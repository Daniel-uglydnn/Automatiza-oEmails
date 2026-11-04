import { z } from 'zod';

export const portfolios = ['https://uglydnn.carrd.co/', 'https://ytjobs.co/talent/profile/565434?r=94'] as const;
export const rulesSchema = z.object({
  discoveryDailyLimit: z.number().int().min(1).max(100).default(100),
  minecraftPercent: z.number().int().min(0).max(100).default(50),
  subscriberMin: z.number().int().min(0).default(2000),
  subscriberMax: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(500000),
  priorityActiveDays: z.number().int().min(1).max(60).default(30),
  maxActiveDays: z.number().int().min(1).max(60).default(60),
  minimumScore: z.number().int().min(0).max(100).default(70),
  dailyContactLimit: z.number().int().min(1).max(100).default(10),
  weights: z.object({ niche: z.number().int().min(0).max(100), activity: z.number().int().min(0).max(100), commercial: z.number().int().min(0).max(100), editing: z.number().int().min(0).max(100), contact: z.number().int().min(0).max(100) }).default({ niche: 20, activity: 20, commercial: 20, editing: 25, contact: 15 }),
  followUpsEnabled: z.literal(false).default(false),
  timezone: z.literal('America/Fortaleza').default('America/Fortaleza'),
}).strict().refine(r => r.subscriberMin <= r.subscriberMax, 'Faixa de inscritos inválida.')
  .refine(r => r.priorityActiveDays <= r.maxActiveDays, 'Janela de prioridade inválida.')
  .refine(r => Object.values(r.weights).reduce((a, b) => a + b, 0) === 100, 'Os pesos devem somar 100.');
export type Rules = z.infer<typeof rulesSchema>;
export const defaultRules = rulesSchema.parse({});
export const campaignInputSchema = z.object({
  query: z.string().trim().max(120).default(''), maxResults: z.number().int().min(1).max(100).default(20),
}).strict();
export type CampaignInput = z.infer<typeof campaignInputSchema>;
export const contactEmailSchema = z.string().trim().max(254).pipe(z.email()).transform(v => v.toLowerCase());
export const sourceUrlSchema = z.url().max(2000).refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'Use uma fonte pública HTTPS sem credenciais.');
export const videoSchema = z.object({
  id: z.string(), title: z.string(), description: z.string(), publishedAt: z.iso.datetime(),
  language: z.string().nullable(), viewCount: z.number().int().nonnegative().nullable(),
});
export type Video = z.infer<typeof videoSchema>;
export const channelSchema = z.object({
  id: z.string().min(1).max(100), title: z.string().min(1).max(300), description: z.string().max(10000),
  subscriberCount: z.number().int().nonnegative().nullable(), videoCount: z.number().int().nonnegative(),
  viewCount: z.number().int().nonnegative(), country: z.string().nullable(),
  discoveredFor: z.enum(['minecraft', 'roblox']), videos: z.array(videoSchema),
  email: contactEmailSchema.nullable(), contactSource: z.enum(['demo', 'public_description', 'manual']).nullable(),
  contactUrl: sourceUrlSchema.nullable(), contactNote: z.string().nullable(),
});
export type Channel = z.infer<typeof channelSchema>;
export const reviewSchema = z.object({
  language: z.enum(['en', 'pt', 'other', 'unknown']).default('unknown'),
  niche: z.enum(['minecraft', 'roblox', 'other', 'unknown']).default('unknown'),
  languageEvidence: z.string().trim().max(2000).default(''),
  editingRating: z.number().min(0).max(1).default(0), editingEvidence: z.string().trim().max(2000).default(''),
  evidenceUrl: sourceUrlSchema.nullable().default(null), messageApproved: z.boolean().default(false),
}).strict().refine(r => (r.language === 'unknown' && r.niche === 'unknown') || (r.languageEvidence.length >= 10 && !!r.evidenceUrl), 'Confirme idioma/nicho com fonte e observação verificável.')
  .refine(r => r.editingRating === 0 || (r.editingEvidence.length >= 10 && !!r.evidenceUrl), 'Pontuação de edição exige uma observação verificável e sua fonte.');
export type Review = z.infer<typeof reviewSchema>;
export const messageSchema = z.object({
  subject: z.string().trim().min(1).max(160).refine(v => !/[\r\n]/.test(v), 'Assunto deve ter uma linha.'),
  body: z.string().trim().min(10).max(8000),
}).strict();
export type Message = z.infer<typeof messageSchema>;
export const draftSchema = messageSchema.extend({ source: z.enum(['template', 'openai']) });
export type Draft = z.infer<typeof draftSchema>;
export const assessmentSchema = z.object({
  score: z.number().min(0).max(100),
  breakdown: z.object({ niche: z.number(), activity: z.number(), commercial: z.number(), editing: z.number(), contact: z.number() }),
  eligible: z.boolean(), reasons: z.array(z.string()), evidence: z.array(z.string()),
});
export type Assessment = z.infer<typeof assessmentSchema>;
export const leadSchema = z.object({
  channel: channelSchema, review: reviewSchema, assessment: assessmentSchema, draft: draftSchema.nullable(),
  simulation: z.object({ id: z.uuid(), at: z.iso.datetime(), recipient: contactEmailSchema, subject: z.string(), body: z.string() }).nullable(),
  response: z.object({ kind: z.enum(['positive', 'negative', 'unsubscribe']), at: z.iso.datetime(), note: z.string().max(1000) }).nullable(),
});
export type Lead = z.infer<typeof leadSchema>;
export const campaignSchema = z.object({
  id: z.uuid(), createdAt: z.iso.datetime(), mode: z.enum(['demo', 'live']),
  input: campaignInputSchema, rules: rulesSchema, warnings: z.array(z.string()), leads: z.array(leadSchema),
});
export type Campaign = z.infer<typeof campaignSchema>;
export const suppressionSchema = z.object({ email: contactEmailSchema, createdAt: z.iso.datetime(), reason: z.enum(['manual', 'negative', 'unsubscribe']) });
export type Suppression = z.infer<typeof suppressionSchema>;
export const eventSchema = z.object({ id: z.uuid(), at: z.iso.datetime(), message: z.string().max(500) });
export type ErrorEvent = z.infer<typeof eventSchema>;
export interface DiscoveryProvider { discover(input: CampaignInput, rules: Rules, excludedIds: Set<string>): Promise<Channel[]> }
export interface MessageWriter { write(channel: Channel): Promise<Draft> }
export interface Repository {
  list(): Promise<Campaign[]>;
  get(id: string): Promise<Campaign | null>;
  save(campaign: Campaign): Promise<void>;
  getRules(): Promise<Rules>;
  saveRules(rules: Rules): Promise<void>;
  suppressions(): Promise<Suppression[]>;
  suppress(email: string, reason: Suppression['reason']): Promise<void>;
  events(): Promise<ErrorEvent[]>;
  addEvent(event: ErrorEvent): Promise<void>;
  withLock<T>(operation: () => Promise<T>): Promise<T>;
}
