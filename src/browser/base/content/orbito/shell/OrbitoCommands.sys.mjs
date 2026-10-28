/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Command bar's commands: urlbar results that open an Orbito screen
 * rather than a page ("Settings", "History"), or start Show Orbito. They
 * come up when the typed text starts one of a command's words, right below
 * the heuristic result, so Enter still goes where the text says unless a
 * command is picked.
 *
 * Registered at runtime, like OrbitoUrlbarProvider.sys.mjs, so that
 * Firefox's files stay unpatched. Firefox's own "Manage settings" quick
 * action opens about:preferences, which Orbito only reaches from its own
 * settings (ADR 0001), so it is turned off here.
 */

import { UrlbarProvider } from "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ActionsProviderQuickActions:
    "moz-src:///browser/components/urlbar/ActionsProviderQuickActions.sys.mjs",
  OrbitoPages: "chrome://browser/content/orbito/OrbitoPages.sys.mjs",
  ProvidersManager:
    "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs",
  QuickActionsLoaderDefault:
    "moz-src:///browser/components/urlbar/QuickActionsLoaderDefault.sys.mjs",
  UrlbarResult: "chrome://browser/content/urlbar/UrlbarResult.mjs",
  UrlbarShared: "chrome://browser/content/urlbar/UrlbarShared.mjs",
});

const DYNAMIC_TYPE = "orbitoCommand";

/**
 * The commands, in the order they are listed. `words` are what the typed
 * text is matched against, `run` does the command in a browser window.
 */
const COMMANDS = [
  {
    name: "settings",
    title: t("orbito-commands-settings"),
    description: "about:orbito-settings",
    icon: "chrome://global/skin/icons/settings.svg",
    words: [
      "settings",
      "preferences",
      "options",
      "appearance",
      "theme",
      "accent",
      "설정",
      "환경",
      "테마",
    ],
    run: win => lazy.OrbitoPages.openSettings(win),
  },
  {
    // The pages the user read, by day (Browsing recall's timeline).
    name: "history",
    title: t("orbito-commands-history"),
    description: t("orbito-commands-history-description"),
    icon: "chrome://browser/skin/history.svg",
    words: ["history", "timeline", "기록", "방문 기록", "타임라인"],
    run: win => lazy.OrbitoPages.openTimeline(win),
  },
  {
    // Starts a demo in the window (shell/show-orbito.mjs).
    name: "show",
    title: t("orbito-commands-show"),
    description: t("orbito-commands-show-description"),
    icon: "chrome://browser/skin/notification-icons/screen.svg",
    // 녹화 is what users search for, though the UI never says it (GLOSSARY).
    words: ["show orbito", "demo", "record", "teach", "시연", "녹화", "가르치기"],
    run: win => win.OrbitoShell?.show.begin(),
  },
];

/** The commands the typed text asks for. */
function commandsFor(text) {
  let query = text.trim().toLowerCase();
  if (query.length < 2) {
    return [];
  }
  return COMMANDS.filter(command =>
    command.words.some(word => word.startsWith(query))
  );
}

const VIEW_TEMPLATE = {
  attributes: { selectable: true },
  children: [
    {
      name: "no-wrap",
      tag: "span",
      classList: ["urlbarView-no-wrap"],
      children: [
        {
          name: "icon",
          tag: "img",
          classList: ["urlbarView-favicon"],
        },
        {
          name: "text-container",
          tag: "span",
          children: [
            {
              name: "title",
              tag: "span",
              classList: ["urlbarView-title"],
            },
            {
              name: "title-separator",
              tag: "span",
              classList: ["urlbarView-title-separator"],
            },
            {
              name: "action",
              tag: "span",
              classList: ["urlbarView-action"],
            },
          ],
        },
      ],
    },
  ],
};

class OrbitoCommandsProvider extends UrlbarProvider {
  get name() {
    return "OrbitoCommands";
  }

  get type() {
    return lazy.UrlbarShared.PROVIDER_TYPE.PROFILE;
  }

  async isActive(queryContext) {
    return (
      !queryContext.searchMode &&
      !queryContext.restrictSource &&
      !!commandsFor(queryContext.searchString).length
    );
  }

  async startQuery(queryContext, addCallback) {
    commandsFor(queryContext.searchString).forEach((command, i) => {
      addCallback(
        this,
        new lazy.UrlbarResult({
          type: lazy.UrlbarShared.RESULT_TYPE.DYNAMIC,
          source: lazy.UrlbarShared.RESULT_SOURCE.OTHER_LOCAL,
          suggestedIndex: 1 + i,
          payload: {
            dynamicType: DYNAMIC_TYPE,
            // What the urlbar shows while the result is selected.
            input: queryContext.searchString,
            command: command.name,
          },
        })
      );
    });
  }

  getViewTemplate() {
    return VIEW_TEMPLATE;
  }

  getViewUpdate(result) {
    let command = COMMANDS.find(c => c.name == result.payload.command);
    return {
      icon: { attributes: { src: command.icon } },
      title: { textContent: command.title },
      action: { textContent: command.description },
    };
  }

  onEngagement(queryContext, controller, details) {
    let win = controller.browserWindow;
    COMMANDS.find(c => c.name == details.result.payload.command).run(win);
    win.OrbitoShell?.commandBar.close({ restoreFocus: false });
  }
}

let registered = false;

/** Adds the commands to the urlbar. Safe to call from every window. */
export function registerCommands() {
  if (registered) {
    return;
  }
  registered = true;
  lazy.ProvidersManager.getInstanceForSap("urlbar").registerProvider(
    new OrbitoCommandsProvider()
  );
  lazy.QuickActionsLoaderDefault.ensureLoaded().then(() => {
    let action = lazy.ActionsProviderQuickActions.getAction("settings");
    if (action) {
      action.isUnsupported = () => true;
    }
  });
}
