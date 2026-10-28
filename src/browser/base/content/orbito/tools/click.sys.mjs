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
  name: "click",
  description:
    "Click an element of a page, by its ref from read_page. The user must approve each call.",
  schema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Element ref from read_page" },
      tab_id: { type: "integer", description: "Tab id from list_tabs" },
    },
    required: ["ref"],
  },
  readOnly: false,

  label(ctx, input) {
    let tab = OrbitoPage.targetTab(ctx, input);
    return t("orbito-assistant-tool-clicking", {
      target: OrbitoPage.shortName(tab, input.ref),
    });
  },

  approvalAction() {
    return t("orbito-assistant-tool-click-action");
  },

  approvalText(ctx, input) {
    let tab = OrbitoPage.targetTab(ctx, input);
    return `Click ${OrbitoPage.describe(tab, input.ref)} on ${OrbitoPage.host(tab)}?`;
  },

  async run(ctx, input) {
    let tab = OrbitoPage.targetTab(ctx, input);
    let outcome = await OrbitoPage.act(tab, "click", { ref: input.ref });
    return OrbitoPage.outcome(outcome, "Clicked.");
  },
};
