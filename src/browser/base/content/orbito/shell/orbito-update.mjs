/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, nothing } from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);
const { OrbitoUpdates } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoUpdates.sys.mjs"
);

/**
 * The Sidebar's note of an update: ready, or found and waiting for the user.
 * One click applies it, restarting Orbito. Hidden while there is none, or
 * while one downloads in the background.
 */
export class OrbitoUpdate extends MozLitElement {
  #onChange = () => this.requestUpdate();

  connectedCallback() {
    super.connectedCallback();
    OrbitoUpdates.addListener(this.#onChange);
    // OrbitoUpdates outlives the window, whose unload leaves the element
    // connected.
    window.addEventListener("unload", this.#removeListener, { once: true });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#removeListener();
  }

  #removeListener = () => OrbitoUpdates.removeListener(this.#onChange);

  #content() {
    let { STATUS, status, version, requested } = OrbitoUpdates;
    switch (status) {
      case STATUS.READY_FOR_RESTART:
        return [t("orbito-update-ready"), t("orbito-update-ready-detail")];
      case STATUS.DOWNLOAD_AND_INSTALL:
        return [
          t("orbito-update-available", { version }),
          t("orbito-update-available-detail"),
        ];
      case STATUS.MANUAL_UPDATE:
        return [
          t("orbito-update-available", { version }),
          t("orbito-update-manual-detail"),
        ];
      case STATUS.DOWNLOADING:
      case STATUS.STAGING: {
        if (!requested) {
          return null;
        }
        let { progress, progressMax } = OrbitoUpdates;
        let percent =
          progressMax > 0 ? Math.floor((progress / progressMax) * 100) : 0;
        return [
          t("orbito-update-downloading"),
          t("orbito-update-downloading-detail", { percent }),
          true,
        ];
      }
    }
    return null;
  }

  render() {
    let content = this.#content();
    this.hidden = !content;
    if (!content) {
      return nothing;
    }
    let [label, detail, busy = false] = content;
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/orbito/shell/orbito-update.css"
      />
      <button
        class="update"
        ?disabled=${busy}
        aria-busy=${busy}
        @click=${() => OrbitoUpdates.update()}
      >
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
        </svg>
        <span class="text">
          <span class="label">${label}</span>
          <span class="detail">${detail}</span>
        </span>
      </button>
    `;
  }
}
customElements.define("orbito-update", OrbitoUpdate);
