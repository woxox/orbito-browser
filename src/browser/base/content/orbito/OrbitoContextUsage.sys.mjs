/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * How much of the model's context window a Thread's next question
 * takes, estimated from what the core sends with it: the system prompt, the
 * tool definitions, what it shares of its window, and the history, split
 * into what the tabs gave (what is shared and the results of the tools that
 * read them) and the rest of the Thread.
 * The question itself is not counted, since it is not written yet.
 * Past a share of the window, pruneHistory() leaves the oldest page results
 * out of what is sent.
 */

import { userPrompt } from "./OrbitoHistory.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

// The tools whose results are what tabs hold.
const TAB_TOOLS = new Set(["get_page_text", "read_page", "list_tabs"]);

/** The window of a model this module does not know, in tokens. */
export const DEFAULT_CONTEXT_WINDOW = 128000;

// Model id patterns and their windows, first match wins.
const CONTEXT_WINDOWS = [
  [/^claude-/, 200000],
  [/^gpt-4\.1/, 1047576],
  [/^gpt-(?:[5-9]|\d\d)/, 400000],
  [/^o\d/, 200000],
];

/**
 * The context window of a model, in tokens.
 *
 * @param {?string} model The model id.
 * @returns {number}
 */
export function contextWindow(model) {
  let id = String(model ?? "").toLowerCase();
  return (
    CONTEXT_WINDOWS.find(([pattern]) => pattern.test(id))?.[1] ??
    DEFAULT_CONTEXT_WINDOW
  );
}

/**
 * The first of values that is a context window, a positive whole number of
 * tokens, or null.
 *
 * @param {...any} values As an endpoint gave them.
 * @returns {?number}
 */
export function firstWindow(...values) {
  return values.find(value => Number.isInteger(value) && value > 0) ?? null;
}

// How long to wait for an endpoint to tell a model's window, in ms: a
// question may wait for it.
const FETCH_TIMEOUT = 3000;
// How long to wait for an endpoint to list its models, in ms: a long list
// (OpenRouter's) takes a while.
export const CATALOG_TIMEOUT = 15000;
// How long a window that could not be fetched is not asked for again, in ms.
const WINDOW_RETRY_AFTER = 60000;
// Windows asked for, by key: {at, failed, promise}.
const fetchedWindows = new Map();

/**
 * Asks an endpoint about its models (their windows, or which there are),
 * giving up after timeout.
 *
 * @param {string} url
 * @param {object} [options] As fetch() takes them.
 * @param {number} [timeout] In ms.
 * @returns {Promise<any>} The JSON answered.
 * @throws {Error} When the endpoint did not answer, or not with 2xx.
 */
export async function fetchModelsJSON(url, options = {}, timeout = FETCH_TIMEOUT) {
  let controller = new AbortController();
  let timer = lazy.setTimeout(() => controller.abort(), timeout);
  try {
    let response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${url}: HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    lazy.clearTimeout(timer);
  }
}

/**
 * A model's context window as fetch() gives it, fetched once a session for
 * the key, or again a minute after it failed. Resolves to null when fetch()
 * gives none or fails.
 *
 * @param {string} key What the window depends on: the backend, its
 *   endpoint and the model.
 * @param {Function} fetch Async, gives the window or null; throws when the
 *   endpoint could not tell, e.g. offline.
 * @returns {Promise<?number>}
 */
export function cachedContextWindow(key, fetch) {
  let entry = fetchedWindows.get(key);
  if (!entry || (entry.failed && Date.now() - entry.at > WINDOW_RETRY_AFTER)) {
    entry = { at: Date.now(), failed: false };
    entry.promise = fetch().then(
      window => firstWindow(window),
      e => {
        console.warn(`Orbito: no context window for ${key}:`, e);
        entry.failed = true;
        return null;
      }
    );
    fetchedWindows.set(key, entry);
  }
  return entry.promise;
}

/**
 * About how many tokens a text is: four ASCII characters a token, and one
 * for every other character (most CJK characters take one or more).
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  let ascii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) {
      ascii++;
    }
  }
  return Math.ceil(ascii / 4) + (text.length - ascii);
}

/**
 * The estimate, by part. parts are, in this order, {id, tokens} with id
 * "system", "tools", "tabs" and "history"; used is their sum, free what is
 * left of the window (never below 0) and total the window.
 *
 * @param {object} options
 * @param {string} options.system The system prompt.
 * @param {object[]} options.tools {name, description, schema}.
 * @param {object[]} options.history The messages sent, as budgetHistory
 *   (OrbitoHistory.sys.mjs) leaves them.
 * @param {string} [options.shared] What the question shares of its window
 *   (the tab or tabs and the page), sent with it; see sharedPrompt().
 * @param {number} options.total The context window, in tokens.
 * @returns {{total: number, used: number, free: number,
 *   parts: {id: string, tokens: number}[]}}
 */
export function contextUsage({ system, tools, history, shared = "", total }) {
  let tabs = estimateTokens(shared);
  let rest = 0;
  for (let message of history) {
    if (message.role == "user") {
      rest += estimateTokens(userPrompt(message.parts));
      continue;
    }
    let names = new Map(
      message.parts
        .filter(p => p.type == "tool_call")
        .map(p => [p.id, p.name])
    );
    for (let part of message.parts) {
      if (part.type == "text") {
        rest += estimateTokens(part.text);
      } else if (part.type == "tool_call") {
        rest += estimateTokens(
          part.name + JSON.stringify(part.input ?? {})
        );
      } else if (part.type == "tool_result") {
        let tokens = estimateTokens(part.content);
        if (TAB_TOOLS.has(names.get(part.call_id))) {
          tabs += tokens;
        } else {
          rest += tokens;
        }
      }
    }
  }
  let parts = [
    { id: "system", tokens: estimateTokens(system) },
    {
      id: "tools",
      tokens: estimateTokens(
        JSON.stringify(
          tools.map(({ name, description, schema }) => ({
            name,
            description,
            schema,
          }))
        )
      ),
    },
    { id: "tabs", tokens: tabs },
    { id: "history", tokens: rest },
  ];
  let used = parts.reduce((sum, part) => sum + part.tokens, 0);
  return { total, used, free: Math.max(0, total - used), parts };
}

// The tools whose results are a page as read then, which a later read can
// replace.
const PAGE_TOOLS = new Set(["get_page_text", "read_page", "screenshot"]);

/** What of the window the next question may take before page results go. */
export const DEFAULT_PRUNE_RATIO = 0.8;

function pruned(name, page) {
  let what = page
    ? ` of ${JSON.stringify(page.title || page.url)} (${page.url})`
    : "";
  return `[${name} result${what} removed to save context; read the page again if needed]`;
}

/**
 * The history with the oldest page results (get_page_text, read_page,
 * screenshot) replaced by a short note naming the page, until the next
 * question takes at most ratio of the window, as contextUsage() estimates
 * it. Results a newer read of the same page in the same tab by the same
 * tool supersedes go first; the newest
 * page result and those of the messages in keep stay. Messages are copied,
 * not changed; below the ratio, history is given back as it is.
 *
 * @param {object} usage What contextUsage() takes.
 * @param {object} [options]
 * @param {number} [options.ratio]
 * @param {string[]} [options.keep] The ids of messages whose results stay,
 *   e.g. the reply of a question still running.
 * @returns {object[]}
 */
export function pruneHistory(
  usage,
  { ratio = DEFAULT_PRUNE_RATIO, keep = [] } = {}
) {
  let { history, total } = usage;
  let over = contextUsage(usage).used - Math.floor(total * ratio);
  if (over <= 0) {
    return history;
  }
  // Oldest first.
  let results = [];
  for (let message of history) {
    if (message.role == "user") {
      continue;
    }
    let names = new Map(
      message.parts
        .filter(p => p.type == "tool_call")
        .map(p => [p.id, p.name])
    );
    for (let part of message.parts) {
      let name = names.get(part.call_id);
      if (
        part.type == "tool_result" &&
        !part.is_error &&
        PAGE_TOOLS.has(name)
      ) {
        let { page } = part;
        results.push({
          part,
          name,
          // A later read the same way of the same page in the same tab
          // supersedes it.
          key: page?.tabId != null && `${name} ${page.tabId} ${page.url}`,
          kept: keep.includes(message.id),
        });
      }
    }
  }
  let later = new Set();
  let superseded = new Set();
  for (let i = results.length - 1; i >= 0; i--) {
    let { key } = results[i];
    if (!key) {
      continue;
    }
    if (later.has(key)) {
      superseded.add(results[i]);
    }
    later.add(key);
  }
  // The newest stays.
  results.pop();
  results = results.filter(r => !r.kept);
  let replaced = new Map();
  for (let result of [
    ...results.filter(r => superseded.has(r)),
    ...results.filter(r => !superseded.has(r)),
  ]) {
    if (over <= 0) {
      break;
    }
    let content = pruned(result.name, result.part.page);
    let saved = estimateTokens(result.part.content) - estimateTokens(content);
    if (saved > 0) {
      replaced.set(result.part, { ...result.part, content });
      over -= saved;
    }
  }
  if (!replaced.size) {
    return history;
  }
  return history.map(message =>
    message.parts.some(p => replaced.has(p))
      ? { ...message, parts: message.parts.map(p => replaced.get(p) ?? p) }
      : message
  );
}
