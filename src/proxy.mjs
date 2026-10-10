import http from 'node:http';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { humanTurns, items } from '../vendor/dirien/messages.mjs';
import { findSecrets } from '../vendor/dirien/secrets.mjs';
import { UsageTap, costOf } from '../vendor/dirien/usage.mjs';
import { classify, createClassifierGuard, decisionState } from './jev.mjs';
import { chooseRoute, isConfirmation } from './policy.mjs';
import { TIERS, scopedPolicy } from './config.mjs';
import { trailingOverride } from './override.mjs';
import { routingPolicySnapshot, classifierReceipt, routeStep } from './receipt.mjs';
import { safeRequestId, requestCorrelation, transportDiagnostics } from './diagnostics.mjs';

export const AUTO = 'jev-pilot';
const HEADER = 'x-jev-pilot-token';
const MAX_BODY = 32 * 1024 * 1024;
const HOP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding', HEADER]);
const safeModel = value => typeof value === 'string' && /^[a-zA-Z0-9._-]{1,120}$/.test(value) ? value : null;
export function rewriteBody(body, route, agent) {
  const copy = structuredClone(body);
  copy.model = route.model;
  if (agent === 'codex') {
    if (route.effort) copy.reasoning = { ...copy.reasoning, effort: route.effort };
  } else if (route.model.includes('haiku')) {
    delete copy.thinking;
    if (copy.output_config) { delete copy.output_config.effort; if (!Object.keys(copy.output_config).length) delete copy.output_config; }
    if (copy.context_management?.edits) copy.context_management.edits = copy.context_management.edits.filter(e => !e.type?.startsWith('clear_thinking'));
  } else if (route.effort) copy.output_config = { ...copy.output_config, effort: route.effort };
  return copy;
}
function normalizeSchema(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(normalizeSchema); return; }
  for (const k of ['Minimum', 'Maximum']) if (typeof value[`exclusive${k}`] === 'boolean') {
    if (value[`exclusive${k}`] && typeof value[k.toLowerCase()] === 'number') { value[`exclusive${k}`] = value[k.toLowerCase()]; delete value[k.toLowerCase()]; }
    else delete value[`exclusive${k}`];
  }
  Object.values(value).forEach(normalizeSchema);
}
export function createProxy({ agent, policy, models, catalog = [], key, log = () => {}, fetchImpl = fetch, decideImpl = classify, prices = {}, jevPrice, notice = () => {}, now = Date.now }) {
  const token = randomBytes(24).toString('hex'), salt = randomBytes(32), sessions = new Map();
  const decide = createClassifierGuard({ policy, classifyImpl: decideImpl, now });
  const policySnapshot = routingPolicySnapshot(policy, models);
  const hash = data => createHmac('sha256', salt).update(JSON.stringify(data)).digest('hex').slice(0, 24);
  let active = 0;
  function error(res, status) { if (!res.headersSent) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'jev_pilot_error', message: `Local routing request failed (${status})` } })); } else res.destroy(); }
  async function routeRequest(body, req, signal) {
    const turns = humanTurns(body), latest = turns.at(-1);
    let userId;
    try { userId = JSON.parse(body.metadata?.user_id ?? '').session_id; }
    catch { userId = typeof body.metadata?.user_id === 'string' ? body.metadata.user_id.match(/session_([\w-]+)/)?.[1] : undefined; }
    const session = hash(body.client_metadata?.thread_id ?? req.headers['thread-id'] ?? req.headers['session-id'] ?? req.headers['session_id'] ?? req.headers['x-claude-code-session-id'] ?? req.headers['x-session-id'] ?? userId ?? body.prompt_cache_key ?? [turns[0]?.text, body.system]);
    let state = sessions.get(session);
    if (!state) {
      if (sessions.size >= 1000) { for (const [id, old] of sessions) if (!old.flight) { sessions.delete(id); break; } }
      state = { streak: 0, generation: 0, requestSequence: 0, turns: new Map() }; sessions.set(session, state);
    }
    const fallback = () => state.route ?? chooseRoute({ policy, models, visual: latest?.images > 0 });
    const snapshot = (route, rewrite = true, generation = state.generation) => ({ session, route: { ...route }, state, rewrite, generation, sequence: ++state.requestSequence });
    const kind = req.headers['x-claude-code-request-class'] ?? req.headers['x-anthropic-request-kind'];
    if (body.model !== AUTO) return snapshot({ model: body.model, effort: body.reasoning?.effort ?? body.output_config?.effort ?? null, reason: 'manual' }, false);
    if (kind && !['main', 'user'].includes(kind)) return snapshot({ ...fallback(), reason: 'auxiliary' });
    const tail = items(body).slice((latest?.index ?? -1) + 1);
    const hasToolTail = tail.some(i => ['function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output'].includes(i?.type) || (Array.isArray(i?.content) && i.content.some(c => ['tool_use', 'tool_result'].includes(c?.type))));
    const content = latest ? items(body)[latest.index]?.content : undefined;
    // Only private, process-salted digests stay in memory. No image or prompt is logged.
    const imageFingerprint = hash(Array.isArray(content) ? content.filter(part => ['image', 'input_image'].includes(part?.type)) : []);
    const turn = latest ? hash([turns.map(value => [value.text, value.images]), imageFingerprint]) : null;
    if (!latest || hasToolTail) {
      while (state.flight) await state.flight;
      const prior = state.turns.get(turn);
      if (prior) return snapshot({ ...prior.route, reason: 'tool-continuation' }, true, prior.generation);
      // A restored/evicted turn has no trustworthy decision link. Do not attach it
      // to a newer human turn or let its response update that turn's cache state.
      const route = { ...fallback(), reason: latest ? 'tool-continuation-unmatched' : 'tool-or-auxiliary' };
      delete route.decisionId;
      return snapshot(route, true, -1);
    }
    // Recheck after every wait: several different turns can share the first in-flight decision.
    while (state.flight) await state.flight;
    const prior = state.turns.get(turn);
    if (prior) return snapshot({ ...prior.route, reason: 'continuation' }, true, prior.generation);
    if (state.lastTurns !== undefined && turns.length < state.lastTurns) { state.contextTokens = 0; state.lastDone = 0; state.streak = 0; }
    state.lastTurns = turns.length;
    state.turn = turn;
    const generation = ++state.generation;
    const run = async () => {
      let proposed, recommendation, classifierState;
      const decisionId = randomUUID();
      const explicit = trailingOverride(latest.text);
      if (explicit) {
        try {
          const requested = scopedPolicy(policy, agent, [explicit.model]);
          const tier = requested.defaultTier;
          proposed = chooseRoute({ policy, models, forced: true, answer: { ok: true, tier, effort: explicit.effort ?? 'medium', confidence: 1, effortConfidence: 1 } });
          const limited = proposed.model !== requested[agent][tier] || (explicit.effort && proposed.effort !== explicit.effort);
          proposed.reason = limited ? 'user-override-limited' : 'user-override';
          proposed.trace.push(routeStep(proposed.reason, proposed));
          if (limited) notice('[Jev Pilot] Requested model/effort was limited by the allowed models, effort ceiling or model capability.');
        } catch { proposed = { ...fallback(), reason: 'user-override-unavailable', streak: 0 }; proposed.trace = [routeStep(proposed.reason, proposed)]; notice('[Jev Pilot] Requested model is not configured for this tool; keeping the default/current route.'); }
      }
      else if (isConfirmation(latest.text) && state.route) {
        proposed = { ...state.route, reason: 'confirmation-hold', streak: 0, trace: [routeStep('confirmation-hold', state.route)] };
      }
      else if (findSecrets(latest.text).length) {
        proposed = { ...chooseRoute({ current: state.route, policy, models, visual: latest.images > 0 }), reason: 'secret-not-sent', streak: 0 };
        proposed.trace.unshift(routeStep('secret-not-sent', null));
      }
      else if (!policy.sendToJev || !key) {
        proposed = { ...chooseRoute({ current: state.route, policy, models, visual: latest.images > 0 }), reason: !policy.sendToJev ? 'jev-disabled' : 'no-jev-key', streak: 0 };
        proposed.trace.unshift(routeStep(proposed.reason, null));
      }
      else {
        let jevTokens;
        const answer = await decide({ key, state: decisionState(body, turns, policy.requestChars), fetchImpl, signal,
          onEvent: e => {
            if (e.event === 'jev_result') {
              jevTokens = e.inputTokens;
              const estimate = Number.isFinite(jevPrice) && Number.isFinite(jevTokens) ? jevTokens * jevPrice / 1e6 : null;
              log({ ...e, session, decisionId, jevCost: estimate });
            } else log({ ...e, session, decisionId });
          } });
        classifierState = classifierReceipt(answer);
        if (answer?.skipped) log({ event: 'jev_skipped', session, decisionId, reason: answer.skipped, classifierState });
        if (answer?.ok) recommendation = { recommendedTier: answer.tier, recommendedEffort: answer.effort,
          confidence: answer.confidence, effortConfidence: answer.effortConfidence, sensitive: answer.sensitive, riskConfidence: answer.riskConfidence,
          capabilityProbability: answer.capabilityProbability, capabilityMargin: answer.capabilityMargin,
          effortProbability: answer.effortProbability, effortMargin: answer.effortMargin, rubricVersion: answer.rubricVersion };
        proposed = chooseRoute({ answer, current: state.route, policy, models, streak: state.streak, failed: state.failed,
          visual: latest.images > 0,
          contextTokens: state.contextTokens ?? 0, warm: now() - (state.lastDone ?? 0) < policy.cacheIdleMinutes * 60000 });
        if (answer?.skipped) {
          proposed.reason = `jev-${answer.skipped}`;
          proposed.trace.unshift(routeStep(proposed.reason, null, classifierState));
        }
      }
      state.streak = proposed.streak ?? 0;
      const selected = policy.mode === 'shadow' ? { ...fallback(), reason: 'shadow' } : { ...proposed };
      selected.decisionId = decisionId;
      const policyTrace = policy.mode === 'shadow'
        ? [...proposed.trace, { rule: 'shadow', before: routeStep('before', proposed).after, after: routeStep('after', selected).after, details: {} }]
        : proposed.trace;
      const previous = state.route;
      state.route = selected;
      state.turns.set(turn, { generation, route: { tier: selected.tier, model: selected.model, effort: selected.effort, reason: selected.reason, decisionId } });
      if (state.turns.size > 64) state.turns.delete(state.turns.keys().next().value);
      state.failed = false;
      log({ event: 'decision', decisionId, session, tier: selected.tier, model: safeModel(selected.model), effort: selected.effort, reason: selected.reason,
        fromModel: safeModel(previous?.model), fromEffort: previous?.effort ?? null,
        modelChanged: Boolean(previous && previous.model !== selected.model), effortChanged: Boolean(previous && previous.effort !== selected.effort),
        shadow: policy.mode === 'shadow', proposedModel: safeModel(proposed.model), proposedEffort: proposed.effort,
        policySnapshot, policyTrace, classifierState, ...recommendation });
      notice(`[Jev Pilot] ${selected.model} · ${selected.effort ?? 'default'} (${selected.reason})`);
      return selected;
    };
    const flight = run(); state.flight = flight;
    let selected;
    try { selected = await flight; } finally { if (state.flight === flight) state.flight = null; }
    return snapshot(selected, true, generation);
  }
  async function handle(req, res) {
    const address = server.address();
    if (!['127.0.0.1', 'localhost'].some(h => req.headers.host === `${h}:${address.port}`) || req.headers.origin) return error(res, 403);
    if (req.headers[HEADER] !== token) return error(res, 401);
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/healthz') { res.writeHead(200); res.end(JSON.stringify({ ok: true, active })); return; }
    if (agent === 'codex' && req.method === 'GET' && ['/models', '/v1/models'].includes(path)) {
      const base = catalog.find(m => m.slug === models[policy.defaultTier].model) ?? catalog[0];
      const sentinel = { ...base, slug: AUTO, display_name: 'Jev Pilot (automatic)', visibility: 'list', supported_in_api: true };
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ models: [sentinel, ...catalog] })); return;
    }
    if (agent === 'claude' && ['HEAD', 'GET'].includes(req.method) && path === '/') { res.writeHead(200); res.end(); return; }
    const allowed = agent === 'codex' ? ['/v1/responses', '/responses'] : ['/v1/messages', '/v1/messages/count_tokens'];
    if (req.method !== 'POST' || !allowed.includes(path)) return error(res, 404);
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) return error(res, 413); chunks.push(chunk); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks)); if (!body || typeof body !== 'object' || !safeModel(body.model)) throw new Error(); } catch { return error(res, 400); }
    const request = randomUUID(), started = performance.now();
    const correlation = requestCorrelation(body, req.headers, hash);
    const { route, session, state, rewrite, generation, sequence } = path.endsWith('count_tokens')
      ? { route: { model: body.model === AUTO ? models[policy.defaultTier].model : body.model, reason: 'count-tokens' }, session: hash('count-tokens'), state: {}, rewrite: body.model === AUTO }
      : await routeRequest(body, req, controller.signal);
    const main = !['count-tokens', 'auxiliary', 'manual', 'tool-or-auxiliary', 'tool-continuation-unmatched'].includes(route.reason);
    if (main && generation === state.generation) state.latestMainSequence = sequence;
    body = rewrite ? rewriteBody(body, route, agent) : body;
    if (agent === 'claude') body.tools?.forEach(t => normalizeSchema(t.input_schema));
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k, v]) => !HOP.has(k) && typeof v === 'string'));
    const url = agent === 'codex' ? 'https://chatgpt.com/backend-api/codex/responses' : `https://api.anthropic.com${path}`;
    log({ event: 'request', request, session, decisionId: route.decisionId, model: safeModel(route.model), effort: route.effort ?? null, reason: route.reason, ...correlation });
    let tap, status = 502, broken = false, canceled = false, transport = {}, upstreamRequestId = null, firstByteMs = null, providerFirstByteMs = null;
    try {
      const providerStarted = performance.now();
      const upstream = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: controller.signal });
      status = upstream.status;
      upstreamRequestId = ['x-request-id', 'request-id', 'openai-request-id'].map(name => safeRequestId(upstream.headers.get(name))).find(Boolean) ?? null;
      const responseHeaders = Object.fromEntries([...upstream.headers].filter(([k]) => !HOP.has(k) && !['content-encoding', 'set-cookie'].includes(k)));
      // Some subscription streams omit Content-Type. The request explicitly declares SSE.
      responseHeaders['content-type'] ??= body.stream ? 'text/event-stream' : 'application/json';
      res.writeHead(status, responseHeaders);
      tap = new UsageTap(responseHeaders['content-type']);
      if (upstream.body) for await (const chunk of upstream.body) {
        if (chunk.length && firstByteMs === null) { firstByteMs = Math.round(performance.now() - started); providerFirstByteMs = Math.round(performance.now() - providerStarted); }
        tap.push(chunk);
        if (!res.write(chunk)) await new Promise((resolve, reject) => {
          const cleanup = () => { res.off('drain', drain); res.off('close', close); };
          const drain = () => { cleanup(); resolve(); };
          const close = () => { cleanup(); reject(new Error('closed')); };
          res.once('drain', drain); res.once('close', close);
        });
      }
      res.end();
    } catch (err) { broken = true; canceled = controller.signal.aborted; transport = transportDiagnostics(err); error(res, status >= 400 ? status : 502); }
    finally {
      const usage = tap?.result();
      // CLIs can close immediately after the terminal event instead of waiting for EOF.
      const completed = status >= 200 && status < 300 && Boolean(tap?.completed) && !tap?.failure;
      const failed = !completed;
      const streamEnd = completed ? 'completed' : status >= 400 ? (broken && !tap ? (canceled ? 'client-aborted' : 'transport-error') : 'http-error')
        : tap?.failure ? (tap.failure.upstreamEvent === 'response.incomplete' ? 'provider-incomplete' : 'provider-error')
        : broken ? (canceled ? 'client-aborted' : 'transport-error') : 'eof';
      // Only the latest started main request of this human turn may change routing state.
      // Responses still get logged when an older turn, duplicate or side call finishes late.
      if (main && generation === state.generation && sequence === state.latestMainSequence) {
        if (usage && completed) { state.contextTokens = usage.input + usage.cacheRead + usage.cacheWrite; state.lastDone = now(); }
        state.failed = failed;
      }
      log({ event: 'response', request, session, decisionId: route.decisionId, status, model: safeModel(route.model), servedModel: safeModel(tap?.model), effort: route.effort ?? null,
        completed, reason: route.reason, ms: Math.round(performance.now() - started), error: failed ? (streamEnd === 'provider-error' ? 'provider-stream-error' : streamEnd === 'provider-incomplete' ? 'provider-incomplete' : streamEnd === 'client-aborted' ? 'client-aborted' : broken ? 'stream-or-network' : status >= 400 ? 'provider-http' : 'incomplete-response') : null,
        firstByteMs, providerFirstByteMs, streamEnd, ...transport, ...tap?.failure, upstreamRequestId: upstreamRequestId ?? tap?.failure?.upstreamRequestId ?? null, ...correlation,
        usage: usage ?? null, cost: costOf(tap?.model, usage, prices) ?? null,
        baselineCost: costOf(models[policy.maxTier].model, usage, prices) ?? null });
    }
  }
  const server = http.createServer((req, res) => {
    active++;
    handle(req, res).catch(() => error(res, 500)).finally(() => active--);
  });
  return { server, token, sessions, async listen() { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
