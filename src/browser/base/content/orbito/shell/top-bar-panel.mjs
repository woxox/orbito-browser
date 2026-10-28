/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MozLitElement } from "chrome://global/content/lit-utils.mjs";

// The window's Top bar panels (this module is the window's).
const panels = new Set();

/**
 * A panel that opens under a Top bar button (site information, extensions,
 * downloads): the element lives in a XUL arrow panel (`panel`) in the
 * window's popup set, opened at the button with the position the button's
 * doorhangers use.
 *
 * Subclasses name the panel and the button, render rows marked `data-item`
 * and bind `onKeyDown` on their container: Up/Down (wrapping), Home and End
 * move between the rows. Opened from the keyboard (or with no event), focus
 * goes to the first row; Escape closes the panel and puts focus back on the
 * button. The panel closes on a tab switch, a top-level navigation and focus
 * moving to an element out of it, and holds doorhangers back while open.
 * It pops in as it opens and fades out as it closes (orbito.css); another
 * opening ends the fade at once, so that two never show together.
 */
export class OrbitoTopBarPanel extends MozLitElement {
  /** The XUL panel's id and accessible name. */
  static panelId = "";
  static label = "";
  /** The event fired on the window when the panel opens or closes. */
  static toggleEvent = "";
  /** Where the panel opens at the button, as for XUL openPopup. */
  static position = "bottomleft topleft";

  /** The XUL panel the element shows in. */
  panel = null;
  /** Whether the panel opened from the keyboard, so focus goes into it. */
  #byKeyboard = false;

  /**
   * Makes the element and the panel it shows in, in the window's popup set.
   */
  static create() {
    let panel = document.createXULElement("panel");
    panel.id = this.panelId;
    panel.setAttribute("type", "arrow");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", this.label);
    panel.setAttribute("noautofocus", "true");
    let element = document.createElement(customElements.getName(this));
    element.panel = panel;
    panel.append(element);
    document.getElementById("mainPopupSet").append(panel);
    for (let type of ["popupshown", "popuphiding", "popuphidden"]) {
      panel.addEventListener(type, element);
    }
    panels.add(element);
    return element;
  }

  /** The Top bar button the panel opens under. */
  get button() {
    throw new Error("Not implemented");
  }

  /** The rows the arrow keys move between. */
  get items() {
    return this.renderRoot.querySelectorAll("[data-item]");
  }

  get isOpen() {
    return this.panel.state == "open" || this.panel.state == "showing";
  }

  /** Called before the panel renders to open. */
  willOpen() {}

  /** Called once the panel shows, and once it is gone. */
  panelShown() {}
  panelHidden() {}

  /**
   * Opens the panel under the button.
   *
   * @param {Event} [event] What opened it; from the keyboard (or with no
   *   event), focus goes to the panel's first row.
   * @param {object} [options]
   * @param {boolean} [options.byKeyboard] Whether focus goes to the first
   *   row, in place of what the event tells.
   */
  async open(event, { byKeyboard } = {}) {
    let button = this.button;
    if (this.isOpen || !button?.checkVisibility()) {
      return;
    }
    await Promise.all([...panels].map(element => element.#endFade()));
    this.#byKeyboard =
      byKeyboard ??
      (!event ||
        event.view != window ||
        event.type.startsWith("key") ||
        (event.type == "click" && event.detail == 0));
    this.willOpen();
    this.requestUpdate();
    await this.updateComplete;
    this.panel.openPopup(button, {
      position: this.constructor.position,
      triggerEvent: event?.view == window ? event : null,
    });
  }

  close() {
    if (this.isOpen) {
      // As a click outside does it: the panel waits for its fade.
      this.panel.hidePopup(true);
    }
  }

  // Ends the panel's fade out at once, once it is gone: the popup manager
  // hides it as the transition ends.
  async #endFade() {
    let panel = this.panel;
    if (panel.state != "hiding") {
      return;
    }
    let hidden = new Promise(resolve =>
      panel.addEventListener("popuphidden", resolve, { once: true })
    );
    for (let animation of panel.getAnimations()) {
      animation.finish();
    }
    await hidden;
  }

  toggle(event) {
    if (this.isOpen) {
      this.close();
    } else {
      this.open(event);
    }
  }

  /**
   * Closes the panel, then runs fn: for what opens another popup (a
   * doorhanger, which the panel holds back while open, or an extension's).
   *
   * @param {Function} fn
   */
  closeThen(fn) {
    this.panel.addEventListener("popuphidden", () => fn(), { once: true });
    this.close();
  }

  handleEvent(event) {
    switch (event.type) {
      case "popupshown":
        if (event.target != this.panel) {
          return;
        }
        // Doorhangers wait until the panel closes, as with Firefox's
        // identity popup.
        window.PopupNotifications.suppressWhileOpen(this.panel);
        window.addEventListener("focus", this, true);
        gBrowser.tabContainer.addEventListener("TabSelect", this);
        gBrowser.addProgressListener(this);
        this.panelShown();
        if (this.#byKeyboard) {
          this.items[0]?.focus({ focusVisible: true });
        }
        this.#toggled();
        break;
      case "popuphiding":
        if (
          event.target == this.panel &&
          this.panel.contains(document.activeElement)
        ) {
          // Focus goes back to the button once the panel is gone.
          let byKeyboard = this.#byKeyboard;
          this.panel.addEventListener(
            "popuphidden",
            () => this.button?.focus({ focusVisible: byKeyboard }),
            { once: true }
          );
        }
        break;
      case "popuphidden":
        if (event.target != this.panel) {
          return;
        }
        window.removeEventListener("focus", this, true);
        gBrowser.tabContainer.removeEventListener("TabSelect", this);
        gBrowser.removeProgressListener(this);
        this.panelHidden();
        this.#toggled();
        break;
      case "focus":
        // Focus that moves to an element out of the panel (F6, a click in
        // the page) closes it; the window getting focus back does not.
        if (
          Element.isInstance(event.target) &&
          !this.panel.contains(event.target)
        ) {
          this.close();
        }
        break;
      case "TabSelect":
        this.close();
        break;
    }
  }

  // Progress listener of the selected browser, while open.
  onLocationChange(webProgress, request, location, flags) {
    if (
      webProgress.isTopLevel &&
      !(flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT)
    ) {
      this.close();
    }
  }

  QueryInterface = ChromeUtils.generateQI([
    "nsIWebProgressListener",
    "nsISupportsWeakReference",
  ]);

  #toggled() {
    window.dispatchEvent(new CustomEvent(this.constructor.toggleEvent));
  }

  onKeyDown(event) {
    let items = [...this.items];
    let index = items.indexOf(event.target);
    if (index == -1 || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    let next;
    switch (event.key) {
      case "ArrowDown":
        next = items[(index + 1) % items.length];
        break;
      case "ArrowUp":
        next = items.at(index - 1);
        break;
      case "Home":
        next = items[0];
        break;
      case "End":
        next = items.at(-1);
        break;
      default:
        return;
    }
    event.preventDefault();
    next.focus({ focusVisible: true });
  }
}
