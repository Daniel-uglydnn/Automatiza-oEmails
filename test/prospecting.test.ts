import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultRules, type Campaign } from '../src/domain/models.js';
import { demoChannels } from '../src/providers/demo.js';
import { LocalRepository } from '../src/repositories/local.js';
import { fixture, now } from './helpers.js';

test('fluxo completo persiste descoberta, propostas e simulações sem rede', async (t) => {
  const { service, directory } = await fixture(t);
  const campaign = await service.create({ maxResults: 8 });
  assert.equal(campaign.leads.length, 8);
  assert.equal(campaign.leads.filter((l) => l.channel.discoveredFor === 'minecraft').length, 4);
  assert.equal(campaign.leads.filter((l) => l.draft).length, 4);
  const first = await service.simulate(campaign.id);
  assert.equal(first.simulated, 4);
  assert.equal((await service.simulate(campaign.id)).simulated, 0);
  const reload = new LocalRepository(directory);
  assert.equal((await reload.get(campaign.id))?.leads.filter((l) => l.simulation).length, 4);
  assert.equal((await service.dashboard()).stats.sent, 0);
});
test('não adiciona canais conhecidos nem inventa canais para completar a meta', async (t) => {
  const { service } = await fixture(t);
  await service.create({ maxResults: 100 });
  const next = await service.create({ maxResults: 100 });
  assert.equal(next.leads.length, 0);
  assert.ok(next.warnings.some((w) => w.includes('Nenhum dado foi inventado')));
});
test('deduplica resultados do provider e limita descoberta diária', async (t) => {
  const sample = demoChannels(now)[0]!;
  const { service, repository } = await fixture(t, {
    discover: async () => [sample, sample, { ...sample, id: 'second' }, { ...sample, id: 'third' }],
  });
  await repository.saveRules({ ...defaultRules, discoveryDailyLimit: 2 });
  const c = await service.create({ maxResults: 100 });
  assert.equal(c.leads.length, 2);
  await assert.rejects(() => service.create({ maxResults: 10 }), /Limite diário/);
});
test('limite de contatos é global por dia, não por campanha', async (t) => {
  const { service, repository } = await fixture(t);
  await repository.saveRules({ ...defaultRules, dailyContactLimit: 2 });
  const c = await service.create({ maxResults: 8 });
  assert.equal((await service.simulate(c.id)).simulated, 2);
  assert.equal((await service.simulate(c.id)).simulated, 0);
});
test('não simula o mesmo email em canais diferentes', async (t) => {
  const channels = demoChannels(now).slice(0, 2);
  channels[1]!.email = channels[0]!.email;
  const { service } = await fixture(t, { discover: async () => channels });
  const c = await service.create({ maxResults: 2 });
  assert.equal((await service.simulate(c.id)).simulated, 1);
});
test('histórico de outro dia continua impedindo novo primeiro contato', async (t) => {
  const { service, repository } = await fixture(t);
  const c = await service.create({ maxResults: 8 });
  await service.simulate(c.id);
  const old = await service.get(c.id);
  for (const lead of old.leads) if (lead.simulation) lead.simulation.at = '2026-11-01T15:00:00Z';
  await repository.save(old);
  const clone: Campaign = { ...structuredClone(old), id: randomUUID() };
  clone.leads.forEach((l) => (l.simulation = null));
  await repository.save(clone);
  assert.equal((await service.simulate(clone.id)).simulated, 0);
});
test('recusa e descadastro bloqueiam globalmente; contato sem fonte é rejeitado', async (t) => {
  const { service, repository } = await fixture(t);
  const c = await service.create({ maxResults: 8 });
  const eligible = c.leads.filter((l) => l.assessment.eligible);
  await service.response(c.id, eligible[0]!.channel.id, { kind: 'negative' });
  await service.response(c.id, eligible[1]!.channel.id, { kind: 'unsubscribe' });
  assert.equal((await repository.suppressions()).length, 2);
  assert.equal((await service.simulate(c.id)).simulated, 2);
  await assert.rejects(() =>
    service.contact(c.id, eligible[0]!.channel.id, { email: 'public@example.com' }),
  );
});
test('mudança de regras exige revisão para aumentar limite, nunca habilita envio', async (t) => {
  const { service } = await fixture(t);
  await assert.rejects(
    () => service.updateRules({ ...defaultRules, dailyContactLimit: 20 }, false),
    /conformidade/,
  );
  await service.updateRules({ ...defaultRules, dailyContactLimit: 20 }, true);
  assert.equal((await service.dashboard()).rules.dailyContactLimit, 20);
  assert.equal((await service.dashboard()).deliveryMode, 'dry-run');
});
test('concorrência não permite duas mutações simultâneas', async (t) => {
  const { repository } = await fixture(t);
  await repository.withLock(async () => {
    await assert.rejects(() => repository.withLock(async () => undefined), /Outra operação/);
  });
  await repository.withLock(async () => undefined);
});
test('não sobrescreve um armazenamento inválido', async (t) => {
  const { directory, service } = await fixture(t);
  await service.repository.getRules();
  // prepare() cria o diretório antes da tentativa de leitura.
  await service.repository.list();
  const path = join(directory, 'rules.json');
  await writeFile(path, '{broken');
  await assert.rejects(() => service.create({ maxResults: 1 }), /Falha ao ler dados locais/);
  assert.equal(await readFile(path, 'utf8'), '{broken');
});
test('IA indisponível preserva o rascunho e erros ficam visíveis sem stack', async (t) => {
  const { service, repository } = await fixture(t);
  const c = await service.create({ maxResults: 2 });
  const lead = c.leads[0]!;
  await assert.rejects(() => service.draft(c.id, lead.channel.id, { useAI: true }), /Configure/);
  assert.deepEqual((await service.get(c.id)).leads[0]!.draft, lead.draft);
  await service.recordError(new Error('sensitive data must not be stored'));
  assert.equal((await repository.events())[0]?.message.includes('sensitive'), false);
});
