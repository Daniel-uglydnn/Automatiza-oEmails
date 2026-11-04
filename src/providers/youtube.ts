import { z } from 'zod';
import { AppError } from '../domain/errors.js';
import {
  contactEmailSchema,
  type CampaignInput,
  type Channel,
  type DiscoveryProvider,
  type Rules,
  type Video,
} from '../domain/models.js';
import { requestJson, type Fetch } from './http.js';

const searchSchema = z.object({
  items: z.array(
    z.object({
      id: z.object({ videoId: z.string().optional() }).optional(),
      snippet: z.object({ channelId: z.string(), title: z.string().optional() }),
    }),
  ),
  nextPageToken: z.string().optional(),
});
export const searchTerms = {
  minecraft: ['survival', 'hardcore', 'SMP', 'funny moments', 'challenges', 'modded survival'],
  roblox: [
    'gameplay',
    'funny moments',
    'challenges',
    'horror games',
    'Brookhaven',
    'Blox Fruits',
    'Fisch',
    'Doors',
    'Dress to Impress',
  ],
};
const count = z.string().regex(/^\d+$/).transform(Number).refine(Number.isSafeInteger);
const channelsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z.object({
        title: z.string(),
        description: z.string(),
        country: z.string().optional(),
      }),
      statistics: z.object({
        subscriberCount: count.optional(),
        hiddenSubscriberCount: z.boolean().optional(),
        videoCount: count,
        viewCount: count,
      }),
      contentDetails: z.object({ relatedPlaylists: z.object({ uploads: z.string() }) }),
    }),
  ),
});
const playlistSchema = z.object({
  items: z.array(z.object({ contentDetails: z.object({ videoId: z.string() }) })),
});
const videosSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z.object({
        channelId: z.string(),
        title: z.string(),
        description: z.string(),
        publishedAt: z.iso.datetime(),
        defaultAudioLanguage: z.string().optional(),
      }),
      statistics: z
        .object({
          viewCount: count.optional(),
          likeCount: count.optional(),
          commentCount: count.optional(),
        })
        .optional(),
    }),
  ),
});
export function publicEmail(description: string): string | null {
  const matches = description.matchAll(
    /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}/gi,
  );
  for (const match of matches) {
    const preceding = description.slice(0, match.index).split('\n');
    const line = `${preceding.at(-1) ?? ''}${description.slice(match.index).split('\n')[0] ?? ''}`;
    const header = preceding.at(-2)?.trim() ?? '';
    const context = `${line} ${header.endsWith(':') && !header.includes('@') ? header : ''}`;
    if (/\b(fan(?:s|mail)?|personal|support|privacy)\b/i.test(line)) continue;
    if (
      !/\b(business|inquir(?:y|ies)|commercial|sponsorships?|work with me|partnerships?|management|booking)\b/i.test(
        context,
      )
    )
      continue;
    const result = contactEmailSchema.safeParse(match[0]);
    if (result.success) return result.data;
  }
  return null;
}
async function parallelMap<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(items.length, 5) }, async () => {
      while (index < items.length) {
        const current = index++;
        result[current] = await fn(items[current]!);
      }
    }),
  );
  return result;
}
export class YouTubeDiscovery implements DiscoveryProvider {
  constructor(
    private readonly key: string,
    private readonly fetcher: Fetch = fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  async discover(input: CampaignInput, rules: Rules, excludedIds: Set<string>): Promise<Channel[]> {
    const deadline = AbortSignal.timeout(360000);
    const api = async (endpoint: string, params: Record<string, string>) => {
      const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
      url.search = new URLSearchParams(params).toString();
      return requestJson(
        this.fetcher,
        url,
        { headers: { 'X-Goog-Api-Key': this.key }, signal: deadline },
        'YouTube',
      );
    };
    const picked = new Map<string, 'minecraft' | 'roblox'>();
    const minecraftTarget = Math.round((input.maxResults * rules.minecraftPercent) / 100);
    for (const [niche, target] of [
      ['minecraft', minecraftTarget],
      ['roblox', input.maxResults - minecraftTarget],
    ] as const) {
      let pageToken: string | undefined;
      let found = 0;
      const budget = Math.max(1, Math.floor(rules.youtubeSearchBudget / 2));
      let termIndex = Math.floor(this.clock().getTime() / 86400000) % searchTerms[niche].length;
      const observed: string[] = [];
      let term = searchTerms[niche][termIndex]!;
      for (let page = 0; page < budget && found < target; page++) {
        const result = searchSchema.safeParse(
          await api('search', {
            part: 'snippet',
            type: 'video',
            q: `${niche} ${term} ${input.query}`.trim(),
            maxResults: '50',
            regionCode: 'US',
            relevanceLanguage: 'en',
            order: 'date',
            publishedAfter: new Date(
              this.clock().getTime() - rules.maxActiveDays * 86400000,
            ).toISOString(),
            ...(pageToken ? { pageToken } : {}),
          }),
        );
        if (!result.success) throw new AppError(502, 'Resposta inesperada da busca do YouTube.');
        for (const item of result.data.items) {
          // Expansão somente quando o termo aparece em título realmente retornado.
          for (const candidate of searchTerms[niche])
            if (
              item.snippet.title?.toLowerCase().includes(candidate.toLowerCase()) &&
              !observed.includes(candidate)
            )
              observed.push(candidate);
          const id = item.snippet.channelId;
          if (found < target && !picked.has(id) && !excludedIds.has(id)) {
            picked.set(id, niche);
            found++;
          }
        }
        const next = result.data.nextPageToken;
        if (next && next !== pageToken) pageToken = next;
        else {
          pageToken = undefined;
          termIndex++;
          term = observed.shift() ?? searchTerms[niche][termIndex % searchTerms[niche].length]!;
        }
      }
    }
    const ids = [...picked.keys()];
    const channels: z.infer<typeof channelsSchema>['items'] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const result = channelsSchema.safeParse(
        await api('channels', {
          part: 'snippet,statistics,contentDetails',
          id: ids.slice(i, i + 50).join(','),
        }),
      );
      if (!result.success) throw new AppError(502, 'Resposta inesperada dos detalhes do YouTube.');
      channels.push(...result.data.items.filter((c) => picked.has(c.id)));
    }
    const uploads = await parallelMap(channels, async (channel) => {
      const result = playlistSchema.safeParse(
        await api('playlistItems', {
          part: 'contentDetails',
          playlistId: channel.contentDetails.relatedPlaylists.uploads,
          maxResults: '10',
        }),
      );
      if (!result.success)
        throw new AppError(502, 'Resposta inesperada da lista de publicações do YouTube.');
      return result.data.items.map((item) => item.contentDetails.videoId);
    });
    const videoIds = [...new Set(uploads.flat())];
    const videos = new Map<string, Video[]>();
    for (let i = 0; i < videoIds.length; i += 50) {
      const result = videosSchema.safeParse(
        await api('videos', {
          part: 'snippet,statistics',
          id: videoIds.slice(i, i + 50).join(','),
        }),
      );
      if (!result.success) throw new AppError(502, 'Resposta inesperada dos vídeos do YouTube.');
      for (const item of result.data.items) {
        const list = videos.get(item.snippet.channelId) ?? [];
        list.push({
          id: item.id,
          title: item.snippet.title,
          description: item.snippet.description,
          publishedAt: item.snippet.publishedAt,
          language: item.snippet.defaultAudioLanguage ?? null,
          viewCount: item.statistics?.viewCount ?? null,
          likeCount: item.statistics?.likeCount ?? null,
          commentCount: item.statistics?.commentCount ?? null,
        });
        videos.set(item.snippet.channelId, list);
      }
    }
    return [
      ...new Map(
        channels.map((item) => {
          const email = publicEmail(item.snippet.description);
          const channel: Channel = {
            id: item.id,
            title: item.snippet.title,
            description: item.snippet.description,
            subscriberCount: item.statistics.hiddenSubscriberCount
              ? null
              : (item.statistics.subscriberCount ?? null),
            videoCount: item.statistics.videoCount,
            viewCount: item.statistics.viewCount,
            country: item.snippet.country ?? null,
            discoveredFor: picked.get(item.id)!,
            videos: videos.get(item.id) ?? [],
            email,
            contactSource: email ? 'public_description' : null,
            contactUrl: email ? `https://www.youtube.com/channel/${item.id}/about` : null,
            contactNote: email
              ? 'Business contact publicado na descrição via YouTube Data API.'
              : null,
            contactVerifiedAt: email ? this.clock().toISOString() : null,
            contactConfidence: email ? 'high' : 'unverified',
            officialSites: [
              ...new Set(
                (item.snippet.description.match(/https:\/\/[^\s<>"']+/g) ?? [])
                  .map((value) => value.replace(/[),.;]+$/, ''))
                  .filter((value) => {
                    try {
                      const u = new URL(value);
                      return (
                        !u.username &&
                        !u.password &&
                        !/(^|\.)(youtube\.com|youtu\.be)$/i.test(u.hostname)
                      );
                    } catch {
                      return false;
                    }
                  }),
              ),
            ].slice(0, 10),
          };
          return [channel.id, channel] as const;
        }),
      ).values(),
    ];
  }
}
