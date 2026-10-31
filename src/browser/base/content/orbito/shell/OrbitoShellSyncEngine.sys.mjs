/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Firefox Sync engine of the Shell's lists: the Pins, the Spaces (their
 * names and order) and each Space's Dock, the same on every device of the
 * account (see docs/adr/0004-shell-sync.md). One collection, "orbito", its
 * records end-to-end encrypted as Sync's others are; on or off with the
 * services.sync.engine.orbito pref, in Firefox's "Choose what to sync".
 * Firefox's Sync service registers it (services/sync service.sys.mjs).
 *
 * The engine only changes the lists in OrbitoShellStore, telling the
 * windows the change is another device's (remote); each window's Pins,
 * Docks and Spaces follow with their tabs. A Space another device removed
 * also takes what this device keeps in it (OrbitoAssistantCore).
 */

import {
  LegacyTracker,
  Store,
  SyncEngine,
} from "resource://services-sync/engines.sys.mjs";
import { CryptoWrapper } from "resource://services-sync/record.sys.mjs";
import { SCORE_INCREMENT_XLARGE } from "resource://services-sync/constants.sys.mjs";
import { Utils } from "resource://services-sync/util.sys.mjs";

import {
  OrbitoShellStore,
  STORE_CHANGED,
} from "chrome://browser/content/orbito/shell/OrbitoShellStore.sys.mjs";
import { checkPins } from "chrome://browser/content/orbito/shell/OrbitoPins.sys.mjs";
import { checkDocks } from "chrome://browser/content/orbito/shell/OrbitoDocks.sys.mjs";
import { checkSpaces } from "chrome://browser/content/orbito/shell/OrbitoSpaces.sys.mjs";
import {
  applyRecords,
  changedIds,
  firstMerge,
  toRecords,
} from "chrome://browser/content/orbito/shell/OrbitoShellSync.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  OrbitoAssistantCore:
    "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs",
});

/** The store keys of the lists, and of the Dock records held here. */
const PINS = "pins";
const DOCKS = "docks";
const SPACES = "spaces";
const HELD = "syncHeld";

const RECORD_FIELDS = [
  "kind",
  "url",
  "title",
  "icon",
  "space",
  "folder",
  "name",
  "ids",
];

const newId = () => crypto.randomUUID();

/** The lists as stored: {pins, docks, spaces}. */
export function readLists() {
  let spaces = OrbitoShellStore.get(SPACES);
  return {
    pins: checkPins(OrbitoShellStore.get(PINS)),
    docks: checkDocks(OrbitoShellStore.get(DOCKS)),
    // None yet (no window has made the first): none to send.
    spaces: Array.isArray(spaces) && spaces.length ? checkSpaces(spaces, newId) : [],
  };
}

/**
 * Stores lists another device changed, every window following. New Spaces
 * come first, those gone staying until the Docks have moved, so that a
 * Dock entry's tab can go to its Space; then the Docks, the Pins, and the
 * Spaces as they are.
 *
 * @param {object} before The lists as they were.
 * @param {object} after
 * @param {{[from: string]: string}} moveTabs Spaces gone whose tabs go to
 *   another.
 */
function writeLists(before, after, moveTabs) {
  let change = { remote: true, moveTabs };
  let set = (key, from, to) => {
    if (JSON.stringify(from) != JSON.stringify(to)) {
      OrbitoShellStore.set(key, to, change);
    }
  };
  let kept = before.spaces.filter(
    space => !after.spaces.some(s => s.id == space.id)
  );
  let spaces = [...after.spaces, ...kept];
  set(SPACES, before.spaces, spaces);
  set(DOCKS, before.docks, after.docks);
  set(PINS, before.pins, after.pins);
  set(SPACES, spaces, after.spaces);
}

export class OrbitoShellRecord extends CryptoWrapper {
  _logName = "Sync.Record.Orbito";
}
Utils.deferGetSet(OrbitoShellRecord, "cleartext", RECORD_FIELDS);

class OrbitoShellSyncStore extends Store {
  async itemExists(id) {
    return id in toRecords(readLists());
  }

  async getAllIDs() {
    return Object.fromEntries(
      Object.keys(toRecords(readLists())).map(id => [id, true])
    );
  }

  async createRecord(id, collection) {
    let record = new OrbitoShellRecord(collection, id);
    let fields = toRecords(readLists())[id];
    if (fields) {
      Object.assign(record.cleartext, fields);
    } else {
      record.deleted = true;
    }
    return record;
  }

  /**
   * A batch of another device's records, applied at once (see
   * applyRecords), or merged with the lists here on a first sync (see
   * firstMerge).
   */
  async applyIncomingBatch(records) {
    let before = readLists();
    let held = OrbitoShellStore.get(HELD) ?? {};
    let merge = this.engine.firstSync ? firstMerge : applyRecords;
    let result = merge(
      before,
      records.map(record => ({
        ...record.cleartext,
        id: record.id,
        deleted: !!record.deleted,
      })),
      held
    );
    if (JSON.stringify(result.held) != JSON.stringify(held)) {
      OrbitoShellStore.set(HELD, result.held);
    }
    writeLists(before, result.state, result.overflow);
    // What this device decided goes back (the Spaces past the limit, the
    // whole merge on a first sync).
    let now = Date.now() / 1000;
    for (let id of result.changed) {
      this.engine._modified.set(id, now);
    }
    for (let space of result.goneSpaces) {
      lazy.OrbitoAssistantCore.spaceRemovedElsewhere(space).catch(
        console.error
      );
    }
    // A Space past the limit goes into the last one, what it keeps too.
    for (let [space, to] of Object.entries(result.overflow)) {
      lazy.OrbitoAssistantCore.spaceRemovedElsewhere(space, to).catch(
        console.error
      );
    }
    return [];
  }

  /**
   * Sync asks this of a store to start again from the server's data; the
   * lists stay as they are (the next sync merges them as a first one), only
   * the Dock records held here go.
   */
  async wipe() {
    OrbitoShellStore.set(HELD, {});
  }
}

/**
 * Marks the records a change to the lists here touches: the items and the
 * orders that differ (changedIds), none when another device made it.
 */
class OrbitoShellTracker extends LegacyTracker {
  #lists = null;

  onStart() {
    this.#lists = readLists();
    Services.obs.addObserver(this, STORE_CHANGED);
  }

  onStop() {
    Services.obs.removeObserver(this, STORE_CHANGED);
  }

  observe(subject, topic, key) {
    if (![PINS, DOCKS, SPACES].includes(key)) {
      return;
    }
    let lists = readLists();
    let ids = changedIds(this.#lists, lists, {
      applying: !!subject?.wrappedJSObject?.remote,
    });
    this.#lists = lists;
    if (ids.length) {
      this.#track(ids).catch(console.error);
    }
  }

  async #track(ids) {
    let added = false;
    for (let id of ids) {
      added = (await this.addChangedID(id)) || added;
    }
    if (added) {
      this.score += SCORE_INCREMENT_XLARGE;
    }
  }
}

export class OrbitoShellEngine extends SyncEngine {
  /** Whether this sync is the first (since Sync or the engine came on). */
  firstSync = false;

  constructor(service) {
    super("Orbito", service);
  }

  get _storeObj() {
    return OrbitoShellSyncStore;
  }

  get _trackerObj() {
    return OrbitoShellTracker;
  }

  get _recordObj() {
    return OrbitoShellRecord;
  }

  get syncPriority() {
    return 10;
  }

  async _syncStartup() {
    // After the server's syncID is checked: a new one (the collection wiped
    // and made again elsewhere) resets the last sync, and the lists here
    // merge again.
    await super._syncStartup();
    this.firstSync = !(await this.getLastSync());
  }

  async _syncCleanup() {
    this.firstSync = false;
    await super._syncCleanup();
  }

  /**
   * Whether an incoming record is applied. On a first sync every one is,
   * for firstMerge to merge them all. Then an item's tombstone wins over a
   * change to it, whichever came later: a change to an item removed here
   * is dropped, and a tombstone for an item changed here applies.
   */
  async _reconcile(item) {
    if (this.firstSync) {
      return true;
    }
    if (
      !item.deleted &&
      this._modified.has(item.id) &&
      !(await this._store.itemExists(item.id))
    ) {
      return false;
    }
    return super._reconcile(item);
  }

  async _shouldReviveRemotelyDeletedRecord() {
    return false;
  }
}
