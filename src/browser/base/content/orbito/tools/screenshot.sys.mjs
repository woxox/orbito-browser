/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { OrbitoPage } from "../OrbitoPage.sys.mjs";

// The longest side of a screenshot, and its JPEG quality.
const MAX_SIDE = 1280;
const QUALITY = 0.8;
// A part of the page beyond the screen is taken in at most this many images,
// shrunk to at most half the size it would be taken at otherwise; what does
// not fit then is left for another call.
const MAX_IMAGES = 6;
const MIN_SHRINK = 0.5;

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

export default {
  name: "screenshot",
  description:
    `Take a screenshot of the visible part of a page, or with a ref from read_page, of that element only, or with full_page or from_y/to_y, of the whole page or that part of it, beyond the screen and without scrolling it (in up to ${MAX_IMAGES} images, each saying which part of the page it shows). Use it for what text cannot tell, like layout, images and canvases; read_page is the way to read a page. Defaults to the tab the user is asking from.`,
  schema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Element ref from read_page" },
      full_page: {
        type: "boolean",
        description: "The whole page, top to bottom",
      },
      from_y: {
        type: "integer",
        description: "Top of the part to take, in px from the top of the page",
      },
      to_y: {
        type: "integer",
        description:
          "Bottom of the part to take, in px from the top of the page",
      },
      tab_id: { type: "integer", description: "Tab id from list_tabs" },
    },
  },
  readOnly: true,

  label() {
    return t("orbito-assistant-tool-screenshot");
  },

  async run(ctx, input) {
    let tab = OrbitoPage.targetTab(ctx, input);
    let part = input.from_y != null || input.to_y != null;
    let ranged = input.full_page || part;
    if (input.full_page && part) {
      throw new Error("Give either full_page or from_y/to_y, not both.");
    }
    if (ranged && input.ref) {
      throw new Error("Give either a ref or full_page/from_y/to_y, not both.");
    }
    let rect = null;
    if (input.ref) {
      OrbitoPage.element(tab, input.ref);
      let { x, y, width, height } = await OrbitoPage.rect(tab, input.ref);
      rect = new ctx.window.DOMRect(x, y, width, height);
    }
    let global = tab.linkedBrowser.browsingContext?.currentWindowGlobal;
    if (!global) {
      throw new Error("The page is not shown yet.");
    }
    if (ranged) {
      return takeRange(ctx, input, tab, global);
    }
    let image = encode(ctx, await global.drawSnapshot(rect, 1, "white"));
    return {
      content: `[screenshot ${image.width}×${image.height}]`,
      images: [image.jpeg],
      page: OrbitoPage.source(ctx, tab),
    };
  },
};

/** A snapshot as a JPEG at most MAX_SIDE on its longest side. */
function encode(ctx, bitmap) {
  let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  let width = Math.max(1, Math.round(bitmap.width * scale));
  let height = Math.max(1, Math.round(bitmap.height * scale));
  let canvas = ctx.window.document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "canvas"
  );
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  let data = canvas.toDataURL("image/jpeg", QUALITY).split(",")[1];
  return { width, height, jpeg: { mimeType: "image/jpeg", data } };
}

/**
 * Takes a part of the page from top to bottom, as wide as the viewport,
 * in as many images as it takes (at most MAX_IMAGES). drawSnapshot draws
 * any part of the page, so the page is never scrolled.
 */
async function takeRange(ctx, input, tab, global) {
  let { width, scrollX, pageHeight } = await OrbitoPage.rect(tab);
  let from = input.full_page ? 0 : Math.max(0, input.from_y ?? 0);
  let to = input.full_page
    ? pageHeight
    : Math.min(pageHeight, input.to_y ?? pageHeight);
  if (to <= from) {
    throw new Error(
      `Nothing to take between y=${from} and y=${to}: the page is ${pageHeight} px tall.`
    );
  }
  // The scale an image as wide as the viewport fits at, shrunk further
  // when the part would not fit in MAX_IMAGES images otherwise.
  let fit = Math.min(1, MAX_SIDE / width);
  let scale = Math.min(fit, (MAX_SIDE * MAX_IMAGES) / (to - from));
  let end = to;
  if (scale < fit * MIN_SHRINK) {
    scale = fit * MIN_SHRINK;
    end = from + (MAX_SIDE * MAX_IMAGES) / scale;
  }
  // Less a hair, so that a part that just fits takes no extra image.
  let count = Math.ceil(((end - from) * scale) / MAX_SIDE - 1e-9);
  // Whole px at each seam, so that images neither overlap nor leave a gap.
  let edge = i => Math.round(from + ((end - from) * i) / count);
  let lines = [];
  let images = [];
  for (let i = 0; i < count; i++) {
    let top = edge(i);
    let bottom = edge(i + 1);
    let rect = new ctx.window.DOMRect(scrollX, top, width, bottom - top);
    let image = encode(ctx, await global.drawSnapshot(rect, scale, "white"));
    images.push(image.jpeg);
    lines.push(
      `[screenshot ${i + 1}/${count} ${image.width}×${image.height}: page y ${top}–${bottom} of ${Math.round(pageHeight)} px]`
    );
  }
  if (end < to) {
    lines.push(
      `The rest was cut short: call screenshot with from_y=${Math.round(end)} for it.`
    );
  }
  return {
    content: lines.join("\n"),
    images,
    page: OrbitoPage.source(ctx, tab),
  };
}
