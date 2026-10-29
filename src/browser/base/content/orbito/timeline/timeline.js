/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * about:orbito-timeline: the pages Browsing recall remembers
 * (OrbitoRecall.sys.mjs), by the days they were read, latest first; older
 * days load as the page scrolls down. The search box searches them as
 * search_browsing does. A page can be summarized, which is the only time
 * the page calls a model, or forgotten. Titles and text come from the web
 * and are only ever inserted as text.
 */

const { OrbitoRecall } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoRecall.sys.mjs"
);
const { OrbitoAssistantCore } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs"
);
const { OrbitoPages } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoPages.sys.mjs"
);
const { OrbitoAppearance } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/shell/OrbitoAppearance.sys.mjs"
);
const { markdown } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoMarkdown.sys.mjs"
);
const { t, OrbitoL10n } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

OrbitoAppearance.follow(document);

// Entries loaded at a time.
const BATCH = 50;
const SEARCH_LIMIT = 50;
const SEARCH_DELAY_MS = 150;

function el(tag, props = {}, children = []) {
  let node = document.createElement(tag);
  for (let [key, value] of Object.entries(props)) {
    if (key == "class") {
      node.className = value;
    } else if (key == "text") {
      node.textContent = value;
    } else if (key.startsWith("on")) {
      node.addEventListener(key.slice(2), value);
    } else {
      node.setAttribute(key, value);
    }
  }
  node.append(...children);
  return node;
}

/** The local date of a time, as YYYY-MM-DD. */
function dayOf(time) {
  let date = new Date(time);
  let pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayTitle(day) {
  if (day == dayOf(Date.now())) {
    return t("orbito-timeline-today");
  }
  if (day == dayOf(Date.now() - 86400000)) {
    return t("orbito-timeline-yesterday");
  }
  let [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString(OrbitoL10n.language, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function readFor(ms) {
  let minutes = Math.round(ms / 60000);
  if (minutes < 1) {
    return t("orbito-timeline-read-briefly");
  }
  if (minutes < 60) {
    return t("orbito-timeline-read-minutes", { minutes });
  }
  return t("orbito-timeline-read-hours", {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  });
}

function topWindow() {
  return window.browsingContext.topChromeWindow;
}

function openURL(url) {
  topWindow().openWebLinkIn(url, "tab");
}

const OrbitoTimeline = {
  // Counts loads, so that a slow one does not add to a later one.
  _loads: 0,
  // The latest visit of the last entry listed, where the next batch starts;
  // null once there is no more.
  _before: null,
  _loading: false,
  _searchTimer: null,

  init() {
    this._search = document.getElementById("search");
    this._search.addEventListener("input", () => {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this._reload(), SEARCH_DELAY_MS);
    });
    // On its paragraph: localizing the paragraph may replace the link.
    document
      .getElementById("open-settings")
      .parentElement.addEventListener("click", event => {
        if (event.target.closest("#open-settings")) {
          event.preventDefault();
          OrbitoPages.openSettings(topWindow(), { pane: "recall" });
        }
      });
    new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        this._loadMore();
      }
    }).observe(document.getElementById("more"));
    // Pages read since the tab was last shown.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !this._search.value.trim()) {
        this._reload();
      }
    });
    this._reload();
  },

  async _reload() {
    let load = ++this._loads;
    let text = this._search.value.trim();
    let entries;
    if (text) {
      entries = (await OrbitoRecall.search(text, { limit: SEARCH_LIMIT })).map(
        page => ({ ...page, day: dayOf(page.visited_at), dwell_ms: null })
      );
    } else {
      entries = await OrbitoRecall.timeline({ limit: BATCH });
    }
    if (load != this._loads) {
      return;
    }
    document.getElementById("days").replaceChildren();
    this._before =
      !text && entries.length == BATCH ? entries.at(-1).visited_at : null;
    this._add(entries);
    let empty = document.getElementById("empty");
    empty.textContent = text
      ? t("orbito-timeline-no-match")
      : t("orbito-timeline-empty");
    empty.hidden = !!entries.length;
  },

  /** Lists the entries of the next older days, if there are more. */
  async _loadMore() {
    if (this._before == null || this._loading) {
      return;
    }
    this._loading = true;
    let load = this._loads;
    try {
      let entries = await OrbitoRecall.timeline({
        before: this._before,
        limit: BATCH,
      });
      if (load != this._loads) {
        return;
      }
      this._before = entries.length == BATCH ? entries.at(-1).visited_at : null;
      this._add(entries);
    } finally {
      this._loading = false;
    }
    // The page may still not reach the bottom of the window.
    let more = document.getElementById("more").getBoundingClientRect();
    if (more.top < window.innerHeight) {
      this._loadMore();
    }
  },

  _add(entries) {
    let days = document.getElementById("days");
    for (let entry of entries) {
      let section = days.lastElementChild;
      if (section?.dataset.day != entry.day) {
        section = el("section", { class: "day", "data-day": entry.day }, [
          el("h2", { text: dayTitle(entry.day) }),
          el("ul", { class: "cards" }),
        ]);
        days.append(section);
      }
      section.querySelector("ul").append(this._item(entry));
    }
  },

  _item(entry) {
    let domain = URL.parse(entry.url)?.hostname ?? entry.url;
    let meta = [
      domain,
      new Date(entry.visited_at).toLocaleTimeString(OrbitoL10n.language, {
        hour: "numeric",
        minute: "2-digit",
      }),
    ];
    if (entry.dwell_ms != null) {
      meta.push(readFor(entry.dwell_ms));
    }
    let item = el("li", { class: "card page", "data-url": entry.url }, [
      el("button", {
        class: "item-title",
        text: entry.title || entry.url,
        title: entry.url,
        onclick: () => openURL(entry.url),
      }),
      el("p", { class: "hint item-meta", text: meta.join(" · ") }),
      el("p", {
        class: "excerpt",
        text: (entry.excerpt ?? entry.start).replace(/\s+/g, " ").trim(),
      }),
    ]);
    item.append(this._actions(item, entry));
    return item;
  },

  _actions(item, entry) {
    let summarize = el("button", {
      class: "summarize",
      text: t("orbito-timeline-summarize"),
      onclick: () => this._summarize(item, entry, summarize),
    });
    let question = el("span", { text: t("orbito-timeline-forget-question") });
    let cancel = el("button", {
      text: t("orbito-timeline-cancel"),
      onclick: () => confirming(false),
    });
    let confirm = el("button", {
      class: "primary confirm-forget",
      text: t("orbito-timeline-forget"),
      onclick: async () => {
        confirming(false);
        try {
          await OrbitoRecall.forget(entry.url);
        } catch (e) {
          console.error(e);
          return;
        }
        let list = item.parentNode;
        item.remove();
        if (!list.children.length) {
          list.closest(".day").remove();
        }
      },
    });
    let forget = el("button", {
      class: "forget",
      text: t("orbito-timeline-forget"),
      "aria-label": t("orbito-timeline-forget-label", {
        title: entry.title || entry.url,
      }),
      onclick: () => confirming(true),
    });
    let confirming = on => {
      summarize.hidden = on || !!item.dataset.summarized;
      forget.hidden = on;
      question.hidden = cancel.hidden = confirm.hidden = !on;
    };
    confirming(false);
    return el("div", { class: "actions" }, [
      question,
      cancel,
      confirm,
      summarize,
      forget,
    ]);
  },

  async _summarize(item, entry, button) {
    button.disabled = true;
    button.textContent = t("orbito-timeline-summarizing");
    let summary = el("div", { class: "summary", role: "status" });
    item.querySelector(".summary")?.remove();
    item.querySelector(".actions").before(summary);
    try {
      let text = await OrbitoAssistantCore.summarizePage(entry.url);
      summary.replaceChildren(
        ...markdown(document, text, {
          link: (href, label) =>
            el("button", { class: "link", onclick: () => openURL(href) }, label),
        })
      );
      item.dataset.summarized = "1";
      button.hidden = true;
    } catch (e) {
      summary.className = "error";
      summary.textContent = e.message;
      button.disabled = false;
      button.textContent = t("orbito-timeline-summarize");
    }
  },
};

window.addEventListener("DOMContentLoaded", () => OrbitoTimeline.init(), {
  once: true,
});
