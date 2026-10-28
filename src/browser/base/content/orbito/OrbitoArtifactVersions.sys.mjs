/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * How a document's (artifact's) versions are numbered, kept free of chrome
 * so it can be tested on its own. Versions count from 1 and are never
 * changed once saved: a change adds the next version, and so does going
 * back to an older one, with that version's content, so no history is lost.
 */

/**
 * A new document record, at version 1.
 *
 * @param {object} options
 * @param {string} options.id
 * @param {string} options.title
 * @param {string[]} [options.sourceUrls]
 * @param {?string} [options.threadId]
 * @param {?string} [options.space] The Space it belongs to: its Thread's.
 * @param {number} now
 */
export function firstVersion(
  { id, title, sourceUrls = [], threadId = null, space = null },
  now
) {
  return {
    id,
    title,
    thread_id: threadId,
    space_id: space,
    source_urls: sourceUrls,
    created_at: now,
    updated_at: now,
    current_version: 1,
  };
}

/** The document record once a new version is added to it. */
export function nextVersion(artifact, now) {
  return {
    ...artifact,
    updated_at: now,
    current_version: artifact.current_version + 1,
  };
}

/**
 * The document record once an older version is restored: the next version,
 * which gets that version's content.
 *
 * @throws {Error} If there is no such older version.
 */
export function restoredVersion(artifact, version, now) {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("Versions are numbered from 1.");
  }
  if (version > artifact.current_version) {
    throw new Error(`There is no version ${version}.`);
  }
  if (version == artifact.current_version) {
    throw new Error(`Version ${version} is already the current one.`);
  }
  return nextVersion(artifact, now);
}
