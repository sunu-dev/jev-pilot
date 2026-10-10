const money = n => Number.isFinite(n) ? `$${n.toFixed(4)}` : 'Unavailable';
const RATINGS = ['right', 'too-weak', 'too-strong', 'too-slow', 'rework'];
const decisionKey = e => e.decisionId ? `id:${e.decisionId}` : JSON.stringify([e.run, e.session, e.ts]);
const count = list => Object.entries(list.reduce((a, k) => { a[k ?? 'unknown'] = (a[k ?? 'unknown'] ?? 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]);
export function summarize(events, { agent, since, run, malformed = 0 } = {}) {
  const selected = events.filter(e => e.event !== 'feedback' && (!agent || e.agent === agent) && (!since || e.ts >= since) && (!run || e.run === run));
  const decisions = selected.filter(e => e.event === 'decision');
  const decisionKeys = new Set(decisions.map(decisionKey)), feedbackByDecision = new Map();
  for (const e of events.filter(e => e.event === 'feedback' && RATINGS.includes(e.rating) && Number.isFinite(Date.parse(e.ts)) && (!agent || e.agent === agent)).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))) {
    const key = e.sourceDecision ? `id:${e.sourceDecision}` : JSON.stringify([e.sourceRun, e.sourceSession, e.sourceTs]);
    if (decisionKeys.has(key)) feedbackByDecision.set(key, e.rating);
  }
  const feedback = { ratedDecisions: feedbackByDecision.size, totalDecisions: decisions.length,
    ratings: Object.fromEntries(RATINGS.map(r => [r, [...feedbackByDecision.values()].filter(v => v === r).length])) };
  const jev = selected.filter(e => e.event === 'jev_result');
  const responses = selected.filter(e => e.event === 'response');
  const inference = responses.filter(e => e.reason !== 'count-tokens');
  const requests = selected.filter(e => e.event === 'request');
  const done = new Set(responses.map(e => e.request));
  const unfinished = requests.filter(e => !done.has(e.request)).length;
  const jevRequests = selected.filter(e => e.event === 'jev_request').length;
  const jevUnfinished = Math.max(0, jevRequests - jev.length);
  const priced = inference.filter(e => Number.isFinite(e.cost) && Number.isFinite(e.baselineCost));
  const allPriced = inference.length > 0 && priced.length === inference.length && unfinished === 0 && malformed === 0;
  const jevPriced = jevUnfinished === 0 && (jev.length === 0 || jev.every(e => Number.isFinite(e.jevCost)));
  const modelCost = priced.reduce((n, e) => n + e.cost, 0);
  const baselineCost = priced.reduce((n, e) => n + e.baselineCost, 0);
  const jevCost = jevPriced ? jev.reduce((n, e) => n + e.jevCost, 0) : null;
  const net = allPriced && jevPriced ? baselineCost - modelCost - jevCost : null;
  const usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  for (const e of inference) for (const k of Object.keys(usage)) usage[k] += Number.isFinite(e.usage?.[k]) ? e.usage[k] : 0;
  const latency = jev.map(e => e.ms).filter(Number.isFinite).sort((a, b) => a - b);
  const pct = p => latency.length ? latency[Math.min(latency.length - 1, Math.ceil(latency.length * p) - 1)] : null;
  const timeline = decisions.map(e => ({ ts: e.ts, agent: e.agent, model: e.model, effort: e.effort, reason: e.reason, changed: e.modelChanged, shadow: e.shadow, proposedModel: e.proposedModel, proposedEffort: e.proposedEffort,
    recommendedTier: e.recommendedTier ?? null, recommendedEffort: e.recommendedEffort ?? null,
    confidence: Number.isFinite(e.confidence) ? e.confidence : null, effortConfidence: Number.isFinite(e.effortConfidence) ? e.effortConfidence : null,
    capabilityProbability: Number.isFinite(e.capabilityProbability) ? e.capabilityProbability : null,
    capabilityMargin: Number.isFinite(e.capabilityMargin) ? e.capabilityMargin : null,
    effortProbability: Number.isFinite(e.effortProbability) ? e.effortProbability : null,
    effortMargin: Number.isFinite(e.effortMargin) ? e.effortMargin : null,
    sensitive: typeof e.sensitive === 'boolean' ? e.sensitive : null,
    riskConfidence: Number.isFinite(e.riskConfidence) ? e.riskConfidence : null, rubricVersion: e.rubricVersion ?? null,
    feedback: feedbackByDecision.get(decisionKey(e)) ?? null }));
  const autoRequests = requests.filter(e => e.reason && !['manual', 'auxiliary', 'count-tokens', 'tool-or-auxiliary'].includes(e.reason));
  const reusedRequests = autoRequests.filter(e => ['continuation', 'tool-continuation', 'confirmation-hold'].includes(e.reason)).length;
  const inputTotal = usage.input + usage.cacheRead + usage.cacheWrite;
  const times = selected.map(e => e.ts).filter(t => typeof t === 'string' && Number.isFinite(Date.parse(t))).sort();
  const blockers = [];
  if (!inference.length) blockers.push('no-responses');
  if (priced.length < inference.length) blockers.push('missing-prices-or-usage');
  if (!jevPriced) blockers.push('missing-jev-cost');
  if (unfinished || jevUnfinished) blockers.push('unfinished-requests');
  if (malformed) blockers.push('malformed-records');
  let servedModelChanges = 0; const previousServed = new Map();
  for (const e of inference) if (e.servedModel) {
    const id = `${e.run}/${e.session}`;
    if (previousServed.has(id) && previousServed.get(id) !== e.servedModel) servedModelChanges++;
    previousServed.set(id, e.servedModel);
  }
  const scopes = new Map();
  for (const e of selected.filter(e => e.event === 'session_start' && Array.isArray(e.allowedModels))) {
    const models = [...new Set(e.allowedModels.filter(m => typeof m === 'string'))].sort();
    const key = JSON.stringify([e.agent, models]);
    const scope = scopes.get(key) ?? { agent: e.agent, models, runs: 0 };
    scope.runs++; scopes.set(key, scope);
  }
  return {
    modelScopes: [...scopes.values()], feedback,
    schema: 1, runs: new Set(selected.map(e => e.run)).size, requests: requests.length, responses: responses.length,
    unfinished, jevUnfinished, malformed,
    period: { start: times[0] ?? null, end: times.at(-1) ?? null },
    completed: inference.filter(e => e.completed).length, providerFailures: responses.filter(e => e.status >= 400 || e.error).length,
    inferenceResponses: inference.length, tokenChecks: responses.length - inference.length, servedModelChanges,
    decisions: decisions.length, jevRequests,
    jevSucceeded: jev.filter(e => e.ok).length, jevFailed: jev.filter(e => !e.ok).length,
    jevInputTokens: jev.reduce((n, e) => n + (Number.isFinite(e.inputTokens) ? e.inputTokens : 0), 0),
    jevOutputTokens: jev.reduce((n, e) => n + (Number.isFinite(e.outputTokens) ? e.outputTokens : 0), 0),
    jevUsageCoverage: jev.filter(e => Number.isFinite(e.inputTokens)).length,
    modelChanges: decisions.filter(e => e.modelChanged).length, effortChanges: decisions.filter(e => e.effortChanged).length,
    cacheHolds: decisions.filter(e => e.reason === 'cache-hold').length,
    modelMismatches: responses.filter(e => e.servedModel && e.model !== e.servedModel && !e.servedModel.startsWith(e.model + '-')).length,
    models: count(inference.map(e => e.servedModel)), selectedModels: count(inference.map(e => e.model)), reasons: count(decisions.map(e => e.reason)),
    usage, usageCoverage: inference.filter(e => e.usage).length, servedModelCoverage: inference.filter(e => e.servedModel).length,
    jevLatency: { p50: pct(0.5), p95: pct(0.95) },
    efficiency: {
      cacheReadPercent: inputTotal > 0 ? usage.cacheRead / inputTotal * 100 : null, reportedInputTokens: inputTotal,
      reusedRequests, automaticRequests: autoRequests.length,
      reusePercent: autoRequests.length ? reusedRequests / autoRequests.length * 100 : null,
      responseCompletionPercent: inference.length ? inference.filter(e => e.completed).length / inference.length * 100 : null,
    },
    estimates: { pricedRequests: priced.length, totalRequests: inference.length, modelCost: priced.length ? modelCost : null,
      baselineCost: priced.length ? baselineCost : null, jevCost, netDifference: net, percent: net !== null && baselineCost > 0 ? net / baselineCost * 100 : null, blockers },
    timeline,
    methodology: 'Estimated API-equivalent price comparison on the SAME observed token usage against each request\'s configured maximum-tier model. Includes Jev cost only when configured and known. Not a rerun, invoice saving, quality benchmark, or subscription-quota measurement. Cache writes actually observed are included; counterfactual model/effort/output/cache behavior is unknown.',
  };
}
export function markdown(s) {
  return `# Jev Pilot usage report\n\n` +
    `| Metric | Value |\n| --- | ---: |\n` +
    Object.entries({ Runs: s.runs, 'Provider requests': s.requests, 'Completed responses': s.completed, 'Unfinished requests': s.unfinished,
      'Jev requests': s.jevRequests, 'Jev successes': s.jevSucceeded, 'Jev failures': s.jevFailed, 'Unfinished Jev requests': s.jevUnfinished, 'Routing decisions': s.decisions,
      'Selected model changes': s.modelChanges, 'Observed served model changes': s.servedModelChanges, 'Selected effort changes': s.effortChanges, 'Cache holds': s.cacheHolds,
      'Locally rated decisions': `${s.feedback.ratedDecisions}/${s.feedback.totalDecisions}`,
      'Feedback: right / too weak / too strong / too slow / rework': RATINGS.map(r => s.feedback.ratings[r]).join(' / '),
      'Cache-read share of reported input': s.efficiency.cacheReadPercent === null ? 'Unavailable' : s.efficiency.cacheReadPercent.toFixed(1) + '%',
      'Route reuse share of automatic requests': s.efficiency.reusePercent === null ? 'Unavailable' : s.efficiency.reusePercent.toFixed(1) + '%',
      'Token-count checks (excluded from price comparison)': s.tokenChecks,
      'Jev input tokens (reported)': s.jevInputTokens, 'Jev output tokens (reported)': s.jevOutputTokens, 'Jev usage coverage': `${s.jevUsageCoverage}/${s.jevRequests}`,
      'Provider failures': s.providerFailures, 'Usage coverage': `${s.usageCoverage}/${s.inferenceResponses}`, 'Served model coverage': `${s.servedModelCoverage}/${s.inferenceResponses}`,
      'Estimated model cost (priced subset)': money(s.estimates.modelCost), 'Estimated Jev cost': money(s.estimates.jevCost),
      'Estimated baseline (priced subset)': money(s.estimates.baselineCost), 'Estimated net difference (complete coverage required)': money(s.estimates.netDifference),
      'Estimated difference %': s.estimates.percent === null ? 'Unavailable' : s.estimates.percent.toFixed(1) + '%',
    }).map(([k, v]) => `| ${k} | ${String(v).replaceAll('|', '\\|')} |`).join('\n') +
    `\n\n## Reported tokens\n\nInput (uncached): ${s.usage.input}; cache reads: ${s.usage.cacheRead}; cache writes: ${s.usage.cacheWrite}; output: ${s.usage.output}.\n\n` +
    `## Models\n\n${s.models.map(([m, n]) => `- ${m}: ${n}`).join('\n') || 'No requests yet.'}\n\n` +
    `## Automatic model scopes\n\n${s.modelScopes.map(scope => `- ${scope.agent}: ${scope.models.join(', ')} (${scope.runs} runs)`).join('\n') || 'Scope was not recorded in these sessions.'}\n\n` +
    `## Interpretation\n\n${s.methodology}\n\nLogs contain counts and routing metadata; prompts and credentials are not recorded. Local logs are never uploaded automatically.\n`;
}
export { htmlReport, terminalReport } from './report-view.mjs';
