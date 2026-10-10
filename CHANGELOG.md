# Changelog

## 0.1.0-alpha.5

- Stream diagnostics distinguish upstream SSE errors, explicit incomplete responses, unexpected EOF, transport failures and downstream cancellation. Only validated request identifiers and bounded error codes are recorded; provider messages, bodies and credentials are excluded. Native Codex turn metadata is parsed without logging its contents, and launch records include the runtime version.
- HTTP 200 inference records with explicitly incomplete responses count as failed/interrupted, including older records that lack an error field.
- Codex configuration options after `exec` or `resume` are normalized into one scope. This prevents native `-c` arguments from silently replacing Pilot's provider configuration in Codex 0.162.1.
- A restrained console report with a desktop sidebar, readable model/token summaries, full-width selection details, responsive tables and translated accessibility labels. Synthetic preview and English/Korean setup guides updated.

Fresh short subscription requests completed on native Codex and fixed-scope Pilot with Astra and Sol. Pilot checks verified matching provider-reported models. A repeated stream failure in an older long-running Codex process remains unresolved; this release adds diagnosis and fixes independently reproduced issues. It does not establish long-session reliability or measured task-quality, token or allowance savings. See [troubleshooting](docs/troubleshooting.md).

## 0.1.0-alpha.4

- Run-wide classifier guard: three consecutive failures pause classification for 60 seconds; one recovery probe resumes it. Optional `jevMaxRequests` caps actual classifier attempts across concurrent sessions. Skips remain distinct from paid calls and failures.
- Effective policy snapshots and ordered decision traces explain model scope, confidence, cache, safety, effort ceilings and model support. The report separates these evaluation steps from provider-reported models.
- Exact `feedback --decision ID` targeting and per-decision commands in the four-language report. `--no-jev` disables classification for one launch while retaining proxy observations and leaving saved settings intact.
- Bounded recent-turn routes preserve model, decision ID and generation for late older-turn tool requests and retries. Unmatched tool requests do not inherit a newer decision link or update its state.
- Response records link to exact decisions and record end-to-end/provider first-body-byte times. These are not first generated-token or whole-task completion measurements.
- Dedicated misrouting issue form, updated synthetic demo and a paired-task validation record template.

Author smoke verification on 2026-10-10: one real Jev decision and completed subscription response each on Codex CLI 0.162.1 (Luna) and Claude Code 2.1.295 (Haiku), macOS arm64 / Node 24.4.1. Long-session/MCP/resume behavior and independently reviewed task-quality or savings comparisons remain unverified.

## 0.1.0-alpha.3

- Quality/completeness-aware classification rubric and recent attachment metadata; replaced images with identical text/count trigger fresh decisions without exposing pixels.
- Original Jev recommendation, separate confidence/probability/margins and rubric version in local diagnostics and accessible report details.
- Optional local feedback (`right`, `too-weak`, `too-strong`, `too-slow`, `rework`), correction ordering and report coverage; feedback does not count as inference activity or auto-train policy.
- Serialized distinct-turn classification, waiting tool continuations, and generation/request guards against stale upstream state updates. Incomplete 200 streams count as failures without provider retries.
- Warm-context tracking for image/explicit routes, xhigh/max-preserving risk/failure floors and Japanese/Chinese confirmations.
- Whole-model live checks isolate each expected physical model from global scopes and require its reported response.
- Offline-first authored multilingual rubric evaluator; live classifier checks are explicit and bounded. Community evidence and remaining validation documented.
- Pinned GitHub release package installation instructions and UTF-8 BOM configuration parsing. Windows execution remains unverified.

No new paid live benchmark was run for this release. Offline protocol/policy tests and synthetic report checks do not prove preserved task quality or subscription savings.

## 0.1.0-alpha.2

- Automatic model scopes per launch (`--models`) and project (`codexModels` / `claudeModels`), including single-model and noncontiguous selections. Effort remains independently selected.
- Scope-aware defaults, fallback/escalation, local catalog validation, baseline and session metadata. Explicit native manual models remain passthrough.
- Redesigned standalone offline report: English/Korean/Japanese/Chinese, model/token charts, scope, whole-dashboard tool filters, timeline and aggregate JSON export.
- `report --open`, readable terminal output, observed cache-read/reuse ratios, incomplete-data explanations and malformed-record estimate suppression.
- Explicit trailing prompt model/effort commands in four languages; no Jev request for explicit choices, with visible scope/effort limits.
- Image-presence classification context and configurable visual-task floors; images remain with the original provider.
- Regression coverage for scope boundaries, argument forwarding/precedence, estimate denominators, report privacy and scope metadata.

No measured subscription-quota saving or long-session quality claim. Demo data and prices remain synthetic.

## 0.1.0-alpha.1

First experimental release by sunulab.

- Source install/uninstall, project policies, doctor and strict opt-in live verification.
- Codex/Claude subscription-session loopback adapters; manual model passthrough.
- Independent capability/effort classification, finite cache downgrade holds and shadow mode.
- Local metadata-only ledger and HTML/JSON/Markdown reporting with estimate coverage.
- Regression coverage for missing streaming headers, UTF-8 chunk splits, duplicate turns, hooks, secret patterns, route limits and incomplete data.

No independently measured subscription saving or long-session quality claim.
