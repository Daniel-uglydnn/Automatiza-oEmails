import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fixture, now } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { gmailScopes, operationsSchema } from '../src/domain/operations.js';
import { DeliveryService } from '../src/services/delivery.js';
import { ProviderError } from '../src/providers/http.js';
import type { MailTransport, Envelope } from '../src/providers/gmail.js';
import type { Message } from '../src/domain/models.js';
import { ReplyTracking } from '../src/services/tracking.js';
import { seal, unseal } from '../src/domain/credentials.js';
import { activationReasons, personalizationReasons } from '../src/services/compliance.js';

import { liveFixture } from './live-helpers.js';
import { notifyReport } from '../src/services/report-notification.js';
import { buildReport } from '../src/services/reports.js';
test('criptografia autenticada não expõe tokens e rejeita adulteração/chave errada', () => {
  const key = randomBytes(32).toString('base64');
  const blob = seal('a-refresh-token', key);
  assert.equal(unseal(blob, key), 'a-refresh-token');
  assert.doesNotMatch(blob, /refresh-token/);
  assert.notEqual(blob, seal('a-refresh-token', key));
  assert.throws(() => unseal(blob.slice(0, -3) + 'abc', key));
  assert.throws(() => unseal(blob, randomBytes(32).toString('base64')));
});
test('cada bloqueio independente impede envio sem chamar o transporte', async (t) => {
  const f = await liveFixture(t);
  assert.ok(
    activationReasons({ ...f.config, ENABLE_LIVE_SENDS: 'false' }, f.settings, f.account).length,
  );
  assert.ok(activationReasons(f.config, { ...f.settings, authorizedAt: null }, f.account).length);
  assert.ok(
    activationReasons(f.config, { ...f.settings, unsubscribeVerifiedAt: null }, f.account).length,
  );
  assert.ok(activationReasons(f.config, { ...f.settings, business: null }, f.account).length);
  assert.ok(activationReasons(f.config, { ...f.settings, jurisdictions: [] }, f.account).length);
  assert.ok(activationReasons(f.config, f.settings, null).length);
  const blocked = new DeliveryService(loadConfig({}), f.repository, async () => {
    throw new Error('must never be called');
  });
  assert.equal((await blocked.dispatch(f.campaign.id)).sent, 0);
});
test('despacho autorizado usa reserva durável, identificação e descadastro, sem aprovação individual', async (t) => {
  const f = await liveFixture(t);
  f.transport.send = async (to, message, envelope) => {
    assert.equal(
      (await f.repository.deliveries()).some((d) => d.recipient === to && d.status === 'reserved'),
      true,
    );
    f.calls.push({ to, message, envelope });
    return { id: 'accepted-' + f.calls.length, threadId: 'thread-' + f.calls.length };
  };
  assert.equal((await f.dispatcher.dispatch(f.campaign.id)).sent, 2);
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0]!.message.body, /Commercial proposal.*TEST address/);
  assert.match(
    f.calls[0]!.envelope.unsubscribeUrl,
    /^https:\/\/outreach.example\/unsubscribe\?token=/,
  );
  assert.equal((await f.repository.deliveries())[0]?.status, 'sent');
  assert.equal((await f.dispatcher.dispatch(f.campaign.id)).sent, 0);
  assert.equal(f.calls.length, 2);
});
test('cota global, bloqueios e país sem base legal impedem chamadas de envio', async (t) => {
  const f = await liveFixture(t);
  await f.repository.saveRules({ ...(await f.repository.getRules()), dailyContactLimit: 1 });
  assert.equal((await f.dispatcher.dispatch(f.campaign.id)).sent, 1);
  assert.equal((await f.dispatcher.dispatch(f.campaign.id)).sent, 0);
  const g = await liveFixture(t);
  g.campaign.leads[0]!.channel.country = null;
  await g.repository.suppress(g.campaign.leads[1]!.channel.email!, 'unsubscribe');
  await g.repository.save(g.campaign);
  const result = await g.dispatcher.dispatch(g.campaign.id);
  assert.equal(result.sent, 0);
  assert.equal(g.calls.length, 0);
  assert.ok(
    Object.values(result.blocked)
      .flat()
      .some((r) => r.includes('base legal')),
  );
});
test('mesmo e-mail em dois canais não recebe dois primeiros contatos', async (t) => {
  const f = await liveFixture(t);
  f.campaign.leads[1]!.channel.email = f.campaign.leads[0]!.channel.email;
  await f.repository.save(f.campaign);
  assert.equal((await f.dispatcher.dispatch(f.campaign.id)).sent, 1);
});
test('sem personalização verificável, contato antigo ou demo nenhum envio é feito', async (t) => {
  const f = await liveFixture(t);
  f.campaign.leads[0]!.channel.contactVerifiedAt = '2026-01-01T00:00:00Z';
  f.campaign.leads[1]!.channel.contactSource = 'demo';
  await f.repository.save(f.campaign);
  assert.equal((await f.dispatcher.dispatch(f.campaign.id)).sent, 0);
  const lead = structuredClone(f.campaign.leads[0]!);
  lead.draft!.body = lead.draft!.body.replace(
    /Your channel lists[^\n]+/,
    'I am contacting you about editing your content.',
  );
  assert.ok(personalizationReasons(lead).length);
});
test('erro de autenticação para a fila e revoga a autorização', async (t) => {
  const f = await liveFixture(t);
  let attempted = 0;
  f.transport.send = async () => {
    attempted++;
    throw new ProviderError(401, 'Gmail HTTP 401');
  };
  assert.equal((await f.dispatcher.dispatch(f.campaign.id)).sent, 0);
  assert.equal(attempted, 1);
  assert.equal((await f.dispatcher.settings()).authorizedAt, null);
  assert.ok((await f.dispatcher.settings()).breaker);
  assert.equal((await f.repository.deliveries())[0]?.status, 'rejected');
});
test('timeout depois de aceitação não reenvia, mesmo ao retomar; reconciliação é somente leitura', async (t) => {
  const f = await liveFixture(t);
  let attempted = 0;
  f.transport.send = async () => {
    attempted++;
    throw new ProviderError(0, 'timeout');
  };
  await f.dispatcher.dispatch(f.campaign.id);
  assert.equal((await f.repository.deliveries())[0]?.status, 'unknown');
  await f.repository.putRecord('operations', 'default', f.settings);
  f.transport.send = async () => {
    throw new Error('must not resend reserved recipient');
  };
  // Suprime o segundo endereço para concentrar a retomada no resultado incerto.
  await f.repository.suppress(f.campaign.leads[1]!.channel.email!, 'manual');
  assert.equal((await f.dispatcher.dispatch(f.campaign.id)).sent, 0);
  f.transport.findSent = async () => [{ id: 'recovered-message', threadId: 'recovered-thread' }];
  assert.equal(await f.dispatcher.reconcile(), 1);
  assert.equal(attempted, 1);
  assert.equal((await f.repository.deliveries())[0]?.gmailMessageId, 'recovered-message');
});
test('falha de persistência após o Gmail aceitar mantém tentativa retida', async (t) => {
  const f = await liveFixture(t);
  const save = f.repository.saveDelivery.bind(f.repository);
  let failed = false;
  f.repository.saveDelivery = async (d) => {
    if (d.status === 'sent' && !failed) {
      failed = true;
      throw new Error('simulated disk failure');
    }
    return save(d);
  };
  await f.dispatcher.dispatch(f.campaign.id);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.repository.deliveries())[0]?.status, 'unknown');
});
test('resposta no mesmo thread é idempotente e remoção bloqueia globalmente', async (t) => {
  const f = await liveFixture(t);
  await f.dispatcher.dispatch(f.campaign.id);
  f.transport.thread = async (id) => [
    {
      id: 'reply-' + id,
      threadId: id,
      from: `Creator <${id === 'thread-1' ? f.calls[0]!.to : f.calls[1]!.to}>`,
      at: new Date(now.getTime() + 60000).toISOString(),
      text: 'Please unsubscribe me',
      references: 'known-thread',
    },
  ];
  const tracking = new ReplyTracking(f.repository, async () => f.transport);
  assert.equal(await tracking.sync(), 2);
  assert.equal(await tracking.sync(), 0);
  assert.equal((await f.repository.suppressions()).length, 2);
  assert.equal((await f.repository.deliveries())[0]?.crmStage, 'unsubscribe');
});
test('descadastro é persistido mesmo durante um lock de campanha', async (t) => {
  const f = await fixture(t);
  await f.repository.withLock(async () => {
    await f.service.suppress('blocked@example.com', 'unsubscribe');
  });
  assert.equal((await f.repository.suppressions())[0]?.email, 'blocked@example.com');
});
test('falha de autenticação antes do primeiro envio também trava a operação', async (t) => {
  const f = await liveFixture(t);
  f.transport.profile = async () => {
    throw new ProviderError(401, 'token expired');
  };
  await assert.rejects(() => f.dispatcher.dispatch(f.campaign.id), /interrompidos/);
  assert.equal(f.calls.length, 0);
  assert.ok((await f.dispatcher.settings()).breaker);
});
test('resumo ao próprio remetente é idempotente, conta na cota e não sai em dry-run', async (t) => {
  const f = await liveFixture(t);
  await f.repository.saveRules({ ...(await f.repository.getRules()), dailyContactLimit: 3 });
  await f.repository.putRecord('operations', 'default', {
    ...f.settings,
    reportEmail: f.account.email,
  });
  const run = {
    id: 'manual:summary-test',
    day: '2026-11-04',
    startedAt: now.toISOString(),
    completedAt: now.toISOString(),
    status: 'completed' as const,
    campaignId: f.campaign.id,
    report: buildReport(f.campaign, [], {}, []),
  };
  await notifyReport(loadConfig({}), f.repository, f.dispatcher, async () => f.transport, run);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.dispatcher.dispatch(f.campaign.id)).sent, 2);
  await notifyReport(f.config, f.repository, f.dispatcher, async () => f.transport, run);
  await notifyReport(f.config, f.repository, f.dispatcher, async () => f.transport, run);
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[2]!.to, f.account.email);
  assert.equal((await f.repository.listRecords('report-mails')).length, 1);
});
test('prazo esgotado impede consultas e envios adicionais durante recuperação', async (t) => {
  const f = await liveFixture(t);
  await f.dispatcher.dispatch(f.campaign.id);
  const pending = (await f.repository.deliveries())[0]!;
  pending.status = 'unknown';
  await f.repository.saveDelivery(pending);
  const noMail = async () => {
    throw new Error('must not consult after deadline');
  };
  const dispatcher = new DeliveryService(f.config, f.repository, noMail);
  assert.equal((await dispatcher.dispatch(f.campaign.id, Date.now() - 1)).sent, 0);
  assert.equal(await dispatcher.reconcile(Date.now() - 1), 0);
  assert.equal(await new ReplyTracking(f.repository, noMail).sync(Date.now() - 1), 0);
});
