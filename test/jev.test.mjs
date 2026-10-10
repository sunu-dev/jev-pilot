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
