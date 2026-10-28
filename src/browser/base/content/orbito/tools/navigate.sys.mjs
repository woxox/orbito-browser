/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { OrbitoPage } from "../OrbitoPage.sys.mjs";
import { parseURL } from "./open_tab.sys.mjs";

const ACTIONS = ["back", "forward", "reload"];

// Counts every entry, also those the user never interacted with, which
// browser.canGoBack skips (browser.navigation.requireUserInteraction).
function canGo(browser, by) {
  let history = browser.browsingContext?.sessionHistory;
  let index = history ? history.index + by : -1;
  return index >= 0 && index < history.count;
}

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

export default {
  name: "navigate",
  description:
    "Go to an http(s) URL in the same tab, or go back, forward or reload. Give either url or action. The user must approve each call.",
  schema: {
    type: "object",
    properties: {
      url: { type: "string", format: "uri" },
      action: { type: "string", enum: ACTIONS },
      tab_id: { type: "integer", description: "Tab id from list_tabs" },
    },
  },
  readOnly: false,

  label(ctx, input) {
    if (input.action == "back") {
      return t("orbito-assistant-tool-going-back");
    }
    if (input.action == "forward") {
      return t("orbito-assistant-tool-going-forward");
    }
    if (input.action == "reload") {
      return t("orbito-assistant-tool-reloading");
    }
    try {
      return t("orbito-assistant-tool-going-to", {
        host: parseURL(input.url).host,
      });
    } catch {
      return t("orbito-assistant-tool-going-to-page");
    }
  },

  approvalAction(ctx, input) {
    switch (input.action) {
      case "back":
        return t("orbito-assistant-tool-back-action");
      case "forward":
        return t("orbito-assistant-tool-forward-action");
      case "reload":
        return t("orbito-assistant-tool-reload-action");
    }
    return t("orbito-assistant-tool-go-to-action");
  },

  approvalText(ctx, input) {
    let tab = OrbitoPage.targetTab(ctx, input);
    let host = OrbitoPage.host(tab);
    if ((input.url == null) == (input.action == null)) {
      throw new Error("Give either url or action.");
    }
    switch (input.action) {
      case undefined:
        return t("orbito-assistant-tool-go-to-approval", {
          url: parseURL(input.url).spec,
        });
      case "back":
        if (!canGo(tab.linkedBrowser, -1)) {
          throw new Error("There is no page to go back to.");
        }
        return t("orbito-assistant-tool-back-approval", { host });
      case "forward":
        if (!canGo(tab.linkedBrowser, 1)) {
          throw new Error("There is no page to go forward to.");
        }
        return t("orbito-assistant-tool-forward-approval", { host });
      case "reload":
        return t("orbito-assistant-tool-reload-approval", { host });
    }
    throw new Error(`action must be one of ${ACTIONS.join(", ")}.`);
  },

  async run(ctx, input) {
    let tab = OrbitoPage.targetTab(ctx, input);
    let browser = tab.linkedBrowser;
    let before = browser.browsingContext?.currentWindowGlobal;
    switch (input.action) {
      case "back":
        browser.goBack(false);
        break;
      case "forward":
        browser.goForward(false);
        break;
      case "reload":
        browser.reload();
        break;
      default:
        browser.loadURI(parseURL(input.url), {
          triggeringPrincipal:
            Services.scriptSecurityManager.createNullPrincipal({}),
        });
    }
    await OrbitoPage.settle(tab, before);
    return {
      content: `Now at ${browser.currentURI.spec} (“${browser.contentTitle}”). Call read_page to see it.`,
      page: OrbitoPage.source(ctx, tab),
    };
  },
};
