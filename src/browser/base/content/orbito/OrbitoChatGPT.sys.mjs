/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The ChatGPT login (Sign in with ChatGPT), which lets the ChatGPT backend
 * use the user's subscription. The login registers a new OAuth client each
 * time (the callback carries its id) and must be granted the
 * chatgpt.tokens.use.direct scope. Tokens are kept in the password manager
 * as {access, refresh, expires, clientId, scopes, email}.
 *
 * Neither the Codex CLI's client id, its ~/.codex/auth.json nor the Codex
 * app-server are used.
 */

import {
  jwtClaims,
  missingScope,
  pkce,
  randomToken,
  SIWC,
  siwcAuthorizeURL,
  tokenFromResponse,
} from "chrome://browser/content/orbito/OrbitoOAuthProtocol.sys.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  OrbitoOAuth: "chrome://browser/content/orbito/OrbitoOAuth.sys.mjs",
  OrbitoSecrets: "chrome://browser/content/orbito/OrbitoSecrets.sys.mjs",
});

const REALM = "ChatGPT Login";
// This installation's id, sent as ext_agent_host_id.
const HOST_ID_PREF = "orbito.chatgpt.hostId";

function pref(name, fallback) {
  return Services.prefs.getStringPref(name, "") || fallback;
}

export const OrbitoChatGPT = {
  // "signed_out" | "signing_in" | "signed_in" | "needs_login"
  _state: null,
  _email: "",
  _error: null,
  _login: null,
  _refreshing: null,
  _listeners: new Set(),

  get authorizeURL() {
    return pref("orbito.chatgpt.authorizeURL", SIWC.authorizeURL);
  },

  get tokenURL() {
    return pref("orbito.chatgpt.tokenURL", SIWC.tokenURL);
  },

  addListener(listener) {
    this._listeners.add(listener);
  },

  removeListener(listener) {
    this._listeners.delete(listener);
  },

  _set(state, { email = this._email, error = null } = {}) {
    this._state = state;
    this._email = email;
    this._error = error;
    for (let listener of this._listeners) {
      try {
        listener();
      } catch (e) {
        console.error(e);
      }
    }
  },

  /**
   * @returns {Promise<{state: string, email: string, error: ?string}>}
   */
  async status() {
    if (!this._state) {
      let tokens = await this._tokens();
      this._state ??= tokens ? "signed_in" : "signed_out";
      this._email ||= tokens?.email || "";
    }
    return { state: this._state, email: this._email, error: this._error };
  },

  _tokens() {
    return lazy.OrbitoSecrets.getJSON(REALM);
  },

  _saveTokens(tokens) {
    return lazy.OrbitoSecrets.setJSON(REALM, tokens, "ChatGPT");
  },

  _hostId() {
    let id = Services.prefs.getStringPref(HOST_ID_PREF, "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
      id = Services.uuid.generateUUID().toString().slice(1, -1);
      Services.prefs.setStringPref(HOST_ID_PREF, id);
    }
    return id;
  },

  /**
   * Logs in in a new tab. Resolves once logged in; failures and
   * cancellations are reported through status() rather than thrown.
   */
  async login() {
    this.cancelLogin();
    let controller = new AbortController();
    this._login = controller;
    let previous = await this.status();
    this._set("signing_in", { email: previous.email });
    try {
      let { verifier, challenge } = await pkce();
      let state = randomToken();
      let params = await lazy.OrbitoOAuth.login({
        url: siwcAuthorizeURL({
          authorizeURL: this.authorizeURL,
          hostId: this._hostId(),
          state,
          challenge,
          nonce: randomToken(),
        }),
        redirectURI: SIWC.redirectURI,
        state,
        signal: controller.signal,
      });
      let clientId = params.client_id;
      if (!clientId) {
        throw new Error("The login did not say which client it registered.");
      }
      let json = await lazy.OrbitoOAuth.requestToken(
        this.tokenURL,
        {
          grant_type: "authorization_code",
          client_id: clientId,
          code: params.code,
          code_verifier: verifier,
          redirect_uri: SIWC.redirectURI,
          resource: SIWC.resource,
        },
        { signal: controller.signal }
      );
      let missing = missingScope(json.scope, [SIWC.directScope]);
      if (missing.length) {
        throw new Error(
          t("orbito-assistant-chatgpt-scope-missing", {
            scopes: missing.join(", "),
          })
        );
      }
      let tokens = {
        ...tokenFromResponse(json, Date.now()),
        clientId,
        email: this._emailOf(json.id_token),
      };
      await this._saveTokens(tokens);
      this._set("signed_in", { email: tokens.email });
    } catch (e) {
      if (this._login != controller) {
        // A newer login took over.
        return;
      }
      let tokens = await this._tokens();
      this._set(tokens ? previous.state : "signed_out", {
        email: tokens ? previous.email : "",
        error: e.message || String(e),
      });
    } finally {
      if (this._login == controller) {
        this._login = null;
      }
    }
  },

  _emailOf(idToken) {
    let claims = jwtClaims(idToken);
    return (
      claims.email || claims["https://api.openai.com/profile"]?.email || ""
    );
  },

  /**
   * The access token for the Responses API, refreshed first if it has
   * expired.
   *
   * @param {object} [options]
   * @param {boolean} [options.refresh] Refresh even if it has not expired,
   *   e.g. because the API refused it.
   * @returns {Promise<string>}
   * @throws {Error} with needsLogin when there is no login, or it could not
   *   be refreshed.
   */
  async accessToken({ refresh = false } = {}) {
    let tokens = await this._tokens();
    if (!tokens?.access) {
      throw this._needsLogin(null);
    }
    if (refresh || (tokens.expires && tokens.expires <= Date.now())) {
      // Questions running at the same time share one refresh.
      this._refreshing ??= this._refresh(tokens).finally(
        () => (this._refreshing = null)
      );
      tokens = await this._refreshing;
    }
    return tokens.access;
  },

  async _refresh(tokens) {
    if (!tokens.refresh || !tokens.clientId) {
      throw this._needsLogin(tokens);
    }
    let json;
    try {
      json = await lazy.OrbitoOAuth.requestToken(this.tokenURL, {
        grant_type: "refresh_token",
        client_id: tokens.clientId,
        refresh_token: tokens.refresh,
        resource: SIWC.resource,
      });
    } catch (e) {
      // Only a refused refresh ends the login; offline, rate limits or
      // server errors may pass.
      if (e.status != 400 && e.status != 401) {
        throw e;
      }
      throw this._needsLogin(tokens);
    }
    if (json.scope && missingScope(json.scope, [SIWC.directScope]).length) {
      throw this._needsLogin(tokens);
    }
    let refreshed = {
      ...tokens,
      ...tokenFromResponse(json, Date.now(), tokens),
      email: this._emailOf(json.id_token) || tokens.email,
    };
    await this._saveTokens(refreshed);
    if (this._state != "signed_in") {
      this._set("signed_in", { email: refreshed.email });
    }
    return refreshed;
  },

  _needsLogin(tokens) {
    let error = new Error(
      tokens
        ? t("orbito-assistant-chatgpt-login-expired")
        : t("orbito-assistant-chatgpt-sign-in")
    );
    error.needsLogin = true;
    if (tokens && this._state != "needs_login") {
      this._set("needs_login");
    }
    return error;
  },

  /** Stops a login waiting in its tab. */
  cancelLogin() {
    this._login?.abort();
  },

  /** Forgets the tokens. */
  async logout() {
    this.cancelLogin();
    await this._saveTokens(null);
    this._set("signed_out", { email: "" });
  },
};
