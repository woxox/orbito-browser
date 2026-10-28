/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Pin list: one for the whole profile, in order, each Pin
 * {id, url, title, icon}. The URL is the one the Pin was made with: a Pin's
 * tab that goes elsewhere does not change it. These functions take a list
 * and give a new one; they never change the list they get. Which Pin a tab
 * stands for is kept by the Shell (shell/pins.mjs).
 */

/**
 * A usable list from what was stored: entries without an id or a URL, or
 * with an id already seen, are dropped; a missing title becomes the URL, a
 * missing icon none.
 *
 * @param {any} stored
 * @returns {Array<{id: string, url: string, title: string, icon: string}>}
 */
export function checkPins(stored) {
  let pins = [];
  let ids = new Set();
  for (let entry of Array.isArray(stored) ? stored : []) {
    let id = typeof entry?.id == "string" ? entry.id : "";
    let url = typeof entry?.url == "string" ? entry.url.trim() : "";
    if (!id || !url || ids.has(id)) {
      continue;
    }
    ids.add(id);
    let title = typeof entry.title == "string" ? entry.title.trim() : "";
    let icon = typeof entry.icon == "string" ? entry.icon : "";
    pins.push({ id, url, title: title || url, icon });
  }
  return pins;
}

/** The list with a Pin put in at index (at the end without one). */
export function addPin(pins, pin, index = pins.length) {
  let rest = pins.filter(p => p.id != pin.id);
  index = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, index), pin, ...rest.slice(index)];
}

/** The list without a Pin. */
export function removePin(pins, id) {
  return pins.filter(pin => pin.id != id);
}

/**
 * The list with a Pin moved to index, counted in the list without it (so
 * the Pin ends up at that index).
 */
export function movePin(pins, id, index) {
  let pin = pins.find(p => p.id == id);
  return pin ? addPin(pins, pin, index) : pins;
}

/**
 * The list in the order of ids (a window's Pin tabs as they now stand):
 * the Pins ids names, in that order, then the others as they were.
 */
export function orderPins(pins, ids) {
  let byId = new Map(pins.map(pin => [pin.id, pin]));
  let ordered = [...new Set(ids)]
    .filter(id => byId.has(id))
    .map(id => byId.get(id));
  let named = new Set(ordered.map(pin => pin.id));
  return [...ordered, ...pins.filter(pin => !named.has(pin.id))];
}

/** Whether two lists have the same Pins in the same order. */
export function sameOrder(a, b) {
  return a.length == b.length && a.every((pin, i) => pin.id == b[i].id);
}
