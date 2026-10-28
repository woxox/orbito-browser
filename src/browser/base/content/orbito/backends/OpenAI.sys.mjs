/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Backend for OpenAI-compatible Chat Completions endpoints (OpenAI,
 * OpenRouter, Ollama, LM Studio, ...). Streams each completion and runs the
 * tool loop itself: while the model asks for tools, run them through the
 * core and send the results back. See OrbitoAssistantCore.sys.mjs for the
 * backend interface.
 */

import {
  cachedContextWindow,
  CATALOG_TIMEOUT,
  fetchModelsJSON,
  firstWindow,
} from "chrome://browser/content/orbito/OrbitoContextUsage.sys.mjs";
import { openAIMessages } from "chrome://browser/content/orbito/OrbitoHistory.sys.mjs";
import { runToolCalls } from "chrome://browser/content/orbito/OrbitoToolCalls.sys.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

// OpenAI's own models that do not chat: images, speech, embeddings, ...
const NOT_CHAT =
  /(?:^|-)(?:audio|realtime|tts|transcribe|image|search|embedding|moderation|dall-e|whisper|babbage|davinci)(?:-|$)/;

/**
 * The models of a GET /models answer, as models() gives them: OpenAI's own
 * only those that chat, newest first; others' in their order.
 *
 * @param {object[]} data The answer's data.
 * @param {string} baseURL Where it came from.
 * @returns {{id: string, label: ?string}[]}
 */
export function listedModels(data, baseURL) {
  let models = (Array.isArray(data) ? data : []).filter(
    m => typeof m?.id == "string" && m.id
  );
  if (new URL(baseURL).hostname == "api.openai.com") {
    models = models
      .filter(m => /^(?:gpt-|o\d|chatgpt-)/.test(m.id) && !NOT_CHAT.test(m.id))
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  }
  return models.map(m => ({
    id: m.id,
    label: typeof m.name == "string" && m.name != m.id ? m.name : null,
  }));
}

export const OpenAIBackend = {
  /**
   * The models the endpoint lists (GET /models).
   *
   * @param {object} settings {baseURL, apiKey}.
   * @returns {Promise<{id: string, label: ?string}[]>}
   */
  async models({ baseURL, apiKey }) {
    let { data } = await fetchModelsJSON(
      `${baseURL}/models`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
      CATALOG_TIMEOUT
    );
    return listedModels(data, baseURL);
  },

  async run({
    history,
    prompt,
    system,
    tools,
    model,
    apiKey,
    baseURL,
    signal,
    callTool,
    emit,
  }) {
    let messages = [
      { role: "system", content: system },
      ...openAIMessages(history),
      { role: "user", content: prompt },
    ];
    let functions = tools.map(({ name, description, schema }) => ({
      type: "function",
      function: { name, description, parameters: schema },
    }));
    let concurrent = new Set(
      tools.filter(tool => tool.concurrent).map(tool => tool.name)
    );

    while (true) {
      let { content, toolCalls } = await this._complete({
        baseURL,
        apiKey,
        body: {
          model,
          stream: true,
          // A last chunk with the completion's token usage.
          stream_options: { include_usage: true },
          messages,
          ...(functions.length ? { tools: functions } : {}),
        },
        signal,
        emit,
      });
      if (!toolCalls.length) {
        return;
      }
      messages.push({
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls.map(({ id, name, args }) => ({
          id,
          type: "function",
          function: { name, arguments: args },
        })),
      });
      // Tool messages carry text only, so images follow in a user message.
      let images = [];
      let results = await runToolCalls(
        toolCalls,
        ({ name }) => concurrent.has(name),
        ({ name, args }) => {
          let input = {};
          let inputError;
          try {
            input = args.trim() ? JSON.parse(args) : {};
          } catch {
            inputError = "The arguments were not valid JSON.";
          }
          return callTool(name, input, { inputError });
        }
      );
      for (let [i, { id }] of toolCalls.entries()) {
        let result = results[i];
        messages.push({
          role: "tool",
          tool_call_id: id,
          content: result.ok ? result.content : `Error: ${result.content}`,
        });
        for (let { mimeType, data } of result.images || []) {
          images.push(
            { type: "text", text: `Image from tool call ${id}:` },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${data}` },
            }
          );
        }
      }
      if (images.length) {
        messages.push({ role: "user", content: images });
      }
      if (signal.aborted) {
        return;
      }
    }
  },

  /**
   * Streams one completion, emitting its text as it arrives, and its token
   * usage when the server reports it.
   *
   * @returns {Promise<{content: string, toolCalls: object[]}>}
   */
  /**
   * The model's context window as the endpoint tells it, or null: OpenAI's
   * own does not. In the model's entry of GET /models: context_length
   * (OpenRouter), max_model_len (vLLM), context_window, or meta.n_ctx_train
   * (llama.cpp); else LM Studio's and Ollama's own APIs next to /v1.
   *
   * @param {string} model
   * @param {object} settings {baseURL, apiKey}.
   * @returns {Promise<?number>}
   */
  contextWindow(model, { baseURL, apiKey }) {
    return cachedContextWindow(`openai ${baseURL} ${model}`, () =>
      this._fetchContextWindow(model, baseURL, apiKey)
    );
  },

  async _fetchContextWindow(model, baseURL, apiKey) {
    let request = (url, options = {}) =>
      fetchModelsJSON(url, {
        ...options,
        headers: { Authorization: `Bearer ${apiKey}`, ...options.headers },
      });
    let { data } = await request(`${baseURL}/models`);
    let entry = (Array.isArray(data) && data.find(m => m?.id == model)) || {};
    let window = firstWindow(
      entry.context_length,
      entry.top_provider?.context_length,
      entry.max_model_len,
      entry.context_window,
      entry.meta?.n_ctx_train
    );
    if (
      window ||
      !baseURL.endsWith("/v1") ||
      new URL(baseURL).hostname == "api.openai.com"
    ) {
      return window;
    }
    let root = baseURL.slice(0, -"/v1".length);
    // LM Studio: the context the model is loaded with, else its most.
    try {
      let lmStudio = await request(
        `${root}/api/v0/models/${encodeURIComponent(model)}`
      );
      window = firstWindow(
        lmStudio.loaded_context_length,
        lmStudio.max_context_length
      );
    } catch {}
    if (window) {
      return window;
    }
    // Ollama: num_ctx when the model sets it, else its most.
    try {
      let ollama = await request(`${root}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      window = firstWindow(
        +/^num_ctx\s+(\d+)/m.exec(ollama.parameters ?? "")?.[1],
        ...Object.entries(ollama.model_info ?? {})
          .filter(([key]) => key.endsWith(".context_length"))
          .map(([, value]) => value)
      );
    } catch {}
    return window;
  },

  async _complete({ baseURL, apiKey, body, signal, emit }) {
    let response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      let detail = "";
      try {
        detail = (await response.json())?.error?.message || "";
      } catch {}
      let error = new Error(
        t("orbito-assistant-openai-error", {
          status: String(response.status),
          detail,
        }).trim()
      );
      error.needsKey = response.status == 401;
      throw error;
    }

    let content = "";
    // Indexed as the deltas are; some servers send a whole call at once.
    let toolCalls = [];
    let reader = response.body.getReader();
    let decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      let { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let lines = buffer.split("\n");
      buffer = lines.pop();
      for (let line of lines) {
        line = line.trim();
        if (!line.startsWith("data:")) {
          continue;
        }
        let data = line.slice(5).trim();
        if (data == "[DONE]") {
          continue;
        }
        let chunk = JSON.parse(data);
        if (chunk.usage) {
          emit({
            type: "usage",
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          });
        }
        let delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
          emit({ type: "text", text: delta.content });
        }
        for (let call of delta?.tool_calls || []) {
          let index = call.index ?? toolCalls.length;
          let entry = (toolCalls[index] ??= { id: "", name: "", args: "" });
          entry.id ||= call.id || "";
          if (!entry.name && call.function?.name) {
            entry.name = call.function.name;
            // The id the events go by, even if the server sends none.
            entry.streamId = entry.id || `call_${index}`;
            emit({
              type: "tool_use_start",
              callId: entry.streamId,
              name: entry.name,
            });
          }
          let piece = call.function?.arguments || "";
          entry.args += piece;
          if (piece && entry.name) {
            emit({
              type: "tool_input_delta",
              callId: entry.streamId,
              name: entry.name,
              partialJson: piece,
            });
          }
        }
      }
    }
    return {
      content,
      toolCalls: toolCalls.filter(Boolean).map(({ id, name, args }, i) => ({
        id: id || `call_${i}`,
        name,
        args,
      })),
    };
  },
};
