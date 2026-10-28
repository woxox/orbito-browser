/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Content side of run_script, for OrbitoPageChild.sys.mjs: runs a script
 * as the page does and returns its value as JSON, with the page's secret
 * fields out of its reach.
 */

import { secretKind } from "chrome://browser/content/orbito/actors/OrbitoPageChild.sys.mjs";
import {
  clearTimeout,
  setTimeout,
} from "resource://gre/modules/Timer.sys.mjs";

// Shorter secrets would be found in too much else to remove them from a
// script's result.
const MIN_SECRET_REDACTED = 4;
const REDACTED = "[secret removed]";

// Evaluated in a script's sandbox: given done(kind, text), a function that
// settles the script's value and hands done its JSON ("value"), "undefined",
// or what kept it from being JSON ("error"). It runs as the page, so the
// page could only spoil its own data. Its describe() is describeError()'s
// twin, on the sandbox's side.
const SCRIPT_RUNNER = `(function (done) {
  "use strict";
  const PLAIN = new Set(["Object", "Array", "Arguments"]);
  const keyPath = (path, key) =>
    /^[A-Za-z_$][\\w$]*$/.test(key) ? path + "." + key : path + "[" + JSON.stringify(key) + "]";
  function serialize(root) {
    let ancestors = [];
    let paths = [];
    function walk(value, path) {
      switch (typeof value) {
        case "string":
        case "boolean":
          return JSON.stringify(value);
        case "number":
          return Number.isFinite(value) ? String(value) : "null";
        case "undefined":
          return undefined;
        case "bigint":
          throw new Error(path + " is a BigInt, which JSON cannot hold. Convert it with String().");
        case "symbol":
          throw new Error(path + " is a Symbol, which JSON cannot hold.");
        case "function":
          throw new Error(path + " is a function, which JSON cannot hold. Call it, or return what you need from it.");
      }
      if (value === null) {
        return "null";
      }
      if (typeof value.nodeType == "number" && typeof value.nodeName == "string") {
        throw new Error(path + " is a DOM node (" + value.nodeName.toLowerCase() + "), which JSON cannot hold. Return its textContent or attributes instead.");
      }
      if (value === value.window) {
        throw new Error(path + " is a window, which JSON cannot hold.");
      }
      let seen = ancestors.indexOf(value);
      if (seen != -1) {
        throw new Error(path + " refers back to " + paths[seen] + ", a cycle JSON cannot hold.");
      }
      if (typeof value.toJSON == "function") {
        return walk(value.toJSON(), path);
      }
      let tag = Object.prototype.toString.call(value).slice(8, -1);
      let array = Array.isArray(value);
      if (!array && !PLAIN.has(tag)) {
        throw new Error(path + " is a " + tag + ", which JSON cannot hold. Convert it to an array or a plain object first (e.g. Array.from or Object.fromEntries).");
      }
      ancestors.push(value);
      paths.push(path);
      let parts = [];
      if (array) {
        for (let i = 0; i < value.length; i++) {
          parts.push(walk(value[i], path + "[" + i + "]") ?? "null");
        }
      } else {
        for (let key of Object.keys(value)) {
          let json = walk(value[key], keyPath(path, key));
          if (json !== undefined) {
            parts.push(JSON.stringify(key) + ":" + json);
          }
        }
      }
      ancestors.pop();
      paths.pop();
      return array ? "[" + parts.join(",") + "]" : "{" + parts.join(",") + "}";
    }
    return walk(root, "The result");
  }
  function describe(error) {
    try {
      return error instanceof Error || (error && typeof error.message == "string")
        ? (error.name || "Error") + ": " + error.message
        : String(error);
    } catch {
      return "an error";
    }
  }
  return function (value) {
    Promise.resolve(value).then(
      settled => {
        let json;
        try {
          json = serialize(settled);
        } catch (e) {
          done("error", describe(e));
          return;
        }
        done(json === undefined ? "undefined" : "value", json ?? "");
      },
      e => done("error", "The script's promise was rejected with " + describe(e))
    );
  };
})`;

let lazyDebugger = null;

/**
 * A Debugger that ends the code of its debuggees once overdue() says so,
 * even in a loop that never yields: each frame steps through it.
 */
function watchdog(debuggees, overdue) {
  if (!lazyDebugger) {
    let { addDebuggerToGlobal } = ChromeUtils.importESModule(
      "resource://gre/modules/jsdebugger.sys.mjs"
    );
    let global = Cu.Sandbox(
      Services.scriptSecurityManager.getSystemPrincipal(),
      { freshCompartment: true, invisibleToDebugger: true }
    );
    addDebuggerToGlobal(global);
    lazyDebugger = global.Debugger;
  }
  let dbg = new lazyDebugger();
  for (let debuggee of debuggees) {
    dbg.addDebuggee(debuggee);
  }
  // null ends the code; undefined lets it go on.
  let check = () => (overdue() ? null : undefined);
  dbg.onEnterFrame = frame => {
    if (overdue()) {
      return null;
    }
    frame.onStep = check;
    return undefined;
  };
  return dbg;
}

function describeError(error) {
  try {
    let { name, message } = error;
    return message ? `${name || "Error"}: ${message}` : String(error);
  } catch {
    return "an error";
  }
}

/**
 * The text with the secrets in it, raw or JSON-escaped, removed.
 *
 * @returns {{text: string, count: number}}
 */
function redact(text, secrets) {
  let count = 0;
  for (let secret of new Set(secrets)) {
    if (secret.length < MIN_SECRET_REDACTED) {
      continue;
    }
    for (let form of new Set([secret, JSON.stringify(secret).slice(1, -1)])) {
      let parts = text.split(form);
      count += parts.length - 1;
      text = parts.join(REDACTED);
    }
  }
  return { text, count };
}

/**
 * Empties the secret fields of the document, its shadow trees and the
 * frames it can reach (their values and default values, or a <select>'s
 * choice), until restore(). A field the user filled in again meanwhile
 * keeps what they typed.
 *
 * @returns {{secrets: string[], restore: Function}} secrets the values and
 *   default values the fields had.
 */
function hideSecrets(document) {
  let fields = [];
  let visit = root => {
    for (let el of root.querySelectorAll("*")) {
      if (
        ["input", "textarea", "select"].includes(el.localName) &&
        secretKind(el)
      ) {
        fields.push(el);
      }
      if (el.openOrClosedShadowRoot) {
        visit(el.openOrClosedShadowRoot);
      }
      let frame =
        (el.localName == "iframe" || el.localName == "frame") &&
        el.contentDocument;
      if (frame) {
        visit(frame);
      }
    }
  };
  visit(document);
  let secrets = [];
  let restores = fields.map(el => {
    if (el.localName == "select") {
      let chosen = Array.from(el.options, o => o.selected);
      el.selectedIndex = -1;
      return () => {
        if (el.selectedIndex == -1) {
          Array.from(el.options, (o, i) => (o.selected = chosen[i]));
        }
      };
    }
    let { value, defaultValue } = el;
    secrets.push(value, defaultValue);
    if (value) {
      el.value = "";
    }
    if (defaultValue) {
      el.defaultValue = "";
    }
    return () => {
      if (defaultValue) {
        el.defaultValue = defaultValue;
      }
      if (value && !el.value) {
        el.value = value;
      }
    };
  });
  return { secrets, restore: () => restores.forEach(restore => restore()) };
}

/**
 * Runs a script as the page does (in a sandbox with the page's principal
 * that sees its window as the page sees it), awaits the value of its last
 * expression, and returns it as JSON. The secret fields are emptied while
 * it runs and filled again after, and any of their values found in the
 * result, or in what went wrong, are removed. Past timeoutMs the script is
 * ended, even in a loop, as is page code it calls; what it left waiting in
 * the sandbox never runs. Code it hands the page to run later (a string
 * for setTimeout, window.eval, a <script>) is the page's own, though, and
 * may.
 *
 * @param {Window} win The page's window.
 * @returns {Promise<{json?: string, length?: number, redacted?: number,
 *   timedOut?: boolean}>} json cut to maxChars, length the whole JSON's;
 *   no json when the value was undefined.
 * @throws What went wrong in the script.
 */
export async function runScript(win, { code, timeoutMs, maxChars }) {
  let sandbox = Cu.Sandbox(win, {
    sandboxPrototype: win,
    sandboxName: "Orbito run_script",
    sameZoneAs: win,
    wantXrays: false,
  });
  let timedOut = false;
  let deadline = ChromeUtils.now() + timeoutMs;
  let overdue = () => (timedOut ||= ChromeUtils.now() > deadline);
  let dbg = watchdog([sandbox, win], overdue);
  let hidden = hideSecrets(win.document);
  let failed = text => new Error(redact(text, hidden.secrets).text);
  let { promise, resolve } = Promise.withResolvers();
  let timer = setTimeout(() => {
    timedOut = true;
    resolve(null);
  }, timeoutMs);
  let outcome;
  try {
    let done = Cu.exportFunction(
      (kind, text) => resolve({ kind: String(kind), text: String(text) }),
      sandbox
    );
    let settle = Cu.evalInSandbox(SCRIPT_RUNNER, sandbox)(done);
    let value;
    try {
      value = Cu.evalInSandbox(code, sandbox, null, "orbito-script.js", 1);
    } catch (e) {
      if (!overdue()) {
        throw failed(`The script threw ${describeError(e)}`);
      }
    }
    if (overdue()) {
      return { timedOut: true };
    }
    settle(value);
    outcome = await promise;
  } finally {
    clearTimeout(timer);
    dbg.removeAllDebuggees();
    // Cuts what the page holds of the sandbox (callbacks, awaits), so none
    // of it runs once the secrets are back.
    Cu.nukeSandbox(sandbox);
    hidden.restore();
  }
  if (!outcome) {
    return { timedOut: true };
  }
  if (outcome.kind == "error") {
    throw failed(outcome.text);
  }
  if (outcome.kind == "undefined") {
    return {};
  }
  let { text, count } = redact(outcome.text, hidden.secrets);
  return {
    json: text.slice(0, maxChars),
    length: text.length,
    redacted: count,
  };
}
