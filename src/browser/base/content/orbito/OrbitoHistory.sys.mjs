/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Turns stored Thread messages into what each backend sends to its
 * model. Messages are {role, parts}; see OrbitoAssistantCore.sys.mjs for
 * the part types. Only text, skills, tool calls and tool results are passed
 * on.
 */

import { skillBlock } from "./OrbitoSkills.sys.mjs";

const STOPPED_RESULT = "No result: the query was stopped.";

/**
 * What a user message says to the model: the instructions of the skill it
 * called, as stored with it, then the user's words.
 *
 * @param {object[]} parts
 * @returns {string}
 */
export function userPrompt(parts) {
  return parts
    .map(part => {
      if (part.type == "skill") {
        return skillBlock(part.name, part.body, part.source);
      }
      return part.type == "text" ? part.text : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The parts of a message that are passed on, with a failed result added for
 * each tool call that never got one (the query was stopped mid-call). A user
 * message is passed on as one text part.
 */
function modelParts(message) {
  if (message.role == "user") {
    let text = userPrompt(message.parts);
    return text ? [{ type: "text", text }] : [];
  }
  let answered = new Set(
    message.parts.filter(p => p.type == "tool_result").map(p => p.call_id)
  );
  let parts = [];
  for (let part of message.parts) {
    if (part.type == "text" || part.type == "tool_result") {
      parts.push(part);
    } else if (part.type == "tool_call") {
      parts.push(part);
      if (!answered.has(part.id)) {
        parts.push({
          type: "tool_result",
          call_id: part.id,
          content: STOPPED_RESULT,
          is_error: true,
        });
      }
    }
  }
  return parts;
}

function characters(length) {
  return length < 1000
    ? `${length} characters`
    : `${Math.round(length / 1000)}k characters`;
}

function size(message) {
  let total = 0;
  for (let part of message.parts) {
    if (part.type == "text") {
      total += part.text.length;
    } else if (part.type == "skill") {
      total += part.body.length;
    } else if (part.type == "tool_call") {
      total += part.name.length + JSON.stringify(part.input ?? {}).length;
    } else if (part.type == "tool_result") {
      total += part.content.length;
    }
  }
  return total;
}

/**
 * Trims the history sent to a model; the stored messages are not changed.
 * Tool results older than the last verbatimTurns turns are replaced by a
 * short note, then the oldest turns are dropped until the rest fits the
 * budget. A turn is a user message and the replies that follow it.
 *
 * @param {object[]} messages
 * @param {object} options
 * @param {number} options.budget In characters.
 * @param {number} [options.verbatimTurns]
 * @returns {{history: object[], droppedTurns: number}}
 */
export function budgetHistory(messages, { budget, verbatimTurns = 2 }) {
  let turns = [];
  for (let message of messages) {
    if (message.role == "user" || !turns.length) {
      turns.push([]);
    }
    turns.at(-1).push(message);
  }
  turns = turns.map((turn, i) => {
    if (i >= turns.length - verbatimTurns) {
      return turn;
    }
    return turn.map(message => {
      let names = new Map(
        message.parts
          .filter(p => p.type == "tool_call")
          .map(p => [p.id, p.name])
      );
      return {
        ...message,
        parts: message.parts.map(part =>
          part.type == "tool_result"
            ? {
                ...part,
                content: `[${names.get(part.call_id) || "tool"} result omitted, ${characters(part.content.length)}]`,
              }
            : part
        ),
      };
    });
  });
  let sizes = turns.map(turn => turn.reduce((sum, m) => sum + size(m), 0));
  let total = sizes.reduce((a, b) => a + b, 0);
  let droppedTurns = 0;
  while (droppedTurns < turns.length && total > budget) {
    total -= sizes[droppedTurns++];
  }
  return { history: turns.slice(droppedTurns).flat(), droppedTurns };
}

function escape(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The Claude backend has no session: earlier turns go into the prompt as a
 * <conversation_history> block, escaped so that page text quoted in it
 * cannot close the block or fake a turn.
 *
 * @param {object[]} history Earlier messages.
 * @param {string} prompt The new question.
 * @returns {string}
 */
export function claudePrompt(history, prompt) {
  let lines = [];
  for (let message of history) {
    let parts = modelParts(message);
    if (!parts.length) {
      continue;
    }
    lines.push(`<${message.role}>`);
    for (let part of parts) {
      if (part.type == "text") {
        lines.push(escape(part.text));
      } else if (part.type == "tool_call") {
        lines.push(
          `<tool_call id="${escape(part.id)}" name="${escape(part.name)}">` +
            `${escape(JSON.stringify(part.input ?? {}))}</tool_call>`
        );
      } else {
        let error = part.is_error ? ' is_error="true"' : "";
        lines.push(
          `<tool_result call_id="${escape(part.call_id)}"${error}>` +
            `${escape(part.content)}</tool_result>`
        );
      }
    }
    lines.push(`</${message.role}>`);
  }
  if (!lines.length) {
    return prompt;
  }
  return [
    "<conversation_history>",
    ...lines,
    "</conversation_history>",
    "",
    prompt,
  ].join("\n");
}

/**
 * Chat Completions messages for the earlier turns, with native tool_calls
 * and tool messages.
 *
 * @param {object[]} history
 * @returns {object[]}
 */
export function openAIMessages(history) {
  let messages = [];
  for (let message of history) {
    let assistant = null;
    for (let part of modelParts(message)) {
      if (message.role == "user") {
        if (part.type == "text") {
          messages.push({ role: "user", content: part.text });
        }
      } else if (part.type == "text") {
        if (!assistant || assistant.tool_calls) {
          assistant = { role: "assistant", content: "" };
          messages.push(assistant);
        }
        assistant.content += part.text;
      } else if (part.type == "tool_call") {
        if (!assistant) {
          assistant = { role: "assistant", content: null };
          messages.push(assistant);
        }
        (assistant.tool_calls ??= []).push({
          id: part.id,
          type: "function",
          function: {
            name: part.name,
            arguments: JSON.stringify(part.input ?? {}),
          },
        });
      } else {
        messages.push({
          role: "tool",
          tool_call_id: part.call_id,
          content: part.is_error ? `Error: ${part.content}` : part.content,
        });
        assistant = null;
      }
    }
  }
  return messages;
}

/**
 * Responses API input items for the earlier turns: messages, and
 * function_call / function_call_output items for tools.
 *
 * @param {object[]} history
 * @returns {object[]}
 */
export function responsesInput(history) {
  let items = [];
  for (let message of history) {
    for (let part of modelParts(message)) {
      if (part.type == "text") {
        let user = message.role == "user";
        items.push({
          type: "message",
          role: user ? "user" : "assistant",
          content: [
            { type: user ? "input_text" : "output_text", text: part.text },
          ],
        });
      } else if (message.role == "user") {
        continue;
      } else if (part.type == "tool_call") {
        items.push({
          type: "function_call",
          call_id: part.id,
          name: part.name,
          arguments: JSON.stringify(part.input ?? {}),
        });
      } else {
        items.push({
          type: "function_call_output",
          call_id: part.call_id,
          output: part.is_error ? `Error: ${part.content}` : part.content,
        });
      }
    }
  }
  return items;
}

/**
 * The images tool calls of this question returned, as a user message to
 * follow their outputs (function_call_output carries text only here).
 *
 * @param {{id: string, images?: object[]}[]} calls
 * @returns {object[]} The message, or nothing if there are no images.
 */
export function responseImages(calls) {
  let content = [];
  for (let { id, images } of calls) {
    for (let { mimeType, data } of images || []) {
      content.push(
        { type: "input_text", text: `Image from tool call ${id}:` },
        { type: "input_image", image_url: `data:${mimeType};base64,${data}` }
      );
    }
  }
  return content.length ? [{ type: "message", role: "user", content }] : [];
}
