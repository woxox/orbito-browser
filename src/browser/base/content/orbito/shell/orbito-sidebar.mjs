/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html } from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";
import "chrome://browser/content/orbito/shell/orbito-tab-list.mjs";
import {
  motionEase,
  motionMs,
  reducedMotion,
} from "chrome://browser/content/orbito/shell/motion.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const WIDTH_PREF = "orbito.sidebar.width";
const COLLAPSED_PREF = "orbito.sidebar.collapsed";

/** The Sidebar's width in px: what the handle allows and its default. */
export const SIDEBAR_WIDTH = { min: 200, max: 360, default: 244 };

// How far one arrow key press moves the resize handle, in px.
const RESIZE_STEP = 8;
// How long a peeking Sidebar stays after the pointer and focus leave, in ms.
const PEEK_LINGER = 300;
// A window this narrow keeps the Sidebar collapsed.
const NARROW_QUERY = "(max-width: 760px)";
// How far a sideways scroll goes before it switches the Space, in px, and
// how long without one ends it (a swipe's momentum keeps it going), in ms.
const SWIPE_DISTANCE = 60;
const SWIPE_END = 200;

const BOOKMARK_ICON = html`<svg viewBox="0 0 16 16" aria-hidden="true">
  <path d="M4.5 2.5h7v11L8 11l-3.5 2.5z" />
</svg>`;

const clampWidth = width =>
  Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)));

/**
 * The full-height Sidebar on the window's left. From the top: the macOS
 * window buttons and the Sidebar's own buttons, Pin, then the Space's body
 * (its name, Dock and the tab list), and the Space switcher at the bottom.
 * Only the collapse button and the tab list are built in; the other parts
 * go in their slots:
 *
 *   window-buttons  the box macOS draws its traffic lights over
 *   top-actions     buttons at the right of the top row
 *   pins            the Pin grid
 *   space-title     the current Space's name
 *   dock            the current Space's Dock
 *   footer          the Space switcher
 *
 * Its width (the handle on its edge) and whether it is collapsed are prefs,
 * shared by every window; a narrow window keeps it collapsed whatever the
 * pref says, without a handle. Collapsed, it is out of the layout and peeks
 * over the page while the pointer is on the window's left edge or on it, or
 * focus is in it. A peek opened without the pointer (⌘S, the Top bar's
 * button) stays until Escape, a click outside, a tab is picked or the
 * Command bar opens.
 */
export class OrbitoSidebar extends MozLitElement {
  static properties = {
    collapsed: { type: Boolean, reflect: true },
    narrow: { type: Boolean, reflect: true },
    peeking: { type: Boolean, reflect: true },
    width: { type: Number },
  };

  static queries = {
    tabList: "orbito-tab-list",
    collapseButton: ".collapse",
    resizer: ".resizer",
    spaceBody: ".space-body",
  };

  #peekTimer = null;
  // The handle's drag: where it started.
  #resize = null;
  #narrowQuery = window.matchMedia(NARROW_QUERY);
  // The animations of a collapse or a comeback still playing.
  #toggleMotion = [];
  // A sideways scroll: how far it went, whether it switched the Space
  // already, and when it last moved.
  #swipe = { distance: 0, switched: false, at: -Infinity };

  constructor() {
    super();
    this.collapsed = false;
    this.narrow = false;
    this.peeking = false;
    this.width = SIDEBAR_WIDTH.default;
  }

  // Held weakly by the prefs service, so a closed window does not leak.
  #prefObserver = {
    observe: () => this.#readPrefs(),
    QueryInterface: ChromeUtils.generateQI([
      "nsIObserver",
      "nsISupportsWeakReference",
    ]),
  };

  connectedCallback() {
    super.connectedCallback();
    Services.prefs.addObserver(WIDTH_PREF, this.#prefObserver, true);
    Services.prefs.addObserver(COLLAPSED_PREF, this.#prefObserver, true);
    this.#narrowQuery.addEventListener("change", this);
    this.#readPrefs();
    for (let type of ["mouseenter", "mouseleave", "focusout", "wheel"]) {
      this.addEventListener(type, this);
    }
    for (let type of ["OrbitoSpaceSwitch", "OrbitoCommandBarOpen", "keydown"]) {
      window.addEventListener(type, this);
    }
    // Before the click lands, in case it lands on something the peek covers.
    window.addEventListener("mousedown", this, true);
    gBrowser.tabContainer.addEventListener("TabSelect", this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    Services.prefs.removeObserver(WIDTH_PREF, this.#prefObserver);
    Services.prefs.removeObserver(COLLAPSED_PREF, this.#prefObserver);
    this.#narrowQuery.removeEventListener("change", this);
    for (let type of ["OrbitoSpaceSwitch", "OrbitoCommandBarOpen", "keydown"]) {
      window.removeEventListener(type, this);
    }
    window.removeEventListener("mousedown", this, true);
    gBrowser.tabContainer.removeEventListener("TabSelect", this);
    clearTimeout(this.#peekTimer);
  }

  #readPrefs() {
    this.narrow = this.#narrowQuery.matches;
    this.collapsed =
      this.narrow || Services.prefs.getBoolPref(COLLAPSED_PREF, false);
    if (!this.collapsed) {
      this.peeking = false;
    }
    this.#applyWidth(
      clampWidth(
        Services.prefs.getIntPref(WIDTH_PREF, SIDEBAR_WIDTH.default)
      )
    );
  }

  #applyWidth(width) {
    this.width = width;
    document.documentElement.style.setProperty(
      "--orbito-sidebar-width",
      `${width}px`
    );
  }

  #saveWidth(width) {
    width = clampWidth(width);
    if (width == SIDEBAR_WIDTH.default) {
      Services.prefs.clearUserPref(WIDTH_PREF);
    } else {
      Services.prefs.setIntPref(WIDTH_PREF, width);
    }
    this.#applyWidth(width);
  }

  handleEvent(event) {
    switch (event.type) {
      case "mouseenter":
        clearTimeout(this.#peekTimer);
        break;
      case "mouseleave":
      case "focusout":
        this.endPeek();
        break;
      case "OrbitoSpaceSwitch":
        this.#slide(event.detail.direction);
        break;
      case "wheel":
        this.#onWheel(event);
        break;
      case "change":
        this.#readPrefs();
        break;
      case "TabSelect":
      case "OrbitoCommandBarOpen":
        this.hidePeek();
        break;
      case "mousedown":
        // A click outside the peek (not on what toggles it) ends it.
        if (
          this.peeking &&
          !event
            .composedPath()
            .some(
              el =>
                el == this ||
                el.id == "orbito-sidebar-edge" ||
                el.hasAttribute?.("orbito-sidebar-toggle")
            )
        ) {
          this.hidePeek();
        }
        break;
      case "keydown":
        // Escape anywhere in the window, unless something took it already.
        if (
          event.key == "Escape" &&
          this.peeking &&
          !event.defaultPrevented
        ) {
          event.preventDefault();
          this.hidePeek();
        }
        break;
    }
  }

  /**
   * The Space's body (its name, Dock and tabs) slides in from the side the
   * new Space is on; Pin, shared by every Space, stays. Not with reduced
   * motion.
   */
  #slide(direction) {
    let body = this.spaceBody;
    if (
      !body ||
      !direction ||
      reducedMotion()
    ) {
      return;
    }
    body.removeAttribute("slide");
    // Restarts the animation when a switch comes before the last one ended.
    body.getBoundingClientRect();
    body.setAttribute("slide", direction > 0 ? "next" : "previous");
    body.addEventListener(
      "animationend",
      () => body.removeAttribute("slide"),
      { once: true }
    );
  }

  /**
   * A sideways scroll (a trackpad swipe) goes to the next Space or the
   * previous one, once per swipe, going round like the shortcuts. A scroll
   * mostly up or down is the tab list's.
   */
  #onWheel(event) {
    let { deltaX, deltaY } = event;
    if (event.deltaMode == WheelEvent.DOM_DELTA_LINE) {
      deltaX *= 16;
    }
    let now = performance.now();
    if (now - this.#swipe.at > SWIPE_END) {
      this.#swipe = { distance: 0, switched: false, at: now };
    }
    if (Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }
    event.preventDefault();
    this.#swipe.at = now;
    if (this.#swipe.switched) {
      return;
    }
    this.#swipe.distance += deltaX * this.#direction;
    if (Math.abs(this.#swipe.distance) >= SWIPE_DISTANCE) {
      this.#swipe.switched = true;
      window.OrbitoShell?.spaces?.step(Math.sign(this.#swipe.distance));
    }
  }

  async focusRegion() {
    if (this.collapsed) {
      this.peek();
      await this.updateComplete;
    }
    this.tabList.focusRegion();
  }

  /** Collapses or brings back the Sidebar, in every window. */
  toggleCollapsed() {
    let collapsing = !Services.prefs.getBoolPref(COLLAPSED_PREF, false);
    let hadFocus = this.matches(":focus-within");
    Services.prefs.setBoolPref(COLLAPSED_PREF, collapsing);
    this.peeking = false;
    if (this.collapsed && hadFocus) {
      gBrowser.selectedBrowser.focus();
    }
  }

  /** Shows the collapsed Sidebar over the page. */
  peek() {
    clearTimeout(this.#peekTimer);
    if (this.collapsed) {
      this.peeking = true;
    }
  }

  /**
   * Hides the peeking Sidebar now; focus in it goes to the page. Not while
   * a tab or the handle is being dragged.
   */
  hidePeek() {
    clearTimeout(this.#peekTimer);
    if (!this.peeking || this.#resize || this.tabList.dragging) {
      return;
    }
    let hadFocus = this.matches(":focus-within");
    this.peeking = false;
    if (hadFocus) {
      gBrowser.selectedBrowser.focus();
    }
  }

  /**
   * Hides the peeking Sidebar a moment after the pointer and focus have left
   * it, and not while a tab or the handle is being dragged.
   */
  endPeek() {
    clearTimeout(this.#peekTimer);
    if (!this.peeking) {
      return;
    }
    this.#peekTimer = setTimeout(() => {
      if (this.#resize || this.tabList.dragging) {
        this.endPeek();
      } else if (!this.matches(":hover") && !this.matches(":focus-within")) {
        this.peeking = false;
      }
    }, PEEK_LINGER);
  }

  updated(changed) {
    if (changed.has("collapsed")) {
      this.dispatchEvent(new CustomEvent("OrbitoSidebarToggle"));
      // A window resized narrow or back collapses or brings it back at
      // once: the resize moves the page already.
      if (changed.get("collapsed") !== undefined && !changed.has("narrow")) {
        this.#playToggle(changed.get("peeking") ?? this.peeking);
      }
    }
  }

  /**
   * Moves the page with the Sidebar as it collapses or comes back, unless
   * the user prefers reduced motion. Collapsing, the Sidebar's column
   * narrows to the gap before the page as the Sidebar slides out
   * (orbito.css), for as long; coming back, the column widens as the
   * Sidebar, at its width, slides in with the column's edge, or stays put
   * if it was peeking.
   *
   * @param {boolean} peeked Whether the Sidebar was peeking.
   */
  #playToggle(peeked) {
    for (let animation of this.#toggleMotion) {
      animation.cancel();
    }
    this.#toggleMotion = [];
    let grid = this.parentElement;
    if (reducedMotion() || !grid) {
      return;
    }
    let width = `${this.width}px`;
    let gap = getComputedStyle(grid).getPropertyValue("--orbito-gap").trim();
    // orbito.css's columns, with the Sidebar's as it was.
    let columns = `${this.collapsed ? width : gap} auto auto minmax(0, 1fr) auto`;
    let timing = { duration: motionMs(this, "long"), easing: motionEase(this) };
    this.#toggleMotion.push(
      grid.animate([{ gridTemplateColumns: columns, offset: 0 }], timing)
    );
    if (!this.collapsed) {
      let shift = peeked ? 0 : parseFloat(gap) - this.width;
      if (document.dir == "rtl") {
        shift = -shift;
      }
      this.#toggleMotion.push(
        this.animate(
          [
            { boxSizing: "border-box", width, translate: `${shift}px` },
            { boxSizing: "border-box", width, translate: "0px" },
          ],
          timing
        )
      );
    }
  }

  // The resize handle: drag it, or use the arrow keys, Home and End.
  // Double-clicking it goes back to the default width.

  get #direction() {
    return document.dir == "rtl" ? -1 : 1;
  }

  #onResizeStart(event) {
    if (event.button != 0) {
      return;
    }
    event.preventDefault();
    let handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    this.#resize = { x: event.clientX, width: this.width };
    this.toggleAttribute("resizing", true);
    // The whole window, so the pointer keeps the cursor and selects nothing
    // wherever the drag takes it.
    let { style } = document.documentElement;
    style.cursor = "col-resize";
    style.userSelect = "none";
  }

  #onResizeMove(event) {
    if (!this.#resize) {
      return;
    }
    let { x, width } = this.#resize;
    this.#applyWidth(
      clampWidth(width + this.#direction * (event.clientX - x))
    );
  }

  #onResizeEnd() {
    if (!this.#resize) {
      return;
    }
    this.#resize = null;
    this.removeAttribute("resizing");
    let { style } = document.documentElement;
    style.cursor = "";
    style.userSelect = "";
    this.#saveWidth(this.width);
  }

  #onResizeKey(event) {
    let width;
    switch (event.key) {
      case "ArrowLeft":
        width = this.width - this.#direction * RESIZE_STEP;
        break;
      case "ArrowRight":
        width = this.width + this.#direction * RESIZE_STEP;
        break;
      case "Home":
        width = SIDEBAR_WIDTH.min;
        break;
      case "End":
        width = SIDEBAR_WIDTH.max;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.#saveWidth(width);
  }

  #toggle() {
    if (window.OrbitoShell?.toggleSidebar) {
      window.OrbitoShell.toggleSidebar();
    } else {
      this.toggleCollapsed();
    }
  }

  render() {
    let shortcut = AppConstants.platform == "macosx" ? "⌘S" : "Ctrl+S";
    let collapseLabel = this.narrow
      ? t("orbito-sidebar-hide")
      : this.collapsed
        ? t("orbito-sidebar-keep-open")
        : t("orbito-sidebar-collapse");
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/orbito/shell/orbito-sidebar.css"
      />
      <div class="top">
        <slot name="window-buttons"></slot>
        <span class="spacer"></span>
        <button
          class="collapse"
          aria-label=${collapseLabel}
          title=${t("orbito-sidebar-collapse-title", {
            label: collapseLabel,
            shortcut,
          })}
          @mousedown=${event => event.preventDefault()}
          @click=${() => this.#toggle()}
        ></button>
        <button
          class="bookmarks"
          aria-label=${t("orbito-sidebar-bookmarks")}
          title=${t("orbito-sidebar-bookmarks")}
          @mousedown=${event => event.preventDefault()}
          @click=${() => PlacesCommandHook.showPlacesOrganizer("AllBookmarks")}
        >
          ${BOOKMARK_ICON}
        </button>
        <slot name="top-actions"></slot>
      </div>
      <slot name="pins"></slot>
      <div class="space-body">
        <slot name="space-title"></slot>
        <slot name="dock"></slot>
        <orbito-tab-list></orbito-tab-list>
      </div>
      <slot name="footer"></slot>
      <div
        class="resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label=${t("orbito-sidebar-resize")}
        aria-valuemin=${SIDEBAR_WIDTH.min}
        aria-valuemax=${SIDEBAR_WIDTH.max}
        aria-valuenow=${this.width}
        title=${t("orbito-sidebar-resize-title")}
        tabindex="0"
        @mousedown=${event => event.preventDefault()}
        @pointerdown=${this.#onResizeStart}
        @pointermove=${this.#onResizeMove}
        @pointerup=${this.#onResizeEnd}
        @pointercancel=${this.#onResizeEnd}
        @lostpointercapture=${this.#onResizeEnd}
        @dblclick=${() => this.#saveWidth(SIDEBAR_WIDTH.default)}
        @keydown=${this.#onResizeKey}
      ></div>
    `;
  }
}
customElements.define("orbito-sidebar", OrbitoSidebar);
