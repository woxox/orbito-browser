/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Registers Orbito's strings before the window's tabs load Orbito's pages.
ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

/**
 * The window's side of the assistant: starts the app-wide assistant core
 * (OrbitoAssistantCore.sys.mjs), tells it about the window's tabs, and
 * opens and closes the Assistant panel (shell/orbito-assistant-panel.mjs,
 * which the Shell puts in the window) with the Top bar's Ask button, the
 * keyboard shortcut, the urlbar's "Ask Orbito" and the library.
 */
var OrbitoAssistant = {
  get _core() {
    return ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs"
    ).OrbitoAssistantCore;
  },

  /** The Assistant panel element. */
  get panel() {
    return document.getElementById("orbito-assistant");
  },

  // While the panel plays its closing motion: the promise it ends with.
  _closing: null,

  /** Open, and not closing. */
  get isOpen() {
    return !!this.panel && !this.panel.hidden && !this._closing;
  },

  /** How tools ask in this window: "ask", "auto" or "bypass". */
  get permissionMode() {
    return this._core.permissionMode(window);
  },

  /** Sets permissionMode and fires OrbitoPermissionModeChange on the window. */
  setPermissionMode(mode) {
    this._core.setPermissionMode(window, mode);
    window.dispatchEvent(new CustomEvent("OrbitoPermissionModeChange"));
  },

  init() {
    this._core.startup();
    ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoUrlbarProvider.sys.mjs"
    ).registerUrlbarProvider();
    ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoRecallUrlbarProvider.sys.mjs"
    ).registerRecallUrlbarProvider();
    ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoRecall.sys.mjs"
    ).OrbitoRecall.trackWindow(window);
    gBrowser.tabContainer.addEventListener("TabClose", this);
    // A tab pinned, docked or put in a Firefox tab group leaves its Orbit.
    gBrowser.tabContainer.addEventListener("TabPinned", this);
    gBrowser.tabContainer.addEventListener("TabGrouped", this);
    window.addEventListener("OrbitoDocksChange", this);
    window.addEventListener("keydown", this, true);
    window.addEventListener("unload", () => this.uninit(), { once: true });
    // Opened with the window when the settings say so, but not in a narrow
    // window, where it would cover the page.
    if (
      Services.prefs.getBoolPref("orbito.assistant.autoOpen", false) &&
      !window.matchMedia("(max-width: 760px)").matches
    ) {
      this.toggle(true, { focus: false });
    }
    SessionStore.promiseAllWindowsRestored.then(() => {
      if (!window.closed) {
        this._core.initWindow(window);
        // The window's PermissionMode and its Threads may have come back.
        this.panel?.refresh();
        window.dispatchEvent(new CustomEvent("OrbitoPermissionModeChange"));
      }
    });
  },

  uninit() {
    // The window is closing, and its tabs with it.
    for (let tab of gBrowser.tabs) {
      this._core.tabClosed(tab);
    }
    gBrowser.tabContainer.removeEventListener("TabClose", this);
    gBrowser.tabContainer.removeEventListener("TabPinned", this);
    gBrowser.tabContainer.removeEventListener("TabGrouped", this);
    window.removeEventListener("OrbitoDocksChange", this);
    window.removeEventListener("keydown", this, true);
  },

  /**
   * Option+Command+A on macOS, where Command+Shift+Space clashes with system
   * shortcuts; Ctrl+Shift+Space elsewhere, since Ctrl+Alt doubles as AltGr.
   * Matched on event.code because Option changes the produced character.
   */
  _isToggleShortcut(event) {
    if (AppConstants.platform == "macosx") {
      return (
        event.code == "KeyA" &&
        event.metaKey &&
        event.altKey &&
        !event.shiftKey &&
        !event.ctrlKey
      );
    }
    return (
      event.code == "Space" &&
      event.ctrlKey &&
      event.shiftKey &&
      !event.altKey &&
      !event.metaKey
    );
  },

  handleEvent(event) {
    switch (event.type) {
      case "TabClose":
        if (event.detail?.adoptedBy) {
          this._core.tabAdopted(event.target, event.detail.adoptedBy);
        } else {
          this._core.tabClosed(event.target);
        }
        break;
      case "TabPinned":
        this._core.leaveOrbit(event.target);
        break;
      case "TabGrouped":
        this._core.leaveOrbit(event.detail);
        break;
      case "OrbitoDocksChange":
        for (let tab of gBrowser.tabs) {
          if (window.OrbitoShell?.docks?.dockOf(tab)) {
            this._core.leaveOrbit(tab);
          }
        }
        break;
      case "keydown":
        if (this._isToggleShortcut(event)) {
          event.preventDefault();
          event.stopPropagation();
          this.toggle();
        }
        break;
    }
  },

  /**
   * Opens or closes the panel, with its motion. Opened, it shows the
   * window's Thread in its Space and takes focus (unless options.focus is
   * false); closed with focus in it, focus goes to the page. Closing, it
   * is hidden once its motion ends, unless it is opened again before. Fires
   * OrbitoAssistantToggle on the window when it opens or starts closing,
   * and again once a closed panel is hidden. Popups have none.
   */
  toggle(force = !this.isOpen, { focus = true } = {}) {
    let panel = this.panel;
    // Popups show only their page and its address.
    if (force && !window.toolbar.visible) {
      return;
    }
    if (!panel || this.isOpen == force) {
      if (force) {
        panel?.refresh();
        if (focus) {
          panel?.focusRegion();
        }
      }
      return;
    }
    if (!force) {
      panel.closeMenu();
      if (panel.matches(":focus-within")) {
        gBrowser.selectedBrowser.focus();
      }
      let motion = panel.playMotion(false);
      if (motion) {
        let closing = (this._closing = motion.then(() => {
          if (this._closing == closing) {
            this._closing = null;
            panel.hidden = true;
            window.dispatchEvent(new CustomEvent("OrbitoAssistantToggle"));
          }
        }));
      } else {
        panel.hidden = true;
      }
    } else {
      this._closing = null;
      panel.hidden = false;
      panel.playMotion(true);
    }
    window.dispatchEvent(new CustomEvent("OrbitoAssistantToggle"));
    if (force) {
      panel.refresh();
      if (focus) {
        panel.focusRegion();
      }
    }
  },

  /**
   * Opens the panel and asks the question in the window's Thread, the
   * same way as typing it there. For other inputs, such as the Command bar
   * and the new tab page.
   *
   * @param {string} prompt
   * @param {object} [options]
   * @param {string} [options.context] What this question shares ("tab",
   *   "tabs" or "none"), instead of the panel's setting.
   * @param {boolean} [options.newIfBusy] While the Thread is answering, ask
   *   in a new one instead of leaving the question in the input.
   */
  ask(prompt, options) {
    this.toggle(true);
    this.panel.ask(prompt, options);
  },

  /** Opens about:orbito-settings in a tab. */
  openSettings() {
    ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoPages.sys.mjs"
    ).OrbitoPages.openSettings(window);
  },

  /** Opens about:orbito-library in a tab. */
  openLibrary() {
    ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoPages.sys.mjs"
    ).OrbitoPages.openLibrary(window);
  },
};

window.addEventListener("load", () => OrbitoAssistant.init(), { once: true });
