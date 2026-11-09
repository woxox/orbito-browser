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

/** The tab's open dialog, checked against the input. */
function openDialog(ctx, input) {
  let tab = OrbitoPage.targetTab(ctx, input);
  let dialog = OrbitoPage.dialog(tab);
  if (!dialog) {
    throw new Error("The page has no dialog open.");
  }
  if (input.text != null && dialog.type != "prompt") {
    throw new Error("Only a prompt has a field to type text into.");
  }
  return { tab, dialog };
}

export default {
  name: "handle_dialog",
  description:
    "Answer the alert, confirm or prompt dialog a page has open, or its prompt asking whether to leave the page: the page waits until it is answered, and cannot be acted on before. accept: true presses OK (Leave page), false Cancel (Stay on page); an alert closes either way. For a prompt, text is typed into its field first. The user must approve each call.",
  schema: {
    type: "object",
    properties: {
      accept: { type: "boolean", description: "OK if true, Cancel if false" },
      text: { type: "string", description: "Text for a prompt's field" },
      tab_id: { type: "integer", description: "Tab id from list_tabs" },
    },
    required: ["accept"],
  },
  readOnly: false,

  label() {
    return t("orbito-assistant-tool-answering-dialog");
  },

  approvalAction() {
    return t("orbito-assistant-tool-dialog-action");
  },

  approvalText(ctx, input) {
    let { dialog } = openDialog(ctx, input);
    let { type, host } = dialog;
    let text = `“${shown(dialog.text)}”`;
    if (type == "beforeunload") {
      return input.accept
        ? `Leave the page on ${host}?`
        : `Stay on the page on ${host}?`;
    }
    if (type == "alert") {
      return `Close the alert ${text} on ${host}?`;
    }
    let what = type == "confirm" ? "confirm dialog" : "prompt";
    if (!input.accept) {
      return `Cancel the ${what} ${text} on ${host}?`;
    }
    if (input.text != null) {
      return `Answer the prompt ${text} with “${shown(String(input.text))}” on ${host}?`;
    }
    return `Press OK in the ${what} ${text} on ${host}?`;
  },

  async run(ctx, input) {
    let { tab, dialog } = openDialog(ctx, input);
    let text = input.text != null ? String(input.text) : null;
    let outcome = await OrbitoPage.answerDialog(tab, {
      accept: !!input.accept,
      text,
    });
    let done;
    if (dialog.type == "beforeunload") {
      done = input.accept ? "Chose to leave the page." : "Chose to stay on the page.";
    } else if (dialog.type == "alert") {
      done = "Closed the alert.";
    } else if (!input.accept) {
      done = `Canceled the ${dialog.type == "confirm" ? "confirm dialog" : "prompt"}.`;
    } else {
      done = text != null ? "Answered the prompt." : "Pressed OK.";
    }
    return OrbitoPage.outcome(outcome, done, tab);
  },
};
