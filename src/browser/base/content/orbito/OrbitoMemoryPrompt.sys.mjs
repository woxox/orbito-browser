/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Builds the part of the system prompt that holds the user's memories
 * (see OrbitoAssistantStore.sys.mjs for their shape).
 */

const HEADER =
  "Memories the user asked you to keep, most recently used first. Follow them unless the user says otherwise:";

export const RECALL_LINE =
  "More memories are saved than fit here; search them with the recall tool when they may help.";

function lastUsed(memory) {
  return memory.last_used_at ?? memory.created_at;
}

/**
 * The memories, most recently used (or, never used, created) first, as one
 * block of at most budget characters. Memories past the budget are left
 * out, and the block then ends with RECALL_LINE.
 *
 * @param {object[]} memories
 * @param {object} options
 * @param {number} options.budget
 * @returns {{text: string, ids: string[]}} The block ("" without
 *   memories) and the ids of the memories in it, in order.
 */
export function memoryPrompt(memories, { budget }) {
  let sorted = [...memories].sort(
    (a, b) => lastUsed(b) - lastUsed(a) || b.created_at - a.created_at
  );
  // One line each, so a memory cannot pass for more of the prompt.
  let lines = sorted.map(m => `- ${m.text.replace(/\s+/g, " ").trim()}`);
  if (!lines.length) {
    return { text: "", ids: [] };
  }
  let all = [HEADER, ...lines].join("\n");
  if (all.length <= budget) {
    return { text: all, ids: sorted.map(m => m.id) };
  }
  let room = budget - RECALL_LINE.length - 1;
  let length = HEADER.length;
  let count = 0;
  while (count < lines.length && length + 1 + lines[count].length <= room) {
    length += 1 + lines[count].length;
    count++;
  }
  if (!count) {
    return { text: RECALL_LINE.length <= budget ? RECALL_LINE : "", ids: [] };
  }
  return {
    text: [HEADER, ...lines.slice(0, count), RECALL_LINE].join("\n"),
    ids: sorted.slice(0, count).map(m => m.id),
  };
}
