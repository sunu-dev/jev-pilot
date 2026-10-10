import test from 'node:test';
import assert from 'node:assert/strict';
import { createProxy, rewriteBody, AUTO } from '../src/proxy.mjs';
import { DEFAULTS, TIERS, scopedPolicy, resolveModels } from '../src/config.mjs';
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
test('distinct turns waiting on one decision serialize every classifier', async t => {
  const gates = Array.from({ length: 3 }, () => Promise.withResolvers()), started = Array.from({ length: 3 }, () => Promise.withResolvers());
  t.after(() => gates.forEach(g => g.resolve()));
  let choices = 0, active = 0, maximum = 0;
  const h = await harness(t, { decideImpl: async () => {
    const i = choices++; maximum = Math.max(maximum, ++active); started[i].resolve();
    await gates[i].promise; active--; return answer;
  } });
  const inputs = Array.from({ length: 3 }, (_, i) => Array.from({ length: i + 1 }, (_, n) => ({ role: 'user', content: 'Task ' + n })));
  let arrivals = 0; const allArrived = Promise.withResolvers();
  h.proxy.server.on('request', () => { if (++arrivals === 3) allArrived.resolve(); });
  const requests = [h.send(inputs[0]).then(r => r.text())]; await started[0].promise;
  requests.push(...inputs.slice(1).map(input => h.send(input).then(r => r.text())));
  await allArrived.promise; await new Promise(resolve => setImmediate(resolve));
  gates[0].resolve(); await started[1].promise; await new Promise(resolve => setImmediate(resolve));
  assert.equal(maximum, 1);
  gates[1].resolve(); await started[2].promise; gates[2].resolve();
  await Promise.all(requests); assert.equal(choices, 3); assert.equal(maximum, 1);
});
test('a tool continuation waits for the in-flight decision instead of taking the default', async t => {
  const gate = Promise.withResolvers(), started = Promise.withResolvers(); t.after(() => gate.resolve());
  const h = await harness(t, { decideImpl: async () => { started.resolve(); await gate.promise; return { ...answer, tier: 'frontier' }; } });
  const input = [{ role: 'user', content: 'Solve this task' }];
  const first = h.send(input).then(r => r.text()); await started.promise;
  const arrived = Promise.withResolvers(); h.proxy.server.once('request', () => arrived.resolve());
  const continuation = h.send([...input, { type: 'function_call_output', call_id: '1', output: 'done' }]).then(r => r.text());
  await arrived.promise; await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.length, 0); gate.resolve(); await Promise.all([first, continuation]);
  assert.ok(h.calls.every(c => JSON.parse(c.options.body).model === DEFAULTS.codex.frontier));
});
test('a late response from a previous human turn cannot overwrite current cache or failure state', async t => {
  const gate = Promise.withResolvers(), started = Promise.withResolvers(); t.after(() => gate.resolve(new Response('', { status: 500 })));
  let requests = 0, decisions = 0;
  const h = await harness(t, { decideImpl: async () => ({ ...answer, tier: ++decisions === 2 ? 'frontier' : 'fast' }), fetchImpl: async (url, options) => {
    if (++requests === 1) { started.resolve(); return gate.promise; }
    return new Response(JSON.stringify({ model: JSON.parse(options.body).model, status: 'completed', usage: { input_tokens: 50000, output_tokens: 10 } }), { headers: { 'content-type': 'application/json' } });
  } });
  const input = [{ role: 'user', content: 'First task' }];
  const first = h.send(input).then(r => r.text()); await started.promise;
  const second = [...input, { role: 'user', content: 'Second task' }]; await (await h.send(second)).text();
  gate.resolve(new Response(JSON.stringify({ status: 'failed', usage: { input_tokens: 1 } }), { status: 500, headers: { 'content-type': 'application/json' } })); await first;
  const state = [...h.proxy.sessions.values()][0]; assert.equal(state.failed, false); assert.equal(state.contextTokens, 50000);
  await (await h.send([...second, { role: 'user', content: 'Fix a typo' }])).text();
  assert.equal(h.events.filter(e => e.event === 'decision').at(-1).reason, 'cache-hold');
  assert.equal(h.events.filter(e => e.event === 'response').length, 3);
});
test('a late duplicate response cannot overwrite the later started request of the same turn', async t => {
  const gate = Promise.withResolvers(), started = Promise.withResolvers(); t.after(() => gate.resolve(new Response('', { status: 500 })));
  let requests = 0;
  const h = await harness(t, { fetchImpl: async (url, options) => {
    if (++requests === 1) { started.resolve(); return gate.promise; }
    return new Response(JSON.stringify({ model: JSON.parse(options.body).model, status: 'completed', usage: { input_tokens: 50000, output_tokens: 10 } }), { headers: { 'content-type': 'application/json' } });
  } });
  const first = h.send('Same task').then(r => r.text()); await started.promise;
  await (await h.send('Same task')).text(); gate.resolve(new Response('', { status: 500 })); await first;
  const state = [...h.proxy.sessions.values()][0]; assert.equal(state.failed, false); assert.equal(state.contextTokens, 50000); assert.equal(h.decisions(), 1);
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
test('an incomplete 200 stream marks the next classified task as failed without retrying it', async t => {
  let calls = 0;
  const h = await harness(t, { fetchImpl: async (url, options) => ++calls === 1
    ? new Response('data: {"type":"response.created"}\n\n', { headers: { 'content-type': 'text/event-stream' } })
    : new Response(JSON.stringify({ model: JSON.parse(options.body).model, status: 'completed', usage: { input_tokens: 100, output_tokens: 10 } }), { headers: { 'content-type': 'application/json' } }) });
  const input = [{ role: 'user', content: 'First task' }]; await (await h.send(input)).text();
  assert.equal(calls, 1); assert.equal(h.events.find(e => e.event === 'response').error, 'incomplete-response');
  await (await h.send([...input, { role: 'user', content: 'Try the next task' }])).text();
  assert.equal(calls, 2); assert.equal(h.events.filter(e => e.event === 'decision').at(-1).reason, 'previous-request-failed');
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

test('automatic scope covers classifier advice, continuations, failures and the price baseline', async t => {
  const policy = scopedPolicy(DEFAULTS, 'codex', ['sol']);
  const scopedModels = resolveModels(policy, 'codex', [{ slug: DEFAULTS.codex.balanced, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] }]);
  let turn = 0;
  const h = await harness(t, { policy, models: scopedModels, prices: { [DEFAULTS.codex.balanced]: { in: 1, out: 2 } }, decideImpl: async () => ++turn === 1 ? { ...answer, tier: 'frontier', sensitive: true } : { ok: false } });
  const input = [{ role: 'user', content: 'Review authentication' }];
  await (await h.send(input)).text();
  await (await h.send([...input, { type: 'function_call_output', call_id: 'a', output: 'done' }])).text();
  await (await h.send([...input, { role: 'user', content: 'Fix a typo' }])).text();
  assert.equal(turn, 2);
  assert.deepEqual(h.calls.map(c => JSON.parse(c.options.body).model), Array(3).fill(DEFAULTS.codex.balanced));
  assert.ok(h.events.filter(e => e.event === 'response').every(e => e.cost === e.baselineCost));
});
test('an explicit native model request is recorded as manual outside automatic scope', async t => {
  const policy = scopedPolicy(DEFAULTS, 'codex', ['luna']);
  const h = await harness(t, { policy, models: { ...models, frontier: { ...models.frontier, allowed: false } } });
  await (await h.send('Manual override', { model: DEFAULTS.codex.frontier })).text();
  assert.equal(h.decisions(), 0); assert.equal(JSON.parse(h.calls[0].options.body).model, DEFAULTS.codex.frontier);
  assert.ok(h.events.some(e => e.event === 'request' && e.reason === 'manual'));
});

test('trailing model choice skips Jev, is held for tools, and the next task returns to automatic routing', async t => {
  const h = await harness(t), input = [{ role: 'user', content: [{ type: 'input_text', text: 'Review this screen. 아스트라 미디움으로 해' }, { type: 'input_image', image_url: 'data:image/png;base64,SYNTHETIC_IMAGE' }] }];
  await (await h.send(input)).text();
  await (await h.send([...input, { type: 'function_call_output', call_id: 'a', output: 'done' }])).text();
  assert.equal(h.decisions(), 0); assert.ok(h.events.some(e => e.reason === 'user-override'));
  assert.equal(JSON.parse(h.calls[0].options.body).model, DEFAULTS.codex.frontier); assert.equal(JSON.parse(h.calls[0].options.body).reasoning.effort, 'medium');
  assert.equal(JSON.parse(h.calls[1].options.body).reasoning.effort, 'medium');
  await (await h.send([...input, { role: 'user', content: 'Fix a typo' }])).text();
  assert.equal(h.decisions(), 1); assert.equal(JSON.parse(h.calls.at(-1).options.body).model, DEFAULTS.codex.fast);
});
test('trailing model/effort commands honor scope and ceiling with an observable limitation', async t => {
  const policy = scopedPolicy(DEFAULTS, 'codex', ['sol']);
  const scopedModels = Object.fromEntries(Object.entries(models).map(([t,m]) => [t,{...m,allowed:m.model===DEFAULTS.codex.balanced}]));
  const notices = [], h = await harness(t, { policy, models: scopedModels, notice: message => notices.push(message) });
  await (await h.send('Review. Use Astra xhigh')).text();
  const sent = JSON.parse(h.calls[0].options.body); assert.equal(sent.model, DEFAULTS.codex.balanced); assert.equal(sent.reasoning.effort, 'high');
  assert.equal(h.decisions(), 0); assert.ok(h.events.some(e => e.reason === 'user-override-limited')); assert.ok(notices.some(n => n.includes('limited')));
});
test('image requests cannot silently classify as a mechanical task, and provider still receives the original image', async t => {
  const h = await harness(t);
  await (await h.send([{ role: 'user', content: [{ type: 'input_text', text: 'Improve this screen' }, { type: 'input_image', image_url: 'data:image/png;base64,SYNTHETIC_IMAGE' }] }])).text();
  const sent = JSON.parse(h.calls[0].options.body); assert.equal(sent.model, DEFAULTS.codex.strong); assert.equal(sent.reasoning.effort, 'high');
  assert.equal(sent.input[0].content[1].image_url, 'data:image/png;base64,SYNTHETIC_IMAGE'); assert.ok(h.events.some(e => e.reason === 'visual-context'));
});
test('replacing an image reclassifies the turn while retrying the same image reuses its decision', async t => {
  const h = await harness(t);
  const input = image => [{ role: 'user', content: [{ type: 'input_text', text: 'Review this screen' }, { type: 'input_image', image_url: 'data:image/png;base64,' + image }] }];
  await (await h.send(input('SYNTHETIC_FIRST'))).text();
  await (await h.send(input('SYNTHETIC_FIRST'))).text(); assert.equal(h.decisions(), 1);
  await (await h.send(input('SYNTHETIC_REPLACEMENT'))).text(); assert.equal(h.decisions(), 2);
  const recorded = JSON.stringify(h.events); assert.ok(!recorded.includes('SYNTHETIC_FIRST')); assert.ok(!recorded.includes('SYNTHETIC_REPLACEMENT'));
});
test('explicit and visual routes both record warm context for subsequent automatic routing', async t => {
  for (const input of [
    [{ role: 'user', content: 'Review it. Use Astra medium' }],
    [{ role: 'user', content: [{ type: 'input_text', text: 'Improve this screen' }, { type: 'input_image', image_url: 'data:image/png;base64,SYNTHETIC_IMAGE' }] }],
  ]) {
    const h = await harness(t, { fetchImpl: async (url, options) => new Response(JSON.stringify({ model: JSON.parse(options.body).model, status: 'completed', usage: { input_tokens: 50000, output_tokens: 10 } }), { headers: { 'content-type': 'application/json' } }) });
    await (await h.send(input)).text(); assert.equal([...h.proxy.sessions.values()][0].contextTokens, 50000);
    await (await h.send([...input, { role: 'user', content: 'Fix a typo' }])).text();
    assert.equal(h.events.filter(e => e.event === 'decision').at(-1).reason, 'cache-hold');
  }
});
test('decisions record the original recommendation separately from the applied policy', async t => {
  const h = await harness(t, { decideImpl: async () => ({ ...answer, tier: 'frontier', effort: 'xhigh', effortConfidence: 0.9, sensitive: true, riskConfidence: 0.85,
    capabilityProbability: 0.75, capabilityMargin: 0.5, effortProbability: 0.8, effortMargin: 0.6 }), policy: { ...DEFAULTS, maxTier: 'strong' } });
  await (await h.send('Review this task')).text();
  const e = h.events.find(e => e.event === 'decision');
  assert.match(e.decisionId, /^[0-9a-f-]{36}$/); assert.equal(e.recommendedTier, 'frontier'); assert.equal(e.recommendedEffort, 'xhigh');
  assert.equal(e.confidence, 0.99); assert.equal(e.effortConfidence, 0.9); assert.equal(e.sensitive, true); assert.equal(e.riskConfidence, 0.85);
  assert.equal(e.capabilityProbability, 0.75); assert.equal(e.capabilityMargin, 0.5); assert.equal(e.effortProbability, 0.8); assert.equal(e.effortMargin, 0.6);
  assert.equal(e.model, DEFAULTS.codex.strong); assert.equal(e.effort, 'high');
});
