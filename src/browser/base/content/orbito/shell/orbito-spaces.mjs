/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, nothing } from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";
import { MAX_SPACES } from "chrome://browser/content/orbito/shell/OrbitoSpaces.sys.mjs";
import { isMenuKey } from "chrome://browser/content/orbito/shell/orbito-pins.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  OrbitoAssistantCore:
    "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs",
});

/** The element with focus, inside shadow roots too. */
function focusedElement() {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  return el;
}

/** The shortcut to the nth Space (from 1), as the platform writes it. */
export function spaceKey(n) {
  return AppConstants.platform == "macosx" ? `⌃${n}` : `Ctrl+Alt+${n}`;
}

/** A view of the window's Spaces (OrbitoShell.spaces). */
class SpacesView extends MozLitElement {
  get spaces() {
    return window.OrbitoShell.spaces;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("OrbitoSpacesChange", this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("OrbitoSpacesChange", this);
  }

  handleEvent() {
    this.requestUpdate();
  }

  /** Opens the Space menu as the context menu, or from its key. */
  onMenu(event, id) {
    if (event.type == "contextmenu" || isMenuKey(event)) {
      event.preventDefault();
      this.spaces.openMenu(id, event.currentTarget, event);
      return true;
    }
    return false;
  }
}

/**
 * The name of the Space the window shows, at the top of the Sidebar's
 * Space body. Its context menu is the Space menu, whose Rename turns it
 * into a field: Enter or leaving it keeps the name typed (a blank one keeps
 * the old), Escape the old one; focus then goes back where it was.
 */
export class OrbitoSpaceTitle extends SpacesView {
  // The Space being renamed, and the element focus goes back to.
  #renaming = null;
  #returnFocus = null;

  static queries = {
    field: "input.rename",
  };

  handleEvent(event) {
    let rename = event.detail?.rename;
    if (rename) {
      this.#returnFocus = focusedElement();
      this.#renaming = rename;
    }
    super.handleEvent(event);
  }

  async updated() {
    if (this.#renaming && this.field && !this.field.matches(":focus")) {
      this.field.focus({ focusVisible: true });
      this.field.select();
    }
  }

  #finish(keep) {
    let id = this.#renaming;
    if (!id) {
      return;
    }
    let typed = this.field?.value;
    this.#renaming = null;
    if (keep) {
      this.spaces.rename(id, typed);
    }
    this.requestUpdate();
    let back = this.#returnFocus;
    this.#returnFocus = null;
    if (back?.isConnected) {
      back.focus();
    } else {
      gBrowser.selectedBrowser.focus();
    }
  }

  #onKeyDown(event) {
    // Enter or Escape that ends a composition (Korean, say) is the IME's.
    if (event.isComposing) {
      return;
    }
    if (event.key == "Enter") {
      event.preventDefault();
      this.#finish(true);
    } else if (event.key == "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.#finish(false);
    }
  }

  render() {
    let space = this.spaces.currentSpace;
    if (this.#renaming && this.#renaming != space?.id) {
      // Another Space is shown now.
      this.#renaming = null;
    }
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/orbito/shell/orbito-spaces.css"
      />
      ${this.#renaming
        ? html`<input
            class="rename"
            aria-label=${t("orbito-spaces-name")}
            maxlength="60"
            .value=${space.name}
            @keydown=${this.#onKeyDown}
            @blur=${() => this.#finish(true)}
          />`
        : html`<div
            class="title"
            @contextmenu=${event => this.onMenu(event, space?.id)}
          >
            ${space?.name}
          </div>`}
    `;
  }
}
customElements.define("orbito-space-title", OrbitoSpaceTitle);

/**
 * The Space switcher at the bottom of the Sidebar: a capsule in the middle
 * with a dot per Space, the current one an accent pill, and apart from it
 * at the end the button that makes a new Space. Only a click (or Enter or
 * Space) switches; the pointer passing over does not. After a new Space,
 * a note at the window's bottom left (the page's, beside a shown Sidebar,
 * not over the switcher) offers to take it back for a few seconds. It is a
 * popover, in the top layer: shown whether the Sidebar is collapsed or not,
 * out of its box.
 *
 * The dots are one tab stop: Left and Right (Home, End) move between them.
 * A Space other than the current one where a Thread waits for an approval
 * has an amber dot. A dot's context menu (or menu key) is its Space's menu.
 *
 * Deleting a Space from that menu asks first, in a dialog where the note
 * shows: its tabs close, and the rest is moved to another Space (the
 * first other one by default) or deleted with it. Escape or Cancel keeps
 * it. Once deleted, the note offers to take it back for a few seconds.
 */
export class OrbitoSpaceSwitcher extends SpacesView {
  // The dot the keyboard is on, by its Space id; the current one when unset.
  #focusedId = null;
  // Whether a Thread waits is told by the core's events.
  #onCoreEvent = (threadId, event) => {
    if (event.type == "approval" || event.type == "done") {
      this.requestUpdate();
    }
  };

  connectedCallback() {
    super.connectedCallback();
    lazy.OrbitoAssistantCore.addListener(this.#onCoreEvent);
    // The core outlives the window, whose unload leaves the element
    // connected.
    window.addEventListener("unload", this.#removeCoreListener, {
      once: true,
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#removeCoreListener();
  }

  #removeCoreListener = () =>
    lazy.OrbitoAssistantCore.removeListener(this.#onCoreEvent);

  static queries = {
    dots: { all: ".space" },
    addButton: ".add",
    undoButton: ".undo",
    note: ".note",
    removeDialog: ".remove-dialog",
  };

  // The Space the delete dialog asks about, and where focus goes back.
  #removing = null;
  #returnFocus = null;

  get #rovingId() {
    let { list, current } = this.spaces;
    return list.some(space => space.id == this.#focusedId)
      ? this.#focusedId
      : current;
  }

  async #focusDot(id) {
    this.#focusedId = id;
    this.requestUpdate();
    await this.updateComplete;
    [...this.dots]
      .find(dot => dot.dataset.space == id)
      ?.focus({ focusVisible: true });
  }

  #onKeyDown(event) {
    if (isMenuKey(event)) {
      let dot = [...this.dots].find(d => d.dataset.space == this.#rovingId);
      event.preventDefault();
      this.spaces.openMenu(this.#rovingId, dot, event);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    let ids = this.spaces.list.map(space => space.id);
    let index = ids.indexOf(this.#rovingId);
    let forward = document.dir == "rtl" ? "ArrowLeft" : "ArrowRight";
    let backward = document.dir == "rtl" ? "ArrowRight" : "ArrowLeft";
    let target;
    switch (event.key) {
      case forward:
        target = ids[Math.min(index + 1, ids.length - 1)];
        break;
      case backward:
        target = ids[Math.max(index - 1, 0)];
        break;
      case "Home":
        target = ids[0];
        break;
      case "End":
        target = ids.at(-1);
        break;
      default:
        return;
    }
    event.preventDefault();
    this.#focusDot(target);
  }

  // Like the tab list's rows, a click does not take focus from the page.
  #keepFocus(event) {
    if (event.button == 0) {
      event.preventDefault();
    }
  }

  // The note going (taken back, or its time up) takes its Undo button with
  // it; focus on it goes to the new Space button.
  async handleEvent() {
    let undoHadFocus = this.undoButton?.matches(":focus");
    this.requestUpdate();
    await this.updateComplete;
    if (undoHadFocus && !this.undoButton) {
      this.addButton.focus({ focusVisible: true });
    }
  }

  #note() {
    let space = this.spaces.undoable;
    if (!space) {
      return nothing;
    }
    let text = this.spaces.undoRemoved
      ? t("orbito-spaces-removed", { name: space.name })
      : t("orbito-spaces-created", { name: space.name });
    return html`<span class="text">${text}</span
      ><button
        class="undo"
        @mousedown=${this.#keepFocus}
        @click=${() => this.spaces.undo()}
      >
        ${t("orbito-spaces-undo")}
      </button>`;
  }

  updated() {
    let open = this.note.matches(":popover-open");
    if (this.spaces.undoable && !open) {
      this.#placeBeside(this.note);
      this.note.showPopover();
    } else if (!this.spaces.undoable && open) {
      this.note.hidePopover();
    }
    // A Space gone while asked about (elsewhere) closes the dialog.
    if (this.#removing && !this.spaces.canRemove(this.#removing)) {
      this.#closeRemove();
    }
  }

  // Over the page, beside a shown Sidebar.
  #placeBeside(popover) {
    popover.toggleAttribute(
      "beside-sidebar",
      !this.closest("orbito-sidebar")?.collapsed
    );
  }

  /** Asks whether to delete a Space, and what to do with the rest. */
  async confirmRemove(id) {
    if (!this.spaces.canRemove(id)) {
      return;
    }
    this.#returnFocus = focusedElement();
    this.#removing = id;
    this.requestUpdate();
    await this.updateComplete;
    this.#placeBeside(this.removeDialog);
    if (!this.removeDialog.matches(":popover-open")) {
      this.removeDialog.showPopover();
    }
    this.removeDialog.querySelector("select").focus({ focusVisible: true });
  }

  #closeRemove({ removed = false } = {}) {
    this.#removing = null;
    if (this.removeDialog.matches(":popover-open")) {
      this.removeDialog.hidePopover();
    }
    this.requestUpdate();
    let back = this.#returnFocus;
    this.#returnFocus = null;
    if (removed) {
      // Undo, in the note now.
      this.updateComplete.then(() =>
        this.undoButton?.focus({ focusVisible: true })
      );
    } else if (back?.isConnected) {
      back.focus();
    }
  }

  #remove() {
    let to = this.removeDialog.querySelector("select").value || null;
    let id = this.#removing;
    this.#closeRemove({ removed: true });
    this.spaces.remove(id, { to });
  }

  #renderRemove() {
    let id = this.#removing;
    let space = id && this.spaces.list.find(s => s.id == id);
    if (!space) {
      return nothing;
    }
    // The tabs that close: not the Dock's, which go with the Dock, nor new
    // tab pages (a tab not loaded yet shows about:blank: it counts).
    let tabs = 0;
    for (let win of Services.wm.getEnumerator("navigator:browser")) {
      tabs +=
        win.OrbitoShell?.spaces
          ?.tabsIn(id)
          .filter(
            tab =>
              !win.OrbitoShell.docks?.dockOf(tab) &&
              (tab.hasAttribute("pending") ||
                !win.isBlankPageURL(tab.linkedBrowser.currentURI.spec))
          ).length ?? 0;
    }
    // Moved to the first other Space by default: the first option, as
    // they are all put in together.
    let choices = [
      ...this.spaces.list
        .filter(s => s.id != id)
        .map(other => [
          other.id,
          t("orbito-spaces-remove-move", { name: other.name }),
        ]),
      ["", t("orbito-spaces-remove-delete")],
    ];
    return html`<p class="remove-title" id="remove-title">
        ${t("orbito-spaces-remove-title", { name: space.name })}
      </p>
      <p class="remove-hint">
        ${t("orbito-spaces-remove-tabs", { count: tabs })}
      </p>
      <label class="remove-data">
        <span>${t("orbito-spaces-remove-data")}</span>
        <select>
          ${choices.map(
            ([value, text]) => html`<option value=${value}>${text}</option>`
          )}
        </select>
      </label>
      <div class="remove-actions">
        <button class="remove-cancel" @click=${() => this.#closeRemove()}>
          ${t("orbito-spaces-remove-cancel")}
        </button>
        <button class="remove-confirm" @click=${() => this.#remove()}>
          ${t("orbito-spaces-remove-confirm")}
        </button>
      </div>`;
  }

  render() {
    let { list, current, undoable } = this.spaces;
    let roving = this.#rovingId;
    let full = this.spaces.all.length >= MAX_SPACES;
    let waiting = new Set(
      lazy.OrbitoAssistantCore.activeThreads(window)
        .filter(thread => thread.waiting)
        .map(thread => thread.space)
    );
    let addLabel = full
      ? t("orbito-spaces-new-full", { max: MAX_SPACES })
      : t("orbito-spaces-new");
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/orbito/shell/orbito-spaces.css"
      />
      <div class="row">
        <div
          class="spaces"
          role="tablist"
          aria-label=${t("orbito-spaces-list")}
          @keydown=${this.#onKeyDown}
        >
          ${list.map((space, i) => {
            let waits = space.id != current && waiting.has(space.id);
            return html`<button
              class="space"
              role="tab"
              data-space=${space.id}
              aria-selected=${space.id == current ? "true" : "false"}
              aria-label=${waits
                ? t("orbito-spaces-space-waiting", { name: space.name })
                : space.name}
              title=${t(
                waits
                  ? "orbito-spaces-space-title-waiting"
                  : "orbito-spaces-space-title",
                { name: space.name, key: spaceKey(i + 1) }
              )}
              tabindex=${space.id == roving ? "0" : "-1"}
              ?current=${space.id == current}
              ?alert=${waits}
              ?fresh=${space.id == undoable?.id && !this.spaces.undoRemoved}
              @mousedown=${this.#keepFocus}
              @click=${() => this.spaces.switchTo(space.id)}
              @contextmenu=${event => this.onMenu(event, space.id)}
              @focus=${() => (this.#focusedId = space.id)}
            ></button>`;
          })}
        </div>
        <button
          class="add"
          aria-label=${addLabel}
          title=${addLabel}
          ?disabled=${full}
          @mousedown=${this.#keepFocus}
          @click=${() => this.spaces.create()}
        ></button>
        <div class="note" role="status" popover="manual">${this.#note()}</div>
        <div
          class="remove-dialog"
          role="dialog"
          aria-labelledby="remove-title"
          popover="manual"
          @keydown=${event => {
            if (event.key == "Escape") {
              event.preventDefault();
              event.stopPropagation();
              this.#closeRemove();
            }
          }}
        >
          ${this.#renderRemove()}
        </div>
      </div>
    `;
  }
}
customElements.define("orbito-space-switcher", OrbitoSpaceSwitcher);
