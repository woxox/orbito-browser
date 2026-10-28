/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The frames of a page, read through the OrbitoSubframe actor
 * (actors/OrbitoSubframe*.sys.mjs), which is in every web document, the
 * top one and every frame's. PageExtractor reads the top document only.
 *
 * Imported by a tool module, so it must not touch chrome globals when
 * imported: the actor is registered once called.
 */

const ACTOR = "OrbitoSubframe";

// Frames read at most, and how deep in frames of frames.
const MAX_FRAMES = 10;
const MAX_DEPTH = 3;

let registered = false;

function register() {
  if (registered) {
    return;
  }
  ChromeUtils.registerWindowActor(ACTOR, {
    parent: {
      esModuleURI:
        "chrome://browser/content/orbito/actors/OrbitoSubframeParent.sys.mjs",
    },
    child: {
      esModuleURI:
        "chrome://browser/content/orbito/actors/OrbitoSubframeChild.sys.mjs",
    },
    matches: ["http://*/*", "https://*/*", "file:///*"],
    allFrames: true,
    messageManagerGroups: ["browsers"],
    // The parent only asks; it takes no requests from the child.
    safeForUntrustedWebProcess: true,
  });
  registered = true;
}

/**
 * Where a frame's text came from: its URL without the query and fragment,
 * which may hold a session's tokens.
 */
function sourceOf(url) {
  let parsed = URL.parse(url);
  return parsed ? parsed.origin + parsed.pathname : url;
}

/** The actor of a browsing context's document, or null if it has none. */
function actorOf(context) {
  try {
    return context.currentWindowGlobal?.getActor(ACTOR) || null;
  } catch {
    // Not a web document, or it went away.
    return null;
  }
}

/**
 * The text of the frames of a browser's page that are shown and big enough
 * to be read, frames of frames too, in document order: [{url, text}], their
 * texts maxChars at most in all, the first frames filled first; url is
 * without its query. A frame without a document of its own (about:srcdoc)
 * counts as part of the document it is in. Frames that have no text are
 * left out, and so are those excluded, with their own frames.
 *
 * @param {Element} browser
 * @param {object} options
 * @param {number} options.maxChars
 * @param {(host: string) => boolean} [options.excluded] Whether to leave
 *   out the frames of a host.
 * @returns {Promise<{url: string, text: string}[]>}
 */
export async function readFrames(browser, { maxChars, excluded = () => false }) {
  register();
  let top = browser.browsingContext;
  let found = [];
  let left = maxChars;
  let visited = 0;
  // Each document says which of its frames to read next.
  async function visit(context, depth) {
    let actor = actorOf(context);
    if (!actor) {
      return;
    }
    let url = context.currentWindowGlobal.documentURI?.spec || "";
    if (context != top && excluded(URL.parse(url)?.hostname || "")) {
      return;
    }
    let result = await actor
      .sendQuery("OrbitoSubframe:Read", {
        maxChars: left,
        // The top document's text is PageExtractor's.
        own: context != top,
      })
      .catch(() => null);
    if (!result || result.error) {
      return;
    }
    if (context != top) {
      visited++;
    }
    let text = result.text?.trim().slice(0, left);
    if (text) {
      found.push({ url: sourceOf(url), text });
      left -= text.length;
    }
    if (depth >= MAX_DEPTH) {
      return;
    }
    for (let id of result.frames || []) {
      if (left <= 0 || visited >= MAX_FRAMES) {
        return;
      }
      // Only frames in this document (or in a frame of it without a
      // document of its own): the child answers ids, and may lie.
      let frame = BrowsingContext.get(id);
      let parent = frame?.parent;
      while (parent && parent != context && !actorOf(parent)) {
        parent = parent.parent;
      }
      if (parent == context) {
        await visit(frame, depth + 1);
      }
    }
  }
  if (maxChars > 0) {
    await visit(top, 0);
  }
  return found;
}

/**
 * Whether a document of a browser's page, the top one or any frame's, shown
 * or not, has a password field. A web document that does not answer counts
 * as having one.
 *
 * @param {Element} browser
 * @returns {Promise<boolean>}
 */
export async function hasPasswordField(browser) {
  register();
  let answers = await Promise.all(
    browser.browsingContext
      .getAllBrowsingContextsInSubtree()
      .map(context =>
        actorOf(context)
          ?.sendQuery("OrbitoSubframe:HasPassword")
          .catch(() => true)
      )
  );
  return answers.some(answer => answer !== false && answer !== undefined);
}
