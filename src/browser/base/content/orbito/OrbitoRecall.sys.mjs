/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Browsing recall: remembers the text of the pages the user reads, in the
 * assistant's store (OrbitoAssistantStore.sys.mjs), and searches them.
 *
 * A page counts as read once it has loaded and the user has either looked
 * at it (its tab selected) for orbito.recall.dwellSeconds or scrolled it
 * (actors/OrbitoRecall*.sys.mjs). Its text is then extracted once, as
 * get_page_text does, and saved with a visit in the Space of its tab; how
 * long its tab was selected is written to the visit when the user leaves
 * the tab or the page. Nothing is remembered from private windows, from pages other than
 * http(s) ones, from the domains in orbito.recall.excludedDomains, from
 * pages with a password field, or while orbito.recall.enabled is off.
 *
 * Pages are kept orbito.recall.retentionDays after their last visit; the
 * older ones are forgotten at startup, once a day and when that setting
 * changes. A domain added to orbito.recall.excludedDomains is forgotten at
 * once.
 *
 * Searches find pages by keywords (SqliteStore.searchPages) and by meaning,
 * with the embeddings of their text (OrbitoEmbedder.sys.mjs), and rank the
 * two together, in one Space (the visits it sees) or in all of them. Pages
 * are embedded in batches while the user is idle,
 * last visited first, catching up on what piled up; the embeddings are
 * kept in memory for searching once a search needs them.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  EMBEDDING_SIZE: "chrome://browser/content/orbito/OrbitoEmbedder.sys.mjs",
  excerptFrom: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  excludedDomains: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  isExcludedHost: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  fuse: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  hasPasswordField: "chrome://browser/content/orbito/OrbitoSubframes.sys.mjs",
  OrbitoAssistantCore:
    "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs",
  OrbitoEmbedder: "chrome://browser/content/orbito/OrbitoEmbedder.sys.mjs",
  OrbitoTools: "chrome://browser/content/orbito/OrbitoTools.sys.mjs",
  pageChunks: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  pageKey: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  quantize: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  readPage: "chrome://browser/content/orbito/tools/get_page_text.sys.mjs",
  recallableURL: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  retentionCutoff: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  searchWords: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  SEMANTIC_FLOOR: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  SUGGEST_FLOOR: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  setInterval: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

export const ENABLED_PREF = "orbito.recall.enabled";
export const EXCLUDED_PREF = "orbito.recall.excludedDomains";
export const RETENTION_PREF = "orbito.recall.retentionDays";
const DWELL_PREF = "orbito.recall.dwellSeconds";

const PRUNE_INTERVAL = 86400000;

const ACTOR = "OrbitoRecall";

// Seconds without input before pages are embedded, and pages embedded at a
// time.
const IDLE_SECONDS = 30;
const EMBED_BATCH = 4;
// Results each way that a search ranks together.
const SEARCH_CANDIDATES = 50;
// Pages suggested in the urlbar at most.
const SUGGESTIONS = 3;

/**
 * The embeddings of every chunk of every page, in memory: a byte per
 * dimension times the chunk's scale.
 */
class ChunkIndex {
  size = 0;
  #capacity = 1024;
  pageIds = new Int32Array(this.#capacity);
  starts = new Int32Array(this.#capacity);
  scales = new Float32Array(this.#capacity);
  vectors = new Int8Array(this.#capacity * lazy.EMBEDDING_SIZE);

  add({ page_id, start, scale, bytes }) {
    if (this.size == this.#capacity) {
      this.#capacity *= 2;
      for (let name of ["pageIds", "starts", "scales"]) {
        let grown = new this[name].constructor(this.#capacity);
        grown.set(this[name]);
        this[name] = grown;
      }
      let vectors = new Int8Array(this.#capacity * lazy.EMBEDDING_SIZE);
      vectors.set(this.vectors);
      this.vectors = vectors;
    }
    this.pageIds[this.size] = page_id;
    this.starts[this.size] = start;
    this.scales[this.size] = scale;
    this.vectors.set(bytes, this.size * lazy.EMBEDDING_SIZE);
    this.size++;
  }

  /** Leaves out a page's chunks from now on. */
  removePage(pageId) {
    for (let i = 0; i < this.size; i++) {
      if (this.pageIds[i] == pageId) {
        this.pageIds[i] = 0;
      }
    }
  }

  /**
   * The pages with a chunk at least floor alike to query (a unit vector):
   * Map(pageId -> {similarity, start}) of each page's most alike chunk.
   */
  search(query, floor) {
    let found = new Map();
    let size = lazy.EMBEDDING_SIZE;
    for (let i = 0; i < this.size; i++) {
      let pageId = this.pageIds[i];
      if (!pageId) {
        continue;
      }
      let offset = i * size;
      let sum = 0;
      for (let j = 0; j < size; j++) {
        sum += query[j] * this.vectors[offset + j];
      }
      let similarity = sum * this.scales[i];
      if (similarity >= floor && similarity > (found.get(pageId)?.similarity ?? -1)) {
        found.set(pageId, { similarity, start: this.starts[i] });
      }
    }
    return found;
  }
}

export const OrbitoRecall = {
  _started: false,
  // browser -> the visit to the page it shows: {key, browser, startedAt,
  // loaded, scrolled, shownMs, shownSince, timer, done, visitId, ended}.
  _visits: new WeakMap(),

  /** Called by the core at startup; only the first call does anything. */
  start() {
    if (this._started) {
      return;
    }
    this._started = true;
    ChromeUtils.registerWindowActor(ACTOR, {
      parent: {
        esModuleURI:
          "chrome://browser/content/orbito/actors/OrbitoRecallParent.sys.mjs",
      },
      child: {
        esModuleURI:
          "chrome://browser/content/orbito/actors/OrbitoRecallChild.sys.mjs",
        // Scrolling any part of the page counts.
        events: { scroll: { capture: true } },
      },
      matches: ["http://*/*", "https://*/*"],
      messageManagerGroups: ["browsers"],
      // The child only says that the page was scrolled.
      safeForUntrustedWebProcess: true,
    });
    Services.prefs.addObserver(RETENTION_PREF, this);
    Services.prefs.addObserver(EXCLUDED_PREF, this);
    lazy.setInterval(() => this.prune().catch(console.error), PRUNE_INTERVAL);
    this.prune().catch(console.error);
    Cc["@mozilla.org/widget/useridleservice;1"]
      .getService(Ci.nsIUserIdleService)
      .addIdleObserver(this, IDLE_SECONDS);
  },

  observe(subject, topic, data) {
    if (topic == "idle") {
      this._userIdle = true;
      this.embedPending().catch(console.error);
      return;
    }
    if (topic == "active") {
      this._userIdle = false;
      return;
    }
    if (topic != "nsPref:changed") {
      return;
    }
    this._pending = this._pending
      .then(async () => {
        if (data == EXCLUDED_PREF) {
          await this._store.deletePagesOf(this.excludedDomains);
          this.resetIndex();
        } else {
          await this.prune();
        }
      })
      .catch(console.error);
  },

  // What a change of the settings started forgetting.
  _pending: Promise.resolve(),

  /** Resolves once what the latest settings change forgets is gone. */
  whenSettled() {
    return this._pending;
  },

  get _store() {
    return lazy.OrbitoAssistantCore.store;
  },

  get enabled() {
    return Services.prefs.getBoolPref(ENABLED_PREF, true);
  },

  /** The domains whose pages are never remembered. */
  get excludedDomains() {
    return lazy.excludedDomains(
      Services.prefs.getStringPref(EXCLUDED_PREF, "[]")
    );
  },

  /** Forgets what is older than the retention period allows. */
  async prune(now = Date.now()) {
    let before = lazy.retentionCutoff(
      Services.prefs.getIntPref(RETENTION_PREF, 180),
      now
    );
    if (before != null) {
      await this._store.prunePages(before);
      this.resetIndex();
    }
  },

  /** How much is remembered: {pages, bytes}. */
  stats() {
    return this._store.pageStats();
  },

  /* Searching */

  // A promise of the ChunkIndex, loaded on first use.
  _index: null,
  // Whether the user has been idle long enough to embed pages, and
  // whether pages are being embedded.
  _userIdle: false,
  _embedding: false,

  _chunkIndex() {
    this._index ??= (async () => {
      let index = new ChunkIndex();
      await this._store.forEachPageChunk(chunk => index.add(chunk));
      return index;
    })().catch(e => {
      this._index = null;
      throw e;
    });
    return this._index;
  },

  /**
   * Drops the embeddings kept in memory, after pages were forgotten; they
   * are loaded again for the next search.
   */
  resetIndex() {
    this._index = null;
  },

  /**
   * Embeds the pages that have no embeddings of their text yet, a few at a
   * time, while the user stays idle (or, with whileIdle false, all of
   * them). Does nothing if this build has no model.
   */
  async embedPending({ whileIdle = true } = {}) {
    if (this._embedding || !(await lazy.OrbitoEmbedder.available())) {
      return;
    }
    this._embedding = true;
    try {
      while (!whileIdle || this._userIdle) {
        let pages = await this._store.pagesToEmbed(EMBED_BATCH);
        if (!pages.length) {
          break;
        }
        for (let page of pages) {
          let chunks = lazy.pageChunks(page.title, page.text);
          let vectors = await lazy.OrbitoEmbedder.embed(
            chunks.map(chunk => chunk.text),
            "passage",
            { title: page.title }
          );
          let embedded = chunks.map((chunk, i) => ({
            start: chunk.start,
            ...lazy.quantize(vectors[i]),
          }));
          let saved = await this._store.savePageChunks(
            page.id,
            page.hash,
            embedded
          );
          if (saved && this._index) {
            let index = await this._index;
            index.removePage(page.id);
            for (let chunk of embedded) {
              index.add({ page_id: page.id, ...chunk });
            }
          }
        }
      }
    } finally {
      this._embedding = false;
    }
  },

  /**
   * The remembered pages for a search, best first: those with words of
   * text (see SqliteStore.searchPages) and those whose text means much the
   * same, ranked together (see fuse), at most limit of them, visited
   * between since and until: [{url, title, visited_at, excerpt,
   * similarity, coverage}], similarity being how alike in meaning the page
   * is to the search (a cosine), or null when it was found by keywords
   * only, and coverage the share of the search's words it has, or null when
   * it was found by meaning only. With space, only the visits that Space
   * sees count (see SqliteStore.searchPages). No word of two characters or
   * more finds nothing.
   */
  async search(
    text,
    { since = null, until = null, limit = 20, now = Date.now(), space } = {}
  ) {
    if (!lazy.searchWords(text).length) {
      return [];
    }
    let [keyword, semantic] = await Promise.all([
      this._store.searchPages(text, {
        since,
        until,
        limit: SEARCH_CANDIDATES,
        now,
        space,
      }),
      this._semantic(text, { since, until, space }).catch(e => {
        console.error(e);
        return [];
      }),
    ]);
    let pages = new Map();
    for (let page of semantic) {
      pages.set(page.id, page);
    }
    for (let page of semantic) {
      page.coverage = null;
    }
    for (let page of keyword) {
      pages.set(page.id, {
        ...page,
        similarity: pages.get(page.id)?.similarity ?? null,
      });
    }
    return lazy
      .fuse(keyword, semantic, now)
      .slice(0, limit)
      .map(({ id }) => {
        let { url, title, visited_at, excerpt, similarity, coverage } =
          pages.get(id);
        return { url, title, visited_at, excerpt, similarity, coverage };
      });
  },

  /**
   * The remembered pages to suggest for what is typed in the urlbar, at most
   * three: those of the best results that have every word typed or are
   * close in meaning to it; none for a search they are not related to.
   * With space, those that Space sees come first, then the other Spaces'.
   */
  async suggest(text, { space } = {}) {
    let related = async options =>
      (await this.search(text, { limit: SUGGESTIONS, ...options })).filter(
        page =>
          page.coverage == 1 || (page.similarity ?? 0) >= lazy.SUGGEST_FLOOR
      );
    let found = await related({ space });
    if (space !== undefined && found.length < SUGGESTIONS) {
      let urls = new Set(found.map(page => page.url));
      for (let page of await related()) {
        if (found.length < SUGGESTIONS && !urls.has(page.url)) {
          found.push(page);
        }
      }
    }
    return found;
  },

  /**
   * The pages alike in meaning to a search, most alike first, with an
   * excerpt from their most alike chunk.
   */
  async _semantic(text, { since, until, space }) {
    if (!(await lazy.OrbitoEmbedder.available())) {
      return [];
    }
    let [query, index] = await Promise.all([
      this._queryEmbedding(text),
      this._chunkIndex(),
    ]);
    let found = index.search(query, lazy.SEMANTIC_FLOOR);
    let best = [...found].sort((a, b) => b[1].similarity - a[1].similarity);
    // The best of those in the period and Space, not of all pages: the
    // others' may be all the best ones.
    let pages = await this._store.pagesByIds(
      best.map(([id]) => id),
      { since, until, space, limit: SEARCH_CANDIDATES }
    );
    return pages
      .map(page => {
        let { similarity, start } = found.get(page.id);
        return {
          id: page.id,
          url: page.url,
          title: page.title,
          visited_at: page.visited_at,
          excerpt: lazy.excerptFrom(page.text, start),
          similarity,
        };
      })
      .sort((a, b) => b.similarity - a.similarity);
  },

  // The latest search's embedding, {text, promise}: suggest() searches the
  // same text again in all Spaces.
  _lastQuery: null,

  _queryEmbedding(text) {
    if (this._lastQuery?.text != text) {
      let promise = lazy.OrbitoEmbedder.embed([text], "query").then(
        ([query]) => query
      );
      promise.catch(() => {
        if (this._lastQuery?.promise == promise) {
          this._lastQuery = null;
        }
      });
      this._lastQuery = { text, promise };
    }
    return this._lastQuery.promise;
  },

  /**
   * The timeline's entries, a page per day it was visited, latest first;
   * see SqliteStore.listPageDays.
   */
  timeline(options) {
    return this._store.listPageDays(options);
  },

  /** Forgets a page, as the timeline does. */
  async forget(url) {
    await this._store.deletePage(url);
    this.resetIndex();
  },

  /* What the user reads */

  /**
   * Follows what a window's tabs show, from the window's startup until it
   * closes. Private windows are left alone.
   */
  trackWindow(win) {
    if (lazy.PrivateBrowsingUtils.isWindowPrivate(win)) {
      return;
    }
    let gBrowser = win.gBrowser;
    let progress = {
      onLocationChange: (browser, webProgress, request, location, flags) => {
        if (webProgress.isTopLevel) {
          this._navigated(browser, location.spec, flags);
        }
      },
      onStateChange: (browser, webProgress, request, flags) => {
        let stop =
          Ci.nsIWebProgressListener.STATE_STOP |
          Ci.nsIWebProgressListener.STATE_IS_WINDOW;
        if (webProgress.isTopLevel && (flags & stop) == stop) {
          this._loaded(browser);
        }
      },
    };
    let events = event => {
      if (event.type == "TabSelect") {
        let previous = event.detail?.previousTab;
        if (previous) {
          this._hide(this._visits.get(previous.linkedBrowser));
        }
        this._show(this._visits.get(event.target.linkedBrowser));
      } else if (event.type == "TabClose") {
        this._end(event.target.linkedBrowser);
      }
    };
    gBrowser.addTabsProgressListener(progress);
    gBrowser.tabContainer.addEventListener("TabSelect", events);
    gBrowser.tabContainer.addEventListener("TabClose", events);
    win.addEventListener(
      "unload",
      () => {
        for (let tab of gBrowser.tabs) {
          this._end(tab.linkedBrowser);
        }
        gBrowser.removeTabsProgressListener(progress);
      },
      { once: true }
    );
    // The pages the window already shows, as after a restore.
    for (let tab of gBrowser.tabs) {
      let browser = tab.linkedBrowser;
      if (browser.currentURI && !tab.hasAttribute("pending")) {
        this._navigated(browser, browser.currentURI.spec, 0);
        if (!browser.webProgress?.isLoadingDocument) {
          this._loaded(browser);
        }
      }
    }
  },

  /** A tab went to url: the visit to the page it showed ends. */
  _navigated(browser, url, flags) {
    let key = lazy.pageKey(url);
    let visit = this._visits.get(browser);
    let sameDocument =
      flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT;
    if (sameDocument && visit?.key == key) {
      return;
    }
    this._end(browser);
    if (
      !lazy.recallableURL(key) ||
      flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_ERROR_PAGE
    ) {
      return;
    }
    visit = {
      key,
      browser,
      startedAt: Date.now(),
      // A page that changed its address in place has loaded already.
      loaded: !!sameDocument,
      scrolled: false,
      shownMs: 0,
      shownSince: null,
      timer: null,
      done: false,
      visitId: null,
      ended: false,
    };
    this._visits.set(browser, visit);
    if (this._isShown(browser)) {
      this._show(visit);
    }
  },

  _isShown(browser) {
    let gBrowser = browser.documentGlobal?.gBrowser;
    return !!gBrowser && gBrowser.selectedBrowser == browser;
  },

  _loaded(browser) {
    let visit = this._visits.get(browser);
    if (visit && !visit.loaded) {
      visit.loaded = true;
      this._check(visit);
    }
  },

  /**
   * The user scrolled the page at url in browser; the actor's parent
   * passes this on.
   */
  scrolled(browser, url) {
    let visit = this._visits.get(browser);
    if (visit && url && lazy.pageKey(url) == visit.key) {
      visit.scrolled = true;
      this._check(visit);
    }
  },

  _dwellMs(visit) {
    return (
      visit.shownMs +
      (visit.shownSince == null ? 0 : Date.now() - visit.shownSince)
    );
  },

  get _minDwellMs() {
    return Services.prefs.getIntPref(DWELL_PREF, 10) * 1000;
  },

  _show(visit) {
    if (!visit || visit.ended || visit.shownSince != null) {
      return;
    }
    visit.shownSince = Date.now();
    if (!visit.done) {
      let wait = Math.max(0, this._minDwellMs - visit.shownMs);
      visit.timer = lazy.setTimeout(() => this._check(visit), wait);
    }
  },

  _hide(visit) {
    if (!visit || visit.shownSince == null) {
      return;
    }
    visit.shownMs = this._dwellMs(visit);
    visit.shownSince = null;
    lazy.clearTimeout(visit.timer);
    visit.timer = null;
    this._writeDwell(visit);
  },

  _end(browser) {
    let visit = this._visits.get(browser);
    if (!visit) {
      return;
    }
    this._visits.delete(browser);
    this._hide(visit);
    visit.ended = true;
  },

  _writeDwell(visit) {
    if (visit.visitId != null) {
      this._store
        .setVisitDwell(visit.visitId, visit.shownMs)
        .catch(console.error);
    }
  },

  /** Saves the page once it has loaded and been read. */
  _check(visit) {
    if (
      visit.done ||
      visit.ended ||
      !visit.loaded ||
      (!visit.scrolled && this._dwellMs(visit) < this._minDwellMs)
    ) {
      return;
    }
    visit.done = true;
    this._save(visit).catch(console.error);
  },

  async _save(visit) {
    let { browser } = visit;
    if (
      !this.enabled ||
      lazy.isExcludedHost(new URL(visit.key).hostname, this.excludedDomains)
    ) {
      return;
    }
    try {
      // A password field in any of its frames counts too.
      if (await lazy.hasPasswordField(browser)) {
        return;
      }
    } catch {
      // The page went away.
      return;
    }
    let tab = browser.documentGlobal?.gBrowser?.getTabForBrowser(browser);
    if (!tab || visit.ended) {
      return;
    }
    let page = await lazy.readPage(tab);
    // The tab may have gone elsewhere while the page was read.
    if (visit.ended || lazy.pageKey(page.url) != visit.key || !page.text) {
      return;
    }
    let { visitId } = await this._store.savePage(
      { url: visit.key, title: page.title || visit.key, text: page.text },
      visit.startedAt,
      // The tab's Space now, or for a pinned tab the one its window shows.
      { space: lazy.OrbitoTools.context({ tab }).space }
    );
    visit.visitId = visitId;
    if (visit.ended || visit.shownSince == null) {
      this._writeDwell(visit);
    }
  },
};
