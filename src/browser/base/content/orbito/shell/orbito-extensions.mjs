/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, nothing } from "chrome://global/content/vendor/lit.all.mjs";
import { OrbitoTopBarPanel } from "chrome://browser/content/orbito/shell/top-bar-panel.mjs";
import { waitingRequests } from "chrome://browser/content/orbito/shell/orbito-top-bar.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const { ExtensionParent } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionParent.sys.mjs"
);

/**
 * The extensions panel the Top bar's extensions button opens: the
 * extension requests (doorhangers) waiting for an answer, the extensions
 * that run in this window, and the way to the extensions manager. It is
 * built over Firefox's models (ADR 0001): gUnifiedExtensions for the list,
 * each extension's browser action for its button. Firefox's unified
 * extensions panel stays in the DOM, unused.
 *
 * A row of an extension with a toolbar button does what that button does:
 * opens its popup, which shows under the extensions button, or tells the
 * extension it was clicked. Other rows open the extension's details in the
 * extensions manager. An extension with a sidebar panel (sidebar_action)
 * has a button after its row that opens or closes that panel, as the side
 * panel next to the Sidebar (orbito-side-panel.mjs). See OrbitoTopBarPanel
 * for the panel and its keys.
 */
export class OrbitoExtensions extends OrbitoTopBarPanel {
  static panelId = "orbito-extensions-panel";
  static label = t("orbito-extensions-title");
  static toggleEvent = "OrbitoExtensionsToggle";
  // Where Firefox opens its extensions panel and extension popups.
  static position = "bottomright topright";

  static queries = {
    extensionRows: { all: ".extension" },
    sidePanelButtons: { all: ".side-panel" },
    requestRows: { all: ".request" },
    manageRow: ".manage",
    emptyState: ".empty",
  };

  get button() {
    return window.OrbitoShell.topBar.extensionsButton;
  }

  willOpen() {
    // Firefox's panel holds the extensions' toolbar buttons (widgets) the
    // rows run; they are made once it is.
    void gUnifiedExtensions.panel;
  }

  panelShown() {
    ExtensionParent.apiManager.on("ready", this.#onExtensionsChanged);
    ExtensionParent.apiManager.on("shutdown", this.#onExtensionsChanged);
  }

  panelHidden() {
    ExtensionParent.apiManager.off("ready", this.#onExtensionsChanged);
    ExtensionParent.apiManager.off("shutdown", this.#onExtensionsChanged);
  }

  #onExtensionsChanged = () => this.requestUpdate();

  /**
   * The extensions that run in this window, by name, as
   * [{extension, action, name, sub, badge, icon, enabled}]; action is the
   * extension's browser action, if it has a toolbar button.
   */
  #extensions() {
    let tab = gBrowser.selectedTab;
    let dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    let policies = gUnifiedExtensions.getActivePolicies();
    policies.sort((a, b) => a.name.localeCompare(b.name));
    return policies.map(policy => {
      let { extension } = policy;
      let action = gUnifiedExtensions.browserActionFor(policy);
      if (!action?.widget) {
        return {
          extension,
          action: null,
          name: extension.name,
          icon: extension.getPreferredIcon(32),
          enabled: true,
        };
      }
      let data = action.action.getContextData(tab);
      let icon = ExtensionParent.IconDetails.getPreferredIcon(
        data.icon,
        extension,
        32
      ).icon;
      // Icons with theme variants: "light" is the one for light themes.
      if (typeof icon == "object") {
        icon = dark ? icon.dark : icon.light;
      }
      return {
        extension,
        action,
        name: extension.name,
        sub: data.title && data.title != extension.name ? data.title : "",
        badge: data.badgeText,
        icon,
        enabled: data.enabled,
      };
    });
  }

  /**
   * Does what the extension's toolbar button does, as a click on it would,
   * once the panel is gone: the popup opens under the extensions button
   * (see shell.mjs anchorExtensionPopups).
   *
   * @param {object} action The extension's browser action.
   */
  #runAction(action) {
    let button = action.widget
      .forWindow(window)
      .node?.querySelector(".unified-extensions-item-action-button");
    if (!button) {
      return;
    }
    this.closeThen(() =>
      button.dispatchEvent(
        new CustomEvent("command", { bubbles: true, cancelable: true })
      )
    );
  }

  /**
   * Opens the extension's panel (its sidebar_action) as the side panel, or
   * closes it if it is the one open; focus goes into it.
   *
   * @param {string} commandID The panel's id in Firefox's sidebar list.
   */
  #toggleSidePanel(commandID) {
    this.close();
    SidebarController.toggle(commandID);
  }

  #openDetails(extension) {
    this.close();
    BrowserAddonUI.manageAddon(extension.id, "unifiedExtensions");
  }

  #openManager() {
    this.close();
    BrowserAddonUI.openAddonsMgr("addons://list/extension");
  }

  #reshow(notification) {
    this.closeThen(() => notification.reshow());
  }

  #requestText(notification) {
    return Object.values(
      window.PopupNotifications._formatDescriptionMessage(notification)
    ).join("");
  }

  #renderEmpty() {
    let [title, sub] =
      gUnifiedExtensions.isPrivateWindowMissingExtensionsWithoutPBMAccess()
        ? [
            t("orbito-extensions-private-empty"),
            t("orbito-extensions-private-empty-sub"),
          ]
        : [t("orbito-extensions-empty"), t("orbito-extensions-empty-sub")];
    return html`<div class="empty">
      <div class="empty-title">${title}</div>
      <div class="sub">${sub}</div>
    </div>`;
  }

  #renderExtension(item) {
    let { extension } = item;
    // Its panel (sidebar_action) in Firefox's sidebar list, if it has one.
    let [sidePanel] =
      [...SidebarController.sidebars].find(
        ([, sidebar]) => sidebar.extensionId == extension.id
      ) ?? [];
    if (!sidePanel) {
      return this.#renderRow(item);
    }
    let open = SidebarController.currentID == sidePanel;
    let label = open
      ? t("orbito-extensions-close-panel")
      : t("orbito-extensions-open-panel");
    return html`<div class="entry">
      ${this.#renderRow(item)}
      <button
        class="item side-panel"
        data-item
        aria-label=${t("orbito-extensions-side-panel-label", {
          action: label,
          name: item.name,
        })}
        aria-pressed=${open}
        @click=${() => this.#toggleSidePanel(sidePanel)}
      >
        <span class="mini">${label}</span>
      </button>
    </div>`;
  }

  #renderRow(item) {
    let { extension, action } = item;
    return html`<button
      class="item extension"
      data-item
      data-extension=${extension.id}
      aria-disabled=${!item.enabled}
      title=${action ? item.sub || item.name : t("orbito-extensions-details")}
      @click=${() =>
        action
          ? item.enabled && this.#runAction(action)
          : this.#openDetails(extension)}
    >
      <img class="icon" src=${item.icon} alt="" />
      <span class="grow"
        ><span class="name">${item.name}</span>${item.sub
          ? html`<span class="sub">${item.sub}</span>`
          : nothing}</span
      >
      ${item.badge ? html`<span class="badge">${item.badge}</span>` : nothing}
      ${action
        ? nothing
        : html`<span class="mini ghost"
            >${t("orbito-extensions-details")}</span
          >`}
    </button>`;
  }

  render() {
    let requests = waitingRequests("extensions");
    let extensions = this.#extensions();
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/orbito/shell/top-bar-panel.css"
      />
      <link
        rel="stylesheet"
        href="chrome://browser/content/orbito/shell/orbito-extensions.css"
      />
      <div class="body" @keydown=${this.onKeyDown}>
        <div class="head">
          <div class="title">${t("orbito-extensions-title")}</div>
        </div>
        ${requests.length
          ? html`<div class="section">${t("orbito-extensions-waiting")}</div>
              ${requests.map(
                n => html`<button
                  class="item request"
                  data-item
                  @click=${() => this.#reshow(n)}
                >
                  <span class="grow">${this.#requestText(n)}</span>
                  <span class="mini">${t("orbito-extensions-answer")}</span>
                </button>`
              )}
              <div class="sep"></div>`
          : nothing}
        ${extensions.length
          ? extensions.map(item => this.#renderExtension(item))
          : this.#renderEmpty()}
        <div class="sep"></div>
        <button class="item manage" data-item @click=${this.#openManager}>
          ${t("orbito-extensions-manage")}
        </button>
      </div>
    `;
  }
}
customElements.define("orbito-extensions", OrbitoExtensions);
