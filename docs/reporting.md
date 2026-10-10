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

baseline = the SAME observed tokens priced as that session's configured maxTier model
net estimated difference = baseline − model estimate − estimated Jev cost
```

The priced subset is labeled with coverage. Net difference and percentage require complete price/usage coverage across selected responses and Jev results. Negative differences remain negative. This baseline does **not** simulate different outputs, reasoning, retries or counterfactual cache reuse. A repeated baseline model could preserve a cache that switching discarded; lower effort could alter the number of requests. Those effects require a controlled end-to-end experiment.

Subscriptions do not expose a universal token-to-quota conversion. Therefore these estimates are **not subscription quota savings, money refunded, task-quality measurements or a rerun baseline**. Low cost can accompany bad output. Track completion, tests, retries and human acceptance alongside cost.

## Files and sharing

Local JSONL logs: `~/.local/share/jev-pilot/logs/`. Permissions are owner-only; each session file is capped at 50 MB and logging warns then stops if storage fails. Logs are not automatically deleted or uploaded. `JEV_PILOT_DATA_HOME` can relocate them.

Live verification writes to `~/.local/share/jev-pilot/verification/logs/` instead, so smoke tests do not inflate your normal usage report. Inspect those separately with `jev-pilot report --from ~/.local/share/jev-pilot/verification/logs`.

Use `jev-pilot report --json summary.json` to export an aggregate report. It includes model IDs and a decision timeline, so inspect before sharing. Malformed/truncated lines are counted and skipped with a warning. `--since` uses UTC dates. The HTML agent filter changes only the timeline; CLI filters change all aggregate metrics.

The demo files contain only synthetic fixtures and invented rates. Do not cite them as user savings.
