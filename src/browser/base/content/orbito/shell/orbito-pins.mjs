/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, repeat } from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";
import { ORBITO_LOGO } from "chrome://browser/content/orbito/shell/orbito-logo.mjs";
import { ListMotion } from "chrome://browser/content/orbito/shell/motion.mjs";

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

// How far a press moves before it becomes a drag.
const DRAG_THRESHOLD = 4;

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
 * time. Dragging a Pin moves it; dropping it on the tab list unpins it, and
 * a tab dragged from the tab list onto the grid becomes a Pin. The context
 * menu (the menu key or Shift+F10 too) unpins.
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
     * While a tab is dragged from the tab list: {index}, where it would
     * land in the grid, -1 when the pointer is not over it. Else null.
     */
    tabDrag: { type: Object },
  };

  static queries = {
    buttons: { all: ".grid .pin" },
    grid: ".grid",
  };

  // The Pin the keyboard is on, by its tab; the selected one when unset.
  #focusedTab = null;
  // A press on a Pin that may become a drag, then the drag: the tab, and
  // where it would land (before or after a Pin's tab, or the tab list).
  #press = null;
  #drag = null;
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
    let box = grid.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) {
      return -1;
    }
    let rtl = document.dir == "rtl";
    let buttons = [...this.buttons].filter(button => button.tab != skip);
    for (let [index, button] of buttons.entries()) {
      let rect = button.getBoundingClientRect();
      let middle = rect.left + rect.width / 2;
      let before = rtl ? x > middle : x < middle;
      if (y < rect.top || (y <= rect.bottom && before)) {
        return index;
      }
    }
    return buttons.length;
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
  // the tab list it is unpinned.

  #onPointerDown(event, tab) {
    if (event.button != 0 || this.#press) {
      return;
    }
    this.#press = { tab, x: event.clientX, y: event.clientY };
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
      this.#drag = { tab: this.#press.tab, index: -1, unpin: false };
      this.toggleAttribute("dragging", true);
    }
    let { clientX: x, clientY: y } = event;
    let index = this.dropIndexAt(x, y, this.#drag.tab);
    let list = this.#tabList.getBoundingClientRect();
    let unpin =
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
  }

  #onPointerUp(event) {
    let drag = this.#drag;
    this.#endDrag();
    if (!drag) {
      return;
    }
    // The press ended a drag, not a click on the Pin.
    let swallow = e => e.stopPropagation();
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    event.preventDefault();
    let { tab, index, unpin } = drag;
    if (!tab.isConnected || !tab.pinned) {
      return;
    }
    if (unpin) {
      this.pins.unpinTab(tab);
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
    this.#press = null;
    this.#drag = null;
    this.removeAttribute("dragging");
    this.#tabList?.removeAttribute("unpin-drop");
    window.removeEventListener("pointermove", this, true);
    window.removeEventListener("pointerup", this, true);
    window.removeEventListener("pointercancel", this, true);
    window.removeEventListener("keydown", this, true);
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
      @mousedown=${event => {
        // As the tab list's rows, a click selects without taking focus.
        if (event.button == 0) {
          event.preventDefault();
        }
      }}
      @pointerdown=${event => this.#onPointerDown(event, tab)}
      @click=${() => this.#select(tab)}
      @contextmenu=${event => {
        event.preventDefault();
        this.pins.openMenu(tab, event.currentTarget, event);
      }}
      @focus=${() => (this.#focusedTab = tab)}
    >
      ${tabIcon(tab)}
    </div>`;
  }

  willUpdate() {
    this.#motion.capture();
  }

  updated() {
    // With no Pin, the grid keeps its place with no height; while a tab is
    // dragged it keeps an invisible place to drop on over the Sidebar's top
    // row (orbito-pins.css), the rows staying where they are.
    this.toggleAttribute("empty", !this.tabs.length);
    this.toggleAttribute("dropping", !!this.tabDrag);
    this.#motion.play();
  }

  render() {
    let tabs = this.tabs;
    let selectedTab = gBrowser.selectedTab;
    let rovingTab = this.#rovingTab;
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
          tabs,
          tab => tab,
          tab => this.#button(tab, tab == selectedTab, tab == rovingTab)
        )}
      </div>
      <div class="ghosts" aria-hidden="true"></div>
    `;
  }
}
customElements.define("orbito-pins", OrbitoPins);
