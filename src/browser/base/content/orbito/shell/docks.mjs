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
 * as a plain tab if it was ever loaded, else closes (in any case when another
 * device removed the entry, by Firefox Sync). Closing a Dock tab
 * keeps its place: an unloaded tab of the entry's URL takes it (Arc's way),
 * so the page goes back to where it was docked and takes no memory until it
 * is selected again. Moving a Dock tab to another window leaves the same in
 * its place; there it is that window's tab for the entry, and the one there
 * before it goes.
 *
 * A Dock can hold folders of entries (shell/OrbitoDocks.sys.mjs), made from
 * a Dock tab's menu ("Move to new folder") or by holding a dragged Dock tab
 * over another ("New folder N", with the two), and named, unmade ("Ungroup":
 * its tabs stay in the Dock) or removed with its entries ("Delete folder")
 * from the folder's menu. A Dock tab goes in or out of a folder by its menu
 * or by a drag (shell/orbito-dock.mjs). A Dock's tabs sit in the order of
 * its entries, those in folders where their folder is. Which folders are
 * closed is the window's own, kept in its session.
 *
 * Private windows show and open the Docks but change none: an entry made
 * there would write a private page's address to the profile. What the Docks
 * share with the Pins is in shell/list-tabs.mjs.
 */

import {
  addDock,
  checkDocks,
  dockEntries,
  dockFolder,
  dockList,
  findDock,
  isDockFolder,
  keepSpaces,
  moveDock,
  orderDock,
  removeDock,
  renameDockFolder,
  sameDock,
  ungroupDockFolder,
  withDockList,
} from "chrome://browser/content/orbito/shell/OrbitoDocks.sys.mjs";
import {
  isLoaded,
  ListTabs,
} from "chrome://browser/content/orbito/shell/list-tabs.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

/** The store key of the Dock lists. */
const LIST_KEY = "docks";
/** The session tab value holding the id of the Dock entry a tab is of. */
const DOCK_VALUE = "orbitoDock";
/** The session window value holding the ids of the folders closed in it. */
const CLOSED_VALUE = "orbitoDockClosedFolders";

const TAB_EVENTS = [
  "TabSelect",
  "TabPinned",
  "TabMove",
  "TabClose",
  "TabGrouped",
];
export class Docks extends ListTabs {
  /**
   * Every Space's Dock: {[spaceId]: [entry | folder]}, an entry
   * {id, url, title, icon}, a folder {id, title, children: [entry]}.
   */
  lists = {};
  /**
   * Dock tabs at rest, as the window made or found them; a tab stays here
   * through a selection undone at once (see TabSelect).
   */
  #asleep = new WeakSet();
  /** The ids of the folders closed in this window. */
  #closed = new Set();
  /** The folder menu, and the folder it was opened for. */
  #folderMenu = null;
  #menuFolder = null;

  /**
   * @param {Spaces} spaces The window's Spaces.
   * @param {Pins} pins The window's Pins, whose tab menu gets the Dock's
   *   items.
   */
  constructor(spaces, pins) {
    super({
      key: LIST_KEY,
      value: DOCK_VALUE,
      changeEvent: "OrbitoDocksChange",
      tabEvents: TAB_EVENTS,
    });
    this.spaces = spaces;
    this.pins = pins;
  }

  take(stored) {
    this.lists = checkDocks(stored);
  }

  ids() {
    return Object.values(this.lists).flatMap(list =>
      dockEntries(list).map(entry => entry.id)
    );
  }

  init() {
    super.init();
    window.addEventListener("OrbitoSpacesChange", this);
    window.addEventListener("load", () => this.#readClosed(), { once: true });
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
    this.pins.addMenuItem({
      id: "orbito-tab-menu-dock-new-folder",
      label: t("orbito-dock-folder-new-with-tab"),
      shows: tab => this.canAdd && !!this.dockOf(tab) && !this.folderOf(tab),
      run: tab => {
        let id = this.newFolder(tab);
        if (id) {
          document.getElementById("orbito-dock")?.rename(id);
        }
      },
    });
    this.pins.addMenu({
      id: "orbito-tab-menu-dock-move",
      label: () => t("orbito-dock-folder-move-to"),
      shows: tab => this.canAdd && this.#otherFolders(tab).length > 0,
      items: tab =>
        this.#otherFolders(tab).map(folder => ({
          value: folder.id,
          label: this.folderName(folder),
        })),
      run: (tab, folder) => this.moveTab(tab, { folder }),
    });
    this.pins.addMenuItem({
      id: "orbito-tab-menu-dock-out-of-folder",
      label: t("orbito-dock-folder-take-out"),
      shows: tab => this.canAdd && !!this.folderOf(tab),
      run: tab => this.takeOutOfFolder(tab),
    });
  }

  /** The Dock list of a Space (the one shown by default), folders and all. */
  listOf(space = this.spaces.current) {
    return dockList(this.lists, space);
  }

  /** A Space's Dock entries, those in folders too, in order. */
  entriesOf(space = this.spaces.current) {
    return dockEntries(this.listOf(space));
  }

  /** The Dock entry a tab is the tab of, or null. */
  dockOf(tab) {
    if (tab.pinned) {
      return null;
    }
    let id = this.idOf(tab);
    if (!id) {
      return null;
    }
    let space = this.spaces.spaceOf(tab);
    return this.entriesOf(space).find(entry => entry.id == id) ?? null;
  }

  /** The folder a Dock tab is in, or null. */
  folderOf(tab) {
    let entry = this.dockOf(tab);
    let found = entry && findDock(this.lists, entry.id);
    return found?.folder ? this.folder(found.folder) : null;
  }

  /** A folder, by its id, in any Space; or null. */
  folder(id) {
    let entry = findDock(this.lists, id)?.entry;
    return isDockFolder(entry) ? entry : null;
  }

  /** A folder's name as shown: its title, or "Folder" without one. */
  folderName(folder) {
    return folder.title || t("orbito-dock-folder-untitled");
  }

  /** The folders of a Dock tab's Space it is not in. */
  #otherFolders(tab) {
    if (!this.dockOf(tab)) {
      return [];
    }
    let own = this.folderOf(tab);
    return this.listOf(this.spaces.spaceOf(tab)).filter(
      item => isDockFolder(item) && item != own
    );
  }

  entryOf(tab) {
    return this.dockOf(tab);
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
   * Adds a tab to its Space's Dock, in every window; it leaves any tab
   * group. Where: {folder, index} as addDock (shell/OrbitoDocks.sys.mjs)
   * takes it, or an index at the top of the Dock; at the end without one.
   */
  dockTab(tab, where = {}) {
    if (!this.canDock(tab)) {
      return;
    }
    if (typeof where == "number") {
      where = { index: where };
    }
    let space = this.spaces.spaceOf(tab);
    let entry = this.entryFrom(tab);
    this.quietly(() => {
      if (tab.group) {
        gBrowser.ungroupTab(tab);
      }
      SessionStore.setCustomTabValue(tab, DOCK_VALUE, entry.id);
    });
    this.save(addDock(this.lists, space, entry, where));
  }

  /**
   * Moves a Dock item of the Space shown (a Dock tab, or a folder by its
   * id) to {folder, index} in its Dock, as moveDock takes it.
   */
  moveItem(item, where) {
    let id = typeof item == "string" ? item : this.dockOf(item)?.id;
    if (!id || !this.canAdd) {
      return;
    }
    let next = moveDock(this.lists, id, where);
    if (!sameDock(this.listOf(), dockList(next, this.spaces.current))) {
      this.save(next);
    }
  }

  /** Moves a Dock tab to {folder, index} in its Space's Dock. */
  moveTab(tab, where) {
    this.moveItem(tab, where);
  }

  /** Takes a Dock tab out of its folder: right after it in the Dock. */
  takeOutOfFolder(tab) {
    let folder = this.folderOf(tab);
    if (!folder) {
      return;
    }
    let list = this.listOf(this.spaces.spaceOf(tab));
    this.moveItem(tab, { index: list.indexOf(folder) + 1 });
  }

  /**
   * Makes a folder, open, at a Dock tab's place in its Space's Dock, with
   * the tab in it; its id, or null. Not for a tab already in a folder.
   */
  newFolder(tab) {
    let entry = this.dockOf(tab);
    if (!entry || !this.canAdd || this.folderOf(tab)) {
      return null;
    }
    let space = this.spaces.spaceOf(tab);
    let folder = dockFolder(t("orbito-dock-folder-new-name"));
    let index = this.listOf(space).indexOf(entry);
    let next = addDock(this.lists, space, folder, { index });
    this.save(addDock(next, space, entry, { folder: folder.id }));
    return folder.id;
  }

  /**
   * Puts a Dock tab in a folder with another Dock tab of its Space: in the
   * other's folder, at its end (opened), or in a new folder of the two
   * where the other is, the other first, named "New folder N". What it
   * did: {id, fresh}, the folder's id and whether it is new; or null.
   */
  groupTabs(tab, target) {
    let entry = this.dockOf(tab);
    let other = this.dockOf(target);
    let space = this.spaces.spaceOf(target);
    if (
      !entry ||
      !other ||
      entry == other ||
      !this.canAdd ||
      this.spaces.spaceOf(tab) != space
    ) {
      return null;
    }
    let folder = this.folderOf(target);
    if (folder) {
      this.setOpen(folder.id, true);
      this.moveItem(tab, { folder: folder.id });
      return { id: folder.id, fresh: false };
    }
    // Where the other is, counted without the two.
    let index = this.listOf(space)
      .filter(item => item != entry)
      .indexOf(other);
    let made = dockFolder(this.#newFolderName(), [other, entry]);
    this.save(addDock(this.lists, space, made, { index }));
    return { id: made.id, fresh: true };
  }

  // The name a folder made by a drag gets: "New folder N", N the lowest no
  // folder in any Space's Dock is named with.
  #newFolderName() {
    let names = new Set(
      Object.values(this.lists)
        .flat()
        .filter(isDockFolder)
        .map(folder => folder.title)
    );
    let name = number => t("orbito-dock-folder-new-numbered-name", { number });
    let number = 1;
    while (names.has(name(number))) {
      number++;
    }
    return name(number);
  }

  /** Names a folder anew (a blank name keeps the old one). */
  renameFolder(id, title) {
    if (this.canAdd) {
      let next = renameDockFolder(this.lists, id, title);
      if (next != this.lists) {
        this.save(next);
      }
    }
  }

  /** Unmakes a folder: its tabs stay in the Dock where it was. */
  ungroupFolder(id) {
    if (this.canAdd && this.folder(id)) {
      this.save(ungroupDockFolder(this.lists, id));
    }
  }

  /**
   * Removes a folder and its entries: their tabs go as an undocked entry's
   * do (a loaded one stays, as a plain tab).
   */
  deleteFolder(id) {
    if (this.canAdd && this.folder(id)) {
      this.save(removeDock(this.lists, id));
    }
  }

  /** Whether a folder is open in this window. */
  isOpen(id) {
    return !this.#closed.has(id);
  }

  /** Opens or closes a folder in this window (toggles it without open). */
  setOpen(id, open = !this.isOpen(id)) {
    if (open == this.isOpen(id)) {
      return;
    }
    if (open) {
      this.#closed.delete(id);
    } else {
      this.#closed.add(id);
    }
    this.#writeClosed();
    window.dispatchEvent(new CustomEvent("OrbitoDocksChange"));
  }

  #readClosed() {
    try {
      let ids = JSON.parse(
        SessionStore.getCustomWindowValue(window, CLOSED_VALUE) || "[]"
      );
      this.#closed = new Set(Array.isArray(ids) ? ids : []);
    } catch (e) {
      this.#closed = new Set();
    }
  }

  #writeClosed() {
    // Only folders there still are.
    for (let id of this.#closed) {
      if (!this.folder(id)) {
        this.#closed.delete(id);
      }
    }
    SessionStore.setCustomWindowValue(
      window,
      CLOSED_VALUE,
      JSON.stringify([...this.#closed])
    );
  }

  /**
   * The folder menu, made on first use: rename, ungroup, delete. Native on
   * macOS, as other context menus.
   */
  get folderMenu() {
    if (!this.#folderMenu) {
      let menu = document.createXULElement("menupopup");
      menu.id = "orbito-dock-folder-menu";
      for (let [id, label, run] of [
        [
          "rename",
          "orbito-dock-folder-rename",
          folder => document.getElementById("orbito-dock")?.rename(folder),
        ],
        ["ungroup", "orbito-dock-folder-ungroup", folder => this.ungroupFolder(folder)],
        ["delete", "orbito-dock-folder-delete", folder => this.deleteFolder(folder)],
      ]) {
        let item = document.createXULElement("menuitem");
        item.id = `orbito-dock-folder-menu-${id}`;
        item.setAttribute("label", t(label));
        item.addEventListener("command", () => {
          if (this.folder(this.#menuFolder)) {
            run(this.#menuFolder);
          }
        });
        menu.append(item);
      }
      document.getElementById("mainPopupSet").append(menu);
      this.#folderMenu = menu;
    }
    return this.#folderMenu;
  }

  /**
   * Opens the folder menu for a folder: at the pointer for a click, else
   * under the element standing for it (a key press). None in a private
   * window, which changes no Dock.
   */
  openFolderMenu(id, anchor, event = null) {
    if (!this.canAdd || !this.folder(id)) {
      return;
    }
    let menu = this.folderMenu;
    this.#menuFolder = id;
    if (event?.type == "contextmenu" && (event.screenX || event.screenY)) {
      menu.openPopupAtScreen(event.screenX, event.screenY, true, event);
    } else {
      menu.openPopup(anchor, "after_start", 0, 0, true, false, event);
    }
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
    this.quietly(() => SessionStore.deleteCustomTabValue(tab, DOCK_VALUE));
    this.save(removeDock(this.lists, entry.id));
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
    this.save(removeDock(this.lists, entry.id));
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
   * Every Space's entries, those of a Space being removed too, which keeps
   * its tabs until it goes.
   */
  wanted() {
    return this.spaces.all.flatMap(space =>
      this.entriesOf(space.id).map(entry => ({ space: space.id, entry }))
    );
  }

  isEligible(tab) {
    return !tab.pinned;
  }

  /**
   * An entry's tab goes in its Space, after the pinned tabs, outside tab
   * groups, Space by Space in the Docks' order.
   */
  placeTab(tab, index, { space }) {
    if (!isLoaded(tab) && !tab.selected) {
      this.#asleep.add(tab);
    }
    if (this.spaces.spaceOf(tab) != space) {
      this.spaces.moveTab(tab, space);
    }
    gBrowser.moveTabTo(tab, {
      tabIndex: gBrowser.pinnedTabCount + index,
      forceUngrouped: true,
    });
  }

  save(lists) {
    // The Dock of a Space that is gone goes with it.
    super.save(
      keepSpaces(
        lists,
        this.spaces.all.map(space => space.id)
      )
    );
  }

  /** Once Session Restore is done with the window: its closed folders too. */
  restored() {
    this.#readClosed();
    super.restored();
  }

  /**
   * A tab whose entry is gone stays as a plain tab if its page was loaded,
   * else closes, as it has nothing to keep.
   */
  keeps(tab) {
    return isLoaded(tab) || tab.selected;
  }

  /** A Dock tab that left the Dock by other means: its entry goes. */
  #left(tab) {
    let id = this.idOf(tab);
    if (!id) {
      return;
    }
    SessionStore.deleteCustomTabValue(tab, DOCK_VALUE);
    if (this.canAdd) {
      this.save(removeDock(this.lists, id));
    }
  }

  handleEvent(event) {
    let tab = event.target;
    let busy = this.busy;
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
        // Moved among its Space's Dock tabs (by gBrowser): the Dock takes
        // the new order, as far as its folders allow.
        if (!busy && this.canAdd) {
          let entry = this.dockOf(tab);
          if (!entry) {
            break;
          }
          let space = this.spaces.spaceOf(tab);
          let list = this.listOf(space);
          let order = orderDock(
            list,
            this.tabsIn(space).map(t => this.dockOf(t).id)
          );
          if (!sameDock(order, list)) {
            this.save(withDockList(this.lists, space, order));
          }
        }
        break;
      case "OrbitoSpacesChange":
        // A Space made elsewhere, or gone: its Dock comes or goes.
        this.sync();
        break;
      // A Dock tab reopened (undo close tab) is its entry's tab again: the
      // sync after Session Restore keeps one of the two.
      default:
        super.handleEvent(event);
    }
  }
}
