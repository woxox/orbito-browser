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
  name: "scroll",
  description:
    "Scroll a page, or the scrollable element with the given ref from read_page. Without amount it scrolls most of a screen; with a ref that does not scroll and no amount, it scrolls that element into view. The user must approve each call.",
  schema: {
    type: "object",
    properties: {
      direction: { type: "string", enum: ["up", "down", "left", "right"] },
      amount: { type: "integer", description: "Pixels to scroll" },
      ref: { type: "string", description: "Element ref from read_page" },
      tab_id: { type: "integer", description: "Tab id from list_tabs" },
    },
    required: ["direction"],
  },
  readOnly: false,
  autoAllow: true,

  label(ctx, input) {
    return t("orbito-assistant-tool-scrolling", { direction: input.direction });
  },

  approvalAction() {
    return t("orbito-assistant-tool-scroll-action");
  },

  approvalText(ctx, input) {
    let tab = OrbitoPage.targetTab(ctx, input);
    let host = OrbitoPage.host(tab);
    if (!["up", "down", "left", "right"].includes(input.direction)) {
      throw new Error("direction must be up, down, left or right.");
    }
    if (input.ref) {
      return `Scroll ${OrbitoPage.describe(tab, input.ref)} ${input.direction} on ${host}?`;
    }
    return `Scroll ${input.direction} on ${host}?`;
  },

  async run(ctx, input) {
    let tab = OrbitoPage.targetTab(ctx, input);
    let { result } = await OrbitoPage.act(tab, "scroll", {
      ref: input.ref,
      direction: input.direction,
      amount: input.amount > 0 ? input.amount : 0,
    });
    let done = result.intoView
      ? `Scrolled ${input.ref} into view; the page is at ${result.position}.`
      : `Scrolled ${input.direction}: now at ${result.position}.`;
    return `${done} Call read_page to see what is shown.`;
  },
};
