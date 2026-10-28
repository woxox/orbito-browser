/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  html,
  nothing,
  repeat,
} from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";
import { ORBITO_LOGO } from "chrome://browser/content/orbito/shell/orbito-logo.mjs";
import {
  motionEase,
  motionMs,
  reducedMotion,
} from "chrome://browser/content/orbito/shell/motion.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);
const { stopShortcutText } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoShow.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  markdown: "chrome://browser/content/orbito/OrbitoMarkdown.sys.mjs",
  OrbitoAssistantCore:
    "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs",
  ClaudeAccount: "chrome://browser/content/orbito/ClaudeCLI.sys.mjs",
  OrbitoChatGPT: "chrome://browser/content/orbito/OrbitoChatGPT.sys.mjs",
  OrbitoPage: "chrome://browser/content/orbito/OrbitoPage.sys.mjs",
  OrbitoPages: "chrome://browser/content/orbito/OrbitoPages.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  STEP_TOOL: "chrome://browser/content/orbito/OrbitoShowReplay.sys.mjs",
  stepStates: "chrome://browser/content/orbito/OrbitoShowReplay.sys.mjs",
  suggestions: "chrome://browser/content/orbito/OrbitoSuggestions.sys.mjs",
});

const ICONS = {
  sliders: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 5h6M12.5 5h1M2.5 11h1M7 11h6.5" />
    <circle cx="10.5" cy="5" r="1.7" />
    <circle cx="5.2" cy="11" r="1.7" />
  </svg>`,
  chevron: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4.5 6.5 8 10l3.5-3.5" />
  </svg>`,
  check: html`<svg class="pick" viewBox="0 0 16 16" aria-hidden="true">
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>`,
  arrowUp: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 13V3M4 7l4-4 4 4" />
  </svg>`,
  arrowDown: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 3v10M4 9l4 4 4-4" />
  </svg>`,
  trash: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </svg>`,
  stop: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <rect class="fill" x="5" y="5" width="6" height="6" rx="1.2" />
  </svg>`,
  plus: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>`,
  shield: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 2 3.2 3.8v3.9c0 2.9 2 4.9 4.8 6.1 2.8-1.2 4.8-3.2 4.8-6.1V3.8z" />
  </svg>`,
  shieldCheck: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 2 3.2 3.8v3.9c0 2.9 2 4.9 4.8 6.1 2.8-1.2 4.8-3.2 4.8-6.1V3.8z" />
    <path d="m5.9 8.1 1.5 1.5 2.8-3" />
  </svg>`,
  shieldOff: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 2 3.2 3.8v3.9c0 2.9 2 4.9 4.8 6.1 2.8-1.2 4.8-3.2 4.8-6.1V3.8z" />
    <path d="M2.5 2.5l11 11" />
  </svg>`,
  allowed: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>`,
  denied: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m4.5 4.5 7 7m0-7-7 7" />
  </svg>`,
  threads: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />
  </svg>`,
  back: html`<svg class="flip" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M10 3 5 8l5 5" />
  </svg>`,
  forward: html`<svg class="flip" viewBox="0 0 16 16" aria-hidden="true">
    <path d="m6 3 5 5-5 5" />
  </svg>`,
  plus: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>`,
  clock: html`<svg class="clock" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3l2 1.5" />
  </svg>`,
  document: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 2.5h5l3 3v8H4z" />
    <path d="M9 2.5v3h3M6 9h4M6 11.5h3" />
  </svg>`,
};

const WIDTH_PREF = "orbito.assistant.width";
const EFFORT_PREF = "orbito.assistant.effort";

/** The panel's width in px: what the handle allows and its default. */
export const PANEL_WIDTH = { min: 280, max: 520, default: 340 };

// How far one arrow key press moves the resize handle, in px.
const RESIZE_STEP = 8;
// Models in the model menu from which on it offers a search over them.
const MODEL_SEARCH_MIN = 8;

const clampWidth = width =>
  Math.round(Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, width)));

// The window's PermissionMode, picked with the shield on the input's bar.
const PERMISSION_MODES = [
  {
    id: "ask",
    label: t("orbito-assistant-permission-ask"),
    description: t("orbito-assistant-permission-ask-description"),
    icon: ICONS.shield,
  },
  {
    id: "auto",
    label: t("orbito-assistant-permission-auto"),
    description: t("orbito-assistant-permission-auto-description"),
    icon: ICONS.shieldCheck,
  },
  {
    id: "bypass",
    label: t("orbito-assistant-permission-bypass"),
    description: t("orbito-assistant-permission-bypass-description"),
    icon: ICONS.shieldOff,
  },
];

const DEFAULT_ICON = "chrome://global/skin/icons/defaultFavicon.svg";

// A page's site, as a chip or an approval names it.
function host(url) {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

// The Thread list's two scopes: the window's Space, or every Space.
const THREAD_SCOPES = [
  { id: "space", label: t("orbito-assistant-threads-this-space") },
  { id: "all", label: t("orbito-assistant-threads-all-spaces") },
];

// The core's events after which the Thread list may list other Threads,
// or other states.
const THREAD_LIST_EVENTS = new Set([
  "start",
  "done",
  "approval",
  "thread_deleted",
]);

/** How long ago a time was, as the Thread list says it. */
function ago(time) {
  let minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) {
    return t("orbito-assistant-threads-just-now");
  }
  if (minutes < 60) {
    return t("orbito-assistant-threads-minutes-ago", { count: minutes });
  }
  let hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("orbito-assistant-threads-hours-ago", { count: hours });
  }
  return t("orbito-assistant-threads-days-ago", {
    count: Math.floor(hours / 24),
  });
}

// The window's events the panel follows: its Space or its Thread changed.
const WINDOW_EVENTS = ["unload", "OrbitoSpacesChange", "OrbitoThreadShown"];

// What comes in as the log grows: a question or a reply, and what a reply
// adds as it goes (a step, an approval to answer, a card).
const ENTERING =
  ":scope > .message, :scope > .message.assistant > :is(.step, .approval.waiting, .artifact, .error, .orbit-card, .thought:not(.thinking), .memory, .sources, .notice)";

/**
 * What a question shares with the model, picked in the session settings,
 * and the lines it adds to the system prompt. This tab sends the selected
 * tab and its page with the question; All open tabs sends the tabs of the
 * Thread's Space in this window and the selected tab's page (see
 * OrbitoAssistantCore.ask()'s context); None sends nothing. The tools stay offered either way, on those tabs
 * only; the selected tab is where they act unless told.
 */
export const CONTEXTS = [
  { id: "tab", label: t("orbito-assistant-context-tab"), instructions: "" },
  {
    id: "tabs",
    label: t("orbito-assistant-context-tabs"),
    instructions:
      "The user shares all the open tabs listed with this question: read the ones that matter with get_page_text and their tab_id.",
  },
  {
    id: "none",
    label: t("orbito-assistant-context-none"),
    instructions:
      "The user shares no tab with this question: do not read or act on any tab unless the user asks you to.",
  },
];

/** How long the model thinks before answering, and the lines it adds. */
export const EFFORTS = [
  {
    id: "low",
    label: t("orbito-assistant-effort-low"),
    instructions:
      "Answer quickly: think and use tools only as much as the question needs.",
  },
  {
    id: "medium",
    label: t("orbito-assistant-effort-medium"),
    instructions: "",
  },
  {
    id: "high",
    label: t("orbito-assistant-effort-high"),
    instructions:
      "Take your time: read the pages that matter and use the think tool to work out the steps before you answer.",
  },
  {
    id: "max",
    label: t("orbito-assistant-effort-max"),
    instructions:
      "Be as thorough as you can: read every page that may matter, use the think tool before each step, and check the answer before you give it.",
  },
];

/**
 * The lines a question adds to the system prompt for the context and the
 * thinking depth picked, or null for the defaults (this tab, medium).
 *
 * @param {string} context One of CONTEXTS' ids.
 * @param {string} effort One of EFFORTS' ids.
 */
export function requestInstructions(context, effort) {
  let lines = [
    CONTEXTS.find(c => c.id == context)?.instructions,
    EFFORTS.find(e => e.id == effort)?.instructions,
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

// What the empty Thread offers to ask.
const STARTERS = [
  [
    t("orbito-assistant-starter-summarize"),
    t("orbito-assistant-starter-summarize-prompt"),
  ],
  [
    t("orbito-assistant-starter-takeaways"),
    t("orbito-assistant-starter-takeaways-prompt"),
  ],
  [
    t("orbito-assistant-starter-explain"),
    t("orbito-assistant-starter-explain-prompt"),
  ],
];

const DRAFT_LABEL = t("orbito-assistant-draft-skill");

// The suggestion chips' labels, by chip id (OrbitoSuggestions.sys.mjs).
const CHIP_LABELS = {
  summarize: t("orbito-suggestions-summarize"),
  translate: t("orbito-suggestions-translate"),
  compare: t("orbito-suggestions-compare"),
};

// The context ring: its circle's radius and length, and from what share of
// the window on it warns.
const RING_RADIUS = 7;
const RING_LENGTH = +(2 * Math.PI * RING_RADIUS).toFixed(2);
const USAGE_HOT = 80;

/**
 * The Assistant panel: a Thread with the assistant, drawn on the window's
 * frame at the right. It shows the Thread the window shows in its Space
 * (see OrbitoAssistantCore.threadFor()): switching tabs leaves it, switching
 * Spaces shows that Space's. The work happens in the
 * app-wide core (OrbitoAssistantCore.sys.mjs); the panel shows what the
 * core reports, asks it questions and answers its approval requests.
 *
 * From the top: on Windows and Linux, while it takes the full height, the
 * window controls (slot window-controls, the `full` attribute); the
 * Thread's title and the session settings (context, auto-approve,
 * backend and key, new Thread, history); the Thread; skill suggestions; and
 * the input, with the ＋ menu (Show Orbito), the model and thinking depth
 * picker and the send button, which stops the reply while one streams. Its
 * width (the handle on its leading edge) is a pref, shared by every window.
 *
 * While the window's Show Orbito (show-orbito.mjs) asks for a demo's goal,
 * records it or holds it stopped, the Thread's place shows that instead,
 * and the input takes no questions. Once stopped, it shows the skill made
 * of the demo for the user to change and save, record again or discard:
 * its name and description, its inputs, each kept as an input or made a
 * fixed value, and its steps, to edit, delete and move.
 *
 * Page text and model output are untrusted: they only ever go in as text
 * (Lit's text bindings, or OrbitoMarkdown's nodes), never as markup.
 */
export class OrbitoAssistantPanel extends MozLitElement {
  static properties = {
    full: { type: Boolean, reflect: true },
    width: { type: Number },
    // What questions share: one of CONTEXTS' ids, for this window.
    context: { type: String },
    // The menu that is open: "session", "plus", "model", "permission",
    // "usage" or "".
    menu: { type: String, state: true },
    // What the panel shows: "chat" (the Thread), or in its place
    // "threads" (the Thread list) or "documents" (the Thread's documents).
    view: { type: String, reflect: true },
    // Which Threads the list shows: one of THREAD_SCOPES' ids.
    threadScope: { type: String },
  };

  static queries = {
    heading: ".title",
    sessionButton: ".session",
    sessionMenu: ".session-menu",
    settingsItem: '[data-command="settings"]',
    newThreadItem: '[data-command="new"]',
    threadsButton: ".threads-button",
    threadsView: ".threads-view",
    backButton: ".threads-view .back",
    libraryButton: ".threads-view .library",
    documentsButton: ".documents-button",
    documentsView: ".documents-view",
    documentsLibraryButton: ".documents-view .library",
    settingsForm: "form.settings",
    backendInput: ".settings .backend",
    authInput: ".settings .auth",
    keyInput: ".settings .key",
    loginRow: ".settings .login",
    loginStatus: ".settings .login-status",
    modelInput: ".settings .model-id",
    baseInput: ".settings .base",
    log: ".log",
    draftError: ".draft-error",
    chips: ".chips",
    skillMenu: ".skill-menu",
    inputNotice: ".input-notice",
    input: "textarea",
    modelButton: ".model",
    modelMenu: ".model-menu",
    permissionButton: ".permission",
    permissionMenu: ".permission-menu",
    usageButton: ".usage",
    usageMenu: ".usage-menu",
    sendButton: ".send",
    resizer: ".resizer",
    plusButton: ".plus",
    plusMenu: ".plus-menu",
    showView: ".show",
    goalInput: ".show .goal",
    showStartButton: ".show-start",
    showStopButton: ".show-stop",
    showCancelButton: ".show-cancel",
    showSteps: ".show-steps",
    showCount: ".show-count",
    showRetryButton: ".show-retry",
    showError: ".show-error",
    reviewView: ".show.review",
    reviewName: ".review-name",
    reviewDescription: ".review-description",
    reviewInputs: ".review-inputs",
    reviewSteps: ".review-steps",
    showRerecordButton: ".show-rerecord",
    showSaveButton: ".show-save",
  };

  /** The Thread shown, and its messages as the core keeps them. */
  threadId = null;
  messages = [];

  // The Threads whose approvals this window's panel asked for, which are
  // stopped if it closes.
  #asked = new Set();
  // Bumped by every refresh, so that a slower earlier one gives up.
  #refreshSeq = 0;
  #refreshQueued = false;
  // Whether the log scrolls to its end after the update.
  #stick = true;
  // Whether it follows a reply to its end as it grows, until the user
  // scrolls up; and where it was scrolled to last.
  #following = false;
  #scrolledTo = 0;
  // Whether the update shows a Thread anew (opened, switched to), whose
  // messages just show; and the log's messages and cards shown already,
  // in the log element they are in.
  #quiet = true;
  #shown = new WeakSet();
  #shownLog = null;
  // When the panel last showed a Thread anew, and the time before: a
  // message made since that was not shown yet.
  #loadedAt = Date.now();
  #newerThan = this.#loadedAt;
  // The pinned step last brought into view.
  #pinnedStep = null;
  // Whether the pinned steps show the whole list.
  #stepsOpen = false;
  // "<message id> <run>" -> {text, nodes}: the Markdown of finished text.
  #markdown = new Map();
  // "<kind> <id>" -> what an action under a message shows: {busy, error,
  // items}.
  #ui = new Map();
  #draft = { busy: false, error: "" };
  #hasText = false;
  #notice = "";
  #skills = [];
  #skillIndex = 0;
  #skillSeq = 0;
  #chips = [];
  // The tab the chips are for.
  #chipsTab = null;
  #chipsSeq = 0;
  // The Thread list's Threads (see OrbitoAssistantCore.threadList), and
  // the row the keyboard is on, by Thread id ("" for New Thread).
  #threadList = [];
  #threadListSeq = 0;
  #threadListQueued = false;
  // Settles once the latest load is shown.
  #threadListLoad = null;
  #threadFocus = null;
  // The documents the Thread shown made (see core.threadArtifacts), for
  // the header's button and the document list; and the Thread and
  // document cards they were loaded for.
  #documents = [];
  #documentsKey = null;
  #documentsSeq = 0;
  // tab -> Set of "<chip id> <url>" dismissed there, in memory only.
  #dismissed = new WeakMap();
  // The settings form: open, and what the backend picked in it needs.
  #settings = {
    open: false,
    backend: "",
    // The backend it was opened for (a reply's), if not the one new
    // questions go to.
    only: null,
    auth: "",
    login: false,
    status: "",
    // The models the backend lists, offered as the model's suggestions.
    models: [],
  };
  // The models the model menu offers, {backend, models}, models null while
  // they are listed or when the backend lists none; and what filters them.
  #catalog = null;
  #modelFilter = "";
  // Whether the open menu opened from the keyboard.
  #menuByKeyboard = false;
  // The handle's drag: where it started.
  #resize = null;
  // The opening or closing motion playing, if any.
  #motion = null;
  // What the next question takes of the context window, and the
  // subscription's limits when the backend gives them.
  #usage = null;
  #limits = null;
  #usageSeq = 0;
  #usageUpdate = null;
  // What stops following the steps of the demo this window records.
  #unsubscribeShow = null;
  // The review's phase last drawn.
  #reviewPhase = null;

  constructor() {
    super();
    this.full = false;
    this.width = PANEL_WIDTH.default;
    this.context = "tab";
    this.menu = "";
    this.view = "chat";
    this.threadScope = "space";
  }

  // Held weakly by the prefs service, so a closed window does not leak.
  #prefObserver = {
    observe: () => this.#readWidth(),
    QueryInterface: ChromeUtils.generateQI([
      "nsIObserver",
      "nsISupportsWeakReference",
    ]),
  };

  #onCoreEvent = (threadId, event) => this.#coreEvent(threadId, event);

  connectedCallback() {
    super.connectedCallback();
    Services.prefs.addObserver(WIDTH_PREF, this.#prefObserver, true);
    this.#readWidth();
    lazy.OrbitoAssistantCore.addListener(this.#onCoreEvent);
    gBrowser.tabContainer.addEventListener("TabSelect", this);
    gBrowser.tabContainer.addEventListener("TabClose", this);
    gBrowser.tabContainer.addEventListener("TabAttrModified", this);
    gBrowser.addTabsProgressListener(this);
    for (let type of WINDOW_EVENTS) {
      window.addEventListener(type, this);
    }
    window.addEventListener("OrbitoShowChange", this);
    window.addEventListener("OrbitoShowSummary", this);
    window.addEventListener("OrbitoShowReview", this);
    this.#followShow();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#teardown();
  }

  // Also when the window closes, which leaves the element connected: the
  // core outlives the window.
  #teardown() {
    Services.prefs.removeObserver(WIDTH_PREF, this.#prefObserver);
    lazy.OrbitoAssistantCore.removeListener(this.#onCoreEvent);
    gBrowser.tabContainer.removeEventListener("TabSelect", this);
    gBrowser.tabContainer.removeEventListener("TabClose", this);
    gBrowser.tabContainer.removeEventListener("TabAttrModified", this);
    gBrowser.removeTabsProgressListener(this);
    for (let type of WINDOW_EVENTS) {
      window.removeEventListener(type, this);
    }
    window.removeEventListener("mousedown", this, true);
    window.removeEventListener("OrbitoShowChange", this);
    window.removeEventListener("OrbitoShowSummary", this);
    window.removeEventListener("OrbitoShowReview", this);
    this.#unsubscribeShow?.();
    this.#unsubscribeShow = null;
    this.#denyAll();
  }

  get #core() {
    return lazy.OrbitoAssistantCore;
  }

  // threadId -> {callId, text, resolve}: the approvals waiting for the
  // user, which every window showing their Thread shows and may answer.
  get #approvals() {
    return (lazy.OrbitoAssistantCore.approvals ??= new Map());
  }

  // callId -> how an approval ended: "allowed", "denied" or "stopped" (the
  // task ended without an answer), in memory only.
  get #answered() {
    return (lazy.OrbitoAssistantCore.answeredApprovals ??= new Map());
  }

  get #isPrivate() {
    return lazy.PrivateBrowsingUtils.isWindowPrivate(window);
  }

  get #running() {
    return this.#core.isRunning(this.threadId);
  }

  /** The window's Show Orbito (show-orbito.mjs). */
  get #show() {
    return window.OrbitoShell?.show ?? null;
  }

  /** What Show Orbito shows in the Thread's place, or null. */
  get #showState() {
    return this.#show?.state ?? null;
  }

  /** The thinking depth new questions get, one of EFFORTS' ids. */
  get effort() {
    let effort = Services.prefs.getStringPref(EFFORT_PREF, "medium");
    return EFFORTS.some(e => e.id == effort) ? effort : "medium";
  }

  set effort(effort) {
    if (effort == "medium") {
      Services.prefs.clearUserPref(EFFORT_PREF);
    } else {
      Services.prefs.setStringPref(EFFORT_PREF, effort);
    }
    this.updateUsage();
    this.requestUpdate();
  }

  /**
   * What the next question takes of the context window, by part (see
   * OrbitoAssistantCore.contextUsage), or null before it is known.
   */
  get usage() {
    return this.#usage;
  }

  /**
   * Estimates again what the next question takes of the context window,
   * and reads the backend's subscription limits. Resolves once shown.
   */
  updateUsage() {
    if (this.hidden) {
      return Promise.resolve();
    }
    this.#usageUpdate = this.#estimateUsage(++this.#usageSeq);
    return this.#usageUpdate;
  }

  async #estimateUsage(seq) {
    let core = this.#core;
    let tab = gBrowser.selectedTab;
    let { backend, model, instructions, context } = this.requestOptions();
    let usage, limits;
    try {
      [usage, limits] = await Promise.all([
        core.contextUsage(this.threadId ?? core.threadFor(window), {
          backend,
          model,
          instructions,
          context,
          tab,
        }),
        core.usageLimits(backend),
      ]);
    } catch (e) {
      console.error(e);
      return;
    }
    if (seq != this.#usageSeq) {
      // A later estimate is on its way: done once that one is.
      return this.#usageUpdate;
    }
    this.#usage = usage;
    this.#limits = limits;
    this.requestUpdate();
    await this.updateComplete;
  }

  /**
   * What ask() gets for the next question besides the prompt: the backend
   * and model picked, the context, and the lines it and the thinking depth
   * add.
   *
   * @param {object} [options]
   * @param {string} [options.context] One of CONTEXTS' ids, for this
   *   question only; the session setting by default.
   */
  requestOptions({ context = this.context } = {}) {
    let { backend, model } = this.#choice();
    return {
      backend,
      model,
      context,
      instructions: requestInstructions(context, this.effort),
    };
  }

  /**
   * The backend and model the Thread's next question goes to (see
   * OrbitoAssistantCore.questionBackend()): once it started, the backend
   * picked for it or its latest reply's, else the default of the window's
   * Space, which is the Thread's. A Thread not shown yet counts as new; the
   * core still keeps its backend when asked.
   */
  #choice() {
    let core = this.#core;
    let shown = this.threadId == core.threadFor(window);
    return core.questionBackend(
      shown ? this.messages : [],
      this.#space(),
      this.threadId
    );
  }

  /** The Space the window shows, or null without Spaces. */
  #space() {
    return window.OrbitoShell?.spaces?.current ?? null;
  }

  /** The Threads waiting for the user to allow or deny a tool. */
  get waitingApprovals() {
    return [...this.#approvals.keys()];
  }

  handleEvent(event) {
    switch (event.type) {
      case "TabSelect":
        // The same Thread, for another page.
        this.#closeMenu();
        this.refresh();
        break;
      case "OrbitoSpacesChange":
      case "OrbitoThreadShown":
        // Opened (from the library, an Orbit's icon), the Thread takes the
        // list's place.
        if (event.detail?.opened) {
          this.view = "chat";
        }
        // Maybe another Thread: the Space's, or one shown in it.
        if (this.#core.threadFor(window) != this.threadId) {
          this.#closeMenu();
          this.refresh();
        }
        this.#queueThreadList();
        break;
      case "TabClose":
        // One fewer tab on its site, or in an Orbit.
        this.#updateSuggestions();
        this.requestUpdate();
        break;
      case "TabAttrModified":
        // An Orbit's result tab, shown as a chip on its wrap-up card, got
        // its title or icon.
        if (
          this.#core.isOrbitResult(event.target) &&
          event.detail.changed.some(a => a == "label" || a == "image")
        ) {
          this.requestUpdate();
        }
        break;
      case "unload":
        this.#teardown();
        break;
      case "OrbitoShowSummary":
        this.requestUpdate();
        break;
      case "OrbitoShowChange":
        this.#followShow();
        break;
      case "OrbitoShowReview":
        this.#followReview();
        break;
      case "mousedown":
        // A press outside the open menu and its button closes the menu.
        if (
          !event.composedPath().some(el => el.dataset?.menu == this.menu)
        ) {
          this.#closeMenu();
        }
        break;
    }
  }

  // Tabs progress listener: a page loaded, the selected one or another
  // tab on its site.
  onStateChange(browser, webProgress, request, stateFlags) {
    if (
      webProgress.isTopLevel &&
      stateFlags & Ci.nsIWebProgressListener.STATE_STOP &&
      stateFlags & Ci.nsIWebProgressListener.STATE_IS_WINDOW
    ) {
      this.#updateSuggestions();
    }
  }

  /**
   * Focuses the input, for F6 and for opening the panel; the Thread list's
   * row the keyboard is on while the list is shown; while Show Orbito
   * takes the input's place, its goal field, its main button or, once the
   * skill made of the demo shows, its name.
   */
  focusRegion() {
    let el = {
      goal: this.goalInput,
      recording: this.showStopButton,
      stopped:
        this.#show?.review?.phase == "ready"
          ? this.reviewName
          : this.showCancelButton,
    }[this.#showState];
    if (el) {
      el.focus();
    } else if (this.view == "threads") {
      this.#rovingRow()?.focus();
    } else if (this.view == "documents") {
      (this.#documentRows()[0] ?? this.documentsView.querySelector(".back"))
        .focus();
    } else {
      this.input?.focus();
    }
  }

  /** Says why something did not happen, over the input, until typing. */
  notify(text) {
    this.#notice = text;
    this.requestUpdate();
  }

  /**
   * Plays the panel's motion as it opens (open true) or closes, unless the
   * user prefers reduced motion. Opening, its column widens as the page
   * eases aside and its content slides in from the end; closing plays that
   * back, faster. In a narrow window, where it floats over the page, it
   * slides and fades instead. A new motion replaces one still playing.
   *
   * @param {boolean} open
   * @returns {Promise|null} Settles once the motion ends or is replaced;
   *   null when there is none.
   */
  playMotion(open) {
    this.#motion?.cancel();
    this.#motion = null;
    this.removeAttribute("motion");
    if (reducedMotion()) {
      return null;
    }
    let narrow = window.matchMedia("(max-width: 760px)").matches;
    let shift = document.dir == "rtl" ? -32 : 32;
    let away = narrow
      ? { opacity: 0, transform: `translateX(${shift}px) scale(0.98)` }
      : { width: "0px", marginInlineEnd: "0px" };
    // Closing is quicker than opening.
    let motion = (this.#motion = this.animate(
      [{ ...away, offset: open ? 0 : 1 }],
      open
        ? { duration: motionMs(this, "long"), easing: motionEase(this) }
        : {
            duration: motionMs(this, "medium"),
            easing: motionEase(this, "exit"),
            fill: "forwards",
          }
    ));
    this.setAttribute("motion", open ? "open" : "close");
    let end = () => {
      if (this.#motion == motion) {
        this.#motion = null;
        this.removeAttribute("motion");
        motion.cancel();
      }
    };
    return motion.finished.then(end, end);
  }

  #coreEvent(threadId, event) {
    if (event.type == "done") {
      this.#endApproval(threadId, "stopped");
      if (this.#approvals.delete(threadId)) {
        this.#approvalsChanged();
      }
    }
    if (THREAD_LIST_EVENTS.has(event.type)) {
      // The list button's dot, and the list.
      this.requestUpdate();
      this.#queueThreadList();
    }
    if (threadId != this.threadId) {
      return;
    }
    if (event.type == "done") {
      this.#updateSuggestions();
    }
    this.#queueRefresh();
  }

  #queueRefresh() {
    if (this.#refreshQueued) {
      return;
    }
    this.#refreshQueued = true;
    window.requestAnimationFrame(() => {
      this.#refreshQueued = false;
      this.refresh({ update: true });
    });
  }

  /**
   * Shows the window's Thread as the core has it now. With update, only
   * catches up with the Thread already shown; otherwise (the panel opened,
   * another tab or Thread) it also looks again at what the page may want
   * and scrolls to the end.
   */
  async refresh({ update = false } = {}) {
    if (this.hidden) {
      return;
    }
    let seq = ++this.#refreshSeq;
    let id = this.#core.threadFor(window);
    let messages = await this.#core.getMessages(id);
    if (seq != this.#refreshSeq || this.hidden) {
      return;
    }
    let changed = id != this.threadId;
    if (changed) {
      this.threadId = id;
      this.#markdown.clear();
      this.#ui.clear();
      this.#draft = { busy: false, error: "" };
    }
    if (!update || changed) {
      this.#stick = true;
      this.#quiet = true;
      this.#following = false;
      this.#newerThan = this.#loadedAt;
      this.#loadedAt = Date.now();
      this.#updateSuggestions();
    } else if (this.#running && this.#chips.length) {
      this.#updateSuggestions();
    }
    this.messages = messages;
    this.#loadDocuments({ force: !update || changed });
    // Not on every streamed piece: once the reply is done.
    if (changed || !this.#running) {
      this.updateUsage();
    }
    this.requestUpdate();
  }

  willUpdate(changed) {
    // The model button shows the model's name from the backend's list.
    if (this.#catalog?.backend != this.#choice().backend) {
      this.#loadCatalog();
    }
    if (changed.has("context") && changed.get("context") !== undefined) {
      this.updateUsage();
    }
    if (
      (changed.has("view") || changed.has("threadScope")) &&
      this.view == "threads"
    ) {
      this.#threadListLoad = this.#loadThreadList();
    }
    if (changed.has("view") && this.view == "documents") {
      this.#loadDocuments({ force: true });
    }
    let log = this.log;
    if (log) {
      this.#onLogScroll();
      if (
        this.#following ||
        log.scrollHeight - log.scrollTop - log.clientHeight < 40
      ) {
        this.#stick = true;
      }
    }
  }

  updated() {
    let log = this.log;
    if (log) {
      this.#bringIn(log);
      if (this.#stick) {
        this.#scrollToEnd(log);
      }
    }
    this.#stick = false;
    this.#quiet = false;
    // A long list of pinned steps brings the one the agent moved to into
    // view, once: the user may scroll it to see the others.
    let steps = this.renderRoot.querySelector(".skill-steps.pinned ol");
    let step = steps?.querySelector(".current, .failed");
    if (step != this.#pinnedStep) {
      this.#pinnedStep = step;
      if (step) {
        steps.scrollTop =
          step.offsetTop - (steps.clientHeight - step.offsetHeight) / 2;
      }
    }
  }

  /**
   * Brings in what is new in the log, unless the user prefers reduced
   * motion: a question rises from the input, a reply comes in, and so do
   * the steps, approvals and cards it adds as it goes, for the medium
   * motion. What shows as a Thread opens just shows, but for what was
   * asked since the panel last showed one (the Command bar's Ask in a new
   * Thread).
   */
  #bringIn(log) {
    if (reducedMotion()) {
      return;
    }
    let quiet = this.#quiet || log != this.#shownLog;
    this.#shownLog = log;
    let messages = [...log.querySelectorAll(":scope > .message")];
    let justAsked = new Set(
      messages.filter(
        (el, i) => (this.messages[i]?.created_at ?? 0) > this.#newerThan
      )
    );
    let timing = {
      duration: motionMs(this, "medium"),
      easing: motionEase(this),
      fill: "backwards",
    };
    let entering = new Set();
    for (let el of log.querySelectorAll(ENTERING)) {
      if (this.#shown.has(el)) {
        continue;
      }
      this.#shown.add(el);
      // A new reply's cards come in with it.
      if (
        (quiet && !justAsked.has(el)) ||
        entering.has(el.parentElement)
      ) {
        continue;
      }
      entering.add(el);
      let from = el.matches(".user") ? "translateY(16px)" : "translateY(4px)";
      el.animate([{ opacity: 0, transform: from, offset: 0 }], timing);
    }
  }

  /**
   * Scrolls the log to its end: at once as a Thread opens or with reduced
   * motion, smoothly as a reply grows, which it then follows until the
   * user scrolls up.
   */
  #scrollToEnd(log) {
    if (this.#quiet || reducedMotion()) {
      log.scrollTop = log.scrollHeight;
    } else {
      log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
      this.#following = true;
    }
    this.#scrolledTo = log.scrollTop;
  }

  // Scrolling up, by the wheel or otherwise, stops following the reply.
  #onLogScroll(event) {
    let log = this.log;
    if (event?.type == "wheel" ? event.deltaY < 0 : log.scrollTop < this.#scrolledTo - 1) {
      this.#following = false;
    }
    this.#scrolledTo = log.scrollTop;
  }

  // Width.

  #readWidth() {
    this.#applyWidth(
      clampWidth(Services.prefs.getIntPref(WIDTH_PREF, PANEL_WIDTH.default))
    );
  }

  #applyWidth(width) {
    this.width = width;
    document.documentElement.style.setProperty(
      "--orbito-assistant-width",
      `${width}px`
    );
  }

  #saveWidth(width) {
    width = clampWidth(width);
    if (width == PANEL_WIDTH.default) {
      Services.prefs.clearUserPref(WIDTH_PREF);
    } else {
      Services.prefs.setIntPref(WIDTH_PREF, width);
    }
    this.#applyWidth(width);
  }

  // The handle on the leading edge: dragging it away from the page's side
  // widens the panel.
  get #direction() {
    return document.dir == "rtl" ? -1 : 1;
  }

  #onResizeStart(event) {
    if (event.button != 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    this.#resize = { x: event.clientX, width: this.width };
    this.toggleAttribute("resizing", true);
    // Nothing in the window gets selected while the handle is dragged.
    document.documentElement.style.userSelect = "none";
  }

  #onResizeMove(event) {
    if (!this.#resize) {
      return;
    }
    let { x, width } = this.#resize;
    this.#applyWidth(clampWidth(width + this.#direction * (x - event.clientX)));
  }

  #onResizeEnd() {
    if (!this.#resize) {
      return;
    }
    this.#resize = null;
    this.removeAttribute("resizing");
    document.documentElement.style.removeProperty("user-select");
    this.#saveWidth(this.width);
  }

  #onResizeKey(event) {
    let width;
    switch (event.key) {
      case "ArrowLeft":
        width = this.width + this.#direction * RESIZE_STEP;
        break;
      case "ArrowRight":
        width = this.width - this.#direction * RESIZE_STEP;
        break;
      case "Home":
        width = PANEL_WIDTH.min;
        break;
      case "End":
        width = PANEL_WIDTH.max;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.#saveWidth(width);
  }

  // Menus: the session settings under the header's button, and the model
  // and thinking depth over the input's. Up/Down (wrapping), Left/Right,
  // Home and End move between the items; Escape closes the menu and puts
  // focus back on its button.

  #toggleMenu(name, event) {
    if (this.menu == name) {
      this.#closeMenu();
      return;
    }
    this.#menuByKeyboard = event.detail == 0;
    this.menu = name;
    window.addEventListener("mousedown", this, true);
    if (name == "usage") {
      this.updateUsage();
    } else if (name == "model") {
      this.#modelFilter = "";
      this.#loadCatalog();
    }
    this.updateComplete.then(() => {
      let items = this.#menuItems();
      let item = items.find(i => i.getAttribute("aria-checked") == "true");
      // A popover without items, as the usage details, takes focus itself.
      (item ?? items[0] ?? this.#openMenu())?.focus({
        focusVisible: this.#menuByKeyboard,
      });
    });
  }

  /** Closes the open menu, if any. */
  closeMenu(options) {
    this.#closeMenu(options);
  }

  #closeMenu({ focusButton = false } = {}) {
    if (!this.menu) {
      return;
    }
    let button = this.renderRoot.querySelector(
      `button[data-menu="${this.menu}"]`
    );
    let hadFocus = this.#openMenu()?.contains(this.renderRoot.activeElement);
    this.menu = "";
    window.removeEventListener("mousedown", this, true);
    if (focusButton || hadFocus) {
      button?.focus({ focusVisible: this.#menuByKeyboard });
    }
  }

  #openMenu() {
    return this.menu
      ? this.renderRoot.querySelector(`.menu[data-menu="${this.menu}"]`)
      : null;
  }

  #menuItems() {
    let menu = this.#openMenu();
    return menu ? [...menu.querySelectorAll('[role^="menuitem"]')] : [];
  }

  #onMenuKey(event) {
    // The model search moves its caret itself.
    if (
      event.target.matches?.("input") &&
      ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    ) {
      return;
    }
    let items = this.#menuItems();
    let index = items.indexOf(this.renderRoot.activeElement);
    let next;
    if (!items.length && !["Escape", "Tab"].includes(event.key)) {
      return;
    }
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (index + 1) % items.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = (index - 1 + items.length) % items.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        this.#closeMenu({ focusButton: true });
        return;
      case "Tab":
        this.#closeMenu();
        return;
      default:
        return;
    }
    if (document.dir == "rtl" && event.key.startsWith("Arrow")) {
      if (event.key == "ArrowRight") {
        next = (index - 1 + items.length) % items.length;
      } else if (event.key == "ArrowLeft") {
        next = (index + 1) % items.length;
      }
    }
    event.preventDefault();
    items[next]?.focus({ focusVisible: true });
  }

  #pickContext(context) {
    this.context = context;
    this.#closeMenu({ focusButton: true });
  }

  /** Lists the models the backend offers, for the model menu and button. */
  async #loadCatalog() {
    let { backend } = this.#choice();
    if (this.#catalog?.backend != backend) {
      this.#catalog = { backend, models: null };
    }
    let models = await this.#core.models(backend);
    if (this.#choice().backend == backend) {
      this.#catalog = { backend, models };
      this.requestUpdate();
    }
  }

  /** The model's name as the backend lists it, else its id. */
  #modelLabel(model) {
    return (
      this.#catalog?.models?.find(m => m.id == model)?.label ?? model
    );
  }

  #pickModel(model) {
    this.#core.pickModel(this.#space(), this.#choice().backend, model);
    this.#closeMenu({ focusButton: true });
    this.updateUsage();
    this.requestUpdate();
  }

  // In a started Thread, for that Thread alone; else for the new Threads
  // of the window's Space.
  #pickBackend(backend) {
    if (this.#choice().kept) {
      this.#core.pickThreadBackend(this.threadId, backend);
    } else {
      this.#core.pickBackend(this.#space(), backend);
    }
    this.#closeMenu({ focusButton: true });
    this.updateUsage();
    this.requestUpdate();
  }

  #pickPermissionMode(mode) {
    window.OrbitoAssistant.setPermissionMode(mode);
    this.#closeMenu({ focusButton: true });
    this.requestUpdate();
  }

  #runCommand(fn) {
    this.#closeMenu();
    fn();
  }

  // Threads.

  /**
   * Shows a new, empty Thread in the window's Space. The Thread shown
   * before goes on answering, if it was.
   */
  newThread() {
    this.#core.newThread(window);
    this.view = "chat";
    this.refresh();
    this.updateComplete.then(() => this.focusRegion());
  }

  /**
   * Opens the panel's question in the window's Thread, the same way as
   * typing it here. If the Thread is still answering, leaves the question
   * in the input to send later instead; or, with newIfBusy (the Command
   * bar's Ask), asks it in a new Thread, leaving that one to go on.
   *
   * @param {string} prompt
   * @param {object} [options]
   * @param {string} [options.context] What the question shares (one of
   *   CONTEXTS' ids), instead of the session setting, which stays as it is.
   * @param {boolean} [options.newIfBusy]
   */
  ask(prompt, { context, newIfBusy = false } = {}) {
    if (this.#showState) {
      this.notify(t("orbito-show-input-blocked"));
      return;
    }
    this.view = "chat";
    if (this.#core.isRunning(this.#core.threadFor(window))) {
      if (!newIfBusy) {
        this.#setInput(prompt);
        return;
      }
      this.#core.newThread(window);
    }
    this.submit(prompt, { context });
  }

  /**
   * Asks the question. A "/name" that calls no skill is not asked: it stays
   * in the input with a notice.
   *
   * @param {string} [prompt] The input's text by default.
   * @param {object} [options]
   * @param {string} [options.context] See ask().
   */
  async submit(prompt = this.input.value.trim(), { context } = {}) {
    let tab = gBrowser.selectedTab;
    let core = this.#core;
    let threadId = core.threadFor(window);
    // Show Orbito blocks this window's agent.
    if (!prompt || core.isRunning(threadId) || this.#showState) {
      return;
    }
    this.#skills = [];
    if (prompt.startsWith("/")) {
      let { unknown } = await core.parsePrompt(prompt, {
        space: await core.questionSpace(threadId, { tab }),
      });
      if (unknown != null) {
        this.#setInput(prompt);
        this.#notice = t("orbito-assistant-unknown-skill", { name: unknown });
        this.requestUpdate();
        await this.updateComplete;
        return;
      }
      if (core.isRunning(threadId) || this.#showState) {
        return;
      }
    }
    this.#notice = "";
    this.#setInput("");
    this.#stick = true;
    core
      .ask({
        threadId,
        prompt,
        origin: { tab },
        confirm: request => this.#confirm(request),
        ...this.requestOptions({ context }),
      })
      .catch(console.error);
    this.requestUpdate();
  }

  /**
   * The core's confirm delegate: shows Allow and Deny in the reply, or, at
   * a step of a skill the user enters themselves, Stop and Continue.
   */
  #confirm({ threadId, callId, name, text, site, code }) {
    let { promise, resolve } = Promise.withResolvers();
    this.#endApproval(threadId, "stopped");
    this.#approvals.set(threadId, { callId, name, text, site, code, resolve });
    this.#asked.add(threadId);
    this.#approvalsChanged();
    if (threadId == this.threadId) {
      this.#queueRefresh();
    }
    return promise;
  }

  // In an Orbit's task, Deny also stops the task: what it opened so far is
  // then the user's to keep or close. Stop at a step of a skill the user
  // enters themselves stops the question.
  #answer(threadId, allowed) {
    let orbit = this.#core.liveOrbit(threadId);
    let entry = this.#approvals.get(threadId)?.name == lazy.STEP_TOOL;
    this.#endApproval(threadId, allowed ? "allowed" : "denied");
    this.#approvals.delete(threadId);
    if (!allowed && (orbit || entry)) {
      this.#core.stop(threadId, {
        notice: entry
          ? t("orbito-assistant-skill-step-stopped")
          : t("orbito-assistant-stopped-denied"),
      });
    }
    this.#approvalsChanged();
    this.#queueRefresh();
  }

  /**
   * Shows the Thread of an Orbit's task in the panel, in its Space.
   *
   * @param {string} id The Orbit's task id.
   */
  showOrbit(id) {
    let threadId = this.#core.orbitThread(id);
    if (!threadId) {
      window.OrbitoAssistant.toggle(true);
      return;
    }
    this.#core.openThread(window, threadId).catch(e => {
      console.error(e);
      window.OrbitoAssistant.toggle(true);
    });
  }

  async #settleOrbit(message, part, choice) {
    let key = `orbit ${part.id}`;
    this.#ui.set(key, { busy: true, error: "" });
    this.requestUpdate();
    try {
      await this.#core.settleOrbit(message.thread_id, part.id, choice);
      this.#ui.delete(key);
    } catch (e) {
      this.#ui.set(key, { busy: false, error: e.message || String(e) });
    }
    this.requestUpdate();
  }

  // The Thread list.

  /**
   * Shows the Thread list in the Thread's place, the keyboard on the
   * Thread shown.
   *
   * @param {object} [options]
   * @param {boolean} [options.focusVisible] Whether the row shows focus,
   *   as when the list opened from the keyboard.
   */
  async showThreads({ focusVisible = false } = {}) {
    this.#threadFocus = null;
    this.view = "threads";
    // Opening, it loads the list.
    await this.updateComplete;
    await this.#threadListLoad;
    this.#rovingRow()?.focus({ focusVisible });
  }

  /**
   * Goes back from the Thread list to the Thread, focus on the list button
   * if it was in the list.
   *
   * @param {object} [options]
   * @param {boolean} [options.focusVisible] Whether the button shows focus,
   *   as after Escape.
   */
  async showChat({ focusVisible = false } = {}) {
    let active = this.renderRoot.activeElement;
    let button = this.threadsView?.contains(active)
      ? this.threadsButton
      : this.documentsView?.contains(active) && this.#documents.length
        ? this.documentsButton
        : null;
    this.view = "chat";
    await this.updateComplete;
    button?.focus({ focusVisible });
  }

  /**
   * Shows the documents the Thread made in its place, the keyboard on the
   * newest.
   *
   * @param {object} [options]
   * @param {boolean} [options.focusVisible] As for showThreads().
   */
  async showDocuments({ focusVisible = false } = {}) {
    this.view = "documents";
    await this.updateComplete;
    this.#documentRows()[0]?.focus({ focusVisible });
  }

  /**
   * Loads the documents the Thread shown made: with force, or when the
   * Thread or its document cards changed since.
   */
  async #loadDocuments({ force = false } = {}) {
    let id = this.threadId;
    let key = [
      id,
      ...this.messages.flatMap(m =>
        m.parts.filter(p => p.type == "artifact").map(p => p.id)
      ),
    ].join(" ");
    if (!force && key == this.#documentsKey) {
      return;
    }
    this.#documentsKey = key;
    let seq = ++this.#documentsSeq;
    let documents = await this.#core.threadArtifacts(id);
    if (seq == this.#documentsSeq) {
      this.#documents = documents;
      this.requestUpdate();
    }
  }

  #documentRows() {
    return [...this.renderRoot.querySelectorAll(".document-row")];
  }

  /** Opens a listed document: in a tab of the window's Space. */
  async #openListed(id) {
    try {
      await this.#core.openArtifact(window, id);
    } catch (e) {
      console.error(e);
    }
  }

  async #loadThreadList() {
    let seq = ++this.#threadListSeq;
    let threads = await this.#core.threadList(window, {
      all: this.threadScope == "all",
    });
    if (seq == this.#threadListSeq) {
      this.#threadList = threads;
      this.requestUpdate();
    }
    await this.updateComplete;
  }

  #queueThreadList() {
    if (this.view != "threads" || this.#threadListQueued) {
      return;
    }
    this.#threadListQueued = true;
    window.requestAnimationFrame(() => {
      this.#threadListQueued = false;
      this.#threadListLoad = this.#loadThreadList();
    });
  }

  /** Opens a listed Thread: in its Space, which the window then shows. */
  async #openListedThread(threadId) {
    try {
      if (threadId != this.threadId) {
        await this.#core.openThread(window, threadId);
      }
      await this.showChat();
      this.focusRegion();
    } catch (e) {
      console.error(e);
    }
  }

  // The row that is the list's tab stop: the one the keyboard was on, else
  // the Thread shown's, else New Thread.
  #rovingId() {
    let ids = this.#threadList.map(thread => thread.id);
    return [this.#threadFocus, this.threadId].find(
      id => id === "" || ids.includes(id)
    ) ?? "";
  }

  #rovingRow() {
    let id = this.#rovingId();
    return [...this.renderRoot.querySelectorAll(".thread-row")].find(
      row => (row.dataset.thread ?? "") == id
    );
  }

  // Up and Down (Home, End) move between the rows of the Thread list or
  // the document list; Escape goes back to the Thread.
  #onThreadsKey(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (event.key == "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.showChat({ focusVisible: true });
      return;
    }
    let rows = [
      ...this.renderRoot.querySelectorAll(
        this.view == "documents" ? ".document-row" : ".thread-row"
      ),
    ];
    let index = rows.indexOf(this.renderRoot.activeElement);
    if (index < 0) {
      return;
    }
    let next;
    switch (event.key) {
      case "ArrowDown":
        next = Math.min(index + 1, rows.length - 1);
        break;
      case "ArrowUp":
        next = Math.max(index - 1, 0);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = rows.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    rows[next].focus({ focusVisible: true });
  }

  // Answers the Thread's approval, if one is asked here, and keeps
  // how it ended for its card.
  #endApproval(threadId, how) {
    let approval = this.#approvals.get(threadId);
    if (approval) {
      this.#answered.set(approval.callId, how);
      approval.resolve(how == "allowed");
    }
  }

  #denyAll() {
    for (let threadId of this.#asked) {
      this.#endApproval(threadId, "stopped");
      this.#approvals.delete(threadId);
    }
    this.#asked.clear();
  }

  #approvalsChanged() {
    window.dispatchEvent(new CustomEvent("OrbitoAssistantApprovalsChange"));
  }

  // The input.

  #setInput(value) {
    let input = this.input;
    input.value = value;
    this.#autosize();
    let hasText = !!value.trim();
    if (hasText != this.#hasText) {
      this.#hasText = hasText;
      this.requestUpdate();
    }
  }

  #autosize() {
    let input = this.input;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }

  #onInput() {
    this.#autosize();
    let hasText = !!this.input.value.trim();
    if (hasText != this.#hasText || this.#notice) {
      this.#hasText = hasText;
      this.#notice = "";
      this.requestUpdate();
    }
    this.#updateSkillMenu();
  }

  #onInputKey(event) {
    if (this.#skillMenuKey(event)) {
      event.preventDefault();
    } else if (event.key == "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.submit();
    }
  }

  #onSend() {
    if (this.#running) {
      this.#core.stop(this.threadId);
    } else {
      this.submit();
    }
  }

  /**
   * Shows the skills that are on whose names start with what is typed after
   * "/", until a whole name is typed: those the Thread's Space sees.
   */
  async #updateSkillMenu() {
    let value = this.input.value;
    let seq = ++this.#skillSeq;
    if (!value.startsWith("/") || value.includes("\n")) {
      this.#showSkills([]);
      return;
    }
    let skills = [];
    try {
      skills = await this.#questionSkills();
    } catch (e) {
      console.error(e);
    }
    if (seq != this.#skillSeq) {
      return;
    }
    let typed = value.slice(1);
    this.#showSkills(
      skills.filter(s => s.enabled && s.name.startsWith(typed) && s.name != typed)
    );
  }

  /** The skills a question in the window's Thread sees (core.skills()). */
  async #questionSkills() {
    let core = this.#core;
    return core.skills({
      space: await core.questionSpace(core.threadFor(window), {
        tab: gBrowser.selectedTab,
      }),
    });
  }

  #showSkills(skills) {
    this.#skills = skills;
    this.#skillIndex = 0;
    this.requestUpdate();
  }

  #pickSkill(name) {
    this.#showSkills([]);
    this.#setInput(`/${name} `);
    this.input.focus();
  }

  /**
   * Arrow keys move through the skill menu, Tab and Enter pick the selected
   * skill and Escape closes it.
   *
   * @returns {boolean} Whether the key was the menu's.
   */
  #skillMenuKey(event) {
    let count = this.#skills.length;
    if (!count || event.isComposing) {
      return false;
    }
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        let step = event.key == "ArrowDown" ? 1 : -1;
        this.#skillIndex = (this.#skillIndex + step + count) % count;
        this.requestUpdate();
        return true;
      }
      case "Tab":
      case "Enter":
        if (event.shiftKey) {
          return false;
        }
        this.#pickSkill(this.#skills[this.#skillIndex].name);
        return true;
      case "Escape":
        this.#showSkills([]);
        return true;
    }
    return false;
  }

  // Suggestions.

  /**
   * Shows the chips of the skills the selected page may want, decided by
   * local rules only: nothing reaches the model until one is picked. Not
   * while the window's Thread is answering, in private windows, or with
   * orbito.assistant.suggestions.enabled off.
   */
  async #updateSuggestions() {
    let seq = ++this.#chipsSeq;
    let tab = gBrowser.selectedTab;
    let core = this.#core;
    if (
      this.hidden ||
      this.#isPrivate ||
      !Services.prefs.getBoolPref("orbito.assistant.suggestions.enabled", true) ||
      core.isRunning(core.threadFor(window))
    ) {
      this.#showChips([]);
      return;
    }
    let chips = [];
    try {
      let features = await lazy.OrbitoPage.features(tab);
      let skills = new Set(
        (await this.#questionSkills()).filter(s => s.enabled).map(s => s.name)
      );
      chips = lazy.suggestions(
        features,
        Services.locale.appLocaleAsBCP47
      )
        .filter(chip => skills.has(chip.skill) && !this.#isDismissed(tab, chip))
        .map(chip => ({ ...chip, label: CHIP_LABELS[chip.id] ?? chip.label }));
    } catch {
      // Not a web page, or it went away meanwhile.
    }
    if (seq != this.#chipsSeq || tab != gBrowser.selectedTab) {
      return;
    }
    if (core.isRunning(core.threadFor(window))) {
      chips = [];
    }
    this.#showChips(chips, tab);
  }

  #showChips(chips, tab = this.#chipsTab) {
    if (chips.length || this.#chips.length) {
      this.#chips = chips;
      this.#chipsTab = tab;
      this.requestUpdate();
    }
  }

  #isDismissed(tab, chip) {
    let key = `${chip.id} ${tab.linkedBrowser.currentURI.spec}`;
    return !!this.#dismissed.get(tab)?.has(key);
  }

  #dismiss(tab, chip) {
    if (!this.#dismissed.has(tab)) {
      this.#dismissed.set(tab, new Set());
    }
    this.#dismissed
      .get(tab)
      .add(`${chip.id} ${tab.linkedBrowser.currentURI.spec}`);
    this.#showChips(this.#chips.filter(c => c.id != chip.id));
  }

  // Settings: the backend, its key or login, model and base URL.

  /**
   * Opens or closes the settings form, which shows the backend new
   * questions go to, or another one. Resolves once it shows them.
   *
   * @param {boolean} [force]
   * @param {object} [options]
   * @param {string} [options.backend] The backend to show; saving its
   *   settings then leaves the one new questions go to as it is, unless
   *   another is picked in the form.
   */
  async toggleSettings(force = !this.#settings.open, { backend } = {}) {
    this.#settings.open = force;
    this.requestUpdate();
    if (force) {
      let shown = backend in this.#core.BACKENDS ? backend : null;
      this.#settings.only = shown;
      await this.#loadSettings(shown ?? this.#core.backend);
      (this.#settings.login ? this.modelInput : this.keyInput).focus();
    }
    await this.updateComplete;
  }

  async #loadSettings(backend) {
    let core = this.#core;
    let config = core.BACKENDS[backend];
    let settings = this.#settings;
    settings.backend = backend;
    // How Claude authenticates, chosen here or on the settings page.
    await this.#loadAuth(backend == "claude" ? await core.claudeAuth() : "");
    let key = config.login ? "" : await core.getKey(backend);
    this.requestUpdate();
    await this.updateComplete;
    this.backendInput.value = backend;
    this.authInput.value = settings.auth;
    this.keyInput.value = key;
    this.modelInput.value = core.model(backend);
    this.baseInput.value = core.baseURL;
    settings.models = [];
    core.models(backend).then(models => {
      if (settings.backend == backend) {
        settings.models = models ?? [];
        this.requestUpdate();
      }
    });
  }

  async #loadAuth(auth) {
    let settings = this.#settings;
    settings.auth = auth;
    settings.login =
      !!this.#core.BACKENDS[settings.backend].login || auth == "claudeAccount";
    if (settings.login) {
      let account =
        auth == "claudeAccount" ? lazy.ClaudeAccount : lazy.OrbitoChatGPT;
      let { state, email } = await account.status();
      settings.status =
        state == "signed_in"
          ? email
            ? t("orbito-assistant-signed-in-as", { email })
            : t("orbito-assistant-signed-in")
          : t("orbito-assistant-not-signed-in");
    }
    this.requestUpdate();
  }

  async #saveSettings(event) {
    event.preventDefault();
    let core = this.#core;
    let backend = this.backendInput.value;
    if (backend == "claude" && this.authInput.value) {
      core.setClaudeAuth(this.authInput.value);
    }
    if (!this.#settings.login) {
      await core.setKey(backend, this.keyInput.value.trim());
    }
    if (backend != this.#settings.only) {
      core.backend = backend;
    }
    core.setModel(backend, this.modelInput.value.trim());
    if (backend == "openai") {
      core.baseURL = this.baseInput.value.trim();
    }
    await this.toggleSettings(false);
    this.updateUsage();
    this.focusRegion();
  }

  // Actions under the Thread and its replies.

  #uiState(key) {
    if (!this.#ui.has(key)) {
      this.#ui.set(key, { busy: false, error: "", items: null });
    }
    return this.#ui.get(key);
  }

  /** Runs an action under a reply, showing why it failed if it does. */
  async #act(key, fn) {
    let state = this.#uiState(key);
    state.busy = true;
    state.error = "";
    this.requestUpdate();
    try {
      await fn();
    } catch (e) {
      state.error = e.message;
    } finally {
      state.busy = false;
      this.requestUpdate();
    }
  }

  #openArtifact(id) {
    return this.#act(`artifact ${id}`, () =>
      this.#core.openArtifact(window, id)
    );
  }

  /** Deletes a memory straight away, without asking the model. */
  #undoMemory(id) {
    let state = this.#uiState(`memory ${id}`);
    state.busy = true;
    this.requestUpdate();
    this.#core.deleteMemory(id).catch(e => {
      console.error(e);
      state.busy = false;
      this.requestUpdate();
    });
  }

  /** Lists the memories a reply used, once its list is opened. */
  async #loadMemories(event, message, ids) {
    let state = this.#uiState(`memories ${message.id}`);
    if (!event.target.open || state.items) {
      return;
    }
    let memories = new Map(
      (await this.#core.listMemories()).map(m => [m.id, m])
    );
    state.items = ids.map(id => memories.get(id)?.text ?? null);
    this.requestUpdate();
  }

  /**
   * Has the core draft a skill from the Thread shown and opens it in
   * the settings page's editor.
   */
  async #draftSkill() {
    this.#draft = { busy: true, error: "" };
    this.requestUpdate();
    try {
      let draft = await this.#core.draftSkill(this.threadId);
      lazy.OrbitoPages.openSkillDraft(window, draft);
    } catch (e) {
      this.#draft.error = t("orbito-assistant-draft-skill-failed", {
        error: e.message,
      });
    } finally {
      this.#draft.busy = false;
      this.requestUpdate();
    }
  }

  #openSettingsPage() {
    lazy.OrbitoPages.openSettings(window);
  }

  /** Opens the library on its "documents" or "threads". */
  #openLibrary(list) {
    lazy.OrbitoPages.openLibrary(window, { list });
  }

  // Show Orbito: the goal, the recording and the stopped demo take the
  // Thread's place; the window's ShowOrbito does the work.

  /**
   * Catches up with the window's Show Orbito: follows the steps of the demo
   * it records, for their count, and moves focus along as the view in the
   * Thread's place changes under it.
   */
  #followShow() {
    this.#unsubscribeShow?.();
    this.#unsubscribeShow = null;
    let show = this.#show;
    let log = show?.recording ? show.log : null;
    if (log) {
      this.#unsubscribeShow = log.subscribe(() => this.requestUpdate());
    }
    if (show?.state) {
      this.#closeMenu();
      this.#showSkills([]);
    }
    // What the notice said was about the state before.
    this.#notice = "";
    // The Thread, back, shows its end.
    this.#stick = true;
    let hadFocus = this.matches(":focus-within");
    this.requestUpdate();
    if (!this.hidden && (hadFocus || show?.state == "goal")) {
      this.updateComplete.then(() => this.focusRegion());
    }
  }

  /**
   * Catches up with the review of the stopped demo. Once the skill shows,
   * focus moves on to it from the view before, which goes.
   */
  #followReview() {
    let phase = this.#show?.review?.phase ?? null;
    let moved = phase != this.#reviewPhase && phase == "ready";
    this.#reviewPhase = phase;
    let hadFocus = this.matches(":focus-within");
    this.requestUpdate();
    if (moved && hadFocus && !this.hidden) {
      this.updateComplete.then(() => this.focusRegion());
    }
  }

  #startShow() {
    this.#notice = "";
    this.#show.start(this.goalInput?.value ?? "");
  }

  /** The skill the review changes, or null. */
  get #reviewSkill() {
    let review = this.#show?.review;
    return review?.phase == "ready" ? review.skill : null;
  }

  // An input is kept an input or made the value it had in the demo.
  #setFixed(input, fixed) {
    if (fixed && !input.value) {
      return;
    }
    input.fixed = fixed;
    this.requestUpdate();
  }

  /**
   * The arrow keys and Home and End in an input's "As input / Fixed value"
   * choice pick the other one, as in other radio groups.
   */
  #onModeKey(event, input) {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    let fixed = {
      ArrowLeft: false,
      ArrowUp: false,
      Home: false,
      ArrowRight: true,
      ArrowDown: true,
      End: true,
    }[event.key];
    if (fixed == undefined) {
      return;
    }
    event.preventDefault();
    if (document.dir == "rtl" && event.key.startsWith("ArrowL")) {
      fixed = true;
    } else if (document.dir == "rtl" && event.key.startsWith("ArrowR")) {
      fixed = false;
    }
    if (fixed && !input.value) {
      return;
    }
    this.#setFixed(input, fixed);
    let group = event.currentTarget;
    this.updateComplete.then(() =>
      group.querySelector(`[data-value="${fixed ? "fixed" : "input"}"]`)?.focus()
    );
  }

  /**
   * Moves the step at index by delta (-1 up, 1 down); focus stays with it,
   * on what had it (its field or a button), or its field when that button
   * cannot be pressed there.
   */
  #moveStep(index, delta, from = "text") {
    let steps = this.#reviewSkill?.steps;
    let to = index + delta;
    if (!steps || to < 0 || to >= steps.length) {
      return;
    }
    let [step] = steps.splice(index, 1);
    steps.splice(to, 0, step);
    this.#focusStep(to, from);
  }

  /** Deletes the step at index; focus goes on to the step in its place. */
  #deleteStep(index) {
    let steps = this.#reviewSkill?.steps;
    if (!steps) {
      return;
    }
    steps.splice(index, 1);
    if (steps.length) {
      this.#focusStep(Math.min(index, steps.length - 1), "text");
    } else {
      this.requestUpdate();
      this.updateComplete.then(() => this.reviewName?.focus());
    }
  }

  // Focuses the step at index once drawn: its field or one of its buttons
  // ("up", "down" or "delete"), its field if that button is disabled.
  #focusStep(index, part) {
    this.requestUpdate();
    this.updateComplete.then(() => {
      let row = this.reviewSteps?.children[index];
      let button = part != "text" && row?.querySelector(`.step-${part}`);
      (button && !button.disabled ? button : row?.querySelector(".step-text"))?.focus();
    });
  }

  /**
   * In a step's field: Up and Down go to the step before or after, and
   * with Alt move the step itself.
   */
  #onStepKey(event, index) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) {
      return;
    }
    let delta = { ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (!delta) {
      return;
    }
    event.preventDefault();
    if (event.altKey) {
      this.#moveStep(index, delta);
    } else {
      this.reviewSteps?.children[index + delta]?.querySelector(".step-text")?.focus();
    }
  }

  #onGoalKey(event) {
    if (event.key == "Enter" && !event.isComposing) {
      event.preventDefault();
      this.#startShow();
    } else if (event.key == "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.#show.cancel();
    }
  }

  // Rendering.

  /** The Thread's title: its first question, as the core names it. */
  #threadTitle() {
    let question = this.messages.find(m => m.role == "user");
    let words = question?.parts
      .map(p => (p.type == "skill" ? `/${p.name}` : p.type == "text" ? p.text : ""))
      .filter(Boolean)
      .join(" ")
      .trim();
    return words?.slice(0, 50) || t("orbito-assistant-new-thread");
  }

  /**
   * Renders model output as Markdown with the converter the document pages
   * use too (OrbitoMarkdown.sys.mjs). Links open in a tab when clicked.
   * Kept per message and run of text, so that a finished reply is not
   * converted again on every update.
   */
  #markdownOf(key, text) {
    let cached = this.#markdown.get(key);
    if (cached?.text == text) {
      return cached.nodes;
    }
    let link = (href, label) => {
      let open = event => {
        if (event.type == "keydown" ? event.key != "Enter" : event.button > 1) {
          return;
        }
        event.preventDefault();
        window.openWebLinkIn(href, "tab");
      };
      // No href: a link in the chrome document would navigate the window.
      let a = document.createElement("a");
      a.setAttribute("role", "link");
      a.setAttribute("tabindex", "0");
      a.setAttribute("title", href);
      a.addEventListener("click", open);
      a.addEventListener("auxclick", open);
      a.addEventListener("keydown", open);
      a.append(...label);
      return a;
    };
    let nodes = lazy.markdown(document, text, { link });
    this.#markdown.set(key, { text, nodes });
    return nodes;
  }

  #renderReason(state) {
    return html`<span class="reason" ?hidden=${!state?.error}
      >${state?.error ?? ""}</span
    >`;
  }

  #renderUserMessage(message) {
    return html`<div class="message user">${message.parts.map(part =>
      part.type == "skill"
        ? html`<span class="skill-chip" title=${t("orbito-assistant-skill")}>/${part.name}</span>`
        : part.type == "text"
          ? part.text
          : nothing
    )}</div>`;
  }

  #renderStep(part, result) {
    let state = !result ? "running" : result.is_error ? "failed" : "";
    return html`<div class="step ${state}">
      <span class="step-label">${part.label || part.name}</span>${result?.is_error
        ? html`<span class="reason">${result.content}</span>`
        : nothing}
    </div>`;
  }

  // The tabs a reply read or opened, each a chip with its icon and title
  // that goes to the tab, or opens the page again once it is closed.
  #renderSources(message) {
    let sources = this.#core.replySources(message);
    if (!sources.length) {
      return nothing;
    }
    return html`<div class="sources" role="group" aria-label=${t("orbito-assistant-sources")}>
      ${sources.map(
        ({ url, title }) => html`<button class="src-chip" title=${url} @click=${() => this.#openSource(url)}>
          <img src=${`page-icon:${url}`} alt="" @error=${event => (event.target.src = DEFAULT_ICON)} /><span>${title || host(url)}</span>
        </button>`
      )}
    </div>`;
  }

  // Selects a tab, in whichever window it is.
  #selectTab(tab) {
    tab.documentGlobal.gBrowser.selectedTab = tab;
    tab.documentGlobal.focus();
  }

  // A tab at the page, its fragment aside, in any window like this one
  // (private or not), the one used last first; else the page in a new tab.
  #openSource(url) {
    let spec;
    try {
      spec = Services.io.newURI(url).specIgnoringRef;
    } catch {
      return;
    }
    let windows = lazy.BrowserWindowTracker.orderedWindows.filter(
      w => lazy.PrivateBrowsingUtils.isWindowPrivate(w) == this.#isPrivate
    );
    for (let w of windows) {
      let tab = w.gBrowser.tabs.find(
        t => !t.closing && t.linkedBrowser.currentURI.specIgnoringRef == spec
      );
      if (tab) {
        this.#selectTab(tab);
        return;
      }
    }
    window.openWebLinkIn(url, "tab", { inBackground: false });
  }

  #renderArtifact(part) {
    let state = this.#ui.get(`artifact ${part.id}`);
    return html`<div class="artifact">
      <span class="artifact-title">${part.title}</span>
      <button class="mini" @click=${() => this.#openArtifact(part.id)}>${t("orbito-assistant-open")}</button>
      ${this.#renderReason(state)}
    </div>`;
  }

  // The settings it opens are those of the reply's backend, which the
  // Thread keeps, not the one new questions go to.
  #renderError(part, backend) {
    return html`<div class="error" role="alert">
      <p>${part.message}</p>
      ${part.needsKey
        ? html`<button class="primary" @click=${() => this.toggleSettings(true, { backend })}>${t("orbito-assistant-open-settings")}</button>`
        : nothing}
      ${part.needsLogin
        ? html`<button class="primary" @click=${() => this.#openSettingsPage()}>${t("orbito-assistant-open-settings-page")}</button>`
        : nothing}
    </div>`;
  }

  // An approval waiting for the user: the question on one line with its
  // answers, a soft dot marking it as waiting; under it, the code the step
  // runs, if it runs any, in full; then the site the step
  // goes to and the task's name, or for a task's step on no site in
  // particular the icons of all the tabs it opened.
  #renderApproval(message) {
    let approval = this.#approvals.get(message.thread_id);
    let id = message.thread_id;
    let orbit = this.#core.liveOrbit(id);
    let tabs = orbit ? this.#core.orbitTabs(orbit) : [];
    // A step of a skill the user enters themselves.
    let entry = approval.name == lazy.STEP_TOOL;
    let site = approval.site;
    let meta = site
      ? html`<span class="favicons"><img src=${`page-icon:${site}`} alt="" @error=${event => (event.target.src = DEFAULT_ICON)} /></span>
          <span class="approval-site">${host(site)}</span><span class="approval-sep" aria-hidden="true">·</span>`
      : orbit
        ? html`<span class="favicons">${tabs.map(
            tab => html`<img src=${gBrowser.getIcon(tab) || DEFAULT_ICON} alt="" />`
          )}</span>`
        : null;
    return html`<div class="approval waiting" role="group" aria-label=${t("orbito-assistant-approval-needed")}>
      <div class="approval-row">
        <span class="pulse" aria-hidden="true"></span>
        <p title=${approval.text}>${approval.text}</p>
        <button class="secondary" @click=${() => this.#answer(id, false)}>${entry ? t("orbito-assistant-skill-step-stop") : t("orbito-assistant-deny")}</button>
        <button class="primary" @click=${() => this.#answer(id, true)}>${entry ? t("orbito-assistant-skill-step-continue") : t("orbito-assistant-allow")}</button>
      </div>
      ${approval.code
        ? html`<pre class="approval-code">${approval.code}</pre>`
        : nothing}
      ${meta
        ? html`<div class="approval-meta" title=${site || ""}>
            ${meta}<span class="approval-task">${this.#threadTitle()}</span>
          </div>`
        : nothing}
    </div>`;
  }

  // An approval once answered stays where it was asked, folded to one line:
  // the step's short name and how it ended; one PermissionMode "bypass"
  // allowed says so. Approvals kept before steps had a short name show the
  // question.
  #renderSettledApproval(part) {
    const ENDED = {
      allowed: t("orbito-assistant-approval-allowed"),
      denied: t("orbito-assistant-approval-denied"),
      stopped: t("orbito-assistant-approval-stopped"),
    };
    let how = this.#answered.get(part.call_id);
    if (part.name == lazy.STEP_TOOL) {
      ENDED.allowed = t("orbito-assistant-skill-step-continued");
      ENDED.denied = t("orbito-assistant-skill-step-stopped");
    }
    let note = part.bypassed
      ? t("orbito-assistant-approval-bypassed")
      : (ENDED[how] ??
        (part.result ? ENDED.allowed : t("orbito-assistant-approval-not-allowed")));
    return html`<div class=${`approval settled ${part.result ? "" : "no"}`} role="group" aria-label=${t("orbito-assistant-approval")}>
      <span class="approval-icon">${part.result ? ICONS.allowed : ICONS.denied}</span>
      <span class="approval-line" title=${part.text}><b>${part.action || part.text}</b> · <span class="done">${note}</span></span>
    </div>`;
  }

  // The steps of a skill made from a demo, before the agent starts them and
  // as it goes. While the reply runs they stay pinned above the input
  // (#renderPinnedSteps), not in the reply where its work pushes them
  // away: the step the agent is on, how far it is and a bar of all of
  // them, the list when the user opens it. Once the reply ends, the reply
  // keeps one line of how it went, the list folded under it. In the list,
  // those done are ticked, the one it is on marked, the one it could not
  // do says what it could not find, and steps the user enters themselves
  // say so.
  #renderSkillSteps(part, live, pinned = false) {
    let states = lazy.stepStates(part, { finished: !live && !part.stopped });
    let { failed } = part;
    let count = part.steps.length;
    let label = t("orbito-assistant-skill-steps", { name: part.name });
    let reason = failed?.missing
      ? html`<span class="reason">${t("orbito-assistant-skill-step-not-found", { what: failed.missing })}</span>`
      : nothing;
    let list = html`<ol>${part.steps.map((step, i) => {
      let state = states[i];
      return html`<li class=${state} aria-current=${state == "current" ? "step" : nothing}>
        <span class="skill-step-mark" aria-hidden="true">${state == "done" ? ICONS.allowed : state == "failed" ? ICONS.denied : i + 1}</span>
        <span class="skill-step-body">
          <span>${step.text || t("orbito-show-review-user-enters")}</span>
          ${step.direct && step.text ? html`<span class="skill-step-direct">${t("orbito-show-review-user-enters")}</span>` : nothing}
          ${state == "failed" ? reason : nothing}
        </span>
      </li>`;
    })}</ol>`;
    if (!pinned) {
      let done = states.every(state => state == "done");
      let status = failed
        ? t("orbito-assistant-skill-steps-failed", { n: failed.step, count })
        : done
          ? t("orbito-assistant-skill-steps-done", { count })
          : part.current
            ? t("orbito-assistant-skill-steps-at", { n: part.current, count })
            : t("orbito-assistant-skill-steps-count", { count });
      return html`<details class=${`skill-steps ${failed ? "failed" : done ? "done" : ""}`} aria-label=${label}>
        <summary>
          ${failed || done ? html`<span class="skill-steps-icon">${failed ? ICONS.denied : ICONS.allowed}</span>` : nothing}
          <span class="skill-steps-name">/${part.name}</span>
          <span class="skill-steps-status">${status}</span>
          ${reason}
        </summary>
        ${list}
      </details>`;
    }
    let open = this.#stepsOpen;
    let step = part.steps[part.current - 1];
    let now = failed
      ? t("orbito-assistant-skill-steps-failed", { n: failed.step, count })
      : step
        ? step.text || t("orbito-show-review-user-enters")
        : t("orbito-assistant-skill-steps-count", { count });
    let toggle = t(open ? "orbito-assistant-skill-steps-hide" : "orbito-assistant-skill-steps-show");
    return html`<div class=${`skill-steps pinned ${failed ? "failed" : ""}`} role="group" aria-label=${label}>
      <div class="skill-steps-now" role="status">
        <span class="skill-steps-current" title=${now}>${now}</span>
        ${step?.direct && step.text && !failed ? html`<span class="skill-step-direct">${t("orbito-show-review-user-enters")}</span>` : nothing}
        ${part.current
          ? html`<span class="skill-steps-count" title=${t("orbito-assistant-skill-steps-at", { n: part.current, count })}>${part.current}/${count}</span>`
          : nothing}
        <button
          class="icon skill-steps-toggle"
          aria-expanded=${open}
          aria-label=${toggle}
          title=${toggle}
          @click=${() => {
            this.#stepsOpen = !open;
            this.requestUpdate();
          }}
        >${ICONS.chevron}</button>
      </div>
      ${failed ? reason : nothing}
      <div class="skill-steps-bar" aria-hidden="true">${states.map(state => html`<i class=${state}></i>`)}</div>
      ${open ? list : nothing}
    </div>`;
  }

  // What to do with the tabs a finished task opened, once it is done, as
  // an approval asks: how the task ended on the first row; what it made
  // and the question under it; then close them, or keep them as a tab
  // group. Once answered (or its tabs gone before), one line with what
  // became of them.
  #renderOrbit(message, part) {
    const PICKED = {
      group: t("orbito-assistant-orbit-grouped"),
      close: t("orbito-assistant-orbit-closed"),
      // Choices of replies kept before these.
      keep: t("orbito-assistant-orbit-kept"),
      release: t("orbito-assistant-orbit-released"),
    };
    let wrapUp = t("orbito-assistant-orbit-wrap-up");
    let tabs = this.#core.orbitTabs(part.id);
    let state = this.#ui.get(`orbit ${part.id}`);
    // Closing them, before the choice is kept.
    if (!part.choice && !tabs.length && state?.busy) {
      return nothing;
    }
    if (part.choice || !tabs.length) {
      return html`<div class=${`orbit-card settled ${part.choice ? "" : "no"}`} role="group" aria-label=${wrapUp}>
        <span class="approval-icon">${part.choice ? ICONS.allowed : ICONS.denied}</span>
        <span class="approval-line"><b>${wrapUp}</b> · <span class="done">${part.choice ? PICKED[part.choice] : t("orbito-assistant-orbit-gone")}</span></span>
      </div>`;
    }
    // What the task made: its result tabs while they are open; once they
    // are gone, the documents the reply keeps.
    let resultTabs = tabs.filter(t => this.#core.isOrbitResult(t));
    let made = message.parts.filter(p => p.type == "artifact");
    let chips = resultTabs.length
      ? resultTabs.map(
          tab => html`<button class="result-chip" title=${tab.label} @click=${() => this.#selectTab(tab)}><img src=${tab.documentGlobal.gBrowser.getIcon(tab) || DEFAULT_ICON} alt="" /><span>${tab.label}</span></button>`
        )
      : made.map(
          part => html`<button class="result-chip" title=${part.title} @click=${() => this.#openArtifact(part.id)}>${ORBITO_LOGO}<span>${part.title}</span></button>`
        );
    let count = tabs.length;
    let pick = choice => this.#settleOrbit(message, part, choice);
    return html`<div class="orbit-card" role="group" aria-label=${wrapUp}>
      <div class="approval-row">
        <span class=${`pulse ${part.stopped ? "" : "ok"}`} aria-hidden="true"></span>
        <p>${part.stopped ? t("orbito-assistant-orbit-stopped-title") : t("orbito-assistant-orbit-done-title")}</p>
      </div>
      <div class="approval-meta">
        ${chips.map(chip => html`${chip}<span class="approval-sep" aria-hidden="true">·</span>`)}
        <span class="approval-task">${t("orbito-assistant-orbit-tabs", { count })}</span>
      </div>
      <div class="approval-actions">
        <button class="secondary" data-choice="close" ?disabled=${!!state?.busy} @click=${() => pick("close")}>${t("orbito-assistant-orbit-close-tabs")}</button>
        <button class="primary" data-choice="group" ?disabled=${!!state?.busy} @click=${() => pick("group")}>${t("orbito-assistant-orbit-keep-group")}</button>
      </div>
      ${this.#renderReason(state)}
    </div>`;
  }

  #renderMemory(part) {
    if (part.undone) {
      return html`<div class="memory undone">${t("orbito-assistant-memory-forgot", { text: part.text })}</div>`;
    }
    let state = this.#ui.get(`memory ${part.id}`);
    return html`<div class="memory">
      <span>${t("orbito-assistant-memory-remembered", { text: part.text })}</span>
      <button class="secondary" ?disabled=${!!state?.busy} @click=${() => this.#undoMemory(part.id)}>${t("orbito-assistant-memory-undo")}</button>
    </div>`;
  }

  /** How long the model thought; clicked, what it thought, if it was kept. */
  #renderThought(part) {
    let label = t("orbito-assistant-thought-for", {
      seconds: Math.max(1, Math.round(part.duration_ms / 1000)),
    });
    if (!part.text?.trim()) {
      return html`<div class="thought">${label}</div>`;
    }
    return html`<details class="thought">
      <summary>${label}</summary>
      <div class="thought-text">${part.text.trim()}</div>
    </details>`;
  }

  #renderMemoriesUsed(message, ids) {
    let state = this.#ui.get(`memories ${message.id}`);
    return html`<details
      class="memories"
      @toggle=${event => this.#loadMemories(event, message, ids)}
    >
      <summary>${t("orbito-assistant-memories-used", { count: ids.length })}</summary>
      <ul>
        ${(state?.items ?? []).map(text =>
          text == null
            ? html`<li class="undone">${t("orbito-assistant-memory-forgotten")}</li>`
            : html`<li>${text}</li>`
        )}
      </ul>
    </details>`;
  }

  /**
   * Whether the live reply waits for the model's first token: nothing
   * written yet, or a step just done, rather than text streaming in or a
   * step still running (steps run at once may end in any order).
   */
  #waitsForModel(message, results) {
    if (message.parts.some(p => p.type == "tool_call" && !results.has(p.id))) {
      return false;
    }
    let last = message.parts.findLast(p =>
      ["text", "tool_call", "tool_result", "thinking", "artifact"].includes(
        p.type
      )
    );
    return last?.type != "text";
  }

  #renderReply(message, live) {
    let core = this.#core;
    let results = new Map(
      message.parts
        .filter(p => p.type == "tool_result")
        .map(p => [p.call_id, p])
    );
    let children = [];
    let text = "";
    let run = 0;
    let flushText = () => {
      if (text) {
        children.push(this.#markdownOf(`${message.id} ${run++}`, text));
        text = "";
      }
    };
    for (let part of message.parts) {
      switch (part.type) {
        case "text":
          text += part.text;
          break;
        case "tool_call":
          flushText();
          children.push(this.#renderStep(part, results.get(part.id)));
          break;
        case "artifact":
          flushText();
          children.push(this.#renderArtifact(part));
          break;
        case "thinking":
          flushText();
          children.push(this.#renderThought(part));
          break;
        case "error":
          flushText();
          children.push(this.#renderError(part, message.backend));
          break;
        case "approval":
          flushText();
          children.push(this.#renderSettledApproval(part));
          break;
        case "skill_steps":
          if (!live) {
            flushText();
            children.push(this.#renderSkillSteps(part, live));
          }
          break;
      }
    }
    flushText();
    if (!live) {
      children.push(this.#renderSources(message));
    }
    if (live && core.thinkingSince(message.thread_id)) {
      children.push(
        html`<div class="thought thinking" role="status">${t("orbito-assistant-thinking")}</div>`
      );
    } else if (
      live &&
      !this.#approvals.has(message.thread_id) &&
      this.#waitsForModel(message, results)
    ) {
      children.push(
        html`<div class="dots" role="status"><i></i><i></i><i></i><span class="visually-hidden">${t("orbito-assistant-waiting")}</span></div>`
      );
    }
    if (live && this.#approvals.has(message.thread_id)) {
      children.push(this.#renderApproval(message));
    }
    let orbit = message.parts.find(p => p.type == "orbit");
    if (orbit && !live) {
      children.push(this.#renderOrbit(message, orbit));
    }
    let used = [
      ...new Set(
        message.parts.filter(p => p.type == "skill_used").map(p => p.name)
      ),
    ];
    if (used.length) {
      children.push(
        html`<div class="skills-used">${used.map(
          name => html`<span class="skill-chip" title=${t("orbito-assistant-skill-used")}>/${name}</span>`
        )}</div>`
      );
    }
    for (let part of message.parts) {
      if (part.type == "memory_saved") {
        children.push(this.#renderMemory(part));
      }
    }
    let memories = message.parts.find(p => p.type == "memories");
    if (memories) {
      children.push(this.#renderMemoriesUsed(message, memories.ids));
    }
    for (let notice of core.notices(message.id)) {
      children.push(html`<div class="notice">${notice}</div>`);
    }
    return html`<div class="message assistant">${children}</div>`;
  }

  /** Asks what the demo is for, before it starts; the goal is optional. */
  #renderShowGoal() {
    return html`<div class="show goal-step" role="group" aria-labelledby="show-title">
      <div class="show-title" id="show-title" role="heading" aria-level="3">${t("orbito-show")}</div>
      <label class="show-label" for="show-goal">${t("orbito-show-goal-label")}</label>
      <input
        class="goal"
        id="show-goal"
        type="text"
        autocomplete="off"
        placeholder=${t("orbito-show-goal-placeholder")}
        .value=${this.#show.suggestedGoal ?? ""}
        aria-describedby="show-goal-hint"
        @keydown=${this.#onGoalKey}
      />
      <p class="hint" id="show-goal-hint">${t("orbito-show-goal-hint")}</p>
      <div class="show-actions">
        <button class="secondary show-cancel" @click=${() => this.#show.cancel()}>${t("orbito-show-cancel")}</button>
        <button class="primary show-start" @click=${() => this.#startShow()}>${t("orbito-show-start")}</button>
      </div>
    </div>`;
  }

  /**
   * The recording: Stop and Cancel at the top, then the live summary's
   * steps, when the model has written them, and how many actions the demo
   * has.
   */
  #renderShowRecording() {
    let log = this.#show.log;
    let steps = this.#show.summary ?? [];
    let shortcut = stopShortcutText();
    return html`<div class="show recording" role="group" aria-labelledby="show-title">
      <div class="show-head">
        <span class="rec-dot" aria-hidden="true"></span>
        <div class="show-title" id="show-title" role="heading" aria-level="3">${t("orbito-show-watching")}</div>
      </div>
      ${log?.goal ? html`<p class="show-goal" title=${log.goal}>${log.goal}</p>` : nothing}
      <div class="show-actions">
        <button class="secondary show-cancel" @click=${() => this.#show.cancel()}>${t("orbito-show-cancel")}</button>
        <button
          class="primary show-stop"
          title=${t("orbito-show-stop-title", { shortcut })}
          aria-keyshortcuts=${shortcut == "⌘⇧." ? "Meta+Shift+." : "Control+Shift+."}
          @click=${() => this.#show.stop("button")}
        >${ICONS.stop}${t("orbito-show-stop")}</button>
      </div>
      <ol class="show-steps" aria-label=${t("orbito-show-steps")} ?hidden=${!steps.length}>${steps.map(
        step => html`<li>${step}</li>`
      )}</ol>
      <p class="show-count" role="status">${t("orbito-show-recording", { count: log?.length ?? 0 })}</p>
    </div>`;
  }

  /**
   * A stopped demo while the backend turns it into a skill, or after that
   * failed, with Try again; then the review of the skill.
   */
  #renderShowStopped() {
    let show = this.#show;
    let review = show.review;
    if (review?.phase == "ready") {
      return this.#renderReview(review);
    }
    let failed = review?.phase == "failed";
    return html`<div class="show stopped" role="group" aria-labelledby="show-title" aria-busy=${failed ? "false" : "true"}>
      <div class="show-title" id="show-title" role="heading" aria-level="3">${t("orbito-show-recorded")}</div>
      <p class="show-count">${t("orbito-show-recorded-count", { count: show.log?.length ?? 0 })}</p>
      ${show.reason == "timeout"
        ? html`<p class="hint">${t("orbito-show-stopped-timeout")}</p>`
        : nothing}
      <p class="show-status" role="status">${failed
        ? nothing
        : html`<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>${t("orbito-show-converting")}`}</p>
      <p class="show-error" role="alert" ?hidden=${!failed}>${failed
        ? t("orbito-show-review-failed", { error: review.error })
        : ""}</p>
      <div class="show-actions">
        <button class="secondary show-cancel" @click=${() => show.cancel()}>${t("orbito-show-discard")}</button>
        ${failed
          ? html`<button class="primary show-retry" @click=${() => show.convert()}>${t("orbito-show-retry")}</button>`
          : nothing}
      </div>
    </div>`;
  }

  /**
   * The skill made of the demo, for the user to check before saving: its
   * name and description, its inputs, its steps, and Discard, Record again
   * and Save. Changes go into the review's skill as they are typed.
   */
  #renderReview(review) {
    let show = this.#show;
    let skill = review.skill;
    let count = skill.steps.length;
    let canSave =
      !review.saving && skill.steps.some(step => step.text.trim() || step.direct);
    return html`<div class="show review" role="group" aria-labelledby="show-title">
      <div class="show-title" id="show-title" role="heading" aria-level="3">${show.replacing
        ? t("orbito-show-review-again", { name: show.replacing.name })
        : t("orbito-show-review")}</div>
      <p class="hint">${t("orbito-show-review-hint")}</p>
      <label class="show-label" for="review-name">${t("orbito-show-review-name")}</label>
      <input
        class="field review-name"
        id="review-name"
        type="text"
        autocomplete="off"
        .value=${skill.name}
        @input=${event => (skill.name = event.target.value)}
      />
      <label class="show-label" for="review-description">${t("orbito-show-review-description")}</label>
      <input
        class="field review-description"
        id="review-description"
        type="text"
        autocomplete="off"
        .value=${skill.description}
        @input=${event => (skill.description = event.target.value)}
      />
      ${skill.inputs.length
        ? html`<div class="review-section" role="group" aria-labelledby="review-inputs-title" aria-describedby="review-inputs-hint">
            <div class="review-heading" id="review-inputs-title" role="heading" aria-level="4">${t("orbito-show-review-inputs")}</div>
            <p class="hint" id="review-inputs-hint">${t("orbito-show-review-inputs-hint")}</p>
            <ul class="review-inputs">${skill.inputs.map(input => this.#renderReviewInput(input))}</ul>
          </div>`
        : nothing}
      <div class="review-section" role="group" aria-labelledby="review-steps-title" aria-describedby="review-steps-hint">
        <div class="review-heading" id="review-steps-title" role="heading" aria-level="4">${t("orbito-show-steps")}</div>
        <p class="hint" id="review-steps-hint">${t("orbito-show-review-steps-hint")}</p>
        <ol class="review-steps">${repeat(
          skill.steps,
          step => step,
          (step, i) => this.#renderReviewStep(step, i, count)
        )}</ol>
      </div>
      <p class="show-error" role="alert" ?hidden=${!review.saveError}>${review.saveError}</p>
      <div class="show-actions review-actions">
        <button class="secondary show-cancel" @click=${() => show.cancel()}>${t("orbito-show-discard")}</button>
        <button class="secondary show-rerecord" @click=${() => show.rerecord()}>${t("orbito-show-rerecord")}</button>
        <button class="primary show-save" ?disabled=${!canSave} @click=${() => show.save()}>${review.saving
          ? t("orbito-show-saving")
          : t("orbito-show-save")}</button>
      </div>
    </div>`;
  }

  /**
   * An input: its name, what it is, and "As input / Fixed value". A
   * personal value (an input candidate) made fixed is warned of: it is
   * saved in the skill, and the model sees it every time.
   */
  #renderReviewInput(input) {
    let id = `review-input-${input.name}`;
    let warningId = `review-input-warning-${input.name}`;
    let warned = !!input.kind && input.fixed;
    let radio = (fixed, label) => html`<button
      role="radio"
      data-value=${fixed ? "fixed" : "input"}
      aria-checked=${input.fixed == fixed ? "true" : "false"}
      aria-describedby=${fixed && warned ? warningId : nothing}
      tabindex=${input.fixed == fixed ? "0" : "-1"}
      ?disabled=${fixed && !input.value}
      @click=${() => this.#setFixed(input, fixed)}
    >${label}</button>`;
    return html`<li class="review-input" data-name=${input.name}>
      <div class="input-head" id=${id}>
        <code class="input-name">{${input.name}}</code>
        <span class="input-description">${input.description}</span>
      </div>
      <div
        class="segments"
        role="radiogroup"
        aria-labelledby=${id}
        @keydown=${event => this.#onModeKey(event, input)}
      >${radio(false, t("orbito-show-review-as-input"))}${radio(true, t("orbito-show-review-as-fixed"))}</div>
      ${input.value
        ? html`<p class="input-value">${input.fixed
            ? t("orbito-show-review-fixed-value", { value: input.value })
            : t("orbito-show-review-demo-value", { value: input.value })}</p>`
        : nothing}
      ${input.kind
        ? html`<p class="input-warning" id=${warningId} aria-live="polite">${warned
            ? t("orbito-show-review-personal-warning")
            : nothing}</p>`
        : nothing}
    </li>`;
  }

  /**
   * A step: its words to edit (a step the user enters themselves marked
   * so), and Move up, Move down and Delete.
   */
  #renderReviewStep(step, i, count) {
    let n = i + 1;
    return html`<li class="review-step" ?data-direct=${step.direct}>
      <span class="step-number" aria-hidden="true">${n}.</span>
      <div class="step-body">
        <input
          class="field step-text"
          type="text"
          autocomplete="off"
          aria-label=${t("orbito-show-review-step", { n })}
          aria-describedby=${step.direct ? `step-direct-${n}` : nothing}
          .value=${step.text}
          @input=${event => {
            step.text = event.target.value;
            this.requestUpdate();
          }}
          @keydown=${event => this.#onStepKey(event, i)}
        />
        ${step.direct
          ? html`<span class="step-direct" id=${`step-direct-${n}`}>${t("orbito-show-review-user-enters")}</span>`
          : nothing}
      </div>
      <div class="step-actions">
        <button
          class="icon step-up"
          aria-label=${t("orbito-show-review-step-up", { n })}
          title=${t("orbito-show-review-step-up", { n })}
          ?disabled=${i == 0}
          @click=${() => this.#moveStep(i, -1, "up")}
        >${ICONS.arrowUp}</button>
        <button
          class="icon step-down"
          aria-label=${t("orbito-show-review-step-down", { n })}
          title=${t("orbito-show-review-step-down", { n })}
          ?disabled=${i == count - 1}
          @click=${() => this.#moveStep(i, 1, "down")}
        >${ICONS.arrowDown}</button>
        <button
          class="icon step-delete"
          aria-label=${t("orbito-show-review-step-delete", { n })}
          title=${t("orbito-show-review-step-delete", { n })}
          @click=${() => this.#deleteStep(i)}
        >${ICONS.trash}</button>
      </div>
    </li>`;
  }

  #renderShow(state) {
    switch (state) {
      case "goal":
        return this.#renderShowGoal();
      case "recording":
        return this.#renderShowRecording();
      default:
        return this.#renderShowStopped();
    }
  }

  /** The ＋ menu by the input: what else to do from here. */
  #renderPlusMenu() {
    return html`<div
      class="menu plus-menu"
      id="plus-menu"
      role="menu"
      aria-label=${t("orbito-assistant-plus")}
      data-menu="plus"
      ?hidden=${this.menu != "plus"}
      @keydown=${this.#onMenuKey}
    >
      <button
        class="item"
        role="menuitem"
        data-command="show"
        tabindex="-1"
        @click=${() => this.#runCommand(() => this.#show?.begin())}
      >
        <span class="grow">${t("orbito-show")}<span class="sub">${t("orbito-show-description")}</span></span>
      </button>
    </div>`;
  }

  #renderEmpty() {
    return html`<div class="empty">
      <div class="empty-mark">${ORBITO_LOGO}</div>
      <p>${t("orbito-assistant-empty")}</p>
      <div class="starters">
        ${STARTERS.map(
          ([label, prompt]) =>
            html`<button @click=${() => this.submit(prompt)}>${label}</button>`
        )}
      </div>
    </div>`;
  }

  #renderLog() {
    if (!this.messages.length) {
      return this.#renderEmpty();
    }
    let running = this.#running;
    let last = this.messages.length - 1;
    let draft = this.#draft;
    return html`${repeat(
      this.messages,
      message => message.id,
      (message, i) =>
        message.role == "user"
          ? this.#renderUserMessage(message)
          : this.#renderReply(message, running && i == last)
    )}${!running && !this.#isPrivate
      ? html`<div class="draft">
          <button class="link" ?disabled=${draft.busy} @click=${() => this.#draftSkill()}>${draft.busy ? t("orbito-assistant-drafting-skill") : DRAFT_LABEL}</button>
          <div class="draft-error" ?hidden=${!draft.error}>${draft.error}</div>
        </div>`
      : nothing}`;
  }

  // The steps of the skill the running reply is doing, pinned above the
  // input.
  #renderPinnedSteps() {
    let reply = this.#running ? this.messages.at(-1) : null;
    let part =
      reply?.role == "assistant" &&
      reply.parts.findLast(p => p.type == "skill_steps");
    return part ? this.#renderSkillSteps(part, true, true) : nothing;
  }

  #renderSessionMenu() {
    let open = this.menu == "session";
    return html`<div
      class="menu session-menu"
      id="session-menu"
      role="menu"
      aria-label=${t("orbito-assistant-session-settings")}
      data-menu="session"
      ?hidden=${!open}
      @keydown=${this.#onMenuKey}
    >
      <div class="section" id="context-label">${t("orbito-assistant-context")}</div>
      <div role="group" aria-labelledby="context-label">
        ${CONTEXTS.map(
          context => html`<button
            class="item"
            role="menuitemradio"
            aria-checked=${context.id == this.context}
            data-context=${context.id}
            tabindex="-1"
            @click=${() => this.#pickContext(context.id)}
          >
            <span class="grow">${context.label}</span>${ICONS.check}
          </button>`
        )}
      </div>
      <div class="sep" role="separator"></div>
      <button
        class="item"
        role="menuitem"
        data-command="settings"
        tabindex="-1"
        @click=${() => this.#runCommand(() => this.toggleSettings(true))}
      >
        <span class="grow">${t("orbito-assistant-backend-and-key")}</span>
      </button>
      <div class="sep" role="separator"></div>
      <button
        class="item"
        role="menuitem"
        data-command="new"
        tabindex="-1"
        @click=${() => this.#runCommand(() => this.newThread())}
      >
        <span class="grow">${t("orbito-assistant-start-thread")}</span>
      </button>
      <button
        class="item"
        role="menuitem"
        data-command="threads"
        tabindex="-1"
        @click=${() =>
          this.#runCommand(() =>
            this.showThreads({ focusVisible: this.#menuByKeyboard })
          )}
      >
        <span class="grow">${t("orbito-assistant-threads")}</span>
      </button>
    </div>`;
  }

  /**
   * What the Threads other than the one shown are doing, for the list
   * button's dot: "waiting" if one waits for an approval, "running" if one
   * works, else null.
   */
  #othersActivity() {
    let others = this.#core
      .activeThreads(window)
      .filter(thread => thread.id != this.threadId);
    if (others.some(thread => thread.waiting)) {
      return "waiting";
    }
    return others.length ? "running" : null;
  }

  #renderThreadsButton() {
    let activity = this.#othersActivity();
    let label = t(
      {
        waiting: "orbito-assistant-threads-waiting",
        running: "orbito-assistant-threads-busy",
      }[activity] ?? "orbito-assistant-threads"
    );
    return html`<button
      class="icon threads-button"
      data-activity=${activity ?? nothing}
      aria-label=${label}
      title=${t("orbito-assistant-threads")}
      @click=${event => this.showThreads({ focusVisible: event.detail == 0 })}
    >
      ${ICONS.threads}${activity ? html`<i class="dot"></i>` : nothing}
    </button>`;
  }

  /**
   * The Thread list, in the Thread's place: New Thread, then the Threads
   * of the window's Space (or of every Space), last asked first, each with
   * what it is doing.
   */
  #renderThreads() {
    let core = this.#core;
    let all = this.threadScope == "all";
    let spaces = window.OrbitoShell?.spaces?.list ?? [];
    let roving = this.#rovingId();
    let row = (id, content, onClick, extra = {}) => html`<div
      role="listitem"
    >
      <button
        class=${`thread-row ${extra.className ?? ""}`}
        data-thread=${id === "" ? nothing : id}
        data-state=${extra.state ?? nothing}
        aria-current=${extra.current ? "true" : nothing}
        tabindex=${id == roving ? "0" : "-1"}
        @focus=${() => (this.#threadFocus = id)}
        @click=${onClick}
      >
        ${content}
      </button>
    </div>`;
    return html`<div
      class="threads-view"
      ?hidden=${this.view != "threads"}
      @keydown=${this.#onThreadsKey}
    >
      <div class="view-head">
        <button
          class="icon back"
          aria-label=${t("orbito-assistant-threads-back")}
          title=${t("orbito-assistant-threads-back-title")}
          @click=${event => this.showChat({ focusVisible: event.detail == 0 })}
        >
          ${ICONS.back}
        </button>
        <div class="view-title" role="heading" aria-level="2">${t("orbito-assistant-threads-heading")}</div>
        <div class="scope" role="group" aria-label=${t("orbito-assistant-threads-scope")}>
          ${THREAD_SCOPES.map(
            scope => html`<button
              aria-pressed=${scope.id == this.threadScope}
              @click=${() => (this.threadScope = scope.id)}
            >${scope.label}</button>`
          )}
        </div>
      </div>
      <div class="threads" role="list" aria-label=${t("orbito-assistant-threads")}>
        ${row(
          "",
          html`<span class="thread-icon">${ICONS.plus}</span
            ><span class="grow"><span class="thread-title">${t("orbito-assistant-start-thread")}</span></span>`,
          () => this.newThread(),
          { className: "new" }
        )}
        ${repeat(
          this.#threadList,
          thread => thread.id,
          thread => {
            let state = core.threadActivity(thread.id);
            let space = all && spaces.find(s => s.id == thread.space_id);
            let documents =
              thread.documents &&
              t("orbito-assistant-thread-documents", {
                count: thread.documents,
              });
            let sub = [ago(thread.updated_at), space?.name, documents]
              .filter(Boolean)
              .join(" · ");
            return row(
              thread.id,
              html`<span class="thread-icon">${thread.scheduled
                  ? html`${ICONS.clock}<span class="visually-hidden">${t("orbito-assistant-thread-scheduled")}, </span>`
                  : html`<span class="orbito-tile">${ORBITO_LOGO}</span>`}</span
                ><span class="grow"
                  ><span class="thread-title">${thread.title || t("orbito-assistant-new-thread")}</span
                  ><span class="thread-sub">${sub}</span></span
                >${state
                  ? html`<span class="state"></span><span class="visually-hidden">, ${t(
                        state == "waiting"
                          ? "orbito-assistant-thread-waiting"
                          : "orbito-assistant-thread-running"
                      )}</span>`
                  : nothing}`,
              () => this.#openListedThread(thread.id),
              { state, current: thread.id == this.threadId }
            );
          }
        )}
      </div>
      <div class="threads-foot">
        <button class="library" @click=${() => this.#openLibrary("threads")}>
          <span class="grow">${t("orbito-assistant-threads-library")}</span>${ICONS.forward}
        </button>
      </div>
    </div>`;
  }

  /** The header's button to the documents the Thread made, with how many. */
  #renderDocumentsButton() {
    let count = this.#documents.length;
    return html`<button
      class="icon documents-button"
      ?hidden=${!count}
      aria-label=${t("orbito-assistant-documents-button", { count })}
      title=${t("orbito-assistant-documents-heading")}
      @click=${event => this.showDocuments({ focusVisible: event.detail == 0 })}
    >
      ${ICONS.document}${count}
    </button>`;
  }

  /**
   * The documents the Thread made, newest first, in its place; each opens
   * in a tab. The Library lists every one.
   */
  #renderDocuments() {
    return html`<div
      class="documents-view"
      ?hidden=${this.view != "documents"}
      @keydown=${this.#onThreadsKey}
    >
      <div class="view-head">
        <button
          class="icon back"
          aria-label=${t("orbito-assistant-threads-back")}
          title=${t("orbito-assistant-threads-back-title")}
          @click=${event => this.showChat({ focusVisible: event.detail == 0 })}
        >
          ${ICONS.back}
        </button>
        <div class="view-title" role="heading" aria-level="2">${t("orbito-assistant-documents-heading")}</div>
      </div>
      <div class="threads" role="list" aria-label=${t("orbito-assistant-documents-heading")}>
        ${this.#documents.length
          ? repeat(
              this.#documents,
              doc => doc.id,
              doc => html`<div role="listitem">
                <button class="thread-row document-row" data-id=${doc.id} @click=${() => this.#openListed(doc.id)}>
                  <span class="thread-icon"><span class="orbito-tile">${ORBITO_LOGO}</span></span
                  ><span class="grow"
                    ><span class="thread-title">${doc.title}</span
                    ><span class="thread-sub">${ago(doc.updated_at)}</span></span
                  ><span class="thread-icon">${ICONS.forward}</span>
                </button>
              </div>`
            )
          : html`<p class="documents-empty">${t("orbito-assistant-documents-none")}</p>`}
      </div>
      <div class="threads-foot">
        <button class="library" @click=${() => this.#openLibrary("documents")}>
          <span class="grow">${t("orbito-assistant-threads-library")}</span>${ICONS.forward}
        </button>
      </div>
    </div>`;
  }

  /**
   * The backend's models, as it lists them, with the one picked first if it
   * does not; a search over them when there are many.
   */
  #renderModels() {
    let { backend, model: current } = this.#choice();
    let listed =
      (this.#catalog?.backend == backend && this.#catalog.models) || [];
    if (!listed.some(m => m.id == current)) {
      listed = [{ id: current, label: null, description: null }, ...listed];
    }
    let filter = this.#modelFilter.trim().toLowerCase();
    let shownModels = filter
      ? listed.filter(m =>
          `${m.id} ${m.label ?? ""}`.toLowerCase().includes(filter)
        )
      : listed;
    return html`${listed.length > MODEL_SEARCH_MIN
        ? html`<input
            class="model-search"
            type="search"
            placeholder=${t("orbito-assistant-model-search")}
            aria-label=${t("orbito-assistant-model-search")}
            .value=${this.#modelFilter}
            @input=${event => {
              this.#modelFilter = event.target.value;
              this.requestUpdate();
            }}
          />`
        : nothing}
      <div class="models" role="group" aria-labelledby="model-label">
        ${repeat(
          shownModels,
          // By id, so that focus stays on its model when the list comes.
          m => m.id,
          m => html`<button
            class="item"
            role="menuitemradio"
            aria-checked=${m.id == current}
            data-model=${m.id}
            title=${m.description ?? ""}
            tabindex="-1"
            @click=${() => this.#pickModel(m.id)}
          >
            <span class="grow"
              >${m.label ?? m.id}${m.label
                ? html`<span class="sub">${m.id}</span>`
                : nothing}</span
            >${ICONS.check}
          </button>`
        )}
      </div>`;
  }

  #renderModelMenu() {
    let core = this.#core;
    let open = this.menu == "model";
    let effort = this.effort;
    let choice = this.#choice();
    return html`<div
      class="menu model-menu"
      id="model-menu"
      role="menu"
      aria-label=${t("orbito-assistant-model-menu")}
      data-menu="model"
      ?hidden=${!open}
      @keydown=${this.#onMenuKey}
    >
      <div class="section" id="model-label">${t("orbito-assistant-model")}</div>
      ${this.#renderModels()}
      <div class="sep" role="separator"></div>
      <div class="section" id="backend-label">${t("orbito-assistant-backend")}</div>
      <div role="group" aria-labelledby="backend-label">
        ${Object.entries(core.BACKENDS).map(
          ([id, { label }]) => html`<button
            class="item"
            role="menuitemradio"
            aria-checked=${id == choice.backend}
            data-backend=${id}
            tabindex="-1"
            @click=${() => this.#pickBackend(id)}
          >
            <span class="grow"
              >${label}<span class="sub"
                >${id == choice.backend
                  ? this.#modelLabel(choice.model)
                  : core.model(id)}</span
              ></span
            >${ICONS.check}
          </button>`
        )}
      </div>
      ${!choice.kept && core.spaceBackend(this.#space()).backend
        ? html`<p class="note backend-note">${t("orbito-assistant-backend-space")}</p>`
        : nothing}
      <div class="sep" role="separator"></div>
      <div class="section" id="effort-label">${t("orbito-assistant-effort")}</div>
      <div class="efforts" role="group" aria-labelledby="effort-label">
        ${EFFORTS.map(
          e => html`<button
            class="effort"
            role="menuitemradio"
            aria-checked=${e.id == effort}
            data-effort=${e.id}
            tabindex="-1"
            @click=${() => (this.effort = e.id)}
          >${e.label}</button>`
        )}
      </div>
      <p class="note">${t("orbito-assistant-effort-note")}</p>
    </div>`;
  }

  #renderPermissionMenu(mode) {
    return html`<div
      class="menu permission-menu"
      id="permission-menu"
      role="menu"
      aria-label=${t("orbito-assistant-permission")}
      data-menu="permission"
      ?hidden=${this.menu != "permission"}
      @keydown=${this.#onMenuKey}
    >
      <div class="section">${t("orbito-assistant-permission")}</div>
      ${PERMISSION_MODES.map(
        m => html`<button
          class="item"
          role="menuitemradio"
          aria-checked=${m.id == mode}
          data-mode=${m.id}
          tabindex="-1"
          @click=${() => this.#pickPermissionMode(m.id)}
        >
          <span class="mode-icon" data-mode=${m.id}>${m.icon}</span>
          <span class="grow">${m.label}<span class="sub">${m.description}</span></span>${ICONS.check}
        </button>`
      )}
    </div>`;
  }

  /**
   * The context ring, filled with the share of the context window the next
   * question takes, and under it the details: the subscription's limits,
   * only when the backend gives them, and the context by part.
   */
  #renderUsage() {
    let usage = this.#usage ?? { total: 0, used: 0, free: 0, parts: [] };
    let percent = usage.total
      ? Math.min(100, Math.round((usage.used / usage.total) * 100))
      : 0;
    let tokens = n => n.toLocaleString();
    let open = this.menu == "usage";
    let context = CONTEXTS.find(c => c.id == this.context)?.label;
    let labels = {
      system: t("orbito-assistant-usage-system"),
      tools: t("orbito-assistant-usage-tools"),
      tabs: t("orbito-assistant-usage-tabs", { context }),
      history: t("orbito-assistant-usage-history"),
    };
    let limits = this.#limits;
    return html`<button
        class=${`usage ${percent >= USAGE_HOT ? "hot" : ""}`}
        data-menu="usage"
        data-percent=${percent}
        aria-haspopup="dialog"
        aria-controls="usage-menu"
        aria-expanded=${open}
        aria-label=${t("orbito-assistant-usage-label", { percent })}
        title=${t("orbito-assistant-usage-title", {
          percent,
          used: tokens(usage.used),
          total: tokens(usage.total),
        })}
        @click=${event => this.#toggleMenu("usage", event)}
      >
        <svg class="ring" viewBox="0 0 20 20" aria-hidden="true">
          <circle class="track" cx="10" cy="10" r=${RING_RADIUS} />
          <circle
            class="value"
            cx="10"
            cy="10"
            r=${RING_RADIUS}
            stroke-dasharray=${`${((percent / 100) * RING_LENGTH).toFixed(2)} ${RING_LENGTH}`}
          />
        </svg>
      </button>
      <div
        class="menu usage-menu"
        id="usage-menu"
        role="dialog"
        aria-labelledby="usage-context"
        data-menu="usage"
        tabindex="-1"
        ?hidden=${!open}
        @keydown=${this.#onMenuKey}
      >
        ${limits
          ? html`<div class="subscription">
              <div class="section" id="usage-subscription">
                ${limits.plan
                  ? t("orbito-assistant-subscription-plan", { plan: limits.plan })
                  : t("orbito-assistant-subscription")}
              </div>
              <ul class="limits" aria-labelledby="usage-subscription">
                ${limits.windows.map(
                  limit => html`<li class="limit">
                    <div class="line">
                      <span>${limit.label}</span><b>${Math.round(limit.percent)}%</b>
                    </div>
                    <div class="bar-track" aria-hidden="true">
                      <i style=${`width: ${Math.min(100, Math.max(0, limit.percent))}%`}></i>
                    </div>
                    ${limit.resetsAt
                      ? html`<span class="resets">${t("orbito-assistant-limit-resets", { date: new Date(limit.resetsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) })}</span>`
                      : nothing}
                  </li>`
                )}
              </ul>
              <div class="sep" role="separator"></div>
            </div>`
          : nothing}
        <div class="section" id="usage-context">
          ${t("orbito-assistant-usage-context", {
            used: tokens(usage.used),
            total: tokens(usage.total),
          })}
        </div>
        <div class="stack" aria-hidden="true">
          ${usage.parts.map(
            (part, i) => html`<i
              class=${`part-${i}`}
              style=${`width: ${usage.total ? (part.tokens / usage.total) * 100 : 0}%`}
            ></i>`
          )}
        </div>
        <ul class="legend" aria-labelledby="usage-context">
          ${usage.parts.map(
            (part, i) => html`<li data-part=${part.id} data-tokens=${part.tokens}>
              <i class=${`part-${i}`} aria-hidden="true"></i
              ><span>${labels[part.id]}</span><b>${tokens(part.tokens)}</b>
            </li>`
          )}
          <li data-part="free" data-tokens=${usage.free}>
            <i class="free" aria-hidden="true"></i
            ><span>${t("orbito-assistant-usage-free")}</span><b>${tokens(usage.free)}</b>
          </li>
        </ul>
        <p class="note">${t("orbito-assistant-usage-note")}</p>
      </div>`;
  }

  #renderSettings() {
    let core = this.#core;
    let settings = this.#settings;
    let config = core.BACKENDS[settings.backend] ?? {};
    let login = settings.login;
    return html`<form
      class="settings"
      ?hidden=${!settings.open}
      @submit=${this.#saveSettings}
    >
      <label for="settings-backend">${t("orbito-assistant-settings-backend")}</label>
      <select
        id="settings-backend"
        class="backend"
        @change=${event => this.#loadSettings(event.target.value)}
      >
        ${Object.entries(core.BACKENDS).map(
          ([value, { settingsLabel }]) =>
            html`<option value=${value}>${settingsLabel}</option>`
        )}
      </select>
      <label for="settings-auth" ?hidden=${settings.backend != "claude"}
        >${t("orbito-assistant-settings-auth")}</label
      >
      <select
        id="settings-auth"
        class="auth"
        ?hidden=${settings.backend != "claude"}
        @change=${event => this.#loadAuth(event.target.value)}
      >
        <option value="" ?hidden=${!!settings.auth}>${t("orbito-assistant-auth-choose")}</option>
        <option value="apiKey">${t("orbito-assistant-auth-api-key")}</option>
        <option value="claudeAccount">${t("orbito-assistant-auth-claude-account")}</option>
      </select>
      <label for="settings-key" ?hidden=${login}>${config.keyLabel ?? ""}</label>
      <input
        id="settings-key"
        class="key"
        type="password"
        autocomplete="off"
        placeholder=${config.keyPlaceholder ?? ""}
        ?hidden=${login}
      />
      <div class="login" ?hidden=${!login}>
        <p class="login-status">${settings.status}</p>
        <button
          type="button"
          class="secondary"
          @click=${() => this.#openSettingsPage()}
        >${t("orbito-assistant-open-settings-page")}</button>
      </div>
      <label for="settings-model">${t("orbito-assistant-model")}</label>
      <input
        id="settings-model"
        class="model-id"
        type="text"
        list="settings-models"
      />
      <datalist id="settings-models">
        ${settings.models.map(
          m => html`<option value=${m.id}>${m.label ?? ""}</option>`
        )}
      </datalist>
      <label for="settings-base" ?hidden=${settings.backend != "openai"}
        >${t("orbito-assistant-settings-base")}</label
      >
      <input
        id="settings-base"
        class="base"
        type="text"
        ?hidden=${settings.backend != "openai"}
      />
      <p class="hint" ?hidden=${login}>${t("orbito-assistant-settings-key-hint")}</p>
      <p class="hint" ?hidden=${settings.backend != "claude"}>${t("orbito-assistant-settings-claude-hint")}</p>
      <div class="settings-actions">
        <button type="button" class="link" @click=${() => this.#openSettingsPage()}>${t("orbito-assistant-settings-all")}</button>
        <button type="button" class="secondary" @click=${() => this.toggleSettings(false)}>${t("orbito-assistant-settings-cancel")}</button>
        <button type="submit" class="primary">${t("orbito-assistant-settings-save")}</button>
      </div>
    </form>`;
  }

  render() {
    let core = this.#core;
    let permission = PERMISSION_MODES.find(
      m => m.id == core.permissionMode(window)
    );
    let running = this.#running;
    let title = this.#threadTitle();
    let effort = EFFORTS.find(e => e.id == this.effort);
    let model = this.#modelLabel(this.#choice().model);
    let show = this.#showState;
    let skills = show ? [] : this.#skills;
    let ready = this.#hasText && !show;
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/orbito/shell/orbito-assistant-panel.css"
      />
      <div class="window-bar" part="window-bar">
        <slot name="window-controls"></slot>
      </div>
      <div class="head">
        ${this.#renderThreadsButton()}
        <div class="title" role="heading" aria-level="2" title=${title}>${title}</div>
        ${this.#renderDocumentsButton()}
        <div class="anchor">
          <button
            class="icon session"
            data-menu="session"
            aria-label=${t("orbito-assistant-session-settings")}
            title=${t("orbito-assistant-session-settings")}
            aria-haspopup="menu"
            aria-controls="session-menu"
            aria-expanded=${this.menu == "session"}
            @click=${event => this.#toggleMenu("session", event)}
          >
            ${ICONS.sliders}
          </button>
          ${this.#renderSessionMenu()}
        </div>
      </div>
      ${this.#renderThreads()}
      ${this.#renderDocuments()}
      ${this.#renderSettings()}
      ${show
        ? this.#renderShow(show)
        : html`<div
            class="log"
            tabindex="-1"
            aria-label=${t("orbito-assistant-log")}
            aria-live="polite"
            @scroll=${this.#onLogScroll}
            @wheel=${this.#onLogScroll}
          >${this.#renderLog()}</div>`}
      ${show ? nothing : this.#renderPinnedSteps()}
      <div class="chips" ?hidden=${show || !this.#chips.length}>
        ${this.#chips.map(chip => {
          let tab = this.#chipsTab;
          return html`<div class="chip" data-id=${chip.id}>
            <button
              title=${`/${chip.skill}`}
              @click=${() => {
                // Done with it on this page, like a dismissed one.
                this.#dismiss(tab, chip);
                this.submit(`/${chip.skill}`);
              }}
            >${chip.label}</button>
            <button
              class="chip-dismiss"
              title=${t("orbito-assistant-chip-dismiss")}
              aria-label=${t("orbito-assistant-chip-dismiss-label", {
                label: chip.label,
              })}
              @click=${() => this.#dismiss(tab, chip)}
            >×</button>
          </div>`;
        })}
      </div>
      <div
        class="skill-menu"
        id="skill-menu"
        role="listbox"
        aria-label=${t("orbito-assistant-skills")}
        ?hidden=${!skills.length}
      >
        ${skills.map(
          (skill, i) => html`<div
            class="skill-option"
            id=${`skill-${i}`}
            role="option"
            aria-selected=${i == this.#skillIndex}
            data-name=${skill.name}
            @mousedown=${event => {
              // Before the input's blur hides the menu.
              event.preventDefault();
              this.#pickSkill(skill.name);
            }}
          >
            <span class="skill-name">/${skill.name}</span>
            <span class="skill-description">${skill.description}</span>
          </div>`
        )}
      </div>
      <div class="input-notice" role="status" ?hidden=${!this.#notice}>${this.#notice}</div>
      <div class=${`composer ${permission.id == "bypass" ? "bypass" : ""}`}>
        <textarea
          rows="1"
          ?disabled=${!!show}
          placeholder=${show
            ? t("orbito-show-input-blocked")
            : t("orbito-assistant-input-placeholder")}
          aria-label=${t("orbito-assistant-input")}
          aria-autocomplete="list"
          aria-controls="skill-menu"
          aria-expanded=${!!skills.length}
          aria-activedescendant=${skills.length
            ? `skill-${this.#skillIndex}`
            : nothing}
          @keydown=${this.#onInputKey}
          @input=${this.#onInput}
          @blur=${() => this.#showSkills([])}
        ></textarea>
        <div class="bar">
          <div class="anchor">
            <button
              class="plus"
              data-menu="plus"
              aria-haspopup="menu"
              aria-controls="plus-menu"
              aria-expanded=${this.menu == "plus"}
              aria-label=${t("orbito-assistant-plus")}
              title=${t("orbito-assistant-plus")}
              ?disabled=${!!show}
              @click=${event => this.#toggleMenu("plus", event)}
            >
              ${ICONS.plus}
            </button>
            ${this.#renderPlusMenu()}
          </div>
          <div class="anchor">
            <button
              class="model"
              data-menu="model"
              aria-haspopup="menu"
              aria-controls="model-menu"
              aria-expanded=${this.menu == "model"}
              aria-label=${t("orbito-assistant-model-button", {
                model,
                effort: effort.label,
              })}
              title=${t("orbito-assistant-model-button-title")}
              @click=${event => this.#toggleMenu("model", event)}
            >
              <span class="model-name">${model}</span
              ><span class="effort-label">${effort.label}</span>${ICONS.chevron}
            </button>
            ${this.#renderModelMenu()}
          </div>
          <div class="anchor">
            <button
              class="permission"
              data-menu="permission"
              data-mode=${permission.id}
              aria-haspopup="menu"
              aria-controls="permission-menu"
              aria-expanded=${this.menu == "permission"}
              aria-label=${t("orbito-assistant-permission-button", {
                mode: permission.label,
              })}
              title=${t("orbito-assistant-permission-button", {
                mode: permission.label,
              })}
              @click=${event => this.#toggleMenu("permission", event)}
            >
              ${permission.icon}
            </button>
            ${this.#renderPermissionMenu(permission.id)}
          </div>
          <span class="spacer"></span>
          ${this.#renderUsage()}
          <button
            class=${`send ${running ? "stop" : ready ? "ready" : ""}`}
            aria-label=${running ? t("orbito-assistant-stop") : t("orbito-assistant-send")}
            title=${running ? t("orbito-assistant-stop") : t("orbito-assistant-send")}
            ?disabled=${!running && !ready}
            @click=${this.#onSend}
          >
            ${running ? ICONS.stop : ICONS.arrowUp}
          </button>
        </div>
      </div>
      <div
        class="resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label=${t("orbito-assistant-resize")}
        aria-valuemin=${PANEL_WIDTH.min}
        aria-valuemax=${PANEL_WIDTH.max}
        aria-valuenow=${this.width}
        title=${t("orbito-assistant-resize-title")}
        tabindex="0"
        @mousedown=${event => event.preventDefault()}
        @pointerdown=${this.#onResizeStart}
        @pointermove=${this.#onResizeMove}
        @pointerup=${this.#onResizeEnd}
        @pointercancel=${this.#onResizeEnd}
        @lostpointercapture=${this.#onResizeEnd}
        @dblclick=${() => this.#saveWidth(PANEL_WIDTH.default)}
        @keydown=${this.#onResizeKey}
      ></div>
    `;
  }
}
customElements.define("orbito-assistant-panel", OrbitoAssistantPanel);
