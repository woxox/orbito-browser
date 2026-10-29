/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Orbito defaults, included at the end of firefox.js so these win.

pref("sidebar.verticalTabs", true);
pref("sidebar.visibility", "always-show");
pref("sidebar.main.tools", "history,bookmarks");
pref("sidebar.verticalTabs.dragToPinPromo.dismissed", true);

pref("browser.toolbars.bookmarks.visibility", "never");

// The user agent says "Firefox/<version>" before "Orbito/<version>": sites
// that sniff for it (Google) serve their old, basic pages otherwise.
pref("general.useragent.compatMode.firefox", true);

// The Shell's Sidebar: its width in px (the handle keeps it within 200 to
// 360) and whether it is collapsed, for every window.
pref("orbito.sidebar.width", 244);
pref("orbito.sidebar.collapsed", false);

// Whether a new window opens with the Assistant panel open (Orbito's
// settings, Layout).
pref("orbito.assistant.autoOpen", false);

// Orbito's look (shell/OrbitoAppearance.sys.mjs), picked in its settings:
// "system", "light" or "dark", and the accent (violet, blue, green, coral,
// graphite), for every window and Orbito page.
pref("orbito.appearance.theme", "system");
pref("orbito.appearance.accent", "violet");

// Orbito's language, picked in its settings (OrbitoL10n.sys.mjs), brings
// Firefox's langpack for it, as Firefox's own language settings do; dev
// builds have those off. The language changes on a restart only: the
// Shell's strings don't swap live like Firefox's.
pref("intl.multilingual.enabled", true);
pref("intl.multilingual.downloadEnabled", true);
pref("intl.multilingual.liveReload", false);
// Langpacks are made for a Firefox version, which is Orbito's platform
// version: %VERSION% is Orbito's own (0.1.0), which AMO has none for.
pref("extensions.getAddons.langpacks.url", "https://services.addons.mozilla.org/api/v4/addons/language-tools/?app=firefox&type=language&appversion=%PLATFORMVERSION%");

// Firefox themes are not used (ADR 0001): the default theme stays the active
// one. OrbitoAppearance.init keeps the other themes out (add-ons' and the
// built-in ones), so this is what Firefox records and starts with. Firefox's
// color scheme comes from orbito.appearance.theme instead (OrbitoAppearance
// sets and locks
// browser.theme.toolbar-theme and content-theme), and pages follow it: their
// own override, "Website appearance" in Firefox's settings (hidden), stays on
// the browser's.
pref("extensions.activeThemeID", "default-theme@mozilla.org", locked);
pref("layout.css.prefers-color-scheme.content-override", 2, locked);

// Private windows are the same Shell on a frame of their own (orbito.css),
// in the light or dark picked in Orbito's settings: not Firefox's dark
// private-window theme.
pref("browser.theme.dark-private-windows", false);

// Pins (shell/pins.mjs) load only once their tab is selected, also when
// Session Restore brings them back.
pref("browser.sessionstore.restore_pinned_tabs_on_demand", true);

// Firefox features Orbito does not have (the Shell blocks the rest, see
// shell/removed-features.mjs): the account button, the stories and sponsored
// content once from Pocket on the new tab page, and add-on and feature
// recommendations. Sync stays.
pref("identity.fxaccounts.toolbar.enabled", false);
pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
pref("browser.newtabpage.activity-stream.showSponsored", false);
pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons", false);
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features", false);
pref("browser.discovery.enabled", false);
pref("extensions.htmlaboutaddons.recommendations.enabled", false);
pref("extensions.getAddons.showPane", false);
pref("browser.compactmode.show", true);

// about:newtab and about:home are Orbito's new tab page (OrbitoPages.sys.mjs),
// a page of the parent process: no preloaded new tab browser (made for
// Firefox's page in its own process), no cached about:home either.
pref("browser.newtab.preload", false);
pref("browser.startup.homepage.abouthome_cache.enabled", false);

// Grouping by dropping a tab onto another needs a deliberate hold, so a quick
// reorder drag never creates a group by accident.
pref("browser.tabs.dragDrop.createGroup.enabled", true);
pref("browser.tabs.dragDrop.createGroup.delayMS", 500);

// Firefox's own AI features are all off; the Orbito assistant is the only AI
// in the browser. Same shape as the AIControls enterprise policy: the AI
// Controls state per feature plus the feature prefs it gates, locked so the
// settings UI and about:config cannot turn them back on.
pref("browser.ai.control.default", "blocked", locked);
pref("browser.ai.control.translations", "blocked", locked);
pref("browser.ai.control.pdfjsAltText", "blocked", locked);
pref("browser.ai.control.smartTabGroups", "blocked", locked);
pref("browser.ai.control.linkPreviewKeyPoints", "blocked", locked);
pref("browser.ai.control.sidebarChatbot", "blocked", locked);
pref("browser.ai.control.smartWindow", "blocked", locked);
pref("browser.ai.control.speechRecognition", "blocked", locked);

// Firefox's ML engine runs Browsing recall's embedding model
// (OrbitoEmbedder.sys.mjs), shipped with the app; Firefox's features that use
// it stay off by their own prefs here.
pref("browser.ml.enable", true, locked);
pref("extensions.ml.enabled", false, locked);
pref("browser.ml.chat.enabled", false, locked);
pref("browser.ml.chat.page", false, locked);
pref("browser.ml.chat.menu", false, locked);
pref("browser.ml.chat.shortcuts", false, locked);
pref("browser.ml.chat.sidebar", false, locked);
pref("browser.ml.linkPreview.enabled", false, locked);
pref("browser.ml.pageAssist.enabled", false, locked);
pref("browser.smartwindow.enabled", false, locked);
pref("browser.tabs.groups.smart.enabled", false, locked);
pref("browser.tabs.groups.smart.userEnabled", false, locked);
pref("browser.translations.enable", false, locked);
pref("pdfjs.enableAltText", false, locked);
pref("pdfjs.enableGuessAltText", false, locked);
pref("pdfjs.enableAltTextModelDownload", false, locked);
pref("places.semanticHistory.featureGate", false, locked);
pref("browser.urlbar.quicksuggest.mlEnabled", false, locked);

pref("orbito.assistant.baseURL", "https://api.openai.com/v1");
pref("orbito.assistant.model", "gpt-5-mini");

// "openai" talks to orbito.assistant.baseURL directly; "claude" (formerly
// "agent") runs the Claude Code CLI shipped in orbito-agent/ (ClaudeCLI.sys.mjs);
// "chatgpt" uses a ChatGPT subscription through the Responses API.
pref("orbito.assistant.backend", "openai");
// Tool calls the assistant may make per question; think does not count.
// 0 means no limit.
pref("orbito.assistant.maxToolTurns", 0);
// The PermissionMode new windows start with: "ask" (tools that are not
// read-only ask first), "auto" (scrolling and grouping tabs run without
// asking too) or "bypass" (nothing asks). Each window
// has its own in the panel.
pref("orbito.assistant.permissionMode", "ask");
// Whether the urlbar offers "Ask Orbito" for what is typed into it. The
// panel works either way.
pref("orbito.assistant.urlbar", true);
// Whether the assistant remembers facts the user asks it to. Private
// windows never read or write memories.
pref("orbito.assistant.memory.enabled", true);
// Characters of memories put in the system prompt, most recently used
// first; the model finds the rest with the recall tool.
pref("orbito.assistant.memory.promptCharBudget", 8000);
// The built-in skills the user turned off, as a JSON array of names.
pref("orbito.assistant.skills.disabled", "[]");
// The user's skills that are off, as a JSON array of their folders' names.
pref("orbito.assistant.skills.userDisabled", "[]");
// Chips above the panel's input offering the built-in skills that may help
// with the page (summarize, translate, compare). Never in private windows.
pref("orbito.assistant.suggestions.enabled", true);
// Runs of scheduled tasks a day, all tasks together, Run now included; the
// runs over it are kept as skipped.
pref("orbito.assistant.tasks.maxRunsPerDay", 24);
// MCP servers added in settings, as JSON (see OrbitoMCP.sys.mjs), and how
// long one MCP tool call may take.
pref("orbito.mcp.servers", "[]");
pref("orbito.mcp.callTimeoutSeconds", 60);
// The ChatGPT backend (Sign in with ChatGPT, Responses API). The URLs can be
// pointed at a mock server for tests.
pref("orbito.chatgpt.model", "gpt-6.1-sol");
pref("orbito.chatgpt.baseURL", "https://api.openai.com/v1");
pref("orbito.chatgpt.authorizeURL", "https://auth.openai.com/api/accounts/authorize");
pref("orbito.chatgpt.tokenURL", "https://auth.openai.com/api/accounts/oauth/token");
pref("orbito.agent.model", "claude-sonnet-5-5");
// Empty means: the CLI shipped in orbito-agent/ next to the binary.
pref("orbito.agent.claude", "");
// Overrides the Anthropic API base URL, e.g. for a proxy or a mock server;
// with an API key only, never for a Claude account.
pref("orbito.agent.baseURL", "");
// How the Claude backend authenticates: "apiKey", "claudeAccount" (the
// Claude Code CLI's own login, ClaudeAccount in ClaudeCLI.sys.mjs) or "cloud"
// (orbito.agent.cloud). Empty until the user chooses, or has a Claude API key
// saved.
pref("orbito.agent.auth", "");
// The cloud provider "cloud" uses, as JSON {provider, region, project,
// profile, resource}; provider is a key of CLAUDE_CLOUDS in ClaudeCLI.sys.mjs.
pref("orbito.agent.cloud", "");

// Browsing recall (OrbitoRecall.sys.mjs): whether the pages the user reads
// are remembered (off pauses it), and days they are kept after their last
// visit, 0 for ever.
pref("orbito.recall.enabled", true);
pref("orbito.recall.retentionDays", 180);
// Seconds a page's tab is looked at before the page counts as read without
// scrolling it.
pref("orbito.recall.dwellSeconds", 10);
// Domains whose pages are never remembered (and their subdomains), as a JSON
// array: mail, banks, payments and account pages.
pref("orbito.recall.excludedDomains", "[\"mail.google.com\",\"accounts.google.com\",\"outlook.live.com\",\"outlook.office.com\",\"mail.yahoo.com\",\"mail.proton.me\",\"icloud.com\",\"mail.naver.com\",\"nid.naver.com\",\"mail.daum.net\",\"accounts.kakao.com\",\"paypal.com\",\"stripe.com\",\"toss.im\",\"kbstar.com\",\"shinhan.com\",\"wooribank.com\",\"kebhana.com\",\"ibk.co.kr\",\"nonghyup.com\",\"kakaobank.com\",\"chase.com\",\"bankofamerica.com\",\"wellsfargo.com\",\"citi.com\"]");
