/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Backend for a ChatGPT subscription (Sign in with ChatGPT), through the
 * OpenAI Responses API. The server keeps nothing (store: false), so every
 * request carries the whole Thread, and the backend runs the tool
 * loop itself like the OpenAI-compatible one. Requests leave out what the
 * preview does not allow (previous_response_id, temperature,
 * max_output_tokens, system messages); the system prompt goes in
 * instructions. The model's own reasoning is kept as its summary, a
 * thought, and never sent back. See
 * OrbitoAssistantCore.sys.mjs for the backend interface.
 */

import {
  responseImages,
  responsesInput,
} from "chrome://browser/content/orbito/OrbitoHistory.sys.mjs";
import { SSEParser } from "chrome://browser/content/orbito/OrbitoSSE.sys.mjs";
import { runToolCalls } from "chrome://browser/content/orbito/OrbitoToolCalls.sys.mjs";
import {
  CATALOG_TIMEOUT,
  fetchModelsJSON,
} from "chrome://browser/content/orbito/OrbitoContextUsage.sys.mjs";
import { listedModels } from "chrome://browser/content/orbito/backends/OpenAI.sys.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

/**
 * The models of a GET /models answer to a ChatGPT login: the subscription's
 * own list ({models: [{slug, display_name, visibility, priority}]}) without
 * the hidden ones, in its order; else an OpenAI-style one ({data}).
 *
 * @param {object} json The answer.
 * @param {string} baseURL Where it came from.
 * @returns {{id: string, label: ?string, description: ?string}[]}
 */
export function chatGPTModels(json, baseURL) {
  if (!Array.isArray(json?.models)) {
    return listedModels(json?.data, baseURL);
  }
  return json.models
    .filter(m => typeof m?.slug == "string" && m.slug && m.visibility != "hide")
    .sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity))
    .map(m => ({
      id: m.slug,
      label:
        typeof m.display_name == "string" && m.display_name != m.slug
          ? m.display_name
          : null,
      description: typeof m.description == "string" ? m.description : null,
    }));
}

export const ChatGPTBackend = {
  /**
   * The models the endpoint lists (GET /models) to the login.
   *
   * @param {object} settings {baseURL, auth}.
   * @returns {Promise<{id: string, label: ?string, description: ?string}[]>}
   */
  async models({ baseURL, auth }) {
    let json = await fetchModelsJSON(
      `${baseURL}/models`,
      {
        headers: { Authorization: `Bearer ${await auth.accessToken()}` },
        credentials: "omit",
      },
      CATALOG_TIMEOUT
    );
    return chatGPTModels(json, baseURL);
  },

  /**
   * Besides the common options, takes auth: {accessToken({refresh})}, which
   * resolves to a token or throws an Error with needsLogin.
   */
  async run({
    history,
    prompt,
    system,
    tools,
    model,
    baseURL,
    auth,
    signal,
    callTool,
    emit,
  }) {
    let input = [
      ...responsesInput(history),
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ];
    let functions = tools.map(({ name, description, schema }) => ({
      type: "function",
      name,
      description,
      parameters: schema,
      strict: false,
    }));
    let concurrent = new Set(
      tools.filter(tool => tool.concurrent).map(tool => tool.name)
    );

    while (true) {
      let { calls } = await this._respond({
        baseURL,
        auth,
        body: {
          model,
          instructions: system,
          input,
          ...(functions.length ? { tools: functions } : {}),
          // A summary of the model's reasoning, kept as a thought.
          reasoning: { summary: "auto" },
          store: false,
          stream: true,
        },
        signal,
        emit,
      });
      if (!calls.length) {
        return;
      }
      let outputs = await runToolCalls(
        calls,
        call => concurrent.has(call.name),
        call => {
          let args = {};
          let inputError;
          try {
            args = call.arguments.trim() ? JSON.parse(call.arguments) : {};
          } catch {
            inputError = "The arguments were not valid JSON.";
          }
          return callTool(call.name, args, { inputError });
        }
      );
      let results = [];
      for (let [i, call] of calls.entries()) {
        let result = outputs[i];
        input.push({
          type: "function_call",
          call_id: call.call_id,
          name: call.name,
          arguments: call.arguments,
        });
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: result.ok ? result.content : `Error: ${result.content}`,
        });
        results.push({ id: call.call_id, images: result.images });
      }
      input.push(...responseImages(results));
      if (signal.aborted) {
        return;
      }
    }
  },

  async _post({ baseURL, token, body, signal }) {
    return fetch(`${baseURL}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal,
      credentials: "omit",
    });
  },

  /**
   * Streams one response, emitting its text as it arrives, and its token
   * usage once it is complete.
   *
   * @returns {Promise<{calls: {call_id, name, arguments}[]}>}
   */
  async _respond({ baseURL, auth, body, signal, emit }) {
    let response = await this._post({
      baseURL,
      token: await auth.accessToken(),
      body,
      signal,
    });
    if (response.status == 401) {
      // The token may have expired early or been revoked: refresh once.
      response.body?.cancel();
      response = await this._post({
        baseURL,
        token: await auth.accessToken({ refresh: true }),
        body,
        signal,
      });
      if (response.status == 401) {
        response.body?.cancel();
        let error = new Error(t("orbito-assistant-chatgpt-login-rejected"));
        error.needsLogin = true;
        throw error;
      }
    }
    if (!response.ok) {
      let detail = "";
      try {
        let json = await response.json();
        detail = json?.error?.message || json?.detail || "";
      } catch {}
      throw new Error(
        t("orbito-assistant-chatgpt-error-status", {
          status: String(response.status),
          detail,
        }).trim()
      );
    }

    // By output_index, as the items are streamed.
    let calls = [];
    // The reasoning summaries so far, by output_index.
    let thoughts = [];
    let completed = false;
    let parser = new SSEParser();
    let reader = response.body.getReader();
    let decoder = new TextDecoder();
    let handle = events => {
      for (let { data } of events) {
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        switch (event.type) {
          case "response.output_text.delta":
            if (event.delta) {
              emit({ type: "text", text: event.delta });
            }
            break;
          case "response.output_item.added":
            if (event.item?.type == "reasoning") {
              thoughts[event.output_index] = "";
              emit({ type: "thinking_start" });
            }
            if (event.item?.type == "function_call") {
              calls[event.output_index] = {
                call_id: event.item.call_id,
                name: event.item.name,
                arguments: event.item.arguments || "",
              };
              emit({
                type: "tool_use_start",
                callId: event.item.call_id,
                name: event.item.name,
              });
            }
            break;
          case "response.function_call_arguments.delta": {
            let call = calls[event.output_index];
            if (call && event.delta) {
              call.arguments += event.delta;
              emit({
                type: "tool_input_delta",
                callId: call.call_id,
                name: call.name,
                partialJson: event.delta,
              });
            }
            break;
          }
          case "response.reasoning_summary_part.added":
            if (thoughts[event.output_index] && event.summary_index > 0) {
              thoughts[event.output_index] += "\n\n";
            }
            break;
          case "response.reasoning_summary_text.delta":
            if (thoughts[event.output_index] !== undefined && event.delta) {
              thoughts[event.output_index] += event.delta;
            }
            break;
          case "response.output_item.done":
            if (
              event.item?.type == "reasoning" &&
              thoughts[event.output_index] !== undefined
            ) {
              let summary = (event.item.summary ?? [])
                .map(s => s.text)
                .filter(Boolean)
                .join("\n\n");
              emit({
                type: "thought",
                text: summary || thoughts[event.output_index],
              });
              delete thoughts[event.output_index];
            }
            if (event.item?.type == "function_call") {
              calls[event.output_index] = {
                call_id: event.item.call_id,
                name: event.item.name,
                arguments: event.item.arguments ?? "",
              };
            }
            break;
          case "response.completed": {
            completed = true;
            let usage = event.response?.usage;
            let reasoning = usage?.output_tokens_details?.reasoning_tokens;
            if (reasoning) {
              console.info(`ChatGPT: ${reasoning} reasoning tokens`);
            }
            if (usage) {
              emit({
                type: "usage",
                inputTokens: usage.input_tokens ?? 0,
                outputTokens: usage.output_tokens ?? 0,
              });
            }
            break;
          }
          case "response.incomplete": {
            let reason = event.response?.incomplete_details?.reason;
            throw new Error(
              reason
                ? t("orbito-assistant-chatgpt-incomplete-reason", { reason })
                : t("orbito-assistant-chatgpt-incomplete")
            );
          }
          case "response.failed":
          case "error": {
            let error = event.response?.error || event.error || event;
            throw new Error(
              t("orbito-assistant-chatgpt-error", {
                error:
                  error.message ||
                  error.code ||
                  t("orbito-assistant-chatgpt-response-failed"),
              })
            );
          }
        }
      }
    };
    while (true) {
      let { done, value } = await reader.read();
      if (done) {
        break;
      }
      handle(parser.push(decoder.decode(value, { stream: true })));
    }
    handle(parser.push(decoder.decode()));
    handle(parser.end());
    if (!completed && !signal.aborted) {
      throw new Error(t("orbito-assistant-chatgpt-ended-early"));
    }
    return { calls: calls.filter(Boolean) };
  },
};
