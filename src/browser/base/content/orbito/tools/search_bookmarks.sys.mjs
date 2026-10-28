/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { limitOf } from "./search_history.sys.mjs";

const MAX_LIMIT = 50;

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

export default {
  name: "search_bookmarks",
  description:
    "Search the user's bookmarks. Every word of the query must appear in a bookmark's title or URL. Returns titles, URLs and the folder each is in.",
  schema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: {
        type: "integer",
        description: `Results to return, at most ${MAX_LIMIT}`,
      },
    },
    required: ["query"],
  },
  readOnly: true,
  concurrent: true,

  label(ctx, input) {
    return t("orbito-assistant-tool-searching-bookmarks", {
      query: input?.query ?? "",
    });
  },

  async run(ctx, input) {
    let { PlacesUtils } = ChromeUtils.importESModule(
      "resource://gre/modules/PlacesUtils.sys.mjs"
    );
    let { bookmarks } = PlacesUtils;
    let query = String(input.query ?? "").trim();
    if (!query) {
      throw new Error("Give a query to search for.");
    }
    let found = (await bookmarks.search({ query }))
      .filter(b => b.type == bookmarks.TYPE_BOOKMARK)
      .slice(0, limitOf(input));

    let roots = {
      [bookmarks.menuGuid]: "Bookmarks Menu",
      [bookmarks.toolbarGuid]: "Bookmarks Toolbar",
      [bookmarks.unfiledGuid]: "Other Bookmarks",
      [bookmarks.mobileGuid]: "Mobile Bookmarks",
    };
    let paths = new Map();
    let pathOf = async guid => {
      if (!guid || guid == bookmarks.rootGuid) {
        return "";
      }
      if (roots[guid]) {
        return roots[guid];
      }
      if (!paths.has(guid)) {
        paths.set(
          guid,
          bookmarks.fetch(guid).then(async folder => {
            let parent = await pathOf(folder?.parentGuid);
            let title = folder?.title || "";
            return parent ? `${parent}/${title}` : title;
          })
        );
      }
      return paths.get(guid);
    };
    let results = [];
    for (let bookmark of found) {
      results.push({
        title: bookmark.title,
        url: bookmark.url.href,
        folder: await pathOf(bookmark.parentGuid),
      });
    }
    return JSON.stringify(results);
  },
};
