/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Skills: named instructions the user calls with "/name". A skill is a
 * SKILL.md file in the Anthropic Agent Skills format: front matter between
 * "---" lines with a name and a description, then the instructions. Orbito
 * also reads tools (the tool names it uses), output ("chat" or
 * "document") and source (what made it: "demo" for Show Orbito's); other
 * fields are ignored, so Claude Code skills read as they are, and other
 * readers ignore Orbito's.
 */

const OUTPUTS = ["chat", "document"];

function unquote(value) {
  let quoted = value.match(/^(["'])(.*)\1$/s);
  if (!quoted) {
    return value;
  }
  return quoted[1] == '"'
    ? quoted[2].replace(/\\(["\\])/g, "$1").replace(/\\n/g, "\n")
    : quoted[2].replace(/''/g, "'");
}

/**
 * The front matter's top-level fields. Enough YAML for skills: plain and
 * quoted strings, "|" and ">" blocks, [a, b] and "- a" lists. A field with
 * anything else indented under it (e.g. a nested map) becomes its text.
 */
function frontMatter(lines) {
  let fields = {};
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }
    let field = line.match(/^([\w-]+)\s*:(?:\s+(.*?))?\s*$/);
    if (!field) {
      throw new Error(`The front matter has a line that is not a field: ${line.trim()}`);
    }
    let [, key, value = ""] = field;
    let nested = [];
    while (
      i + 1 < lines.length &&
      (/^\s/.test(lines[i + 1]) || !lines[i + 1].trim())
    ) {
      nested.push(lines[++i]);
    }
    while (nested.length && !nested.at(-1).trim()) {
      nested.pop();
    }
    let block = value.match(/^([|>])[-+]?$/);
    if (block) {
      let indent = Math.min(
        ...nested.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length)
      );
      let text = nested.map(l => l.slice(indent));
      fields[key] =
        block[1] == "|"
          ? text.join("\n")
          : text.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ");
    } else if (/^\[.*\]$/.test(value)) {
      fields[key] = value
        .slice(1, -1)
        .split(",")
        .map(item => unquote(item.trim()))
        .filter(Boolean);
    } else if (!value && nested.length && nested.every(l => /^\s*-\s/.test(l) || !l.trim())) {
      fields[key] = nested
        .filter(l => l.trim())
        .map(l => unquote(l.replace(/^\s*-\s+/, "").trim()));
    } else {
      // A plain string may go on over indented lines.
      fields[key] = unquote(
        [value, ...nested.map(l => l.trim())].filter(Boolean).join(" ")
      );
    }
  }
  return fields;
}

/**
 * Reads a SKILL.md.
 *
 * @param {string} text
 * @returns {{name: string, description: string, tools: string[],
 *   output: "chat" | "document", source?: string, body: string}} source
 *   only when the front matter has one.
 * @throws {Error} Saying what is wrong, for a file that is not a skill.
 */
export function parseSkill(text) {
  let lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0].trim() != "---") {
    throw new Error("A skill starts with front matter between --- lines.");
  }
  let end = lines.findIndex((line, i) => i > 0 && line.trim() == "---");
  if (end < 0) {
    throw new Error("The skill's front matter has no closing --- line.");
  }
  let fields = frontMatter(lines.slice(1, end));
  let string = key => {
    let value = fields[key];
    if (typeof value != "string" || !value.trim()) {
      throw new Error(`The skill has no ${key}.`);
    }
    return value.trim().replace(/\s+/g, " ");
  };
  let name = string("name");
  let description = string("description");
  let tools = fields.tools ?? [];
  if (typeof tools == "string") {
    tools = tools.split(/[\s,]+/).filter(Boolean);
  }
  let output = fields.output ?? "chat";
  if (!OUTPUTS.includes(output)) {
    throw new Error(`The skill's output must be chat or document, not ${output}.`);
  }
  let source = typeof fields.source == "string" ? fields.source.trim() : "";
  let body = lines.slice(end + 1).join("\n").trim();
  return { name, description, tools, output, ...(source ? { source } : {}), body };
}

/**
 * Finds the skill a prompt calls: "/name", optionally followed by more
 * instructions. Names may have spaces, so the longest name that matches
 * wins.
 *
 * @param {string} prompt
 * @param {string[]} names The skills that can be called.
 * @returns {?{name: ?string, rest: string, called: string}} null if the
 *   prompt does not start with "/"; otherwise name is the skill called
 *   (null for none of names), called what follows the "/" up to the first
 *   space for an unknown one, and rest the more instructions.
 */
export function matchSkill(prompt, names) {
  let text = prompt.trim();
  if (!text.startsWith("/")) {
    return null;
  }
  text = text.slice(1);
  let name = names
    .filter(n => text == n || (text.startsWith(n) && /^\s/.test(text.slice(n.length))))
    .sort((a, b) => b.length - a.length)[0];
  if (!name) {
    return { name: null, rest: "", called: text.split(/\s/)[0] };
  }
  return { name, rest: text.slice(name.length).trim(), called: name };
}

/**
 * How a skill made from a Show Orbito demo ("source: demo") is done again,
 * after its own instructions: wherever the model gets them, called with
 * "/name" (skillBlock) or got with use_skill.
 */
export const DEMO_INSTRUCTIONS = [
  "This skill was made from a demo the user gave in the browser. Do its steps in order on the live pages, deciding at each one what to read, click or type: the pages may look different from when it was recorded.",
  "- Before you start each step, call skill_step with its number, so the user sees where you are.",
  "- At a step the user enters themselves (a password, a payment card, a one-time code), call skill_step with its number and nothing else: it returns once the user has entered it. Never type such a value or ask for it in the chat.",
  "- When you cannot find what a step needs (a link, a button, a field) on the page, call skill_step with its number, found false and what you could not find in missing, then tell the user in one or two sentences what you could not find and end your reply. Do not look for another way, open other pages or guess.",
].join("\n");

/**
 * How a skill a message called is put before the user's words for the
 * model, the same for every backend.
 *
 * @param {string} name
 * @param {string} body
 * @param {string} [source] The skill's source; "demo" adds
 *   DEMO_INSTRUCTIONS.
 */
export function skillBlock(name, body, source = "") {
  return [
    `Skill instructions (/${name}), which the user called for this request:`,
    body,
    ...(source == "demo" ? ["", DEMO_INSTRUCTIONS] : []),
    "End of skill instructions.",
  ].join("\n");
}

// Letters and digits, with spaces, "-", "_" and "." between them, so that a
// name works after "/" and as a folder name.
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_.-]*(?: [\p{L}\p{N}_.-]+)*$/u;
const MAX_NAME = 64;
const TOOL = /^[\w.-]+$/;

/**
 * Checks a name for a skill the user writes.
 *
 * @throws {Error} Saying what the rule is.
 */
export function checkSkillName(name) {
  if (!NAME.test(name) || name.length > MAX_NAME) {
    throw new Error(
      `A skill name is at most ${MAX_NAME} letters, digits, single spaces, -, _ or ., and starts with a letter or digit.`
    );
  }
}

// A front matter value as YAML: plain where that reads back the same,
// otherwise in single quotes.
function yamlString(value) {
  return /^[^\s'"\[\]{}|>&*!%@`#,?:-]/.test(value) &&
    !/: | #|\s$|:$/.test(value)
    ? value
    : `'${value.replace(/'/g, "''")}'`;
}

/**
 * Writes a skill the user filled in as a SKILL.md, checking it as it would
 * be read back.
 *
 * @param {{name: string, description: string, tools?: string[],
 *   output?: string, source?: string, body: string}} skill
 * @returns {string} The SKILL.md text.
 * @throws {Error} Saying what is wrong.
 */
export function skillFile({ name, description, tools = [], output = "chat", source = "", body }) {
  name = String(name ?? "").trim();
  description = String(description ?? "").trim().replace(/\s+/g, " ");
  body = String(body ?? "").trim();
  if (!name) {
    throw new Error("The skill has no name.");
  }
  checkSkillName(name);
  if (!description) {
    throw new Error("The skill has no description.");
  }
  if (!body) {
    throw new Error("The skill has no instructions.");
  }
  let bad = tools.find(tool => !TOOL.test(tool));
  if (bad != null) {
    throw new Error(
      `${bad} is not a tool name: use letters, digits, _, - or ., separated by commas.`
    );
  }
  source = String(source ?? "").trim();
  if (source && !TOOL.test(source)) {
    throw new Error(`${source} is not a skill source.`);
  }
  let text = [
    "---",
    `name: ${yamlString(name)}`,
    `description: ${yamlString(description)}`,
    ...(tools.length ? [`tools: [${tools.join(", ")}]`] : []),
    `output: ${output}`,
    ...(source ? [`source: ${source}`] : []),
    "---",
    body,
    "",
  ].join("\n");
  // Throws for an output that is neither chat nor document.
  parseSkill(text);
  return text;
}

/**
 * The SKILL.md in a model's reply, which may sit in a code fence or follow a
 * sentence or two.
 *
 * @param {string} reply
 * @returns {object} The skill, as parseSkill reads it.
 * @throws {Error} Saying what is wrong, if the reply has no skill.
 */
export function skillDraft(reply) {
  let text = String(reply);
  let fence = text.match(/^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1\s*$/m);
  if (fence && /^---\s*$/m.test(fence[2])) {
    text = fence[2];
  }
  let start = text.search(/^---\s*$/m);
  if (start < 0) {
    throw new Error("The draft has no front matter between --- lines.");
  }
  return parseSkill(text.slice(start));
}
