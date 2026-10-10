# Changelog

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
