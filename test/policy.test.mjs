import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRoute, isConfirmation } from '../src/policy.mjs';
import { DEFAULTS, TIERS, validatePolicy } from '../src/config.mjs';
const models = Object.fromEntries(TIERS.map(t => [t, { model: DEFAULTS.codex[t], efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }]));
const a = (tier = 'fast', effort = 'low') => ({ ok: true, tier, effort, confidence: 0.99, effortConfidence: 0.99 });
const call = extra => chooseRoute({ answer: a(), policy: DEFAULTS, models, ...extra });
test('model capability and effort are independently selected', () => {
  const r = call({ answer: a('strong', 'low') }); assert.equal(r.model, models.strong.model); assert.equal(r.effort, 'low');
});
test('fresh small task can downgrade from Astra immediately', () => {
  assert.equal(call({ current: { tier: 'frontier', model: models.frontier.model, effort: 'high' } }).tier, 'fast');
});
test('large warm conversation holds twice then releases the downgrade', () => {
  const extra = { current: { tier: 'frontier', model: models.frontier.model, effort: 'high' }, warm: true, contextTokens: 50000 };
  let r = call(extra); assert.equal(r.reason, 'cache-hold');
  r = call({ ...extra, streak: r.streak }); assert.equal(r.tier, 'frontier');
  r = call({ ...extra, streak: r.streak }); assert.equal(r.reason, 'sustained-downgrade'); assert.equal(r.tier, 'fast');
});
test('expired cache permits downgrade in a long conversation', () => assert.equal(call({ current: { tier: 'frontier', model: models.frontier.model }, contextTokens: 100000, warm: false }).tier, 'fast'));
test('uncertain classification cannot downgrade', () => assert.equal(call({ current: { tier: 'strong', model: models.strong.model, effort: 'high' }, answer: { ...a(), confidence: 0.2 } }).tier, 'strong'));
test('Jev failure preserves current model and effort', () => {
  const r = call({ current: { tier: 'frontier', model: models.frontier.model, effort: 'high' }, answer: { ok: false } }); assert.equal(r.tier, 'frontier'); assert.equal(r.reason, 'jev-unavailable');
});
test('sensitive changes get at least strong within configured ceiling', () => {
  assert.equal(call({ answer: { ...a(), sensitive: true } }).tier, 'strong');
  assert.equal(call({ answer: { ...a(), sensitive: true }, policy: { ...DEFAULTS, maxTier: 'balanced' } }).tier, 'balanced');
});
test('provider failure increases capability on next classified request', () => assert.equal(call({ failed: true, current: { tier: 'balanced', model: models.balanced.model } }).tier, 'strong'));
test('effort is capped and unsupported levels are clamped downward', () => {
  assert.equal(call({ answer: a('balanced', 'max') }).effort, 'high');
  const limited = { ...models, balanced: { ...models.balanced, efforts: ['low', 'medium'] } };
  assert.equal(call({ answer: a('balanced', 'high'), models: limited }).effort, 'medium');
});
test('Haiku without effort capability does not get effort', () => assert.equal(call({ models: { ...models, fast: { model: 'claude-haiku-4-5', efforts: [] } } }).effort, null));
test('short Korean confirmations inherit previous task but real requests do not', () => {
  assert.ok(isConfirmation('응')); assert.ok(isConfirmation('계속')); assert.ok(!isConfirmation('응 인증 오류도 수정해줘'));
});
test('policy rejects remote destinations and invalid limits', () => {
  assert.throws(() => validatePolicy({ ...DEFAULTS, upstream: 'https://example.com' }));
  assert.throws(() => validatePolicy({ ...DEFAULTS, downgradeAfter: 0 }));
  assert.throws(() => validatePolicy({ ...DEFAULTS, minTier: 'frontier' }));
});
test('classifier fallback still respects a low effort ceiling and Haiku capability', () => {
  assert.equal(call({ answer: { ok: false }, policy: { ...DEFAULTS, maxEffort: 'low' } }).effort, 'low');
  assert.equal(call({ answer: { ok: false }, policy: { ...DEFAULTS, defaultTier: 'fast' }, models: { ...models, fast: { model: 'claude-haiku-5-5', efforts: [] } } }).effort, null);
});
test('catalog effort ordering cannot silently select a lower depth', () => {
  const unordered = { ...models, balanced: { ...models.balanced, efforts: ['high', 'low', 'medium'] } };
  assert.equal(call({ answer: a('balanced', 'high'), models: unordered }).effort, 'high');
});
