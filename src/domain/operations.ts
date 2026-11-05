import { z } from 'zod';
import { contactEmailSchema, sourceUrlSchema } from './models.js';

export const businessSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: contactEmailSchema,
    postalAddress: z.string().trim().min(15).max(500),
  })
  .strict();
export const jurisdictionSchema = z
  .object({
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .refine((c) => c !== 'BR'),
    legalBasis: z.string().trim().min(15).max(2000),
    reviewedAt: z.iso.datetime(),
    evidenceUrl: sourceUrlSchema,
  })
  .strict();
export const operationsSchema = z
  .object({
    paused: z.boolean().default(false),
    useAI: z.boolean().default(true),
    business: businessSchema.nullable().default(null),
    jurisdictions: z.array(jurisdictionSchema).max(100).default([]),
    authorizedAt: z.iso.datetime().nullable().default(null),
    unsubscribeVerifiedAt: z.iso.datetime().nullable().default(null),
    breaker: z.string().max(500).nullable().default(null),
    reportEmail: contactEmailSchema.nullable().default(null),
    retentionDays: z.number().int().min(30).max(730).default(90),
  })
  .strict();
export type Operations = z.infer<typeof operationsSchema>;
export const replySchema = z.object({
  detectedAt: z.iso.datetime().nullable().default(null),
  id: z.string(),
  at: z.iso.datetime(),
  kind: z.enum(['received', 'negative', 'unsubscribe']),
  note: z.string().max(1000),
});
export const deliverySchema = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  channelId: z.string(),
  emailKey: z.string().regex(/^[a-f0-9]{64}$/),
  recipient: contactEmailSchema.nullable(),
  createdAt: z.iso.datetime(),
  status: z.enum(['reserved', 'sent', 'unknown', 'rejected']),
  subject: z.string(),
  body: z.string(),
  rfcMessageId: z.string(),
  gmailMessageId: z.string().nullable(),
  gmailThreadId: z.string().nullable(),
  error: z.string().nullable(),
  replies: z.array(replySchema).default([]),
  crmUpdatedAt: z.iso.datetime().nullable().default(null),
  crmStage: z
    .enum(['new', 'replied', 'positive', 'negotiation', 'won', 'negative', 'unsubscribe'])
    .default('new'),
});
export type Delivery = z.infer<typeof deliverySchema>;
export const runSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9:_-]+$/),
  day: z.string(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  status: z.enum(['running', 'completed', 'failed', 'skipped']),
  campaignId: z.uuid().nullable(),
  report: z
    .object({
      discovered: z.number(),
      qualified: z.number(),
      minecraft: z.number(),
      roblox: z.number(),
      contacts: z.number(),
      prepared: z.number(),
      sent: z.number(),
      simulated: z.number(),
      blocked: z.number(),
      blockReasons: z.record(z.string(), z.number()),
      replies: z.number(),
      positiveReplies: z.number(),
      errors: z.array(z.string()),
      top: z.array(
        z.object({
          channelId: z.string(),
          title: z.string(),
          url: z.string(),
          score: z.number(),
          reason: z.string(),
        }),
      ),
    })
    .nullable(),
});
export type Run = z.infer<typeof runSchema>;
export const accountSchema = z.object({
  email: contactEmailSchema,
  verifiedAt: z.iso.datetime(),
  scopes: z.array(z.string()),
  sealedRefreshToken: z.string().nullable(),
});
export type Account = z.infer<typeof accountSchema>;
export const gmailScopes = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
] as const;
