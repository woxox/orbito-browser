/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Space list: one for the whole profile, in order, each Space
 * {id, name, backend?, model?}: backend and model are its settings' default
 * for the Assistant (see OrbitoAssistantCore.spaceBackend()), left out for
 * the profile's. These functions take a list and give a new one or an
 * answer; they never change the list they get. Which Space a tab is in and
 * which Space a window shows are kept by the Shell (shell/spaces.mjs).
 */

/** As many Spaces as the shortcuts reach (1 to 9). */
export const MAX_SPACES = 9;

/**
 * The name a new Space gets: name(N) ("Space N" by default), the lowest N
 * no Space has, in either form (a first Space is "Space 1" in any language).
 */
export function defaultSpaceName(spaces, name = n => `Space ${n}`) {
  let names = new Set(spaces.map(space => space.name));
  let n = 1;
  while (names.has(name(n)) || names.has(`Space ${n}`)) {
    n++;
  }
  return name(n);
}

/**
 * A usable list from what was stored: entries without an id or with one
 * already seen are dropped, a missing name becomes a default one, and an
 * empty list gets a first Space, so there is always one.
 *
 * @param {any} stored
 * @param {() => string} newId Makes the first Space's id when one is needed.
 * @returns {Array<{id: string, name: string, backend?: string, model?: string}>}
 */
export function checkSpaces(stored, newId) {
  let spaces = [];
  let ids = new Set();
  for (let entry of Array.isArray(stored) ? stored : []) {
    let id = typeof entry?.id == "string" ? entry.id : "";
    if (!id || ids.has(id)) {
      continue;
    }
    ids.add(id);
    let name = typeof entry.name == "string" ? entry.name.trim() : "";
    let space = { id, name: name || defaultSpaceName(spaces) };
    for (let key of ["backend", "model"]) {
      if (typeof entry[key] == "string" && entry[key]) {
        space[key] = entry[key];
      }
    }
    spaces.push(space);
  }
  if (!spaces.length) {
    spaces.push({ id: newId(), name: defaultSpaceName([]) });
  }
  return spaces.slice(0, MAX_SPACES);
}

/**
 * The list with a new Space at the end, or null when it is full.
 *
 * @param {(n: number) => string} [name] Makes the Nth default name.
 * @returns {{spaces: Array, space: {id: string, name: string}} | null}
 */
export function addSpace(spaces, id, name) {
  if (spaces.length >= MAX_SPACES) {
    return null;
  }
  let space = { id, name: defaultSpaceName(spaces, name) };
  return { spaces: [...spaces, space], space };
}

/**
 * The list with a Space renamed, or the same list when the name is blank
 * (a Space always has one) or the Space's already.
 */
export function renameSpace(spaces, id, name) {
  name = String(name ?? "").trim();
  if (!name || !spaces.some(space => space.id == id && space.name != name)) {
    return spaces;
  }
  return spaces.map(space => (space.id == id ? { ...space, name } : space));
}

/** The list without a Space; the last Space is never removed. */
export function removeSpace(spaces, id) {
  let rest = spaces.filter(space => space.id != id);
  return rest.length ? rest : spaces;
}

/** The ids in before that after no longer has. */
export function removedSpaces(before, after) {
  let kept = new Set(after.map(space => space.id));
  return before.filter(space => !kept.has(space.id)).map(space => space.id);
}

/** id if the list has that Space, else the first Space's id. */
export function resolveSpace(spaces, id) {
  return spaces.some(space => space.id == id) ? id : spaces[0].id;
}

/** The id of the nth Space (from 1), or null when there are fewer. */
export function spaceAt(spaces, n) {
  return spaces[n - 1]?.id ?? null;
}

/**
 * The id of the Space step places after (1) or before (-1) the Space id,
 * going round from the last to the first and back.
 */
export function stepSpace(spaces, id, step) {
  let index = spaces.findIndex(space => space.id == id);
  let count = spaces.length;
  return spaces[(((index + step) % count) + count) % count].id;
}

/**
 * Which way a switch goes in the list: 1 to a later Space, -1 to an
 * earlier one, 0 when it stays.
 */
export function switchDirection(spaces, from, to) {
  let a = spaces.findIndex(space => space.id == from);
  let b = spaces.findIndex(space => space.id == to);
  return Math.sign(b - a);
}
