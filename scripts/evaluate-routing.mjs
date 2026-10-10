import { readFileSync, openSync, writeFileSync, closeSync, fchmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { TIERS, EFFORTS, loadConfig, loadKey } from '../src/config.mjs';
import { QUESTIONS, classify, decisionState } from '../src/jev.mjs';

export const MAX_CASES = 32;
const LANGUAGES = ['en', 'ko', 'ja', 'zh'];
const CASE_FIELDS = ['id', 'language', 'rubric', 'text', 'images', 'allowedTiers', 'minEffort', 'maxEffort', 'expectedSensitive'];
export function validateCases(cases) {
  if (!Array.isArray(cases) || !cases.length || cases.length > MAX_CASES) throw new Error(`Expected 1–${MAX_CASES} authored cases`);
  const ids = new Set();
  for (const c of cases) {
    if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).some(k => !CASE_FIELDS.includes(k))) throw new Error('Invalid case fields');
    if (typeof c.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(c.id) || ids.has(c.id)) throw new Error('Case IDs must be unique lowercase identifiers');
    ids.add(c.id);
    if (!LANGUAGES.includes(c.language) || typeof c.rubric !== 'string' || !/^[a-z0-9-]{1,80}$/.test(c.rubric)) throw new Error(`Invalid language or rubric: ${c.id}`);
    if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 8000) throw new Error(`Invalid text: ${c.id}`);
    if (!Number.isInteger(c.images) || c.images < 0 || c.images > 5) throw new Error(`Invalid image count: ${c.id}`);
    if (!Array.isArray(c.allowedTiers) || !c.allowedTiers.length || new Set(c.allowedTiers).size !== c.allowedTiers.length || c.allowedTiers.some(t => !TIERS.includes(t))) throw new Error(`Invalid allowed tiers: ${c.id}`);
    if (!EFFORTS.includes(c.minEffort) || !EFFORTS.includes(c.maxEffort) || EFFORTS.indexOf(c.minEffort) > EFFORTS.indexOf(c.maxEffort)) throw new Error(`Invalid effort interval: ${c.id}`);
    if (c.expectedSensitive !== undefined && typeof c.expectedSensitive !== 'boolean') throw new Error(`Invalid expected risk: ${c.id}`);
  }
  return cases;
}
export function scoreCase(c, answer) {
  if (!answer?.ok || !TIERS.includes(answer.tier) || !EFFORTS.includes(answer.effort)) return { status: 'classifier-error', tierDisagreement: false, effortDisagreement: false, riskDisagreement: false };
  const tierDisagreement = !c.allowedTiers.includes(answer.tier);
  const depth = EFFORTS.indexOf(answer.effort);
  const effortDisagreement = depth < EFFORTS.indexOf(c.minEffort) || depth > EFFORTS.indexOf(c.maxEffort);
  const riskDisagreement = c.expectedSensitive !== undefined && answer.sensitive !== c.expectedSensitive;
  return { status: tierDisagreement || effortDisagreement || riskDisagreement ? 'rubric-disagreement' : 'rubric-match', tierDisagreement, effortDisagreement, riskDisagreement,
    selectedTier: answer.tier, selectedEffort: answer.effort, selectedSensitive: typeof answer.sensitive === 'boolean' ? answer.sensitive : null };
}
const count = () => ({ cases: 0, classified: 0, disagreements: 0, classifierErrors: 0, tierDisagreements: 0, effortDisagreements: 0, riskDisagreements: 0 });
const validTokens = n => Number.isInteger(n) && n >= 0 ? n : null;
export async function runEvaluation(cases, { key, requestChars = 2000, classifyImpl = classify, onProgress = () => {} } = {}) {
  validateCases(cases);
  const results = [];
  for (const c of cases) {
    let event, answer;
    const started = performance.now();
    try {
      answer = await classifyImpl({ key, state: decisionState({}, [{ text: c.text, images: c.images }], requestChars),
        onEvent: e => { if (e.event === 'jev_result') event = e; } });
    } catch { answer = { ok: false }; }
    const reportedLatency = Number.isFinite(event?.ms) && event.ms >= 0;
    const ms = reportedLatency ? event.ms : Math.round(performance.now() - started);
    results.push({ id: c.id, language: c.language, rubric: c.rubric, ...scoreCase(c, answer), latencyMs: ms, latencySource: reportedLatency ? 'classifier-event' : 'measured',
      inputTokens: validTokens(event?.inputTokens), outputTokens: validTokens(event?.outputTokens) });
    onProgress({ completed: results.length, total: cases.length });
  }
  const totals = count(), byLanguage = {}, byRubric = {};
  for (const r of results) for (const group of [totals, byLanguage[r.language] ??= count(), byRubric[r.rubric] ??= count()]) {
    group.cases++;
    if (r.status === 'classifier-error') group.classifierErrors++; else group.classified++;
    if (r.status === 'rubric-disagreement') group.disagreements++;
    if (r.tierDisagreement) group.tierDisagreements++;
    if (r.effortDisagreement) group.effortDisagreements++;
    if (r.riskDisagreement) group.riskDisagreements++;
  }
  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const covered = results.filter(r => r.inputTokens !== null && r.outputTokens !== null);
  return { schema: 1, mode: 'live-classifier-rubric', authoredCases: true, heldOut: false,
    interpretation: 'Rubric agreement reflects authored expectations. It does not measure task success, response quality or savings. Image pixels are not sent. Languages contain different tasks, so per-language counts are diagnostic rather than comparable accuracy.',
    classifierQuestionsSha256: createHash('sha256').update(JSON.stringify(QUESTIONS)).digest('hex'), requestChars,
    expectedRequests: cases.length, completedRequests: results.length, totals, byLanguage, byRubric,
    latency: { reportedCases: results.filter(r => r.latencySource === 'classifier-event').length, measuredCases: latencies.length, medianMs: latencies[Math.floor((latencies.length - 1) / 2)], p95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1] },
    tokens: { reportedCases: covered.length, inputReportedCases: results.filter(r => r.inputTokens !== null).length, outputReportedCases: results.filter(r => r.outputTokens !== null).length,
      totalCases: cases.length, input: results.reduce((n, r) => n + (r.inputTokens ?? 0), 0), output: results.reduce((n, r) => n + (r.outputTokens ?? 0), 0) }, results };
}
export async function main(args = process.argv.slice(2)) {
  let live = false, out, caseFile = fileURLToPath(new URL('../test/fixtures/routing-cases.json', import.meta.url));
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') { console.log('Usage: node scripts/evaluate-routing.mjs [--cases FILE] [--out FILE] [--live]\nDefault: validate authored cases offline. --live makes one paid Jev request per case and requires --out.'); return; }
    if (!['--live', '--out', '--cases'].includes(arg) || seen.has(arg)) throw new Error('Unknown or repeated evaluation option');
    seen.add(arg);
    if (arg === '--live') live = true;
    else {
      const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--out') out = value; else caseFile = value;
    }
  }
  const cases = validateCases(JSON.parse(readFileSync(caseFile, 'utf8')));
  if (live && !out) throw new Error('--live requires an explicit --out path');
  let config, key;
  if (live) {
    config = loadConfig();
    if (!config.policy.sendToJev) throw new Error('Live evaluation refused: sendToJev is disabled');
    key = loadKey(config);
    if (!key) throw new Error('Live evaluation refused: TypeSafe API key is missing');
  }
  const fd = out ? openSync(resolve(out), 'wx', 0o600) : undefined;
  try {
    if (fd !== undefined) fchmodSync(fd, 0o600);
    let result;
    if (live) {
      console.log(`Expected Jev requests: ${cases.length}; concurrency: 1; retries: 0. Authored rubric only, not task-quality or savings measurement.`);
      result = await runEvaluation(cases, { key, requestChars: config.policy.requestChars });
      console.log(`Classified ${result.totals.classified}/${cases.length}; rubric disagreements: ${result.totals.disagreements}; classifier errors: ${result.totals.classifierErrors}.`);
    } else {
      result = { schema: 1, mode: 'offline-schema-validation', authoredCases: true, heldOut: false, cases: cases.length, apiRequests: 0,
        languages: [...new Set(cases.map(c => c.language))], rubrics: [...new Set(cases.map(c => c.rubric))] };
      console.log(`Validated ${cases.length} authored cases offline. API requests: 0. Expectations are not calibrated truth or a held-out benchmark.`);
    }
    if (fd !== undefined) writeFileSync(fd, JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally { if (fd !== undefined) closeSync(fd); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Evaluation failed. Check options, case schema, output availability and local configuration. Provider responses and secrets are omitted.'); process.exitCode = 1; });
