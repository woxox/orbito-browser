/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Reads the string fields of a tool's input while the model is still
 * writing it, kept free of chrome so it can be tested on its own. The input
 * is a JSON object cut off anywhere: in a key, in a value, in the middle of
 * an escape.
 */

const ESCAPES = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/**
 * The top-level string fields of a JSON object that may be cut off, as
 * {name: {value, complete}}. A value cut off is given as far as it goes,
 * leaving out an escape that is cut off; complete says whether its closing
 * quote has come. Fields after the first one cut off, and fields that are
 * not strings, are left out.
 *
 * @param {string} json
 * @returns {object}
 */
export function partialStrings(json) {
  let fields = {};
  let i = skipSpace(json, 0);
  if (json[i] != "{") {
    return fields;
  }
  i++;
  while (true) {
    i = skipSpace(json, i);
    if (json[i] == ",") {
      i++;
      continue;
    }
    if (json[i] != '"') {
      // The end of the object, or of what has come so far.
      return fields;
    }
    let key = readString(json, i);
    if (!key.complete) {
      return fields;
    }
    i = skipSpace(json, key.end);
    if (json[i] != ":") {
      return fields;
    }
    i = skipSpace(json, i + 1);
    if (i >= json.length) {
      return fields;
    }
    if (json[i] == '"') {
      let { value, complete, end } = readString(json, i);
      fields[key.value] = { value, complete };
      if (!complete) {
        return fields;
      }
      i = end;
    } else {
      i = skipValue(json, i);
      if (i < 0) {
        return fields;
      }
    }
  }
}

function skipSpace(json, i) {
  while (i < json.length && " \t\n\r".includes(json[i])) {
    i++;
  }
  return i;
}

/** The string starting at the quote at start: {value, complete, end}. */
function readString(json, start) {
  let value = "";
  let i = start + 1;
  while (i < json.length) {
    let c = json[i];
    if (c == '"') {
      return { value, complete: true, end: i + 1 };
    }
    if (c != "\\") {
      value += c;
      i++;
      continue;
    }
    let e = json[i + 1];
    if (e == undefined) {
      break;
    }
    if (e == "u") {
      let hex = json.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
        // Cut off in the middle, or not an escape at all: stop before it.
        break;
      }
      value += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    value += ESCAPES[e] ?? e;
    i += 2;
  }
  // Half a surrogate pair is not a character yet.
  if (/[\uD800-\uDBFF]$/.test(value)) {
    value = value.slice(0, -1);
  }
  return { value, complete: false, end: json.length };
}

/**
 * Skips a value that is not a string: the index of the "," or "}" after it,
 * or -1 if it is cut off.
 */
function skipValue(json, i) {
  let depth = 0;
  while (i < json.length) {
    let c = json[i];
    if (c == '"') {
      let { complete, end } = readString(json, i);
      if (!complete) {
        return -1;
      }
      i = end;
      continue;
    }
    if (c == "[" || c == "{") {
      depth++;
    } else if (c == "]" || c == "}") {
      if (!depth) {
        return i;
      }
      depth--;
    } else if (c == "," && !depth) {
      return i;
    }
    i++;
  }
  return -1;
}
