/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The tab group colors Firefox has (MozTabbrowserTabGroupMenu.COLORS).
const COLORS = [
  "blue",
  "purple",
  "cyan",
  "orange",
  "yellow",
  "pink",
  "green",
  "gray",
  "red",
];

/**
 * The tabs of the window with these ids from list_tabs.
 *
 * @returns {object[]}
 */
export function tabsOf(ctx, ids) {
  if (!Array.isArray(ids) || !ids.length) {
    throw new Error("Give the ids of the tabs, from list_tabs.");
  }
  return [...new Set(ids)].map(id => {
    let tab = ctx.tabById(id);
    if (!tab) {
      throw new Error(`There is no tab ${id} in this window.`);
    }
    return tab;
  });
}

/** “Title”, “Title” and 3 more, for approval questions. */
export function titlesOf(tabs) {
  let titles = tabs.slice(0, 5).map(t => `“${t.label}”`);
  if (tabs.length > 5) {
    titles.push(
      t("orbito-assistant-tool-more-tabs", { count: tabs.length - 5 })
    );
  }
  return titles.join(", ");
}

function groupOf(ctx, input) {
  if (input.group_id == null || input.group_id === "") {
    return null;
  }
  let group = ctx.window.gBrowser.getTabGroupById(String(input.group_id));
  // Only a group of the tabs the tools see.
  if (!group || !group.tabs.some(t => ctx.tabs.includes(t))) {
    throw new Error(`There is no tab group ${input.group_id} in this window.`);
  }
  return group;
}

function check(ctx, input) {
  let tabs = tabsOf(ctx, input.tab_ids);
  if (tabs.some(t => t.pinned)) {
    throw new Error("Pinned tabs cannot be grouped.");
  }
  let group = groupOf(ctx, input);
  let name = String(input.name ?? "").trim();
  if (!group && !name) {
    throw new Error("Give the new group a name.");
  }
  if (input.color != null && !COLORS.includes(input.color)) {
    throw new Error(`The color must be one of ${COLORS.join(", ")}.`);
  }
  return { tabs, group, name };
}

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

export default {
  name: "group_tabs",
  description:
    "Put tabs into a tab group: a new one with a name (and optionally a color), or an existing one by its group_id from list_tabs, which a name or color then renames or recolors. Pinned tabs cannot be grouped. The user must approve each call.",
  schema: {
    type: "object",
    properties: {
      tab_ids: {
        type: "array",
        items: { type: "integer" },
        description: "Tab ids from list_tabs",
      },
      name: { type: "string", description: "The group's name" },
      color: { type: "string", enum: COLORS },
      group_id: {
        type: "string",
        description: "An existing group's id from list_tabs",
      },
    },
    required: ["tab_ids"],
  },
  readOnly: false,
  autoAllow: true,

  label(ctx, input) {
    return input?.name
      ? t("orbito-assistant-tool-grouping-into", { name: input.name })
      : t("orbito-assistant-tool-grouping");
  },

  approvalAction() {
    return t("orbito-assistant-tool-group-action");
  },

  approvalText(ctx, input) {
    let { tabs, group, name } = check(ctx, input);
    return t("orbito-assistant-tool-group-approval", {
      titles: titlesOf(tabs),
      name: name || group.label,
    });
  },

  run(ctx, input) {
    let { tabs, group, name } = check(ctx, input);
    let { gBrowser } = ctx.window;
    if (group) {
      group.addTabs(tabs);
      if (name) {
        group.label = name;
      }
      if (input.color) {
        group.color = input.color;
      }
    } else {
      group = gBrowser.addTabGroup(tabs, {
        label: name,
        color: input.color || null,
        insertBefore: tabs[0],
      });
    }
    return `Tabs ${tabs.map(t => ctx.tabId(t)).join(", ")} are in group ${group.id} “${group.label}” (${group.color}).`;
  },
};
