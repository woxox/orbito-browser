/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What an element of a web page is, as the content actors name it: its
 * role, label and accessible name, roughly as the accessibility tree
 * computes them, and the text inside it, through shadow roots. The page
 * tools (OrbitoPageChild) and Show Orbito (OrbitoShowChild) share these.
 */

// Left out with their contents. Frames are out of scope.
export const SKIPPED = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "frame",
  "object",
  "embed",
  "svg",
  "math",
]);

const INPUT_ROLES = {
  button: "button",
  submit: "button",
  reset: "button",
  image: "button",
  file: "button",
  checkbox: "checkbox",
  radio: "radio",
  range: "slider",
  number: "spinbutton",
  search: "searchbox",
};

/** The nodes rendered as an element's children, through shadow roots. */
export function renderedChildren(node) {
  if (node.shadowRoot) {
    return node.shadowRoot.childNodes;
  }
  if (node.localName == "slot") {
    let assigned = node.assignedNodes({ flatten: true });
    if (assigned.length) {
      return assigned;
    }
  }
  return node.childNodes;
}

/** The element's role, explicit or implied by its tag; null for none. */
export function roleOf(el) {
  let explicit = el.getAttribute("role")?.trim().split(/\s+/)[0];
  if (explicit && explicit != "presentation" && explicit != "none") {
    return explicit;
  }
  switch (el.localName) {
    case "a":
      return el.hasAttribute("href") ? "link" : null;
    case "button":
    case "summary":
      return "button";
    case "input":
      return INPUT_ROLES[el.type] || "textbox";
    case "textarea":
      return "textbox";
    case "select":
      return el.multiple || el.size > 1 ? "listbox" : "combobox";
  }
  if (el.isContentEditable && !el.parentElement?.isContentEditable) {
    return "textbox";
  }
  if (
    el.hasAttribute("onclick") ||
    (el.hasAttribute("tabindex") && el.tabIndex >= 0)
  ) {
    return "button";
  }
  return null;
}

/** The element's label from aria-labelledby, aria-label or <label>. */
export function labelOf(el) {
  let doc = el.ownerDocument;
  let labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    let text = labelledBy
      .split(/\s+/)
      .map(id => (el.getRootNode().getElementById?.(id) || doc.getElementById(id))?.textContent || "")
      .join(" ")
      .trim();
    if (text) {
      return text;
    }
  }
  let label = el.getAttribute("aria-label")?.trim();
  if (label) {
    return label;
  }
  if (el.labels?.length) {
    return Array.from(el.labels, l => textOf(l, el)).join(" ").trim();
  }
  return "";
}

/** The text inside an element, leaving out the control it labels. */
export function textOf(root, skip) {
  let text = "";
  let walk = node => {
    for (let child of renderedChildren(node)) {
      if (child == skip) {
        continue;
      }
      if (child.nodeType == child.TEXT_NODE) {
        text += child.data;
      } else if (
        child.nodeType == child.ELEMENT_NODE &&
        !SKIPPED.has(child.localName)
      ) {
        if (child.localName == "img") {
          text += " " + (child.getAttribute("alt") || "") + " ";
        } else {
          walk(child);
          text += " ";
        }
      }
    }
  };
  walk(root);
  return text.replace(/\s+/g, " ").trim();
}

/** The accessible name, roughly as the accessibility tree computes it. */
export function nameOf(el) {
  let label = labelOf(el);
  if (label) {
    return label;
  }
  let tag = el.localName;
  if (tag == "input" && ["button", "submit", "reset"].includes(el.type)) {
    return el.value || (el.type == "submit" ? "Submit" : "");
  }
  if (tag == "input" && el.type == "image") {
    return el.alt || el.value || "";
  }
  if (tag == "input" || tag == "textarea" || tag == "select") {
    return el.getAttribute("placeholder") || el.title || "";
  }
  return textOf(el) || el.title || "";
}
