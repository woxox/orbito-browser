/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The document page, about:orbito-doc?id=<document id>, where documents the
 * assistant made (artifacts) are shown. It is an unprivileged content page
 * (registered by OrbitoPages.sys.mjs) with no script of its own: the
 * OrbitoDoc actors (actors/OrbitoDoc*.sys.mjs) fill it in. The Markdown is
 * turned into HTML here, in the parent process, with the panel's converter,
 * and cleaned with Firefox's sanitizer before it is sent to the page.
 */

import { markdown } from "chrome://browser/content/orbito/OrbitoMarkdown.sys.mjs";

export const DOC_PAGE = "about:orbito-doc";

// What the sanitizer keeps: the converter's table alignment (style=""),
// nothing that loads (media) or submits (forms).
const SANITIZER_FLAGS =
  Ci.nsIParserUtils.SanitizerAllowStyle |
  Ci.nsIParserUtils.SanitizerDropForms |
  Ci.nsIParserUtils.SanitizerDropMedia;

let actorRegistered = false;

export const OrbitoDocs = {
  SANITIZER_FLAGS,

  /** The page's URL for a document. */
  url(id) {
    return `${DOC_PAGE}?id=${encodeURIComponent(id)}`;
  },

  /**
   * The document id of a document page's URI, or null for other pages.
   *
   * @param {nsIURI} uri
   */
  idOf(uri) {
    if (!uri?.schemeIs("about") || !uri.spec.startsWith(`${DOC_PAGE}?`)) {
      return null;
    }
    return new URLSearchParams(uri.query).get("id") || null;
  },

  /**
   * A document's Markdown as sanitized HTML for the document page.
   *
   * @param {string} text
   * @returns {string}
   */
  render(text) {
    let doc = new DOMParser().parseFromString(
      "<!DOCTYPE html><body></body>",
      "text/html"
    );
    doc.body.append(...markdown(doc, text));
    return Cc["@mozilla.org/parserutils;1"]
      .getService(Ci.nsIParserUtils)
      .sanitize(doc.body.innerHTML, SANITIZER_FLAGS);
  },

  /** Tells every tab showing a document that it has a new version. */
  changed(id) {
    let url = this.url(id);
    for (let win of Services.wm.getEnumerator("navigator:browser")) {
      for (let tab of win.gBrowser.tabs) {
        let browser = tab.linkedBrowser;
        if (browser.currentURI.spec != url) {
          continue;
        }
        try {
          browser.browsingContext?.currentWindowGlobal
            ?.getActor("OrbitoDoc")
            .sendAsyncMessage("changed");
        } catch (e) {
          // Still loading: the page asks for the document once it is parsed.
        }
      }
    }
  },

  /** Registers the OrbitoDoc actors; does nothing the second time. */
  registerActor() {
    if (actorRegistered) {
      return;
    }
    actorRegistered = true;
    ChromeUtils.registerWindowActor("OrbitoDoc", {
      parent: {
        esModuleURI:
          "chrome://browser/content/orbito/actors/OrbitoDocParent.sys.mjs",
      },
      child: {
        esModuleURI:
          "chrome://browser/content/orbito/actors/OrbitoDocChild.sys.mjs",
        events: { DOMContentLoaded: {} },
      },
      matches: [`${DOC_PAGE}*`],
      messageManagerGroups: ["browsers"],
      // The page is unprivileged, so it loads in a web content process. The
      // parent hands out only the document its URL names.
      safeForUntrustedWebProcess: true,
    });
  },
};
