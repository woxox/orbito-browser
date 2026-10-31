/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Shell's lists as Firefox Sync records, and other devices' records
 * merged into them (see docs/adr/0004-shell-sync.md). A state is the three
 * lists as OrbitoShellStore keeps them, {pins, docks, spaces}. These
 * functions take a state and give a new one; they never change what they
 * get. The Sync engine (OrbitoShellSyncEngine.sys.mjs) reads and writes the
 * store with them.
 *
 * A record per Pin {kind: "pin", url, title, icon}, per Dock entry (the
 * same, and space, and folder when it is in one), per Dock folder
 * {kind: "dock-folder", title, space} and per Space {kind: "space", name},
 * under the item's own id; and a record per list's order
 * {kind: "order", ids}: the Pins', the Spaces', each Space's Dock's (the
 * items at its top, folders too) and each Dock folder's. A Space's backend
 * and model stay on the device.
 */

import { checkPins, orderPins } from "./OrbitoPins.sys.mjs";
import {
  addDock,
  dockEntries,
  findDock,
  isDockFolder,
  moveDocks,
  removeDock,
  ungroupDockFolder,
  withDockList,
} from "./OrbitoDocks.sys.mjs";
import { defaultSpaceName, MAX_SPACES } from "./OrbitoSpaces.sys.mjs";

/** The record ids of the Pins' and the Spaces' order. */
export const ORDER_PINS = "order-pins";
export const ORDER_SPACES = "order-spaces";
const DOCK_ORDER = "order-dock-";
const FOLDER_ORDER = "order-folder-";

/** The record id of a Space's Dock's order. */
export function dockOrderId(space) {
  return DOCK_ORDER + space;
}

/** The record id of a Dock folder's order. */
export function folderOrderId(folder) {
  return FOLDER_ORDER + folder;
}

/** A Pin or Dock entry's record fields; a data: icon is too big to send. */
function entryFields({ url, title, icon }) {
  return { url, title, icon: icon.startsWith("data:") ? "" : icon };
}

/**
 * Every record of a state, by id: the items', then the orders'. A Dock of
 * a Space not in the list has none.
 *
 * @returns {{[id: string]: object}}
 */
export function toRecords({ pins, docks, spaces }) {
  let records = {};
  for (let pin of pins) {
    records[pin.id] = { kind: "pin", ...entryFields(pin) };
  }
  for (let { id: space } of spaces) {
    for (let item of docks[space] ?? []) {
      if (!isDockFolder(item)) {
        records[item.id] = { kind: "dock", ...entryFields(item), space };
        continue;
      }
      records[item.id] = { kind: "dock-folder", title: item.title, space };
      for (let entry of item.children) {
        records[entry.id] = {
          kind: "dock",
          ...entryFields(entry),
          space,
          folder: item.id,
        };
      }
    }
  }
  for (let { id, name } of spaces) {
    records[id] = { kind: "space", name };
  }
  records[ORDER_PINS] = { kind: "order", ids: pins.map(pin => pin.id) };
  records[ORDER_SPACES] = { kind: "order", ids: spaces.map(s => s.id) };
  for (let { id: space } of spaces) {
    records[dockOrderId(space)] = {
      kind: "order",
      ids: (docks[space] ?? []).map(item => item.id),
    };
    for (let folder of (docks[space] ?? []).filter(isDockFolder)) {
      records[folderOrderId(folder.id)] = {
        kind: "order",
        ids: folder.children.map(entry => entry.id),
      };
    }
  }
  return records;
}

/**
 * The ids of the records a change from before to after adds, changes or
 * removes: none while another device's records are being applied, which
 * are not sent back.
 */
export function changedIds(before, after, { applying = false } = {}) {
  if (applying) {
    return [];
  }
  let a = toRecords(before);
  let b = toRecords(after);
  let changed = Object.keys(b).filter(
    id => JSON.stringify(a[id]) != JSON.stringify(b[id])
  );
  return [...changed, ...Object.keys(a).filter(id => !(id in b))];
}

/** An entry from a record, keeping the icon it had when the record has none. */
function entryFrom(record, had) {
  let [entry] = checkPins([{ ...record }]);
  if (entry && !entry.icon && had?.icon) {
    entry.icon = had.icon;
  }
  return entry;
}

/**
 * The lists of a state in the Spaces' order, a Dock only for a Space
 * listed: the Spaces past MAX_SPACES go, their Docks after the last one's
 * (without a URL it has), as when a Space is removed.
 *
 * @returns {{state: object, overflow: {[from: string]: string}}}
 */
function fitSpaces({ pins, docks, spaces }) {
  let overflow = {};
  if (spaces.length > MAX_SPACES) {
    let last = spaces[MAX_SPACES - 1].id;
    for (let { id } of spaces.slice(MAX_SPACES)) {
      docks = moveDocks(docks, id, last);
      overflow[id] = last;
    }
    spaces = spaces.slice(0, MAX_SPACES);
  }
  let ordered = {};
  for (let { id } of spaces) {
    if (docks[id]?.length) {
      ordered[id] = docks[id];
    }
  }
  return { state: { pins, docks: ordered, spaces }, overflow };
}

/**
 * Another device's records applied to a state: Spaces first, then Dock
 * folders, Dock entries, Pins, and the orders last. An item's tombstone
 * ({id, deleted}) wins over a change to it; a Dock folder's leaves its
 * entries in the Dock (those removed with it have tombstones of their
 * own). A Dock folder or entry whose Space, or an entry whose folder, is
 * not here yet is held (held, by id) until it comes, or goes with the
 * Space's tombstone. An order keeps the ids it names in its order, and the
 * items it does not name (just added elsewhere) after them.
 *
 * @param {object} state
 * @param {object[]} records Each {id, deleted} or {id, kind, ...fields}.
 * @param {{[id: string]: object}} [held] Dock records waiting for their
 *   Space or folder.
 * @returns {{state: object, held: object, goneSpaces: string[],
 *   overflow: object, changed: string[]}} goneSpaces, the Spaces a
 *   tombstone removed; overflow, the Spaces past MAX_SPACES and where they
 *   went; changed, the ids to send back for that.
 */
export function applyRecords(state, records, held = {}) {
  let applied = applyLists(state, records, held);
  let fitted = fitSpaces(applied.state);
  return {
    ...applied,
    ...fitted,
    changed: changedIds(applied.state, fitted.state),
  };
}

/** applyRecords before the Spaces are fitted to MAX_SPACES. */
function applyLists(state, records, held) {
  let { pins, docks, spaces } = state;
  held = { ...held };
  let goneSpaces = [];
  let deleted = new Set(records.filter(r => r.deleted).map(r => r.id));
  let live = records.filter(r => !r.deleted && !deleted.has(r.id));
  let ofKind = kind => live.filter(r => r.kind == kind);

  // Spaces.
  for (let id of deleted) {
    for (let [entry, record] of Object.entries(held)) {
      if (record.space == id) {
        delete held[entry];
      }
    }
    if (spaces.some(s => s.id == id)) {
      spaces = spaces.filter(s => s.id != id);
      docks = withDockList(docks, id, []);
      goneSpaces.push(id);
    }
  }
  for (let { id, name } of ofKind("space")) {
    name = String(name ?? "").trim() || defaultSpaceName(spaces);
    spaces = spaces.some(s => s.id == id)
      ? spaces.map(s => (s.id == id ? { ...s, name } : s))
      : [...spaces, { id, name }];
  }

  // Dock folders, then entries.
  let hasSpace = id => spaces.some(s => s.id == id);
  for (let id of deleted) {
    let found = findDock(docks, id);
    docks = isDockFolder(found?.entry)
      ? ungroupDockFolder(docks, id)
      : removeDock(docks, id);
    delete held[id];
    // Entries waiting for a folder gone: it took them, or they come again
    // without it.
    for (let [entry, record] of Object.entries(held)) {
      if (record.folder == id) {
        delete held[entry];
      }
    }
  }
  let hasFolder = record =>
    !record.folder ||
    (docks[record.space] ?? []).some(
      item => item.id == record.folder && isDockFolder(item)
    );
  let ready = record => hasSpace(record.space) && hasFolder(record);
  let place = record => {
    let found = findDock(docks, record.id);
    if (record.kind == "dock-folder") {
      let title = String(record.title ?? "").trim();
      let folder = { id: record.id, title, children: [] };
      if (isDockFolder(found?.entry)) {
        folder.children = found.entry.children;
      }
      docks =
        found?.space == record.space
          ? withDockList(
              docks,
              record.space,
              docks[record.space].map(i => (i.id == folder.id ? folder : i))
            )
          : addDock(docks, record.space, folder);
      return;
    }
    let entry = entryFrom(record, found?.entry);
    if (!entry) {
      return;
    }
    let folder = record.folder || null;
    if (found?.space == record.space && found.folder == folder) {
      let swap = e => (e.id == entry.id ? entry : e);
      docks = withDockList(
        docks,
        record.space,
        docks[record.space].map(item =>
          item.id == folder ? { ...item, children: item.children.map(swap) } : swap(item)
        )
      );
    } else {
      docks = addDock(docks, record.space, entry, { folder });
    }
  };
  let docksIn = live
    .filter(r => r.kind == "dock-folder")
    .concat(ofKind("dock"));
  for (let record of docksIn) {
    // A record of an entry's folder in the same batch has just been placed.
    if (ready(record)) {
      delete held[record.id];
      place(record);
    } else {
      let found = findDock(docks, record.id);
      docks = isDockFolder(found?.entry)
        ? ungroupDockFolder(docks, record.id)
        : removeDock(docks, record.id);
      held[record.id] = record;
    }
  }
  // Folders first, for the entries waiting for them.
  let waiting = Object.values(held).sort(
    (a, b) => (b.kind == "dock-folder") - (a.kind == "dock-folder")
  );
  for (let record of waiting) {
    if (ready(record)) {
      delete held[record.id];
      place(record);
    }
  }

  // Pins.
  pins = pins.filter(pin => !deleted.has(pin.id));
  for (let record of ofKind("pin")) {
    let had = pins.find(pin => pin.id == record.id);
    let entry = entryFrom(record, had);
    if (entry) {
      pins = had
        ? pins.map(pin => (pin.id == entry.id ? entry : pin))
        : [...pins, entry];
    }
  }

  // Orders.
  for (let { id, ids } of ofKind("order")) {
    ids = Array.isArray(ids) ? ids : [];
    if (id == ORDER_PINS) {
      pins = orderPins(pins, ids);
    } else if (id == ORDER_SPACES) {
      spaces = orderPins(spaces, ids);
    } else if (id.startsWith(DOCK_ORDER)) {
      let space = id.slice(DOCK_ORDER.length);
      if (docks[space]) {
        docks = withDockList(docks, space, orderPins(docks[space], ids));
      }
    } else if (id.startsWith(FOLDER_ORDER)) {
      let found = findDock(docks, id.slice(FOLDER_ORDER.length));
      if (isDockFolder(found?.entry)) {
        let folder = found.entry;
        docks = withDockList(
          docks,
          found.space,
          docks[found.space].map(item =>
            item == folder
              ? { ...item, children: orderPins(item.children, ids) }
              : item
          )
        );
      }
    }
  }

  return { state: { pins, docks, spaces }, held, goneSpaces };
}

/**
 * The first merge of this device's lists with the server's (records, all
 * of them), when Sync is first connected or turned on again: neither side
 * is lost. Each list has the server's items first, then this device's,
 * less a Pin of a URL the server's Pins have, or a Dock entry of a URL its
 * Space's Dock has there (in a folder or not); each Dock folder's entries
 * too. Spaces of the same name stay apart. Past
 * MAX_SPACES, the extra Spaces' Docks go to the last one (see
 * applyRecords).
 *
 * @returns {{state: object, held: object, goneSpaces: string[],
 *   overflow: object, changed: string[]}} changed, every id to send.
 */
export function firstMerge(local, records, held = {}) {
  let fromServer = new Set(records.filter(r => !r.deleted).map(r => r.id));
  let applied = applyLists(local, records, held);
  let serverFirst = (list, oneURL) => {
    let server = list.filter(item => fromServer.has(item.id));
    let urls = new Set(server.map(item => item.url));
    let mine = list.filter(
      item => !fromServer.has(item.id) && !(oneURL && urls.has(item.url))
    );
    return [...server, ...mine];
  };
  let mergeDock = list => {
    let urls = new Set(
      dockEntries(list)
        .filter(entry => fromServer.has(entry.id))
        .map(entry => entry.url)
    );
    let keep = entry => fromServer.has(entry.id) || !urls.has(entry.url);
    return serverFirst(
      list
        .filter(item => isDockFolder(item) || keep(item))
        .map(item =>
          isDockFolder(item)
            ? { ...item, children: serverFirst(item.children.filter(keep), false) }
            : item
        ),
      false
    );
  };
  let { pins, docks, spaces } = applied.state;
  let merged = {
    pins: serverFirst(pins, true),
    docks: Object.fromEntries(
      Object.entries(docks).map(([space, list]) => [space, mergeDock(list)])
    ),
    spaces: serverFirst(spaces, false),
  };
  let fitted = fitSpaces(merged);
  return {
    ...applied,
    ...fitted,
    changed: [
      ...new Set([
        ...Object.keys(toRecords(fitted.state)),
        ...changedIds(local, fitted.state),
      ]),
    ],
  };
}
