/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Sync records of Browsing recall's visits (see
 * docs/adr/0007-recall-sync.md and OrbitoRecallSyncEngine.sys.mjs), and
 * what this device does with another device's: no store, no Services, so
 * that the rules can be tested alone.
 *
 * A visit record, id the visit's guid: {kind: "visit", url, title,
 * visitedAt, dwellMs, space, device, deviceName}. A forget record, id
 * forgetId(url): {kind: "forget", url, at}, every visit to url at or
 * before at, on every device, being forgotten.
 */

const FORGET_PREFIX = "forget-";

/**
 * Notified with a record's id as data when a visit or forget here changes,
 * for Sync's tracker.
 */
export const SYNC_CHANGED = "orbito-recall-sync-changed";

/** A new visit's guid: 12 URL-safe characters, as Sync's own ids. */
export function newVisitGuid() {
  let bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// cyrb53 of a string's UTF-16 code units, as 14 hex digits.
function cyrb53(s, seed) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0))
    .toString(16)
    .padStart(14, "0");
}

/**
 * The id of the forget record of a URL, the same on every device: 35
 * URL-safe characters, never a visit's guid.
 */
export function forgetId(url) {
  let s = String(url);
  return FORGET_PREFIX + cyrb53(s, 1) + cyrb53(s, 2);
}

export function isForgetId(id) {
  return String(id).startsWith(FORGET_PREFIX);
}

/**
 * A visit's record fields.
 *
 * @param {{url, title, visited_at, dwell_ms, space_id}} visit
 * @param {{id: string, name: string}} device This device.
 */
export function visitRecord(visit, device) {
  return {
    kind: "visit",
    url: visit.url,
    title: visit.title,
    visitedAt: visit.visited_at,
    dwellMs: visit.dwell_ms,
    space: visit.space_id,
    device: device.id,
    deviceName: device.name,
  };
}

export function forgetRecord({ url, at }) {
  return { kind: "forget", url, at };
}

/** The record lifetime in seconds for a retention in days; none to keep all. */
export function recordTTL(retentionDays) {
  let days = Math.floor(Number(retentionDays));
  return days > 0 ? days * 86400 : null;
}

const isTime = value => Number.isFinite(value) && value >= 0;

/**
 * What another device's records change here.
 *
 * Forgets apply first, whatever the order: the latest `at` of a URL (the
 * one kept here or an incoming one) wins, and a visit to it at or before
 * that time is dropped. Visits from this device, of an excluded site or
 * older than the retention period are dropped too; any other visit is kept
 * as it comes (another device's Space id included). A record's tombstone
 * removes the visit kept under its id.
 *
 * @param {Array<object>} records Record fields with id and deleted.
 * @param {object} context
 * @param {string} context.localDeviceId
 * @param {Map<string, number>} context.forgets The forgets kept here, by URL.
 * @param {function(string): boolean} context.isExcluded For a URL.
 * @param {?number} context.cutoff The oldest visit kept, or null for all.
 * @returns {{upsert: object[], remove: string[], forgets: object[],
 *   purge: object[], reupload: string[]}} upsert: the remote visits to
 *   store, as rows; remove: the guids of remote visits to delete; forgets:
 *   the forgets to store ({url, at}); purge: {url, at}, the visits (this
 *   device's and others') to a URL at or before at, to delete; reupload:
 *   the ids of forgets kept here that are later than the incoming ones.
 */
export function incomingActions(
  records,
  { localDeviceId, forgets, isExcluded, cutoff }
) {
  let live = records.filter(r => !r.deleted);
  let latest = new Map(forgets);
  let reupload = [];
  for (let r of live) {
    if (r.kind != "forget" || typeof r.url != "string" || !isTime(r.at)) {
      continue;
    }
    let kept = forgets.get(r.url);
    if (kept != null && kept > r.at) {
      reupload.push(r.id);
    }
    if (!(latest.get(r.url) >= r.at)) {
      latest.set(r.url, r.at);
    }
  }
  let actions = { upsert: [], remove: [], forgets: [], purge: [], reupload };
  for (let [url, at] of latest) {
    let kept = forgets.get(url);
    if (kept != null && kept >= at) {
      continue;
    }
    actions.purge.push({ url, at });
    if (cutoff == null || at >= cutoff) {
      actions.forgets.push({ url, at });
    }
  }
  for (let r of records) {
    if (r.deleted) {
      actions.remove.push(r.id);
      continue;
    }
    if (r.kind != "visit") {
      continue;
    }
    let keep =
      typeof r.url == "string" &&
      isTime(r.visitedAt) &&
      typeof r.device == "string" &&
      r.device &&
      r.device != localDeviceId &&
      !isExcluded(r.url) &&
      (cutoff == null || r.visitedAt >= cutoff) &&
      !(latest.get(r.url) >= r.visitedAt);
    if (!keep) {
      actions.remove.push(r.id);
      continue;
    }
    actions.upsert.push({
      guid: r.id,
      url: r.url,
      title: typeof r.title == "string" ? r.title : "",
      visited_at: r.visitedAt,
      dwell_ms: isTime(r.dwellMs) ? r.dwellMs : null,
      space_id: typeof r.space == "string" ? r.space : null,
      device_id: r.device,
      device_name: typeof r.deviceName == "string" ? r.deviceName : "",
    });
  }
  return actions;
}
