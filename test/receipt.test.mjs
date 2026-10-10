import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, scopedPolicy } from '../src/config.mjs';
import { routingPolicySnapshot, classifierReceipt } from '../src/receipt.mjs';

test('policy receipts preserve effective scope and limits without copying private config', () => {
  const policy = scopedPolicy({ ...DEFAULTS, keyFile: '/private/key', prompt: 'private content', maxEffort: 'xhigh' }, 'codex', ['sol']);
  const models = Object.fromEntries(['fast', 'balanced', 'strong', 'frontier'].map(tier => [tier, {
    model: policy.codex[tier], efforts: ['low', 'medium', 'high', 'xhigh'], context: 200000, allowed: ['balanced', 'strong'].includes(tier),
  }]));
  const receipt = routingPolicySnapshot(policy, models);
  assert.equal(receipt.maxEffort, 'xhigh');
  assert.deepEqual([...new Set(receipt.models.map(model => model.model))], ['gpt-6.1-sol']);
  assert.equal(receipt.image.pixelsSentToClassifier, false);
  assert.equal(JSON.stringify(receipt).includes('private'), false);
  models.balanced.efforts.push('max');
  assert.equal(receipt.models[0].efforts.includes('max'), false);
});

test('classifier receipts retain safe operational fields only', () => {
  assert.deepEqual(classifierReceipt({ ok: false, skipped: 'circuit-open', attempted: false, retryAfterMs: 30000,
    state: { request: 'private' }, key: 'private', raw: 'private' }), {
    attempted: false, retryAfterMs: 30000, skipped: 'circuit-open',
  });
});
