/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * How the timeline (about:orbito-timeline) lays out the visits it lists:
 * by day, each day's reading by hour, and its visits in reading sessions.
 * Pure: the timeline gives it the visits and the local calendar.
 *
 * A visit: {url, title, start, visited_at, dwell_ms, device}, device null
 * for this device or {id, name} for another; dwell_ms null when it is not
 * known (a visit too short to count, or one being read).
 */

/**
 * The longest a reader may stop, from the end of a visit to the start of
 * the next, for both to be in one reading session.
 */
export const SESSION_GAP_MS = 30 * 60000;

/** The key of a visit's device: "local" for this one, else its id. */
export function deviceKey(device) {
  return device?.id ?? "local";
}

function hostOf(url) {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/**
 * Lays visits out by day, latest first.
 *
 * A day: {day, pages, dwellMs, devices, hours, sessions}. pages counts the
 * day's distinct URLs, devices the keys (deviceKey) of the devices that read
 * them, this device first then by first seen; hours is 24 {visits, dwellMs,
 * byDevice: {key: dwellMs}}, a visit counted wholly in the hour it started.
 *
 * A session: {start, end, dwellMs, pages, domains, entries}. Visits are in
 * one session while each starts at most gapMs after the end (visited_at
 * plus dwell_ms) of the one before, on the same day. start is its first
 * visit's start, end the latest end; domains its hosts, most read first.
 *
 * An entry: a page a device read in the session, its visits merged:
 * {url, title, start, visited_at, dwell_ms, device, visits}, with the
 * latest visit's title, text and time and the dwell of all of them (null
 * when none is known), latest first.
 *
 * @param {object[]} visits Latest first.
 * @param {object} calendar
 * @param {function(number): string} calendar.dayOf A time's local day.
 * @param {function(number): number} calendar.hourOf A time's local hour.
 * @param {number} [calendar.gapMs]
 */
export function timelineDays(visits, { dayOf, hourOf, gapMs = SESSION_GAP_MS }) {
  let days = [];
  let day = null;
  let session = null;
  for (let visit of [...visits].sort((a, b) => b.visited_at - a.visited_at)) {
    let date = dayOf(visit.visited_at);
    if (day?.day != date) {
      day = {
        day: date,
        pages: 0,
        dwellMs: 0,
        devices: [],
        hours: Array.from({ length: 24 }, () => ({
          visits: 0,
          dwellMs: 0,
          byDevice: {},
        })),
        sessions: [],
        urls: new Set(),
      };
      days.push(day);
      session = null;
    }
    let dwell = visit.dwell_ms ?? 0;
    let key = deviceKey(visit.device);
    if (!day.devices.includes(key)) {
      day.devices.push(key);
    }
    if (!day.urls.has(visit.url)) {
      day.urls.add(visit.url);
      day.pages++;
    }
    day.dwellMs += dwell;
    let hour = day.hours[Math.min(23, Math.max(0, hourOf(visit.visited_at)))];
    hour.visits++;
    hour.dwellMs += dwell;
    hour.byDevice[key] = (hour.byDevice[key] ?? 0) + dwell;

    // Walking back in time: the visit joins the session after it if it
    // ended no more than gapMs before that session started.
    if (!session || session.start - (visit.visited_at + dwell) > gapMs) {
      session = {
        start: visit.visited_at,
        end: visit.visited_at + dwell,
        dwellMs: 0,
        pages: 0,
        domains: [],
        entries: [],
        byKey: new Map(),
        byDomain: new Map(),
      };
      day.sessions.push(session);
    }
    session.start = Math.min(session.start, visit.visited_at);
    session.end = Math.max(session.end, visit.visited_at + dwell);
    session.dwellMs += dwell;
    let entryKey = `${key}\n${visit.url}`;
    let entry = session.byKey.get(entryKey);
    if (entry) {
      entry.visits++;
      if (visit.dwell_ms != null) {
        entry.dwell_ms = (entry.dwell_ms ?? 0) + visit.dwell_ms;
      }
    } else {
      entry = {
        url: visit.url,
        title: visit.title,
        start: visit.start,
        visited_at: visit.visited_at,
        dwell_ms: visit.dwell_ms ?? null,
        device: visit.device ?? null,
        visits: 1,
      };
      session.byKey.set(entryKey, entry);
      session.entries.push(entry);
    }
    let host = hostOf(visit.url);
    session.byDomain.set(host, (session.byDomain.get(host) ?? 0) + dwell);
  }
  for (let d of days) {
    // This device first, then the others as they came.
    let local = d.devices.indexOf("local");
    if (local > 0) {
      d.devices.splice(local, 1);
      d.devices.unshift("local");
    }
    delete d.urls;
    for (let s of d.sessions) {
      s.pages = new Set(s.entries.map(e => e.url)).size;
      // Most read first; equal ones in the order they were met (latest).
      s.domains = [...s.byDomain.entries()]
        .map(([host, dwell], i) => ({ host, dwell, i }))
        .sort((a, b) => b.dwell - a.dwell || a.i - b.i)
        .map(x => x.host);
      delete s.byKey;
      delete s.byDomain;
    }
  }
  return days;
}
