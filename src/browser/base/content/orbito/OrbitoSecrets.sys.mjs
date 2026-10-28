/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Secrets the assistant keeps in the browser's password manager (API keys,
 * MCP server headers, OAuth tokens), one login per realm under a single
 * chrome origin, so that none of them end up in prefs.
 */

const ORIGIN = "chrome://orbito-assistant";

async function find(realm) {
  let logins = await Services.logins.searchLoginsAsync({
    origin: ORIGIN,
    httpRealm: realm,
  });
  return logins[0] || null;
}

export const OrbitoSecrets = {
  ORIGIN,

  /** @returns {Promise<string>} The secret, or "" if there is none. */
  async get(realm) {
    return (await find(realm))?.password || "";
  },

  /**
   * Replaces the secret kept for a realm; an empty value removes it.
   *
   * @param {string} realm
   * @param {string} value
   * @param {string} [username] Shown in the password manager.
   */
  async set(realm, value, username = realm) {
    let existing = await find(realm);
    if (existing) {
      await Services.logins.removeLoginAsync(existing);
    }
    if (!value) {
      return;
    }
    let login = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(
      Ci.nsILoginInfo
    );
    login.init(ORIGIN, null, realm, username, value, "", "");
    await Services.logins.addLoginAsync(login);
  },

  /** A JSON value kept as a secret, or null. */
  async getJSON(realm) {
    let value = await this.get(realm);
    try {
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  },

  setJSON(realm, value, username) {
    return this.set(realm, value ? JSON.stringify(value) : "", username);
  },
};
