/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Decides where text typed into an input such as the urlbar should go: to
 * an address, to the search engine, or to the assistant. Rules only, with no
 * network or model, so it can run on every keystroke; a classifier can take
 * the rules' place later behind the same route().
 *
 * When unsure between an address and anything else it picks the address:
 * taking an address away from the user is the worse mistake. "/name" with
 * the name of a skill that is on calls that skill, so it goes to the
 * assistant; the caller passes the names.
 */

import { matchSkill } from "./OrbitoSkills.sys.mjs";

const RULES = {
  // Schemes that have no "//", e.g. about:config or mailto:a@b.com.
  opaqueSchemes: [
    "about",
    "blob",
    "chrome",
    "data",
    "file",
    "javascript",
    "mailto",
    "moz-extension",
    "resource",
    "view-source",
  ],
  // An English question or request starts with one of these, followed by at
  // least one more word.
  englishStarts: [
    "what", "how", "why", "who", "whom", "whose", "when", "where", "which",
    "can", "could", "should", "would", "will", "is", "are", "am", "was",
    "were", "do", "does", "did", "summarize", "summarise", "explain",
    "compare", "translate", "write", "rewrite", "describe", "tell",
  ],
  // A Korean question or request has one of these anywhere...
  koreanWords: [
    "알려", "뭐야", "뭐지", "뭔데", "어떻게", "어때", "무엇", "요약", "설명",
    "비교", "번역", "추천", "정리",
  ],
  // ...or ends with one of these.
  koreanEndings: ["까", "나요", "가요", "줘", "죠", "래"],
  // This many words or more is a question rather than a search.
  minEnglishWords: 6,
  minKoreanWords: 4,
};

const HANGUL = /\p{Script=Hangul}/u;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const OPAQUE = new RegExp(`^(${RULES.opaqueSchemes.join("|")}):`, "i");
const PORT_PATH = String.raw`(:\d{1,5})?([/?#]\S*)?`;
const HOST_LIKE = [
  new RegExp(String.raw`^localhost${PORT_PATH}$`, "i"),
  new RegExp(String.raw`^\d{1,3}(\.\d{1,3}){3}${PORT_PATH}$`),
  new RegExp(String.raw`^\[[0-9a-f:.]+\]${PORT_PATH}$`, "i"),
  // A domain: labels ending with a top-level one of letters.
  new RegExp(
    String.raw`^([\p{L}\p{N}-]+\.)+\p{L}[\p{L}-]+\.?${PORT_PATH}$`,
    "iu"
  ),
];

function looksLikeAddress(text) {
  if (/\s/.test(text)) {
    return false;
  }
  return (
    SCHEME.test(text) ||
    OPAQUE.test(text) ||
    HOST_LIKE.some(re => re.test(text))
  );
}

function looksLikeQuestion(text) {
  if (/[?？]$/.test(text)) {
    return true;
  }
  let words = text.split(/\s+/);
  if (HANGUL.test(text)) {
    let bare = text.replace(/[.!~…]+$/, "");
    return (
      RULES.koreanWords.some(word => text.includes(word)) ||
      RULES.koreanEndings.some(ending => bare.endsWith(ending)) ||
      words.length >= RULES.minKoreanWords
    );
  }
  return (
    (words.length >= 2 &&
      RULES.englishStarts.includes(words[0].toLowerCase())) ||
    words.length >= RULES.minEnglishWords
  );
}

/**
 * @param {string} input What the user typed.
 * @param {string[]} [skills] The names of the skills that are on.
 * @returns {?{kind: "url" | "search" | "agent"}} null for blank input.
 */
export function route(input, skills = []) {
  let text = input.trim();
  if (!text) {
    return null;
  }
  // An unknown "/name" falls through to the rules below.
  if (matchSkill(text, skills)?.name) {
    return { kind: "agent" };
  }
  if (looksLikeAddress(text)) {
    return { kind: "url" };
  }
  return { kind: looksLikeQuestion(text) ? "agent" : "search" };
}
