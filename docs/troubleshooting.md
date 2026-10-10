# Interrupted Codex responses

`stream disconnected before completion` does not identify the failed layer. Codex can display it after an upstream SSE error, an unexpected end of stream, or a transport failure. HTTP 200 means the stream opened; successful inference requires a terminal completion event. The same generic processing-error message has been [reported with the native OpenAI provider](https://github.com/openai/codex/issues/43517), and [Codex can obscure an earlier failure while waiting for more events](https://github.com/openai/codex/issues/43140). These reports do not establish the cause of a particular Pilot failure.

## Recover without repeating completed work

Inspect the partially completed work before retrying. A stopped response does not roll back tool actions. In the affected project, exit the old CLI and resume with a restricted model scope, for example:

```sh
pilot-codex --models sol resume --last
```

This keeps local reporting and constrains automatic routing to the configured Sol model. It is a diagnostic workaround, not a guarantee of recovery. Source updates take effect only when a new launcher process starts; an already running proxy retains the code it loaded.

For an isolated comparison, use a new disposable workspace and a tiny request without tools. Compare native Codex with Pilot constrained to the same physical model. Check the Pilot ledger for a completed response **and a matching served model**: a successful CLI exit alone does not prove the request crossed the proxy. A fresh short request cannot establish that long histories, tools, compaction or resume are compatible.

## Local diagnostic records

New launcher records include `session_start.runtimeVersion`. Request and response records contain a process-salted `turnHash` and a bounded `requestKind` when the CLI supplies them. The original turn ID, metadata blob, project information and tool inventory are not recorded.

Response records distinguish:

| `streamEnd` | Observation |
| --- | --- |
| `completed` | Successful terminal event observed |
| `provider-error` | Upstream `error` or `response.failed` event observed |
| `provider-incomplete` | Upstream `response.incomplete` observed |
| `http-error` | Upstream HTTP error response |
| `transport-error` | Fetch or stream transport threw an error |
| `client-aborted` | The downstream client closed before the transport failure was caught |
| `eof` | Stream ended without a recognized terminal event |

When available, `upstreamRequestId` retains a validated provider identifier. `upstreamEvent`, `upstreamErrorType`, `upstreamErrorCode`, `transportErrorName` and `transportErrorCode` retain allowlisted diagnostic values. Unknown codes stay `unknown`. Provider error messages, response bodies and authentication headers are never saved. Both upstream-error and transport evidence can be retained if a connection fails after an error event.

Records are local and are not automatically uploaded. Inspect them before sharing. Older records lack these fields; missing values cannot be reconstructed. Explicitly incomplete inference responses still count as failed/interrupted responses even when an older record has HTTP 200 and no error field. This count does not attribute fault to a provider or Pilot.

Pilot does not retry or resend the interrupted request with another model. On a later new user turn, the existing previous-failure policy may raise the route within scope. Codex may perform its own retries. Keep those attempts in usage and reliability comparisons. See the [compatibility limits](compatibility.md) and [validation plan](validation.md).
