// Reads token usage out of an upstream response as it streams past, without changing a byte.
// Understands Anthropic Messages (SSE and JSON) and OpenAI Responses (SSE and JSON).

/** @import { Price, RawUsage, Usage } from './types.js' */

/**
 * The parts of a response, or of one streamed event, that carry the model and its usage:
 * Anthropic's message_start and message_delta, OpenAI's response.completed and response.incomplete.
 * @typedef {object} UsageEvent
 * @property {string} [type]
 * @property {string} [model]
 * @property {RawUsage} [usage]
 * @property {{ model?: string, usage?: RawUsage }} [message]
 * @property {{ model?: string, usage?: RawUsage }} [response]
 */

const MAX_JSON_BYTES = 8 * 1024 * 1024;

/** Collects the usage of one upstream response from the chunks the router relays. */
export class UsageTap {
  /** @param {string} [contentType] the response's content-type */
  constructor(contentType = '') {
    this.sse = contentType.includes('text/event-stream');
    this.decoder = new TextDecoder();
    this.pending = '';
    this.json = '';
    /** @type {RawUsage} */
    this.raw = {};
    /** @type {string | undefined} */
    this.model = undefined;
    this.completed = false;
  }

  /**
   * Reads one chunk of the response body. Chunks may split lines and UTF-8 characters anywhere.
   * @param {Uint8Array} chunk
   */
  push(chunk) {
    const text = this.decoder.decode(chunk, { stream: true });
    if (!this.sse) {
      if (this.json.length < MAX_JSON_BYTES) this.json += text;
      return;
    }
    const lines = (this.pending + text).split('\n');
    this.pending = lines.pop() ?? '';
    // A line with no end in sight carries no usage the tap can read; it must not grow without bound.
    if (this.pending.length > MAX_JSON_BYTES) this.pending = '';
    for (const line of lines) if (line.startsWith('data:')) this.#event(line.slice(5).trim());
  }

  /** @param {string} data */
  #event(data) {
    if (!data || data === '[DONE]') return;
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    // `data: null` must not throw: an exception here would cut the stream the client is reading.
    if (!parsed || typeof parsed !== 'object') return;
    /** @type {UsageEvent} */
    const event = parsed;
    if (event.type === 'message_start') {
      this.model = event.message?.model;
      Object.assign(this.raw, event.message?.usage);
    } else if (event.type === 'message_delta') Object.assign(this.raw, event.usage);
    else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
      this.completed = event.type === 'response.completed';
      this.model = event.response?.model;
      Object.assign(this.raw, event.response?.usage);
    } else if (event.type === 'message_stop') this.completed = true;
  }

  /**
   * The usage the response reported, with `input` counting uncached input tokens only.
   * @returns {Usage | undefined} undefined when the response carried no usage
   */
  result() {
    if (this.sse && this.pending.startsWith('data:')) this.#event(this.pending.slice(5).trim());
    if (!this.sse && this.json) {
      try {
        /** @type {UsageEvent} */
        const body = JSON.parse(this.json);
        this.model = body.model;
        this.completed = body.status === 'completed' || Boolean(body.stop_reason);
        Object.assign(this.raw, body.usage);
      } catch {
        /* not JSON, or cut off */
      }
    }
    const u = this.raw;
    if (u.input_tokens === undefined && u.output_tokens === undefined) return undefined;
    const cached = u.cache_read_input_tokens ?? u.input_tokens_details?.cached_tokens ?? 0;
    const responsesApi = u.input_tokens_details !== undefined;
    return {
      input: Math.max(0, (u.input_tokens ?? 0) - (responsesApi ? cached : 0)),
      cacheRead: cached,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      output: u.output_tokens ?? 0,
    };
  }
}

/**
 * Estimated USD for one request. A dated model name ("-20251001") falls back to the undated price.
 * @param {string} model
 * @param {Usage | undefined} usage
 * @param {Record<string, Price>} prices USD per million tokens, by model
 * @returns {number | undefined} undefined for a model without a price, or a response without usage
 */
export function costOf(model, usage, prices) {
  if (!usage || !model) return undefined;
  const p = prices[model] ?? prices[model.replace(/-\d{8}$/, '')];
  if (!p) return undefined;
  const usd =
    (usage.input * p.in + usage.cacheRead * (p.cacheRead ?? p.in) + usage.cacheWrite * (p.cacheWrite ?? p.in) + usage.output * p.out) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}
