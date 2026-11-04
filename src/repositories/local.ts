import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import lockfile from 'proper-lockfile';
import { z } from 'zod';
import { AppError } from '../domain/errors.js';
import {
  campaignSchema,
  defaultRules,
  rulesSchema,
  suppressionSchema,
  type Campaign,
  type Repository,
  type Rules,
  type Suppression,
} from '../domain/models.js';
import { eventSchema, type ErrorEvent } from '../domain/models.js';
import { deliverySchema, type Delivery } from '../domain/operations.js';

export class LocalRepository implements Repository {
  readonly directory: string;
  constructor(directory: string) {
    this.directory = resolve(directory);
  }
  private async prepare(): Promise<void> {
    await mkdir(join(this.directory, 'campaigns'), { recursive: true, mode: 0o700 });
  }
  private async read(file: string): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(join(this.directory, file), 'utf8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new AppError(
        500,
        'Falha ao ler dados locais. Não sobrescreva os arquivos; verifique o armazenamento.',
      );
    }
  }
  private async write(file: string, value: unknown): Promise<void> {
    await this.prepare();
    const target = join(this.directory, file);
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
      await rename(tmp, target);
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  }
  async list(): Promise<Campaign[]> {
    await this.prepare();
    const files = (await readdir(join(this.directory, 'campaigns'))).filter((f) =>
      f.endsWith('.json'),
    );
    const campaigns = await Promise.all(
      files.map(async (file) => campaignSchema.parse(await this.read(`campaigns/${file}`))),
    );
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
  async getRules(): Promise<Rules> {
    return rulesSchema.parse((await this.read('rules.json')) ?? defaultRules);
  }
  async saveRules(rules: Rules): Promise<void> {
    await this.write('rules.json', rulesSchema.parse(rules));
  }
  async suppressions(): Promise<Suppression[]> {
    const legacy = z.array(suppressionSchema).parse((await this.read('suppressions.json')) ?? []);
    const current = z.array(suppressionSchema).parse(await this.listRecords('suppression-data'));
    return [...new Map([...legacy, ...current].map((entry) => [entry.email, entry])).values()];
  }
  async suppress(email: string, reason: Suppression['reason']): Promise<void> {
    const entry = suppressionSchema.parse({ email, reason, createdAt: new Date().toISOString() });
    await this.putRecord(
      'suppression-data',
      createHash('sha256').update(entry.email).digest('hex'),
      entry,
    );
  }
  async events(): Promise<ErrorEvent[]> {
    return z.array(eventSchema).parse((await this.read('events.json')) ?? []);
  }
  async addEvent(event: ErrorEvent): Promise<void> {
    await this.write(
      'events.json',
      [eventSchema.parse(event), ...(await this.events())].slice(0, 100),
    );
  }
  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.prepare();
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(join(this.directory, 'writer'), {
        realpath: false,
        stale: 900000,
        update: 60000,
        retries: 0,
      });
    } catch {
      throw new AppError(409, 'Outra operação está em andamento. Aguarde e tente novamente.');
    }
    try {
      return await operation();
    } finally {
      await release();
    }
  }
  private recordPath(namespace: string, id: string): string {
    z.string()
      .regex(/^[a-z][a-z0-9_-]{0,30}$/)
      .parse(namespace);
    z.string()
      .regex(/^[a-zA-Z0-9:_-]{1,100}$/)
      .parse(id);
    return `records/${namespace}/${id}.json`;
  }
  async getRecord(namespace: string, id: string): Promise<unknown | null> {
    return this.read(this.recordPath(namespace, id));
  }
  async putRecord(namespace: string, id: string, document: unknown): Promise<void> {
    const path = this.recordPath(namespace, id);
    await mkdir(join(this.directory, 'records', namespace), { recursive: true, mode: 0o700 });
    await this.write(path, document);
  }
  async listRecords(namespace: string): Promise<unknown[]> {
    this.recordPath(namespace, 'validation');
    const directory = join(this.directory, 'records', namespace);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return Promise.all(
      (await readdir(directory))
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((file) => this.read(`records/${namespace}/${file}`)),
    );
  }
  async deliveries(): Promise<Delivery[]> {
    return z.array(deliverySchema).parse(await this.listRecords('deliveries'));
  }
  async reserveDelivery(input: Delivery): Promise<boolean> {
    const delivery = deliverySchema.parse(input);
    if (
      (await this.deliveries()).some(
        (d) => d.channelId === delivery.channelId || d.emailKey === delivery.emailKey,
      )
    )
      return false;
    await this.putRecord('deliveries', delivery.id, delivery);
    return true;
  }
  async saveDelivery(delivery: Delivery): Promise<void> {
    await this.putRecord('deliveries', delivery.id, deliverySchema.parse(delivery));
  }
  async withAutomationLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.prepare();
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(join(this.directory, 'automation'), {
        realpath: false,
        stale: 1800000,
        update: 60000,
        retries: 0,
      });
    } catch {
      throw new AppError(409, 'Uma execução diária já está em andamento.');
    }
    try {
      return await operation();
    } finally {
      await release();
    }
  }
}
