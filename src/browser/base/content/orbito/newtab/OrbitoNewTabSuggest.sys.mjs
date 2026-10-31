/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What the new tab page (orbito-new-tab.mjs) suggests while something is
 * typed, and the greeting above its input.
 *
 * The suggestions are the Command bar's: the page asks Firefox's urlbar
 * providers itself (ProvidersManager, with the urlbar's own providers and
 * Orbito's), with no urlbar, input or view, so it gets the same results:
 * the heuristic result Enter picks (with its inline completion), search
 * suggestions, Ask Orbito, the Command bar's commands, open tabs, history
 * and "From memory". Each is
 * shown as a row (rowsOf()).
 */

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ProvidersManager:
    "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs",
  UrlbarQueryContext: "chrome://browser/content/urlbar/UrlbarQueryContext.mjs",
  UrlbarShared: "chrome://browser/content/urlbar/UrlbarShared.mjs",
});

/** How many suggestions the page shows at most, as the urlbar does. */
const MAX_RESULTS = 10;

/** A web address as the page shows it: no scheme, "www." or end slash. */
function shortURL(url) {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

/** A web page's host, without "www.". */
export function hostOf(url) {
  return URL.parse(url)?.host.replace(/^www\./, "") ?? "";
}

/**
 * What a urlbar result is as a row, or null for a kind the page does not
 * show (a tip, a restrict keyword, a Command bar command).
 *
 * kind is what picking it does, as the Command bar's hints say: "go",
 * "search", "ask", "switch-tab", "open" or "command" (with its icon);
 * group the group it is in,
 * "tabs", "history" or "memory", "" for the results at the top, and
 * section that group's heading.
 *
 * @returns {?{kind: string, group: string, section: string, title: string, sub: string, url: string}}
 */
function rowOf(result) {
  let { RESULT_TYPE } = lazy.UrlbarShared;
  let { payload } = result;
  // A page's row: its title (or address) over its host.
  let page = (kind, group, section) => ({
    kind,
    group,
    section,
    title: payload.title || shortURL(payload.url),
    sub: hostOf(payload.url),
    url: payload.url,
  });
  switch (result.type) {
    case RESULT_TYPE.URL:
    case RESULT_TYPE.KEYWORD:
    case RESULT_TYPE.REMOTE_TAB:
      if (result.heuristic) {
        return {
          kind: "go",
          group: "",
          section: "",
          title: shortURL(payload.url),
          sub: "",
          url: payload.url,
        };
      }
      return result.providerName == "OrbitoRecall"
        ? page("open", "memory", t("orbito-newtab-memory"))
        : page("open", "history", t("orbito-newtab-history"));
    case RESULT_TYPE.TAB_SWITCH:
      return page("switch-tab", "tabs", t("orbito-command-bar-section-tabs"));
    case RESULT_TYPE.SEARCH:
      return {
        kind: "search",
        group: "",
        section: "",
        title: payload.suggestion ?? payload.query,
        sub: result.heuristic ? payload.engine : "",
        url: "",
      };
    case RESULT_TYPE.DYNAMIC:
      if (payload.dynamicType == "orbitoAsk") {
        return {
          kind: "ask",
          group: "",
          section: "",
          title: payload.query,
          sub: t("orbito-urlbar-ask"),
          url: "",
        };
      }
      // A Command bar command (shell/OrbitoCommands.sys.mjs), shown with
      // what its view would show.
      if (payload.dynamicType == "orbitoCommand") {
        let view = payload.viewUpdate;
        return {
          kind: "command",
          group: "",
          section: "",
          title: view.title.textContent,
          sub: view.action.textContent,
          url: "",
          icon: view.icon.attributes.src,
        };
      }
  }
  return null;
}

/**
 * The rows for urlbar results, in their order, each with the result it
 * stands for.
 *
 * @param {Array<object>} results
 * @returns {Array<{kind: string, group: string, section: string, title: string, sub: string, url: string, result: object}>}
 */
export function rowsOf(results) {
  let rows = [];
  for (let result of results) {
    let row = rowOf(result);
    if (row) {
      rows.push({ ...row, result });
    }
  }
  return rows;
}

/**
 * What the input shows for typed text once the first result came: the text
 * completed with the result's autofill, typed as it was, or null when
 * there is nothing to complete.
 *
 * @param {string} typed
 * @param {?object} result The first result.
 * @returns {?string}
 */
export function autofilled(typed, result) {
  let value = result?.heuristic && result.autofill?.value;
  if (
    !value ||
    value.length <= typed.length ||
    !value.toLowerCase().startsWith(typed.toLowerCase())
  ) {
    return null;
  }
  return typed + value.slice(typed.length);
}

/**
 * Asks the urlbar's providers for what to suggest, one query at a time: a
 * new one cancels the one before.
 */
export class NewTabSuggester {
  #window;
  #context = null;

  /** @param {Window} window The page's browser window, which providers ask for its Space. */
  constructor(window) {
    this.#window = window;
  }

  get #manager() {
    return lazy.ProvidersManager.getInstanceForSap("urlbar");
  }

  /**
   * Starts suggesting for text; onResults gets the results each time more
   * come, until another query starts or this one is canceled.
   *
   * @param {string} text
   * @param {{isPrivate: boolean, userContextId?: number}} options
   * @param {(results: Array<object>) => void} onResults
   * @returns {Promise} Settles once every provider is done.
   */
  start(text, { isPrivate, userContextId }, onResults) {
    this.cancel();
    let context = new lazy.UrlbarQueryContext({
      sapName: "urlbar",
      searchString: text,
      isPrivate,
      maxResults: MAX_RESULTS,
      allowAutofill: true,
      userContextId,
    });
    this.#context = context;
    // Stands for the urlbar's controller, which the query tells when
    // results come and the providers ask for the window.
    let listener = {
      browserWindow: this.#window,
      receiveResults: queryContext => {
        if (queryContext == this.#context) {
          onResults(queryContext.results);
        }
      },
    };
    return this.#manager.startQuery(context, listener);
  }

  /** Stops the query running, if any; its results no longer come. */
  cancel() {
    if (this.#context) {
      this.#manager.cancelQuery(this.#context);
      this.#context = null;
    }
  }
}

/**
 * The greeting's message for the hour: morning from 5, afternoon from noon,
 * evening from 18 and night from 22.
 *
 * @param {number} hour 0 to 23.
 */
export function greetingId(hour) {
  if (hour >= 5 && hour < 12) {
    return "orbito-newtab-greeting-morning";
  }
  if (hour >= 12 && hour < 18) {
    return "orbito-newtab-greeting-afternoon";
  }
  if (hour >= 18 && hour < 22) {
    return "orbito-newtab-greeting-evening";
  }
  return "orbito-newtab-greeting-night";
}

/**
 * The parts of the line under the greeting: today's date, then how many
 * pages were read today and how many scheduled tasks ran, each only when
 * there were some.
 *
 * @param {{now: number, pagesRead?: number, taskRuns?: number}} counts
 * @param {string} language
 * @returns {string[]}
 */
export function summaryParts({ now, pagesRead = 0, taskRuns = 0 }, language) {
  let parts = [
    new Date(now).toLocaleDateString(language, {
      month: "long",
      day: "numeric",
      weekday: "long",
    }),
  ];
  if (pagesRead) {
    parts.push(t("orbito-newtab-pages-read", { count: pagesRead }));
  }
  if (taskRuns) {
    parts.push(t("orbito-newtab-task-runs", { count: taskRuns }));
  }
  return parts;
}
