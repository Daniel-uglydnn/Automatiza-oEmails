import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
import { supabaseFailureMessage } from './supabase-errors.js';

export class SupabaseRepository implements Repository {
  private readonly client: SupabaseClient;
  constructor(url: string, key: string, client?: SupabaseClient) {
    this.client =
      client ??
      createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) }),
        },
      });
  }
  private check(error: unknown, status?: number): void {
    if (error) throw new AppError(502, supabaseFailureMessage(error, status));
  }
  async list(): Promise<Campaign[]> {
    const campaigns: Campaign[] = [];
    // Paginação explícita: o limite padrão do PostgREST não pode perder o histórico de deduplicação.
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client
        .from('campaigns')
        .select('document')
        .order('created_at', { ascending: false })
        .order('id')
        .range(offset, offset + 499);
      this.check(error);
      for (const row of data ?? []) campaigns.push(campaignSchema.parse(row.document));
      if ((data?.length ?? 0) < 500) break;
    }
    return campaigns;
  }
  async get(id: string): Promise<Campaign | null> {
    z.uuid().parse(id);
    const { data, error } = await this.client
      .from('campaigns')
      .select('document')
      .eq('id', id)
      .maybeSingle();
    this.check(error);
    return data ? campaignSchema.parse(data.document) : null;
  }
  async save(campaign: Campaign): Promise<void> {
    const value = campaignSchema.parse(campaign);
    const { error } = await this.client
      .from('campaigns')
      .upsert({ id: value.id, created_at: value.createdAt, document: value });
    this.check(error);
  }
  async getRules(): Promise<Rules> {
    const { data, error, status } = await this.client
      .from('settings')
      .select('document')
      .eq('id', 'default')
      .maybeSingle();
    this.check(error, status);
    return rulesSchema.parse(data?.document ?? defaultRules);
  }
  async saveRules(rules: Rules): Promise<void> {
    const { error } = await this.client
      .from('settings')
      .upsert({ id: 'default', document: rulesSchema.parse(rules) });
    this.check(error);
  }
  async suppressions(): Promise<Suppression[]> {
    const entries: Suppression[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client
        .from('suppressions')
        .select('*')
        .order('email')
        .range(offset, offset + 499);
      this.check(error);
      for (const row of data ?? [])
        entries.push(
          suppressionSchema.parse({
            email: row.email,
            createdAt: row.created_at,
            reason: row.reason,
          }),
        );
      if ((data?.length ?? 0) < 500) break;
    }
    return entries;
  }
  async suppress(email: string, reason: Suppression['reason']): Promise<void> {
    const entry = suppressionSchema.parse({ email, reason, createdAt: new Date().toISOString() });
    const { error } = await this.client
      .from('suppressions')
      .upsert({ email: entry.email, reason, created_at: entry.createdAt });
    this.check(error);
  }
  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const owner = randomUUID();
    const { data, error } = await this.client.rpc('acquire_prospecting_lock', {
      lock_owner: owner,
    });
    this.check(error);
    if (data !== true)
      throw new AppError(409, 'Outra instância está processando a prospecção. Aguarde.');
    // Operações de descoberta têm prazo de 6 min; o lease dura 15 min.
    try {
      return await operation();
    } finally {
      const { error: releaseError } = await this.client.rpc('release_prospecting_lock', {
        lock_owner: owner,
      });
      this.check(releaseError);
    }
  }
  async events(): Promise<ErrorEvent[]> {
    const { data, error } = await this.client
      .from('error_events')
      .select('document')
      .order('created_at', { ascending: false })
      .limit(100);
    this.check(error);
    return (data ?? []).map((row) => eventSchema.parse(row.document));
  }
  async addEvent(event: ErrorEvent): Promise<void> {
    const value = eventSchema.parse(event);
    const { error } = await this.client
      .from('error_events')
      .insert({ id: value.id, created_at: value.at, document: value });
    this.check(error);
  }
  private validateRecord(namespace: string, id: string): void {
    z.string()
      .regex(/^[a-z][a-z0-9_-]{0,30}$/)
      .parse(namespace);
    z.string()
      .regex(/^[a-zA-Z0-9:_-]{1,100}$/)
      .parse(id);
  }
  async getRecord(namespace: string, id: string): Promise<unknown | null> {
    this.validateRecord(namespace, id);
    const { data, error } = await this.client
      .from('app_records')
      .select('document')
      .eq('namespace', namespace)
      .eq('id', id)
      .maybeSingle();
    this.check(error);
    return data?.document ?? null;
  }
  async putRecord(namespace: string, id: string, document: unknown): Promise<void> {
    this.validateRecord(namespace, id);
    const { error } = await this.client.from('app_records').upsert({ namespace, id, document });
    this.check(error);
  }
  async listRecords(namespace: string): Promise<unknown[]> {
    this.validateRecord(namespace, 'validation');
    const all: unknown[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client
        .from('app_records')
        .select('document')
        .eq('namespace', namespace)
        .order('id')
        .range(offset, offset + 499);
      this.check(error);
      all.push(...(data ?? []).map((row) => row.document));
      if ((data?.length ?? 0) < 500) break;
    }
    return all;
  }
  async deliveries(): Promise<Delivery[]> {
    const all: Delivery[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client
        .from('deliveries')
        .select('document')
        .order('id')
        .range(offset, offset + 499);
      this.check(error);
      all.push(...(data ?? []).map((row) => deliverySchema.parse(row.document)));
      if ((data?.length ?? 0) < 500) break;
    }
    return all;
  }
  async reserveDelivery(input: Delivery): Promise<boolean> {
    const d = deliverySchema.parse(input);
    const { error } = await this.client
      .from('deliveries')
      .insert({ id: d.id, channel_id: d.channelId, email_key: d.emailKey, document: d });
    if (error?.code === '23505') return false;
    this.check(error);
    return true;
  }
  async saveDelivery(input: Delivery): Promise<void> {
    const d = deliverySchema.parse(input);
    const { error } = await this.client.from('deliveries').update({ document: d }).eq('id', d.id);
    this.check(error);
  }
  async withAutomationLock<T>(operation: () => Promise<T>): Promise<T> {
    const owner = randomUUID();
    const { data, error } = await this.client.rpc('acquire_automation_lock', { lock_owner: owner });
    this.check(error);
    if (data !== true) throw new AppError(409, 'Uma execução diária já está em andamento.');
    try {
      return await operation();
    } finally {
      const { error } = await this.client.rpc('release_automation_lock', { lock_owner: owner });
      this.check(error);
    }
  }
}
