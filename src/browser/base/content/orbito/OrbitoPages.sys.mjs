/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The assistant's own pages, which open in tabs, registered as about pages
 * at runtime (no Firefox file is patched for them):
 *   about:orbito-settings, about:orbito-library and
 *     about:orbito-timeline, privileged chrome pages loaded in the parent
 *     process;
 *   about:orbito-doc, the unprivileged document page (OrbitoDocs.sys.mjs),
 *     loaded in a web content process with the about: URL's own principal;
 *   about:newtab and about:home, which show Orbito's new tab page
 *     (newtab/newtab.html, a privileged chrome page in the parent process)
 *     instead of Firefox's.
 * Firefox's settings (about:preferences, reached from Orbito's settings)
 * and add-ons manager (about:addons) get a sheet that hides the sections
 * the Shell replaced.
 * Content processes need the about module of a page they load too (for its
 * flags; without them the load is dropped), so a process script registers
 * those pages in every content process as well.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  OrbitoDocs: "chrome://browser/content/orbito/OrbitoDocs.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

const PAGES = {
  "orbito-settings": {
    url: "chrome://browser/content/orbito/settings/settings.html",
    flags:
      Ci.nsIAboutModule.ALLOW_SCRIPT | Ci.nsIAboutModule.IS_SECURE_CHROME_UI,
  },
  "orbito-library": {
    url: "chrome://browser/content/orbito/library/library.html",
    flags:
      Ci.nsIAboutModule.ALLOW_SCRIPT | Ci.nsIAboutModule.IS_SECURE_CHROME_UI,
  },
  "orbito-timeline": {
    url: "chrome://browser/content/orbito/timeline/timeline.html",
    flags:
      Ci.nsIAboutModule.ALLOW_SCRIPT | Ci.nsIAboutModule.IS_SECURE_CHROME_UI,
  },
  "orbito-doc": {
    url: "chrome://browser/content/orbito/doc/doc.html",
    flags:
      Ci.nsIAboutModule.URI_SAFE_FOR_UNTRUSTED_CONTENT |
      Ci.nsIAboutModule.URI_MUST_LOAD_IN_CHILD |
      Ci.nsIAboutModule.HIDE_FROM_ABOUTABOUT,
  },
};

// What Orbito's new tab page replaces: Firefox's new tab and home pages.
const NEW_TAB_PAGES = ["newtab", "home"];

export const NEW_TAB_PAGE_URL =
  "chrome://browser/content/orbito/newtab/newtab.html";
export const SETTINGS_URL = "about:orbito-settings";
export const LIBRARY_URL = "about:orbito-library";
export const TIMELINE_URL = "about:orbito-timeline";

// Hide the sections of Firefox's pages the Shell replaced: the sheet for
// the pages each URL starts.
const FIREFOX_PAGE_SHEETS = [
  {
    urls: ["about:preferences", "about:settings"],
    sheet: "chrome://browser/content/orbito/settings/firefox-settings.css",
  },
  {
    urls: ["about:addons"],
    sheet: "chrome://browser/content/orbito/settings/firefox-addons.css",
  },
];

// Runs in every content process, present and future.
const PROCESS_SCRIPT =
  "data:," +
  encodeURIComponent(
    `ChromeUtils.importESModule("chrome://browser/content/orbito/OrbitoPages.sys.mjs").OrbitoPages.register();`
  );

// Tells open settings pages a skill draft is waiting.
const SKILL_DRAFT_TOPIC = "orbito-skill-draft";
// Tells open settings pages to show a task's runs.
const TASK_RUNS_TOPIC = "orbito-task-runs";
// Tells open library pages which list to show.
const LIBRARY_LIST_TOPIC = "orbito-library-list";
// Tells open settings pages to show a Space's settings.
const SPACE_SETTINGS_TOPIC = "orbito-space-settings";
// Tells open settings pages which pane to show.
const SETTINGS_PANE_TOPIC = "orbito-settings-pane";

class AboutPage {
  QueryInterface = ChromeUtils.generateQI(["nsIAboutModule"]);

  constructor({ url, flags }) {
    this.chromeURL = url;
    this.flags = flags;
  }

  getURIFlags() {
    return this.flags;
  }

  getChromeURI() {
    return Services.io.newURI(this.chromeURL);
  }

  newChannel(uri, loadInfo) {
    let channel = Services.io.newChannelFromURIWithLoadInfo(
      this.getChromeURI(),
      loadInfo
    );
    channel.originalURI = uri;
    return channel;
  }

  createInstance(iid) {
    return this.QueryInterface(iid);
  }
}

/**
 * about:newtab and about:home: Orbito's new tab page instead of Firefox's.
 * Firefox's own module for them stays: its code that reaches the module
 * through the contract (AboutNewTab, the newtab add-on's startup) still
 * gets it, through wrappedJSObject.
 */
class NewTabPage extends AboutPage {
  constructor(firefoxModule) {
    super({
      url: NEW_TAB_PAGE_URL,
      flags:
        Ci.nsIAboutModule.ALLOW_SCRIPT | Ci.nsIAboutModule.IS_SECURE_CHROME_UI,
    });
    this.firefoxModule = firefoxModule;
  }

  get wrappedJSObject() {
    return this.firefoxModule.wrappedJSObject;
  }
}

export const OrbitoPages = {
  SKILL_DRAFT_TOPIC,
  TASK_RUNS_TOPIC,
  LIBRARY_LIST_TOPIC,
  SPACE_SETTINGS_TOPIC,
  SETTINGS_PANE_TOPIC,
  _registered: false,
  // A skill draft for the settings page's editor, until the page takes it.
  _skillDraft: null,
  // The task whose runs the settings page is to show, until it takes it.
  _taskRuns: null,
  // The list the library page is to show, until it takes it.
  _libraryList: null,
  // The pane the settings page is to show, until it takes it.
  _settingsPane: null,

  /**
   * Registers the about pages; does nothing the second time. In the parent
   * process it registers them all and has content processes register the
   * pages that load there.
   */
  register() {
    if (this._registered) {
      return;
    }
    this._registered = true;
    let parent =
      Services.appinfo.processType == Services.appinfo.PROCESS_TYPE_DEFAULT;
    let registrar = Components.manager.QueryInterface(
      Ci.nsIComponentRegistrar
    );
    for (let [what, page] of Object.entries(PAGES)) {
      let inChild = page.flags & Ci.nsIAboutModule.URI_MUST_LOAD_IN_CHILD;
      if (!parent && !inChild) {
        continue;
      }
      registrar.registerFactory(
        Components.ID(Services.uuid.generateUUID().toString()),
        `Orbito ${what}`,
        `@mozilla.org/network/protocol/about;1?what=${what}`,
        new AboutPage(page)
      );
    }
    if (parent) {
      // The new tab page loads in this process only, so content processes
      // keep Firefox's module.
      let newTab = new NewTabPage(
        Cc["@mozilla.org/network/protocol/about;1?what=newtab"].getService(
          Ci.nsIAboutModule
        )
      );
      for (let what of NEW_TAB_PAGES) {
        registrar.registerFactory(
          Components.ID(Services.uuid.generateUUID().toString()),
          `Orbito ${what}`,
          `@mozilla.org/network/protocol/about;1?what=${what}`,
          newTab
        );
      }
      Services.ppmm.loadProcessScript(PROCESS_SCRIPT, true);
      lazy.OrbitoDocs.registerActor();
      Services.obs.addObserver(this, "document-element-inserted");
    }
  },

  /** Gives Firefox's settings and add-ons pages their sheet as they load. */
  observe(doc, topic) {
    if (
      topic != "document-element-inserted" ||
      !doc.nodePrincipal?.isSystemPrincipal
    ) {
      return;
    }
    let page = FIREFOX_PAGE_SHEETS.find(({ urls }) =>
      urls.some(url => doc.documentURI.startsWith(url))
    );
    if (page) {
      doc.defaultView?.windowUtils.loadSheetUsingURIString(
        page.sheet,
        Ci.nsIDOMWindowUtils.AUTHOR_SHEET
      );
    }
  },

  /**
   * Selects the settings tab, opening it if needed.
   *
   * @param {Window} win The window asking.
   * @param {object} [options]
   * @param {string} [options.pane] The pane to show, as "backends" or
   *   "recall"; by default the one it shows.
   */
  openSettings(win, { pane = null } = {}) {
    if (pane) {
      this._settingsPane = pane;
      // A settings page that is open shows it now, a new one once it loads.
      Services.obs.notifyObservers(null, SETTINGS_PANE_TOPIC);
    }
    this._open(win, SETTINGS_URL);
  },

  /** The pane the settings page is to show, once, or null. */
  takeSettingsPane() {
    let pane = this._settingsPane;
    this._settingsPane = null;
    return pane;
  },

  /**
   * Selects the library tab, opening it if needed.
   *
   * @param {Window} win The window asking.
   * @param {object} [options]
   * @param {string} [options.list] The list to show: "documents" or
   *   "threads"; by default the one it shows.
   */
  openLibrary(win, { list = null } = {}) {
    this._libraryList = list;
    // A library page that is open shows it now, a new one once it loads.
    Services.obs.notifyObservers(null, LIBRARY_LIST_TOPIC);
    this._open(win, LIBRARY_URL);
  },

  /** The list the library page is to show, once, or null. */
  takeLibraryList() {
    let list = this._libraryList;
    this._libraryList = null;
    return list;
  },

  /**
   * Selects the timeline tab, opening it if needed.
   *
   * @param {Window} win The window asking.
   */
  openTimeline(win) {
    this._open(win, TIMELINE_URL);
  },

  /**
   * Selects the tab of a privileged page, opening it if needed. These pages
   * hold logins or what normal windows saved, so they never open in a
   * private window: from one, they open in the latest normal window
   * instead.
   */
  _open(win, url) {
    this.register();
    if (lazy.PrivateBrowsingUtils.isWindowPrivate(win)) {
      let normal = lazy.BrowserWindowTracker.getTopWindow({ private: false });
      if (!normal) {
        win.openTrustedLinkIn(url, "window", {
          forceNonPrivate: true,
        });
        return;
      }
      win = normal;
      win.focus();
    }
    win.switchToTabHavingURI(url, true, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
  },
  /**
   * Opens the settings page with a skill draft in its editor, for the user
   * to check and save.
   *
   * @param {Window} win The window asking.
   * @param {object} draft {name, description, tools, output, body}.
   */
  openSkillDraft(win, draft) {
    this._skillDraft = draft;
    // A settings page that is open takes it now, a new one once it loads.
    Services.obs.notifyObservers(null, SKILL_DRAFT_TOPIC);
    this.openSettings(win);
  },

  /** The skill draft waiting for the settings page, once. */
  takeSkillDraft() {
    let draft = this._skillDraft;
    this._skillDraft = null;
    return draft;
  },

  /**
   * Opens the settings page showing a scheduled task's runs.
   *
   * @param {Window} win The window asking.
   * @param {string} taskId
   */
  openTaskRuns(win, taskId) {
    this._taskRuns = taskId;
    Services.obs.notifyObservers(null, TASK_RUNS_TOPIC);
    this.openSettings(win);
  },

  /**
   * Opens the settings page on a Space's settings.
   *
   * @param {Window} win The window asking.
   * @param {string} space The Space's id.
   */
  openSpaceSettings(win, space) {
    this._spaceSettings = space;
    Services.obs.notifyObservers(null, SPACE_SETTINGS_TOPIC);
    this.openSettings(win);
  },

  /** The Space whose settings the settings page is to show, once. */
  takeSpaceSettings() {
    let space = this._spaceSettings;
    this._spaceSettings = null;
    return space;
  },

  /** The task whose runs the settings page is to show, once. */
  takeTaskRuns() {
    let id = this._taskRuns;
    this._taskRuns = null;
    return id;
  },
};
