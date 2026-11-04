import { randomUUID } from 'node:crypto';
import { AppError } from '../domain/errors.js';
import {
  campaignInputSchema,
  channelSchema,
  contactEmailSchema,
  reviewSchema,
  rulesSchema,
  sourceUrlSchema,
  type Campaign,
  type Lead,
  type MessageWriter,
  type Repository,
  type DiscoveryProvider,
  type Rules,
} from '../domain/models.js';
import { assess } from '../domain/qualification.js';
import { dayKey } from '../domain/time.js';
import { TemplateWriter, validateMessage } from '../providers/messages.js';
import { z } from 'zod';
import { metadataSuggestions } from './analysis.js';
import { dayKey as operationDay } from '../domain/time.js';

export class ProspectingService {
  constructor(
    readonly repository: Repository,
    private readonly discovery: DiscoveryProvider,
    readonly mode: 'demo' | 'live',
    private readonly aiWriter: MessageWriter | null = null,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async create(input: unknown): Promise<Campaign> {
    const parsed = campaignInputSchema.parse(input);
    return this.repository.withLock(async () => {
      const rules = await this.repository.getRules();
      const history = await this.repository.list();
      const today = dayKey(this.clock());
      const used = history
        .filter((c) => dayKey(new Date(c.createdAt)) === today)
        .reduce((sum, c) => sum + c.leads.length, 0);
      const remaining = rules.discoveryDailyLimit - used;
      if (remaining <= 0) throw new AppError(409, 'Limite diário de descoberta atingido.');
      const actualInput = { ...parsed, maxResults: Math.min(parsed.maxResults, remaining) };
      const known = new Set(history.flatMap((c) => c.leads.map((lead) => lead.channel.id)));
      const discovered = await this.discovery.discover(actualInput, rules, known);
      const unique = new Map<string, z.infer<typeof channelSchema>>();
      for (const candidate of discovered) {
        const channel = channelSchema.parse(candidate);
        if (!known.has(channel.id) && unique.size < actualInput.maxResults)
          unique.set(channel.id, channel);
      }
      const leads: Lead[] = [];
      for (const channel of unique.values()) {
        const review = reviewSchema.parse({});
        const assessment = assess(channel, review, rules, this.clock());
        const draft = assessment.eligible ? await new TemplateWriter().write(channel) : null;
        leads.push({
          channel,
          review,
          assessment,
          draft,
          simulation: null,
          response: null,
          suggestions: metadataSuggestions(channel),
        });
      }
      leads.sort((a, b) => b.assessment.score - a.assessment.score);
      const campaign: Campaign = {
        id: randomUUID(),
        createdAt: this.clock().toISOString(),
        mode: this.mode,
        input: actualInput,
        rules,
        leads,
        warnings: [
          ...(this.mode === 'demo'
            ? ['Dados fictícios de demonstração. Não representam canais ou contatos reais.']
            : []),
          ...(leads.length < actualInput.maxResults
            ? ['Foram encontrados menos canais novos que a meta. Nenhum dado foi inventado.']
            : []),
          'Idioma usa defaultAudioLanguage da amostra, não regionCode nem suposição de país. Ausências exigem revisão.',
          'Potencial comercial é uma heurística de inscritos e views. Edição exige avaliação humana com evidência.',
        ],
      };
      await this.repository.save(campaign);
      return campaign;
    });
  }
  async get(id: string): Promise<Campaign> {
    z.uuid().parse(id);
    const campaign = await this.repository.get(id);
    if (!campaign) throw new AppError(404, 'Campanha não encontrada.');
    return campaign;
  }
  private lead(campaign: Campaign, channelId: string): Lead {
    const lead = campaign.leads.find((l) => l.channel.id === channelId);
    if (!lead) throw new AppError(404, 'Canal não encontrado nesta campanha.');
    return lead;
  }
  async review(id: string, channelId: string, input: unknown): Promise<Campaign> {
    const review = reviewSchema.parse(input);
    return this.repository.withLock(async () => {
      const campaign = await this.get(id);
      const lead = this.lead(campaign, channelId);
      lead.review = review;
      lead.assessment = assess(lead.channel, review, campaign.rules, this.clock());
      if (lead.assessment.eligible && !lead.draft)
        lead.draft = await new TemplateWriter().write(lead.channel);
      await this.repository.save(campaign);
      return campaign;
    });
  }
  async contact(id: string, channelId: string, input: unknown): Promise<Campaign> {
    const contact = z
      .object({
        email: contactEmailSchema,
        sourceUrl: sourceUrlSchema,
        note: z.string().trim().min(10).max(1000),
        publicBusinessContact: z.literal(true),
      })
      .strict()
      .parse(input);
    return this.repository.withLock(async () => {
      const campaign = await this.get(id);
      const lead = this.lead(campaign, channelId);
      if (lead.simulation || lead.response)
        throw new AppError(409, 'Contato com histórico não pode ser substituído.');
      Object.assign(lead.channel, {
        email: contact.email,
        contactUrl: contact.sourceUrl,
        contactNote: contact.note,
        contactSource: 'manual',
        contactVerifiedAt: this.clock().toISOString(),
        contactConfidence: 'high',
      });
      lead.review.messageApproved = false;
      lead.assessment = assess(lead.channel, lead.review, campaign.rules, this.clock());
      if (lead.assessment.eligible && !lead.draft)
        lead.draft = await new TemplateWriter().write(lead.channel);
      await this.repository.save(campaign);
      return campaign;
    });
  }
  async draft(id: string, channelId: string, input: unknown): Promise<Campaign> {
    const options = z
      .object({ useAI: z.boolean().default(false), message: z.unknown().optional() })
      .strict()
      .parse(input);
    return this.repository.withLock(async () => {
      const campaign = await this.get(id);
      const lead = this.lead(campaign, channelId);
      lead.assessment = assess(lead.channel, lead.review, campaign.rules, this.clock());
      if (!lead.assessment.eligible)
        throw new AppError(409, 'Revise os critérios pendentes antes de gerar uma proposta.');
      if (lead.simulation)
        throw new AppError(409, 'O contato já possui uma simulação. Histórico preservado.');
      if (options.message) lead.draft = { ...validateMessage(options.message), source: 'template' };
      else if (options.useAI) {
        if (!this.aiWriter)
          throw new AppError(409, 'Configure LLM_API_KEY ou OPENAI_API_KEY para gerar com IA.');
        lead.draft = await this.aiWriter.write(lead.channel);
      } else lead.draft = await new TemplateWriter().write(lead.channel);
      lead.review.messageApproved = false;
      await this.repository.save(campaign);
      return campaign;
    });
  }
  async simulate(id: string): Promise<{ campaign: Campaign; simulated: number; skipped: number }> {
    return this.repository.withLock(async () => {
      const campaign = await this.get(id);
      const rules = await this.repository.getRules();
      const history = await this.repository.list();
      const blocked = new Set((await this.repository.suppressions()).map((s) => s.email));
      const simulations = history.flatMap((c) =>
        c.leads.flatMap((lead) =>
          lead.simulation ? [{ ...lead.simulation, channelId: lead.channel.id }] : [],
        ),
      );
      const contactedChannels = new Set(simulations.map((s) => s.channelId));
      const contactedEmails = new Set(simulations.map((s) => s.recipient));
      let remaining = Math.max(
        0,
        rules.dailyContactLimit -
          simulations.filter((s) => dayKey(new Date(s.at)) === dayKey(this.clock())).length,
      );
      let simulated = 0;
      for (const lead of [...campaign.leads].sort(
        (a, b) => b.assessment.score - a.assessment.score,
      )) {
        lead.assessment = assess(lead.channel, lead.review, rules, this.clock());
        const email = lead.channel.email;
        if (
          !remaining ||
          !lead.assessment.eligible ||
          !email ||
          !lead.draft ||
          lead.response ||
          lead.simulation ||
          blocked.has(email) ||
          contactedChannels.has(lead.channel.id) ||
          contactedEmails.has(email)
        )
          continue;
        validateMessage({ subject: lead.draft.subject, body: lead.draft.body });
        lead.simulation = {
          id: randomUUID(),
          at: this.clock().toISOString(),
          recipient: email,
          subject: lead.draft.subject,
          body: lead.draft.body,
        };
        contactedChannels.add(lead.channel.id);
        contactedEmails.add(email);
        remaining--;
        simulated++;
      }
      // Apenas persistência local/Supabase. Nenhuma chamada ao Gmail é feita.
      await this.repository.save(campaign);
      return { campaign, simulated, skipped: campaign.leads.length - simulated };
    });
  }
  async response(id: string, channelId: string, input: unknown): Promise<Campaign> {
    const response = z
      .object({
        kind: z.enum(['received', 'positive', 'negotiation', 'won', 'negative', 'unsubscribe']),
        note: z.string().trim().max(1000).default(''),
      })
      .strict()
      .parse(input);
    return this.repository.withLock(async () => {
      const campaign = await this.get(id);
      const lead = this.lead(campaign, channelId);
      // Bloqueio é persistido primeiro; uma falha subsequente não reabilita o contato.
      if (lead.channel.email && ['negative', 'unsubscribe'].includes(response.kind))
        await this.repository.suppress(
          lead.channel.email,
          response.kind as 'negative' | 'unsubscribe',
        );
      lead.response = { ...response, at: this.clock().toISOString() };
      const delivery = (await this.repository.deliveries()).find(
        (d) => d.channelId === lead.channel.id,
      );
      if (delivery) {
        delivery.crmStage = response.kind === 'received' ? 'replied' : response.kind;
        delivery.crmUpdatedAt = lead.response.at;
        await this.repository.saveDelivery(delivery);
      }
      await this.repository.save(campaign);
      return campaign;
    });
  }
  async updateRules(input: unknown, complianceReviewed: boolean): Promise<Rules> {
    const rules = rulesSchema.parse(input);
    return this.repository.withLock(async () => {
      const old = await this.repository.getRules();
      if (rules.dailyContactLimit > old.dailyContactLimit && !complianceReviewed)
        throw new AppError(
          409,
          'Aumentar o limite exige registrar a revisão de conformidade, qualidade e reputação.',
        );
      await this.repository.saveRules(rules);
      return rules;
    });
  }
  async suppress(input: unknown, reason: 'manual' | 'unsubscribe' = 'manual'): Promise<void> {
    const email = contactEmailSchema.parse(input);
    return this.repository.suppress(email, reason);
  }
  async recordError(error: unknown): Promise<void> {
    const message =
      error instanceof AppError
        ? error.message
        : 'Falha interna. Verifique configuração e armazenamento.';
    await this.repository
      .withLock(() =>
        this.repository.addEvent({ id: randomUUID(), at: this.clock().toISOString(), message }),
      )
      .catch(() => undefined);
  }
  async dashboard() {
    const campaigns = await this.repository.list();
    const leads = campaigns.flatMap((c) => c.leads);
    const deliveries = await this.repository.deliveries();
    const sent = deliveries.filter((d) => d.status === 'sent');
    const replied = sent.filter((d) => d.replies.length || d.crmStage !== 'new');
    const positive = sent.filter((d) => ['positive', 'negotiation', 'won'].includes(d.crmStage));
    const won = sent.filter((d) => d.crmStage === 'won');
    return {
      mode: this.mode,
      deliveryMode: 'dry-run' as const,
      followUpsEnabled: false,
      schedule: { timezone: 'America/Fortaleza', time: '09:00', cronUTC: '0 12 * * *' },
      stats: {
        discovered: leads.length,
        qualified: leads.filter((l) => l.assessment.eligible).length,
        businessContacts: leads.filter((l) => l.channel.email).length,
        simulated: leads.filter((l) => l.simulation).length,
        prepared: leads.filter((l) => l.draft).length,
        sent: sent.length,
        replies: new Set([
          ...replied.map((d) => d.channelId),
          ...leads.filter((l) => l.response).map((l) => l.channel.id),
        ]).size,
        positiveReplies: new Set([
          ...positive.map((d) => d.channelId),
          ...leads
            .filter((l) => ['positive', 'negotiation', 'won'].includes(l.response?.kind ?? ''))
            .map((l) => l.channel.id),
        ]).size,
        negotiation: new Set([
          ...sent.filter((d) => d.crmStage === 'negotiation').map((d) => d.channelId),
          ...leads.filter((l) => l.response?.kind === 'negotiation').map((l) => l.channel.id),
        ]).size,
        won: new Set([
          ...won.map((d) => d.channelId),
          ...leads.filter((l) => l.response?.kind === 'won').map((l) => l.channel.id),
        ]).size,
        responseRate: sent.length ? replied.length / sent.length : null,
        conversionRate: sent.length ? won.length / sent.length : null,
        sentToday: sent.filter(
          (d) => operationDay(new Date(d.createdAt)) === operationDay(this.clock()),
        ).length,
        discoveredToday: campaigns
          .filter((c) => dayKey(new Date(c.createdAt)) === dayKey(this.clock()))
          .reduce((sum, c) => sum + c.leads.length, 0),
        simulatedToday: leads.filter(
          (l) => l.simulation && dayKey(new Date(l.simulation.at)) === dayKey(this.clock()),
        ).length,
      },
      campaigns,
      rules: await this.repository.getRules(),
      suppressions: await this.repository.suppressions(),
      errors: await this.repository.events(),
    };
  }
}
