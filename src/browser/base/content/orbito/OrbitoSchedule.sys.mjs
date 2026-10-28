/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * When scheduled tasks run, in the local time zone. A schedule is
 * {kind: "hourly"|"daily"|"weekly", minute, hour?, weekday?}: hourly at
 * minute past every hour, daily at hour:minute, weekly on weekday (0 is
 * Sunday, as Date.getDay()) at hour:minute. Times are epoch ms. Every
 * function takes the time now as an argument, so that tests can set the
 * clock.
 *
 * Its strings come from Fluent only where ChromeUtils exists.
 */

// Orbito's strings, in the browser; elsewhere the English ones below.
const l10n = globalThis.ChromeUtils
  ? ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
    )
  : null;

function text(id, args, english) {
  return l10n ? l10n.t(id, args) : english;
}

const RANGE_IDS = {
  minute: "orbito-schedule-minute-range",
  hour: "orbito-schedule-hour-range",
  day: "orbito-schedule-day-range",
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function whole(value, min, max, what) {
  let n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(
      text(
        RANGE_IDS[what],
        { min, max },
        `The ${what} must be a whole number from ${min} to ${max}.`
      )
    );
  }
  return n;
}

/**
 * The schedule with only the fields its kind uses, as numbers.
 *
 * @throws {Error} Saying what is wrong with it.
 */
export function checkSchedule(schedule) {
  let kind = schedule?.kind;
  if (!["hourly", "daily", "weekly"].includes(kind)) {
    throw new Error(
      text(
        "orbito-schedule-choose-kind",
        null,
        "Choose every hour, every day or every week."
      )
    );
  }
  let minute = whole(schedule.minute, 0, 59, "minute");
  if (kind == "hourly") {
    return { kind, minute };
  }
  let hour = whole(schedule.hour, 0, 23, "hour");
  if (kind == "daily") {
    return { kind, minute, hour };
  }
  return { kind, minute, hour, weekday: whole(schedule.weekday, 0, 6, "day") };
}

/**
 * The first time after now that a schedule runs. On a day the clocks skip
 * the time, it runs when they get there.
 *
 * @param {object} schedule A checked schedule.
 * @param {number} now
 * @returns {number}
 */
export function nextRun(schedule, now) {
  let { kind, minute, hour, weekday } = schedule;
  let at = new Date(now);
  if (kind == "hourly") {
    // Counted in real time: setting local minutes in the hour the clocks
    // repeat lands in its first pass, which may be before now.
    let time =
      now - (now % 60000) + ((minute - at.getMinutes() + 60) % 60) * 60000;
    return time <= now ? time + 3600000 : time;
  }
  let days = kind == "weekly" ? (weekday - at.getDay() + 7) % 7 : 0;
  // Setting the date before the time keeps a day that changes the clocks
  // from moving the time.
  let on = d => {
    let day = new Date(now);
    day.setHours(12, 0, 0, 0);
    day.setDate(day.getDate() + d);
    day.setHours(hour, minute, 0, 0);
    return day.getTime();
  };
  let time = on(days);
  if (time <= now) {
    time = on(days + (kind == "weekly" ? 7 : 1));
  }
  return time;
}

/** Local midnight at the start of the day now is in. */
export function startOfDay(now) {
  return new Date(now).setHours(0, 0, 0, 0);
}

/**
 * What to do with a task when the scheduler looks at it. A task whose
 * next_run_at has passed runs once, however many times it was missed while
 * the browser was off, and its next run is worked out again from now. Over
 * the daily limit, shared by all tasks, the run is skipped instead.
 *
 * @param {object} task {schedule, enabled, next_run_at}.
 * @param {number} now
 * @param {number} runsToday Runs of any task since startOfDay(now), not
 *   counting skipped ones.
 * @param {number} maxRunsPerDay
 * @returns {?{status: "run"|"skipped", nextRunAt: number}} null when the
 *   task is not due.
 */
export function dueRun(task, now, runsToday, maxRunsPerDay) {
  if (!task.enabled || task.next_run_at > now) {
    return null;
  }
  return {
    status: runsToday >= maxRunsPerDay ? "skipped" : "run",
    nextRunAt: nextRun(task.schedule, now),
  };
}

/** How a schedule reads in the settings page, e.g. "Every Monday at 08:00". */
export function scheduleText(schedule) {
  let pad = n => String(n).padStart(2, "0");
  let { kind, minute, hour, weekday } = schedule;
  if (kind == "hourly") {
    return text(
      "orbito-schedule-hourly",
      { minute: pad(minute) },
      `Every hour at :${pad(minute)}`
    );
  }
  let time = `${pad(hour)}:${pad(minute)}`;
  return kind == "daily"
    ? text("orbito-schedule-daily", { time }, `Every day at ${time}`)
    : text(
        "orbito-schedule-weekly",
        { weekday, time },
        `Every ${WEEKDAYS[weekday]} at ${time}`
      );
}
