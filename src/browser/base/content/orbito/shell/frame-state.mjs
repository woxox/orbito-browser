/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  OrbitoAssistantCore:
    "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs",
});

/**
 * The window's Frame state: what its agent is doing, shown on the frame
 * (orbito.css, `:root[orbito-frame]`) and on the Top bar's Ask button, so
 * that it shows with the Assistant panel closed too.
 *
 *   frame     "record" while a demonstration is recorded, "attention" while
 *             a question asked here waits for an approval, "agent" while
 *             one is being answered, else null.
 *   activity  The Ask button's dot: "confirm" (an approval waits),
 *             "running", "decide" (a finished task's tabs wait for the user
 *             to choose what to keep), else null.
 *
 * Fires OrbitoFrameStateChange on the window when either changes. The
 * state comes from the core's questions (OrbitoAssistantCore) and this
 * window's Orbit tabs; recording is set by Show Orbito (show-orbito.mjs).
 */
export class FrameState {
  #frame = null;
  #activity = null;
  #recording = false;
  #onCoreEvent = () => this.update();

  init() {
    lazy.OrbitoAssistantCore.addListener(this.#onCoreEvent);
    // An Orbit's tabs closing, or coming back with their Orbit (Session
    // Restore), change whether a choice waits.
    gBrowser.tabContainer.addEventListener("TabClose", this);
    gBrowser.tabContainer.addEventListener("SSTabRestoring", this);
    // The core outlives the window.
    window.addEventListener("unload", this, { once: true });
    this.update();
  }

  handleEvent(event) {
    switch (event.type) {
      case "unload":
        lazy.OrbitoAssistantCore.removeListener(this.#onCoreEvent);
        gBrowser.tabContainer.removeEventListener("TabClose", this);
        gBrowser.tabContainer.removeEventListener("SSTabRestoring", this);
        break;
      default:
        this.update();
    }
  }

  get frame() {
    return this.#frame;
  }

  get activity() {
    return this.#activity;
  }

  /** Whether a demonstration is being recorded in this window. */
  get recording() {
    return this.#recording;
  }

  set recording(value) {
    this.#recording = !!value;
    this.update();
  }

  /** Reads the state again; the listeners above call it. */
  update() {
    let core = lazy.OrbitoAssistantCore;
    let questions = core.windowActivity(window);
    let deciding =
      !questions &&
      gBrowser.tabs.some(tab => {
        let orbit = !tab.closing && core.orbitOf(tab);
        return orbit && core.orbitState(orbit) == "done";
      });
    let activity =
      questions == "waiting"
        ? "confirm"
        : questions == "running"
          ? "running"
          : deciding
            ? "decide"
            : null;
    let frame = this.#recording
      ? "record"
      : questions == "waiting"
        ? "attention"
        : questions == "running"
          ? "agent"
          : null;
    if (frame == this.#frame && activity == this.#activity) {
      return;
    }
    this.#frame = frame;
    this.#activity = activity;
    if (frame) {
      document.documentElement.setAttribute("orbito-frame", frame);
    } else {
      document.documentElement.removeAttribute("orbito-frame");
    }
    window.dispatchEvent(new CustomEvent("OrbitoFrameStateChange"));
  }
}
