/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, render } from "chrome://global/content/vendor/lit.all.mjs";
import { tabIcon } from "chrome://browser/content/orbito/shell/orbito-pins.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);
const { BrowserWindowTracker } = ChromeUtils.importESModule(
  "resource:///modules/BrowserWindowTracker.sys.mjs"
);
const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
);

/** The chip's panel: one per window, made on first use. */
const PANEL_ID = "orbito-tear-off";
/**
 * The see-through room around the chip in its panel, for its shadow (CSS
 * px; orbito.css pads the panel by it).
 */
const ROOM = 32;

/**
 * Whether a pointer event in one window is in a window's visible frame. In
 * desktop pixels, which windows on screens of different scales share.
 */
function isIn(w, { screenX, screenY }, from) {
  let scale = from.devicePixelRatio / from.desktopToDeviceScale;
  let theirs = w.devicePixelRatio / w.desktopToDeviceScale;
  let x = screenX * scale - w.mozInnerScreenX * theirs;
  let y = screenY * scale - w.mozInnerScreenY * theirs;
  return (
    x >= 0 && y >= 0 && x < w.innerWidth * theirs && y < w.innerHeight * theirs
  );
}

/**
 * A tab or a tab group dragged in the Sidebar, as far as leaving the window
 * goes. Let go outside the window's visible frame, it moves into the Orbito
 * window under the pointer, if there is one that can take it: at the end of
 * the Space shown there, selected. Else it opens in a new window, placed so
 * that its row is under the pointer there, as Firefox places a tab dragged
 * out of its tab strip (tabbrowser's drag-and-drop.js). The page area is in
 * the window: a drop there stays the Sidebar's to handle.
 *
 * While the pointer is out, a chip like the dragged row follows it where
 * the row was grabbed, with a hint under it saying which of the two a drop
 * does; it shows only when the item can leave, which it cannot when it
 * holds all the window's tabs.
 */
export class TearOff {
  #item;
  // Where the row was grabbed, from its top-left, and its width.
  #grab;
  #width;
  // From the window's top-left (window.screenX/Y, its frame's) to where
  // the pointer is to sit on the new window, in CSS px.
  #offset;
  #icon;

  /**
   * @param {MozTabbrowserTab|MozTabbrowserTabGroup} item
   * @param {object} options
   * @param {Element} options.row The row grabbed, which the chip looks like.
   * @param {number} [options.width] The chip's width: the row's by default.
   * @param {number} options.x The press, in client coordinates.
   * @param {number} options.y
   * @param {number} [options.offsetX] Where the pointer is to sit on the new
   *   window, in this window's client coordinates: the press by default.
   * @param {number} [options.offsetY]
   */
  constructor(item, { row, width, x, y, offsetX = x, offsetY = y }) {
    let rect = row.getBoundingClientRect();
    this.#item = item;
    this.#grab = { x: x - rect.left, y: y - rect.top };
    this.#width = width ?? rect.width;
    this.#offset = {
      x: offsetX + window.mozInnerScreenX - window.screenX,
      y: offsetY + window.mozInnerScreenY - window.screenY,
    };
    // A group's color, as its row's dot shows it.
    let dot = gBrowser.isTabGroup(item) && row.querySelector(".dot");
    this.#icon = dot
      ? html`<span
          class="dot"
          style=${`background-color: ${getComputedStyle(dot).backgroundColor}`}
        ></span>`
      : tabIcon(item);
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
    let elements = item.multiselected
      ? gBrowser.selectedElements
      : [item.splitview ?? item];
    return gBrowser.tabs.length != elements.length;
  }

  /**
   * Follows the pointer: shows the chip at it while a drop would take the
   * item out of the window, else hides it.
   *
   * @returns {boolean} Whether a drop now would take it out.
   */
  update(event) {
    let to = this.#destination(event);
    if (to) {
      this.#show(
        event.screenX - this.#grab.x,
        event.screenY - this.#grab.y,
        to.window
      );
    } else {
      this.end();
    }
    return !!to;
  }

  /**
   * Moves the item into another window, or opens it in a new one, if the
   * pointer is let go out of this one and it can leave.
   *
   * @returns {boolean} Whether it did.
   */
  drop(event) {
    this.end();
    let to = this.#destination(event);
    if (!to) {
      return false;
    }
    if (to.window) {
      this.#moveInto(to.window);
      return true;
    }
    let features = { suppressanimation: 1, ...this.#placeAt(event) };
    if (gBrowser.isTabGroup(this.#item)) {
      // As replaceGroupWithWindow, which takes no window features.
      gBrowser.replaceTabWithWindow(this.#item, features);
    } else {
      gBrowser.replaceTabsWithWindow(this.#item, features);
    }
    return true;
  }

  /** Hides the chip. */
  end() {
    let panel = document.getElementById(PANEL_ID);
    if (panel && panel.state != "closed") {
      panel.hidePopup();
    }
  }

  /**
   * Where a drop at the pointer takes the item: null when it stays (the
   * pointer is in the window, or the item cannot leave), else {window}, the
   * window it moves into, null for a new one.
   */
  #destination(event) {
    if (isIn(window, event, window) || !this.canDetach) {
      return null;
    }
    // Most recently used first, which is near enough the order on screen
    // (it has no other way to know what lies over what). A private window
    // and another take no tabs from each other (swapBrowsersAndCloseOther).
    let isPrivate = PrivateBrowsingUtils.isWindowPrivate(window);
    let other = BrowserWindowTracker.orderedWindows.find(
      w =>
        w != window &&
        !w.closed &&
        w.windowState != w.STATE_MINIMIZED &&
        w.OrbitoShell &&
        w.toolbar.visible &&
        PrivateBrowsingUtils.isWindowPrivate(w) == isPrivate &&
        isIn(w, event, window)
    );
    return { window: other ?? null };
  }

  /**
   * Moves the item into another window, at the end of the Space shown
   * there, selected, as Firefox's drop on another window's tab strip
   * adopts it. A Pin's tab goes among the pinned tabs there, and a Pin's or
   * a Dock tab is the entry's tab there in place of the one the window had
   * (shell/list-tabs.mjs), the Dock tab in its Dock's Space.
   */
  #moveInto(other) {
    let browser = other.gBrowser;
    let { docks, spaces } = other.OrbitoShell;
    let item = this.#item;
    // The tabs come with their Space; they join the one shown there before
    // one is selected, which would show its Space instead.
    let space = spaces.current;
    let select;
    if (gBrowser.isTabGroup(item)) {
      let selected = item.tabs.find(tab => tab.selected) ?? item.tabs[0];
      let index = item.tabs.indexOf(selected);
      let group = browser.adoptTabGroup(item, {
        tabIndex: browser.tabs.length,
      });
      spaces.moveGroup(group, space);
      select = group.tabs[index];
    } else {
      let elements = item.multiselected
        ? gBrowser.selectedElements
        : [item.splitview ?? item];
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

  /** The chip at a point, its hint for a drop into a window or a new one. */
  #show(x, y, into) {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      // A drag popup lets the pointer through, so the drag goes on under it
      // outside the window.
      panel = document.createXULElement("panel");
      panel.id = PANEL_ID;
      panel.setAttribute("type", "drag");
      panel.setAttribute("noautofocus", "true");
      panel.style.setProperty("--orbito-tear-off-room", `${ROOM}px`);
      document.getElementById("mainPopupSet").append(panel);
    }
    let label = gBrowser.isTabGroup(this.#item)
      ? this.#item.label || t("orbito-tabs-unnamed-group")
      : this.#item.label;
    let hint = into ? "orbito-tabs-move-to-window" : "orbito-tabs-tear-off";
    render(
      html`<div class="chip" style=${`width: ${this.#width}px`}>
          ${this.#icon}<span class="label">${label}</span>
        </div>
        <div class="hint">${t(hint)}</div>`,
      panel
    );
    if (panel.state == "open" || panel.state == "showing") {
      panel.moveTo(x - ROOM, y - ROOM);
    } else {
      panel.openPopupAtScreen(x - ROOM, y - ROOM, false);
    }
  }
}
