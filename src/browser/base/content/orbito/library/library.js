/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * about:orbito-library: the documents and Threads normal windows
 * saved, newest first, in two tabs under one search box that searches the
 * content of both, those of the window's Space (and of none in
 * particular) or of all Spaces. A document opens in its tab, a Thread in
 * the panel of its tab, as does the Thread that made a document; a
 * document can move to another Space; either can be deleted, after the
 * user confirms. Titles are untrusted and only ever inserted as text.
 */

const { OrbitoAssistantCore } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs"
);
const { OrbitoPages } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoPages.sys.mjs"
);
const { OrbitoAppearance } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/shell/OrbitoAppearance.sys.mjs"
);
const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

// The page takes Orbito's light, dark and accent, as the windows do.
OrbitoAppearance.follow(document);

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

const date = time => new Date(time).toLocaleString();

const OrbitoLibrary = {
  // Counts searches, so that a slow one does not overwrite a later one.
  _searches: 0,
  // Whose documents and Threads are listed: "space" (the window's) or
  // "all".
  _scope: "space",

  init() {
    this._search = document.getElementById("search");
    this._search.addEventListener("input", () => this._render());
    // On its paragraph: localizing the paragraph may replace the link.
    document
      .getElementById("open-timeline")
      .parentElement.addEventListener("click", event => {
        if (event.target.closest("#open-timeline")) {
          event.preventDefault();
          OrbitoPages.openTimeline(window.browsingContext.topChromeWindow);
        }
      });
    for (let tab of document.querySelectorAll("[role=tab]")) {
      tab.addEventListener("click", () => this._select(tab));
    }
    for (let button of document.querySelectorAll("#scope button")) {
      button.addEventListener("click", () => {
        this._scope = button.dataset.scope;
        this._render();
      });
    }
    // The list the panel asked for, now or while this page is open.
    let takeList = () => {
      let list = OrbitoPages.takeLibraryList();
      if (list) {
        this._select(
          document.getElementById(
            list == "threads" ? "tab-threads" : "tab-artifacts"
          )
        );
      }
    };
    Services.obs.addObserver(takeList, OrbitoPages.LIBRARY_LIST_TOPIC);
    // Another Space shown in the window.
    let chrome = window.browsingContext.topChromeWindow;
    let spacesChanged = () => this._render();
    chrome?.addEventListener("OrbitoSpacesChange", spacesChanged);
    window.addEventListener("unload", () => {
      Services.obs.removeObserver(takeList, OrbitoPages.LIBRARY_LIST_TOPIC);
      chrome?.removeEventListener("OrbitoSpacesChange", spacesChanged);
    });
    takeList();
    // Questions asked and documents made since the tab was last shown.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        this._render();
      }
    });
    this._render();
  },

  _select(tab) {
    for (let other of document.querySelectorAll("[role=tab]")) {
      let selected = other == tab;
      other.setAttribute("aria-selected", selected);
      document.getElementById(other.getAttribute("aria-controls")).hidden =
        !selected;
    }
  },

  /** The Spaces of the page's window: {current, list}, or null without. */
  _spaces() {
    let spaces = window.browsingContext.topChromeWindow?.OrbitoShell?.spaces;
    return spaces ? { current: spaces.current, list: spaces.list } : null;
  },

  async _render() {
    let search = ++this._searches;
    let text = this._search.value;
    let spaces = this._spaces();
    let scope = document.getElementById("scope");
    scope.hidden = !spaces;
    for (let button of scope.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", button.dataset.scope == this._scope);
    }
    this._all = !spaces || this._scope == "all";
    let { artifacts, threads } = await OrbitoAssistantCore.library(text, {
      space: this._all ? undefined : spaces.current,
    });
    if (search != this._searches) {
      return;
    }
    let searching = !!text.trim();
    this._fill("artifacts", artifacts.map(a => this._artifactItem(a)), {
      none: t("orbito-library-no-documents"),
      noMatch: t("orbito-library-no-documents-match"),
      searching,
    });
    this._fill(
      "threads",
      threads.map(c => this._threadItem(c)),
      {
        none: t("orbito-library-no-threads"),
        noMatch: t("orbito-library-no-threads-match"),
        searching,
      }
    );
  },

  _fill(id, items, { none, noMatch, searching }) {
    let section = document.getElementById(id);
    section.querySelector("ul").replaceChildren(...items);
    let empty = section.querySelector(".empty");
    empty.textContent = searching ? noMatch : none;
    empty.hidden = !!items.length;
    document.querySelector(`#tab-${id} .count`).textContent = items.length;
  },

  _artifactItem(artifact) {
    let meta =
      artifact.thread_title != null
        ? t("orbito-library-document-meta-from", {
            date: date(artifact.updated_at),
            thread: artifact.thread_title,
          })
        : t("orbito-library-document-meta", {
            date: date(artifact.updated_at),
          });
    let actions = [];
    if (this._spaces()) {
      actions.push(this._artifactSpace(artifact));
    }
    // The Thread that made it, unless it was deleted since.
    if (artifact.thread_title != null) {
      actions.push(
        el("button", {
          class: "open-thread",
          text: t("orbito-library-open-thread"),
          title: t("orbito-library-open-thread-title"),
          onclick: () =>
            OrbitoAssistantCore.openThread(
              window.browsingContext.topChromeWindow,
              artifact.thread_id
            ).catch(console.error),
        })
      );
    }
    return el("li", { class: "card artifact", "data-id": artifact.id }, [
      el("button", {
        class: "item-title",
        text: artifact.title,
        onclick: () =>
          OrbitoAssistantCore.openArtifact(
            window.browsingContext.topChromeWindow,
            artifact.id
          ).catch(console.error),
      }),
      el("p", { class: "hint item-meta", text: meta }),
      this._deleteActions(
        t("orbito-library-delete-document-question"),
        () => OrbitoAssistantCore.deleteArtifact(artifact.id),
        actions
      ),
    ]);
  },

  /**
   * The menu of the Space a document belongs to, or none in particular
   * (listed in every Space); picking another moves it there.
   */
  _artifactSpace(artifact) {
    let spaces = this._spaces()?.list ?? [];
    let options = [
      { id: "", name: t("orbito-library-all-spaces") },
      ...spaces,
    ];
    // A Space removed since, until it moves to another.
    if (
      artifact.space_id != null &&
      !spaces.some(s => s.id == artifact.space_id)
    ) {
      options.push({
        id: artifact.space_id,
        name: t("orbito-library-space-gone"),
      });
    }
    let select = el(
      "select",
      {
        class: "document-space",
        "aria-label": t("orbito-library-document-space"),
        onchange: async event => {
          try {
            await OrbitoAssistantCore.setArtifactSpace(
              artifact.id,
              event.target.value || null
            );
          } catch (e) {
            console.error(e);
          }
          this._render();
        },
      },
      options.map(({ id, name }) => el("option", { value: id, text: name }))
    );
    select.value = artifact.space_id ?? "";
    return select;
  },

  _threadItem(thread) {
    let backend = OrbitoAssistantCore.BACKENDS[thread.backend];
    // Its Space, when every Space's are listed.
    let space =
      this._all &&
      this._spaces()?.list.find(s => s.id == thread.space_id)?.name;
    let meta = [
      backend
        ? t("orbito-library-thread-meta-backend", {
            date: date(thread.updated_at),
            backend: backend.label,
          })
        : t("orbito-library-thread-meta", {
            date: date(thread.updated_at),
          }),
      space,
      t("orbito-library-thread-documents", { count: thread.documents }),
    ]
      .filter(Boolean)
      .join(" · ");
    return el("li", { class: "card thread", "data-id": thread.id }, [
      el("button", {
        class: "item-title",
        text: thread.title,
        onclick: () =>
          OrbitoAssistantCore.openThread(
            window.browsingContext.topChromeWindow,
            thread.id
          ).catch(console.error),
      }),
      el("p", { class: "hint item-meta", text: meta }),
      this._deleteActions(
        t("orbito-library-delete-thread-question"),
        () => OrbitoAssistantCore.deleteThread(thread.id)
      ),
    ]);
  },

  /**
   * A Delete button that asks first: it shows the question with a second
   * Delete button, and only that one deletes. The other actions come
   * before it, hidden while it asks.
   */
  _deleteActions(question, remove, others = []) {
    let shown = [
      el("span", { class: "question", text: question }),
      el("button", {
        text: t("orbito-library-cancel"),
        onclick: () => confirming(false),
      }),
      el("button", {
        class: "primary confirm-delete",
        text: t("orbito-library-delete"),
        onclick: async () => {
          confirming(false);
          try {
            await remove();
          } catch (e) {
            console.error(e);
          }
          this._render();
        },
      }),
    ];
    let start = el("button", {
      class: "delete",
      text: t("orbito-library-delete"),
      onclick: () => confirming(true),
    });
    let confirming = on => {
      start.hidden = on;
      for (let node of others) {
        node.hidden = on;
      }
      for (let node of shown) {
        node.hidden = !on;
      }
    };
    confirming(false);
    return el("div", { class: "actions" }, [...others, ...shown, start]);
  },
};

window.addEventListener("DOMContentLoaded", () => OrbitoLibrary.init(), {
  once: true,
});
