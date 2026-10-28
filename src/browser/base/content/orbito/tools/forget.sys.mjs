/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function core() {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs"
  ).OrbitoAssistantCore;
}

/**
 * The saved memory with the input's id that the Thread's Space sees (as
 * recall does); throws if there is none.
 */
async function memoryOf(ctx, input) {
  let id = String(input?.id ?? "");
  let memory = (await core().listMemories({ space: ctx.space })).find(
    m => m.id == id
  );
  if (!memory) {
    throw new Error(`No memory has the id ${id}. Find it with recall.`);
  }
  return memory;
}

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

export default {
  name: "forget",
  description:
    "Delete one of the memories the user asked you to keep, by its id (recall returns the ids). Call it only when the user asks you to forget something. The user must approve each call.",
  schema: {
    type: "object",
    properties: {
      id: { type: "string", description: "The memory's id, from recall" },
    },
    required: ["id"],
  },
  readOnly: false,
  // Like remember: what the user asked to keep must not go unseen.
  alwaysConfirm: true,

  label() {
    return t("orbito-assistant-tool-forgetting");
  },

  approvalAction() {
    return t("orbito-assistant-tool-forget-action");
  },

  async approvalText(ctx, input) {
    return `Forget “${(await memoryOf(ctx, input)).text}”?`;
  },

  async run(ctx, input) {
    await core().deleteMemory((await memoryOf(ctx, input)).id);
    return "Forgotten.";
  },
};
