import { z } from 'zod';
import type { Config } from '../config.js';
import { AppError } from '../domain/errors.js';
import type { Repository } from '../domain/models.js';
import { operationsSchema, type Operations } from '../domain/operations.js';
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
