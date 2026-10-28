/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Docks: one list per Space, all of them kept for the whole profile, as
 * {[spaceId]: [{id, url, title, icon}]}, each list in order. An entry is
 * shaped as a Pin is (shell/OrbitoPins.sys.mjs), and the Pin list functions
 * (addPin, removePin, movePin, orderPins, sameOrder) work on a Dock's list
 * too. Its URL is the one it was docked with: the tab goes back to it when
 * closed, whatever page it went to since. A Dock entry's id is unique across
 * every Space. These functions take the lists and give new ones; they never
 * change what they get. Which Dock entry a tab stands for is kept by the
 * Shell (shell/docks.mjs).
 */

import { checkPins } from "./OrbitoPins.sys.mjs";

/**
 * Usable lists from what was stored: per Space, what checkPins keeps, and
 * an entry whose id another list (or an earlier one in the same) already
 * has is dropped. Empty lists are left out.
 *
 * @param {any} stored
 * @returns {{[spaceId: string]: Array<{id: string, url: string, title: string, icon: string}>}}
 */
export function checkDocks(stored) {
  let docks = {};
  let ids = new Set();
  if (!stored || typeof stored != "object" || Array.isArray(stored)) {
    return docks;
  }
  for (let [space, entries] of Object.entries(stored)) {
    let list = checkPins(entries).filter(entry => !ids.has(entry.id));
    list.forEach(entry => ids.add(entry.id));
    if (space && list.length) {
      docks[space] = list;
    }
  }
  return docks;
}

/** A Space's Dock list (empty without one). */
export function dockList(docks, space) {
  return docks[space] ?? [];
}

/** The lists with a Space's Dock list replaced (left out when empty). */
export function withDockList(docks, space, list) {
  let next = { ...docks };
  delete next[space];
  if (list.length) {
    next[space] = list;
  }
  return next;
}

/** The Space and entry of a Dock entry id, or null. */
export function findDock(docks, id) {
  for (let [space, list] of Object.entries(docks)) {
    let entry = list.find(e => e.id == id);
    if (entry) {
      return { space, entry };
    }
  }
  return null;
}

/** The lists without an entry, wherever it is. */
export function removeDock(docks, id) {
  let found = findDock(docks, id);
  return found
    ? withDockList(
        docks,
        found.space,
        docks[found.space].filter(e => e.id != id)
      )
    : docks;
}

/** The lists of the Spaces ids names only (a Space gone takes its Dock). */
export function keepSpaces(docks, ids) {
  let keep = new Set(ids);
  return Object.fromEntries(
    Object.entries(docks).filter(([space]) => keep.has(space))
  );
}

/**
 * The lists with a Space's Dock moved to another Space's, after its
 * entries; an entry of a URL the other's Dock already has is left out.
 */
export function moveDocks(docks, from, to) {
  if (!docks[from]) {
    return docks;
  }
  let target = dockList(docks, to);
  let urls = new Set(target.map(entry => entry.url));
  let moved = docks[from].filter(entry => !urls.has(entry.url));
  return withDockList(withDockList(docks, from, []), to, [...target, ...moved]);
}
