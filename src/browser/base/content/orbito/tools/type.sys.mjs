/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { OrbitoPage } from "../OrbitoPage.sys.mjs";

const MAX_SHOWN = 100;

function shown(text) {
  return text.length > MAX_SHOWN ? text.slice(0, MAX_SHOWN - 1) + "…" : text;
}

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

export default {
  name: "type",
  description:
    "Type text into a text field, textarea or editable area of a page, by its ref from read_page, replacing what is there. With submit, press Enter afterwards. Never use it for passwords or payment card details: those fields are refused. The user must approve each call.",
  schema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Element ref from read_page" },
      text: { type: "string" },
      submit: { type: "boolean", description: "Press Enter after typing" },
      tab_id: { type: "integer", description: "Tab id from list_tabs" },
    },
    required: ["ref", "text"],
  },
  readOnly: false,

  label(ctx, input) {
    let tab = OrbitoPage.targetTab(ctx, input);
    return t("orbito-assistant-tool-typing", {
      target: OrbitoPage.shortName(tab, input.ref),
    });
  },

  approvalAction() {
    return t("orbito-assistant-tool-type-action");
  },

  approvalText(ctx, input) {
    let tab = OrbitoPage.targetTab(ctx, input);
    let { name, role, sensitive } = OrbitoPage.element(tab, input.ref);
    if (sensitive) {
      throw new Error(
        "Typing into password, payment card and other secret fields is not allowed. Ask the user to fill it in."
      );
    }
    let field = name ? `“${name}”` : `a ${role}`;
    let enter = input.submit ? " and press Enter" : "";
    let frame = OrbitoPage.frameNote(tab, input.ref);
    return `Type “${shown(String(input.text))}” into ${field}${frame}${enter}?`;
  },

  async run(ctx, input) {
    let tab = OrbitoPage.targetTab(ctx, input);
    let outcome = await OrbitoPage.act(tab, "type", {
      ref: input.ref,
      text: String(input.text),
      submit: !!input.submit,
    });
    return OrbitoPage.outcome(outcome, input.submit ? "Typed and pressed Enter." : "Typed.");
  },
};
