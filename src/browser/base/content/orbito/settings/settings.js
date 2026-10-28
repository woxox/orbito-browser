/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * about:orbito-settings: the assistant's settings that need more room than
 * the panel's form, like the memories, the skills, the scheduled tasks and
 * the MCP servers. Server data, memories, skills and tasks are untrusted
 * and only ever inserted as text.
 */

const { OrbitoMCP } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoMCP.sys.mjs"
);
const { OrbitoChatGPT } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoChatGPT.sys.mjs"
);
const { ClaudeAccount } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/ClaudeCLI.sys.mjs"
);
const { OrbitoAssistantCore } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs"
);
const { OrbitoPages } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoPages.sys.mjs"
);
const { OrbitoTasks, MORNING_BRIEF } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoTasks.sys.mjs"
);
const { scheduleText } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoSchedule.sys.mjs"
);
const { demoSteps } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoShowReplay.sys.mjs"
);
const { OrbitoAppearance, THEMES, ACCENTS, THEME_PREF, ACCENT_PREF } =
  ChromeUtils.importESModule(
    "chrome://browser/content/orbito/shell/OrbitoAppearance.sys.mjs"
  );
const { AppConstants } = ChromeUtils.importESModule(
  "resource://gre/modules/AppConstants.sys.mjs"
);
const { UIState } = ChromeUtils.importESModule(
  "resource://services-sync/UIState.sys.mjs"
);
const { OrbitoRecall, ENABLED_PREF, EXCLUDED_PREF, RETENTION_PREF } =
  ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoRecall.sys.mjs"
  );
const { checkDomain } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs"
);
const { OrbitoShellStore, STORE_CHANGED } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/shell/OrbitoShellStore.sys.mjs"
);
const { renameSpace } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/shell/OrbitoSpaces.sys.mjs"
);
const { DownloadUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/DownloadUtils.sys.mjs"
);
const { t, OrbitoL10n, LANGUAGES } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

// The page takes Orbito's light, dark and accent, as the windows do.
OrbitoAppearance.follow(document);

const MEMORY_PREF = "orbito.assistant.memory.enabled";
const SIDEBAR_COLLAPSED_PREF = "orbito.sidebar.collapsed";
const ASSISTANT_AUTO_OPEN_PREF = "orbito.assistant.autoOpen";
// Where Sync's pages are opened from, for Mozilla's account server.
const SYNC_ENTRY_POINT = "orbito-settings";

function el(tag, props = {}, children = []) {
  let node = document.createElement(tag);
  for (let [key, value] of Object.entries(props)) {
    if (key == "class") {
      node.className = value;
    } else if (key == "text") {
      node.textContent = value;
    } else if (key.startsWith("on")) {
      node.addEventListener(key.slice(2), value);
    } else {
      node.setAttribute(key, value);
    }
  }
  node.append(...children);
  return node;
}

/**
 * Makes the buttons in a role=radiogroup element one tab stop, where the
 * arrow keys and Home and End pick the next, previous, first or last one;
 * a click picks one too. Picking calls pick(value) with the button's
 * data-value; check() then marks the picked one.
 *
 * @param {Element} group
 * @param {function(string)} pick
 * @returns {function(string)} check(value)
 */
function radioGroup(group, pick) {
  let radios = () => [...group.querySelectorAll("[role=radio]")];
  group.addEventListener("click", event => {
    let radio = event.target.closest("[role=radio]");
    if (radio) {
      pick(radio.dataset.value);
    }
  });
  group.addEventListener("keydown", event => {
    let list = radios();
    let index = list.indexOf(event.target);
    if (index == -1 || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    let back = document.dir == "rtl" ? "ArrowRight" : "ArrowLeft";
    let next = {
      ArrowUp: index - 1,
      [back]: index - 1,
      ArrowDown: index + 1,
      [back == "ArrowLeft" ? "ArrowRight" : "ArrowLeft"]: index + 1,
      Home: 0,
      End: list.length - 1,
    }[event.key];
    if (next == undefined) {
      return;
    }
    event.preventDefault();
    let radio = list.at(next % list.length);
    radio.focus();
    pick(radio.dataset.value);
  });
  return value => {
    for (let radio of radios()) {
      let on = radio.dataset.value == value;
      radio.setAttribute("aria-checked", on);
      radio.tabIndex = on ? 0 : -1;
    }
  };
}

/** Token counts as the user reads them, e.g. "1,200 in, 80 out tokens". */
function tokens(input, output) {
  let n = count => (count ?? 0).toLocaleString();
  return t("orbito-settings-tokens", { input: n(input), output: n(output) });
}

const OrbitoSettings = {
  init() {
    this._servers = document.getElementById("mcp-servers");
    this._form = document.getElementById("mcp-add");
    this._field("auth").addEventListener("change", () =>
      this._updateAuthFields()
    );
    this._form.addEventListener("submit", event => {
      event.preventDefault();
      this._addServer();
    });
    this._updateAuthFields();
    this._render = this._render.bind(this);
    OrbitoMCP.addListener(this._render);
    this._renderChatGPT = this._renderChatGPT.bind(this);
    OrbitoChatGPT.addListener(this._renderChatGPT);
    this._renderClaude = this._renderClaude.bind(this);
    ClaudeAccount.addListener(this._renderClaude);
    Services.prefs.addObserver("orbito.agent.auth", this._renderClaude);
    window.addEventListener("unload", () => {
      OrbitoMCP.removeListener(this._render);
      OrbitoChatGPT.removeListener(this._renderChatGPT);
      ClaudeAccount.removeListener(this._renderClaude);
      Services.prefs.removeObserver("orbito.agent.auth", this._renderClaude);
    });
    let button = id => document.getElementById(id);
    button("chatgpt-login").addEventListener("click", () =>
      OrbitoChatGPT.login()
    );
    button("chatgpt-cancel").addEventListener("click", () =>
      OrbitoChatGPT.cancelLogin()
    );
    button("chatgpt-logout").addEventListener("click", () =>
      OrbitoChatGPT.logout()
    );
    for (let radio of document.querySelectorAll("[name=claude-auth]")) {
      radio.addEventListener("change", () =>
        OrbitoAssistantCore.setClaudeAuth(radio.value)
      );
    }
    button("claude-login").addEventListener("click", () =>
      ClaudeAccount.login()
    );
    button("claude-cancel").addEventListener("click", () =>
      ClaudeAccount.cancelLogin()
    );
    button("claude-logout").addEventListener("click", () =>
      ClaudeAccount.logout()
    );
    // On its paragraph: localizing the paragraph may replace the button.
    button("open-library").parentElement.addEventListener("click", event => {
      if (event.target.closest("#open-library")) {
        event.preventDefault();
        OrbitoPages.openLibrary(window.browsingContext.topChromeWindow);
      }
    });
    button("open-timeline").addEventListener("click", () =>
      OrbitoPages.openTimeline(window.browsingContext.topChromeWindow)
    );
    button("open-firefox-settings").addEventListener("click", () =>
      window.browsingContext.topChromeWindow.openPreferences()
    );
    this._initAppearance();
    this._initLanguage();
    this._initLayout();
    this._initAccount();
    this._render();
    this._renderChatGPT();
    this._renderClaude();
    this._initSpaces();
    this._initMemories();
    this._initRecall();
    this._initDeleteData();
    this._initSkills();
    this._initTasks();
  },

  /* Spaces */

  _initSpaces() {
    let observer = {
      observe: (subject, topic, key) => {
        if (key == "spaces") {
          this._renderSpaces();
          // Their Space menus; a Space gone may have taken some.
          if (this._editingMemory == null) {
            this._renderMemories();
          }
        }
      },
    };
    Services.obs.addObserver(observer, STORE_CHANGED);
    // The Sidebar's Space menu asks for a Space's settings.
    let take = () => {
      this._focusSpace = OrbitoPages.takeSpaceSettings();
      if (this._focusSpace) {
        this._renderSpaces();
      }
    };
    Services.obs.addObserver(take, OrbitoPages.SPACE_SETTINGS_TOPIC);
    window.addEventListener("unload", () => {
      Services.obs.removeObserver(observer, STORE_CHANGED);
      Services.obs.removeObserver(take, OrbitoPages.SPACE_SETTINGS_TOPIC);
    });
    take();
    this._renderSpaces();
  },

  // The Space whose card takes focus once drawn, and the one whose card
  // asks whether to delete it.
  _focusSpace: null,
  _confirmingSpace: null,
  _spacesSeq: 0,

  /**
   * A card per Space: those being removed say so, with an undo, until they
   * go.
   */
  async _renderSpaces() {
    let list = document.getElementById("space-list");
    // Not while a name or model is being typed, which a change elsewhere
    // would take away.
    let typing = document.activeElement;
    if (typing?.matches(".space-model, .space-name") && list.contains(typing)) {
      list.addEventListener("focusout", () => this._renderSpaces(), {
        once: true,
      });
      return;
    }
    let seq = ++this._spacesSeq;
    let [memories, skills] = await Promise.all([
      OrbitoAssistantCore.listMemories(),
      OrbitoAssistantCore.skills(),
    ]);
    if (seq != this._spacesSeq) {
      return;
    }
    let spaces = OrbitoShellStore.get("spaces") ?? [];
    let removing = new Set(OrbitoAssistantCore.removingSpaces());
    let shown = spaces.filter(space => !removing.has(space.id));
    list.replaceChildren(
      ...spaces.map(space =>
        removing.has(space.id)
          ? this._removedSpaceCard(space)
          : this._spaceCard(space, {
              shown,
              memories: memories.filter(m => m.space_id == space.id),
              skills: skills.filter(skill => skill.space == space.id),
            })
      )
    );
    let focus = this._focusSpace;
    let field =
      focus && list.querySelector(`.space[data-space="${focus}"] .space-name`);
    if (field) {
      this._focusSpace = null;
      field.scrollIntoView({ block: "center" });
      field.focus();
    }
  },

  /**
   * A Space's settings: its name, default backend and model, the memories
   * and skills kept for it only, and deleting it.
   */
  _spaceCard(space, { shown, memories, skills }) {
    let { backend, model } = OrbitoAssistantCore.spaceBackend(space.id);
    let name = el("input", {
      class: "space-name",
      maxlength: "60",
      onchange: event => {
        let spaces = OrbitoShellStore.get("spaces") ?? [];
        let renamed = renameSpace(spaces, space.id, event.target.value);
        if (renamed != spaces) {
          OrbitoShellStore.set("spaces", renamed);
        } else {
          event.target.value = space.name;
        }
      },
    });
    name.value = space.name;
    let backends = el(
      "select",
      {
        class: "space-backend",
        onchange: event =>
          OrbitoAssistantCore.setSpaceBackend(space.id, {
            backend: event.target.value || null,
          }),
      },
      [
        el("option", {
          value: "",
          text: t("orbito-settings-space-backend-default"),
        }),
        ...Object.entries(OrbitoAssistantCore.BACKENDS).map(([id, b]) =>
          el("option", { value: id, text: b.label })
        ),
      ]
    );
    backends.value = backend ?? "";
    let models = el("input", {
      class: "space-model",
      // The model the backend gets without one.
      placeholder: backend ? OrbitoAssistantCore.model(backend) : "",
      onchange: event =>
        OrbitoAssistantCore.setSpaceBackend(space.id, {
          backend,
          model: event.target.value,
        }),
    });
    models.value = model ?? "";
    models.disabled = !backend;
    let kept = (cls, label, items) => [
      el("h4", { text: t(label) }),
      items.length
        ? el(
            "ul",
            { class: cls },
            items.map(text => el("li", { text }))
          )
        : el("p", { class: `hint ${cls}`, text: t("orbito-settings-space-none") }),
    ];
    return el("li", { class: "card space", "data-space": space.id }, [
      el("h3", { text: space.name }),
      el("label", {}, [
        el("span", { text: t("orbito-settings-space-name") }),
        name,
      ]),
      el("label", {}, [el("span", { text: t("orbito-settings-backend") }), backends]),
      el("label", {}, [el("span", { text: t("orbito-settings-model") }), models]),
      ...kept(
        "space-memories",
        "orbito-settings-space-memories",
        memories.map(m => m.text)
      ),
      ...kept(
        "space-skills",
        "orbito-settings-space-skills",
        skills.map(skill => `/${skill.name}`)
      ),
      this._spaceRemove(space, shown),
    ]);
  },

  /**
   * Deleting a Space takes a second click, once what happens to the rest
   * is picked: moved to another Space (the first other one by default) or
   * deleted with it. Its tabs close.
   */
  _spaceRemove(space, shown) {
    let others = shown.filter(s => s.id != space.id);
    if (this._confirmingSpace != space.id) {
      let start = el("button", {
        class: "space-remove",
        text: t("orbito-settings-space-remove"),
        onclick: () => {
          this._confirmingSpace = space.id;
          this._renderSpaces();
        },
      });
      start.disabled = !others.length;
      return el("div", { class: "actions" }, [start]);
    }
    let choice = el(
      "select",
      { class: "space-remove-data" },
      [
        ...others.map(other =>
          el("option", {
            value: other.id,
            text: t("orbito-spaces-remove-move", { name: other.name }),
          })
        ),
        el("option", { value: "", text: t("orbito-spaces-remove-delete") }),
      ]
    );
    return el("div", { class: "space-remove-form" }, [
      el("p", {
        text: t("orbito-spaces-remove-title", { name: space.name }),
      }),
      el("label", {}, [
        el("span", { text: t("orbito-spaces-remove-data") }),
        choice,
      ]),
      el("div", { class: "actions" }, [
        el("button", {
          class: "space-remove-cancel",
          text: t("orbito-settings-cancel"),
          onclick: () => {
            this._confirmingSpace = null;
            this._renderSpaces();
          },
        }),
        el("button", {
          class: "primary space-remove-confirm",
          text: t("orbito-spaces-remove-confirm"),
          onclick: () => {
            this._confirmingSpace = null;
            OrbitoAssistantCore.removeSpace(space.id, {
              to: choice.value || null,
            });
          },
        }),
      ]),
    ]);
  },

  /** A Space being removed, until its undo time is up. */
  _removedSpaceCard(space) {
    return el("li", { class: "card space removed", "data-space": space.id }, [
      el("p", {
        role: "status",
        text: t("orbito-spaces-removed", { name: space.name }),
      }),
      el("div", { class: "actions" }, [
        el("button", {
          class: "space-undo",
          text: t("orbito-spaces-undo"),
          onclick: () => OrbitoAssistantCore.undoRemoveSpace(space.id),
        }),
      ]),
    ]);
  },

  /* Appearance */

  _initAppearance() {
    let theme = document.getElementById("theme");
    theme.append(
      ...THEMES.map(({ id, name }) =>
        el("button", { type: "button", role: "radio", "data-value": id, text: name })
      )
    );
    let accent = document.getElementById("accent");
    accent.append(
      ...ACCENTS.map(({ id, name, hue, chroma }) => {
        let swatch = el("button", {
          type: "button",
          role: "radio",
          class: "swatch",
          "data-value": id,
          "aria-label": name,
          title: name,
        });
        swatch.style.setProperty("--swatch-hue", hue);
        swatch.style.setProperty("--swatch-chroma", chroma);
        return swatch;
      })
    );
    let checkTheme = radioGroup(theme, id => OrbitoAppearance.setTheme(id));
    let checkAccent = radioGroup(accent, id => OrbitoAppearance.setAccent(id));
    let sync = () => {
      checkTheme(OrbitoAppearance.theme);
      checkAccent(OrbitoAppearance.accent.id);
    };
    sync();
    Services.prefs.addObserver(THEME_PREF, sync);
    Services.prefs.addObserver(ACCENT_PREF, sync);
    window.addEventListener("unload", () => {
      Services.prefs.removeObserver(THEME_PREF, sync);
      Services.prefs.removeObserver(ACCENT_PREF, sync);
    });
  },

  /* Language: Orbito's and Firefox's, from the next start */

  _initLanguage() {
    let group = document.getElementById("language");
    group.append(
      ...LANGUAGES.map(language =>
        el("button", {
          type: "button",
          role: "radio",
          "data-value": language,
          lang: language,
          text: OrbitoL10n.nativeName(language),
        })
      )
    );
    let restart = document.getElementById("language-restart");
    let status = restart.querySelector("p");
    restart.querySelector("button").addEventListener("click", () => {
      let cancel = Cc["@mozilla.org/supports-PRBool;1"].createInstance(
        Ci.nsISupportsPRBool
      );
      Services.obs.notifyObservers(cancel, "quit-application-requested", "restart");
      if (!cancel.data) {
        Services.startup.quit(
          Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart
        );
      }
    });
    let check = radioGroup(group, async language => {
      if (group.hasAttribute("aria-busy")) {
        return;
      }
      check(language);
      group.setAttribute("aria-busy", "true");
      let withFirefox = true;
      try {
        withFirefox = await OrbitoL10n.setLanguage(language);
      } finally {
        group.removeAttribute("aria-busy");
      }
      show(withFirefox);
    });
    let show = (withFirefox = true) => {
      let picked = OrbitoL10n.requestedLanguage;
      check(picked);
      restart.hidden = picked == OrbitoL10n.language;
      let pending = t("orbito-language-pending", {
        language: OrbitoL10n.nativeName(picked),
      });
      status.textContent = withFirefox
        ? pending
        : `${pending} ${t("orbito-language-no-langpack")}`;
    };
    show();
  },

  /* Layout: the Sidebar and the Assistant panel, in every window */

  _initLayout() {
    let mac = AppConstants.platform == "macosx";
    document.l10n.setAttributes(
      document.getElementById("sidebar-collapsed-label"),
      "orbito-settings-sidebar-collapsed",
      { shortcut: mac ? "⌘S" : "Ctrl+S" }
    );
    let boxes = [
      [document.getElementById("sidebar-collapsed"), SIDEBAR_COLLAPSED_PREF],
      [document.getElementById("assistant-auto-open"), ASSISTANT_AUTO_OPEN_PREF],
    ];
    let sync = () => {
      for (let [box, pref] of boxes) {
        box.checked = Services.prefs.getBoolPref(pref, false);
      }
    };
    sync();
    for (let [box, pref] of boxes) {
      box.addEventListener("change", () =>
        Services.prefs.setBoolPref(pref, box.checked)
      );
      Services.prefs.addObserver(pref, sync);
    }
    window.addEventListener("unload", () => {
      for (let [, pref] of boxes) {
        Services.prefs.removeObserver(pref, sync);
      }
    });
  },

  /* Account (Firefox Sync, through the window's gSync) */

  _initAccount() {
    let render = () => this._renderAccount();
    Services.obs.addObserver(render, UIState.ON_UPDATE);
    window.addEventListener("unload", () =>
      Services.obs.removeObserver(render, UIState.ON_UPDATE)
    );
    this._renderAccount();
  },

  /**
   * What the account section says and offers for Sync's state:
   * {status, actions: [{id, label, primary, disabled, run}]}.
   */
  _accountState() {
    if (!Services.prefs.getBoolPref("identity.fxaccounts.enabled", true)) {
      return { status: t("orbito-settings-sync-disabled"), actions: [] };
    }
    let gSync = window.browsingContext.topChromeWindow.gSync;
    let entry = SYNC_ENTRY_POINT;
    let state = UIState.get();
    let signOut = {
      id: "sign-out",
      label: t("orbito-settings-sign-out"),
      run: () => gSync.disconnect(),
    };
    let manage = {
      id: "manage-account",
      label: t("orbito-settings-manage-account"),
      run: () => gSync.openFxAManagePage(entry),
    };
    switch (state.status) {
      case UIState.STATUS_LOGIN_FAILED:
        return {
          status: t("orbito-settings-sync-login-failed", {
            email: state.email,
          }),
          actions: [
            signOut,
            {
              id: "sign-in-again",
              label: t("orbito-settings-sign-in-again"),
              primary: true,
              run: () => gSync.openSignInAgainPage(entry),
            },
          ],
        };
      case UIState.STATUS_NOT_VERIFIED:
        return {
          status: t("orbito-settings-sync-not-verified", {
            email: state.email,
          }),
          actions: [
            signOut,
            {
              id: "verify",
              label: t("orbito-settings-confirm-account"),
              primary: true,
              run: () => gSync.verifyAccount(),
            },
          ],
        };
      case UIState.STATUS_SIGNED_IN:
        if (!state.syncEnabled) {
          return {
            status: t("orbito-settings-sync-off", { email: state.email }),
            actions: [
              manage,
              {
                id: "turn-on",
                label: t("orbito-settings-turn-on-sync"),
                primary: true,
                run: () => gSync.openSyncSetupForEntryPoint(entry),
              },
            ],
          };
        }
        return {
          status: state.syncing
            ? t("orbito-settings-sync-syncing", { email: state.email })
            : state.lastSync
              ? t("orbito-settings-sync-last-synced", {
                  email: state.email,
                  date: state.lastSync.toLocaleString(),
                })
              : t("orbito-settings-sync-not-synced", { email: state.email }),
          actions: [
            manage,
            {
              id: "choose",
              label: t("orbito-settings-choose-what-to-sync"),
              run: () =>
                gSync.openPrefs(entry, null, { action: "choose-what-to-sync" }),
            },
            {
              id: "sync-now",
              label: t("orbito-settings-sync-now"),
              primary: true,
              disabled: state.syncing,
              run: () => gSync.doSync(),
            },
          ],
        };
      default:
        return {
          status: t("orbito-settings-not-signed-in"),
          actions: [
            {
              id: "sign-in",
              label: t("orbito-settings-sign-in"),
              primary: true,
              run: () => gSync.openFxAEmailFirstPage(entry),
            },
          ],
        };
    }
  },

  _renderAccount() {
    let { status, actions } = this._accountState();
    document.getElementById("sync-status").textContent = status;
    let box = document.getElementById("sync-actions");
    // The same buttons stay (and keep focus) while only their state changes.
    let ids = actions.map(action => action.id).join();
    if (box.dataset.actions != ids) {
      let hadFocus = box.contains(document.activeElement);
      box.dataset.actions = ids;
      box.replaceChildren(
        ...actions.map(action =>
          el("button", {
            "data-action": action.id,
            class: action.primary ? "primary" : "",
            text: action.label,
          })
        )
      );
      if (hadFocus) {
        box.firstElementChild?.focus();
      }
    }
    for (let action of actions) {
      let button = box.querySelector(`[data-action="${action.id}"]`);
      button.disabled = !!action.disabled;
      button.onclick = action.run;
    }
  },

  /* Memories */

  _initMemories() {
    let $ = id => document.getElementById(id);
    let enabled = $("memory-enabled");
    let sync = () => (enabled.checked = OrbitoAssistantCore.memoryEnabled);
    sync();
    enabled.addEventListener("change", () =>
      Services.prefs.setBoolPref(MEMORY_PREF, enabled.checked)
    );
    Services.prefs.addObserver(MEMORY_PREF, sync);
    window.addEventListener("unload", () =>
      Services.prefs.removeObserver(MEMORY_PREF, sync)
    );
    // Deleting them all takes a second click on a button that only then
    // shows.
    let confirming = on => {
      $("memories-clear-start").hidden = on;
      for (let id of ["question", "cancel", "confirm"]) {
        $(`memories-clear-${id}`).hidden = !on;
      }
    };
    $("memories-clear-start").addEventListener("click", () => confirming(true));
    $("memories-clear-cancel").addEventListener("click", () =>
      confirming(false)
    );
    $("memories-clear-confirm").addEventListener("click", async () => {
      confirming(false);
      await OrbitoAssistantCore.deleteAllMemories();
      this._renderMemories();
    });
    // The assistant may have saved some since the tab was last shown.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this._editingMemory == null) {
        this._renderMemories();
      }
    });
    this._renderMemories();
  },

  /* Browsing recall */

  _initRecall() {
    let $ = id => document.getElementById(id);
    let enabled = $("recall-enabled");
    let retention = $("recall-retention");
    let form = $("recall-domain-form");
    let sync = () => {
      enabled.checked = OrbitoRecall.enabled;
      let days = String(Services.prefs.getIntPref(RETENTION_PREF, 180));
      if (![...retention.options].some(o => o.value == days)) {
        retention.append(
          el("option", {
            value: days,
            text: t("orbito-settings-recall-days", { days: Number(days) }),
          })
        );
      }
      retention.value = days;
      this._renderDomains();
    };
    enabled.addEventListener("change", () =>
      Services.prefs.setBoolPref(ENABLED_PREF, enabled.checked)
    );
    retention.addEventListener("change", async () => {
      Services.prefs.setIntPref(RETENTION_PREF, Number(retention.value));
      await OrbitoRecall.whenSettled();
      this._renderRecallStats();
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      let error = form.querySelector(".error");
      let domain;
      try {
        domain = checkDomain(form.elements.domain.value);
      } catch {
        error.textContent = t("orbito-settings-recall-domain-error");
        error.hidden = false;
        return;
      }
      error.hidden = true;
      form.reset();
      let domains = OrbitoRecall.excludedDomains;
      if (!domains.includes(domain)) {
        this._setDomains([...domains, domain]);
        await OrbitoRecall.whenSettled();
        this._renderRecallStats();
      }
    });
    let prefs = [ENABLED_PREF, EXCLUDED_PREF, RETENTION_PREF];
    for (let pref of prefs) {
      Services.prefs.addObserver(pref, sync);
    }
    window.addEventListener("unload", () => {
      for (let pref of prefs) {
        Services.prefs.removeObserver(pref, sync);
      }
    });
    // Pages may have been remembered since the tab was last shown.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        this._renderRecallStats();
      }
    });
    sync();
    this._renderRecallStats();
  },

  _setDomains(domains) {
    Services.prefs.setStringPref(EXCLUDED_PREF, JSON.stringify(domains));
  },

  _renderDomains() {
    let domains = OrbitoRecall.excludedDomains;
    document.getElementById("recall-domains").replaceChildren(
      ...domains.map(domain =>
        el("li", { class: "card domain", "data-domain": domain }, [
          el("span", { text: domain }),
          el("button", {
            text: t("orbito-settings-recall-domain-remove"),
            "aria-label": t("orbito-settings-recall-domain-remove-label", {
              domain,
            }),
            onclick: () =>
              this._setDomains(
                OrbitoRecall.excludedDomains.filter(d => d != domain)
              ),
          }),
        ])
      )
    );
  },

  async _renderRecallStats() {
    let { pages, bytes } = await OrbitoRecall.stats();
    let [amount, unit] = DownloadUtils.convertByteUnits(bytes);
    document.getElementById("recall-stats").textContent = t(
      "orbito-settings-recall-stats",
      { pages, size: `${amount} ${unit}` }
    );
  },

  /* Delete all agent data */

  _initDeleteData() {
    let $ = id => document.getElementById(id);
    // Takes a second click on a button that only then shows.
    let confirming = on => {
      $("delete-data-start").hidden = on;
      for (let id of ["question", "cancel", "confirm"]) {
        $(`delete-data-${id}`).hidden = !on;
      }
    };
    $("delete-data-start").addEventListener("click", () => confirming(true));
    $("delete-data-cancel").addEventListener("click", () => confirming(false));
    $("delete-data-confirm").addEventListener("click", async () => {
      confirming(false);
      await OrbitoAssistantCore.deleteAllData();
      this._renderMemories();
      this._renderRecallStats();
      this._renderTasks();
    });
  },

  // The id of the memory whose edit form is open.
  _editingMemory: null,

  async _renderMemories() {
    let memories = await OrbitoAssistantCore.listMemories();
    let list = document.getElementById("memories");
    document.getElementById("memories-empty").hidden = !!memories.length;
    document.getElementById("memories-clear").hidden = !memories.length;
    list.replaceChildren(...memories.map(m => this._memoryCard(m)));
    // The Space cards list the memories kept for each.
    this._renderSpaces();
  },

  _memoryCard(memory) {
    let date = time => new Date(time).toLocaleString();
    let meta = memory.last_used_at
      ? t("orbito-settings-memory-meta-used", {
          saved: date(memory.created_at),
          used: date(memory.last_used_at),
        })
      : t("orbito-settings-memory-meta-unused", {
          saved: date(memory.created_at),
        });
    let source = memory.source_url
      ? el("p", { class: "hint memory-source" }, [
          t("orbito-settings-memory-source"),
          " ",
          el("a", {
            href: memory.source_url,
            text: memory.source_url,
            onclick: event => {
              event.preventDefault();
              window.browsingContext.topChromeWindow.openWebLinkIn(
                memory.source_url,
                "tab"
              );
            },
          }),
        ])
      : "";
    return el("li", { class: "card memory", "data-id": memory.id }, [
      this._editingMemory == memory.id
        ? this._memoryForm(memory)
        : el("p", { class: "memory-text", text: memory.text }),
      el("p", { class: "hint memory-meta", text: meta }),
      source,
      this._editingMemory == memory.id
        ? ""
        : el("div", { class: "actions" }, [
            this._memorySpace(memory),
            el("button", {
              text: t("orbito-settings-delete"),
              onclick: async () => {
                await OrbitoAssistantCore.deleteMemory(memory.id);
                this._renderMemories();
              },
            }),
            el("button", {
              text: t("orbito-settings-edit"),
              onclick: () => {
                this._editingMemory = memory.id;
                this._renderMemories();
              },
            }),
          ]),
    ]);
  },

  /** The menu of the Space a memory is kept for, or all of them. */
  _memorySpace(memory) {
    let spaces = OrbitoShellStore.get("spaces") ?? [];
    let options = [
      { id: "", name: t("orbito-settings-memory-all-spaces") },
      ...spaces,
    ];
    // A Space removed since, until the memory gets another.
    if (memory.space_id != null && !spaces.some(s => s.id == memory.space_id)) {
      options.push({
        id: memory.space_id,
        name: t("orbito-settings-memory-space-gone"),
      });
    }
    let select = el(
      "select",
      {
        class: "memory-space",
        "aria-label": t("orbito-settings-memory-space"),
        onchange: async event => {
          await OrbitoAssistantCore.setMemorySpace(
            memory.id,
            event.target.value || null
          );
          this._renderMemories();
        },
      },
      options.map(({ id, name }) => el("option", { value: id, text: name }))
    );
    select.value = memory.space_id ?? "";
    return select;
  },

  _memoryForm(memory) {
    let text = el("textarea", { name: "text", rows: "2" });
    text.value = memory.text;
    let error = el("p", { class: "error", hidden: "" });
    let form = el("form", { class: "edit" }, [
      text,
      error,
      el("div", { class: "actions" }, [
        el("button", {
          type: "button",
          text: t("orbito-settings-cancel"),
          onclick: () => {
            this._editingMemory = null;
            this._renderMemories();
          },
        }),
        el("button", {
          type: "submit",
          class: "primary",
          text: t("orbito-settings-save"),
        }),
      ]),
    ]);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      try {
        await OrbitoAssistantCore.updateMemory(memory.id, text.value);
      } catch (e) {
        error.textContent = e.message;
        error.hidden = false;
        return;
      }
      this._editingMemory = null;
      this._renderMemories();
    });
    return form;
  },

  /* Skills */

  _initSkills() {
    let form = document.getElementById("skill-form");
    form.addEventListener("submit", event => {
      event.preventDefault();
      this._saveSkill();
    });
    document.getElementById("skill-cancel").addEventListener("click", () =>
      this._closeSkillForm()
    );
    document.getElementById("skill-new").addEventListener("click", () =>
      this._openSkillForm(t("orbito-settings-skill-new"), {})
    );
    // Show Orbito in this window: the Assistant panel asks for the goal.
    document.getElementById("skill-from-demo").addEventListener("click", () =>
      window.browsingContext.topChromeWindow.OrbitoShell?.show.begin()
    );
    // Skills may have been dropped into the folder in the meantime.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        this._renderSkills();
      }
    });
    // A draft the panel made from a Thread ("Save as skill"), waiting
    // now or sent while this page is open. The user saves it.
    let takeDraft = () => {
      let draft = OrbitoPages.takeSkillDraft();
      if (draft) {
        this._openSkillForm(
          t("orbito-settings-skill-new-from-thread"),
          draft,
          {}
        );
      }
    };
    Services.obs.addObserver(takeDraft, OrbitoPages.SKILL_DRAFT_TOPIC);
    window.addEventListener("unload", () =>
      Services.obs.removeObserver(takeDraft, OrbitoPages.SKILL_DRAFT_TOPIC)
    );
    this._renderSkills();
  },

  // What the open form changes: {dir, original, source}, source kept as the
  // skill has it; null when it is closed.
  _skillTarget: null,

  async _renderSkills() {
    let skills = await OrbitoAssistantCore.skills();
    this._skills = skills;
    this._renderTaskSkills();
    document
      .getElementById("skill-list")
      .replaceChildren(...skills.map(s => this._skillCard(s)));
    // The Space cards list the skills kept for each.
    this._renderSpaces();
  },

  _skillCard(skill) {
    let button = (text, onclick) => el("button", { text, onclick });
    return el(
      "li",
      {
        class: "card skill",
        "data-name": skill.name,
        ...(skill.dir ? { "data-dir": skill.dir } : {}),
        ...(skill.source ? { "data-source": skill.source } : {}),
      },
      [
        el("div", { class: "skill-head" }, [
          el("span", { class: "skill-name", text: `/${skill.name}` }),
          el("span", {
            class: "skill-kind",
            text: skill.builtin
              ? t("orbito-settings-skill-builtin")
              : skill.source == "demo"
                ? t("orbito-settings-skill-from-demo-kind")
                : t("orbito-settings-skill-yours"),
          }),
        ]),
        el("p", { class: "skill-description", text: skill.description }),
        el("div", { class: "actions" }, [
          el("label", { class: "checkbox" }, [
            el("input", {
              type: "checkbox",
              ...(skill.enabled ? { checked: "" } : {}),
              onchange: event => {
                OrbitoAssistantCore.setSkillEnabled(skill, event.target.checked);
                this._renderSkills();
              },
            }),
            t("orbito-settings-on"),
          ]),
          this._skillSpace(skill),
          ...(skill.builtin
            ? [
                button(t("orbito-settings-skill-copy"), () =>
                  this._openSkillForm(
                    t("orbito-settings-skill-copy-title", { name: skill.name }),
                    skill,
                    { original: skill.name }
                  )
                ),
              ]
            : [
                button(t("orbito-settings-delete"), async () => {
                  await OrbitoAssistantCore.deleteSkill(skill.dir);
                  if (this._skillTarget?.dir == skill.dir) {
                    this._closeSkillForm();
                  }
                  this._renderSkills();
                }),
                button(t("orbito-settings-edit"), () =>
                  this._openSkillForm(
                    t("orbito-settings-skill-edit-title", { name: skill.name }),
                    skill,
                    { dir: skill.dir, original: skill.name, source: skill.source }
                  )
                ),
                // Show Orbito again in this window; saving the new demo
                // replaces this skill.
                ...(skill.source == "demo"
                  ? [
                      button(t("orbito-settings-skill-rerecord"), () =>
                        window.browsingContext.topChromeWindow.OrbitoShell?.show.begin({
                          replace: { dir: skill.dir, name: skill.name },
                          goal: skill.description,
                        })
                      ),
                    ]
                  : []),
              ]),
        ]),
      ]
    );
  },

  /** The menu of the Space a skill is for, or all of them. */
  _skillSpace(skill) {
    let spaces = OrbitoShellStore.get("spaces") ?? [];
    let options = [
      { id: "", name: t("orbito-settings-skill-all-spaces") },
      ...spaces,
    ];
    // A Space removed since, until the skill gets another.
    if (skill.space != null && !spaces.some(s => s.id == skill.space)) {
      options.push({
        id: skill.space,
        name: t("orbito-settings-skill-space-gone"),
      });
    }
    let select = el(
      "select",
      {
        class: "skill-space",
        "aria-label": t("orbito-settings-skill-space"),
        onchange: event => {
          OrbitoAssistantCore.setSkillSpace(skill, event.target.value || null);
          this._renderSkills();
        },
      },
      options.map(({ id, name }) => el("option", { value: id, text: name }))
    );
    select.value = skill.space ?? "";
    return select;
  },

  _openSkillForm(title, skill, target = {}) {
    let form = document.getElementById("skill-form");
    let field = name => form.elements.namedItem(name);
    form.querySelector("h3").textContent = title;
    field("name").value = skill.name ?? "";
    field("description").value = skill.description ?? "";
    field("tools").value = (skill.tools ?? []).join(", ");
    field("output").value = skill.output ?? "chat";
    field("body").value = skill.body ?? "";
    form.querySelector(".error").hidden = true;
    this._skillTarget = target;
    form.hidden = false;
    field("name").focus();
  },

  _closeSkillForm() {
    document.getElementById("skill-form").hidden = true;
    this._skillTarget = null;
  },

  async _saveSkill() {
    let form = document.getElementById("skill-form");
    let field = name => form.elements.namedItem(name).value;
    let error = form.querySelector(".error");
    error.hidden = true;
    try {
      await OrbitoAssistantCore.saveSkill(
        {
          name: field("name"),
          description: field("description"),
          tools: field("tools").split(/[\s,]+/).filter(Boolean),
          output: field("output"),
          source: this._skillTarget?.source,
          body: field("body"),
        },
        this._skillTarget
      );
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      return;
    }
    this._closeSkillForm();
    this._renderSkills();
  },

  /* Scheduled tasks */

  _initTasks() {
    let form = document.getElementById("task-form");
    let field = name => form.elements.namedItem(name);
    field("backend").replaceChildren(
      el("option", {
        value: "",
        text: t("orbito-settings-task-backend-space"),
      }),
      ...Object.entries(OrbitoAssistantCore.BACKENDS).map(([id, backend]) =>
        el("option", { value: id, text: backend.label })
      )
    );
    field("backend").addEventListener("change", () =>
      this._updateModelField()
    );
    field("kind").addEventListener("change", () =>
      this._updateScheduleFields()
    );
    // A skill picked allows the tools it lists, for the user to check.
    field("skill").addEventListener("change", () => {
      this._renderAllowedTools(this._skillTools(field("skill").value));
      this._renderSkillInputs(field("skill").value);
      this._updateQuestionField();
    });
    form.addEventListener("submit", event => {
      event.preventDefault();
      this._saveTask();
    });
    document.getElementById("task-cancel").addEventListener("click", () =>
      this._closeTaskForm()
    );
    document.getElementById("task-new").addEventListener("click", () =>
      this._openTaskForm(null)
    );
    document
      .getElementById("task-morning-brief")
      .addEventListener("click", () => this._openTaskForm(null, MORNING_BRIEF));
    this._renderTasks = this._renderTasks.bind(this);
    OrbitoTasks.addListener(this._renderTasks);
    // A notification of a failed run asks for its task's runs, now or while
    // this page is open.
    let takeRuns = () => {
      let id = OrbitoPages.takeTaskRuns();
      if (id) {
        this._showRuns = id;
        this._renderTasks();
      }
    };
    Services.obs.addObserver(takeRuns, OrbitoPages.TASK_RUNS_TOPIC);
    window.addEventListener("unload", () => {
      OrbitoTasks.removeListener(this._renderTasks);
      Services.obs.removeObserver(takeRuns, OrbitoPages.TASK_RUNS_TOPIC);
    });
    takeRuns();
    this._renderTasks();
  },

  // The task whose edit form is open: its id, "" for a new one, null when
  // the form is closed.
  _editingTask: null,
  // The task whose runs to open and scroll to on the next render.
  _showRuns: null,
  // The last render started: only it draws the list, so an earlier one that
  // ends later does not undo it (closing the runs it was to show).
  _tasksRender: 0,

  async _renderTasks() {
    let render = ++this._tasksRender;
    let tasks = await OrbitoTasks.list();
    let list = document.getElementById("task-list");
    let open = new Set(
      [...list.querySelectorAll(".task-runs[open]")].map(d => d.dataset.task)
    );
    let show = this._showRuns;
    if (show) {
      open.add(show);
    }
    let cards = await Promise.all(
      tasks.map(t => this._taskCard(t, open.has(t.id)))
    );
    if (render != this._tasksRender) {
      return;
    }
    this._showRuns = null;
    document.getElementById("tasks-empty").hidden = !!tasks.length;
    list.replaceChildren(...cards);
    if (show) {
      list
        .querySelector(`.task[data-id="${CSS.escape(show)}"]`)
        ?.scrollIntoView({ block: "start" });
    }
  },

  async _taskCard(task, runsOpen) {
    let date = time => new Date(time).toLocaleString();
    let last = task.last_run;
    let state = OrbitoTasks.isPending(task.id)
      ? t("orbito-settings-task-running")
      : task.enabled
        ? t("orbito-settings-task-next-run", { date: date(task.next_run_at) })
        : t("orbito-settings-task-off");
    let meta =
      last && last.status != "running"
        ? t("orbito-settings-task-meta", {
            state,
            lastRun: t("orbito-settings-task-last-run", {
              date: date(last.started_at),
              status: last.status,
            }),
          })
        : state;
    let button = (text, onclick, props = {}) =>
      el("button", { text, onclick, ...props });
    let runs = el("details", { class: "task-runs", "data-task": task.id }, [
      el("summary", { text: t("orbito-settings-task-runs") }),
      runsOpen ? await this._runList(task) : el("ul"),
    ]);
    runs.open = runsOpen;
    runs.addEventListener("toggle", async () => {
      if (runs.open) {
        runs.lastChild.replaceWith(await this._runList(task));
      }
    });
    return el("li", { class: "card task", "data-id": task.id }, [
      el("div", { class: "task-head" }, [
        el("span", { class: "task-name", text: task.name }),
        el("span", {
          class: "task-schedule",
          text: scheduleText(task.schedule),
        }),
      ]),
      el("p", { class: "hint task-meta", text: meta }),
      task.total_input_tokens || task.total_output_tokens
        ? el("p", {
            class: "hint task-tokens",
            text: t("orbito-settings-task-tokens", {
              tokens: tokens(task.total_input_tokens, task.total_output_tokens),
            }),
          })
        : "",
      el("div", { class: "actions" }, [
        el("label", { class: "checkbox" }, [
          el("input", {
            type: "checkbox",
            ...(task.enabled ? { checked: "" } : {}),
            onchange: event =>
              OrbitoTasks.setEnabled(task.id, event.target.checked),
          }),
          t("orbito-settings-on"),
        ]),
        button(t("orbito-settings-delete"), async () => {
          if (this._editingTask == task.id) {
            this._closeTaskForm();
          }
          await OrbitoTasks.remove(task.id);
        }),
        button(t("orbito-settings-edit"), () => this._openTaskForm(task)),
        button(
          t("orbito-settings-task-run-now"),
          () => OrbitoTasks.runNow(task.id),
          {
            class: "run-now",
            ...(OrbitoTasks.isPending(task.id) ? { disabled: "" } : {}),
          }
        ),
      ]),
      runs,
    ]);
  },

  async _runList(task) {
    let runs = await OrbitoTasks.runs(task.id);
    if (!runs.length) {
      return el("ul", {}, [
        el("li", { class: "hint", text: t("orbito-settings-runs-empty") }),
      ]);
    }
    return el(
      "ul",
      {},
      runs.map(run =>
        el("li", { class: "run", "data-id": run.id }, [
          el("span", { text: new Date(run.started_at).toLocaleString() }),
          el("span", {
            class: "run-status",
            "data-status": run.status,
            text: t("orbito-settings-run-status", { status: run.status }),
          }),
          run.input_tokens != null || run.output_tokens != null
            ? el("span", {
                class: "run-tokens",
                text: tokens(run.input_tokens, run.output_tokens),
              })
            : "",
          run.error ? el("span", { class: "run-error", text: run.error }) : "",
          run.artifact_id
            ? el("button", {
                class: "link open-result",
                text: t("orbito-settings-run-open-result"),
                onclick: () =>
                  OrbitoAssistantCore.openArtifact(
                    window.browsingContext.topChromeWindow,
                    run.artifact_id
                  ).catch(e => {
                    console.error(e);
                    this._renderTasks();
                  }),
              })
            : "",
        ])
      )
    );
  },

  /**
   * @param {?object} task The task to change, or null for a new one.
   * @param {object} [template] For a new task, the fields to start with:
   *   {name, prompt, skill, schedule, space}, any of them. Without space,
   *   it is for the Space this page's window shows.
   */
  _openTaskForm(task, template = {}) {
    let form = document.getElementById("task-form");
    let field = name => form.elements.namedItem(name);
    let pad = n => String(n).padStart(2, "0");
    let start = task ?? template;
    let schedule = start.schedule ?? { kind: "daily", hour: 8, minute: 0 };
    form.querySelector("h3").textContent = task
      ? t("orbito-settings-task-edit-title", { name: task.name })
      : t("orbito-settings-task-new");
    field("name").value = start.name ?? "";
    this._renderTaskSkills(start.skill ?? "");
    field("skill").value = start.skill ?? "";
    this._renderSkillInputs(start.skill, start.inputs);
    this._updateQuestionField();
    field("prompt").value = start.prompt ?? "";
    field("kind").value = schedule.kind;
    field("minute").value = schedule.minute;
    field("weekday").value = schedule.weekday ?? 1;
    field("time").value = `${pad(schedule.hour ?? 8)}:${pad(schedule.minute)}`;
    this._renderTaskSpaces(
      task
        ? task.space_id
        : (start.space ??
            window.browsingContext.topChromeWindow.OrbitoShell?.spaces
              ?.current ??
            null)
    );
    field("backend").value = task?.backend ?? "";
    field("model").value = task?.model ?? "";
    this._updateModelField();
    this._renderAllowedTools(
      task ? task.allowed_tools : this._skillTools(start.skill)
    );
    form.querySelector(".error").hidden = true;
    this._editingTask = task?.id ?? "";
    this._updateScheduleFields();
    form.hidden = false;
    field("name").focus();
  },

  /**
   * The form's skill choices: the skills that are on, and the one a task
   * has even if it is off now, so that saving keeps it.
   *
   * @param {string} [keep] The skill to list anyway.
   */
  _renderTaskSkills(keep) {
    let select = document
      .getElementById("task-form")
      .elements.namedItem("skill");
    let value = keep ?? select.value;
    let names = new Set(
      (this._skills ?? []).filter(s => s.enabled).map(s => s.name)
    );
    if (value) {
      names.add(value);
    }
    select.replaceChildren(
      select.options[0],
      ...[...names].map(name => el("option", { value: name, text: `/${name}` }))
    );
    select.value = value;
  },

  /**
   * The form's Space choices: none in particular (whose Threads every
   * Space lists), then each Space.
   *
   * @param {?string} value The Space to pick.
   */
  _renderTaskSpaces(value) {
    let select = document
      .getElementById("task-form")
      .elements.namedItem("space");
    let spaces = OrbitoShellStore.get("spaces") ?? [];
    let options = [
      { id: "", name: t("orbito-settings-task-all-spaces") },
      ...spaces,
    ];
    // A Space removed since, until the task gets another.
    if (value != null && !spaces.some(s => s.id == value)) {
      options.push({
        id: value,
        name: t("orbito-settings-task-space-gone"),
      });
    }
    select.replaceChildren(
      ...options.map(({ id, name }) => el("option", { value: id, text: name }))
    );
    select.value = value ?? "";
  },

  /** The model is the backend's: none to give without one. */
  _updateModelField() {
    let form = document.getElementById("task-form");
    let model = form.elements.namedItem("model");
    model.disabled = !form.elements.namedItem("backend").value;
    if (model.disabled) {
      model.value = "";
    }
  },

  /** The tools a skill lists that a task could be allowed. */
  _skillTools(name) {
    let skill = name && this._skills?.find(s => s.name == name);
    return skill ? OrbitoTasks.skillTools(skill) : [];
  },

  /**
   * For a skill made from a demo: a field for each of its inputs, which a
   * run has nobody to ask for, and a warning when it has steps the user
   * enters themselves, where its runs stop.
   *
   * @param {string} [name] The skill picked.
   * @param {object} [values] {name: value} to fill the fields with.
   */
  _renderSkillInputs(name, values = {}) {
    let form = document.getElementById("task-form");
    let skill = name && this._skills?.find(s => s.name == name);
    let { inputs, steps } =
      skill?.source == "demo" ? demoSteps(skill.body) : { inputs: [], steps: [] };
    form.querySelector(".direct-warning").hidden = !steps.some(s => s.direct);
    let fieldset = form.querySelector(".skill-inputs");
    fieldset.hidden = !inputs.length;
    fieldset.querySelector(".input-list").replaceChildren(
      ...inputs.map(input => {
        let field = el("input", {
          "data-input": input.name,
          ...(input.example ? { placeholder: input.example } : {}),
        });
        field.value = values?.[input.name] ?? "";
        return el("label", {}, [
          el("span", {
            text: input.description
              ? `${input.name}: ${input.description}`
              : input.name,
          }),
          " ",
          field,
        ]);
      })
    );
  },

  _updateQuestionField() {
    let form = document.getElementById("task-form");
    form.elements.namedItem("prompt").placeholder = form.elements.namedItem(
      "skill"
    ).value
      ? t("orbito-settings-task-prompt-skill-placeholder")
      : t("orbito-settings-task-prompt-placeholder");
  },

  /**
   * The checkboxes of the tools a task can be allowed.
   *
   * @param {string[]} [allowedTools] Those to tick.
   */
  _renderAllowedTools(allowedTools) {
    let form = document.getElementById("task-form");
    // Tools allowed before that are not registered now (as an MCP server's
    // while it is off) stay listed, so that saving keeps them.
    let allowed = new Set(allowedTools);
    let tools = OrbitoTasks.allowableTools().map(t => t.name);
    form.querySelector(".tool-list").replaceChildren(
      ...[...new Set([...tools, ...allowed])].map(name =>
        el("label", { class: "checkbox" }, [
          el("input", {
            type: "checkbox",
            name: "allowed",
            value: name,
            ...(allowed.has(name) ? { checked: "" } : {}),
          }),
          name,
        ])
      ),
      ...(tools.length || allowed.size
        ? []
        : [
            el("p", {
              class: "hint",
              text: t("orbito-settings-no-such-tools"),
            }),
          ])
    );
  },

  _closeTaskForm() {
    document.getElementById("task-form").hidden = true;
    this._editingTask = null;
  },

  _updateScheduleFields() {
    let form = document.getElementById("task-form");
    let kind = form.elements.namedItem("kind").value;
    form.querySelector(".minute-field").hidden = kind != "hourly";
    form.querySelector(".time-field").hidden = kind == "hourly";
    form.querySelector(".weekday-field").hidden = kind != "weekly";
  },

  async _saveTask() {
    let form = document.getElementById("task-form");
    let field = name => form.elements.namedItem(name).value;
    let error = form.querySelector(".error");
    error.hidden = true;
    let kind = field("kind");
    let [hour, minute] = field("time").split(":");
    let schedule =
      kind == "hourly"
        ? { kind, minute: field("minute") }
        : { kind, hour, minute, weekday: field("weekday") };
    try {
      await OrbitoTasks.save(
        {
          name: field("name"),
          prompt: field("prompt"),
          skill: field("skill"),
          inputs: Object.fromEntries(
            [...form.querySelectorAll(".skill-inputs [data-input]")].map(
              input => [input.dataset.input, input.value]
            )
          ),
          schedule,
          space: field("space"),
          backend: field("backend"),
          model: field("model"),
          allowedTools: [
            ...form.querySelectorAll(".tool-list input:checked"),
          ].map(input => input.value),
        },
        this._editingTask || null
      );
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      return;
    }
    this._closeTaskForm();
  },

  async _renderChatGPT() {
    let { state, email, error } = await OrbitoChatGPT.status();
    let $ = id => document.getElementById(id);
    let text = {
      signed_out: t("orbito-settings-not-signed-in"),
      signing_in: t("orbito-settings-chatgpt-signing-in"),
      signed_in: email
        ? t("orbito-settings-chatgpt-signed-in-as", { email })
        : t("orbito-settings-chatgpt-signed-in"),
      needs_login: t("orbito-settings-chatgpt-needs-login"),
    };
    $("chatgpt-status").textContent = text[state];
    $("chatgpt-status").dataset.state = state;
    $("chatgpt-error").textContent = error || "";
    $("chatgpt-error").hidden = !error;
    $("chatgpt-login").hidden = state == "signing_in" || state == "signed_in";
    $("chatgpt-cancel").hidden = state != "signing_in";
    $("chatgpt-logout").hidden = state != "signed_in" && state != "needs_login";
  },

  async _renderClaude() {
    let $ = id => document.getElementById(id);
    let auth = await OrbitoAssistantCore.claudeAuth();
    for (let radio of document.querySelectorAll("[name=claude-auth]")) {
      radio.checked = radio.value == auth;
    }
    let account = auth == "claudeAccount";
    let { state, email, error, command } = account
      ? await ClaudeAccount.status()
      : {};
    let text = {
      signed_out: t("orbito-settings-not-signed-in"),
      signing_in: t("orbito-settings-claude-signing-in"),
      signed_in: email
        ? t("orbito-settings-claude-signed-in-as", { email })
        : t("orbito-settings-claude-signed-in"),
    };
    $("claude-status").textContent = account
      ? text[state]
      : t(auth ? "orbito-settings-claude-uses-key" : "orbito-settings-claude-choose");
    $("claude-status").dataset.state = account ? state : "";
    $("claude-error").textContent = error || "";
    $("claude-error").hidden = !error;
    $("claude-command").textContent = command || "";
    $("claude-command").hidden = !command;
    $("claude-login").hidden = !account || state != "signed_out";
    $("claude-cancel").hidden = !account || state != "signing_in";
    $("claude-logout").hidden = !account || state != "signed_in";
  },

  // By name, since form.name is the form's own name.
  _field(name) {
    return this._form.elements.namedItem(name);
  },

  _updateAuthFields(form = this._form) {
    let auth = form.elements.namedItem("auth").value;
    form.querySelector(".header-fields").hidden = auth != "header";
    form.querySelector(".oauth-fields").hidden = auth != "oauth";
  },

  async _addServer() {
    let form = this._form;
    let error = form.querySelector(".error");
    error.hidden = true;
    let value = name => this._field(name).value;
    try {
      await OrbitoMCP.addServer({
        name: value("name"),
        url: value("url"),
        auth: value("auth"),
        headerName: value("headerName"),
        headerValue: value("headerValue"),
        clientId: value("clientId"),
        clientSecret: value("clientSecret"),
      });
      form.reset();
      this._updateAuthFields();
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    }
  },

  // The id of the server whose edit form is open.
  _editing: null,

  _render() {
    let servers = OrbitoMCP.servers();
    document.getElementById("mcp-empty").hidden = !!servers.length;
    let open = new Set(
      [...this._servers.querySelectorAll("details[open]")].map(
        d => d.dataset.server
      )
    );
    this._servers.replaceChildren(
      ...servers.map(server => this._serverCard(server, open.has(server.id)))
    );
  },

  _serverCard(server, toolsOpen) {
    let tools = el(
      "details",
      { class: "tools", "data-server": server.id },
      [
        el("summary", {
          text: t("orbito-settings-mcp-tools", { count: server.tools.length }),
        }),
        el(
          "ul",
          {},
          server.tools.map(tool =>
            el("li", {}, [
              el("span", { class: "tool-name", text: tool.name }),
              tool.readOnly
                ? ` ${t("orbito-settings-mcp-tool-read-only")}`
                : "",
              tool.description ? ` — ${tool.description}` : "",
            ])
          )
        ),
      ]
    );
    tools.open = toolsOpen;
    let checkbox = (label, checked, key) =>
      el("label", { class: "checkbox" }, [
        el("input", {
          type: "checkbox",
          "data-key": key,
          ...(checked ? { checked: "" } : {}),
          onchange: event =>
            this._update(server.id, { [key]: event.target.checked }),
        }),
        label,
      ]);
    return el("li", { class: "card server", "data-id": server.id }, [
      el("div", { class: "server-head" }, [
        el("span", { class: "server-name", text: server.name }),
        el("span", { class: "server-url", text: server.url }),
        el("span", {
          class: "status",
          "data-status": server.status,
          text: t("orbito-settings-mcp-status", { status: server.status }),
        }),
      ]),
      ...(server.error ? [el("p", { class: "error", text: server.error })] : []),
      ...server.warnings.map(w => el("p", { class: "hint warning", text: w })),
      tools,
      el("div", { class: "options" }, [
        checkbox(t("orbito-settings-on"), server.enabled, "enabled"),
        checkbox(
          t("orbito-settings-mcp-trust-read-only"),
          server.trustReadOnly,
          "trustReadOnly"
        ),
      ]),
      this._editing == server.id
        ? this._editForm(server)
        : el("div", { class: "actions" }, [
            el("button", {
              text: t("orbito-settings-mcp-remove"),
              onclick: () => OrbitoMCP.removeServer(server.id),
            }),
            ...this._loginButtons(server),
            el("button", {
              text: t("orbito-settings-edit"),
              onclick: () => {
                this._editing = server.id;
                this._render();
              },
            }),
            el("button", {
              text: t("orbito-settings-mcp-reconnect"),
              onclick: () => OrbitoMCP.reconnect(server.id),
            }),
          ]),
    ]);
  },

  _loginButtons(server) {
    if (server.status == "logging_in") {
      return [
        el("button", {
          text: t("orbito-settings-mcp-cancel-login"),
          onclick: () => OrbitoMCP.cancelLogin(server.id),
        }),
      ];
    }
    if (server.auth != "oauth" || !server.enabled) {
      return [];
    }
    if (server.status == "needs_login") {
      return [
        el("button", {
          class: "primary",
          text: t("orbito-settings-mcp-log-in"),
          onclick: () => OrbitoMCP.login(server.id),
        }),
      ];
    }
    return [
      el("button", {
        text: t("orbito-settings-mcp-log-out"),
        onclick: () => OrbitoMCP.logout(server.id),
      }),
    ];
  },

  _editForm(server) {
    let input = (name, value, props = {}) =>
      el("input", { name, value, ...props });
    let form = el("form", { class: "edit" }, [
      el("label", {}, [t("orbito-settings-name"), input("name", server.name)]),
      el("label", {}, [
        t("orbito-settings-url"),
        input("url", server.url, { type: "url" }),
      ]),
      el("label", {}, [
        t("orbito-settings-authentication"),
        el("select", { name: "auth" }, [
          el("option", { value: "none", text: t("orbito-settings-auth-none") }),
          el("option", {
            value: "header",
            text: t("orbito-settings-auth-header"),
          }),
          el("option", {
            value: "oauth",
            text: t("orbito-settings-auth-oauth"),
          }),
        ]),
      ]),
      el("div", { class: "header-fields" }, [
        el("label", {}, [
          t("orbito-settings-header-name"),
          input("headerName", server.headerName || "Authorization"),
        ]),
        el("label", {}, [
          t("orbito-settings-header-value"),
          input("headerValue", "", {
            type: "password",
            autocomplete: "off",
            placeholder: t("orbito-settings-unchanged"),
          }),
        ]),
      ]),
      el("div", { class: "oauth-fields" }, [
        el("label", {}, [
          t("orbito-settings-client-id"),
          input("clientId", server.clientId || "", {
            placeholder: t("orbito-settings-client-id-registered"),
          }),
        ]),
        el("label", {}, [
          t("orbito-settings-client-secret"),
          input("clientSecret", "", {
            type: "password",
            autocomplete: "off",
            placeholder: t("orbito-settings-unchanged"),
          }),
        ]),
      ]),
      el("p", { class: "error", hidden: "" }),
      el("div", { class: "actions" }, [
        el("button", {
          type: "button",
          text: t("orbito-settings-cancel"),
          onclick: () => {
            this._editing = null;
            this._render();
          },
        }),
        el("button", {
          type: "submit",
          class: "primary",
          text: t("orbito-settings-save"),
        }),
      ]),
    ]);
    let field = name => form.elements.namedItem(name);
    field("auth").value = server.auth || "none";
    field("auth").addEventListener("change", () =>
      this._updateAuthFields(form)
    );
    this._updateAuthFields(form);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      let changes = {
        name: field("name").value,
        url: field("url").value,
        auth: field("auth").value,
        headerName: field("headerName").value,
        clientId: field("clientId").value,
      };
      for (let secret of ["headerValue", "clientSecret"]) {
        if (field(secret).value) {
          changes[secret] = field(secret).value;
        }
      }
      try {
        this._editing = null;
        await OrbitoMCP.updateServer(server.id, changes);
      } catch (e) {
        this._editing = server.id;
        this._render();
        let error = this._servers.querySelector(
          `[data-id="${server.id}"] .edit .error`
        );
        error.textContent = e.message;
        error.hidden = false;
      }
    });
    return form;
  },

  async _update(id, changes) {
    try {
      await OrbitoMCP.updateServer(id, changes);
    } catch (e) {
      console.error(e);
      this._render();
    }
  },
};

window.addEventListener("DOMContentLoaded", () => OrbitoSettings.init(), {
  once: true,
});
