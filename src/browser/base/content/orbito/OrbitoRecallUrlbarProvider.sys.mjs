/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The urlbar's "From memory" group: up to three pages Browsing recall
 * remembers (OrbitoRecall.sys.mjs) that are related to what is typed, as
 * URL results Enter opens, those read in the window's Space first. Searched
 * once typing pauses, for text of three
 * or more characters that is not an address; no model is asked, and
 * private windows get none. Nothing shows for unrelated text (see
 * OrbitoRecall.suggest).
 *
 * Registered at runtime next to OrbitoUrlbarProvider.sys.mjs, so that
 * Firefox's files stay unpatched.
 */

import { UrlbarProvider } from "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs";
import { route } from "chrome://browser/content/orbito/OrbitoRouter.sys.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  OrbitoRecall: "chrome://browser/content/orbito/OrbitoRecall.sys.mjs",
  ProvidersManager:
    "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  UrlbarResult: "chrome://browser/content/urlbar/UrlbarResult.mjs",
  UrlbarShared: "chrome://browser/content/urlbar/UrlbarShared.mjs",
});

const MIN_LENGTH = 3;
/** How long typing pauses before memory is searched. */
export const DELAY_MS = 150;

/**
 * Whether typed text is searched in memory: text of three or more
 * characters that is not an address. The new tab page asks too.
 */
export function searchesMemory(text) {
  text = text.trim();
  return [...text].length >= MIN_LENGTH && route(text, [])?.kind != "url";
}

/**
 * A urlbar group label (a result's rowLabel) that says text. The urlbar
 * takes labels as Fluent messages of the window's own files, which Orbito's
 * strings are not in, so this is a Firefox message whose label is only its
 * argument. The Command bar labels open tabs with it too.
 */
export function groupLabel(text) {
  return {
    id: "tabbrowser-manager-closed-tab-group",
    args: { tabGroupName: text },
  };
}

class OrbitoRecallUrlbarProvider extends UrlbarProvider {
  get name() {
    return "OrbitoRecall";
  }

  get type() {
    return lazy.UrlbarShared.PROVIDER_TYPE.PROFILE;
  }

  async isActive(queryContext) {
    return (
      !queryContext.isPrivate &&
      !queryContext.searchMode &&
      !queryContext.restrictSource &&
      searchesMemory(queryContext.searchString)
    );
  }

  async startQuery(queryContext, addCallback, controller) {
    let instance = this.queryInstance;
    await new Promise(resolve => lazy.setTimeout(resolve, DELAY_MS));
    if (instance != this.queryInstance) {
      return;
    }
    // The Space the window shows; without Spaces, every one alike.
    let space = controller?.browserWindow?.OrbitoShell?.spaces?.current;
    let pages = await lazy.OrbitoRecall.suggest(
      queryContext.searchString.trim(),
      { space: space ?? undefined }
    );
    if (instance != this.queryInstance) {
      return;
    }
    for (let [i, page] of pages.entries()) {
      addCallback(
        this,
        new lazy.UrlbarResult({
          type: lazy.UrlbarShared.RESULT_TYPE.URL,
          source: lazy.UrlbarShared.RESULT_SOURCE.HISTORY,
          // Together, in order, after the other results.
          suggestedIndex: i - pages.length,
          rowLabel: groupLabel(t("orbito-urlbar-memory")),
          payload: {
            url: page.url,
            title: page.title,
            icon: lazy.UrlbarShared.getIconForUrl(page.url),
          },
        })
      );
    }
  }
}

let registered = false;

/** Adds the group to the urlbar. Safe to call from every window. */
export function registerRecallUrlbarProvider() {
  if (registered) {
    return;
  }
  registered = true;
  lazy.ProvidersManager.getInstanceForSap("urlbar").registerProvider(
    new OrbitoRecallUrlbarProvider()
  );
}
