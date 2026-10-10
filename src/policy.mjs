import { TIERS, EFFORTS } from './config.mjs';
const rank = t => TIERS.indexOf(t);
export const isConfirmation = text => /^(?:yes|yes please|ok|okay|go ahead|continue|do it|응|네|예|좋아|진행해|진행해줘|계속|해줘)[.!\s]*$/i.test(text.trim());
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
  if (current && (!allowed.includes(current.tier) || models[current.tier].model !== current.model)) current = undefined;
  const defaultTier = clamp(policy.defaultTier);
  const fallback = current ?? { tier: defaultTier, effort: 'medium', model: models[defaultTier].model };
  const visualFloor = route => {
    if (!visual) return route;
    const tier = clamp(TIERS[Math.max(rank(route.tier), rank(policy.imageMinTier ?? 'strong'))]);
    const effort = EFFORTS[Math.max(EFFORTS.indexOf(route.effort), EFFORTS.indexOf(policy.imageMinEffort ?? 'high'))];
    return { ...route, tier, model: models[tier].model, effort: supportedEffort(effort, models[tier], policy.maxEffort),
      reason: tier !== route.tier || effort !== route.effort ? 'visual-context' : route.reason };
  };
  if (!answer?.ok) return visualFloor({ ...fallback, effort: supportedEffort(fallback.effort, models[fallback.tier], policy.maxEffort), reason: 'jev-unavailable', streak: 0 });
  let tier = clamp(answer.tier), effort = answer.effort, reason = tier !== answer.tier && models[tier].model !== models[answer.tier]?.model ? 'model-limit' : 'jev', nextStreak = 0;
  if (answer.confidence < policy.minConfidence) {
    tier = fallback.tier;
    reason = 'low-confidence-hold';
  }
  if (answer.effortConfidence < policy.minConfidence) effort = current?.effort ?? 'medium';
  if (answer.sensitive || failed) {
    tier = clamp(TIERS[Math.max(rank(tier), answer.sensitive ? rank('strong') : Math.min(3, rank(fallback.tier) + 1))]);
    effort = 'high'; reason = answer.sensitive ? 'sensitive-work' : 'previous-request-failed';
  }
  // A same-model capability/effort change does not count as a model switch.
  if (!forced && current && rank(tier) < rank(current.tier) && models[tier].model !== current.model && policy.mode === 'adaptive' && warm && contextTokens > policy.warmTokens) {
    nextStreak = streak + 1;
    if (nextStreak < policy.downgradeAfter) { tier = current.tier; reason = 'cache-hold'; }
    else { reason = 'sustained-downgrade'; nextStreak = 0; }
  }
  const target = models[tier];
  effort = supportedEffort(effort, target, policy.maxEffort);
  return visualFloor({ tier, model: target.model, effort, reason, streak: nextStreak });
}
