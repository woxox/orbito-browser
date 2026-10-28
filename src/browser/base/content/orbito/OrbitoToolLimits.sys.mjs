/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Keeps a model from calling tools forever within one question. Tool calls
 * other than think are limited per question (unless maxToolCalls is 0), and
 * think to a few in a row.
 * The first call past a limit is refused with an error the model sees, so
 * it can wrap up; calling past the same limit again stops the question.
 */

const MAX_CONSECUTIVE_THINKS = 5;

export class ToolLimits {
  #maxToolCalls;
  #toolCalls = 0;
  #thinks = 0;
  #refused = new Set();

  constructor({ maxToolCalls }) {
    this.#maxToolCalls = maxToolCalls;
  }

  /**
   * Counts a tool call and says what to do with it.
   *
   * @param {string} name
   * @returns {{action: "run"} | {action: "refuse", error: string} |
   *           {action: "stop", error: string, notice: string}}
   */
  check(name) {
    let limit;
    if (name == "think") {
      if (++this.#thinks <= MAX_CONSECUTIVE_THINKS) {
        return { action: "run" };
      }
      limit = {
        kind: "think",
        error:
          "Too many think calls in a row. Use a tool or answer the user now.",
        notice: "Stopped: the assistant kept thinking without acting.",
      };
    } else {
      this.#thinks = 0;
      if (!this.#maxToolCalls || ++this.#toolCalls <= this.#maxToolCalls) {
        return { action: "run" };
      }
      limit = {
        kind: "tools",
        error:
          "Tool call limit reached. Answer the user now with the information you have so far.",
        notice: `Stopped: the assistant reached its limit of ${this.#maxToolCalls} tool calls.`,
      };
    }
    if (!this.#refused.has(limit.kind)) {
      this.#refused.add(limit.kind);
      return { action: "refuse", error: limit.error };
    }
    return { action: "stop", error: limit.error, notice: limit.notice };
  }

  /** The model wrote text, which ends a run of thinks. */
  onText() {
    this.#thinks = 0;
  }
}
