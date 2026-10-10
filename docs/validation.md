# Evidence required before savings claims

Offline automated tests prove protocol and policy invariants. A live smoke proves one Jev request and one provider completion. Neither proves lower quota use or preserved task quality on long software work.

Before promoting a stable release:

1. Fresh installs by people other than the author on macOS Apple Silicon and Linux. Include upgrade/uninstall and broken-key/offline cases.
2. Real same-session turns covering simple → difficult → simple, short approvals, long caches, compaction/resume, manual selection and tool loops on both CLIs.
3. At least 30 fixed coding tasks across mechanical changes, bounded features, unknown bugs, concurrency/security and migrations, with held-out tasks written independently from routing rules.
4. Compare Pilot with fixed model+effort baselines on fresh checkouts. Randomize execution order; repeat at least three times. Keep tooling and context consistent. Count retries and all classification/provider requests.
5. Score tests passing, accepted patches, reviewer corrections, latency, token/cache usage and estimated cost. Publish failures and negative results. Do not use only classifier-label accuracy.
6. Report API-equivalent estimates separately from any directly observed account-allowance deltas. Allowance deltas need isolated workloads and cannot be inferred from token pricing.

Report sample size, task selection, exact versions, policy, rates/date, baseline, missing usage, reruns and exclusions. No default “saved X%” claim or extrapolation from a synthetic demo.

## Classifier rubric checks

`npm run eval:routing` validates 24 authored development cases offline and makes zero API calls. The cases include four languages, short difficult tasks, polished UI/content work, a long simple request, visual context and security explanations versus changes. Schema tests and mocked classifications verify the evaluator; they do not establish Jev label accuracy.

Explicit `npm run eval:routing -- --live --out /tmp/routing-eval.json` makes one paid Jev call per case, at most 32 cases, sequentially with no retries. It requires a key and enabled `sendToJev`, reserves an exclusive owner-only output before calls, and records rubric disagreement/errors, latency, token coverage and a question fingerprint without prompts/raw responses. It compares raw classifier output before scope/effort clamps. Language counts are diagnostics because the languages contain different tasks. These authored expectations are not held-out labels; broad tier/effort intervals cannot fully express a model/effort tradeoff such as Sol xhigh versus Astra medium. Use independent held-out tasks and actual provider executions for quality or savings conclusions.

## Community pilot

Ask volunteers to run `doctor`, offline tests and live checks, then work on a task they can independently review. An aggregate JSON export is optional. The user reviews and submits it themselves; Pilot has no upload endpoint. Start with installation success, verified completion, downgrade behavior and cache coverage before optimizing star growth.

Launch readiness: compatibility matrix is accurate, the latest CI is green, known failures are documented, the demo is clearly labeled, and another person can reach a verified response using only the README.
