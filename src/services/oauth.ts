import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config.js';
import { AppError } from '../domain/errors.js';
import { seal, unseal } from '../domain/credentials.js';
import { accountSchema, gmailScopes, type Account } from '../domain/operations.js';
import type { Repository } from '../domain/models.js';
import { GmailClient, type MailTransport } from '../providers/gmail.js';
import { requestJson, type Fetch } from '../providers/http.js';

export class GmailConnection {
  constructor(
    private readonly config: Config,
    private readonly repository: Repository,
    private readonly fetcher: Fetch = fetch,
  ) {}
  private redirectURI(): string {
    return `${this.config.PUBLIC_ORIGIN ?? `http://127.0.0.1:${this.config.PORT}`}/oauth/gmail/callback`;
  }
  async account(): Promise<Account | null> {
    const value = await this.repository.getRecord('credentials', 'gmail');
    return value ? accountSchema.parse(value) : null;
  }
  async status() {
    const a = await this.account();
    return {
      connected: !!a,
      email: a?.email ?? null,
      verifiedAt: a?.verifiedAt ?? null,
      scopes: a?.scopes ?? [],
    };
  }
  async start(): Promise<string> {
    if (!this.config.GMAIL_CLIENT_ID || !this.config.GMAIL_CLIENT_SECRET)
      throw new AppError(503, 'Configure GMAIL_CLIENT_ID e GMAIL_CLIENT_SECRET.');
    const state = randomBytes(32).toString('base64url'),
      verifier = randomBytes(48).toString('base64url');
    const sealed = seal(
      JSON.stringify({ verifier, expires: Date.now() + 600000 }),
      this.config.CREDENTIAL_ENCRYPTION_KEY,
    );
    await this.repository.withLock(() =>
      this.repository.putRecord('oauth', createHash('sha256').update(state).digest('hex'), {
        sealed,
        used: false,
      }),
    );
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.config.GMAIL_CLIENT_ID,
      redirect_uri: this.redirectURI(),
      response_type: 'code',
      scope: gmailScopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    }).toString();
    return url.href;
  }
  async callback(code: string, state: string): Promise<void> {
    const id = createHash('sha256').update(state).digest('hex');
    const verifier = await this.repository.withLock(async () => {
      const record = z
        .object({ sealed: z.string(), used: z.boolean() })
        .safeParse(await this.repository.getRecord('oauth', id));
      if (!record.success || record.data.used)
        throw new AppError(400, 'Autorização OAuth expirada, inválida ou já utilizada.');
      const payload = z
        .object({ verifier: z.string(), expires: z.number() })
        .parse(JSON.parse(unseal(record.data.sealed, this.config.CREDENTIAL_ENCRYPTION_KEY)));
      if (payload.expires < Date.now()) throw new AppError(400, 'Autorização OAuth expirada.');
      await this.repository.putRecord('oauth', id, { sealed: '', used: true });
      return payload.verifier;
    });
    const result = z.object({ refresh_token: z.string(), scope: z.string() }).safeParse(
      await requestJson(
        this.fetcher,
        'https://oauth2.googleapis.com/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: this.config.GMAIL_CLIENT_ID!,
            client_secret: this.config.GMAIL_CLIENT_SECRET!,
            redirect_uri: this.redirectURI(),
            grant_type: 'authorization_code',
            code,
            code_verifier: verifier,
          }),
        },
        'OAuth do Gmail',
      ),
    );
    if (
      !result.success ||
      !gmailScopes.every((scope) => result.data.scope.split(' ').includes(scope))
    )
      throw new AppError(
        400,
        'Google não concedeu offline access e os escopos necessários. Reconecte com consentimento.',
      );
    await this.verifyAndStore(result.data.refresh_token, result.data.scope.split(' '));
  }
  private async verifyAndStore(refresh: string, scopes: string[] = []): Promise<Account> {
    const client = new GmailClient(
      {
        clientId: this.config.GMAIL_CLIENT_ID!,
        clientSecret: this.config.GMAIL_CLIENT_SECRET!,
        refreshToken: refresh,
      },
      this.fetcher,
      scopes,
    );
    const profile = await client.profile();
    if (!gmailScopes.every((scope) => profile.scopes.includes(scope)))
      throw new AppError(
        400,
        'Faltam os escopos gmail.send e gmail.readonly na autorização Google.',
      );
    const account: Account = {
      email: profile.email,
      scopes: profile.scopes,
      verifiedAt: new Date().toISOString(),
      sealedRefreshToken: seal(refresh, this.config.CREDENTIAL_ENCRYPTION_KEY),
    };
    await this.repository.withLock(() =>
      this.repository.putRecord('credentials', 'gmail', account),
    );
    return account;
  }
  async validateEnvironment(): Promise<void> {
    if (
      !this.config.GMAIL_CLIENT_ID ||
      !this.config.GMAIL_CLIENT_SECRET ||
      !this.config.GMAIL_REFRESH_TOKEN
    )
      throw new AppError(503, 'Configure credenciais OAuth ou conecte o Gmail pelo dashboard.');
    await this.verifyAndStore(this.config.GMAIL_REFRESH_TOKEN);
  }
  async transport(): Promise<MailTransport> {
    const account = await this.account();
    if (
      !account ||
      !account.sealedRefreshToken ||
      !this.config.GMAIL_CLIENT_ID ||
      !this.config.GMAIL_CLIENT_SECRET
    )
      throw new AppError(503, 'Conecte e valide o Gmail antes de ativar o envio.');
    return new GmailClient(
      {
        clientId: this.config.GMAIL_CLIENT_ID,
        clientSecret: this.config.GMAIL_CLIENT_SECRET,
        refreshToken: unseal(account.sealedRefreshToken, this.config.CREDENTIAL_ENCRYPTION_KEY),
      },
      this.fetcher,
      account.scopes,
    );
  }
}
