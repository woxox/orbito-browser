/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Parent side of the page tools. The logic is in OrbitoPage.sys.mjs, which
 * queries the child (OrbitoPageChild.sys.mjs) through this actor.
 */
export class OrbitoPageParent extends JSWindowActorParent {}
