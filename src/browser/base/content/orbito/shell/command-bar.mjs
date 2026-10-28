/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Command bar: the floating input ⌘T and ⌘L open, for an address, a
 * search or a question. It is Firefox's urlbar itself (ADR 0001): the same
 * input, controller, providers and result view, keyboard and all, shown over
 * the window instead of in the hidden nav bar (command-bar.css). This module
 * decides when it shows, where Enter opens what is picked, and where focus
 * goes when it closes.
 *
 * Two modes: "current" (⌘L) edits the selected tab's address and loads in
 * it; "new" (⌘T) starts empty and opens what is picked in a new tab, so
 * closing it leaves no tab behind.
 */

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  groupLabel: "chrome://browser/content/orbito/OrbitoRecallUrlbarProvider.sys.mjs",
  UrlbarShared: "chrome://browser/content/urlbar/UrlbarShared.mjs",
});

/**
 * The hint at the end of each result row, by the result's kind
 * (command-bar.css picks one per row).
 */
const ROW_HINTS = {
  go: "orbito-command-bar-hint-go",
  search: "orbito-command-bar-hint-search",
  ask: "orbito-command-bar-hint-ask",
  "switch-tab": "orbito-command-bar-hint-switch-tab",
  open: "orbito-command-bar-hint-open",
  command: "orbito-command-bar-hint-command",
};

/** text as a CSS string, for `content`. */
function cssString(text) {
  return `"${text.replace(/["\\]/g, "\\$&")}"`;
}

/** The element focus is on, through shadow roots. */
function deepActiveElement() {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  return el;
}

export class CommandBar {
  /** Where focus was before the Command bar opened. */
  #returnFocus = null;
  /** The browser the Command bar opened over, which typing may have edited. */
  #browser = null;
  #closing = false;
  /** The urlbar controller whose whereToOpen is wrapped. */
  #controller = null;
  /** The urlbar view whose onQueryResults is wrapped. */
  #view = null;
  /**
   * The Command bar's own parts in the urlbar, made on first open: what to
   * type over the empty input, the mode chip and the footer's last line.
   */
  #parts = null;

  /** The element behind the Command bar; pressing it closes the bar. */
  scrim = null;

  /** "current" or "new" while open, null while closed. */
  get mode() {
    return document.documentElement.getAttribute("orbito-command-bar");
  }

  get isOpen() {
    return !!this.mode;
  }

  init() {
    ChromeUtils.importESModule(
      "chrome://browser/content/orbito/shell/OrbitoCommands.sys.mjs"
    ).registerCommands();

    this.scrim = document.createElement("div");
    this.scrim.id = "orbito-command-bar-scrim";
    this.scrim.addEventListener("mousedown", event => {
      event.preventDefault();
      this.close();
    });
    document.getElementById("browser").append(this.scrim);

    // ⌘L and File > Open Location; other windows (the Library, macOS
    // windows without a browser) send it here too.
    let openLocation = window.openLocation;
    window.openLocation = event => {
      if (gURLBar.readOnly) {
        openLocation(event);
      } else {
        this.open("current", event);
      }
    };

    // ⌘T and the New Tab menu items, before Firefox opens a tab for them.
    for (let id of ["cmd_newNavigatorTab", "cmd_newNavigatorTabNoEvent"]) {
      document.getElementById(id).addEventListener("command", event => {
        if (!gURLBar.readOnly) {
          event.stopPropagation();
          this.open("new", event);
        }
      });
    }

    // Firefox focuses the urlbar itself in places: a new window on a blank
    // page, the last tab closed, a tab left with the urlbar focused. Each
    // opens the Command bar, so the input is never typed into unseen.
    gURLBar.addEventListener("beforefocus", this);
    gURLBar.addEventListener("beforeselect", this);
    gURLBar.addEventListener("keydown", this, true);
    gURLBar.addEventListener("focusout", this);
  }

  /**
   * Shows the Command bar with the input focused, or switches its mode if
   * it is open.
   *
   * @param {"current"|"new"} mode
   * @param {Event} [event] What opened it, for the urlbar's first query.
   */
  open(mode = "current", event = null) {
    let wasMode = this.mode;
    this.#show(mode);
    if (mode == "new" && wasMode != "new") {
      gURLBar.value = "";
    } else if (mode == "current" && wasMode == "new") {
      gURLBar.handleRevert();
    }
    gURLBar.select();
    if (!gURLBar.view.isOpen) {
      gURLBar.startQuery({ event });
    }
  }

  /**
   * Hides the Command bar.
   *
   * @param {object} [options]
   * @param {boolean} [options.restoreFocus]
   *   Whether focus goes back to where it was before the bar opened, rather
   *   than to the page.
   * @param {boolean} [options.revert]
   *   Whether what was typed is dropped, putting the page's address back.
   */
  close({ restoreFocus = true, revert = true } = {}) {
    if (!this.isOpen || this.#closing) {
      return;
    }
    this.#closing = true;
    try {
      if (revert) {
        gURLBar.handleRevert();
        if (this.#browser?.isConnected && this.#browser != gBrowser.selectedBrowser) {
          this.#browser.userTypedValue = null;
        }
      }
      gURLBar.view.close();
      if (gURLBar.contains(document.activeElement)) {
        let target = restoreFocus ? this.#returnFocus : null;
        // Focus on a page goes back to the page shown now: Firefox may
        // have opened a tab under the bar (a new tab page).
        if (
          target?.isConnected &&
          target.localName != "browser" &&
          !gURLBar.contains(target) &&
          target.checkVisibility()
        ) {
          target.focus();
        }
        // Also when focus was nowhere it can go back to.
        if (gURLBar.contains(document.activeElement)) {
          gBrowser.selectedBrowser.focus();
        }
      }
    } finally {
      document.documentElement.removeAttribute("orbito-command-bar");
      gURLBar.inputField.removeAttribute("aria-description");
      this.#returnFocus = null;
      this.#browser = null;
      this.#closing = false;
    }
  }

  #show(mode) {
    let opening = !this.isOpen;
    if (opening) {
      this.#returnFocus = deepActiveElement();
      this.#browser = gBrowser.selectedBrowser;
      this.#overrideWhereToOpen();
      this.#labelOpenTabs();
      this.#addParts();
    }
    document.documentElement.setAttribute("orbito-command-bar", mode);
    if (opening) {
      // A peeking Sidebar gets out of the way.
      window.dispatchEvent(new CustomEvent("OrbitoCommandBarOpen"));
    }
    let isNew = mode == "new";
    let opensIn = t(
      isNew ? "orbito-command-bar-opens-new-tab" : "orbito-command-bar-opens-this-tab"
    );
    this.#parts.placeholder.textContent = t(
      isNew ? "orbito-command-bar-placeholder-new" : "orbito-command-bar-placeholder-current"
    );
    this.#parts.mode.textContent = t(
      isNew ? "orbito-command-bar-mode-new" : "orbito-command-bar-mode-current"
    );
    this.#parts.opensIn.textContent = opensIn;
    gURLBar.inputField.setAttribute("aria-description", opensIn);
  }

  /**
   * Puts the Command bar's own parts in the urlbar, once: they stay, and
   * command-bar.css shows them only while it is open. They only repeat what
   * the input's aria-description says, so screen readers skip them.
   */
  #addParts() {
    if (this.#parts) {
      return;
    }
    let make = (tag, className, ...children) => {
      let el = document.createElement(tag);
      if (className) {
        el.className = className;
      }
      el.append(...children);
      return el;
    };
    // A key's hint: its chips, then what it does.
    let keys = (labels, id) =>
      make(
        "span",
        "",
        ...labels.flatMap(label => [make("kbd", "", label), " "]),
        t(id)
      );

    let placeholder = make("span", "orbito-command-bar-placeholder");
    let mode = make("span", "orbito-command-bar-mode");
    let opensIn = make("span", "");
    let footer = make(
      "div",
      "orbito-command-bar-footer",
      keys(["↑", "↓"], "orbito-command-bar-key-select"),
      keys(["↵"], "orbito-command-bar-key-open"),
      keys([t("orbito-command-bar-key-esc")], "orbito-command-bar-key-close"),
      make("span", "orbito-command-bar-spacer"),
      opensIn
    );
    for (let el of [placeholder, mode, footer]) {
      el.setAttribute("aria-hidden", "true");
    }
    // The rows' hints are drawn by command-bar.css, which takes the words
    // from here.
    for (let [kind, id] of Object.entries(ROW_HINTS)) {
      gURLBar.style.setProperty(`--orbito-command-bar-hint-${kind}`, cssString(t(id)));
    }
    gURLBar.inputField.after(placeholder);
    gURLBar.querySelector(".urlbar-input-container").append(mode);
    gURLBar.panel.append(footer);
    this.#parts = { placeholder, mode, opensIn };
  }

  /**
   * In "new" mode a pick opens in a new tab where it would load in the
   * current one. The controller exists once the urlbar is connected.
   */
  #overrideWhereToOpen() {
    let { controller } = gURLBar;
    if (this.#controller == controller) {
      return;
    }
    this.#controller = controller;
    let whereToOpen = controller.whereToOpen.bind(controller);
    controller.whereToOpen = event => {
      let where = whereToOpen(event);
      return where == "current" && this.mode == "new" ? "tab" : where;
    };
  }

  /**
   * Puts the open tabs among the results under their own label, as the
   * urlbar labels groups: each run of switch-to-tab results gets it, and
   * the result after a run gets its own group's label again. Only the
   * label changes; the results and their order stay the urlbar's.
   */
  #labelOpenTabs() {
    let { view } = gURLBar;
    if (this.#view == view) {
      return;
    }
    this.#view = view;
    let onQueryResults = view.onQueryResults.bind(view);
    view.onQueryResults = queryContext => {
      for (let result of queryContext.results) {
        if (
          result.type == lazy.UrlbarShared.RESULT_TYPE.TAB_SWITCH &&
          !result.heuristic &&
          !result.rowLabel
        ) {
          Object.defineProperty(result, "rowLabel", {
            value: lazy.groupLabel(t("orbito-command-bar-section-tabs")),
          });
        }
      }
      onQueryResults(queryContext);
    };
  }

  handleEvent(event) {
    switch (event.type) {
      case "beforefocus":
      case "beforeselect":
        if (!this.isOpen && !event.defaultPrevented) {
          this.#show("current");
        }
        break;
      case "keydown":
        // Escape closes at once, rather than first closing the results and
        // then reverting the text as the urlbar does. Menus inside the
        // urlbar (the result menu, the search engine list) close first.
        if (
          event.key == "Escape" &&
          this.isOpen &&
          event.target == gURLBar.inputField &&
          !event.isComposing
        ) {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
        break;
      case "focusout":
        // Focus left on its own: a pick loaded a page or switched tabs, or
        // the Assistant panel took a question. Wait for it to land, and
        // stay open while the window is merely in the background.
        if (this.isOpen && !this.#closing && !gURLBar.contains(event.relatedTarget)) {
          setTimeout(() => {
            if (this.isOpen && !gURLBar.contains(document.activeElement)) {
              this.close({ restoreFocus: false, revert: this.mode == "new" });
            }
          });
        }
        break;
    }
  }
}
