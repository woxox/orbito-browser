/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { tabOf } from "./select_tab.sys.mjs";

function check(ctx, input) {
  let tab = tabOf(ctx, input.tab_id);
  // The question's work goes on in it.
  if (tab == ctx.tab) {
    throw new Error("The tab the user asked from cannot be closed.");
  }
  return tab;
}

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

export default {
  name: "close_tab",
  description:
    "Close a tab by its id from list_tabs; not the tab the user asked from. The user must approve each call.",
  schema: {
    type: "object",
    properties: {
      tab_id: { type: "integer", description: "Tab id from list_tabs" },
    },
    required: ["tab_id"],
  },
  readOnly: false,

  label() {
    return t("orbito-assistant-tool-closing-tab");
  },

  approvalAction() {
    return t("orbito-assistant-tool-close-tab-action");
  },

  approvalText(ctx, input) {
    return t("orbito-assistant-tool-close-tab-approval", {
      title: check(ctx, input).label,
    });
  },

  run(ctx, input) {
    let tab = check(ctx, input);
    let id = ctx.tabId(tab);
    let title = tab.label;
    ctx.window.gBrowser.removeTab(tab);
    return `Closed tab ${id} “${title}”.`;
  },
};
