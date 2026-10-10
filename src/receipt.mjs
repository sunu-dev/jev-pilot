import { TIERS } from './config.mjs';

// Explicit metadata only: never copy the global config, paths, credentials or prompts.
export function routingPolicySnapshot(policy, models) {
  return {
    version: 1, mode: policy.mode, sendToJev: policy.sendToJev,
    tierBounds: { min: policy.minTier, default: policy.defaultTier, max: policy.maxTier },
    maxEffort: policy.maxEffort, minConfidence: policy.minConfidence,
    models: TIERS.filter(tier => models[tier]?.allowed !== false && models[tier])
      .filter(tier => TIERS.indexOf(tier) >= TIERS.indexOf(policy.minTier) && TIERS.indexOf(tier) <= TIERS.indexOf(policy.maxTier))
      .map(tier => ({ tier, model: models[tier].model, efforts: [...models[tier].efforts], context: models[tier].context })),
    image: { minTier: policy.imageMinTier, minEffort: policy.imageMinEffort, pixelsSentToClassifier: false },
    cache: { warmTokens: policy.warmTokens, idleMinutes: policy.cacheIdleMinutes, downgradeAfter: policy.downgradeAfter },
    classifier: { requestChars: policy.requestChars, timeoutMs: 6000,
      circuitFailures: policy.jevCircuitFailures, cooldownSeconds: policy.jevCircuitCooldownSeconds, maxRequests: policy.jevMaxRequests },
  };
}

export function classifierReceipt(answer) {
  const fields = ['attempted', 'jevAttempt', 'circuitState', 'consecutiveFailures', 'retryAfterMs', 'recoveryProbe', 'recovered', 'skipped', 'error'];
  return Object.fromEntries(fields.filter(field => answer?.[field] !== undefined).map(field => [field, answer[field]]));
}

export function routeStep(rule, route, details = {}) {
  const value = route ? { tier: route.tier ?? null, model: route.model ?? null, effort: route.effort ?? null } : null;
  return { rule, before: value, after: value, details };
}
