/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Content side of Show Orbito (OrbitoShow.sys.mjs), one per top-level web
 * page while any window records a demo: tells the parent what the user
 * did on the page, as the events OrbitoShowLog.sys.mjs records.
 *
 * Clicks name their target by role, accessible name, text and context,
 * never by where it was or a selector. Fields are reported when the user
 * leaves them (change), presses Enter in them or submits their form, with
 * their final value, once for each time they were typed in; the value of
 * a secret field (fieldKind) is never read, only that the user typed it,
 * nor the option chosen in a secret <select>. Scrolling, mouse moves and
 * hovering are not reported; a click only says whether its target was
 * outside the view the user had at their step before. Only the user's own
 * input counts, not events a page dispatches.
 *
 * Names and labels are worked out as for the page tools
 * (OrbitoElementInfo.sys.mjs).
 */

import {
  fieldKind,
  offscreenAt,
  oneLine,
} from "chrome://browser/content/orbito/OrbitoShowLog.sys.mjs";
import {
  labelOf,
  nameOf,
  roleOf,
} from "chrome://browser/content/orbito/actors/OrbitoElementInfo.sys.mjs";

// The roles a click is named by: the nearest ancestor with one is the
// target.
const CLICK_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "switch",
  "tab",
  "treeitem",
]);

const MENU_ROLES = new Set(["menu", "menubar", "listbox"]);

const SECTION_ROLES = new Set(["dialog", "region", "complementary", "navigation", "main", "search"]);
const SECTION_TAGS = new Set(["section", "article", "aside", "nav", "main", "dialog", "fieldset"]);

const NOT_TEXT_INPUTS = new Set([
  "button",
  "submit",
  "reset",
  "image",
  "file",
  "checkbox",
  "radio",
  "hidden",
]);

/** Fields whose change is a choice: their value is not typed. */
function isChoice(el) {
  return (
    el.localName == "select" ||
    (el.localName == "input" && (el.type == "checkbox" || el.type == "radio"))
  );
}

/** Fields the user types (or picks) a value into. */
function isField(el) {
  return (
    el.localName == "textarea" ||
    (el.localName == "input" && !NOT_TEXT_INPUTS.has(el.type))
  );
}

function isEditableRoot(el) {
  return el.isContentEditable && !el.parentElement?.isContentEditable;
}

/** What fieldKind decides on: the field's attributes, never its value. */
function fieldOf(el) {
  return {
    tag: el.localName,
    type: el.localName == "input" ? el.type : "",
    autocomplete: el.getAttribute("autocomplete") || "",
    name: el.getAttribute("name") || "",
    id: el.id,
    wasPassword: !!el.hasBeenTypePassword,
  };
}

export class OrbitoShowChild extends JSWindowActorChild {
  // The page's scroll position at the user's step before.
  #view = null;
  // Field -> the value last reported (true for a secret one), so that a
  // field is not reported again until the user types in it again.
  #reported = new WeakMap();

  handleEvent(event) {
    let win = this.contentWindow;
    if (!event.isTrusted || !win) {
      return;
    }
    // The first event of the page, a scroll maybe, starts the view.
    this.#view ??= { x: win.scrollX, y: win.scrollY };
    let target = event.composedPath()[0];
    switch (event.type) {
      case "click":
        if (event.button == 0) {
          this._click(target);
        }
        break;
      case "change":
        this._change(target);
        break;
      case "input":
        this.#reported.delete(target);
        break;
      case "focusout":
        if (target.nodeType == target.ELEMENT_NODE && isEditableRoot(target)) {
          this._input(target);
        }
        break;
      case "submit": {
        let focused = this._focused();
        if (focused && isField(focused) && focused.form == target) {
          this._input(focused);
        }
        break;
      }
      case "keydown":
        this._keydown(event);
        break;
    }
  }

  _send(data) {
    try {
      this.sendAsyncMessage("OrbitoShow:Event", data);
    } catch {
      // The page has gone.
      return;
    }
    let win = this.contentWindow;
    if (win) {
      this.#view = { x: win.scrollX, y: win.scrollY };
    }
  }

  /** The focused element, inside shadow roots too. */
  _focused() {
    let focused = this.document?.activeElement;
    while (focused?.shadowRoot?.activeElement) {
      focused = focused.shadowRoot.activeElement;
    }
    return focused == this.document?.body ? null : focused;
  }

  /** A field's label, never its value. */
  _fieldLabel(el) {
    if (isEditableRoot(el) && el.localName != "input" && el.localName != "textarea") {
      return oneLine(labelOf(el) || el.getAttribute("aria-placeholder") || "");
    }
    return oneLine(nameOf(el) || el.getAttribute("name") || el.id || "");
  }

  /* Clicks */

  _click(hit) {
    let el = hit?.nodeType == hit?.ELEMENT_NODE ? hit : hit?.parentElement;
    if (!el) {
      return;
    }
    let target = el;
    let role = "";
    for (let node = el; node; node = node.parentNode || node.host) {
      if (node.nodeType != node.ELEMENT_NODE) {
        continue;
      }
      if (node == this.document.body) {
        break;
      }
      let found = roleOf(node);
      if (found && CLICK_ROLES.has(found)) {
        target = node;
        role = found;
        break;
      }
    }
    // Choosing in a field, or going into one, is the field's own step.
    let isFieldStep = node => {
      let control = node.closest("label")?.control;
      return (
        isChoice(node) ||
        isField(node) ||
        node.localName == "option" ||
        node.isContentEditable ||
        (control && (isChoice(control) || isField(control)))
      );
    };
    if (isFieldStep(el) || isFieldStep(target)) {
      return;
    }
    let win = this.contentWindow;
    let rect = target.getBoundingClientRect();
    this._send({
      type: "click",
      role,
      name: oneLine(role ? nameOf(target) : ""),
      text: oneLine(target.innerText),
      form: this._formName(target),
      section: this._sectionName(target),
      menu: this._menu(target),
      offscreen: offscreenAt(
        {
          top: rect.top + win.scrollY,
          left: rect.left + win.scrollX,
          width: rect.width,
          height: rect.height,
        },
        this.#view,
        { width: win.innerWidth, height: win.innerHeight }
      ),
    });
  }

  _formName(el) {
    let form = el.form || el.closest("form");
    if (!form) {
      return "";
    }
    return oneLine(
      labelOf(form) ||
        form.querySelector("legend, h1, h2, h3, h4, h5, h6")?.textContent ||
        form.getAttribute("name") ||
        ""
    );
  }

  /** The label or first heading of the nearest section it is in. */
  _sectionName(el) {
    for (let node = el.parentElement; node && node != this.document.body; node = node.parentElement) {
      let role = node.getAttribute("role");
      if (!SECTION_TAGS.has(node.localName) && !SECTION_ROLES.has(role)) {
        continue;
      }
      let name =
        labelOf(node) ||
        node.querySelector("legend, h1, h2, h3, h4, h5, h6, [role=heading]")?.textContent;
      if (name?.trim()) {
        return oneLine(name);
      }
    }
    return "";
  }

  /**
   * Whether the target is in a menu: its name, or true for one without a
   * name, or "" when it is not. A list held open by hovering its item (a
   * CSS menu) is named by that item.
   */
  _menu(el) {
    for (let node = el.parentElement; node && node != this.document.body; node = node.parentElement) {
      if (MENU_ROLES.has(node.getAttribute("role"))) {
        let trigger =
          node.id &&
          this.document.querySelector(
            `[aria-controls~="${this.contentWindow.CSS.escape(node.id)}"]`
          );
        return oneLine(labelOf(node) || (trigger ? nameOf(trigger) : "")) || true;
      }
      let item = node.parentElement;
      if (
        (node.localName == "ul" || node.localName == "ol" || node.localName == "div") &&
        item?.localName == "li" &&
        item.matches(":hover")
      ) {
        let trigger = item.querySelector(":scope > a, :scope > button, :scope > span");
        if (trigger && !trigger.contains(el)) {
          return oneLine(nameOf(trigger)) || true;
        }
      }
    }
    return "";
  }

  /* Fields */

  _change(el) {
    if (el.nodeType != el.ELEMENT_NODE) {
      return;
    }
    if (el.localName == "select") {
      let field = fieldOf(el);
      let data = { type: "select", label: this._fieldLabel(el), field };
      // A secret choice (a card's expiry month) is not read either.
      if (!fieldKind(field).secret) {
        data.options = Array.from(el.selectedOptions, o => oneLine(o.label));
      }
      this._send(data);
    } else if (isChoice(el)) {
      this._send({
        type: "check",
        label: this._fieldLabel(el),
        role: el.type,
        checked: el.checked,
      });
    } else if (isField(el) || el.localName == "input") {
      this._input(el);
    }
  }

  /** Reports a field's final value, or for a secret one only that the user typed in it. */
  _input(el) {
    let field = fieldOf(el);
    let data = { type: "input", label: this._fieldLabel(el), field };
    if (fieldKind(field).secret) {
      if (this.#reported.has(el)) {
        return;
      }
      this.#reported.set(el, true);
    } else {
      let value = el.localName == "input" || el.localName == "textarea" ? el.value : el.innerText;
      if (this.#reported.get(el) === value) {
        return;
      }
      this.#reported.set(el, value);
      data.value = value;
    }
    this._send(data);
  }

  /* Keys */

  _keydown(event) {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    let focused = this._focused();
    let label = focused ? this._fieldLabel(focused) : "";
    if (event.key == "Escape") {
      this._send({ type: "key", key: "Escape", label });
      return;
    }
    // Enter elsewhere clicks, or starts a new line.
    if (event.key != "Enter" || !focused || !isField(focused)) {
      return;
    }
    // The field's value first: a page that handles Enter itself may keep
    // the change from firing. A change that does fire reports nothing new.
    this._input(focused);
    this._send({ type: "key", key: "Enter", label });
  }
}
