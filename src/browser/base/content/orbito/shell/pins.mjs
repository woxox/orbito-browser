/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Pins in a window. The Pin list is the profile's (OrbitoShellStore, the
 * same in every window); each window has a Firefox pinned tab of its own
 * for each Pin, in the list's order, marked with the Pin's id as a session
 * tab value. A window makes the tabs it lacks unloaded (lazy browsers), so
 * a Pin's page loads only once its tab is first selected. Pinned tabs are in
 * no Space (shell/spaces.mjs) and show in all of them.
 *
 * Pinning a tab (the Pin grid, its menu, or Firefox's gBrowser.pinTab from
 * anywhere else) adds a Pin; unpinning it removes the Pin; moving a Pin's tab
 * among the pinned ones reorders the list. Every window hears of the change
 * and follows: a new Pin gets an unloaded tab, a removed Pin's tab is
 * unpinned (into the Space shown) if it was ever loaded, else closed.
 * Closing a Pin's tab keeps the Pin: an unloaded tab of its URL takes the
 * tab's place.
 *
 * Private windows show and open the Pins but add none: a Pin made there
 * would write a private page's address to the profile. A tab pinned there
 * by other means stays a pinned tab of that window alone, as are pinned tabs
 * with no Pin anywhere else.
 */

import {
  addPin,
  checkPins,
  orderPins,
  sameOrder,
} from "chrome://browser/content/orbito/shell/OrbitoPins.sys.mjs";

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

/** The store key of the Pin list. */
const LIST_KEY = "pins";
/** The session tab value holding the id of the Pin a tab is the tab of. */
const PIN_VALUE = "orbitoPin";
/** Icons a tab can be given back without a page to load them (setIcon). */
const LOCAL_ICON = /^(chrome|about|resource|data):/;

const TAB_EVENTS = [
  "TabPinned",
  "TabUnpinned",
  "TabMove",
  "TabClose",
  "SSTabRestoring",
];
const WINDOW_EVENTS = ["SSWindowStateBusy", "SSWindowStateReady"];

const newId = () => crypto.randomUUID();

/** Whether a tab's page was ever loaded (not a lazy or pending tab). */
function isLoaded(tab) {
  return !!tab.linkedPanel && !tab.hasAttribute("pending");
}

export class Pins {
  /** The profile's Pins, in order: [{id, url, title, icon}]. */
  list = [];
  /** While Session Restore fills the window, tabs come in any order. */
  #restoring = false;
  /** While the window changes its own tabs to follow the list. */
  #quiet = false;
  /** Whether the window's tabs have been made yet (not before load). */
  #ready = false;
  /** The tabs this window made for Pins. */
  #made = new WeakSet();
  /** The tab menu, and the tab it was opened for. */
  #menu = null;
  #menuTab = null;
  /**
   * Items other parts of the Shell put in the tab menu (addMenuItem,
   * addMenu).
   */
  #menuItems = [];

  // Held weakly by the observer service, so a closed window does not leak.
  #observer = {
    observe: (subject, topic, key) => {
      if (key == LIST_KEY) {
        this.list = checkPins(OrbitoShellStore.get(LIST_KEY));
        this.sync();
      }
    },
    QueryInterface: ChromeUtils.generateQI([
      "nsIObserver",
      "nsISupportsWeakReference",
    ]),
  };

  init() {
    this.list = checkPins(OrbitoShellStore.get(LIST_KEY));
    Services.obs.addObserver(this.#observer, STORE_CHANGED, true);
    for (let type of TAB_EVENTS) {
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
    window.addEventListener(
      "load",
      () => {
        this.#ready = true;
        this.sync();
      },
      { once: true }
    );
  }

  /**
   * Puts an item in the tab menu, after the Pin items: shown when
   * shows(tab) says so, run(tab) when picked.
   *
   * @param {{id: string, label: string, shows: Function, run: Function}} item
   */
  addMenuItem(item) {
    this.#menuItems.push(item);
    if (this.#menu) {
      this.#menu.append(this.#makeMenuItem(item));
    }
  }

  /**
   * Puts a submenu in the tab menu, after the Pin items: shown when
   * shows(tab) says so, labelled label(tab), with an item for each of
   * items(tab), [{value, label}]; run(tab, value) when one is picked.
   *
   * @param {{id: string, label: Function, shows: Function, items: Function, run: Function}} menu
   */
  addMenu(menu) {
    this.addMenuItem({ ...menu, submenu: true });
  }

  #makeMenuItem({ id, label, run, submenu }) {
    let item = document.createXULElement(submenu ? "menu" : "menuitem");
    item.id = id;
    if (submenu) {
      let popup = document.createXULElement("menupopup");
      popup.addEventListener("command", event => {
        let tab = this.#menuTab;
        if (tab?.isConnected) {
          run(tab, event.target.getAttribute("value"));
        }
      });
      item.append(popup);
      return item;
    }
    item.setAttribute("label", label);
    item.addEventListener("command", () => {
      let tab = this.#menuTab;
      if (tab?.isConnected) {
        run(tab);
      }
    });
    return item;
  }

  /** A submenu's label and items, for the tab the menu opens for. */
  #fillMenu({ id, label, items }, tab) {
    let menu = this.menu.querySelector(`#${id}`);
    menu.setAttribute("label", label(tab));
    menu.menupopup.replaceChildren(
      ...items(tab).map(({ value, label: text }) => {
        let item = document.createXULElement("menuitem");
        item.setAttribute("label", text);
        item.setAttribute("value", value);
        return item;
      })
    );
  }

  /**
   * The Sidebar's tab menu, made on first use: "Pin tab" for a tab, "Unpin
   * tab" for a Pin's tab, then the items others add (addMenuItem). Native
   * on macOS, as other context menus.
   */
  get menu() {
    if (!this.#menu) {
      let menu = document.createXULElement("menupopup");
      menu.id = "orbito-tab-menu";
      for (let item of [
        {
          id: "orbito-tab-menu-pin",
          label: t("orbito-pins-pin-tab"),
          run: tab => this.pinTab(tab),
        },
        {
          id: "orbito-tab-menu-unpin",
          label: t("orbito-pins-unpin-tab"),
          run: tab => this.unpinTab(tab),
        },
        ...this.#menuItems,
      ]) {
        menu.append(this.#makeMenuItem(item));
      }
      document.getElementById("mainPopupSet").append(menu);
      this.#menu = menu;
    }
    return this.#menu;
  }

  /**
   * Opens the tab menu for a tab: at the pointer for a click, else under
   * the element standing for the tab (a key press). Nothing opens when it
   * would be empty (a tab in a private window).
   *
   * @param {MozTabbrowserTab} tab
   * @param {Element} anchor
   * @param {Event} [event]
   */
  openMenu(tab, anchor, event = null) {
    let menu = this.menu;
    menu.querySelector("#orbito-tab-menu-pin").hidden = !(
      !tab.pinned && this.canAdd
    );
    menu.querySelector("#orbito-tab-menu-unpin").hidden = !tab.pinned;
    for (let item of this.#menuItems) {
      let shows = item.shows(tab);
      menu.querySelector(`#${item.id}`).hidden = !shows;
      if (shows && item.submenu) {
        this.#fillMenu(item, tab);
      }
    }
    if ([...menu.children].every(item => item.hidden)) {
      return;
    }
    this.#menuTab = tab;
    if (event?.type == "contextmenu" && (event.screenX || event.screenY)) {
      menu.openPopupAtScreen(event.screenX, event.screenY, true, event);
    } else {
      menu.openPopup(anchor, "after_start", 0, 0, true, false, event);
    }
  }

  /** Whether this window can add Pins: not a private one. */
  get canAdd() {
    return !PrivateBrowsingUtils.isWindowPrivate(window);
  }

  /** The window's pinned tabs, in order: the Pins', then its own. */
  get tabs() {
    return gBrowser.tabs.filter(tab => tab.pinned && !tab.closing);
  }

  /** The Pin a tab is the tab of, or null. */
  pinOf(tab) {
    if (!tab.pinned) {
      return null;
    }
    let id = SessionStore.getCustomTabValue(tab, PIN_VALUE);
    return this.list.find(pin => pin.id == id) ?? null;
  }

  /**
   * Makes a tab a Pin, put at index in the list (at the end without one),
   * in every window. Not in a private window.
   */
  pinTab(tab, index = this.list.length) {
    if (tab.pinned || tab.closing || !this.canAdd) {
      return;
    }
    let pin = this.#pinFrom(tab);
    this.#quietly(() => {
      gBrowser.pinTab(tab);
      SessionStore.setCustomTabValue(tab, PIN_VALUE, pin.id);
    });
    this.#save(addPin(this.list, pin, index));
  }

  /** Removes the Pin a tab is the tab of, in every window; it stays open. */
  unpinTab(tab) {
    gBrowser.unpinTab(tab);
  }

  /**
   * Brings the window's tabs in line with the list: a tab for each Pin, in
   * the list's order, before the window's own pinned tabs.
   */
  sync() {
    if (!this.#ready || this.#restoring || this.#quiet || window.closed) {
      return;
    }
    this.#quietly(() => {
      let ids = new Set(this.list.map(pin => pin.id));
      let tabs = new Map();
      for (let tab of this.tabs) {
        let id = SessionStore.getCustomTabValue(tab, PIN_VALUE);
        if (!id) {
          continue;
        }
        if (!ids.has(id)) {
          this.#letGo(tab);
          continue;
        }
        // Two tabs for one Pin (one closed and opened again): the one in
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
      this.list.forEach((pin, index) => {
        let tab = tabs.get(pin.id) ?? this.#openTab(pin);
        gBrowser.moveTabTo(tab, { tabIndex: index });
      });
    });
    window.dispatchEvent(new CustomEvent("OrbitoPinsChange"));
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

  #save(list) {
    // Every window, this one too, follows from the store's notification.
    OrbitoShellStore.set(LIST_KEY, list);
  }

  /** How much a tab is in use: selected, loaded, or not. */
  #use(tab) {
    return tab.selected ? 2 : Number(isLoaded(tab));
  }

  #pinFrom(tab) {
    let url = tab.linkedBrowser.currentURI.spec;
    let icon = gBrowser.getIcon(tab) ?? "";
    return {
      id: newId(),
      url,
      title: tab.label || url,
      icon: LOCAL_ICON.test(icon) ? icon : "",
    };
  }

  /** An unloaded pinned tab for a Pin. */
  #openTab(pin) {
    let tab = gBrowser.addTrustedTab(pin.url, {
      createLazyBrowser: true,
      lazyTabTitle: pin.title,
      skipAnimation: true,
    });
    if (pin.icon) {
      gBrowser.setIcon(tab, pin.icon);
    }
    SessionStore.setCustomTabValue(tab, PIN_VALUE, pin.id);
    gBrowser.pinTab(tab);
    this.#made.add(tab);
    return tab;
  }

  /**
   * A tab whose Pin is gone: unpinned into the Space shown if its page was
   * loaded, else closed, as it has nothing to keep.
   */
  #letGo(tab) {
    SessionStore.deleteCustomTabValue(tab, PIN_VALUE);
    if (isLoaded(tab)) {
      gBrowser.unpinTab(tab);
    } else {
      gBrowser.removeTab(tab, {
        animate: false,
        skipPermitUnload: true,
        skipSessionStore: true,
      });
    }
  }

  /**
   * A tab pinned by other means than pinTab (Firefox, an extension, Session
   * Restore): a Pin's own tab, opened again, or a new Pin.
   */
  #pinned(tab) {
    if (SessionStore.getCustomTabValue(tab, PIN_VALUE)) {
      this.sync();
      return;
    }
    if (!this.canAdd) {
      return;
    }
    let pin = this.#pinFrom(tab);
    let tabs = this.tabs;
    let index = tabs
      .slice(0, tabs.indexOf(tab))
      .filter(t => this.pinOf(t)).length;
    SessionStore.setCustomTabValue(tab, PIN_VALUE, pin.id);
    this.#save(addPin(this.list, pin, index));
  }

  /**
   * After Session Restore: the unloaded tabs this window had made for Pins
   * and Session Restore unpinned to put its own tabs first go; pinned tabs
   * from before Pins become Pins.
   */
  #restored() {
    for (let tab of gBrowser.tabs) {
      if (
        !tab.pinned &&
        this.#made.has(tab) &&
        SessionStore.getCustomTabValue(tab, PIN_VALUE)
      ) {
        this.#letGo(tab);
      }
    }
    if (this.canAdd) {
      let list = this.list;
      for (let tab of this.tabs) {
        if (!SessionStore.getCustomTabValue(tab, PIN_VALUE)) {
          let pin = this.#pinFrom(tab);
          SessionStore.setCustomTabValue(tab, PIN_VALUE, pin.id);
          list = addPin(list, pin);
        }
      }
      if (list != this.list) {
        this.#save(list);
        return;
      }
    }
    this.sync();
  }

  handleEvent(event) {
    let tab = event.target;
    switch (event.type) {
      case "TabUnpinned": {
        let id = SessionStore.getCustomTabValue(tab, PIN_VALUE);
        if (!id) {
          break;
        }
        // Session Restore unpins the tabs it finds to put its own first;
        // those are seen to once it is done.
        if (this.#restoring) {
          break;
        }
        SessionStore.deleteCustomTabValue(tab, PIN_VALUE);
        if (!this.#quiet) {
          this.#save(this.list.filter(pin => pin.id != id));
        }
        break;
      }
      case "SSTabRestoring":
        // A Pin's tab duplicated, or reopened unpinned, is a plain tab.
        if (!tab.pinned) {
          SessionStore.deleteCustomTabValue(tab, PIN_VALUE);
        }
        break;
      case "TabPinned":
        // Session Restore pins a tab it reopens before it gives the tab its
        // values (which Pin it is the tab of): after that.
        if (!this.#quiet && !this.#restoring && this.#ready) {
          setTimeout(() => {
            if (tab.pinned && !tab.closing && !this.#restoring) {
              this.#pinned(tab);
            }
          }, 0);
        }
        break;
      case "TabMove":
        // Moved among the pinned tabs (the Pin grid, Firefox's keys): the
        // list takes the new order.
        if (!this.#quiet && !this.#restoring && this.pinOf(tab)) {
          let order = orderPins(
            this.list,
            this.tabs.map(t => this.pinOf(t)?.id).filter(Boolean)
          );
          if (!sameOrder(order, this.list)) {
            this.#save(order);
          }
        }
        break;
      case "TabClose":
        // The Pin stays: an unloaded tab takes the closed one's place.
        if (!this.#quiet && !this.#restoring && this.pinOf(tab)) {
          setTimeout(() => this.sync(), 0);
        }
        break;
      // Session Restore marks the window busy around each tab it restores,
      // the tabs made here for Pins too: those are not waited for.
      case "SSWindowStateBusy":
        if (!this.#quiet) {
          this.#restoring = true;
        }
        break;
      case "SSWindowStateReady":
        if (this.#quiet) {
          break;
        }
        this.#restoring = false;
        if (this.#ready) {
          this.#restored();
        }
        break;
    }
  }
}
