/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const LIMIT = 20;

/**
 * The FTS5 query for the words of a search: any of them, each as a prefix,
 * so "회사" also finds "회사는" (memories_fts splits words on spaces only).
 */
export function ftsQuery(text) {
  let words = String(text ?? "")
    .split(/\s+/)
    .map(word => word.replaceAll('"', ""))
    .filter(Boolean);
  if (!words.length) {
    throw new Error("Give words to search for.");
  }
  return words.map(word => `"${word}"*`).join(" OR ");
}

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

export default {
  name: "recall",
  description:
    "Search the memories the user asked you to keep, for ones not in the system prompt. Any word of the query may match the start of a word in a memory. Returns the best matches with their ids and when they were saved.",
  schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Words to look for" },
    },
    required: ["query"],
  },
  readOnly: true,
  concurrent: true,

  label(ctx, input) {
    return t("orbito-assistant-tool-searching-memories", {
      query: input?.query ?? "",
    });
  },

  async run(ctx, input) {
    let { OrbitoAssistantCore } = ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs"
    );
    // Those of all Spaces and of the Thread's, as in the system prompt.
    let found = await OrbitoAssistantCore.searchMemories(
      ftsQuery(input?.query),
      LIMIT,
      { space: ctx.space }
    );
    if (!found.length) {
      return "No memories match.";
    }
    return JSON.stringify(
      found.map(m => ({
        id: m.id,
        text: m.text,
        saved: new Date(m.created_at).toISOString().slice(0, 10),
      }))
    );
  },
};
