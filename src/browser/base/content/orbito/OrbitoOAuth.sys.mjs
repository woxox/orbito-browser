/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * OAuth logins in a tab, for Sign in with ChatGPT and MCP servers.
 *
 * The login page runs in a new tab of a normal window. When that tab is
 * about to go to the login's loopback redirect URI, the request is caught
 * by an http-on-modify-request observer and cancelled before it reaches
 * the network: no local server listens, so nothing else on the port (such
 * as the Codex CLI) is involved. The callback's parameters are read from
 * the URL and the tab is closed.
 */

import { parseCallback } from "chrome://browser/content/orbito/OrbitoOAuthProtocol.sys.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
});

class LoginCancelled extends Error {
  constructor(message = t("orbito-assistant-login-cancelled")) {
    super(message);
    this.cancelled = true;
  }
}

/** Logins waiting for their callback. */
const pending = new Set();

const observer = {
  observe(subject, topic) {
    if (topic != "http-on-modify-request" || !pending.size) {
      return;
    }
    let channel = subject.QueryInterface(Ci.nsIHttpChannel);
    let url = channel.URI.spec;
    for (let login of pending) {
      let result = parseCallback(url, login);
      if (!result) {
        continue;
      }
      // Never let a request to a callback address out, even one with
      // someone else's state.
      channel.cancel(Cr.NS_BINDING_ABORTED);
      if (!result.ignored) {
        login.finish(result);
        return;
      }
    }
  },
};

function watch(login) {
  if (!pending.size) {
    Services.obs.addObserver(observer, "http-on-modify-request");
  }
  pending.add(login);
}

function unwatch(login) {
  pending.delete(login);
  if (!pending.size) {
    Services.obs.removeObserver(observer, "http-on-modify-request");
  }
}

export const OrbitoOAuth = {
  LoginCancelled,

  /**
   * Opens a login page in a new tab and waits for its callback.
   *
   * @param {object} options
   * @param {string} options.url The authorize URL.
   * @param {string} options.redirectURI
   * @param {string} options.state
   * @param {AbortSignal} [options.signal] Cancels the login.
   * @returns {Promise<object>} The callback's query parameters.
   */
  async login({ url, redirectURI, state, signal }) {
    let win = lazy.BrowserWindowTracker.getTopWindow({ private: false });
    if (!win) {
      throw new Error(t("orbito-assistant-login-needs-window"));
    }
    let { promise, resolve, reject } = Promise.withResolvers();
    let tab = null;
    let login = {
      redirectURI,
      state,
      finish(result) {
        if (result.error) {
          reject(
            new Error(
              t("orbito-assistant-login-failed", { error: result.error })
            )
          );
        } else {
          resolve(result.params);
        }
      },
    };
    let onClose = () => reject(new LoginCancelled());
    let onAbort = () => reject(new LoginCancelled());
    watch(login);
    try {
      if (signal?.aborted) {
        throw new LoginCancelled();
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      tab = win.gBrowser.addTab(url, {
        triggeringPrincipal:
          Services.scriptSecurityManager.createNullPrincipal({}),
      });
      win.gBrowser.selectedTab = tab;
      win.focus();
      tab.addEventListener("TabClose", onClose, { once: true });
      return await promise;
    } finally {
      unwatch(login);
      signal?.removeEventListener("abort", onAbort);
      if (tab) {
        tab.removeEventListener("TabClose", onClose);
        let tabWindow = tab.documentGlobal;
        if (!tab.closing && tabWindow && !tabWindow.closed) {
          // The page is gone mid-redirect; don't wait for it to agree.
          tabWindow.gBrowser.removeTab(tab, { skipPermitUnload: true });
        }
      }
    }
  },

  /**
   * Posts a form to a token endpoint.
   *
   * @param {string} url
   * @param {object} params
   * @param {object} [options]
   * @param {string} [options.clientSecret] Sent with HTTP basic auth.
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<object>} The response's JSON.
   */
  async requestToken(url, params, { clientSecret, signal } = {}) {
    let headers = {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (clientSecret) {
      let encode = value =>
        encodeURIComponent(value).replace(/%20/g, "+");
      headers.Authorization = `Basic ${btoa(`${encode(params.client_id)}:${encode(clientSecret)}`)}`;
    }
    let body = new URLSearchParams();
    for (let [key, value] of Object.entries(params)) {
      if (value != null && value !== "") {
        body.set(key, value);
      }
    }
    let response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal,
      credentials: "omit",
    });
    let json = null;
    try {
      json = await response.json();
    } catch {}
    if (!response.ok) {
      let detail = json?.error_description || json?.error || "";
      let error = new Error(
        `The token request failed (${response.status})${detail ? `: ${detail}` : "."}`
      );
      error.status = response.status;
      error.oauthError = json?.error || null;
      throw error;
    }
    if (!json || typeof json != "object") {
      throw new Error("The token response was not JSON.");
    }
    return json;
  },
};
