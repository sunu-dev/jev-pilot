const money = n => Number.isFinite(n) ? `$${n.toFixed(4)}` : 'Unavailable';
const count = list => Object.entries(list.reduce((a, k) => { a[k ?? 'unknown'] = (a[k ?? 'unknown'] ?? 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function summarize(events, { agent, since, run } = {}) {
  const selected = events.filter(e => (!agent || e.agent === agent) && (!since || e.ts >= since) && (!run || e.run === run));
  const decisions = selected.filter(e => e.event === 'decision');
  const jev = selected.filter(e => e.event === 'jev_result');
  const responses = selected.filter(e => e.event === 'response');
  const inference = responses.filter(e => e.reason !== 'count-tokens');
  const requests = selected.filter(e => e.event === 'request');
  const done = new Set(responses.map(e => e.request));
  const unfinished = requests.filter(e => !done.has(e.request)).length;
  const jevRequests = selected.filter(e => e.event === 'jev_request').length;
  const jevUnfinished = Math.max(0, jevRequests - jev.length);
  const priced = inference.filter(e => Number.isFinite(e.cost) && Number.isFinite(e.baselineCost));
  const allPriced = inference.length > 0 && priced.length === inference.length && unfinished === 0;
  const jevPriced = jevUnfinished === 0 && (jev.length === 0 || jev.every(e => Number.isFinite(e.jevCost)));
  const modelCost = priced.reduce((n, e) => n + e.cost, 0);
  const baselineCost = priced.reduce((n, e) => n + e.baselineCost, 0);
  const jevCost = jevPriced ? jev.reduce((n, e) => n + e.jevCost, 0) : null;
  const net = allPriced && jevPriced ? baselineCost - modelCost - jevCost : null;
  const usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  for (const e of inference) for (const k of Object.keys(usage)) usage[k] += Number.isFinite(e.usage?.[k]) ? e.usage[k] : 0;
  const latency = jev.map(e => e.ms).filter(Number.isFinite).sort((a, b) => a - b);
  const pct = p => latency.length ? latency[Math.min(latency.length - 1, Math.ceil(latency.length * p) - 1)] : null;
  const timeline = decisions.map(e => ({ ts: e.ts, agent: e.agent, model: e.model, effort: e.effort, reason: e.reason, changed: e.modelChanged, shadow: e.shadow, proposedModel: e.proposedModel, proposedEffort: e.proposedEffort }));
  let servedModelChanges = 0; const previousServed = new Map();
  for (const e of inference) if (e.servedModel) {
    const id = `${e.run}/${e.session}`;
    if (previousServed.has(id) && previousServed.get(id) !== e.servedModel) servedModelChanges++;
    previousServed.set(id, e.servedModel);
  }
  return {
    schema: 1, runs: new Set(selected.map(e => e.run)).size, requests: requests.length, responses: responses.length,
    unfinished, jevUnfinished,
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
    models: count(inference.map(e => e.servedModel ?? e.model)), reasons: count(decisions.map(e => e.reason)),
    usage, usageCoverage: inference.filter(e => e.usage).length, servedModelCoverage: inference.filter(e => e.servedModel).length,
    jevLatency: { p50: pct(0.5), p95: pct(0.95) },
    estimates: { pricedRequests: priced.length, totalRequests: inference.length, modelCost: priced.length ? modelCost : null,
      baselineCost: priced.length ? baselineCost : null, jevCost, netDifference: net, percent: net !== null && baselineCost > 0 ? net / baselineCost * 100 : null },
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
      'Token-count checks (excluded from price comparison)': s.tokenChecks,
      'Jev input tokens (reported)': s.jevInputTokens, 'Jev output tokens (reported)': s.jevOutputTokens, 'Jev usage coverage': `${s.jevUsageCoverage}/${s.jevRequests}`,
      'Provider failures': s.providerFailures, 'Usage coverage': `${s.usageCoverage}/${s.inferenceResponses}`, 'Served model coverage': `${s.servedModelCoverage}/${s.inferenceResponses}`,
      'Estimated model cost (priced subset)': money(s.estimates.modelCost), 'Estimated Jev cost': money(s.estimates.jevCost),
      'Estimated baseline (priced subset)': money(s.estimates.baselineCost), 'Estimated net difference (complete coverage required)': money(s.estimates.netDifference),
      'Estimated difference %': s.estimates.percent === null ? 'Unavailable' : s.estimates.percent.toFixed(1) + '%',
    }).map(([k, v]) => `| ${k} | ${String(v).replaceAll('|', '\\|')} |`).join('\n') +
    `\n\n## Reported tokens\n\nInput (uncached): ${s.usage.input}; cache reads: ${s.usage.cacheRead}; cache writes: ${s.usage.cacheWrite}; output: ${s.usage.output}.\n\n` +
    `## Models\n\n${s.models.map(([m, n]) => `- ${m}: ${n}`).join('\n') || 'No requests yet.'}\n\n` +
    `## Interpretation\n\n${s.methodology}\n\nLogs contain counts and routing metadata; prompts and credentials are not recorded. Local logs are never uploaded automatically.\n`;
}
export function htmlReport(summary, { demo = false } = {}) {
  const data = JSON.stringify(summary).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jev Pilot report</title>
<style>body{margin:0;background:#101820;color:#edf4f5;font:16px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:36px 24px}header{display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{color:#65dfb1;font-weight:700;letter-spacing:.1em}h1{font-size:clamp(28px,5vw,44px);margin:.3em 0}p{color:#aebdc7}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:14px}.card,section{background:#192630;border:1px solid #30404b;border-radius:14px;padding:20px;margin:16px 0}.card strong{display:block;font-size:30px;color:#65dfb1}.label{color:#aebdc7;font-size:14px}.note{background:#293426;border:1px solid #647e40;padding:16px;border-radius:12px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #30404b}.scroll{overflow:auto}select,button{background:#203742;color:#edf4f5;border:1px solid #69808c;border-radius:8px;padding:8px 12px}.bar{height:9px;background:#65dfb1;border-radius:8px;min-width:2px}footer{font-size:13px;color:#aebdc7}h2{font-size:20px}.pill{border:1px solid #65dfb1;padding:4px 10px;border-radius:999px;color:#65dfb1}a{color:#65dfb1}</style>
<main><header><div class="brand">JEV PILOT / sunulab</div><span class="pill">${demo ? 'SYNTHETIC DEMO' : 'LOCAL REPORT'}</span></header><h1>See what your router actually did.</h1><p>Jev calls, model changes, cache usage and honest estimates.</p>
${demo ? '<p class="note">All numbers on this page are generated fixtures with invented example prices. They are not user results or a savings claim.</p>' : ''}
<div class="cards">${[['Jev requests', summary.jevRequests], ['Model changes', summary.modelChanges], ['Effort changes', summary.effortChanges], ['Provider requests', summary.requests], ['Jev failures', summary.jevFailed], ['Cache holds', summary.cacheHolds]].map(([k, v]) => `<div class="card"><span class="label">${k}</span><strong>${v}</strong></div>`).join('')}</div>
<section><h2>Estimated API-equivalent difference</h2><div class="cards">${[['Model cost · priced subset', money(summary.estimates.modelCost)], ['Jev cost', money(summary.estimates.jevCost)], ['Baseline · priced subset', money(summary.estimates.baselineCost)], ['Net difference', money(summary.estimates.netDifference)]].map(([k, v]) => `<div><span class="label">${k}</span><strong style="display:block;font-size:26px">${v}</strong></div>`).join('')}</div><p class="note">${esc(summary.methodology)}</p><p>Price coverage ${summary.estimates.pricedRequests}/${summary.estimates.totalRequests} requests. Missing rates or Jev usage keep net difference unavailable. Negative differences remain visible.</p></section>
<section><h2>Models observed</h2>${summary.models.map(([m, n]) => `<p>${esc(m)} <b>${n}</b><span class="bar" style="display:block;width:${Math.round(n / Math.max(1, summary.responses) * 100)}%"></span></p>`).join('') || '<p>No responses recorded.</p>'}</section>
<section><h2>Reported usage and verification</h2><p>Uncached input: <b>${summary.usage.input}</b> · Cache read: <b>${summary.usage.cacheRead}</b> · Cache write: <b>${summary.usage.cacheWrite}</b> · Output: <b>${summary.usage.output}</b></p><p>Jev input ${summary.jevInputTokens} / output ${summary.jevOutputTokens} · Jev usage coverage ${summary.jevUsageCoverage}/${summary.jevRequests} · Jev unfinished ${summary.jevUnfinished}</p><p>Usage ${summary.usageCoverage}/${summary.inferenceResponses} · Served model ${summary.servedModelCoverage}/${summary.inferenceResponses} · Completed ${summary.completed} · Unfinished ${summary.unfinished} · Provider failures ${summary.providerFailures} · Model mismatches ${summary.modelMismatches}</p><p>Observed served-model changes ${summary.servedModelChanges} · Token-count checks ${summary.tokenChecks} (excluded from token totals and price comparison)</p><p>Jev latency p50 ${summary.jevLatency.p50 ?? '—'} ms / p95 ${summary.jevLatency.p95 ?? '—'} ms</p></section>
<section><h2>Decision timeline</h2><label for="agent">Filter by agent </label><select id="agent"><option value="">All agents</option><option>codex</option><option>claude</option></select> <button id="download">Export summary JSON</button><div class="scroll"><table><thead><tr><th>Time</th><th>Agent</th><th>Selected model</th><th>Effort</th><th>Reason</th><th>Changed</th></tr></thead><tbody id="timeline"></tbody></table></div></section>
<footer>Jev Pilot · independent experimental project by sunulab. No prompts, keys or provider credentials in this report. It is a standalone local file; no external assets or analytics. Timeline filters do not change aggregate totals.</footer></main>
<script type="application/json" id="report-data">${data}</script><script>
const report=JSON.parse(document.getElementById('report-data').textContent);const tbody=document.getElementById('timeline');
function render(){tbody.replaceChildren();for(const e of report.timeline.filter(e=>!document.getElementById('agent').value||e.agent===document.getElementById('agent').value)){const tr=document.createElement('tr');for(const value of [e.ts,e.agent,e.model,e.effort??'default',e.shadow?'shadow → '+e.proposedModel+' / '+e.proposedEffort:e.reason,e.changed?'yes':'—']){const td=document.createElement('td');td.textContent=value;tr.append(td);}tbody.append(tr);}}
document.getElementById('agent').addEventListener('change',render);document.getElementById('download').addEventListener('click',()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='jev-pilot-summary.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);});render();</script></html>`;
}
