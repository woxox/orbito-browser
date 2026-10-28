/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Where the agent says which step of a skill made from a demo it is on
 * (OrbitoShowReplay.sys.mjs). Offered only to questions that may run such
 * a skill. The core answers it itself, as it does think: it moves the
 * steps the reply shows, and at a step the user enters themselves asks
 * them, under any PermissionMode, before it returns.
 */
export default {
  name: "skill_step",
  description:
    "Report the step of a skill made from a demo that you are about to do, by its number, before doing it. At a step the user enters themselves it returns once they have. With found false and missing, report that you could not find what the step needs: the skill then stops.",
  schema: {
    type: "object",
    properties: {
      step: { type: "integer", description: "The step's number, from 1" },
      found: {
        type: "boolean",
        description:
          "false when you could not find what the step needs on the page",
      },
      missing: {
        type: "string",
        description: "With found false: what you could not find",
      },
    },
    required: ["step"],
  },
  readOnly: true,

  run() {
    throw new Error("No skill made from a demo is running.");
  },
};
