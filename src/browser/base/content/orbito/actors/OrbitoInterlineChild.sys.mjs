/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Page side of Interline (OrbitoInterline.sys.mjs), one per top-level web
 * page: finds the page's paragraphs as they come into view, sends their
 * text up one unit at a time, and shows the translations under them
 * (bilingual) or instead of them (replace). Holding the hover key over a
 * paragraph translates only that one, whether or not the tab translates.
 *
 * This module is shared by every page of the content process: all state
 * lives on the actor and its InterlinePage, never at module level. DOM
 * constructors and globals come from the page's window.
 *
 * The page never sees a key, an engine or a target language: it sends
 * text, and asks the parent what it should show (Interline:Sync), which
 * the parent also pushes (Interline:Set) when that changes.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

const SHEET = "chrome://browser/content/orbito/actors/OrbitoInterline.css";
const BATCH_SIZE = 50; // elements per animation frame
const MAX_UNIT_RETRIES = 2;
const MAX_VISIBILITY_RETRIES = 8;
const VISIBILITY_RETRY_MS = 1500;
// Translates this far ahead of the viewport.
const ROOT_MARGIN = "1200px";
// Enough of the page for the parent to detect its language by.
const SAMPLE_CHARS = 1000;
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const SHOW_TEXT = 4; // NodeFilter.SHOW_TEXT
const FILTER_ACCEPT = 1;
const FILTER_REJECT = 2;

const TRANSLATED_ATTR = "il-marked";
const FAILED_ATTR = "il-fails";
// What Interline inserts; never scanned or translated again.
const OWN_NODES = "font.il-dual, il-dual, il-trans, il-content";

// Ported from Interline (after Trancy's default rule), with the XT-* names
// its il- rename missed written as IL-*.
const SKIP_TAGS = new Set([
  "IFRAME",
  "C-WIZ",
  "META",
  "IMAGE",
  "SCRIPT",
  "HEAD",
  "STYLE",
  "SVG",
  "NOSCRIPT",
  "FIGCAPTION",
  "PRE",
  "FORM",
  "CODE",
  "DIFF-FILE-FILTER",
  "FILE-ATTACHMENT",
  "QBSEARCH-INPUT",
  "DIFF-LAYOUT",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "OPTION",
  "I",
  "IL-DUAL",
  "IL-CONTENT",
  "IL-TRANS",
  "MAT-ICON",
  "MATH-RENDERER",
  "TASK-LISTS",
]);
const SKIP_CLASS = new Set([
  "blob-code-content",
  "diff-view",
  "monaco-mouse-cursor-text",
  "il-wrap",
  "il-ignore",
  "notranslate",
]);
// Checked with closest(): the element and its ancestors.
const SKIP_ANCESTOR_SELECTOR = [
  // Page structure (div menus are told by their ARIA role).
  "nav",
  "footer",
  "header",
  "aside",
  '[role="navigation"]',
  '[role="banner"]',
  '[role="menubar"]',
  '[role="menu"]',
  '[role="toolbar"]',
  // Fields, forms and code.
  "input",
  "select",
  "textarea",
  "form",
  "svg",
  "pre",
  "script",
  "style",
  "head",
  "i",
  "code",
  '[contenteditable="true"]',
  "[role=code]",
  ".prism-code",
  ".enlighter-code",
  ".rc-CodeBlock",
  "div[data-paste-markdown-skip]",
  "table.highlight",
  "div[class^=codeBlockContent]",
  "div[class^=codeBlockLines]",
  "div[class^=token-line]",
  ".code",
  "cds-code-snippet",
  ".interactive-markdown__code",
  "kbd",
  "MILKDOWN-CODE-BLOCK",
  // Icon fonts.
  ".material-symbols",
  ".material-icons",
  "material-icon",
  "i.fa",
  "i[class^=fa-]",
  ".google-symbols",
  "span[class^=material-symbols-]",
  // Marked as not to translate.
  ".notranslate",
  ":not(html):not(body)[translate='no']",
  "[data-notranslate]",
  "em[translate=no]",
  "code[translate=no]",
  // Math.
  "math-renderer",
  "span.katex",
  ".math-block",
  ".MathJax_Preview",
  ".MathJax_Display",
  ".math-container",
  ".MathJax",
  ".MathJax_SVG",
  '[aria-labelledby^="MathJax-SVG"]',
  ".mwe-math-element",
  "span.math.inline",
  "span.math.display",
  ".ltx_Math",
  ".mathjax-block",
  ".MathJax_CHTML",
  "span.pretex-inline",
  "span.math-inline",
  // Ruby, times, share widgets and other UI.
  "rp",
  "rt",
  "ruby",
  "time",
  ".countdown",
  ".social-share",
  ".post__footer",
  ".btn",
  ".share-nav",
  ".o-share",
  "[data-toolbar=share]",
  ".navmenu-container",
  ".reference-citations",
  ".easyscholar-ranking",
  "h1 br",
  "h2 br",
  "h3 br",
  "h4 br",
  ".textLayer > span[role=presentation]",
  ".rpv-core__text-layer > span[role=presentation]",
  // Interline's own nodes and other translation extensions'.
  "font.il-dual",
  "il-dual",
  "il-trans",
  "trancy-app",
  "#trancy-root",
  "trancy-caption-window",
  ".il-ignore",
  ".rd-slider-inside",
  ".uacc-clickable",
  "#monica-content-root",
  "#immersive-translate-popup",
  "#immersive-translate-float-ball",
  "#omni-extension",
  ".omni-item",
  "#liuchan-window > .liuchan-container > *",
  "relin-hc",
  "x-p",
  "xqdd_highlight_new_word",
  "rw-highlight",
  "hypothesis-highlight",
].join(", ");
// Digits, spaces, punctuation and units only.
const SKIP_PATTERN = /^[\d\s.,:%+\-\xb7/\\:：()（）kKmMbB万亿]+$/;
const HAS_LETTER = /\p{L}/u;
// A unit is translated only inside one of these. Every boundary tag must be
// here, or its units are all skipped.
const INCLUDE_SELECTOR =
  "p, h1, h2, h3, h4, h5, h6, li, span, div, td, th, dt, dd, blockquote, summary, a, figcaption, button";
// Text is translated by the nearest of these around it.
const SEMANTIC_BOUNDARY_TAGS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "TD",
  "TH",
  "DT",
  "DD",
  "BLOCKQUOTE",
  "FIGCAPTION",
  "SUMMARY",
]);
// Never a unit of their own: their text goes with their parent's.
const KNOWN_INLINE_TAGS = new Set([
  "A",
  "B",
  "I",
  "U",
  "S",
  "EM",
  "STRONG",
  "SPAN",
  "CODE",
  "KBD",
  "SAMP",
  "VAR",
  "SUB",
  "SUP",
  "SMALL",
  "MARK",
  "DEL",
  "INS",
  "ABBR",
  "CITE",
  "Q",
  "TIME",
  "LABEL",
  "BIG",
  "FONT",
  "WBR",
  "DATA",
  "BDI",
  "BDO",
  "RUBY",
  "RT",
  "RP",
]);
// More words than this: the translation goes on a line of its own.
const BLOCK_THRESHOLD = { P: 2, BLOCKQUOTE: 2, FIGCAPTION: 2, BUTTON: 10 };
const BLOCK_THRESHOLD_DEFAULT = 4;
// Translated even in a header, which is otherwise skipped.
const EXTRACT_SELECTOR = "header h1, header h2, header h3, header p";
// Short span, div and a text reads as a UI label, unless in a heading or
// a list item.
const SHORT_FILTER_TAGS = new Set(["SPAN", "DIV", "A"]);
const SHORT_FILTER_MAX_LENGTH = 20;
const SHORT_FILTER_KEEP_PARENT = "h1, h2, h3, h4, h5, h6, li";
// What a translation may rebuild of the original's inline elements.
const ALLOWED_TAGS = new Set([
  "b",
  "i",
  "u",
  "strong",
  "em",
  "mark",
  "sub",
  "sup",
  "small",
  "s",
  "del",
  "ins",
  "code",
  "kbd",
  "samp",
  "var",
  "br",
  "a",
]);
const ALLOWED_LINK_ATTRS = ["href", "title", "target", "rel"];

// Per site, by host: include (translate only inside these) and exclude
// (skip these too).
const SITE_RULES = [
  {
    match: /(^|\.)github\.com$/,
    include: [".markdown-body"],
    exclude: [
      "[aria-labelledby='folders-and-files']",
      ".opened-by",
      "#repository-container-header",
      "#partial-discussion-sidebar",
      ".gh-header-show",
      ".gh-header-meta",
      ".timeline-comment-header",
      "[data-test-selector='commit-tease-commit-message']",
      "[data-test-selector='create-branch.developmentForm']",
      "div.Box-header.position-relative",
      "div.blob-wrapper-embedded",
      "div.Box.Box--condensed.my-2",
      "div.jp-CodeCell",
      '[aria-label="Account"] .markdown-title',
      ".js-repos-container .markdown-title",
      "a.anchor",
      "div.file-navigation + div.Box",
      "[data-testid^='breadcrumbs']",
      "[data-ga-click*=Star]",
      ".Layout-sidebar",
      "[data-testid='issue-viewer-metadata-container']",
      ".diff-table",
      ".diff-view",
      "[data-testid='list-row-repo-name-and-number']",
      "[data-testid='list-row-state-icon']",
      ".table-list-filters",
      "button",
      ".graph-before-activity-overview",
    ],
  },
  {
    match: /(^|\.)reddit\.com$/,
    exclude: [
      // Post flair (passes the short-label filter inside an li).
      "shreddit-post-flair",
      ".flair-content",
      // Screen-reader-only text and tooltips.
      "faceplate-screen-reader-content",
      "rpl-tooltip",
      // Relative times and the credit bar.
      "faceplate-timeago",
      'shreddit-post [slot="credit-bar"]',
      // Vote and share buttons.
      "shreddit-post-overflow-menu",
      "shreddit-status-icons",
      "award-button",
    ],
  },
];

/**
 * @typedef {object} Rule The selectors one document is translated by.
 * @property {string} include Translate only inside these ("" for anywhere).
 * @property {string} exclude Skip these too ("" for none).
 * @property {string} extractExclude Kept as a placeholder inside a unit.
 */

/** @returns {Rule} The rule for a host. */
export function siteRule(hostname) {
  let site = SITE_RULES.find(rule => rule.match.test(hostname));
  let exclude = site?.exclude?.join(", ") ?? "";
  return {
    include: site?.include?.join(", ") ?? "",
    exclude,
    extractExclude: exclude
      ? `${SKIP_ANCESTOR_SELECTOR}, ${exclude}`
      : SKIP_ANCESTOR_SELECTOR,
  };
}

/**
 * @typedef {object} Unit One run of text sent as one request.
 * @property {Node[]} nodes The original nodes of the unit.
 * @property {Node|null} anchor Insert the translation before this, or append.
 * @property {string} text HTML-escaped text with <n>..</n> placeholders.
 * @property {string} plain The text without placeholders.
 * @property {Map<number, {shell: Element, excluded: boolean}>} tagMap
 *   n -> the original inline element (rebuilt shallow on render), or an
 *   excluded subtree (code, kbd, math) put back whole in place of <n></n>.
 */

/** @typedef {import("../OrbitoInterline.sys.mjs").Desired} Desired */

export class OrbitoInterlineChild extends JSWindowActorChild {
  /** @type {InterlinePage|null} */ #page = null;
  /** @type {HoverKey|null} */ #hover = null;
  /** @type {Map<number, (text: string) => void>} */ #pending = new Map();
  #nextId = 1;
  /** @type {Desired|null} */ #desired = null;

  handleEvent(event) {
    switch (event.type) {
      case "DOMContentLoaded":
        if (event.target == this.document) {
          this.#sync({ restored: false });
        }
        break;
      case "pageshow":
        if (event.persisted) {
          this.#sync({ restored: true });
        }
        break;
      case "pagehide":
        // Into bfcache, or away: stop asking, and stop paying for answers.
        this.#page?.suspend();
        this.#pending.clear();
        this.#send("Interline:Cancel", {});
        break;
    }
  }

  receiveMessage({ name, data }) {
    switch (name) {
      case "Interline:Set":
        this.#apply(data, { restored: false });
        break;
      case "Interline:Delta":
        this.#pending.get(data?.id)?.(String(data.text));
        break;
    }
  }

  async #sync({ restored }) {
    let doc = this.document;
    let lang = doc.documentElement?.getAttribute("lang")?.trim() || "";
    let desired;
    try {
      desired = await this.sendQuery("Interline:Sync", {
        lang,
        sample: lang ? "" : textSample(doc, SAMPLE_CHARS),
      });
    } catch {
      return; // the actor went away
    }
    this.#apply(desired, { restored });
  }

  /**
   * Makes the page show what `desired` says. Idempotent: any number of
   * Set and Sync answers, in any order, end in the same page.
   *
   * @param {Desired} desired
   */
  #apply(desired, { restored }) {
    this.#desired = desired;
    if (desired.hoverKey) {
      this.#hover ??= new HoverKey(this.contentWindow, (point, toggle) =>
        this.#pageObj().hoverAt(point, toggle)
      );
      this.#hover.setKey(desired.hoverKey);
    } else {
      this.#hover?.dispose();
      this.#hover = null;
    }
    let page = this.#page;
    if (
      page?.running &&
      (desired.page != "on" || page.epoch != desired.epoch)
    ) {
      // What is in flight was asked for what the page will no longer show.
      this.#pending.clear();
      this.#send("Interline:Cancel", {});
    }
    switch (desired.page) {
      case "off":
        this.#page?.stop();
        if (!desired.hoverKey) {
          this.#page?.removeSheet();
        }
        break;
      case "halted":
        this.#page?.halt();
        break;
      case "on": {
        let page = this.#pageObj();
        if (page.running && page.epoch == desired.epoch) {
          if (restored) {
            page.resync();
          }
        } else {
          page.stop();
          page.start(desired);
        }
        break;
      }
    }
  }

  /** The page translator, made on first need. */
  #pageObj() {
    this.#page ??= new InterlinePage(this.contentWindow, {
      mode: () => this.#desired?.mode ?? "bilingual",
      request: (text, onDelta) => this.#request(text, onDelta),
    });
    return this.#page;
  }

  /**
   * One unit up to the parent.
   *
   * @returns {Promise<{text: string} | {error: {kind: string, retryable: boolean}}>}
   */
  async #request(text, onDelta) {
    let id = this.#nextId++;
    if (onDelta) {
      this.#pending.set(id, onDelta);
    }
    try {
      return await this.sendQuery("Interline:Translate", { id, text });
    } catch {
      return { error: { kind: "gone", retryable: false } };
    } finally {
      this.#pending.delete(id);
    }
  }

  #send(name, data) {
    try {
      this.sendAsyncMessage(name, data);
    } catch {}
  }

  didDestroy() {
    this.#page?.halt();
    this.#hover?.dispose();
    this.#pending.clear();
    this.#page = this.#hover = null;
  }
}

/** The first `max` characters of the page's text, for language detection. */
function textSample(doc, max) {
  if (!doc.body) {
    return "";
  }
  let walker = doc.createTreeWalker(doc.body, SHOW_TEXT, {
    acceptNode: node =>
      node.parentElement?.closest("script, style, noscript, template")
        ? FILTER_REJECT
        : FILTER_ACCEPT,
  });
  let text = "";
  let node;
  while (text.length < max && (node = walker.nextNode())) {
    let piece = node.nodeValue.replace(/\s+/g, " ").trim();
    if (piece) {
      text += piece + " ";
    }
  }
  return text.slice(0, max).trim();
}

/**
 * Interline's page translator for one document: everything Interline kept
 * at module level lives here.
 */
export class InterlinePage {
  running = false;
  epoch = -1;
  // Bumped whenever answers in flight must no longer land.
  generation = 0;
  /** @type {IntersectionObserver|null} */ io = null;
  /** @type {MutationObserver|null} */ mo = null;
  visibilityRetries = new WeakMap();
  // Element -> the #commit that marked it, so an older one leaves the mark.
  #marks = new WeakMap();
  #sheet = false;

  /**
   * @param {Window} win The page's window.
   * @param {{mode: () => "bilingual"|"replace",
   *          request: (text: string, onDelta?: (t: string) => void) =>
   *            Promise<{text: string} | {error: {kind: string, retryable: boolean}}>}} deps
   */
  constructor(win, deps) {
    this.win = win;
    this.doc = win.document;
    this.deps = deps;
    this.rule = siteRule(win.location.hostname);
  }

  /** Observes the body and translates what comes into view. */
  start({ epoch }) {
    this.epoch = epoch;
    this.running = true;
    if (!this.doc.body) {
      return;
    }
    this.ensureSheet();
    this.#observe();
  }

  /** Observers that answer for the current generation, over the body. */
  #observe() {
    this.io?.disconnect();
    this.mo?.disconnect();
    let gen = this.generation;
    this.io = new this.win.IntersectionObserver(
      entries => this.#onIntersect(entries, gen),
      { rootMargin: ROOT_MARGIN }
    );
    this.mo = new this.win.MutationObserver(mutations =>
      this.#onMutations(mutations)
    );
    this.mo.observe(this.doc.body, { childList: true, subtree: true });
    this.scheduleElements(this.doc.body);
  }

  /** Stops asking; keeps what is shown. */
  halt() {
    this.generation++;
    this.io?.disconnect();
    this.mo?.disconnect();
    this.io = this.mo = null;
    this.running = false;
  }

  /** Removes every translation and mark. Safe when already stopped. */
  stop() {
    this.halt();
    this.epoch = -1;
    let doc = this.doc;
    for (let el of doc.querySelectorAll("font.il-dual, il-trans")) {
      el.remove();
    }
    for (let el of doc.querySelectorAll("il-dual")) {
      el.replaceWith(...el.childNodes);
    }
    for (let attr of [TRANSLATED_ATTR, FAILED_ATTR]) {
      for (let el of doc.querySelectorAll(`[${attr}]`)) {
        el.removeAttribute(attr);
      }
    }
  }

  /** pagehide: the answers in flight will not come. */
  suspend() {
    this.generation++;
  }

  /**
   * bfcache restore: clears half-done units and looks again, with new
   * observers (suspend() left the old ones a generation behind).
   */
  resync() {
    for (let shell of this.doc.querySelectorAll("font.il-dual.il-loading")) {
      shell.parentElement?.removeAttribute(TRANSLATED_ATTR);
      shell.remove();
    }
    if (this.doc.body) {
      this.#observe();
    }
  }

  /**
   * The hover key went down (toggle) or the pointer moved with it held:
   * translates the paragraph under the point, or on a new press takes a
   * translation there away again.
   *
   * @returns {boolean} Whether there was something there to act on.
   */
  hoverAt({ x, y }, toggle) {
    let target = this.doc.elementFromPoint(x, y);
    if (target?.nodeType != ELEMENT_NODE) {
      return false;
    }
    let marked = target.closest(`[${TRANSLATED_ATTR}="ok"]`);
    if (marked) {
      if (toggle) {
        removeTranslations(marked);
      }
      return true;
    }
    let shown = target.closest("font.il-dual, il-trans");
    if (shown) {
      if (!toggle) {
        return false;
      }
      if (shown.parentElement) {
        removeTranslations(shown.parentElement);
      } else {
        shown.remove();
      }
      return true;
    }
    let el = findTranslatableParent(target, this.doc.body);
    if (!el) {
      return false;
    }
    this.io?.unobserve(el);
    this.ensureSheet();
    let prep = this.#prepare(el, true);
    if (prep) {
      this.#commit(prep, this.generation).catch(console.error);
    }
    return true;
  }

  /** The page CSS, once, as an author sheet (not subject to page CSP). */
  ensureSheet() {
    if (!this.#sheet) {
      let utils = this.win.windowUtils;
      utils.loadSheetUsingURIString(SHEET, utils.AUTHOR_SHEET);
      this.#sheet = true;
    }
  }

  /** Takes the page CSS away again, once nothing of Interline is shown. */
  removeSheet() {
    if (this.#sheet) {
      let utils = this.win.windowUtils;
      utils.removeSheetUsingURIString(SHEET, utils.AUTHOR_SHEET);
      this.#sheet = false;
    }
  }

  scheduleElements(root) {
    for (let el of collectParents(this.win, root, this.rule)) {
      this.io?.observe(el);
    }
  }

  #onIntersect(entries, gen) {
    if (gen != this.generation) {
      return;
    }
    let visible = [];
    for (let entry of entries) {
      let el = entry.target;
      if (
        entry.intersectionRatio <= 0 ||
        el.getAttribute(TRANSLATED_ATTR) == "ok"
      ) {
        continue;
      }
      if (isVisible(el)) {
        visible.push(el);
        continue;
      }
      // The observer does not fire again for a fade-in: look again later
      // (unobserve and observe give a new first entry), a few times.
      let tries = this.visibilityRetries.get(el) ?? 0;
      if (tries >= MAX_VISIBILITY_RETRIES) {
        continue;
      }
      this.visibilityRetries.set(el, tries + 1);
      lazy.setTimeout(() => {
        if (gen != this.generation || !el.isConnected || !this.io) {
          return;
        }
        this.io.unobserve(el);
        this.io.observe(el);
      }, VISIBILITY_RETRY_MS);
    }
    if (visible.length) {
      this.#processBatch(visible, gen).catch(console.error);
    }
  }

  #onMutations(mutations) {
    for (let mutation of mutations) {
      for (let node of mutation.addedNodes) {
        // An empty element filled in later (chats, live feeds) adds a text
        // node: its parent is scanned.
        let el = node.nodeType == TEXT_NODE ? node.parentElement : node;
        if (el?.nodeType != ELEMENT_NODE || el.closest(OWN_NODES)) {
          continue;
        }
        this.scheduleElements(el);
      }
    }
  }

  /**
   * Fifty elements a frame, each chunk read first (styles, text) and then
   * written, so reading never forces a layout of what was just written.
   */
  async #processBatch(elements, gen) {
    for (let i = 0; i < elements.length; i += BATCH_SIZE) {
      await new Promise(resolve => this.win.requestAnimationFrame(resolve));
      if (gen != this.generation) {
        return;
      }
      let prepared = [];
      for (let el of elements.slice(i, i + BATCH_SIZE)) {
        if (!el.parentElement || el.getAttribute(TRANSLATED_ATTR) == "ok") {
          continue;
        }
        this.io?.unobserve(el);
        let prep = this.#prepare(el, false);
        if (prep) {
          prepared.push(prep);
        }
      }
      for (let prep of prepared) {
        this.#commit(prep, gen).catch(console.error);
      }
    }
  }

  #prepare(el, force) {
    if (el.getAttribute(TRANSLATED_ATTR) == "ok") {
      return null;
    }
    if (!force && isSkippable(el, this.rule)) {
      return null;
    }
    let units = buildUnits(this.win, el, { force, rule: this.rule });
    if (!units.length) {
      return null;
    }
    // Read now: the computed style is live and would force a restyle later.
    let whiteSpace = this.win.getComputedStyle(el).whiteSpace;
    return { el, units, whiteSpace, force };
  }

  async #commit({ el, units, whiteSpace, force }, gen) {
    if (el.getAttribute(TRANSLATED_ATTR) == "ok") {
      return;
    }
    let mark = {};
    el.setAttribute(TRANSLATED_ATTR, "ok");
    this.#marks.set(el, mark);
    let results = await Promise.all(
      units.map(unit =>
        this.#translateUnit(el, unit, {
          block: isBlockUnit(el, unit),
          whiteSpace,
          gen,
          force,
        })
      )
    );
    if (results.every(result => result.ok) || this.#marks.get(el) !== mark) {
      return;
    }
    // Units that made it are not translated again (hasDualSibling and the
    // IL-* skips in buildUnits); the rest may be tried again.
    el.removeAttribute(TRANSLATED_ATTR);
    if (force || !this.io) {
      return;
    }
    if (gen != this.generation) {
      // Started over (a bfcache restore) since: the observer looks again.
      this.io.observe(el);
      return;
    }
    let fails = Number(el.getAttribute(FAILED_ATTR) ?? 0);
    let retryable = results.every(result => result.ok || result.retryable);
    if (retryable && fails < MAX_UNIT_RETRIES) {
      el.setAttribute(FAILED_ATTR, String(fails + 1));
      this.io.observe(el);
    }
  }

  /**
   * One unit: its loading shell, the request, the streamed preview and the
   * final translation.
   *
   * @returns {Promise<{ok: boolean, retryable?: boolean}>}
   */
  async #translateUnit(el, unit, { block, whiteSpace, gen, force }) {
    let doc = this.doc;
    let current = () => (force || gen == this.generation) && el.isConnected;
    if (this.deps.mode() == "replace") {
      let answer = await this.deps.request(unit.text);
      if (answer.error || !current() || !unit.nodes[0].isConnected) {
        return { ok: false, retryable: answer.error?.retryable ?? true };
      }
      let trans = doc.createElement("il-trans");
      trans.append(renderUnit(doc, answer.text, unit.tagMap));
      // The original stays, hidden, so a hover can bring it back.
      let original = doc.createElement("il-dual");
      let first = unit.nodes[0];
      first.parentNode.insertBefore(trans, first);
      trans.after(original);
      original.append(...unit.nodes);
      return { ok: true };
    }

    if (hasDualSibling(unit)) {
      return { ok: true };
    }
    let dual = doc.createElement("font");
    dual.className = `notranslate il-dual${block ? " il-block" : ""} il-loading`;
    let content = doc.createElement("il-content");
    // The original's text keeps the shell's size while it shimmers.
    content.textContent = unit.nodes.map(n => n.textContent ?? "").join("");
    if (block) {
      dual.append(doc.createElement("br"), content);
    } else {
      if (whiteSpace == "nowrap" || whiteSpace == "pre") {
        dual.style.whiteSpace = whiteSpace;
      }
      dual.append("\xa0\xa0", content);
    }
    if (unit.anchor) {
      el.insertBefore(dual, unit.anchor);
    } else {
      el.append(dual);
    }

    // Chunks arrive in bursts; the preview types at a steady pace instead,
    // on placeholder-free text (half a tag would not render).
    let target = "";
    let typed = 0;
    let started = false;
    let frame = 0;
    let live = () => (force || gen == this.generation) && dual.isConnected;
    let tick = () => {
      frame = 0;
      if (!live()) {
        return;
      }
      if (typed < target.length) {
        typed += Math.max(1, Math.ceil((target.length - typed) / 8));
        content.textContent = target.slice(0, typed);
      }
      if (typed < target.length) {
        frame = this.win.requestAnimationFrame(tick);
      }
    };
    let onDelta = partial => {
      if (!live()) {
        return;
      }
      if (!started) {
        started = true;
        dual.classList.remove("il-loading");
        content.textContent = "";
        content.style.opacity = "0.80";
      }
      target = stripPlaceholders(partial);
      if (!frame && typed < target.length) {
        frame = this.win.requestAnimationFrame(tick);
      }
    };

    let answer = await this.deps.request(unit.text, onDelta);
    if (answer.error || !live()) {
      if (frame) {
        this.win.cancelAnimationFrame(frame);
      }
      dual.remove();
      return { ok: false, retryable: answer.error?.retryable ?? true };
    }
    // Let the typing catch up before the final text replaces it.
    while (live() && typed < target.length) {
      await new Promise(resolve => this.win.requestAnimationFrame(resolve));
    }
    if (frame) {
      this.win.cancelAnimationFrame(frame);
    }
    if (!dual.isConnected) {
      return { ok: false, retryable: true };
    }
    dual.classList.remove("il-loading");
    content.replaceChildren(renderUnit(doc, answer.text, unit.tagMap));
    content.style.opacity = "0.80";
    return { ok: true };
  }
}

/** The hover key: listeners on the page's window, removed in dispose(). */
export class HoverKey {
  #key = "";
  #pressed = false;
  /** @type {{x: number, y: number}|null} */ #point = null;
  #lastTarget = null;

  /**
   * @param {Window} win
   * @param {(point: {x: number, y: number}, toggle: boolean) => boolean} onHover
   *   toggle on a new press; returns whether it found something.
   */
  constructor(win, onHover) {
    this.win = win;
    this.onHover = onHover;
    // Added by hand, not as the actor's events, which would wake an actor
    // on every mouse move; untrusted events never count.
    for (let type of ["mousemove", "keydown", "keyup"]) {
      win.addEventListener(type, this, { capture: true }, false);
    }
    win.addEventListener("blur", this, false, false);
  }

  setKey(key) {
    this.#key = key;
  }

  handleEvent(event) {
    if (!event.isTrusted) {
      return;
    }
    switch (event.type) {
      case "mousemove":
        this.#point = { x: event.clientX, y: event.clientY };
        // Held: a paragraph the pointer moves onto translates too.
        if (this.#pressed && event.target != this.#lastTarget) {
          this.#lastTarget = event.target;
          this.onHover(this.#point, false);
        }
        break;
      case "keydown":
        if (event.key != this.#key || isEditing(this.win.document)) {
          // Part of a shortcut (Alt+Tab, Shift+Arrow), or typing: not a
          // hover, and the key stays the page's.
          this.#pressed = false;
          break;
        }
        if (event.repeat) {
          break;
        }
        this.#pressed = true;
        this.#lastTarget = null;
        // Only then does the key not do what it does on the page.
        if (this.#point && this.onHover(this.#point, true)) {
          event.preventDefault();
        }
        break;
      case "keyup":
        if (event.key == this.#key) {
          this.#pressed = false;
          this.#lastTarget = null;
        }
        break;
      case "blur":
        // The keyup goes to another window.
        this.#pressed = false;
        this.#lastTarget = null;
        this.#point = null;
        break;
    }
  }

  dispose() {
    for (let type of ["mousemove", "keydown", "keyup"]) {
      this.win.removeEventListener(type, this, { capture: true });
    }
    this.win.removeEventListener("blur", this);
  }
}

/** Whether the focus is in a field or editable text. */
function isEditing(doc) {
  if (doc.designMode == "on") {
    return true;
  }
  let el = doc.activeElement;
  while (el?.openOrClosedShadowRoot?.activeElement) {
    el = el.openOrClosedShadowRoot.activeElement;
  }
  return (
    !!el &&
    (el.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
  );
}

/** Takes a paragraph's translations away and brings its original back. */
function removeTranslations(el) {
  for (let shown of el.querySelectorAll(":scope > font.il-dual, :scope > il-trans")) {
    shown.remove();
  }
  for (let original of el.querySelectorAll(":scope > il-dual")) {
    original.replaceWith(...original.childNodes);
  }
  el.removeAttribute(TRANSLATED_ATTR);
}

/**
 * The nearest element with text around a hovered one: a hover translates
 * whatever the filters say, only never Interline's own nodes.
 */
function findTranslatableParent(el, body) {
  if (el.closest(OWN_NODES)) {
    return null;
  }
  for (let current = el; current && current != body; current = current.parentElement) {
    if (current.tagName != "FONT" && current.textContent.trim()) {
      return current;
    }
  }
  return null;
}

function hasSkipTagOrClass(el) {
  if (SKIP_TAGS.has(el.tagName)) {
    return true;
  }
  for (let name of el.classList) {
    if (SKIP_CLASS.has(name)) {
      return true;
    }
  }
  return false;
}

function isShortUiLabel(el, text) {
  return (
    SHORT_FILTER_TAGS.has(el.tagName) &&
    text.length <= SHORT_FILTER_MAX_LENGTH &&
    !el.closest(SHORT_FILTER_KEEP_PARENT)
  );
}

/** Whether a boundary element is left alone. */
export function isSkippable(el, rule) {
  if (el.getAttribute(TRANSLATED_ATTR) == "ok" || hasSkipTagOrClass(el)) {
    return true;
  }
  if (!el.closest(INCLUDE_SELECTOR)) {
    return true;
  }
  // textContent walks the whole subtree: only after the cheap checks.
  if (
    SHORT_FILTER_TAGS.has(el.tagName) &&
    isShortUiLabel(el, el.textContent.trim())
  ) {
    return true;
  }
  if (rule.include && !el.closest(rule.include)) {
    return true;
  }
  if (rule.exclude && el.closest(rule.exclude)) {
    return true;
  }
  if (el.matches(EXTRACT_SELECTOR)) {
    return false;
  }
  return !!el.closest(SKIP_ANCESTOR_SELECTOR);
}

function isVisible(el) {
  return el.checkVisibility({
    opacityProperty: true,
    visibilityProperty: true,
  });
}

function isInlineDisplay(win, el) {
  let display = win.getComputedStyle(el).display;
  return display.startsWith("inline") || display == "contents";
}

/**
 * The element a text node is translated with: the nearest semantic block,
 * or an inline element that is laid out as a block (going higher would put
 * the translation in its parent's grid or flex, with its siblings' text).
 */
function findParagraphBoundary(win, node) {
  let body = win.document.body;
  let el = node.parentElement;
  while (el && el != body) {
    if (
      SEMANTIC_BOUNDARY_TAGS.has(el.tagName) ||
      !KNOWN_INLINE_TAGS.has(el.tagName) ||
      !isInlineDisplay(win, el)
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return el;
}

/** The boundary elements under root that have text to translate. */
export function collectParents(win, root, rule) {
  let walker = win.document.createTreeWalker(root, SHOW_TEXT, {
    acceptNode(node) {
      let text = node.nodeValue?.trim() ?? "";
      if (!text || SKIP_PATTERN.test(text) || !HAS_LETTER.test(text)) {
        return FILTER_REJECT;
      }
      let parent = node.parentElement;
      return !parent || hasSkipTagOrClass(parent) ? FILTER_REJECT : FILTER_ACCEPT;
    },
  });
  let seen = new Set();
  let parents = [];
  let node;
  while ((node = walker.nextNode())) {
    let boundary = findParagraphBoundary(win, node);
    if (!boundary || seen.has(boundary)) {
      continue;
    }
    seen.add(boundary);
    if (!isSkippable(boundary, rule)) {
      parents.push(boundary);
    }
  }
  return parents;
}

function escapeHTML(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A node's text, its inline elements as numbered placeholders. */
function extractNodeText(node, tagMap, counter, rule) {
  if (node.nodeType == TEXT_NODE) {
    return escapeHTML(node.nodeValue ?? "");
  }
  if (node.nodeType != ELEMENT_NODE) {
    return "";
  }
  if (node.tagName == "FONT" && node.classList.contains("il-dual")) {
    return "";
  }
  if (node.tagName == "BR") {
    return "\n";
  }
  let n = ++counter.n;
  // Code, kbd, math and the like stay as they are, in their place.
  if (SKIP_TAGS.has(node.tagName) || node.matches(rule.extractExclude)) {
    tagMap.set(n, { shell: node, excluded: true });
    return `<${n}></${n}>`;
  }
  tagMap.set(n, { shell: node, excluded: false });
  let inner = "";
  for (let child of node.childNodes) {
    inner += extractNodeText(child, tagMap, counter, rule);
  }
  return `<${n}>${inner}</${n}>`;
}

/**
 * The units of a boundary element: runs of inline content, cut where a
 * block child starts (whose translation goes before that child).
 *
 * @param {Window} win
 * @param {Element} el
 * @param {{force?: boolean, rule?: Rule}} [options] force (hover) skips
 *   the filters for short and non-text units.
 * @returns {Unit[]}
 */
export function buildUnits(win, el, { force = false, rule = siteRule("") } = {}) {
  let units = [];
  let current = [];
  let flush = anchor => {
    if (!current.length) {
      return;
    }
    let tagMap = new Map();
    let counter = { n: 0 };
    let text = "";
    for (let node of current) {
      text += extractNodeText(node, tagMap, counter, rule);
    }
    let plain = stripPlaceholders(text).trim();
    if (
      plain &&
      (force ||
        (!SKIP_PATTERN.test(plain) &&
          HAS_LETTER.test(plain) &&
          !isShortUiLabel(el, plain)))
    ) {
      units.push({ nodes: current, anchor, text: text.trim(), plain, tagMap });
    }
    current = [];
  };
  for (let node of el.childNodes) {
    if (node.nodeType == TEXT_NODE) {
      current.push(node);
      continue;
    }
    if (node.nodeType != ELEMENT_NODE) {
      continue;
    }
    // Translations already there (a retry after a partial failure).
    if (
      (node.tagName == "FONT" && node.classList.contains("il-dual")) ||
      node.tagName == "IL-TRANS" ||
      node.tagName == "IL-DUAL"
    ) {
      continue;
    }
    if (node.tagName == "BR" || isInlineDisplay(win, node)) {
      current.push(node);
      continue;
    }
    flush(node);
  }
  flush(null);
  return units;
}

/**
 * Whether a unit's translation goes on its own line, by its word count
 * (two CJK characters to a word); H1 to H3 always.
 */
export function isBlockUnit(el, unit) {
  if (/^H[1-3]$/.test(el.tagName)) {
    return true;
  }
  let cjk =
    unit.plain.match(/[぀-ヿ㐀-鿿豈-﫿가-힯]/g)
      ?.length ?? 0;
  let words = unit.plain
    .split(/\s+/)
    .filter(word => /[\p{L}\p{N}]/u.test(word)).length;
  return (
    words + Math.ceil(cjk / 2) >
    (BLOCK_THRESHOLD[el.tagName] ?? BLOCK_THRESHOLD_DEFAULT)
  );
}

/** Whether a unit already has its translation after it (a retry). */
function hasDualSibling(unit) {
  let sibling = unit.nodes.at(-1).nextSibling;
  while (sibling?.nodeType == TEXT_NODE && !sibling.nodeValue.trim()) {
    sibling = sibling.nextSibling;
  }
  return (
    sibling?.nodeType == ELEMENT_NODE &&
    sibling.tagName == "FONT" &&
    sibling.classList.contains("il-dual")
  );
}

/** Placeholder-free text, for the streamed preview. */
export function stripPlaceholders(text) {
  return text.replace(/<\/?\d+>/g, "");
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\xa0" };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] == "#") {
      let code =
        name[1] == "x" || name[1] == "X"
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** A shallow copy of an original inline element, or null to unwrap it. */
function rebuild(doc, original) {
  let tag = original.localName;
  if (!ALLOWED_TAGS.has(tag)) {
    return null;
  }
  let el = doc.createElement(tag);
  if (tag == "a") {
    for (let name of ALLOWED_LINK_ATTRS) {
      let value = original.getAttribute(name);
      if (value === null) {
        continue;
      }
      if (name == "href" && /^\s*(javascript|data|vbscript):/i.test(value)) {
        continue;
      }
      el.setAttribute(name, value);
    }
  }
  return el;
}

/**
 * Builds a translation as nodes of the page's document: no markup string
 * is ever parsed, so the page's Trusted Types and sanitizer do not apply.
 *
 * Tokens of `translated`:
 *  - "<n>" / "</n>" (n in tagMap): open / close a shallow copy of the
 *    original inline element, keeping only allowed tags and link attributes
 *    (another tag's content stays, unwrapped);
 *  - "<n>...</n>" for an excluded subtree: its deep clone, once;
 *  - any other tag: dropped;
 *  - text: entity-decoded, as text nodes.
 * Elements still open at the end close there.
 *
 * @param {Document} doc
 * @param {string} translated
 * @param {Unit["tagMap"]} tagMap
 * @returns {DocumentFragment}
 */
export function renderUnit(doc, translated, tagMap) {
  let fragment = doc.createDocumentFragment();
  // Open placeholders, innermost last: {n, el} (el null when unwrapped).
  let stack = [];
  let parent = () => stack.findLast(open => open.el)?.el ?? fragment;
  let used = new Set();
  let token = /<\s*(\/?)\s*(\d+)\s*>|<\/?[a-zA-Z!][^<>]*>/g;
  let at = 0;
  let text = end => {
    if (end > at) {
      parent().append(doc.createTextNode(decodeEntities(translated.slice(at, end))));
    }
  };
  let match;
  while ((match = token.exec(translated))) {
    text(match.index);
    at = token.lastIndex;
    let [, closing, number] = match;
    let entry = number && tagMap.get(Number(number));
    if (!entry) {
      continue;
    }
    let n = Number(number);
    if (closing) {
      let index = stack.findLastIndex(open => open.n == n);
      if (index >= 0) {
        stack.length = index;
      }
      continue;
    }
    if (entry.excluded) {
      if (!used.has(n)) {
        used.add(n);
        parent().append(entry.shell.cloneNode(true));
      }
      // Whatever the model wrote inside it goes.
      let close = new RegExp(`<\\s*/\\s*${n}\\s*>`, "g");
      close.lastIndex = at;
      if (close.exec(translated)) {
        at = token.lastIndex = close.lastIndex;
      }
      continue;
    }
    let el = rebuild(doc, entry.shell);
    if (el) {
      parent().append(el);
    }
    stack.push({ n, el });
  }
  text(translated.length);
  return fragment;
}
