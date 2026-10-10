// Deterministic secret detection. It runs on every human turn before anything leaves the router:
// before Jev sees a prompt, and before a request goes to an upstream that isn't trusted with secrets.
// A regex can't catch every secret, so trust decisions also stay sticky once something is found.

/** @type {Array<[kind: string, pattern: RegExp]>} */
const PATTERNS = [
  ['bearer-token', /\b(?:authorization\s*:\s*)?Bearer\s+[A-Za-z0-9._~+\/-]{8,}/gi],
  ['private-key', /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g],
  ['anthropic-key', /\bsk-ant-(?:api|admin|oat|ort)\d{2}-[A-Za-z0-9_-]{20,}/g],
  ['openrouter-key', /\bsk-or-v1-[A-Za-z0-9]{32,}/g],
  ['openai-key', /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|\bsk-[A-Za-z0-9]{40,}\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['aws-secret-key', /\baws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}\b/gi],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ['gitlab-token', /\bglpat-[A-Za-z0-9_-]{20,}\b/g],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ['stripe-key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['pulumi-token', /\bpul-[a-f0-9]{40}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['url-credentials', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"'<>]+:[^\s/@"'<>]+@/gi],
  // key = value assignments, but not references such as process.env.X, $VAR, ${VAR} or <placeholder>.
  [
    'assignment',
    /\b(?:password|passwd|pwd|secret|client_secret|api[_-]?key|access[_-]?token|auth[_-]?token)["']?\s*[:=]\s*["']?(?!process\.env|os\.environ|os\.getenv|env\.|\$|<|\{\{|\*{3})[^\s"',;)]{8,}/gi,
  ],
];
const ANY = new RegExp(PATTERNS.map(([, re]) => re.source).join('|'), 'i');

/**
 * Cheap check on raw text, including a serialized request body. It may say yes to text without a
 * secret, never no to text with one.
 * @param {string} text
 * @returns {boolean}
 */
export const mayContainSecret = (text) => ANY.test(text);

/**
 * Lists the kind of every secret in `text`, once per occurrence.
 * @param {string} text
 * @returns {string[]}
 */
export function findSecrets(text) {
  /** @type {string[]} */
  const found = [];
  for (const [kind, re] of PATTERNS) for (const _ of text.matchAll(re)) found.push(kind);
  return found;
}

/**
 * Replaces every secret in `text` with `[REDACTED <kind>]`.
 * @param {string} text
 * @returns {{ text: string, count: number }}
 */
export function scrub(text) {
  let count = 0;
  let out = text;
  for (const [kind, re] of PATTERNS)
    out = out.replace(re, () => {
      count += 1;
      return `[REDACTED ${kind}]`;
    });
  return { text: out, count };
}

// Signed reasoning must not change (the signature would no longer verify), and ids, images and
// encrypted payloads carry no prose.
/** @type {ReadonlySet<unknown>} */
const KEEP_TYPES = new Set(['thinking', 'redacted_thinking', 'reasoning']);
const KEEP_KEYS = new Set([
  'id',
  'tool_use_id',
  'call_id',
  'signature',
  'encrypted_content',
  'data',
  'model',
  'type',
  'role',
  'media_type',
]);

/**
 * Replaces secrets anywhere in a request body: prompts, tool results, assistant text, system prompt.
 * @template T
 * @param {T} body
 * @returns {{ body: T, count: number }}
 */
export function redactBody(body) {
  let count = 0;
  /** @type {(value: unknown) => unknown} */
  const walk = (value) => {
    if (typeof value === 'string') {
      const result = scrub(value);
      count += result.count;
      return result.text;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      if ('type' in value && KEEP_TYPES.has(value.type)) return value;
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, KEEP_KEYS.has(k) ? v : walk(v)]));
    }
    return value;
  };
  // walk keeps the shape and only rewrites strings, so the result has the body's type.
  const redacted = /** @type {T} */ (walk(body));
  return { body: redacted, count };
}
