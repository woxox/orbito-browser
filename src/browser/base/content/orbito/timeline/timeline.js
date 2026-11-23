/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * about:orbito-timeline: the pages Browsing recall remembers
 * (OrbitoRecall.sys.mjs), by the days they were read, latest first, each
 * day's reading by hour and its visits in reading sessions
 * (OrbitoTimelineSessions.sys.mjs); older days load as the page scrolls
 * down, with the visits of the account's other devices that Sync brings
 * (OrbitoRecallSyncEngine.sys.mjs), which a device menu narrows. The
 * search box lists, without days or sessions, this device's pages as
 * search_browsing does, then the other devices' visits by title and URL. A
 * page of this device can be summarized, which is the only time the page
 * calls a model; any can be forgotten, every device forgetting it while
 * Sync sends the forget. Titles and text come from the web and are only
 * ever inserted as text.
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
const { timelineDays, deviceKey } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoTimelineSessions.sys.mjs"
);

OrbitoAppearance.follow(document);

// Visits loaded at a time, more to end on the start of a day.
const BATCH = 100;
// The colors of other devices' visits (timeline.css), by the devices' order.
const DEVICE_COLORS = 4;
// The reading time a visit's bar is full at; an hour's is full at the
// day's most read hour, or at least this.
const FULL_VISIT_MS = 30 * 60000;
const FULL_HOUR_MIN_MS = 20 * 60000;
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

/** A time spent reading: "12 min", "1 h 5 min". */
function duration(ms) {
  let minutes = Math.round(ms / 60000);
  if (minutes < 1) {
    return t("orbito-timeline-duration-brief");
  }
  if (minutes < 60) {
    return t("orbito-timeline-duration-minutes", { minutes });
  }
  return t("orbito-timeline-duration-hours", {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  });
}

function clock(time) {
  return new Date(time).toLocaleTimeString(OrbitoL10n.language, {
    hour: "numeric",
    minute: "2-digit",
  });
}

const CALENDAR = { dayOf, hourOf: time => new Date(time).getHours() };

/** Sets how full a bar is, 0 to 1 (a style attribute is not allowed). */
function fill(node, fraction) {
  node.style.setProperty("--fill", String(Math.min(1, Math.max(0, fraction))));
  return node;
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
  // Where the next older visits start; null once there are no more.
  _before: null,
  _loading: false,
  _searchTimer: null,
  // The visits listed by day (not search results), to lay a day out again
  // when a page is forgotten.
  _visits: [],
  // The color of each other device: its key's number in DEVICE_COLORS.
  _colors: new Map(),

  init() {
    this._search = document.getElementById("search");
    this._search.addEventListener("input", () => {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this._reload(), SEARCH_DELAY_MS);
    });
    this._devices = document.getElementById("device");
    this._devices.addEventListener("change", () => this._reload());
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
    // Pages read (or synced) since the tab was last shown.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !this._search.value.trim()) {
        this._reload();
      }
    });
    this._reload();
  },

  /** The device chosen: undefined for all, "local" or another's id. */
  get _device() {
    return this._devices.value || undefined;
  },

  /**
   * Lists the other devices in the device menu, shown only when there are
   * any; one gone since falls back to all devices. Gives each its color.
   */
  async _listDevices() {
    let devices = await OrbitoRecall.devices();
    let chosen = this._devices.value;
    let option = (value, text) => el("option", { value, text });
    this._devices.replaceChildren(
      option("", t("orbito-timeline-all-devices")),
      option("local", t("orbito-timeline-this-device")),
      ...devices.map(device => option(device.id, device.name || device.id))
    );
    this._devices.value = [...this._devices.options].some(
      o => o.value == chosen
    )
      ? chosen
      : "";
    this._devices.hidden = !devices.length;
    this._names = new Map(devices.map(d => [d.id, d.name || d.id]));
    this._colors = new Map(
      devices.map((d, i) => [d.id, String((i % DEVICE_COLORS) + 1)])
    );
  },

  _colorOf(key) {
    return key == "local" ? "local" : (this._colors.get(key) ?? "1");
  },

  _nameOf(key) {
    return key == "local"
      ? t("orbito-timeline-this-device")
      : (this._names?.get(key) ?? key);
  },

  async _reload() {
    let load = ++this._loads;
    await this._listDevices();
    let text = this._search.value.trim();
    let device = this._device;
    let days = document.getElementById("days");
    let empty = document.getElementById("empty");
    if (text) {
      // This device's pages, best first, then the other devices' latest.
      let local =
        device === undefined || device == "local"
          ? await OrbitoRecall.search(text, { limit: SEARCH_LIMIT })
          : [];
      let remote =
        device == "local"
          ? []
          : await OrbitoRecall.searchOtherDevices(text, {
              device,
              limit: SEARCH_LIMIT,
            });
      if (load != this._loads) {
        return;
      }
      let entries = [...local, ...remote].map(page => ({
        ...page,
        dwell_ms: null,
        device: page.device ?? null,
      }));
      this._before = null;
      this._visits = [];
      days.replaceChildren();
      if (entries.length) {
        days.append(
          el("section", { class: "results" }, [
            el("ul", { class: "entries" }, entries.map(e => this._item(e))),
          ])
        );
      }
      empty.textContent = t("orbito-timeline-no-match");
      empty.hidden = !!entries.length;
      return;
    }
    let { visits, next } = await OrbitoRecall.timeline({
      limit: BATCH,
      device,
    });
    if (load != this._loads) {
      return;
    }
    days.replaceChildren();
    this._visits = [];
    this._before = next;
    this._add(visits);
    empty.textContent = t("orbito-timeline-empty");
    empty.hidden = !!visits.length;
  },

  /** Lists the next older days, if there are more. */
  async _loadMore() {
    if (this._before == null || this._loading) {
      return;
    }
    this._loading = true;
    let load = this._loads;
    try {
      let { visits, next } = await OrbitoRecall.timeline({
        before: this._before,
        limit: BATCH,
        device: this._device,
      });
      if (load != this._loads) {
        return;
      }
      this._before = next;
      this._add(visits);
    } finally {
      this._loading = false;
    }
    // The page may still not reach the bottom of the window.
    let more = document.getElementById("more").getBoundingClientRect();
    if (more.top < window.innerHeight) {
      this._loadMore();
    }
  },

  /** Lists visits of whole days older than those listed. */
  _add(visits) {
    this._visits.push(...visits);
    document
      .getElementById("days")
      .append(...timelineDays(visits, CALENDAR).map(day => this._day(day)));
  },

  _day(day) {
    let legend = this._devices.hidden
      ? []
      : day.devices.map(key =>
          el("li", { "data-color": this._colorOf(key) }, [
            el("span", { class: "dot", "aria-hidden": "true" }),
            this._nameOf(key),
          ])
        );
    let full = Math.max(FULL_HOUR_MIN_MS, ...day.hours.map(h => h.dwellMs));
    let hours = day.hours.map((hour, h) => {
      let label = new Date(2000, 0, 1, h).toLocaleTimeString(
        OrbitoL10n.language,
        { hour: "numeric" }
      );
      let bar = el("span", {
        class: hour.visits ? "hour read" : "hour",
        title: hour.visits ? `${label} · ${duration(hour.dwellMs)}` : label,
      });
      for (let key of day.devices) {
        if (hour.byDevice[key]) {
          bar.append(
            fill(
              el("span", { class: "part", "data-color": this._colorOf(key) }),
              hour.byDevice[key] / full
            )
          );
        }
      }
      return bar;
    });
    return el("section", { class: "day", "data-day": day.day }, [
      el("header", { class: "day-head" }, [
        el("div", { class: "day-title" }, [
          el("h2", { text: dayTitle(day.day) }),
          el("span", {
            class: "day-summary",
            text: t("orbito-timeline-summary", {
              pages: day.pages,
              duration: duration(day.dwellMs),
            }),
          }),
          el("ul", { class: "legend" }, legend),
        ]),
        el(
          "div",
          {
            class: "hours",
            role: "img",
            "aria-label": t("orbito-timeline-hours-label"),
          },
          hours
        ),
        el(
          "div",
          { class: "ticks", "aria-hidden": "true" },
          [0, 6, 12, 18, 24].map(h => el("span", { text: String(h) }))
        ),
      ]),
      el(
        "ol",
        { class: "sessions" },
        day.sessions.map(s => this._session(s))
      ),
    ]);
  },

  _session(session) {
    let [domain, ...others] = session.domains;
    let node = el("li", { class: "session" });
    let times = [el("span", { text: clock(session.start) })];
    if (clock(session.end) != clock(session.start)) {
      times.push(el("span", { class: "until", text: clock(session.end) }));
    }
    node.append(
      el("div", { class: "session-time" }, times),
      el("div", { class: "session-rail", "aria-hidden": "true" }),
      el("div", { class: "session-box" }, [
        el("div", { class: "session-head" }, [
          el("h3", {
            class: "session-title",
            text: others.length
              ? t("orbito-timeline-session-title", {
                  domain,
                  more: others.length,
                })
              : domain,
          }),
          el("span", {
            class: "session-summary",
            text: t("orbito-timeline-summary", {
              pages: session.pages,
              duration: duration(session.dwellMs),
            }),
          }),
          this._sessionActions(session),
        ]),
        el(
          "ul",
          { class: "entries" },
          session.entries.map(e => this._item(e))
        ),
      ])
    );
    return node;
  },

  /** Opens a session's pages again, or forgets them all. */
  _sessionActions(session) {
    let urls = [...new Set(session.entries.map(e => e.url))];
    let question = el("span");
    let reopen = el("button", {
      class: "quiet accent reopen",
      text: t("orbito-timeline-reopen"),
      onclick: () => {
        // Oldest first, so that the tabs read as they were read.
        for (let url of [...urls].reverse()) {
          topWindow().openWebLinkIn(url, "tab", { inBackground: true });
        }
      },
    });
    let forget = el("button", {
      class: "quiet danger forget-session",
      text: t("orbito-timeline-forget-session"),
      onclick: () => confirming(true),
    });
    let cancel = el("button", {
      class: "quiet",
      text: t("orbito-timeline-cancel"),
      onclick: () => confirming(false),
    });
    let confirm = el("button", {
      class: "primary danger confirm-forget-session",
      text: t("orbito-timeline-forget"),
      onclick: async () => {
        confirming(false);
        for (let url of urls) {
          try {
            await OrbitoRecall.forget(url);
          } catch (e) {
            console.error(e);
            continue;
          }
          this._removePage(url);
        }
      },
    });
    let actions = el("div", { class: "actions session-actions" }, [
      question,
      cancel,
      confirm,
      reopen,
      forget,
    ]);
    let confirming = on => {
      if (on) {
        question.textContent = t(
          OrbitoRecall.syncing
            ? "orbito-timeline-forget-session-everywhere-question"
            : "orbito-timeline-forget-session-question",
          { pages: urls.length }
        );
      }
      actions.classList.toggle("confirming", on);
      reopen.hidden = forget.hidden = on;
      question.hidden = cancel.hidden = confirm.hidden = !on;
    };
    confirming(false);
    return actions;
  },

  _item(entry) {
    let domain = URL.parse(entry.url)?.hostname ?? entry.url;
    let meta = [domain, clock(entry.visited_at)];
    if (entry.dwell_ms != null) {
      meta.push(readFor(entry.dwell_ms));
    }
    if (entry.device) {
      meta.push(entry.device.name || entry.device.id);
    }
    let key = deviceKey(entry.device);
    let main = el("div", { class: "item-main" }, [
      el("button", {
        class: "link item-title",
        text: entry.title || entry.url,
        title: entry.url,
        onclick: () => openURL(entry.url),
      }),
      el("p", { class: "hint item-meta", text: meta.join(" · ") }),
    ]);
    let excerpt = (entry.excerpt ?? entry.start ?? "").replace(/\s+/g, " ").trim();
    if (excerpt) {
      main.append(el("p", { class: "excerpt", text: excerpt }));
    }
    let item = el(
      "li",
      { class: "page", "data-url": entry.url, "data-color": this._colorOf(key) },
      [el("span", { class: "dot", "aria-hidden": "true" }), main]
    );
    if (entry.dwell_ms) {
      item.append(
        el("span", { class: "dwell", "aria-hidden": "true" }, [
          fill(el("span"), entry.dwell_ms / FULL_VISIT_MS),
        ])
      );
    }
    if (entry.device) {
      item.dataset.device = entry.device.id;
    }
    item.append(this._actions(item, entry));
    return item;
  },

  /**
   * Takes a forgotten page off the page: out of the search results, or out
   * of its days, which are laid out again without it, or go if it was all.
   */
  _removePage(url) {
    let gone = new Set();
    for (let item of document.querySelectorAll("#days .page")) {
      if (item.dataset.url == url) {
        let day = item.closest(".day");
        if (day) {
          gone.add(day);
        }
        item.remove();
      }
    }
    this._visits = this._visits.filter(v => v.url != url);
    for (let section of gone) {
      let visits = this._visits.filter(
        v => dayOf(v.visited_at) == section.dataset.day
      );
      let [day] = timelineDays(visits, CALENDAR);
      if (day) {
        let laidOut = this._day(day);
        this._keepSummaries(section, laidOut);
        section.replaceWith(laidOut);
      } else {
        section.remove();
      }
    }
    document.querySelector("#days .results:not(:has(.page))")?.remove();
  },

  /** Moves the summaries made on a day's pages to the day laid out again. */
  _keepSummaries(from, to) {
    for (let old of from.querySelectorAll(".page[data-summarized]")) {
      let item = [...to.querySelectorAll(".page")].find(
        li =>
          li.dataset.url == old.dataset.url &&
          li.dataset.device == old.dataset.device
      );
      if (item) {
        item.querySelector(".item-main").append(old.querySelector(".summary"));
        item.dataset.summarized = "1";
        item.querySelector(".summarize").hidden = true;
      }
    }
  },

  _actions(item, entry) {
    let summarize = el("button", {
      class: "quiet accent summarize",
      text: t("orbito-timeline-summarize"),
      onclick: () => this._summarize(item, entry, summarize),
    });
    let question = el("span");
    let cancel = el("button", {
      class: "quiet",
      text: t("orbito-timeline-cancel"),
      onclick: () => confirming(false),
    });
    let confirm = el("button", {
      class: "primary danger confirm-forget",
      text: t("orbito-timeline-forget"),
      onclick: async () => {
        confirming(false);
        try {
          await OrbitoRecall.forget(entry.url);
        } catch (e) {
          console.error(e);
          return;
        }
        this._removePage(entry.url);
      },
    });
    let forget = el("button", {
      class: "quiet danger forget",
      text: t("orbito-timeline-forget"),
      "aria-label": t("orbito-timeline-forget-label", {
        title: entry.title || entry.url,
      }),
      onclick: () => confirming(true),
    });
    let confirming = on => {
      if (on) {
        question.textContent = t(
          OrbitoRecall.syncing
            ? "orbito-timeline-forget-everywhere-question"
            : "orbito-timeline-forget-question"
        );
      }
      // Only this device keeps a page's text to summarize.
      summarize.hidden = on || !!item.dataset.summarized || !!entry.device;
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
    item.querySelector(".item-main").append(summary);
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
