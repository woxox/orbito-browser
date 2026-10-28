/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html } from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const ICONS = {
  minimize: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 8h10" />
  </svg>`,
  maximize: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3.5" y="3.5" width="9" height="9" />
  </svg>`,
  restore: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3.5" y="5.5" width="7" height="7" />
    <path d="M5.5 5.5v-2h7v7h-2" />
  </svg>`,
  close: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
  </svg>`,
};

/**
 * Minimize, maximize (or restore) and close, drawn by the Shell where the
 * OS does not draw them over the window (Windows, Linux). They run the
 * window's own commands, as Firefox's title bar buttons do.
 */
export class OrbitoWindowControls extends MozLitElement {
  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("sizemodechange", this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("sizemodechange", this);
  }

  handleEvent() {
    this.requestUpdate();
  }

  #command(id) {
    document.getElementById(id).doCommand();
  }

  render() {
    let maximized = window.windowState == window.STATE_MAXIMIZED;
    let sizeLabel = maximized
      ? t("orbito-window-restore")
      : t("orbito-window-maximize");
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/orbito/shell/orbito-window-controls.css"
      />
      <button
        class="minimize"
        aria-label=${t("orbito-window-minimize")}
        title=${t("orbito-window-minimize")}
        @click=${() => this.#command("cmd_minimizeWindow")}
      >
        ${ICONS.minimize}
      </button>
      <button
        class=${maximized ? "restore" : "maximize"}
        aria-label=${sizeLabel}
        title=${sizeLabel}
        @click=${() =>
          this.#command(maximized ? "cmd_restoreWindow" : "cmd_maximizeWindow")}
      >
        ${maximized ? ICONS.restore : ICONS.maximize}
      </button>
      <button
        class="close"
        aria-label=${t("orbito-window-close")}
        title=${t("orbito-window-close")}
        @click=${() => this.#command("cmd_closeWindow")}
      >
        ${ICONS.close}
      </button>
    `;
  }
}
customElements.define("orbito-window-controls", OrbitoWindowControls);
