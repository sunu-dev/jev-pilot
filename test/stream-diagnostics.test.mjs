import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageTap } from '../vendor/dirien/usage.mjs';
import { createProxy, AUTO } from '../src/proxy.mjs';
import { DEFAULTS, TIERS } from '../src/config.mjs';
import { createLedger, readLedger } from '../src/ledger.mjs';
import { safeRequestId, safeRuntimeVersion } from '../src/diagnostics.mjs';

const fixtureId = '11111111-2222-4333-8444-555555555555';
const privateText = 'fixture-private-prompt-and-credential';
const encode = text => new TextEncoder().encode(text);
const sse = value => `data: ${JSON.stringify(value)}\n\n`;
const models = Object.fromEntries(TIERS.map(tier => [tier, { model: DEFAULTS.codex[tier], efforts: ['low', 'medium', 'high'], context: 200000 }]));
// Execute the real handler with stream doubles: no network, keys or paid calls.
function harness(fetchImpl) {
  const events = [], pending = new Map(), waiting = []; let calls = 0;
  const proxy = createProxy({ agent: 'codex', policy: { ...DEFAULTS, sendToJev: false }, models,
    fetchImpl: async (...args) => { calls++; return fetchImpl(...args); },
    log: event => {
      events.push(event);
      if (event.event === 'request') pending.set(event.request, waiting.shift());
      if (event.event === 'response') { pending.get(event.request)?.resolve(event); pending.delete(event.request); }
    } });
  proxy.server.address = () => ({ port: 12345 });
  return { events, calls: () => calls, async send(extra = {}, onWrite, headers = {}) {
    const body = { model: AUTO, input: 'Fixture task', stream: true, ...extra };
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method: 'POST', url: '/v1/responses', headers: { host: 'localhost:12345', 'x-jev-pilot-token': proxy.token, ...headers } });
    const res = new EventEmitter(), chunks = [], completed = Promise.withResolvers();
    Object.assign(res, { headersSent: false, writableFinished: false,
      writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
      write(chunk) { chunks.push(Buffer.from(chunk)); onWrite?.(this); return true; },
      end(text) { if (text) chunks.push(Buffer.from(text)); this.writableFinished = true; },
      destroy() { this.emit('close'); } });
    waiting.push(completed);
    proxy.server.emit('request', req, res);
    const response = await completed.promise;
    return { response, text: Buffer.concat(chunks).toString(), status: res.status, headers: res.headers };
  } };
}

test('failed SSE diagnostics preserve bytes and extract only bounded fields and a fixture UUID', async () => {
  const text = sse({ type: 'response.failed', response: { model: DEFAULTS.codex.balanced, error: { type: 'server_error', code: 'server_error', message: `${privateText}; request ID: ${fixtureId}` } } });
  const h = harness(async () => new Response(new ReadableStream({ start(controller) { for (const byte of encode(text)) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } }));
  const { response, text: relayed } = await h.send();
  assert.equal(relayed, text); assert.equal(h.calls(), 1); assert.equal(response.status, 200); assert.equal(response.completed, false);
  assert.equal(response.streamEnd, 'provider-error'); assert.equal(response.error, 'provider-stream-error');
  assert.equal(response.upstreamEvent, 'response.failed'); assert.equal(response.upstreamErrorType, 'server_error'); assert.equal(response.upstreamErrorCode, 'server_error');
  assert.equal(response.upstreamRequestId, fixtureId); assert.ok(!JSON.stringify(h.events).includes(privateText));
});
test('generic error events prefer a validated upstream header and discard arbitrary diagnostic strings', async () => {
  const text = sse({ type: 'error', error: { type: privateText, code: privateText, message: `request ID ${fixtureId}` } });
  const h = harness(async () => new Response(text, { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'invalid private header', 'request-id': 'req_0123456789ABCDEF01234567' } }));
  const result = await h.send();
  assert.equal(result.text, text); assert.equal(result.response.upstreamRequestId, 'req_0123456789ABCDEF01234567');
  assert.equal(result.response.upstreamErrorType, 'unknown'); assert.equal(result.response.upstreamErrorCode, 'unknown');
  assert.ok(!JSON.stringify(h.events).includes(privateText)); assert.ok(!JSON.stringify(h.events).includes('invalid private header'));
});
test('EOF, explicit incomplete, successful completion and HTTP errors remain distinguishable', async () => {
  const cases = [
    [sse({ type: 'response.created' }), 200, 'eof', 'incomplete-response', false],
    [sse({ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }), 200, 'provider-incomplete', 'provider-incomplete', false],
    [sse({ type: 'response.completed', response: { model: DEFAULTS.codex.balanced, usage: { input_tokens: 4, output_tokens: 1 } } }), 200, 'completed', null, true],
    [JSON.stringify({ error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: privateText } }), 429, 'http-error', 'provider-http', false],
  ];
  for (const [text, status, end, error, completed] of cases) {
    const h = harness(async () => new Response(text, { status, headers: { 'content-type': status === 200 ? 'text/event-stream' : 'application/json' } }));
    const result = await h.send();
    assert.equal(result.text, text); assert.equal(result.status, status); assert.equal(result.response.streamEnd, end); assert.equal(result.response.error, error); assert.equal(result.response.completed, completed);
    assert.ok(!JSON.stringify(h.events).includes(privateText));
  }
});
test('transport failures before headers record allowlisted cause only and do not retry', async () => {
  const h = harness(async () => { throw new TypeError(privateText, { cause: Object.assign(new Error(privateText), { code: 'UND_ERR_HEADERS_TIMEOUT' }) }); });
  const { response, status } = await h.send();
  assert.equal(status, 502); assert.equal(h.calls(), 1); assert.equal(response.streamEnd, 'transport-error');
  assert.equal(response.transportErrorName, 'TypeError'); assert.equal(response.transportErrorCode, 'UND_ERR_HEADERS_TIMEOUT');
  assert.ok(!JSON.stringify(h.events).includes(privateText));
});
test('midstream network failures stay transport errors even when destroying the client aborts the signal', async () => {
  const prefix = sse({ type: 'response.created' }); let pulls = 0;
  const h = harness(async () => new Response(new ReadableStream({ pull(controller) { if (!pulls++) controller.enqueue(encode(prefix)); else controller.error(new TypeError(privateText, { cause: { code: 'UND_ERR_SOCKET' } })); } }), { headers: { 'content-type': 'text/event-stream' } }));
  const result = await h.send();
  assert.equal(result.text, prefix); assert.equal(result.response.streamEnd, 'transport-error'); assert.equal(result.response.transportErrorCode, 'UND_ERR_SOCKET');
  assert.equal(result.response.completed, false); assert.ok(!JSON.stringify(h.events).includes(privateText));
});
test('client cancellation and provider failure followed by disconnect keep separate evidence', async () => {
  let signal, pulls = 0;
  const canceled = harness(async (url, options) => { signal = options.signal; return new Response(new ReadableStream({ pull(controller) { if (!pulls++) controller.enqueue(encode(sse({ type: 'response.created' }))); else controller.error(new DOMException(privateText, 'AbortError')); } }), { headers: { 'content-type': 'text/event-stream' } }); });
  const result = await canceled.send({}, res => res.emit('close'));
  assert.equal(signal.aborted, true); assert.equal(result.response.streamEnd, 'client-aborted'); assert.equal(result.response.transportErrorName, 'AbortError');
  let chunks = 0;
  const failed = harness(async () => new Response(new ReadableStream({ pull(controller) { if (!chunks++) controller.enqueue(encode(sse({ type: 'error', code: 'server_error', message: privateText }))); else controller.error(Object.assign(new Error(privateText), { code: 'ECONNRESET' })); } }), { headers: { 'content-type': 'text/event-stream' } }));
  const interrupted = await failed.send();
  assert.equal(interrupted.response.streamEnd, 'provider-error'); assert.equal(interrupted.response.upstreamErrorCode, 'server_error'); assert.equal(interrupted.response.transportErrorCode, 'ECONNRESET');
});
test('turn identifiers are process-salted digests and request kinds are enums', async () => {
  const h = harness(async () => new Response(sse({ type: 'response.completed' }), { headers: { 'content-type': 'text/event-stream' } }));
  const extra = { client_metadata: { turn_id: privateText, request_kind: 'compaction' } };
  const first = await h.send(extra), same = await h.send(extra), different = await h.send({ client_metadata: { turn_id: 'another-fixture-turn', request_kind: privateText } });
  assert.match(first.response.turnHash, /^[0-9a-f]{24}$/); assert.equal(first.response.turnHash, same.response.turnHash); assert.notEqual(first.response.turnHash, different.response.turnHash);
  assert.equal(first.response.requestKind, 'compaction'); assert.equal(different.response.requestKind, 'unknown');
  assert.ok(!JSON.stringify(h.events).includes(privateText));
});
test('Codex canonical JSON metadata takes precedence and header or legacy metadata remains compatible', async () => {
  const h = harness(async () => new Response(sse({ type: 'response.completed' }), { headers: { 'content-type': 'text/event-stream' } }));
  const canonical = JSON.stringify({ turn_id: privateText, request_kind: 'memory', workspaces: [{ root: privateText, git_url: privateText }], tool_namespaces_info: privateText });
  const header = { 'x-codex-turn-metadata': JSON.stringify({ turn_id: 'header-fixture-turn', request_kind: 'compaction' }) };
  const body = { client_metadata: { 'x-codex-turn-metadata': canonical, turn_id: 'legacy-fixture-turn', request_kind: 'turn' } };
  const preferred = await h.send(body, undefined, header), equivalent = await h.send({ client_metadata: { turn_id: privateText, request_kind: 'memory' } });
  assert.equal(preferred.response.requestKind, 'memory'); assert.equal(preferred.response.turnHash, equivalent.response.turnHash);
  const fromHeader = await h.send({ client_metadata: { 'x-codex-turn-metadata': '{broken', turn_id: 'legacy-fixture-turn', request_kind: 'turn' } }, undefined, header);
  assert.equal(fromHeader.response.requestKind, 'compaction'); assert.notEqual(fromHeader.response.turnHash, preferred.response.turnHash);
  for (const malformed of [null, [], ['not-a-json-string'], '{broken', '[]', 'null', JSON.stringify({ turn_id: {}, request_kind: privateText }), ' '.repeat(65537)]) {
    const result = await h.send({ client_metadata: { 'x-codex-turn-metadata': malformed } });
    assert.equal(result.response.requestKind, 'unknown'); assert.equal(result.response.turnHash, null);
  }
  assert.ok(!JSON.stringify(h.events).includes(privateText)); assert.ok(!JSON.stringify(h.events).includes('tool_namespaces_info'));
});
test('ledger independently sanitizes diagnostic values and never stores error messages', t => {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-diagnostics-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = createLedger({ dir, agent: 'codex' });
  ledger.log({ event: 'response', upstreamEvent: privateText, upstreamErrorType: privateText, upstreamErrorCode: privateText, upstreamRequestId: privateText, transportErrorName: privateText, transportErrorCode: privateText, streamEnd: privateText, turnHash: privateText, requestKind: privateText, message: privateText, cause: { message: privateText }, body: privateText });
  ledger.log({ event: 'response', upstreamRequestId: fixtureId, transportErrorCode: 'ECONNRESET', requestKind: 'turn' }); ledger.close();
  assert.ok(!readFileSync(ledger.path, 'utf8').includes(privateText));
  const [bad, good] = readLedger(dir).events;
  assert.equal(bad.upstreamErrorCode, 'unknown'); assert.equal(bad.upstreamRequestId, null); assert.equal(bad.turnHash, null);
  assert.equal(good.upstreamRequestId, fixtureId); assert.equal(good.transportErrorCode, 'ECONNRESET'); assert.equal(good.requestKind, 'turn');
  for (const invalid of ['req_short', 'Bearer fixture', fixtureId + ' trailing', fixtureId + '\n', 'req_0123456789ABCDEF\n', '00000000-0000-0000-0000-000000000000']) assert.equal(safeRequestId(invalid), null);
});
test('UsageTap diagnostics tolerate malformed events and record only a recognized incomplete reason', () => {
  const tap = new UsageTap('text/event-stream');
  tap.push(encode('data: null\n\ndata: {broken}\n\n' + sse({ type: 'response.incomplete', response: { incomplete_details: { reason: privateText } } })));
  assert.doesNotThrow(() => tap.result()); assert.equal(tap.failure.upstreamErrorCode, 'unknown'); assert.ok(!JSON.stringify(tap.failure).includes(privateText));
});
test('session runtime versions are strictly SemVer validated at the ledger boundary', t => {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-runtime-version-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = createLedger({ dir, agent: 'codex' });
  for (const version of ['0.1.0-alpha.4', '1.2.3', '1.0.0-0.3.7+build.01']) {
    assert.equal(safeRuntimeVersion(version), version); ledger.log({ event: 'session_start', runtimeVersion: version });
  }
  for (const version of [privateText, '01.2.3', '1.02.3', '1.2.03', '1.2.3-alpha.01', '1.2.3\n', 'v1.2.3', '1.2.3-', '1.2.3+', null, {}, '1.2.3+' + 'x'.repeat(129)]) {
    assert.equal(safeRuntimeVersion(version), null); ledger.log({ event: 'session_start', runtimeVersion: version });
  }
  ledger.close();
  const records = readLedger(dir).events;
  assert.equal(records[0].runtimeVersion, '0.1.0-alpha.4'); assert.ok(records.slice(3).every(record => record.runtimeVersion === null));
  assert.ok(!readFileSync(ledger.path, 'utf8').includes(privateText));
});
