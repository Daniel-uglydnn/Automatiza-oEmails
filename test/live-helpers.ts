import type { TestContext } from 'node:test';
import { randomBytes } from 'node:crypto';
import { fixture, now } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { gmailScopes, operationsSchema } from '../src/domain/operations.js';
import { DeliveryService } from '../src/services/delivery.js';
import type { MailTransport, Envelope } from '../src/providers/gmail.js';
import type { Message } from '../src/domain/models.js';
import { seal } from '../src/domain/credentials.js';
export async function liveFixture(t: TestContext) {
  const f = await fixture(t);
  const campaign = await f.service.create({ maxResults: 2 });
  campaign.mode = 'live';
  for (const [i, lead] of campaign.leads.entries())
    Object.assign(lead.channel, {
      id: `UC_test_${i}`,
      email: `creator${i}@test.example`,
      contactSource: 'public_description',
      contactUrl: 'https://www.youtube.com/channel/UC_test/about',
      contactVerifiedAt: now.toISOString(),
      contactConfidence: 'high',
    });
  await f.repository.save(campaign);
  const config = loadConfig({
    APP_MODE: 'live',
    YOUTUBE_API_KEY: 'fake-test-only',
    STORAGE_DRIVER: 'supabase',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'fake-test-key',
    PUBLIC_ORIGIN: 'https://outreach.example',
    API_AUTH_TOKEN: 'a'.repeat(40),
    UNSUBSCRIBE_SIGNING_KEY: 's'.repeat(40),
    CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ENABLE_LIVE_SENDS: 'true',
    DELIVERY_MODE: 'live',
    GMAIL_CLIENT_ID: 'test-id',
    GMAIL_CLIENT_SECRET: 'test-secret',
  });
  const settings = operationsSchema.parse({
    business: {
      name: 'Daniel',
      email: 'daniel@test.example',
      postalAddress: 'TEST address 123, Test city, US',
    },
    jurisdictions: [
      {
        country: 'US',
        legalBasis: 'Test-only legal basis attestation for mocked recipients.',
        reviewedAt: now.toISOString(),
        evidenceUrl: 'https://www.ftc.gov/business-guidance',
      },
    ],
    authorizedAt: now.toISOString(),
    unsubscribeVerifiedAt: now.toISOString(),
  });
  await f.repository.putRecord('operations', 'default', settings);
  const account = {
    email: 'daniel@test.example',
    verifiedAt: now.toISOString(),
    scopes: [...gmailScopes],
    sealedRefreshToken: seal('test-refresh-token', config.CREDENTIAL_ENCRYPTION_KEY),
  };
  await f.repository.putRecord('credentials', 'gmail', account);
  const calls: Array<{ to: string; message: Message; envelope: Envelope }> = [];
  const transport: MailTransport = {
    profile: async () => ({ email: account.email, scopes: [...gmailScopes] }),
    send: async (to, message, envelope) => {
      calls.push({ to, message, envelope });
      return { id: `gmail-${calls.length}`, threadId: `thread-${calls.length}` };
    },
    thread: async () => [],
    findSent: async () => [],
  };
  const dispatcher = new DeliveryService(
    config,
    f.repository,
    async () => transport,
    () => now,
  );
  return { ...f, campaign, config, settings, account, calls, transport, dispatcher };
}
