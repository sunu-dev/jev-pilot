> SYNTHETIC DEMO: fixture data and invented prices. Not real usage.

# Jev Pilot usage report

| Metric | Value |
| --- | ---: |
| Runs | 2 |
| Provider requests | 18 |
| Completed responses | 18 |
| Unfinished requests | 0 |
| Jev requests | 9 |
| Jev successes | 8 |
| Jev failures | 1 |
| Unfinished Jev requests | 0 |
| Routing decisions | 9 |
| Selected model changes | 4 |
| Observed served model changes | 4 |
| Selected effort changes | 3 |
| Cache holds | 2 |
| Cache-read share of reported input | 85.7% |
| Route reuse share of automatic requests | 55.6% |
| Token-count checks (excluded from price comparison) | 0 |
| Jev input tokens (reported) | 2300 |
| Jev output tokens (reported) | 48 |
| Jev usage coverage | 8/9 |
| Provider failures | 0 |
| Usage coverage | 18/18 |
| Served model coverage | 18/18 |
| Estimated model cost (priced subset) | $0.3720 |
| Estimated Jev cost | $0.0008 |
| Estimated baseline (priced subset) | $0.7080 |
| Estimated net difference (complete coverage required) | $0.3352 |
| Estimated difference % | 47.3% |

## Reported tokens

Input (uncached): 16800; cache reads: 132000; cache writes: 5200; output: 3240.

## Models

- gpt-6-astra: 6
- gpt-6.1-sol: 4
- claude-sonnet-5-5: 3
- claude-haiku-5-5: 3
- gpt-6-luna: 2

## Automatic model scopes

- codex: gpt-6-astra, gpt-6-luna, gpt-6.1-sol (1 runs)
- claude: claude-haiku-5-5, claude-sonnet-5-5 (1 runs)

## Interpretation

Estimated API-equivalent price comparison on the SAME observed token usage against each request's configured maximum-tier model. Includes Jev cost only when configured and known. Not a rerun, invoice saving, quality benchmark, or subscription-quota measurement. Cache writes actually observed are included; counterfactual model/effort/output/cache behavior is unknown.

Logs contain counts and routing metadata; prompts and credentials are not recorded. Local logs are never uploaded automatically.
