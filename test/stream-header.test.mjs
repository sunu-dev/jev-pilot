import test from 'node:test';
import assert from 'node:assert/strict';
import { createProxy, AUTO } from '../src/proxy.mjs';
import { DEFAULTS, TIERS } from '../src/config.mjs';
test('subscription SSE without Content-Type still records actual model and completion', async t => {
  const events = [], models = Object.fromEntries(TIERS.map(t => [t, { model: DEFAULTS.codex[t], efforts: ['low', 'medium', 'high'] }]));
  const proxy = createProxy({ agent: 'codex', policy: DEFAULTS, models, key: '', log: e => events.push(e),
    fetchImpl: async () => new Response(new TextEncoder().encode('data: {"type":"response.completed","response":{"model":"gpt-6.1-sol","usage":{"input_tokens":100,"output_tokens":2}}}\n\n')) });
  const url = await proxy.listen(); t.after(() => proxy.close());
  const response = await fetch(url + '/v1/responses', { method: 'POST', headers: { 'x-jev-pilot-token': proxy.token }, body: JSON.stringify({ model: AUTO, stream: true, input: 'Hello' }) });
  await response.text();
  const e = events.find(e => e.event === 'response'); assert.equal(e.completed, true); assert.equal(e.servedModel, 'gpt-6.1-sol'); assert.equal(e.usage.input, 100);
});
