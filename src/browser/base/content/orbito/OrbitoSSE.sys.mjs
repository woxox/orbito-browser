/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * A text/event-stream parser, for the MCP client and the ChatGPT backend.
 */

/**
 * Splits a text/event-stream into events as chunks of it arrive.
 */
export class SSEParser {
  #buffer = "";
  #data = [];
  #event = "";
  #id = null;
  #skipLF = false;

  /** @returns {{event: string, data: string, id: ?string}[]} */
  push(text) {
    // A chunk ending in "\r" may be followed by the "\n" of the same "\r\n".
    if (this.#skipLF && text.startsWith("\n")) {
      text = text.slice(1);
    }
    this.#skipLF = text.endsWith("\r");
    this.#buffer += text;
    let events = [];
    let lines = this.#buffer.split(/\r\n|\r|\n/);
    // The last line may not be complete yet.
    this.#buffer = lines.pop();
    for (let line of lines) {
      this.#line(line, events);
    }
    return events;
  }

  /** The stream ended: delivers an event left without its blank line. */
  end() {
    let events = [];
    if (this.#buffer) {
      this.#line(this.#buffer, events);
      this.#buffer = "";
    }
    this.#line("", events);
    return events;
  }

  #line(line, events) {
    if (!line) {
      if (this.#data.length) {
        events.push({
          event: this.#event || "message",
          data: this.#data.join("\n"),
          id: this.#id,
        });
      }
      this.#data = [];
      this.#event = "";
      return;
    }
    if (line.startsWith(":")) {
      return;
    }
    let colon = line.indexOf(":");
    let field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field == "data") {
      this.#data.push(value);
    } else if (field == "event") {
      this.#event = value;
    } else if (field == "id") {
      this.#id = value;
    }
  }
}
