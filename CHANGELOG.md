# Changelog

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
