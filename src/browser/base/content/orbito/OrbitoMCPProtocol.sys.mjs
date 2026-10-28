/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The parts of the MCP client (OrbitoMCP.sys.mjs) that need no browser:
 * JSON-RPC messages, reading a streamable HTTP response (JSON or SSE),
 * naming tools for the registry and turning tools/call results into tool
 * results.
 */

import { SSEParser } from "./OrbitoSSE.sys.mjs";

export const PROTOCOL_VERSION = "2025-06-18";

export function request(id, method, params) {
  return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
}

export function notification(method, params) {
  return { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
}

/**
 * The JSON-RPC messages in a response body, as they arrive.
 *
 * @param {string} contentType
 * @param {ReadableStream} body
 */
export async function* readMessages(contentType, body) {
  let reader = body.getReader();
  let decoder = new TextDecoder();
  let sse = /^text\/event-stream/i.test(contentType || "");
  if (!sse) {
    let text = "";
    for (;;) {
      let { done, value } = await reader.read();
      if (done) {
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    if (text.trim()) {
      yield* [JSON.parse(text)].flat();
    }
    return;
  }
  let parser = new SSEParser();
  let parse = function* (events) {
    for (let { event, data } of events) {
      if (event == "message" && data.trim()) {
        yield* [JSON.parse(data)].flat();
      }
    }
  };
  try {
    for (;;) {
      let { done, value } = await reader.read();
      if (done) {
        break;
      }
      yield* parse(parser.push(decoder.decode(value, { stream: true })));
    }
    yield* parse(parser.push(decoder.decode()));
    yield* parse(parser.end());
  } finally {
    reader.releaseLock();
  }
}

const MAX_NAME = 64;

function namePart(text) {
  return String(text)
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Registry names for a server's tools: "<server>__<tool>" with characters
 * the registry does not allow replaced, cut to 64 characters, and a number
 * added to names already taken.
 *
 * @param {string} serverName
 * @param {string[]} names The server's tool names, in order.
 * @param {Set<string>} taken Names in use elsewhere.
 * @returns {string[]}
 */
export function toolNames(serverName, names, taken) {
  let used = new Set(taken);
  let server = namePart(serverName) || "mcp";
  return names.map(name => {
    let base = `${server}__${namePart(name) || "tool"}`.slice(0, MAX_NAME);
    let candidate = base;
    for (let n = 2; used.has(candidate); n++) {
      let suffix = `_${n}`;
      candidate = base.slice(0, MAX_NAME - suffix.length) + suffix;
    }
    used.add(candidate);
    return candidate;
  });
}

/**
 * A tools/call result as a tool result for the core.
 *
 * @returns {{ok: boolean, content: string, images?: object[]}}
 */
export function toolResult(result) {
  let texts = [];
  let images = [];
  for (let item of result?.content || []) {
    if (item?.type == "text") {
      texts.push(String(item.text ?? ""));
    } else if (item?.type == "image" && item.data) {
      images.push({ mimeType: item.mimeType || "image/png", data: item.data });
      texts.push("[image]");
    } else {
      texts.push(`[${item?.type || "unknown"} content]`);
    }
  }
  if (!texts.length && result?.structuredContent) {
    texts.push(JSON.stringify(result.structuredContent));
  }
  let tool = { ok: !result?.isError, content: texts.join("\n") };
  if (images.length && tool.ok) {
    tool.images = images;
  }
  return tool;
}
