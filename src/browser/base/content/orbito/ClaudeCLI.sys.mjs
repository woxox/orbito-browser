/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Runs the Claude Code CLI shipped in orbito-agent/ (staged, unmodified, by
 * scripts/agent-runtime.py): one headless stream-json process per query,
 * whose output becomes the events query() reports. The CLI gets
 * only the environment it needs and keeps its configuration in the profile,
 * so it never reads or writes the user's own ~/.claude. It reaches the
 * browser tools through the query's endpoint of OrbitoMCPServer.sys.mjs.
 *
 * It authenticates with the user's API key, or with the user's Claude
 * account (ClaudeAccount), which the CLI signs in to, keeps and refreshes
 * itself: Orbito never sees the account's tokens.
 */

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
  OrbitoMCPServer: "chrome://browser/content/orbito/OrbitoMCPServer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
});

// The browser's environment variables the CLI gets (compared in upper case,
// as Windows names are not case sensitive), with every LC_* one. Anything
// else, such as credentials for Claude Code or a cloud provider, stays out.
const PASSED_ENVIRONMENT = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "SYSTEMROOT",
  "WINDIR",
  // Without it the CLI can't find rundll32 to open the login page.
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "COMSPEC",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
]);

// How long a call of a browser tool may take, waiting for approval
// included, before the CLI gives up on it. The CLI's default for a call
// that sends nothing back meanwhile is 5 minutes.
const TOOL_TIMEOUT = 24 * 60 * 60 * 1000;

// How the API refuses a CLI too old for the model or for the organization's
// policy when it does not say so in api_error; the CLI checks the same.
const OUTDATED =
  /\bClaude Code \S+ (?:does not support this model; version \S+ or newer is required|is older than the minimum version required by your organization's policy)/;

// The Claude account's usage limits the panel shows, by the rateLimitType
// the CLI gives them, in this order.
const LIMIT_LABELS = {
  five_hour: "orbito-assistant-claude-limit-five-hour",
  seven_day: "orbito-assistant-claude-limit-seven-day",
  seven_day_opus: "orbito-assistant-claude-limit-seven-day-opus",
  seven_day_sonnet: "orbito-assistant-claude-limit-seven-day-sonnet",
};

// The plans `auth status` gives as subscriptionType, by their names.
const PLAN_NAMES = {
  pro: "orbito-assistant-claude-plan-pro",
  max: "orbito-assistant-claude-plan-max",
  team: "orbito-assistant-claude-plan-team",
  enterprise: "orbito-assistant-claude-plan-enterprise",
};

const CONTEXT_WINDOWS_PREF = "orbito.agent.contextWindows";
// How long the CLI may take to list its models, in ms.
const MODELS_TIMEOUT = 15000;

export const ClaudeCLI = {
  // The processes of the queries still running, killed if the app quits.
  _processes: new Set(),
  // The context windows the CLI gave for the models its queries used, in
  // tokens, by model id; kept in CONTEXT_WINDOWS_PREF, so that they are
  // known before the first query after a restart.
  _contextWindows: null,

  /**
   * Starts a query in a new CLI process.
   *
   * @param {object} options
   * @param {string} options.prompt
   * @param {string} options.model
   * @param {string} [options.apiKey] Anthropic API key; without one, the
   *   CLI uses the Claude account it is signed in to.
   * @param {string} options.system System prompt.
   * @param {object[]} options.tools Tool definitions from OrbitoTools.list().
   * @param {object} handler
   *   onText(text), onToolUseStart(name, callId),
   *   onToolInputDelta({callId, name, partialJson}),
   *   onToolErrors([{name, message}]),
   *   onThinkingStart() and onThought(text) around the model's own
   *   thinking (text "" when the API leaves it out),
   *   onDone({error, authFailed, usage}) (authFailed when the API did not
   *   accept the credentials; usage {inputTokens, outputTokens}, when the
   *   CLI reported it), and
   *   async callTool(name, input) resolving to {ok, content, images?}.
   * @returns {Promise<Function>} Interrupts the query.
   */
  async query(options, handler) {
    let { home, configDir, workDir } = await this._folders();
    let command = await this._binaryPath();
    // In a file, as the skills' descriptions and the memories can make the
    // system prompt longer than a Windows command line may be.
    let systemFile = await IOUtils.createUniqueFile(
      home,
      "system-prompt.txt",
      0o600
    );
    await IOUtils.writeUTF8(systemFile, options.system);
    // In a file only the user can read too, as other users may see command
    // lines and could call the tools with the token.
    let mcpFile = await IOUtils.createUniqueFile(home, "mcp.json", 0o600);
    let tools = lazy.OrbitoMCPServer.open(options.tools, handler);
    let removeFiles = () =>
      Promise.all([IOUtils.remove(systemFile), IOUtils.remove(mcpFile)]);

    let environment = this._environment(options.apiKey, configDir);

    let process;
    try {
      await IOUtils.writeJSON(mcpFile, {
        mcpServers: {
          orbito: {
            type: "http",
            url: tools.url,
            headers: { Authorization: `Bearer ${tools.token}` },
            timeout: TOOL_TIMEOUT,
            // The CLI waits for the server before the first request, which
            // must offer the tools.
            alwaysLoad: true,
          },
        },
      });
      process = await lazy.Subprocess.call({
        command,
        arguments: [
          "-p",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-partial-messages",
          "--model",
          options.model,
          "--system-prompt-file",
          systemFile,
          "--tools",
          "",
          "--setting-sources",
          "",
          "--strict-mcp-config",
          "--mcp-config",
          mcpFile,
          "--allowedTools",
          "mcp__orbito",
          "--permission-mode",
          "dontAsk",
          "--no-session-persistence",
        ],
        environment,
        environmentAppend: false,
        stderr: "pipe",
        workdir: workDir,
      });
    } catch (e) {
      tools.close();
      await removeFiles();
      throw new Error(
        t("orbito-assistant-claude-failed", {
          path: command,
          error: e.message || e,
        })
      );
    }

    this._processes.add(process);
    if (this._processes.size == 1) {
      Services.obs.addObserver(this, "quit-application");
    }
    let done = false;
    let onDone = result => {
      if (!done) {
        done = true;
        tools.close();
        handler.onDone(result);
      }
    };
    this._run(process, options.prompt, !!options.apiKey, {
      ...handler,
      onDone,
    }).finally(() => {
      this._processes.delete(process);
      if (!this._processes.size) {
        Services.obs.removeObserver(this, "quit-application");
        // Once no other query's process may still write to it.
        this._removeLogs(environment, workDir).catch(e =>
          console.warn("ClaudeCLI: could not remove the logs", e)
        );
      }
      removeFiles().catch(() => {});
    });
    return () => {
      if (!done) {
        process.kill();
        // Over now, not once the process has exited; it has no answer left
        // to report. Tool calls still running end as stopped in
        // OrbitoAssistantCore.
        onDone({});
      }
    };
  },

  /**
   * The model's context window as the CLI gave it with a query that used
   * the model, or null before one did.
   *
   * @param {string} model
   * @returns {?number}
   */
  contextWindow(model) {
    return this._loadContextWindows()[model] ?? null;
  },

  _loadContextWindows() {
    if (!this._contextWindows) {
      try {
        this._contextWindows = JSON.parse(
          Services.prefs.getStringPref(CONTEXT_WINDOWS_PREF, "{}")
        );
      } catch {}
      if (typeof this._contextWindows != "object" || !this._contextWindows) {
        this._contextWindows = {};
      }
    }
    return this._contextWindows;
  },

  /** Keeps the windows of the result event's modelUsage, by model id. */
  _noteContextWindows(modelUsage) {
    let windows = this._loadContextWindows();
    let changed = false;
    for (let [model, usage] of Object.entries(modelUsage ?? {})) {
      let window = usage?.contextWindow;
      if (Number.isInteger(window) && window > 0 && windows[model] != window) {
        windows[model] = window;
        changed = true;
      }
    }
    if (changed) {
      Services.prefs.setStringPref(
        CONTEXT_WINDOWS_PREF,
        JSON.stringify(windows)
      );
    }
  },

  /**
   * The models the CLI offers the Claude account, from its answer to an
   * initialize control request (supportedModels() in the Agent SDK): the
   * only part of the SDK control protocol Orbito uses, as the account's
   * credentials are the CLI's alone. The CLI is not asked anything else,
   * and is killed once it answered. Not the "default" entry, which repeats
   * another.
   *
   * @returns {Promise<{id: string, label: ?string, description: ?string}[]>}
   * @throws {Error} When the CLI does not answer.
   */
  async models() {
    let { configDir, workDir } = await this._folders();
    let command = await this._binaryPath();
    let process;
    try {
      process = await lazy.Subprocess.call({
        command,
        arguments: [
          "-p",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--verbose",
          "--tools",
          "",
          "--setting-sources",
          "",
          "--strict-mcp-config",
          "--no-session-persistence",
        ],
        environment: this._environment(null, configDir),
        environmentAppend: false,
        stderr: "stdout",
        workdir: workDir,
      });
    } catch (e) {
      throw new Error(
        t("orbito-assistant-claude-failed", {
          path: command,
          error: e.message || e,
        })
      );
    }
    let models = null;
    let timer = lazy.setTimeout(() => process.kill(), MODELS_TIMEOUT);
    try {
      process.stdin
        .write(
          JSON.stringify({
            type: "control_request",
            request_id: "orbito-models",
            request: { subtype: "initialize" },
          }) + "\n"
        )
        .catch(() => {});
      await this._readLines(process.stdout, line => {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (
          !models &&
          event.type == "control_response" &&
          event.response?.request_id == "orbito-models"
        ) {
          models = event.response.response?.models;
          process.kill();
        }
      });
    } finally {
      lazy.clearTimeout(timer);
      process.kill();
    }
    if (!Array.isArray(models)) {
      throw new Error("The Claude Code CLI did not list its models.");
    }
    let seen = new Set();
    return models.flatMap(model => {
      let id = model?.resolvedModel || model?.value;
      if (model?.value == "default" || typeof id != "string" || seen.has(id)) {
        return [];
      }
      seen.add(id);
      // "Opus 5.5 · Best for everyday, complex tasks · $4/$20 per Mtok"
      let [name, ...rest] = String(model.description ?? "").split(" · ");
      return [
        {
          id,
          label: rest.length ? name : model.displayName || null,
          description: rest.join(" · ") || null,
        },
      ];
    });
  },

  observe(subject, topic) {
    if (topic == "quit-application") {
      for (let process of this._processes) {
        process.kill(0);
      }
    }
  },

  async _run(process, prompt, withKey, handler) {
    let wroteText = false;
    // Why the API refused the last message, e.g. "authentication_failed".
    let apiError;
    // The tool calls ({callId, name}) and thinking ({thought}) of the
    // message being streamed, by content block index.
    let blocks = new Map();
    let result = null;
    let stderr = [];
    let stderrRead = this._readLines(process.stderr, line => {
      stderr.push(line);
      console.debug("ClaudeCLI:", line);
    });
    process.stdin
      .write(
        JSON.stringify({
          type: "user",
          message: { role: "user", content: prompt },
        }) + "\n"
      )
      .then(() => process.stdin.close())
      .catch(e => console.warn("ClaudeCLI: could not send the prompt", e));

    await this._readLines(process.stdout, line => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        console.warn("ClaudeCLI: unexpected output", line);
        return;
      }
      if (event.type == "stream_event" && !event.parent_tool_use_id) {
        let e = event.event;
        if (
          e.type == "content_block_start" &&
          e.content_block.type == "tool_use"
        ) {
          let name = e.content_block.name.replace(/^mcp__orbito__/, "");
          let callId = e.content_block.id;
          blocks.set(e.index, { callId, name });
          handler.onToolUseStart?.(name, callId);
        } else if (
          e.type == "content_block_delta" &&
          e.delta.type == "input_json_delta" &&
          blocks.has(e.index)
        ) {
          handler.onToolInputDelta?.({
            ...blocks.get(e.index),
            partialJson: e.delta.partial_json,
          });
        } else if (
          e.type == "content_block_start" &&
          (e.content_block.type == "thinking" ||
            e.content_block.type == "redacted_thinking")
        ) {
          blocks.set(e.index, { thought: e.content_block.thinking || "" });
          handler.onThinkingStart?.();
        } else if (
          e.type == "content_block_delta" &&
          e.delta.type == "thinking_delta" &&
          blocks.has(e.index)
        ) {
          blocks.get(e.index).thought += e.delta.thinking;
        } else if (
          e.type == "content_block_stop" &&
          blocks.get(e.index)?.thought !== undefined
        ) {
          handler.onThought?.(blocks.get(e.index).thought);
          blocks.delete(e.index);
        } else if (e.type == "message_start") {
          blocks.clear();
        } else if (
          e.type == "content_block_start" &&
          e.content_block.type == "text" &&
          wroteText
        ) {
          handler.onText("\n\n");
        } else if (
          e.type == "content_block_delta" &&
          e.delta.type == "text_delta"
        ) {
          wroteText = true;
          handler.onText(e.delta.text);
        }
      } else if (
        event.type == "assistant" &&
        !event.parent_tool_use_id &&
        event.error
      ) {
        apiError = event.error;
      } else if (event.type == "rate_limit_event" && !withKey) {
        ClaudeAccount._rateLimit(event.rate_limit_info);
      } else if (event.type == "result") {
        result = event;
        this._noteContextWindows(event.modelUsage);
      }
    });
    let { exitCode } = await process.wait();
    await stderrRead;

    let error;
    let authFailed = false;
    let usage;
    let u = result?.usage;
    if (u) {
      usage = {
        inputTokens:
          (u.input_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
      };
    }
    if (result?.subtype && result.subtype != "success") {
      error = result.errors?.join("\n") || result.subtype;
    } else if (result?.is_error && apiError == "authentication_failed") {
      // A key the API refused (401), or none at all ("Not logged in"); a
      // Claude account that is not signed in, or whose login the CLI could
      // not refresh.
      error = t(
        withKey
          ? "orbito-assistant-claude-key-rejected"
          : "orbito-assistant-claude-login-rejected"
      );
      authFailed = true;
    } else if (
      result?.is_error &&
      (result.api_error == "claude_code_version_too_old" ||
        OUTDATED.test(result.result))
    ) {
      error = t("orbito-assistant-claude-outdated");
    } else if (result?.is_error) {
      error = result.result;
    } else if (!result) {
      error = t("orbito-assistant-claude-exited", {
        code: exitCode,
        output: stderr.slice(-5).join("\n"),
      });
    }
    handler.onDone({ error, authFailed, usage });
  },

  async _readLines(pipe, onLine) {
    let buffer = "";
    try {
      while (true) {
        let chunk = await pipe.readString();
        if (!chunk) {
          break;
        }
        buffer += chunk;
        let lines = buffer.split("\n");
        buffer = lines.pop();
        for (let line of lines) {
          if (line.trim()) {
            onLine(line);
          }
        }
      }
    } catch (e) {
      console.warn("ClaudeCLI: read failed", e);
    }
  },

  /**
   * Removes the folder the CLI keeps its logs in for workDir, MCP logs
   * included, under its cache folder (as env-paths finds it from the
   * environment the CLI got). It would clean them up itself only with
   * settings, which it does not read.
   */
  async _removeLogs(environment, workDir) {
    let value = name =>
      Object.entries(environment).find(([n]) => n.toUpperCase() == name)?.[1];
    let home = value(Services.appinfo.OS == "WINNT" ? "USERPROFILE" : "HOME");
    let cache;
    if (Services.appinfo.OS == "Darwin") {
      cache = home && PathUtils.join(home, "Library", "Caches");
    } else if (Services.appinfo.OS == "WINNT") {
      let local =
        value("LOCALAPPDATA") ||
        (home && PathUtils.join(home, "AppData", "Local"));
      cache = local && PathUtils.join(local, "claude-cli-nodejs", "Cache");
    } else {
      cache =
        value("XDG_CACHE_HOME") || (home && PathUtils.join(home, ".cache"));
    }
    if (!cache) {
      return;
    }
    if (Services.appinfo.OS != "WINNT") {
      cache = PathUtils.join(cache, "claude-cli-nodejs");
    }
    // The CLI names it after its working directory as process.cwd() gives
    // it, with symbolic links resolved; a longer name gets a hash, which
    // only the profile folder of an unusually long path needs.
    let dir = new lazy.FileUtils.File(workDir);
    dir.normalize();
    let name = dir.path.replace(/[^a-zA-Z0-9]/g, "-");
    if (name.length <= 200) {
      await IOUtils.remove(PathUtils.join(cache, name), { recursive: true });
    }
  },

  /**
   * The CLI's folders in the profile, made if missing: home (orbito-agent),
   * its configDir (CLAUDE_CONFIG_DIR, logins included) and its workDir.
   */
  async _folders() {
    let home = PathUtils.join(PathUtils.profileDir, "orbito-agent");
    let configDir = PathUtils.join(home, "claude");
    let workDir = PathUtils.join(home, "work");
    await IOUtils.makeDirectory(configDir);
    await IOUtils.makeDirectory(workDir);
    return { home, configDir, workDir };
  },

  _environment(apiKey, configDir) {
    let environment = {};
    for (let [name, value] of Object.entries(
      lazy.Subprocess.getEnvironment()
    )) {
      let upper = name.toUpperCase();
      if (PASSED_ENVIRONMENT.has(upper) || upper.startsWith("LC_")) {
        environment[name] = value;
      }
    }
    Object.assign(environment, {
      CLAUDE_CONFIG_DIR: configDir,
      DISABLE_AUTOUPDATER: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      // Not documented, but the only way found to leave thinking out of the
      // requests; the think tool is where the model thinks. Models that
      // cannot turn thinking off (Claude 5 and later) still think, which
      // the query passes on as thoughts.
      CLAUDE_CODE_DISABLE_THINKING: "1",
      // Every browser tool in every request, as the other backends send them,
      // rather than some behind a tool search.
      ENABLE_TOOL_SEARCH: "false",
    });
    // Nothing else may authenticate: the environment has no other
    // credentials.
    if (apiKey) {
      environment.ANTHROPIC_API_KEY = apiKey;
      // With a key only: the Claude account's credentials go to Anthropic's
      // own API and nowhere else, whatever orbito.agent.baseURL says.
      let baseURL = Services.prefs.getStringPref("orbito.agent.baseURL", "");
      if (baseURL) {
        environment.ANTHROPIC_BASE_URL = baseURL;
      }
    }
    return environment;
  },

  /**
   * The CLI shipped in orbito-agent/ next to the browser binary, unless
   * orbito.agent.claude is set.
   */
  async _binaryPath() {
    let pref = Services.prefs.getStringPref("orbito.agent.claude", "");
    if (pref) {
      return pref;
    }
    let path = PathUtils.join(
      Services.dirsvc.get("GreBinD", Ci.nsIFile).path,
      "orbito-agent",
      Services.appinfo.OS == "WINNT" ? "claude.exe" : "claude"
    );
    if (!(await IOUtils.exists(path))) {
      throw new Error(t("orbito-assistant-claude-missing", { path }));
    }
    return path;
  },
};

/**
 * The Claude account the CLI signs in to, in its configDir: `claude auth
 * login --claudeai`, `auth status` and `auth logout`, run as they are. The
 * CLI opens the browser, takes the callback and keeps the credentials
 * (in the Keychain on macOS, under a name made from configDir, otherwise in
 * configDir); Orbito gives the login no input, does not read what it
 * prints, and learns the outcome only from its exit code and `auth status`.
 * Without a browser callback the CLI would ask for a code to paste, which
 * Orbito does not do: such a login fails, and the user is given the command
 * to sign in from a terminal.
 */
export const ClaudeAccount = {
  // "signed_out" | "signing_in" | "signed_in"
  _state: null,
  _email: "",
  // The account's plan, as `auth status` last gave it, e.g. "max".
  _plan: "",
  _error: null,
  // The command to sign in from a terminal, after a login failed.
  _command: "",
  // The process of the login under way.
  _login: null,
  _listeners: new Set(),
  // What the account's queries last told of each usage limit, by
  // rateLimitType: {percent, resetsAt}.
  _limits: new Map(),
  // The same from unifiedWindows, by window: every window the last query
  // told of, or null before one did.
  _windows: null,

  addListener(listener) {
    this._listeners.add(listener);
  },

  removeListener(listener) {
    this._listeners.delete(listener);
  },

  _set(state, { email = "", error = null, command = "" } = {}) {
    if (state == "signed_out" || email != this._email) {
      this._limits.clear();
      this._windows = null;
    }
    if (state == "signed_out") {
      this._plan = "";
    }
    this._state = state;
    this._email = email;
    this._error = error;
    this._command = command;
    for (let listener of this._listeners) {
      try {
        listener();
      } catch (e) {
        console.error(e);
      }
    }
  },

  /**
   * @returns {Promise<{state: string, email: string, error: ?string,
   *   command: string}>} command is set when a login failed.
   */
  async status() {
    if (!this._state) {
      let { loggedIn, email } = await this._status();
      if (!this._state) {
        this._state = loggedIn ? "signed_in" : "signed_out";
        this._email = email;
      }
    }
    return {
      state: this._state,
      email: this._email,
      error: this._error,
      command: this._command,
    };
  },

  /**
   * Notes a usage limit from the rate_limit_event the CLI prints with a
   * query's answer (SDKRateLimitEvent in the Agent SDK reference). It tells
   * how much of the limit is used (utilization) only once that is near, or
   * reached ("rejected"); otherwise the limit is not shown, unless
   * unifiedWindows tells of it.
   *
   * @param {object} info Its rate_limit_info.
   */
  _rateLimit(info) {
    // unifiedWindows gives every window's use with each event, but it is
    // not documented (the CLI's schema marks it @internal), so it is read
    // only as far as it has the expected shape. Check it again when the
    // CLI is updated.
    let unified = info?.unifiedWindows;
    if (unified && typeof unified == "object" && !Array.isArray(unified)) {
      let windows = new Map();
      for (let [type, w] of Object.entries(unified)) {
        if (
          /^[a-z0-9_]+$/.test(type) &&
          Number.isFinite(w?.utilization) &&
          w.utilization >= 0
        ) {
          windows.set(type, {
            percent: w.utilization * 100,
            resetsAt: Number.isFinite(w.resetsAt) ? w.resetsAt * 1000 : null,
          });
        }
      }
      if (windows.size) {
        this._windows = windows;
      }
    }
    let type = info?.rateLimitType;
    if (!Object.hasOwn(LIMIT_LABELS, type)) {
      return;
    }
    if (typeof info.utilization == "number") {
      this._limits.set(type, {
        percent: info.utilization * 100,
        resetsAt: info.resetsAt ? info.resetsAt * 1000 : null,
      });
    } else if (info.status == "rejected") {
      this._limits.set(type, {
        percent: 100,
        resetsAt: info.resetsAt ? info.resetsAt * 1000 : null,
      });
    } else {
      this._limits.delete(type);
    }
  },

  /**
   * The account's usage limits as its last queries told them, those not
   * reset since, and its plan: {plan, windows} (see
   * OrbitoAssistantCore.usageLimits). Nothing is asked for them; they change
   * only with a query, and the plan with `auth status`.
   */
  usageLimits() {
    let now = Date.now();
    let windows = [];
    let types = new Set([
      ...Object.keys(LIMIT_LABELS),
      ...(this._windows?.keys() ?? []),
    ]);
    for (let type of types) {
      let limit = this._windows?.get(type) ?? this._limits.get(type);
      if (limit && !(limit.resetsAt && limit.resetsAt <= now)) {
        let label = Object.hasOwn(LIMIT_LABELS, type)
          ? t(LIMIT_LABELS[type])
          : t("orbito-assistant-claude-limit-other", {
              name: type.replaceAll("_", " "),
            });
        windows.push({ label, ...limit });
      }
    }
    let plan = null;
    if (Object.hasOwn(PLAN_NAMES, this._plan)) {
      plan = t(PLAN_NAMES[this._plan]);
    } else if (/^[a-z0-9_]+$/.test(this._plan)) {
      plan = this._plan[0].toUpperCase() + this._plan.slice(1);
    }
    return { plan, windows };
  },

  /** Asks the CLI again, e.g. after it did not accept the login. */
  async refresh() {
    if (this._state != "signing_in") {
      let { loggedIn, email } = await this._status();
      this._set(loggedIn ? "signed_in" : "signed_out", { email });
    }
  },

  /**
   * Signs in in the system browser. Resolves once the login is over;
   * failures and cancellations are reported through status() rather than
   * thrown. It waits for as long as the user takes, until cancelLogin().
   */
  async login() {
    this.cancelLogin();
    this._set("signing_in", { email: this._email });
    let process;
    try {
      process = await this._start(["auth", "login", "--claudeai"]);
    } catch (e) {
      let { loggedIn, email } = await this._status();
      this._set(loggedIn ? "signed_in" : "signed_out", {
        email,
        error: e.message || String(e),
      });
      return;
    }
    this._login = process;
    Services.obs.addObserver(this, "quit-application");
    // Nothing to read from Orbito: a code to paste never comes.
    process.stdin.close().catch(() => {});
    let { exitCode } = await process.wait();
    Services.obs.removeObserver(this, "quit-application");
    process.stdout.close().catch(() => {});
    if (this._login != process) {
      // Cancelled.
      return;
    }
    this._login = null;
    let { loggedIn, email } = await this._status();
    if (exitCode == 0 && loggedIn) {
      this._set("signed_in", { email });
    } else {
      this._set(loggedIn ? "signed_in" : "signed_out", {
        email,
        error: t("orbito-assistant-claude-login-failed"),
        command: await this.terminalCommand(),
      });
    }
  },

  cancelLogin() {
    let process = this._login;
    if (process) {
      this._login = null;
      process.kill();
      this._state = null;
      this.refresh().catch(e => console.warn("ClaudeAccount:", e));
    }
  },

  observe(subject, topic) {
    if (topic == "quit-application") {
      this._login?.kill(0);
    }
  },

  async logout() {
    this.cancelLogin();
    try {
      await (await this._start(["auth", "logout"])).wait();
    } finally {
      await this.refresh();
    }
  },

  /**
   * The command that signs the CLI in from a terminal, to the account
   * Orbito uses: for PowerShell on Windows, a POSIX shell elsewhere.
   */
  async terminalCommand() {
    let { configDir } = await ClaudeCLI._folders();
    let command;
    try {
      command = await ClaudeCLI._binaryPath();
    } catch {
      return "";
    }
    if (Services.appinfo.OS == "WINNT") {
      let quote = s => `'${s.replaceAll("'", "''")}'`;
      return `$env:CLAUDE_CONFIG_DIR=${quote(configDir)}; & ${quote(command)} auth login --claudeai`;
    }
    let quote = s => `'${s.replaceAll("'", `'\\''`)}'`;
    return `CLAUDE_CONFIG_DIR=${quote(configDir)} ${quote(command)} auth login --claudeai`;
  },

  /**
   * What `auth status` says: {loggedIn, email}. Keeps the plan it gives as
   * well.
   */
  async _status() {
    let output = "";
    let exitCode;
    try {
      let process = await this._start(["auth", "status", "--json"]);
      process.stdin.close().catch(() => {});
      await ClaudeCLI._readLines(process.stdout, line => (output += line));
      ({ exitCode } = await process.wait());
      let status = JSON.parse(output);
      let loggedIn = exitCode == 0 && status.loggedIn === true;
      this._plan =
        loggedIn && typeof status.subscriptionType == "string"
          ? status.subscriptionType.toLowerCase()
          : "";
      return { loggedIn, email: status.email || "" };
    } catch (e) {
      console.warn("ClaudeAccount: no status", exitCode, e);
      return { loggedIn: false, email: "" };
    }
  },

  /** Runs the CLI with arguments, without credentials in its environment. */
  async _start(args) {
    let { configDir, workDir } = await ClaudeCLI._folders();
    let command = await ClaudeCLI._binaryPath();
    try {
      // Its own stderr, not the browser's: on Windows, once the app has
      // restarted itself, a CLI given the browser's has no working
      // standard handles.
      let process = await lazy.Subprocess.call({
        command,
        arguments: args,
        environment: ClaudeCLI._environment(null, configDir),
        environmentAppend: false,
        stderr: "pipe",
        workdir: workDir,
      });
      ClaudeCLI._readLines(process.stderr, line =>
        console.debug("ClaudeAccount:", line)
      );
      return process;
    } catch (e) {
      throw new Error(
        t("orbito-assistant-claude-failed", {
          path: command,
          error: e.message || e,
        })
      );
    }
  },
};
