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
 *
 * The tabs of the user's other devices (Firefox's RemoteTabs provider) are
 * trimmed and described here for the Command bar too (trimRemoteTabs(),
 * remoteTabSub(), deviceIcon()), so the two inputs show them alike.
 */

const { t, OrbitoL10n } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ProvidersManager:
    "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs",
  SyncedTabs: "resource://services-sync/SyncedTabs.sys.mjs",
  UrlbarQueryContext: "chrome://browser/content/urlbar/UrlbarQueryContext.mjs",
  UrlbarShared: "chrome://browser/content/urlbar/UrlbarShared.mjs",
});

/** How many suggestions the page shows at most, as the urlbar does. */
const MAX_RESULTS = 10;

/** How many tabs of other devices the suggestions show at most. */
export const MAX_REMOTE_TABS = 3;

/** The icon of each kind of device Sync knows, by its client type. */
const DEVICE_ICONS = {
  desktop: "chrome://browser/skin/device-desktop.svg",
  phone: "chrome://browser/skin/device-phone.svg",
  tablet: "chrome://browser/skin/device-tablet.svg",
};

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
 * The icon of a kind of device ("desktop", "phone" or "tablet", as Sync
 * says), a desktop's when it is not known.
 *
 * @param {?string} type
 */
export function deviceIcon(type) {
  return DEVICE_ICONS[type] ?? DEVICE_ICONS.desktop;
}

/**
 * How long ago a time was, in words: "now", "5 minutes ago", "yesterday".
 *
 * @param {number} time In milliseconds.
 * @param {number} now In milliseconds.
 * @param {string} language
 */
export function agoText(time, now, language) {
  let format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  let minutes = Math.floor(Math.max(0, now - time) / 60000);
  if (minutes < 1) {
    return format.format(0, "second");
  }
  if (minutes < 60) {
    return format.format(-minutes, "minute");
  }
  let hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return format.format(-hours, "hour");
  }
  return format.format(-Math.floor(hours / 24), "day");
}

/**
 * The line under a tab of another device: the device's name, then how long
 * ago the tab was last used there, when Sync knows.
 *
 * @param {{device?: string, lastUsed?: number}} payload
 *   A remote tab result's: lastUsed is in milliseconds, 0 when not known.
 * @param {number} now
 * @param {string} language
 */
export function remoteTabSub({ device, lastUsed }, now, language) {
  return [device, lastUsed ? agoText(lastUsed, now, language) : ""]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The results with no more than MAX_REMOTE_TABS tabs of other devices, and
 * none that is open here already: a switch-to-tab result for the same
 * address is the one kept. The order stays the urlbar's (with Firefox's
 * own: the tabs used in the last 72 hours first).
 *
 * @param {Array<object>} results
 * @returns {Array<object>}
 */
export function trimRemoteTabs(results) {
  let { RESULT_TYPE } = lazy.UrlbarShared;
  let open = new Set(
    results
      .filter(result => result.type == RESULT_TYPE.TAB_SWITCH)
      .map(result => result.payload.url)
  );
  let remote = 0;
  return results.filter(
    result =>
      result.type != RESULT_TYPE.REMOTE_TAB ||
      result.heuristic ||
      (!open.has(result.payload.url) && ++remote <= MAX_REMOTE_TABS)
  );
}

/**
 * The kind of each of the user's other devices by its name, as remote tab
 * results name their device; empty when Sync is not set up or not ready.
 *
 * @returns {Promise<Map<string, string>>}
 */
export async function deviceTypes() {
  try {
    let clients = await lazy.SyncedTabs.getTabClients();
    return new Map(clients.map(client => [client.name, client.clientType]));
  } catch (e) {
    console.error(e);
    return new Map();
  }
}

/**
 * What a urlbar result is as a row, or null for a kind the page does not
 * show (a tip, a restrict keyword, a Command bar command).
 *
 * kind is what picking it does, as the Command bar's hints say: "go",
 * "search", "ask", "switch-tab", "open" or "command" (with its icon);
 * group the group it is in,
 * "tabs", "remote", "history" or "memory", "" for the results at the top,
 * and section that group's heading. A tab of another device also has its
 * device's icon (deviceIcon).
 *
 * @param {object} result
 * @param {{devices: Map<string, string>, now: number, language: string}} context
 *   Each device's kind by its name (deviceTypes()), and the time and
 *   language to say how long ago a remote tab was used in.
 * @returns {?{kind: string, group: string, section: string, title: string, sub: string, url: string}}
 */
function rowOf(result, { devices, now, language }) {
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
    case RESULT_TYPE.REMOTE_TAB:
      if (!result.heuristic) {
        return {
          ...page("open", "remote", t("orbito-newtab-section-remote")),
          sub: remoteTabSub(payload, now, language),
          deviceIcon: deviceIcon(devices.get(payload.device)),
        };
      }
    // A heuristic one is where Enter goes, as an address's.
    // falls through
    case RESULT_TYPE.URL:
    case RESULT_TYPE.KEYWORD:
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
 * stands for. The tabs of other devices are trimmed (trimRemoteTabs()).
 *
 * @param {Array<object>} results
 * @param {object} [context]
 * @param {Map<string, string>} [context.devices] Each device's kind by its name.
 * @param {number} [context.now]
 * @param {string} [context.language]
 * @returns {Array<{kind: string, group: string, section: string, title: string, sub: string, url: string, result: object}>}
 */
export function rowsOf(
  results,
  { devices = new Map(), now = Date.now(), language = OrbitoL10n.language } = {}
) {
  let rows = [];
  for (let result of trimRemoteTabs(results)) {
    let row = rowOf(result, { devices, now, language });
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
  /** When devices was last asked for, 0 before. */
  #devicesTime = 0;

  /**
   * The kind of each of the user's other devices by its name (deviceTypes()),
   * for rowsOf(); asked for once made, and again as queries start, at most
   * once a minute.
   *
   * @type {Map<string, string>}
   */
  devices = new Map();

  /** @param {Window} window The page's browser window, which providers ask for its Space. */
  constructor(window) {
    this.#window = window;
    // Before anything is typed, so the first suggestions have them.
    this.#askForDevices();
  }

  #askForDevices() {
    if (Date.now() - this.#devicesTime < 60000) {
      return;
    }
    this.#devicesTime = Date.now();
    deviceTypes().then(devices => {
      this.devices = devices;
    });
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
    this.#askForDevices();
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
