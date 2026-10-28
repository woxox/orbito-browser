/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Content side of the page tools (OrbitoPage.sys.mjs): takes snapshots of
 * the page with a ref for every element the model can act on, and acts on
 * those elements. One actor per document, frames included, so a navigation
 * forgets the refs of that document only. A snapshot leaves an entry where
 * each frame is; the parent fills it in from the frame's own actor.
 *
 * Every query answers {error} instead of throwing, so the message survives.
 */

import {
  SKIPPED,
  labelOf,
  nameOf,
  renderedChildren,
  roleOf,
} from "chrome://browser/content/orbito/actors/OrbitoElementInfo.sys.mjs";
import { runScript } from "chrome://browser/content/orbito/actors/OrbitoScriptRunner.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

// Elements that end the line of text before them.
const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BR",
  "DD",
  "DETAILS",
  "DIALOG",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TD",
  "TH",
  "TR",
  "UL",
]);

const LANDMARK_TAGS = {
  MAIN: "main",
  NAV: "navigation",
  ASIDE: "complementary",
  FORM: "form",
  DIALOG: "dialog",
};

const LANDMARK_ROLES = new Set([
  "banner",
  "complementary",
  "contentinfo",
  "dialog",
  "form",
  "main",
  "navigation",
  "region",
  "search",
]);

const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

const NOT_TEXT_INPUTS = new Set([
  "button",
  "submit",
  "reset",
  "image",
  "file",
  "checkbox",
  "radio",
  "range",
  "color",
  "hidden",
]);

const MAX_TEXT_LINE = 300;
const MAX_NAME = 100;
const MAX_VALUE = 200;
const MAX_OPTIONS = 25;
// Enough text to detect a language from.
const FEATURE_SAMPLE_CHARS = 4000;
// How long a PDF may take to load in the built-in viewer before it is read,
// and to be read: a long scan has many pages without text to go through.
const PDF_LOAD_MS = 5000;
const PDF_READ_MS = 10000;

const STALE_REF =
  "is not on the page any more: the page has changed. Call read_page again to get fresh refs.";

const CHANGED_REF =
  "has changed since the snapshot. Call read_page again to see what it is now.";

/** What an action's approval names an element by. */
function identity(el, role, name) {
  return JSON.stringify([role, name, el.getAttribute("href")]);
}

function clip(text, max) {
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function quote(text) {
  return JSON.stringify(text);
}

function isTextField(el) {
  return (
    el.localName == "textarea" ||
    (el.localName == "input" && !NOT_TEXT_INPUTS.has(el.type))
  );
}

function fieldValue(el) {
  return el.localName == "input" || el.localName == "textarea"
    ? el.value
    : el.textContent;
}

const SECRET_NAME = /otp|ssn|cvc|iban|secret|token|api[-_]?key/i;

/**
 * What kind of secret a field holds, or "" if none: "password",
 * "payment-card", "one-time-code" or "secret". Secret fields are never typed
 * into, and their values never shown.
 */
export function secretKind(el) {
  let tokens = (el.getAttribute("autocomplete") || "")
    .toLowerCase()
    .split(/\s+/);
  let input = el.localName == "input";
  if (
    (input && (el.type == "password" || el.hasBeenTypePassword)) ||
    tokens.includes("current-password") ||
    tokens.includes("new-password")
  ) {
    return "password";
  }
  if (tokens.some(token => token.startsWith("cc-"))) {
    return "payment-card";
  }
  if (tokens.includes("one-time-code")) {
    return "one-time-code";
  }
  let names = [el.getAttribute("name") || "", el.id];
  return names.some(n => SECRET_NAME.test(n)) ? "secret" : "";
}

const SECRET_ERROR =
  "Typing into password, payment card and other secret fields is not allowed. Ask the user to fill it in.";

export class OrbitoPageChild extends JSWindowActorChild {
  constructor() {
    super();
    // ref -> {el, identity}, from the latest snapshot only.
    this._refs = new Map();
    // Browsing context id -> the <iframe> or <frame> the latest snapshot
    // showed it in.
    this._frames = new Map();
  }

  async receiveMessage({ name, data }) {
    try {
      switch (name) {
        case "read":
          return this._read(data);
        case "act":
          return await this._act(data);
        case "rect":
          return this._rect(data);
        case "frame":
          return this._frameOffset(data);
        case "features":
          return this._features();
        case "pdf":
          return await this._pdf(data);
        case "run":
          return await runScript(this.contentWindow, data);
      }
      throw new Error(`Unknown query ${name}.`);
    } catch (e) {
      return { error: e.message || String(e) };
    }
  }

  /**
   * What the suggestion chips are decided on: the length of the page's text
   * and its lang attribute, with a sample of the text to detect the
   * language from when it has none.
   */
  _features() {
    let doc = this.document;
    let text = doc.body?.innerText.trim() || "";
    let lang = doc.documentElement?.lang.trim() || "";
    return {
      textLength: text.length,
      lang,
      sample: lang ? "" : text.slice(0, FEATURE_SAMPLE_CHARS),
    };
  }

  /**
   * The text layer of the PDF that the built-in viewer (pdf.js) shows, a
   * string per page from the first, until maxChars of text have been read
   * or PDF_READ_MS have passed:
   * {pages, count}, or {locked: true} while the viewer asks for the PDF's
   * password, so a locked PDF is read only once the user has opened it.
   */
  async _pdf({ maxChars }) {
    let end = Date.now() + PDF_LOAD_MS;
    let later = async () => {
      if (Date.now() > end) {
        throw new Error("The PDF has not loaded.");
      }
      await new Promise(resolve => lazy.setTimeout(resolve, 100));
    };
    // The viewer's script runs after its document is there.
    let app;
    while (!(app = this.contentWindow?.wrappedJSObject.PDFViewerApplication)) {
      await later();
    }
    await app.initializedPromise;
    while (!app.pdfDocument) {
      if (this.document.getElementById("passwordDialog")?.open) {
        return { locked: true };
      }
      await later();
    }
    let doc = app.pdfDocument;
    let pages = [];
    let length = 0;
    end = Date.now() + PDF_READ_MS;
    for (
      let n = 1;
      n <= doc.numPages && length < maxChars && Date.now() < end;
      n++
    ) {
      // What the viewer's promises give is seen through Xrays, which hide
      // the methods of pdf.js's objects.
      let page = Cu.waiveXrays(await doc.getPage(n));
      let { items } = Cu.waiveXrays(await page.getTextContent());
      // As the viewer's own getAllText() joins them.
      let text = "";
      for (let item of items) {
        text += (item.str || "") + (item.hasEOL ? "\n" : "");
      }
      pages.push(text.replaceAll("\0", ""));
      length += text.length;
    }
    return { pages, count: doc.numPages };
  }

  /* Snapshots */

  /**
   * The document's lines, as text or, for a line with a ref or a frame,
   * {text, ref} or {text, frame, depth}, where frame is the frame's
   * browsing context id and depth its line's indentation level.
   */
  _read({ firstRef, maxChars }) {
    let doc = this.document;
    let win = this.contentWindow;
    this._refs = new Map();
    this._frames = new Map();
    let state = {
      lines: [],
      line: "",
      length: 0,
      maxChars,
      truncated: false,
      nextRef: firstRef,
      refs: [],
      width: win.innerWidth,
      height: win.innerHeight,
    };
    if (doc.body) {
      this._walk(doc.body, 0, state);
    }
    this._flush(state, 0);
    let scrollable = doc.scrollingElement;
    return {
      header: `Viewport: ${state.width}×${state.height}, scrolled to ${Math.round(win.scrollY)} of ${scrollable?.scrollHeight ?? 0} px`,
      lines: state.lines,
      refs: state.refs,
      nextRef: state.nextRef,
      truncated: state.truncated,
    };
  }

  _push(state, depth, text, extra) {
    if (state.truncated) {
      return;
    }
    let line = "  ".repeat(depth) + text;
    if (state.length + line.length > state.maxChars) {
      state.truncated = true;
      return;
    }
    state.length += line.length + 1;
    state.lines.push(extra ? { text: line, ...extra } : line);
  }

  _flush(state, depth) {
    let text = clip(state.line, MAX_TEXT_LINE);
    state.line = "";
    if (text) {
      this._push(state, depth, text);
    }
  }

  _walk(node, depth, state) {
    for (let child of renderedChildren(node)) {
      if (state.truncated) {
        return;
      }
      if (child.nodeType == child.TEXT_NODE) {
        state.line += child.data;
      } else if (child.nodeType == child.ELEMENT_NODE) {
        this._element(child, depth, state);
      }
    }
  }

  _element(el, depth, state) {
    let frame = el.localName == "iframe" || el.localName == "frame";
    if (
      (SKIPPED.has(el.localName) && !frame) ||
      el.getAttribute("aria-hidden") == "true" ||
      (el.localName == "input" && el.type == "hidden")
    ) {
      return;
    }
    if (
      !el.checkVisibility({ visibilityProperty: true }) &&
      // Such elements have no box of their own, but their children do.
      this.contentWindow.getComputedStyle(el).display != "contents"
    ) {
      return;
    }
    if (frame) {
      this._frame(el, depth, state);
      return;
    }
    let tag = el.localName.toUpperCase();
    let role = roleOf(el);

    if (role && INTERACTIVE_ROLES.has(role)) {
      this._flush(state, depth);
      let { text, ref } = this._describe(el, role, state);
      this._push(state, depth, text, { ref });
      // Custom lists and menus hold their options as descendants.
      if (
        (role == "listbox" || role == "combobox") &&
        el.localName != "select"
      ) {
        this._walk(el, depth + 1, state);
        this._flush(state, depth + 1);
      }
      return;
    }

    let heading = /^H([1-6])$/.exec(tag);
    if (heading || role == "heading") {
      this._flush(state, depth);
      let level = heading
        ? heading[1]
        : el.getAttribute("aria-level") || "2";
      let text = clip(nameOf(el), MAX_TEXT_LINE);
      if (text) {
        this._push(
          state,
          depth,
          `heading ${quote(text)} level=${level}${this._offscreen(el, state)}`
        );
      }
      return;
    }

    let landmark = this._landmark(el, role);
    if (landmark) {
      this._flush(state, depth);
      let label = labelOf(el);
      this._push(
        state,
        depth,
        `${landmark}${label ? " " + quote(clip(label, MAX_NAME)) : ""}:`
      );
      this._walk(el, depth + 1, state);
      this._flush(state, depth + 1);
      return;
    }

    let block = BLOCK_TAGS.has(tag);
    if (block) {
      this._flush(state, depth);
    }
    if (tag == "IMG") {
      let alt = el.getAttribute("alt");
      if (alt?.trim()) {
        state.line += ` [image: ${clip(alt, MAX_NAME)}] `;
      }
    }
    this._walk(el, depth, state);
    if (block) {
      this._flush(state, depth);
    } else {
      state.line += " ";
    }
  }

  /** Where a frame is; the parent puts the frame's own lines under it. */
  _frame(el, depth, state) {
    let rect = el.getBoundingClientRect();
    let id = el.browsingContext?.id;
    if (!rect.width || !rect.height || !id) {
      return;
    }
    this._flush(state, depth);
    this._frames.set(id, el);
    let title = clip(el.getAttribute("title") || el.name || "", MAX_NAME);
    let text = `${el.localName}${title ? " " + quote(title) : ""}`;
    this._push(state, depth, text, { frame: id, depth });
  }

  _landmark(el, role) {
    if (role && LANDMARK_ROLES.has(role)) {
      return role;
    }
    let tag = el.localName.toUpperCase();
    if (LANDMARK_TAGS[tag]) {
      return LANDMARK_TAGS[tag];
    }
    // Only the page's own header and footer, not those of an article.
    if (tag == "HEADER" || tag == "FOOTER") {
      if (!el.parentElement?.closest("article, aside, main, nav, section")) {
        return tag == "HEADER" ? "banner" : "contentinfo";
      }
    }
    if (tag == "SECTION" && labelOf(el)) {
      return "region";
    }
    return null;
  }

  _offscreen(el, state) {
    let rect = el.getBoundingClientRect();
    let outside =
      rect.bottom <= 0 ||
      rect.right <= 0 ||
      rect.top >= state.height ||
      rect.left >= state.width;
    return outside ? " (offscreen)" : "";
  }

  _describe(el, role, state) {
    let ref = `e${state.nextRef++}`;
    let name = clip(nameOf(el), MAX_NAME);
    this._refs.set(ref, { el, identity: identity(el, role, name) });
    let secret = secretKind(el);
    state.refs.push({ ref, role, name, sensitive: !!secret });

    let parts = [`[${ref}] ${role}`];
    if (name) {
      parts.push(quote(name));
    }
    let tag = el.localName;
    if (secret) {
      parts.push(secret);
      let value = fieldValue(el);
      if (value) {
        parts.push(`value=(${value.length} chars)`);
      }
    } else if (tag == "select") {
      let selected = Array.from(el.selectedOptions, o => clip(o.label, MAX_NAME));
      parts.push(`value=${quote(selected.join(", "))}`);
      let options = Array.from(el.options, o => clip(o.label, MAX_NAME));
      let more = options.length - MAX_OPTIONS;
      parts.push(
        `options=${JSON.stringify(options.slice(0, MAX_OPTIONS))}${more > 0 ? ` (+${more} more)` : ""}`
      );
    } else if (
      role == "textbox" ||
      role == "searchbox" ||
      role == "spinbutton" ||
      role == "slider"
    ) {
      let value = fieldValue(el);
      if (value) {
        parts.push(`value=${quote(clip(value, MAX_VALUE))}`);
      }
    }
    if (tag == "a" && el.hasAttribute("href")) {
      parts.push(`href=${el.getAttribute("href").slice(0, MAX_VALUE)}`);
    }
    let checked =
      tag == "input" && (el.type == "checkbox" || el.type == "radio")
        ? el.checked
        : el.getAttribute("aria-checked") == "true";
    if (checked) {
      parts.push("checked");
    }
    if (el.getAttribute("aria-selected") == "true") {
      parts.push("selected");
    }
    let expanded = el.getAttribute("aria-expanded");
    if (expanded) {
      parts.push(expanded == "true" ? "expanded" : "collapsed");
    }
    if (el.disabled || el.getAttribute("aria-disabled") == "true") {
      parts.push("disabled");
    }
    if (el.readOnly) {
      parts.push("readonly");
    }
    if (el.required) {
      parts.push("required");
    }
    return { text: parts.join(" ") + this._offscreen(el, state), ref };
  }

  /* Actions */

  _lookup(ref) {
    let { el, identity: shown } = this._refs.get(ref) ?? {};
    if (!el || !el.isConnected) {
      throw new Error(`${ref} ${STALE_REF}`);
    }
    // Actions on a ref were approved for the element as the snapshot showed
    // it.
    let name = clip(nameOf(el), MAX_NAME);
    if (identity(el, roleOf(el), name) != shown) {
      throw new Error(`${ref} ${CHANGED_REF}`);
    }
    return el;
  }

  _rect({ ref }) {
    let win = this.contentWindow;
    if (!ref) {
      return {
        width: win.innerWidth,
        height: win.innerHeight,
        scrollX: win.scrollX,
        scrollY: win.scrollY,
        pageHeight: Math.max(
          this.document.scrollingElement?.scrollHeight ?? 0,
          win.innerHeight
        ),
      };
    }
    let rect = this._lookup(ref).getBoundingClientRect();
    if (!rect.width || !rect.height) {
      throw new Error(`${ref} takes up no space on the page.`);
    }
    // In the viewport: the parent adds where a frame is in the page.
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      scrollX: win.scrollX,
      scrollY: win.scrollY,
    };
  }

  /**
   * Where a point of a frame's viewport is in this document's viewport,
   * with this document's scroll position. With hit, also checks that the
   * frame is what a click there would reach.
   */
  _frameOffset({ frame, x, y, hit }) {
    let el = this._frames.get(frame);
    if (!el?.isConnected || el.browsingContext?.id != frame) {
      throw new Error(`That frame ${STALE_REF}`);
    }
    let win = this.contentWindow;
    let rect = el.getBoundingClientRect();
    let style = win.getComputedStyle(el);
    x += rect.left + el.clientLeft + parseFloat(style.paddingLeft);
    y += rect.top + el.clientTop + parseFloat(style.paddingTop);
    // Out of view, a click there would reach nothing that can be checked.
    if (hit && !this._checkHit(el, x, y)) {
      throw new Error(
        "That element's frame is out of view. Scroll to it, then call read_page again."
      );
    }
    return { x, y, scrollX: win.scrollX, scrollY: win.scrollY };
  }

  async _act({ action, ref, ...args }) {
    let el = ref ? this._lookup(ref) : null;
    if (el && action != "scroll" && action != "press_key") {
      if (el.disabled) {
        throw new Error(`${ref} is disabled.`);
      }
    }
    switch (action) {
      case "point":
        return this._point(el);
      case "click":
        return this._click(el);
      case "type":
        return this._type(el, args);
      case "select_option":
        return this._select(el, args);
      case "scroll":
        return this._scroll(el, args);
      case "press_key":
        return this._pressKey(el, args);
    }
    throw new Error(`Unknown action ${action}.`);
  }

  /**
   * Clicks like a mouse would, with mousedown, mouseup and focus, where the
   * element can be hit; otherwise clicks it directly.
   */
  _click(el) {
    let win = this.contentWindow;
    let { x, y, hit } = this._point(el);
    let clicked = false;
    if (hit) {
      let onClick = event => (clicked ||= event.composedPath().includes(el));
      win.addEventListener("click", onClick, { capture: true });
      try {
        for (let type of ["mousedown", "mouseup"]) {
          win.synthesizeMouseEvent(type, x, y, { button: 0, clickCount: 1 });
        }
      } finally {
        win.removeEventListener("click", onClick, { capture: true });
      }
    }
    // E.g. in a background tab, where the mouse may not reach the page.
    if (!clicked) {
      el.click();
    }
    return {};
  }

  /**
   * Scrolls the element into view and finds the point a click on it would
   * go to, checking that nothing covers it there. In a frame, the parent
   * then checks that nothing covers the frame there either.
   *
   * @returns {{x: number, y: number, hit: boolean}} hit is false where the
   *   element cannot be hit, e.g. when it takes up no space.
   */
  _point(el) {
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    let rect = el.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    let y = rect.top + rect.height / 2;
    let hit = !!rect.width && !!rect.height && this._checkHit(el, x, y);
    return { x, y, hit };
  }

  /**
   * Whether anything is at the point, throwing if what is there is not el
   * or inside it.
   */
  _checkHit(el, x, y) {
    let hit = this.document.elementFromPoint(x, y);
    // The document's hit is a shadow host; look inside it.
    while (hit?.shadowRoot) {
      let inner = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner == hit) {
        break;
      }
      hit = inner;
    }
    // Climb out of shadow roots: a hit inside el's shadow tree is a hit.
    let reached = node => {
      for (; node; node = node.parentNode || node.host) {
        if (node == el) {
          return true;
        }
      }
      return false;
    };
    // A modal, a consent banner or a transparent trap the user cannot see
    // through would take a real click, so el.click() must not go past it.
    if (hit && !reached(hit)) {
      let name = clip(nameOf(hit), MAX_NAME);
      throw new Error(
        `That element is covered by a <${hit.localName}>${name ? ` “${name}”` : ""}. Deal with what covers it first, then call read_page again.`
      );
    }
    return !!hit;
  }

  _type(el, { text, submit }) {
    if (secretKind(el)) {
      throw new Error(SECRET_ERROR);
    }
    if (isTextField(el)) {
      if (el.readOnly) {
        throw new Error("That field is read-only.");
      }
      el.focus();
      el.setUserInput(text);
    } else if (el.isContentEditable) {
      el.focus();
      this.contentWindow.getSelection().selectAllChildren(el);
      this.document.execCommand("insertText", false, text);
    } else {
      throw new Error(
        "That element is not a text field. Use click, select_option or press_key instead."
      );
    }
    if (submit) {
      this._key("Enter");
    }
    return {};
  }

  _select(el, { values }) {
    if (el.localName != "select") {
      throw new Error(
        "That element is not a <select>. Click it, then click the option instead."
      );
    }
    if (!el.multiple && values.length > 1) {
      throw new Error("That list allows only one option.");
    }
    let options = Array.from(el.options);
    let matches = values.map(value => {
      let wanted = String(value).trim();
      let option =
        options.find(o => o.value == wanted || o.label.trim() == wanted) ||
        options.find(
          o => o.label.trim().toLowerCase() == wanted.toLowerCase()
        );
      if (!option) {
        throw new Error(
          `There is no option ${quote(wanted)}. The options are ${JSON.stringify(options.map(o => o.label.trim()))}.`
        );
      }
      if (option.disabled) {
        throw new Error(`The option ${quote(wanted)} is disabled.`);
      }
      return option;
    });
    el.focus();
    for (let option of options) {
      option.selected = matches.includes(option);
    }
    let win = this.contentWindow;
    el.dispatchEvent(new win.Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
    return { selected: matches.map(o => o.label.trim()) };
  }

  /** The element, or an ancestor, that scrolls in that direction. */
  _scroller(el, vertical) {
    let win = this.contentWindow;
    for (let node = el; node && node != this.document.documentElement; ) {
      if (node.nodeType == node.ELEMENT_NODE && node != this.document.body) {
        let overflow = win.getComputedStyle(node)[vertical ? "overflowY" : "overflowX"];
        let room = vertical
          ? node.scrollHeight > node.clientHeight
          : node.scrollWidth > node.clientWidth;
        if (room && /auto|scroll|overlay/.test(overflow)) {
          return node;
        }
      }
      node = node.parentNode || node.host;
    }
    return null;
  }

  _scroll(el, { direction, amount }) {
    let win = this.contentWindow;
    let vertical = direction == "up" || direction == "down";
    let scroller = el && this._scroller(el, vertical);
    let target = scroller || this.document.scrollingElement;
    if (el && !scroller && !amount) {
      // Nothing to scroll inside: bring the element into view instead.
      el.scrollIntoView({ block: "center", behavior: "instant" });
      return { position: this._position(target, true), intoView: true };
    }
    let size = vertical
      ? scroller?.clientHeight || win.innerHeight
      : scroller?.clientWidth || win.innerWidth;
    let by = Math.round(amount || size * 0.8);
    if (direction == "up" || direction == "left") {
      by = -by;
    }
    target.scrollBy({
      top: vertical ? by : 0,
      left: vertical ? 0 : by,
      behavior: "instant",
    });
    return { position: this._position(target, vertical) };
  }

  _position(target, vertical) {
    return vertical
      ? `${Math.round(target.scrollTop)} of ${target.scrollHeight - target.clientHeight} px`
      : `${Math.round(target.scrollLeft)} of ${target.scrollWidth - target.clientWidth} px`;
  }

  _pressKey(el, { key }) {
    if (el) {
      el.focus();
    }
    let focused = this.document.activeElement;
    while (focused?.shadowRoot?.activeElement) {
      focused = focused.shadowRoot.activeElement;
    }
    // The focus is in a frame: the parent sends the key on to it.
    if (
      !el &&
      (focused?.localName == "iframe" || focused?.localName == "frame") &&
      focused.browsingContext
    ) {
      return { frame: focused.browsingContext.id };
    }
    if (focused && secretKind(focused)) {
      throw new Error(SECRET_ERROR);
    }
    this._key(key);
    return {};
  }

  /** Sends a key press as a keyboard would, so default actions happen. */
  _key(key) {
    let win = this.contentWindow;
    let tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(
      Ci.nsITextInputProcessor
    );
    if (!tip.beginInputTransactionForTests(win)) {
      throw new Error("Could not send the key to the page.");
    }
    let printable = [...key].length == 1;
    let dictionary = { key };
    let flags;
    if (printable) {
      dictionary.code =
        tip.guessCodeValueOfPrintableKeyInUSEnglishKeyboardLayout(key);
      dictionary.keyCode =
        tip.guessKeyCodeValueOfPrintableKeyInUSEnglishKeyboardLayout(key);
      flags = tip.KEY_FORCE_PRINTABLE_KEY;
      if (!dictionary.keyCode) {
        flags |= tip.KEY_KEEP_KEYCODE_ZERO;
      }
    } else {
      dictionary.code = tip.computeCodeValueOfNonPrintableKey(key);
      flags = tip.KEY_NON_PRINTABLE_KEY;
    }
    let event = new win.KeyboardEvent("", dictionary);
    tip.keydown(event, flags);
    tip.keyup(event, flags);
  }
}
