import type { Repository } from '../domain/models.js';

// Preserva IDs e hashes de deduplicação. Reduz conteúdo pessoal sem reabrir a fila.
export async function minimizeHistory(
  repository: Repository,
  retentionDays: number,
  now = new Date(),
): Promise<number> {
  const cutoff = now.getTime() - retentionDays * 86400000;
  let count = 0;
  return repository.withLock(async () => {
    const deliveries = await repository.deliveries();
    for (const campaign of await repository.list()) {
      if (Date.parse(campaign.createdAt) >= cutoff) continue;
      let changed = false;
      for (const lead of campaign.leads) {
        const d = deliveries.find((d) => d.channelId === lead.channel.id);
        if (
          (d && ['reserved', 'unknown'].includes(d.status)) ||
          ['positive', 'negotiation'].includes(d?.crmStage ?? '')
        )
          continue;
        if (!lead.channel.description && !lead.draft) continue;
        lead.channel.description = '';
        lead.channel.contactNote = null;
        lead.channel.email = null;
        lead.channel.contactConfidence = 'unverified';
        lead.channel.videos.forEach((v) => (v.description = ''));
        lead.draft = null;
        if (lead.simulation) lead.simulation.body = '';
        lead.assessment.eligible = false;
        lead.assessment.reasons = [
          'Registro minimizado pela política de retenção. ID preservado para deduplicação.',
        ];
        changed = true;
        count++;
      }
      if (changed) await repository.save(campaign);
    }
    for (const d of deliveries) {
      if (
        Date.parse(d.createdAt) >= cutoff ||
        ['reserved', 'unknown'].includes(d.status) ||
        ['positive', 'negotiation'].includes(d.crmStage)
      )
        continue;
      d.recipient = null;
      d.body = '';
      d.replies.forEach((r) => (r.note = 'Conteúdo minimizado pela política de retenção.'));
      await repository.saveDelivery(d);
    }
    return count;
  });
}
