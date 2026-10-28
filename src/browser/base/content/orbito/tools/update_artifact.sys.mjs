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
  name: "update_artifact",
  description:
    "Change a document made with create_artifact by giving its whole new content; it is saved as the document's next version, and tabs showing it update. The user can go back to older versions on the document page.",
  schema: {
    type: "object",
    properties: {
      id: { type: "string", description: "The document's id" },
      content: {
        type: "string",
        description: "The whole new document, in Markdown",
      },
    },
    required: ["id", "content"],
  },
  // Runs without asking, like create_artifact: older versions stay and can
  // be restored.
  readOnly: true,

  label() {
    return t("orbito-assistant-tool-updating-document");
  },

  async run(ctx, input) {
    let { OrbitoAssistantCore } = ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs"
    );
    let content = String(input?.content ?? "");
    if (!content.trim()) {
      throw new Error("The document needs content.");
    }
    let artifact = await OrbitoAssistantCore.updateArtifact(
      String(input?.id ?? ""),
      content,
      {
        isPrivate: OrbitoAssistantCore.isPrivateThread(
          ctx.threadId
        ),
      }
    );
    return {
      content: `Saved version ${artifact.current_version} of the document ${artifact.id}.`,
      artifact: { id: artifact.id, title: artifact.title },
    };
  },
};
