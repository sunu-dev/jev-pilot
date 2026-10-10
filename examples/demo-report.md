> SYNTHETIC DEMO: fixture data and invented prices. Not real usage.

# Jev Pilot usage report

| Metric | Value |
| --- | ---: |
| Runs | 1 |
| Provider requests | 12 |
| Completed responses | 12 |
| Unfinished requests | 0 |
| Jev requests | 7 |
| Jev successes | 6 |
| Jev failures | 1 |
| Unfinished Jev requests | 0 |
| Routing decisions | 7 |
| Selected model changes | 3 |
| Observed served model changes | 3 |
| Selected effort changes | 2 |
| Cache holds | 2 |
| Token-count checks (excluded from price comparison) | 0 |
| Jev input tokens (reported) | 1800 |
| Jev output tokens (reported) | 36 |
| Jev usage coverage | 6/7 |
| Provider failures | 0 |
| Usage coverage | 12/12 |
| Served model coverage | 12/12 |
| Estimated model cost (priced subset) | $0.3000 |
| Estimated Jev cost | $0.0006 |
| Estimated baseline (priced subset) | $0.6000 |
| Estimated net difference (complete coverage required) | $0.2994 |
| Estimated difference % | 49.9% |

## Reported tokens

Input (uncached): 12000; cache reads: 108000; cache writes: 4000; output: 2400.

## Models

- gpt-example-strong: 6
- gpt-example-balanced: 4
- gpt-example-fast: 2

## Interpretation

Estimated API-equivalent price comparison on the SAME observed token usage against each request's configured maximum-tier model. Includes Jev cost only when configured and known. Not a rerun, invoice saving, quality benchmark, or subscription-quota measurement. Cache writes actually observed are included; counterfactual model/effort/output/cache behavior is unknown.

Logs contain counts and routing metadata; prompts and credentials are not recorded. Local logs are never uploaded automatically.
