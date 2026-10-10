import { readFileSync } from 'node:fs';

const asset = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const safe = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
const number = value => new Intl.NumberFormat('en-US').format(value ?? 0);
const percent = value => Number.isFinite(value) ? `${value.toFixed(1)}%` : 'Unavailable';
const dollars = value => Number.isFinite(value) ? `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(4)}` : 'Unavailable';

export function terminalReport(s, { color = false } = {}) {
  const accent = value => color ? `\u001b[1;36m${value}\u001b[0m` : value;
  const muted = value => color ? `\u001b[2m${value}\u001b[0m` : value;
  const row = (label, value) => `  ${label.padEnd(27)} ${value}`;
  return [
    '', accent('  JEV PILOT  /  USAGE REPORT'), muted('  ' + '─'.repeat(62)), '',
    row('Estimated cost difference', accent(percent(s.estimates.percent))),
    row('Net estimated difference', dollars(s.estimates.netDifference)),
    row('Cache-read share', percent(s.efficiency.cacheReadPercent)),
    row('Route reuse', `${percent(s.efficiency.reusePercent)}  (${s.efficiency.reusedRequests}/${s.efficiency.automaticRequests} automatic requests)`),
    '', muted('  ACTIVITY'),
    row('Jev calls / failures', `${number(s.jevRequests)} / ${number(s.jevFailed)}`),
    row('Skipped Jev calls', number(s.jevSkipped)),
    row('Model / effort changes', `${number(s.modelChanges)} / ${number(s.effortChanges)}`),
    row('Completed responses', `${number(s.completed)} / ${number(s.inferenceResponses)}`),
    row('Locally rated decisions', `${number(s.feedback.ratedDecisions)} / ${number(s.feedback.totalDecisions)}`),
    row('Too weak / rework', `${number(s.feedback.ratings['too-weak'])} / ${number(s.feedback.ratings.rework)}`),
    row('Reported input / output', `${number(s.efficiency.reportedInputTokens)} / ${number(s.usage.output)} tokens`),
    row('Price coverage', `${s.estimates.pricedRequests}/${s.estimates.totalRequests} responses`),
    row('Jev latency · median', s.jevLatency.p50 === null ? 'Unavailable' : `${number(s.jevLatency.p50)} ms`),
    ...(s.unfinished || s.jevUnfinished ? [row('Still awaiting a result', `${s.unfinished} provider / ${s.jevUnfinished} Jev`)] : []),
    '', muted('  AUTOMATIC MODEL SCOPES'),
    ...(s.modelScopes.length ? s.modelScopes.map(scope => `  ${safe(scope.agent)}: ${scope.models.map(safe).join(', ')}  (${number(scope.runs)} runs)`) : ['  Not recorded in these sessions.']),
    '', muted('  OBSERVED MODELS'),
    ...(s.models.length ? s.models.map(([model, n]) => `  ${safe(model)}  ${number(n)}`) : ['  No responses yet. Start a task with pilot-codex or pilot-claude.']),
    '', muted('  API-equivalent estimate; not subscription-quota or task-quality savings.'),
    ...(s.estimates.percent === null ? [muted('  Missing rates, usage or unfinished requests keep estimates unavailable.')] : []),
    muted('  Cache and reuse ratios describe observed traffic, not tokens avoided.'),
    '', `  ${accent('jev-pilot report --open')}  →  open the visual dashboard`, '',
  ].join('\n');
}

export function htmlReport(summary, { demo = false, byAgent = {} } = {}) {
  const views = { all: summary, ...Object.fromEntries(Object.entries(byAgent).filter(([key]) => ['codex', 'claude'].includes(key))) };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>Jev Pilot — Routing report</title><style>${asset('report.css')}</style></head>
<body><div class="page-shell">
<header class="topbar"><a class="brand" href="#overview" aria-label="Jev Pilot overview" data-i18n-aria-label="reportBrand"><span class="brand-icon" aria-hidden="true">jp</span><span>jev<span class="brand-light">pilot</span><small>by sunulab</small></span></a>
<nav aria-label="Report sections" data-i18n-aria-label="reportSections"><a href="#overview" data-i18n="overview">Overview</a><a href="#usage" data-i18n="modelMix">Model usage</a><a href="#activity" data-i18n="activity">Activity</a><a href="#methodology" data-i18n="methodology">Methodology</a></nav>
<div class="topbar-end"><span class="local-badge"><span></span><span data-i18n="local">Local & private</span></span><label class="sr-only" for="language" data-i18n="languageLabel">Report language</label><select id="language" class="language-button"><option value="en">English</option><option value="ko">한국어</option><option value="ja">日本語</option><option value="zh">中文</option></select></div></header>
<main id="overview">
<div class="report-header"><div class="page-heading"><div><div class="eyebrow" data-i18n="eyebrow">Model routing</div><h1 data-i18n="title">Usage report</h1><p class="intro" data-i18n="intro">Review model selections, token usage and classification activity.</p></div>
<div class="heading-actions"><label class="sr-only" for="agent" data-i18n="filterLabel">Filter by tool</label><select id="agent"><option value="all" data-i18n="allTools">All tools</option>${Object.keys(views).filter(k => k !== 'all').map(k => `<option value="${k}">${k === 'codex' ? 'Codex CLI' : 'Claude Code'}</option>`).join('')}</select><button id="download" class="button secondary"><span aria-hidden="true">↓</span> <span data-i18n="export">Export JSON</span></button></div></div>
<div class="report-meta"><span id="period">—</span><span class="meta-separator">/</span><span id="run-count">0 sessions</span><span class="snapshot" data-i18n="snapshot">Snapshot report</span></div>
<div class="scope-meta"><span data-i18n="scopeTitle">Allowed automatic models</span><strong id="model-scope">—</strong></div></div>
${demo ? '<aside class="demo-banner"><span class="demo-tag">DEMO</span><span data-i18n="demo">Synthetic data and invented prices. A preview of the interface, not real savings.</span></aside>' : ''}
<div id="empty-banner" class="empty-banner" hidden><span class="empty-symbol" aria-hidden="true">—</span><div><strong data-i18n="emptyTitle">No responses recorded</strong><p data-i18n="emptyText">Run pilot-codex or pilot-claude, then generate a new report.</p></div></div>
<div class="metric-grid">
<section class="metric-card"><div class="metric-label"><span data-i18n="cacheTitle">Cache-read share</span></div><strong id="cache-percent">—</strong><p id="cache-caption"></p><div class="mini-track"><span id="cache-progress"></span></div><small data-i18n="cacheNote">Of reported input tokens; not tokens saved.</small></section>
<section class="metric-card"><div class="metric-label"><span data-i18n="reuseTitle">Route reuse</span></div><strong id="reuse-percent">—</strong><p id="reuse-caption"></p><div class="mini-track violet-track"><span id="reuse-progress"></span></div><small data-i18n="reuseNote">Continuations reuse the current decision.</small></section>
<section class="metric-card"><div class="metric-label"><span data-i18n="changesTitle">Model changes</span></div><strong id="model-changes">0</strong><p id="change-caption"></p><div class="metric-detail"><span data-i18n="observedChanges">Observed in responses</span><b id="served-changes">0</b></div><small data-i18n="changesNote">The first selection isn't a change.</small></section>
<section class="metric-card"><div class="metric-label"><span data-i18n="jevTitle">Jev requests</span></div><strong id="jev-requests">0</strong><p id="jev-caption"></p><div class="metric-detail"><span data-i18n="medianLatency">Median classification</span><b id="jev-latency">—</b></div><small id="jev-failures"></small></section>
</div>
<div id="usage" class="detail-grid">
<section class="panel"><div class="section-top"><div><h2 data-i18n="modelMix">Model usage</h2><p data-i18n="modelMixNote">Models reported by the provider.</p></div><span class="small-tag" id="response-count">0 responses</span></div><div id="model-mix"></div></section>
<section class="panel"><div class="section-top"><div><h2 data-i18n="tokenFlow">Token usage</h2><p data-i18n="tokenFlowNote">Reported usage across inference responses.</p></div><span class="small-tag">TOKENS</span></div><strong id="token-total" class="token-total">0</strong><div id="token-bar" class="token-bar" role="img" aria-label="Token usage composition" data-i18n-aria-label="tokenFlow"></div><div id="token-legend" class="token-legend"></div><div class="token-overhead"><span data-i18n="jevTokens">Jev reported input / output</span><b id="jev-tokens">0 / 0</b></div></section>
</div>
<div class="hero-grid">
<section class="savings-card" aria-labelledby="savings-title"><div class="card-top"><span class="overline" id="savings-title" data-i18n="estimatedDifference">Estimated cost difference</span><span class="estimate-badge" data-i18n="estimateBadge">API-equivalent</span></div>
<div class="savings-headline"><strong id="savings-percent">—</strong><div><span id="savings-direction" data-i18n="awaitingData">Awaiting data</span><small data-i18n="includingJev">including Jev overhead</small></div></div>
<p id="savings-caption" class="savings-caption"></p>
<div class="cost-bars" role="group" aria-label="Estimated cost comparison" data-i18n-aria-label="estimatedDifference"><div class="cost-row"><div><span data-i18n="baseline">Maximum-tier baseline</span><strong id="baseline-cost">—</strong></div><div class="cost-track"><span id="baseline-bar" class="baseline-bar"></span></div></div>
<div class="cost-row"><div><span data-i18n="withPilot">With Jev Pilot</span><strong id="pilot-cost">—</strong></div><div class="cost-track"><span id="model-bar" class="model-bar"></span><span id="jev-bar" class="jev-bar"></span></div></div></div>
<div class="savings-footer"><span><i class="legend-dot lime"></i><span data-i18n="modelCost">Model estimate</span> <b id="model-cost">—</b></span><span><i class="legend-dot violet"></i>Jev <b id="jev-cost">—</b></span><a href="#methodology" data-i18n="howCalculated">How it's calculated ↗</a></div></section>
<section class="coverage-card" aria-labelledby="coverage-title"><div class="section-top"><h2 id="coverage-title" data-i18n="evidence">Data coverage</h2><span class="small-tag" data-i18n="observed">Observed</span></div>
<div class="coverage-visual"><div id="coverage-ring" class="coverage-ring"><div><strong id="coverage-percent">—</strong><span data-i18n="usageCoverage">usage coverage</span></div></div></div>
<div class="coverage-row"><span data-i18n="completed">Completed responses</span><b id="completed-coverage">0 / 0</b></div><div class="coverage-row"><span data-i18n="served">Reported model</span><b id="model-coverage">0 / 0</b></div><div class="coverage-row"><span data-i18n="priced">Priced responses</span><b id="price-coverage">0 / 0</b></div><p class="microcopy" data-i18n="coverageNote">Coverage describes recorded responses, not whether a coding task was correct.</p></section>
</div>
<section id="activity" class="panel activity-panel"><div class="section-top"><div><h2 data-i18n="routingActivity">Routing history</h2><p data-i18n="activityNote">Why a model changed, stayed, or fell back. No conversation content is stored here.</p></div><span class="small-tag" id="decision-count">0 decisions</span></div><div id="route-strip" class="route-strip" aria-label="Model selection sequence" data-i18n-aria-label="routingActivity"></div><div class="table-scroll"><table role="table"><thead role="rowgroup"><tr><th scope="col" data-i18n="time">Time · UTC</th><th scope="col" data-i18n="tool">Tool</th><th scope="col" data-i18n="recommendation">Jev recommendation</th><th scope="col" data-i18n="selectedModel">Selected model</th><th scope="col" data-i18n="effort">Effort</th><th scope="col" data-i18n="reason">Reason</th><th scope="col" data-i18n="feedbackTitle">Your feedback</th><th scope="col" data-i18n="change">Change</th></tr></thead><tbody id="timeline" role="rowgroup"></tbody></table></div><p id="timeline-note" class="microcopy"></p></section>
<section class="panel feedback-panel"><div class="section-top"><div><h2 data-i18n="feedbackTitle">User feedback</h2><p data-i18n="feedbackNote">Your optional feedback, not a measured task success rate. The latest rating per decision counts.</p></div><span class="small-tag" id="feedback-coverage">0 / 0</span></div><div id="feedback-counts" class="all-counters"></div><p class="microcopy" data-i18n="feedbackHelp">After reviewing the latest turn: jev-pilot feedback too-weak --agent codex. Feedback stays local and does not retrain the router.</p></section>
<section id="methodology" class="methodology"><div><div class="eyebrow" data-i18n="finePrint">Calculation notes</div><h2 data-i18n="methodTitle">Cost estimates and limitations</h2><p data-i18n="methodIntro">Task quality and subscription allowance are not measured in this report.</p></div><div><p id="estimate-status" class="estimate-status"></p><p data-i18n="methodBody">The baseline prices the same observed tokens as each request's configured maximum-tier model. Net difference subtracts the model estimate and Jev cost. It doesn't rerun the task or measure subscription quota, quality, or money refunded.</p><details><summary data-i18n="priceSetup">Set up price estimates</summary><p data-i18n="priceInstructions">Add current USD-per-million input, output and cache rates under prices in your global config, plus Jev's input rate under jevPrice. Start a new routed session after changing rates. Existing records keep their original estimates.</p><code>~/.config/jev-pilot/config.json</code><p data-i18n="priceCaution">Use official rates for your exact models. Missing data stays unavailable; negative differences stay negative.</p></details><details><summary data-i18n="allCounters">All counters & coverage</summary><div id="all-counters" class="all-counters"></div></details></div></section>
<footer><div class="footer-brand">jev<span>pilot</span><small> / sunulab</small></div><p data-i18n="footer">Local report · no external assets or analytics.</p><span class="footer-status"><i></i><span data-i18n="offline">Works offline</span></span></footer>
</main></div><noscript>This offline dashboard needs JavaScript to render its embedded aggregate data. Use jev-pilot report --markdown report.md for a text export.</noscript>
<script id="report-data" type="application/json">${json({ demo, views })}</script><script>${asset('report-client.js')}</script></body></html>`;
}
