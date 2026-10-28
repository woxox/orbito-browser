/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Which pages Browsing recall remembers and how they are keyed and
 * searched: the pages left out, the page's key, the hash that tells
 * whether its text changed, the FTS5 queries for a search and how results
 * are ranked and excerpted. Times are epoch ms, and functions that need
 * the time take it as an argument, so that tests can set the clock.
 */

// Words this long or longer are looked up in pages_fts (trigram), which
// finds them anywhere in a word; shorter ones (two characters) as a word's
// start in pages_fts_words, since a trigram index has no entry for them.
// Single characters are left out. A page needs only some of the words.
const TRIGRAM_LENGTH = 3;
const MIN_LENGTH = 2;

// A visit this many days old counts half as much as one today.
const RECENCY_HALF_DAYS = 30;
const DAY_MS = 86400000;

// Characters around the first match in an excerpt.
const EXCERPT_LENGTH = 300;

/**
 * The time before which visits are forgotten when pages are kept days
 * days, or null when they are kept for ever (0 days).
 */
export function retentionCutoff(days, now) {
  days = Math.floor(Number(days));
  return days > 0 ? now - days * DAY_MS : null;
}

/** Whether a page at this URL may be remembered: web pages only. */
export function recallableURL(url) {
  return /^https?:\/\//i.test(String(url));
}

/**
 * The domains whose pages are never remembered, from their setting (a JSON
 * array), lowercased and without a leading "." or "*.", each once.
 */
export function excludedDomains(json) {
  let list;
  try {
    list = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) {
    return [];
  }
  let domains = list
    .map(d => String(d).trim().toLowerCase().replace(/^(\*?\.)+/, ""))
    .filter(Boolean);
  return [...new Set(domains)];
}

/**
 * The domain the user typed to exclude, lowercased: a host name, or the
 * host of a URL.
 *
 * @throws {Error} Saying what is wrong with it.
 */
export function checkDomain(text) {
  let domain = String(text ?? "").trim().toLowerCase();
  if (domain.includes("://")) {
    domain = URL.parse(domain)?.hostname ?? "";
  }
  domain = domain.replace(/^(\*?\.)+/, "").replace(/\.$/, "");
  if (!/^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)*$/u.test(domain)) {
    throw new Error("Type a domain, like example.com.");
  }
  return domain;
}

/** Whether host is one of the domains or under one. */
export function isExcludedHost(host, domains) {
  host = String(host).toLowerCase().replace(/\.$/, "");
  return domains.some(d => host == d || host.endsWith(`.${d}`));
}

/** The page a URL shows, without its fragment. */
export function pageKey(url) {
  return String(url).replace(/#.*$/s, "");
}

/**
 * A hash of a page's title and text, to tell whether they changed: 53-bit
 * cyrb53 over their UTF-16 code units, as hex.
 */
export function pageHash(title, text) {
  let s = `${title ?? ""}\u0000${text ?? ""}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  let hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return hash.toString(16).padStart(14, "0");
}

/** The words of a search, without quotes, each once. */
export function searchWords(text) {
  let words = String(text ?? "")
    .split(/\s+/)
    .map(word => word.replaceAll('"', ""))
    .filter(word => [...word].length >= MIN_LENGTH);
  return [...new Set(words)];
}

// Words of a search that are looked up; the rest are left out.
const MAX_WORDS = 10;

/**
 * The FTS5 lookups for the words of a search, one per word, each in the
 * index that can find it: [{table, query}], table being "pages_fts" for
 * words of three or more characters and "pages_fts_words" for shorter
 * ones. A page matching any of them is found; see pageRank.
 */
export function pageTerms(text) {
  return searchWords(text)
    .slice(0, MAX_WORDS)
    .map(word =>
      [...word].length >= TRIGRAM_LENGTH
        ? { table: "pages_fts", query: `"${word}"` }
        : { table: "pages_fts_words", query: `"${word}"*` }
    );
}

/**
 * Orders pages found for a search: more of its words first, then the
 * better score (see pageScore).
 */
export function pageRank(a, b) {
  return b.matched - a.matched || b.score - a.score;
}

/**
 * How well a page matches, from its bm25 (lower is better, as FTS5 gives
 * it), counting a recent visit more.
 */
export function pageScore(bm25, visitedAt, now) {
  let days = Math.max(0, now - visitedAt) / DAY_MS;
  return -bm25 / (1 + days / RECENCY_HALF_DAYS);
}

/** About length characters of text from start on. */
export function excerptFrom(text, start, length = EXCERPT_LENGTH) {
  text = String(text ?? "");
  let part = text.slice(start, start + length).trim();
  return (
    (start > 0 ? "…" : "") + part + (start + length < text.length ? "…" : "")
  );
}

/**
 * About EXCERPT_LENGTH characters of text around the first place any word
 * of the search appears, or its start if none does.
 */
export function excerpt(text, search, length = EXCERPT_LENGTH) {
  text = String(text ?? "");
  let lower = text.toLowerCase();
  let at = Math.min(
    ...searchWords(search)
      .map(word => lower.indexOf(word.toLowerCase()))
      .filter(i => i >= 0)
  );
  if (at == Infinity || at < length / 3) {
    at = 0;
  } else {
    at -= Math.floor(length / 3);
  }
  return excerptFrom(text, at, length);
}

// What of a page is embedded: its text in chunks of about this many
// characters, the first few of them.
const CHUNK_CHARS = 500;
const MAX_CHUNKS = 3;

// Below this cosine with the search, a page counts as unrelated; below
// the second, it is not close enough to be suggested in the urlbar.
// Measured with OrbitoEmbedder's model: searches and the pages they mean
// 0.43 and up, unrelated searches 0.32 at most.
export const SEMANTIC_FLOOR = 0.3;
export const SUGGEST_FLOOR = 0.38;

// Reciprocal rank fusion's constant.
const FUSION_K = 60;
// A visit this many days old counts half as much in a fused ranking.
const FUSED_RECENCY_HALF_DAYS = 90;

/**
 * The chunks of a page's text to embed: [{start, text}], start being where
 * the chunk starts in the text; the title alone for a page without text.
 * Chunks end at a space where there is one near their end.
 */
export function pageChunks(title, text) {
  text = String(text ?? "");
  let chunks = [];
  let start = 0;
  while (start < text.length && chunks.length < MAX_CHUNKS) {
    let end = Math.min(text.length, start + CHUNK_CHARS);
    if (end < text.length) {
      let space = text.lastIndexOf(" ", end);
      if (space > start + CHUNK_CHARS / 2) {
        end = space;
      }
    }
    let chunk = text.slice(start, end).trim();
    if (chunk) {
      chunks.push({ start, text: chunk });
    }
    start = end;
  }
  if (!chunks.length && title) {
    chunks.push({ start: 0, text: String(title) });
  }
  return chunks;
}

/**
 * A unit vector in a byte per dimension: {scale, bytes}, each value being
 * about bytes[i] * scale.
 */
export function quantize(vector) {
  let max = 0;
  for (let x of vector) {
    max = Math.max(max, Math.abs(x));
  }
  let scale = max / 127 || 1;
  return { scale, bytes: Int8Array.from(vector, x => Math.round(x / scale)) };
}

/**
 * Ranks pages found by keywords and by meaning together (reciprocal rank
 * fusion), counting recent visits more: [{id, score}], best first. A page
 * found by keywords counts as much as the share of the search's words it
 * has (coverage).
 *
 * @param {{id: number, visited_at: number, coverage?: number}[]} keyword
 *   Best first.
 * @param {{id, visited_at}[]} semantic Best first.
 * @param {number} now
 */
export function fuse(keyword, semantic, now) {
  let pages = new Map();
  for (let list of [keyword, semantic]) {
    list.forEach((page, rank) => {
      let entry = pages.get(page.id) ?? { page, rrf: 0 };
      entry.rrf += (page.coverage ?? 1) / (FUSION_K + rank + 1);
      pages.set(page.id, entry);
    });
  }
  return [...pages.values()]
    .map(({ page, rrf }) => {
      let days = Math.max(0, now - page.visited_at) / DAY_MS;
      return { id: page.id, score: rrf / (1 + days / FUSED_RECENCY_HALF_DAYS) };
    })
    .sort((a, b) => b.score - a.score);
}

/** A vector scaled to unit length, as a Float32Array. */
export function normalized(vector) {
  let length = Math.hypot(...vector);
  return Float32Array.from(vector, x => (length ? x / length : 0));
}

/** The dot product of two vectors; their cosine when they are unit length. */
export function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}
