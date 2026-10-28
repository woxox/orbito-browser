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
// The Shell's own: the Dock lists followed, the Space shown changed.
const WINDOW_EVENTS = ["OrbitoDocksChange", "OrbitoSpacesChange"];

// How far a press moves before it becomes a drag.
const DRAG_THRESHOLD = 4;

/**
 * The Dock under the Space's name: a row per Dock tab of the Space shown
 * (OrbitoShell.docks), in the Dock's order, with a line under it that sets
 * it apart from the tab list. It slides with the Space's name and tabs.
 * Clicking a row selects its tab, which loads its page if it rests (closed
 * back to where it was docked, or not selected yet; those rows are dimmed).
 * Closing one keeps its row: the tab goes back to the docked page, unloaded.
 *
 * A tab dragged from the tab list onto the Dock is docked there; dragging a
 * row moves it in the Dock, and dropping it on the tab list undocks it. The
 * context menu (the menu key or Shift+F10 too) docks and undocks as well.
 *
 * The Dock is one tab stop: Up and Down move between rows, Home and End to
 * the first and last, Enter or Space select.
 *
 * Rows move as the Dock changes (ListMotion): a new one comes in at its
 * place, an undocked one shrinks away and the others slide to theirs; not
 * when another Space's Dock shows.
 */
export class OrbitoDock extends MozLitElement {
  static properties = {
    /**
     * While a tab is dragged from the tab list: {index}, where it would
     * land in the Dock, -1 when the pointer is not over it. Else null.
     */
    tabDrag: { type: Object },
  };

  static queries = {
    rows: { all: ".list .tab" },
    list: ".list",
  };

  // The row the keyboard is on, by its tab; the selected one when unset.
  #focusedTab = null;
  // A press on a row that may become a drag, then the drag: the tab, and
  // where it would land (an index in the Dock, or the tab list).
  #press = null;
  #drag = null;
  // The Space whose Dock shows, for the motion: none on a switch.
  #shownSpace = null;
  #motion = new ListMotion({
    items: () => [...this.rows].map(row => [row.tab, row]),
    root: () => this.list,
    layer: () => this.renderRoot.querySelector(".ghosts"),
    enter: [{ opacity: 0, transform: "scale(0.9)", offset: 0 }],
    exit: [{ opacity: 0, transform: "scale(0.9)", offset: 1 }],
  });

  constructor() {
    super();
    this.tabDrag = null;
  }

  get docks() {
    return window.OrbitoShell.docks;
  }

  /** The tabs the Dock shows: the Space's Dock tabs, in order. */
  get tabs() {
    return this.docks.tabsIn();
  }

  /** Whether a row is being dragged. */
  get dragging() {
    return !!this.#drag;
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

  get #rovingTab() {
    let tabs = this.tabs;
    if (tabs.includes(this.#focusedTab)) {
      return this.#focusedTab;
    }
    return tabs.includes(gBrowser.selectedTab) ? gBrowser.selectedTab : tabs[0];
  }

  #rowFor(tab) {
    return [...this.rows].find(row => row.tab == tab);
  }

  /** Focuses the row the keyboard is on (the Dock is one tab stop). */
  focusRegion() {
    this.#focusTab(this.#rovingTab);
  }

  async #focusTab(tab) {
    this.#focusedTab = tab;
    this.requestUpdate();
    await this.updateComplete;
    this.#rowFor(tab)?.focus({ focusVisible: true });
  }

  #select(tab) {
    gBrowser.selectedTab = tab;
  }

  #close(tab) {
    gBrowser.removeTab(tab, { animate: true });
  }

  /**
   * Where a drop at a point lands in the Dock: the index of the row it goes
   * before (the number of rows for after the last), leaving out the tab
   * skip; -1 off the Dock.
   */
  dropIndexAt(x, y, skip = null) {
    let list = this.list;
    if (!list || !list.checkVisibility()) {
      return -1;
    }
    let box = list.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) {
      return -1;
    }
    let rows = [...this.rows].filter(row => row.tab != skip);
    let index = rows.findIndex(row => {
      let rect = row.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    return index == -1 ? rows.length : index;
  }

  #onKeyDown(event) {
    if (isMenuKey(event)) {
      event.preventDefault();
      let tab = this.#rovingTab;
      window.OrbitoShell.pins.openMenu(tab, this.#rowFor(tab));
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    let tabs = this.tabs;
    let tab = this.#rovingTab;
    let index = tabs.indexOf(tab);
    let target;
    switch (event.key) {
      case "ArrowDown":
        target = tabs[Math.min(index + 1, tabs.length - 1)];
        break;
      case "ArrowUp":
        target = tabs[Math.max(index - 1, 0)];
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
    this.#focusTab(target);
  }

  // Dragging a row: dropped in the Dock it moves among the Space's Dock
  // tabs, on the tab list it is undocked.

  #onPointerDown(event, tab) {
    // A private window changes no Dock.
    if (
      event.button != 0 ||
      event.target.closest(".close") ||
      this.#press ||
      !this.docks.canAdd
    ) {
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
      this.#drag = { tab: this.#press.tab, index: -1, undock: false };
      this.toggleAttribute("dragging", true);
    }
    let { clientX: x, clientY: y } = event;
    let index = this.dropIndexAt(x, y, this.#drag.tab);
    let list = this.#tabList.getBoundingClientRect();
    let undock =
      index == -1 &&
      x >= list.left &&
      x <= list.right &&
      y >= list.top &&
      y <= list.bottom;
    if (index != this.#drag.index || undock != this.#drag.undock) {
      Object.assign(this.#drag, { index, undock });
      this.#tabList.toggleAttribute("undock-drop", undock);
      this.requestUpdate();
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
    let { tab, index, undock } = drag;
    if (!tab.isConnected || !this.docks.dockOf(tab)) {
      return;
    }
    if (undock) {
      this.docks.undockTab(tab);
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
    this.#tabList?.removeAttribute("undock-drop");
    window.removeEventListener("pointermove", this, true);
    window.removeEventListener("pointerup", this, true);
    window.removeEventListener("pointercancel", this, true);
    window.removeEventListener("keydown", this, true);
    this.requestUpdate();
  }

  #row(tab, selected, roving) {
    let name = tab.label;
    let resting = this.docks.isResting(tab);
    return html`<div
      class="tab"
      role="tab"
      aria-label=${name}
      aria-selected=${selected ? "true" : "false"}
      title=${name}
      tabindex=${roving ? "0" : "-1"}
      ?selected=${selected}
      ?resting=${resting}
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
      @auxclick=${event => {
        if (event.button == 1) {
          this.#close(tab);
        }
      }}
      @contextmenu=${event => {
        event.preventDefault();
        window.OrbitoShell.pins.openMenu(tab, event.currentTarget, event);
      }}
      @focus=${() => (this.#focusedTab = tab)}
    >
      ${tabIcon(tab)}
      <span class="label">${name}</span>
      ${resting
        ? nothing
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

  willUpdate() {
    this.#motion.capture(this.#shownSpace);
  }

  updated() {
    // With no Dock tab, the Dock takes no room; while a tab is dragged it
    // keeps a small invisible strip to drop on (orbito-dock.css).
    this.toggleAttribute("empty", !this.tabs.length);
    this.toggleAttribute("dropping", !!this.tabDrag);
    this.#motion.play(this.#shownSpace);
  }

  render() {
    this.#shownSpace = window.OrbitoShell.spaces?.current;
    let tabs = this.tabs;
    let selectedTab = gBrowser.selectedTab;
    let rovingTab = this.#rovingTab;
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
          tabs,
          tab => tab,
          tab => this.#row(tab, tab == selectedTab, tab == rovingTab)
        )}
      </div>
      <div class="separator"></div>
      <div class="ghosts" aria-hidden="true"></div>
    `;
  }
}
customElements.define("orbito-dock", OrbitoDock);
