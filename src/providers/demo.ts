import type { CampaignInput, Channel, DiscoveryProvider, Rules } from '../domain/models.js';

export function demoChannels(now = new Date()): Channel[] {
  return Array.from({ length: 8 }, (_, i) => {
    const niche = i % 2 === 0 ? 'minecraft' : 'roblox';
    const game = niche === 'minecraft' ? 'Minecraft' : 'Roblox';
    return {
      id: `demo-${i}`, title: `${game} Creator ${i + 1} · DEMO`,
      description: 'Fictional creator for development. Not a real channel or commercial contact.',
      subscriberCount: i === 6 ? 750 : 12000 + i * 7500, videoCount: 80 + i, viewCount: 900000,
      country: i === 7 ? 'BR' : i === 5 ? null : 'US', discoveredFor: niche,
      videos: Array.from({ length: 4 }, (_, v) => ({ id: `demo-video-${i}-${v}`, title: `${game} ${niche === 'minecraft' ? 'Hardcore Survival Challenge' : 'Blox Fruits Challenge'} ${v + 1}`,
        description: 'Fictional demo metadata.', publishedAt: new Date(now.getTime() - (2 + v * 7) * 86400000).toISOString(),
        language: i === 5 ? null : i === 7 ? 'pt' : 'en', viewCount: 10000 + v * 1000 })),
      email: i === 4 ? null : `creator${i + 1}@example.invalid`, contactSource: i === 4 ? null : 'demo',
      contactUrl: i === 4 ? null : 'https://example.invalid/demo', contactNote: 'Contato fictício, exclusivo para simulação.',
    };
  });
}
export class DemoDiscovery implements DiscoveryProvider {
  constructor(private readonly clock: () => Date = () => new Date()) {}
  async discover(input: CampaignInput, rules: Rules, excludedIds: Set<string>): Promise<Channel[]> {
    const available = demoChannels(this.clock()).filter(c => !excludedIds.has(c.id));
    const minecraft = Math.round(input.maxResults * rules.minecraftPercent / 100);
    return [...available.filter(c => c.discoveredFor === 'minecraft').slice(0, minecraft), ...available.filter(c => c.discoveredFor === 'roblox').slice(0, input.maxResults - minecraft)];
  }
}
