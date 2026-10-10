# Compatibility and evidence

Author verification: **2026-10-10**, macOS arm64, Node.js 24.4.1. These results describe one author's accounts and machine. They are not universal model entitlement or a long-session quality benchmark.

| Tool | CLI version | Existing login | Configured models with completed live responses |
| --- | --- | --- | --- |
| Codex CLI | 0.160.1 | ChatGPT subscription | `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6-astra` |
| Claude Code | 2.1.295 | Claude Max subscription | `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5` |

Run `jev-pilot verify --live all --models` to test every distinct configured model. This makes paid TypeSafe requests and uses provider allowance. Each check constrains the capability bounds to one tier, submits a tiny prompt through the original CLI, and requires a valid Jev decision plus a completed provider response reporting the selected model. It verifies connectivity and model access; it does not test Jev's ability to rank real work. Default `--live codex` or `--live claude` checks one unconstrained decision instead.

Three additional author-written Korean probe prompts were sent to the real classifier without forcing tiers:

| Probe | Jev capability / effort | Applied Codex route |
| --- | --- | --- |
| Correct one heading typo | fast / low | Luna / low |
| Implement ordered deduplication and edge-case tests | balanced / medium | Sol / medium |
| Fix concurrent daily quota reservations while preserving failure/midnight semantics | strong / xhigh | Sol / high, sensitive-work rule |

These probes show that classification can distinguish difficulty and that policy can cap effort. They are three smoke examples, not a held-out benchmark or evidence that the resulting code is correct. The third effort confidence was below the threshold; the independent sensitive-work rule chose high.

## What is covered

- Offline integration tests use fake upstreams to check same-turn/tool continuation, parallel duplicate classification, manual model passthrough, shadow mode, secret holds, warm-context downgrades and independent effort selection.
- Stream tests relay Korean UTF-8 split at every byte and handle subscription responses without a Content-Type header. HTTP 200 without a terminal completion is not accepted as success.
- Installation/uninstall tests protect existing commands. Report tests preserve unknown/missing usage, incomplete requests and negative estimates.
- Linux/macOS on Node.js 22 and 24 are configured in GitHub CI. A green run confirms those offline checks, not a subscription login on each OS.

## Known limits of this alpha

- Native smoke checks cover short sessions. Resume, very long conversations, compaction, multi-agent isolation and interactive `/model` transitions still need independent live validation. Tool/sub-agent message shapes are covered by fixtures, not every future CLI variant.
- Routing state is in memory for the launcher process. Restarting loses downgrade streaks. Cache warmth is a usage/time heuristic, not a provider guarantee; model switches can discard cache reuse.
- Codex's local catalog checks model IDs and effort levels but does not prove account access. Claude effort capability uses a static allowlist. Model IDs/defaults will need updates as providers change.
- CLI versions matter. An older Claude Code installation (2.0.10) rejected the configured newer models in author testing. `doctor` displays the executable's version; see [binary selection](configuration.md#choosing-the-original-cli).
- Source symlink installation targets macOS/Linux. Windows is unverified. Codex desktop application sessions are not routed; launch the CLI using `pilot-codex`.
- No independently measured task-quality, subscription-quota saving or controlled token-saving result exists yet. The public demo is synthetic. See the [validation plan](validation.md).

Jev Pilot passes existing CLI subscription authentication to the original provider. Account eligibility and provider terms remain provider controlled. This project is independent of TypeSafe, OpenAI and Anthropic.
