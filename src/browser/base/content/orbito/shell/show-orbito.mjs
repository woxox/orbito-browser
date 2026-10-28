/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  OrbitoAssistantCore:
    "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs",
});

const { isStopShortcut, MAX_RECORDING_MS, OrbitoShow } =
  ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoShow.sys.mjs"
  );

const { ShowSummary } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoShowSummary.sys.mjs"
);

const { conversionRequest, DEMO_TOOLS, demoSkill, demoTools, parseConversion } =
  ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoShowSkill.sys.mjs"
  );

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

/**
 * Show Orbito in one window (GLOSSARY): where a demo starts and stops. The
 * recording itself is OrbitoShow.sys.mjs's; this keeps the window in step
 * with it. The Assistant panel shows each state (orbito-assistant-panel).
 *
 *   state  null; "goal" while the panel asks what the demo is for (the
 *          entry points: the panel's ＋ menu, the Command bar's "Show
 *          Orbito", the settings' Skills); "recording", with the Frame
 *          state red and this window's agent blocked; "stopped", the log
 *          kept for the review until the skill is saved or the demo
 *          discarded.
 *   summary  while it records, the live summary's draft of the steps
 *          (OrbitoShowSummary.sys.mjs), asked of the backend new questions
 *          go to; [] until there is one or when the model fails.
 *   review  once stopped, the skill made of the demo for the user to
 *          check: {phase, error, skill, saving, saveError}. phase is
 *          "converting" while the backend turns the log into a skill (one
 *          request, OrbitoShowSkill.sys.mjs), "failed" (error says why;
 *          convert() tries again) or "ready", with skill what
 *          parseConversion made, which the panel changes in place until
 *          save().
 *   replacing  the skill a demo records again ({dir, name}), from the
 *          settings' "Record again": saving replaces it.
 *
 * Saving the skill, discarding the demo and recording it again each drop
 * the log at once.
 *
 * Stops with the panel's Stop button, the stop shortcut, or by itself
 * after MAX_RECORDING_MS; Cancel drops the log at once, and so does closing
 * the window. A demo cannot start while this window's agent works. Other
 * windows are left alone.
 *
 * Fires on the window:
 *   OrbitoShowChange  the state changed.
 *   OrbitoShowSummary the live summary's draft changed.
 *   OrbitoShowStop    a recording stopped, with detail {log, reason}:
 *                     reason "button", "shortcut" or "timeout"; the review
 *                     starts converting it.
 *   OrbitoShowReview  the review changed: its phase, or saving.
 */
export class ShowOrbito {
  #state = null;
  #reason = null;
  #timer = null;
  #summary = null;
  // The live summary's last draft, for the conversion.
  #draft = [];
  #review = null;
  #conversion = null;
  #replace = null;
  #goal = "";
  #frameState;

  /** How long a demo records at most; tests shorten it. */
  limit = MAX_RECORDING_MS;

  /** @param {FrameState} frameState The window's (frame-state.mjs). */
  constructor(frameState) {
    this.#frameState = frameState;
  }

  init() {
    window.addEventListener("keydown", this, true);
    window.addEventListener("unload", this, { once: true });
  }

  handleEvent(event) {
    switch (event.type) {
      case "keydown":
        if (this.#state == "recording" && isStopShortcut(event)) {
          event.preventDefault();
          event.stopPropagation();
          this.stop("shortcut");
        }
        break;
      case "unload":
        window.removeEventListener("keydown", this, true);
        window.clearTimeout(this.#timer);
        this.#summary?.stop();
        this.#conversion?.abort();
        // OrbitoShow forgets a recording log as the window closes, not one
        // kept for the review.
        OrbitoShow.discard(window);
        break;
    }
  }

  get state() {
    return this.#state;
  }

  get recording() {
    return this.#state == "recording";
  }

  /** Why the last recording stopped, as OrbitoShowStop says, or null. */
  get reason() {
    return this.#reason;
  }

  /** This window's log, while it records or once it stopped, or null. */
  get log() {
    return this.#state == "recording" || this.#state == "stopped"
      ? OrbitoShow.log(window)
      : null;
  }

  /** The live summary's draft of the steps while it records, or null. */
  get summary() {
    return this.#state == "recording" ? (this.#summary?.steps ?? []) : null;
  }

  /** The review of the stopped demo, or null. */
  get review() {
    return this.#state == "stopped" ? this.#review : null;
  }

  /** The skill this demo records again, {dir, name}, or null. */
  get replacing() {
    return this.#replace;
  }

  /** What the goal prompt starts with: the goal of the demo recorded again. */
  get suggestedGoal() {
    return this.#goal;
  }

  /** Whether this window's agent is working, which keeps a demo off. */
  get agentBusy() {
    return !!lazy.OrbitoAssistantCore.windowActivity(window);
  }

  /**
   * The entry points: opens the Assistant panel on the goal prompt, or on
   * the recording if one goes on. While this window's agent works, the
   * panel says so instead and nothing starts. A stopped demo is dropped.
   *
   * @param {object} [options]
   * @param {?{dir: string, name: string}} [options.replace] The user skill
   *   made from a demo that this one records again.
   * @param {string} [options.goal] What the goal prompt starts with.
   * @returns {boolean} Whether the goal prompt or the recording shows.
   */
  begin({ replace = null, goal = "" } = {}) {
    // Popups have no Assistant panel.
    if (!window.toolbar.visible) {
      return false;
    }
    if (this.#state == "recording") {
      window.OrbitoAssistant.toggle(true);
      return true;
    }
    if (this.agentBusy) {
      this.#refuse();
      return false;
    }
    // A new demo leaves the one stopped before.
    this.#endReview();
    OrbitoShow.discard(window);
    this.#replace = replace;
    this.#goal = goal;
    // Open first: the panel then moves focus on to the goal field.
    window.OrbitoAssistant.toggle(true);
    this.#set("goal");
    return true;
  }

  /**
   * Starts recording from the selected tab as it is, a log kept before
   * dropped.
   *
   * @param {string} [goal] What the user said the demo is for.
   * @returns {boolean} Whether it started.
   */
  start(goal = "") {
    if (this.#state == "recording") {
      return true;
    }
    // The agent may have started while the goal was asked.
    if (this.agentBusy) {
      this.#set(null);
      this.#refuse();
      return false;
    }
    let log = OrbitoShow.start(window, { goal: goal.trim() });
    // Not stored in any Thread: the window's backend is asked on its own.
    this.#summary = new ShowSummary(log, {
      summarize: request => this.#complete(request),
      locale: Services.locale.appLocaleAsBCP47,
      onChange: () =>
        window.dispatchEvent(new CustomEvent("OrbitoShowSummary")),
    });
    this.#reason = null;
    this.#frameState.recording = true;
    this.#timer = window.setTimeout(() => this.stop("timeout"), this.limit);
    this.#set("recording");
    return true;
  }

  /**
   * Stops recording and hands the log on for the review.
   *
   * @param {"button"|"shortcut"|"timeout"} [reason]
   */
  stop(reason = "button") {
    if (this.#state != "recording") {
      return;
    }
    this.#draft = this.#summary?.steps ?? [];
    this.#end();
    let log = OrbitoShow.stop(window);
    this.#reason = reason;
    this.#review = { phase: "converting", error: "", skill: null };
    this.#set("stopped");
    window.dispatchEvent(
      new CustomEvent("OrbitoShowStop", { detail: { log, reason } })
    );
    this.convert();
  }

  /** Drops the demo, recording or stopped, or the goal prompt, at once. */
  cancel() {
    if (!this.#state) {
      return;
    }
    this.#end();
    this.#endReview();
    OrbitoShow.discard(window);
    this.#reason = null;
    this.#replace = null;
    this.#goal = "";
    this.#set(null);
  }

  /**
   * Turns the stopped demo into a skill for the review: one request to the
   * backend new questions go to, not stored in any Thread, with the
   * log's masked steps, the goal and the live summary's last draft; never
   * the input candidates. Again after it failed.
   */
  async convert() {
    let log = this.log;
    if (this.#state != "stopped" || !log || this.#review?.phase == "ready") {
      return;
    }
    this.#conversion?.abort();
    let conversion = (this.#conversion = new AbortController());
    this.#review = { phase: "converting", error: "", skill: null };
    this.#changed();
    let { text, candidates } = log.serialize();
    let locale = Services.locale.appLocaleAsBCP47;
    let review;
    try {
      let reply = await this.#complete({
        ...conversionRequest({ text, draft: this.#draft, locale, tools: DEMO_TOOLS }),
        signal: conversion.signal,
      });
      if (conversion.signal.aborted) {
        return;
      }
      try {
        review = {
          phase: "ready",
          error: "",
          skill: parseConversion(reply, {
            candidates,
            fallbackTools: demoTools(log.steps),
          }),
          saving: false,
          saveError: "",
        };
      } catch (e) {
        throw new Error(t("orbito-show-review-not-skill", { error: e.message }));
      }
      // Recorded again: the skill keeps its name.
      if (this.#replace) {
        review.skill.name = this.#replace.name;
      }
    } catch (e) {
      if (conversion.signal.aborted) {
        return;
      }
      if (!e?.needsKey && !e?.needsLogin) {
        console.warn("Orbito: could not turn the demo into a skill:", e);
      }
      review = { phase: "failed", error: e?.message || String(e), skill: null };
    } finally {
      if (this.#conversion == conversion) {
        this.#conversion = null;
      }
    }
    this.#review = review;
    this.#changed();
  }

  /**
   * Saves the reviewed skill as a user skill (the one recorded again, if
   * any, replaced) and drops the demo.
   *
   * @returns {Promise<?string>} The skill's folder, or null when it was not
   *   saved; saveError then says why, and the demo stays.
   */
  async save() {
    let review = this.review;
    if (review?.phase != "ready" || review.saving) {
      return null;
    }
    review.saving = true;
    review.saveError = "";
    this.#changed();
    let skill = demoSkill(review.skill, {
      locale: Services.locale.appLocaleAsBCP47,
    });
    let replace = this.#replace;
    let dir;
    try {
      dir = await lazy.OrbitoAssistantCore.saveSkill(
        skill,
        replace ? { dir: replace.dir, original: replace.name } : {}
      );
    } catch (e) {
      if (this.#review == review) {
        review.saving = false;
        review.saveError = e.message;
        this.#changed();
      }
      return null;
    }
    if (this.#review == review) {
      this.cancel();
      window.OrbitoAssistant.panel?.notify(
        t("orbito-show-saved", { name: skill.name })
      );
    }
    return dir;
  }

  /**
   * Drops the stopped demo and asks for a new one's goal at once, the same
   * goal and skill to replace kept.
   */
  rerecord() {
    if (this.#state != "stopped") {
      return false;
    }
    let goal = this.log?.goal ?? "";
    let replace = this.#replace;
    this.cancel();
    return this.begin({ replace, goal });
  }

  #endReview() {
    this.#conversion?.abort();
    this.#conversion = null;
    this.#review = null;
    this.#draft = [];
  }

  #changed() {
    window.dispatchEvent(new CustomEvent("OrbitoShowReview"));
  }

  #end() {
    window.clearTimeout(this.#timer);
    this.#timer = null;
    this.#summary?.stop();
    this.#summary = null;
    this.#frameState.recording = false;
  }

  // Asks the backend and model a new Thread in the window's Space would.
  #complete(request) {
    let core = lazy.OrbitoAssistantCore;
    let space = window.OrbitoShell?.spaces?.current ?? null;
    let { backend, model } = core.questionBackend([], space);
    return core.complete({ ...request, backend, model });
  }

  #refuse() {
    window.OrbitoAssistant.toggle(true);
    window.OrbitoAssistant.panel?.notify(t("orbito-show-agent-busy"));
  }

  #set(state) {
    this.#state = state;
    window.dispatchEvent(new CustomEvent("OrbitoShowChange"));
  }
}
