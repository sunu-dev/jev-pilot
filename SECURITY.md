# Security

This alpha handles provider subscription credentials in memory. Use it only on a computer and source checkout you trust. It is not a sandbox and does not change the original CLI's permissions.

## Boundaries

- Random loopback port and per-process token; Origin requests and unexpected Host values are refused.
- Fixed HTTPS destinations: `api.typesafe.ai`, `api.anthropic.com`, and `chatgpt.com`. Redirects are refused. Project settings cannot introduce destinations, keys, binaries or log paths.
- The TypeSafe credential is used only for classification; original first-party credentials are forwarded only to their original provider. No credential is logged or copied into source/configuration by init.
- Recognized secrets are removed from bounded classifier context. Pattern matching is incomplete. A sensitive natural-language description, unknown key format, path or code excerpt can still reach TypeSafe. Use `sendToJev: false` or the original CLI when this is unacceptable.
- JSONL files are owner-only and exclude prompt/tool/system text, raw account/session IDs and credentials. Reports are local, with no telemetry or upload feature. Unknown price/usage data is explicitly missing.

Other local processes running as your user can inspect process memory or files. The local token does not protect against a compromised account. Upstream services, your CLI, hooks, installed plugins and your configured key file have their own data handling and logs.

## Reporting

Use GitHub **Report a vulnerability** if private vulnerability reporting is enabled for this repository. Do not include secrets in a public issue. Rotate any real credential that has been disclosed. Only the current experimental version is maintained; a security response SLA is not promised.
