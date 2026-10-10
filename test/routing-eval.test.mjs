import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateCases, scoreCase, runEvaluation, main, MAX_CASES } from '../scripts/evaluate-routing.mjs';

const cases = JSON.parse(readFileSync(new URL('./fixtures/routing-cases.json', import.meta.url), 'utf8'));
test('authored routing rubric covers all four languages without claiming held-out labels', () => {
  assert.equal(validateCases(cases).length, 24);
  for (const language of ['en', 'ko', 'ja', 'zh']) assert.equal(cases.filter(c => c.language === language).length, 6);
  for (const rubric of ['mechanical', 'short-hard', 'long-simple', 'visual-research', 'polished-design', 'ambiguity', 'repeat-correction', 'security-explanation', 'security-change']) assert.ok(cases.some(c => c.rubric === rubric), rubric);
});
test('case schema rejects unbounded, duplicate and inconsistent expectations', () => {
  for (const invalid of [[], Array(MAX_CASES + 1).fill(cases[0]), [cases[0], cases[0]], [{ ...cases[0], images: -1 }], [{ ...cases[0], text: 'x'.repeat(8001) }], [{ ...cases[0], minEffort: 'max', maxEffort: 'low' }], [{ ...cases[0], allowedTiers: ['unknown'] }], [{ ...cases[0], extra: 'field' }]]) assert.throws(() => validateCases(invalid));
});
test('rubric disagreements stay separate from classifier errors and task failure', () => {
  assert.equal(scoreCase(cases[0], { ok: true, tier: 'fast', effort: 'low' }).status, 'rubric-match');
  const disagreement = scoreCase(cases[0], { ok: true, tier: 'frontier', effort: 'max' });
  assert.equal(disagreement.status, 'rubric-disagreement'); assert.ok(disagreement.tierDisagreement); assert.ok(disagreement.effortDisagreement);
  const error = scoreCase(cases[0], { ok: false }); assert.equal(error.status, 'classifier-error'); assert.equal(error.tierDisagreement, false);
  assert.equal(scoreCase(cases[0], { ok: true, tier: 'fast', effort: 'unexpected' }).status, 'classifier-error');
  const explanation = cases.find(c => c.rubric === 'security-explanation');
  const incorrectRisk = scoreCase(explanation, { ok: true, tier: 'fast', effort: 'low', sensitive: true });
  assert.equal(incorrectRisk.status, 'rubric-disagreement'); assert.equal(incorrectRisk.riskDisagreement, true);
  assert.equal(scoreCase(explanation, { ok: true, tier: 'fast', effort: 'low', sensitive: false }).status, 'rubric-match');
});
test('evaluation is sequential, bounds requests, records coverage, and omits prompts and raw responses', async () => {
  let active = 0, maximum = 0, calls = 0;
  const selected = [cases[0], cases[2], cases[8]];
  const result = await runEvaluation(selected, { key: 'fake-key-never-written', classifyImpl: async ({ state, onEvent }) => {
    active++; maximum = Math.max(maximum, active); calls++;
    assert.equal(state.attachments.image_pixels_visible_to_classifier, false);
    await Promise.resolve();
    onEvent({ event: 'jev_result', ms: 12, ...(calls < 3 ? { inputTokens: 10, outputTokens: 2 } : {}) });
    active--;
    return calls === 2 ? { ok: false, raw: 'private-provider-body' } : { ok: true, tier: 'fast', effort: 'low', raw: 'private-provider-body' };
  } });
  assert.equal(calls, selected.length); assert.equal(maximum, 1);
  assert.equal(result.totals.classifierErrors, 1); assert.equal(result.totals.disagreements, 1);
  assert.equal(result.byLanguage.ko.disagreements, 1); assert.equal(result.byRubric['visual-research'].disagreements, 1);
  assert.equal(result.tokens.reportedCases, 2); assert.equal(result.tokens.totalCases, 3); assert.equal(result.tokens.input, 20);
  assert.equal(result.latency.p95Ms, 12); assert.equal(result.heldOut, false);
  const serialized = JSON.stringify(result);
  for (const privateText of [...selected.map(c => c.text), 'fake-key-never-written', 'private-provider-body']) assert.ok(!serialized.includes(privateText));
  assert.ok(!Object.hasOwn(result.totals, 'taskSuccess'));
});
test('a throwing classifier records one error without retrying or leaking exceptions', async () => {
  let calls = 0;
  const result = await runEvaluation([cases[0]], { classifyImpl: async () => { calls++; throw new Error('private failure'); } });
  assert.equal(calls, 1); assert.equal(result.totals.classifierErrors, 1); assert.equal(result.latency.reportedCases, 0); assert.equal(result.latency.measuredCases, 1); assert.ok(!JSON.stringify(result).includes('private failure'));
});
test('offline CLI writes only schema metadata to an exclusive owner-only file and live requires an explicit output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'routing-eval-test-')), out = join(dir, 'aggregate.json');
  try {
    const result = await main(['--out', out]);
    assert.equal(result.apiRequests, 0); assert.equal(statSync(out).mode & 0o777, 0o600);
    assert.ok(!readFileSync(out, 'utf8').includes(cases[0].text));
    await assert.rejects(main(['--out', out]), /EEXIST/);
    await assert.rejects(main(['--live']), /explicit --out/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
