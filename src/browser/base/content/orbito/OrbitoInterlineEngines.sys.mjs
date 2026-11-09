/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Interline's providers (OrbitoInterline.sys.mjs): one request to Claude
 * Messages, OpenAI-compatible Chat Completions or Google, streamed or not,
 * and the pure pieces around it: which engine the settings mean, retry,
 * splitting a streamed "%%" batch, and the cache's keys and LRU. Nothing
 * here keeps state or knows about tabs. HTTP status is turned into
 * InterlineError here and nowhere else.
 *
 * Parent process only: engines carry API keys.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  SSEParser: "chrome://browser/content/orbito/OrbitoSSE.sys.mjs",
});

// Bumped when the prompts change, so the cache does not serve answers to
// an older prompt (part of engineKey).
export const PROMPT_VERSION = 1;
export const BATCH_SEPARATOR = "\n\n%%\n\n";
// Non-streamed: the whole request. Streamed: between two chunks.
const REQUEST_TIMEOUT_MS = 30000;
const IDLE_TIMEOUT_MS = 30000;
const RETRY_ATTEMPTS = 3; // in total
const RETRY_GAP_MS = 500;
// The free Google endpoint takes the text in the URL.
const GOOGLE_FREE_MAX_CHARS = 1800;

export const PREF_BRANCH = "orbito.interline.";
export const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  claude: "claude-haiku-4-5-20251001",
};
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const CLAUDE_DEFAULT_BASE_URL = "https://api.anthropic.com";
const GOOGLE_FREE_BASE_URL = "https://translate.googleapis.com";
const GOOGLE_CLOUD_BASE_URL = "https://translation.googleapis.com";

/** OrbitoSecrets realms of the translation keys, by engine. */
export const REALMS = {
  openai: "Interline OpenAI API Key",
  claude: "Interline Anthropic API Key",
  google: "Interline Google API Key",
};
/** The Assistant's key, only read: the inherited OpenAI-compatible endpoint. */
export const ASSISTANT_OPENAI_REALM = "OpenAI API Key";

/**
 * @typedef {{kind: "claude", baseURL: string, model: string, apiKey: string}
 *         | {kind: "openai", baseURL: string, model: string, apiKey: string}
 *         | {kind: "google", baseURL: string, apiKey: string}} Engine
 *   An OpenAI-compatible apiKey may be "" (local servers). A Google apiKey
 *   of "" means the free gtx endpoint; its baseURL "" means Google's own
 *   hosts (tests set another).
 */

/**
 * @typedef {"needs-key"|"auth"|"bad-request"|"rate-limit"|"server"|"network"|"bad-response"|"too-long"|"gone"} ErrorKind
 */

const RETRYABLE = new Set(["rate-limit", "server", "network", "bad-response"]);

/**
 * What a translation may go wrong with, in the terms callers act on. The
 * only classification of errors outside this module is `kind`.
 */
export class InterlineError extends Error {
  /**
   * @param {ErrorKind} kind
   * @param {string} [message] English, for logs; the UI's words come from kind.
   */
  constructor(kind, message = kind) {
    super(message);
    this.name = "InterlineError";
    this.kind = kind;
  }

  get retryable() {
    return RETRYABLE.has(this.kind);
  }

  /** What a child gets: {kind, retryable}. */
  toJSON() {
    return { kind: this.kind, retryable: this.retryable };
  }
}

function errorForStatus(status, detail) {
  let kind =
    status == 401 || status == 403
      ? "auth"
      : status == 429
        ? "rate-limit"
        : status >= 500
          ? "server"
          : "bad-request";
  return new InterlineError(kind, `HTTP ${status}${detail ? `: ${detail}` : ""}`);
}

/** Without a trailing slash, and without "/chat/completions" if pasted. */
export function normalizeBaseURL(raw) {
  return String(raw)
    .trim()
    .replace(/\/chat\/completions\/?$/, "")
    .replace(/\/+$/, "");
}

/**
 * The engine the settings mean. Pure over a snapshot, so the fallback rule
 * is tested without prefs or the password manager.
 *
 * The OpenAI-compatible endpoint is one unit: when both its base URL pref
 * and its own key are empty it is the Assistant's (orbito.assistant.baseURL,
 * the "OpenAI API Key" secret, and orbito.interline.openai.model or else
 * orbito.assistant.model); otherwise it is entirely its own. The
 * Assistant's key is never paired with another base URL.
 *
 * @param {{prefs: Record<string, string>, secrets: Record<string, string>}} snapshot
 *   prefs by full name, secrets by realm.
 * @returns {Engine}
 * @throws {InterlineError} needs-key for Claude without a key.
 */
export function resolveEngine({ prefs, secrets }) {
  let pref = name => String(prefs[name] ?? "").trim();
  let own = name => pref(PREF_BRANCH + name);
  let secret = realm => String(secrets[realm] ?? "").trim();
  switch (own("engine")) {
    case "claude": {
      let apiKey = secret(REALMS.claude);
      if (!apiKey) {
        throw new InterlineError("needs-key", "Claude needs an API key");
      }
      return {
        kind: "claude",
        baseURL: normalizeBaseURL(own("claude.baseURL") || CLAUDE_DEFAULT_BASE_URL),
        model: own("claude.model") || DEFAULT_MODELS.claude,
        apiKey,
      };
    }
    case "openai": {
      let baseURL = own("openai.baseURL");
      let apiKey = secret(REALMS.openai);
      if (!baseURL && !apiKey) {
        return {
          kind: "openai",
          baseURL: normalizeBaseURL(
            pref("orbito.assistant.baseURL") || OPENAI_DEFAULT_BASE_URL
          ),
          model:
            own("openai.model") ||
            pref("orbito.assistant.model") ||
            DEFAULT_MODELS.openai,
          apiKey: secret(ASSISTANT_OPENAI_REALM),
        };
      }
      return {
        kind: "openai",
        baseURL: normalizeBaseURL(baseURL || OPENAI_DEFAULT_BASE_URL),
        model: own("openai.model") || DEFAULT_MODELS.openai,
        apiKey,
      };
    }
    default:
      return {
        kind: "google",
        baseURL: normalizeBaseURL(own("google.baseURL")),
        apiKey: secret(REALMS.google),
      };
  }
}

/** The cache and queue identity of an engine: never includes the key. */
export function engineKey(engine) {
  let endpoint =
    engine.kind == "google"
      ? `${engine.apiKey ? "cloud" : "free"}:${engine.baseURL}`
      : engine.baseURL;
  return `${engine.kind}|${endpoint}|${engine.model ?? ""}|${PROMPT_VERSION}`;
}

/** Whether texts may be joined with "%%" for this engine (not Google). */
export function batches(engine) {
  return engine.kind != "google";
}

/** One translation in the cache: the same text, engine and language. */
export function cacheKey(engineKeyValue, targetLang, text) {
  return `${engineKeyValue}\0${targetLang}\0${text}`;
}

/**
 * One batch: private and normal requests never share one, nor do two
 * sites' (one's text could steer the answer the other gets).
 */
export function queueKey(engineKeyValue, targetLang, isPrivate, origin = "") {
  return `${engineKeyValue}\0${targetLang}\0${isPrivate ? 1 : 0}\0${origin}`;
}

/**
 * A Map in recency order, bounded by entries and by the characters of its
 * keys and values.
 */
export class LRU {
  #map = new Map();
  #chars = 0;

  /** @param {{maxEntries: number, maxChars: number}} limits */
  constructor({ maxEntries, maxChars }) {
    this.maxEntries = maxEntries;
    this.maxChars = maxChars;
  }

  get size() {
    return this.#map.size;
  }

  /** @returns {string|undefined} The value, now the newest. */
  get(key) {
    let value = this.#map.get(key);
    if (value !== undefined) {
      this.#map.delete(key);
      this.#map.set(key, value);
    }
    return value;
  }

  set(key, value) {
    this.#remove(key);
    let chars = key.length + value.length;
    if (chars > this.maxChars) {
      return;
    }
    this.#map.set(key, value);
    this.#chars += chars;
    for (let oldest of this.#map.keys()) {
      if (this.#map.size <= this.maxEntries && this.#chars <= this.maxChars) {
        break;
      }
      this.#remove(oldest);
    }
  }

  clear() {
    this.#map.clear();
    this.#chars = 0;
  }

  #remove(key) {
    let value = this.#map.get(key);
    if (value !== undefined) {
      this.#map.delete(key);
      this.#chars -= key.length + value.length;
    }
  }
}

/** A language tag's English name for the model, e.g. "Korean" for "ko". */
export function languageName(tag) {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) || tag;
  } catch {
    return tag;
  }
}

/** The language code Google takes for a tag: "ko", "zh-CN", "zh-TW". */
export function googleLanguage(tag) {
  let locale;
  try {
    locale = new Intl.Locale(tag);
  } catch {
    return tag;
  }
  if (locale.language == "zh") {
    let traditional =
      locale.script == "Hant" || ["TW", "HK", "MO"].includes(locale.region);
    return traditional ? "zh-TW" : "zh-CN";
  }
  return locale.language;
}

const SINGLE_SYSTEM_PROMPT = `You are a professional {{targetLang}} native translator who fluently translates text into {{targetLang}}. Follow these rules:
1. Output only the translated content, without explanations or additional content (such as "Here is the translation:" or "Translation as follows:")
2. If the original text uses \`%%\` as separators between paragraphs, keep \`%%\` and the surrounding blank lines in the exact same positions in the translation; do not merge, split, or reorder any paragraphs even if a segment is incomplete
3. Translate each \`%%\`-delimited chunk independently and base the output only on that chunk; even if the meaning is incomplete, do not fill it with content from other chunks and do not move punctuation or words between chunks
4. If the text contains HTML tags, maintain correct tag placement after translation and ensure the translation flows naturally
5. For content that should not be translated (such as proper nouns, code, etc.), keep the original text`;

const BATCH_SYSTEM_PROMPT = `You are a professional {{targetLang}} native translator who needs to fluently translate text into {{targetLang}}.

## Translation Rules
1. Output only the translated content, without explanations or additional content (such as "Here is the translation:" or "Translation as follows:")
2. The returned translation must maintain exactly the same number of paragraphs and format as the original text
3. If the original text uses \`%%\` as separators between paragraphs, you must keep \`%%\` and the surrounding blank lines in exactly the same positions in the translation, and you must not merge, split, or reorder any paragraphs even if a segment is incomplete
4. Translate each \`%%\`-delimited chunk independently, basing your output solely on the text inside that chunk; even if the meaning is incomplete, do not complete it with content from other chunks and do not move punctuation or words between chunks
5. If the text contains HTML tags, consider where the tags should be placed in the translation while maintaining fluency
6. For content that should not be translated (such as proper nouns, code, etc.), keep the original text

## Input/Output Format Examples

### Input Example:
Paragraph A

%%

Paragraph B

### Output Example:
Translation A

%%

Translation B`;

/** The system prompt (English, ADR 0002), single or batch. */
export function systemPrompt(targetLang, { batch = false } = {}) {
  return (batch ? BATCH_SYSTEM_PROMPT : SINGLE_SYSTEM_PROMPT).replaceAll(
    "{{targetLang}}",
    languageName(targetLang)
  );
}

/** The user prompt. */
export function userPrompt(text, targetLang, { batch = false } = {}) {
  let name = languageName(targetLang);
  return batch
    ? `Translate to ${name}:\n\n${text}`
    : `Translate to ${name} (output translation only):\n\n${text}`;
}

/**
 * Runs fn up to RETRY_ATTEMPTS times, RETRY_GAP_MS apart, while the error
 * is retryable and the signal has not aborted.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {(ms: number) => Promise<void>} [options.sleep] Tests pass a fake.
 * @returns {Promise<T>}
 */
export async function withRetry(fn, { signal, sleep = wait } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      let retry =
        error instanceof InterlineError &&
        error.retryable &&
        attempt < RETRY_ATTEMPTS &&
        !signal?.aborted;
      if (!retry) {
        throw error;
      }
      await sleep(RETRY_GAP_MS);
    }
  }
}

function wait(ms) {
  return new Promise(resolve => lazy.setTimeout(resolve, ms));
}

/**
 * Splits the streamed answer to a "%%" batch of `count` units.
 *
 * push(accumulated) returns the updates the text so far makes: every part
 * before the last one seen is final ({index, text, done: true}, once per
 * index); the last is a preview ({done: false}). A trailing /%+\s*$/ is
 * held back so a half-arrived separator is never shown. A text shorter
 * than before (a retry started the stream over) needs nothing special:
 * finished parts are never given again.
 *
 * end(full) returns all `count` parts, or null when the answer does not
 * split into exactly `count` (the caller falls back to single requests for
 * the parts not finished).
 */
export class PercentSplit {
  #count;
  #finished = new Set();

  constructor(count) {
    this.#count = count;
  }

  /** @returns {{index: number, text: string, done: boolean}[]} */
  push(accumulated) {
    let parts = accumulated.replace(/%+\s*$/, "").split(/\s*%%\s*/);
    let last = parts.length - 1;
    let updates = [];
    for (let i = 0; i < parts.length && i < this.#count; i++) {
      if (this.#finished.has(i)) {
        continue;
      }
      let text = parts[i].trim();
      if (i < last) {
        this.#finished.add(i);
        updates.push({ index: i, text, done: true });
      } else if (text) {
        updates.push({ index: i, text, done: false });
      }
    }
    return updates;
  }

  /** @returns {string[] | null} */
  end(full) {
    let parts = full.split(/\s*%%\s*/).map(part => part.trim());
    if (parts.length == this.#count + 1 && !parts.at(-1)) {
      parts.pop();
    }
    return parts.length == this.#count ? parts : null;
  }
}

/**
 * One provider call.
 *
 * @param {Engine} engine
 * @param {string} text One unit, or units joined with BATCH_SEPARATOR.
 * @param {object} options
 * @param {string} options.targetLang BCP 47.
 * @param {boolean} [options.batch] Use the batch prompt.
 * @param {(accumulated: string) => void} [options.onText] Streams when
 *   given (not for Google): called with the whole text so far.
 * @param {AbortSignal} [options.signal] Aborting it rejects with "gone".
 * @returns {Promise<string>} The translation, trimmed.
 * @throws {InterlineError}
 */
export async function request(engine, text, options) {
  switch (engine.kind) {
    case "claude":
      return claude(engine, text, options);
    case "openai":
      return openAI(engine, text, options);
    case "google":
      return google(engine, text, options);
  }
  throw new InterlineError("bad-request", `Unknown engine ${engine.kind}`);
}

async function claude(engine, text, { targetLang, batch, onText, signal }) {
  let body = {
    model: engine.model,
    // As much for one paragraph as for a batch: less would cut a long
    // paragraph short, and the short answer would be cached.
    max_tokens: 8192,
    system: systemPrompt(targetLang, { batch }),
    messages: [{ role: "user", content: userPrompt(text, targetLang, { batch }) }],
  };
  let url = `${engine.baseURL}/v1/messages`;
  let headers = {
    "x-api-key": engine.apiKey,
    "anthropic-version": "2023-06-01",
    // The request comes from the browser, which the API refuses unless told.
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (onText) {
    return stream(
      url,
      headers,
      { ...body, stream: true },
      signal,
      onText,
      readClaudeEvent
    );
  }
  let data = await fetchJSON(url, { method: "POST", headers, body }, signal);
  let block = Array.isArray(data?.content)
    ? data.content.find(b => b?.type == "text")
    : null;
  return answer(block?.text);
}

function readClaudeEvent(event) {
  if (event.type == "error") {
    let message = event.error?.message || "Stream error";
    throw new InterlineError("server", message);
  }
  let text =
    event.type == "content_block_delta" && event.delta?.type == "text_delta"
      ? event.delta.text
      : "";
  return { text, end: event.type == "message_stop" };
}

async function openAI(engine, text, { targetLang, batch, onText, signal }) {
  let body = {
    model: engine.model,
    messages: [
      { role: "system", content: systemPrompt(targetLang, { batch }) },
      { role: "user", content: userPrompt(text, targetLang, { batch }) },
    ],
  };
  let url = `${engine.baseURL}/chat/completions`;
  let headers = engine.apiKey ? { Authorization: `Bearer ${engine.apiKey}` } : {};
  if (onText) {
    return stream(
      url,
      headers,
      { ...body, stream: true },
      signal,
      onText,
      event => ({
        text: event.choices?.[0]?.delta?.content || "",
        end: !!event.choices?.[0]?.finish_reason,
      })
    );
  }
  let data = await fetchJSON(url, { method: "POST", headers, body }, signal);
  return answer(data?.choices?.[0]?.message?.content);
}

async function google(engine, text, { targetLang, signal }) {
  let tl = googleLanguage(targetLang);
  if (engine.apiKey) {
    let url = new URL(
      `${engine.baseURL || GOOGLE_CLOUD_BASE_URL}/language/translate/v2`
    );
    url.searchParams.set("key", engine.apiKey);
    let data = await fetchJSON(
      url.href,
      { method: "POST", body: { q: text, target: tl, format: "text" } },
      signal
    );
    return answer(data?.data?.translations?.[0]?.translatedText);
  }
  let pieces = [];
  for (let chunk of splitForGet(text, GOOGLE_FREE_MAX_CHARS)) {
    let url = new URL(`${engine.baseURL || GOOGLE_FREE_BASE_URL}/translate_a/single`);
    for (let [name, value] of Object.entries({
      client: "gtx",
      sl: "auto",
      tl,
      dt: "t",
      q: chunk,
    })) {
      url.searchParams.set(name, value);
    }
    let data = await fetchJSON(url.href, {}, signal);
    if (!Array.isArray(data?.[0])) {
      throw new InterlineError("bad-response", "Google answered no sentences");
    }
    pieces.push(data[0].map(sentence => sentence?.[0] ?? "").join(""));
  }
  return answer(pieces.join(" "));
}

/** Text in pieces of at most maxChars, cut at sentence ends when it can. */
export function splitForGet(text, maxChars) {
  if (text.length <= maxChars) {
    return [text];
  }
  let chunks = [];
  let current = "";
  for (let sentence of text.split(/(?<=[.!?。！？])\s+/)) {
    for (let i = 0; i < sentence.length; i += maxChars) {
      let piece = sentence.slice(i, i + maxChars);
      if (current && current.length + 1 + piece.length > maxChars) {
        chunks.push(current);
        current = piece;
      } else {
        current = current ? `${current} ${piece}` : piece;
      }
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function answer(text) {
  if (typeof text != "string") {
    throw new InterlineError("bad-response", "No text in the answer");
  }
  return text.trim();
}

/**
 * An AbortController that aborts with the caller's signal and after
 * `timeout` ms; restart() starts the timeout over.
 */
function deadline(signal, timeout) {
  let controller = new AbortController();
  let timedOut = false;
  let timer = 0;
  let restart = () => {
    lazy.clearTimeout(timer);
    timer = lazy.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);
  };
  let onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  if (signal?.aborted) {
    controller.abort();
  }
  restart();
  return {
    signal: controller.signal,
    restart,
    // What a failure of fetch() or of reading means.
    error(error) {
      if (error instanceof InterlineError) {
        return error;
      }
      if (signal?.aborted && !timedOut) {
        return new InterlineError("gone", "Cancelled");
      }
      return new InterlineError("network", String(error?.message || error));
    },
    done() {
      lazy.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

async function send(url, { method = "GET", headers = {}, body }, signal) {
  let response = await fetch(url, {
    method,
    headers:
      body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
    credentials: "omit",
  });
  if (!response.ok) {
    let detail = "";
    try {
      let raw = await response.text();
      try {
        let parsed = JSON.parse(raw);
        detail = parsed?.error?.message ?? parsed?.message ?? "";
      } catch {}
      detail ||= raw.slice(0, 200);
    } catch {}
    throw errorForStatus(response.status, String(detail));
  }
  return response;
}

async function fetchJSON(url, init, signal) {
  let timing = deadline(signal, REQUEST_TIMEOUT_MS);
  try {
    let response = await send(url, init, timing.signal);
    let raw = await response.text();
    try {
      return JSON.parse(raw);
    } catch {
      throw new InterlineError("bad-response", "The answer is not JSON");
    }
  } catch (error) {
    throw timing.error(error);
  } finally {
    timing.done();
  }
}

/**
 * A streamed answer. read(event) gives an event's text and whether it is
 * the provider's last one, or throws for an error event: a stream that
 * stops before its last event is cut short, not done.
 *
 * @param {(event: object) => {text: string, end: boolean}} read
 */
async function stream(url, headers, body, signal, onText, read) {
  let timing = deadline(signal, IDLE_TIMEOUT_MS);
  let full = "";
  let reader = null;
  try {
    let response = await send(url, { method: "POST", headers, body }, timing.signal);
    if (!response.body) {
      throw new InterlineError("bad-response", "The stream has no body");
    }
    let parser = new lazy.SSEParser();
    reader = response.body.getReader();
    let decoder = new TextDecoder();
    let finished = false;
    let ended = false;
    let handle = events => {
      for (let { data } of events) {
        if (data == "[DONE]") {
          finished = ended = true;
          return;
        }
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        let { text, end } = read(event);
        ended ||= end;
        if (text) {
          full += text;
          onText(full);
        }
      }
    };
    while (!finished) {
      let { done, value } = await reader.read();
      if (done) {
        handle(parser.end());
        break;
      }
      timing.restart();
      handle(parser.push(decoder.decode(value, { stream: true })));
    }
    if (finished) {
      reader.cancel().catch(() => {});
    }
    if (!ended) {
      throw new InterlineError("network", "The stream ended early");
    }
  } catch (error) {
    reader?.cancel().catch(() => {});
    throw timing.error(error);
  } finally {
    timing.done();
  }
  if (!full.trim()) {
    throw new InterlineError("bad-response", "The stream had no text");
  }
  return full.trim();
}
