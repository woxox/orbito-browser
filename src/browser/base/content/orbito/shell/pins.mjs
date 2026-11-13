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
 * unpinned (into the Space shown) if it was ever loaded, else closed; it
 * closes in any case when another device removed the Pin (Firefox Sync).
 * What it shares with the Docks is in shell/list-tabs.mjs.
 * Closing a Pin's tab keeps the Pin: an unloaded tab of its URL takes the
 * tab's place. So does moving it to another window, where it is pinned
 * again as that window's tab for the Pin, and the one there before it goes.
 * A Pin's tab gone to another page goes back to the Pin's URL, or makes
 * the page the Pin's, from its menu; the first from the Pin grid too.
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
  updatePin,
} from "chrome://browser/content/orbito/shell/OrbitoPins.sys.mjs";
import {
  isLoaded,
  ListTabs,
} from "chrome://browser/content/orbito/shell/list-tabs.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

/** The store key of the Pin list. */
const LIST_KEY = "pins";
/** The session tab value holding the id of the Pin a tab is the tab of. */
const PIN_VALUE = "orbitoPin";

const TAB_EVENTS = [
  "TabPinned",
  "TabUnpinned",
  "TabMove",
  "TabClose",
  "SSTabRestoring",
];

export class Pins extends ListTabs {
  /** The profile's Pins, in order: [{id, url, title, icon}]. */
  list = [];
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

  constructor() {
    super({
      key: LIST_KEY,
      value: PIN_VALUE,
      changeEvent: "OrbitoPinsChange",
      tabEvents: TAB_EVENTS,
    });
  }

  take(stored) {
    this.list = checkPins(stored);
  }

  ids() {
    return this.list.map(pin => pin.id);
  }

  init() {
    super.init();
    for (let item of this.entryMenuItems("orbito-tab-menu-pin-entry")) {
      this.addMenuItem(item);
    }
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

  /** The window's pinned tabs, in order: the Pins', then its own. */
  get tabs() {
    return gBrowser.tabs.filter(tab => tab.pinned && !tab.closing);
  }

  /** The Pin a tab is the tab of, or null. */
  pinOf(tab) {
    if (!tab.pinned) {
      return null;
    }
    let id = this.idOf(tab);
    return this.list.find(pin => pin.id == id) ?? null;
  }

  entryOf(tab) {
    return this.pinOf(tab);
  }

  withEntry(id, page) {
    return updatePin(this.list, id, page);
  }

  /**
   * Makes a tab a Pin, put at index in the list (at the end without one),
   * in every window. Not in a private window.
   */
  pinTab(tab, index = this.list.length) {
    if (tab.pinned || tab.closing || !this.canAdd) {
      return;
    }
    let pin = this.entryFrom(tab);
    this.quietly(() => {
      gBrowser.pinTab(tab);
      SessionStore.setCustomTabValue(tab, PIN_VALUE, pin.id);
    });
    this.save(addPin(this.list, pin, index));
  }

  /** Removes the Pin a tab is the tab of, in every window; it stays open. */
  unpinTab(tab) {
    gBrowser.unpinTab(tab);
  }

  wanted() {
    return this.list.map(entry => ({ entry }));
  }

  isEligible(tab) {
    return tab.pinned;
  }

  /**
   * A Pin's tab moved in from another window comes unpinned (as the tab a
   * window opens with, or among unpinned tabs): pinned again, it is the
   * Pin's tab here, and the one this window had goes (sync()).
   */
  claim(tab) {
    gBrowser.pinTab(tab);
  }

  /** A Pin's tab goes at its place in the list, before others pinned. */
  placeTab(tab, index) {
    gBrowser.moveTabTo(tab, { tabIndex: index });
  }

  /** An unloaded pinned tab for a Pin. */
  openTab(pin) {
    let tab = super.openTab(pin);
    gBrowser.pinTab(tab);
    this.#made.add(tab);
    return tab;
  }

  /**
   * A tab whose Pin is gone is unpinned into the Space shown if its page
   * was loaded, else closed, as it has nothing to keep.
   */
  keeps(tab) {
    return isLoaded(tab);
  }

  release(tab) {
    gBrowser.unpinTab(tab);
  }

  /**
   * A tab pinned by other means than pinTab (Firefox, an extension, Session
   * Restore): a Pin's own tab, opened again, or a new Pin.
   */
  #pinned(tab) {
    if (this.idOf(tab)) {
      this.sync();
      return;
    }
    if (!this.canAdd) {
      return;
    }
    let pin = this.entryFrom(tab);
    let tabs = this.tabs;
    let index = tabs
      .slice(0, tabs.indexOf(tab))
      .filter(t => this.pinOf(t)).length;
    SessionStore.setCustomTabValue(tab, PIN_VALUE, pin.id);
    this.save(addPin(this.list, pin, index));
  }

  /**
   * After Session Restore: the unloaded tabs this window had made for Pins
   * and Session Restore unpinned to put its own tabs first go; pinned tabs
   * from before Pins become Pins. Once the task is over: a tab restores as
   * it is selected, as one is in place of a Pin's tab leaving for another
   * window (gBrowser.adoptTab), which has given its values away by then but
   * is not yet closing.
   */
  restored() {
    setTimeout(() => {
      if (this.ready && !this.restore.restoring && !window.closed) {
        this.#restored();
      }
    }, 0);
  }

  #restored() {
    for (let tab of gBrowser.tabs) {
      if (!tab.pinned && this.#made.has(tab) && this.idOf(tab)) {
        this.letGo(tab);
      }
    }
    if (this.canAdd) {
      let list = this.list;
      for (let tab of this.tabs) {
        if (!this.idOf(tab)) {
          let pin = this.entryFrom(tab);
          SessionStore.setCustomTabValue(tab, PIN_VALUE, pin.id);
          list = addPin(list, pin);
        }
      }
      if (list != this.list) {
        this.save(list);
        return;
      }
    }
    this.sync();
  }

  handleEvent(event) {
    let tab = event.target;
    switch (event.type) {
      case "TabUnpinned": {
        let id = this.idOf(tab);
        if (!id) {
          break;
        }
        // Session Restore unpins the tabs it finds to put its own first;
        // those are seen to once it is done.
        if (this.restore.restoring) {
          break;
        }
        SessionStore.deleteCustomTabValue(tab, PIN_VALUE);
        if (!this.quiet) {
          this.save(this.list.filter(pin => pin.id != id));
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
        if (!this.busy) {
          setTimeout(() => {
            if (tab.pinned && !tab.closing && !this.restore.restoring) {
              this.#pinned(tab);
            }
          }, 0);
        }
        break;
      case "TabMove":
        // Moved among the pinned tabs (the Pin grid, Firefox's keys): the
        // list takes the new order.
        if (!this.quiet && !this.restore.restoring && this.pinOf(tab)) {
          let order = orderPins(
            this.list,
            this.tabs.map(t => this.pinOf(t)?.id).filter(Boolean)
          );
          if (!sameOrder(order, this.list)) {
            this.save(order);
          }
        }
        break;
      default:
        super.handleEvent(event);
    }
  }
}
