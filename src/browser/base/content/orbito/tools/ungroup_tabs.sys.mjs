/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { tabsOf, titlesOf } from "./group_tabs.sys.mjs";

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

export default {
  name: "ungroup_tabs",
  description:
    "Take tabs out of their tab groups; the tabs stay open. The user must approve each call.",
  schema: {
    type: "object",
    properties: {
      tab_ids: {
        type: "array",
        items: { type: "integer" },
        description: "Tab ids from list_tabs",
      },
    },
    required: ["tab_ids"],
  },
  readOnly: false,
  autoAllow: true,

  label() {
    return t("orbito-assistant-tool-ungrouping");
  },

  approvalAction() {
    return t("orbito-assistant-tool-ungroup-action");
  },

  approvalText(ctx, input) {
    let tabs = tabsOf(ctx, input.tab_ids);
    return t("orbito-assistant-tool-ungroup-approval", {
      titles: titlesOf(tabs),
      count: tabs.length,
    });
  },

  run(ctx, input) {
    let tabs = tabsOf(ctx, input.tab_ids);
    let grouped = tabs.filter(t => t.group);
    for (let tab of grouped) {
      ctx.window.gBrowser.ungroupTab(tab);
    }
    let ids = grouped.map(t => ctx.tabId(t));
    return ids.length
      ? `Took tabs ${ids.join(", ")} out of their groups.`
      : "None of those tabs were in a group.";
  },
};
