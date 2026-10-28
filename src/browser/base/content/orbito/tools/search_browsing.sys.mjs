/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { limitOf, localTime, time } from "./search_history.sys.mjs";

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

// The most the results may take, excerpts included; results past it are
// left out.
export const MAX_RESULT_CHARS = 12000;

export default {
  name: "search_browsing",
  description:
    "Search the text of the pages the user read before (Browsing recall), not only their titles and URLs, by keywords and by meaning. Pass a few key words of what the page was about (e.g. \"GPU 가격 비교\"), not the user's whole question: dates and words like \"the article I saw\" belong in since and until or nowhere. Pages with more of the words rank first; words of three or more characters may match inside a word, two-character words match a word's start. since and until (ISO 8601, e.g. 2026-10-14 or 2026-10-14T09:00:00+09:00) limit it to visits in that period. It searches the pages read in the current Space unless all_spaces is true. Returns the best matches, with their URL, title, last visit in the period and an excerpt.",
  schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Words to look for" },
      since: { type: "string", description: "Earliest visit, ISO 8601" },
      until: { type: "string", description: "Latest visit, ISO 8601" },
      limit: { type: "integer", description: "Results to return, at most 50" },
      all_spaces: {
        type: "boolean",
        description: "Search the pages read in every Space",
      },
    },
    required: ["query"],
  },
  readOnly: true,
  concurrent: true,

  label(ctx, input) {
    return t("orbito-assistant-tool-searching-browsing", {
      query: input?.query ?? "",
    });
  },

  async run(ctx, input) {
    let { OrbitoAssistantCore } = ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs"
    );
    if (OrbitoAssistantCore.isPrivateThread(ctx.threadId)) {
      return "Pages read before are not searched from a private window.";
    }
    let { OrbitoRecall } = ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoRecall.sys.mjs"
    );
    let since = time(input?.since, "since");
    let until = time(input?.until, "until");
    let found = await OrbitoRecall.search(String(input?.query ?? ""), {
      since: since == null ? null : since / 1000,
      until: until == null ? null : until / 1000,
      limit: limitOf(input ?? {}),
      // The Thread's Space; without one, every Space.
      space:
        input?.all_spaces === true || ctx.space == null ? undefined : ctx.space,
    });
    let results = [];
    let size = 2;
    for (let page of found) {
      let result = JSON.stringify({
        title: page.title,
        url: page.url,
        visited: localTime(page.visited_at * 1000),
        excerpt: page.excerpt,
      });
      if (size + result.length + 1 > MAX_RESULT_CHARS) {
        break;
      }
      size += result.length + 1;
      results.push(result);
    }
    if (!results.length) {
      return "No pages you read match.";
    }
    return `[${results.join(",")}]`;
  },
};
