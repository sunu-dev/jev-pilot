import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, htmlReport, terminalReport } from '../src/report.mjs';
import { createLedger, readLedger } from '../src/ledger.mjs';
import { mkdtempSync, rmSync, readFileSync, statSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
const base = { schema: 1, ts: '2026-10-10T12:00:00Z', run: 'fixture', agent: 'codex' };
const e = data => ({ ...base, ...data });
test('skipped classifications never inflate paid calls, failures or missing-cost coverage', () => {
  const s = summarize([e({ event: 'jev_skipped', reason: 'circuit-open' }), e({ event: 'jev_skipped', reason: 'budget-exhausted' }),
    e({ event: 'response', cost: 0.1, baselineCost: 0.2 })]);
  assert.equal(s.jevSkipped, 2); assert.equal(s.jevRequests, 0); assert.equal(s.jevFailed, 0);
  assert.equal(s.jevUnfinished, 0); assert.equal(s.estimates.jevCost, 0); assert.equal(s.estimates.netDifference, 0.1);
});
test('receipts use exact run and decision links, preserve old unknowns and avoid manual guesses', () => {
  const snapshot = { maxEffort: 'high' }, policyTrace = [{ rule: 'effort-ceiling' }];
  const s = summarize([e({ event: 'session_start', policySnapshot: snapshot }),
    e({ event: 'decision', decisionId: 'choice-1', policyTrace }), e({ event: 'decision' }),
    e({ event: 'response', decisionId: 'choice-1', servedModel: 'gpt-reported' }),
    e({ event: 'response', decisionId: 'choice-1', servedModel: 'gpt-other-run', run: 'other' }),
    e({ event: 'response', servedModel: 'gpt-manual', reason: 'manual' })]);
  assert.equal(s.timeline[0].decisionId, 'choice-1'); assert.deepEqual(s.timeline[0].policySnapshot, snapshot);
  assert.deepEqual(s.timeline[0].policyTrace, policyTrace); assert.deepEqual(s.timeline[0].servedModels, ['gpt-reported']);
  assert.equal(s.timeline[0].observedResponses, 1); assert.equal(s.timeline[1].decisionId, null);
  assert.deepEqual(s.timeline[1].servedModels, []);
});
test('reports distinguish classifier calls, decisions, changes and provider requests', () => {
  const s = summarize([e({ event: 'jev_request' }), e({ event: 'jev_result', ok: true, ms: 10 }),
    e({ event: 'decision', model: 'gpt-example', modelChanged: false }), e({ event: 'decision', modelChanged: true, effortChanged: true }),
    e({ event: 'request', request: '1' }), e({ event: 'response', request: '1', model: 'gpt-example', completed: true })]);
  assert.equal(s.jevRequests, 1); assert.equal(s.decisions, 2); assert.equal(s.modelChanges, 1); assert.equal(s.responses, 1); assert.equal(s.usageCoverage, 0);
});
test('local feedback counts latest verdict per decision without inflating runs, requests or period', () => {
  const decision = e({ event: 'decision', decisionId: 'choice-1', session: 's', model: 'gpt-example', recommendedTier: 'strong', recommendedEffort: 'xhigh', confidence: 0.7, effortConfidence: 0.8 });
  const feedback = (rating, ts, run) => e({ event: 'feedback', rating, ts, run, sourceDecision: 'choice-1', sourceRun: 'fixture', sourceSession: 's', sourceTs: base.ts });
  const events = [decision, feedback('too-weak', '2026-10-11T12:00:00Z', 'feedback-1'), feedback('right', '2026-10-12T12:00:00Z', 'feedback-2'), e({ event: 'feedback', sourceDecision: 'unrelated', rating: 'rework' })];
  const s = summarize(events, { run: 'fixture' });
  assert.equal(s.runs, 1); assert.equal(s.requests, 0); assert.equal(s.period.end, base.ts);
  assert.equal(s.feedback.ratedDecisions, 1); assert.equal(s.feedback.ratings.right, 1); assert.equal(s.feedback.ratings['too-weak'], 0);
  assert.equal(s.timeline[0].feedback, 'right'); assert.equal(s.timeline[0].recommendedEffort, 'xhigh');
  assert.equal(s.timeline[0].confidence, 0.7); assert.equal(s.timeline[0].effortConfidence, 0.8);
  assert.equal(summarize(events, { agent: 'claude' }).feedback.ratedDecisions, 0);
  assert.equal(summarize(events, { since: '2026-10-11' }).feedback.ratedDecisions, 0);
});
test('legacy feedback uses run/session/time and leaves unrated or orphan decisions unknown', () => {
  const s = summarize([e({ event: 'decision', session: 'legacy' }), e({ event: 'decision', session: 'unrated' }), e({ event: 'feedback', rating: 'rework', sourceRun: 'fixture', sourceSession: 'legacy', sourceTs: base.ts })]);
  assert.equal(s.feedback.ratedDecisions, 1); assert.equal(s.feedback.totalDecisions, 2);
  assert.equal(s.feedback.ratings.rework, 1); assert.equal(s.timeline[1].feedback, null);
});
test('feedback corrections use chronological fractional timestamps rather than string ordering', () => {
  const s = summarize([e({ event: 'decision', decisionId: 'choice' }), e({ event: 'feedback', sourceDecision: 'choice', rating: 'right', ts: '2026-10-10T12:01:00.11Z' }), e({ event: 'feedback', sourceDecision: 'choice', rating: 'too-weak', ts: '2026-10-10T12:01:00.1Z' })]);
  assert.equal(s.feedback.ratings.right, 1); assert.equal(s.feedback.ratings['too-weak'], 0);
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
test('HTTP 200 inference responses explicitly marked incomplete count as failures once', () => {
  const s = summarize([
    e({ event: 'response', status: 200, completed: false, error: null }),
    e({ event: 'response', status: 500, completed: false, error: 'upstream-error' }),
    e({ event: 'response', status: 200, completed: true, error: null })
  ]);
  assert.equal(s.providerFailures, 2); assert.equal(s.completed, 1);
});
test('successful token checks and missing or malformed completion flags do not imply failure', () => {
  const responses = [undefined, null, 0, 'false'].map(completed => e({ event: 'response', status: 200, completed, error: null }));
  responses.push(e({ event: 'response', reason: 'count-tokens', status: 200, completed: false, error: null }));
  assert.equal(summarize(responses).providerFailures, 0);
  responses.push(e({ event: 'response', reason: 'count-tokens', status: 500, completed: false, error: 'upstream-error' }));
  assert.equal(summarize(responses).providerFailures, 1);
});
test('HTML escapes untrusted strings and has no remote assets', () => {
  const html = htmlReport(summarize([e({ event: 'response', servedModel: '</script><img src=x onerror=alert(1)>' })]));
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
test('a selected model cannot masquerade as an observed served model', () => {
  const s = summarize([e({ event: 'response', model: 'gpt-example-selected' })]);
  assert.deepEqual(s.models, [['unknown', 1]]); assert.deepEqual(s.selectedModels, [['gpt-example-selected', 1]]);
  assert.equal(s.servedModelCoverage, 0);
});

test('efficiency ratios exclude manual, auxiliary and token-count traffic and keep empty denominators unknown', () => {
  const requests = ['jev', 'continuation', 'tool-continuation', 'confirmation-hold', 'manual', 'auxiliary', 'count-tokens', 'tool-or-auxiliary'].map((reason, i) => e({ event: 'request', request: String(i), reason }));
  const s = summarize([...requests, e({ event: 'response', usage: { input: 20, cacheRead: 70, cacheWrite: 10, output: 5 } }), e({ event: 'response', reason: 'count-tokens', usage: { input: 1000 } })]);
  assert.equal(s.efficiency.cacheReadPercent, 70); assert.equal(s.efficiency.reusePercent, 75);
  assert.equal(s.efficiency.automaticRequests, 4); assert.equal(s.efficiency.reusedRequests, 3);
  const empty = summarize([]); assert.equal(empty.efficiency.reusePercent, null); assert.equal(empty.efficiency.cacheReadPercent, null);
});
test('unreadable records suppress the net estimate and a zero baseline has no percentage', () => {
  const priced = e({ event: 'response', cost: 0, baselineCost: 0 });
  assert.equal(summarize([priced]).estimates.percent, null);
  const incomplete = summarize([e({ event: 'response', cost: 0.1, baselineCost: 1 })], { malformed: 1 });
  assert.equal(incomplete.estimates.netDifference, null); assert.ok(incomplete.estimates.blockers.includes('malformed-records'));
});
test('model scopes aggregate per tool, preserve old unknown sessions, and do not depend on served model guesses', () => {
  const events = [e({ event: 'session_start', allowedModels: ['gpt-6.1-sol', 'gpt-6-astra'] }), e({ event: 'session_start', run: 'second', allowedModels: ['gpt-6-astra', 'gpt-6.1-sol'] }), e({ event: 'session_start', run: 'old' }), e({ event: 'session_start', run: 'claude', agent: 'claude', allowedModels: ['claude-sonnet-5-5'] })];
  const s = summarize(events, { agent: 'codex' }); assert.equal(s.runs, 3);
  assert.deepEqual(s.modelScopes, [{ agent: 'codex', models: ['gpt-6-astra', 'gpt-6.1-sol'], runs: 2 }]);
  const html = htmlReport(summarize(events), { byAgent: { codex: s } });
  const data = JSON.parse(html.match(/<script id="report-data" type="application\/json">(.*?)<\/script>/s)[1]);
  assert.equal(data.views.codex.runs, 3); assert.equal(data.views.all.runs, 4);
});
test('terminal report keeps unavailable estimates and removes model control characters', () => {
  const s = summarize([e({ event: 'response', servedModel: 'gpt-evil\u001b[31m' })]);
  const output = terminalReport(s); assert.ok(output.includes('Unavailable')); assert.ok(!output.includes('\u001b')); assert.ok(output.includes('report --open'));
});

test('English, Korean, Japanese and Chinese cover every dashboard string and routing reason', () => {
  const source = readFileSync(new URL('../src/report-client.js', import.meta.url), 'utf8');
  const prefix = source.slice(0, source.indexOf('let language ='));
  const result = runInNewContext(prefix + `JSON.stringify(Object.fromEntries(['ko','ja','zh'].map(lang => [lang, { strings: Object.keys(copy.en).filter(k => !(k in copy[lang])), reasons: Object.keys(copy.en.reasons).filter(k => !(k in copy[lang].reasons)) }])))`, { document: { getElementById: () => ({ textContent: '{}' }) } });
  assert.deepEqual(JSON.parse(result), { ko: { strings: [], reasons: [] }, ja: { strings: [], reasons: [] }, zh: { strings: [], reasons: [] } });
});
