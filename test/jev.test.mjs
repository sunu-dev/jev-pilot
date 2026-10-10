import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, decisionState, createClassifierGuard } from '../src/jev.mjs';
import { DEFAULTS, validatePolicy } from '../src/config.mjs';
import { humanTurns } from '../vendor/dirien/messages.mjs';
test('single paid request asks independent capability and effort questions', async () => {
  let count = 0; const events = [];
  const result = await classify({ key: 'test-placeholder', state: { request: 'Rename x' }, onEvent: e => events.push(e), fetchImpl: async (url, options) => {
    count++; assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    const p = JSON.parse(options.body); assert.ok(p.questions.capability); assert.ok(p.questions.effort);
    return Response.json({ answers: { capability: { choice: 'fast', confidence: 0.99 }, effort: { choice: 'low', confidence: 0.98 }, risk: { choice: 'ordinary', confidence: 1 } }, usage: { input_tokens: 100 } });
  } });
  assert.equal(count, 1); assert.equal(result.ok, true); assert.equal(events[1].inputTokens, 100);
});
test('invalid or uncertain data is not fabricated as a successful classification', async () => {
  const result = await classify({ key: 'placeholder', state: {}, fetchImpl: async () => Response.json({ answers: { capability: { choice: 'fast' } } }) });
  assert.equal(result.ok, false);
});
test('provider error body containing credentials is never exposed to logs', async () => {
  const events = [];
  await classify({ key: 'sensitive-value', state: {}, onEvent: e => events.push(e), fetchImpl: async () => new Response('sensitive-value private prompt', { status: 401 }) });
  assert.ok(!JSON.stringify(events).includes('sensitive-value')); assert.equal(events[1].error, 'http-401');
});
test('routing context is bounded and excludes tool output and system instructions', () => {
  const body = { input: [{ role: 'user', content: 'Explain the bug' }, { role: 'assistant', content: 'Previous explanation' }, { type: 'function_call_output', output: 'SECRET TOOL FILE CONTENT' }, { role: 'user', content: 'Fix it' }], instructions: 'PRIVATE SYSTEM PROMPT' };
  const state = decisionState(body, humanTurns(body), 2000);
  assert.ok(!JSON.stringify(state).includes('SECRET TOOL')); assert.ok(!JSON.stringify(state).includes('PRIVATE SYSTEM')); assert.equal(state.last_assistant_message, 'Previous explanation');
});
test('long pasted prose keeps the final task instruction within the context limit', () => {
  const body = { input: 'Background '.repeat(1000) + '\nFinal task: rename the heading only.' };
  const state = decisionState(body, humanTurns(body), 2000);
  assert.ok(state.request.length <= 2000); assert.ok(state.request.endsWith('Final task: rename the heading only.'));
});

test('classification sees image presence but never receives image pixels or paths', () => {
  const body = { input: [{ role: 'user', content: [{ type: 'input_text', text: 'Improve this screen' }, { type: 'input_image', image_url: 'data:image/png;base64,PRIVATE_PIXELS' }] }] };
  const state = decisionState(body, humanTurns(body), 2000);
  assert.equal(state.attachments.image_count, 1); assert.equal(state.attachments.image_pixels_visible_to_classifier, false);
  assert.ok(!JSON.stringify(state).includes('PRIVATE_PIXELS'));
});

test('screenshot follow-ups carry recent attachment metadata without exposing prior pixels', () => {
  const body = { input: [{ role: 'user', content: [{ type: 'input_text', text: '이 화면을 봐줘' }, { type: 'input_image', image_url: 'data:image/png;base64,PRIOR_PRIVATE_PIXELS' }] }, { role: 'assistant', content: '어떤 부분을 개선할까요?' }, { role: 'user', content: '대장주 설명과 디자인을 같이 보완해줘' }] };
  const state = decisionState(body, humanTurns(body), 2000);
  assert.equal(state.attachments.image_count, 0);
  assert.deepEqual(state.recent_user_attachments, [{ turns_ago: 1, image_count: 1 }]);
  assert.ok(!JSON.stringify(state).includes('PRIOR_PRIVATE_PIXELS'));
});
test('separate reported confidence and option probability remain observable, with no invented missing probability', async () => {
  const events = [];
  const response = { answers: { capability: { choice: 'strong', confidence: 0.7, probabilities: { fast: 0.02, balanced: 0.08, strong: 0.8, frontier: 0.1 } }, effort: { choice: 'xhigh', confidence: 0.9 }, risk: { choice: 'ordinary', confidence: 0.95 } } };
  const result = await classify({ key: 'fixture', state: {}, onEvent: e => events.push(e), fetchImpl: async () => Response.json(response) });
  assert.equal(result.confidence, 0.7); assert.equal(result.capabilityProbability, 0.8); assert.ok(Math.abs(result.capabilityMargin - 0.7) < 1e-12);
  assert.equal(result.effortProbability, null); assert.equal(events[1].effortConfidence, 0.9); assert.equal(events[1].riskConfidence, 0.95);
  assert.equal(events[1].rubricVersion, '2026-10-10-quality-context-v2');
  response.answers.capability.probabilities = { fast: 0, balanced: 0, strong: 1, frontier: 1 };
  const invalid = await classify({ key: 'fixture', state: {}, fetchImpl: async () => Response.json(response) });
  assert.equal(invalid.ok, true); assert.equal(invalid.capabilityProbability, null); assert.equal(invalid.capabilityMargin, null);
});

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
test('consecutive classifier failures open the circuit, skip without events, and recover with one later probe', async () => {
  let clock = 1000, calls = 0;
  const events = [], guard = createClassifierGuard({ policy: { ...DEFAULTS, jevCircuitFailures: 2, jevCircuitCooldownSeconds: 5 }, now: () => clock,
    classifyImpl: async ({ onEvent }) => { calls++; onEvent({ event: 'jev_request' }); return calls < 3 ? { ok: false, error: 'http-503' } : { ok: true, tier: 'balanced', effort: 'medium' }; } });
  const first = await guard({ onEvent: e => events.push(e) }); assert.equal(first.jevAttempt, 1); assert.equal(first.circuitState, 'closed');
  const second = await guard({ onEvent: e => events.push(e) }); assert.equal(second.circuitState, 'open'); assert.equal(second.retryAfterMs, 5000);
  clock += 4000;
  const skipped = await guard({ onEvent: e => events.push(e) }); assert.equal(skipped.skipped, 'circuit-open'); assert.equal(skipped.attempted, false); assert.equal(skipped.retryAfterMs, 1000);
  assert.equal(calls, 2); assert.equal(events.length, 2);
  clock += 1000;
  const recovered = await guard({ onEvent: e => events.push(e) }); assert.equal(recovered.ok, true); assert.equal(recovered.recoveryProbe, true); assert.equal(recovered.recovered, true); assert.equal(recovered.circuitState, 'closed'); assert.equal(recovered.consecutiveFailures, 0);
  assert.equal(events[2].jevAttempt, 3); assert.equal(events[2].recoveryProbe, true);
});
test('one half-open recovery probe excludes concurrent probes and a failed probe restarts cooldown', async () => {
  let clock = 1000, calls = 0;
  const waiting = deferred(), guard = createClassifierGuard({ policy: { ...DEFAULTS, jevCircuitFailures: 1, jevCircuitCooldownSeconds: 2 }, now: () => clock,
    classifyImpl: async () => { calls++; return calls === 1 ? { ok: false } : waiting.promise; } });
  await guard(); clock += 2000;
  const probe = guard(), competing = await guard();
  assert.equal(competing.skipped, 'circuit-open'); assert.equal(competing.circuitState, 'half-open'); assert.equal(calls, 2);
  waiting.resolve({ ok: false, error: 'http-503' });
  const failed = await probe; assert.equal(failed.circuitState, 'open'); assert.equal(failed.retryAfterMs, 2000); assert.equal(failed.recoveryProbe, true); assert.equal(failed.recovered, false);
  assert.equal((await guard()).skipped, 'circuit-open'); assert.equal(calls, 2);
});
test('a run-wide request limit reserves concurrent attempts before awaiting and never resets on cooldown', async () => {
  let calls = 0, clock = 1000;
  const waiting = deferred(), guard = createClassifierGuard({ policy: { ...DEFAULTS, jevMaxRequests: 2, jevCircuitFailures: 1, jevCircuitCooldownSeconds: 1 }, now: () => clock,
    classifyImpl: async () => { calls++; return waiting.promise; } });
  const first = guard(), second = guard(), third = await guard();
  assert.equal(calls, 2); assert.equal(third.skipped, 'budget-exhausted'); assert.equal(third.attempted, false);
  waiting.resolve({ ok: false });
  const completed = await Promise.all([first, second]); assert.deepEqual(completed.map(r => r.jevAttempt), [1, 2]);
  clock += 60000;
  assert.equal((await guard()).skipped, 'budget-exhausted'); assert.equal(calls, 2);
  const disabled = createClassifierGuard({ policy: { ...DEFAULTS, jevMaxRequests: 0 }, classifyImpl: async () => { throw new Error('must not execute'); } });
  assert.equal((await disabled()).jevAttempt, 0); assert.equal((await disabled()).skipped, 'budget-exhausted');
});
test('an older in-flight success cannot close a circuit opened by another request', async () => {
  let calls = 0, clock = 1000;
  const old = deferred(), guard = createClassifierGuard({ policy: { ...DEFAULTS, jevCircuitFailures: 1 }, now: () => clock,
    classifyImpl: async () => ++calls === 1 ? old.promise : { ok: false } });
  const original = guard(); await guard(); old.resolve({ ok: true, tier: 'fast', effort: 'low' });
  assert.equal((await original).circuitState, 'open'); assert.equal((await guard()).skipped, 'circuit-open'); assert.equal(calls, 2);
});
test('successful calls reset the failure streak and independent runs have independent budgets', async () => {
  const answers = [{ ok: false }, { ok: true }, { ok: false }];
  const first = createClassifierGuard({ policy: { ...DEFAULTS, jevCircuitFailures: 2, jevMaxRequests: 3 }, classifyImpl: async () => answers.shift() });
  assert.equal((await first()).consecutiveFailures, 1); assert.equal((await first()).consecutiveFailures, 0); assert.equal((await first()).circuitState, 'closed');
  assert.equal((await first()).skipped, 'budget-exhausted');
  const next = createClassifierGuard({ policy: { ...DEFAULTS, jevMaxRequests: 1 }, classifyImpl: async () => ({ ok: true }) });
  assert.equal((await next()).jevAttempt, 1); assert.equal((await next()).skipped, 'budget-exhausted');
});
test('user cancellation neither consumes a pre-aborted attempt nor poisons the failure streak', async () => {
  let calls = 0;
  const guard = createClassifierGuard({ policy: { ...DEFAULTS, jevCircuitFailures: 1, jevMaxRequests: 1 }, classifyImpl: async () => { calls++; return { ok: false, error: 'aborted' }; } });
  const skipped = await guard({ signal: AbortSignal.abort() }); assert.equal(skipped.skipped, 'request-aborted'); assert.equal(skipped.jevAttempt, 0); assert.equal(calls, 0);
  const attempted = await guard(); assert.equal(attempted.attempted, true); assert.equal(attempted.consecutiveFailures, 0); assert.equal(attempted.circuitState, 'closed');
  assert.equal((await guard()).skipped, 'budget-exhausted');
});
test('guard failures expose only a safe error enum and preserve one real fetch per attempt', async () => {
  let calls = 0;
  const events = [], guard = createClassifierGuard({ policy: { ...DEFAULTS, jevCircuitFailures: 1 } });
  const result = await guard({ key: 'private-fixture', state: { request: 'private text' }, onEvent: e => events.push(e), fetchImpl: async () => { calls++; throw new Error('private-fixture private text'); } });
  assert.equal(calls, 1); assert.equal(result.error, 'network-or-timeout'); assert.equal(result.jevAttempt, 1); assert.equal(events.filter(e => e.event === 'jev_request').length, 1);
  assert.ok(!JSON.stringify({ events, result }).includes('private-fixture')); assert.ok(!JSON.stringify({ events, result }).includes('private text'));
  assert.equal((await guard()).skipped, 'circuit-open');
  const throwing = createClassifierGuard({ classifyImpl: async () => { throw new Error('private exception'); } });
  const sanitized = await throwing(); assert.equal(sanitized.error, 'classifier-exception'); assert.ok(!JSON.stringify(sanitized).includes('private exception'));
});
test('guard policy validates bounded integers and nullable optional request limits', () => {
  assert.equal(validatePolicy({ ...DEFAULTS, jevMaxRequests: 0 }).jevMaxRequests, 0);
  assert.equal(validatePolicy({ ...DEFAULTS, jevMaxRequests: null }).jevMaxRequests, null);
  for (const extra of [{ jevCircuitFailures: 0 }, { jevCircuitFailures: 1.5 }, { jevCircuitFailures: 21 }, { jevCircuitCooldownSeconds: 0 }, { jevCircuitCooldownSeconds: 3601 }, { jevMaxRequests: -1 }, { jevMaxRequests: 1.5 }, { jevMaxRequests: '2' }, { jevMaxRequests: 1000001 }]) {
    assert.throws(() => validatePolicy({ ...DEFAULTS, ...extra })); assert.throws(() => createClassifierGuard({ policy: { ...DEFAULTS, ...extra } }));
  }
});
