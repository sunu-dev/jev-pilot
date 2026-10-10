import { mkdirSync, openSync, writeSync, closeSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataHome } from './config.mjs';

const FIELDS = new Set(['event', 'agent', 'session', 'request', 'reason', 'tier', 'model', 'servedModel', 'effort', 'fromModel', 'fromEffort', 'modelChanged', 'effortChanged', 'ok', 'status', 'ms', 'confidence', 'inputTokens', 'outputTokens', 'usage', 'cost', 'baselineCost', 'jevCost', 'completed', 'error', 'shadow', 'proposedModel', 'proposedEffort', 'mode', 'allowedModels']);
export function createLedger({ dir = join(dataHome(), 'logs'), agent, warn = () => {} } = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const run = randomUUID();
  const path = join(dir, `${new Date().toISOString().replaceAll(':', '-')}-${run}.jsonl`);
  let fd = openSync(path, 'wx', 0o600), bytes = 0, warned = false;
  const log = data => {
    if (fd === null) return;
    const event = Object.fromEntries(Object.entries(data).filter(([k]) => FIELDS.has(k)));
    const line = JSON.stringify({ schema: 1, ts: new Date().toISOString(), run, agent, ...event }) + '\n';
    try {
      if (bytes + Buffer.byteLength(line) > 50 * 1024 * 1024) throw new Error('log-limit');
      writeSync(fd, line); bytes += Buffer.byteLength(line);
    } catch {
      closeSync(fd); fd = null;
      if (!warned) { warn('Report logging stopped (storage or 50 MB session limit). Routing continues.'); warned = true; }
    }
  };
  return { path, run, log, close() { if (fd !== null) { closeSync(fd); fd = null; } } };
}
export function readLedger(path = join(dataHome(), 'logs')) {
  let files;
  try { files = statSync(path).isDirectory() ? readdirSync(path).filter(f => f.endsWith('.jsonl')).sort().map(f => join(path, f)) : [path]; }
  catch (err) { if (err.code === 'ENOENT') return { events: [], malformed: 0 }; throw err; }
  const events = []; let malformed = 0;
  for (const file of files) {
    if (statSync(file).size > 51 * 1024 * 1024) throw new Error('Log exceeds supported 51 MB file size');
    for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      try { const e = JSON.parse(line); if (e.schema !== 1 || !e.event || !e.run) throw new Error(); events.push(e); } catch { malformed++; }
    }
  }
  return { events, malformed };
}
