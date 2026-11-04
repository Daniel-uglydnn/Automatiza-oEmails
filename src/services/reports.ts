import type { Campaign } from '../domain/models.js';
import type { Delivery, Run } from '../domain/operations.js';
import { dayKey } from '../domain/time.js';

export function buildReport(
  campaign: Campaign | null,
  deliveries: Delivery[],
  blocked: Record<string, string[]>,
  errors: string[],
  day = campaign ? dayKey(new Date(campaign.createdAt)) : dayKey(new Date()),
): NonNullable<Run['report']> {
  const leads = campaign?.leads ?? [];
  const records = deliveries.filter((d) => d.campaignId === campaign?.id);
  const blockReasons: Record<string, number> = {};
  if (blocked.all && leads.length)
    blocked = Object.fromEntries(
      leads.map((l) => [l.channel.id, [...(blocked[l.channel.id] ?? []), ...blocked.all!]]),
    );
  for (const reasons of Object.values(blocked))
    for (const reason of new Set(reasons)) blockReasons[reason] = (blockReasons[reason] ?? 0) + 1;
  const replies = records.filter((d) => d.replies.length || d.crmStage !== 'new');
  return {
    discovered: leads.length,
    qualified: leads.filter((l) => l.assessment.eligible).length,
    minecraft: leads.filter((l) => l.channel.discoveredFor === 'minecraft').length,
    roblox: leads.filter((l) => l.channel.discoveredFor === 'roblox').length,
    contacts: leads.filter((l) => l.channel.email).length,
    prepared: leads.filter((l) => l.draft).length,
    sent: records.filter((d) => d.status === 'sent').length,
    simulated: leads.filter((l) => l.simulation).length,
    blocked: Object.keys(blocked).length,
    blockReasons,
    replies: deliveries
      .flatMap((d) => d.replies)
      .filter((r) => dayKey(new Date(r.detectedAt ?? r.at)) === day).length,
    positiveReplies: deliveries.filter(
      (d) =>
        d.crmUpdatedAt &&
        dayKey(new Date(d.crmUpdatedAt)) === day &&
        ['positive', 'negotiation', 'won'].includes(d.crmStage),
    ).length,
    errors,
    top: [...leads]
      .sort((a, b) => b.assessment.score - a.assessment.score)
      .slice(0, 10)
      .map((l) => ({
        channelId: l.channel.id,
        title: l.channel.title,
        url: `https://www.youtube.com/channel/${encodeURIComponent(l.channel.id)}`,
        score: l.assessment.score,
        reason: [...l.assessment.evidence.slice(0, 3), ...l.assessment.reasons].join(' '),
      })),
  };
}
const cell = (value: unknown) => {
  let text = String(value ?? '');
  // Evita execução de fórmulas ao abrir o CSV em planilhas.
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
export function campaignsCSV(campaigns: Campaign[], deliveries: Delivery[]): string {
  const header = [
    'channel_id',
    'channel',
    'url',
    'niche',
    'subscribers',
    'score',
    'email',
    'contact_source',
    'verified_at',
    'confidence',
    'discovered_at',
    'status',
    'not_sent_reasons',
  ];
  const rows = campaigns.flatMap((c) =>
    c.leads.map((l) => {
      const delivery = deliveries.find((d) => d.channelId === l.channel.id);
      return [
        l.channel.id,
        l.channel.title,
        `https://www.youtube.com/channel/${encodeURIComponent(l.channel.id)}`,
        l.channel.discoveredFor,
        l.channel.subscriberCount,
        l.assessment.score,
        l.channel.email,
        l.channel.contactUrl,
        l.channel.contactVerifiedAt,
        l.channel.contactConfidence,
        c.createdAt,
        delivery?.status ??
          (l.simulation ? 'simulated' : l.assessment.eligible ? 'prepared' : 'pending'),
        [...l.assessment.reasons, ...(delivery?.error ? [delivery.error] : [])].join(' | '),
      ];
    }),
  );
  return '\uFEFF' + [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
}
export function reportText(run: Run): string {
  const r = run.report;
  return (
    `RESUMO DIÁRIO DE PROSPECÇÃO\nData: ${run.day}\nStatus: ${run.status}\n` +
    (r
      ? `Canais descobertos: ${r.discovered}\nNovos qualificados: ${r.qualified}\nMinecraft: ${r.minecraft}\nRoblox: ${r.roblox}\nContatos: ${r.contacts}\nPropostas: ${r.prepared}\nEnviadas: ${r.sent}\nSimuladas: ${r.simulated}\nBloqueadas: ${r.blocked}\nMotivos: ${JSON.stringify(r.blockReasons)}\nRespostas da campanha: ${r.replies}\nPositivas: ${r.positiveReplies}\nErros: ${r.errors.length}\n${r.errors.join('\n')}\n\nTop oportunidades:\n${r.top.map((t) => `${t.title} · ${t.score}/100 · ${t.url}\n${t.reason}`).join('\n\n')}`
      : 'Execução ainda sem relatório.')
  );
}
