/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The assistant's MCP client. Connects to the HTTP (streamable HTTP) MCP
 * servers the user added in settings and registers their tools with the
 * tool registry (OrbitoTools.sys.mjs), so that every backend offers them
 * and the core approves, limits, records and shows their calls like any
 * browser tool.
 *
 * Servers are kept in the orbito.mcp.servers pref as JSON:
 *   [{id, name, url, auth: "none" | "header" | "oauth", headerName,
 *     clientId, enabled, trustReadOnly}]
 * Header values, OAuth tokens and client secrets are kept in the password
 * manager (OrbitoSecrets, OrbitoMCPAuth.sys.mjs), never in the pref. A
 * server that answers 401 with a WWW-Authenticate challenge is taken to
 * need an OAuth login. Tools are never read-only (so each call is approved) unless
 * the user trusts the server's readOnlyHint annotations.
 */

import { parseWWWAuthenticate } from "chrome://browser/content/orbito/OrbitoOAuthProtocol.sys.mjs";
import {
  notification,
  PROTOCOL_VERSION,
  readMessages,
  request,
  toolNames,
  toolResult,
} from "chrome://browser/content/orbito/OrbitoMCPProtocol.sys.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  NeedsLogin: "chrome://browser/content/orbito/OrbitoMCPAuth.sys.mjs",
  OrbitoMCPAuth: "chrome://browser/content/orbito/OrbitoMCPAuth.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  OrbitoSecrets: "chrome://browser/content/orbito/OrbitoSecrets.sys.mjs",
  OrbitoTools: "chrome://browser/content/orbito/OrbitoTools.sys.mjs",
});

const SERVERS_PREF = "orbito.mcp.servers";
// How long one tool call may take.
const TIMEOUT_PREF = "orbito.mcp.callTimeoutSeconds";

function headerRealm(id) {
  return `MCP server header ${id}`;
}

function newId() {
  return Services.uuid.generateUUID().toString().slice(1, 9);
}

/** An HTTP error from a server, with its status. */
class HTTPError extends Error {
  constructor(response, detail = "") {
    super(
      `The server answered ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`.trim()
    );
    this.status = response.status;
  }
}

/**
 * One server: its connection, its session and the tools it registered.
 */
class Connection {
  constructor(config, client) {
    this.config = config;
    this.client = client;
    // "disabled" | "connecting" | "connected" | "error" | "needs_login" |
    // "logging_in"
    this.status = "disabled";
    this.error = null;
    this.warnings = [];
    // [{name, registryName, description, readOnly}]
    this.tools = [];
    this._removers = [];
    this._sessionId = null;
    this._protocolVersion = null;
    this._nextId = 1;
    this._controller = null;
    // The parameters of the server's last WWW-Authenticate challenge.
    this._challenge = null;
    this._login = null;
  }

  get name() {
    return this.config.name;
  }

  _setStatus(status, error = null) {
    this.status = status;
    this.error = error;
    this.client._changed();
  }

  async connect() {
    this.disconnect();
    if (!this.config.enabled) {
      return;
    }
    let controller = (this._controller = new AbortController());
    this._setStatus("connecting");
    try {
      let { result } = await this._rpc(
        "initialize",
        {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "Orbito", version: "0.1" },
        },
        { signal: controller.signal, initializing: true }
      );
      this._protocolVersion = result?.protocolVersion || PROTOCOL_VERSION;
      await this._notify("notifications/initialized");
      await this._loadTools(controller.signal);
      if (!controller.signal.aborted) {
        this._setStatus("connected");
        this._listen(controller.signal);
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        this._unregister();
        this._setStatus(
          e.needsLogin ? "needs_login" : "error",
          e.message || String(e)
        );
      }
    }
  }

  /** Logs in to the server in a tab, then connects. */
  async login() {
    this._login?.abort();
    let controller = (this._login = new AbortController());
    this.disconnect();
    this._setStatus("logging_in");
    try {
      await lazy.OrbitoMCPAuth.login(this.config, {
        challenge: this._challenge,
        signal: controller.signal,
      });
      this._challenge = null;
    } catch (e) {
      if (this._login == controller) {
        this._login = null;
        this._setStatus("needs_login", e.message || String(e));
      }
      return;
    }
    this._login = null;
    await this.connect();
  }

  cancelLogin() {
    this._login?.abort();
  }

  async logout() {
    this._login?.abort();
    this.disconnect();
    await lazy.OrbitoMCPAuth.logout(this.config);
    this._setStatus("needs_login", t("orbito-assistant-mcp-logged-out"));
  }

  disconnect() {
    this._controller?.abort();
    this._controller = null;
    this._unregister();
    this.tools = [];
    this.warnings = [];
    if (this._sessionId) {
      // Tell the server the session is over; it may not support that.
      this._fetch("DELETE", null, { sessionId: this._sessionId }).catch(
        () => {}
      );
    }
    this._sessionId = null;
    this.status = "disabled";
    this.error = null;
  }

  async _loadTools(signal) {
    let listed = [];
    let cursor;
    do {
      let { result } = await this._rpc(
        "tools/list",
        cursor ? { cursor } : undefined,
        { signal }
      );
      listed.push(...(result?.tools || []));
      cursor = result?.nextCursor;
    } while (cursor);
    if (signal.aborted) {
      return;
    }
    this._unregister();
    this.warnings = [];
    let usable = listed.filter(tool => {
      if (tool?.inputSchema?.type != "object") {
        this.warnings.push(
          t("orbito-assistant-mcp-tool-bad-schema", { name: tool?.name })
        );
        return false;
      }
      return typeof tool.name == "string";
    });
    let taken = new Set(lazy.OrbitoTools.list().map(t => t.name));
    let names = toolNames(
      this.name,
      usable.map(t => t.name),
      taken
    );
    this.tools = [];
    usable.forEach((tool, i) => {
      let entry = {
        name: tool.name,
        registryName: names[i],
        description: tool.description || tool.title || "",
        readOnly:
          !!this.config.trustReadOnly &&
          tool.annotations?.readOnlyHint === true,
      };
      try {
        this._removers.push(
          lazy.OrbitoTools.register(this._registryTool(tool, entry))
        );
        this.tools.push(entry);
      } catch (e) {
        this.warnings.push(
          t("orbito-assistant-mcp-tool-left-out", {
            name: tool.name,
            error: e.message,
          })
        );
      }
    });
  }

  /** Lists the tools again, e.g. after the server said they changed. */
  async reloadTools() {
    let signal = this._controller?.signal;
    if (this.status != "connected" || !signal) {
      return;
    }
    try {
      await this._loadTools(signal);
      this.client._changed();
    } catch (e) {
      if (!signal.aborted) {
        this._lost(e);
      }
    }
  }

  /**
   * Listens for what the server sends on its own, like tool list changes.
   * Servers need not offer this.
   */
  async _listen(signal) {
    try {
      let response = await this._fetch("GET", null, { signal });
      let type = response.headers.get("Content-Type") || "";
      if (!response.ok || !/^text\/event-stream/i.test(type)) {
        response.body?.cancel();
        return;
      }
      for await (let message of readMessages(type, response.body)) {
        this._onServerMessage(message);
      }
    } catch {}
  }

  /** The connection broke: the tools go until it is connected again. */
  _lost(error) {
    this._controller?.abort();
    this._controller = null;
    this._unregister();
    this.tools = [];
    this._sessionId = null;
    this._setStatus(
      "error",
      t("orbito-assistant-mcp-connection-lost", {
        error: error.message || error,
      })
    );
  }

  _registryTool(tool, entry) {
    let connection = this;
    let title = tool.title || tool.annotations?.title || tool.name;
    return {
      name: entry.registryName,
      description: `${this.name}: ${entry.description || title}`,
      schema: tool.inputSchema,
      readOnly: entry.readOnly,
      mcp: { server: this.config.id, tool: tool.name },

      label() {
        return `${connection.name}: ${title}`;
      },

      approvalAction() {
        return `${connection.name}: ${title}`;
      },

      approvalText(ctx, input) {
        let args = JSON.stringify(input ?? {});
        if (args.length > 300) {
          args = args.slice(0, 300) + "…";
        }
        return `Allow ${connection.name} to run ${tool.name} with ${args}?`;
      },

      async run(ctx, input) {
        let result = await connection.call(tool.name, input, ctx?.signal);
        if (!result.ok) {
          throw new Error(result.content || `${tool.name} failed.`);
        }
        return result.images
          ? { content: result.content, images: result.images }
          : result.content;
      },
    };
  }

  _unregister() {
    for (let remove of this._removers) {
      remove();
    }
    this._removers = [];
  }

  /**
   * Calls a tool on the server, within the time limit.
   *
   * @param {string} name
   * @param {object} args
   * @param {AbortSignal} [signal] The question's; stopping it cancels the
   *   call.
   * @returns {Promise<{ok: boolean, content: string, images?: object[]}>}
   */
  async call(name, args, signal, { retried = false } = {}) {
    if (this.status == "needs_login") {
      return { ok: false, content: this.error || `Log in to ${this.name}.` };
    }
    if (this.status != "connected") {
      return {
        ok: false,
        content: `${this.name} is not connected${this.error ? `: ${this.error}` : "."}`,
      };
    }
    let seconds = Services.prefs.getIntPref(TIMEOUT_PREF, 60);
    let controller = new AbortController();
    let timedOut = false;
    let timer = lazy.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, seconds * 1000);
    let onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      controller.abort();
    }
    let response;
    try {
      response = await this._rpc(
        "tools/call",
        { name, arguments: args ?? {} },
        { signal: controller.signal }
      );
    } catch (e) {
      if (timedOut) {
        return {
          ok: false,
          content: `${this.name} did not answer within ${seconds} second${seconds == 1 ? "" : "s"}, so the call was stopped.`,
        };
      }
      if (signal?.aborted) {
        throw new Error("The question was stopped.");
      }
      if (e.needsLogin) {
        // The tools stay registered, so that a new login brings them back
        // at once; until then their calls fail with this reason.
        this._setStatus("needs_login", e.message);
        return { ok: false, content: e.message };
      }
      if (e.status == 404 && !retried) {
        // The server forgot the session: start a new one and try again.
        await this.connect();
        return this.call(name, args, signal, { retried: true });
      }
      if (!e.status) {
        this._lost(e);
      }
      return { ok: false, content: e.message || String(e) };
    } finally {
      lazy.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    if (response.error) {
      return {
        ok: false,
        content: response.error.message || "The server returned an error.",
      };
    }
    return toolResult(response.result);
  }

  async _headers() {
    let headers = {};
    if (this.config.auth == "oauth") {
      headers.Authorization = `Bearer ${await lazy.OrbitoMCPAuth.accessToken(this.config)}`;
    } else if (this.config.auth == "header" && this.config.headerName) {
      let value = await lazy.OrbitoSecrets.get(headerRealm(this.config.id));
      if (value) {
        headers[this.config.headerName] = value;
      }
    }
    return headers;
  }

  async _fetch(method, body, { signal, sessionId = this._sessionId }) {
    let headers = {
      Accept:
        method == "GET"
          ? "text/event-stream"
          : "application/json, text/event-stream",
      ...(await this._headers()),
    };
    if (body) {
      headers["Content-Type"] = "application/json";
    }
    if (sessionId) {
      headers["Mcp-Session-Id"] = sessionId;
    }
    if (this._protocolVersion) {
      headers["MCP-Protocol-Version"] = this._protocolVersion;
    }
    return fetch(this.config.url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal,
      credentials: "omit",
    });
  }

  async _send(message, { signal }) {
    let response = await this._fetch("POST", message, { signal });
    if (
      response.status == 401 &&
      this.config.auth == "oauth" &&
      (await lazy.OrbitoMCPAuth.hasTokens(this.config))
    ) {
      // Refused: refresh the token once and try again.
      response.body?.cancel();
      await lazy.OrbitoMCPAuth.accessToken(this.config, { refresh: true });
      response = await this._fetch("POST", message, { signal });
    }
    if (response.status == 401 || response.status == 403) {
      let challenge = parseWWWAuthenticate(
        response.headers.get("WWW-Authenticate")
      );
      let scopeError =
        response.status == 403 && challenge?.error == "insufficient_scope";
      // A server without auth that sends a Bearer challenge wants an
      // OAuth login; one with a fixed header just refused the header.
      let wantsLogin =
        response.status == 401 &&
        (this.config.auth == "oauth" ||
          (this.config.auth == "none" && challenge));
      if (wantsLogin || (scopeError && this.config.auth != "header")) {
        response.body?.cancel();
        this._challenge = challenge;
        if (this.config.auth == "none") {
          this.config.auth = "oauth";
          this.client._writeConfigs();
        }
        let hadTokens = await lazy.OrbitoMCPAuth.hasTokens(this.config);
        throw new lazy.NeedsLogin(
          scopeError
            ? `${this.name} needs more permissions${challenge.scope ? ` (${challenge.scope})` : ""}. Log in again in settings.`
            : hadTokens
              ? `${this.name} did not accept the login. Log in again in settings.`
              : `Log in to ${this.name} to use it.`,
          { scope: challenge?.scope }
        );
      }
    }
    if (!response.ok) {
      let detail = "";
      try {
        detail = (await response.text()).trim().slice(0, 200);
      } catch {}
      throw new HTTPError(response, detail);
    }
    return response;
  }

  _notify(method, params) {
    return this._send(notification(method, params), {}).then(response =>
      response.body?.cancel()
    );
  }

  /**
   * Sends a request and resolves to its JSON-RPC response, handling the
   * server's notifications that come in the same stream.
   */
  async _rpc(method, params, { signal, initializing = false } = {}) {
    let id = this._nextId++;
    try {
      let response = await this._send(request(id, method, params), {
        signal,
      });
      if (initializing) {
        this._sessionId = response.headers.get("Mcp-Session-Id");
      }
      for await (let message of readMessages(
        response.headers.get("Content-Type"),
        response.body
      )) {
        if (
          message.id === id &&
          ("result" in message || "error" in message)
        ) {
          if (initializing && message.error) {
            throw new Error(message.error.message || "initialize failed.");
          }
          return message;
        }
        this._onServerMessage(message);
      }
    } catch (e) {
      if (signal?.aborted && !initializing) {
        // Let the server stop working on it.
        this._notify("notifications/cancelled", {
          requestId: id,
          reason: "The user stopped the question or it took too long.",
        }).catch(() => {});
      }
      throw e;
    }
    throw new Error(`The server did not answer ${method}.`);
  }

  _onServerMessage(message) {
    if (message.method == "notifications/tools/list_changed") {
      this.client._toolsChanged(this);
    }
  }
}

export const OrbitoMCP = {
  // id -> Connection
  _connections: new Map(),
  _listeners: new Set(),
  _initialized: false,

  /** Connects to the enabled servers. Called once at startup. */
  init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;
    for (let config of this._readConfigs()) {
      let connection = new Connection(config, this);
      this._connections.set(config.id, connection);
      connection.connect();
    }
  },

  _readConfigs() {
    try {
      let configs = JSON.parse(
        Services.prefs.getStringPref(SERVERS_PREF, "[]")
      );
      return Array.isArray(configs)
        ? configs.filter(c => c?.id && c.url)
        : [];
    } catch {
      return [];
    }
  },

  _writeConfigs() {
    Services.prefs.setStringPref(
      SERVERS_PREF,
      JSON.stringify([...this._connections.values()].map(c => c.config))
    );
  },

  /** @param {Function} listener Called whenever a server changes. */
  addListener(listener) {
    this._listeners.add(listener);
  },

  removeListener(listener) {
    this._listeners.delete(listener);
  },

  _changed() {
    for (let listener of this._listeners) {
      try {
        listener();
      } catch (e) {
        console.error(e);
      }
    }
  },

  _toolsChanged(connection) {
    connection.reloadTools();
  },

  /**
   * The servers and their state, for settings.
   *
   * @returns {object[]}
   */
  servers() {
    return [...this._connections.values()].map(c => ({
      ...c.config,
      status: c.status,
      error: c.error,
      warnings: [...c.warnings],
      tools: c.tools.map(t => ({ ...t })),
    }));
  },

  _validate({ name, url }) {
    if (!name?.trim()) {
      throw new Error(t("orbito-assistant-mcp-needs-name"));
    }
    let uri;
    try {
      uri = Services.io.newURI(url);
    } catch {
      throw new Error(t("orbito-assistant-mcp-invalid-url"));
    }
    if (!uri.schemeIs("http") && !uri.schemeIs("https")) {
      throw new Error(t("orbito-assistant-mcp-http-only"));
    }
  },

  /**
   * Adds a server and connects to it.
   *
   * @param {object} server {name, url, auth, headerName, headerValue,
   *   clientId, clientSecret}
   * @returns {Promise<string>} The server's id.
   */
  async addServer({
    name,
    url,
    auth = "none",
    headerName,
    headerValue,
    clientId,
    clientSecret,
  }) {
    this._validate({ name, url });
    let config = {
      id: newId(),
      name: name.trim(),
      url: url.trim(),
      auth,
      headerName: auth == "header" ? headerName?.trim() || "Authorization" : "",
      clientId: auth == "oauth" ? clientId?.trim() || "" : "",
      enabled: true,
      trustReadOnly: false,
    };
    if (auth == "header") {
      await lazy.OrbitoSecrets.set(
        headerRealm(config.id),
        headerValue || "",
        config.name
      );
    }
    if (config.clientId && clientSecret) {
      await lazy.OrbitoMCPAuth.setClientSecret(config, clientSecret);
    }
    let connection = new Connection(config, this);
    this._connections.set(config.id, connection);
    this._writeConfigs();
    this._changed();
    await connection.connect();
    return config.id;
  },

  /** Connects to a server again. */
  reconnect(id) {
    return this._connections.get(id)?.connect();
  },

  /**
   * Changes a server. A new header value replaces the stored one; leave
   * headerValue out to keep it.
   *
   * @param {string} id
   * @param {object} changes Any of {name, url, auth, headerName,
   *   headerValue, clientId, clientSecret, enabled, trustReadOnly}.
   */
  async updateServer(id, changes) {
    let connection = this._connections.get(id);
    if (!connection) {
      throw new Error(t("orbito-assistant-mcp-no-server"));
    }
    let old = connection.config;
    let config = { ...old };
    for (let key of ["name", "url", "auth", "headerName", "clientId"]) {
      if (typeof changes[key] == "string") {
        config[key] = changes[key].trim();
      }
    }
    for (let key of ["enabled", "trustReadOnly"]) {
      if (typeof changes[key] == "boolean") {
        config[key] = changes[key];
      }
    }
    this._validate(config);
    if (config.auth == "header") {
      config.headerName ||= "Authorization";
    } else {
      config.headerName = "";
    }
    if (config.auth != "oauth") {
      config.clientId = "";
    }
    if (typeof changes.clientSecret == "string" && config.clientId) {
      await lazy.OrbitoMCPAuth.setClientSecret(config, changes.clientSecret);
    }
    let secretChanged = typeof changes.headerValue == "string";
    if (secretChanged || config.auth != "header") {
      await lazy.OrbitoSecrets.set(
        headerRealm(id),
        config.auth == "header" ? changes.headerValue ?? "" : "",
        config.name
      );
    }
    if (config.url != old.url || config.auth != "oauth") {
      // Tokens are for the server they were issued for.
      await lazy.OrbitoMCPAuth.logout(old);
    }
    connection.config = config;
    this._writeConfigs();
    let reconnect =
      secretChanged ||
      ["name", "url", "auth", "headerName", "clientId", "enabled"].some(
        key => config[key] != old[key]
      );
    if (reconnect) {
      if (config.enabled) {
        await connection.connect();
      } else {
        connection.disconnect();
        this._changed();
      }
    } else if (config.trustReadOnly != old.trustReadOnly) {
      await connection.reloadTools();
    } else {
      this._changed();
    }
  },

  /** Disconnects a server and forgets it and its secrets. */
  async removeServer(id) {
    let connection = this._connections.get(id);
    if (!connection) {
      return;
    }
    connection.disconnect();
    this._connections.delete(id);
    this._writeConfigs();
    this._changed();
    await lazy.OrbitoSecrets.set(headerRealm(id), "");
    await lazy.OrbitoMCPAuth.forget(connection.config);
  },

  /** Logs in to an OAuth server in a tab. */
  login(id) {
    return this._connections.get(id)?.login();
  },

  cancelLogin(id) {
    this._connections.get(id)?.cancelLogin();
  },

  /** Forgets an OAuth server's tokens and registered client. */
  logout(id) {
    return this._connections.get(id)?.logout();
  },
};
