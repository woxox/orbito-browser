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

const { t, OrbitoL10n } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  agoText: "chrome://browser/content/orbito/newtab/OrbitoNewTabSuggest.sys.mjs",
  deviceTypes: "chrome://browser/content/orbito/newtab/OrbitoNewTabSuggest.sys.mjs",
  groupLabel: "chrome://browser/content/orbito/OrbitoRecallUrlbarProvider.sys.mjs",
  trimRemoteTabs: "chrome://browser/content/orbito/newtab/OrbitoNewTabSuggest.sys.mjs",
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
  /** The urlbar whose autofill is wrapped (#wrapAutofill()). */
  #input = null;
  /**
   * The autofill shown past the caret while an IME composes, which the
   * input can't take without ending the composition: the text it was found
   * for, its result, and what it adds.
   *
   * @type {?{typed: string, result: object, suffix: string}}
   */
  #ghost = null;
  /**
   * The ghost an IME took away by emptying what it composes, kept for the
   * text it commits next: justype empties the composition, ends it, and
   * then commits the word as new text.
   */
  #pending = null;
  /**
   * "Enter" or "Tab" pressed over the ghost while composing, with its event,
   * to act on once the composition is committed.
   */
  #accept = null;
  /**
   * The ghost last put in the input on a commit, until the next key: Tab
   * then takes the completion, as it would have over the ghost.
   */
  #committed = null;
  /**
   * The Command bar's own parts in the urlbar, made on first open: what to
   * type over the empty input, the mode chip and the footer's last line.
   */
  #parts = null;
  /**
   * The kind of each of the user's other devices by its name, asked for
   * each time the Command bar opens (deviceTypes()).
   *
   * @type {Map<string, string>}
   */
  #devices = new Map();

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
    gURLBar.addEventListener("input", this);
    gURLBar.addEventListener("popuphidden", this);
  }

  /**
   * Whether the search engine list (the urlbar's search mode switcher) is
   * open or opening. It is a XUL panel, and a panel takes focus from
   * whatever has it as it opens, the input or its button: focus goes
   * nowhere, but the bar stays open for a pick from the list.
   */
  get #switcherOpen() {
    let state = gURLBar.querySelector(".searchmode-switcher-panel")?.state;
    return state == "showing" || state == "open";
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
      this.#setGhost(null);
      this.#pending = this.#accept = this.#committed = null;
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
      this.#wrapAutofill();
      this.#labelGroups();
      this.#addParts();
      lazy.deviceTypes().then(devices => {
        this.#devices = devices;
        this.#describeRemoteTabs();
      });
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
    let ghost = make(
      "span",
      "orbito-command-bar-ghost",
      make("span", "", make("span", ""), make("span", ""))
    );
    ghost.hidden = true;
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
    for (let el of [ghost, placeholder, mode, footer]) {
      el.setAttribute("aria-hidden", "true");
    }
    // The rows' hints are drawn by command-bar.css, which takes the words
    // from here.
    for (let [kind, id] of Object.entries(ROW_HINTS)) {
      gURLBar.style.setProperty(`--orbito-command-bar-hint-${kind}`, cssString(t(id)));
    }
    gURLBar.inputField.after(ghost, placeholder);
    gURLBar.querySelector(".urlbar-input-container").append(mode);
    gURLBar.panel.append(footer);
    this.#parts = { ghost, placeholder, mode, opensIn };
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
   * Autofills while an IME composes too, as Chrome does: the urlbar asks
   * for autofill only once the composition is committed, since writing the
   * completion into the input would end it. While composing, the completion
   * shows past the caret instead (#setGhost()), and goes into the input once
   * the composition is committed, or is taken with Enter or Tab.
   */
  #wrapAutofill() {
    let input = gURLBar;
    if (this.#input == input) {
      return;
    }
    this.#input = input;
    let startQuery = input.startQuery.bind(input);
    input.startQuery = (options = {}) => {
      let { event } = options;
      if (
        this.isOpen &&
        input.isComposing &&
        event?.type == "input" &&
        !event.inputType?.startsWith("delete")
      ) {
        options = { ...options, allowAutofill: true };
      }
      return startQuery(options);
    };
    // A completion autofilled before the composition started must not be
    // put back over it.
    let onFirstResult = input.onFirstResult.bind(input);
    input.onFirstResult = queryContext => {
      if (input.isComposing) {
        input._autofillPlaceholder = null;
      }
      onFirstResult(queryContext);
    };
    let autofillFirstResult = input._autofillFirstResult.bind(input);
    input._autofillFirstResult = result => {
      if (input.isComposing) {
        this.#setGhost(this.isOpen ? result : null);
      } else {
        autofillFirstResult(result);
      }
    };
  }

  /**
   * Shows result's autofill past the caret, or nothing for null or when it
   * doesn't complete what is in the input.
   */
  #setGhost(result) {
    let field = gURLBar.inputField;
    let typed = field.value;
    let value = result?.autofill?.value ?? "";
    this.#ghost =
      typed &&
      value.length > typed.length &&
      value.toLocaleLowerCase().startsWith(typed.toLocaleLowerCase()) &&
      field.selectionStart == typed.length &&
      field.selectionEnd == typed.length
        ? { typed, result, suffix: value.slice(typed.length) }
        : null;
    let el = this.#parts?.ghost;
    if (!el) {
      return;
    }
    el.hidden = !this.#ghost;
    if (this.#ghost) {
      let line = el.firstChild;
      line.firstChild.textContent = typed;
      line.lastChild.textContent = this.#ghost.suffix;
      line.style.translate = `${-field.scrollLeft}px`;
    }
  }

  /** Keeps the ghost through input while composing. */
  #onComposingInput(event) {
    if (event.data) {
      if (this.#ghost) {
        // Typing more of the completion keeps it.
        this.#setGhost(this.#ghost.result);
      }
    } else if (this.#ghost) {
      this.#pending ??= this.#ghost;
      this.#setGhost(null);
    }
  }

  /**
   * After text is committed: puts the ghost in the input when the input
   * then has the text it was found for, and does what Enter or Tab pressed
   * over it asked. A composition ended with nothing committed, as justype
   * ends one before committing its word, waits for the text that follows:
   * filling the input in between would put the completion before that text.
   */
  #commitGhost(event) {
    if (event.inputType == "insertCompositionText" && !event.data) {
      if (this.#ghost) {
        this.#pending ??= this.#ghost;
        this.#setGhost(null);
      }
      return;
    }
    let ghost = this.#ghost ?? this.#pending;
    let accept = this.#accept;
    this.#setGhost(null);
    this.#pending = this.#accept = this.#committed = null;
    if (
      !ghost ||
      !event.data ||
      gURLBar.inputField.value.toLocaleLowerCase() !=
        ghost.typed.toLocaleLowerCase()
    ) {
      return;
    }
    gURLBar.setValueFromResult({ result: ghost.result });
    if (accept?.key == "Tab") {
      let end = gURLBar.inputField.value.length;
      gURLBar.setSelectionRange(end, end);
    } else if (accept?.key == "Enter") {
      gURLBar.handleCommand(accept.event);
    } else {
      this.#committed = ghost;
    }
  }

  /**
   * Tab right after a commit put the ghost in the input takes the
   * completion, as Tab over the ghost does; justype commits before the key
   * reaches the input. Enter needs nothing: the input has the completion.
   */
  #takeCommitted(event) {
    let ghost = this.#committed;
    this.#committed = null;
    let field = gURLBar.inputField;
    if (
      event.key == "Tab" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      field.selectionStart == ghost.typed.length &&
      field.selectionEnd == field.value.length &&
      field.value.length > ghost.typed.length
    ) {
      event.preventDefault();
      event.stopPropagation();
      gURLBar.setSelectionRange(field.value.length, field.value.length);
      return true;
    }
    return false;
  }

  /**
   * Enter or Tab over the ghost while composing. An IME that takes the key
   * reports it as "Process" and commits on its own; a key it lets through
   * would reach the urlbar mid-composition, so it commits here instead.
   */
  #acceptGhost(event) {
    let key = event.key == "Process" ? event.code : event.key;
    if (key == "NumpadEnter") {
      key = "Enter";
    }
    if (key != "Enter" && key != "Tab") {
      if (event.key == "ArrowUp" || event.key == "ArrowDown") {
        this.#setGhost(null);
      }
      return;
    }
    this.#accept = { key, event };
    if (event.key != "Process") {
      event.preventDefault();
      event.stopPropagation();
      gURLBar.editor.forceCompositionEnd();
    }
  }

  /**
   * Puts the open tabs and the tabs of other devices among the results
   * under their own labels, as the urlbar labels groups: each run of
   * switch-to-tab or remote tab results gets its label, and the result
   * after a run gets its own group's label again. The tabs of other devices
   * are trimmed as the new tab page trims them (trimRemoteTabs()) and say
   * their device and when they were used there (#describeRemoteTabs());
   * the other results and their order stay the urlbar's.
   */
  #labelGroups() {
    let { view } = gURLBar;
    if (this.#view == view) {
      return;
    }
    this.#view = view;
    let { RESULT_TYPE } = lazy.UrlbarShared;
    let labels = {
      [RESULT_TYPE.TAB_SWITCH]: "orbito-command-bar-section-tabs",
      [RESULT_TYPE.REMOTE_TAB]: "orbito-command-bar-section-remote",
    };
    let onQueryResults = view.onQueryResults.bind(view);
    view.onQueryResults = queryContext => {
      queryContext.results = lazy.trimRemoteTabs(queryContext.results);
      for (let result of queryContext.results) {
        let label = labels[result.type];
        if (label && !result.heuristic && !result.rowLabel) {
          Object.defineProperty(result, "rowLabel", {
            value: lazy.groupLabel(t(label)),
          });
        }
      }
      onQueryResults(queryContext);
      this.#describeRemoteTabs();
    };
    let onQueryResultRemoved = view.onQueryResultRemoved.bind(view);
    view.onQueryResultRemoved = (...args) => {
      onQueryResultRemoved(...args);
      this.#describeRemoteTabs();
    };
  }

  /**
   * Gives each row of another device's tab its device's kind and how long
   * ago the tab was used there, which command-bar.css shows around the
   * device's name that Firefox puts in the row's action. Rows are reused
   * for other results, so every row is gone over.
   */
  #describeRemoteTabs() {
    let now = Date.now();
    for (let row of gURLBar.view.panel.querySelectorAll(".urlbarView-row")) {
      let { result } = row;
      let action = row.querySelector(".urlbarView-action");
      if (result?.type != lazy.UrlbarShared.RESULT_TYPE.REMOTE_TAB) {
        row.removeAttribute("orbito-device");
        action?.removeAttribute("orbito-ago");
        continue;
      }
      let { device, lastUsed } = result.payload;
      row.setAttribute("orbito-device", this.#devices.get(device) ?? "desktop");
      if (lastUsed) {
        action?.setAttribute(
          "orbito-ago",
          lazy.agoText(lastUsed, now, OrbitoL10n.language)
        );
      } else {
        action?.removeAttribute("orbito-ago");
      }
    }
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
        if (
          this.#ghost &&
          event.isComposing &&
          event.target == gURLBar.inputField
        ) {
          this.#acceptGhost(event);
          break;
        }
        if (
          this.#committed &&
          !event.isComposing &&
          event.target == gURLBar.inputField &&
          this.#takeCommitted(event)
        ) {
          break;
        }
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
      case "input":
        if (gURLBar.isComposing) {
          this.#onComposingInput(event);
        } else {
          this.#commitGhost(event);
        }
        break;
      case "focusout":
        // Focus left on its own: a pick loaded a page or switched tabs, or
        // the Assistant panel took a question. Wait for it to land, and
        // stay open while the window is merely in the background.
        if (this.isOpen && !this.#closing && !gURLBar.contains(event.relatedTarget)) {
          setTimeout(() => {
            if (
              this.isOpen &&
              !gURLBar.contains(document.activeElement) &&
              !this.#switcherOpen
            ) {
              this.close({ restoreFocus: false, revert: this.mode == "new" });
            }
          });
        }
        break;
      case "popuphidden":
        // The search engine list closed. Once the pick, if any, has done
        // its work: focus that went elsewhere (Search settings opened a tab)
        // closes the bar, and focus that is still nowhere (Escape, a second
        // press of the list's button) goes back to the input.
        if (event.target.classList.contains("searchmode-switcher-panel")) {
          setTimeout(() => {
            let active = document.activeElement;
            if (!this.isOpen || this.#switcherOpen || gURLBar.contains(active)) {
              return;
            }
            if (active && active != document.body && active != document.documentElement) {
              this.close({ restoreFocus: false, revert: this.mode == "new" });
            } else {
              gURLBar.focus();
            }
          });
        }
        break;
    }
  }
}
