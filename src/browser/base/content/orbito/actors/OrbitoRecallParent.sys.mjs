/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Parent side of Browsing recall's actor: passes on that the user scrolled
 * a page, with the page's URL, so that a message from a page the tab has
 * already left counts for nothing.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  OrbitoRecall: "chrome://browser/content/orbito/OrbitoRecall.sys.mjs",
});

export class OrbitoRecallParent extends JSWindowActorParent {
  receiveMessage(message) {
    let browser = this.browsingContext.top.embedderElement;
    if (message.name == "OrbitoRecall:Scrolled" && browser) {
      lazy.OrbitoRecall.scrolled(browser, this.manager.documentURI?.spec);
    }
  }
}
