/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const LIMIT = 10;

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

export default {
  name: "search_artifacts",
  description:
    "Search the documents made with create_artifact by their title and content. Any word of the query may match the start of a word in a document. It searches the documents of the current Space unless all_spaces is true. Returns the best matches with their ids, titles and a part of the text around a match; read one whole with read_artifact.",
  schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Words to look for" },
      all_spaces: {
        type: "boolean",
        description: "Search the documents of every Space",
      },
    },
    required: ["query"],
  },
  readOnly: true,
  concurrent: true,

  label(ctx, input) {
    return t("orbito-assistant-tool-searching-documents", {
      query: input?.query ?? "",
    });
  },

  async run(ctx, input) {
    let { OrbitoAssistantCore } = ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs"
    );
    let found = await OrbitoAssistantCore.searchArtifacts(
      String(input?.query ?? ""),
      LIMIT,
      {
        isPrivate: OrbitoAssistantCore.isPrivateThread(
          ctx.threadId
        ),
        // The Thread's Space; without one, every Space.
        space:
          input?.all_spaces === true || ctx.space == null
            ? undefined
            : ctx.space,
      }
    );
    if (!found.length) {
      return "No documents match.";
    }
    return JSON.stringify(
      found.map(a => ({
        id: a.id,
        title: a.title,
        updated: new Date(a.updated_at).toISOString().slice(0, 10),
        excerpt: a.snippet,
      }))
    );
  },
};
