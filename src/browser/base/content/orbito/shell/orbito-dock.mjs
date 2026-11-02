/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  html,
  nothing,
  repeat,
} from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";
import {
  isMenuKey,
  tabIcon,
} from "chrome://browser/content/orbito/shell/orbito-pins.mjs";
import { ListMotion } from "chrome://browser/content/orbito/shell/motion.mjs";
import { isDockFolder } from "chrome://browser/content/orbito/shell/OrbitoDocks.sys.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

// gBrowser's tab events after which the Dock may look different.
const TAB_EVENTS = [
  "TabOpen",
  "TabClose",
  "TabSelect",
  "TabMove",
  "TabAttrModified",
  "TabShow",
  "TabHide",
  "TabPinned",
  "TabUnpinned",
  // A tab at rest wakes: its browser goes in, its page is restored.
  "TabBrowserInserted",
  "SSTabRestored",
];
// The Shell's own: the Dock lists followed or a folder opened or closed,
// the Space shown changed.
const WINDOW_EVENTS = ["OrbitoDocksChange", "OrbitoSpacesChange"];

// How far a press moves before it becomes a drag.
const DRAG_THRESHOLD = 4;
// How long a dragged Dock tab is held over another before a drop puts the
// two in a folder, and how far from a row's top and bottom the pointer must
// be for that, as the tab list's (orbito-tab-list.mjs).
const HOLD_DELAY = 550;
const HOLD_EDGE = 8;

// Stands in the Dock's rows for the copy of a dragged tab or folder.
const PREVIEW = Symbol("preview");

/**
 * The Dock under the Space's name: a row per Dock tab of the Space shown
 * (OrbitoShell.docks) and per folder, in the Dock's order, with a line
 * under it that sets it apart from the tab list. It slides with the
 * Space's name and tabs. Clicking a row selects its tab, which loads its
 * page if it rests (closed back to where it was docked, or not selected
 * yet; those rows are dimmed). Closing one (its × button) keeps its row:
 * the tab goes back to the docked page, unloaded. A row at rest has a −
 * button instead, which takes it out of the Dock.
 *
 * A folder is a box as the tab list's gray tab groups are (group.css),
 * holding its header and its tabs' rows. Its header opens and closes it
 * (in this window); its tabs' rows show while it is open, and its selected
 * tab's while it is closed. Its × button deletes it with its tabs, as its
 * context menu does, which renames it too (as a double click does) or
 * ungroups it; renaming turns its name into a field: Enter or leaving it
 * keeps the name typed (a blank one keeps the old), Escape the old one.
 *
 * A tab dragged from the tab list onto the Dock is docked there; dragging a
 * row moves it in the Dock, and dropping a tab's row on the tab list
 * undocks it. A Dock tab held over another Dock tab's row for a moment
 * puts the two in a new folder there ("New folder N"), which pops in, or
 * the dragged one in the other's folder. A tab dropped on the middle of a
 * folder's header goes in the folder, at its end; between the rows of an open folder's tabs, in the
 * folder there; elsewhere, out of any. A folder moves at the top of the
 * Dock only. Where a drop would land, a see-through copy of the dragged
 * row takes the place (the folder is marked when it would go in a
 * closed one, its box when it would go in it). The context menu (the menu key or Shift+F10 too) docks and
 * undocks, and puts a tab in a folder or takes it out, as well.
 *
 * The Dock is one tab stop: Up and Down move between rows, Home and End to
 * the first and last, Enter or Space select a tab or open or close a
 * folder; Left closes a folder, or goes from a tab in one to its row;
 * Right opens a folder; F2 renames one.
 *
 * Rows move as the Dock changes (ListMotion): a new one comes in at its
 * place, an undocked one shrinks away and the others slide to theirs; not
 * when another Space's Dock shows.
 */
export class OrbitoDock extends MozLitElement {
  static properties = {
    /**
     * While a tab is dragged from the tab list: {spot, tab}, where the tab
     * would land in the Dock (as dropSpotAt), null when the pointer is not
     * over it. Else null.
     */
    tabDrag: { type: Object },
  };

  static queries = {
    rows: { all: ".list .tab:not([preview])" },
    folders: { all: ".list .group:not([preview])" },
    keyed: { all: ".list [keyed]" },
    field: "input.rename",
    list: ".list",
  };

  // The row the keyboard is on, by its tab or its folder's id; the
  // selected tab's when unset.
  #focusedItem = null;
  // A press on a row that may become a drag, then the drag: the tab or
  // folder id, and where it would land (a spot in the Dock, or the tab
  // list).
  #press = null;
  #drag = null;
  // Where the rows were as the Dock last showed without the copy of a
  // dragged row: {box, rows: [{item, id, in, folder, rect}]}. Drops are
  // placed by these, so that the copy, moving the rows, does not move
  // where a drop lands under the pointer.
  #slots = null;
  // The last spot dropSpotAt gave: the same object while it is the same.
  #spot = null;
  // The folder being renamed.
  #renaming = null;
  // Folders just made by holding a Dock tab over another, which pop in.
  #fresh = new Set();
  // The Space whose Dock shows, for the motion: none on a switch.
  #shownSpace = null;
  #motion = new ListMotion({
    items: () => [...this.keyed].map(row => [row.item, row]),
    root: () => this.list,
    layer: () => this.renderRoot.querySelector(".ghosts"),
    enter: [{ opacity: 0, transform: "scale(0.9)", offset: 0 }],
    exit: [{ opacity: 0, transform: "scale(0.9)", offset: 1 }],
    // A folder made by a drag pops in (group.css).
    entersOwn: el => el.matches(".group[fresh]"),
  });

  constructor() {
    super();
    this.tabDrag = null;
  }

  get docks() {
    return window.OrbitoShell.docks;
  }

  /** The tabs the Dock has: the Space's Dock tabs, in order. */
  get tabs() {
    return this.docks.tabsIn();
  }

  /** Whether a row is being dragged. */
  get dragging() {
    return !!this.#drag;
  }

  /**
   * The rows the Dock shows, in order: {tab, in} for a tab's (in, its
   * folder's id or null), {folder} for a folder's.
   */
  get #shown() {
    let tabs = new Map(this.tabs.map(tab => [this.docks.dockOf(tab).id, tab]));
    let shown = [];
    for (let item of this.docks.listOf()) {
      if (!isDockFolder(item)) {
        if (tabs.has(item.id)) {
          shown.push({ tab: tabs.get(item.id), in: null });
        }
        continue;
      }
      shown.push({ folder: item });
      let open = this.docks.isOpen(item.id);
      for (let entry of item.children) {
        let tab = tabs.get(entry.id);
        if (tab && (open || tab.selected)) {
          shown.push({ tab, in: item.id });
        }
      }
    }
    return shown;
  }

  /** The keys of the rows shown: a tab, or a folder's id. */
  get #items() {
    return this.#shown.map(row => row.tab ?? row.folder.id);
  }

  connectedCallback() {
    super.connectedCallback();
    for (let type of TAB_EVENTS) {
      gBrowser.tabContainer.addEventListener(type, this);
    }
    for (let type of WINDOW_EVENTS) {
      window.addEventListener(type, this);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    for (let type of TAB_EVENTS) {
      gBrowser.tabContainer.removeEventListener(type, this);
    }
    for (let type of WINDOW_EVENTS) {
      window.removeEventListener(type, this);
    }
    this.#endDrag();
  }

  handleEvent(event) {
    switch (event.type) {
      case "pointermove":
        this.#onPointerMove(event);
        break;
      case "pointerup":
        this.#onPointerUp(event);
        break;
      case "pointercancel":
        this.#endDrag();
        break;
      case "keydown":
        // Escape cancels a drag.
        if (event.key == "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.#endDrag();
        }
        break;
      default:
        this.requestUpdate();
    }
  }

  get #rovingItem() {
    let items = this.#items;
    if (items.includes(this.#focusedItem)) {
      return this.#focusedItem;
    }
    return items.includes(gBrowser.selectedTab) ? gBrowser.selectedTab : items[0];
  }

  // The row of an item: a tab's, or the header button of a folder's box.
  #rowFor(item) {
    let row = [...this.keyed].find(el => el.item == item);
    return row?.folder ? row.querySelector(".group-toggle") : row;
  }

  /** Focuses the row the keyboard is on (the Dock is one tab stop). */
  focusRegion() {
    this.#focusItem(this.#rovingItem);
  }

  async #focusItem(item) {
    this.#focusedItem = item;
    this.requestUpdate();
    await this.updateComplete;
    this.#rowFor(item)?.focus({ focusVisible: true });
  }

  #select(tab) {
    gBrowser.selectedTab = tab;
  }

  #close(tab) {
    gBrowser.removeTab(tab, { animate: true });
  }

  /** Turns a folder's name into a field to rename it. */
  async rename(id) {
    if (!this.docks.folder(id) || !this.docks.canAdd) {
      return;
    }
    this.#renaming = id;
    this.#focusedItem = id;
    this.requestUpdate();
    await this.updateComplete;
    this.field?.focus({ focusVisible: true });
    this.field?.select();
  }

  #finishRename(keep) {
    let id = this.#renaming;
    if (!id) {
      return;
    }
    let typed = this.field?.value;
    this.#renaming = null;
    if (keep) {
      this.docks.renameFolder(id, typed);
    }
    this.#focusItem(id);
  }

  #onRenameKeyDown(event) {
    // Keys typed in the field are the field's, not the Dock's.
    event.stopPropagation();
    // Enter or Escape that ends a composition (Korean, say) is the IME's.
    if (event.isComposing) {
      return;
    }
    if (event.key == "Enter") {
      event.preventDefault();
      this.#finishRename(true);
    } else if (event.key == "Escape") {
      event.preventDefault();
      this.#finishRename(false);
    }
  }

  /** The ids of a place in the Dock: its top, or a folder's entries. */
  #idsIn(folder) {
    let items = folder
      ? (this.docks.folder(folder)?.children ?? [])
      : this.docks.listOf();
    return items.map(item => item.id);
  }

  /**
   * Where a drop at a point lands in the Dock, leaving out the dragged row
   * skip (a tab, or a folder's id, which takes its tabs' rows with it):
   * {folder, index, into}, the folder's id (null for the top of the Dock)
   * and the index in it (counted without skip); into when on the middle of
   * a folder's row, for the end of it. Null off the Dock. The same object
   * while the place is the same.
   */
  dropSpotAt(x, y, skip = null) {
    let list = this.list;
    if (!list || !list.checkVisibility()) {
      return null;
    }
    this.#slots ??= {
      box: list.getBoundingClientRect(),
      // A folder by its header.
      rows: [...this.keyed].map(row => ({
        item: row.item,
        id: row.folder ? row.item : this.docks.dockOf(row.item)?.id,
        in: row.in ?? null,
        folder: !!row.folder,
        rect: (row.folder
          ? row.querySelector(".group-head")
          : row
        ).getBoundingClientRect(),
      })),
    };
    // The Dock as it was, and as the copy makes it: a row longer, or with
    // no Dock tab, in its place under the Space's name.
    let was = this.#slots.box;
    let now = list.getBoundingClientRect();
    if (
      x < Math.min(was.left, now.left) ||
      x > Math.max(was.right, now.right) ||
      y < Math.min(was.top, now.top) ||
      y > Math.max(was.bottom, now.bottom)
    ) {
      return null;
    }
    let moving = typeof skip == "string";
    let skipId = moving ? skip : skip && this.docks.dockOf(skip)?.id;
    let rows = this.#slots.rows.filter(
      row => row.item != skip && !(moving && row.in == skip)
    );
    let spot = null;
    for (let row of rows) {
      let { top, height } = row.rect;
      if (
        row.folder &&
        !moving &&
        y >= top + height / 4 &&
        y <= top + (height * 3) / 4
      ) {
        let ids = this.#idsIn(row.id).filter(id => id != skipId);
        spot = { folder: row.id, index: ids.length, into: true };
        break;
      }
      if (y < top + height / 2) {
        // A folder goes before the folder whose tab's row this is.
        let folder = moving ? null : row.in;
        let id = moving && row.in ? row.in : row.id;
        let ids = this.#idsIn(folder).filter(i => i != skipId);
        spot = { folder, index: Math.max(0, ids.indexOf(id)), into: false };
        break;
      }
    }
    spot ??= {
      folder: null,
      index: this.#idsIn(null).filter(id => id != skipId).length,
      into: false,
    };
    let same =
      this.#spot &&
      ["folder", "index", "into"].every(key => this.#spot[key] == spot[key]);
    if (!same) {
      this.#spot = spot;
    }
    return this.#spot;
  }

  /**
   * Where the dragged row would land: {item, spot}, or null. Held over
   * another Dock tab, none shows (a drop before it arms still lands at the
   * spot): the rows stay where the pointer found them.
   */
  get #landing() {
    if (this.#drag) {
      return this.#drag.spot && !this.#drag.hold ? this.#drag : null;
    }
    return this.tabDrag?.spot
      ? { item: this.tabDrag.tab, spot: this.tabDrag.spot }
      : null;
  }

  #onKeyDown(event) {
    let item = this.#rovingItem;
    let folder = typeof item == "string" ? item : null;
    if (isMenuKey(event)) {
      event.preventDefault();
      if (folder) {
        this.docks.openFolderMenu(folder, this.#rowFor(item));
      } else {
        window.OrbitoShell.pins.openMenu(item, this.#rowFor(item));
      }
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    let items = this.#items;
    let index = items.indexOf(item);
    let target;
    switch (event.key) {
      case "ArrowDown":
        target = items[Math.min(index + 1, items.length - 1)];
        break;
      case "ArrowUp":
        target = items[Math.max(index - 1, 0)];
        break;
      case "Home":
        target = items[0];
        break;
      case "End":
        target = items.at(-1);
        break;
      case "ArrowLeft":
        // A folder closes; a tab in one goes to its row.
        if (folder) {
          event.preventDefault();
          this.docks.setOpen(folder, false);
          return;
        }
        target = this.docks.folderOf(item)?.id ?? item;
        break;
      case "ArrowRight":
        if (folder) {
          event.preventDefault();
          this.docks.setOpen(folder, true);
        }
        return;
      case "F2":
        if (folder) {
          event.preventDefault();
          this.rename(folder);
        }
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (folder) {
          this.docks.setOpen(folder);
        } else {
          this.#select(item);
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    this.#focusItem(target);
  }

  // Dragging a row: dropped in the Dock it moves there, a tab's dropped on
  // the tab list is undocked.

  #onPointerDown(event, item) {
    // A private window changes no Dock.
    if (
      event.button != 0 ||
      event.target.closest(".close, .rename") ||
      this.#press ||
      !this.docks.canAdd
    ) {
      return;
    }
    this.#press = { item, x: event.clientX, y: event.clientY };
    window.addEventListener("pointermove", this, true);
    window.addEventListener("pointerup", this, true);
    window.addEventListener("pointercancel", this, true);
    window.addEventListener("keydown", this, true);
  }

  get #tabList() {
    return window.OrbitoShell.sidebar.tabList;
  }

  #onPointerMove(event) {
    if (!this.#drag) {
      let { x, y } = this.#press;
      if (Math.hypot(event.clientX - x, event.clientY - y) < DRAG_THRESHOLD) {
        return;
      }
      this.#drag = {
        item: this.#press.item,
        spot: null,
        undock: false,
        // {tab, armed, timer}: the Dock tab it is held over.
        hold: null,
      };
      this.toggleAttribute("dragging", true);
    }
    let { clientX: x, clientY: y } = event;
    let { item } = this.#drag;
    let spot = this.dropSpotAt(x, y, item);
    this.#holdOver(this.#holdTargetAt(x, y));
    let list = this.#tabList.getBoundingClientRect();
    // A folder is not undocked.
    let undock =
      !spot &&
      typeof item != "string" &&
      x >= list.left &&
      x <= list.right &&
      y >= list.top &&
      y <= list.bottom;
    if (spot != this.#drag.spot || undock != this.#drag.undock) {
      Object.assign(this.#drag, { spot, undock });
      this.#tabList.toggleAttribute("undock-drop", undock);
      this.requestUpdate();
    }
    // Over the tab list, its guide bar shows where the tab would go.
    if (typeof item != "string") {
      this.#drag.landing = this.#tabList.landOutside(item, undock ? y : null);
    }
  }

  /**
   * The Dock tab whose row's middle is at a point (where the rows were
   * without the copy, as dropSpotAt places drops), if the dragged one is a
   * Dock tab that can go in a folder with it: not both in one folder.
   */
  #holdTargetAt(x, y) {
    let item = this.#drag.item;
    if (typeof item == "string" || !this.#slots) {
      return null;
    }
    let row = this.#slots.rows.find(
      ({ folder, rect }) =>
        !folder &&
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top + HOLD_EDGE &&
        y <= rect.bottom - HOLD_EDGE
    );
    let own = this.docks.folderOf(item)?.id;
    if (!row || row.item == item || (own && row.in == own)) {
      return null;
    }
    return row.item;
  }

  // Starts holding over a Dock tab (arming it after HOLD_DELAY), or stops.
  #holdOver(tab) {
    let hold = this.#drag?.hold;
    if (hold?.tab == tab) {
      return;
    }
    clearTimeout(hold?.timer);
    this.#drag.hold = tab
      ? {
          tab,
          armed: false,
          timer: setTimeout(() => {
            if (this.#drag?.hold?.tab == tab) {
              this.#drag.hold.armed = true;
              this.requestUpdate();
            }
          }, HOLD_DELAY),
        }
      : null;
    this.requestUpdate();
  }

  // Puts a Dock tab in a folder with another (docks.groupTabs); a new
  // folder pops in.
  #groupWith(tab, target) {
    let made = this.docks.groupTabs(tab, target);
    if (made?.fresh) {
      this.#fresh.add(made.id);
      setTimeout(() => {
        this.#fresh.delete(made.id);
        this.requestUpdate();
      }, 300);
    }
  }

  #onPointerUp(event) {
    let drag = this.#drag;
    this.#endDrag();
    if (!drag) {
      return;
    }
    // The press ended a drag, not a click on the row.
    let swallow = e => e.stopPropagation();
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    event.preventDefault();
    let { item, spot, undock } = drag;
    if (typeof item == "string") {
      if (spot) {
        this.docks.moveItem(item, spot);
      }
      return;
    }
    if (!item.isConnected || !this.docks.dockOf(item)) {
      return;
    }
    if (drag.hold?.armed) {
      this.#groupWith(item, drag.hold.tab);
      return;
    }
    if (undock) {
      this.docks.undockTab(item);
      if (drag.landing) {
        this.#tabList.dropOutside(item, drag.landing);
      }
      return;
    }
    if (spot) {
      this.docks.moveTab(item, spot);
    }
  }

  #endDrag() {
    clearTimeout(this.#drag?.hold?.timer);
    this.#press = null;
    this.#drag = null;
    this.removeAttribute("dragging");
    this.#tabList?.removeAttribute("undock-drop");
    this.#tabList?.landOutside(null, null);
    window.removeEventListener("pointermove", this, true);
    window.removeEventListener("pointerup", this, true);
    window.removeEventListener("pointercancel", this, true);
    window.removeEventListener("keydown", this, true);
    this.requestUpdate();
  }

  #row(tab, folder, selected, roving) {
    let name = tab.label;
    let resting = this.docks.isResting(tab);
    let hold = this.#drag?.hold?.tab == tab ? this.#drag.hold : null;
    return html`<div
      class="tab"
      keyed
      role="tab"
      aria-label=${name}
      aria-selected=${selected ? "true" : "false"}
      title=${name}
      tabindex=${roving ? "0" : "-1"}
      ?selected=${selected}
      ?resting=${resting}
      ?dragged=${this.#drag?.item == tab}
      hold=${hold ? (hold.armed ? "armed" : "") : nothing}
      hold-hint=${hold?.armed
        ? t(
            folder
              ? "orbito-dock-hold-add-to-folder"
              : "orbito-dock-hold-new-folder"
          )
        : nothing}
      .item=${tab}
      .tab=${tab}
      .in=${folder}
      @mousedown=${event => {
        // As the tab list's rows, a click selects without taking focus.
        if (event.button == 0) {
          event.preventDefault();
        }
      }}
      @pointerdown=${event => this.#onPointerDown(event, tab)}
      @click=${() => this.#select(tab)}
      @auxclick=${event => {
        if (event.button == 1) {
          this.#close(tab);
        }
      }}
      @contextmenu=${event => {
        event.preventDefault();
        window.OrbitoShell.pins.openMenu(tab, event.currentTarget, event);
      }}
      @focus=${() => (this.#focusedItem = tab)}
    >
      ${tabIcon(tab)}
      <span class="label">${name}</span>
      ${resting
        ? html`<button
            class="close"
            remove
            tabindex="-1"
            aria-label=${t("orbito-dock-remove")}
            title=${t("orbito-dock-remove")}
            ?hidden=${!this.docks.canAdd}
            @mousedown=${event => event.preventDefault()}
            @click=${event => {
              event.stopPropagation();
              this.docks.removeResting(tab);
            }}
          ></button>`
        : html`<button
            class="close"
            tabindex="-1"
            aria-label=${t("orbito-tabs-close-tab")}
            title=${t("orbito-dock-close-tab-title")}
            @mousedown=${event => event.preventDefault()}
            @click=${event => {
              event.stopPropagation();
              this.#close(tab);
            }}
          ></button>`}
    </div>`;
  }

  /**
   * A folder's box: its header (the name, which opens and closes it, and
   * the × button) and the rows given, its tabs' (and a copy's).
   */
  #folderBox(folder, rows, roving, dropInto, rowOf) {
    let name = this.docks.folderName(folder);
    let open = this.docks.isOpen(folder.id);
    let renaming = this.#renaming == folder.id;
    let count = folder.children.length;
    let inField = event => event.target.closest(".rename, .close");
    return html`<div
      class="group"
      keyed
      role="group"
      aria-label=${name}
      ?collapsed=${!open}
      ?fresh=${this.#fresh.has(folder.id)}
      ?dragged=${this.#drag?.item == folder.id}
      ?drop-into=${dropInto}
      .item=${folder.id}
      .folder=${folder}
    >
      <div
        class="group-head"
        @mousedown=${event => {
          if (event.button == 0 && !event.target.closest(".rename")) {
            event.preventDefault();
          }
        }}
        @pointerdown=${event => this.#onPointerDown(event, folder.id)}
        @click=${event => {
          if (!inField(event)) {
            this.docks.setOpen(folder.id);
          }
        }}
        @dblclick=${event => {
          if (!inField(event)) {
            this.rename(folder.id);
          }
        }}
        @contextmenu=${event => {
          event.preventDefault();
          this.docks.openFolderMenu(
            folder.id,
            event.currentTarget.querySelector(".group-toggle"),
            event
          );
        }}
      >
        <div
          class="group-toggle"
          role="button"
          aria-expanded=${open ? "true" : "false"}
          aria-label=${name}
          title=${t("orbito-dock-folder-title", { name, count })}
          tabindex=${roving ? "0" : "-1"}
          @focus=${() => (this.#focusedItem = folder.id)}
        >
          <span class="dot"></span>
          ${renaming
            ? html`<input
                class="rename"
                aria-label=${t("orbito-dock-folder-name")}
                maxlength="60"
                .value=${folder.title}
                @keydown=${this.#onRenameKeyDown}
                @blur=${() => this.#finishRename(true)}
              />`
            : html`<span class="label">${name}</span>`}
          <span class="chevron"></span>
          <span class="count" aria-hidden="true">${count}</span>
        </div>
        <button
          class="close"
          tabindex="-1"
          aria-label=${t("orbito-dock-folder-delete")}
          title=${t("orbito-dock-folder-delete")}
          ?hidden=${!this.docks.canAdd}
          @mousedown=${event => event.preventDefault()}
          @click=${() => this.docks.deleteFolder(folder.id)}
        ></button>
      </div>
      ${rows.length
        ? html`<div class="group-body">
            ${repeat(rows, row => row.preview ? PREVIEW : row.tab, rowOf)}
          </div>`
        : nothing}
    </div>`;
  }

  // The see-through copy of a dragged row, where it would land: a tab's, or
  // a folder's box with its header only.
  #preview(item) {
    if (typeof item == "string") {
      let folder = this.docks.folder(item);
      return html`<div
        class="group"
        preview
        ?collapsed=${!this.docks.isOpen(item)}
        aria-hidden="true"
      >
        <div class="group-head">
          <div class="group-toggle">
            <span class="dot"></span>
            <span class="label"
              >${folder ? this.docks.folderName(folder) : ""}</span
            >
            <span class="chevron"></span>
          </div>
        </div>
      </div>`;
    }
    return html`<div class="tab" preview aria-hidden="true">
      ${tabIcon(item)}
      <span class="label">${item.label}</span>
    </div>`;
  }

  /**
   * The rows to show, with the copy of a dragged row where it would land:
   * before the row of the item at the spot, or after the last row of its
   * place; none in a closed folder, whose row is marked instead.
   */
  #withPreview(shown, landing) {
    if (!landing) {
      return shown;
    }
    let { item, spot } = landing;
    let { folder } = spot;
    if (folder && !this.docks.isOpen(folder)) {
      return shown;
    }
    let skipId =
      typeof item == "string" ? item : this.docks.dockOf(item)?.id;
    let ids = this.#idsIn(folder).filter(id => id != skipId);
    let before = ids[spot.index];
    let rowId = row => (row.folder ? row.folder.id : this.docks.dockOf(row.tab)?.id);
    let at = before ? shown.findIndex(row => rowId(row) == before) : -1;
    if (at == -1) {
      // At the end of the place: after its last row.
      at = folder
        ? shown.findLastIndex(row => row.in == folder || row.folder?.id == folder) + 1
        : shown.length;
    }
    let rows = [...shown];
    rows.splice(at, 0, { preview: item, in: folder });
    return rows;
  }

  /**
   * The rows to show as the Dock lays them out: a tab's (or a copy's) at
   * the top, or a folder's box {folder, rows} with its tabs' (and a
   * copy's) in it.
   */
  #blocks(rows) {
    let blocks = [];
    let boxes = new Map();
    for (let row of rows) {
      if (row.folder) {
        let box = { folder: row.folder, rows: [] };
        boxes.set(row.folder.id, box);
        blocks.push(box);
      } else if (row.in && boxes.has(row.in)) {
        boxes.get(row.in).rows.push(row);
      } else {
        blocks.push(row);
      }
    }
    return blocks;
  }

  willUpdate() {
    this.#motion.capture(this.#shownSpace);
  }

  updated() {
    // With no Dock tab or folder, the Dock takes no room; while a tab is
    // dragged it keeps a small invisible strip to drop on
    // (orbito-dock.css), until the copy of the tab shows where it would
    // land.
    this.toggleAttribute("empty", !this.docks.listOf().length);
    this.toggleAttribute("dropping", !!this.tabDrag);
    this.toggleAttribute("landing", !!this.#landing);
    // Measured again as they show now; not while a Dock tab is held over
    // another, whose rows slide back from the copy as they were measured.
    if (!this.#landing && !this.#drag?.hold) {
      this.#slots = null;
      this.#spot = null;
    }
    this.#motion.play(this.#shownSpace);
  }

  render() {
    this.#shownSpace = window.OrbitoShell.spaces?.current;
    if (this.#renaming && !this.docks.listOf().some(i => i.id == this.#renaming)) {
      // Gone, or another Space is shown now.
      this.#renaming = null;
    }
    let selectedTab = gBrowser.selectedTab;
    let rovingItem = this.#rovingItem;
    let landing = this.#landing;
    let into = landing?.spot.into ? landing.spot.folder : null;
    let rows = this.#withPreview(this.#shown, landing);
    let rowOf = row =>
      row.preview
        ? this.#preview(row.preview)
        : this.#row(
            row.tab,
            row.in,
            row.tab == selectedTab,
            row.tab == rovingItem
          );
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/orbito/shell/orbito-dock.css"
      />
      <div
        class="list"
        role="tablist"
        aria-orientation="vertical"
        aria-label=${t("orbito-dock-list")}
        ?dropping=${!!this.tabDrag}
        @keydown=${this.#onKeyDown}
      >
        ${repeat(
          this.#blocks(rows),
          block => (block.preview ? PREVIEW : (block.tab ?? block.folder.id)),
          block =>
            block.folder
              ? this.#folderBox(
                  block.folder,
                  block.rows,
                  block.folder.id == rovingItem,
                  block.folder.id == into,
                  rowOf
                )
              : rowOf(block)
        )}
      </div>
      <div class="separator"></div>
      <div class="ghosts" aria-hidden="true"></div>
    `;
  }
}
customElements.define("orbito-dock", OrbitoDock);
