import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, now } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { DeliveryService } from '../src/services/delivery.js';
import { ReplyTracking } from '../src/services/tracking.js';
import { PublicWebsiteContacts, publicAddress } from '../src/providers/public-contacts.js';
import { AutomationService } from '../src/services/automation.js';
import { campaignsCSV } from '../src/services/reports.js';
import { operationsSchema } from '../src/domain/operations.js';
import { demoChannels } from '../src/providers/demo.js';
import { retryRead } from '../src/providers/retry.js';
import { minimizeHistory } from '../src/services/retention.js';
import { liveFixture } from './live-helpers.js';
import { ProspectingService } from '../src/services/prospecting.js';

test('ciclo diário completo gera relatório real da simulação e é idempotente', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const { service, repository } = await fixture(t);
  const config = loadConfig({});
  const transport = async () => {
    throw new Error('Gmail must never be called in dry-run');
  };
  const delivery = new DeliveryService(config, repository, transport);
  const runner = new AutomationService(
    config,
    service,
    delivery,
    new ReplyTracking(repository, transport),
    new PublicWebsiteContacts([]),
    () => now,
  );
  const first = await runner.run(true, true),
    second = await runner.run(true, true);
  assert.equal(first.id, second.id);
  assert.equal(first.status, 'completed');
  assert.equal(first.report?.discovered, 8);
  assert.equal(first.report?.qualified, 4);
  assert.equal(first.report?.minecraft, 4);
  assert.equal(first.report?.roblox, 4);
  assert.equal(first.report?.sent, 0);
  assert.equal(first.report?.simulated, 4);
  assert.equal(first.report?.top.length, 8);
  assert.equal((await repository.list()).length, 1);
  assert.equal((await repository.listRecords('runs')).length, 1);
  const events = log.mock.calls.map((call) => JSON.parse(String(call.arguments[0])));
  assert.equal(events.length, 2);
  assert.equal(events[0].event, 'automation.completed');
  assert.equal(events[0].executionMode, 'dry-run');
  assert.equal(events[1].event, 'automation.already_completed');
  assert.equal(events[1].reused, true);
  assert.equal(events[1].executionMode, undefined);
  assert.deepEqual(events[1].blockReasons, first.report?.blockReasons);
});

for (const blockedBy of ['country', 'server'] as const) {
  test(`diagnóstico de zero envios identifica bloqueio de ${blockedBy} sem expor contatos ou credenciais`, async (t) => {
    const log = t.mock.method(console, 'log', () => {});
    const f = await liveFixture(t);
    const config =
      blockedBy === 'server' ? { ...f.config, ENABLE_LIVE_SENDS: 'false' as const } : f.config;
    if (blockedBy === 'country') {
      for (const lead of f.campaign.leads) lead.channel.country = 'CA';
      await f.repository.save(f.campaign);
    }
    const prospects = new ProspectingService(
      f.repository,
      {
        discover: async () =>
          f.campaign.leads.map((lead, index) => ({
            ...lead.channel,
            id: `UC_new_${index}`,
            email: `newcreator${index}@test.example`,
          })),
      },
      'live',
      null,
      () => now,
    );
    const runner = new AutomationService(
      config,
      prospects,
      new DeliveryService(
        config,
        f.repository,
        async () => f.transport,
        () => now,
      ),
      new ReplyTracking(f.repository, async () => f.transport),
      new PublicWebsiteContacts([]),
      () => now,
    );
    const run = await runner.run(true);
    assert.equal(run.status, 'completed');
    assert.equal(run.report?.discovered, 2);
    assert.equal(run.report?.qualified, 2);
    assert.equal(run.report?.sent, 0);
    assert.equal(run.report?.simulated, 0);
    assert.deepEqual(run.report?.errors, []);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(await f.repository.deliveries(), []);
    const expectedReason =
      blockedBy === 'country'
        ? 'País desconhecido ou sem base legal/requisitos revisados.'
        : 'Envio real desativado nas variáveis do servidor.';
    const summaryText = String(log.mock.calls.at(-1)!.arguments[0]);
    const summary = JSON.parse(summaryText);
    assert.equal(summary.executionMode, 'live');
    assert.equal(summary.liveSendsEnabled, blockedBy !== 'server');
    assert.equal(summary.qualified, 2);
    assert.equal(summary.sent, 0);
    assert.ok(summary.blockReasons[expectedReason] > 0);
    assert.equal(summary.errors, 0);
    assert.ok(run.report!.top.every((lead) => lead.reason.includes(expectedReason)));
    for (const privateValue of [
      config.API_AUTH_TOKEN!,
      config.CREDENTIAL_ENCRYPTION_KEY!,
      config.GMAIL_CLIENT_SECRET!,
      config.UNSUBSCRIBE_SIGNING_KEY!,
      f.settings.business!.email,
      f.settings.business!.postalAddress,
      ...f.campaign.leads.map((lead) => lead.channel.email!),
      'newcreator0@test.example',
      'newcreator1@test.example',
    ])
      assert.equal(summaryText.includes(privateValue), false);
  });
}
test('teste manual em simulação não chama Gmail mesmo com envio autorizado e preserva a agenda diária', async (t) => {
  const f = await liveFixture(t);
  await f.repository.putRecord('operations', 'default', {
    ...f.settings,
    reportEmail: f.settings.business!.email,
  });
  let gmailCalls = 0;
  const noMail = async () => {
    gmailCalls++;
    throw new Error('Simulação não deve acessar o Gmail, nem para resumo ou respostas.');
  };
  const runner = new AutomationService(
    f.config,
    f.service,
    new DeliveryService(f.config, f.repository, noMail, () => now),
    new ReplyTracking(f.repository, noMail),
    new PublicWebsiteContacts([]),
    () => now,
    noMail,
  );
  const run = await runner.run(false, true);
  assert.equal(run.status, 'completed');
  assert.match(run.id, /^manual:/);
  assert.equal(run.report?.sent, 0);
  assert.ok(run.report!.simulated > 0);
  assert.deepEqual(run.report?.errors, []);
  assert.equal(gmailCalls, 0);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.repository.deliveries(), []);
  assert.equal(await f.repository.getRecord('runs', 'daily:2026-11-04'), null);
  const settings = operationsSchema.parse(await f.repository.getRecord('operations', 'default'));
  assert.equal(settings.authorizedAt, f.settings.authorizedAt);
});
test('pausa persiste e impede descoberta, retomada produz dados sem reiniciar o projeto', async (t) => {
  const { service, repository } = await fixture(t);
  const config = loadConfig({});
  const noMail = async () => {
    throw new Error('not configured');
  };
  const delivery = new DeliveryService(config, repository, noMail);
  const runner = new AutomationService(
    config,
    service,
    delivery,
    new ReplyTracking(repository, noMail),
    new PublicWebsiteContacts([]),
    () => now,
  );
  await repository.putRecord('operations', 'default', operationsSchema.parse({ paused: true }));
  assert.equal((await runner.run(true)).status, 'skipped');
  assert.equal((await repository.list()).length, 0);
  await repository.putRecord('operations', 'default', operationsSchema.parse({ paused: false }));
  assert.equal((await runner.run(true)).report?.discovered, 8);
});
test('recuperação usa campanha persistida após interrupção e não duplica canais', async (t) => {
  const { service, repository } = await fixture(t);
  const campaign = await service.create({ maxResults: 8 });
  const id = 'daily:2026-11-04';
  await repository.putRecord('runs', id, {
    id,
    day: '2026-11-04',
    startedAt: now.toISOString(),
    completedAt: null,
    status: 'running',
    campaignId: campaign.id,
    report: null,
  });
  const config = loadConfig({}),
    noMail = async () => {
      throw new Error('no mail');
    };
  const delivery = new DeliveryService(config, repository, noMail);
  const runner = new AutomationService(
    config,
    service,
    delivery,
    new ReplyTracking(repository, noMail),
    new PublicWebsiteContacts([]),
    () => now,
  );
  const recovered = await runner.run(true, true);
  assert.equal(recovered.campaignId, campaign.id);
  assert.equal((await repository.list()).length, 1);
  assert.ok(recovered.report?.errors.some((e) => e.includes('Retomada')));
});
test('CSV contém fontes e protege contra fórmulas de planilha', async (t) => {
  const { service } = await fixture(t);
  const campaign = await service.create({ maxResults: 2 });
  campaign.leads[0]!.channel.title = '=HYPERLINK("https://evil.example")';
  const csv = campaignsCSV([campaign], []);
  assert.match(csv, /"'=HYPERLINK/);
  assert.match(csv, /verified_at/);
  assert.match(csv, /example.invalid/);
});
test('lock exclusivo de execução impede ciclos diários simultâneos', async (t) => {
  const { repository } = await fixture(t);
  await repository.withAutomationLock(() =>
    assert.rejects(() => repository.withAutomationLock(async () => undefined), /execução diária/),
  );
});
test('backoff é exponencial e limitado, sem repetir erro não temporário', async () => {
  let calls = 0;
  const delays: number[] = [];
  const value = await retryRead(
    async () => {
      if (++calls < 3) throw new Error('temporary');
      return 42;
    },
    () => true,
    async (ms) => {
      delays.push(ms);
    },
  );
  assert.equal(value, 42);
  assert.equal(calls, 3);
  assert.equal(delays.length, 2);
  assert.ok(delays[1]! > delays[0]!);
  calls = 0;
  await assert.rejects(() =>
    retryRead(
      async () => {
        calls++;
        throw new Error('auth');
      },
      () => false,
    ),
  );
  assert.equal(calls, 1);
});
test('retenção minimiza conteúdo antigo e preserva IDs para deduplicação', async (t) => {
  const { service, repository } = await fixture(t);
  const campaign = await service.create({ maxResults: 2 });
  campaign.createdAt = '2026-01-01T12:00:00Z';
  await repository.save(campaign);
  assert.equal(await minimizeHistory(repository, 90, now), 2);
  const minimized = await repository.get(campaign.id);
  assert.equal(minimized?.leads[0]?.draft, null);
  assert.equal(minimized?.leads[0]?.channel.email, null);
  assert.equal(minimized?.leads[0]?.channel.id, campaign.leads[0]?.channel.id);
  assert.equal(
    (await service.create({ maxResults: 2 })).leads.some(
      (l) => l.channel.id === campaign.leads[0]!.channel.id,
    ),
    false,
  );
});
test('contatos em site oficial respeitam robots e registram URL exata', async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (request, init) => {
    const url = String(request);
    calls.push(url);
    assert.equal(init?.redirect, 'manual');
    return new Response(
      url.endsWith('/robots.txt')
        ? 'User-agent: *\nAllow: /\nCrawl-delay: 0'
        : '<html><body><p>Business inquiries: work@example.com</p></body></html>',
      {
        status: 200,
        headers: { 'content-type': url.endsWith('/robots.txt') ? 'text/plain' : 'text/html' },
      },
    );
  };
  const channel = demoChannels(now)[4]!;
  channel.officialSites = ['https://studio.example/contact'];
  const result = await new PublicWebsiteContacts(['studio.example'], fetcher, async () => [
    '8.8.8.8',
  ]).find(channel);
  assert.equal(result.email, 'work@example.com');
  assert.equal(result.contactUrl, 'https://studio.example/contact');
  assert.equal(result.contactSource, 'official_website');
  assert.ok(result.contactVerifiedAt);
  assert.equal(calls.length, 2);
});
test('robôs proibidos, IP privado, redirecionamentos e host não aprovado são bloqueados', async () => {
  assert.equal(publicAddress('127.0.0.1'), false);
  assert.equal(publicAddress('10.0.0.1'), false);
  assert.equal(publicAddress('::1'), false);
  assert.equal(publicAddress('169.254.169.254'), false);
  const channel = demoChannels(now)[4]!;
  channel.officialSites = ['https://studio.example/contact'];
  let calls = 0;
  const denied: typeof fetch = async () => {
    calls++;
    return new Response('User-agent: *\nDisallow: /', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  };
  assert.equal(
    (
      await new PublicWebsiteContacts(['studio.example'], denied, async () => ['8.8.8.8']).find(
        channel,
      )
    ).email,
    null,
  );
  assert.equal(calls, 1);
  calls = 0;
  await new PublicWebsiteContacts(['studio.example'], denied, async () => ['127.0.0.1']).find(
    channel,
  );
  assert.equal(calls, 0);
  await new PublicWebsiteContacts([], denied, async () => ['8.8.8.8']).find(channel);
  assert.equal(calls, 0);
  const redirect: typeof fetch = async () =>
    new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest' } });
  assert.equal(
    (
      await new PublicWebsiteContacts(['studio.example'], redirect, async () => ['8.8.8.8']).find(
        channel,
      )
    ).email,
    null,
  );
});
test('fila real processa campanha pendente e relatório conta os envios do backlog', async (t) => {
  const f = await liveFixture(t);
  const runner = new AutomationService(
    f.config,
    f.service,
    f.dispatcher,
    new ReplyTracking(f.repository, async () => f.transport),
    new PublicWebsiteContacts([]),
    () => now,
  );
  const run = await runner.run(true, false);
  assert.equal(run.status, 'completed');
  assert.equal(run.report?.sent, 2);
  assert.equal(f.calls.length, 2);
  assert.equal(
    (await f.repository.deliveries()).every((d) => d.campaignId === f.campaign.id),
    true,
  );
});
