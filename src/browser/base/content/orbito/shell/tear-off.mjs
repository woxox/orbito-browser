/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
);

/**
 * The drag data type of a Sidebar row dragged with the platform's drag and
 * drop. Its data, set with mozSetDataAt, is the SidebarDrag itself, which
 * other windows of the process can read while the drag is over them.
 */
export const DRAG_TYPE = "application/x-orbito-sidebar-item";

/** The SidebarDrag a drag event carries, if it is one. */
export function sidebarDragOf(event) {
  let dt = event.dataTransfer;
  if (!dt?.types.includes(DRAG_TYPE)) {
    return null;
  }
  try {
    return dt.mozGetDataAt(DRAG_TYPE, 0);
  } catch {
    return null;
  }
}

/**
 * What a draggable row does on mousedown in place of preventDefault(),
 * which would keep the drag from starting: a click does not focus it, as
 * Firefox's tabs do it.
 */
export function pressWithoutFocus(event) {
  if (event.button != 0) {
    return;
  }
  let row = event.currentTarget;
  row.style.MozUserFocus = "ignore";
  let reset = () => (row.style.MozUserFocus = "");
  window.addEventListener("mouseup", reset, { capture: true, once: true });
  row.addEventListener("dragend", reset, { once: true });
}

/**
 * A row of the Sidebar (the tab list's, the Pin grid's or the Dock's)
 * dragged with the platform's drag and drop, which the window under the
 * pointer gets the events of, whichever window the drag started in: what
 * lets a drag reach another window on Wayland too, where a window cannot
 * know where the others are.
 *
 * The platform draws the row under the pointer, from where it was grabbed.
 * In its own window, a drop anywhere stays the window's: the row's list
 * (through onOver and onDrop) places it as the pointer says. In another
 * Orbito window, the window's ForeignDrop takes it (TearOff.moveInto). Let
 * go where no window takes it, it opens in a new window (TearOff.detach).
 */
export class SidebarDrag {
  #row;
  #onOver;
  #onDrop;
  #onEnd;
  #dropped = false;
  #ended = false;

  /**
   * Starts the drag from its dragstart.
   *
   * @param {DragEvent} event The row's dragstart.
   * @param {object} options
   * @param {*} options.item What is dragged: a tab, a tab group, or a Dock
   *   folder's id.
   * @param {TearOff|null} options.tearOff How it leaves the window, or null
   *   when it cannot.
   * @param {Function} options.onOver Called with each dragover in this
   *   window, and with null once the pointer has left it.
   * @param {Function} options.onDrop Called with a drop in this window.
   * @param {Function} options.onEnd Called once the drag is over, after
   *   the drop.
   */
  constructor(event, { item, tearOff, onOver, onDrop, onEnd }) {
    this.item = item;
    this.tearOff = tearOff;
    this.window = window;
    this.#row = event.currentTarget;
    this.#onOver = onOver;
    this.#onDrop = onDrop;
    this.#onEnd = onEnd;
    let dt = event.dataTransfer;
    dt.mozSetDataAt(DRAG_TYPE, this, 0);
    dt.effectAllowed = "move";
    let rect = this.#row.getBoundingClientRect();
    dt.setDragImage(
      this.#row,
      event.clientX - rect.left,
      event.clientY - rect.top
    );
    for (let type of ["dragover", "dragleave", "drop", "mousedown"]) {
      window.addEventListener(type, this, true);
    }
    // Where the drag started, even once the row has left the document (a
    // tab moved into another window).
    this.#row.addEventListener("dragend", this);
  }

  handleEvent(event) {
    switch (event.type) {
      case "dragover":
        if (sidebarDragOf(event) == this) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          this.#onOver(event);
        }
        break;
      case "dragleave":
        // Without a relatedTarget, the drag has left the window.
        if (!event.relatedTarget && sidebarDragOf(event) == this) {
          this.#onOver(null);
        }
        break;
      case "drop":
        if (sidebarDragOf(event) == this) {
          event.preventDefault();
          event.stopPropagation();
          this.#dropped = true;
          this.#onDrop(event);
        }
        break;
      case "dragend": {
        let dt = event.dataTransfer;
        if (
          !this.#dropped &&
          !dt.mozUserCancelled &&
          dt.dropEffect == "none"
        ) {
          this.tearOff?.detach(event);
        }
        this.end();
        break;
      }
      case "mousedown":
        // A press needs the button let go first, which cannot happen during
        // a drag: the drag is over, whatever became of its dragend.
        if (event.button == 0) {
          this.end();
        }
        break;
    }
  }

  /** Stops listening, and lets the row's list end its drag. */
  end() {
    if (this.#ended) {
      return;
    }
    this.#ended = true;
    for (let type of ["dragover", "dragleave", "drop", "mousedown"]) {
      window.removeEventListener(type, this, true);
    }
    this.#row.removeEventListener("dragend", this);
    this.#onEnd();
  }
}

/**
 * Takes a Sidebar row dragged from another Orbito window (SidebarDrag):
 * a drop anywhere in this window moves it here (TearOff.moveInto), and one
 * over the tab list where its guide bar shows, when it is a tab or a group
 * of the list there. One per window, from the Sidebar.
 */
export class ForeignDrop {
  #tabList;
  // Where a drop in the tab list would land (as its landOutside), or null.
  #landing = null;

  constructor(tabList) {
    this.#tabList = tabList;
    for (let type of ["dragover", "dragleave", "drop"]) {
      window.addEventListener(type, this, true);
    }
  }

  destroy() {
    for (let type of ["dragover", "dragleave", "drop"]) {
      window.removeEventListener(type, this, true);
    }
    this.#land(null, null);
  }

  handleEvent(event) {
    let drag = sidebarDragOf(event);
    if (!drag || drag.window == window) {
      return;
    }
    switch (event.type) {
      case "dragover": {
        if (!drag.tearOff?.canMoveInto(window)) {
          this.#land(null, null);
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        let list = this.#tabList.getBoundingClientRect();
        let { clientX: x, clientY: y } = event;
        let overList =
          drag.tearOff.landsInList &&
          x >= list.left &&
          x <= list.right &&
          y >= list.top &&
          y <= list.bottom;
        this.#land(drag.item, overList ? y : null);
        break;
      }
      case "dragleave":
        if (!event.relatedTarget) {
          this.#land(null, null);
        }
        break;
      case "drop": {
        if (!drag.tearOff?.canMoveInto(window)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        let landing = this.#landing;
        this.#land(null, null);
        drag.tearOff.moveInto(window, landing);
        break;
      }
    }
  }

  #land(item, y) {
    this.#landing = this.#tabList.landOutside(item, y);
  }
}

/**
 * A tab or a tab group dragged in the Sidebar, as far as leaving its
 * window goes. Dropped on another Orbito window that can take it, it moves
 * there: at the end of the Space shown there, selected, or where the tab
 * list's guide bar showed it. Let go where no window takes it, it opens in
 * a new window, placed so that its row is under the pointer there, as
 * Firefox places a tab dragged out of its tab strip (tabbrowser's
 * drag-and-drop.mjs); nowhere in particular on Wayland, where the pointer's
 * place on the screen is not known. It cannot leave when it holds all the
 * window's tabs.
 */
export class TearOff {
  #item;
  // From the window's top-left (window.screenX/Y, its frame's) to where
  // the pointer is to sit on the new window, in CSS px.
  #offset;

  /**
   * @param {MozTabbrowserTab|MozTabbrowserTabGroup} item
   * @param {object} options
   * @param {number} options.x The press, in client coordinates.
   * @param {number} options.y
   * @param {number} [options.offsetX] Where the pointer is to sit on the new
   *   window, in this window's client coordinates: the press by default.
   * @param {number} [options.offsetY]
   */
  constructor(item, { x, y, offsetX = x, offsetY = y }) {
    this.#item = item;
    this.#offset = {
      x: offsetX + window.mozInnerScreenX - window.screenX,
      y: offsetY + window.mozInnerScreenY - window.screenY,
    };
  }

  /**
   * Whether the item can leave the window: not when it is all the window's
   * tabs (gBrowser.replaceTabsWithWindow would do nothing).
   */
  get canDetach() {
    let item = this.#item;
    if (!item.isConnected || item.closing) {
      return false;
    }
    if (gBrowser.isTabGroup(item)) {
      return gBrowser.tabs.some(tab => tab.group != item);
    }
    let elements = this.#elements;
    return gBrowser.tabs.length != elements.length;
  }

  // The tab, its split view, or the tabs selected with it.
  get #elements() {
    let item = this.#item;
    return item.multiselected
      ? gBrowser.selectedElements
      : [item.splitview ?? item];
  }

  /**
   * Whether another window can take the item: an Orbito window with its
   * Sidebar (not a popup), of the same kind, as a private window and
   * another take no tabs from each other (swapBrowsersAndCloseOther).
   */
  canMoveInto(other) {
    return (
      other != window &&
      !other.closed &&
      !!other.OrbitoShell?.spaces &&
      other.toolbar.visible &&
      PrivateBrowsingUtils.isWindowPrivate(other) ==
        PrivateBrowsingUtils.isWindowPrivate(window) &&
      this.canDetach
    );
  }

  /**
   * Whether the item would go in the tab list where it moves to: a tab
   * group, or one tab, neither a Pin's nor a Dock tab, and not with others.
   */
  get landsInList() {
    let item = this.#item;
    if (gBrowser.isTabGroup(item)) {
      return true;
    }
    return (
      this.#elements.length == 1 &&
      !item.splitview &&
      !item.pinned &&
      !window.OrbitoShell.docks?.idOf(item)
    );
  }

  /** Opens the item in a new window, placed by where it was let go. */
  detach(event) {
    if (!this.canDetach) {
      return;
    }
    let features = { suppressanimation: 1, ...this.#placeAt(event) };
    if (gBrowser.isTabGroup(this.#item)) {
      // As replaceGroupWithWindow, which takes no window features.
      gBrowser.replaceTabWithWindow(this.#item, features);
    } else {
      gBrowser.replaceTabsWithWindow(this.#item, features);
    }
  }

  /**
   * Moves the item into another window, at the end of the Space shown
   * there, selected, as Firefox's drop on another window's tab strip
   * adopts it. A Pin's tab goes among the pinned tabs there, and a Pin's or
   * a Dock tab is the entry's tab there in place of the one the window had
   * (shell/list-tabs.mjs), the Dock tab in its Dock's Space. With a
   * landing (the tab list's landOutside there), the tab or group goes
   * there in the list instead of at the end.
   */
  moveInto(other, landing = null) {
    let browser = other.gBrowser;
    let { docks, spaces } = other.OrbitoShell;
    let item = this.#item;
    // The tabs come with their Space; they join the one shown there before
    // one is selected, which would show its Space instead.
    let space = spaces.current;
    let select;
    // What goes where the landing is, known before the item leaves.
    let placed = null;
    if (!this.landsInList) {
      landing = null;
    }
    if (gBrowser.isTabGroup(item)) {
      let selected = item.tabs.find(tab => tab.selected) ?? item.tabs[0];
      let index = item.tabs.indexOf(selected);
      let group = browser.adoptTabGroup(item, {
        tabIndex: browser.tabs.length,
      });
      spaces.moveGroup(group, space);
      select = group.tabs[index];
      placed = group;
    } else {
      let elements = this.#elements;
      let moved = elements.map(element =>
        gBrowser.isSplitViewWrapper(element)
          ? browser.adoptSplitView(element, { tabIndex: browser.tabs.length })
          : browser.adoptTab(element, {
              tabIndex: element.pinned
                ? browser.pinnedTabCount
                : browser.tabs.length,
            })
      );
      for (let tab of moved.flatMap(m => m?.tabs ?? (m ? [m] : []))) {
        if (!docks.idOf(tab)) {
          spaces.moveTab(tab, space);
        }
      }
      let dragged = moved[elements.indexOf(item.splitview ?? item)];
      select = dragged?.tabs?.[0] ?? dragged;
      placed = dragged;
    }
    if (landing && placed) {
      other.OrbitoShell.sidebar.tabList.dropOutside(placed, landing);
    }
    if (select) {
      browser.selectedTab = select;
    }
    other.focus();
  }

  /**
   * Where the new window goes: the offset from the pointer, kept on the
   * available area of the screen under the pointer, with the window's size
   * (Firefox's sums, in desktop pixels). Nowhere in full screen, as the
   * new window does not take this one's size.
   */
  #placeAt({ screenX, screenY }) {
    if (window.fullScreen) {
      return { suppressinitialfullscreen: 1 };
    }
    let ourScale = window.devicePixelRatio / window.desktopToDeviceScale;
    let screen = Cc["@mozilla.org/gfx/screenmanager;1"]
      .getService(Ci.nsIScreenManager)
      .screenForRect(screenX * ourScale, screenY * ourScale, 1, 1);
    let [availX, availY, availWidth, availHeight] = [{}, {}, {}, {}];
    screen.GetAvailRectDisplayPix(availX, availY, availWidth, availHeight);
    let screenScale = screen.defaultCSSScaleFactor / screen.contentsScaleFactor;
    let width = Math.min(window.outerWidth * screenScale, availWidth.value);
    let height = Math.min(window.outerHeight * screenScale, availHeight.value);
    let left = Math.min(
      Math.max(
        screenX * ourScale - this.#offset.x * screenScale,
        availX.value
      ),
      availX.value + availWidth.value - width
    );
    let top = Math.min(
      Math.max(
        screenY * ourScale - this.#offset.y * screenScale,
        availY.value
      ),
      availY.value + availHeight.value - height
    );
    return { screenX: left / ourScale, screenY: top / ourScale };
  }
}
