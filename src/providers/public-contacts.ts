import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { load } from 'cheerio';
import { createRequire } from 'node:module';
import { setTimeout } from 'node:timers/promises';
import type { Channel } from '../domain/models.js';
import { publicEmail } from './youtube.js';
import type { Fetch } from './http.js';

const agent = 'DanielCreatorOutreach';
const robotsParser = createRequire(import.meta.url)('robots-parser') as (
  url: string,
  text: string,
) => {
  isAllowed(url: string, agent: string): boolean | undefined;
  getCrawlDelay(agent: string): number | undefined;
};
type Resolver = (host: string) => Promise<string[]>;
const resolvePublic: Resolver = async (host) =>
  (await lookup(host, { all: true })).map((item) => item.address);
export function publicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
export class PublicWebsiteContacts {
  constructor(
    private readonly hosts: string[],
    private readonly fetcher: Fetch = fetch,
    private readonly resolver: Resolver = resolvePublic,
  ) {}
  private async allowed(url: URL): Promise<boolean> {
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      !this.hosts.includes(url.hostname)
    )
      return false;
    const addresses = await this.resolver(url.hostname);
    return addresses.length > 0 && addresses.every(publicAddress);
  }
  private async text(url: URL, limit: number): Promise<{ status: number; text: string }> {
    if (!(await this.allowed(url))) return { status: 403, text: '' };
    const response = await this.fetcher(url, {
      redirect: 'manual',
      headers: { 'User-Agent': agent, Accept: 'text/html,text/plain' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { status: response.status, text: '' };
    }
    if (!/text\/(html|plain)/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel();
      return { status: 415, text: '' };
    }
    const reader = response.body?.getReader();
    if (!reader) return { status: response.status, text: '' };
    let length = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        return { status: 413, text: '' };
      }
      chunks.push(value);
    }
    return { status: response.status, text: Buffer.concat(chunks).toString('utf8') };
  }
  async find(channel: Channel): Promise<Channel> {
    if (channel.email) return channel;
    for (const source of channel.officialSites.slice(0, 3)) {
      try {
        const url = new URL(source);
        if (!(await this.allowed(url))) continue;
        const robotsURL = new URL('/robots.txt', url);
        const robots = await this.text(robotsURL, 65536);
        if (![200, 404].includes(robots.status)) continue;
        const policy = robotsParser(robotsURL.href, robots.text);
        const delay = policy.getCrawlDelay(agent) ?? 0.5;
        if (delay > 5) continue; // limite operacional conservador: não ignora uma demora maior
        const queue = [url];
        const seen = new Set<string>();
        while (queue.length && seen.size < 3) {
          const page = queue.shift()!;
          if (
            seen.has(page.href) ||
            policy.isAllowed(page.href, agent) === false ||
            /login|sign-?in|captcha/i.test(page.pathname)
          )
            continue;
          seen.add(page.href);
          await setTimeout(delay * 1000);
          const result = await this.text(page, 524288);
          if (result.status !== 200) continue;
          const $ = load(result.text);
          $('script,style,noscript,form').remove();
          let email: string | null = null;
          $('p,li,address,footer').each((_i, element) => {
            email ??= publicEmail($(element).text());
          });
          $('a[href^="mailto:"]').each((_i, element) => {
            if (email) return;
            const candidate = ($(element).attr('href') ?? '').slice(7).split('?')[0];
            const context = $(element).closest('p,li,section,footer,div').text();
            email = publicEmail(`${context} ${candidate ?? ''}`);
          });
          if (email)
            return {
              ...channel,
              email,
              contactSource: 'official_website',
              contactUrl: page.href,
              contactNote: `Contato comercial em site vinculado na descrição oficial do canal. Robots respeitado.`,
              contactVerifiedAt: new Date().toISOString(),
              contactConfidence: 'medium',
            };
          $('a[href]').each((_i, element) => {
            const href = $(element).attr('href') ?? '';
            if (!/contact|business|work.with|about/i.test(`${href} ${$(element).text()}`)) return;
            try {
              const link = new URL(href, page);
              link.hash = '';
              if (link.origin === url.origin && !seen.has(link.href) && queue.length < 3)
                queue.push(link);
            } catch {
              /* link inválido não é fonte */
            }
          });
        }
      } catch {
        /* Falha ou restrição: preservar contato pendente, sem contornar. */
      }
    }
    return channel;
  }
}
