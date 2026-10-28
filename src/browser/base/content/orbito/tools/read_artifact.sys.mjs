/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

export default {
  name: "read_artifact",
  description:
    "Read a document made with create_artifact: its title, current version and whole Markdown content. Find ids with search_artifacts.",
  schema: {
    type: "object",
    properties: {
      id: { type: "string", description: "The document's id" },
    },
    required: ["id"],
  },
  readOnly: true,
  concurrent: true,

  label() {
    return t("orbito-assistant-tool-reading-document");
  },

  async run(ctx, input) {
    let { OrbitoAssistantCore } = ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs"
    );
    let artifact = await OrbitoAssistantCore.getArtifact(
      String(input?.id ?? ""),
      {
        isPrivate: OrbitoAssistantCore.isPrivateThread(
          ctx.threadId
        ),
      }
    );
    if (!artifact) {
      throw new Error("There is no such document.");
    }
    return JSON.stringify({
      id: artifact.id,
      title: artifact.title,
      version: artifact.current_version,
      updated: new Date(artifact.updated_at).toISOString().slice(0, 10),
      source_urls: artifact.source_urls,
      content: artifact.content,
    });
  },
};
