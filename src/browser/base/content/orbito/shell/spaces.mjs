/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Spaces in a window. The Space list is the profile's (OrbitoShellStore,
 * the same in every window); each tab is in one Space, kept as a session
 * tab value; each window shows one Space, kept as a session window value,
 * so two windows can show different ones. Tabs in the other Spaces are
 * hidden in gBrowser (hideTab), which keeps them out of the tab list, the
 * tab switching keys and "close other tabs". Pinned tabs are in no Space
 * and show in all of them.
 *
 * A new tab goes in the Space the window shows. Selecting a tab of another
 * Space (an agent's tool, a "switch to tab" result, reopening a closed tab)
 * switches to that Space. A Space never shows empty: switching to one with
 * no tab, or closing its last, opens a new tab in it.
 *
 * A tab group is in one Space: moving one of its tabs to another Space
 * moves the group with all its tabs, and a tab put in a group goes to the
 * group's Space.
 *
 * A Space being removed (OrbitoAssistantCore.removeSpace()) is no longer
 * shown, here or in any window, but its tabs stay, hidden, until its undo
 * time is up; then it leaves the list and they close.
 *
 * Keys: ⌃1 to ⌃9 (Ctrl+Alt+1 to 9 off macOS) go to that Space, ⌥⌘← and ⌥⌘→
 * (Ctrl+Alt+← and →) to the previous and next one. Changes are told by
 * events on the window: OrbitoSpacesChange (the list, the Space shown, the
 * undo offer, a rename asked for: detail.rename) and OrbitoSpaceSwitch
 * (detail.direction: 1 to a later Space, -1 to an earlier one, for the
 * Sidebar's slide).
 */

import {
  addSpace,
  checkSpaces,
  removedSpaces,
  removeSpace,
  renameSpace,
  resolveSpace,
  spaceAt,
  stepSpace,
  switchDirection,
} from "chrome://browser/content/orbito/shell/OrbitoSpaces.sys.mjs";

// Through the shared module loader: one store for every window (a static
// import would load a copy into each).
const { OrbitoShellStore, STORE_CHANGED } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/shell/OrbitoShellStore.sys.mjs"
);
const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  OrbitoAssistantCore:
    "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs",
  OrbitoPages: "chrome://browser/content/orbito/OrbitoPages.sys.mjs",
});

/** The store key of the Space list. */
const LIST_KEY = "spaces";
/** The session value holding a tab's Space and a window's. */
const SPACE_VALUE = "orbitoSpace";
/** What hideTab is told hid a tab, so other hidden tabs stay hidden. */
const HIDDEN_BY = "orbito-space";
/** How long a new Space can be taken back, in ms. */
export const UNDO_TIME = 5000;

const TAB_EVENTS = [
  "TabOpen",
  "TabSelect",
  "TabClose",
  "TabUnpinned",
  "TabGrouped",
  "SSTabRestoring",
];
const WINDOW_EVENTS = [
  "SSWindowStateBusy",
  "SSWindowStateReady",
  "keydown",
  "keypress",
];

const newId = () => crypto.randomUUID();

export class Spaces {
  /** The profile's Spaces shown, in order: [{id, name}]. */
  list = [];
  /** Every Space in the profile's list, those being removed too. */
  all = [];
  /** The id of the Space this window shows. */
  current = null;
  /** While Session Restore fills the window, tabs come in any order. */
  #restoring = false;
  /**
   * The Space just made, or removed here, while it can be taken back:
   * {space, back, removed, timer}, back the Space to show again.
   */
  #undo = null;
  /** The Space menu, once made, and the Space it was opened for. */
  #menu = null;
  #menuSpace = null;
  /** The tab switch just made: {from}, the tab selected before. */
  #lastSelect = null;

  // Held weakly by the observer service, so a closed window does not leak.
  #observer = {
    observe: (subject, topic, key) => {
      if (key == LIST_KEY) {
        this.#listChanged();
      }
    },
    QueryInterface: ChromeUtils.generateQI([
      "nsIObserver",
      "nsISupportsWeakReference",
    ]),
  };

  init() {
    this.#setList(this.#readList());
    this.current = resolveSpace(this.list, this.#windowValue());
    Services.obs.addObserver(this.#observer, STORE_CHANGED, true);
    for (let type of TAB_EVENTS) {
      gBrowser.tabContainer.addEventListener(type, this);
    }
    for (let type of WINDOW_EVENTS) {
      window.addEventListener(type, this, true);
    }
    window.addEventListener(
      "unload",
      () => {
        Services.obs.removeObserver(this.#observer, STORE_CHANGED);
        clearTimeout(this.#undo?.timer);
      },
      { once: true }
    );
    this.#showCurrent();
  }

  /** The Space this window shows: {id, name}. */
  get currentSpace() {
    return this.list.find(space => space.id == this.current);
  }

  /**
   * The Space just made, or removed here, while it can still be taken
   * back, or null.
   */
  get undoable() {
    return this.#undo?.space ?? null;
  }

  /** Whether the Space that can be taken back was removed, not made. */
  get undoRemoved() {
    return !!this.#undo?.removed;
  }

  /** The id of the Space a tab is in; null for a pinned tab. */
  spaceOf(tab) {
    if (tab.pinned) {
      return null;
    }
    let id = SessionStore.getCustomTabValue(tab, SPACE_VALUE);
    if (!this.all.some(space => space.id == id)) {
      // New to the Shell (opened before it, or in a session from before
      // Spaces), or its Space is gone: it joins the one shown.
      id = this.current;
      SessionStore.setCustomTabValue(tab, SPACE_VALUE, id);
    }
    return id;
  }

  /** The open tabs in a Space, pinned ones aside. */
  tabsIn(id) {
    return gBrowser.tabs.filter(
      tab => !tab.closing && !tab.pinned && this.spaceOf(tab) == id
    );
  }

  /**
   * The tabs in a Space that switching to it or closing a tab may select:
   * not the Dock tabs at rest, whose pages load only once picked
   * (shell/docks.mjs).
   */
  #awakeTabsIn(id) {
    let docks = window.OrbitoShell?.docks;
    return this.tabsIn(id).filter(tab => !docks?.isResting(tab));
  }

  /**
   * Puts a tab in a Space, which may hide it. A tab in a group takes the
   * group with it.
   */
  moveTab(tab, id) {
    this.#moveTabs(tab.group ? tab.group.tabs : [tab], id);
  }

  /** Puts a tab group in a Space, with all its tabs. */
  moveGroup(group, id) {
    this.#moveTabs(group.tabs, id);
  }

  #moveTabs(tabs, id) {
    tabs = tabs.filter(tab => !tab.pinned && !tab.closing);
    if (!tabs.length || !this.list.some(space => space.id == id)) {
      return;
    }
    for (let tab of tabs) {
      SessionStore.setCustomTabValue(tab, SPACE_VALUE, id);
    }
    if (tabs.some(tab => tab.selected) && id != this.current) {
      this.switchTo(id);
    } else {
      this.#showCurrent();
    }
  }

  /** Renames a Space in every window; a blank name keeps the old one. */
  rename(id, newName) {
    let spaces = checkSpaces(OrbitoShellStore.get(LIST_KEY), newId);
    let renamed = renameSpace(spaces, id, newName);
    if (renamed != spaces) {
      OrbitoShellStore.set(LIST_KEY, renamed);
    }
  }

  /**
   * Asks the Space's name to be typed in its title: the window shows it
   * first.
   */
  startRename(id) {
    this.switchTo(id);
    window.dispatchEvent(
      new CustomEvent("OrbitoSpacesChange", { detail: { rename: this.current } })
    );
  }

  /**
   * Removes a Space from every window (see
   * OrbitoAssistantCore.removeSpace()), the rest going to the Space to, or
   * with to null deleted with it. For a few seconds it can be taken back
   * from here (undo()), which shows it again if this window showed it. The
   * last Space shown is never removed.
   */
  remove(id, { to = null } = {}) {
    let space = this.list.find(s => s.id == id);
    if (!space || this.list.length < 2) {
      return;
    }
    let back = this.current == id ? id : null;
    this.#endUndo();
    lazy.OrbitoAssistantCore.removeSpace(id, { to });
    this.#undo = {
      space,
      back,
      removed: true,
      timer: setTimeout(() => {
        this.#endUndo();
        this.#changed();
      }, UNDO_TIME),
    };
    this.#changed();
  }

  /** Takes back the Space just made or removed here. */
  undo() {
    let undo = this.#undo;
    if (!undo?.removed) {
      this.undoCreate();
      return;
    }
    this.#endUndo();
    lazy.OrbitoAssistantCore.undoRemoveSpace(undo.space.id);
    if (undo.back) {
      this.switchTo(undo.back);
    }
    this.#changed();
  }

  /** Whether a Space can be removed: not the last one shown. */
  canRemove(id) {
    return this.list.length > 1 && this.list.some(space => space.id == id);
  }

  /**
   * The Space menu, made on first use: rename, the Space's settings and
   * removing it (which the switcher asks about first). Native on macOS, as
   * other context menus.
   */
  get menu() {
    if (!this.#menu) {
      let menu = document.createXULElement("menupopup");
      menu.id = "orbito-space-menu";
      for (let [id, label, run] of [
        ["rename", "orbito-spaces-menu-rename", space => this.startRename(space)],
        [
          "settings",
          "orbito-spaces-menu-settings",
          space => lazy.OrbitoPages.openSpaceSettings(window, space),
        ],
        [
          "remove",
          "orbito-spaces-menu-remove",
          space =>
            document
              .getElementById("orbito-space-switcher")
              ?.confirmRemove(space),
        ],
      ]) {
        let item = document.createXULElement("menuitem");
        item.id = `orbito-space-menu-${id}`;
        item.setAttribute("label", t(label));
        item.addEventListener("command", () => {
          if (this.all.some(space => space.id == this.#menuSpace)) {
            run(this.#menuSpace);
          }
        });
        menu.append(item);
      }
      document.getElementById("mainPopupSet").append(menu);
      this.#menu = menu;
    }
    return this.#menu;
  }

  /**
   * Opens the Space menu for a Space: at the pointer for a click, else
   * under the element standing for it (a key press).
   *
   * @param {string} id
   * @param {Element} anchor
   * @param {Event} [event]
   */
  openMenu(id, anchor, event = null) {
    let menu = this.menu;
    menu.querySelector("#orbito-space-menu-remove").disabled =
      !this.canRemove(id);
    this.#menuSpace = id;
    if (event?.type == "contextmenu" && (event.screenX || event.screenY)) {
      menu.openPopupAtScreen(event.screenX, event.screenY, true, event);
    } else {
      menu.openPopup(anchor, "after_start", 0, 0, true, false, event);
    }
  }

  /**
   * The tab menu's items to move a tab, or the group it is in, to another
   * Space shown.
   *
   * @param {Pins} pins Whose tab menu gets them.
   */
  addMenuItems(pins) {
    pins.addMenu({
      id: "orbito-tab-menu-space",
      label: tab =>
        t(tab.group ? "orbito-spaces-move-group" : "orbito-spaces-move-tab"),
      shows: tab =>
        !tab.pinned &&
        !window.OrbitoShell?.docks?.dockOf(tab) &&
        this.list.length > 1,
      items: tab =>
        this.list
          .filter(space => space.id != this.spaceOf(tab))
          .map(space => ({ value: space.id, label: space.name })),
      run: (tab, id) => this.moveTab(tab, id),
    });
  }

  /**
   * Shows a Space in this window: selects the tab last used in it (unless
   * a pinned tab is selected, which stays), or a new tab, and hides the
   * others.
   */
  switchTo(id) {
    id = resolveSpace(this.list, id);
    if (id == this.current) {
      return;
    }
    let direction = switchDirection(this.list, this.current, id);
    this.current = id;
    this.#saveWindowValue();
    let selected = gBrowser.selectedTab;
    if (!selected.pinned && this.spaceOf(selected) != id) {
      let tabs = this.#awakeTabsIn(id);
      gBrowser.selectedTab = tabs.length
        ? tabs.reduce((a, b) => (b.lastAccessed > a.lastAccessed ? b : a))
        : this.#openTab();
    }
    this.#showCurrent();
    window.dispatchEvent(
      new CustomEvent("OrbitoSpaceSwitch", { detail: { direction } })
    );
    this.#changed();
  }

  /** Shows the nth Space (from 1), if there is one. */
  switchToNth(n) {
    let id = spaceAt(this.list, n);
    if (id) {
      this.switchTo(id);
    }
  }

  /** Shows the next Space (step 1) or the previous one (-1), going round. */
  step(step) {
    this.switchTo(stepSpace(this.list, this.current, step));
  }

  /**
   * Makes a Space at the end of the list and shows it. For a few seconds
   * it can be taken back (undoCreate). Does nothing once there are nine.
   */
  create() {
    // Named in the app's language when made; the stored name stays as is.
    let added = addSpace(this.all, newId(), number =>
      t("orbito-spaces-default-name", { number })
    );
    if (!added) {
      return null;
    }
    let back = this.current;
    this.#endUndo();
    OrbitoShellStore.set(LIST_KEY, added.spaces);
    this.switchTo(added.space.id);
    this.#undo = {
      space: added.space,
      back,
      timer: setTimeout(() => {
        this.#endUndo();
        this.#changed();
      }, UNDO_TIME),
    };
    this.#changed();
    return added.space;
  }

  /**
   * Takes back the Space just made, with its tabs in every window: back to
   * the Space shown before it.
   */
  undoCreate() {
    let undo = this.#undo;
    if (!undo) {
      return;
    }
    this.#endUndo();
    if (this.current == undo.space.id) {
      this.switchTo(undo.back);
    }
    OrbitoShellStore.set(LIST_KEY, removeSpace(this.all, undo.space.id));
  }

  #endUndo() {
    clearTimeout(this.#undo?.timer);
    this.#undo = null;
  }

  #changed() {
    window.dispatchEvent(new CustomEvent("OrbitoSpacesChange"));
  }

  /**
   * Takes the profile's list: all of it, and shown, the Spaces not being
   * removed.
   */
  #setList(spaces) {
    this.all = spaces;
    let removing = new Set(lazy.OrbitoAssistantCore.removingSpaces());
    let shown = spaces.filter(space => !removing.has(space.id));
    this.list = shown.length ? shown : spaces;
  }

  #readList() {
    let stored = OrbitoShellStore.get(LIST_KEY);
    let spaces = checkSpaces(stored, newId);
    // The first Space is made once, for every window.
    if (JSON.stringify(spaces) != JSON.stringify(stored)) {
      OrbitoShellStore.set(LIST_KEY, spaces);
    }
    return spaces;
  }

  /**
   * Another window (or this one) changed the list: a Space that is gone
   * takes its tabs with it, and the window shows another if it showed it or
   * the one being removed, the one before it if it can.
   */
  #listChanged() {
    let next = checkSpaces(OrbitoShellStore.get(LIST_KEY), newId);
    let gone = removedSpaces(this.all, next);
    let all = this.all;
    // Still with every Space of the old list, so that the going tabs are in
    // their Space (hidden, not selected) until they close.
    this.#setList(next);
    this.all = all;
    if (!this.list.some(space => space.id == this.current)) {
      let index = all.findIndex(space => space.id == this.current);
      let shown = new Set(this.list.map(space => space.id));
      let before = all
        .slice(0, Math.max(index, 0))
        .findLast(space => shown.has(space.id));
      this.switchTo((before ?? this.list[0]).id);
    }
    if (gone.length) {
      gBrowser.removeTabs(
        gBrowser.tabs.filter(
          tab => !tab.pinned && gone.includes(this.spaceOf(tab))
        ),
        { animate: false, skipPermitUnload: true, skipSessionStore: true }
      );
    }
    // The Space that could be taken back is gone, or back from elsewhere.
    let undone = this.#undo?.space.id;
    if (
      gone.includes(undone) ||
      (this.#undo?.removed && this.list.some(space => space.id == undone))
    ) {
      this.#endUndo();
    }
    this.#setList(next);
    this.current = resolveSpace(this.list, this.current);
    this.#showCurrent();
    this.#changed();
  }

  #windowValue() {
    try {
      return SessionStore.getCustomWindowValue(window, SPACE_VALUE);
    } catch {
      // Not yet known to Session Restore.
      return "";
    }
  }

  #saveWindowValue() {
    try {
      SessionStore.setCustomWindowValue(window, SPACE_VALUE, this.current);
    } catch {
      // Not yet known to Session Restore; saved on the next switch.
    }
  }

  /**
   * A new tab for a Space that has none. It leaves focus where it is (a new
   * tab page would take it to the urlbar, which opens the Command bar).
   */
  #openTab() {
    let tab = gBrowser.addTrustedTab(BROWSER_NEW_TAB_URL);
    gURLBar.getBrowserState(tab.linkedBrowser).urlbarFocused = false;
    return tab;
  }

  /** Shows the tabs in the current Space, hides the others'. */
  #showCurrent() {
    for (let tab of gBrowser.tabs) {
      if (tab.pinned || tab.closing) {
        continue;
      }
      if (this.spaceOf(tab) == this.current) {
        let hiddenBy = SessionStore.getCustomTabValue(tab, "hiddenBy");
        if (tab.hidden && (!hiddenBy || hiddenBy == HIDDEN_BY)) {
          gBrowser.showTab(tab);
        }
      } else if (!tab.hidden) {
        gBrowser.hideTab(tab, HIDDEN_BY);
      }
    }
  }

  /** After Session Restore: the window's Space, or the selected tab's. */
  #restored() {
    this.current = resolveSpace(this.list, this.#windowValue());
    let selected = gBrowser.selectedTab;
    if (!selected.pinned) {
      this.current = this.spaceOf(selected);
    }
    this.#saveWindowValue();
    this.#showCurrent();
    this.#changed();
  }

  /** The tab's Space is the one shown, or it shows that Space. */
  #follow(tab) {
    let id = this.spaceOf(tab);
    if (tab.selected && id && id != this.current) {
      this.switchTo(id);
    } else {
      this.#showCurrent();
    }
  }

  /**
   * A tab of the current Space is closing and Firefox found no other in it
   * to show, or only Dock tabs at rest: one opens in its place. (With no
   * tab left in the window at all, Firefox has already opened one.)
   */
  #closing(tab) {
    if (
      tab.pinned ||
      SessionStore.getCustomTabValue(tab, SPACE_VALUE) != this.current ||
      this.#awakeTabsIn(this.current).length
    ) {
      return;
    }
    let opened = this.#openTab();
    // Selected, or Firefox has just selected a pinned tab in its place.
    if (tab.selected || this.#lastSelect?.from == tab) {
      gBrowser.selectedTab = opened;
    }
  }

  /** The Space a key press asks for: a number, a step, or null. */
  #keyFor(event) {
    if (event.isComposing || event.shiftKey) {
      return null;
    }
    let mac = AppConstants.platform == "macosx";
    let digits = mac
      ? event.ctrlKey && !event.altKey && !event.metaKey
      : event.ctrlKey && event.altKey && !event.metaKey;
    let arrows = mac
      ? event.metaKey && event.altKey && !event.ctrlKey
      : event.ctrlKey && event.altKey && !event.metaKey;
    // Off macOS, Ctrl+Alt is also AltGr, which types characters on some
    // keyboards ({ on a German one's 7): only a digit counts.
    if (
      digits &&
      /^Digit[1-9]$/.test(event.code) &&
      (mac || /^[1-9]$/.test(event.key)) &&
      !event.getModifierState("AltGraph")
    ) {
      let n = Number(event.code.slice(5));
      return spaceAt(this.list, n) ? { n } : null;
    }
    if (arrows && (event.key == "ArrowLeft" || event.key == "ArrowRight")) {
      let rtl = document.dir == "rtl";
      return { step: (event.key == "ArrowRight") != rtl ? 1 : -1 };
    }
    return null;
  }

  handleEvent(event) {
    switch (event.type) {
      case "keydown": {
        let key = this.#keyFor(event);
        if (key) {
          event.preventDefault();
          event.stopPropagation();
          if (key.n) {
            this.switchToNth(key.n);
          } else {
            this.step(key.step);
          }
        }
        break;
      }
      case "keypress":
        // Firefox takes ⌥⌘← and ⌥⌘→ to the previous and next tab on
        // keypress.
        if (this.#keyFor(event)) {
          event.preventDefault();
          event.stopPropagation();
        }
        break;
      case "TabOpen":
        if (!SessionStore.getCustomTabValue(event.target, SPACE_VALUE)) {
          SessionStore.setCustomTabValue(
            event.target,
            SPACE_VALUE,
            this.current
          );
        }
        break;
      case "TabGrouped": {
        // Put in a group, a tab goes to the group's Space.
        let tab = event.detail;
        let other = tab.group?.tabs.find(
          member => member != tab && !member.closing
        );
        if (!this.#restoring && other && !other.pinned) {
          let id = this.spaceOf(other);
          if (this.spaceOf(tab) != id) {
            this.#moveTabs([tab], id);
          }
        }
        break;
      }
      case "TabUnpinned":
        // Back from every Space into the one shown.
        SessionStore.setCustomTabValue(
          event.target,
          SPACE_VALUE,
          this.current
        );
        break;
      case "TabSelect":
        // Only for a TabClose in the same task: closing a selected tab
        // selects another first.
        this.#lastSelect = { from: event.detail.previousTab };
        queueMicrotask(() => (this.#lastSelect = null));
      // Falls through.
      case "SSTabRestoring":
        if (!this.#restoring) {
          this.#follow(event.target);
        }
        break;
      case "TabClose":
        if (!this.#restoring && !event.detail?.adoptedBy) {
          this.#closing(event.target);
        }
        break;
      case "SSWindowStateBusy":
        this.#restoring = true;
        break;
      case "SSWindowStateReady":
        this.#restoring = false;
        this.#restored();
        break;
    }
  }
}
