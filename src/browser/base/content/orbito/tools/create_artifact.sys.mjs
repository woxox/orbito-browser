/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const MAX_TITLE = 200;

/**
 * The checked input of create_artifact: {title, content, sourceUrls}, where
 * only http(s) source URLs are kept.
 *
 * @throws {Error} Saying what is missing.
 */
export function artifactInput(input) {
  let title = String(input?.title ?? "").trim();
  let content = String(input?.content ?? "");
  if (!title) {
    throw new Error("The document needs a title.");
  }
  if (title.length > MAX_TITLE) {
    throw new Error(`A title is at most ${MAX_TITLE} characters.`);
  }
  if (!content.trim()) {
    throw new Error("The document needs content.");
  }
  let urls = input?.source_urls ?? [];
  if (!Array.isArray(urls)) {
    throw new Error("source_urls must be a list of URLs.");
  }
  let sourceUrls = [
    ...new Set(urls.map(String).filter(url => /^https?:\/\/\S+$/i.test(url))),
  ];
  return { title, content, sourceUrls };
}

/**
 * The document a reply is kept as, without the model (a task's run):
 * {title, content}. The content is the reply's text; the title is its first
 * heading, or else the first line of the question, or "Answer".
 *
 * @param {object[]} parts The reply's parts.
 * @param {string} [question] The text of the question it answers.
 * @returns {?{title: string, content: string}} null for a reply without
 *   text.
 */
export function replyArtifact(parts, question = "") {
  // Text parts come apart where a tool ran in between.
  let content = parts
    .filter(p => p.type == "text")
    .map(p => p.text.trim())
    .filter(Boolean)
    .join("\n\n");
  if (!content) {
    return null;
  }
  let line = text =>
    text
      .split("\n")
      .map(l => l.trim())
      .find(Boolean) ?? "";
  let heading = content.match(/^#{1,6}[ \t]+(.+?)[ \t#]*$/m)?.[1];
  let title = (heading || line(question) || "Answer").slice(0, MAX_TITLE);
  return { title, content };
}

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

export default {
  name: "create_artifact",
  description:
    "Write a Markdown document that opens in a new tab, for results the user will read at length or keep: comparison tables, reports, notes on several pages. Reply with a short note instead of repeating it. Returns the document's id.",
  schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "A short title" },
      content: {
        type: "string",
        description: "The whole document, in Markdown",
      },
      source_urls: {
        type: "array",
        items: { type: "string" },
        description: "The URLs of the pages it is based on, if any",
      },
    },
    required: ["title", "content"],
  },
  // Runs without asking: it only writes to the assistant's own storage and
  // opens an Orbito page, which reaches nothing outside the browser.
  readOnly: true,

  label(ctx, input) {
    let title = String(input?.title ?? "").trim();
    return title
      ? t("orbito-assistant-tool-writing", { title })
      : t("orbito-assistant-tool-writing-document");
  },

  async run(ctx, input) {
    let { OrbitoAssistantCore } = ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs"
    );
    let artifact = await OrbitoAssistantCore.createArtifact({
      ...artifactInput(input),
      // The id of the tab already showing it being written, if there is one.
      id: ctx.artifactId,
      threadId: ctx.threadId,
      // The Thread's Space, as what it opens.
      space: ctx.space,
    });
    // A windowless query leaves it for the user to open later.
    if (ctx.windowless) {
      return {
        content: `Created the document ${artifact.id}.`,
        artifact: { id: artifact.id, title: artifact.title },
      };
    }
    // Selected if the user is looking at the tab that asked; in the
    // Thread's Space.
    let tab = await OrbitoAssistantCore.openArtifact(ctx.window, artifact.id, {
      background: ctx.window.gBrowser.selectedTab != ctx.tab,
      space: ctx.space,
    });
    // What the task made, in its Orbit (the tab it was written in already
    // is).
    ctx.opened(tab, { result: true });
    return {
      content: `Created the document ${artifact.id} and opened it in tab ${ctx.tabId(tab)}.`,
      artifact: { id: artifact.id, title: artifact.title },
    };
  },
};
