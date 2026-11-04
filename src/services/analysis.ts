import type { Channel } from '../domain/models.js';

export function metadataSuggestions(channel: Channel): string[] {
  const suggestions: string[] = [];
  for (const video of channel.videos.slice(0, 3)) {
    const source = `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;
    if (/hardcore|survival|challenge|smp/i.test(video.title))
      suggestions.push(
        `Hipótese baseada no título “${video.title}”: organizar progressão, objetivos e momentos decisivos. Fonte: ${source}`,
      );
    if (/funny|moments|troll/i.test(video.title))
      suggestions.push(
        `Hipótese baseada no título “${video.title}”: explorar seleção de momentos e timing cômico. Fonte: ${source}`,
      );
    if (/mods?|blox fruits|fisch|dress to impress/i.test(video.title))
      suggestions.push(
        `Hipótese baseada no título “${video.title}”: destacar visualmente objetivos, itens ou mudanças relevantes. Fonte: ${source}`,
      );
  }
  return [
    'Limitação: somente títulos, descrições e metadata foram analisados. Sugestões não afirmam defeitos nem recebem pontos de edição sem revisão do vídeo.',
    ...suggestions.slice(0, 4),
  ];
}
