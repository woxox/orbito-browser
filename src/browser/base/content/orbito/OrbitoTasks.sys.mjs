/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Scheduled tasks: questions the assistant answers on its own, or skills it
 * runs, called as "/name" would be with the question after it. A run asks
 * the core windowless, in a new Thread of its own that no tab shows,
 * keeps the answer as a document without opening it, and says so with a
 * system notification, which opens the document (or, for a failed run, the
 * task's runs in the settings page) when clicked. Nobody is there to
 * approve tools, so only read-only ones run, and those the user allowed
 * when making the task (allowed_tools), whatever the PermissionMode
 * default; a call to any other is refused, and the run keeps the refusal
 * as its error but goes on. Runs go one at a time, in the
 * order they were asked for. OrbitoScheduler.sys.mjs runs tasks when their
 * time comes; all runs together, Run now included, are limited to
 * orbito.assistant.tasks.maxRunsPerDay a day, and those over it are kept
 * as skipped.
 *
 * A task belongs to a Space, as it was made in one (or to none in
 * particular, as those before Spaces): each run's Thread is in that Space
 * whichever one the windows show, and uses its memories, skills, browsing
 * recall and, for a task without a backend of its own, its default
 * backend; a tab it opens goes into that Space without showing it.
 *
 * Tasks and runs are kept in the core's store (OrbitoAssistantStore.sys.mjs)
 * as {id, name, prompt, skill, inputs, schedule, backend, model,
 * allowed_tools, enabled, created_at, last_run_at, next_run_at, space_id}
 * and {id, task_id, started_at, finished_at, status, thread_id, artifact_id,
 * input_tokens, output_tokens, error}, with status running, ok, failed or
 * skipped, and the tokens its reply used (null if the backend
 * reported none). schedule is as OrbitoSchedule.sys.mjs has it; backend
 * and model are null for the Space's default (see
 * OrbitoAssistantCore.questionBackend()). inputs, {name: value}, fills in
 * the 입력 / Inputs of a skill made from a demo, whose run nobody is there
 * to ask.
 */

import {
  demoSteps,
  inputsPrompt,
  missingInputs,
} from "chrome://browser/content/orbito/OrbitoShowReplay.sys.mjs";
import {
  checkSchedule,
  dueRun,
  nextRun,
  startOfDay,
} from "chrome://browser/content/orbito/OrbitoSchedule.sys.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  OrbitoAssistantCore:
    "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs",
  OrbitoPages: "chrome://browser/content/orbito/OrbitoPages.sys.mjs",
  OrbitoShellStore:
    "chrome://browser/content/orbito/shell/OrbitoShellStore.sys.mjs",
  OrbitoTools: "chrome://browser/content/orbito/OrbitoTools.sys.mjs",
});

const MAX_NAME = 100;

/**
 * The "Morning brief" template the settings page fills its form with: a
 * daily task that sums up the day ahead from what the browser knows.
 */
export const MORNING_BRIEF = {
  name: t("orbito-tasks-morning-brief"),
  prompt: [
    "Write my morning brief for today as one document, with a section for each of these:",
    "1. Today's schedule: if you have tools from a connected calendar (an MCP server), list today's events with their times. If you have none, leave this part out and write \"No calendar connected\" in the document instead.",
    "2. Yesterday's browsing: use search_history to find the pages I visited yesterday and sum up what I was working on, grouped by topic.",
    "3. Open tabs: use list_tabs and sum up the tabs I still have open, grouped by topic, noting any that look unfinished.",
  ].join("\n"),
  schedule: { kind: "daily", hour: 8, minute: 0 },
};
const MAX_RUNS_PREF = "orbito.assistant.tasks.maxRunsPerDay";

// Added to a run's system prompt.
const TASK_INSTRUCTIONS =
  "This question is a scheduled task the user set up earlier: nobody is watching while you answer, and no browser tab is open for you. Write the result with create_artifact, once, and then reply with a short note.";

function newId() {
  return Services.uuid.generateUUID().toString().slice(1, -1);
}

export const OrbitoTasks = {
  _listeners: new Set(),
  // Runs wait for the one before them to end.
  _queue: Promise.resolve(),
  // Task id -> how many of its runs are waiting or running.
  _pending: new Map(),
  // Task id -> the AbortController of its run in progress.
  _running: new Map(),

  get _store() {
    return lazy.OrbitoAssistantCore.store;
  },

  /** @param {Function} listener Called whenever a task or a run changes. */
  addListener(listener) {
    this._listeners.add(listener);
  },

  removeListener(listener) {
    this._listeners.delete(listener);
  },

  _changed() {
    for (let listener of this._listeners) {
      try {
        listener();
      } catch (e) {
        console.error(e);
      }
    }
  },

  /**
   * Every task, oldest first, each with its latest run as last_run and the
   * tokens of all its runs as total_input_tokens and total_output_tokens.
   */
  list() {
    return this._store.listTasks();
  },

  get(id) {
    return this._store.getTask(id);
  },

  /** A task's runs, latest first. */
  runs(taskId) {
    return this._store.listTaskRuns(taskId);
  },

  /**
   * The tools a task can be allowed: those registered now (MCP tools
   * included) that are not read-only, which a task runs anyway, nor
   * alwaysConfirm, which a task is never offered.
   *
   * @returns {{name: string, description: string}[]}
   */
  allowableTools() {
    return lazy.OrbitoTools.list()
      .filter(
        ({ name, readOnly }) =>
          !readOnly && !lazy.OrbitoTools.get(name).alwaysConfirm
      )
      .map(({ name, description }) => ({ name, description }));
  },

  /**
   * The tools a skill lists (its front matter's tools) that a task running
   * it is allowed by default: the allowable ones, and those not registered
   * now, which may be an MCP server's that is off. Read-only tools run
   * anyway.
   *
   * @param {object} skill
   * @returns {string[]}
   */
  skillTools(skill) {
    let allowable = new Set(this.allowableTools().map(t => t.name));
    return (skill.tools ?? []).filter(
      name => allowable.has(name) || !lazy.OrbitoTools.get(name)
    );
  },

  /** Whether a run of the task is waiting or running. */
  isPending(taskId) {
    return this._pending.has(taskId);
  },

  /**
   * Saves a new task, or changes one. Its next run is worked out again
   * from now.
   *
   * @param {object} fields {name, prompt, skill, inputs, schedule, backend,
   *   model, allowedTools, space}; an empty backend is the Space's default
   *   when a run starts, else the profile's (and the model with it), an
   *   empty model the backend's current one, an empty space none; without
   *   space a changed task keeps its own. A task with a skill runs it with
   *   the prompt, if any, after its name; a skill made from a demo needs a
   *   value in inputs for each of its inputs, which go before the prompt.
   *   Without
   *   allowedTools a changed task keeps its own. A tool that is not
   *   registered now (as one of an MCP server that is off) can stay.
   * @param {string} [id] The task to change.
   * @returns {Promise<object>} The task.
   * @throws {Error} Saying what is wrong; nothing is saved then.
   */
  async save(fields, id = null) {
    let { BACKENDS } = lazy.OrbitoAssistantCore;
    let name = String(fields.name ?? "").trim();
    let prompt = String(fields.prompt ?? "").trim();
    let skill = String(fields.skill ?? "").trim() || null;
    if (!name) {
      throw new Error(t("orbito-tasks-needs-name"));
    }
    if (name.length > MAX_NAME) {
      throw new Error(t("orbito-tasks-name-too-long", { max: MAX_NAME }));
    }
    if (!prompt && !skill) {
      throw new Error(t("orbito-tasks-needs-prompt"));
    }
    let picked =
      skill &&
      (await lazy.OrbitoAssistantCore.skills()).find(s => s.name == skill);
    if (skill && !picked) {
      throw new Error(t("orbito-tasks-no-skill", { name: skill }));
    }
    // Only the inputs the skill has.
    let inputs = {};
    if (picked?.source == "demo") {
      let wanted = demoSteps(picked.body).inputs;
      let missing = missingInputs(wanted, fields.inputs);
      if (missing.length) {
        throw new Error(t("orbito-tasks-needs-input", { name: missing[0] }));
      }
      for (let input of wanted) {
        inputs[input.name] = String(fields.inputs[input.name]).trim();
      }
    }
    let backend = String(fields.backend ?? "") || null;
    if (backend && !(backend in BACKENDS)) {
      throw new Error(t("orbito-tasks-choose-backend"));
    }
    let schedule = checkSchedule(fields.schedule);
    let allowed = fields.allowedTools && [
      ...new Set(fields.allowedTools.map(String)),
    ];
    let unallowable = allowed?.find(
      name => lazy.OrbitoTools.get(name)?.alwaysConfirm
    );
    if (unallowable) {
      throw new Error(t("orbito-tasks-not-allowable", { tool: unallowable }));
    }
    let old = id && (await this.get(id));
    if (id && !old) {
      throw new Error(t("orbito-tasks-deleted"));
    }
    let now = Date.now();
    let task = {
      id: id || newId(),
      allowed_tools: [],
      enabled: true,
      created_at: now,
      last_run_at: null,
      space_id: null,
      ...old,
      name,
      prompt,
      skill,
      inputs,
      schedule,
      backend,
      model:
        backend &&
        (String(fields.model ?? "").trim() ||
          lazy.OrbitoAssistantCore.model(backend)),
      ...(allowed && { allowed_tools: allowed }),
      ...("space" in fields && {
        space_id: String(fields.space ?? "") || null,
      }),
      next_run_at: nextRun(schedule, now),
    };
    await this._store.saveTask(task);
    this._changed();
    return task;
  },

  /** Deletes a task and its runs, stopping a run in progress. */
  async remove(id) {
    this._running.get(id)?.abort();
    await this._store.deleteTask(id);
    this._changed();
  },

  /**
   * Turns a task on or off. Turned on, it runs next at its next time from
   * now, not at one missed while it was off.
   */
  async setEnabled(id, enabled) {
    let task = await this.get(id);
    if (!task) {
      throw new Error(t("orbito-tasks-deleted"));
    }
    task.enabled = enabled;
    task.next_run_at = nextRun(task.schedule, Date.now());
    await this._store.saveTask(task);
    this._changed();
  },

  /**
   * Runs a task once the runs asked for before it are done, whether it is
   * on or not.
   *
   * @returns {Promise<?object>} The run once it ended, or null if the task
   *   was deleted before its turn.
   */
  runNow(id) {
    this._pending.set(id, (this._pending.get(id) ?? 0) + 1);
    this._changed();
    return this._enqueue(() => this._run(id)).finally(() => {
      let left = this._pending.get(id) - 1;
      if (left) {
        this._pending.set(id, left);
      } else {
        this._pending.delete(id);
      }
      this._changed();
    });
  },

  /**
   * Runs, one after the other, the tasks that are on and whose next run has
   * come, each once however many times it was missed, and moves each one's
   * next run to after now.
   *
   * @returns {Promise} Once they ended.
   */
  runDue() {
    return this._enqueue(async () => {
      let now = Date.now();
      let due = (await this.list())
        .filter(task => task.enabled && task.next_run_at <= now)
        .sort((a, b) => a.next_run_at - b.next_run_at);
      for (let task of due) {
        await this._run(task.id, true);
      }
    });
  },

  _enqueue(job) {
    let done = this._queue.then(job);
    this._queue = done.catch(console.error);
    return done;
  },

  /**
   * @param {string} id
   * @param {boolean} [scheduled] Run only if the task is due, as runDue
   *   does; otherwise it runs whatever its schedule.
   */
  async _run(id, scheduled = false) {
    let task = await this.get(id);
    if (!task) {
      return null;
    }
    let core = lazy.OrbitoAssistantCore;
    let started = Date.now();
    let runsToday = await this._store.countTaskRunsSince(startOfDay(started));
    let max = Services.prefs.getIntPref(MAX_RUNS_PREF, 24);
    let status = runsToday >= max ? "skipped" : "run";
    if (scheduled) {
      let due = dueRun(task, started, runsToday, max);
      if (!due) {
        return null;
      }
      task.next_run_at = due.nextRunAt;
      status = due.status;
    }
    if (status == "skipped") {
      let run = {
        id: newId(),
        task_id: id,
        started_at: started,
        finished_at: started,
        status,
        thread_id: null,
        artifact_id: null,
        input_tokens: null,
        output_tokens: null,
        error: t("orbito-tasks-limit-reached", { max }),
      };
      await this._store.saveTaskRun(run);
      await this._store.saveTask(task);
      this._changed();
      return run;
    }
    let run = {
      id: newId(),
      task_id: id,
      started_at: started,
      finished_at: null,
      status: "running",
      thread_id: newId(),
      artifact_id: null,
      input_tokens: null,
      output_tokens: null,
      error: null,
    };
    await this._store.saveTaskRun(run);
    task.last_run_at = started;
    await this._store.saveTask(task);
    this._changed();

    // A Space removed since leaves its tasks' Threads in none.
    let space = (lazy.OrbitoShellStore.get("spaces") ?? []).some(
      s => s?.id == task.space_id
    )
      ? task.space_id
      : null;
    let controller = new AbortController();
    this._running.set(id, controller);
    let error = null;
    let allowed = new Set(task.allowed_tools);
    let refused = [];
    try {
      let date = new Date(started).toLocaleDateString(undefined, {
        dateStyle: "medium",
      });
      await core.ask({
        threadId: run.thread_id,
        // A skill is called as "/name" is in the panel: its instructions go
        // into the user message, as a skill part. The values of its inputs
        // go first, a line each.
        prompt: task.skill
          ? `/${task.skill} ${[inputsPrompt(task.inputs), task.prompt ?? ""]
              .filter(Boolean)
              .join("\n")}`.trim()
          : task.prompt,
        origin: {},
        // Asked before any tool that is not read-only: nobody is there to
        // allow it, so the task's list decides.
        confirm: async ({ name }) => {
          if (!allowed.has(name)) {
            refused.push(name);
          }
          return allowed.has(name);
        },
        signal: controller.signal,
        onEvent: event => {
          if (event.type == "error") {
            error = event.message;
          }
        },
        backend: task.backend,
        model: task.model,
        title: `${task.name} — ${date}`,
        instructions: TASK_INSTRUCTIONS,
        space,
      });
      if (error) {
        throw new Error(error);
      }
      if (controller.signal.aborted) {
        throw new Error(t("orbito-tasks-run-stopped"));
      }
      let reply = (await core.getMessages(run.thread_id)).at(-1);
      let made = reply?.parts.findLast(p => p.type == "artifact");
      // A model that answered without writing a document gets its reply
      // kept as one.
      run.artifact_id =
        made?.id ??
        (await core.openReplyAsArtifact(run.thread_id, reply?.id)).id;
      run.status = "ok";
      if (refused.length) {
        let names = [...new Set(refused)].join(", ");
        run.error = t("orbito-tasks-not-allowed", { tools: names });
      }
    } catch (e) {
      run.status = "failed";
      run.error = e.message || String(e);
    } finally {
      this._running.delete(id);
    }
    // The tokens the reply used, failed runs included.
    let reply = (await core.getMessages(run.thread_id)).findLast(
      m => m.role == "assistant"
    );
    run.input_tokens = reply?.input_tokens ?? null;
    run.output_tokens = reply?.output_tokens ?? null;
    run.finished_at = Date.now();
    await this._store.saveTaskRun(run);
    this._changed();
    this._notify(task, run);
    return run;
  },

  /** Says with a system notification how a run went. */
  _notify(task, run) {
    let ok = run.status == "ok";
    try {
      let alert = Cc["@mozilla.org/alert-notification;1"].createInstance(
        Ci.nsIAlertNotification
      );
      alert.init(
        `orbito-task-${run.id}`,
        "chrome://branding/content/icon64.png",
        ok
          ? t("orbito-tasks-done", { name: task.name })
          : t("orbito-tasks-failed", { name: task.name, error: run.error }),
        ok ? t("orbito-tasks-open-result") : t("orbito-tasks-see-runs"),
        true,
        run.id
      );
      // Looked up each time, so that tests can stand in for it.
      Cc["@mozilla.org/alerts-service;1"]
        .getService(Ci.nsIAlertsService)
        .showAlert(alert, (subject, topic) => {
          if (topic == "alertclickcallback") {
            this.openRun(run.id).catch(console.error);
          }
        });
    } catch (e) {
      console.error(e);
    }
  },

  /**
   * Shows a run: its document, or for a run without one the task's runs in
   * the settings page. With no normal window open, it opens one.
   */
  async openRun(runId) {
    let run = await this._store.getTaskRun(runId);
    if (!run) {
      return;
    }
    let win = lazy.BrowserWindowTracker.getTopWindow({ private: false });
    win ??= await lazy.BrowserWindowTracker.promiseOpenWindow({
      private: false,
    });
    win.focus();
    if (run.artifact_id) {
      try {
        await lazy.OrbitoAssistantCore.openArtifact(win, run.artifact_id);
        return;
      } catch {
        // The document was deleted: show the runs instead.
      }
    }
    lazy.OrbitoPages.openTaskRuns(win, run.task_id);
  },
};
