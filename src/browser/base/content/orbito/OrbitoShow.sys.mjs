/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Show Orbito's capture: records what the user does in every tab of one
 * window into that window's event log (ShowLog, OrbitoShowLog.sys.mjs),
 * in memory only. Pages report clicks, fields and keys through the
 * OrbitoShow actors (actors/OrbitoShow*.sys.mjs), which are registered
 * only while some window records; the window's tabs report navigations
 * and opening, switching and closing tabs. Other windows, and the
 * Assistant panel and the rest of the window's chrome, are left out.
 *
 * The window's Show Orbito (shell/show-orbito.mjs) starts and stops it
 * from the entry points; the live summary (#211) and the review (#212)
 * read the log:
 *   start(win, {goal})  starts recording the window: a new log, the one
 *                       before discarded, its first step the selected
 *                       tab's page. Throws if it already records.
 *   stop(win)           stops recording; the log stays for the review.
 *   log(win)            the window's log, recording or stopped, or null:
 *                       subscribe(), serialize() and steps are its own.
 *   isRecording(win)
 *   discard(win)        stops recording and forgets the log at once.
 * A window that closes discards its log. MAX_RECORDING_MS and the stop
 * shortcut (isStopShortcut, stopShortcutText) are the window's to apply.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AppConstants: "resource://gre/modules/AppConstants.sys.mjs",
  ShowLog: "chrome://browser/content/orbito/OrbitoShowLog.sys.mjs",
});

const ACTOR = "OrbitoShow";

const { LOAD_CMD_HISTORY, LOAD_CMD_RELOAD } = Ci.nsIDocShell;

/** How long a demo records at most before it stops by itself, in ms. */
export const MAX_RECORDING_MS = 30 * 60 * 1000;

/**
 * Whether a keydown is the stop shortcut: Command+Shift+. on macOS,
 * Ctrl+Shift+. elsewhere. Matched on event.code, as Shift changes the
 * character the key produces.
 */
export function isStopShortcut(
  event,
  mac = lazy.AppConstants.platform == "macosx"
) {
  return (
    event.code == "Period" &&
    event.shiftKey &&
    !event.altKey &&
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
  );
}

/** The stop shortcut as the user reads it. */
export function stopShortcutText(mac = lazy.AppConstants.platform == "macosx") {
  return mac ? "⌘⇧." : "Ctrl+Shift+.";
}

export const OrbitoShow = {
  // win -> {log, recording, stopCapture}.
  _demos: new WeakMap(),
  // How many windows record, for registering the actors.
  _recording: 0,

  isRecording(win) {
    return !!this._demos.get(win)?.recording;
  },

  log(win) {
    return this._demos.get(win)?.log ?? null;
  },

  /**
   * Starts recording what the user does in win's tabs.
   *
   * @param {Window} win A browser window.
   * @param {object} [options]
   * @param {string} [options.goal] What the user said the demo is for.
   * @returns {ShowLog}
   */
  start(win, { goal = "" } = {}) {
    if (this.isRecording(win)) {
      throw new Error("This window already records a demo.");
    }
    this.discard(win);
    let log = new lazy.ShowLog({ goal });
    let demo = { log, recording: true, stopCapture: null };
    this._demos.set(win, demo);
    demo.stopCapture = this._capture(win, log);
    if (this._recording++ == 0) {
      this._register();
    }
    // The demo starts from the selected tab as it is: its page is the
    // first step, unless it is none the actors record (a new tab page,
    // Orbito's settings).
    let browser = win.gBrowser.selectedBrowser;
    let url = browser.currentURI?.spec ?? "";
    if (/^(https?|file):/.test(url)) {
      log.add({
        type: "navigate",
        tab: browser.permanentKey,
        url,
        title: browser.contentTitle,
      });
    }
    return log;
  },

  /** Stops recording win; its log stays until it is discarded. */
  stop(win) {
    let demo = this._demos.get(win);
    if (!demo?.recording) {
      return demo?.log ?? null;
    }
    demo.recording = false;
    demo.stopCapture();
    if (--this._recording == 0) {
      this._unregister();
    }
    return demo.log;
  },

  /** Stops recording win and forgets its log at once. */
  discard(win) {
    this.stop(win);
    this._demos.get(win)?.log.discard();
    this._demos.delete(win);
  },

  /** What a page reported (OrbitoShowParent), for its window's demo. */
  record(browser, event) {
    let win = browser.ownerDocument?.defaultView;
    if (!win || !this.isRecording(win) || !win.gBrowser?.getTabForBrowser(browser)) {
      return;
    }
    this.log(win).add({ ...event, tab: browser.permanentKey });
  },

  _register() {
    ChromeUtils.registerWindowActor(ACTOR, {
      parent: {
        esModuleURI:
          "chrome://browser/content/orbito/actors/OrbitoShowParent.sys.mjs",
      },
      child: {
        esModuleURI:
          "chrome://browser/content/orbito/actors/OrbitoShowChild.sys.mjs",
        events: {
          click: { capture: true },
          change: { capture: true },
          input: { capture: true },
          focusout: { capture: true },
          submit: { capture: true },
          keydown: { capture: true },
          // Only to know the view the user had before scrolling.
          scroll: { capture: true, passive: true },
        },
      },
      matches: ["http://*/*", "https://*/*", "file:///*"],
      messageManagerGroups: ["browsers"],
      // The child only reports; the parent records what it says as text.
      safeForUntrustedWebProcess: true,
    });
  },

  _unregister() {
    ChromeUtils.unregisterWindowActor(ACTOR);
  },

  /**
   * Follows win's tabs into log: navigations, with their title once the
   * page has loaded, and tabs opened, switched to and closed. Returns what
   * stops it.
   */
  _capture(win, log) {
    let gBrowser = win.gBrowser;
    // browser -> the session history index it was at.
    let indexes = new WeakMap();
    // browser -> the navigation waiting for its page to load: {url, via}.
    let loading = new WeakMap();
    let historyIndex = browser =>
      browser.browsingContext?.sessionHistory?.index ?? null;
    for (let tab of gBrowser.tabs) {
      indexes.set(tab.linkedBrowser, historyIndex(tab.linkedBrowser));
    }
    let navigated = (browser, url, via) =>
      log.add({
        type: "navigate",
        tab: browser.permanentKey,
        url,
        title: browser.contentTitle,
        via,
      });
    let progress = {
      onLocationChange: (browser, webProgress, request, location, flags) => {
        if (!webProgress.isTopLevel) {
          return;
        }
        let index = historyIndex(browser);
        let before = indexes.get(browser);
        indexes.set(browser, index);
        let via;
        let loadType = webProgress.loadType ?? 0;
        if (loadType & LOAD_CMD_HISTORY) {
          via =
            index != null && before != null && index != before
              ? index < before
                ? "back"
                : "forward"
              : "history";
        } else if (loadType & LOAD_CMD_RELOAD) {
          via = "reload";
        }
        if (flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT) {
          loading.delete(browser);
          navigated(browser, location.spec, via);
        } else {
          loading.set(browser, { url: location.spec, via });
        }
      },
      onStateChange: (browser, webProgress, request, flags) => {
        let stop =
          Ci.nsIWebProgressListener.STATE_STOP |
          Ci.nsIWebProgressListener.STATE_IS_WINDOW;
        let pending = loading.get(browser);
        if (webProgress.isTopLevel && (flags & stop) == stop && pending) {
          loading.delete(browser);
          navigated(browser, pending.url, pending.via);
        }
      },
    };
    let tabs = event => {
      let tab = event.target;
      let browser = tab.linkedBrowser;
      let action = { TabOpen: "open", TabSelect: "switch", TabClose: "close" }[
        event.type
      ];
      if (action == "open") {
        indexes.set(browser, historyIndex(browser));
      }
      log.add({
        type: "tab",
        tab: browser.permanentKey,
        action,
        title: tab.label,
        url: browser.currentURI?.spec,
      });
    };
    let unload = () => this.discard(win);
    gBrowser.addTabsProgressListener(progress);
    for (let type of ["TabOpen", "TabSelect", "TabClose"]) {
      gBrowser.tabContainer.addEventListener(type, tabs);
    }
    win.addEventListener("unload", unload, { once: true });
    return () => {
      gBrowser.removeTabsProgressListener(progress);
      for (let type of ["TabOpen", "TabSelect", "TabClose"]) {
        gBrowser.tabContainer.removeEventListener(type, tabs);
      }
      win.removeEventListener("unload", unload);
    };
  },
};
