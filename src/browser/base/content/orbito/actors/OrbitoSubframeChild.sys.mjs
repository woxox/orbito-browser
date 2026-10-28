/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Content side of reading a page's frames (OrbitoSubframes.sys.mjs), one per
 * document, the top one and every frame's: answers the document's text,
 * whether it has a password field, and which of its frames are shown big
 * enough to be read.
 *
 * Every query answers {error} instead of throwing, so the message survives.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  extractTextFromDOM:
    "moz-src:///toolkit/components/pageextractor/DOMExtractor.sys.mjs",
});

// A frame smaller than this, in CSS pixels, is taken for an ad, a banner
// or a tracker and not read.
const MIN_WIDTH = 200;
const MIN_HEIGHT = 100;

// The frames of a document, in document order.
function framesOf(document) {
  return document.querySelectorAll("iframe, frame");
}

function shown(frame) {
  let { width, height } = frame.getBoundingClientRect();
  return (
    width >= MIN_WIDTH &&
    height >= MIN_HEIGHT &&
    frame.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  );
}

// The document of a frame that has no actor of its own (about:srcdoc, or
// an about:blank a script wrote), which is in this process; null for the
// others.
function documentWithoutActor(frame) {
  let document = frame.contentDocument;
  return document && !/^(https?|file):/.test(document.documentURI)
    ? document
    : null;
}

// The built-in PDF viewer (pdf.js) always has a password field, in the
// dialog that asks for a locked PDF's password: that one counts only while
// the dialog is open.
function hasPassword(document) {
  let dialog =
    document.nodePrincipal.originNoSuffix == "resource://pdf.js" &&
    document.getElementById("passwordDialog");
  return (
    [...document.querySelectorAll('input[type="password"]')].some(
      field => !dialog || dialog.open || !dialog.contains(field)
    ) ||
    [...framesOf(document)].some(frame => {
      let inner = documentWithoutActor(frame);
      return inner && hasPassword(inner);
    })
  );
}

export class OrbitoSubframeChild extends JSWindowActorChild {
  receiveMessage(message) {
    try {
      switch (message.name) {
        case "OrbitoSubframe:HasPassword":
          // Frames without an actor of their own count as this document.
          return !!this.document && hasPassword(this.document);
        case "OrbitoSubframe:Read":
          return this.#read(message.data);
      }
    } catch (e) {
      return { error: String(e?.message || e) };
    }
    return null;
  }

  /**
   * {text, frames}: the document's text (but for the top one, whose text is
   * PageExtractor's) with that of its shown frames that have no actor of
   * their own, maxChars at most, and the ids of the browsing contexts of
   * its other frames that are shown and big enough, in document order.
   */
  #read({ maxChars, own }) {
    let texts = [];
    let frames = [];
    let read = (document, withOwn) => {
      if (withOwn && document.body) {
        texts.push(
          lazy.extractTextFromDOM(document, document.body, {
            sufficientLength: maxChars,
            sourceUrl: document.documentURI,
          }).text
        );
      }
      for (let frame of framesOf(document)) {
        if (!shown(frame)) {
          continue;
        }
        let inner = documentWithoutActor(frame);
        if (inner) {
          read(inner, true);
        } else if (frame.browsingContext) {
          frames.push(frame.browsingContext.id);
        }
      }
    };
    if (this.document && maxChars > 0) {
      read(this.document, own);
    }
    return {
      text: texts.filter(Boolean).join("\n\n").slice(0, maxChars),
      frames,
    };
  }
}
