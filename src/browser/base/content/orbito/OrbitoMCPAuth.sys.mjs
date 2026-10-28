/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * OAuth logins for MCP servers, following the MCP Authorization spec
 * (OAuth 2.1): the server's Protected Resource Metadata names its
 * authorization server, whose metadata gives the endpoints. The client is
 * registered dynamically (RFC 7591) when the server allows it, or else is
 * the client id (and secret) the user entered. The login itself runs in a
 * tab like Sign in with ChatGPT (OrbitoOAuth.sys.mjs), asking for the
 * server as the resource (RFC 8707).
 *
 * Per server, the password manager keeps:
 *   "MCP server tokens <id>": {access, refresh, expires, scopes, tokenURL,
 *     clientId, resource}
 *   "MCP server client <id>": {clientId, clientSecret?, issuer?,
 *     dynamic}, the registered or entered client
 */

import {
  authServerMetadataURLs,
  canonicalResource,
  chooseScope,
  endpointsFrom,
  mcpAuthorizeURL,
  pkce,
  randomToken,
  resourceMetadataURLs,
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

// Not the ChatGPT login's path; nothing listens on it either.
export const REDIRECT_URI = "http://127.0.0.1:1455/mcp/callback";

/** The server needs a (new) login before it can be used. */
export class NeedsLogin extends Error {
  constructor(message, { scope = null } = {}) {
    super(message);
    this.needsLogin = true;
    this.scope = scope;
  }
}

function tokensRealm(id) {
  return `MCP server tokens ${id}`;
}

function clientRealm(id) {
  return `MCP server client ${id}`;
}

async function getJSON(url) {
  let response = await fetch(url, {
    headers: { Accept: "application/json" },
    credentials: "omit",
  });
  if (!response.ok) {
    response.body?.cancel();
    return null;
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function firstJSON(urls) {
  for (let url of urls) {
    let json = await getJSON(url);
    if (json && typeof json == "object") {
      return json;
    }
  }
  return null;
}

export const OrbitoMCPAuth = {
  // id -> a refresh in progress, shared by concurrent requests.
  _refreshing: new Map(),

  /**
   * Finds a server's authorization server and its endpoints.
   *
   * @param {string} serverURL
   * @param {?object} challenge The parameters of the server's
   *   WWW-Authenticate challenge.
   */
  async discover(serverURL, challenge) {
    let resource = await firstJSON(resourceMetadataURLs(serverURL, challenge));
    let issuer = resource?.authorization_servers?.[0];
    if (!issuer) {
      throw new Error(t("orbito-assistant-mcp-no-login-server"));
    }
    let metadata = await firstJSON(authServerMetadataURLs(issuer));
    if (!metadata) {
      throw new Error(
        t("orbito-assistant-mcp-login-metadata", { issuer })
      );
    }
    return {
      issuer,
      endpoints: endpointsFrom(metadata, issuer),
      resourceScopes: Array.isArray(resource.scopes_supported)
        ? resource.scopes_supported
        : [],
    };
  },

  /**
   * The client to log in with: the one entered for the server, the one
   * registered before with this login server, or a newly registered one.
   */
  async _client(server, issuer, endpoints) {
    if (server.clientId) {
      return {
        clientId: server.clientId,
        clientSecret:
          (await lazy.OrbitoSecrets.getJSON(clientRealm(server.id)))
            ?.clientSecret || "",
        dynamic: false,
      };
    }
    let saved = await lazy.OrbitoSecrets.getJSON(clientRealm(server.id));
    if (saved?.dynamic && saved.issuer == issuer) {
      return saved;
    }
    if (!endpoints.registration) {
      let error = new Error(t("orbito-assistant-mcp-needs-client"));
      error.needsClient = true;
      throw error;
    }
    let response = await fetch(endpoints.registration, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_name: "Orbito",
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
      credentials: "omit",
    });
    let json = null;
    try {
      json = await response.json();
    } catch {}
    if (!response.ok || !json?.client_id) {
      throw new Error(
        json?.error_description
          ? t("orbito-assistant-mcp-register-failed-reason", {
              reason: json.error_description,
            })
          : t("orbito-assistant-mcp-register-failed")
      );
    }
    let client = {
      clientId: json.client_id,
      clientSecret: json.client_secret || "",
      issuer,
      dynamic: true,
    };
    await lazy.OrbitoSecrets.setJSON(clientRealm(server.id), client, server.name);
    return client;
  },

  /** Keeps the secret of a client id the user entered. */
  setClientSecret(server, clientSecret) {
    return lazy.OrbitoSecrets.setJSON(
      clientRealm(server.id),
      clientSecret ? { clientSecret, dynamic: false } : null,
      server.name
    );
  },

  _secretOptions(client, endpoints) {
    if (!client.clientSecret) {
      return { params: {}, clientSecret: null };
    }
    // client_secret_basic unless the server only takes client_secret_post.
    let methods = endpoints.tokenAuthMethods;
    if (
      methods.includes("client_secret_post") &&
      !methods.includes("client_secret_basic")
    ) {
      return { params: { client_secret: client.clientSecret }, clientSecret: null };
    }
    return { params: {}, clientSecret: client.clientSecret };
  },

  /**
   * Logs in to a server in a tab and keeps its tokens.
   *
   * @param {object} server The server's config.
   * @param {object} options
   * @param {?object} options.challenge From the server's last 401 or 403.
   * @param {AbortSignal} [options.signal]
   */
  async login(server, { challenge, signal } = {}) {
    let { issuer, endpoints, resourceScopes } = await this.discover(
      server.url,
      challenge
    );
    let client = await this._client(server, issuer, endpoints);
    let { verifier, challenge: codeChallenge } = await pkce();
    let state = randomToken();
    let resource = canonicalResource(server.url);
    let params = await lazy.OrbitoOAuth.login({
      url: mcpAuthorizeURL({
        authorizeURL: endpoints.authorize,
        clientId: client.clientId,
        redirectURI: REDIRECT_URI,
        state,
        challenge: codeChallenge,
        scope: chooseScope({
          challenge: challenge?.scope,
          resource: resourceScopes,
          server: endpoints.scopes,
        }),
        resource,
      }),
      redirectURI: REDIRECT_URI,
      state,
      signal,
    });
    let secret = this._secretOptions(client, endpoints);
    let json = await lazy.OrbitoOAuth.requestToken(
      endpoints.token,
      {
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: REDIRECT_URI,
        client_id: client.clientId,
        code_verifier: verifier,
        resource,
        ...secret.params,
      },
      { clientSecret: secret.clientSecret, signal }
    );
    await this._saveTokens(server, {
      ...tokenFromResponse(json, Date.now()),
      tokenURL: endpoints.token,
      tokenAuthMethods: endpoints.tokenAuthMethods,
      clientId: client.clientId,
      resource,
    });
  },

  _saveTokens(server, tokens) {
    return lazy.OrbitoSecrets.setJSON(tokensRealm(server.id), tokens, server.name);
  },

  hasTokens(server) {
    return lazy.OrbitoSecrets.getJSON(tokensRealm(server.id)).then(t => !!t);
  },

  /**
   * The access token for a server's requests, refreshed first if it has
   * expired.
   *
   * @param {object} server
   * @param {object} [options]
   * @param {boolean} [options.refresh] The server refused the last one.
   * @returns {Promise<string>}
   * @throws {NeedsLogin}
   */
  async accessToken(server, { refresh = false } = {}) {
    let tokens = await lazy.OrbitoSecrets.getJSON(tokensRealm(server.id));
    if (!tokens?.access) {
      throw new NeedsLogin(`Log in to ${server.name} to use it.`);
    }
    if (refresh || (tokens.expires && tokens.expires <= Date.now())) {
      let refreshing = this._refreshing.get(server.id);
      if (!refreshing) {
        refreshing = this._refresh(server, tokens).finally(() =>
          this._refreshing.delete(server.id)
        );
        this._refreshing.set(server.id, refreshing);
      }
      tokens = await refreshing;
    }
    return tokens.access;
  },

  async _refresh(server, tokens) {
    let expired = new NeedsLogin(
      `Your login to ${server.name} has expired. Log in again in settings.`
    );
    if (!tokens.refresh || !tokens.tokenURL) {
      throw expired;
    }
    let client = (await lazy.OrbitoSecrets.getJSON(clientRealm(server.id))) || {};
    let secret = this._secretOptions(
      { clientSecret: client.clientSecret },
      { tokenAuthMethods: tokens.tokenAuthMethods || [] }
    );
    let json;
    try {
      json = await lazy.OrbitoOAuth.requestToken(
        tokens.tokenURL,
        {
          grant_type: "refresh_token",
          refresh_token: tokens.refresh,
          client_id: tokens.clientId,
          resource: tokens.resource,
          ...secret.params,
        },
        { clientSecret: secret.clientSecret }
      );
    } catch (e) {
      // Only a refused refresh ends the login; offline, rate limits or
      // server errors may pass.
      if (e.status != 400 && e.status != 401) {
        throw e;
      }
      throw expired;
    }
    let refreshed = { ...tokens, ...tokenFromResponse(json, Date.now(), tokens) };
    await this._saveTokens(server, refreshed);
    return refreshed;
  },

  /** Forgets a server's tokens and registered client. */
  async logout(server) {
    await lazy.OrbitoSecrets.set(tokensRealm(server.id), "");
    let client = await lazy.OrbitoSecrets.getJSON(clientRealm(server.id));
    if (client?.dynamic) {
      await lazy.OrbitoSecrets.set(clientRealm(server.id), "");
    }
  },

  /** Forgets everything kept for a server that is being removed. */
  async forget(server) {
    await lazy.OrbitoSecrets.set(tokensRealm(server.id), "");
    await lazy.OrbitoSecrets.set(clientRealm(server.id), "");
  },
};
