/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, nothing } from "chrome://global/content/vendor/lit.all.mjs";
import { OrbitoTopBarPanel } from "chrome://browser/content/orbito/shell/top-bar-panel.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const { DownloadsViewUI } = ChromeUtils.importESModule(
  "moz-src:///browser/components/downloads/DownloadsViewUI.sys.mjs"
);

const ICONS = {
  folder: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
  </svg>`,
  cancel: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </svg>`,
};

/**
 * One download's commands, as Firefox's downloads panel and Library run
 * them (open, show in folder, cancel, retry, unblock).
 */
class DownloadItem extends DownloadsViewUI.DownloadElementShell {
  constructor(download, element) {
    super();
    this.download = download;
    this.element = element;
  }
}

/**
 * A size in bytes for people to read, e.g. "1.5 MB".
 *
 * @param {number} bytes
 */
function size(bytes) {
  return DownloadUtils.convertByteUnits(bytes).join(" ");
}

/**
 * The downloads panel the Top bar's downloads button opens: the window's
 * downloads (this session's, newest first) with their progress, and the way
 * to all downloads in the Library. It is built over Firefox's downloads
 * model (ADR 0001): DownloadsCommon's data for the list, Firefox's download
 * item commands for what a row does. Firefox's downloads panel stays in the
 * DOM, unused.
 *
 * A row does the download's main action: opens a finished file, retries a
 * failed or canceled download, resumes a paused one, shows a running one in
 * its folder; the button after it shows a finished file in its folder or
 * cancels a running download. See OrbitoTopBarPanel for the panel and its
 * keys.
 */
export class OrbitoDownloads extends OrbitoTopBarPanel {
  static panelId = "orbito-downloads-panel";
  static label = t("orbito-downloads-title");
  static toggleEvent = "OrbitoDownloadsToggle";
  // Where Firefox opens its downloads panel.
  static position = "bottomright topright";

  static queries = {
    downloadRows: { all: ".download" },
    libraryRow: ".library",
  };

  /** The window's downloads, newest first, and their items. */
  #downloads = [];
  #items = new WeakMap();
  #data = null;

  connectedCallback() {
    super.connectedCallback();
    this.#data = DownloadsCommon.getData(window);
    this.#data.addView(this);
    // Also when the window closes, which leaves the element connected: the
    // data outlives the window.
    window.addEventListener("unload", this.#removeView);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#removeView();
  }

  #removeView = () => {
    window.removeEventListener("unload", this.#removeView);
    this.#data.removeView(this);
  };

  get button() {
    // A narrow window hides the downloads button; the panel opens under the
    // URL display then.
    let { downloadsButton, urlDisplay } = window.OrbitoShell.topBar;
    return downloadsButton?.checkVisibility() ? downloadsButton : urlDisplay;
  }

  willOpen() {
    // Files may have been moved or deleted since; Firefox's panel checks
    // too. Each answer comes back as a change of the download.
    for (let download of this.#downloads) {
      download.refresh().catch(console.error);
    }
  }

  panelShown() {
    // The button's attention dot is for downloads not seen yet.
    DownloadsCommon.getIndicatorData(window).attentionSuppressed |=
      DownloadsCommon.SUPPRESS_PANEL_OPEN;
  }

  panelHidden() {
    DownloadsCommon.getIndicatorData(window).attentionSuppressed &=
      ~DownloadsCommon.SUPPRESS_PANEL_OPEN;
  }

  // View of DownloadsCommon's downloads data, which sends the list oldest
  // first, then each new download.
  onDownloadAdded(download) {
    this.#downloads.unshift(download);
    this.#items.set(download, new DownloadItem(download, this));
    this.requestUpdate();
  }

  onDownloadChanged() {
    this.requestUpdate();
  }

  onDownloadRemoved(download) {
    this.#downloads = this.#downloads.filter(d => d != download);
    if (!this.#downloads.length) {
      // The button goes with the last download.
      this.close();
    }
    this.requestUpdate();
  }

  onDownloadBatchStarting() {}
  onDownloadBatchEnded() {}

  /** The window's downloads, newest first. */
  get downloads() {
    return [...this.#downloads];
  }

  /** The row of a download, while the panel shows it. */
  rowFor(download) {
    return [...this.downloadRows].find(row => row.download == download);
  }

  /**
   * What a download's row says and does, as
   * {status, progress, main, mainLabel, action, actionLabel, icon}:
   * progress is a percentage while it runs (-1 when the size is unknown),
   * main and action are Firefox download item commands.
   *
   * @param {Download} download
   */
  #describe(download) {
    let item = this.#items.get(download);
    let enabled = command => item.isCommandEnabled(command);
    let transfer = download.hasProgress
      ? t("orbito-downloads-transfer", {
          current: size(download.currentBytes),
          total: size(download.totalBytes),
        })
      : size(download.currentBytes);
    let row = { main: "", action: "", progress: null };
    switch (DownloadsCommon.stateOfDownload(download)) {
      case DownloadsCommon.DOWNLOAD_NOTSTARTED:
        row.status = t("orbito-downloads-starting");
        row.action = "downloadsCmd_cancel";
        break;
      case DownloadsCommon.DOWNLOAD_DOWNLOADING:
        row.status = download.hasProgress
          ? t("orbito-downloads-progress", {
              transfer,
              percent: download.progress,
            })
          : transfer;
        row.progress = download.hasProgress ? download.progress : -1;
        row.main = "downloadsCmd_show";
        row.action = "downloadsCmd_cancel";
        break;
      case DownloadsCommon.DOWNLOAD_PAUSED:
        row.status = t("orbito-downloads-paused", { transfer });
        row.progress = download.hasProgress ? download.progress : -1;
        row.main = "downloadsCmd_pauseResume";
        row.action = "downloadsCmd_cancel";
        break;
      case DownloadsCommon.DOWNLOAD_FINISHED:
        if (download.target.exists) {
          let known = download.target.size !== undefined;
          row.status = known
            ? t("orbito-downloads-done-size", { size: size(download.target.size) })
            : t("orbito-downloads-done");
          row.main = "downloadsCmd_open";
          row.action = "downloadsCmd_show";
        } else {
          row.status = download.deleted
            ? t("orbito-downloads-deleted")
            : t("orbito-downloads-missing");
        }
        break;
      case DownloadsCommon.DOWNLOAD_FAILED:
        row.status = t("orbito-downloads-failed");
        row.main = "downloadsCmd_retry";
        break;
      case DownloadsCommon.DOWNLOAD_CANCELED:
        row.status = t("orbito-downloads-canceled");
        row.main = "downloadsCmd_retry";
        break;
      case DownloadsCommon.DOWNLOAD_DIRTY:
        row.status = t("orbito-downloads-dirty");
        // Firefox's dialog to remove the file or keep it anyway.
        row.main = download.hasBlockedData ? "unblock" : "";
        break;
      default:
        row.status = t("orbito-downloads-blocked");
    }
    if (row.main && row.main != "unblock" && !enabled(row.main)) {
      row.main = "";
    }
    if (row.action && !enabled(row.action)) {
      row.action = "";
    }
    row.mainLabel = {
      downloadsCmd_open: t("orbito-downloads-open"),
      downloadsCmd_show: t("orbito-downloads-show"),
      downloadsCmd_pauseResume: t("orbito-downloads-resume"),
      downloadsCmd_retry: t("orbito-downloads-retry"),
      unblock: t("orbito-downloads-review"),
    }[row.main];
    row.actionLabel = {
      downloadsCmd_show: t("orbito-downloads-show"),
      downloadsCmd_cancel: t("orbito-downloads-cancel"),
    }[row.action];
    return row;
  }

  /**
   * Runs a download item command, then closes the panel when it hands off
   * to something else (a file, a folder, a dialog), as Firefox's does.
   *
   * @param {Download} download
   * @param {string} command
   */
  #run(download, command) {
    let item = this.#items.get(download);
    switch (command) {
      case "":
        return;
      case "unblock":
        this.close();
        item.confirmUnblock(window, "chooseUnblock");
        return;
      case "downloadsCmd_open":
      case "downloadsCmd_show":
        this.close();
        break;
    }
    item.doCommand(command);
  }

  #icon(download) {
    // As Firefox's: the file's own icon once it is there.
    return download.target.path
      ? `moz-icon://${download.target.path}?size=32${download.succeeded ? "&state=normal" : ""}`
      : "moz-icon://.unknown?size=32";
  }

  #showLibrary() {
    this.close();
    BrowserCommands.downloadsUI();
  }

  #renderDownload(download) {
    let row = this.#describe(download);
    let name = DownloadsViewUI.getDisplayName(download);
    if (typeof name != "string") {
      name = DownloadsViewUI.getStrippedUrl(download);
    }
    let progress =
      row.progress === null
        ? nothing
        : html`<span
            class="bar"
            ?undetermined=${row.progress < 0}
            ?paused=${download.stopped}
            style=${row.progress < 0 ? "" : `--progress: ${row.progress}%`}
          ></span>`;
    return html`<div class="entry">
      <button
        class="item download"
        data-item
        .download=${download}
        aria-disabled=${!row.main}
        aria-label=${row.mainLabel
          ? t("orbito-downloads-row-label-action", {
              name,
              status: row.status,
              action: row.mainLabel,
            })
          : t("orbito-downloads-row-label", { name, status: row.status })}
        title=${row.mainLabel ?? name}
        @click=${() => this.#run(download, row.main)}
      >
        <img class="icon" src=${this.#icon(download)} alt="" />
        <span class="grow"
          ><span class="name">${name}</span
          ><span class="sub">${row.status}</span>${progress}</span
        >
      </button>
      ${row.action
        ? html`<button
            class="item action"
            data-item
            data-command=${row.action}
            aria-label=${t("orbito-downloads-action-label", {
              action: row.actionLabel,
              name,
            })}
            title=${row.actionLabel}
            @click=${() => this.#run(download, row.action)}
          >
            ${row.action == "downloadsCmd_cancel" ? ICONS.cancel : ICONS.folder}
          </button>`
        : nothing}
    </div>`;
  }

  render() {
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/orbito/shell/top-bar-panel.css"
      />
      <link
        rel="stylesheet"
        href="chrome://browser/content/orbito/shell/orbito-downloads.css"
      />
      <div class="body" @keydown=${this.onKeyDown}>
        <div class="head">
          <div class="title">${t("orbito-downloads-title")}</div>
        </div>
        <div class="list">
          ${this.#downloads.map(download => this.#renderDownload(download))}
        </div>
        <div class="sep"></div>
        <button class="item library" data-item @click=${this.#showLibrary}>
          ${t("orbito-downloads-show-all")}
        </button>
      </div>
    `;
  }
}
customElements.define("orbito-downloads", OrbitoDownloads);
