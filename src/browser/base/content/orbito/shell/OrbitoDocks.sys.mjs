/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Docks: one list per Space, all of them kept for the whole profile, as
 * {[spaceId]: [item]}, each list in order. An item is an entry
 * {id, url, title, icon}, shaped as a Pin is (shell/OrbitoPins.sys.mjs), or
 * a folder {id, title, children: [entry]}, which holds entries only (no
 * folder in a folder), in order. An entry's URL is the one it was docked
 * with: the tab goes back to it when closed, whatever page it went to
 * since, until the user replaces it with the page the tab shows
 * (updateDock), the entry keeping its id and place. An item's id is unique
 * across every Space, folders' and entries'
 * alike. These functions take the lists and give new ones; they never
 * change what they get. Which Dock entry a tab stands for is kept by the
 * Shell (shell/docks.mjs).
 *
 * Another module that adds to a Dock (an import, say) changes the stored
 * lists and the windows follow:
 *
 *   let docks = checkDocks(OrbitoShellStore.get(DOCKS_KEY));
 *   docks = addDock(docks, space, dockFolder("Work", entries));
 *   OrbitoShellStore.set(DOCKS_KEY, docks);
 */

import { checkPins, orderPins, updatePin } from "./OrbitoPins.sys.mjs";

/** The OrbitoShellStore key of the Dock lists. */
export const DOCKS_KEY = "docks";

/** Whether a Dock item is a folder. */
export function isDockFolder(item) {
  return Array.isArray(item?.children);
}

/**
 * A new folder of entries (each {url, title?, icon?}, given an id if it
 * has none), for addDock.
 *
 * @param {string} title
 * @param {Array<{id?: string, url: string, title?: string, icon?: string}>} [entries]
 */
export function dockFolder(title, entries = []) {
  return {
    id: crypto.randomUUID(),
    title: String(title ?? "").trim(),
    children: checkPins(
      entries.map(entry => ({ ...entry, id: entry.id ?? crypto.randomUUID() }))
    ),
  };
}

/**
 * Usable lists from what was stored: per Space, the entries checkPins
 * keeps and folders with an id (a missing title none, their children as
 * entries are checked); an item whose id another (in any list) already has
 * is dropped. Empty lists are left out; an empty folder stays.
 *
 * @param {any} stored
 * @returns {{[spaceId: string]: Array<{id: string, url: string, title: string, icon: string} | {id: string, title: string, children: object[]}>}}
 */
export function checkDocks(stored) {
  let docks = {};
  let ids = new Set();
  if (!stored || typeof stored != "object" || Array.isArray(stored)) {
    return docks;
  }
  let fresh = item => {
    if (ids.has(item.id)) {
      return false;
    }
    ids.add(item.id);
    return true;
  };
  for (let [space, items] of Object.entries(stored)) {
    let list = [];
    for (let item of Array.isArray(items) ? items : []) {
      if (isDockFolder(item)) {
        let id = typeof item.id == "string" ? item.id : "";
        if (!id || !fresh({ id })) {
          continue;
        }
        let title = typeof item.title == "string" ? item.title.trim() : "";
        list.push({
          id,
          title,
          children: checkPins(item.children).filter(fresh),
        });
      } else {
        list.push(...checkPins([item]).filter(fresh));
      }
    }
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

/** A Dock list's entries, those in folders too, in order. */
export function dockEntries(list) {
  return list.flatMap(item => (isDockFolder(item) ? item.children : [item]));
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

/**
 * Where an item is, by its id (an entry's or a folder's): its Space, the
 * item, and the id of the folder it is in (null at the top of the list);
 * or null.
 */
export function findDock(docks, id) {
  for (let [space, list] of Object.entries(docks)) {
    for (let item of list) {
      if (item.id == id) {
        return { space, entry: item, folder: null };
      }
      let child = isDockFolder(item) && item.children.find(e => e.id == id);
      if (child) {
        return { space, entry: child, folder: item.id };
      }
    }
  }
  return null;
}

/** A list without an item, wherever it is in it. */
function without(list, id) {
  return list
    .filter(item => item.id != id)
    .map(item =>
      isDockFolder(item) && item.children.some(e => e.id == id)
        ? { ...item, children: item.children.filter(e => e.id != id) }
        : item
    );
}

/** The lists without an item (a folder goes with its entries), wherever it is. */
export function removeDock(docks, id) {
  let found = findDock(docks, id);
  return found
    ? withDockList(docks, found.space, without(docks[found.space], id))
    : docks;
}

/**
 * The lists with an item (an entry or a folder) put in a Space's Dock, at
 * index (at the end without one): at the top of the list, or in a folder
 * of that Space when one is named (an entry only; a folder not there puts
 * it at the top). Wherever the item, or a folder's entry, was before, it
 * is taken out: the index counts the place without it.
 *
 * @param {object} docks
 * @param {string} space
 * @param {object} item
 * @param {{folder?: string|null, index?: number}} [where]
 */
export function addDock(
  docks,
  space,
  item,
  { folder = null, index = Infinity } = {}
) {
  let next = removeDock(docks, item.id);
  if (isDockFolder(item)) {
    for (let entry of item.children) {
      next = removeDock(next, entry.id);
    }
    folder = null;
  }
  let list = dockList(next, space);
  let put = (items, at) => {
    at = Math.max(0, Math.min(at, items.length));
    return [...items.slice(0, at), item, ...items.slice(at)];
  };
  if (folder && list.some(i => i.id == folder && isDockFolder(i))) {
    list = list.map(i =>
      i.id == folder ? { ...i, children: put(i.children, index) } : i
    );
  } else {
    list = put(list, index);
  }
  return withDockList(next, space, list);
}

/**
 * The lists with an item moved to a place in a Space's Dock (its own
 * without one), as addDock puts it.
 */
export function moveDock(
  docks,
  id,
  { space, folder = null, index = Infinity } = {}
) {
  let found = findDock(docks, id);
  return found
    ? addDock(docks, space ?? found.space, found.entry, { folder, index })
    : docks;
}

/**
 * The lists with an entry's page ({url, title, icon}) replaced, wherever it
 * is, the entry keeping its id and place.
 */
export function updateDock(docks, id, page) {
  let found = findDock(docks, id);
  if (!found || isDockFolder(found.entry)) {
    return docks;
  }
  let list = docks[found.space];
  return withDockList(
    docks,
    found.space,
    found.folder
      ? list.map(item =>
          item.id == found.folder
            ? { ...item, children: updatePin(item.children, id, page) }
            : item
        )
      : updatePin(list, id, page)
  );
}

/** The lists with a folder named anew (a blank title keeps the old one). */
export function renameDockFolder(docks, id, title) {
  let found = findDock(docks, id);
  title = String(title ?? "").trim();
  if (!found || !isDockFolder(found.entry) || !title) {
    return docks;
  }
  return withDockList(
    docks,
    found.space,
    docks[found.space].map(item => (item.id == id ? { ...item, title } : item))
  );
}

/**
 * The lists without a folder, its entries left in the Dock where it was,
 * in its order.
 */
export function ungroupDockFolder(docks, id) {
  let found = findDock(docks, id);
  if (!found || !isDockFolder(found.entry)) {
    return docks;
  }
  return withDockList(
    docks,
    found.space,
    docks[found.space].flatMap(item => (item.id == id ? item.children : [item]))
  );
}

/**
 * A list in the order of ids (a window's Dock tabs as they now stand), as
 * far as its folders allow: each folder's entries in that order, and the
 * top of the list in it too, a folder where its first entry is. An empty
 * folder stays after the item it was after; entries ids does not name
 * stay after those it does.
 */
export function orderDock(list, ids) {
  let at = new Map([...new Set(ids)].map((id, i) => [id, i]));
  let rank = id => at.get(id) ?? Infinity;
  let items = list.map(item =>
    isDockFolder(item)
      ? { ...item, children: orderPins(item.children, ids) }
      : item
  );
  let ranks = [];
  items.forEach((item, i) => {
    let r = isDockFolder(item)
      ? Math.min(...item.children.map(e => rank(e.id)))
      : rank(item.id);
    // An empty folder, or one of entries ids leaves out: after what was
    // before it.
    ranks.push(r == Infinity && i ? ranks[i - 1] : r);
  });
  return items
    .map((item, i) => ({ item, rank: ranks[i], i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(({ item }) => item);
}

/** Whether two Dock lists have the same items, in the same folders and order. */
export function sameDock(a, b) {
  let shape = list =>
    JSON.stringify(
      list.map(item =>
        isDockFolder(item) ? [item.id, item.children.map(e => e.id)] : item.id
      )
    );
  return shape(a) == shape(b);
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
 * items, folders with it; an entry of a URL the other's Dock already has
 * is left out.
 */
export function moveDocks(docks, from, to) {
  if (!docks[from]) {
    return docks;
  }
  let target = dockList(docks, to);
  let urls = new Set(dockEntries(target).map(entry => entry.url));
  let moved = docks[from]
    .map(item =>
      isDockFolder(item)
        ? { ...item, children: item.children.filter(e => !urls.has(e.url)) }
        : item
    )
    .filter(item => isDockFolder(item) || !urls.has(item.url));
  return withDockList(withDockList(docks, from, []), to, [...target, ...moved]);
}
