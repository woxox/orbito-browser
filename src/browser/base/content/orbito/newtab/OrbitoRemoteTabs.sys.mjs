/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The new tab page's "From other devices": which of the devices Firefox
 * Sync knows (SyncedTabs.getTabClients()) it shows, with which of their
 * tabs, and how long ago they were used. Pure functions, without the page.
 */

import { isExcludedHost } from "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** How many of a device's tabs show before "N more tabs". */
export const REMOTE_LIMIT = 4;
/** A device not used for this many days is left out. */
export const STALE_DAYS = 14;

/**
 * The other devices to show, the one used last first: those used in the
 * last STALE_DAYS days that have a web page open which this browser has
 * not, and is not on an excluded domain (Browsing recall's, subdomains
 * included). Each device's tabs come the one used last first.
 *
 * @param {Array<object>} clients
 *   SyncedTabs.getTabClients()'s: {id, name, clientType, lastModified (ms),
 *   tabs: [{url, title, icon, lastUsed (s)}]}.
 * @param {object} options
 * @param {number} options.now
 * @param {string[]} [options.excluded]
 *   The excluded domains, see excludedDomains().
 * @param {Set<string>} [options.openURLs]
 *   The URLs of this browser's tabs.
 * @returns {Array<{id: string, name: string, type: string, lastUsed: number,
 *   tabs: Array<{url: string, title: string, host: string, icon: string,
 *   lastUsed: number}>}>} The times in ms.
 */
export function remoteDevices(
  clients,
  { now, excluded = [], openURLs = new Set() }
) {
  let devices = [];
  for (let client of clients ?? []) {
    let lastUsed = Number(client.lastModified) || 0;
    if (now - lastUsed > STALE_DAYS * DAY_MS) {
      continue;
    }
    let tabs = [];
    for (let tab of client.tabs ?? []) {
      let url = URL.parse(tab.url);
      if (
        !url ||
        !["http:", "https:"].includes(url.protocol) ||
        openURLs.has(tab.url) ||
        isExcludedHost(url.hostname, excluded)
      ) {
        continue;
      }
      let host = url.host.replace(/^www\./, "");
      tabs.push({
        url: tab.url,
        title: tab.title || host,
        host,
        icon: tab.icon || `page-icon:${tab.url}`,
        lastUsed: (Number(tab.lastUsed) || 0) * 1000,
      });
    }
    if (!tabs.length) {
      continue;
    }
    tabs.sort((a, b) => b.lastUsed - a.lastUsed);
    devices.push({
      id: client.id,
      name: client.name,
      type: client.clientType,
      lastUsed,
      tabs,
    });
  }
  return devices.sort((a, b) => b.lastUsed - a.lastUsed);
}

/**
 * The device shown: the one picked, while it is there, or else the one
 * used last; null without devices.
 */
export function pickedDevice(devices, id) {
  return devices.find(device => device.id == id) ?? devices[0] ?? null;
}

/**
 * How long ago a time was, as a message id of pages.ftl and its arguments.
 *
 * @returns {[string, object?]}
 */
export function agoMessage(time, now) {
  let minutes = Math.floor((now - time) / MINUTE_MS);
  if (minutes < 1) {
    return ["orbito-newtab-remote-just-now"];
  }
  if (minutes < 60) {
    return ["orbito-newtab-remote-minutes-ago", { count: minutes }];
  }
  let hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return ["orbito-newtab-remote-hours-ago", { count: hours }];
  }
  return ["orbito-newtab-remote-days-ago", { count: Math.floor(hours / 24) }];
}
