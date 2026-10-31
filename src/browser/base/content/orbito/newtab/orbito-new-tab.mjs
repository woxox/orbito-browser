/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, nothing } from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";
import { ORBITO_LOGO } from "chrome://browser/content/orbito/shell/orbito-logo.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserUtils: "resource://gre/modules/BrowserUtils.sys.mjs",
  OrbitoPages: "chrome://browser/content/orbito/OrbitoPages.sys.mjs",
  OrbitoRecall: "chrome://browser/content/orbito/OrbitoRecall.sys.mjs",
  OrbitoTasks: "chrome://browser/content/orbito/OrbitoTasks.sys.mjs",
  PlacesQuery: "resource://gre/modules/PlacesQuery.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  runCommand: "chrome://browser/content/orbito/shell/OrbitoCommands.sys.mjs",
  UrlbarPrefs: "moz-src:///browser/components/urlbar/UrlbarPrefs.sys.mjs",
  UrlbarSearchUtils:
    "moz-src:///browser/components/urlbar/UrlbarSearchUtils.sys.mjs",
  UrlbarShared: "chrome://browser/content/urlbar/UrlbarShared.mjs",
  UrlbarUtils: "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs",
  routeQuery: "chrome://browser/content/orbito/OrbitoUrlbarProvider.sys.mjs",
  SearchService: "moz-src:///toolkit/components/search/SearchService.sys.mjs",
  startOfDay: "chrome://browser/content/orbito/OrbitoSchedule.sys.mjs",
});
const { OrbitoAppearance } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/shell/OrbitoAppearance.sys.mjs"
);
const { t, OrbitoL10n } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);
const {
  autofilled,
  greetingId,
  hostOf,
  NewTabSuggester,
  rowsOf,
  summaryParts,
} = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/newtab/OrbitoNewTabSuggest.sys.mjs"
);

// The page takes Orbito's light, dark and accent, as the window does.
OrbitoAppearance.follow(document);

/** How many recent visits the page shows. */
export const RECENT_LIMIT = 6;
// How many of the latest visited pages are looked through for them.
const HISTORY_LIMIT = 100;

/** The words at the end of a suggestion: what Enter does with it. */
const ROW_HINTS = {
  go: "orbito-command-bar-hint-go",
  search: "orbito-command-bar-hint-search",
  ask: "orbito-command-bar-hint-ask",
  "switch-tab": "orbito-command-bar-hint-switch-tab",
  open: "orbito-command-bar-hint-open",
  command: "orbito-command-bar-hint-command",
};

const GLOBE = html`<svg viewBox="0 0 16 16" aria-hidden="true">
  <circle cx="8" cy="8" r="6" />
  <path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" />
</svg>`;
const SEARCH = html`<svg viewBox="0 0 16 16" aria-hidden="true">
  <circle cx="7" cy="7" r="4.5" />
  <path d="M10.5 10.5 14 14" />
</svg>`;

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
 * Orbito's new tab page (about:newtab and about:home): a greeting, an input
 * for a question or an address, and the sites visited last.
 *
 * The greeting says good morning, afternoon, evening or night by the hour,
 * over today's date and, when there were some, how many pages Browsing
 * recall remembered today and how many scheduled tasks ran (none in
 * private windows). With more than one Space, the page's corner names the
 * Space its window shows.
 *
 * While something is typed the input suggests what the Command bar would
 * for the same text (OrbitoNewTabSuggest.sys.mjs): the result Enter runs,
 * search suggestions, Ask Orbito, the Command bar's commands (settings,
 * history, Show Orbito), open tabs, history and "From memory", whose
 * "See all" opens the timeline. An address it knows is completed in the
 * input past the caret, selected, as the urlbar does; Tab takes the
 * completion. The arrow keys pick a suggestion and Enter runs it: an
 * address or a page loads in this tab (or where a modifier or the middle
 * button says), a search goes to its engine, a command is done, an open
 * tab is switched to and a question opens the Assistant panel on this tab
 * and is sent at once, sharing no tab ("None" context) whatever the
 * panel's setting. Before the
 * suggestions for the text have come, Enter runs it as the Command bar's
 * top result would (routeQuery()): Firefox's URI fixup and default engine,
 * or a question. Escape closes the suggestions.
 *
 * A recent visit opens its page in this tab (or where a modifier or the
 * middle button says).
 *
 * A privileged page in the parent process: it talks to its window
 * (OrbitoAssistant), to Places and to the urlbar's providers directly. It
 * takes focus only when its tab's page does (never from the Command bar):
 * then the input gets it.
 *
 * Keyboard: the input, with its suggestions as a combobox's list, then the
 * recent visits as one tab stop, where the arrow keys move and Home and End
 * go to the ends.
 */
export class OrbitoNewTab extends MozLitElement {
  static properties = {
    /** The recent visits shown, see recentSites(). */
    sites: { type: Array },
    /** The suggestions for what is typed, see rowsOf(). */
    rows: { type: Array },
    /** The index of the suggestion picked in rows. */
    selected: { type: Number },
    /** Whether the suggestions show. */
    open: { type: Boolean },
    /** Whether the input shows a completion that Tab takes. */
    completed: { type: Boolean },
    /** The greeting's message id, see greetingId(). */
    greeting: { type: String },
    /** The line under the greeting, see summaryParts(). */
    summary: { type: Array },
    /** The name of the Space the window shows, or "" with one Space. */
    space: { type: String },
  };

  static queries = {
    input: ".ask input",
    recentList: ".recent",
    siteLinks: { all: ".site" },
    suggestionList: ".suggestions",
    suggestionRows: { all: ".suggestion" },
  };

  #history = null;
  #suggester = null;
  // What was typed, without what completes it.
  #typed = "";
  // The text the rows are for.
  #rowsText = "";
  // Whether typing may complete the text: not while deleting.
  #completes = false;
  // Whether Escape closed the suggestions for what is typed.
  #dismissed = false;
  // The recent visit the keyboard is on, by URL; the first when unset.
  #focusedURL = null;

  constructor() {
    super();
    this.sites = [];
    this.rows = [];
    this.selected = 0;
    this.open = false;
    this.completed = false;
    this.greeting = greetingId(new Date().getHours());
    this.summary = summaryParts({ now: Date.now() }, OrbitoL10n.language);
    this.space = "";
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

  get #isPrivate() {
    return lazy.PrivateBrowsingUtils.isBrowserPrivate(
      window.browsingContext.embedderElement
    );
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("focus", this);
    window.addEventListener("unload", this, { once: true });
    this.#suggester = new NewTabSuggester(this.chromeWindow);
    this.#history = new lazy.PlacesQuery();
    this.#history.observeHistory(visits => this.#showHistory(visits));
    this.#history
      .getHistory({ sortBy: "lastvisited", limit: HISTORY_LIMIT })
      .then(visits => this.#showHistory(visits), console.error);
    this.#refreshGreeting();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("focus", this);
    this.#close();
    this.#history?.close();
    this.#history = null;
  }

  handleEvent(event) {
    switch (event.type) {
      case "focus":
        this.#takeFocus();
        this.#refreshGreeting();
        break;
      case "unload":
        this.#close();
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

  /** Brings the greeting, the line under it and the Space up to date. */
  async #refreshGreeting() {
    let now = Date.now();
    this.greeting = greetingId(new Date(now).getHours());
    let spaces = this.chromeWindow?.OrbitoShell?.spaces;
    this.space =
      spaces?.list.length > 1 ? (spaces.currentSpace?.name ?? "") : "";
    let counts = { now };
    if (!this.#isPrivate) {
      let since = lazy.startOfDay(now);
      let [pagesRead, taskRuns] = await Promise.all([
        lazy.OrbitoRecall.enabled
          ? lazy.OrbitoRecall.pagesReadSince(since).catch(() => 0)
          : 0,
        lazy.OrbitoTasks.runsSince(since).catch(() => 0),
      ]);
      counts = { now, pagesRead, taskRuns };
    }
    this.summary = summaryParts(counts, OrbitoL10n.language);
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
    let isPrivate = this.#isPrivate;
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
    if (url) {
      // A typed address, which autofill learns as the urlbar's.
      lazy.UrlbarUtils.addToUrlbarHistory(url, this.chromeWindow);
    } else {
      let submission =
        lazy.UrlbarSearchUtils.getDefaultEngine(isPrivate)?.getSubmission(text);
      url = submission?.uri.spec;
      postData = submission?.postData;
    }
    if (!url) {
      return;
    }
    this.#load(url, "current", postData);
  }

  /**
   * Sends a question to the Assistant panel of this tab: the input's text,
   * or prompt.
   */
  ask(prompt = this.input.value.trim()) {
    let win = this.chromeWindow;
    let tab = this.tab;
    if (!prompt || !win?.OrbitoAssistant || !tab) {
      return;
    }
    win.gBrowser.selectedTab = tab;
    this.input.value = "";
    this.#typed = "";
    this.#close();
    win.OrbitoAssistant.ask(prompt, { context: "none" });
  }

  #load(url, where, postData = null) {
    this.#close();
    this.chromeWindow.openTrustedLinkIn(url, where, {
      targetBrowser:
        where == "current" ? window.browsingContext.embedderElement : undefined,
      postData,
      allowInheritPrincipal: false,
    });
  }

  /** Runs a suggestion, where the event says for a page. */
  async pick(row, event) {
    switch (row.kind) {
      case "ask":
        this.ask(row.result.payload.query);
        return;
      case "switch-tab":
        this.#switchToTab(row.result);
        return;
      case "command":
        this.#close();
        lazy.runCommand(row.result.payload.command, this.chromeWindow);
        return;
      case "search":
        await lazy.SearchService.init();
        break;
      case "go":
        // A typed address, which autofill learns as the urlbar's.
        lazy.UrlbarUtils.addToUrlbarHistory(row.url, this.chromeWindow);
        break;
    }
    // What the urlbar loads for the result: its address (with a keyword's
    // post data) or its engine's search.
    let { url, postData } = lazy.UrlbarUtils.getUrlFromResult(row.result);
    if (url) {
      this.#load(url, lazy.BrowserUtils.whereToOpenLink(event), postData);
    }
  }

  // Switches to the open tab, as the urlbar does: in its container, or a
  // new tab when it has closed, then closes this tab if it was left empty.
  #switchToTab(result) {
    this.#close();
    let win = this.chromeWindow;
    let tab = this.tab;
    let { userContextId = 0 } = result.payload;
    let switched = win.switchToTabHavingURI(
      Services.io.newURI(result.payload.url),
      true,
      {
        adoptIntoActiveWindow: lazy.UrlbarPrefs.get(
          "switchTabs.adoptIntoActiveWindow"
        ),
      },
      lazy.UrlbarShared.isNonPrivateUserContextId(userContextId)
        ? userContextId
        : null
    );
    if (switched && tab && !tab.splitview && tab.isEmpty) {
      win.gBrowser.removeTab(tab);
    }
  }

  #onInput(event) {
    let text = this.input.value;
    this.#typed = text;
    this.#dismissed = false;
    this.completed = false;
    this.#completes =
      event.inputType?.startsWith("insert") &&
      this.input.selectionEnd == text.length;
    this.#suggest();
  }

  /** Suggests for what is typed, or closes the suggestions for nothing. */
  #suggest() {
    let text = this.#typed;
    if (!text.trim()) {
      this.#close();
      return;
    }
    this.#suggester
      .start(
        text,
        { isPrivate: this.#isPrivate, userContextId: this.tab?.userContextId },
        results => this.#showResults(text, results)
      )
      .catch(console.error);
  }

  #showResults(text, results) {
    if (text != this.#typed) {
      return;
    }
    // The suggestion picked stays picked as more come.
    let picked = this.#rowsText == text && this.rows[this.selected]?.result;
    this.#rowsText = text;
    this.rows = rowsOf(results);
    this.selected = Math.max(
      0,
      this.rows.findIndex(row => row.result == picked)
    );
    this.open =
      this.rows.length > 0 &&
      !this.#dismissed &&
      this.shadowRoot.activeElement == this.input;
    this.#complete(results[0]);
  }

  // Completes the typed text in the input past the caret, selected, with
  // the first result's autofill, or takes away a completion it no longer
  // has.
  #complete(result) {
    let input = this.input;
    let typed = this.#typed;
    let completing =
      input.selectionStart == typed.length &&
      input.selectionEnd == input.value.length &&
      input.value.toLowerCase().startsWith(typed.toLowerCase());
    if (!completing) {
      return;
    }
    let value = (this.#completes && autofilled(typed, result)) || typed;
    if (input.value != value) {
      input.value = value;
      input.setSelectionRange(typed.length, value.length);
    }
    this.completed = value != typed;
  }

  // Whether the input shows a completion past what was typed.
  get #hasCompletion() {
    let input = this.input;
    return (
      input.value.length > this.#typed.length &&
      input.selectionStart == this.#typed.length &&
      input.selectionEnd == input.value.length
    );
  }

  /** Stops suggesting and hides the suggestions. */
  #close() {
    this.#suggester?.cancel();
    this.open = false;
    this.rows = [];
    this.#rowsText = "";
  }

  #onInputKeyDown(event) {
    if (event.isComposing) {
      return;
    }
    let count = this.rows.length;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        if (!count) {
          return;
        }
        event.preventDefault();
        // The first press after Escape shows them again.
        if (!this.open) {
          this.#dismissed = false;
          this.open = true;
          break;
        }
        this.selected =
          (this.selected + (event.key == "ArrowDown" ? 1 : -1) + count) % count;
        this.updateComplete.then(() =>
          this.suggestionRows[this.selected]?.scrollIntoView({
            block: "nearest",
          })
        );
        break;
      case "Enter": {
        event.preventDefault();
        // The suggestion picked, or with them closed the first, once the
        // first for the text typed (the heuristic result) came; before, the
        // text itself.
        let row =
          this.#rowsText == this.#typed &&
          this.rows[0]?.result.heuristic &&
          this.rows[this.open ? this.selected : 0];
        (row ? this.pick(row, event) : this.go()).catch(console.error);
        break;
      }
      case "Escape":
        // As in the urlbar: the completion goes, then the suggestions.
        if (this.#hasCompletion) {
          event.preventDefault();
          this.input.value = this.#typed;
          this.completed = false;
        } else if (this.open) {
          event.preventDefault();
          this.#dismissed = true;
          this.open = false;
          this.selected = 0;
        }
        break;
      case "Tab":
        if (
          !event.shiftKey &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          this.#hasCompletion
        ) {
          event.preventDefault();
          let end = this.input.value.length;
          this.input.setSelectionRange(end, end);
          this.#typed = this.input.value;
          this.#completes = false;
          this.completed = false;
          this.#suggest();
        }
        break;
    }
  }

  #onInputFocus() {
    if (this.rows.length && this.input.value.trim() && !this.#dismissed) {
      this.open = true;
    }
  }

  // Focus leaving the input and its suggestions hides them.
  #onAskFocusOut(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      this.open = false;
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

  #onSiteKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    let urls = this.sites.map(site => site.url);
    let index = urls.indexOf(this.#rovingURL);
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
        return;
    }
    event.preventDefault();
    this.#focusSite(urls[Math.max(0, Math.min(target, urls.length - 1))]);
  }

  async #focusSite(url) {
    this.#focusedURL = url;
    this.requestUpdate();
    await this.updateComplete;
    [...this.siteLinks].find(link => link.href == url)?.focus();
  }

  #rowIcon(row) {
    switch (row.kind) {
      case "go":
        return GLOBE;
      case "search":
        return SEARCH;
      case "ask":
        return ORBITO_LOGO;
    }
    return html`<img
      src=${row.icon ?? `page-icon:${row.url}`}
      alt=""
      width="16"
      height="16"
    />`;
  }

  #renderRow(row, index) {
    return html`<li
      class="suggestion"
      id=${`suggestion-${index}`}
      role="option"
      aria-selected=${index == this.selected}
      data-kind=${row.kind}
      @mousemove=${() => {
        this.selected = index;
      }}
      @mousedown=${event => event.preventDefault()}
      @click=${event => this.pick(row, event).catch(console.error)}
      @auxclick=${event =>
        event.button == 1 && this.pick(row, event).catch(console.error)}
    >
      <span class="icon">${this.#rowIcon(row)}</span>
      <span class="title">${row.title}</span>
      ${row.sub ? html`<span class="sub">${row.sub}</span>` : nothing}
      <span class="hint">${t(ROW_HINTS[row.kind])}</span>
    </li>`;
  }

  #renderSuggestions() {
    if (!this.open) {
      return nothing;
    }
    // The rows in groups of one section each, the section's heading over
    // all but the top group.
    let groups = [];
    for (let [index, row] of this.rows.entries()) {
      if (groups.at(-1)?.group != row.group) {
        groups.push({ group: row.group, section: row.section, rows: [] });
      }
      groups.at(-1).rows.push([row, index]);
    }
    return html`<div class="suggestions">
      <div
        class="groups"
        role="listbox"
        id="suggestions"
        aria-label=${t("orbito-newtab-suggestions")}
      >
        ${groups.map(
          (group, i) =>
            html`<ul
              role="group"
              aria-labelledby=${group.section ? `section-${i}` : nothing}
            >
              ${group.section
                ? html`<li class="section" role="presentation">
                    <span id=${`section-${i}`}>${group.section}</span>
                    ${group.group == "memory"
                      ? html`<button
                          class="more"
                          tabindex="-1"
                          @mousedown=${event => event.preventDefault()}
                          @click=${() =>
                            lazy.OrbitoPages.openTimeline(this.chromeWindow)}
                        >
                          ${t("orbito-newtab-memory-all")}
                        </button>`
                      : nothing}
                  </li>`
                : nothing}
              ${group.rows.map(([row, index]) => this.#renderRow(row, index))}
            </ul>`
        )}
      </div>
      <div class="keys" aria-hidden="true">
        <span
          ><kbd>↑</kbd> <kbd>↓</kbd> ${t("orbito-command-bar-key-select")}</span
        >
        <span><kbd>↵</kbd> ${t("orbito-command-bar-key-open")}</span>
        <span
          ><kbd>${t("orbito-command-bar-key-esc")}</kbd> ${t(
            "orbito-command-bar-key-close"
          )}</span
        >
      </div>
    </div>`;
  }

  #renderSites() {
    if (!this.sites.length) {
      return nothing;
    }
    let roving = this.#rovingURL;
    return html`<nav aria-labelledby="recent-heading">
      <h2 id="recent-heading">${t("orbito-newtab-recent")}</h2>
      <ul class="recent">
        ${this.sites.map(
          site =>
            html`<li>
              <a
                class="site"
                href=${site.url}
                title=${site.title}
                tabindex=${site.url == roving ? 0 : -1}
                @click=${event => this.#open(event, site)}
                @auxclick=${event =>
                  event.button == 1 && this.#open(event, site)}
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
    let open = this.open && this.rows.length > 0;
    return html`<link
        rel="stylesheet"
        href="chrome://browser/content/orbito/newtab/orbito-new-tab.css"
      />
      ${this.space
        ? html`<p class="space">
            <span class="dot" aria-hidden="true"></span>${t(
              "orbito-newtab-space",
              { name: this.space }
            )}
          </p>`
        : nothing}
      <main>
        <span class="mark" aria-hidden="true">${ORBITO_LOGO}</span>
        <header class="greeting">
          <h1>${t(this.greeting)}</h1>
          <p>${this.summary.join(" · ")}</p>
        </header>
        <div class="ask-slot">
          <div class="ask" ?open=${open} @focusout=${this.#onAskFocusOut}>
            <label class="field">
              ${SEARCH}
              <input
                type="text"
                role="combobox"
                aria-label=${t("orbito-newtab-ask")}
                aria-autocomplete="both"
                aria-expanded=${open}
                aria-controls="suggestions"
                aria-activedescendant=${open
                  ? `suggestion-${this.selected}`
                  : nothing}
                placeholder=${t("orbito-newtab-ask-placeholder")}
                autocomplete="off"
                spellcheck="false"
                @input=${this.#onInput}
                @keydown=${this.#onInputKeyDown}
                @focus=${this.#onInputFocus}
              />
              ${this.completed
                ? html`<span class="complete" aria-hidden="true"
                    ><kbd>${t("orbito-newtab-key-tab")}</kbd> ${t(
                      "orbito-newtab-complete"
                    )}</span
                  >`
                : nothing}
            </label>
            ${this.#renderSuggestions()}
          </div>
        </div>
        ${this.#renderSites()}
      </main>`;
  }
}
customElements.define("orbito-new-tab", OrbitoNewTab);
