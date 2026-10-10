# Reporting without invented savings

Reports stay on the user's computer. There is no central database, telemetry, shared leaderboard or automatic report submission.

## Observed counters

- **Jev requests:** actual outbound classification HTTP attempts, not the number of provider requests. Pilot makes one attempt per classified user turn, with duplicate requests sharing an in-flight decision. It has no classifier retry loop.
- **Jev successes/failures:** valid answers versus HTTP, network, timeout or invalid-answer failures. Interrupted calls can remain unfinished.
- **Routing decisions:** new user turns handled by Pilot, including confirmations and secret/no-key holds that do not call Jev.
- **Selected model/effort changes:** differences from the previous automatic selection in that in-memory session. The first selection is not counted as a change. These do not prove the provider honored the effort or successfully served the next request.
- **Observed served-model changes:** differences between successive reported response models within a run/session, counted independently from selection attempts. Responses without a reported model cannot establish a change.
- **Provider requests/responses:** includes continuations, manual requests and auxiliary traffic that reaches the inference proxy. Original CLI retries count as additional requests.
- **Served model coverage:** how often a provider response reports its model. Selected and served names are displayed separately in JSON logs; dated model aliases are accepted by live verification.
- **Completion:** terminal `response.completed` / `message_stop`, or a completed nonstream JSON response. HTTP 200 alone does not prove success.
- **Usage coverage:** responses with reported token usage. Missing usage is not zero usage. Partial/incomplete responses can still have billable usage.
- **Token-count checks:** auxiliary `count_tokens` calls, listed separately and excluded from inference token totals and price coverage. Jev's reported input/output totals have their own coverage.
- **Unfinished calls:** provider requests or Jev attempts lacking a result remain visible after interruption and prevent an aggregate net estimate.

Uncached input, cache read, cache write and output are separate. OpenAI input totals include cached tokens; Anthropic's uncached input excludes its separate cache counters. The usage adapter normalizes these without subtracting cache tokens twice. Output tokens can include reasoning; this report cannot isolate all reasoning usage on every provider.

## Read the visual dashboard

`jev-pilot report` prints a compact terminal report. `jev-pilot report --open` writes a private HTML snapshot under the local data directory's `reports/` and opens it in your browser; `--html report.html` chooses the export path. Files never overwrite an existing export. No web service or external assets are required.

The dashboard offers English/Korean/Japanese/Chinese, model and token composition, scope metadata, price/usage coverage, routing reasons and a JSON download of the selected tool's aggregates. Its tool filter updates all cards, charts and timeline. It is a snapshot: generate it again for later activity.

- **Cache-read share:** reported cache-read tokens / (uncached input + cache reads + cache writes). This is observed input composition, not tokens avoided or quota savings. Missing usage can bias the observed ratio; usage coverage stays visible.
- **Route reuse:** provider requests marked continuation, tool-continuation or confirmation-hold / eligible automatic provider requests. Manual, auxiliary, unclassified tool/auxiliary traffic and token-count checks are excluded. It describes reuse events, not a replayed estimate of paid Jev requests avoided.
- Empty denominators stay unavailable. Malformed records or unfinished requests prevent aggregate net estimates. The dashboard shows a reason when data is incomplete.
- Allowed automatic models come from session-start metadata. Old sessions remain unrecorded; their observed model mix is not used to guess a scope.

## Inspect a decision and record feedback

The activity table separates the original Jev tier/effort recommendation from the applied model/effort. Expand a recommendation using mouse, keyboard or touch to see the two reported confidence values, optional selected-option probabilities and margins, risk flag and rubric version. Old records stay unknown. Confidence and option probability are different statistics; neither is a calibrated probability that the coding task will succeed. The existing confidence gate is configurable and has not been optimized on a held-out workload.

After reviewing the latest routed turn, optionally run in another terminal:

```sh
jev-pilot feedback right --agent codex
jev-pilot feedback too-weak --agent codex
jev-pilot feedback rework --agent claude
```

Ratings are `right`, `too-weak`, `too-strong`, `too-slow`, `rework`. The target is the latest decision for that tool across **all local projects and runs**, not the terminal's current directory. Check the model and timestamp printed by the command. Omit `--agent` only when the newest decision across both tools is intended. Ambiguous latest runs, unreadable logs or unknown options are rejected before recording. Record immediately after reviewing the intended turn; concurrent sessions can create a newer decision.

Feedback creates an owner-only metadata event linked to the decision, without editing its source log. Corrections count only the latest rating for each decision. Reports include feedback only for decisions selected by the report's tool/date/run filters; later feedback remains associated with the original decision date. Feedback files do not inflate runs, periods, requests or costs. These voluntary ratings have selection bias and are not task-success measurements. Pilot does not automatically retrain or change routing from them.

## Configure prices

Edit `~/.config/jev-pilot/config.json`. Keep the existing `keyFile` and policy fields. Rates are **USD per million tokens**, not per token. Use current official rates for your exact models and record the date/source for your own comparison. No potentially stale public prices are bundled.

```json
{
  "policy": {},
  "prices": {
    "gpt-example-fast": { "in": 1, "out": 2, "cacheRead": 0.1, "cacheWrite": 1 },
    "gpt-example-strong": { "in": 5, "out": 10, "cacheRead": 0.5, "cacheWrite": 6.25 }
  },
  "jevPrice": 0.5
}
```

**The IDs and numbers above are invented examples.** They are not official prices. Omitted cache rates fall back to the uncached input rate. Use the right cache-write rate/TTL for your provider. Pilot does not currently price images, audio, search/tool fees, batch discounts, service tiers, long-context surcharges or tiered pricing. Do not use a flat estimate as a billing reconciliation.

Configure rates **before** starting the session. Each response stores its estimates using the configuration at that time; changing rates later does not retroactively reprice prior records. An unknown served model/rate remains unpriced. Jev estimates require its configured input rate and reported input usage. A failed Jev request can have unknown cost, so it can make the overall comparison unavailable.

## Formula and baseline

```text
model estimate = (uncached input × input rate
                + cache reads × cache-read rate
                + cache writes × cache-write rate
                + output × output rate) / 1,000,000

baseline = the SAME observed tokens priced as the highest allowed model
           (configured maxTier when no model scope is set)
net estimated difference = baseline − model estimate − estimated Jev cost
```

The priced subset is labeled with coverage. Net difference and percentage require complete price/usage coverage across selected responses and Jev results. Negative differences remain negative. This baseline does **not** simulate different outputs, reasoning, retries or counterfactual cache reuse. A repeated baseline model could preserve a cache that switching discarded; lower effort could alter the number of requests. Those effects require a controlled end-to-end experiment.

Subscriptions do not expose a universal token-to-quota conversion. Therefore these estimates are **not subscription quota savings, money refunded, task-quality measurements or a rerun baseline**. Low cost can accompany bad output. Track completion, tests, retries and human acceptance alongside cost.

## Files and sharing

Local JSONL logs: `~/.local/share/jev-pilot/logs/`. Permissions are owner-only; each session file is capped at 50 MB and logging warns then stops if storage fails. Logs are not automatically deleted or uploaded. `JEV_PILOT_DATA_HOME` can relocate them.

Live verification writes to `~/.local/share/jev-pilot/verification/logs/` instead, so smoke tests do not inflate your normal usage report. Inspect those separately with `jev-pilot report --from ~/.local/share/jev-pilot/verification/logs`.

Use `jev-pilot report --json summary.json` to export an aggregate report. It includes model IDs and a decision timeline, so inspect before sharing. Malformed/truncated lines are counted and skipped with a warning. `--since` uses UTC dates. Both the HTML tool filter and CLI filters change all aggregate metrics. The exported HTML includes embedded aggregates and a routing timeline; inspect before sharing.

The demo files contain only synthetic fixtures and invented rates. Do not cite them as user savings.
