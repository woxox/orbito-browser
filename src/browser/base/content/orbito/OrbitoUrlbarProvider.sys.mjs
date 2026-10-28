/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The "Ask Orbito" urlbar result. OrbitoRouter.sys.mjs decides what the
 * typed text is: for a question, or "/name" calling a skill that is on, the
 * result is the heuristic one that Enter picks, for a search it comes right
 * below the search, and for an address there is none. Picking it hands the
 * text to the window's assistant panel (assistant.js), which asks it in the
 * Thread it shows, or in a new Thread while that one is answering; the page
 * does not navigate and the urlbar goes back to the page's address.
 *
 * Registered at runtime rather than in Firefox's provider list, so that
 * Firefox's files stay unpatched. Nothing typed leaves the browser before
 * the result is picked.
 */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

import {
  UrlbarProvider,
  UrlbarUtils,
} from "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs";
import { route } from "chrome://browser/content/orbito/OrbitoRouter.sys.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  OrbitoAssistantCore:
    "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs",
  ProvidersManager:
    "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs",
  UrlbarResult: "chrome://browser/content/urlbar/UrlbarResult.mjs",
  UrlbarSearchUtils:
    "moz-src:///browser/components/urlbar/UrlbarSearchUtils.sys.mjs",
  UrlbarShared: "chrome://browser/content/urlbar/UrlbarShared.mjs",
});

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "enabled",
  "orbito.assistant.urlbar",
  true
);

const DYNAMIC_TYPE = "orbitoAsk";
const ICON = "chrome://browser/skin/orbito/sparkle.svg";

/**
 * route() with the names of the skills that are on, read only for "/". The
 * new tab page's input routes what it is given the same way.
 *
 * @param {string} text
 * @returns {Promise<?{kind: "url" | "search" | "agent"}>}
 */
export async function routeQuery(text) {
  let skills = [];
  if (text.trim().startsWith("/")) {
    skills = (await lazy.OrbitoAssistantCore.skills())
      .filter(skill => skill.enabled)
      .map(skill => skill.name);
  }
  return route(text, skills);
}

const VIEW_TEMPLATE = {
  attributes: { selectable: true },
  children: [
    {
      name: "no-wrap",
      tag: "span",
      classList: ["urlbarView-no-wrap"],
      children: [
        {
          name: "icon",
          tag: "img",
          classList: ["urlbarView-favicon"],
        },
        {
          name: "text-container",
          tag: "span",
          children: [
            {
              name: "title",
              tag: "span",
              classList: ["urlbarView-title"],
            },
            {
              name: "title-separator",
              tag: "span",
              classList: ["urlbarView-title-separator"],
            },
            {
              name: "action",
              tag: "span",
              classList: ["urlbarView-action"],
            },
          ],
        },
      ],
    },
  ],
};

class OrbitoUrlbarProvider extends UrlbarProvider {
  get name() {
    return "OrbitoAsk";
  }

  get type() {
    // Questions get the heuristic result, which Enter picks.
    return lazy.UrlbarShared.PROVIDER_TYPE.HEURISTIC;
  }

  async isActive(queryContext) {
    if (
      !lazy.enabled ||
      queryContext.searchMode ||
      queryContext.restrictSource
    ) {
      return false;
    }
    let kind = (await routeQuery(queryContext.searchString))?.kind;
    return kind == "agent" || kind == "search";
  }

  async startQuery(queryContext, addCallback, controller) {
    let instance = this.queryInstance;
    let query = queryContext.searchString.trim();
    let heuristic = (await routeQuery(query))?.kind == "agent";
    if (instance != this.queryInstance) {
      return;
    }
    addCallback(
      this,
      new lazy.UrlbarResult({
        type: lazy.UrlbarShared.RESULT_TYPE.DYNAMIC,
        source: lazy.UrlbarShared.RESULT_SOURCE.OTHER_LOCAL,
        heuristic,
        // Firefox ranks heuristic results by group. This one shares the
        // group of history URLs (only addresses get those, and addresses get
        // no Ask Orbito), right above the fallback search or visit, so that
        // engine aliases, bookmark keywords and autofill still win.
        group: heuristic
          ? lazy.UrlbarShared.RESULT_GROUP.HEURISTIC_HISTORY_URL
          : undefined,
        suggestedIndex: heuristic ? undefined : 1,
        payload: {
          dynamicType: DYNAMIC_TYPE,
          // What the urlbar shows while the result is selected.
          input: queryContext.searchString,
          query,
        },
      })
    );
    if (!heuristic) {
      return;
    }
    // The search the fallback would have made the heuristic, kept right
    // below so it can still be picked.
    let engine = lazy.UrlbarSearchUtils.getDefaultEngine(
      queryContext.isPrivate
    );
    let icon = await UrlbarUtils.getEngineIconUrl(engine, controller);
    if (instance != this.queryInstance) {
      return;
    }
    addCallback(
      this,
      new lazy.UrlbarResult({
        type: lazy.UrlbarShared.RESULT_TYPE.SEARCH,
        source: lazy.UrlbarShared.RESULT_SOURCE.SEARCH,
        suggestedIndex: 1,
        payload: {
          engine: engine.name,
          query: queryContext.searchString,
          title: queryContext.searchString,
          icon,
        },
        highlights: {
          engine: lazy.UrlbarShared.HIGHLIGHT.TYPED,
        },
      })
    );
  }

  getViewTemplate() {
    return VIEW_TEMPLATE;
  }

  getViewUpdate(result) {
    return {
      icon: { attributes: { src: ICON } },
      title: { textContent: result.payload.query },
      action: { textContent: t("orbito-urlbar-ask") },
    };
  }

  onEngagement(queryContext, controller, details) {
    // The search result below a question searches as usual.
    if (details.result.type != lazy.UrlbarShared.RESULT_TYPE.DYNAMIC) {
      return;
    }
    // Firefox has already put the urlbar back to the page's address.
    controller.browserWindow.OrbitoAssistant?.ask(details.result.payload.query, {
      newIfBusy: true,
    });
  }
}

let registered = false;

/** Adds the result to the urlbar. Safe to call from every window. */
export function registerUrlbarProvider() {
  if (registered) {
    return;
  }
  registered = true;
  lazy.ProvidersManager.getInstanceForSap("urlbar").registerProvider(
    new OrbitoUrlbarProvider()
  );
}
