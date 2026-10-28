/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The tab of the window with this id from list_tabs.
 *
 * @returns {Element}
 */
export function tabOf(ctx, id) {
  if (id == null || id === "") {
    throw new Error("Give the id of the tab, from list_tabs.");
  }
  let tab = ctx.tabById(id);
  if (!tab) {
    throw new Error(`There is no tab ${id} in this window.`);
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
  name: "select_tab",
  description:
    "Switch the window to a tab by its id from list_tabs, so the user sees it. Other tools still act on the tab their tab_id names. The user must approve each call.",
  schema: {
    type: "object",
    properties: {
      tab_id: { type: "integer", description: "Tab id from list_tabs" },
    },
    required: ["tab_id"],
  },
  readOnly: false,
  autoAllow: true,

  label() {
    return t("orbito-assistant-tool-switching-tab");
  },

  approvalAction() {
    return t("orbito-assistant-tool-select-tab-action");
  },

  approvalText(ctx, input) {
    return t("orbito-assistant-tool-select-tab-approval", {
      title: tabOf(ctx, input.tab_id).label,
    });
  },

  run(ctx, input) {
    let tab = tabOf(ctx, input.tab_id);
    ctx.window.gBrowser.selectedTab = tab;
    return `Switched to tab ${ctx.tabId(tab)} “${tab.label}”.`;
  },
};
