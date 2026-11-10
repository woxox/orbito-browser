/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What the Pins (shell/pins.mjs) and the Docks (shell/docks.mjs) of a
 * window share (see docs/adr/0003-shell-list-store.md): a list kept in
 * OrbitoShellStore, the same in every window, which owns its entries and
 * their order, and a tab of the window's own for each entry, marked with
 * the entry's id as a session tab value. The tab only says which entry it
 * stands for; where it sits follows the list.
 *
 * A subclass names its store key, session value and change event, takes
 * the stored list (take()), says which entries want tabs, in order
 * (wanted()), which tabs may stand for one (isEligible()) and where an
 * entry's tab goes (placeTab()), and what is left of a tab whose entry is
 * gone (keeps(), release()). It may take on a tab moved in from another
 * window that came as it cannot be an entry's tab (claim()).
 *
 * An entry's tab moved to another window takes its id along (SessionStore
 * moves a tab's values with it): there it is the entry's tab, in place of
 * the one the window had, and here an unloaded tab takes its place.
 */

import { RestoreWatch } from "chrome://browser/content/orbito/shell/spaces.mjs";

// Through the shared module loader: one store for every window (a static
// import would load a copy into each).
const { OrbitoShellStore, STORE_CHANGED } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/shell/OrbitoShellStore.sys.mjs"
);
const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
);

/** Icons a tab can be given back without a page to load them (setIcon). */
const LOCAL_ICON = /^(chrome|about|resource|data):/;

const WINDOW_EVENTS = ["SSWindowStateBusy", "SSWindowStateReady"];

/**
 * How often, and how long at most, a window opened to take a tab or group
 * from another waits for it before making its own tabs (ms).
 */
const ADOPT_POLL = 50;
const ADOPT_WAIT = 10000;

const newId = () => crypto.randomUUID();

/** Whether a tab's page was ever loaded (not a lazy or pending tab). */
export function isLoaded(tab) {
  return !!tab.linkedPanel && !tab.hasAttribute("pending");
}

export class ListTabs {
  /** While Session Restore fills the window, tabs come in any order. */
  restore = new RestoreWatch(() => this.restored());
  /** While the window changes its own tabs to follow the list. */
  #quiet = false;
  /** Whether the window's tabs have been made yet (not before load). */
  #ready = false;
  /**
   * Ids of entries another device took out: their tabs close, loaded or
   * not, as the entry's own tab would there.
   */
  #dropped = new Set();

  // Held weakly by the observer service, so a closed window does not leak.
  #observer = {
    observe: (subject, topic, key) => {
      if (key == this.key) {
        let before = this.ids();
        this.take(OrbitoShellStore.get(this.key));
        if (subject?.wrappedJSObject?.remote) {
          let after = new Set(this.ids());
          before
            .filter(id => !after.has(id))
            .forEach(id => this.#dropped.add(id));
        }
        this.sync();
      }
    },
    QueryInterface: ChromeUtils.generateQI([
      "nsIObserver",
      "nsISupportsWeakReference",
    ]),
  };

  /**
   * @param {object} options
   * @param {string} options.key The store key of the list.
   * @param {string} options.value The session tab value holding the id of
   *   the entry a tab is the tab of.
   * @param {string} options.changeEvent Dispatched on the window after each
   *   sync().
   * @param {string[]} options.tabEvents Tab events handleEvent() hears.
   */
  constructor({ key, value, changeEvent, tabEvents }) {
    this.key = key;
    this.value = value;
    this.changeEvent = changeEvent;
    this.tabEvents = tabEvents;
  }

  init() {
    this.take(OrbitoShellStore.get(this.key));
    Services.obs.addObserver(this.#observer, STORE_CHANGED, true);
    for (let type of ["TabOpen", ...this.tabEvents]) {
      gBrowser.tabContainer.addEventListener(type, this);
    }
    for (let type of WINDOW_EVENTS) {
      window.addEventListener(type, this);
    }
    window.addEventListener(
      "unload",
      () => Services.obs.removeObserver(this.#observer, STORE_CHANGED),
      { once: true }
    );
    // Session Restore takes the window on at load (gBrowserInit.onLoad);
    // tabs can only be given a state after that.
    window.addEventListener("load", () => this.#start(), { once: true });
  }

  /**
   * Makes the window's tabs once a window opened to take a tab or a tab
   * group from another (gBrowser.replaceTabsWithWindow) has it, which can
   * be well after load (gBrowserInit.onLoad waits for a paint): the moved
   * tab takes the place of the blank one the window opened with, and a
   * group goes at index 0, which would put it among the pinned tabs made
   * here before it.
   */
  #start(since = Date.now()) {
    if (
      gBrowserInit.getTabToAdopt() &&
      !window.closed &&
      Date.now() - since < ADOPT_WAIT
    ) {
      setTimeout(() => this.#start(since), ADOPT_POLL);
      return;
    }
    this.#ready = true;
    this.sync();
  }

  /**
   * Whether this window can change the list: not a private one, which
   * would write a private page's address to the profile.
   */
  get canAdd() {
    return !PrivateBrowsingUtils.isWindowPrivate(window);
  }

  /** Whether the window's tabs have been made yet. */
  get ready() {
    return this.#ready;
  }

  /** Whether the window is changing its own tabs to follow the list. */
  get quiet() {
    return this.#quiet;
  }

  /** Whether tab events now are the window's own or Session Restore's. */
  get busy() {
    return this.#quiet || this.restore.restoring || !this.#ready;
  }

  /** The id of the entry a tab is marked with, whether listed or not. */
  idOf(tab) {
    return SessionStore.getCustomTabValue(tab, this.value);
  }

  /**
   * Brings the window's tabs in line with the list: a tab for each entry
   * wanted, placed in order; tabs of entries gone let go, and of two tabs
   * for one entry (one closed and opened again) the one in use stays.
   */
  sync() {
    if (
      !this.#ready ||
      this.restore.restoring ||
      this.#quiet ||
      window.closed
    ) {
      return;
    }
    this.quietly(() => {
      let wanted = this.wanted();
      let ids = new Set(wanted.map(({ entry }) => entry.id));
      let tabs = new Map();
      for (let tab of gBrowser.tabs) {
        let id = this.idOf(tab);
        if (!id || tab.closing) {
          continue;
        }
        if (!this.isEligible(tab) && ids.has(id)) {
          this.claim(tab);
        }
        if (!this.isEligible(tab)) {
          continue;
        }
        if (!ids.has(id)) {
          this.letGo(tab);
          continue;
        }
        let other = tabs.get(id);
        if (other) {
          let [keep, drop] =
            this.#use(tab) > this.#use(other) ? [tab, other] : [other, tab];
          tabs.set(id, keep);
          this.letGo(drop);
        } else {
          tabs.set(id, tab);
        }
      }
      this.#dropped.clear();
      wanted.forEach((item, index) => {
        let tab = tabs.get(item.entry.id) ?? this.openTab(item.entry);
        this.placeTab(tab, index, item);
      });
    });
    window.dispatchEvent(new CustomEvent(this.changeEvent));
  }

  quietly(fn) {
    let quiet = this.#quiet;
    this.#quiet = true;
    try {
      fn();
    } finally {
      this.#quiet = quiet;
    }
  }

  /** Stores the list; every window, this one too, follows from the store. */
  save(value) {
    OrbitoShellStore.set(this.key, value);
  }

  /** How much a tab is in use: selected, loaded, or not. */
  #use(tab) {
    return tab.selected ? 2 : Number(isLoaded(tab));
  }

  /** A new entry for the page a tab shows. */
  entryFrom(tab) {
    let url = tab.linkedBrowser.currentURI.spec;
    let icon = gBrowser.getIcon(tab) ?? "";
    return {
      id: newId(),
      url,
      title: tab.label || url,
      icon: LOCAL_ICON.test(icon) ? icon : "",
    };
  }

  /** An unloaded tab at an entry's URL, marked as its tab. */
  openTab(entry) {
    let tab = gBrowser.addTrustedTab(entry.url, {
      createLazyBrowser: true,
      lazyTabTitle: entry.title,
      skipAnimation: true,
    });
    if (entry.icon) {
      gBrowser.setIcon(tab, entry.icon);
    }
    SessionStore.setCustomTabValue(tab, this.value, entry.id);
    return tab;
  }

  /**
   * A tab whose entry is gone: what keeps() says has something to keep is
   * released (release()), the rest closes. One whose entry another device
   * took out closes in any case.
   */
  letGo(tab) {
    let dropped = this.#dropped.has(this.idOf(tab));
    SessionStore.deleteCustomTabValue(tab, this.value);
    if (!dropped && this.keeps(tab)) {
      this.release(tab);
    } else {
      gBrowser.removeTab(tab, {
        animate: false,
        skipPermitUnload: true,
        skipSessionStore: true,
      });
    }
  }

  /** Once Session Restore is done with the window. */
  restored() {
    this.sync();
  }

  handleEvent(event) {
    switch (event.type) {
      case "TabClose":
        // The entry stays: an unloaded tab takes the closed one's place.
        // One moved to another window has given its values to its tab there
        // (SessionStore) by now, so it no longer says which entry it was.
        if (
          !this.busy &&
          (this.entryOf(event.target) || event.detail?.adoptedBy)
        ) {
          setTimeout(() => this.sync(), 0);
        }
        break;
      case "TabOpen": {
        // A tab moved in from another window (gBrowser.adoptTab, a group's
        // tabs too) gets its values as it opens: it may be an entry's tab
        // here now, in place of the one the window had. SessionStore moves
        // them again once the other window's tab closes, which drops any
        // the tab got there in between (its Space, as another is selected
        // in its place): the id is kept from now. (A window opened for a
        // tab takes it with no TabOpen; it waits for the tab before it
        // makes its own, #start().)
        if (!this.busy && event.detail?.adoptedTab) {
          let tab = event.target;
          let id = this.idOf(tab);
          setTimeout(() => {
            if (id && !tab.closing && !this.idOf(tab)) {
              SessionStore.setCustomTabValue(tab, this.value, id);
            }
            this.sync();
          }, 0);
        }
        break;
      }
      // Session Restore marks the window busy around each tab it restores,
      // the tabs made here too: those are not waited for.
      case "SSWindowStateBusy":
        if (!this.#quiet) {
          this.restore.busy();
        }
        break;
      case "SSWindowStateReady":
        if (!this.#quiet) {
          this.restore.ready();
        }
        break;
    }
  }

  /* For subclasses. */

  /** Takes the list as stored. */
  take() {
    throw new Error("Not implemented");
  }

  /** The ids of the entries in the list. */
  ids() {
    throw new Error("Not implemented");
  }

  /** The entries that want a tab, in the tabs' order: [{entry, ...}]. */
  wanted() {
    throw new Error("Not implemented");
  }

  /** The listed entry a tab is the tab of, or null. */
  entryOf() {
    throw new Error("Not implemented");
  }

  /** Whether a tab can be an entry's tab (pinned or not). */
  isEligible() {
    throw new Error("Not implemented");
  }

  /**
   * A tab marked with a listed entry's id that cannot be its tab
   * (isEligible()) may be made one here. Only a tab moved in from another
   * window is such a tab: it keeps its values but not whether it was
   * pinned. Nothing in a window makes one, as a tab that stops being
   * eligible loses the value then (Pins on TabUnpinned and SSTabRestoring,
   * Docks on TabPinned and TabGrouped), and so does one let go (letGo()).
   * Left as it is, it stays a tab of no entry here.
   */
  claim() {}

  /** Puts an entry's tab in its place, index in wanted(). */
  placeTab() {
    throw new Error("Not implemented");
  }

  /** Whether a tab whose entry is gone has something to keep. */
  keeps() {
    throw new Error("Not implemented");
  }

  /** What becomes of a tab whose entry is gone that keeps() keeps. */
  release() {}
}
