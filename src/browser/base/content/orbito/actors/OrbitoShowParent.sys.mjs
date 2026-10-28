/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Parent side of Show Orbito's actor: passes what the user did on a page
 * on to the demo of the page's window, if that window records one.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  OrbitoShow: "chrome://browser/content/orbito/OrbitoShow.sys.mjs",
});

export class OrbitoShowParent extends JSWindowActorParent {
  receiveMessage(message) {
    let browser = this.browsingContext.top.embedderElement;
    if (message.name == "OrbitoShow:Event" && browser) {
      lazy.OrbitoShow.record(browser, message.data);
    }
  }
}
