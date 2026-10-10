import { TIERS, EFFORTS } from './config.mjs';
const rank = t => TIERS.indexOf(t);
export const isConfirmation = text => /^(?:yes|yes please|ok|okay|go ahead|continue|do it|응|네|예|좋아|진행해|진행해줘|계속|해줘|はい|うん|ええ|了解|了解です|承知しました|お願いします|続けて|続けてください|進めて|進めてください|是的|好|好的|可以|继续|继续吧|请继续|没问题)[.!！。\s]*$/i.test(text.trim());
function supportedEffort(effort, target, ceiling) {
  const wanted = Math.min(EFFORTS.indexOf(ceiling), Math.max(0, EFFORTS.indexOf(effort)));
  const supported = EFFORTS.filter(e => target.efforts.includes(e));
  const selected = supported.filter(e => EFFORTS.indexOf(e) <= wanted).at(-1) ?? supported[0] ?? null;
  if (selected && EFFORTS.indexOf(selected) > EFFORTS.indexOf(ceiling)) throw new Error('Configured effort ceiling is unsupported by this model');
  return selected;
}
export function chooseRoute({ answer, current, policy, models, contextTokens = 0, warm = false, streak = 0, failed = false, visual = false, forced = false }) {
  const allowed = TIERS.filter(t => rank(t) >= rank(policy.minTier) && rank(t) <= rank(policy.maxTier) && models[t]?.allowed !== false);
  if (!allowed.length) throw new Error('No models are available in the configured scope');
  const clamp = t => allowed.find(a => rank(a) >= rank(t)) ?? allowed.at(-1);
  const trace = [];
  const position = (tier, effort) => ({ tier, model: models[tier]?.model ?? null, effort });
  const snapshot = route => route ? {
    tier: TIERS.includes(route.tier) ? route.tier : null,
    model: typeof route.model === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(route.model) ? route.model : null,
    effort: EFFORTS.includes(route.effort) ? route.effort : null,
  } : null;
  const step = (rule, before, after, details = {}) => trace.push({ rule, before: snapshot(before), after: snapshot(after), details });
  const number = value => Number.isFinite(value) ? value : null;
  const scopeStep = (beforeTier, afterTier, effort, stage) => {
    if (beforeTier === afterTier) return;
    const rule = rank(beforeTier) < rank(policy.minTier) ? 'tier-minimum' : rank(beforeTier) > rank(policy.maxTier) ? 'tier-maximum' : 'model-scope';
    step(rule, position(beforeTier, effort), position(afterTier, effort), { stage, minTier: policy.minTier, maxTier: policy.maxTier, allowedTiers: [...allowed] });
  };
  const routedEffort = (effort, tier, stage) => {
    const selected = supportedEffort(effort, models[tier], policy.maxEffort);
    let intermediate = effort;
    if (EFFORTS.indexOf(effort) > EFFORTS.indexOf(policy.maxEffort)) {
      intermediate = policy.maxEffort;
      step('effort-ceiling', position(tier, effort), position(tier, intermediate), { stage, maxEffort: policy.maxEffort });
    }
    if (selected !== intermediate) step('model-effort-support', position(tier, intermediate), position(tier, selected), {
      stage, supportedEfforts: EFFORTS.filter(e => models[tier].efforts.includes(e)),
    });
    return selected;
  };
  const finish = route => {
    step('result', trace.at(-1)?.after ?? null, route, { reason: route.reason });
    return { ...route, trace };
  };
  const previousRejected = Boolean(current && (!allowed.includes(current.tier) || models[current.tier].model !== current.model));
  if (current && (!allowed.includes(current.tier) || models[current.tier].model !== current.model)) current = undefined;
  const defaultTier = clamp(policy.defaultTier);
  const fallback = current ?? { tier: defaultTier, effort: 'medium', model: models[defaultTier].model };
  const visualFloor = route => {
    if (!visual) return route;
    const requestedTier = TIERS[Math.max(rank(route.tier), rank(policy.imageMinTier ?? 'strong'))];
    const tier = clamp(requestedTier);
    const effort = EFFORTS[Math.max(EFFORTS.indexOf(route.effort), EFFORTS.indexOf(policy.imageMinEffort ?? 'high'))];
    step('visual-floor', route, position(requestedTier, effort), { minTier: policy.imageMinTier ?? 'strong', minEffort: policy.imageMinEffort ?? 'high' });
    scopeStep(requestedTier, tier, effort, 'visual');
    return { ...route, tier, model: models[tier].model, effort: routedEffort(effort, tier, 'visual'),
      reason: tier !== route.tier || effort !== route.effort ? 'visual-context' : route.reason };
  };
  if (!answer?.ok) {
    step(current ? 'fallback-current' : 'fallback-default', null, current ?? position(policy.defaultTier, 'medium'), { previousRouteRejected: previousRejected });
    if (!current) scopeStep(policy.defaultTier, defaultTier, 'medium', 'fallback');
    return finish(visualFloor({ ...fallback, effort: routedEffort(fallback.effort, fallback.tier, 'fallback'), reason: 'jev-unavailable', streak: 0 }));
  }
  let tier = clamp(answer.tier), effort = answer.effort, reason = tier !== answer.tier && models[tier].model !== models[answer.tier]?.model ? 'model-limit' : 'jev', nextStreak = 0;
  step(forced ? 'explicit-choice' : 'jev-recommendation', null, position(answer.tier, effort), { confidence: number(answer.confidence), effortConfidence: number(answer.effortConfidence) });
  scopeStep(answer.tier, tier, effort, 'recommendation');
  if (answer.confidence < policy.minConfidence) {
    const before = position(tier, effort);
    tier = fallback.tier;
    reason = 'low-confidence-hold';
    step('capability-confidence-hold', before, position(tier, effort), { confidence: number(answer.confidence), minConfidence: policy.minConfidence, source: current ? 'current' : 'default' });
  }
  if (answer.effortConfidence < policy.minConfidence) {
    const before = position(tier, effort);
    effort = current?.effort ?? 'medium';
    step('effort-confidence-hold', before, position(tier, effort), { confidence: number(answer.effortConfidence), minConfidence: policy.minConfidence, source: current?.effort ? 'current' : 'default' });
  }
  if (answer.sensitive || failed) {
    const before = position(tier, effort);
    const minimumTier = answer.sensitive ? 'strong' : TIERS[Math.min(3, rank(fallback.tier) + 1)];
    const requestedTier = TIERS[Math.max(rank(tier), rank(minimumTier))];
    tier = clamp(requestedTier);
    effort = EFFORTS[Math.max(EFFORTS.indexOf(effort), EFFORTS.indexOf('high'))]; reason = answer.sensitive ? 'sensitive-work' : 'previous-request-failed';
    step(answer.sensitive ? 'sensitive-work-floor' : 'previous-failure-floor', before, position(requestedTier, effort), { minTier: minimumTier, minEffort: 'high' });
    scopeStep(requestedTier, tier, effort, 'guard');
  }
  // A same-model capability/effort change does not count as a model switch.
  if (current && rank(tier) < rank(current.tier) && models[tier].model !== current.model && policy.mode === 'adaptive' && warm && contextTokens > policy.warmTokens) {
    const before = position(tier, effort);
    const details = { contextTokens: number(contextTokens), warmTokens: policy.warmTokens, consecutiveDowngrades: streak + 1, downgradeAfter: policy.downgradeAfter };
    if (forced) step('cache-bypass', before, before, { ...details, source: 'explicit-choice' });
    else {
      nextStreak = streak + 1;
      if (nextStreak < policy.downgradeAfter) { tier = current.tier; reason = 'cache-hold'; }
      else { reason = 'sustained-downgrade'; nextStreak = 0; }
      step(reason, before, position(tier, effort), details);
    }
  }
  const target = models[tier];
  effort = routedEffort(effort, tier, 'selected-model');
  return finish(visualFloor({ tier, model: target.model, effort, reason, streak: nextStreak }));
}
