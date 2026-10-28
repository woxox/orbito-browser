/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Orbito's own strings, in Fluent files under orbito/locales/{locale}/,
 * and the languages Orbito comes in.
 *
 * The files are an L10n source of their own (registered on import, in the
 * parent process; content processes get it from there), apart from
 * Firefox's: Firefox's strings for a language other than English come from
 * that language's langpack, which knows nothing of Orbito's. A Localization
 * takes its files from one source family per language, so Orbito's strings
 * are never put in the same Localization as Firefox's: t() and the pages'
 * <link rel="localization"> name Orbito's files only.
 *
 * The language is picked in about:orbito-settings (setLanguage()) and takes
 * effect on a restart: the Shell's strings are formatted once, as it
 * renders.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AddonRepository: "resource://gre/modules/addons/AddonRepository.sys.mjs",
  LangPackMatcher: "moz-src:///intl/locale/LangPackMatcher.sys.mjs",
});

/** The languages Orbito's strings come in, the first the default. */
export const LANGUAGES = ["en-US", "ko"];

const SOURCE_NAME = "orbito";
const PRE_PATH = "chrome://browser/content/orbito/locales/{locale}/";
const FILES = [
  "orbito/common.ftl",
  "orbito/sidebar.ftl",
  "orbito/top-bar.ftl",
  "orbito/assistant.ftl",
  "orbito/settings.ftl",
  "orbito/pages.ftl",
];

function registerSource() {
  if (
    Services.appinfo.processType != Services.appinfo.PROCESS_TYPE_DEFAULT
  ) {
    return;
  }
  let registry = L10nRegistry.getInstance();
  if (registry.hasSource(SOURCE_NAME)) {
    return;
  }
  registry.registerSources([
    new L10nFileSource(
      SOURCE_NAME,
      "app",
      LANGUAGES,
      PRE_PATH,
      {},
      LANGUAGES.flatMap(language =>
        FILES.map(file => PRE_PATH.replace("{locale}", language) + file)
      )
    ),
  ]);
}

registerSource();

const l10n = new Localization(FILES, true);

// Requesting another language changes the app's at once, Firefox's pages
// with it, but the Shell's strings stay until a restart.
const startupLanguage = Services.locale.appLocaleAsBCP47;

/**
 * One of Orbito's strings in the app's language.
 *
 * @param {string} id The Fluent message's id.
 * @param {object} [args] The message's variables.
 * @returns {string}
 */
export function t(id, args) {
  return l10n.formatValueSync(id, args) ?? id;
}

export const OrbitoL10n = {
  /** The language Orbito's strings show in: the app's when it started. */
  get language() {
    return startupLanguage;
  },

  /**
   * The language picked for after a restart: the first requested that
   * Orbito comes in, or the default.
   */
  get requestedLanguage() {
    let [language] = Services.locale.negotiateLanguages(
      Services.locale.requestedLocales,
      LANGUAGES,
      LANGUAGES[0],
      Services.locale.langNegStrategyLookup
    );
    return language;
  },

  /**
   * A language's name in that language, e.g. "한국어".
   *
   * @param {string} language
   */
  nativeName(language) {
    // Without the region: "English", not "American English".
    return new Intl.DisplayNames([language], { type: "language" }).of(
      new Intl.Locale(language).language
    );
  },

  /**
   * Picks the language Orbito shows in after a restart, installing
   * Firefox's langpack for it first so Firefox's own strings follow.
   * Without the langpack (offline, or none for this version) Orbito's
   * strings still change and Firefox's stay in English.
   *
   * @param {string} language One of LANGUAGES.
   * @returns {Promise<boolean>} Whether Firefox's strings follow too.
   */
  async setLanguage(language) {
    if (!LANGUAGES.includes(language)) {
      throw new Error(`Orbito doesn't come in ${language}`);
    }
    let withFirefox = true;
    if (!(await this._hasLangpack(language))) {
      withFirefox = await this._installLangpack(language);
    }
    lazy.LangPackMatcher.setRequestedAppLocales([language]);
    return withFirefox;
  },

  async _hasLangpack(language) {
    if (Services.locale.packagedLocales.includes(language)) {
      return true;
    }
    let { AddonManager } = ChromeUtils.importESModule(
      "resource://gre/modules/AddonManager.sys.mjs"
    );
    let langpacks = await AddonManager.getAddonsByTypes(["locale"]);
    return langpacks.some(
      addon => addon.isActive && addon.id.startsWith(`langpack-${language}@`)
    );
  },

  async _installLangpack(language) {
    let available;
    try {
      available = await lazy.AddonRepository.getAvailableLangpacks();
    } catch (error) {
      console.error(error);
      return false;
    }
    let langpack = available?.find(pack => pack.target_locale == language);
    if (!langpack) {
      return false;
    }
    return lazy.LangPackMatcher.mockable.installLangPack(
      langpack,
      "about:orbito-settings"
    );
  },
};
