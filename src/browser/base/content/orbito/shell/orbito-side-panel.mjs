/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html } from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const PANELS_URL = "chrome://browser/content/webext-panels.xhtml";

/**
 * The head of the side panel: Firefox's sidebar (#sidebar-box), which
 * orbito.css shows as an overlay card next to the Sidebar, over the page.
 * The model and controller are Firefox's (ADR 0001): SidebarController
 * opens it, for an extension's sidebar_action (from the extensions panel,
 * the extension itself, its shortcut or the View menu) or for Firefox's
 * own panels (history, bookmarks).
 *
 * An extension's panel gets this head (its icon, its title, a close
 * button) in place of the one Firefox draws inside it. Firefox's own
 * panels keep theirs, which holds their search box; orbito.css hides this
 * one for them. Escape in the panel closes it, as its close button does.
 */
export class OrbitoSidePanelHeader extends MozLitElement {
  static queries = {
    closeButton: ".close",
    heading: ".title",
  };

  #observer = new MutationObserver(() => this.#changed());

  /** Firefox's sidebar box the head is in. */
  get box() {
    return document.getElementById("sidebar-box");
  }

  get isOpen() {
    return SidebarController.isOpen;
  }

  /** The open panel's entry in Firefox's sidebar list, if any. */
  get #sidebar() {
    return this.isOpen
      ? SidebarController.sidebars.get(SidebarController.currentID)
      : null;
  }

  /** Whether the open panel is an extension's (sidebar_action). */
  get isExtension() {
    return !!this.#sidebar?.extensionId;
  }

  /** The open panel's title. */
  get title() {
    let sidebar = this.#sidebar;
    return (
      sidebar?.label || sidebar?.title || t("orbito-side-panel-default-title")
    );
  }

  /** Puts the head at the top of Firefox's sidebar box. */
  static create() {
    let header = document.createElement("orbito-side-panel-header");
    header.id = "orbito-side-panel-header";
    let box = header.box;
    box.querySelector(".sidebar-browser-stack").before(header);
    box.setAttribute("role", "complementary");
    return header;
  }

  connectedCallback() {
    super.connectedCallback();
    this.#observer.observe(this.box, {
      attributes: true,
      attributeFilter: ["hidden", "sidebarcommand"],
    });
    window.addEventListener("SidebarItemChanged", this);
    this.box.addEventListener("keydown", this);
    SidebarController.browser.addEventListener("load", this, true);
    this.#changed();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#observer.disconnect();
    window.removeEventListener("SidebarItemChanged", this);
    this.box.removeEventListener("keydown", this);
    SidebarController.browser.removeEventListener("load", this, true);
  }

  handleEvent(event) {
    switch (event.type) {
      case "SidebarItemChanged":
        this.#changed();
        break;
      case "load":
        this.#panelLoaded(event.target);
        break;
      case "keydown":
        if (
          event.key == "Escape" &&
          !event.defaultPrevented &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
          this.close();
        }
        break;
    }
  }

  #changed() {
    this.box.setAttribute(
      "aria-label",
      t("orbito-side-panel-label", { title: this.title })
    );
    this.box.toggleAttribute("orbito-extension", this.isExtension);
    this.requestUpdate();
  }

  /**
   * An extension's panel document (Firefox's webext-panels page, which
   * holds the extension's page) loses Firefox's head: this one stands
   * in for it.
   *
   * @param {Document} doc
   */
  #panelLoaded(doc) {
    if (doc?.documentURI != PANELS_URL) {
      return;
    }
    let header = doc.getElementById("sidebar-panel-header");
    if (header) {
      header.style.display = "none";
    }
  }

  /** Closes the panel; focus goes to the page. */
  close() {
    SidebarController.hide();
  }

  /**
   * Focuses what the panel shows: an extension's page, or Firefox's own
   * panel.
   */
  focusRegion() {
    let browser = SidebarController.browser;
    let page = browser.contentDocument?.getElementById("webext-panels-browser");
    (page ?? browser).focus();
  }

  render() {
    let icon = this.#sidebar?.iconUrl;
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/orbito/shell/orbito-side-panel.css"
      />
      ${icon
        ? html`<img class="icon" src=${icon} alt="" />`
        : html`<span class="icon"></span>`}
      <span class="title">${this.title}</span>
      <span class="chip">${t("orbito-side-panel-extension")}</span>
      <button
        class="close"
        aria-label=${t("orbito-side-panel-close")}
        title=${t("orbito-side-panel-close")}
        @click=${() => this.close()}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
        </svg>
      </button>
    `;
  }
}
customElements.define("orbito-side-panel-header", OrbitoSidePanelHeader);
