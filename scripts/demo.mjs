import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize, markdown, htmlReport } from '../src/report.mjs';
import { DEFAULTS, TIERS, scopedPolicy, resolveModels } from '../src/config.mjs';
import { chooseRoute } from '../src/policy.mjs';
import { routingPolicySnapshot, routeStep } from '../src/receipt.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const events = [];
let index = 0;
const emit = data => events.push({ schema: 1, ts: new Date(Date.UTC(2026, 9, 10, 12, 0, index++)).toISOString(), run: 'synthetic-demo', agent: 'codex', session: 'synthetic-session', ...data });
const codexModels = Object.fromEntries(TIERS.map(tier => [tier, { model: DEFAULTS.codex[tier], efforts: ['low','medium','high','xhigh','max'], context: 200000 }]));
const codexSnapshot = routingPolicySnapshot(DEFAULTS, codexModels);
emit({ event: 'session_start', allowedModels: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'], policySnapshot: codexSnapshot });
const models = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-astra', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6.1-sol'];
let currentRoute, streak = 0;
for (const [i, model] of models.entries()) {
  emit({ event: 'jev_request' });
  emit({ event: 'jev_result', ok: true, inputTokens: 300, outputTokens: 6, ms: 300 + i * 30, jevCost: 0.0001 });
  const tier = i === 1 ? 'frontier' : i > 1 && i < 5 ? 'fast' : 'balanced', effort = i === 1 ? 'xhigh' : 'low';
  const selected = chooseRoute({ answer: { ok: true, tier, effort, confidence: 0.87, effortConfidence: 0.81 }, current: currentRoute, policy: DEFAULTS, models: codexModels, warm: true, contextTokens: 30000, streak });
  currentRoute = selected; streak = selected.streak;
  emit({ event: 'decision', decisionId: `synthetic-choice-${i}`, recommendedTier: tier, recommendedEffort: effort, confidence: 0.87, effortConfidence: 0.81, capabilityProbability: 0.91, capabilityMargin: 0.86, model, effort: selected.effort, reason: selected.reason, modelChanged: i > 0 && models[i - 1] !== model, effortChanged: i === 1 || i === 2, policySnapshot: codexSnapshot, policyTrace: selected.trace });
  for (let j = 0; j < 2; j++) {
    const request = `synthetic-${i}-${j}`;
    emit({ event: 'request', request, decisionId: `synthetic-choice-${i}`, model, reason: j ? 'continuation' : 'jev' });
    emit({ event: 'response', request, decisionId: `synthetic-choice-${i}`, model, servedModel: model, completed: true, status: 200, ms: 1500,
      usage: { input: 1000, cacheRead: 9000, cacheWrite: i === 4 ? 2000 : 0, output: 200 },
      cost: i === 1 || i === 2 || i === 3 ? 0.04 : 0.01, baselineCost: 0.05 });
  }
}
for (let i = 0; i < 3; i++) {
  emit({ event: 'jev_request' }); emit({ event: 'jev_result', ok: false, ms: 6000, error: 'network-or-timeout', jevCost: 0 });
  const fallback = chooseRoute({ current: currentRoute, policy: DEFAULTS, models: codexModels });
  emit({ event: 'decision', decisionId: `synthetic-fallback-${i}`, model: fallback.model, effort: fallback.effort, reason: fallback.reason, modelChanged: false, effortChanged: false, policySnapshot: codexSnapshot, policyTrace: fallback.trace });
}
emit({ event: 'jev_skipped', reason: 'circuit-open' });
emit({ event: 'decision', decisionId: 'synthetic-circuit', model: currentRoute.model, effort: currentRoute.effort, reason: 'jev-circuit-open', policySnapshot: codexSnapshot, policyTrace: [routeStep('jev-circuit-open', currentRoute)], classifierState: { attempted: false, circuitState: 'open', retryAfterMs: 60000 } });
emit({ event: 'session_end' });
const claude = data => emit({ run: 'synthetic-claude', agent: 'claude', session: 'synthetic-claude-session', ...data });
const claudePolicy = scopedPolicy(DEFAULTS, 'claude', ['sonnet','haiku']), claudeModels = resolveModels(claudePolicy, 'claude');
const claudeSnapshot = routingPolicySnapshot(claudePolicy, claudeModels);
claude({ event: 'session_start', allowedModels: ['claude-haiku-5-5', 'claude-sonnet-5-5'], policySnapshot: claudeSnapshot });
for (const [i, model] of ['claude-sonnet-5-5', 'claude-haiku-5-5'].entries()) {
  claude({ event: 'jev_request' });
  claude({ event: 'jev_result', ok: true, inputTokens: 250, outputTokens: 6, ms: 290, jevCost: 0.0001 });
  const selected = chooseRoute({ answer: { ok: true, tier: i ? 'fast' : 'balanced', effort: i ? 'low' : 'medium', confidence: 0.9, effortConfidence: 0.9 }, policy: claudePolicy, models: claudeModels });
  claude({ event: 'decision', decisionId: `synthetic-claude-choice-${i}`, model, effort: selected.effort, reason: selected.reason, modelChanged: i > 0, effortChanged: i > 0, policySnapshot: claudeSnapshot, policyTrace: selected.trace });
  for (let j = 0; j < 3; j++) {
    const request = `synthetic-claude-${i}-${j}`;
    claude({ event: 'request', request, decisionId: `synthetic-claude-choice-${i}`, model, reason: j ? 'tool-continuation' : 'jev' });
    claude({ event: 'response', request, decisionId: `synthetic-claude-choice-${i}`, model, servedModel: model, completed: true, status: 200,
      usage: { input: 800, cacheRead: 4000, cacheWrite: j ? 0 : 600, output: 140 }, cost: i ? 0.006 : 0.018, baselineCost: 0.018 });
  }
}
claude({ event: 'session_end' });
emit({ event: 'feedback', sourceDecision: 'synthetic-choice-0', rating: 'right', run: 'synthetic-feedback-1' });
emit({ event: 'feedback', sourceDecision: 'synthetic-choice-4', rating: 'too-weak', run: 'synthetic-feedback-2' });
mkdirSync(resolve(root, 'examples'), { recursive: true });
const summary = summarize(events);
writeFileSync(resolve(root, 'examples/demo.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
writeFileSync(resolve(root, 'examples/demo-report.html'), htmlReport(summary, { demo: true, byAgent: { codex: summarize(events, { agent: 'codex' }), claude: summarize(events, { agent: 'claude' }) } }));
writeFileSync(resolve(root, 'examples/demo-report.md'), '> SYNTHETIC DEMO: fixture data and invented prices. Not real usage.\n\n' + markdown(summary));
console.log('Generated synthetic reports in examples/. No API calls were made.');
