import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import lockfile from 'proper-lockfile';
import { z } from 'zod';
import { AppError } from '../domain/errors.js';
import { campaignSchema, defaultRules, rulesSchema, suppressionSchema, type Campaign, type Repository, type Rules, type Suppression } from '../domain/models.js';
import { eventSchema, type ErrorEvent } from '../domain/models.js';

export class LocalRepository implements Repository {
  readonly directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }
  private async prepare(): Promise<void> { await mkdir(join(this.directory, 'campaigns'), { recursive: true, mode: 0o700 }); }
  private async read(file: string): Promise<unknown | null> {
    try { return JSON.parse(await readFile(join(this.directory, file), 'utf8')) as unknown; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new AppError(500, 'Falha ao ler dados locais. Não sobrescreva os arquivos; verifique o armazenamento.'); }
  }
  private async write(file: string, value: unknown): Promise<void> {
    await this.prepare();
    const target = join(this.directory, file);
    const tmp = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' }); await rename(tmp, target); }
    finally { await unlink(tmp).catch(() => undefined); }
  }
  async list(): Promise<Campaign[]> {
    await this.prepare();
    const files = (await readdir(join(this.directory, 'campaigns'))).filter(f => f.endsWith('.json'));
    const campaigns = await Promise.all(files.map(async file => campaignSchema.parse(await this.read(`campaigns/${file}`))));
    return campaigns.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<Campaign | null> {
    z.uuid().parse(id);
    const data = await this.read(`campaigns/${id}.json`);
    return data ? campaignSchema.parse(data) : null;
  }
  async save(campaign: Campaign): Promise<void> {
    const valid = campaignSchema.parse(campaign);
    await this.write(`campaigns/${valid.id}.json`, valid);
  }
  async getRules(): Promise<Rules> { return rulesSchema.parse(await this.read('rules.json') ?? defaultRules); }
  async saveRules(rules: Rules): Promise<void> { await this.write('rules.json', rulesSchema.parse(rules)); }
  async suppressions(): Promise<Suppression[]> { return z.array(suppressionSchema).parse(await this.read('suppressions.json') ?? []); }
  async suppress(email: string, reason: Suppression['reason']): Promise<void> {
    const entry = suppressionSchema.parse({ email, reason, createdAt: new Date().toISOString() });
    const entries = await this.suppressions();
    await this.write('suppressions.json', [...entries.filter(e => e.email !== entry.email), entry]);
  }
  async events(): Promise<ErrorEvent[]> { return z.array(eventSchema).parse(await this.read('events.json') ?? []); }
  async addEvent(event: ErrorEvent): Promise<void> { await this.write('events.json', [eventSchema.parse(event), ...await this.events()].slice(0, 100)); }
  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.prepare();
    let release: () => Promise<void>;
    try { release = await lockfile.lock(join(this.directory, 'writer'), { realpath: false, stale: 900000, update: 60000, retries: 0 }); }
    catch { throw new AppError(409, 'Outra operação está em andamento. Aguarde e tente novamente.'); }
    try { return await operation(); } finally { await release(); }
  }
}
