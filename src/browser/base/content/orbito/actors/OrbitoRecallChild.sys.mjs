/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Content side of Browsing recall (OrbitoRecall.sys.mjs), one per top-level
 * web page: says once that the user scrolled the page, which counts as
 * reading it. Whether the page has a password field is asked of every
 * frame (OrbitoSubframes.sys.mjs).
 */
export class OrbitoRecallChild extends JSWindowActorChild {
  #scrolled = false;

  handleEvent(event) {
    if (event.type == "scroll" && !this.#scrolled) {
      this.#scrolled = true;
      this.sendAsyncMessage("OrbitoRecall:Scrolled");
    }
  }
}
