/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Updates to Orbito, from the public repository's latest release
 * (scripts/release/make-update.sh). Firefox's update service checks for,
 * downloads and stages them in the background; this follows it with one
 * AppUpdater for the app, so the Shell can offer the restart that applies an
 * update in place of Firefox's app menu, which it hides.
 */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AppUpdater: "resource://gre/modules/AppUpdater.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

// The first check waits for the window to settle.
const FIRST_CHECK_DELAY_MS = 10_000;
// The background check found an update: it waits for the user (without
// automatic updates), or is downloaded and ready, or nearly.
const UPDATE_TOPICS = ["update-available", "update-downloaded", "update-staged"];

class Updates {
  #updater = null;
  #listeners = new Set();

  /** The AppUpdater status, null until the first check. */
  status = null;
  /** Bytes downloaded and in all, while downloading. */
  progress = 0;
  progressMax = 0;
  /** Whether the user asked to update: it then restarts once ready. */
  requested = false;

  get STATUS() {
    return lazy.AppUpdater.STATUS;
  }

  /** Whether this build updates itself: release builds have an update URL. */
  get supported() {
    return (
      AppConstants.MOZ_UPDATER &&
      !!(
        Services.appinfo.updateURL ||
        Services.policies?.getActivePolicies()?.AppUpdateURL
      )
    );
  }

  /** The version of the update found, if any. */
  get version() {
    return this.#updater?.update?.displayVersion ?? null;
  }

  /** Starts following updates, once for the app. */
  init() {
    if (this.#updater || !this.supported) {
      return;
    }
    this.#updater = new lazy.AppUpdater();
    this.#updater.addListener((status, progress = 0, progressMax = 0) => {
      this.status = status;
      this.progress = progress;
      this.progressMax = progressMax;
      if (status == this.STATUS.READY_FOR_RESTART && this.requested) {
        this.restart();
        return;
      }
      if (this.STATUS.isTerminalStatus(status)) {
        this.requested = false;
      }
      for (let listener of this.#listeners) {
        listener();
      }
    });
    for (let topic of UPDATE_TOPICS) {
      Services.obs.addObserver(this, topic);
    }
    lazy.setTimeout(() => this.check(), FIRST_CHECK_DELAY_MS);
  }

  observe() {
    this.check();
  }

  /** Checks for an update, or follows the one under way. */
  check() {
    this.#updater?.check();
  }

  /**
   * Applies the update found: downloads it if need be, then restarts. Without
   * one to install here, opens its release page.
   */
  update() {
    let { STATUS } = this;
    switch (this.status) {
      case STATUS.READY_FOR_RESTART:
        this.restart();
        break;
      case STATUS.MANUAL_UPDATE:
        this.#openReleasePage();
        break;
      case STATUS.DOWNLOAD_AND_INSTALL:
        this.requested = true;
        this.#updater.allowUpdateDownload();
        break;
    }
  }

  restart() {
    let cancel = Cc["@mozilla.org/supports-PRBool;1"].createInstance(
      Ci.nsISupportsPRBool
    );
    Services.obs.notifyObservers(cancel, "quit-application-requested", "restart");
    if (!cancel.data) {
      Services.startup.quit(
        Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart
      );
    }
  }

  #openReleasePage() {
    let url = Services.urlFormatter.formatURLPref("app.update.url.manual");
    Services.wm
      .getMostRecentBrowserWindow()
      ?.openTrustedLinkIn(url, "tab");
  }

  addListener(listener) {
    this.#listeners.add(listener);
  }

  removeListener(listener) {
    this.#listeners.delete(listener);
  }
}

export const OrbitoUpdates = new Updates();
