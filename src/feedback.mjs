import { join } from 'node:path';
import { dataHome } from './config.mjs';
import { createLedger, readLedger } from './ledger.mjs';

export const FEEDBACK_RATINGS = Object.freeze(['right', 'too-weak', 'too-strong', 'too-slow', 'rework']);
const AGENTS = new Set(['codex', 'claude']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const safeModel = value => value == null || (typeof value === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(value));
const safeTimestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));

// Feedback is an observation about a saved routing decision, not an evaluation
// of its response. A correction creates another event; report consumers use the
// latest event for the same sourceDecision (or legacy run/session/timestamp).
export function recordFeedback({ dir = join(dataHome(), 'logs'), rating, agent, decisionId, warn = () => {} } = {}) {
  if (!FEEDBACK_RATINGS.includes(rating)) throw new Error(`Invalid feedback rating. Choose: ${FEEDBACK_RATINGS.join(', ')}.`);
  if (agent !== undefined && !AGENTS.has(agent)) throw new Error('Feedback tool must be codex or claude.');
  if (decisionId !== undefined && !safeId(decisionId)) throw new Error('Invalid --decision ID. Use the exact decision ID from the report.');

  const { events, malformed } = readLedger(dir);
  // An unfinished write could be a newer decision. Do not silently attach the
  // verdict to an older decision while another process is writing that record.
  if (malformed) throw new Error('Feedback was not saved: routing logs contain incomplete or unreadable records. Wait for the current write to finish and try again.');
  const candidates = events.filter(event => event.event === 'decision' && AGENTS.has(event.agent) && (agent === undefined || event.agent === agent)
    && (decisionId === undefined || event.decisionId === decisionId));
  if (decisionId !== undefined && !candidates.length) throw new Error(`No routing decision found for the specified ID${agent ? ` and ${agent}` : ''}. Check --decision and --agent; feedback was not saved.`);
  if (decisionId !== undefined && candidates.length > 1) throw new Error('Feedback was not saved: the decision ID matches multiple records. Check the routing logs before retrying.');
  if (!candidates.length) throw new Error(`No routing decisions found${agent ? ` for ${agent}` : ''}. Use pilot-codex or pilot-claude before recording feedback.`);

  let target;
  let latest = -Infinity;
  for (const candidate of candidates) {
    if (!safeTimestamp(candidate.ts)) throw new Error('Feedback was not saved: a routing decision has an invalid timestamp.');
    const time = Date.parse(candidate.ts);
    // On equal timestamps, use the later ledger entry. New decisions carry an
    // explicit id; legacy logs can only identify a run/session/timestamp tuple.
    if (time >= latest) { target = candidate; latest = time; }
  }
  if (candidates.some(candidate => Date.parse(candidate.ts) === latest && candidate.run !== target.run)) {
    throw new Error('Feedback was not saved: the latest decision is ambiguous across runs. Specify --decision ID, narrow with --agent codex|claude, or record feedback after the intended session’s next decision.');
  }
  if (!safeId(target.run) || !safeId(target.session) || !safeModel(target.model) ||
      (target.effort != null && !EFFORTS.has(target.effort)) ||
      (target.decisionId !== undefined && !safeId(target.decisionId))) {
    throw new Error('Feedback was not saved: the selected routing decision has invalid linking metadata.');
  }

  const feedback = {
    event: 'feedback', agent: target.agent, rating,
    sourceRun: target.run, sourceTs: target.ts, sourceSession: target.session,
    ...(target.decisionId !== undefined ? { sourceDecision: target.decisionId } : {}),
    model: target.model ?? null, effort: target.effort ?? null,
  };
  // Each sequential correction must sort after the previous verdict even when
  // the wall clock has not advanced (or has moved backwards). Original events
  // stay untouched; only this new feedback event gets the monotonic timestamp.
  let timestampMs = Date.now();
  for (const event of events) {
    if (event.event !== 'feedback' || event.agent !== target.agent) continue;
    const sameDecision = event.sourceDecision !== undefined && target.decisionId !== undefined
      ? event.sourceDecision === target.decisionId
      : event.sourceRun === target.run && event.sourceTs === target.ts && event.sourceSession === target.session;
    if (sameDecision && safeTimestamp(event.ts)) timestampMs = Math.max(timestampMs, Date.parse(event.ts) + 1);
  }
  const timestamp = new Date(timestampMs).toISOString();
  const ledger = createLedger({ dir, agent: target.agent, warn, now: () => timestamp });
  try { ledger.log(feedback); } finally { ledger.close(); }
  const persisted = readLedger(ledger.path).events[0];
  if (!persisted || persisted.event !== 'feedback' || persisted.rating !== rating ||
      persisted.sourceRun !== target.run || persisted.sourceTs !== target.ts || persisted.sourceSession !== target.session ||
      (target.decisionId !== undefined && persisted.sourceDecision !== target.decisionId)) {
    throw new Error('Feedback could not be saved. Check report storage and try again.');
  }
  return { event: persisted, path: ledger.path };
}
