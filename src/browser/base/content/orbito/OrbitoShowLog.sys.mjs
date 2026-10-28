/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The event log of a Show Orbito demo: what the user did in one window,
 * kept in memory only, as steps. OrbitoShow.sys.mjs feeds it what the
 * OrbitoShow actors (actors/OrbitoShow*.sys.mjs) and the window's tabs
 * report; this module needs no page or window, so that it can be tested.
 *
 * Steps ({type, tab, at, ...}), tab being the tab's number in the demo
 * (1 for the first tab it saw) and at the ms since the demo started:
 *   click     role, name, text, form, section, menu (a name, or true for
 *             an unnamed one), offscreen (the target was outside the view
 *             the user had at the step before, so they scrolled to it)
 *   input     label, and value, or direct (the field's secret kind: its
 *             value is never read, the user types it themselves), or
 *             personal (the kind of personal information the value is)
 *   select    label, options (the chosen options' labels), and personal
 *             as for input; a choice in a secret field (a card's expiry
 *             month, say) is an input step with direct instead
 *   check     label, role ("checkbox" or "radio"), checked
 *   key       key ("Enter" or "Escape"), label (of the focused field)
 *   navigate  url, title, via ("back", "forward", "history", "reload" or
 *             none)
 *   tab       action ("open", "switch" or "close"), title, url
 *
 * Personal values are kept as they are, for the review of the demo (#212),
 * but serialize() hides them from the model behind placeholders.
 */

const MAX_TEXT = 100;
const MAX_VALUE = 1000;
const MAX_URL = 2000;
// Personal values shorter than this are not looked for elsewhere in the
// steps: they would match too much.
const MIN_MASKED = 3;

const SECRET_NAME = /otp|ssn|cvc|iban|secret|token|api[-_]?key/i;

// autocomplete tokens -> the kind of personal information.
const PERSONAL_TOKENS = {
  email: "email",
  tel: "tel",
  "street-address": "address",
  "address-line1": "address",
  "address-line2": "address",
  "address-line3": "address",
  "address-level1": "address",
  "address-level2": "address",
  "address-level3": "address",
  "address-level4": "address",
  "postal-code": "address",
  country: "address",
  "country-name": "address",
  name: "name",
  "given-name": "name",
  "additional-name": "name",
  "family-name": "name",
  "honorific-prefix": "name",
  "honorific-suffix": "name",
  nickname: "name",
  bday: "birthday",
  organization: "organization",
  "organization-title": "organization",
  username: "username",
};

const PERSONAL_TYPES = { email: "email", tel: "tel" };

const KEYS = { Enter: "Enter", Escape: "Escape", Esc: "Escape" };
const TAB_ACTIONS = new Set(["open", "switch", "close"]);
const VIAS = new Set(["back", "forward", "history", "reload"]);

/**
 * Text on one line: its runs of white space made single spaces, cut to
 * max with "…". For every Show Orbito module.
 */
export function oneLine(text, max = MAX_TEXT) {
  text = String(text ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/** A value as typed: line breaks kept, cut to MAX_VALUE. */
function clipValue(value) {
  value = String(value ?? "");
  return value.length > MAX_VALUE ? value.slice(0, MAX_VALUE - 1) + "…" : value;
}

/**
 * What a form field holds, from its attributes alone, so that the value
 * of a secret one is never read: {secret} with "password",
 * "payment-card", "one-time-code", "secret" or "file"; {personal} with
 * "email", "tel", "address", "name", "birthday", "organization" or
 * "username"; or {} for anything else.
 *
 * @param {{tag?: string, type?: string, autocomplete?: string,
 *   name?: string, id?: string, wasPassword?: boolean}} field
 */
export function fieldKind(field = {}) {
  let type = String(field.type ?? "").toLowerCase();
  let tokens = String(field.autocomplete ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (
    (field.tag == "input" && type == "password") ||
    field.wasPassword ||
    tokens.includes("current-password") ||
    tokens.includes("new-password")
  ) {
    return { secret: "password" };
  }
  if (tokens.some(token => token.startsWith("cc-"))) {
    return { secret: "payment-card" };
  }
  if (tokens.includes("one-time-code")) {
    return { secret: "one-time-code" };
  }
  if ([field.name, field.id].some(n => n && SECRET_NAME.test(n))) {
    return { secret: "secret" };
  }
  // A file's name and path are the user's own.
  if (field.tag == "input" && type == "file") {
    return { secret: "file" };
  }
  for (let token of tokens) {
    let personal =
      PERSONAL_TOKENS[token] ||
      (token.startsWith("tel-") && "tel") ||
      (token.startsWith("bday-") && "birthday");
    if (personal) {
      return { personal };
    }
  }
  if (field.tag == "input" && PERSONAL_TYPES[type]) {
    return { personal: PERSONAL_TYPES[type] };
  }
  return {};
}

/**
 * Whether an element was outside the view the user had: rect in page
 * coordinates, scroll the page's scroll position then, viewport its size.
 * An element that takes no space was never seen either way.
 */
export function offscreenAt(rect, scroll, viewport) {
  if (!rect.width || !rect.height) {
    return false;
  }
  return (
    rect.top + rect.height <= scroll.y ||
    rect.top >= scroll.y + viewport.height ||
    rect.left + rect.width <= scroll.x ||
    rect.left >= scroll.x + viewport.width
  );
}

/**
 * The step for an event the page or the window reported, without its tab
 * number and time, or null for one that is not recorded. Only the fields
 * of each step type are taken; the value of a secret field never is, even
 * if one came with it.
 */
export function stepFrom(event) {
  switch (event?.type) {
    case "click": {
      let step = { type: "click", role: oneLine(event.role), name: oneLine(event.name) };
      let text = oneLine(event.text);
      if (text && text != step.name) {
        step.text = text;
      }
      for (let key of ["form", "section"]) {
        let value = oneLine(event[key]);
        if (value) {
          step[key] = value;
        }
      }
      if (event.menu) {
        step.menu = typeof event.menu == "string" ? oneLine(event.menu) || true : true;
      }
      if (event.offscreen) {
        step.offscreen = true;
      }
      return step.name || step.text ? step : null;
    }
    case "input": {
      let step = { type: "input", label: oneLine(event.label) };
      let { secret, personal } = fieldKind(event.field);
      if (secret) {
        step.direct = secret;
        return step;
      }
      step.value = clipValue(event.value);
      if (personal) {
        step.personal = personal;
      }
      return step;
    }
    case "select": {
      let label = oneLine(event.label);
      let { secret, personal } = fieldKind(event.field);
      if (secret) {
        return { type: "input", label, direct: secret };
      }
      let step = { type: "select", label, options: Array.from(event.options ?? [], o => oneLine(o)) };
      if (personal) {
        step.personal = personal;
      }
      return step;
    }
    case "check":
      return {
        type: "check",
        label: oneLine(event.label),
        role: event.role == "radio" ? "radio" : "checkbox",
        checked: !!event.checked,
      };
    case "key": {
      let key = KEYS[event.key];
      return key ? { type: "key", key, label: oneLine(event.label) } : null;
    }
    case "navigate": {
      let url = String(event.url ?? "").slice(0, MAX_URL);
      if (!url || url == "about:blank") {
        return null;
      }
      let step = { type: "navigate", url, title: oneLine(event.title) };
      if (VIAS.has(event.via)) {
        step.via = event.via;
      }
      return step;
    }
    case "tab":
      if (!TAB_ACTIONS.has(event.action)) {
        return null;
      }
      return {
        type: "tab",
        action: event.action,
        title: oneLine(event.title),
        url: String(event.url ?? "").slice(0, MAX_URL),
      };
  }
  return null;
}

/** Whether step only updates last, the step before it, in place. */
function updates(last, step) {
  if (last?.type != step.type || last.tab != step.tab) {
    return false;
  }
  if (step.type == "input") {
    // Typing in the same field again: its latest value counts.
    return (
      last.label == step.label &&
      last.direct == step.direct &&
      last.personal == step.personal
    );
  }
  if (step.type == "navigate") {
    // The same page again, e.g. with its title known now.
    return last.url == step.url;
  }
  return false;
}

/** The personal value of a step, or null: what the user typed or chose. */
function personalValue(step) {
  if (!step.personal) {
    return null;
  }
  if (step.type == "input") {
    return step.value;
  }
  return step.type == "select" ? step.options.join(", ") : null;
}

/**
 * The forms a value may take in a URL, longest first: as it is,
 * percent-encoded (as encodeURIComponent or encodeURI writes it) and
 * form-encoded, with + for spaces. They are looked for in any case, so
 * %2f matches %2F too.
 */
function urlForms(value) {
  let forms = new Set([value]);
  for (let encoded of [encodeURIComponent(value), encodeURI(value)]) {
    forms.add(encoded);
    forms.add(encoded.replace(/%20/g, "+"));
  }
  forms.add(new URLSearchParams({ v: value }).toString().slice(2));
  return [...forms].sort((a, b) => b.length - a.length);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Text for the model: quoted so that a page cannot end a line or a block. */
function quote(text) {
  return JSON.stringify(String(text)).replace(/</g, "\\u003c");
}

function describe(step, mask) {
  let q = text => quote(mask(text));
  let label = step.label ? q(step.label) : "a field";
  switch (step.type) {
    case "click": {
      let what = [step.role, step.name ? q(step.name) : ""].filter(Boolean).join(" ");
      let parts = [`Clicked ${what || "the text"}`];
      if (step.text) {
        parts.push(`showing ${q(step.text)}`);
      }
      if (step.form) {
        parts.push(`in the form ${q(step.form)}`);
      }
      if (step.section) {
        parts.push(`under ${q(step.section)}`);
      }
      if (step.menu) {
        parts.push(step.menu === true ? "in a menu" : `in the menu ${q(step.menu)}`);
      }
      if (step.offscreen) {
        parts.push("(scrolled to it first)");
      }
      return parts.join(", ");
    }
    case "input":
      if (step.direct) {
        return `The user typed into ${label} themselves (${step.direct}; the value was not recorded)`;
      }
      if (step.personal) {
        return `Typed ${mask(step.value)} into ${label} (${step.personal}: an input candidate)`;
      }
      return `Typed ${q(step.value)} into ${label}`;
    case "select":
      if (step.personal) {
        return `Selected ${mask(personalValue(step))} in ${label} (${step.personal}: an input candidate)`;
      }
      return `Selected ${step.options.map(q).join(", ") || "nothing"} in ${label}`;
    case "check":
      return step.role == "radio"
        ? `Chose ${label}`
        : `${step.checked ? "Checked" : "Unchecked"} ${label}`;
    case "key":
      return step.label ? `Pressed ${step.key} in ${label}` : `Pressed ${step.key}`;
    case "navigate": {
      let went = {
        back: "Went back to",
        forward: "Went forward to",
        history: "Went through history to",
        reload: "Reloaded",
      }[step.via] || "Went to";
      return `${went} ${q(step.title || step.url)} (${q(step.url)})`;
    }
    case "tab": {
      let verb = { open: "Opened", switch: "Switched to", close: "Closed" }[step.action];
      let page = step.title || step.url;
      return `${verb} tab ${step.tab}${page ? ` ${q(page)}` : ""}`;
    }
  }
  return "";
}

/**
 * One demo's steps, in memory. The window's capture (OrbitoShow.sys.mjs)
 * adds to it; the live summary (#211) subscribes to it and serializes it;
 * the review (#212) reads its steps and candidates, then discards it.
 */
export class ShowLog {
  #steps = [];
  #listeners = new Set();
  // The page's tab key -> its number in the demo.
  #tabs = new Map();
  #discarded = false;

  /**
   * @param {object} [options]
   * @param {string} [options.goal] What the user said the demo is for.
   * @param {number} [options.startedAt] Epoch ms.
   */
  constructor({ goal = "", startedAt = Date.now() } = {}) {
    this.goal = oneLine(goal, MAX_VALUE);
    this.startedAt = startedAt;
  }

  /** Copies of the steps so far. */
  get steps() {
    return this.#steps.map(step => structuredClone(step));
  }

  get length() {
    return this.#steps.length;
  }

  get discarded() {
    return this.#discarded;
  }

  /**
   * Records an event: {type, tab, ...} as stepFrom takes it, tab being any
   * key of the tab it happened in. An event in the same field or page as
   * the step before only updates that step.
   *
   * @returns {object|null} The step added or updated, or null if the event
   *   is not recorded.
   */
  add(event, now = Date.now()) {
    if (this.#discarded) {
      return null;
    }
    let step = stepFrom(event);
    if (!step) {
      return null;
    }
    if (!this.#tabs.has(event.tab)) {
      this.#tabs.set(event.tab, this.#tabs.size + 1);
    }
    step = { ...step, tab: this.#tabs.get(event.tab), at: Math.max(0, now - this.startedAt) };
    let last = this.#steps.at(-1);
    let updated = updates(last, step);
    if (updated) {
      this.#steps[this.#steps.length - 1] = step;
    } else {
      this.#steps.push(step);
    }
    for (let listener of this.#listeners) {
      try {
        listener(structuredClone(step), { updated });
      } catch (e) {
        console.error(e);
      }
    }
    return structuredClone(step);
  }

  /**
   * Calls listener(step, {updated}) for every step added from now on, or
   * updated (the step before replaced). Returns what unsubscribes.
   */
  subscribe(listener) {
    if (this.#discarded) {
      return () => {};
    }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * The steps as text for the model, one numbered line each, with the
   * personal values put behind placeholders wherever they show ([email],
   * [email_2], ...), and those values as input candidates, which stay here
   * and are never sent: {text, candidates: [{placeholder, kind, label,
   * value}]}.
   */
  serialize() {
    let candidates = [];
    let byValue = new Map();
    let counts = {};
    for (let step of this.#steps) {
      let value = personalValue(step);
      if (value == null || byValue.has(value)) {
        continue;
      }
      let n = (counts[step.personal] = (counts[step.personal] ?? 0) + 1);
      let placeholder = n == 1 ? `[${step.personal}]` : `[${step.personal}_${n}]`;
      byValue.set(value, placeholder);
      candidates.push({ placeholder, kind: step.personal, label: step.label, value });
    }
    // Longest first, so that a value inside another is not replaced first.
    let masks = [...byValue]
      .filter(([value]) => value.length >= MIN_MASKED)
      .sort((a, b) => b[0].length - a[0].length)
      .map(([value, placeholder]) => [
        new RegExp(urlForms(value).map(escapeRegExp).join("|"), "gi"),
        placeholder,
      ]);
    let mask = text => {
      text = String(text);
      if (byValue.has(text)) {
        return byValue.get(text);
      }
      for (let [pattern, placeholder] of masks) {
        text = text.replace(pattern, placeholder);
      }
      return text;
    };
    let lines = [];
    if (this.goal) {
      lines.push(`Goal: ${quote(mask(this.goal))}`);
    }
    this.#steps.forEach((step, i) => {
      let where = step.type == "tab" ? "" : `[tab ${step.tab}] `;
      lines.push(`${i + 1}. ${where}${describe(step, mask)}`);
    });
    return { text: lines.join("\n"), candidates };
  }

  /** Forgets every step at once; the log records nothing after. */
  discard() {
    this.#discarded = true;
    this.#steps.length = 0;
    this.#steps = [];
    this.#tabs.clear();
    this.#listeners.clear();
    this.goal = "";
  }
}
