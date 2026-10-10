// Diagnostic values are enums or validated identifiers, never provider messages.
const TYPES = new Set(['server_error', 'invalid_request_error', 'authentication_error', 'permission_error', 'not_found_error', 'rate_limit_error', 'overloaded_error', 'api_error', 'timeout_error', 'billing_error']);
const CODES = new Set(['server_error', 'internal_error', 'internal_server_error', 'invalid_prompt', 'invalid_request_error', 'context_length_exceeded', 'rate_limit_exceeded', 'insufficient_quota', 'model_not_found', 'model_not_supported', 'unsupported_parameter', 'invalid_value', 'invalid_api_key', 'authentication_error', 'permission_denied', 'request_timeout', 'timeout', 'overloaded_error', 'capacity_exceeded', 'model_capacity_exceeded', 'max_output_tokens', 'content_filter', 'safety_violation', 'billing_hard_limit_reached']);
const TRANSPORT_NAMES = new Set(['Error', 'TypeError', 'AbortError', 'TimeoutError']);
const TRANSPORT_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNABORTED', 'ERR_STREAM_PREMATURE_CLOSE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_ABORTED', 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH', 'UND_ERR_HEADERS_OVERFLOW']);
const EVENTS = new Set(['error', 'response.failed', 'response.incomplete']);
const ENDS = new Set(['completed', 'provider-error', 'provider-incomplete', 'http-error', 'transport-error', 'client-aborted', 'eof']);
const KINDS = new Set(['turn', 'compaction', 'memory', 'prewarm']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bounded = (value, values) => value == null ? null : typeof value === 'string' && values.has(value) ? value : 'unknown';

export function safeRequestId(value) {
  return typeof value === 'string' && value.trim() === value && (UUID.test(value) || /^req_[A-Za-z0-9]{16,80}$/.test(value)) ? value : null;
}
export function requestIdInMessage(message) {
  if (typeof message !== 'string') return null;
  const match = message.slice(0, 4096).match(/\brequest[ _-]?id\s*[:=]?\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
  return match && UUID.test(match[1]) ? match[1] : null;
}
export const requestKind = value => bounded(value ?? 'unknown', KINDS);
export function requestCorrelation(body, headers, hash) {
  const parse = value => {
    if (typeof value !== 'string' || value.length > 65536) return null;
    try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null; }
    catch { return null; }
  };
  // Codex keeps request_kind inside this JSON string, rather than its flat map.
  // Read only these two fields; the blob can also contain private workspace data.
  const sources = [parse(body.client_metadata?.['x-codex-turn-metadata']), parse(headers?.['x-codex-turn-metadata']), body.client_metadata];
  const turnId = sources.map(source => source?.turn_id).find(value => typeof value === 'string' && value.length > 0 && value.length <= 256);
  const kind = sources.map(source => source?.request_kind).find(value => KINDS.has(value));
  return { turnHash: turnId ? hash(['turn-id', turnId]) : null, requestKind: requestKind(kind) };
}
export function safeRuntimeVersion(value) {
  if (typeof value !== 'string' || value.length > 128 || value.trim() !== value) return null;
  const match = value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  return match && !(match[4]?.split('.').some(id => /^\d+$/.test(id) && id.length > 1 && id.startsWith('0'))) ? value : null;
}
export function transportDiagnostics(error) {
  return sanitizeDiagnostics({ transportErrorName: error?.name, transportErrorCode: error?.cause?.code ?? error?.code });
}
// Reapply this boundary when writing the ledger, even for direct logger callers.
export function sanitizeDiagnostics(data) {
  const output = {};
  for (const [field, values] of [['upstreamEvent', EVENTS], ['upstreamErrorType', TYPES], ['upstreamErrorCode', CODES], ['transportErrorName', TRANSPORT_NAMES], ['transportErrorCode', TRANSPORT_CODES], ['streamEnd', ENDS], ['requestKind', KINDS]]) {
    if (Object.hasOwn(data, field)) output[field] = bounded(data[field], values);
  }
  if (Object.hasOwn(data, 'upstreamRequestId')) output.upstreamRequestId = safeRequestId(data.upstreamRequestId);
  if (Object.hasOwn(data, 'turnHash')) output.turnHash = typeof data.turnHash === 'string' && data.turnHash.length === 24 && /^[0-9a-f]{24}$/.test(data.turnHash) ? data.turnHash : null;
  if (Object.hasOwn(data, 'runtimeVersion')) output.runtimeVersion = safeRuntimeVersion(data.runtimeVersion);
  return output;
}
