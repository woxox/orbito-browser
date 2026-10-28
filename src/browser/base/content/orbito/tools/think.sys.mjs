/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Where the model thinks, for both backends (their built-in thinking is off;
 * models that cannot turn it off think there too, kept the same way).
 * The core stores the thought, which the panel shows only when the user
 * opens it, and leaves it out of later questions.
 */
export default {
  name: "think",
  description:
    "Think through what you have learned and what to do next. Use it after getting tool results and before actions that change something. The user sees your thoughts only if they open them.",
  schema: {
    type: "object",
    properties: {
      thought: { type: "string", description: "Your thinking." },
    },
    required: ["thought"],
  },
  readOnly: true,

  run() {
    return "";
  },
};
