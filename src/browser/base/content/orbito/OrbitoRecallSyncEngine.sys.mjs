/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Firefox Sync engine of Browsing recall's visits: this device's visits
 * go to the account's other devices, theirs come here for the timeline,
 * and a page forgotten from the timeline is forgotten on every device (see
 * docs/adr/0007-recall-sync.md). One collection, "orbitorecall", on or off
 * with the services.sync.engine.orbitorecall pref, in Firefox's "Choose
 * what to sync". Firefox's Sync service registers it (services/sync
 * service.sys.mjs).
 *
 * What another device's records change is decided by incomingActions
 * (OrbitoRecallSync.sys.mjs) and applied to the assistant's store at once.
 * No tombstone is ever sent: a visit gone here is not sent at all, and the
 * server forgets old records by their ttl.
 */

import {
  LegacyTracker,
  Store,
  SyncEngine,
} from "resource://services-sync/engines.sys.mjs";
import { CryptoWrapper } from "resource://services-sync/record.sys.mjs";
import {
  SCORE_INCREMENT_SMALL,
  SCORE_INCREMENT_XLARGE,
} from "resource://services-sync/constants.sys.mjs";
import { Utils } from "resource://services-sync/util.sys.mjs";

import {
  forgetId,
  forgetRecord,
  incomingActions,
  isForgetId,
  recordTTL,
  SYNC_CHANGED,
  visitRecord,
} from "chrome://browser/content/orbito/OrbitoRecallSync.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  isExcludedHost: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  OrbitoAssistantCore:
    "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs",
  OrbitoRecall: "chrome://browser/content/orbito/OrbitoRecall.sys.mjs",
  RETENTION_PREF: "chrome://browser/content/orbito/OrbitoRecall.sys.mjs",
  retentionCutoff: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
});

const START_OVER = "weave:service:start-over";

const RECORD_FIELDS = [
  "kind",
  "url",
  "title",
  "visitedAt",
  "dwellMs",
  "space",
  "device",
  "deviceName",
  "at",
];

function store() {
  return lazy.OrbitoAssistantCore.store;
}

function retentionDays() {
  return Services.prefs.getIntPref(lazy.RETENTION_PREF, 180);
}

export class OrbitoRecallRecord extends CryptoWrapper {
  _logName = "Sync.Record.OrbitoRecall";
}
Utils.deferGetSet(OrbitoRecallRecord, "cleartext", RECORD_FIELDS);

class OrbitoRecallSyncStore extends Store {
  async #forget(id) {
    for (let [url, at] of await store().recallForgets()) {
      if (forgetId(url) == id) {
        return { url, at };
      }
    }
    return null;
  }

  /** This device's visits (none while Browsing recall is off) and forgets. */
  async itemExists(id) {
    if (isForgetId(id)) {
      return !!(await this.#forget(id));
    }
    return lazy.OrbitoRecall.enabled && !!(await store().recallVisit(id));
  }

  async getAllIDs() {
    let ids = {};
    if (lazy.OrbitoRecall.enabled) {
      for (let guid of await store().recallVisitGuids()) {
        ids[guid] = true;
      }
    }
    for (let url of (await store().recallForgets()).keys()) {
      ids[forgetId(url)] = true;
    }
    return ids;
  }

  async createRecord(id, collection) {
    let fields = null;
    if (isForgetId(id)) {
      let forget = await this.#forget(id);
      fields = forget && forgetRecord(forget);
    } else if (lazy.OrbitoRecall.enabled) {
      let visit = await store().recallVisit(id);
      let clients = this.engine.service.clientsEngine;
      fields =
        visit &&
        visitRecord(visit, { id: clients.localID, name: clients.localName });
    }
    if (!fields) {
      // Gone since pullNewChanges: skipped, not sent as a tombstone.
      throw new Error(`Nothing to send for ${id}`);
    }
    let record = new OrbitoRecallRecord(collection, id);
    Object.assign(record.cleartext, fields);
    // A forget has no ttl: it must outlive every visit record it covers,
    // whichever device's retention those were sent with.
    let ttl = isForgetId(id) ? null : recordTTL(retentionDays());
    if (ttl) {
      record.ttl = ttl;
    }
    return record;
  }

  async applyIncomingBatch(records) {
    let domains = lazy.OrbitoRecall.excludedDomains;
    let actions = incomingActions(
      records.map(record => ({
        ...record.cleartext,
        id: record.id,
        deleted: !!record.deleted,
      })),
      {
        localDeviceId: this.engine.service.clientsEngine.localID,
        forgets: await store().recallForgets(),
        isExcluded: url =>
          lazy.isExcludedHost(URL.parse(url)?.hostname ?? "", domains),
        cutoff: lazy.retentionCutoff(retentionDays(), Date.now()),
      }
    );
    if (await store().applyRecallSync(actions)) {
      lazy.OrbitoRecall.resetIndex();
    }
    // A later forget kept here goes back over the earlier one.
    let now = Date.now() / 1000;
    for (let id of actions.reupload) {
      this.engine._modified.set(id, now);
    }
    return [];
  }

  /** The other devices' visits and the forgets go; this device's stay. */
  async wipe() {
    await store().deleteRemoteRecall();
  }
}

/** Marks the visits and forgets OrbitoRecall says changed (SYNC_CHANGED). */
class OrbitoRecallTracker extends LegacyTracker {
  onStart() {
    Services.obs.addObserver(this, SYNC_CHANGED);
  }

  onStop() {
    Services.obs.removeObserver(this, SYNC_CHANGED);
  }

  observe(subject, topic, id) {
    if (topic == SYNC_CHANGED && id) {
      this.#track(id).catch(console.error);
    }
  }

  async #track(id) {
    if (await this.addChangedID(id)) {
      // A forget goes at once; a visit waits for the next sync.
      this.score += isForgetId(id)
        ? SCORE_INCREMENT_XLARGE
        : SCORE_INCREMENT_SMALL;
    }
  }
}

export class OrbitoRecallEngine extends SyncEngine {
  constructor(service) {
    super("OrbitoRecall", service);
  }

  get _storeObj() {
    return OrbitoRecallSyncStore;
  }

  get _trackerObj() {
    return OrbitoRecallTracker;
  }

  get _recordObj() {
    return OrbitoRecallRecord;
  }

  async initialize() {
    await super.initialize();
    Services.obs.addObserver(this.asyncObserver, START_OVER, true);
  }

  async finalize() {
    Services.obs.removeObserver(this.asyncObserver, START_OVER);
    await super.finalize();
  }

  /**
   * Turning the engine off, or signing out of Sync, drops what came from
   * the other devices (ADR 0007 §9). Neither goes through wipeClient:
   * turning it off only wipes the server at the next sync, and signing out
   * resets the engines and clears every Sync pref, this one included, so
   * the pref is watched here and so is the sign-out.
   */
  async observe(subject, topic, data) {
    await super.observe(subject, topic, data);
    let off =
      topic == "nsPref:changed" &&
      data == `services.sync.engine.${this.prefName}` &&
      !this.enabled;
    if (off || topic == START_OVER) {
      await this._store.wipe();
    }
  }

  /** The changes still here: none for a visit gone or not to be sent. */
  async pullNewChanges() {
    let changes = { ...(await super.pullNewChanges()) };
    for (let id of Object.keys(changes)) {
      if (!(await this._store.itemExists(id))) {
        delete changes[id];
      }
    }
    return changes;
  }

  /**
   * Every incoming record is applied: incomingActions decides, the later
   * forget winning by its time, not by when the server got it.
   */
  async _reconcile() {
    return true;
  }
}
