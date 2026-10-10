# Evidence required before savings claims

Offline automated tests prove protocol and policy invariants. A live smoke proves one Jev request and one provider completion. Neither proves lower quota use or preserved task quality on long software work.

## Current evidence: alpha.4

The alpha.4 routing controls and local feedback records prepare Pilot for measurement. Two real-account smoke checks have exercised the connection and completion path. No paired software-task quality or savings experiment has been completed for this release. A completed HTTP/provider response is a transport observation; it is not evidence that the requested work was correct, accepted or cheaper.

Independent held-out tasks, fresh installation by an external user, and long sessions with MCP tools, compaction and resume still require validation. The task counts and repeat counts below are operating targets for collecting evidence, not a statistical guarantee or a threshold for GitHub Trending, weekly first place or stars.

Before promoting a stable release:

1. Fresh installs by people other than the author on macOS Apple Silicon and Linux. Include upgrade/uninstall and broken-key/offline cases.
2. Real same-session turns covering simple → difficult → simple, short approvals, long caches, compaction/resume, manual selection and tool loops on both CLIs.
3. At least 30 fixed coding tasks across mechanical changes, bounded features, unknown bugs, concurrency/security and migrations, with held-out tasks written independently from routing rules.
4. Compare Pilot with fixed model+effort baselines on fresh checkouts. Randomize execution order; repeat at least three times. Keep tooling and context consistent. Count retries and all classification/provider requests.
5. Score tests passing, accepted patches, reviewer corrections, latency, token/cache usage and estimated cost. Publish failures and negative results. Do not use only classifier-label accuracy.
6. Report API-equivalent estimates separately from any directly observed account-allowance deltas. Allowance deltas need isolated workloads and cannot be inferred from token pricing.

Report sample size, task selection, exact versions, policy, rates/date, baseline, missing usage, reruns and exclusions. No default “saved X%” claim or extrapolation from a synthetic demo.

## Paired task record

Create one record per task, tool and repeat **before** either run. Use the same starting commit in separate clean checkouts, the same task and acceptance criteria, and the same CLI version, tools, MCP configuration, permissions and time/tool budgets. Pin the baseline model **and reasoning effort**; record Pilot's complete policy and model catalog snapshot. Randomize which arm runs first and retain that order. Do not copy the first arm's patch, transcript or newly discovered solution into the second arm. Describe any necessary context difference rather than treating the runs as identical.

A `--no-jev` run observes local routing without external classification; it is not automatically a fixed-model baseline. For a native CLI baseline, use that CLI's explicit model/effort controls and state how its timing and usage were captured. Mark unavailable fields as unavailable. Pilot's proxy report does not measure a native CLI run that bypasses the proxy.

Copy this template for each pair. Store private task material locally; a shared record can identify a public task or a redacted task manifest without including source code, prompts, credentials or personal paths.

```text
Pair ID / task ID / repeat:
Task author / independent held-out task? / task category:
Task and acceptance-criteria reference:
Starting commit / separate checkout IDs / clean-state verification:
Tool and version / OS / MCP and other tool versions:
Execution order / order selection method / runner:
Shared initial context / permissions / time and tool budgets:
Baseline: exact model + effort / native launch settings / capture method:
Pilot: version / policy snapshot / model catalog snapshot / launch flags:
Cache setup per arm: fresh or warm / preparation / any carry-over:
Other account workloads / interruptions / known confounders:
```

| Measurement, recorded for every attempt | Fixed model + effort | Pilot |
| --- | --- | --- |
| Start time / first response time / last response time, with timezone | | |
| Review start / accepted or stopped time / wall-clock duration | | |
| Provider requests, including failed requests and retries | | |
| Classifier attempts, failures, skipped calls and classification latency | Not applicable | |
| Input / output / cache-read / cache-write tokens and usage source | | |
| Usage coverage: requests with observed usage / all provider requests | | |
| Provider API-equivalent estimate / rate source and date / missing cost data | | |
| Classification charge or estimate / source and date | Not applicable | |
| Directly observed allowance delta / capture window, or unavailable | | |
| Routing decisions / model and effort switches / decision IDs | Fixed settings | |
| Tool or MCP errors / compaction / resume events | | |
| Tests and acceptance checks: passed, failed or not run | | |
| Review time / corrections requested / manual edits | | |
| Retries or reruns / reason / extra time and usage for each | | |
| User accepted: yes, no or pending / acceptance time and reason | | |
| Final task outcome: accepted, rejected, failed, aborted or pending | | |
| Local feedback rating and linked decision IDs, if recorded | | |

Define the task-quality rubric before execution: required behavior, tests, reviewer checks and what counts as a correction or rejection. Where practical, review patches without showing which arm produced them. Record `response.completed` separately from this rubric and user acceptance. A `right` feedback rating is a user's local assessment; neither it nor a successful response replaces the recorded acceptance checks.

Keep failed, timed-out, interrupted and rejected runs in the record and the denominator. Append a new attempt for a retry; retain the earlier attempt and count its time, requests and observed usage. Explain missing usage and any exclusions, and publish negative results. A task cannot become a successful cheap run by dropping its failed attempts or the later manual repair.

Compare time to accepted work, acceptance/correction rates, all observed usage and classification overhead across pairs. Show sample size and missing-data coverage beside any estimate. Keep estimated API-equivalent cost, measured provider charges and directly observed subscription allowance separate; an unavailable allowance measurement cannot be replaced with token-price arithmetic. Do not extrapolate one successful smoke, authored rubric checks or this unfilled template into a quality or savings claim.

## Classifier rubric checks

`npm run eval:routing` validates 24 authored development cases offline and makes zero API calls. The cases include four languages, short difficult tasks, polished UI/content work, a long simple request, visual context and security explanations versus changes. Schema tests and mocked classifications verify the evaluator; they do not establish Jev label accuracy.

Explicit `npm run eval:routing -- --live --out /tmp/routing-eval.json` makes one paid Jev call per case, at most 32 cases, sequentially with no retries. It requires a key and enabled `sendToJev`, reserves an exclusive owner-only output before calls, and records rubric disagreement/errors, latency, token coverage and a question fingerprint without prompts/raw responses. It compares raw classifier output before scope/effort clamps. Language counts are diagnostics because the languages contain different tasks. These authored expectations are not held-out labels; broad tier/effort intervals cannot fully express a model/effort tradeoff such as Sol xhigh versus Astra medium. Use independent held-out tasks and actual provider executions for quality or savings conclusions.

## Community pilot

Ask volunteers to run `doctor`, offline tests and live checks, then work on a task they can independently review. An aggregate JSON export is optional. The user reviews and submits it themselves; Pilot has no upload endpoint. Start with installation success, verified completion, downgrade behavior and cache coverage before optimizing star growth.

Launch readiness: compatibility matrix is accurate, the latest CI is green, known failures are documented, the demo is clearly labeled, and another person can reach a verified response using only the README.
