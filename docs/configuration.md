# Configuration

Global settings: `~/.config/jev-pilot/config.json`. Set `JEV_PILOT_CONFIG_HOME` to relocate this directory. The TypeSafe key comes from `TYPESAFE_API_KEY`, then `JEV_API_KEY`, then the raw file named by global `keyFile`. No project file can choose a key, log directory or upstream host.

Project settings: nearest `.jev-pilot.json`, walking up from the working directory and stopping at a Git root. Codex `-C`/`--cd` is respected. Project fields override global `policy` fields. An existing `.jev-router.json` from another router is not imported.

| Field | Default | Effect |
| --- | --- | --- |
| enabled | true | false runs the original CLI directly |
| sendToJev | true | false uses the proxy and default/current model without classification |
| mode | adaptive | adaptive, turn (no cache hold), or shadow |
| minTier / defaultTier / maxTier | fast / balanced / frontier | capability bounds |
| maxEffort | high | maximum routed reasoning effort, including trailing commands |
| imageMinTier / imageMinEffort | strong / high | floor for attached-image interpretation, clamped to permitted models/effort |
| minConfidence | 0.6 | uncertain decisions hold current capability |
| downgradeAfter | 3 | confident downgrade decisions needed in a warm large conversation |
| warmTokens | 20000 | context threshold for the cache hold heuristic |
| cacheIdleMinutes | 5 | cache becomes cold after this idle time; heuristic, not a provider TTL guarantee |
| requestChars | 2000 | latest text limit sent to TypeSafe (100–4000) |
| codexModels / claudeModels | [] | optional automatic model scope; empty means use tier bounds |
| codex / claude | see below | mapping of capability tiers to model IDs |

These are starting heuristics, not a trained or independently validated policy. The effective model scope/bounds remain authoritative even when a task is sensitive; an economy ceiling can reduce quality.

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

## Automatic model scope

`pilot-codex --models astra,sol` or `pilot-claude --models sonnet,haiku` selects an automatic model allowlist for that process. `--models=sol` also works. Comma order is irrelevant; names are case-insensitive. Accepts Astra/Sol/Luna, Opus/Sonnet/Haiku, or exact model IDs from your configured tier map. Unknown names and empty entries fail before any classifier request. Put `--` before a literal prompt argument that starts with `--models`.

Project defaults are arrays:

```json
{
  "codexModels": ["astra", "sol"],
  "claudeModels": ["sonnet", "haiku"],
  "maxEffort": "high"
}
```

Precedence: launch scope > project scope > global policy scope > tier bounds. A nonempty scope replaces min/default/max tier bounds for that agent. The default tier is preserved when allowed; otherwise the next higher allowed tier, or the highest allowed tier, is used. Bounds must still be a valid ordered policy before the scope is applied. Empty config arrays restore tier-bound behavior.

Noncontiguous scopes are supported. A recommendation for an excluded tier maps to the next higher permitted tier, or the highest permitted tier if no higher one exists. With Astra + Luna, a Sol recommendation selects Astra. Low-confidence holds, sensitive-work floors, provider-failure escalation, cache holds, no-key fallback and shadow defaults all stay within the automatic scope. Only included Codex IDs must exist in the local catalog.

A single-model scope keeps capability fixed while Jev still selects effort, subject to `maxEffort` and model support. Haiku receives no unsupported effort field. The most capable allowed model becomes the API-equivalent baseline; with one model there is no modeled capability price saving, and Jev adds overhead.

The startup banner, local session metadata and report show allowed automatic models. Old sessions without scope metadata remain unknown. Scope changes require a new Pilot launch; already-running sessions keep their loaded policy. This is an automatic-routing preference, not a security or spending boundary: explicit real-model native requests, including manual or auxiliary requests, pass through unchanged. Launch `--models` and `--model`/`-m` cannot be combined.

## Choose a model at the end of a prompt

End an unquoted user request with an explicit command:

```text
Improve this screen. Use Astra medium
이 화면을 개선해줘. 아스트라 미디움으로 해
画面を改善してください。アストラ mediumでお願いします
改进这个页面。请用Astra medium
```

Korean `솔로 해`, `루나로 해`, Japanese `ソルでお願いします` and Chinese `用Luna` work too. Commands must be at the end, outside quoted examples or fenced code. Aliases are recognized locally; no classifier call is made for that turn. Omitted effort uses medium, clamped to model support and `maxEffort`. Tool continuations and short approvals retain the route; the next substantive user turn returns to normal automatic routing. Shadow mode still only records suggestions.

Unlike an explicit native `/model` request, a trailing command respects the automatic model scope and effort ceiling. When restricted, the launcher prints a limitation notice and the report records `user-override-limited`. `솔 xhigh로 해` requires `"maxEffort": "xhigh"` or higher to actually apply xhigh; the default high ceiling remains high. A model unavailable for that tool keeps the current/default route and is reported. Supported syntax is deterministic; it does not promise to understand every paraphrase.

## Screenshots and visual tasks

The classifier receives bounded text and the number of attached images; image pixels, URLs and files are not sent to Jev. The original provider still receives the original image. Because the classifier cannot inspect the screen, attached-image tasks have a conservative default floor of strong/high (Sol/high with the default Codex map). This is a heuristic, not a measured optimum; use `imageMinTier` / `imageMinEffort` to change it. Allowed models and `maxEffort` still cap the result, including a Luna-only launch. The visual floor also applies to a new image task when Jev is unavailable or disabled; already-routed tool continuations preserve their exact route. Explicit trailing model commands skip this visual floor.

The text criteria also distinguish ambiguous content research/information architecture/visual design from mechanical edits. Missing image context or vague references can still cause mistakes; a local report cannot reconstruct private prompt text to explain an individual past decision conclusively.

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
