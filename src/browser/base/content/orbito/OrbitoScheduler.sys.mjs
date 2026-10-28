/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Runs scheduled tasks (OrbitoTasks.sys.mjs) when their time comes, while
 * the browser is open; nothing runs them while it is closed. At startup it
 * runs, once each, the tasks whose next run passed while the browser was
 * closed, then waits with a timer for the nearest next run. It looks again
 * whenever a task changes and when the system wakes from sleep.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  OrbitoTasks: "chrome://browser/content/orbito/OrbitoTasks.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

// The longest the timer waits before looking again, in case the clock was
// changed or the system slept without saying so.
const MAX_WAIT = 3600000;

export const OrbitoScheduler = {
  _started: false,
  _timer: null,
  // Whether due tasks are being run, and whether to look again after.
  _checking: false,
  _again: false,

  /** Called by the core at startup; only the first call does anything. */
  start() {
    if (this._started) {
      return;
    }
    this._started = true;
    Services.obs.addObserver(this, "wake_notification");
    lazy.OrbitoTasks.addListener(() => this._arm().catch(console.error));
    this._check();
  },

  observe(subject, topic) {
    if (topic == "wake_notification") {
      this._check();
    }
  },

  /** Runs the tasks that are due, then sets the timer for the next one. */
  async _check() {
    if (this._checking) {
      this._again = true;
      return;
    }
    this._checking = true;
    lazy.clearTimeout(this._timer);
    this._timer = null;
    try {
      do {
        this._again = false;
        await lazy.OrbitoTasks.runDue();
      } while (this._again);
    } catch (e) {
      console.error(e);
    } finally {
      this._checking = false;
    }
    await this._arm().catch(console.error);
  },

  /**
   * Sets the timer for the nearest next run of a task that is on. While
   * due tasks run, _check sets it once they are done.
   */
  async _arm() {
    if (this._checking) {
      return;
    }
    let tasks = await lazy.OrbitoTasks.list();
    if (this._checking) {
      return;
    }
    let next = Math.min(
      ...tasks.filter(task => task.enabled).map(task => task.next_run_at)
    );
    lazy.clearTimeout(this._timer);
    this._timer = null;
    if (next != Infinity) {
      let wait = Math.min(Math.max(next - Date.now(), 0), MAX_WAIT);
      this._timer = lazy.setTimeout(() => this._check(), wait);
    }
  },
};
