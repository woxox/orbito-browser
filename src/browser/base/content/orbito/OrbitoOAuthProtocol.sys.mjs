/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The parts of the assistant's OAuth logins (OrbitoOAuth.sys.mjs) that need
 * no browser: PKCE, authorize URLs, reading callbacks and token responses.
 * Sign in with ChatGPT and MCP server logins both use them.
 */

/** Sign in with ChatGPT; the URLs can be changed by prefs for tests. */
export const SIWC = {
  authorizeURL: "https://auth.openai.com/api/accounts/authorize",
  tokenURL: "https://auth.openai.com/api/accounts/oauth/token",
  resource: "https://api.openai.com/v1",
  redirectURI: "http://127.0.0.1:1455/auth/callback",
  // Each login registers a new client; the callback carries its id.
  dynamicClientId: "dynamic_agent_client",
  agentName: "Orbito",
  directScope: "chatgpt.tokens.use.direct",
  scope:
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
};

// Tokens are refreshed this long before they expire.
const EXPIRY_MARGIN_MS = 3 * 60 * 1000;

export function base64url(bytes) {
  let binary = "";
  for (let byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A random value for state, nonce and PKCE verifiers. */
export function randomToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The S256 code challenge for a PKCE verifier. */
export async function challengeFor(verifier) {
  let digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return base64url(new Uint8Array(digest));
}

/** @returns {Promise<{verifier: string, challenge: string}>} */
export async function pkce() {
  let verifier = randomToken();
  return { verifier, challenge: await challengeFor(verifier) };
}

/** An endpoint URL with these query parameters added. */
export function withParams(endpoint, params) {
  let url = new URL(endpoint);
  for (let [key, value] of Object.entries(params)) {
    if (value != null && value !== "") {
      url.searchParams.set(key, value);
    }
  }
  return url.href;
}

/**
 * The URL that starts Sign in with ChatGPT.
 *
 * @param {object} options
 * @param {string} options.authorizeURL
 * @param {string} options.hostId This installation's UUID.
 * @param {string} options.state
 * @param {string} options.challenge
 * @param {string} options.nonce
 */
export function siwcAuthorizeURL({
  authorizeURL,
  hostId,
  state,
  challenge,
  nonce,
}) {
  return withParams(authorizeURL, {
    client_id: SIWC.dynamicClientId,
    agent_name_hint: SIWC.agentName,
    ext_agent_host_id: `urn:uuid:${hostId}`,
    response_type: "code",
    redirect_uri: SIWC.redirectURI,
    resource: SIWC.resource,
    scope: SIWC.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    nonce,
  });
}

/**
 * Reads a URL the login tab is going to.
 *
 * @param {string} url
 * @param {object} expected {redirectURI, state}
 * @returns {?({code: string, params: object} | {error: string} |
 *   {ignored: string})} null if the URL is not the callback; ignored if it
 *   is not this login's (wrong state); error if the login failed.
 */
export function parseCallback(url, { redirectURI, state }) {
  let parsed;
  let redirect = new URL(redirectURI);
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.origin != redirect.origin ||
    parsed.pathname != redirect.pathname
  ) {
    return null;
  }
  let params = Object.fromEntries(parsed.searchParams);
  if (params.state != state) {
    return { ignored: "The state did not match." };
  }
  if (params.error) {
    return { error: params.error_description || params.error };
  }
  if (!params.code) {
    return { error: "The callback had no code." };
  }
  return { code: params.code, params };
}

/** The required scopes a granted scope string leaves out. */
export function missingScope(granted, required) {
  let scopes = new Set(String(granted ?? "").split(/\s+/).filter(Boolean));
  return required.filter(scope => !scopes.has(scope));
}

/**
 * The tokens to keep from a token endpoint's response.
 *
 * @param {object} json
 * @param {number} now
 * @param {object} [previous] Tokens being refreshed; their refresh token
 *   and scopes stay if the response has none.
 * @returns {{access: string, refresh: ?string, expires: ?number,
 *   scopes: string[]}}
 */
export function tokenFromResponse(json, now, previous = null) {
  if (typeof json?.access_token != "string" || !json.access_token) {
    throw new Error("The token response had no access token.");
  }
  let expiresIn = Number(json.expires_in);
  return {
    access: json.access_token,
    refresh: json.refresh_token || previous?.refresh || null,
    expires:
      expiresIn > 0 ? now + expiresIn * 1000 - EXPIRY_MARGIN_MS : null,
    scopes: json.scope
      ? String(json.scope).split(/\s+/).filter(Boolean)
      : previous?.scopes || [],
  };
}

/** The claims of a JWT such as an ID token, unverified; {} if unreadable. */
export function jwtClaims(token) {
  try {
    let payload = String(token).split(".")[1];
    let binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    let bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    let claims = JSON.parse(new TextDecoder().decode(bytes));
    return claims && typeof claims == "object" ? claims : {};
  } catch {
    return {};
  }
}

/* MCP server logins (MCP Authorization, OAuth 2.1). */

/**
 * The parameters of the Bearer challenge in a WWW-Authenticate header, with
 * lowercase names; null if there is none.
 *
 * @param {?string} header
 * @returns {?object}
 */
export function parseWWWAuthenticate(header) {
  if (!header) {
    return null;
  }
  // scheme [token68 | auth-param, ...], with challenges separated by
  // commas too: a word followed by a space starts a challenge.
  let pattern =
    /\s*(?:([A-Za-z][\w!#$%&'*+.^`|~-]*)(?=\s+[^\s=,]|\s*,|\s*$)\s*)?(?:([\w!#$%&'*+.^`|~-]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^\s,]*))?\s*,?/gy;
  let challenges = [];
  let match;
  while (pattern.lastIndex < header.length && (match = pattern.exec(header))) {
    if (!match[0]) {
      break;
    }
    let [, scheme, name, value] = match;
    if (scheme) {
      challenges.push({ scheme: scheme.toLowerCase(), params: {} });
    }
    if (name && challenges.length) {
      if (value.startsWith('"')) {
        value = value.slice(1, -1).replace(/\\(.)/g, "$1");
      }
      challenges.at(-1).params[name.toLowerCase()] = value;
    }
  }
  return challenges.find(c => c.scheme == "bearer")?.params ?? null;
}

/**
 * Where to look for a server's Protected Resource Metadata (RFC 9728): the
 * challenge's resource_metadata, or else the well-known URLs for the
 * server's path and its origin.
 */
export function resourceMetadataURLs(serverURL, challenge) {
  if (challenge?.resource_metadata) {
    return [challenge.resource_metadata];
  }
  let url = new URL(serverURL);
  let path = url.pathname.replace(/\/+$/, "");
  let urls = [];
  if (path) {
    urls.push(`${url.origin}/.well-known/oauth-protected-resource${path}`);
  }
  urls.push(`${url.origin}/.well-known/oauth-protected-resource`);
  return urls;
}

/**
 * Where to look for an authorization server's metadata: RFC 8414, then
 * OpenID Connect discovery in both its forms.
 */
export function authServerMetadataURLs(issuer) {
  let url = new URL(issuer);
  let path = url.pathname.replace(/\/+$/, "");
  if (!path) {
    return [
      `${url.origin}/.well-known/oauth-authorization-server`,
      `${url.origin}/.well-known/openid-configuration`,
    ];
  }
  return [
    `${url.origin}/.well-known/oauth-authorization-server${path}`,
    `${url.origin}/.well-known/openid-configuration${path}`,
    `${url.origin}${path}/.well-known/openid-configuration`,
  ];
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

/**
 * The endpoints and options in the authorization server metadata of
 * issuer, which must be the metadata's own (RFC 8414 3.3): the MCP server
 * names the issuer, and could name one that hands out another's endpoints.
 *
 * @returns {{authorize: string, token: string, registration: ?string,
 *   scopes: string[], tokenAuthMethods: string[]}}
 */
export function endpointsFrom(metadata, issuer) {
  if (!metadata?.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error(
      "The login server's metadata has no authorization and token endpoints."
    );
  }
  if (metadata.issuer !== issuer) {
    throw new Error(
      `The login server's metadata is for ${metadata.issuer}, not ${issuer}.`
    );
  }
  for (let endpoint of [
    metadata.authorization_endpoint,
    metadata.token_endpoint,
    metadata.registration_endpoint,
  ]) {
    let url = endpoint && new URL(endpoint);
    if (url && url.protocol != "https:" && !LOOPBACK_HOSTS.has(url.hostname)) {
      throw new Error(
        `The login server's endpoint ${endpoint} does not use https.`
      );
    }
  }
  let methods = metadata.code_challenge_methods_supported;
  if (Array.isArray(methods) && !methods.includes("S256")) {
    throw new Error("The login server does not support PKCE with S256.");
  }
  return {
    authorize: metadata.authorization_endpoint,
    token: metadata.token_endpoint,
    registration: metadata.registration_endpoint || null,
    scopes: Array.isArray(metadata.scopes_supported)
      ? metadata.scopes_supported
      : [],
    tokenAuthMethods: Array.isArray(
      metadata.token_endpoint_auth_methods_supported
    )
      ? metadata.token_endpoint_auth_methods_supported
      : [],
  };
}

/**
 * The scope to ask for: what the server's challenge asked for, else what
 * the resource says it supports, else what the login server does.
 *
 * @returns {?string} null to leave scope out.
 */
export function chooseScope({ challenge, resource, server } = {}) {
  if (challenge) {
    return challenge;
  }
  for (let scopes of [resource, server]) {
    if (scopes?.length) {
      return scopes.join(" ");
    }
  }
  return null;
}

/** An MCP server's URL as the OAuth resource (RFC 8707): no fragment. */
export function canonicalResource(url) {
  let parsed = new URL(url);
  parsed.hash = "";
  return parsed.href;
}

/** The URL that starts an MCP server login. */
export function mcpAuthorizeURL({
  authorizeURL,
  clientId,
  redirectURI,
  state,
  challenge,
  scope,
  resource,
}) {
  return withParams(authorizeURL, {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectURI,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
    scope,
  });
}
