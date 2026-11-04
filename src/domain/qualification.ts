import type { Assessment, Channel, Review, Rules } from './models.js';

export function nicheOf(title: string): 'minecraft' | 'roblox' | null {
  if (/\bminecraft\b/i.test(title)) return 'minecraft';
  if (/\b(roblox|blox fruits|brookhaven|dress to impress|fisch)\b/i.test(title)) return 'roblox';
  return null; // "Doors" sozinho não prova que o vídeo é de Roblox.
}
export function assess(channel: Channel, review: Review, rules: Rules, now: Date): Assessment {
  const reasons: string[] = [];
  const evidence: string[] = [];
  const videos = channel.videos.filter((v) => new Date(v.publishedAt) <= now);
  const english = videos.filter((v) => /^en(?:-|$)/i.test(v.language ?? '')).length;
  const portuguese = videos.filter((v) => /^pt(?:-|$)/i.test(v.language ?? '')).length;
  const language =
    review.language !== 'unknown'
      ? review.language
      : videos.length && english / videos.length > 0.5
        ? 'en'
        : portuguese / Math.max(videos.length, 1) > 0.5
          ? 'pt'
          : 'unknown';
  if (channel.country?.toUpperCase() === 'BR') reasons.push('Canal declarado como brasileiro.');
  if (language !== 'en')
    reasons.push(
      language === 'unknown'
        ? 'Idioma predominante precisa de verificação.'
        : 'Conteúdo não é predominantemente em inglês.',
    );
  const nicheMatches = videos.filter((v) => nicheOf(v.title) !== null).length;
  const nicheConfirmed =
    review.niche === 'unknown'
      ? videos.length > 0 && nicheMatches / videos.length > 0.5
      : review.niche !== 'other';
  if (!nicheConfirmed)
    reasons.push('Nicho Minecraft/Roblox precisa de verificação ou está fora do alvo.');
  const recent = [...videos].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const days = recent[0]
    ? (now.getTime() - Date.parse(recent[0].publishedAt)) / 86400000
    : Infinity;
  if (days > rules.maxActiveDays)
    reasons.push('Sem publicação verificada dentro da janela de atividade.');
  if (!channel.email) reasons.push('Sem contato comercial público verificado.');
  const recentCount = videos.filter(
    (v) => now.getTime() - Date.parse(v.publishedAt) <= 30 * 86400000,
  ).length;
  const inRange =
    channel.subscriberCount !== null &&
    channel.subscriberCount >= rules.subscriberMin &&
    channel.subscriberCount <= rules.subscriberMax;
  const views = videos
    .flatMap((v) => (v.viewCount === null ? [] : [v.viewCount]))
    .sort((a, b) => a - b);
  const medianViews = views[Math.floor(views.length / 2)] ?? null;
  const preferredCountry = ['US', 'GB', 'CA', 'AU', 'NZ', 'IE'].includes(
    channel.country?.toUpperCase() ?? '',
  );
  // Heurísticas de prioridade; não afirmam intenção de compra nem análise visual.
  const engagement = videos.flatMap((v) =>
    v.viewCount && v.likeCount !== null && v.commentCount !== null
      ? [(v.likeCount + v.commentCount) / v.viewCount]
      : [],
  );
  const averageEngagement = engagement.length
    ? engagement.reduce((a, b) => a + b, 0) / engagement.length
    : null;
  const averageViews = views.length
    ? Math.round(views.reduce((a, b) => a + b, 0) / views.length)
    : null;
  const fractions = {
    niche: nicheConfirmed ? 1 : 0,
    activity:
      days <= rules.priorityActiveDays
        ? 0.7 + Math.min(recentCount / 4, 1) * 0.3
        : days <= rules.maxActiveDays
          ? 0.4
          : 0,
    commercial:
      (inRange ? 0.55 : channel.subscriberCount === null ? 0 : 0.25) +
      Math.min((medianViews ?? 0) / 5000, 1) * 0.25 +
      Math.min((averageEngagement ?? 0) / 0.02, 1) * 0.1 +
      (preferredCountry ? 0.1 : 0),
    editing: review.editingRating,
    contact: channel.email ? 1 : 0,
  };
  const breakdown = Object.fromEntries(
    Object.entries(fractions).map(([key, value]) => [
      key,
      Math.round(value * rules.weights[key as keyof typeof fractions] * 10) / 10,
    ]),
  ) as Assessment['breakdown'];
  const score = Math.round(Object.values(breakdown).reduce((a, b) => a + b, 0));
  if (score < rules.minimumScore) reasons.push(`Pontuação abaixo de ${rules.minimumScore}.`);
  evidence.push(`País declarado: ${channel.country ?? 'não informado'}; não inferido pelo idioma.`);
  evidence.push(
    `Amostra: ${videos.length} vídeos, ${english} com inglês declarado, ${nicheMatches} com título do nicho.`,
  );
  evidence.push(
    `Publicações em 30 dias: ${recentCount}; inscritos: ${channel.subscriberCount ?? 'ocultos'}; mediana de views: ${medianViews ?? 'não informada'}.`,
  );
  if (recent[0])
    evidence.push(
      `Última publicação: https://www.youtube.com/watch?v=${recent[0].id} (${recent[0].publishedAt}).`,
    );
  evidence.push(
    `Média aproximada de views recentes: ${averageViews ?? 'não informada'}; engajamento (likes + comentários / views): ${averageEngagement === null ? 'indisponível' : `${(averageEngagement * 100).toFixed(2)}%`}.`,
  );
  evidence.push(
    ...recent.map(
      (v) =>
        `Vídeo: ${v.title} · ${v.publishedAt} · https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`,
    ),
  );
  evidence.push(
    review.editingRating
      ? `Edição: ${review.editingEvidence} (${review.evidenceUrl})`
      : 'Edição não avaliada: 0 pontos. Não inferimos melhorias pela metadata.',
  );
  if (review.languageEvidence)
    evidence.push(`Revisão: ${review.languageEvidence} (${review.evidenceUrl})`);
  if (channel.contactUrl)
    evidence.push(
      `Contato: ${channel.contactUrl}; ${channel.contactNote ?? channel.contactSource}. Tipo: ${channel.contactSource}; confiança: ${channel.contactConfidence}; verificado em: ${channel.contactVerifiedAt ?? 'pendente'}.`,
    );
  return { score, breakdown, eligible: reasons.length === 0, reasons, evidence };
}
