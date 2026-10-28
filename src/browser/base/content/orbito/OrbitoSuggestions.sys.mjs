/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Suggestion chips: the built-in skills the panel offers above its input
 * when they may help with the page shown. Decided only by these local rules
 * on the page's features, which the panel gathers without the model
 * (OrbitoPage.features); nothing is sent until the user picks a chip.
 */

// The page features are {textLength, lang, sameSiteTabs}: the length of the
// page's text, its language tag ("" when unknown), and how many tabs in its
// window are on the same site, itself included.
export const SUGGESTION_RULES = [
  {
    id: "summarize",
    label: "Summarize",
    skill: "페이지 요약",
    applies: page => page.textLength >= 4000,
  },
  {
    id: "translate",
    label: "Translate",
    skill: "번역",
    applies: (page, uiLanguage) =>
      !!page.lang &&
      primaryLanguage(page.lang) != "und" &&
      primaryLanguage(page.lang) != primaryLanguage(uiLanguage),
  },
  {
    id: "compare",
    label: "Compare",
    skill: "탭 비교",
    applies: page => page.sameSiteTabs >= 3,
  },
];

const MAX_SUGGESTIONS = 3;

/** "en" for "en-US" or "EN_gb". */
export function primaryLanguage(tag) {
  return tag.split(/[-_]/)[0].toLowerCase();
}

/**
 * The chips for a page, in the order of SUGGESTION_RULES.
 *
 * @param {{textLength: number, lang: string, sameSiteTabs: number}} page
 * @param {string} uiLanguage The browser's interface language, e.g. "ko".
 * @returns {{id: string, label: string, skill: string}[]}
 */
export function suggestions(page, uiLanguage) {
  return SUGGESTION_RULES.filter(rule => rule.applies(page, uiLanguage))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ id, label, skill }) => ({ id, label, skill }));
}
