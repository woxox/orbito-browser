/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Shared by the page tools (read_page, click, type, ...): reaches a tab's
 * page through the OrbitoPage actors (actors/OrbitoPage*.sys.mjs), which are
 * registered on first use, and remembers what each ref of the latest
 * snapshot is, so that labels and approvals can name the element. Frames
 * have actors of their own: a snapshot puts each frame's lines under the
 * frame's entry, and an action goes to the frame its ref is in.
 *
 * Like the tool modules, this must not touch chrome globals when imported.
 */

const ACTOR = "OrbitoPage";
const MAX_SNAPSHOT_CHARS = 40000;
const MAX_FRAME_URL = 200;
// How long an action may take to start a navigation, and to finish it.
const NAVIGATION_START_MS = 300;
const NAVIGATION_LOAD_MS = 10000;

const STALE_REF =
  "is not on the page any more: the page has changed. Call read_page again to get fresh refs.";

let registered = false;
// Refs are numbered across all pages and frames, so a ref from an earlier
// snapshot, page or frame never names an element of the current one.
let nextRef = 1;
// The tab's WindowGlobalParent -> Map(ref -> {role, name, sensitive,
// global}), where global is the WindowGlobalParent of the frame (or page)
// the element is in.
const refTables = new WeakMap();

function register() {
  if (registered) {
    return;
  }
  ChromeUtils.registerWindowActor(ACTOR, {
    parent: {
      esModuleURI:
        "chrome://browser/content/orbito/actors/OrbitoPageParent.sys.mjs",
    },
    child: {
      esModuleURI:
        "chrome://browser/content/orbito/actors/OrbitoPageChild.sys.mjs",
    },
    matches: ["http://*/*", "https://*/*", "file:///*", "about:srcdoc"],
    allFrames: true,
    messageManagerGroups: ["browsers"],
    // The parent only asks; it takes no requests from the child.
    safeForUntrustedWebProcess: true,
  });
  registered = true;
}

/** The tab's document, as its WindowGlobalParent, or null. */
export function windowGlobal(tab) {
  return tab.linkedBrowser.browsingContext?.currentWindowGlobal || null;
}

/** Queries the actor of a page or frame. */
async function ask(global, name, data) {
  register();
  let actor;
  try {
    actor = global.getActor(ACTOR);
  } catch {
    throw new Error(
      "Only web pages (http, https and file) can be read and controlled."
    );
  }
  let result = await actor.sendQuery(name, data);
  if (result?.error) {
    throw new Error(result.error);
  }
  return result;
}

function query(tab, name, data) {
  return ask(windowGlobal(tab), name, data);
}

/** The document a frame under the top browsing context shows, or null. */
function frameGlobal(top, id) {
  let context = BrowsingContext.get(id);
  if (context?.top != top || context == top) {
    return null;
  }
  return context.currentWindowGlobal;
}

/**
 * Where a point in a frame's viewport is in the tab's viewport, with the
 * tab's scroll position: the embedder of each frame on the way up adds
 * where the frame is. With hit, each also checks that a click there would
 * reach the frame.
 *
 * @returns {Promise<{x: number, y: number, scrollX: number, scrollY: number}>}
 */
async function toTop(global, point, hit = false) {
  for (let context = global.browsingContext; context.parent; ) {
    let { x, y } = point;
    point = await ask(context.parent.currentWindowGlobal, "frame", {
      frame: context.id,
      x,
      y,
      hit,
    });
    context = context.parent;
  }
  return point;
}

/** The host of a page or frame, for approval questions. */
function frameHost(global) {
  // A sandboxed frame's null principal names no site: its URL does.
  let principal = global.documentPrincipal;
  return hostOf(
    principal?.isContentPrincipal ? principal.URI : global.documentURI
  );
}

function hostOf(uri) {
  try {
    return uri.host || uri.spec;
  } catch {
    return uri.spec;
  }
}

/**
 * Adds a document's snapshot lines, those of its frames under each frame's
 * entry, until the snapshot has MAX_SNAPSHOT_CHARS.
 *
 * @param {object} state {lines, length, truncated, refs}, the refs being
 *   those of the lines added, as in refTables.
 * @returns {Promise<string>} The document's header line.
 */
async function readDocument(global, depth, state) {
  let { header, lines, refs, nextRef: next, truncated } = await ask(
    global,
    "read",
    { firstRef: nextRef, maxChars: MAX_SNAPSHOT_CHARS - state.length }
  );
  nextRef = Math.max(nextRef, next);
  let infos = new Map(refs.map(({ ref, ...info }) => [ref, info]));
  let indent = "  ".repeat(depth);
  let add = text => {
    let line = indent + text;
    if (state.truncated || state.length + line.length > MAX_SNAPSHOT_CHARS) {
      state.truncated = true;
      return false;
    }
    state.length += line.length + 1;
    state.lines.push(line);
    return true;
  };
  for (let line of lines) {
    if (typeof line == "string") {
      add(line);
    } else if (line.ref) {
      if (add(line.text) && infos.has(line.ref)) {
        state.refs.set(line.ref, { ...infos.get(line.ref), global });
      }
    } else if (line.frame) {
      let frame = frameGlobal(global.browsingContext.top, line.frame);
      // Without its query and fragment, which may hold a session's tokens.
      let uri = frame?.documentURI;
      let entry = line.text;
      if (uri) {
        let url = uri.schemeIs("about") ? uri.spec : uri.prePath + uri.filePath;
        entry += ` src=${url.slice(0, MAX_FRAME_URL)}`;
      }
      if (!add(entry + ":")) {
        break;
      }
      if (frame) {
        try {
          await readDocument(frame, depth + line.depth + 1, state);
        } catch {
          // E.g. about:blank, or a frame that went away: shown empty.
        }
      }
    }
    if (state.truncated) {
      return header;
    }
  }
  state.truncated ||= truncated;
  return header;
}

function sleep(ms) {
  let { setTimeout } = ChromeUtils.importESModule(
    "resource://gre/modules/Timer.sys.mjs"
  );
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Text from a page, with the "<" of tags that start with page_ quoted. */
export function quotePageTags(text) {
  return String(text).replace(/<(?=\s*\/?\s*page_)/gi, "&lt;");
}

/**
 * A page's title, URL and text for the model, with the text in a <tag>
 * block. A page could write the block's tags itself to end the block early
 * and pass what follows as instructions, so tags that start with page_ lose
 * their "<".
 */
export function pageBlock(tag, { title, url, text }) {
  return [
    `Title: ${quotePageTags(title)}`,
    `URL: ${quotePageTags(url)}`,
    `<${tag}>`,
    quotePageTags(text),
    `</${tag}>`,
  ].join("\n");
}

export const OrbitoPage = {
  /** The tab a tool acts on: input.tab_id, or the tab the user asked from. */
  targetTab(ctx, input) {
    if (input.tab_id == null) {
      return ctx.tab;
    }
    let tab = ctx.tabById(input.tab_id);
    if (!tab) {
      throw new Error(`There is no tab with id ${input.tab_id}.`);
    }
    return tab;
  },

  /**
   * The page a tab is at, for the reply's source chips: a tool that reads
   * or opens a tab returns it as its result's page.
   *
   * @returns {{url: string, title: string, tabId: number}}
   */
  source(ctx, tab) {
    let browser = tab.linkedBrowser;
    return {
      url: browser.currentURI.spec,
      title: browser.contentTitle || tab.label,
      tabId: ctx.tabId(tab),
    };
  },

  /** The page's host, for approval questions. */
  host(tab) {
    return hostOf(tab.linkedBrowser.currentURI);
  },

  /**
   * A snapshot of the page with a ref for each element the tools can act on.
   *
   * @returns {Promise<string>}
   */
  async read(tab) {
    let global = windowGlobal(tab);
    let state = { lines: [], length: 0, truncated: false, refs: new Map() };
    let header = await readDocument(global, 0, state);
    if (state.truncated) {
      state.lines.push("… (the snapshot was cut short here)");
    }
    refTables.set(global, state.refs);
    let browser = tab.linkedBrowser;
    return pageBlock("page_snapshot", {
      title: browser.contentTitle || tab.label,
      url: browser.currentURI.spec,
      text: [header, ...state.lines].join("\n"),
    });
  },

  /**
   * What a ref of the page's latest snapshot is.
   *
   * @returns {{role: string, name: string, sensitive: boolean,
   *   global: WindowGlobalParent}} global is the frame's (or page's)
   *   document the element is in.
   * @throws If the ref is not one of the page's current refs, or its frame
   *   has navigated since.
   */
  element(tab, ref) {
    let global = windowGlobal(tab);
    let info = global && refTables.get(global)?.get(ref);
    if (!info || info.global.isClosed || !info.global.isCurrentGlobal) {
      throw new Error(`${ref} ${STALE_REF}`);
    }
    return info;
  },

  /** E.g. the “Sign in” button, or the “Pay” button in a frame from x.com. */
  describe(tab, ref) {
    let { role, name } = this.element(tab, ref);
    let what = name ? `the “${name}” ${role}` : `a ${role}`;
    return what + this.frameNote(tab, ref);
  },

  /**
   * “ in a frame from x.com” for a ref in a frame from another host than
   * the page's, else "": approvals name where an action really goes.
   */
  frameNote(tab, ref) {
    let host = frameHost(this.element(tab, ref).global);
    return host != this.host(tab) ? ` in a frame from ${host}` : "";
  },

  /** E.g. “Sign in”, for step labels; never throws. */
  shortName(tab, ref) {
    try {
      let { role, name } = this.element(tab, ref);
      return name ? `“${name}”` : `a ${role}`;
    } catch {
      return ref;
    }
  },

  /**
   * Has the page act on one of its elements, then waits for a navigation the
   * action started.
   *
   * @returns {Promise<{result: object, navigated: boolean, url: string}>}
   */
  async act(tab, action, data) {
    let before = windowGlobal(tab);
    let target = data.ref ? this.element(tab, data.ref).global : before;
    if (action == "click" && target != before) {
      // Nothing in the frames above may cover the frame where the element
      // is, either.
      let point = await ask(target, "act", { action: "point", ref: data.ref });
      if (point.hit) {
        await toTop(target, point, true);
      }
    }
    let result = await ask(target, "act", { action, ...data });
    // Without a ref, a key goes where the focus is, which may be in a frame.
    while (result.frame) {
      target = frameGlobal(before.browsingContext, result.frame);
      if (!target) {
        throw new Error("The focused frame is not on the page any more.");
      }
      // The user approved a key for this page, not for another site.
      if (frameHost(target) != this.host(tab)) {
        throw new Error(
          `The focus is in a frame from ${frameHost(target)}. Call press_key with the ref of the element to press the key in.`
        );
      }
      result = await ask(target, "act", { action, ...data });
    }
    let navigated = await this.settle(tab, before);
    return { result, navigated, url: tab.linkedBrowser.currentURI.spec };
  },

  /**
   * Waits for a navigation to start and load, if one is coming.
   *
   * @returns {Promise<boolean>} Whether the tab shows another document now.
   */
  async settle(tab, before) {
    let browser = tab.linkedBrowser;
    await sleep(NAVIGATION_START_MS);
    let end = Date.now() + NAVIGATION_LOAD_MS;
    while (
      browser.browsingContext?.webProgress?.isLoadingDocument &&
      Date.now() < end
    ) {
      await sleep(100);
    }
    return windowGlobal(tab) != before;
  },

  /**
   * The size of the page's viewport, where it is scrolled to and how tall
   * the page is, or with a ref, where that element is on the page.
   *
   * @returns {Promise<{x?: number, y?: number, width: number, height: number,
   *   scrollX?: number, scrollY?: number, pageHeight?: number}>}
   */
  async rect(tab, ref) {
    if (!ref) {
      return query(tab, "rect", {});
    }
    let { global } = this.element(tab, ref);
    let rect = await ask(global, "rect", { ref });
    let { x, y, scrollX, scrollY } = await toTop(global, rect);
    return { x: x + scrollX, y: y + scrollY, width: rect.width, height: rect.height };
  },

  /**
   * Runs a script in the page (see OrbitoPageChild's _run()). A page that
   * hangs the script where its watchdog cannot see (in the page's own
   * code) gets a second past timeoutMs before this gives up on it.
   *
   * @returns {Promise<{json?: string, length?: number, redacted?: number,
   *   timedOut?: boolean}>}
   */
  async script(tab, { code, timeoutMs, maxChars }) {
    let { promise: late, resolve } = Promise.withResolvers();
    let { setTimeout, clearTimeout } = ChromeUtils.importESModule(
      "resource://gre/modules/Timer.sys.mjs"
    );
    let timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs + 1000);
    try {
      return await Promise.race([
        query(tab, "run", { code, timeoutMs, maxChars }),
        late,
      ]);
    } finally {
      clearTimeout(timer);
    }
  },

  /**
   * What the suggestion chips (OrbitoSuggestions.sys.mjs) are decided on,
   * worked out here without sending the page anywhere: the length of its
   * text, its language (the lang attribute, or else Firefox's language
   * detector, when it is confident), and how many tabs in its window are on
   * its site (eTLD+1), itself included.
   *
   * @returns {Promise<{textLength: number, lang: string, sameSiteTabs: number}>}
   */
  async features(tab) {
    let { textLength, lang, sample } = await query(tab, "features");
    if (!lang && sample) {
      let { LanguageDetector } = ChromeUtils.importESModule(
        "resource://gre/modules/translations/LanguageDetector.sys.mjs"
      );
      let detected = await LanguageDetector.detectLanguage(sample);
      lang = detected.confident ? detected.language : "";
    }
    let site = uri => {
      if (!/^https?$/.test(uri.scheme)) {
        return null;
      }
      try {
        return Services.eTLD.getSchemelessSite(uri);
      } catch {
        return uri.host;
      }
    };
    let own = site(tab.linkedBrowser.currentURI);
    let sameSiteTabs = own
      ? tab.ownerDocument.defaultView.gBrowser.tabs.filter(
          t => !t.closing && site(t.linkedBrowser.currentURI) == own
        ).length
      : 1;
    return { textLength, lang, sameSiteTabs };
  },

  /** Whether the tab shows a PDF in the built-in viewer (pdf.js). */
  isPdf(tab) {
    return (
      windowGlobal(tab)?.documentPrincipal.originNoSuffix == "resource://pdf.js"
    );
  },

  /**
   * The text layer of the PDF the tab shows, a string per page from the
   * first, until maxChars of text have been read.
   *
   * @returns {Promise<{pages: string[], count: number} | {locked: true}>}
   *   locked while the viewer waits for the PDF's password.
   */
  pdf(tab, maxChars) {
    return query(tab, "pdf", { maxChars });
  },

  /** The result text for an action that may have changed the page. */
  outcome({ navigated, url }, done) {
    return navigated
      ? `${done} The page navigated to ${url}. Call read_page to see it.`
      : `${done} Call read_page to see what changed.`;
  },
};
