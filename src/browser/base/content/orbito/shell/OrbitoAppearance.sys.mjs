/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Orbito's look, picked in about:orbito-settings: light, dark or the
 * system's, and one accent. Both are prefs, so every window and every
 * Orbito page that follows them (follow()) changes at once.
 *
 * A document follows them through its root's inline style: color-scheme
 * (which light-dark() in tokens.css reads; none for the system's) and the
 * accent's --orbito-accent-hue and --orbito-accent-chroma.
 *
 * Firefox themes are not used (ADR 0001). init() keeps them out at run
 * time (an enterprise policy would have Firefox say an organization manages
 * it): no theme add-on installs or stays, Firefox's built-in ones included,
 * and no window takes a theme's look, an extension's browser.theme.update()
 * included. It also has Firefox's color scheme follow the theme: its prefs
 * for the chrome and for pages (browser.theme.toolbar-theme and
 * content-theme), which Firefox's theme code writes on every theme update,
 * are locked to the theme's value.
 * A browser window's own override of the scheme, which that code sets from
 * the Firefox theme and the OS, follows it too (follow()).
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  BuiltInThemes: "resource:///modules/BuiltInThemes.sys.mjs",
  LightweightThemeConsumer:
    "resource://gre/modules/LightweightThemeConsumer.sys.mjs",
  LightweightThemeManager:
    "resource://gre/modules/LightweightThemeManager.sys.mjs",
});

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

// The theme Firefox has with no other: no look of its own.
const DEFAULT_THEME_ID = "default-theme@mozilla.org";

export const THEME_PREF = "orbito.appearance.theme";
export const ACCENT_PREF = "orbito.appearance.accent";

/** Firefox's color scheme prefs: dark 0, light 1, the system's 2. */
export const FIREFOX_SCHEME_PREFS = [
  "browser.theme.toolbar-theme",
  "browser.theme.content-theme",
];
const FIREFOX_SCHEMES = { dark: 0, light: 1 };
const SYSTEM_SCHEME = 2;

/** The themes, the first the default. */
export const THEMES = [
  { id: "system", name: t("orbito-appearance-theme-system") },
  { id: "light", name: t("orbito-appearance-theme-light") },
  { id: "dark", name: t("orbito-appearance-theme-dark") },
];

/** The accents, the first the default (the hue tokens.css starts with). */
export const ACCENTS = [
  {
    id: "violet",
    name: t("orbito-appearance-accent-violet"),
    hue: 277,
    chroma: 0.2,
  },
  {
    id: "blue",
    name: t("orbito-appearance-accent-blue"),
    hue: 245,
    chroma: 0.17,
  },
  {
    id: "green",
    name: t("orbito-appearance-accent-green"),
    hue: 155,
    chroma: 0.14,
  },
  {
    id: "coral",
    name: t("orbito-appearance-accent-coral"),
    hue: 30,
    chroma: 0.17,
  },
  {
    id: "graphite",
    name: t("orbito-appearance-accent-graphite"),
    hue: 260,
    chroma: 0.02,
  },
];

function pick(list, pref) {
  let id = Services.prefs.getStringPref(pref, "");
  return list.find(item => item.id == id) ?? list[0];
}

export const OrbitoAppearance = {
  _initialized: false,

  /**
   * Keeps Firefox themes out and Firefox's color scheme on the theme's;
   * does nothing the second time. Parent process only.
   */
  init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;
    this._setFirefoxScheme();
    Services.prefs.addObserver(THEME_PREF, () => this._setFirefoxScheme());
    this._keepThemesOut();
  },

  _setFirefoxScheme() {
    let value = FIREFOX_SCHEMES[this.colorScheme()] ?? SYSTEM_SCHEME;
    let defaults = Services.prefs.getDefaultBranch("");
    for (let pref of FIREFOX_SCHEME_PREFS) {
      // A locked pref reads its default value and ignores what is set.
      Services.prefs.unlockPref(pref);
      Services.prefs.clearUserPref(pref);
      defaults.setIntPref(pref, value);
      Services.prefs.lockPref(pref);
    }
  },

  _keepThemesOut() {
    let { AddonManager } = lazy;
    // Firefox installs its built-in themes (light, dark, Alpenglow) once it
    // is idle, and when its welcome page offers them: none.
    lazy.BuiltInThemes.builtInThemeMap = new Map();
    // An install of a theme (from a site, a file or an update) stops before
    // the theme lands.
    AddonManager.addInstallListener({
      onInstallStarted: install => install.addon?.type != "theme",
    });
    // One that lands or comes on anyway goes: a temporary one, one found at
    // startup, one an earlier run left.
    let drop = addon => {
      if (addon.type != "theme" || addon.id == DEFAULT_THEME_ID) {
        return;
      }
      let gone =
        addon.permissions & AddonManager.PERM_API_CAN_UNINSTALL
          ? addon.uninstall()
          : addon.isActive && addon.disable();
      Promise.resolve(gone).catch(console.error);
    };
    AddonManager.addAddonListener({ onInstalled: drop, onEnabled: drop });
    AddonManager.getAddonsByTypes(["theme"])
      .then(themes => themes.forEach(drop))
      .catch(console.error);

    // A window's theme code (LightweightThemeConsumer) gets a theme's look
    // from theme add-ons and from extensions' browser.theme.update(): it
    // gets the default theme's instead, and the windows already open get it
    // again.
    let { prototype } = lazy.LightweightThemeConsumer;
    let update = prototype._update;
    prototype._update = function (themeData) {
      let id = themeData?.theme?.id;
      return update.call(
        this,
        id && id != DEFAULT_THEME_ID ? { theme: null } : themeData
      );
    };
    Services.obs.notifyObservers(
      lazy.LightweightThemeManager.themeData,
      "lightweight-theme-styling-update"
    );
  },

  /** The theme's id: "system", "light" or "dark". */
  get theme() {
    return pick(THEMES, THEME_PREF).id;
  },

  /** The accent: {id, name, hue, chroma}. */
  get accent() {
    return pick(ACCENTS, ACCENT_PREF);
  },

  /** @param {string} id One of THEMES' ids. */
  setTheme(id) {
    if (THEMES.some(theme => theme.id == id)) {
      Services.prefs.setStringPref(THEME_PREF, id);
    }
  },

  /** @param {string} id One of ACCENTS' ids. */
  setAccent(id) {
    if (ACCENTS.some(accent => accent.id == id)) {
      Services.prefs.setStringPref(ACCENT_PREF, id);
    }
  },

  /**
   * The color scheme a theme forces, or null for the system's.
   *
   * @param {string} [theme]
   * @returns {"light"|"dark"|null}
   */
  colorScheme(theme = this.theme) {
    return theme == "system" ? null : theme;
  },

  /**
   * Gives a document the look now, and a window's top chrome document
   * the color scheme for its prefers-color-scheme too.
   *
   * @param {Document} doc
   */
  apply(doc) {
    let style = doc.documentElement.style;
    let { hue, chroma } = this.accent;
    style.setProperty("--orbito-accent-hue", String(hue));
    style.setProperty("--orbito-accent-chroma", String(chroma));
    let scheme = this.colorScheme();
    if (scheme) {
      style.setProperty("color-scheme", scheme);
    } else {
      style.removeProperty("color-scheme");
    }
    let context = doc.defaultView.browsingContext;
    if (!context.isContent && !context.parent) {
      context.prefersColorSchemeOverride = scheme ?? "none";
    }
  },

  /**
   * Gives a document the look, and the new one whenever it changes, until
   * its window unloads.
   *
   * @param {Document} doc
   */
  follow(doc) {
    this.apply(doc);
    let observer = { observe: () => this.apply(doc) };
    Services.prefs.addObserver(THEME_PREF, observer);
    Services.prefs.addObserver(ACCENT_PREF, observer);
    // A browser window's theme code (LightweightThemeConsumer) has just set
    // its scheme override from the Firefox theme and the OS.
    doc.defaultView.addEventListener("windowlwthemeupdate", () =>
      this.apply(doc)
    );
    doc.defaultView.addEventListener(
      "unload",
      () => {
        Services.prefs.removeObserver(THEME_PREF, observer);
        Services.prefs.removeObserver(ACCENT_PREF, observer);
      },
      { once: true }
    );
  },
};
