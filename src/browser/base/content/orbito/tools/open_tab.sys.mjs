/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export function parseURL(url) {
  let uri;
  try {
    uri = Services.io.newURI(url);
  } catch {
    throw new Error("That is not a valid URL.");
  }
  if (!uri.schemeIs("http") && !uri.schemeIs("https")) {
    throw new Error("Only http and https URLs can be opened.");
  }
  return uri;
}

function lastWindow() {
  let { BrowserWindowTracker } = ChromeUtils.importESModule(
    "resource:///modules/BrowserWindowTracker.sys.mjs"
  );
  let win = BrowserWindowTracker.getTopWindow({ private: false });
  if (!win) {
    throw new Error("No browser window is open to open the tab in.");
  }
  return win;
}

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

export default {
  name: "open_tab",
  description:
    "Open an http(s) URL in a new background tab. The user must approve each call.",
  schema: {
    type: "object",
    properties: { url: { type: "string", format: "uri" } },
    required: ["url"],
  },
  readOnly: false,

  label(ctx, input) {
    try {
      return t("orbito-assistant-tool-opening", {
        host: parseURL(input.url).host,
      });
    } catch {
      return t("orbito-assistant-tool-opening-tab");
    }
  },

  approvalAction(ctx, input) {
    return t("orbito-assistant-tool-open-site-action", {
      host: parseURL(input.url).host,
    });
  },

  // The question is the same for every page: the site is under it.
  approvalText(ctx, input) {
    // Only for its throw: a bad URL fails before the user is asked.
    parseURL(input.url);
    return t("orbito-assistant-tool-open-tab-approval");
  },

  approvalSite(ctx, input) {
    return parseURL(input.url).spec;
  },

  run(ctx, input) {
    let uri = parseURL(input.url);
    // A windowless query (a scheduled task) opens it in the window used
    // last, still in the background.
    let win = ctx.windowless ? lastWindow() : ctx.window;
    let opened = win.gBrowser.addTab(uri.spec, {
      triggeringPrincipal:
        Services.scriptSecurityManager.createNullPrincipal({}),
      inBackground: true,
    });
    // In the Thread's Space, which the window may not show (a windowless
    // query's, if it has one).
    if (ctx.space) {
      win.OrbitoShell?.spaces?.moveTab(opened, ctx.space);
    }
    if (!ctx.windowless) {
      ctx.opened(opened);
    }
    // Its title is not known yet: the chip shows the host.
    let tabId = ctx.tabId(opened);
    return {
      content: `Opened tab ${tabId}.`,
      page: { url: uri.spec, title: null, tabId },
    };
  },
};
