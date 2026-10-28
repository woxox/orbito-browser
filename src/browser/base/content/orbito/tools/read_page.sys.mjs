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
  name: "read_page",
  description:
    "Get a structured snapshot of a page: its headings, landmarks and text, and every link, button and form field with a ref (e1, e2, ...) to act on with click, type, select_option, scroll and press_key. What is inside the page's frames is under each frame's entry, with refs used the same way. Refs last until the next read_page call or until the page changes. Defaults to the tab the user is asking from.",
  schema: {
    type: "object",
    properties: {
      tab_id: { type: "integer", description: "Tab id from list_tabs" },
    },
  },
  readOnly: true,

  label(ctx, input) {
    let tab = OrbitoPage.targetTab(ctx, input);
    return t("orbito-assistant-tool-reading-tab", { title: tab.label });
  },

  step() {
    return t("orbito-assistant-tool-reading-page");
  },

  async run(ctx, input) {
    let tab = OrbitoPage.targetTab(ctx, input);
    return {
      content: await OrbitoPage.read(tab),
      page: OrbitoPage.source(ctx, tab),
    };
  },
};
