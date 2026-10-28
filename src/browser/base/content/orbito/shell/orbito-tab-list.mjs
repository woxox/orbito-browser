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
import { ORBITO_LOGO } from "chrome://browser/content/orbito/shell/orbito-logo.mjs";
import { ListMotion } from "chrome://browser/content/orbito/shell/motion.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  OrbitoAssistantCore:
    "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs",
});

// gBrowser's tab and tab group events after which the list may look
// different. They all reach the tab container.
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
  "TabGrouped",
  "TabUngrouped",
  "TabGroupCreate",
  "TabGroupRemoved",
  "TabGroupCollapse",
  "TabGroupExpand",
  "TabGroupUpdate",
  "TabGroupMoved",
  // A restored tab's Orbit has come back.
  "SSTabRestoring",
];

// The assistant core's events after which an Orbit may look different.
const CORE_EVENTS = new Set(["start", "orbit", "touching", "approval", "done"]);

// Where an Orbit's task is, for each OrbitoAssistantCore orbitState(), in
// its icon's tooltip after the task's name; the header itself has no text.
const ORBIT_STATES = {
  running: t("orbito-tabs-orbit-running"),
  waiting: t("orbito-tabs-orbit-waiting"),
  done: t("orbito-tabs-orbit-done"),
};

const STOP_ICON = html`<svg viewBox="0 0 16 16" aria-hidden="true">
  <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />
</svg>`;

// The hue each Firefox tab group color takes on the Shell's group boxes.
const GROUP_HUES = {
  blue: 255,
  purple: 305,
  cyan: 215,
  orange: 55,
  yellow: 95,
  pink: 350,
  green: 150,
  red: 25,
  gray: 0,
};

// How far a press moves before it becomes a drag.
const DRAG_THRESHOLD = 4;
// How long a dragged tab is held over another before a drop groups them,
// and how far from a row's top and bottom the pointer must be for that
// (nearer, the drop moves the tab before or after the row).
const HOLD_DELAY = 550;
const HOLD_EDGE = 8;

/**
 * The Sidebar's tab list: the new tab button, then one row per tab gBrowser
 * shows, in its order. A Firefox tab group is a box in the group's color
 * holding its header and its tabs; the header collapses and expands it.
 *
 * Pinned tabs are not listed: they are the Pin grid's (orbito-pins); nor
 * are Dock tabs, which are the Dock's (orbito-dock).
 *
 * The tabs an assistant task opened come first, in an Orbit: a box whose
 * header has no text, only its icon, a progress bar while the task works
 * and its edge (amber while it waits for an approval, accent once done)
 * show where the task is; the icon's tooltip names the task and says it.
 * The icon (not the rest of the header) opens the task's Thread in
 * the Assistant panel, where approvals and what to keep afterwards are
 * answered. A ring turns around the icon of the tab the task acts on now,
 * in an Orbit or not; its tooltip says so. Tabs are in an Orbit by a task
 * id in their session values (OrbitoAssistantCore.orbitOf), never by a
 * Firefox tab group.
 *
 * Clicking a row selects its tab, its close button closes it, and rows and
 * group headers can be dragged to move them in gBrowser; a tab dropped on
 * the Pin grid becomes a Pin, one dropped on the Dock a Dock tab, and one
 * held over another tab for a moment groups the two. The
 * context menu (the menu key or Shift+F10 too) pins or docks a tab. The list is a single tab stop: the arrow keys move
 * between rows and headers, Enter or Space selects a tab or toggles a group,
 * Left and Right collapse and expand.
 *
 * Rows, groups and Orbits move as the list changes (ListMotion): a new tab
 * comes in where it opens, a closed one folds away and the rows under it
 * come up, a moved one slides to its place; not on a Space switch.
 */
export class OrbitoTabList extends MozLitElement {
  // The row the keyboard is on, by its tab or tab group; the selected tab's
  // when unset.
  #focusedItem = null;
  // A press on a row that may become a drag, then the drag: what is dragged
  // and where it would land.
  #press = null;
  #drag = null;
  // Groups just made by holding a tab over another, which pop in.
  #fresh = new WeakSet();
  // Thread id -> what its current question's last step (tool call)
  // does, for its Orbit's tooltip.
  #steps = new Map();
  // Thread id -> its title, the Orbit's task name, once the core has
  // it.
  #titles = new Map();
  // The Space whose tabs show, for the motion: none on a switch.
  #shownSpace = null;
  #motion = new ListMotion({
    items: () =>
      [...this.renderRoot.querySelectorAll(".list :is(.tab, .group, .orbit)")].map(
        el => [el.tab ?? el.group ?? el.orbit, el]
      ),
    root: () => this.renderRoot.querySelector(".list"),
    layer: () => this.renderRoot.querySelector(".ghosts"),
    enter: [{ opacity: 0, transform: "translateY(-4px) scale(0.98)", offset: 0 }],
    exit: [{ opacity: 0, transform: "scale(0.98, 0.6)", offset: 1 }],
    // A group made by a drag and an Orbit pop in (orbito-tab-list.css).
    entersOwn: el => el.matches(".orbit, .group[fresh]"),
  });

  static queries = {
    rows: { all: ".list .tab" },
    groupHeaders: { all: ".group-toggle" },
    newTabButton: ".new-tab",
  };

  connectedCallback() {
    super.connectedCallback();
    for (let type of TAB_EVENTS) {
      gBrowser.tabContainer.addEventListener(type, this);
    }
    // A tab docked or undocked leaves or joins the list.
    window.addEventListener("OrbitoDocksChange", this);
    window.addEventListener("unload", this);
    lazy.OrbitoAssistantCore.addListener(this.#onCoreEvent);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#teardown();
  }

  // Also when the window closes, which leaves the element connected: the
  // core outlives the window.
  #teardown() {
    for (let type of TAB_EVENTS) {
      gBrowser.tabContainer.removeEventListener(type, this);
    }
    window.removeEventListener("OrbitoDocksChange", this);
    window.removeEventListener("unload", this);
    lazy.OrbitoAssistantCore.removeListener(this.#onCoreEvent);
    this.#endDrag();
  }

  #onCoreEvent = (threadId, event) => {
    if (event.type == "start") {
      this.#steps.delete(threadId);
    } else if (event.type == "tool_start") {
      this.#steps.set(threadId, event.label);
      this.requestUpdate();
    }
    if (CORE_EVENTS.has(event.type)) {
      this.requestUpdate();
    }
  };

  // What an Orbit's header says about its task: its name, then where it
  // is or, while it works, what its last step does. The steps are not
  // counted out of a total: a task's has no known end.
  #orbitName(orbit, state) {
    let threadId = lazy.OrbitoAssistantCore.orbitThread(orbit);
    let step = state == "running" && this.#steps.get(threadId);
    return t("orbito-tabs-orbit-name", {
      task: this.#taskName(threadId) ?? t("orbito-tabs-orbit"),
      status: step || ORBIT_STATES[state],
    });
  }

  // The Thread's title, or null until the core has given it.
  #taskName(threadId) {
    if (!threadId) {
      return null;
    }
    if (!this.#titles.has(threadId)) {
      this.#titles.set(threadId, null);
      lazy.OrbitoAssistantCore.threadTitle(threadId).then(
        title => {
          if (title) {
            this.#titles.set(threadId, title);
            this.requestUpdate();
          } else {
            // Asked again on a later render.
            this.#titles.delete(threadId);
          }
        },
        () => this.#titles.delete(threadId)
      );
    }
    return this.#titles.get(threadId);
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
      case "unload":
        this.#teardown();
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

  /**
   * The tabs the list shows: gBrowser's, minus pinned, hidden and closing
   * ones and those in collapsed groups (but the selected one), as Firefox
   * shows them, and minus Dock tabs.
   */
  get tabs() {
    return gBrowser.tabs.filter(
      tab => tab.visible && !tab.pinned && !this.#isDocked(tab)
    );
  }

  #isDocked(tab) {
    return !!window.OrbitoShell.docks?.dockOf(tab);
  }

  /** Whether a row or group header is being dragged. */
  get dragging() {
    return !!this.#drag;
  }

  /**
   * What the list shows, in order: each Orbit with its tabs, then tabs
   * outside groups, and for each group that has a tab to show, the group
   * with the tabs it shows. A tab in a group is the group's, Orbit or not.
   *
   * @returns {Array<{tab: MozTabbrowserTab} | {group: MozTabbrowserTabGroup, tabs: MozTabbrowserTab[]} | {orbit: string, tabs: MozTabbrowserTab[]}>}
   */
  get #blocks() {
    let blocks = [];
    let groups = new Map();
    let orbits = new Map();
    let core = lazy.OrbitoAssistantCore;
    for (let tab of gBrowser.tabs) {
      if (tab.hidden || tab.closing || tab.pinned || this.#isDocked(tab)) {
        continue;
      }
      let orbit = !tab.group && core.orbitOf(tab);
      if (orbit) {
        let block = orbits.get(orbit);
        if (!block) {
          block = { orbit, tabs: [] };
          orbits.set(orbit, block);
        }
        block.tabs.push(tab);
        continue;
      }
      let group = tab.group;
      if (!group) {
        blocks.push({ tab });
        continue;
      }
      let block = groups.get(group);
      if (!block) {
        block = { group, tabs: [] };
        groups.set(group, block);
        blocks.push(block);
      }
      if (tab.visible) {
        block.tabs.push(tab);
      }
    }
    return [...orbits.values(), ...blocks];
  }

  /**
   * The rows the keyboard moves between: Orbit headers (by their task id),
   * group headers and tabs.
   */
  get #items() {
    return this.#blocks.flatMap(block =>
      block.tab ? [block.tab] : [block.orbit ?? block.group, ...block.tabs]
    );
  }

  /** The Orbit header elements, in order. */
  get orbitHeaders() {
    return this.renderRoot.querySelectorAll(".orbit-toggle");
  }

  /** The Orbit a tab's row is in, or null. */
  #orbitOf(tab) {
    return tab.group ? null : lazy.OrbitoAssistantCore.orbitOf(tab);
  }

  /** Opens the Orbit's Thread in the Assistant panel. */
  #showOrbit(orbit) {
    window.OrbitoShell.assistant?.showOrbit(orbit);
  }

  #stopOrbit(orbit) {
    let core = lazy.OrbitoAssistantCore;
    let threadId = core.orbitThread(orbit);
    if (threadId && core.liveOrbit(threadId) == orbit) {
      core.stop(threadId);
    }
  }

  get #rovingItem() {
    let items = this.#items;
    if (items.includes(this.#focusedItem)) {
      return this.#focusedItem;
    }
    // A selected Pin or Dock tab is not in the list.
    return items.includes(gBrowser.selectedTab)
      ? gBrowser.selectedTab
      : items[0];
  }

  #elementFor(item) {
    if (typeof item == "string") {
      return [...this.orbitHeaders].find(header => header.orbit == item);
    }
    if (gBrowser.isTabGroup(item)) {
      return [...this.groupHeaders].find(header => header.group == item);
    }
    return [...this.rows].find(row => row.tab == item);
  }

  focusRegion() {
    this.#focusItem(this.#rovingItem);
  }

  async #focusItem(item) {
    this.#focusedItem = item;
    this.requestUpdate();
    await this.updateComplete;
    this.#elementFor(item)?.focus({ focusVisible: true });
  }

  /**
   * What the new tab button does: opens a tab on the new tab page, selects
   * it and focuses the page, whose input then takes focus. Not the urlbar,
   * which would open the Command bar over the page.
   */
  newTab() {
    let tab = gBrowser.addTrustedTab(BROWSER_NEW_TAB_URL);
    gURLBar.getBrowserState(tab.linkedBrowser).urlbarFocused = false;
    gBrowser.selectedTab = tab;
    tab.linkedBrowser.focus();
  }

  #select(tab) {
    gBrowser.selectedTab = tab;
  }

  #close(tab) {
    gBrowser.removeTab(tab, { animate: true });
  }

  #toggleGroup(group, collapsed = !group.collapsed) {
    group.collapsed = collapsed;
  }

  #onKeyDown(event) {
    let item = this.#rovingItem;
    if (isMenuKey(event)) {
      if (gBrowser.isTab(item)) {
        event.preventDefault();
        this.#openMenu(item, this.#elementFor(item));
      }
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    let items = this.#items;
    let index = items.indexOf(item);
    let isGroup = gBrowser.isTabGroup(item);
    let isOrbit = typeof item == "string";
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
        // A group header collapses; a tab in a group goes to its header.
        if (isGroup) {
          event.preventDefault();
          this.#toggleGroup(item, true);
          return;
        }
        target = isOrbit ? item : (item.group ?? this.#orbitOf(item) ?? item);
        break;
      case "ArrowRight":
        if (isGroup) {
          event.preventDefault();
          this.#toggleGroup(item, false);
        }
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (isOrbit) {
          this.#showOrbit(item);
        } else if (isGroup) {
          this.#toggleGroup(item);
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

  /** The tab menu (Pin tab), if the window has Pins (not a popup). */
  #openMenu(tab, anchor, event) {
    window.OrbitoShell.pins?.openMenu(tab, anchor, event);
  }

  /** The Pin grid a dragged tab can be dropped on, if it can take one. */
  get #pinGrid() {
    let grid = document.getElementById("orbito-pins");
    return grid && window.OrbitoShell.pins?.canAdd ? grid : null;
  }

  /** The Dock a dragged tab can be dropped on, if it can take one. */
  get #dock() {
    let dock = document.getElementById("orbito-dock");
    return dock && window.OrbitoShell.docks?.canAdd ? dock : null;
  }

  // Dragging. A press on a row or group header that moves a few pixels
  // drags it; dropping moves it in gBrowser before or after the row under
  // the pointer, into or out of groups as the rows there are. A tab dropped
  // on the Pin grid is pinned there, one dropped on the Dock docked. A tab
  // held over the middle of another tab's row arms it after HOLD_DELAY:
  // dropping then puts it in that tab's group, or makes a group of the two.

  #onPointerDown(event, item) {
    if (event.button != 0 || event.target.closest(".close") || this.#press) {
      return;
    }
    this.#press = { item, x: event.clientX, y: event.clientY };
    window.addEventListener("pointermove", this, true);
    window.addEventListener("pointerup", this, true);
    window.addEventListener("pointercancel", this, true);
    window.addEventListener("keydown", this, true);
  }

  #onPointerMove(event) {
    if (!this.#drag) {
      let { x, y } = this.#press;
      if (Math.hypot(event.clientX - x, event.clientY - y) < DRAG_THRESHOLD) {
        return;
      }
      this.#drag = {
        item: this.#press.item,
        target: null,
        before: false,
        pin: -1,
        dock: -1,
        // {tab, armed, timer}: the tab it is held over.
        hold: null,
      };
      this.toggleAttribute("dragging", true);
      // The dragged row dims.
      this.requestUpdate();
    }
    let isTab = gBrowser.isTab(this.#drag.item);
    let grid = isTab ? this.#pinGrid : null;
    let dock = isTab ? this.#dock : null;
    // The grid's drop place may lie over the Dock's when both are empty
    // (orbito.css): the grid comes first.
    let pin = grid?.dropIndexAt(event.clientX, event.clientY) ?? -1;
    let docked =
      pin == -1 ? (dock?.dropIndexAt(event.clientX, event.clientY) ?? -1) : -1;
    Object.assign(this.#drag, { pin, dock: docked });
    if (grid && grid.tabDrag?.index !== pin) {
      grid.tabDrag = { index: pin };
    }
    if (dock && dock.tabDrag?.index !== docked) {
      dock.tabDrag = { index: docked };
    }
    if (pin != -1 || docked != -1) {
      this.#holdOver(null);
      Object.assign(this.#drag, { target: null, before: false });
      return;
    }
    let scroller = this.renderRoot.querySelector(".scroll");
    let box = scroller.getBoundingClientRect();
    if (event.clientY < box.top + 24) {
      scroller.scrollBy(0, -8);
    } else if (event.clientY > box.bottom - 24) {
      scroller.scrollBy(0, 8);
    }
    Object.assign(this.#drag, this.#dropAt(event.clientY));
    this.#holdOver(this.#groupTargetAt(event.clientX, event.clientY));
  }

  /**
   * The tab whose row's middle is at a point, if the dragged tab can be
   * grouped with it: neither in an Orbit, nor both in one group.
   */
  #groupTargetAt(x, y) {
    let item = this.#drag.item;
    if (!gBrowser.isTab(item) || this.#orbitOf(item)) {
      return null;
    }
    // An Orbit's rows are not matched: they are its task's.
    let rows = this.renderRoot.querySelectorAll(".list > .tab, .group .tab");
    let row = [...rows].find(el => {
      let rect = el.getBoundingClientRect();
      return (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top + HOLD_EDGE &&
        y <= rect.bottom - HOLD_EDGE
      );
    });
    let tab = row?.tab;
    if (!tab || tab == item || (tab.group && tab.group == item.group)) {
      return null;
    }
    return tab;
  }

  // Starts holding over a tab (arming it after HOLD_DELAY), or stops.
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

  /**
   * Puts a tab in another's group, expanded, or makes a new group of the
   * two where the other is.
   */
  #group(tab, target) {
    // Either may have closed during the drag.
    if (!tab.isConnected || !target.isConnected) {
      return;
    }
    let group = target.group;
    if (group) {
      group.collapsed = false;
      group.addTabs([tab]);
      return;
    }
    group = gBrowser.addTabGroup([target, tab], {
      insertBefore: target,
      label: this.#newGroupName(),
    });
    if (group) {
      this.#fresh.add(group);
      setTimeout(() => {
        this.#fresh.delete(group);
        this.requestUpdate();
      }, 300);
    }
  }

  // The name a group made by a drag gets: "New group N", N the lowest no
  // group in the window is named with.
  #newGroupName() {
    let names = new Set(gBrowser.tabGroups.map(group => group.label));
    let name = number => t("orbito-tabs-new-group-name", { number });
    let number = 1;
    while (names.has(name(number))) {
      number++;
    }
    return name(number);
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
    if (drag.pin != -1) {
      window.OrbitoShell.pins.pinTab(drag.item, drag.pin);
      return;
    }
    if (drag.dock != -1) {
      window.OrbitoShell.docks.dockTab(drag.item, drag.dock);
      return;
    }
    if (drag.hold?.armed) {
      this.#group(drag.item, drag.hold.tab);
      return;
    }
    this.#move(drag);
  }

  #endDrag() {
    for (let id of ["orbito-pins", "orbito-dock"]) {
      let target = document.getElementById(id);
      if (target) {
        target.tabDrag = null;
      }
    }
    clearTimeout(this.#drag?.hold?.timer);
    this.#press = null;
    this.#drag = null;
    this.removeAttribute("dragging");
    window.removeEventListener("pointermove", this, true);
    window.removeEventListener("pointerup", this, true);
    window.removeEventListener("pointercancel", this, true);
    window.removeEventListener("keydown", this, true);
    this.requestUpdate();
  }

  /**
   * Where a drop at a height would land: before or after a tab or group.
   * A tab lands next to any row, a group header standing for its group; a
   * group lands only next to tabs outside groups and other groups.
   */
  #dropAt(y) {
    let item = this.#drag.item;
    // An Orbit's rows are its task's: nothing lands among them.
    let selector = gBrowser.isTabGroup(item)
      ? ".list > .tab, .list > .group"
      : ".list > .tab, .group .tab, .group-head";
    let candidates = [...this.renderRoot.querySelectorAll(selector)]
      .map(el => ({ el, target: el.tab ?? el.group }))
      .filter(({ target }) => target != item);
    if (!candidates.length) {
      return { target: null, before: false };
    }
    let found = candidates.find(
      ({ el }) => el.getBoundingClientRect().bottom > y
    );
    if (!found) {
      return { target: candidates.at(-1).target, before: false };
    }
    let rect = found.el.getBoundingClientRect();
    return { target: found.target, before: y < rect.top + rect.height / 2 };
  }

  #move({ item, target, before }) {
    // Either may have closed during the drag.
    if (!target?.isConnected || !item.isConnected) {
      return;
    }
    // A tab dropped under an open group's header goes first in the group.
    if (
      gBrowser.isTab(item) &&
      gBrowser.isTabGroup(target) &&
      !before &&
      !target.collapsed
    ) {
      if (target.tabs[0] != item) {
        gBrowser.moveTabBefore(item, target.tabs[0]);
      }
      return;
    }
    if (before) {
      gBrowser.moveTabBefore(item, target);
    } else {
      gBrowser.moveTabAfter(item, target);
    }
  }

  #row(tab, selected, roving, touched) {
    let touching = touched.has(tab);
    // What the assistant does in the tab: its running call, if one is.
    let call = touched.get(tab) || null;
    let step = call?.step || null;
    let working = touching
      ? call?.label || t("orbito-tabs-assistant-working")
      : null;
    let hold = this.#drag?.hold?.tab == tab ? this.#drag.hold : null;
    return html`<div
      class="tab"
      role="tab"
      aria-selected=${selected ? "true" : "false"}
      aria-description=${working ?? nothing}
      touching=${touching ? (step ? "running" : "") : nothing}
      tabindex=${roving ? "0" : "-1"}
      title=${tab.label}
      ?selected=${selected}
      ?unloaded=${!tab.linkedPanel || tab.hasAttribute("pending")}
      ?dragged=${this.#drag?.item == tab}
      hold=${hold ? (hold.armed ? "armed" : "") : nothing}
      hold-hint=${hold?.armed
        ? t(
            tab.group
              ? "orbito-tabs-hold-add-to-group"
              : "orbito-tabs-hold-new-group"
          )
        : nothing}
      .tab=${tab}
      @mousedown=${event => {
        // Like Firefox's tabs, a click selects without taking focus.
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
        this.#openMenu(tab, event.currentTarget, event);
      }}
      @focus=${() => (this.#focusedItem = tab)}
    >
      ${tabIcon(tab)}
      <span class="label">${tab.label}</span>
      ${step
        ? html`<span class="step" aria-hidden="true" title=${working}
            >${step}</span
          >`
        : nothing}
      <button
        class="close"
        tabindex="-1"
        aria-label=${t("orbito-tabs-close-tab")}
        title=${t("orbito-tabs-close-tab")}
        @mousedown=${event => event.preventDefault()}
        @click=${event => {
          event.stopPropagation();
          this.#close(tab);
        }}
      ></button>
    </div>`;
  }

  #orbitBox({ orbit, tabs }, selectedTab, rovingItem, touched) {
    let core = lazy.OrbitoAssistantCore;
    let state = core.orbitState(orbit);
    let name = this.#orbitName(orbit, state);
    return html`<div
      class="orbit"
      role="group"
      aria-label=${t("orbito-tabs-orbit")}
      state=${state}
      .orbit=${orbit}
    >
      <div
        class="orbit-head"
        @mousedown=${event => {
          if (event.button == 0) {
            event.preventDefault();
          }
        }}
      >
        <div
          class="orbit-toggle"
          role="button"
          aria-label=${name}
          title=${name}
          tabindex=${orbit == rovingItem ? "0" : "-1"}
          .orbit=${orbit}
          @click=${() => this.#showOrbit(orbit)}
          @focus=${() => (this.#focusedItem = orbit)}
        >
          ${ORBITO_LOGO}
        </div>
        ${state == "running"
          ? html`<div
              class="orbit-bar"
              role="progressbar"
              aria-label=${t("orbito-tabs-task-in-progress")}
            ></div>`
          : nothing}
        ${state == "done"
          ? nothing
          : html`<button
              class="stop"
              tabindex="-1"
              aria-label=${t("orbito-tabs-stop-task")}
              title=${t("orbito-tabs-stop-task")}
              @mousedown=${event => event.preventDefault()}
              @click=${() => this.#stopOrbit(orbit)}
            >
              ${STOP_ICON}
            </button>`}
      </div>
      <div class="orbit-body">
        ${repeat(
          tabs,
          tab => tab,
          tab =>
            this.#row(tab, tab == selectedTab, tab == rovingItem, touched)
        )}
      </div>
    </div>`;
  }

  #groupBox({ group, tabs }, selectedTab, rovingItem, touched) {
    let name = group.label || t("orbito-tabs-unnamed-group");
    let count = group.tabs.length;
    let hue = GROUP_HUES[group.color] ?? GROUP_HUES.gray;
    return html`<div
      class="group"
      role="group"
      aria-label=${name}
      style=${`--orbito-group-hue: ${hue}; --orbito-group-chroma-scale: ${
        group.color == "gray" ? 0 : 1
      }`}
      ?collapsed=${group.collapsed}
      ?fresh=${this.#fresh.has(group)}
      ?dragged=${this.#drag?.item == group}
      .group=${group}
    >
      <div
        class="group-head"
        .group=${group}
        @mousedown=${event => {
          if (event.button == 0) {
            event.preventDefault();
          }
        }}
        @pointerdown=${event => this.#onPointerDown(event, group)}
        @click=${event => {
          if (!event.target.closest(".close")) {
            this.#toggleGroup(group);
          }
        }}
      >
        <div
          class="group-toggle"
          role="button"
          aria-expanded=${group.collapsed ? "false" : "true"}
          aria-label=${name}
          title=${t("orbito-tabs-group-title", { name, count })}
          tabindex=${group == rovingItem ? "0" : "-1"}
          .group=${group}
          @focus=${() => (this.#focusedItem = group)}
        >
          <span class="dot"></span>
          <span class="label">${group.label}</span>
          <span class="chevron"></span>
        </div>
        <button
          class="close"
          tabindex="-1"
          aria-label=${t("orbito-tabs-close-group")}
          title=${t("orbito-tabs-close-group")}
          @mousedown=${event => event.preventDefault()}
          @click=${() => gBrowser.removeTabGroup(group)}
        ></button>
      </div>
      ${tabs.length
        ? html`<div class="group-body">
            ${repeat(
              tabs,
              tab => tab,
              tab =>
                this.#row(tab, tab == selectedTab, tab == rovingItem, touched)
            )}
          </div>`
        : nothing}
    </div>`;
  }

  willUpdate() {
    this.#motion.capture(this.#shownSpace);
  }

  updated() {
    this.#motion.play(this.#shownSpace);
  }

  render() {
    this.#shownSpace = window.OrbitoShell.spaces?.current;
    let selectedTab = gBrowser.selectedTab;
    let rovingItem = this.#rovingItem;
    let touched = lazy.OrbitoAssistantCore.touchedTabs();
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/orbito/shell/orbito-tab-list.css"
      />
      <div class="scroll">
        <button class="new-tab" @click=${() => this.newTab()}>
          <span class="icon"></span>
          <span class="label">${t("orbito-tabs-new-tab")}</span>
        </button>
        <div
          class="list"
          role="tablist"
          aria-orientation="vertical"
          aria-label=${t("orbito-tabs-list")}
          @keydown=${this.#onKeyDown}
        >
          ${repeat(
            this.#blocks,
            block => block.orbit ?? block.group ?? block.tab,
            block =>
              block.orbit
                ? this.#orbitBox(block, selectedTab, rovingItem, touched)
                : block.group
                  ? this.#groupBox(block, selectedTab, rovingItem, touched)
                  : this.#row(
                      block.tab,
                      block.tab == selectedTab,
                      block.tab == rovingItem,
                      touched
                    )
          )}
        </div>
        <div class="ghosts" aria-hidden="true"></div>
      </div>
    `;
  }
}
customElements.define("orbito-tab-list", OrbitoTabList);
