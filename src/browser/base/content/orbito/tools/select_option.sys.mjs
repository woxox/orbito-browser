/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { OrbitoPage } from "../OrbitoPage.sys.mjs";

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

export default {
  name: "select_option",
  description:
    "Choose options of a <select> on a page, by its ref from read_page and the options' values or labels. The user must approve each call.",
  schema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Element ref from read_page" },
      values: {
        type: "array",
        items: { type: "string" },
        description: "Values or labels of the options to choose",
      },
      tab_id: { type: "integer", description: "Tab id from list_tabs" },
    },
    required: ["ref", "values"],
  },
  readOnly: false,

  label(ctx, input) {
    return t("orbito-assistant-tool-selecting", {
      values: (input.values || []).map(v => `“${v}”`).join(", "),
    });
  },

  approvalAction() {
    return t("orbito-assistant-tool-select-action");
  },

  approvalText(ctx, input) {
    let tab = OrbitoPage.targetTab(ctx, input);
    let { name, role } = OrbitoPage.element(tab, input.ref);
    let values = input.values.map(v => `“${v}”`).join(", ");
    let field = name ? `“${name}”` : `a ${role}`;
    let frame = OrbitoPage.frameNote(tab, input.ref);
    return `Select ${values} in ${field}${frame} on ${OrbitoPage.host(tab)}?`;
  },

  async run(ctx, input) {
    let tab = OrbitoPage.targetTab(ctx, input);
    let outcome = await OrbitoPage.act(tab, "select_option", {
      ref: input.ref,
      values: input.values.map(String),
    });
    let selected = outcome.result.selected.map(v => `“${v}”`).join(", ");
    return OrbitoPage.outcome(outcome, `Selected ${selected}.`);
  },
};
