import { createHash, randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import { AppError } from '../domain/errors.js';
import type { Repository } from '../domain/models.js';
import {
  accountSchema,
  gmailScopes,
  deliverySchema,
  operationsSchema,
  type Delivery,
  type Operations,
} from '../domain/operations.js';
import { dayKey } from '../domain/time.js';
import { unsubscribeToken } from '../domain/unsubscribe.js';
import type { MailTransport } from '../providers/gmail.js';
import { ProviderError } from '../providers/http.js';
import { assess } from '../domain/qualification.js';
import { activationReasons, recipientReasons } from './compliance.js';

export const emailKey = (email: string) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
export class DeliveryService {
  constructor(
    private readonly config: Config,
    private readonly repository: Repository,
    private readonly transport: () => Promise<MailTransport>,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  async settings(): Promise<Operations> {
    return operationsSchema.parse((await this.repository.getRecord('operations', 'default')) ?? {});
  }
  async readiness(): Promise<string[]> {
    const value = await this.repository.getRecord('credentials', 'gmail');
    return activationReasons(
      this.config,
      await this.settings(),
      value ? accountSchema.parse(value) : null,
    );
  }
  async dispatch(
    campaignId: string,
    deadline = Date.now() + 600000,
  ): Promise<{ sent: number; blocked: Record<string, string[]> }> {
    if (Date.now() >= deadline)
      return { sent: 0, blocked: { all: ['Orçamento de tempo da execução esgotado.'] } };
    const blocked: Record<string, string[]> = {};
    let sent = 0;
    const initial = await this.readiness();
    if (initial.length) return { sent, blocked: { all: initial } };
    const mail = await this.transport();
    let profile: Awaited<ReturnType<MailTransport['profile']>>;
    try {
      profile = await mail.profile();
    } catch {
      await this.repository.withLock(async () => {
        const settings = await this.settings();
        settings.breaker = 'Falha de autenticação/validação Gmail. Reconecte antes de autorizar.';
        settings.authorizedAt = null;
        await this.repository.putRecord('operations', 'default', settings);
      });
      throw new AppError(502, 'Validação da conta Gmail falhou. Envios interrompidos.');
    }
    if (!gmailScopes.every((scope) => profile.scopes.includes(scope)))
      throw new AppError(409, 'Permissões Gmail insuficientes; reconecte a conta.');
    const initialSettings = await this.settings();
    if (profile.email !== initialSettings.business?.email)
      throw new AppError(409, 'Conta Gmail diferente do remetente autorizado.');
    const campaign = await this.repository.get(campaignId);
    if (!campaign) throw new AppError(404, 'Campanha não encontrada.');
    if (campaign.mode !== 'live')
      return { sent, blocked: { all: ['Campanhas de demonstração não enviam e-mails reais.'] } };
    for (const candidate of [...campaign.leads].sort(
      (a, b) => b.assessment.score - a.assessment.score,
    )) {
      if (Date.now() >= deadline) {
        blocked[candidate.channel.id] = ['Orçamento de tempo da execução esgotado.'];
        continue;
      }
      const attempt = await this.repository.withLock(async () => {
        const reasons = await this.readiness();
        const settings = await this.settings();
        const fresh = await this.repository.get(campaignId);
        const lead = fresh?.leads.find((l) => l.channel.id === candidate.channel.id);
        if (!lead) return null;
        const rules = await this.repository.getRules();
        lead.assessment = assess(lead.channel, lead.review, rules, this.clock());
        reasons.push(...recipientReasons(lead, settings, this.clock()));
        const history = await this.repository.deliveries();
        const reports = (await this.repository.listRecords('report-mails')) as Array<{
          at: string;
        }>;
        const used =
          history.filter((d) => dayKey(new Date(d.createdAt)) === dayKey(this.clock())).length +
          reports.filter((d) => dayKey(new Date(d.at)) === dayKey(this.clock())).length;
        const reserveForSummary = settings.reportEmail ? 1 : 0;
        if (used >= rules.dailyContactLimit - reserveForSummary)
          reasons.push('Limite diário de envio atingido.');
        if ((await this.repository.suppressions()).some((s) => s.email === lead.channel.email))
          reasons.push('Endereço excluído de contatos.');
        if (
          history.some(
            (d) =>
              d.channelId === lead.channel.id || d.emailKey === emailKey(lead.channel.email ?? ''),
          )
        )
          reasons.push('Canal ou endereço já reservado/abordado; nunca reenviar automaticamente.');
        if (reasons.length) {
          blocked[lead.channel.id] = [...new Set(reasons)];
          return null;
        }
        const id = randomUUID(),
          business = settings.business!;
        const link = `${this.config.PUBLIC_ORIGIN}/unsubscribe?token=${unsubscribeToken(lead.channel.email!, this.config.UNSUBSCRIBE_SIGNING_KEY!)}`;
        const delivery: Delivery = deliverySchema.parse({
          id,
          campaignId,
          channelId: lead.channel.id,
          emailKey: emailKey(lead.channel.email!),
          recipient: lead.channel.email,
          createdAt: this.clock().toISOString(),
          status: 'reserved',
          subject: lead.draft!.subject,
          body: `${lead.draft!.body}\n\nBest,\n${business.name}\n${business.email}\nCommercial proposal · ${business.postalAddress}\nTo stop future commercial contact: ${link}`,
          rfcMessageId: `${id}@${business.email.split('@')[1]}`,
          gmailMessageId: null,
          gmailThreadId: null,
          error: null,
        });
        if (!(await this.repository.reserveDelivery(delivery))) {
          blocked[lead.channel.id] = ['Reserva duplicada impedida pelo banco.'];
          return null;
        }
        // A reserva é durável antes de qualquer efeito externo.
        return { delivery, business, link };
      });
      if (!attempt) continue;
      const { delivery, business, link } = attempt;
      // Rechecar descadastro e pausa imediatamente antes do envio, sob o mesmo lock
      // usado pelo endpoint de exclusão. Não há intervalo entre a checagem e o POST.
      await this.repository.withLock(async () => {
        const stop = await this.readiness();
        if ((await this.repository.suppressions()).some((s) => s.email === delivery.recipient))
          stop.push('Descadastro recebido antes do envio.');
        if (stop.length) {
          delivery.status = 'rejected';
          delivery.error = stop.join(' ');
          await this.repository.saveDelivery(delivery);
          blocked[delivery.channelId] = stop;
          return;
        }
        try {
          const result = await mail.send(
            delivery.recipient!,
            { subject: delivery.subject, body: delivery.body },
            {
              from: business.email,
              name: business.name,
              unsubscribeUrl: link,
              messageId: delivery.rfcMessageId,
            },
          );
          delivery.status = 'sent';
          delivery.gmailMessageId = result.id;
          delivery.gmailThreadId = result.threadId;
          await this.repository.saveDelivery(delivery);
          sent++;
        } catch (error) {
          delivery.status =
            error instanceof ProviderError && [400, 401, 403, 429].includes(error.providerStatus)
              ? 'rejected'
              : 'unknown';
          delivery.error =
            'Envio interrompido; não repetir automaticamente. Confira Gmail e reconciliação.';
          await this.repository.saveDelivery(delivery);
          const settings = await this.settings();
          settings.breaker =
            'Falha do Gmail ou resultado incerto. Valide a conta e reconcilie antes de reativar.';
          settings.authorizedAt = null;
          await this.repository.putRecord('operations', 'default', settings);
          blocked[delivery.channelId] = [delivery.error];
        }
      });
      if ((await this.settings()).breaker) break;
    }
    return { sent, blocked };
  }
  async reconcile(deadline = Date.now() + 120000): Promise<number> {
    const pending = (await this.repository.deliveries()).filter((d) =>
      ['unknown', 'reserved'].includes(d.status),
    );
    if (!pending.length || Date.now() >= deadline) return 0;
    const mail = await this.transport();
    let found = 0;
    for (const entry of pending.slice(0, 100)) {
      if (Date.now() >= deadline) break;
      const matches = await mail.findSent(entry.rfcMessageId);
      if (matches.length !== 1) continue; // ausência no Gmail não autoriza novo envio
      await this.repository.withLock(async () => {
        const current = (await this.repository.deliveries()).find((d) => d.id === entry.id)!;
        current.status = 'sent';
        current.gmailMessageId = matches[0]!.id;
        current.gmailThreadId = matches[0]!.threadId;
        current.error = null;
        await this.repository.saveDelivery(current);
        found++;
      });
    }
    return found;
  }
}
