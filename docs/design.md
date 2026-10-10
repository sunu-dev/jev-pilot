# Design

Pilot is a bounded subscription-session adapter, not a general-purpose multi-provider gateway.

1. Start the original CLI with a temporary loopback base URL, random local token and sentinel model `jev-pilot`.
2. Identify human turns after removing known harness wrappers and tool-result messages. Hash session identifiers with a random per-process key before logging.
3. Classify a new user turn once. Send bounded, scrubbed context and three typed Choice questions (capability, effort and sensitive-change risk) to the fixed TypeSafe endpoint. A six-second deadline and one attempt bound the overhead.
4. Apply configured bounds, confidence handling, failure escalation and a finite cache downgrade hold. Pure confirmations reuse the previous route. Recognized secrets bypass classification.
5. Rewrite model and supported effort while preserving the original inference request and first-party credentials. In-session concrete model requests bypass automatic rewriting. Token counting and auxiliary work do not ask Jev.
6. Stream bytes unchanged. Observe terminal status, served model and token usage. Persist only allowed metadata.

Each sub-agent thread is separated when Codex supplies a thread ID. Requests that already name a real model pass through; automatic sub-agent coverage is not guaranteed. A finished sub-agent notification is not treated as a new human turn. Concurrency tests cover duplicate requests for a single turn; production cancellation, compaction/resume and multiple parallel agents need further validation.

No provider retries, cross-provider fallback, persistent routing state, CLI configuration edits, account synchronization or community report upload are performed. The proxy dies with the child. Failure of report storage does not stop inference.

The cache heuristic uses the most recent reported input total and a configured idle interval. It does not predict true provider TTL, normalize cache identity between models, or claim effort changes are cache-free. The report exposes observed cache usage so these assumptions can be evaluated. A model chosen for a fresh simple task must be able to move down; an ongoing tool chain must keep one route.

Parsing, recognized-secret detection and token normalization build on the Apache-2.0 helpers in `vendor/dirien/`. All routing policy, proxy orchestration, reporting and launchers are implemented here. See NOTICE for provenance and modifications.
