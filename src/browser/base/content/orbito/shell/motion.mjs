/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Shell's motion for script animations (Element.animate), which CSS
 * cannot still: the user's reduced motion, and the motion tokens
 * (tokens.css) the stylesheets use.
 */

/** Whether the user prefers reduced motion: then nothing in the Shell moves. */
export function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * How long a motion token says, in ms, as an element sees it.
 *
 * @param {Element} element
 * @param {"short"|"medium"|"long"} length --orbito-duration-<length>.
 * @returns {number}
 */
export function motionMs(element, length) {
  let value = getComputedStyle(element)
    .getPropertyValue(`--orbito-duration-${length}`)
    .trim();
  let ms = parseFloat(value);
  return value.endsWith("ms") ? ms : ms * 1000;
}

/**
 * The Shell's easing, as an element sees it: --orbito-ease, or what leaves
 * (--orbito-ease-exit).
 *
 * @param {Element} element
 * @param {"exit"} [kind]
 */
export function motionEase(element, kind) {
  let name = kind ? `--orbito-ease-${kind}` : "--orbito-ease";
  return getComputedStyle(element).getPropertyValue(name).trim() || "ease-out";
}

// Attributes a gone item's ghost leaves out: it is only seen.
const GHOST_DROPS = [
  "id",
  "role",
  "tabindex",
  "title",
  "touching",
  "hold",
  "hold-hint",
  "dragged",
];

/**
 * Moves a list's items as an update changes it (FLIP): the items that stay
 * slide from where they were to where they are, new ones come in where
 * they are, and gone ones leave from where they were, as a ghost over the
 * list. capture() before the update notes where the items are; play()
 * after it moves them, for the medium motion token.
 *
 * An update while items move moves them on from where they show. Nothing
 * moves with reduced motion, when the context (a Space) changed, or when
 * more items come and go than `most`, at once or in updates that follow
 * each other within the motion (tabs closed in a batch): then the list
 * just shows as it is, and motion still playing ends.
 */
export class ListMotion {
  #items;
  #root;
  #layer;
  #enter;
  #exit;
  #most;
  #entersOwn;
  #before = null;
  // Element -> its move still playing; and every animation playing.
  #moves = new Map();
  #playing = new Set();
  // How many items came and went in updates that followed each other
  // within the motion, and when the last came or went.
  #changes = 0;
  #changed = -Infinity;

  /**
   * @param {object} options
   * @param {() => Iterable<[any, Element]>} options.items Each item shown,
   *   by a key that stays the item's across updates (its tab), and its
   *   element.
   * @param {() => ?Element} options.root The box the list moves in: the
   *   items' places are taken in it, so that the box moving moves nothing.
   * @param {() => ?Element} options.layer An absolutely placed box the
   *   ghosts go in, out of the list's queries.
   * @param {Keyframe[]} options.enter A new item's keyframes, to its style.
   * @param {Keyframe[]} options.exit A gone item's, from its style.
   * @param {number} [options.most] How many items may come and go at once.
   * @param {(element: Element) => boolean} [options.entersOwn] Whether a
   *   new item comes in by its own animation (its stylesheet's).
   */
  constructor({ items, root, layer, enter, exit, most = 4, entersOwn }) {
    this.#items = items;
    this.#root = root;
    this.#layer = layer;
    this.#enter = enter;
    this.#exit = exit;
    this.#most = most;
    this.#entersOwn = entersOwn ?? (() => false);
  }

  #places(root) {
    let box = root.getBoundingClientRect();
    let places = new Map();
    for (let [key, element] of this.#items()) {
      let rect = element.getBoundingClientRect();
      places.set(key, {
        element,
        x: rect.left - box.left,
        y: rect.top - box.top,
        width: rect.width,
        height: rect.height,
      });
    }
    return places;
  }

  /**
   * Notes where the items are, before an update. Where one is moving, it
   * is where it shows now, so that a move goes on from there.
   *
   * @param {*} [context] What the list shows (its Space): play() moves
   *   nothing if it changed.
   */
  capture(context) {
    let root = this.#root();
    this.#before =
      root && !reducedMotion()
        ? { context, places: this.#places(root) }
        : null;
  }

  /**
   * Moves the items from where capture() saw them.
   *
   * @param {*} [context] What the list shows now.
   */
  play(context) {
    let before = this.#before;
    this.#before = null;
    let root = this.#root();
    if (!before || !root) {
      return;
    }
    let items = new Map(this.#items());
    let added = [...items.keys()].filter(key => !before.places.has(key));
    let gone = [...before.places.keys()].filter(key => !items.has(key));
    let duration = motionMs(root, "medium");
    if (added.length || gone.length) {
      let now = performance.now();
      if (now - this.#changed > duration) {
        this.#changes = 0;
      }
      this.#changes += added.length + gone.length;
      this.#changed = now;
    }
    if (
      before.context !== context ||
      this.#changes > this.#most ||
      reducedMotion()
    ) {
      this.#stop();
      return;
    }
    // Where the items go, without the moves they still play: those go on
    // from where capture() saw them.
    for (let animation of this.#moves.values()) {
      animation.cancel();
    }
    this.#moves.clear();
    let places = this.#places(root);
    let timing = { duration, easing: motionEase(root) };
    // How far each item that stays moved.
    let shifts = new Map();
    for (let [key, place] of places) {
      let old = before.places.get(key);
      if (old) {
        shifts.set(place.element, { x: old.x - place.x, y: old.y - place.y });
      }
    }
    for (let [element, shift] of shifts) {
      // An item in another that moves moves with it already.
      let parent = element.parentElement;
      while (parent && parent != root && !shifts.has(parent)) {
        parent = parent.parentElement;
      }
      let outer = shifts.get(parent) ?? { x: 0, y: 0 };
      let x = shift.x - outer.x;
      let y = shift.y - outer.y;
      if (Math.abs(x) >= 1 || Math.abs(y) >= 1) {
        let move = this.#play(
          element,
          [{ translate: `${x}px ${y}px` }, { translate: "0px" }],
          timing
        );
        this.#moves.set(element, move);
      }
    }
    for (let key of added) {
      let element = items.get(key);
      if (!this.#entersOwn(element)) {
        this.#play(element, this.#enter, { ...timing, fill: "backwards" });
      }
    }
    let layer = this.#layer();
    if (layer) {
      let box = root.getBoundingClientRect();
      let origin = layer.getBoundingClientRect();
      for (let key of gone) {
        let place = before.places.get(key);
        let ghost = this.#ghost(place.element);
        Object.assign(ghost.style, {
          position: "absolute",
          boxSizing: "border-box",
          margin: "0",
          left: `${place.x + box.left - origin.left}px`,
          top: `${place.y + box.top - origin.top}px`,
          width: `${place.width}px`,
          height: `${place.height}px`,
        });
        layer.append(ghost);
        let animation = this.#play(ghost, this.#exit, {
          ...timing,
          fill: "forwards",
        });
        animation.ghost = ghost;
      }
    }
  }

  // A copy of a gone item's element, to be seen and not used.
  #ghost(element) {
    let ghost = element.cloneNode(true);
    for (let el of [ghost, ...ghost.querySelectorAll("*")]) {
      for (let name of GHOST_DROPS) {
        el.removeAttribute(name);
      }
      for (let { name } of [...el.attributes]) {
        if (name.startsWith("aria-")) {
          el.removeAttribute(name);
        }
      }
    }
    for (let button of ghost.querySelectorAll("button")) {
      button.remove();
    }
    ghost.setAttribute("ghost", "");
    ghost.inert = true;
    return ghost;
  }

  #play(element, keyframes, timing) {
    let animation = element.animate(keyframes, timing);
    this.#playing.add(animation);
    let end = () => {
      this.#playing.delete(animation);
      if (this.#moves.get(element) == animation) {
        this.#moves.delete(element);
      }
      animation.ghost?.remove();
    };
    animation.finished.then(end, end);
    return animation;
  }

  // Ends what still plays: the items go to their places, ghosts away.
  #stop() {
    for (let animation of this.#playing) {
      animation.cancel();
      animation.ghost?.remove();
    }
    this.#playing.clear();
    this.#moves.clear();
  }
}
