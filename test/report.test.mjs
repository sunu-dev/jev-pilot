import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, htmlReport } from '../src/report.mjs';
import { createLedger, readLedger } from '../src/ledger.mjs';
import { mkdtempSync, rmSync, readFileSync, statSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base = { schema: 1, ts: '2026-10-10T12:00:00Z', run: 'fixture', agent: 'codex' };
const e = data => ({ ...base, ...data });
test('reports distinguish classifier calls, decisions, changes and provider requests', () => {
  const s = summarize([e({ event: 'jev_request' }), e({ event: 'jev_result', ok: true, ms: 10 }),
    e({ event: 'decision', model: 'gpt-example', modelChanged: false }), e({ event: 'decision', modelChanged: true, effortChanged: true }),
    e({ event: 'request', request: '1' }), e({ event: 'response', request: '1', model: 'gpt-example', completed: true })]);
  assert.equal(s.jevRequests, 1); assert.equal(s.decisions, 2); assert.equal(s.modelChanges, 1); assert.equal(s.responses, 1); assert.equal(s.usageCoverage, 0);
});
test('missing price or Jev usage cannot become zero-cost savings', () => {
  const s = summarize([e({ event: 'jev_result', ok: true }), e({ event: 'response', cost: 0.1, baselineCost: 0.5 })]);
  assert.equal(s.estimates.netDifference, null); assert.equal(s.estimates.jevCost, null);
  assert.equal(summarize([e({ event: 'response' })]).estimates.modelCost, null);
});
test('negative estimates are retained and include Jev overhead', () => {
  const s = summarize([e({ event: 'jev_result', ok: true, jevCost: 0.2 }), e({ event: 'response', cost: 1, baselineCost: 1.1 })]);
  assert.ok(Math.abs(s.estimates.netDifference - (-0.1)) < 1e-9);
});
test('partial price coverage hides aggregate percentage', () => {
  const s = summarize([e({ event: 'response', cost: 0.1, baselineCost: 1 }), e({ event: 'response' })]);
  assert.equal(s.estimates.pricedRequests, 1); assert.equal(s.estimates.percent, null);
});
test('unfinished requests remain visible after interruption', () => {
  assert.equal(summarize([e({ event: 'request', request: '1' })]).unfinished, 1);
});
test('HTML escapes untrusted strings and has no remote assets', () => {
  const html = htmlReport(summarize([e({ event: 'response', model: '</script><img src=x onerror=alert(1)>' })]));
  assert.ok(!html.includes('</script><img')); assert.ok(!html.includes('<script src=')); assert.ok(html.includes('\\u003c/script>'));
});
test('ledger excludes raw prompt, key and arbitrary objects; recovers a truncated final line', t => {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-ledger-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = createLedger({ dir, agent: 'codex' });
  ledger.log({ event: 'decision', model: 'gpt-example', prompt: 'private discussion', key: 'secret-value', headers: { authorization: 'secret' } }); ledger.close();
  const text = readFileSync(ledger.path, 'utf8'); assert.ok(!text.includes('private discussion')); assert.ok(!text.includes('secret'));
  if (process.platform !== 'win32') assert.equal(statSync(ledger.path).mode & 0o777, 0o600);
  appendFileSync(ledger.path, '{'); const parsed = readLedger(dir); assert.equal(parsed.events.length, 1); assert.equal(parsed.malformed, 1);
});
test('agent and UTC date filters apply to aggregates', () => {
  const s = summarize([e({ event: 'request', agent: 'claude' }), e({ event: 'request', ts: '2026-10-09T12:00:00Z' }), e({ event: 'request' })], { agent: 'codex', since: '2026-10-10' });
  assert.equal(s.requests, 1);
});
test('token-count responses do not invalidate inference price coverage', () => {
  const s = summarize([e({ event: 'response', reason: 'count-tokens' }), e({ event: 'response', cost: 0.1, baselineCost: 0.5 })]);
  assert.equal(s.tokenChecks, 1); assert.equal(s.inferenceResponses, 1); assert.equal(s.estimates.netDifference, 0.4);
});
test('observed served model changes are independent from attempted selections', () => {
  const s = summarize([e({ event: 'response', session: 'a', servedModel: 'gpt-example-a' }), e({ event: 'response', session: 'a', servedModel: 'gpt-example-b' })]);
  assert.equal(s.servedModelChanges, 1); assert.equal(s.modelChanges, 0);
});
test('interrupted Jev or provider requests suppress the aggregate savings estimate', () => {
  const priced = e({ event: 'response', request: 'done', cost: 0.1, baselineCost: 0.5 });
  const jev = summarize([priced, e({ event: 'jev_request' })]);
  assert.equal(jev.jevUnfinished, 1); assert.equal(jev.estimates.netDifference, null);
  const provider = summarize([priced, e({ event: 'request', request: 'interrupted' })]);
  assert.equal(provider.unfinished, 1); assert.equal(provider.estimates.netDifference, null);
});
test('token counting does not inflate inference token totals', () => {
  const s = summarize([e({ event: 'response', reason: 'count-tokens', usage: { input: 1000 } }), e({ event: 'response', usage: { input: 100 } })]);
  assert.equal(s.usage.input, 100);
});
