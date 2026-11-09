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
 *                     // under PermissionMode "bypass"; implies attendedOnly
 *     attendedOnly,  // optional; true: offered only to questions asked
 *                    // from a tab, never windowless, and never allowed to
 *                    // a task, since nobody would see what it does
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
 * Space's in that window, the pinned ones, and those of the popup windows
 * their pages opened: see openedTabs()), the query's abort signal and the
 * Thread it is answered in; tabById finds only those tabs. A tool that
 * opens a tab puts it in that Space and passes it to opened(), which
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
  "handle_dialog",
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
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

// The browserId of each top-level page a page opened -> the browserId of
// the opener's tab, kept from when the page's browsing context is made: a
// page that isolates itself (Cross-Origin-Opener-Policy, as sign-in pages
// do) gets a new browsing context without the opener, in the same browser.
const openers = new Map();
let watchingOpeners = false;

function watchOpeners() {
  if (watchingOpeners) {
    return;
  }
  watchingOpeners = true;
  Services.obs.addObserver(context => {
    let opener = context.top == context && openerContext(context);
    if (opener?.browserId && context.browserId != opener.browserId) {
      openers.set(context.browserId, opener.browserId);
    }
  }, "browsing-context-attached");
}

/** The top browsing context of the page that opened one, or null. */
function openerContext(context) {
  try {
    return (context.crossGroupOpener ?? context.opener)?.top ?? null;
  } catch {
    // Not a CanonicalBrowsingContext.
    return null;
  }
}

/** The open browser windows as private (or not) as win, win among them. */
function windowsLike(win) {
  let isPrivate = lazy.PrivateBrowsingUtils.isWindowPrivate(win);
  return [...Services.wm.getEnumerator("navigator:browser")].filter(
    w =>
      !w.closed &&
      w.gBrowser &&
      lazy.PrivateBrowsingUtils.isWindowPrivate(w) == isPrivate
  );
}

/** The open tabs of those windows, by their browser's browserId. */
function tabsByBrowser(win) {
  let tabs = new Map();
  for (let w of windowsLike(win)) {
    for (let tab of w.gBrowser.tabs) {
      let id = tab.linkedBrowser?.browserId;
      if (id && !tab.closing) {
        tabs.set(id, tab);
      }
    }
  }
  return tabs;
}

/** The tab of byId whose page opened the tab's, or null. */
function openerIn(tab, byId) {
  let browser = tab.linkedBrowser;
  let id =
    openerContext(browser?.browsingContext)?.browserId ||
    openers.get(browser?.browserId);
  return (id && byId.get(id)) || null;
}

/** Whether a tab in roots opened the tab's page, or opened one that did. */
function openedFrom(tab, roots, byId) {
  let seen = new Set();
  while (tab && !seen.has(tab)) {
    seen.add(tab);
    tab = openerIn(tab, byId);
    if (roots.has(tab)) {
      return true;
    }
  }
  return false;
}

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
      attendedOnly,
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
      (attendedOnly != null && typeof attendedOnly != "boolean") ||
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
   * @returns {boolean} Whether the tool by that name runs only with someone
   *   there: attendedOnly or alwaysConfirm.
   */
  attendedOnly(name) {
    let tool = this.get(name);
    return !!(tool?.attendedOnly || tool?.alwaysConfirm);
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
    watchOpeners();
    let tabIds = this._tabIds;
    let tools = this;
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
        let win = this.window;
        let known = spaces();
        let id = this.space;
        let own = win.gBrowser.tabs.filter(
          t => !t.closing && (!known || t.pinned || known.spaceOf(t) == id)
        );
        return own.concat(tools.openedTabs(win, own));
      },
      tabId: t => this.tabId(t),
      opened,
      tabById(id) {
        return this.tabs.find(t => tabIds.get(t) == id) || null;
      },
    };
  },

  /**
   * The tabs of popup windows (window.open with a size: a sign-in or
   * payment window, say), as private as win, whose pages one of these tabs
   * opened, or one of the popups they opened, and so on; a page's opener
   * counts even when it opened it with noopener. Other windows' tabs are
   * the user's, even those opened from these.
   *
   * @param {Window} win
   * @param {Element[]} tabs
   * @returns {Element[]}
   */
  openedTabs(win, tabs) {
    let roots = new Set(tabs);
    let byId = tabsByBrowser(win);
    return [...byId.values()].filter(
      t =>
        t.documentGlobal != win &&
        // A popup window has no toolbars.
        !t.documentGlobal.toolbar.visible &&
        openedFrom(t, roots, byId)
    );
  },

  /** The open tabs of every window as private as win, its own among them. */
  allTabs(win) {
    return [...tabsByBrowser(win).values()];
  },

  /**
   * The open tab whose page opened the tab's, in a window as private as
   * its, or null.
   */
  openerOf(tab) {
    return openerIn(tab, tabsByBrowser(tab.documentGlobal));
  },

  /**
   * Whether one of these tabs opened the tab's page, or opened the page of
   * a tab that did, and so on, in windows as private as the tab's.
   */
  openedFrom(tab, tabs) {
    return openedFrom(tab, new Set(tabs), tabsByBrowser(tab.documentGlobal));
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
