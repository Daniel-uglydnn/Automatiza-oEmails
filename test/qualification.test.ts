import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, nicheOf } from '../src/domain/qualification.js';
import { defaultRules, reviewSchema, rulesSchema } from '../src/domain/models.js';
import { demoChannels } from '../src/providers/demo.js';
import { dayKey } from '../src/domain/time.js';
import { now } from './helpers.js';

const channel = () => demoChannels(now)[0]!;
test('pontuação verificável, sem inventar oportunidades de edição', () => {
  const a = assess(channel(), reviewSchema.parse({}), defaultRules, now);
  assert.deepEqual(a.breakdown, { niche: 20, activity: 20, commercial: 20, editing: 0, contact: 15 });
  assert.equal(a.score, 75); assert.equal(a.eligible, true);
  assert.ok(a.evidence.some(e => e.includes('Edição não avaliada')));
});
test('edição só recebe pontos com observação e fonte', () => {
  assert.equal(reviewSchema.safeParse({ editingRating: 1 }).success, false);
  const review = reviewSchema.parse({ editingRating: 0.8, editingEvidence: 'At 1:20 the pause could be shortened to improve pacing.', evidenceUrl: 'https://www.youtube.com/watch?v=test' });
  assert.equal(assess(channel(), review, defaultRules, now).breakdown.editing, 20);
});
test('idioma desconhecido não vira inglês por país ou título', () => {
  const c = channel(); c.videos.forEach(v => v.language = null);
  const a = assess(c, reviewSchema.parse({}), defaultRules, now);
  assert.equal(a.eligible, false); assert.ok(a.reasons.some(r => r.includes('Idioma')));
  const reviewed = reviewSchema.parse({ language: 'en', languageEvidence: 'Reviewed spoken English across the sampled videos.', evidenceUrl: 'https://www.youtube.com/watch?v=test' });
  assert.equal(assess(c, reviewed, defaultRules, now).eligible, true);
});
test('país desconhecido é aceito sem inferir país pelo inglês', () => {
  const c = channel(); c.country = null;
  const a = assess(c, reviewSchema.parse({}), defaultRules, now);
  assert.equal(a.eligible, true); assert.ok(a.evidence.some(e => e.includes('não informado')));
});
test('país BR e conteúdo português são excluídos', () => {
  const c = channel(); c.country = 'BR';
  assert.equal(assess(c, reviewSchema.parse({}), defaultRules, now).eligible, false);
  c.country = 'PT'; c.videos.forEach(v => v.language = 'pt-PT');
  assert.equal(assess(c, reviewSchema.parse({}), defaultRules, now).eligible, false);
});
test('canais pequenos continuam elegíveis com potencial suficiente', () => {
  const c = channel(); c.subscriberCount = 750;
  assert.equal(assess(c, reviewSchema.parse({}), defaultRules, now).eligible, false); // 69 sem revisão de edição
  const review = reviewSchema.parse({ editingRating: 0.2, editingEvidence: 'A pause at 03:45 could be tightened in this upload.', evidenceUrl: 'https://www.youtube.com/watch?v=test' });
  assert.equal(assess(c, review, defaultRules, now).eligible, true);
});
test('atividade de 31–60 dias é aceita, além de 60 é bloqueada', () => {
  const c = channel(); c.videos.forEach(v => v.publishedAt = new Date(now.getTime() - 45 * 86400000).toISOString());
  const review = reviewSchema.parse({ editingRating: 1, editingEvidence: 'Specific editing improvement observed in this video.', evidenceUrl: 'https://www.youtube.com/watch?v=test' });
  assert.equal(assess(c, review, defaultRules, now).eligible, true);
  c.videos.forEach(v => v.publishedAt = new Date(now.getTime() - 61 * 86400000).toISOString());
  assert.equal(assess(c, review, defaultRules, now).eligible, false);
});
test('nicho não é deduzido de termo ambíguo nem só da busca', () => {
  assert.equal(nicheOf('New Doors challenge'), null);
  const c = channel(); c.videos.forEach(v => v.title = 'Cooking dinner at home');
  assert.equal(assess(c, reviewSchema.parse({}), defaultRules, now).eligible, false);
});
test('regras rejeitam pesos inconsistentes, follow-ups e teto acima de 100', () => {
  assert.equal(rulesSchema.safeParse({ dailyContactLimit: 101 }).success, false);
  assert.equal(rulesSchema.safeParse({ followUpsEnabled: true }).success, false);
  assert.equal(rulesSchema.safeParse({ weights: { niche: 20, activity: 20, commercial: 20, editing: 25, contact: 20 } }).success, false);
});
test('limites diários usam a virada de dia de Fortaleza', () => {
  assert.equal(dayKey(new Date('2026-11-05T02:59:59Z')), '2026-11-04');
  assert.equal(dayKey(new Date('2026-11-05T03:00:00Z')), '2026-11-05');
});
