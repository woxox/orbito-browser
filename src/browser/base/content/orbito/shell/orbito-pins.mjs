/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, repeat } from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";
import { ORBITO_LOGO } from "chrome://browser/content/orbito/shell/orbito-logo.mjs";
import { ListMotion } from "chrome://browser/content/orbito/shell/motion.mjs";
import {
  pressWithoutFocus,
  SidebarDrag,
  TearOff,
} from "chrome://browser/content/orbito/shell/tear-off.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const DEFAULT_ICON = "chrome://global/skin/icons/defaultFavicon.svg";

// gBrowser's tab events after which the grid may look different.
const TAB_EVENTS = [
  "TabOpen",
  "TabClose",
  "TabSelect",
  "TabMove",
  "TabAttrModified",
  "TabPinned",
  "TabUnpinned",
];

/** Pins in a row of the grid. */
export const PIN_COLUMNS = 4;

// Stands in the grid's items for the copy of a dragged tab.
const PREVIEW = Symbol("preview");

/**
 * A tab's icon in the Sidebar, as the class "icon": its favicon, or for an
 * about: page the Orbito tile, Orbito's mark on the accent (the
 * component's stylesheet styles .orbito-tile).
 */
export function tabIcon(tab) {
  if (tab.linkedBrowser?.currentURI?.schemeIs("about")) {
    return html`<span class="icon orbito-tile">${ORBITO_LOGO}</span>`;
  }
  return html`<img
    class="icon"
    src=${gBrowser.getIcon(tab) || DEFAULT_ICON}
    alt=""
  />`;
}

// The arrow a Pin's or Dock tab's icon turns into to go back (entryIcon), as
// the Top bar's back button's.
const BACK_ARROW = html`<svg class="arrow" viewBox="0 0 16 16" aria-hidden="true">
  <path d="M10 3 5 8l5 5" />
</svg>`;

/**
 * A Pin's or Dock tab's icon in the Sidebar (tabIcon), which is a button
 * back to the entry's URL once the tab has gone from it (list, the window's
 * Pins or Docks, says so): the icon turns into a back arrow under the
 * pointer. A press on it selects no tab and starts no drag.
 */
export function entryIcon(tab, list) {
  if (!list.isAway(tab)) {
    return tabIcon(tab);
  }
  let label = t("orbito-saved-page-reset");
  return html`<button
    class="back"
    tabindex="-1"
    aria-label=${label}
    title=${label}
    @mousedown=${event => event.preventDefault()}
    @click=${event => {
      event.stopPropagation();
      list.resetTab(tab);
    }}
  >
    ${tabIcon(tab)}${BACK_ARROW}
  </button>`;
}

/**
 * Whether a key press opens the context menu: the menu key, or Shift+F10
 * (which macOS does not turn into a contextmenu event by itself).
 */
export function isMenuKey(event) {
  return (
    event.key == "ContextMenu" ||
    (event.key == "F10" &&
      event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey)
  );
}

/**
 * The Pin grid at the top of the Sidebar, the same in every Space: a button
 * per pinned tab of the window (OrbitoShell.pins), four to a row, in
 * gBrowser's order. A click selects the tab, which loads its page the first
 * time. Dragging a Pin (with the platform's drag and drop, which draws it
 * under the pointer) moves it; dropping it on the tab list unpins it,
 * dropping it on another Orbito window moves its tab there, and letting it
 * go where no window takes it opens it in a new one (shell/tear-off.mjs).
 * A tab dragged from the tab list onto the grid becomes a Pin. Where a drop would land, a see-through copy of the dragged
 * tab takes the slot. The context menu (the menu key or Shift+F10 too)
 * unpins. A Pin whose tab has gone from the Pin's URL has its icon as a
 * button back there (entryIcon); its menu goes back too, or makes the page
 * the Pin's.
 *
 * The grid is one tab stop: the arrow keys move between Pins (Up and Down by
 * a row), Home and End to the first and last, Enter or Space select.
 *
 * Pins move as the grid changes (ListMotion): a new one comes in at its
 * place, an unpinned one shrinks away and the others slide to theirs.
 */
export class OrbitoPins extends MozLitElement {
  static properties = {
    /**
     * While a tab is dragged from the tab list: {index, tab}, where the tab
     * would land in the grid, -1 when the pointer is not over it. Else null.
     */
    tabDrag: { type: Object },
  };

  static queries = {
    buttons: { all: ".grid .pin:not([preview])" },
    grid: ".grid",
  };

  // The Pin the keyboard is on, by its tab; the selected one when unset.
  #focusedTab = null;
  // The drag of a Pin: the tab, where it would land (before or after a
  // Pin's tab, or the tab list), and its SidebarDrag.
  #drag = null;
  // Where the Pins were as the grid last showed without the copy of a
  // dragged tab: {box, pins: [{tab, rect}]}. Drops are placed by
  // these, so that the copy, moving the Pins, does not move where a drop
  // lands under the pointer.
  #slots = null;
  #motion = new ListMotion({
    items: () => [...this.buttons].map(button => [button.tab, button]),
    root: () => this.grid,
    layer: () => this.renderRoot.querySelector(".ghosts"),
    enter: [{ opacity: 0, transform: "scale(0.6)", offset: 0 }],
    exit: [{ opacity: 0, transform: "scale(0.6)", offset: 1 }],
  });

  constructor() {
    super();
    this.tabDrag = null;
  }

  get pins() {
    return window.OrbitoShell.pins;
  }

  /** The tabs the grid shows: the window's pinned tabs, in order. */
  get tabs() {
    return this.pins.tabs;
  }

  /** Whether a Pin is being dragged. */
  get dragging() {
    return !!this.#drag;
  }

  connectedCallback() {
    super.connectedCallback();
    for (let type of TAB_EVENTS) {
      gBrowser.tabContainer.addEventListener(type, this);
    }
    window.addEventListener("OrbitoPinsChange", this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    for (let type of TAB_EVENTS) {
      gBrowser.tabContainer.removeEventListener(type, this);
    }
    window.removeEventListener("OrbitoPinsChange", this);
    this.#endDrag();
  }

  handleEvent(event) {
    switch (event.type) {
      default:
        this.requestUpdate();
    }
  }

  get #rovingTab() {
    let tabs = this.tabs;
    if (tabs.includes(this.#focusedTab)) {
      return this.#focusedTab;
    }
    return tabs.includes(gBrowser.selectedTab) ? gBrowser.selectedTab : tabs[0];
  }

  #buttonFor(tab) {
    return [...this.buttons].find(button => button.tab == tab);
  }

  focusRegion() {
    this.#focusTab(this.#rovingTab);
  }

  async #focusTab(tab) {
    this.#focusedTab = tab;
    this.requestUpdate();
    await this.updateComplete;
    this.#buttonFor(tab)?.focus({ focusVisible: true });
  }

  #select(tab) {
    gBrowser.selectedTab = tab;
  }

  /**
   * Where a drop at a point lands in the grid: the index of the Pin it
   * goes before (the number of Pins for after the last), leaving out the
   * tab skip; -1 off the grid.
   */
  dropIndexAt(x, y, skip = null) {
    let grid = this.grid;
    if (!grid) {
      return -1;
    }
    this.#slots ??= {
      box: grid.getBoundingClientRect(),
      pins: [...this.buttons].map(button => ({
        tab: button.tab,
        rect: button.getBoundingClientRect(),
      })),
    };
    // The grid as it was, and as the copy makes it: one row more, or with
    // no Pin, in its place under the Sidebar's top row.
    let was = this.#slots.box;
    let now = grid.getBoundingClientRect();
    if (
      x < Math.min(was.left, now.left) ||
      x > Math.max(was.right, now.right) ||
      y < Math.min(was.top, now.top) ||
      y > Math.max(was.bottom, now.bottom)
    ) {
      return -1;
    }
    let rtl = document.dir == "rtl";
    let pins = this.#slots.pins.filter(pin => pin.tab != skip);
    for (let [index, { rect }] of pins.entries()) {
      let middle = rect.left + rect.width / 2;
      let before = rtl ? x > middle : x < middle;
      if (y < rect.top || (y <= rect.bottom && before)) {
        return index;
      }
    }
    return pins.length;
  }

  /** Where the dragged tab would land: {tab, index} (as dropIndexAt), or null. */
  get #landing() {
    let drag = this.#drag ?? this.tabDrag;
    return drag?.tab && drag.index != -1 ? drag : null;
  }

  #onKeyDown(event) {
    if (isMenuKey(event)) {
      event.preventDefault();
      this.pins.openMenu(this.#rovingTab, event.target);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    let tabs = this.tabs;
    let tab = this.#rovingTab;
    let index = tabs.indexOf(tab);
    let ahead = document.dir == "rtl" ? -1 : 1;
    let target;
    switch (event.key) {
      case "ArrowRight":
        target = tabs[index + ahead];
        break;
      case "ArrowLeft":
        target = tabs[index - ahead];
        break;
      case "ArrowDown":
        target = tabs[index + PIN_COLUMNS];
        break;
      case "ArrowUp":
        target = tabs[index - PIN_COLUMNS];
        break;
      case "Home":
        target = tabs[0];
        break;
      case "End":
        target = tabs.at(-1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        this.#select(tab);
        return;
      default:
        return;
    }
    event.preventDefault();
    if (target) {
      this.#focusTab(target);
    }
  }

  // Dragging a Pin: dropped in the grid it moves among the pinned tabs, on
  // the tab list it is unpinned, on another window it moves there, and
  // where no window takes it it opens in a new one (shell/tear-off.mjs).

  #onDragStart(event, tab) {
    if (this.#drag) {
      event.preventDefault();
      return;
    }
    this.#drag = { tab, index: -1, unpin: false };
    this.#drag.native = new SidebarDrag(event, {
      item: tab,
      tearOff: new TearOff(tab, { x: event.clientX, y: event.clientY }),
      onOver: over => this.#onDragOver(over),
      onDrop: () => this.#onDrop(),
      onEnd: () => this.#endDrag(),
    });
    this.toggleAttribute("dragging", true);
    this.requestUpdate();
  }

  get #tabList() {
    return window.OrbitoShell.sidebar.tabList;
  }

  // A dragover in the window, or null once the drag has left it.
  #onDragOver(event) {
    if (!this.#drag) {
      return;
    }
    // Out of the window, nothing in it shows where it would land.
    let out = !event;
    let x = event?.clientX;
    let y = event?.clientY;
    let index = out ? -1 : this.dropIndexAt(x, y, this.#drag.tab);
    let list = this.#tabList.getBoundingClientRect();
    let unpin =
      !out &&
      index == -1 &&
      x >= list.left &&
      x <= list.right &&
      y >= list.top &&
      y <= list.bottom;
    if (index != this.#drag.index || unpin != this.#drag.unpin) {
      Object.assign(this.#drag, { index, unpin });
      this.#tabList.toggleAttribute("unpin-drop", unpin);
      this.requestUpdate();
    }
    // Over the tab list, its guide bar shows where the tab would go.
    this.#drag.landing = this.#tabList.landOutside(
      this.#drag.tab,
      unpin ? y : null
    );
  }

  // A drop in the window.
  #onDrop() {
    let drag = this.#drag;
    this.#endDrag();
    if (!drag) {
      return;
    }
    let { tab, index, unpin } = drag;
    if (!tab.isConnected || !tab.pinned) {
      return;
    }
    if (unpin) {
      this.pins.unpinTab(tab);
      if (drag.landing) {
        this.#tabList.dropOutside(tab, drag.landing);
      }
      return;
    }
    let others = this.tabs.filter(t => t != tab);
    if (index == -1 || !others.length) {
      return;
    }
    if (index < others.length) {
      gBrowser.moveTabBefore(tab, others[index]);
    } else {
      gBrowser.moveTabAfter(tab, others.at(-1));
    }
  }

  #endDrag() {
    let drag = this.#drag;
    this.#drag = null;
    drag?.native.end();
    this.removeAttribute("dragging");
    this.#tabList?.removeAttribute("unpin-drop");
    this.#tabList?.landOutside(null, null);
    this.requestUpdate();
  }

  #button(tab, selected, roving) {
    let name = tab.label;
    return html`<div
      class="pin"
      role="tab"
      aria-label=${name}
      aria-selected=${selected ? "true" : "false"}
      title=${name}
      tabindex=${roving ? "0" : "-1"}
      ?selected=${selected}
      ?dragged=${this.#drag?.tab == tab}
      .tab=${tab}
      draggable="true"
      @mousedown=${pressWithoutFocus}
      @dragstart=${event => this.#onDragStart(event, tab)}
      @click=${() => this.#select(tab)}
      @contextmenu=${event => {
        event.preventDefault();
        this.pins.openMenu(tab, event.currentTarget, event);
      }}
      @focus=${() => (this.#focusedTab = tab)}
    >
      ${entryIcon(tab, this.pins)}
    </div>`;
  }

  // The see-through copy of a dragged tab, in the slot it would take.
  #preview(tab) {
    return html`<div class="pin" preview aria-hidden="true">
      ${tabIcon(tab)}
    </div>`;
  }

  willUpdate() {
    this.#motion.capture();
  }

  updated() {
    // With no Pin, the grid keeps its place with no height; while a tab is
    // dragged it keeps an invisible place to drop on over the Sidebar's top
    // row (orbito-pins.css), the rows staying where they are, until the
    // copy of the tab shows where it would land.
    this.toggleAttribute("empty", !this.tabs.length);
    this.toggleAttribute("dropping", !!this.tabDrag);
    this.toggleAttribute("landing", !!this.#landing);
    if (!this.#landing) {
      // Measured again as they show now.
      this.#slots = null;
    }
    this.#motion.play();
  }

  render() {
    let tabs = this.tabs;
    let selectedTab = gBrowser.selectedTab;
    let rovingTab = this.#rovingTab;
    let landing = this.#landing;
    let items = [...tabs];
    if (landing) {
      let others = tabs.filter(tab => tab != landing.tab);
      let at = others[landing.index];
      items.splice(at ? items.indexOf(at) : items.length, 0, PREVIEW);
    }
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/orbito/shell/orbito-pins.css"
      />
      <div
        class="grid"
        role="tablist"
        aria-label=${t("orbito-pins-list")}
        title=${t("orbito-pins-shared")}
        ?dropping=${!!this.tabDrag}
        @keydown=${this.#onKeyDown}
      >
        ${repeat(
          items,
          item => item,
          item =>
            item == PREVIEW
              ? this.#preview(landing.tab)
              : this.#button(item, item == selectedTab, item == rovingTab)
        )}
      </div>
      <div class="ghosts" aria-hidden="true"></div>
    `;
  }
}
customElements.define("orbito-pins", OrbitoPins);
