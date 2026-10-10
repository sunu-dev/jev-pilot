import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, decisionState } from '../src/jev.mjs';
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
