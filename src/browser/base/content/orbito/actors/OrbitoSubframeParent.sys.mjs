/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Parent side of reading a page's frames (OrbitoSubframes.sys.mjs): only
 * asks, so it takes no messages.
 */
export class OrbitoSubframeParent extends JSWindowActorParent {}
