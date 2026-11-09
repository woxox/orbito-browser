/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Interline, page translation (GLOSSARY, ADR 0006): the parent side.
 * actors/OrbitoInterlineChild.sys.mjs is the page side.
 *
 * - each tab's on/off state, kept while the tab moves between pages and
 *   dropped with the tab or at restart;
 * - each document's language, for when the Top bar button shows;
 * - which engine, key and language the settings mean;
 * - translate(text): the cache, "%%" batches shared across callers,
 *   retry and streaming, behind one call any feature may use;
 * - the parent actor, which takes only text from the page and decides
 *   everything else from the state here.
 *
 * Translations are cached in memory only, one LRU for normal windows and
 * one for private ones, which is forgotten with the last private window.
 * Private and normal text never share a provider request either, nor do
 * two sites' texts.
 *
 * Must not touch chrome globals when imported: start() does that.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ASSISTANT_OPENAI_REALM:
    "chrome://browser/content/orbito/OrbitoInterlineEngines.sys.mjs",
  BATCH_SEPARATOR: "chrome://browser/content/orbito/OrbitoInterlineEngines.sys.mjs",
  batches: "chrome://browser/content/orbito/OrbitoInterlineEngines.sys.mjs",
  cacheKey: "chrome://browser/content/orbito/OrbitoInterlineEngines.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  DEFAULT_MODELS: "chrome://browser/content/orbito/OrbitoInterlineEngines.sys.mjs",
  engineKey: "chrome://browser/content/orbito/OrbitoInterlineEngines.sys.mjs",
  InterlineError: "chrome://browser/content/orbito/OrbitoInterlineEngines.sys.mjs",
  LanguageDetector:
    "resource://gre/modules/translations/LanguageDetector.sys.mjs",
  LRU: "chrome://browser/content/orbito/OrbitoInterlineEngines.sys.mjs",
  normalizeBaseURL: "chrome://browser/content/orbito/OrbitoInterlineEngines.sys.mjs",
  OPENAI_DEFAULT_BASE_URL:
    "chrome://browser/content/orbito/OrbitoInterlineEngines.sys.mjs",
  OrbitoL10n: "chrome://browser/content/orbito/OrbitoL10n.sys.mjs",
  OrbitoPages: "chrome://browser/content/orbito/OrbitoPages.sys.mjs",
  OrbitoSecrets: "chrome://browser/content/orbito/OrbitoSecrets.sys.mjs",
  PercentSplit: "chrome://browser/content/orbito/OrbitoInterlineEngines.sys.mjs",
  PREF_BRANCH: "chrome://browser/content/orbito/OrbitoInterlineEngines.sys.mjs",
  primaryLanguage: "chrome://browser/content/orbito/OrbitoSuggestions.sys.mjs",
  queueKey: "chrome://browser/content/orbito/OrbitoInterlineEngines.sys.mjs",
  REALMS: "chrome://browser/content/orbito/OrbitoInterlineEngines.sys.mjs",
  request: "chrome://browser/content/orbito/OrbitoInterlineEngines.sys.mjs",
  resolveEngine: "chrome://browser/content/orbito/OrbitoInterlineEngines.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  withRetry: "chrome://browser/content/orbito/OrbitoInterlineEngines.sys.mjs",
});

const ACTOR = "OrbitoInterline";
const CHANGE_EVENT = "OrbitoInterlineChange";

// The prefs resolveEngine reads, by full name.
const ENGINE_PREFS = [
  "orbito.interline.engine",
  "orbito.interline.openai.baseURL",
  "orbito.interline.openai.model",
  "orbito.interline.claude.model",
  "orbito.interline.claude.baseURL",
  "orbito.interline.google.baseURL",
  "orbito.assistant.baseURL",
  "orbito.assistant.model",
];

const BATCH_WAIT_MS = 250;
const BATCH_MAX_ITEMS = 20;
const BATCH_MAX_CHARS = 6000;
const CACHE_LIMITS = { maxEntries: 5000, maxChars: 4_000_000 };
// What one page may ask at once, and in one unit.
const MAX_UNIT_CHARS = 8000;
const MAX_INFLIGHT_PER_ACTOR = 400;
// What the parent detects a page's language by.
const MAX_SAMPLE_CHARS = 2000;
// Errors that stop a tab rather than one paragraph.
const TAB_FATAL = new Set(["needs-key", "auth", "bad-request"]);

/** @typedef {"off"|"on"|"error"} Status */
/**
 * @typedef {object} TabRecord One per tab, keyed by browser.permanentKey.
 *   No record means off.
 * @property {Status} status
 * @property {InterlineError|null} error Set exactly when status is "error".
 * @property {"off"|"on"} resume What a settings change brings an "error"
 *   tab back to: what it was when the error came.
 * @property {number} inflight Requests from the tab's pages not answered yet.
 * @property {InterlineError|null} warning The latest retryable failure from
 *   the tab's current document while it is on; a later success keeps it.
 */
/**
 * @typedef {object} Desired What a page should show; derived, never stored.
 * @property {"off"|"on"|"halted"} page halted: keep what is shown, ask for
 *   no more.
 * @property {"bilingual"|"replace"} mode
 * @property {string} hoverKey A KeyboardEvent.key, or "" for no hover.
 * @property {number} epoch Changes when the output would; the page starts over.
 */

/**
 * One text waiting in a batch.
 *
 * @typedef {object} Item
 * @property {string} text
 * @property {boolean} private Picks the cache it is written to.
 * @property {string} origin The site it is from: only batched with its own.
 * @property {(accumulated: string) => void} [onDelta]
 * @property {AbortSignal} [signal]
 * @property {string} key Its cache key.
 * @property {(text: string) => void} resolve
 * @property {(error: InterlineError) => void} reject
 * @property {boolean} settled
 */

/**
 * The texts for one engine, language, privacy class and site, sent together
 * after BATCH_WAIT_MS or once full.
 *
 * @typedef {object} Batch
 * @property {string} id Its queueKey.
 * @property {object} engine
 * @property {string} targetLang
 * @property {Item[]} items
 * @property {number} chars
 * @property {number} timer
 */

// State. Each piece has one owner: this module.
const tabs = new WeakMap(); // browser.permanentKey -> TabRecord
// WindowGlobalParent -> {lang}: the <html lang> tag; null while there is
// none and detection has not answered; then the detected tag or "und".
// A new document is a new key, so a language is never stale.
const languages = new WeakMap();
const queues = new Map(); // queueKey -> Batch being filled
// Bumped when the engine, target or mode a page renders with changes.
let epoch = 0;
let basis = null;
const caches = {
  normal: null,
  private: null,
};
// The secrets resolveEngine needs, read once until the password manager
// says a login changed.
let secretsPromise = null;
let started = false;

function cacheFor(isPrivate) {
  let name = isPrivate ? "private" : "normal";
  return (caches[name] ??= new lazy.LRU(CACHE_LIMITS));
}

/** The target language: the pref, or Orbito's UI language. */
export function currentTarget() {
  return (
    Services.prefs.getStringPref(lazy.PREF_BRANCH + "targetLang", "").trim() ||
    lazy.OrbitoL10n.language
  );
}

function readSecrets() {
  secretsPromise ??= (async () => {
    let secrets = {};
    for (let realm of [
      ...Object.values(lazy.REALMS),
      lazy.ASSISTANT_OPENAI_REALM,
    ]) {
      secrets[realm] = await lazy.OrbitoSecrets.get(realm);
    }
    return secrets;
  })().catch(error => {
    secretsPromise = null;
    throw error;
  });
  return secretsPromise;
}

/**
 * @returns {Promise<import("./OrbitoInterlineEngines.sys.mjs").Engine>}
 * @throws {InterlineError} needs-key
 */
async function currentEngine() {
  let prefs = {};
  for (let name of ENGINE_PREFS) {
    prefs[name] = Services.prefs.getStringPref(name, "");
  }
  return lazy.resolveEngine({ prefs, secrets: await readSecrets() });
}

/** "bilingual" or "replace". */
function currentMode() {
  return Services.prefs.getStringPref(lazy.PREF_BRANCH + "mode", "") == "replace"
    ? "replace"
    : "bilingual";
}

function currentHoverKey() {
  return Services.prefs.getStringPref(lazy.PREF_BRANCH + "hoverKey", "");
}

/** Recomputes what pages render with; the pages start over if it changed. */
async function refreshBasis() {
  let engine;
  try {
    engine = lazy.engineKey(await currentEngine());
  } catch (error) {
    engine = `no engine: ${error?.kind}`;
  }
  let next = `${engine}\0${currentTarget()}\0${currentMode()}`;
  if (basis !== null && next != basis) {
    epoch++;
  }
  let changed = next != basis;
  basis = next;
  return changed;
}

function recordFor(browser) {
  let record = tabs.get(browser.permanentKey);
  if (!record) {
    record = {
      status: "off",
      error: null,
      resume: "off",
      inflight: 0,
      warning: null,
    };
    tabs.set(browser.permanentKey, record);
  }
  return record;
}

/** @returns {Desired} */
function desiredFor(browser) {
  let status = tabs.get(browser.permanentKey)?.status ?? "off";
  return {
    page: { off: "off", on: "on", error: "halted" }[status],
    mode: currentMode(),
    hoverKey: currentHoverKey(),
    epoch,
  };
}

/** The actor of the page a tab shows, or null when it is not a web page. */
function actorFor(browser) {
  try {
    return (
      browser.browsingContext?.currentWindowGlobal?.getActor(ACTOR) ?? null
    );
  } catch {
    return null;
  }
}

/** Tells the tab's page what it should show now. */
function push(browser) {
  try {
    actorFor(browser)?.sendAsyncMessage("Interline:Set", desiredFor(browser));
  } catch {}
}

/** Forgets the tab's warning; the document or settings it was for changed. */
function clearWarning(browser) {
  let record = tabs.get(browser.permanentKey);
  if (record?.warning) {
    record.warning = null;
    changed(browser);
  }
}

/** Lets the Top bar draw the tab again. */
function changed(browser) {
  let win = browser.ownerDocument?.defaultView;
  win?.dispatchEvent(new win.CustomEvent(CHANGE_EVENT, { detail: { browser } }));
}

function setStatus(browser, status, error = null) {
  let record = recordFor(browser);
  if (status == "error" && record.status != "error") {
    record.resume = record.status;
  }
  record.status = status;
  record.error = error;
  record.warning = null;
  push(browser);
  changed(browser);
}

/** The settings page, on Interline's pane. */
function openSettings(browser) {
  let win = browser.ownerDocument?.defaultView;
  if (win) {
    lazy.OrbitoPages.openSettings(win, { pane: "interline" });
  }
}

/** Every tab browser of every window. */
function* allBrowsers() {
  for (let win of Services.wm.getEnumerator("navigator:browser")) {
    if (!win.closed && win.gBrowser) {
      yield* win.gBrowser.browsers;
    }
  }
}

/**
 * @typedef {object} View What the Top bar draws for a tab; synchronous.
 * @property {boolean} shown
 * @property {Status} status
 * @property {boolean} busy Waiting for translations.
 * @property {{kind: string}|null} error Why the tab stopped.
 * @property {{kind: string}|null} warning Why paragraphs of an "on" tab
 *   stay untranslated.
 */

/**
 * The Top bar's rule, pure: shown while the tab is not off, or when the
 * page's language is known and is not the one to translate into.
 *
 * @param {{status: Status, lang: string|null, target: string}} state
 *   lang null: not known yet.
 */
export function interlineShown({ status, lang, target }) {
  if (status != "off") {
    return true;
  }
  if (!lang) {
    return false;
  }
  let page = lazy.primaryLanguage(lang);
  return page != "und" && page != lazy.primaryLanguage(target);
}

/**
 * Whether a password manager change is to Orbito's secrets: its subject is
 * the login, or an nsIArray of them (modify, remove all), or a string.
 */
function touchesSecrets(subject) {
  let logins =
    subject instanceof Ci.nsIArray ? [...subject.enumerate()] : [subject];
  return logins.some(
    login =>
      login instanceof Ci.nsILoginInfo &&
      login.origin == lazy.OrbitoSecrets.ORIGIN
  );
}

function asInterlineError(error) {
  return error instanceof lazy.InterlineError
    ? error
    : new lazy.InterlineError("bad-response", String(error?.message || error));
}

/** One text alone, with retry; streams when onDelta is given. */
function single(engine, text, targetLang, { signal, onDelta }) {
  return lazy.withRetry(
    () =>
      lazy.request(engine, text, {
        targetLang,
        signal,
        onText: lazy.batches(engine) ? onDelta : undefined,
      }),
    { signal }
  );
}

/** Answers an item, and caches its text unless told not to yet. */
function settle(item, text, { cache = true } = {}) {
  if (!text) {
    fail(item, new lazy.InterlineError("bad-response", "Empty translation"));
    return;
  }
  if (cache) {
    cacheFor(item.private).set(item.key, text);
  }
  if (!item.settled) {
    item.settled = true;
    item.resolve(text);
  }
}

function fail(item, error) {
  if (!item.settled) {
    item.settled = true;
    item.reject(error);
  }
}

function singleItem(engine, targetLang, item) {
  single(engine, item.text, targetLang, item).then(
    text => settle(item, text),
    error => fail(item, asInterlineError(error))
  );
}

function enqueue(engine, targetLang, item) {
  let id = lazy.queueKey(
    lazy.engineKey(engine),
    targetLang,
    item.private,
    item.origin
  );
  let batch = queues.get(id);
  // Checked before adding, so a batch never goes over BATCH_MAX_CHARS.
  if (batch && batch.chars + item.text.length > BATCH_MAX_CHARS) {
    flush(batch);
    batch = null;
  }
  if (!batch) {
    batch = { id, engine, targetLang, items: [], chars: 0, timer: 0 };
    batch.timer = lazy.setTimeout(() => flush(batch), BATCH_WAIT_MS);
    queues.set(id, batch);
  }
  batch.items.push(item);
  batch.chars += item.text.length;
  if (batch.items.length >= BATCH_MAX_ITEMS) {
    flush(batch);
  }
}

function flush(batch) {
  lazy.clearTimeout(batch.timer);
  if (queues.get(batch.id) === batch) {
    queues.delete(batch.id);
  }
  send(batch).catch(console.error);
}

async function send({ engine, targetLang, items }) {
  let gone = () => new lazy.InterlineError("gone", "Cancelled");
  let live = items.filter(item => {
    if (item.signal?.aborted) {
      fail(item, gone());
      return false;
    }
    return true;
  });
  if (!live.length) {
    return;
  }
  if (live.length == 1) {
    singleItem(engine, targetLang, live[0]);
    return;
  }
  // The request stops once nobody waits for any of its texts: each was
  // answered or aborted.
  let controller = new AbortController();
  let listeners = live.map(item => {
    let onAbort = () => {
      fail(item, gone());
      if (live.every(i => i.settled)) {
        controller.abort();
      }
    };
    item.signal?.addEventListener("abort", onAbort);
    return () => item.signal?.removeEventListener("abort", onAbort);
  });
  let split = new lazy.PercentSplit(live.length);
  let streams = live.some(item => item.onDelta);
  let onText = accumulated => {
    for (let { index, text, done } of split.push(accumulated)) {
      if (done) {
        // Shown now, but cached only once end() finds every part: a model
        // that merged two paragraphs gives a wrong part early.
        settle(live[index], text, { cache: false });
      } else {
        live[index].onDelta?.(text);
      }
    }
  };
  try {
    let full = await lazy.withRetry(
      () =>
        lazy.request(
          engine,
          live.map(item => item.text).join(lazy.BATCH_SEPARATOR),
          {
            targetLang,
            batch: true,
            signal: controller.signal,
            onText: streams ? onText : undefined,
          }
        ),
      { signal: controller.signal }
    );
    let parts = split.end(full);
    if (parts) {
      live.forEach((item, i) => settle(item, parts[i]));
    } else {
      // The model merged or split paragraphs: the rest one at a time.
      for (let item of live) {
        if (!item.settled) {
          singleItem(engine, targetLang, item);
        }
      }
    }
  } catch (error) {
    // After retries: no single requests against a failing provider.
    let reason = asInterlineError(error);
    for (let item of live) {
      fail(item, reason);
    }
  } finally {
    for (let remove of listeners) {
      remove();
    }
  }
}

export const OrbitoInterline = {
  /**
   * Starts what Interline needs app-wide. Called by
   * OrbitoAssistantCore.startup(); only the first call does anything.
   */
  start() {
    if (started) {
      return;
    }
    started = true;
    ChromeUtils.registerWindowActor(ACTOR, {
      parent: {
        esModuleURI: "chrome://browser/content/orbito/OrbitoInterline.sys.mjs",
      },
      child: {
        esModuleURI:
          "chrome://browser/content/orbito/actors/OrbitoInterlineChild.sys.mjs",
        events: {
          DOMContentLoaded: {},
          pageshow: {},
          pagehide: { createActor: false },
        },
      },
      matches: ["http://*/*", "https://*/*", "file:///*"],
      messageManagerGroups: ["browsers"],
      // The child sends only text; the parent picks engine, key, language
      // and privacy from its own state, and answers only the actor that
      // asked.
      safeForUntrustedWebProcess: true,
    });
    Services.prefs.addObserver(lazy.PREF_BRANCH, this);
    Services.prefs.addObserver("orbito.assistant.baseURL", this);
    Services.prefs.addObserver("orbito.assistant.model", this);
    Services.obs.addObserver(this, "last-pb-context-exited");
    Services.obs.addObserver(this, "passwordmgr-storage-changed");
    refreshBasis().catch(console.error);
  },

  observe(subject, topic, data) {
    switch (topic) {
      case "last-pb-context-exited":
        caches.private?.clear();
        break;
      case "passwordmgr-storage-changed":
        if (touchesSecrets(subject)) {
          secretsPromise = null;
          this._settingsChanged().catch(console.error);
        }
        break;
      case "nsPref:changed":
        this._settingsChanged({
          // Hover works on every page, translated or not.
          everyPage: data == lazy.PREF_BRANCH + "hoverKey",
        }).catch(console.error);
        break;
    }
  },

  /**
   * Pages that are on start over with what the settings now mean, and
   * tabs an error stopped go back to what they were: the error may be
   * gone with the change.
   */
  async _settingsChanged({ everyPage = false } = {}) {
    await refreshBasis();
    for (let browser of allBrowsers()) {
      clearWarning(browser);
      let record = tabs.get(browser.permanentKey);
      if (record?.status == "error") {
        setStatus(browser, record.resume);
      } else if (record?.status == "on" || everyPage) {
        push(browser);
      }
    }
  },

  /**
   * What the Top bar shows for a tab. Only reads: a page's language is
   * known from its Interline:Sync (and detected then when it has none).
   *
   * @returns {View}
   */
  view(browser) {
    let record = tabs.get(browser.permanentKey);
    let status = record?.status ?? "off";
    let global = browser.browsingContext?.currentWindowGlobal;
    let lang = (global && languages.get(global)?.lang) || null;
    return {
      shown: interlineShown({ status, lang, target: currentTarget() }),
      status,
      busy: (record?.inflight ?? 0) > 0,
      error: record?.error ? { kind: record.error.kind } : null,
      warning: record?.warning ? { kind: record.warning.kind } : null,
    };
  },

  /**
   * The Top bar button and the Command bar: off -> on, on or error -> off.
   * An engine without its key, or a key refused, opens the settings pane
   * instead (the tab stays or turns off).
   *
   * @returns {Promise<boolean>} false when the tab is off and has no web
   *   page (one that is on turns off on any page).
   */
  async toggle(browser) {
    let record = recordFor(browser);
    if (record.status == "off" && !actorFor(browser)) {
      return false;
    }
    if (record.status == "off") {
      try {
        await currentEngine();
      } catch (error) {
        if (error?.kind != "needs-key") {
          throw error;
        }
        openSettings(browser);
        return true;
      }
      setStatus(browser, "on");
    } else {
      let kind = record.error?.kind;
      setStatus(browser, "off");
      if (kind == "auth" || kind == "needs-key") {
        openSettings(browser);
      }
    }
    return true;
  },

  /**
   * Translates one text with the engine and language the settings mean.
   * Batching with other callers, the cache, retry and streaming are all
   * here. A cache hit answers without any delta.
   *
   * @param {string} text
   * @param {object} [options]
   * @param {boolean} [options.private] From a private window: its own
   *   cache, and never in a request with normal windows' text.
   * @param {string} [options.origin] The site the text is from: never in a
   *   request with another site's text.
   * @param {AbortSignal} [options.signal] Rejects with "gone" once aborted.
   * @param {(accumulated: string) => void} [options.onDelta] Streams the
   *   translation so far when given (not with Google).
   * @param {string} [options.targetLang] Defaults to the setting.
   * @returns {Promise<string>}
   * @throws {InterlineError}
   */
  async translate(text, options = {}) {
    let engine = await currentEngine();
    let targetLang = options.targetLang || currentTarget();
    let isPrivate = !!options.private;
    let key = lazy.cacheKey(lazy.engineKey(engine), targetLang, text);
    let hit = cacheFor(isPrivate).get(key);
    if (hit !== undefined) {
      return hit;
    }
    if (options.signal?.aborted) {
      throw new lazy.InterlineError("gone", "Cancelled");
    }
    if (!lazy.batches(engine) || text.includes("%%")) {
      let result;
      try {
        result = await single(engine, text, targetLang, options);
      } catch (error) {
        throw asInterlineError(error);
      }
      if (!result) {
        throw new lazy.InterlineError("bad-response", "Empty translation");
      }
      cacheFor(isPrivate).set(key, result);
      return result;
    }
    return new Promise((resolve, reject) =>
      enqueue(engine, targetLang, {
        text,
        private: isPrivate,
        origin: options.origin ?? "",
        onDelta: options.onDelta,
        signal: options.signal,
        key,
        resolve,
        reject,
        settled: false,
      })
    );
  },

  /** The translation key of an engine ("openai", "claude", "google"), or "". */
  getKey(engine) {
    return lazy.OrbitoSecrets.get(lazy.REALMS[engine]);
  },

  /** Saves an engine's translation key ("" removes it). */
  async setKey(engine, value) {
    await lazy.OrbitoSecrets.set(lazy.REALMS[engine], String(value).trim());
    secretsPromise = null;
    await this._settingsChanged();
  },

  /** What an unset OpenAI-compatible endpoint uses: {baseURL, model}. */
  inheritedOpenAI() {
    return {
      baseURL: lazy.normalizeBaseURL(
        Services.prefs.getStringPref("orbito.assistant.baseURL", "") ||
          lazy.OPENAI_DEFAULT_BASE_URL
      ),
      model:
        Services.prefs.getStringPref("orbito.assistant.model", "") ||
        lazy.DEFAULT_MODELS.openai,
    };
  },

  /** Forgets every translation (also from "Delete all data"). */
  clearCache() {
    caches.normal?.clear();
    caches.private?.clear();
  },
};

/**
 * The parent actor. Every value but the text comes from here: the tab from
 * browsingContext.top.embedderElement, privacy from usePrivateBrowsing,
 * the site from the page's principal, the engine and language from the
 * settings. Only the page a tab shows now
 * may change the tab's state.
 */
export class OrbitoInterlineParent extends JSWindowActorParent {
  /** @type {Set<AbortController>} */ #requests = new Set();

  receiveMessage({ name, data }) {
    switch (name) {
      case "Interline:Sync":
        return this.#sync(data);
      case "Interline:Translate":
        return this.#translate(data);
      case "Interline:Cancel":
        this.#cancel();
        break;
    }
    return undefined;
  }

  #sync(data) {
    let browser = this.browsingContext.top.embedderElement;
    if (!browser) {
      return null;
    }
    // Sent when the tab shows another document (loaded or from bfcache).
    clearWarning(browser);
    if (!languages.has(this.manager)) {
      let lang = String(data?.lang ?? "").trim().slice(0, 35);
      let entry = { lang: lang || null };
      languages.set(this.manager, entry);
      if (!lang) {
        this.#detect(browser, entry, String(data?.sample ?? ""));
      }
      changed(browser);
    }
    return desiredFor(browser);
  }

  /** The page has no lang attribute: once per document, from its text. */
  async #detect(browser, entry, sample) {
    let lang = "und";
    sample = sample.slice(0, MAX_SAMPLE_CHARS);
    if (sample.trim()) {
      try {
        let detected = await lazy.LanguageDetector.detectLanguage(sample);
        if (detected.confident) {
          lang = detected.language;
        }
      } catch (error) {
        console.error(error);
      }
    }
    entry.lang = lang;
    changed(browser);
  }

  async #translate(data) {
    let gone = { error: { kind: "gone", retryable: false } };
    let browser = this.browsingContext.top.embedderElement;
    if (!browser || !this.manager.isCurrentGlobal) {
      return gone;
    }
    // Text is asked for only by a tab that translates, or by a hover.
    if (tabs.get(browser.permanentKey)?.status != "on" && !currentHoverKey()) {
      return gone;
    }
    let { id, text } = data ?? {};
    if (typeof text != "string" || !text) {
      return { error: { kind: "bad-request", retryable: false } };
    }
    if (text.length > MAX_UNIT_CHARS) {
      return { error: { kind: "too-long", retryable: false } };
    }
    if (this.#requests.size >= MAX_INFLIGHT_PER_ACTOR) {
      return { error: { kind: "rate-limit", retryable: true } };
    }
    let controller = new AbortController();
    this.#requests.add(controller);
    let record = recordFor(browser);
    if (record.inflight++ == 0) {
      changed(browser);
    }
    let onDelta =
      currentMode() == "bilingual" && Number.isInteger(id)
        ? delta => this.#send("Interline:Delta", { id, text: delta })
        : undefined;
    try {
      return {
        text: await OrbitoInterline.translate(text, {
          private: this.browsingContext.usePrivateBrowsing,
          origin: this.manager.documentPrincipal.origin,
          signal: controller.signal,
          onDelta,
        }),
      };
    } catch (e) {
      let error = asInterlineError(e);
      if (TAB_FATAL.has(error.kind) && this.manager.isCurrentGlobal) {
        setStatus(browser, "error", error);
      } else if (
        error.retryable &&
        this.manager.isCurrentGlobal &&
        record.status == "on"
      ) {
        record.warning = error;
        changed(browser);
      }
      return { error: error.toJSON() };
    } finally {
      this.#requests.delete(controller);
      if (--record.inflight == 0) {
        changed(browser);
      }
    }
  }

  #cancel() {
    for (let controller of this.#requests) {
      controller.abort();
    }
    this.#requests.clear();
  }

  /** The page may have gone. */
  #send(name, data) {
    try {
      this.sendAsyncMessage(name, data);
    } catch {}
  }

  didDestroy() {
    this.#cancel();
  }
}
