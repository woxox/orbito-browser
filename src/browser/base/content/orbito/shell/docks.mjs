/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Docks in a window. Each Space has a Dock list, kept for the whole profile
 * (OrbitoShellStore, the same in every window); each window has a tab of its
 * own for each entry of every Space's Dock, in that Space, marked with the
 * entry's id as a session tab value. Those tabs sit after the pinned ones,
 * outside tab groups, Space by Space in the Dock's order; the Spaces hide
 * those of the Spaces not shown, as they hide any tab. A window makes the
 * tabs it lacks unloaded (lazy browsers), so a Dock tab's page loads only
 * once the tab is first selected.
 *
 * Docking a tab (dropping it on the Dock, its menu, or ⌘D on the selected
 * tab) adds it to its Space's Dock, with the page it shows as the entry's
 * URL; undocking it (dropping it on the tab list, its menu, ⌘D again)
 * removes the entry, the tab staying open as a plain tab; a Dock tab at rest
 * taken out of the Dock (its row's − button) closes with it; moving a Dock
 * tab among its Space's Dock tabs reorders the Dock. Pinning a Dock tab, or
 * putting it in a tab group, undocks it. Every window hears of the change
 * and follows: a new entry gets an unloaded tab, a removed entry's tab stays
 * as a plain tab if it was ever loaded, else closes. Closing a Dock tab
 * keeps its place: an unloaded tab of the entry's URL takes it (Arc's way),
 * so the page goes back to where it was docked and takes no memory until it
 * is selected again.
 *
 * Private windows show and open the Docks but change none: an entry made
 * there would write a private page's address to the profile.
 */

import {
  addPin,
  orderPins,
  sameOrder,
} from "chrome://browser/content/orbito/shell/OrbitoPins.sys.mjs";
import {
  checkDocks,
  dockList,
  keepSpaces,
  removeDock,
  withDockList,
} from "chrome://browser/content/orbito/shell/OrbitoDocks.sys.mjs";
import { RestoreWatch } from "chrome://browser/content/orbito/shell/spaces.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

// Through the shared module loader: one store for every window (a static
// import would load a copy into each).
const { OrbitoShellStore, STORE_CHANGED } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/shell/OrbitoShellStore.sys.mjs"
);
const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
);

/** The store key of the Dock lists. */
const LIST_KEY = "docks";
/** The session tab value holding the id of the Dock entry a tab is of. */
const DOCK_VALUE = "orbitoDock";
/** Icons a tab can be given back without a page to load them (setIcon). */
const LOCAL_ICON = /^(chrome|about|resource|data):/;

const TAB_EVENTS = [
  "TabSelect",
  "TabPinned",
  "TabMove",
  "TabClose",
  "TabGrouped",
];
const WINDOW_EVENTS = ["SSWindowStateBusy", "SSWindowStateReady"];

const newId = () => crypto.randomUUID();

/** Whether a tab's page was ever loaded (not a lazy or pending tab). */
function isLoaded(tab) {
  return !!tab.linkedPanel && !tab.hasAttribute("pending");
}

export class Docks {
  /** Every Space's Dock: {[spaceId]: [{id, url, title, icon}]}. */
  lists = {};
  /** While Session Restore fills the window, tabs come in any order. */
  #restore = new RestoreWatch(() => this.sync());
  /** While the window changes its own tabs to follow the lists. */
  #quiet = false;
  /** Whether the window's tabs have been made yet (not before load). */
  #ready = false;
  /**
   * Dock tabs at rest, as the window made or found them; a tab stays here
   * through a selection undone at once (see TabSelect).
   */
  #asleep = new WeakSet();

  // Held weakly by the observer service, so a closed window does not leak.
  #observer = {
    observe: (subject, topic, key) => {
      if (key == LIST_KEY) {
        this.lists = checkDocks(OrbitoShellStore.get(LIST_KEY));
        this.sync();
      }
    },
    QueryInterface: ChromeUtils.generateQI([
      "nsIObserver",
      "nsISupportsWeakReference",
    ]),
  };

  /**
   * @param {Spaces} spaces The window's Spaces.
   * @param {Pins} pins The window's Pins, whose tab menu gets the Dock's
   *   items.
   */
  constructor(spaces, pins) {
    this.spaces = spaces;
    this.pins = pins;
  }

  init() {
    this.lists = checkDocks(OrbitoShellStore.get(LIST_KEY));
    Services.obs.addObserver(this.#observer, STORE_CHANGED, true);
    for (let type of TAB_EVENTS) {
      gBrowser.tabContainer.addEventListener(type, this);
    }
    for (let type of WINDOW_EVENTS) {
      window.addEventListener(type, this);
    }
    window.addEventListener("OrbitoSpacesChange", this);
    window.addEventListener(
      "unload",
      () => Services.obs.removeObserver(this.#observer, STORE_CHANGED),
      { once: true }
    );
    // Session Restore takes the window on at load (gBrowserInit.onLoad);
    // tabs can only be given a state after that.
    window.addEventListener(
      "load",
      () => {
        this.#ready = true;
        this.sync();
      },
      { once: true }
    );
    this.pins.addMenuItem({
      id: "orbito-tab-menu-dock",
      label: t("orbito-dock-add"),
      shows: tab => this.canDock(tab),
      run: tab => this.dockTab(tab),
    });
    this.pins.addMenuItem({
      id: "orbito-tab-menu-undock",
      label: t("orbito-dock-remove"),
      shows: tab => this.canAdd && !!this.dockOf(tab),
      run: tab =>
        this.isResting(tab) ? this.removeResting(tab) : this.undockTab(tab),
    });
  }

  /** Whether this window can change the Docks: not a private one. */
  get canAdd() {
    return !PrivateBrowsingUtils.isWindowPrivate(window);
  }

  /** The Dock list of a Space (the one shown by default). */
  listOf(space = this.spaces.current) {
    return dockList(this.lists, space);
  }

  /** The Dock entry a tab is the tab of, or null. */
  dockOf(tab) {
    if (tab.pinned) {
      return null;
    }
    let id = SessionStore.getCustomTabValue(tab, DOCK_VALUE);
    if (!id) {
      return null;
    }
    let space = this.spaces.spaceOf(tab);
    return this.listOf(space).find(entry => entry.id == id) ?? null;
  }

  /**
   * Whether a tab is a Dock tab at rest: closed back to its entry's URL, or
   * not selected since the window made it, so its page is not loaded.
   */
  isResting(tab) {
    return (this.#asleep.has(tab) || !isLoaded(tab)) && !!this.dockOf(tab);
  }

  /** A Space's Dock tabs (the one shown by default), in the Dock's order. */
  tabsIn(space = this.spaces.current) {
    return gBrowser.tabs.filter(
      tab =>
        !tab.closing &&
        !tab.pinned &&
        this.spaces.spaceOf(tab) == space &&
        this.dockOf(tab)
    );
  }

  /** Whether a tab can be docked here: a plain tab, in a window that can. */
  canDock(tab) {
    return this.canAdd && !tab.pinned && !tab.closing && !this.dockOf(tab);
  }

  /**
   * Adds a tab to its Space's Dock, at index in it (at the end without
   * one), in every window; it leaves any tab group.
   */
  dockTab(tab, index = Infinity) {
    if (!this.canDock(tab)) {
      return;
    }
    let space = this.spaces.spaceOf(tab);
    let entry = this.#entryFrom(tab);
    this.#quietly(() => {
      if (tab.group) {
        gBrowser.ungroupTab(tab);
      }
      SessionStore.setCustomTabValue(tab, DOCK_VALUE, entry.id);
    });
    let list = this.listOf(space);
    this.#save(
      withDockList(
        this.lists,
        space,
        addPin(list, entry, Math.min(index, list.length))
      )
    );
  }

  /**
   * Removes the Dock entry a tab is the tab of, in every window; the tab
   * stays open, as the first of the Space's plain tabs.
   */
  undockTab(tab) {
    let entry = this.dockOf(tab);
    if (!entry || !this.canAdd) {
      return;
    }
    this.#quietly(() => SessionStore.deleteCustomTabValue(tab, DOCK_VALUE));
    this.#save(removeDock(this.lists, entry.id));
  }

  /**
   * Takes a Dock tab at rest out of the Dock, in every window: its entry
   * goes, and the tab with it, as it has no page to keep (sync).
   */
  removeResting(tab) {
    let entry = this.dockOf(tab);
    if (!entry || !this.canAdd || !this.isResting(tab)) {
      return;
    }
    this.#save(removeDock(this.lists, entry.id));
  }

  /** Docks a tab, or undocks it if it is a Dock tab (⌘D). */
  toggleDock(tab) {
    if (this.dockOf(tab)) {
      this.undockTab(tab);
    } else {
      this.dockTab(tab);
    }
  }

  /**
   * Brings the window's tabs in line with the lists: a tab for each entry,
   * in its Space, in order, after the pinned tabs.
   */
  sync() {
    if (
      !this.#ready ||
      this.#restore.restoring ||
      this.#quiet ||
      window.closed
    ) {
      return;
    }
    this.#quietly(() => {
      // Those of a Space being removed too, which keeps its tabs until it
      // goes.
      let wanted = this.spaces.all.flatMap(space =>
        this.listOf(space.id).map(entry => ({ space: space.id, entry }))
      );
      let ids = new Set(wanted.map(({ entry }) => entry.id));
      let tabs = new Map();
      for (let tab of gBrowser.tabs) {
        let id = SessionStore.getCustomTabValue(tab, DOCK_VALUE);
        if (!id || tab.closing || tab.pinned) {
          continue;
        }
        if (!ids.has(id)) {
          this.#letGo(tab);
          continue;
        }
        // Two tabs for one entry (one closed and opened again): the one in
        // use stays.
        let other = tabs.get(id);
        if (other) {
          let [keep, drop] =
            this.#use(tab) > this.#use(other) ? [tab, other] : [other, tab];
          tabs.set(id, keep);
          this.#letGo(drop);
        } else {
          tabs.set(id, tab);
        }
      }
      let start = gBrowser.pinnedTabCount;
      wanted.forEach(({ space, entry }, index) => {
        let tab = tabs.get(entry.id) ?? this.#openTab(entry);
        if (!isLoaded(tab) && !tab.selected) {
          this.#asleep.add(tab);
        }
        if (this.spaces.spaceOf(tab) != space) {
          this.spaces.moveTab(tab, space);
        }
        gBrowser.moveTabTo(tab, {
          tabIndex: start + index,
          forceUngrouped: true,
        });
      });
    });
    window.dispatchEvent(new CustomEvent("OrbitoDocksChange"));
  }

  #quietly(fn) {
    let quiet = this.#quiet;
    this.#quiet = true;
    try {
      fn();
    } finally {
      this.#quiet = quiet;
    }
  }

  #save(lists) {
    // Every window, this one too, follows from the store's notification.
    // The Dock of a Space that is gone goes with it.
    OrbitoShellStore.set(
      LIST_KEY,
      keepSpaces(
        lists,
        this.spaces.all.map(space => space.id)
      )
    );
  }

  /** How much a tab is in use: selected, loaded, or not. */
  #use(tab) {
    return tab.selected ? 2 : Number(isLoaded(tab));
  }

  #entryFrom(tab) {
    let url = tab.linkedBrowser.currentURI.spec;
    let icon = gBrowser.getIcon(tab) ?? "";
    return {
      id: newId(),
      url,
      title: tab.label || url,
      icon: LOCAL_ICON.test(icon) ? icon : "",
    };
  }

  /** An unloaded tab for a Dock entry, at its URL. */
  #openTab(entry) {
    let tab = gBrowser.addTrustedTab(entry.url, {
      createLazyBrowser: true,
      lazyTabTitle: entry.title,
      skipAnimation: true,
    });
    if (entry.icon) {
      gBrowser.setIcon(tab, entry.icon);
    }
    SessionStore.setCustomTabValue(tab, DOCK_VALUE, entry.id);
    return tab;
  }

  /**
   * A tab whose entry is gone: kept as a plain tab if its page was loaded,
   * else closed, as it has nothing to keep.
   */
  #letGo(tab) {
    SessionStore.deleteCustomTabValue(tab, DOCK_VALUE);
    if (!isLoaded(tab) && !tab.selected) {
      gBrowser.removeTab(tab, {
        animate: false,
        skipPermitUnload: true,
        skipSessionStore: true,
      });
    }
  }

  /** A Dock tab that left the Dock by other means: its entry goes. */
  #left(tab) {
    let id = SessionStore.getCustomTabValue(tab, DOCK_VALUE);
    if (!id) {
      return;
    }
    SessionStore.deleteCustomTabValue(tab, DOCK_VALUE);
    if (this.canAdd) {
      this.#save(removeDock(this.lists, id));
    }
  }

  handleEvent(event) {
    let tab = event.target;
    let busy = this.#quiet || this.#restore.restoring || !this.#ready;
    switch (event.type) {
      case "TabSelect":
        // A Dock tab at rest wakes once selected. But Firefox selects one
        // by itself when the selected tab closes, before anyone hears of the
        // close; if another tab is selected in the same task (the Spaces
        // open a new one when only Dock tabs at rest are left), the Dock tab
        // goes back to rest.
        if (this.#asleep.has(tab)) {
          queueMicrotask(() => {
            if (
              tab.selected ||
              tab.closing ||
              !gBrowser.discardBrowser(tab)
            ) {
              this.#asleep.delete(tab);
            }
            window.dispatchEvent(new CustomEvent("OrbitoDocksChange"));
          });
        }
        break;
      case "TabPinned":
        // Pinned, it is a Pin's now.
        if (!busy) {
          this.#left(tab);
        }
        break;
      case "TabGrouped":
        if (!busy) {
          this.#left(event.detail);
        }
        break;
      case "TabMove":
        // Moved among its Space's Dock tabs (a drag in the Dock): the Dock
        // takes the new order.
        if (!busy && this.canAdd) {
          let entry = this.dockOf(tab);
          if (!entry) {
            break;
          }
          let space = this.spaces.spaceOf(tab);
          let list = this.listOf(space);
          let order = orderPins(
            list,
            this.tabsIn(space).map(t => this.dockOf(t).id)
          );
          if (!sameOrder(order, list)) {
            this.#save(withDockList(this.lists, space, order));
          }
        }
        break;
      case "TabClose":
        // The place stays: an unloaded tab takes the closed one's.
        if (!busy && this.dockOf(tab)) {
          setTimeout(() => this.sync(), 0);
        }
        break;
      case "OrbitoSpacesChange":
        // A Space made elsewhere, or gone: its Dock comes or goes.
        this.sync();
        break;
      // Session Restore marks the window busy around each tab it restores,
      // the tabs made here for the Docks too: those are not waited for. A
      // Dock tab reopened (undo close tab) is its entry's tab again: the
      // sync after it keeps one of the two.
      case "SSWindowStateBusy":
        if (!this.#quiet) {
          this.#restore.busy();
        }
        break;
      case "SSWindowStateReady":
        if (!this.#quiet) {
          this.#restore.ready();
        }
        break;
    }
  }
}
