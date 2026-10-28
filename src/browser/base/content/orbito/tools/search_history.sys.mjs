/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export function limitOf(input) {
  let limit = Math.floor(Number(input.limit) || DEFAULT_LIMIT);
  return Math.min(MAX_LIMIT, Math.max(1, limit));
}

/** Microseconds since the epoch, as Places keeps times, or null. */
export function time(value, name) {
  if (value == null || value === "") {
    return null;
  }
  let ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(`${name} is not a date or time.`);
  }
  return ms * 1000;
}

/** A local time with its offset, which the model can read back. */
export function localTime(us) {
  let date = new Date(us / 1000);
  let offset = -date.getTimezoneOffset();
  let pad = n => String(Math.trunc(Math.abs(n))).padStart(2, "0");
  let local = new Date(date.getTime() + offset * 60000)
    .toISOString()
    .slice(0, 19);
  return `${local}${offset < 0 ? "-" : "+"}${pad(offset / 60)}:${pad(offset % 60)}`;
}

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

export default {
  name: "search_history",
  description:
    "Search the pages the user visited, newest first. Every word of the query must appear in a page's title or URL; leave it out to list recent visits. since and until (ISO 8601, e.g. 2026-10-14 or 2026-10-14T09:00:00+09:00) limit it to visits in that period. Returns titles, URLs and the last visit in the period.",
  schema: {
    type: "object",
    properties: {
      query: { type: "string" },
      since: { type: "string", description: "Earliest visit, ISO 8601" },
      until: { type: "string", description: "Latest visit, ISO 8601" },
      limit: {
        type: "integer",
        description: `Results to return, at most ${MAX_LIMIT}`,
      },
    },
  },
  readOnly: true,
  concurrent: true,

  label(ctx, input) {
    return input?.query
      ? t("orbito-assistant-tool-searching-history", { query: input.query })
      : t("orbito-assistant-tool-looking-history");
  },

  async run(ctx, input) {
    let { PlacesUtils } = ChromeUtils.importESModule(
      "resource://gre/modules/PlacesUtils.sys.mjs"
    );
    let since = time(input.since, "since");
    let until = time(input.until, "until");
    let words = String(input.query ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 10);
    let db = await PlacesUtils.promiseDBConnection();
    let params = { limit: limitOf(input) };
    let where = ["h.hidden = 0"];
    if (since != null) {
      where.push("v.visit_date >= :since");
      params.since = since;
    }
    if (until != null) {
      where.push("v.visit_date <= :until");
      params.until = until;
    }
    words.forEach((word, i) => {
      where.push(
        `(h.title LIKE :w${i} ESCAPE '/' OR h.url LIKE :w${i} ESCAPE '/')`
      );
      params[`w${i}`] = `%${word.replace(/[/%_]/g, "/$&")}%`;
    });
    let rows = await db.execute(
      `SELECT h.url, h.title, MAX(v.visit_date) AS visited
       FROM moz_historyvisits v
       JOIN moz_places h ON h.id = v.place_id
       WHERE ${where.join(" AND ")}
       GROUP BY h.id
       ORDER BY visited DESC
       LIMIT :limit`,
      params
    );
    return JSON.stringify(
      rows.map(row => ({
        title: row.getResultByName("title") || "",
        url: row.getResultByName("url"),
        visited: localTime(row.getResultByName("visited")),
      }))
    );
  },
};
