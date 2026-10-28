/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { OrbitoPage } from "../OrbitoPage.sys.mjs";

const KEYS = [
  "Enter",
  "Escape",
  "Tab",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
];

function checkKey(key) {
  if (!KEYS.includes(key) && [...String(key)].length != 1) {
    throw new Error(`Unknown key ${key}. Use one of ${KEYS.join(", ")} or a single character.`);
  }
}

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

export default {
  name: "press_key",
  description: `Press a key on a page, in the element with the given ref from read_page or else where the focus is. Keys: ${KEYS.join(", ")}, or a single character. The user must approve each call.`,
  schema: {
    type: "object",
    properties: {
      key: { type: "string" },
      ref: { type: "string", description: "Element ref from read_page" },
      tab_id: { type: "integer", description: "Tab id from list_tabs" },
    },
    required: ["key"],
  },
  readOnly: false,

  label(ctx, input) {
    return t("orbito-assistant-tool-pressing", { key: input.key });
  },

  approvalAction() {
    return t("orbito-assistant-tool-press-key-action");
  },

  approvalText(ctx, input) {
    checkKey(input.key);
    let tab = OrbitoPage.targetTab(ctx, input);
    let host = OrbitoPage.host(tab);
    if (input.ref) {
      return `Press ${input.key} in ${OrbitoPage.describe(tab, input.ref)} on ${host}?`;
    }
    return `Press ${input.key} on ${host}?`;
  },

  async run(ctx, input) {
    checkKey(input.key);
    let tab = OrbitoPage.targetTab(ctx, input);
    let outcome = await OrbitoPage.act(tab, "press_key", {
      ref: input.ref,
      key: input.key,
    });
    return OrbitoPage.outcome(outcome, `Pressed ${input.key}.`);
  },
};
