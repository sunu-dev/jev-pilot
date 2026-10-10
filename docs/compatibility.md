# Compatibility and evidence

Author verification: **2026-10-10**, macOS arm64, Node.js 24.4.1. These results describe one author's accounts and machine. They are not universal model entitlement or a long-session quality benchmark. The alpha.1 model-access checks and alpha.4 smoke checks below are separate runs with different coverage.

## Alpha.4 live smoke check

Run at **2026-10-10 14:46 UTC**, with the existing subscription logins:

| Tool | CLI version | Existing login | Completed provider model | Jev calls / completed responses |
| --- | --- | --- | --- | --- |
| Codex CLI | 0.162.1 | ChatGPT subscription | `gpt-6-luna` | 1 / 1 |
| Claude Code | 2.1.295 | Claude Max subscription | `claude-haiku-5-5` | 1 / 1 |

Both checks produced one successful Jev classification and one completed provider response. The local records contained the effective `policySnapshot`, ordered `policyTrace`, and a response linked to its routing `decisionId`. This is a two-model connectivity and receipt smoke check. It does not reverify every configured model, exercise live outage recovery/request caps, or establish long-session behavior, task quality or savings.

## Alpha.1 model-access checks

The earlier alpha.1 checks completed live responses from all distinct models in the author's default map:

| Tool | CLI version | Existing login | Configured models with completed live responses |
| --- | --- | --- | --- |
| Codex CLI | 0.160.1 | ChatGPT subscription | `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6-astra` |
| Claude Code | 2.1.295 | Claude Max subscription | `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5` |

Run `jev-pilot verify --live all --models` to test every distinct globally configured model. This makes paid TypeSafe requests and uses provider allowance. Each check isolates one physical model from global model scopes, submits a tiny prompt through the original CLI, and requires a valid Jev decision plus a completed provider response reporting that expected model. Checks run in a temporary project; model mappings defined only in the current project's policy are not loaded. It verifies connectivity and model access; it does not test Jev's ability to rank real work. Default `--live codex` or `--live claude` checks one unconstrained decision instead.

In that earlier verification, three additional author-written Korean probe prompts were sent to the real classifier without forcing tiers:

| Probe | Jev capability / effort | Applied Codex route |
| --- | --- | --- |
| Correct one heading typo | fast / low | Luna / low |
| Implement ordered deduplication and edge-case tests | balanced / medium | Sol / medium |
| Fix concurrent daily quota reservations while preserving failure/midnight semantics | strong / xhigh | Sol / high, sensitive-work rule |

These probes show that classification can distinguish difficulty and that policy can cap effort. They are three smoke examples, not a held-out benchmark or evidence that the resulting code is correct. The third effort confidence was below the threshold; the independent sensitive-work rule chose high.

## What is covered

- Alpha.2 model scopes, multilingual trailing commands and image floors are covered by offline integration tests; the live model-access checks above were made for alpha.1 and do not independently establish long-session behavior of the new policies.
- Alpha.3 adds offline checks for stale/parallel responses, replaced images, recommendation diagnostics, local feedback and the authored evaluation runner. No new paid classifier evaluation or provider smoke check was run for alpha.3.
- Alpha.4 adds offline checks for the shared run request cap, canceled attempts, consecutive-failure pauses, a single half-open recovery probe, and safe reuse of retained older turns. The two-model live smoke check above verifies completed responses and decision receipts; circuit failure/recovery paths remain tested with fake classifiers and upstreams.
- Offline integration tests use fake upstreams to check same-turn/tool continuation, parallel duplicate classification, manual model passthrough, shadow mode, secret holds, warm-context downgrades and independent effort selection.
- Stream tests relay Korean UTF-8 split at every byte and handle subscription responses without a Content-Type header. HTTP 200 without a terminal completion is not accepted as success.
- Installation/uninstall tests protect existing commands. Report tests preserve unknown/missing usage, incomplete requests and negative estimates.
- Linux/macOS on Node.js 22 and 24 are configured in GitHub CI. A green run confirms those offline checks, not a subscription login on each OS.

## Known limits of this alpha

- Repeated `stream disconnected before completion` errors have occurred in an author's long Codex session. The affected process started before the current diagnostic improvements. Fresh short native and fixed-scope Pilot requests completed on Astra and Sol, which does not establish the cause or resolve the long-session failure. See [interrupted-response diagnostics](troubleshooting.md).
- Native smoke checks cover short sessions. Resume, very long conversations, compaction, multi-agent isolation and interactive `/model` transitions still need independent live validation. Tool/sub-agent message shapes are covered by fixtures, not every future CLI variant.
- Routing state is in memory for the launcher process. Restarting loses downgrade streaks. Cache warmth is a usage/time heuristic, not a provider guarantee; model switches can discard cache reuse.
- Route history is limited to 64 distinct human turns per routing session. Matching older tool continuations retain their own decision link; unmatched or evicted tool requests have no decision link and cannot update the current turn's routing/cache state. Fixture coverage does not establish persistent resume or compatibility with every MCP/tool message shape.
- Codex advertises the smallest context window among allowed models for the automatic session. Claude uses a conservative 200k model context and a 160k auto-compaction hint. Routing does not preserve a native 1M context configuration; MCP tool search, context display and compaction behavior need direct comparison in the user's environment.
- Codex's local catalog checks model IDs and effort levels but does not prove account access. Claude effort capability uses a static allowlist. Model IDs/defaults will need updates as providers change.
- CLI versions matter. An older Claude Code installation (2.0.10) rejected the configured newer models in author testing. `doctor` displays the executable's version; see [binary selection](configuration.md#choosing-the-original-cli).
- Source symlink installation targets macOS/Linux. Windows is unverified. Codex desktop application sessions are not routed; launch the CLI using `pilot-codex`.
- No independently measured task-quality, subscription-quota saving or controlled token-saving result exists yet. The public demo is synthetic. See the [validation plan](validation.md).

Jev Pilot passes existing CLI subscription authentication to the original provider. Account eligibility and provider terms remain provider controlled. This project is independent of TypeSafe, OpenAI and Anthropic.
