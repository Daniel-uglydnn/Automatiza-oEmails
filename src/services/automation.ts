import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import { AppError } from '../domain/errors.js';
import type { Campaign } from '../domain/models.js';
import { operationsSchema, runSchema, type Run } from '../domain/operations.js';
import { dayKey } from '../domain/time.js';
import type { PublicWebsiteContacts } from '../providers/public-contacts.js';
import { assess } from '../domain/qualification.js';
import type { ProspectingService } from './prospecting.js';
import type { DeliveryService } from './delivery.js';
import type { ReplyTracking } from './tracking.js';
import { buildReport } from './reports.js';
import { personalizationReasons } from './compliance.js';
import { minimizeHistory } from './retention.js';
import { notifyReport } from './report-notification.js';
import type { MailTransport } from '../providers/gmail.js';

export class AutomationService {
  constructor(
    private readonly config: Config,
    private readonly prospects: ProspectingService,
    private readonly delivery: DeliveryService,
    private readonly tracking: ReplyTracking,
    private readonly contacts: PublicWebsiteContacts,
    private readonly clock: () => Date = () => new Date(),
    private readonly transport?: () => Promise<MailTransport>,
  ) {}
  async run(scheduled: boolean, forceSimulation = false): Promise<Run> {
    const repo = this.prospects.repository;
    return repo.withAutomationLock(async () => {
      const day = dayKey(this.clock());
      const id = scheduled ? `daily:${day}` : `manual:${randomUUID()}`;
      const previousValue = await repo.getRecord('runs', id);
      const previous = previousValue ? runSchema.parse(previousValue) : null;
      if (previous?.status === 'completed') return previous;
      const run: Run = previous ?? {
        id,
        day,
        startedAt: this.clock().toISOString(),
        completedAt: null,
        status: 'running',
        campaignId: null,
        report: null,
      };
      const interrupted = previous?.status === 'running' || previous?.status === 'failed';
      run.status = 'running';
      await repo.withLock(() => repo.putRecord('runs', id, run));
      const deadline = Date.now() + 660000;
      const errors: string[] = interrupted
        ? ['Retomada após interrupção. Reservas anteriores não serão reenviadas.']
        : [];
      let blocked: Record<string, string[]> = {};
      let campaign: Campaign | null = null;
      try {
        const settings = operationsSchema.parse(
          (await repo.getRecord('operations', 'default')) ?? {},
        );
        if (settings.paused) {
          run.status = 'skipped';
          blocked.all = ['Automação pausada pelo operador.'];
        } else {
          if (run.campaignId) campaign = await this.prospects.get(run.campaignId);
          else {
            const rules = await repo.getRules();
            campaign = await this.prospects.create({ maxResults: rules.discoveryDailyLimit });
            run.campaignId = campaign.id;
            await repo.withLock(() => repo.putRecord('runs', id, run));
          }
          for (const channelId of campaign.leads.map((l) => l.channel.id)) {
            const lead = campaign.leads.find((l) => l.channel.id === channelId)!;
            if (Date.now() > deadline) {
              blocked[lead.channel.id] = ['Tempo da execução esgotado.'];
              continue;
            }
            if (!lead.channel.email && this.config.APP_MODE === 'live') {
              lead.channel = await this.contacts.find(lead.channel);
              lead.assessment = assess(lead.channel, lead.review, campaign.rules, this.clock());
              await repo.withLock(() => repo.save(campaign!));
            }
            if (!lead.assessment.eligible) {
              blocked[lead.channel.id] = lead.assessment.reasons;
              continue;
            }
            try {
              const useAI =
                settings.useAI && !!(this.config.LLM_API_KEY || this.config.OPENAI_API_KEY);
              if (!lead.simulation && useAI)
                campaign = await this.prospects.draft(campaign.id, lead.channel.id, {
                  useAI: true,
                });
              const current = campaign.leads.find((l) => l.channel.id === lead.channel.id)!;
              const reasons = personalizationReasons(current);
              if (reasons.length) blocked[lead.channel.id] = reasons;
            } catch (error) {
              errors.push(
                error instanceof AppError ? error.message : 'Falha ao preparar proposta.',
              );
              blocked[lead.channel.id] = ['Geração de proposta falhou.'];
            }
          }
          // Propostas sem personalização são retiradas da fila, nunca completadas com alegações inventadas.
          for (const lead of campaign.leads)
            if (
              blocked[lead.channel.id]?.some(
                (r) => r.includes('personaliza') || r.includes('Geração'),
              )
            )
              lead.draft = null;
          await repo.withLock(() => repo.save(campaign!));
          if (!forceSimulation && this.config.DELIVERY_MODE === 'live') {
            if (!(await this.delivery.readiness()).length) {
              await this.delivery.reconcile(deadline);
              await this.tracking.sync(deadline);
            }
            // Leads elegíveis de dias anteriores continuam na fila; apenas descobertas são "novas".
            const backlog = (await repo.list())
              .filter((c) => c.mode === 'live')
              .sort(
                (a, b) =>
                  Math.max(0, ...b.leads.map((l) => l.assessment.score)) -
                  Math.max(0, ...a.leads.map((l) => l.assessment.score)),
              );
            for (const queued of backlog) {
              if (Date.now() >= deadline) break;
              const result = await this.delivery.dispatch(queued.id, deadline);
              blocked = { ...blocked, ...result.blocked };
              if ((await this.delivery.settings()).breaker) break;
            }
            await this.tracking.sync(deadline);
          } else {
            const result = await this.prospects.simulate(campaign.id);
            campaign = result.campaign;
            const excluded = new Set((await repo.suppressions()).map((s) => s.email));
            for (const lead of campaign.leads)
              if (!lead.simulation)
                blocked[lead.channel.id] ??= excluded.has(lead.channel.email ?? '')
                  ? ['Endereço excluído de contatos.']
                  : lead.assessment.reasons.length
                    ? lead.assessment.reasons
                    : ['Limite diário, resposta ou histórico de contato impedem simulação.'];
          }
          run.status = 'completed';
        }
      } catch (error) {
        run.status = 'failed';
        errors.push(error instanceof AppError ? error.message : 'Falha interna na execução.');
        await this.prospects.recordError(error);
      }
      if (run.campaignId) campaign = await repo.get(run.campaignId);
      run.report = buildReport(campaign, await repo.deliveries(), blocked, errors, day);
      if (!forceSimulation && this.config.DELIVERY_MODE === 'live')
        run.report.sent = (await repo.deliveries()).filter(
          (d) => d.status === 'sent' && Date.parse(d.createdAt) >= Date.parse(run.startedAt),
        ).length;
      run.completedAt = this.clock().toISOString();
      await repo.withLock(() => repo.putRecord('runs', id, run));
      try {
        if (
          Date.now() < deadline &&
          !forceSimulation &&
          this.config.DELIVERY_MODE === 'live' &&
          this.transport
        )
          await notifyReport(this.config, repo, this.delivery, this.transport, run);
        await minimizeHistory(repo, (await this.delivery.settings()).retentionDays, this.clock());
      } catch (error) {
        await this.prospects.recordError(error);
        run.report.errors.push(
          'Falha no resumo por e-mail ou na retenção. Confira o histórico de erros.',
        );
        await repo.withLock(() => repo.putRecord('runs', id, run));
      }
      console.log(
        JSON.stringify({
          event: 'automation.completed',
          runId: run.id,
          status: run.status,
          discovered: run.report.discovered,
          sent: run.report.sent,
          simulated: run.report.simulated,
          errors: errors.length,
        }),
      );
      return run;
    });
  }
}
