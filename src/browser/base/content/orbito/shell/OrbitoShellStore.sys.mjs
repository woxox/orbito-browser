/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Shell's lists that the whole profile shares, every window seeing the
 * same ones: the Space list now, the Pin list and each Space's Dock later.
 * One JSON file in the profile (orbito-shell.json), a top-level key per
 * list. What belongs to one tab or one window (which Space a tab is in,
 * which Space a window shows) is in the session instead, with the tab or
 * window it belongs to.
 *
 * A window reads a list as it starts, before it draws, so the file is read
 * at once on first use. Writes go to disk shortly after (and at the latest
 * at shutdown); every window hears of them at once, by the
 * "orbito-shell-store-changed" notification, its data being the key.
 *
 * Load it with ChromeUtils.importESModule, not a static import from a
 * window's module, which would give that window a store of its own.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  JSONFile: "resource://gre/modules/JSONFile.sys.mjs",
});

export const STORE_CHANGED = "orbito-shell-store-changed";

let file = null;

function data() {
  if (!file) {
    file = new lazy.JSONFile({
      path: PathUtils.join(PathUtils.profileDir, "orbito-shell.json"),
    });
  }
  file.ensureDataReady();
  return file.data;
}

export const OrbitoShellStore = {
  /**
   * A list as stored, or undefined when none is. A copy: change it with
   * set().
   *
   * @param {string} key
   */
  get(key) {
    let value = data()[key];
    return value === undefined ? undefined : structuredClone(value);
  },

  /**
   * Stores a list (anything JSON can hold) and tells every window.
   *
   * @param {string} key
   * @param {any} value
   */
  set(key, value) {
    data()[key] = structuredClone(value);
    file.saveSoon();
    Services.obs.notifyObservers(null, STORE_CHANGED, key);
  },
};
