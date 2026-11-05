import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import { AppError } from '../domain/errors.js';
import type { Repository } from '../domain/models.js';
import { jurisdictionSchema, operationsSchema, type Operations } from '../domain/operations.js';
import { unsubscribeToken } from '../domain/unsubscribe.js';
import type { GmailConnection } from './oauth.js';
import { activationReasons } from './compliance.js';
import type { Fetch } from '../providers/http.js';

const editable = operationsSchema.omit({
  authorizedAt: true,
  unsubscribeVerifiedAt: true,
  breaker: true,
});
export class OperationsService {
  constructor(
    private readonly config: Config,
    private readonly repository: Repository,
    private readonly gmail: GmailConnection,
    private readonly fetcher: Fetch = fetch,
  ) {}
  async get(): Promise<Operations> {
    return operationsSchema.parse((await this.repository.getRecord('operations', 'default')) ?? {});
  }
  async update(input: unknown) {
    const changes = editable.partial().strict().parse(input);
    return this.repository.withLock(async () => {
      const previous = await this.get();
      const settings = operationsSchema.parse({ ...previous, ...changes });
      if (
        JSON.stringify(previous.business) !== JSON.stringify(settings.business) ||
        JSON.stringify(previous.jurisdictions) !== JSON.stringify(settings.jurisdictions)
      ) {
        settings.authorizedAt = null;
        settings.unsubscribeVerifiedAt = null;
      }
      if (settings.reportEmail && settings.reportEmail !== settings.business?.email)
        throw new AppError(
          400,
          'Relatórios por e-mail só podem ser enviados ao próprio remetente comercial validado.',
        );
      await this.repository.putRecord('operations', 'default', settings);
      return settings;
    });
  }
  async reviewJurisdiction(input: unknown): Promise<Operations> {
    const { confirmed: _confirmed, ...review } = jurisdictionSchema
      .omit({ reviewedAt: true })
      .extend({ confirmed: z.literal(true) })
      .strict()
      .parse(input);
    return this.changeJurisdictions((previous) => [
      ...previous.filter((rule) => rule.country !== review.country),
      { ...review, reviewedAt: new Date().toISOString() },
    ]);
  }
  async removeJurisdiction(country: unknown): Promise<Operations> {
    const code = jurisdictionSchema.shape.country.parse(country);
    return this.changeJurisdictions((previous) => previous.filter((rule) => rule.country !== code));
  }
  private async changeJurisdictions(
    change: (previous: Operations['jurisdictions']) => Operations['jurisdictions'],
  ): Promise<Operations> {
    return this.repository.withLock(async () => {
      const previous = await this.get();
      const settings = operationsSchema.parse({
        ...previous,
        jurisdictions: change(previous.jurisdictions),
      });
      if (JSON.stringify(previous.jurisdictions) !== JSON.stringify(settings.jurisdictions)) {
        settings.authorizedAt = null;
        settings.unsubscribeVerifiedAt = null;
      }
      await this.repository.putRecord('operations', 'default', settings);
      return settings;
    });
  }
  async testUnsubscribe(): Promise<{ verified: true; verifiedAt: string }> {
    if (!this.config.PUBLIC_ORIGIN || !this.config.UNSUBSCRIBE_SIGNING_KEY)
      throw new AppError(
        409,
        'Configure UNSUBSCRIBE_SIGNING_KEY e a origem pública HTTPS (PUBLIC_ORIGIN ou URL automática do Render), e aguarde o deploy ficar Live antes de testar o descadastro.',
      );
    // .invalid é reservado para testes. Nunca usa a conta Gmail nem um lead real.
    const email = `unsubscribe-self-test-${randomUUID()}@example.invalid`;
    const token = unsubscribeToken(email, this.config.UNSUBSCRIBE_SIGNING_KEY);
    const url = `${this.config.PUBLIC_ORIGIN}/unsubscribe?token=${token}`;
    await this.repository.withLock(async () => {
      const settings = await this.get();
      settings.unsubscribeVerifiedAt = null;
      await this.repository.putRecord('operations', 'default', settings);
    });
    try {
      // Não manter lock durante HTTP: o POST público precisa persistir a exclusão.
      const confirmation = await this.fetcher(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      const confirmed =
        confirmation.ok &&
        confirmation.headers.get('X-Unsubscribe-Handler') === 'creator-outreach-v1';
      await confirmation.body?.cancel();
      if (!confirmed)
        throw new AppError(
          502,
          'A página pública de descadastro não passou no teste. Confira o domínio público e o último deploy.',
        );
      const result = await this.fetcher(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      });
      const accepted = result.ok;
      await result.body?.cancel();
      if (!accepted)
        throw new AppError(
          502,
          'O endpoint público recusou o descadastro de teste. Confira se o deploy está atualizado e a chave está configurada.',
        );
      const blocked = (await this.repository.suppressions()).some(
        (entry) => entry.email === email && entry.reason === 'unsubscribe',
      );
      if (!blocked)
        throw new AppError(
          502,
          'O descadastro respondeu, mas o bloqueio não foi encontrado no banco. Confira a configuração do Supabase.',
        );
      const verifiedAt = new Date().toISOString();
      await this.repository.withLock(async () => {
        const settings = await this.get();
        settings.unsubscribeVerifiedAt = verifiedAt;
        await this.repository.putRecord('operations', 'default', settings);
      });
      return { verified: true, verifiedAt };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        502,
        'Não foi possível concluir o teste público de descadastro. Confira HTTPS, rede e o último deploy do Render.',
      );
    }
  }
  async authorize(input: unknown): Promise<Operations> {
    z.object({
      authorization: z.literal('AUTHORIZE_AUTOMATIC_OUTREACH'),
      identityReviewed: z.literal(true),
      complianceReviewed: z.literal(true),
      unsubscribeReviewed: z.literal(true),
    })
      .strict()
      .parse(input);
    // Esta configuração só pode ser alterada pelo administrador da hospedagem, não pelo dashboard.
    if (this.config.ENABLE_LIVE_SENDS !== 'true' || this.config.DELIVERY_MODE !== 'live')
      throw new AppError(
        409,
        'Envio real continua desativado no servidor. Nenhuma autorização foi registrada.',
      );
    const account = await this.gmail.account();
    if (!account) throw new AppError(409, 'Conecte o Gmail antes de autorizar envios.');
    const profile = await (await this.gmail.transport()).profile();
    if (profile.email !== account.email)
      throw new AppError(409, 'A conta Google conectada mudou. Reconecte-a.');
    const settings = await this.get();
    const proposed = {
      ...settings,
      authorizedAt: new Date().toISOString(),
      unsubscribeVerifiedAt: new Date().toISOString(),
      breaker: null,
    };
    const reasons = activationReasons(this.config, proposed, {
      ...account,
      scopes: profile.scopes,
    });
    if (reasons.length) throw new AppError(409, reasons.join(' '));
    const token = unsubscribeToken(settings.business!.email, this.config.UNSUBSCRIBE_SIGNING_KEY!);
    const url = `${this.config.PUBLIC_ORIGIN}/unsubscribe?token=${token}`;
    const response = await this.fetcher(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok || response.headers.get('X-Unsubscribe-Handler') !== 'creator-outreach-v1') {
      await response.body?.cancel();
      throw new AppError(409, 'Endpoint público HTTPS de descadastro não passou na validação.');
    }
    await response.body?.cancel();
    return this.repository.withLock(async () => {
      const current = await this.get();
      if (JSON.stringify(current) !== JSON.stringify(settings))
        throw new AppError(409, 'Configuração mudou durante a validação. Repita a autorização.');
      await this.repository.putRecord('operations', 'default', proposed);
      return proposed;
    });
  }
  async revoke(): Promise<void> {
    await this.repository.withLock(async () => {
      const s = await this.get();
      s.authorizedAt = null;
      s.paused = true;
      await this.repository.putRecord('operations', 'default', s);
    });
  }
}
