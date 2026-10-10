import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedger, readLedger } from '../src/ledger.mjs';
import { recordFeedback } from '../src/feedback.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-feedback-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function decision(dir, agent = 'codex', data = {}, timestamp) {
  const ledger = createLedger({ dir, agent });
  ledger.log({ event: 'decision', session: 'private-session-hash', model: 'gpt-6.1-sol', effort: 'high', ...data });
  ledger.close();
  if (timestamp) {
    const saved = JSON.parse(readFileSync(ledger.path, 'utf8'));
    writeFileSync(ledger.path, JSON.stringify({ ...saved, ts: timestamp }) + '\n');
  }
  return ledger;
}

test('feedback links to a decision and persists metadata only in an owner-readable new log', t => {
  const dir = fixture(t);
  const original = decision(dir, 'codex', { decisionId: 'decision-one', prompt: 'private prompt', key: 'secret-key', path: '/Users/private/project' });
  const before = readFileSync(original.path, 'utf8');
  const result = recordFeedback({ dir, rating: 'too-weak' });
  assert.equal(result.event.agent, 'codex');
  assert.equal(result.event.sourceRun, original.run);
  assert.equal(result.event.sourceSession, 'private-session-hash');
  assert.equal(result.event.sourceDecision, 'decision-one');
  assert.equal(result.event.rating, 'too-weak');
  assert.equal(result.event.model, 'gpt-6.1-sol');
  assert.equal(result.event.effort, 'high');
  assert.notEqual(result.path, original.path);
  assert.equal(readFileSync(original.path, 'utf8'), before);
  const text = readFileSync(result.path, 'utf8');
  for (const privateText of ['private prompt', 'secret-key', '/Users/private/project', dir]) assert.ok(!text.includes(privateText));
  if (process.platform !== 'win32') assert.equal(statSync(result.path).mode & 0o777, 0o600);
});

test('tool filtering chooses that tool’s latest decision rather than a later other-tool event', t => {
  const dir = fixture(t);
  const codex = decision(dir, 'codex', { decisionId: 'codex-one' }, '2026-10-10T12:00:00.001Z');
  const claude = decision(dir, 'claude', { decisionId: 'claude-one', model: 'claude-sonnet-5-5', effort: null }, '2026-10-10T12:00:00.002Z');
  const latest = recordFeedback({ dir, rating: 'right' });
  assert.equal(latest.event.sourceRun, claude.run);
  const filtered = recordFeedback({ dir, rating: 'rework', agent: 'codex' });
  assert.equal(filtered.event.sourceRun, codex.run);
  assert.equal(filtered.event.sourceDecision, 'codex-one');
});

test('an explicit decision ID targets an earlier project and corrections stay on that decision', t => {
  const dir = fixture(t);
  const intended = decision(dir, 'codex', { decisionId: 'project-one', session: 'first-project-session' }, '2026-10-10T12:00:00.001Z');
  decision(dir, 'codex', { decisionId: 'project-two', session: 'second-project-session' }, '2026-10-10T12:00:00.002Z');
  const first = recordFeedback({ dir, rating: 'too-weak', decisionId: 'project-one' });
  decision(dir, 'claude', { decisionId: 'project-three' }, '2026-10-10T12:00:00.003Z');
  const corrected = recordFeedback({ dir, rating: 'right', decisionId: 'project-one', agent: 'codex' });
  for (const event of [first.event, corrected.event]) {
    assert.equal(event.sourceDecision, 'project-one');
    assert.equal(event.sourceRun, intended.run);
    assert.equal(event.sourceSession, 'first-project-session');
  }
  assert.ok(Date.parse(corrected.event.ts) > Date.parse(first.event.ts));
  assert.equal(recordFeedback({ dir, rating: 'rework', agent: 'codex' }).event.sourceDecision, 'project-two');
});

test('decision IDs disambiguate simultaneous runs of the same tool without choosing an arbitrary run', t => {
  const dir = fixture(t), timestamp = '2026-10-10T12:00:00.000Z';
  const intended = decision(dir, 'codex', { decisionId: 'parallel-one' }, timestamp);
  decision(dir, 'codex', { decisionId: 'parallel-two' }, timestamp);
  assert.throws(() => recordFeedback({ dir, rating: 'right', agent: 'codex' }), /ambiguous across runs/);
  const saved = recordFeedback({ dir, rating: 'too-slow', decisionId: 'parallel-one' });
  assert.equal(saved.event.sourceRun, intended.run);
  assert.equal(saved.event.sourceDecision, 'parallel-one');
});

test('invalid, unknown, duplicate and wrong-tool decision IDs cannot create feedback', t => {
  const dir = fixture(t);
  decision(dir, 'codex', { decisionId: 'selected-id' });
  for (const decisionId of ['', '/Users/private/project', 'private prompt', 'a'.repeat(129)]) {
    assert.throws(() => recordFeedback({ dir, rating: 'right', decisionId }), /Invalid --decision ID/);
  }
  assert.throws(() => recordFeedback({ dir, rating: 'right', decisionId: 'unknown-id' }), /No routing decision found for the specified ID/);
  assert.throws(() => recordFeedback({ dir, rating: 'right', decisionId: 'selected-id', agent: 'claude' }), /specified ID and claude/);
  decision(dir, 'codex', { decisionId: 'selected-id' });
  assert.throws(() => recordFeedback({ dir, rating: 'right', decisionId: 'selected-id' }), /matches multiple records/);
  assert.equal(readLedger(dir).events.filter(event => event.event === 'feedback').length, 0);
});

test('rating corrections link to the same decision and do not target a feedback event', t => {
  const dir = fixture(t);
  decision(dir, 'codex', { decisionId: 'correction-source' });
  const first = recordFeedback({ dir, rating: 'too-strong' });
  const corrected = recordFeedback({ dir, rating: 'right' });
  for (const field of ['sourceRun', 'sourceTs', 'sourceSession', 'sourceDecision']) assert.equal(corrected.event[field], first.event[field]);
  assert.notEqual(first.event.run, corrected.event.run);
  assert.deepEqual(readLedger(dir).events.filter(event => event.event === 'feedback').map(event => event.rating).sort(), ['right', 'too-strong']);
});

test('sequential corrections sort deterministically with a fixed or backwards clock for new and legacy decisions', t => {
  let clock = Date.parse('2030-01-01T00:00:00.000Z');
  t.mock.method(Date, 'now', () => clock);
  for (const withId of [true, false]) {
    const dir = fixture(t);
    decision(dir, 'codex', withId ? { decisionId: 'fixed-clock-source' } : {});
    const first = recordFeedback({ dir, rating: 'too-weak' });
    const corrected = recordFeedback({ dir, rating: 'right' });
    assert.equal(Date.parse(corrected.event.ts), Date.parse(first.event.ts) + 1);
    clock -= 1000;
    const third = recordFeedback({ dir, rating: 'rework' });
    assert.equal(Date.parse(third.event.ts), Date.parse(corrected.event.ts) + 1);
    const ordered = readLedger(dir).events.filter(event => event.event === 'feedback').sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    assert.deepEqual(ordered.map(event => event.rating), ['too-weak', 'right', 'rework']);
  }
});

test('invalid ratings, invalid tools and missing decisions fail before creating feedback logs', t => {
  const dir = fixture(t);
  assert.throws(() => recordFeedback({ dir, rating: 'excellent' }), /Invalid feedback rating/);
  assert.throws(() => recordFeedback({ dir, rating: 'right', agent: 'other' }), /codex or claude/);
  assert.throws(() => recordFeedback({ dir, rating: 'right' }), /No routing decisions/);
  decision(dir, 'claude');
  assert.throws(() => recordFeedback({ dir, rating: 'right', agent: 'codex' }), /No routing decisions found for codex/);
  assert.equal(readLedger(dir).events.filter(event => event.event === 'feedback').length, 0);
});

test('an incomplete growing log cannot silently bind feedback to an older decision', t => {
  const dir = fixture(t);
  const source = decision(dir);
  appendFileSync(source.path, '{"schema":1,"event":"decision"');
  assert.throws(() => recordFeedback({ dir, rating: 'right' }), /incomplete or unreadable/);
  assert.throws(() => recordFeedback({ dir, rating: 'right', decisionId: 'some-id' }), /incomplete or unreadable/);
  assert.equal(readLedger(dir).events.filter(event => event.event === 'feedback').length, 0);
});

test('the latest malformed decision metadata is rejected without falling back to an older decision', t => {
  const dir = fixture(t);
  const source = decision(dir);
  appendFileSync(source.path, JSON.stringify({ schema: 1, event: 'decision', run: source.run, agent: 'codex', ts: '2099-01-01T00:00:00Z', session: 'safe-session', model: '/Users/private/project', effort: 'high' }) + '\n');
  assert.throws(() => recordFeedback({ dir, rating: 'too-slow' }), /invalid linking metadata/);
  assert.equal(readLedger(dir).events.filter(event => event.event === 'feedback').length, 0);
});

test('an explicitly selected malformed decision cannot fall back to another valid decision', t => {
  const dir = fixture(t);
  const source = decision(dir, 'codex', { decisionId: 'valid-latest' }, '2026-10-10T12:01:00Z');
  appendFileSync(source.path, JSON.stringify({ schema: 1, event: 'decision', decisionId: 'invalid-target', run: source.run, agent: 'codex', ts: '2026-10-10T12:00:00Z', session: 'safe-session', model: '/Users/private/project', effort: 'high' }) + '\n');
  assert.throws(() => recordFeedback({ dir, rating: 'right', decisionId: 'invalid-target' }), /invalid linking metadata/);
  assert.equal(readLedger(dir).events.filter(event => event.event === 'feedback').length, 0);
  assert.equal(recordFeedback({ dir, rating: 'right', decisionId: 'valid-latest' }).event.sourceDecision, 'valid-latest');
});

test('timestamp strings must be plain ISO metadata, not parsed dates carrying arbitrary text', t => {
  const dir = fixture(t);
  const source = decision(dir);
  appendFileSync(source.path, JSON.stringify({ schema: 1, event: 'decision', run: source.run, agent: 'codex', ts: '2099-01-01 GMT (private prompt)', session: 'safe-session', model: 'gpt-6.1-sol', effort: 'high' }) + '\n');
  assert.throws(() => recordFeedback({ dir, rating: 'right' }), /invalid timestamp/);
});

test('same-time decisions in separate runs require disambiguation rather than arbitrary file ordering', t => {
  const dir = fixture(t);
  const timestamp = '2026-10-10T12:00:00.000Z';
  decision(dir, 'codex', { decisionId: 'parallel-codex' }, timestamp);
  decision(dir, 'claude', { decisionId: 'parallel-claude' }, timestamp);
  assert.throws(() => recordFeedback({ dir, rating: 'right' }), /ambiguous across runs/);
  assert.equal(recordFeedback({ dir, rating: 'right', agent: 'codex' }).event.sourceDecision, 'parallel-codex');
});

test('the default directory ignores verification logs and can record feedback during a live run', t => {
  const root = fixture(t);
  const previous = process.env.JEV_PILOT_DATA_HOME;
  process.env.JEV_PILOT_DATA_HOME = root;
  t.after(() => { if (previous === undefined) delete process.env.JEV_PILOT_DATA_HOME; else process.env.JEV_PILOT_DATA_HOME = previous; });
  decision(join(root, 'verification', 'logs'), 'codex', { decisionId: 'verification-source' });
  assert.throws(() => recordFeedback({ rating: 'right' }), /No routing decisions/);
  assert.throws(() => recordFeedback({ rating: 'right', decisionId: 'verification-source' }), /No routing decision found for the specified ID/);
  const live = createLedger({ dir: join(root, 'logs'), agent: 'codex' });
  t.after(() => live.close());
  live.log({ event: 'decision', session: 'live-session', decisionId: 'live-source', model: 'gpt-6.1-sol', effort: 'medium' });
  const saved = recordFeedback({ rating: 'right' });
  assert.equal(saved.event.sourceDecision, 'live-source');
  assert.equal(saved.event.sourceRun, live.run);
  live.log({ event: 'request', session: 'live-session', model: 'gpt-6.1-sol' });
  assert.equal(readLedger(live.path).events.length, 2);
});
