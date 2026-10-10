import test from 'node:test';
import assert from 'node:assert/strict';
import { createProxy, rewriteBody, AUTO } from '../src/proxy.mjs';
import { DEFAULTS, TIERS } from '../src/config.mjs';
const models = Object.fromEntries(TIERS.map(t => [t, { model: DEFAULTS.codex[t], efforts: ['low', 'medium', 'high'] }]));
const answer = { ok: true, tier: 'fast', effort: 'low', confidence: 0.99, effortConfidence: 0.99 };
async function harness(t, overrides = {}) {
  const calls = [], events = []; let decisions = 0;
  const proxy = createProxy({ agent: 'codex', policy: DEFAULTS, models, key: 'test-placeholder', log: e => events.push(e),
    decideImpl: async o => { decisions++; await new Promise(r => setTimeout(r, 10)); return answer; },
    fetchImpl: async (url, options) => {
      calls.push({ url, options }); const b = JSON.parse(options.body);
      return new Response(JSON.stringify({ model: b.model, status: 'completed', usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 60 }, output_tokens: 10 } }), { headers: { 'content-type': 'application/json' } });
    }, ...overrides });
  const url = await proxy.listen(); t.after(() => proxy.close());
  const send = (input, extra = {}, headers = {}) => fetch(url + '/v1/responses', { method: 'POST', headers: { 'x-jev-pilot-token': proxy.token, authorization: 'Bearer subscription-placeholder', ...headers }, body: JSON.stringify({ model: AUTO, input, client_metadata: { thread_id: 'test-thread' }, ...extra }) });
  return { proxy, url, calls, events, send, decisions: () => decisions };
}
test('authenticated inference forwards subscription auth only to original host', async t => {
  const h = await harness(t); const res = await h.send('Fix a typo'); await res.text();
  assert.equal(h.calls[0].url, 'https://chatgpt.com/backend-api/codex/responses');
  assert.equal(h.calls[0].options.headers.authorization, 'Bearer subscription-placeholder');
  assert.equal(h.calls[0].options.headers['x-jev-pilot-token'], undefined);
  assert.equal(JSON.parse(h.calls[0].options.body).model, 'gpt-6-luna');
  assert.equal(h.events.find(e => e.event === 'response').usage.cacheRead, 60);
});
test('Origin and unauthenticated requests are refused before paid calls', async t => {
  const h = await harness(t);
  assert.equal((await fetch(h.url + '/healthz')).status, 401);
  assert.equal((await h.send('x', {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal(h.calls.length, 0);
});
test('fresh turns classify once; tool continuations reuse the route', async t => {
  const h = await harness(t); const input = [{ role: 'user', content: 'Fix a typo' }];
  await (await h.send(input)).text();
  await (await h.send([...input, { type: 'function_call_output', call_id: '1', output: 'done' }])).text();
  await (await h.send([...input, { role: 'user', content: 'Add a test' }])).text();
  assert.equal(h.decisions(), 2);
});
test('parallel duplicate turn shares one Jev decision', async t => {
  const h = await harness(t);
  await Promise.all([h.send('Fix typo'), h.send('Fix typo')].map(async p => (await p).text()));
  assert.equal(h.decisions(), 1);
});
test('trailing system hook does not hide the user request', async t => {
  const h = await harness(t);
  await (await h.send([{ role: 'user', content: 'Fix typo' }, { role: 'system', content: 'hook output' }])).text();
  assert.equal(h.decisions(), 1);
});
test('manual model selection bypasses classifier and rewriting', async t => {
  const h = await harness(t);
  await (await h.send('Fix typo', { model: 'gpt-6-astra', reasoning: { effort: 'xhigh' } })).text();
  assert.equal(h.decisions(), 0); assert.equal(JSON.parse(h.calls[0].options.body).reasoning.effort, 'xhigh');
});
test('sub-agent handback is not a new user turn', async t => {
  const h = await harness(t); const messages = [{ role: 'user', content: 'Find the file' }];
  await (await h.send(messages)).text();
  await (await h.send([...messages, { role: 'user', content: '<subagent_notification>Found it</subagent_notification>' }])).text();
  assert.equal(h.decisions(), 1);
});
test('secret-looking prompt does not leave for Jev', async t => {
  const h = await harness(t);
  await (await h.send('Authorization: Bearer ' + 'sensitive-placeholder-credential')).text();
  assert.equal(h.decisions(), 0); assert.ok(h.events.some(e => e.reason === 'secret-not-sent'));
});
test('shadow mode records advice without applying it', async t => {
  const h = await harness(t, { policy: { ...DEFAULTS, mode: 'shadow' } });
  await (await h.send('Fix typo')).text();
  assert.equal(JSON.parse(h.calls[0].options.body).model, models.balanced.model);
  assert.equal(h.events.find(e => e.event === 'decision').proposedModel, models.fast.model);
});
test('SSE split at every UTF-8 byte relays identical Korean bytes and records served usage', async t => {
  const text = 'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: '안녕하세요' }) + '\n\ndata: ' + JSON.stringify({ type: 'response.completed', response: { model: 'gpt-6-luna', usage: { input_tokens: 12, output_tokens: 3 } } }) + '\n\n';
  const bytes = new TextEncoder().encode(text);
  const h = await harness(t, { fetchImpl: async () => new Response(new ReadableStream({ start(c) { for (const b of bytes) c.enqueue(new Uint8Array([b])); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } }) });
  assert.equal(await (await h.send('Hello')).text(), text);
  const e = h.events.find(e => e.event === 'response'); assert.equal(e.completed, true); assert.equal(e.servedModel, 'gpt-6-luna');
});
test('200 stream without terminal completion is not considered verified', async t => {
  const h = await harness(t, { fetchImpl: async () => new Response('data: {"type":"response.created"}\n\n', { headers: { 'content-type': 'text/event-stream' } }) });
  await (await h.send('Hi')).text(); assert.equal(h.events.find(e => e.event === 'response').completed, false);
});
test('Haiku rewrite removes unsupported thinking and effort without mutating source', () => {
  const b = { model: AUTO, thinking: { type: 'adaptive' }, output_config: { effort: 'high' } };
  const r = rewriteBody(b, { model: 'claude-haiku-4-5', effort: null }, 'claude');
  assert.equal(r.thinking, undefined); assert.equal(r.output_config, undefined); assert.ok(b.thinking);
});
test('tool continuations update warm context without extra classification and prevent premature downgrade', async t => {
  let choice = 0;
  const h = await harness(t, { decideImpl: async () => ({ ...answer, tier: choice++ === 0 ? 'frontier' : 'fast' }), fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body), large = Array.isArray(body.input) && body.input.some(i => i.type === 'function_call_output');
    return new Response(JSON.stringify({ model: body.model, status: 'completed', usage: { input_tokens: large ? 50000 : 100, output_tokens: 10 } }), { headers: { 'content-type': 'application/json' } });
  } });
  const input = [{ role: 'user', content: 'Solve this hard task' }];
  await (await h.send(input)).text();
  await (await h.send([...input, { type: 'function_call_output', call_id: '1', output: 'done' }])).text();
  await (await h.send([...input, { role: 'user', content: 'Fix a typo' }])).text();
  assert.equal(choice, 2); assert.equal(h.events.filter(e => e.event === 'decision').at(-1).reason, 'cache-hold');
  assert.ok(h.events.some(e => e.reason === 'tool-continuation'));
});
test('usage without a served model remains unpriced even when the selection has a rate', async t => {
  const h = await harness(t, { prices: { 'gpt-6-luna': { in: 1, out: 1 } }, fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', usage: { input_tokens: 100, output_tokens: 2 } }), { headers: { 'content-type': 'application/json' } }) });
  await (await h.send('Hi')).text(); assert.equal(h.events.find(e => e.event === 'response').cost, null);
});
