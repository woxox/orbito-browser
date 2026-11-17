/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// How far in from an end the rows fade, at most, in px (scroll-edges.css).
const FADE = 24;

/**
 * A Shell list's ends, in place of the platform's scrollbar, which lies
 * over the rows' ends (the tab list's close buttons) and turns into a
 * white track under the pointer: the scrollbar is gone, and the rows fade
 * out at an end that has more to scroll to, by as much as there is (up to
 * 24px). scroll-edges.css styles the scroller (class "edges").
 *
 * The scroller selector may match several lists of which one shows (the
 * Assistant panel's views): the first match is watched, picked again on
 * every update.
 *
 * update() from the host's updated(), which also picks the scroller up
 * once rendered; disconnect() when the host goes.
 */
export class ScrollEdges {
  #host;
  #selectors;
  #scroller = null;
  #resize = new ResizeObserver(() => this.#measure());

  /**
   * @param {LitElement} host
   * @param {object} selectors In the host's render root.
   * @param {string} selectors.scroller The box that scrolls.
   * @param {string} [selectors.content] What scrolls in it, when not its
   *   children: its size changing is the list's.
   */
  constructor(host, selectors) {
    this.#host = host;
    this.#selectors = selectors;
  }

  update() {
    let root = this.#host.renderRoot;
    let scroller = root?.querySelector(this.#selectors.scroller) ?? null;
    if (scroller != this.#scroller) {
      this.disconnect();
      this.#watch(scroller);
    }
    this.#measure();
  }

  disconnect() {
    this.#resize.disconnect();
    for (let type of ["scroll", "transitionend", "animationend"]) {
      this.#scroller?.removeEventListener(type, this);
    }
    this.#scroller = null;
  }

  handleEvent() {
    this.#measure();
  }

  #watch(scroller) {
    this.#scroller = scroller;
    if (!scroller) {
      return;
    }
    scroller.addEventListener("scroll", this, { passive: true });
    // A folder or group opening or closing changes how far it scrolls
    // without an update.
    scroller.addEventListener("transitionend", this);
    scroller.addEventListener("animationend", this);
    this.#resize.observe(scroller);
    let content =
      this.#selectors.content &&
      this.#host.renderRoot.querySelector(this.#selectors.content);
    if (content) {
      this.#resize.observe(content);
    }
  }

  #measure() {
    let scroller = this.#scroller;
    if (!scroller?.isConnected) {
      return;
    }
    let { scrollTop, scrollHeight, clientHeight } = scroller;
    let room = Math.max(0, scrollHeight - clientHeight);
    let fadeStart = Math.min(Math.max(scrollTop, 0), FADE);
    let fadeEnd = Math.min(Math.max(room - scrollTop, 0), FADE);
    scroller.style.setProperty("--orbito-fade-start", `${fadeStart}px`);
    scroller.style.setProperty("--orbito-fade-end", `${fadeEnd}px`);
  }
}
