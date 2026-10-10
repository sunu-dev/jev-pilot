import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize, markdown, htmlReport } from '../src/report.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const events = [];
let index = 0;
const emit = data => events.push({ schema: 1, ts: new Date(Date.UTC(2026, 9, 10, 12, 0, index++)).toISOString(), run: 'synthetic-demo', agent: 'codex', session: 'synthetic-session', ...data });
emit({ event: 'session_start', allowedModels: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'] });
const models = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-astra', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6.1-sol'];
for (const [i, model] of models.entries()) {
  emit({ event: 'jev_request' });
  emit({ event: 'jev_result', ok: true, inputTokens: 300, outputTokens: 6, ms: 300 + i * 30, jevCost: 0.0001 });
  emit({ event: 'decision', decisionId: `synthetic-choice-${i}`, recommendedTier: i === 1 ? 'frontier' : i > 1 && i < 5 ? 'fast' : 'balanced', recommendedEffort: i === 1 ? 'xhigh' : 'low', confidence: 0.87, effortConfidence: 0.81, capabilityProbability: 0.91, capabilityMargin: 0.86, model, effort: i === 1 ? 'high' : 'low', reason: i === 2 || i === 3 ? 'cache-hold' : i === 4 ? 'sustained-downgrade' : 'jev', modelChanged: i > 0 && models[i - 1] !== model, effortChanged: i === 1 || i === 2 });
  for (let j = 0; j < 2; j++) {
    const request = `synthetic-${i}-${j}`;
    emit({ event: 'request', request, model, reason: j ? 'continuation' : 'jev' });
    emit({ event: 'response', request, model, servedModel: model, completed: true, status: 200, ms: 1500,
      usage: { input: 1000, cacheRead: 9000, cacheWrite: i === 4 ? 2000 : 0, output: 200 },
      cost: i === 1 || i === 2 || i === 3 ? 0.04 : 0.01, baselineCost: 0.05 });
  }
}
emit({ event: 'jev_request' }); emit({ event: 'jev_result', ok: false, ms: 6000, error: 'network-or-timeout', jevCost: 0 });
emit({ event: 'decision', model: models.at(-1), effort: 'low', reason: 'jev-unavailable', modelChanged: false, effortChanged: false });
emit({ event: 'session_end' });
const claude = data => emit({ run: 'synthetic-claude', agent: 'claude', session: 'synthetic-claude-session', ...data });
claude({ event: 'session_start', allowedModels: ['claude-haiku-5-5', 'claude-sonnet-5-5'] });
for (const [i, model] of ['claude-sonnet-5-5', 'claude-haiku-5-5'].entries()) {
  claude({ event: 'jev_request' });
  claude({ event: 'jev_result', ok: true, inputTokens: 250, outputTokens: 6, ms: 290, jevCost: 0.0001 });
  claude({ event: 'decision', model, effort: i ? null : 'medium', reason: 'jev', modelChanged: i > 0, effortChanged: i > 0 });
  for (let j = 0; j < 3; j++) {
    const request = `synthetic-claude-${i}-${j}`;
    claude({ event: 'request', request, model, reason: j ? 'tool-continuation' : 'jev' });
    claude({ event: 'response', request, model, servedModel: model, completed: true, status: 200,
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
