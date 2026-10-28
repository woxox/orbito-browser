/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Doing a skill made from a Show Orbito demo again ("source: demo"): its
 * inputs and steps as its body has them (demoSteps, the format
 * OrbitoShowSkill.sys.mjs writes), the reply part that shows the steps and
 * the one the agent is on (newSkillStepsPart), and the rules for what the
 * agent reports with the skill_step tool (reportStep, enterStep,
 * unattendedEntryStopMessage, stoppedError).
 *
 * The agent says which step it is on by calling skill_step with its
 * number, before doing it: a tool call works the same on every backend,
 * where words in the reply would have to be found and hidden again. At a
 * step the user enters themselves the core asks the user, whatever the
 * PermissionMode, and the agent goes on once they have. A step whose
 * target the agent cannot find is reported with found false: the skill
 * then stops there, and every tool but think is refused for the rest of
 * the reply.
 *
 * The part, kept in the reply, is
 *   {type: "skill_steps", name, steps: [{text, direct}], current, entered,
 *    failed}
 * with current the step reported last (0 before any), entered the steps
 * the user entered themselves, and failed null or {step, missing, entry}
 * (entry: a step the user was to enter, and did not).
 *
 * This module needs no window or model, so that it can be tested.
 */

import { oneLine } from "chrome://browser/content/orbito/OrbitoShowLog.sys.mjs";
import {
  DEMO_HEADINGS,
  USER_ENTRY_PHRASES,
} from "chrome://browser/content/orbito/OrbitoShowSkill.sys.mjs";

/** The tool the agent reports its step with. */
export const STEP_TOOL = "skill_step";

const MAX_MISSING = 200;

// "- query: 검색할 상품명 (예: "무선 마우스")"; the example as
// demoSkill writes it, in JSON.
function inputLine(name, rest) {
  let description = rest;
  let example = "";
  let shown = rest.match(/\s*\((?:예:|e\.g\.)\s*("(?:[^"\\]|\\.)*")\)\s*$/);
  if (shown) {
    try {
      example = String(JSON.parse(shown[1]));
      description = rest.slice(0, shown.index);
    } catch {}
  }
  return { name, description: description.trim(), example };
}

function stepLine(text) {
  let direct = false;
  for (let phrase of USER_ENTRY_PHRASES) {
    if (text.includes(phrase)) {
      text = text.split(phrase).join(" ");
      direct = true;
    }
  }
  return { text: oneLine(text, 500), direct };
}

/**
 * The inputs and steps of a skill made from a demo: those of its 입력 /
 * Inputs and 단계 / Steps sections, or, without a steps section, every
 * numbered line outside the inputs. A step goes on over the indented lines
 * under it. A step the user enters themselves is direct, with the phrase
 * that says so left out of its text.
 *
 * @param {string} body
 * @returns {{inputs: {name: string, description: string, example: string}[],
 *   steps: {text: string, direct: boolean}[]}}
 */
export function demoSteps(body) {
  let inputs = [];
  let sections = { steps: [], loose: [] };
  let section = null;
  let last = null;
  for (let line of String(body ?? "").split(/\r?\n/)) {
    let heading = line.match(/^#{1,6}\s+(.*?)[\s#]*$/);
    if (heading) {
      let title = heading[1].trim();
      section = DEMO_HEADINGS.inputs.includes(title)
        ? "inputs"
        : DEMO_HEADINGS.steps.includes(title)
          ? "steps"
          : null;
      last = null;
      continue;
    }
    if (section == "inputs") {
      let item = line.match(/^\s*[-*]\s+([\p{L}\p{N}_]+)\s*(?::\s*(.*?))?\s*$/u);
      if (item) {
        inputs.push(inputLine(item[1], item[2] ?? ""));
      }
      continue;
    }
    let numbered = line.match(/^\s*\d+[.)]\s+(.*\S)\s*$/);
    if (numbered) {
      last = { raw: numbered[1] };
      sections[section == "steps" ? "steps" : "loose"].push(last);
    } else if (last && /^\s+\S/.test(line)) {
      last.raw += ` ${line.trim()}`;
    } else if (line.trim()) {
      last = null;
    }
  }
  let raw = sections.steps.length ? sections.steps : sections.loose;
  return { inputs, steps: raw.map(step => stepLine(step.raw)) };
}

/**
 * The reply part that shows a skill's steps, before the agent reports
 * any; null for a skill that was not made from a demo or has no steps.
 */
export function newSkillStepsPart(skill) {
  if (skill?.source != "demo") {
    return null;
  }
  let { steps } = demoSteps(skill.body);
  if (!steps.length) {
    return null;
  }
  return {
    type: "skill_steps",
    name: skill.name,
    steps,
    current: 0,
    entered: [],
    failed: null,
  };
}

/**
 * What a step report does, by the rules: a step number of the skill;
 * found false stops the skill there; a step the user enters themselves
 * is asked ("confirm", then enterStep or unattendedEntryStopMessage), and
 * no later step may be reported before it. Changes the part.
 *
 * @param {object} part As newSkillStepsPart made it.
 * @param {object} input skill_step's {step, found, missing}.
 * @returns {{action: "go" | "confirm" | "stop", step: number,
 *   content?: string}} content, what the agent is told, for go and stop.
 * @throws {Error} Telling the agent what is wrong; the part is unchanged.
 */
export function reportStep(part, input) {
  let stopped = stoppedError(part);
  if (stopped) {
    throw new Error(stopped);
  }
  let count = part.steps.length;
  let n = input?.step;
  if (!Number.isInteger(n) || n < 1 || n > count) {
    throw new Error(
      `step is the number of a step of /${part.name}, from 1 to ${count}.`
    );
  }
  if (input.found === false) {
    let missing = oneLine(input.missing, MAX_MISSING);
    part.current = n;
    part.failed = { step: n, missing, entry: false };
    let what = missing ? `“${missing}” was not found` : "what it needs was not found";
    return {
      action: "stop",
      step: n,
      content: `The skill stops at step ${n}. Tell the user, in one or two sentences, that step ${n} could not be done because ${what}, and end your reply. Do not look for another way.`,
    };
  }
  let skipped = part.steps.findIndex(
    (step, i) => i < n - 1 && step.direct && !part.entered.includes(i + 1)
  );
  if (skipped >= 0) {
    throw new Error(
      `Step ${skipped + 1} is one the user enters themselves: report it with ${STEP_TOOL} first and wait for them.`
    );
  }
  part.current = n;
  if (part.steps[n - 1].direct && !part.entered.includes(n)) {
    return { action: "confirm", step: n };
  }
  return {
    action: "go",
    step: n,
    content: `Step ${n} of ${count}: ${part.steps[n - 1].text}`,
  };
}

/**
 * After the user was asked at a step they enter themselves: whether they
 * went on. Changes the part.
 *
 * @returns {string} What the agent is told.
 */
export function enterStep(part, n, entered) {
  if (!entered) {
    part.failed = { step: n, missing: "", entry: true };
    return `The user did not go on, so the skill stops at step ${n}. Do nothing more and end your reply.`;
  }
  if (!part.entered.includes(n)) {
    part.entered.push(n);
  }
  let next =
    n < part.steps.length ? `go on with step ${n + 1}` : "finish the task";
  return `The user entered step ${n} themselves. Read the page again to see where it is now, then ${next}. Never type what they entered.`;
}

/**
 * A step the user enters themselves in a question nobody watches (a
 * scheduled task): the skill stops there. Changes the part.
 *
 * @returns {string} What the agent is told.
 */
export function unattendedEntryStopMessage(part, n) {
  part.failed = { step: n, missing: "", entry: true };
  return `Step ${n} is one the user enters themselves, and nobody is here to do it. The skill stops at step ${n}: say so in one or two sentences and do nothing more.`;
}

/**
 * The error every tool but think gets once the skill has stopped; null
 * while it goes on.
 */
export function stoppedError(part) {
  if (!part?.failed) {
    return null;
  }
  return `The skill /${part.name} stopped at step ${part.failed.step}: do nothing more, tell the user why in one or two sentences and end your reply.`;
}

/**
 * How each step shows: "done", "current", "failed" or "pending". Once the
 * reply ended well at the last step, that one is done too.
 *
 * @param {object} part
 * @param {object} [options]
 * @param {boolean} [options.finished] The reply ended and was not stopped.
 * @returns {string[]}
 */
export function stepStates(part, { finished = false } = {}) {
  let { current, failed } = part;
  let count = part.steps.length;
  return part.steps.map((step, i) => {
    let n = i + 1;
    if (failed?.step == n) {
      return "failed";
    }
    if (n < current || (n == current && finished && !failed && n == count)) {
      return "done";
    }
    return n == current ? "current" : "pending";
  });
}

/**
 * The words a scheduled task puts after the skill's name for its inputs:
 * "name: value" lines, for the inputs with a value.
 *
 * @param {object} values {name: value}
 * @returns {string}
 */
export function inputsPrompt(values) {
  return Object.entries(values ?? {})
    .map(([name, value]) => [name, oneLine(value, 500)])
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
}

/** The inputs of a skill that values leaves empty, by name. */
export function missingInputs(inputs, values) {
  return inputs
    .filter(input => !oneLine(values?.[input.name]))
    .map(input => input.name);
}
