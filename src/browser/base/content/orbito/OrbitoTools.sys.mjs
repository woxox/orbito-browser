/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Registry of the browser tools the assistant's backends can call. Each
 * built-in tool is one module in tools/ whose default export is:
 *
 *   {
 *     name, description,
 *     schema,     // JSON Schema with type "object"
 *     readOnly,   // false: the user approves each call first
 *     concurrent,  // optional; true: calls of it in one model response may
 *                  // run at once (OpenAI-compatible and ChatGPT backends);
 *                  // only for a readOnly tool that keeps nothing, not even
 *                  // the question's state
 *     alwaysConfirm,  // optional; true: the user approves each call even
 *                     // under PermissionMode "bypass"
 *     autoAllow,  // optional; true: runs without asking under
 *                 // PermissionMode "auto"; never for a tool that sends data
 *                 // out (as a URL), since reading tabs is free
 *     label(ctx, input),         // optional, the step shown to the user
 *     step(ctx, input),          // optional, the step shown on the tab it
 *                                // acts in, for a label that names that
 *                                // tab; the label if not
 *     approvalText(ctx, input),  // optional, the question to approve (or a
 *                                // promise of it); may throw to reject bad
 *                                // input before asking
 *     approvalAction(ctx, input),  // optional, the step's short name
 *                                  // (e.g. "Open example.com"), shown
 *                                  // once it is answered; the tool's name
 *                                  // if not
 *     approvalSite(ctx, input),  // optional, the URL of the site the step
 *                                // goes to, shown under the question
 *     approvalCode(ctx, input),  // optional, code the step runs, shown
 *                                // in full with the question
 *     run(ctx, input),           // resolves to the result text, or to
 *                                // {content, images?, memory?, skill?,
 *                                // artifact?, page?}:
 *                                // images [{mimeType, data}] with base64
 *                                // data, memory {id, text} that was saved,
 *                                // skill {name} that was used, artifact
 *                                // {id, title} that was made or changed,
 *                                // page {url, title, tabId} that was read
 *                                // or opened (title null if not known yet);
 *                                // or throws
 *   }
 *
 * ctx is {tab, window, space, tabs, signal, threadId, windowless,
 * tabId(tab), tabById(id), opened(tab, {result}?)}: the tab the user asked
 * from, the window that tab is in now, the Space of the Thread (null in a
 * window without Spaces), the tabs the tools may see and act on (that
 * Space's in that window, and the pinned ones), the query's abort signal
 * and the Thread it is answered in; tabById finds only those tabs. A tool
 * that opens a tab puts it in that Space and passes it to opened(), which
 * puts it in the question's Orbit (with result, as what the task made). A
 * windowless query (a scheduled task) has neither tab nor window: reading
 * tab, window, tabs or tabById throws, so tools that need them fail; its
 * space is the Thread's (null for none, or for a Space removed since).
 * The assistant core asks for approval before running a tool that is not
 * readOnly, so tools never do that themselves.
 */

// Each is tools/<name>.sys.mjs, also listed in jar.mn.
const BUILTIN_TOOLS = [
  "get_page_text",
  "read_page",
  "click",
  "type",
  "select_option",
  "scroll",
  "press_key",
  "navigate",
  "screenshot",
  "run_script",
  "list_tabs",
  "open_tab",
  "select_tab",
  "close_tab",
  "group_tabs",
  "ungroup_tabs",
  "search_history",
  "search_browsing",
  "search_bookmarks",
  "think",
  "remember",
  "recall",
  "forget",
  "use_skill",
  "skill_step",
  "create_artifact",
  "update_artifact",
  "read_artifact",
  "search_artifacts",
];

const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  OrbitoShellStore:
    "chrome://browser/content/orbito/shell/OrbitoShellStore.sys.mjs",
});

export const OrbitoTools = {
  _tools: null,
  _tabIds: new WeakMap(),
  _nextTabId: 1,

  get _registry() {
    if (!this._tools) {
      let tools = new Map();
      for (let name of BUILTIN_TOOLS) {
        this._add(
          tools,
          ChromeUtils.importESModule(
            `chrome://browser/content/orbito/tools/${name}.sys.mjs`
          ).default
        );
      }
      this._tools = tools;
    }
    return this._tools;
  },

  /**
   * The tool definitions sent to backends.
   *
   * @returns {{name: string, description: string, schema: object,
   *            readOnly: boolean, concurrent: boolean}[]}
   */
  list() {
    return Array.from(
      this._registry.values(),
      ({ name, description, schema, readOnly, concurrent }) => ({
        name,
        description,
        schema,
        readOnly,
        concurrent: !!concurrent,
      })
    );
  },

  get(name) {
    return this._registry.get(name) || null;
  },

  /**
   * Adds a tool defined elsewhere (e.g. by an MCP server) to the registry.
   *
   * @param {object} tool Shaped like a tools/ module's default export.
   * @returns {Function} Removes the tool again.
   */
  register(tool) {
    this._add(this._registry, tool);
    return () => {
      if (this._registry.get(tool.name) == tool) {
        this._registry.delete(tool.name);
      }
    };
  },

  /**
   * @returns {boolean} Whether a tool by that name was registered.
   */
  unregister(name) {
    return this._registry.delete(name);
  },

  _add(tools, tool) {
    let {
      name,
      description,
      schema,
      readOnly,
      concurrent,
      alwaysConfirm,
      autoAllow,
      run,
    } = tool;
    if (typeof name != "string" || !NAME_PATTERN.test(name)) {
      throw new Error(`Invalid tool name ${name}.`);
    }
    if (tools.has(name)) {
      throw new Error(`A tool named ${name} is already registered.`);
    }
    if (
      typeof description != "string" ||
      schema?.type != "object" ||
      typeof readOnly != "boolean" ||
      (concurrent != null && typeof concurrent != "boolean") ||
      (concurrent && !readOnly) ||
      (alwaysConfirm != null && typeof alwaysConfirm != "boolean") ||
      (autoAllow != null && typeof autoAllow != "boolean") ||
      typeof run != "function"
    ) {
      throw new Error(
        `Tool ${name} needs a description, an object schema, readOnly and run.`
      );
    }
    tools.set(name, tool);
  },

  /**
   * Builds the ctx passed to a tool's label(), approvalText(),
   * approvalAction() and run().
   *
   * @param {object} options
   * @param {Element} [options.tab] The tab asked from; none windowless.
   * @param {string} [options.space] The Thread's Space; by default the
   *   tab's (or, for a pinned tab, the one its window shows). Without a
   *   tab, none by default.
   */
  context({ tab, space, signal, threadId, opened = () => {} }) {
    let tabIds = this._tabIds;
    let noTab = () => {
      throw new Error(
        "This runs without a browser tab or window, so this could not run."
      );
    };
    let spaces = () => tab?.documentGlobal.OrbitoShell?.spaces;
    return {
      get tab() {
        return tab || noTab();
      },
      signal,
      threadId,
      windowless: !tab,
      get window() {
        return tab ? tab.documentGlobal : noTab();
      },
      get space() {
        // Windowless, the Thread's own while that Space is there.
        if (!tab) {
          let list = lazy.OrbitoShellStore.get("spaces") ?? [];
          return list.some(s => s?.id == space) ? space : null;
        }
        let known = spaces();
        if (!known) {
          return null;
        }
        return known.list.some(s => s.id == space)
          ? space
          : (known.spaceOf(tab) ?? known.current);
      },
      get tabs() {
        let { gBrowser } = this.window;
        let known = spaces();
        let id = this.space;
        return gBrowser.tabs.filter(
          t => !t.closing && (!known || t.pinned || known.spaceOf(t) == id)
        );
      },
      tabId: t => this.tabId(t),
      opened,
      tabById(id) {
        return this.tabs.find(t => tabIds.get(t) == id) || null;
      },
    };
  },

  /**
   * An id for the tab that the model can refer to, unique across windows.
   */
  tabId(tab) {
    let id = this._tabIds.get(tab);
    if (!id) {
      id = this._nextTabId++;
      this._tabIds.set(tab, id);
    }
    return id;
  },
};
