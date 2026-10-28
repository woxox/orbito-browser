/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, nothing } from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";
import { ORBITO_LOGO } from "chrome://browser/content/orbito/shell/orbito-logo.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserUtils: "resource://gre/modules/BrowserUtils.sys.mjs",
  DELAY_MS: "chrome://browser/content/orbito/OrbitoRecallUrlbarProvider.sys.mjs",
  OrbitoPages: "chrome://browser/content/orbito/OrbitoPages.sys.mjs",
  OrbitoRecall: "chrome://browser/content/orbito/OrbitoRecall.sys.mjs",
  PlacesQuery: "resource://gre/modules/PlacesQuery.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  UrlbarSearchUtils:
    "moz-src:///browser/components/urlbar/UrlbarSearchUtils.sys.mjs",
  UrlbarUtils: "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs",
  routeQuery: "chrome://browser/content/orbito/OrbitoUrlbarProvider.sys.mjs",
  SearchService: "moz-src:///toolkit/components/search/SearchService.sys.mjs",
  searchesMemory:
    "chrome://browser/content/orbito/OrbitoRecallUrlbarProvider.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});
const { OrbitoAppearance } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/shell/OrbitoAppearance.sys.mjs"
);
const { t, OrbitoL10n } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

// The page takes Orbito's light, dark and accent, as the window does.
OrbitoAppearance.follow(document);

/** How many recent visits the page shows. */
export const RECENT_LIMIT = 6;
// How many of the latest visited pages are looked through for them.
const HISTORY_LIMIT = 100;

/** A web page's host, without "www.". */
function hostOf(url) {
  return URL.parse(url)?.host.replace(/^www\./, "") ?? "";
}

/**
 * The recent visits to show, from history visits newest first: the latest
 * web page of each site, labeled by its host.
 *
 * @param {Array<{url: string, title: string}>} visits
 * @param {number} [limit]
 * @returns {Array<{url: string, title: string, host: string}>}
 */
export function recentSites(visits, limit = RECENT_LIMIT) {
  let sites = [];
  let hosts = new Set();
  for (let visit of visits) {
    let url = URL.parse(visit.url);
    if (!url || !["http:", "https:"].includes(url.protocol)) {
      continue;
    }
    let host = hostOf(visit.url);
    if (hosts.has(host)) {
      continue;
    }
    hosts.add(host);
    sites.push({ url: visit.url, title: visit.title || host, host });
    if (sites.length == limit) {
      break;
    }
  }
  return sites;
}

/**
 * When a remembered page was last visited, for its line on the page:
 * today, yesterday or its date.
 *
 * @param {number} time
 * @param {number} [now]
 * @returns {string}
 */
export function visitedWhen(time, now = Date.now()) {
  let day = date => new Date(date).toDateString();
  if (day(time) == day(now)) {
    return t("orbito-timeline-today");
  }
  if (day(time) == day(now - 86400000)) {
    return t("orbito-timeline-yesterday");
  }
  return new Date(time).toLocaleDateString(OrbitoL10n.language, {
    month: "long",
    day: "numeric",
  });
}

/**
 * Orbito's new tab page (about:newtab and about:home): an input for a
 * question or an address, the sites visited last and, while something is
 * typed, the remembered pages related to it ("From memory"), nothing else.
 *
 * Enter runs what the Command bar would put first for the same text
 * (routeQuery(), as OrbitoUrlbarProvider routes it): an address or a search
 * loads in this tab through Firefox's URI fixup and default engine, and a
 * question opens the Assistant panel on this tab and is sent at once,
 * sharing no tab ("None" context) whatever the panel's setting. A recent
 * visit opens its page in this tab (or where a modifier or the middle
 * button says).
 *
 * "From memory" shows what the Command bar's group of that name would for
 * the same text (OrbitoRecall.suggest(), those read in the window's Space
 * first), searched once typing pauses; a page opens as a recent visit
 * does, and "See all" opens the timeline. Private windows get none.
 *
 * A privileged page in the parent process: it talks to its window
 * (OrbitoAssistant) and to Places directly. It takes focus only when its
 * tab's page does (never from the Command bar): then the input gets it.
 *
 * Keyboard: the input, the recent visits as one tab stop and the
 * remembered pages as another, where the arrow keys move and Home and End
 * go to the ends.
 */
export class OrbitoNewTab extends MozLitElement {
  static properties = {
    /** The recent visits shown, see recentSites(). */
    sites: { type: Array },
    /** The remembered pages shown, see OrbitoRecall.suggest(). */
    memories: { type: Array },
  };

  static queries = {
    input: ".ask input",
    recentList: ".recent",
    siteLinks: { all: ".site" },
    memoryLinks: { all: ".memory-page" },
  };

  #history = null;
  // The recent visit the keyboard is on, by URL; the first when unset.
  #focusedURL = null;
  // The same for the remembered pages.
  #focusedMemory = null;
  // The latest text searched in memory, to drop older searches' pages.
  #memoryText = "";

  constructor() {
    super();
    this.sites = [];
    this.memories = [];
  }

  /** The window the page is in. */
  get chromeWindow() {
    return window.browsingContext.topChromeWindow;
  }

  /** The page's tab. */
  get tab() {
    return this.chromeWindow?.gBrowser.getTabForBrowser(
      window.browsingContext.embedderElement
    );
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("focus", this);
    window.addEventListener("unload", this, { once: true });
    this.#history = new lazy.PlacesQuery();
    this.#history.observeHistory(visits => this.#showHistory(visits));
    this.#history
      .getHistory({ sortBy: "lastvisited", limit: HISTORY_LIMIT })
      .then(visits => this.#showHistory(visits), console.error);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("focus", this);
    this.#history?.close();
    this.#history = null;
  }

  handleEvent(event) {
    switch (event.type) {
      case "focus":
        this.#takeFocus();
        break;
      case "unload":
        this.#history?.close();
        this.#history = null;
        break;
    }
  }

  #showHistory(visits) {
    if (this.#history) {
      this.sites = recentSites(visits ?? []);
    }
  }

  firstUpdated() {
    if (document.hasFocus()) {
      this.#takeFocus();
    }
  }

  // The page got focus with nothing in it focused: the input takes it.
  #takeFocus() {
    if (!document.activeElement || document.activeElement == document.body) {
      this.input?.focus();
    }
  }

  /**
   * Runs the input's text as the Command bar's top result would: goes to an
   * address, searches, or asks.
   */
  async go() {
    let text = this.input.value.trim();
    if (!text) {
      return;
    }
    if ((await lazy.routeQuery(text))?.kind == "agent") {
      this.ask();
      return;
    }
    let browser = window.browsingContext.embedderElement;
    let isPrivate = lazy.PrivateBrowsingUtils.isBrowserPrivate(browser);
    // Fixup searches with the default engine only once search is up.
    await lazy.SearchService.init();
    if (this.input.value.trim() != text) {
      return;
    }
    // What the urlbar's heuristic fallback loads: the fixed-up address, or
    // the default engine's search for the text.
    let fixup = lazy.UrlbarUtils.getURIFixupInfo(text, isPrivate);
    let url = fixup?.preferredURI?.spec;
    let postData = fixup?.postData;
    if (!url) {
      let submission =
        lazy.UrlbarSearchUtils.getDefaultEngine(isPrivate)?.getSubmission(
          text
        );
      url = submission?.uri.spec;
      postData = submission?.postData;
    }
    if (!url) {
      return;
    }
    this.chromeWindow.openTrustedLinkIn(url, "current", {
      targetBrowser: browser,
      postData,
      allowInheritPrincipal: false,
    });
  }

  /** Sends the input's question to the Assistant panel of this tab. */
  ask() {
    let prompt = this.input.value.trim();
    let win = this.chromeWindow;
    let tab = this.tab;
    if (!prompt || !win?.OrbitoAssistant || !tab) {
      return;
    }
    win.gBrowser.selectedTab = tab;
    this.input.value = "";
    win.OrbitoAssistant.ask(prompt, { context: "none" });
  }

  /** Searches memory for the input's text once typing pauses. */
  async #searchMemory() {
    let text = this.input.value.trim();
    this.#memoryText = text;
    let browser = window.browsingContext.embedderElement;
    if (
      !lazy.searchesMemory(text) ||
      lazy.PrivateBrowsingUtils.isBrowserPrivate(browser)
    ) {
      this.memories = [];
      return;
    }
    await new Promise(resolve => lazy.setTimeout(resolve, lazy.DELAY_MS));
    if (this.#memoryText != text) {
      return;
    }
    // The Space the window shows; without Spaces, every one alike.
    let space = this.chromeWindow?.OrbitoShell?.spaces?.current;
    let pages = await lazy.OrbitoRecall.suggest(text, {
      space: space ?? undefined,
    });
    if (this.#memoryText == text) {
      this.memories = pages;
    }
  }

  #onInputKeyDown(event) {
    if (event.key == "Enter" && !event.isComposing) {
      event.preventDefault();
      this.go().catch(console.error);
    }
  }

  /** Opens a recent visit, in this tab unless the click says otherwise. */
  #open(event, site) {
    event.preventDefault();
    let win = this.chromeWindow;
    let where = lazy.BrowserUtils.whereToOpenLink(event);
    win.openTrustedLinkIn(site.url, where, {
      targetBrowser:
        where == "current" ? window.browsingContext.embedderElement : undefined,
    });
  }

  get #rovingURL() {
    return this.sites.some(site => site.url == this.#focusedURL)
      ? this.#focusedURL
      : this.sites[0]?.url;
  }

  get #rovingMemory() {
    return this.memories.some(page => page.url == this.#focusedMemory)
      ? this.#focusedMemory
      : this.memories[0]?.url;
  }

  #onSiteKeyDown(event) {
    let urls = this.sites.map(site => site.url);
    let target = this.#keyTarget(event, urls, this.#rovingURL);
    if (target) {
      this.#focusSite(target);
    }
  }

  #onMemoryKeyDown(event) {
    let urls = this.memories.map(page => page.url);
    let target = this.#keyTarget(event, urls, this.#rovingMemory);
    if (target) {
      this.#focusMemory(target);
    }
  }

  // The URL of a list the arrow key, Home or End moves to from current.
  #keyTarget(event, urls, current) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return null;
    }
    let index = urls.indexOf(current);
    let rtl = getComputedStyle(this).direction == "rtl";
    let target;
    switch (event.key) {
      case "ArrowRight":
        target = index + (rtl ? -1 : 1);
        break;
      case "ArrowLeft":
        target = index + (rtl ? 1 : -1);
        break;
      case "ArrowDown":
        target = index + 1;
        break;
      case "ArrowUp":
        target = index - 1;
        break;
      case "Home":
        target = 0;
        break;
      case "End":
        target = urls.length - 1;
        break;
      default:
        return null;
    }
    event.preventDefault();
    return urls[Math.max(0, Math.min(target, urls.length - 1))];
  }

  async #focusSite(url) {
    this.#focusedURL = url;
    this.requestUpdate();
    await this.updateComplete;
    [...this.siteLinks].find(link => link.href == url)?.focus();
  }

  async #focusMemory(url) {
    this.#focusedMemory = url;
    this.requestUpdate();
    await this.updateComplete;
    [...this.memoryLinks].find(link => link.href == url)?.focus();
  }

  #renderMemories() {
    if (!this.memories.length) {
      return nothing;
    }
    let roving = this.#rovingMemory;
    return html`<section class="memory" aria-labelledby="memory-heading">
      <header>
        <h2 id="memory-heading">${t("orbito-newtab-memory")}</h2>
        <button
          class="more"
          @click=${() => lazy.OrbitoPages.openTimeline(this.chromeWindow)}
        >
          ${t("orbito-newtab-memory-all")}
        </button>
      </header>
      <ul>
        ${this.memories.map(
          page => html`<li>
            <a
              class="memory-page"
              href=${page.url}
              title=${page.title}
              tabindex=${page.url == roving ? 0 : -1}
              @click=${event => this.#open(event, page)}
              @auxclick=${event => event.button == 1 && this.#open(event, page)}
              @keydown=${this.#onMemoryKeyDown}
              @focus=${() => {
                this.#focusedMemory = page.url;
                this.requestUpdate();
              }}
              ><img
                src=${`page-icon:${page.url}`}
                alt=""
                width="16"
                height="16"
              /><span class="text"
                ><span class="title">${page.title}</span
                ><span class="sub"
                  >${`${hostOf(page.url)} · ${visitedWhen(page.visited_at)}`}</span
                ></span
              ></a
            >
          </li>`
        )}
      </ul>
    </section>`;
  }

  #renderSites() {
    if (!this.sites.length) {
      return nothing;
    }
    let roving = this.#rovingURL;
    return html`<nav aria-label=${t("orbito-newtab-recent")}>
      <ul class="recent">
        ${this.sites.map(
          site => html`<li>
            <a
              class="site"
              href=${site.url}
              title=${site.title}
              tabindex=${site.url == roving ? 0 : -1}
              @click=${event => this.#open(event, site)}
              @auxclick=${event => event.button == 1 && this.#open(event, site)}
              @keydown=${this.#onSiteKeyDown}
              @focus=${() => {
                this.#focusedURL = site.url;
                this.requestUpdate();
              }}
              ><img
                src=${`page-icon:${site.url}`}
                alt=""
                width="16"
                height="16"
              />${site.host}</a
            >
          </li>`
        )}
      </ul>
    </nav>`;
  }

  render() {
    return html`<link
        rel="stylesheet"
        href="chrome://browser/content/orbito/newtab/orbito-new-tab.css"
      />
      <main>
        <span class="mark" aria-hidden="true">${ORBITO_LOGO}</span>
        <div class="ask">
          ${ORBITO_LOGO}
          <input
            type="text"
            aria-label=${t("orbito-newtab-ask")}
            placeholder=${t("orbito-newtab-ask-placeholder")}
            autocomplete="off"
            @input=${() => this.#searchMemory().catch(console.error)}
            @keydown=${this.#onInputKeyDown}
          />
        </div>
        ${this.#renderSites()} ${this.#renderMemories()}
      </main>`;
  }
}
customElements.define("orbito-new-tab", OrbitoNewTab);
