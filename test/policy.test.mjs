import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRoute, isConfirmation } from '../src/policy.mjs';
import { DEFAULTS, TIERS, validatePolicy, scopedPolicy, resolveModels, activeModelIds } from '../src/config.mjs';
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
test('safety and failure guards preserve reasoning above their high minimum', () => {
  for (const flags of [{ sensitive: true }, { failed: true }]) {
    for (const effort of ['low', 'xhigh', 'max']) {
      const r = call({ answer: { ...a('balanced', effort), sensitive: flags.sensitive }, failed: flags.failed,
        policy: { ...DEFAULTS, maxEffort: 'max' } });
      assert.equal(r.effort, effort === 'low' ? 'high' : effort);
      assert.equal(r.tier, 'strong');
    }
  }
});
test('guard reasoning floors still respect effort ceilings, model support and a single-model scope', () => {
  for (const flags of [{ sensitive: true }, { failed: true }]) {
    const extra = { answer: { ...a('fast', 'max'), sensitive: flags.sensitive }, failed: flags.failed };
    assert.equal(call({ ...extra, policy: { ...DEFAULTS, maxEffort: 'medium' } }).effort, 'medium');
    const limited = { ...models, strong: { ...models.strong, efforts: ['low', 'medium'] } };
    assert.equal(call({ ...extra, models: limited, policy: { ...DEFAULTS, maxEffort: 'max' } }).effort, 'medium');
    const single = call({ ...scoped(['luna'], { maxEffort: 'max' }), ...extra });
    assert.equal(single.model, DEFAULTS.codex.fast); assert.equal(single.effort, 'high');
  }
});
test('effort is capped and unsupported levels are clamped downward', () => {
  assert.equal(call({ answer: a('balanced', 'max') }).effort, 'high');
  const limited = { ...models, balanced: { ...models.balanced, efforts: ['low', 'medium'] } };
  assert.equal(call({ answer: a('balanced', 'high'), models: limited }).effort, 'medium');
});
test('Haiku without effort capability does not get effort', () => assert.equal(call({ models: { ...models, fast: { model: 'claude-haiku-4-5', efforts: [] } } }).effort, null));
test('short Korean confirmations inherit previous task but real requests do not', () => {
  assert.ok(isConfirmation('응')); assert.ok(isConfirmation('계속')); assert.ok(!isConfirmation('응 인증 오류도 수정해줘'));
});
test('standalone Japanese and Chinese confirmations match without swallowing new work or questions', () => {
  for (const text of ['はい', '了解です。', '続けてください！', '  進めて  ', '好的', '可以。', '请继续！', '没问题']) assert.ok(isConfirmation(text), text);
  for (const text of ['はい、認証エラーも修正して', '続けていいですか？', 'いいえ', '好的，修改登录错误', '可以吗？', '不要继续', '不可以', '继续调查这个问题']) assert.ok(!isConfirmation(text), text);
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

const catalog = [...new Set(Object.values(DEFAULTS.codex))].map(slug => ({ slug, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }] }));
function scoped(names, extra = {}) {
  const policy = scopedPolicy({ ...DEFAULTS, ...extra }, 'codex', names);
  return { policy, models: resolveModels(policy, 'codex', catalog) };
}
test('all requested model combinations remain closed across every classifier tier and failures', () => {
  for (const names of [['astra', 'sol'], ['sol'], ['luna'], ['astra', 'sol', 'luna'], ['astra', 'luna']]) {
    const config = scoped(names), permitted = activeModelIds(config.policy, 'codex');
    for (const tier of TIERS) for (const flags of [{}, { sensitive: true }, { confidence: 0.1 }]) {
      for (const failed of [false, true]) {
        const r = call({ ...config, answer: { ...a(tier, 'high'), ...flags }, failed });
        assert.ok(permitted.includes(r.model), `${names}: ${r.model}`);
      }
    }
    assert.ok(permitted.includes(call({ ...config, answer: { ok: false } }).model));
  }
});
test('noncontiguous scope never fills its gap with Sol, even when holding a stale route', () => {
  const config = scoped(['astra', 'luna']);
  assert.equal(call({ ...config, answer: a('balanced') }).model, DEFAULTS.codex.frontier);
  const r = call({ ...config, answer: { ok: false }, current: { tier: 'balanced', model: DEFAULTS.codex.balanced, effort: 'high' } });
  assert.equal(r.model, DEFAULTS.codex.frontier);
});
test('single-model scope still selects reasoning effort independently', () => {
  const config = scoped(['sol']);
  const low = call({ ...config, answer: a('fast', 'low') }), high = call({ ...config, answer: a('frontier', 'high') });
  assert.equal(low.model, high.model); assert.equal(low.model, DEFAULTS.codex.balanced);
  assert.equal(low.effort, 'low'); assert.equal(high.effort, 'high');
});
test('launch scope overrides project bounds and scope without mutating defaults', () => {
  const policy = scopedPolicy({ ...DEFAULTS, minTier: 'balanced', codexModels: ['astra', 'sol'] }, 'codex', ['luna']);
  assert.equal(policy.minTier, 'fast'); assert.equal(policy.maxTier, 'fast'); assert.equal(policy.defaultTier, 'fast');
  assert.deepEqual(DEFAULTS.codexModels, []);
  assert.deepEqual(scopedPolicy({ ...DEFAULTS, codexModels: ['astra', 'sol'] }, 'codex').codexModels, [DEFAULTS.codex.frontier, DEFAULTS.codex.balanced]);
});
test('missing excluded catalog models do not prevent a scoped launch', () => {
  const policy = scopedPolicy(DEFAULTS, 'codex', ['sol']);
  assert.equal(resolveModels(policy, 'codex', catalog.filter(m => m.slug === DEFAULTS.codex.balanced)).fast.allowed, false);
  assert.throws(() => resolveModels(policy, 'codex', []), /absent/);
});
test('scope rejects misspellings and other provider models before classification', () => {
  assert.throws(() => scoped(['astrra']), /Unknown codex/);
  assert.throws(() => validatePolicy({ ...DEFAULTS, codexModels: 'sol' }), /expected an array/);
  assert.throws(() => validatePolicy({ ...DEFAULTS, claudeModels: ['astra'] }), /Unknown claude/);
  assert.deepEqual(scopedPolicy(DEFAULTS, 'claude', ['sonnet', 'haiku']).claudeModels, [DEFAULTS.claude.balanced, DEFAULTS.claude.fast]);
});

test('visual interpretation has a model/effort floor without escaping a restricted scope', () => {
  const ordinary = call({ visual: true }); assert.equal(ordinary.model, DEFAULTS.codex.strong); assert.equal(ordinary.effort, 'high'); assert.equal(ordinary.reason, 'visual-context');
  assert.equal(call({ visual: true, answer: { ok: false }, current: { tier: 'fast', model: models.fast.model, effort: 'low' } }).model, DEFAULTS.codex.strong);
  const limited = call({ ...scoped(['luna']), visual: true }); assert.equal(limited.model, DEFAULTS.codex.fast);
  assert.equal(call({ visual: true, policy: { ...DEFAULTS, maxEffort: 'low' } }).effort, 'low');
});
test('an explicit choice may lower a warm route immediately while normal automatic routing holds', () => {
  const extra = { current: { tier: 'frontier', model: models.frontier.model, effort: 'high' }, warm: true, contextTokens: 50000 };
  assert.equal(call(extra).tier, 'frontier'); assert.equal(call({ ...extra, forced: true }).tier, 'fast');
});
