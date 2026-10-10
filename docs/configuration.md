# Configuration

Global settings: `~/.config/jev-pilot/config.json`. Set `JEV_PILOT_CONFIG_HOME` to relocate this directory. The TypeSafe key comes from `TYPESAFE_API_KEY`, then `JEV_API_KEY`, then the raw file named by global `keyFile`. No project file can choose a key, log directory or upstream host.

Project settings: nearest `.jev-pilot.json`, walking up from the working directory and stopping at a Git root. Codex `-C`/`--cd` is respected. Project fields override global `policy` fields. An existing `.jev-router.json` from another router is not imported.

| Field | Default | Effect |
| --- | --- | --- |
| enabled | true | false runs the original CLI directly |
| sendToJev | true | false uses the proxy and default/current model without classification |
| mode | adaptive | adaptive, turn (no cache hold), or shadow |
| minTier / defaultTier / maxTier | fast / balanced / frontier | capability bounds |
| maxEffort | high | maximum automatic reasoning effort |
| minConfidence | 0.6 | uncertain decisions hold current capability |
| downgradeAfter | 3 | confident downgrade decisions needed in a warm large conversation |
| warmTokens | 20000 | context threshold for the cache hold heuristic |
| cacheIdleMinutes | 5 | cache becomes cold after this idle time; heuristic, not a provider TTL guarantee |
| requestChars | 2000 | latest text limit sent to TypeSafe (100–4000) |
| codex / claude | see below | mapping of capability tiers to model IDs |

These are starting heuristics, not a trained or independently validated policy. Capability bounds remain authoritative even when a task is sensitive; an economy ceiling can reduce quality.

```json
{
  "enabled": true,
  "mode": "adaptive",
  "maxEffort": "high",
  "codex": {
    "fast": "gpt-6-luna",
    "balanced": "gpt-6.1-sol",
    "strong": "gpt-6.1-sol",
    "frontier": "gpt-6-astra"
  },
  "claude": {
    "fast": "claude-haiku-5-5",
    "balanced": "claude-sonnet-5-5",
    "strong": "claude-opus-5-5",
    "frontier": "claude-opus-5-5"
  }
}
```

Configure model IDs that your plan can actually use. Pilot checks Codex's local `models_cache.json`; it does not fetch entitlement or promise a particular model exists in every account. Run plain `codex` once to refresh its catalog. The supported effort is clamped to the model's advertised levels and configured ceiling; `ultra`/automatic delegation is excluded from automatic routing in this alpha.

Claude uses the configured effort allowlist low/medium/high/xhigh/max; Haiku has effort/thinking removed. Supported capabilities vary by model. `doctor` cannot establish Claude capability or entitlement. Verify configured models before a long session. Explicit model choices pass through unchanged and can exceed automatic policy limits.

For inherited gateway environment variables, Pilot refuses to silently replace another upstream. Clear your gateway explicitly or use the original CLI. No custom upstream URL is accepted from project files.

## Choosing the original CLI

If more than one CLI installation exists, your PATH may select an older one. `jev-pilot doctor` displays the versions actually used. To choose explicitly, add global `binaries` alongside your existing `keyFile` and `policy` fields:

```json
{
  "binaries": {
    "codex": "/absolute/path/to/codex",
    "claude": "/absolute/path/to/claude"
  }
}
```

Use the real original CLI executable, never `pilot-codex`, `pilot-claude` or `jev-pilot` (which would recurse). This setting is global only; a project's policy cannot select an executable. Without it Pilot uses `codex` and `claude` from PATH. A version check is not proof of model support; run the live model checks after upgrading or changing model IDs.
