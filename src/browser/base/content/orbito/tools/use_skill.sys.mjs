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
  name: "use_skill",
  description:
    "Get the instructions of one of the user's skills listed in the system prompt, by its name. Call it when a skill fits the request, then follow the instructions it returns.",
  schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The skill's name, without /" },
    },
    required: ["name"],
  },
  readOnly: true,

  label(ctx, input) {
    return t("orbito-assistant-tool-using-skill", { name: input?.name ?? "" });
  },

  async run(ctx, input) {
    let { OrbitoAssistantCore } = ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs"
    );
    let name = String(input?.name ?? "").trim().replace(/^\//, "");
    // Those of all Spaces and of the one its tools see.
    let skill = (await OrbitoAssistantCore.skills({ space: ctx.space })).find(
      s => s.enabled && s.name == name
    );
    if (!skill) {
      throw new Error(
        `There is no skill named ${name}. Use a name from the system prompt.`
      );
    }
    let { DEMO_INSTRUCTIONS } = ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoSkills.sys.mjs"
    );
    // As the system prompt and skillBlock say it for a skill the user
    // called.
    let content = skill.body;
    if (skill.source == "demo") {
      content += `\n\n${DEMO_INSTRUCTIONS}`;
    }
    if (skill.output == "document") {
      content += "\n\nThe result of this skill is a document: write it with create_artifact, and reply with a short note.";
    }
    return { content, skill: { name: skill.name } };
  },
};
