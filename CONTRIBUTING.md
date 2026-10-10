# Contributing

Thank you for trying Jev Pilot. Installation fixes, protocol regressions, missing-usage cases and independently reviewed routing examples are especially useful.

1. Use Node.js 22+; no runtime dependencies or API keys are needed for offline tests.
2. Run `npm run verify` before submitting a patch.
3. Add focused regression coverage for protocol, routing, privacy or report-calculation changes.
4. State the CLI/OS versions and what was actually tested. Label mocked versus live evidence.
5. Preserve Apache-2.0 attribution in vendor files. Keep credentials and local reports out of commits.

Do not paste private prompts, raw CLI transcripts, auth files, account identifiers or keys into issues. A summary exported by `jev-pilot report --json summary.json` is optional; inspect it before sharing. A model incorrectly chosen for a task needs a non-sensitive task description, the selected model/effort, reason, and whether the output passed independent checks. A lower token count by itself is not a successful result.

Useful first contributions: Linux fresh-install validation, supported Claude model capability discovery, CLI version compatibility tests, and held-out coding tasks with deterministic graders. Coordinate larger changes in an issue to avoid duplicate work. No automatic publication, benchmark upload or secret-dependent CI is required.
