/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, nothing } from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";
import { isMenuKey } from "chrome://browser/content/orbito/shell/orbito-pins.mjs";
import { ORBITO_LOGO } from "chrome://browser/content/orbito/shell/orbito-logo.mjs";
import {
  motionMs,
  reducedMotion,
} from "chrome://browser/content/orbito/shell/motion.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
);

const ICONS = {
  sidebar: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M6 3v10" />
  </svg>`,
  back: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M10 3 5 8l5 5" />
  </svg>`,
  forward: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m6 3 5 5-5 5" />
  </svg>`,
  reload: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M13 8a5 5 0 1 1-1.46-3.54M13 2.5v3h-3" />
  </svg>`,
  stop: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
  </svg>`,
  lock: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </svg>`,
  notSecure: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 4.6-1.4M2.5 14.5l11-11" />
  </svg>`,
  info: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 7.5v3.5M8 5v.5" />
  </svg>`,
  reader: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 3.5h10M3 6.5h10M3 9.5h7M3 12.5h5" />
  </svg>`,
  puzzle: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M3 5.5h2.5V4a1.5 1.5 0 0 1 3 0v1.5H11v2.5h1a1.5 1.5 0 0 1 0 3h-1v2.5H3v-2.5h1.25a1.5 1.5 0 0 0 0-3H3z"
    />
  </svg>`,
  download: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
  </svg>`,
  mask: html`<svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M2.5 6.5c2-1.5 9-1.5 11 0-.3 3-2 4.5-3.5 4.5S8 9.5 8 9.5 7.5 11 6 11 2.8 9.5 2.5 6.5z"
    />
  </svg>`,
};

/** How far, in CSS pixels, a press on the URL display may move and stay a click. */
const CLICK_SLOP = 4;

/** How long, in ms, Back or Forward is held before the history menu opens (Firefox's). */
const HOLD_MS = 500;

/**
 * Firefox's commands the Back, Forward and Reload/Stop buttons run, and the
 * ones whose disabled state they follow: Firefox disables Back and Forward
 * with no history that way, Reload on pages with nothing to reload, and
 * enables Stop while the selected tab loads (XULBrowserWindow).
 */
const NAVIGATION = {
  back: { command: "Browser:BackOrBackDuplicate", state: "Browser:Back" },
  forward: {
    command: "Browser:ForwardOrForwardDuplicate",
    state: "Browser:Forward",
  },
  reload: { command: "Browser:ReloadOrDuplicate", state: "Browser:Reload" },
  stop: { command: "Browser:Stop", state: "Browser:Stop" },
};

/** What the Ask button's dot says (FrameState's activity). */
const ASK_STATUS = {
  running: t("orbito-top-bar-ask-status-running"),
  confirm: t("orbito-top-bar-ask-status-confirm"),
  decide: t("orbito-top-bar-ask-status-decide"),
};

/** How long, in ms, the downloads button shows a download that starts or ends. */
const DOWNLOAD_NOTIFICATION_MS = { start: 700, finish: 2150 };

/**
 * A URL for people to read: IDN hosts and escaped characters shown as
 * themselves, except those that could pass for something else.
 *
 * @param {string} spec
 */
function forDisplay(spec) {
  return Services.textToSubURI.unEscapeURIForUI(spec);
}

/**
 * The selected tab's URL, as the URL display shows it: the host in bold and
 * the rest muted. Pages that stand for "no page yet" (new tab, about:blank)
 * show nothing, and other schemes show their whole URL.
 *
 * @param {nsIURI} uri
 * @returns {{empty: boolean, host: string, rest: string}}
 */
export function urlParts(uri) {
  if (!uri || isBlankPageURL(uri.spec)) {
    return { empty: true, host: "", rest: "" };
  }
  if (uri.schemeIs("http") || uri.schemeIs("https")) {
    let rest = uri.displaySpec.slice(uri.displayPrePath.length);
    return {
      empty: false,
      host: uri.displayHostPort.replace(/^www\./, ""),
      rest: rest == "/" ? "" : forDisplay(rest),
    };
  }
  return { empty: false, host: forDisplay(uri.displaySpec), rest: "" };
}

/**
 * Which Top bar part stands for a doorhanger's or popup's anchor in the
 * hidden urlbar or toolbar: "extensions" for extension installs and
 * permissions, "site-info" for site permissions and the identity box, and
 * otherwise (saved passwords, the default anchor, anchors that are gone)
 * "url".
 *
 * @param {Element} [anchor]
 * @returns {"extensions"|"site-info"|"url"}
 */
export function anchorPlace(anchor) {
  let id = anchor?.id ?? "";
  if (
    anchor?.closest("#unified-extensions-button") ||
    id == "addons-notification-icon"
  ) {
    return "extensions";
  }
  let urlDisplayAnchors = [
    "default-notification-icon",
    "password-notification-icon",
    "notification-popup-box",
  ];
  if (
    !urlDisplayAnchors.includes(id) &&
    (anchor?.closest("#notification-popup-box") ||
      anchor?.closest("#identity-box"))
  ) {
    return "site-info";
  }
  return "url";
}

/**
 * The selected tab's requests (doorhangers) that show under a Top bar part
 * and were dismissed and are not showing: they wait, with no urlbar or
 * toolbar icon to bring them back, until the panel of that part does
 * (permission requests in the site information panel, extension requests in
 * the extensions panel). Persistent ones also come back on their own, e.g.
 * on a tab switch.
 *
 * @param {"site-info"|"extensions"} [place] See anchorPlace.
 * @returns {object[]} PopupNotifications' Notification objects.
 */
export function waitingRequests(place = "site-info") {
  let popupNotifications = window.PopupNotifications;
  let showing = popupNotifications.isPanelOpen
    ? [...popupNotifications.panel.children].map(el => el.notification)
    : [];
  return popupNotifications._currentNotifications.filter(
    n =>
      n.dismissed &&
      !n.options.neverShow &&
      !showing.includes(n) &&
      anchorPlace(n.anchorElement) == place
  );
}

/**
 * The short bar over the page: Show Sidebar (while the Sidebar is collapsed),
 * Back, Forward and Reload (Stop while the page loads), the site information
 * button (the Orbito mark on Orbito's and Firefox's own pages) and the URL
 * display, which takes the room the other parts leave, then the Private pill
 * in private windows, the reader view (on pages that have one), extensions,
 * downloads (once there are any) and Ask buttons, and on Windows and Linux
 * the window controls at the far right. Popups show only the site
 * information button and the URL display. Other buttons go in its slots:
 *
 *   start            before Back
 *   end              before the Ask button
 *   window-controls  the minimize, maximize and close buttons
 *
 * The bar is where the window is dragged from. A press on the URL display
 * that leaves the window where it was opens the Command bar instead.
 *
 * Its own controls are one tab stop; the arrow keys move between them.
 * The site information and extensions buttons open their panels and show a
 * dot while a request waits there. The downloads button shows the downloads'
 * progress and a dot for finished or failed ones not seen yet. The Ask
 * button shows a dot while the window's agent works, waits for an approval
 * or waits for the user to choose what to keep of a task's tabs, and a red
 * ring while the window's PermissionMode is "bypass".
 *
 * Back and Forward open the tab's history on a long press or right-click.
 */
export class OrbitoTopBar extends MozLitElement {
  static properties = {
    /** Whether the Sidebar is collapsed (shell.mjs), for Show Sidebar. */
    sidebarCollapsed: { type: Boolean },
  };

  static queries = {
    showSidebarButton: ".show-sidebar",
    backButton: ".back",
    forwardButton: ".forward",
    reloadButton: ".reload",
    urlDisplay: ".url",
    siteInfoButton: ".site-info",
    readerButton: ".reader",
    extensionsButton: ".extensions",
    downloadsButton: ".downloads",
    askButton: ".ask",
  };

  constructor() {
    super();
    this.sidebarCollapsed = false;
  }

  /** Where the window and the pointer were when the URL display was pressed. */
  #press = null;
  /** The control that is the bar's tab stop. */
  #current = "url";
  #readerObserver = null;
  #requestsObserver = null;
  #navigationObserver = null;
  /** The long press on Back or Forward that opens the history menu. */
  #holdTimer = 0;
  /** Whether that menu opened, so the press's click does not also go. */
  #held = false;
  /** The timer while Reload's icon turns after a click (0 when it does not). */
  #reloadSpin = 0;
  /**
   * Firefox's downloads indicator data for the window, as its view gets it:
   * whether there are downloads, their progress in percent (-1 when none
   * runs) and the attention they ask for (DownloadsCommon.ATTENTION_*).
   */
  #downloads = { hasDownloads: false, percentComplete: -1, attention: "" };
  #downloadsView = new Proxy(this.#downloads, {
    set: (downloads, name, value) => {
      downloads[name] = value;
      this.requestUpdate();
      return true;
    },
  });
  #removeDownloadsView = () => {
    window.removeEventListener("unload", this.#removeDownloadsView);
    DownloadsCommon.getIndicatorData(window).removeView(this.#downloadsView);
  };
  /** The download event the downloads button shows ("start", "finish"). */
  #downloadNotification = "";
  #downloadNotificationTimer = 0;

  connectedCallback() {
    super.connectedCallback();
    gBrowser.tabContainer.addEventListener("TabSelect", this);
    gBrowser.addProgressListener(this);
    // Windows sends no mousedown inside a window drag region, only this.
    window.addEventListener("draggableregionleftmousedown", this);
    window.addEventListener("mousedown", this, true);
    window.addEventListener("OrbitoAssistantToggle", this);
    window.addEventListener("OrbitoPermissionModeChange", this);
    window.addEventListener("OrbitoSiteInfoToggle", this);
    window.addEventListener("OrbitoExtensionsToggle", this);
    window.addEventListener("OrbitoDownloadsToggle", this);
    window.addEventListener("OrbitoFrameStateChange", this);
    DownloadsCommon.getIndicatorData(window).addView(this.#downloadsView);
    // Also when the window closes, which leaves the element connected: the
    // indicator data outlives the window.
    window.addEventListener("unload", this.#removeDownloadsView);
    this.#navigationObserver = new MutationObserver(() => this.requestUpdate());
    for (let { state } of Object.values(NAVIGATION)) {
      this.#navigationObserver.observe(document.getElementById(state), {
        attributes: true,
        attributeFilter: ["disabled"],
      });
    }
    // A request that is shown, dismissed or answered changes the waiting
    // dots; dismissing one is the doorhanger closing.
    this.#requestsObserver = new MutationObserver(() => this.requestUpdate());
    for (let id of ["notification-popup-box", "unified-extensions-button"]) {
      let anchors = document.getElementById(id);
      if (anchors) {
        this.#requestsObserver.observe(anchors, {
          attributes: true,
          subtree: true,
          attributeFilter: ["showing"],
        });
      }
    }
    let doorhanger = document.getElementById("notification-popup");
    doorhanger.addEventListener("popupshown", this);
    doorhanger.addEventListener("popuphidden", this);
    // Firefox shows its reader view button (in the hidden urlbar) when the
    // page has a reader view; this one follows it.
    let reader = document.getElementById("reader-mode-button");
    this.#readerObserver = new MutationObserver(() => this.requestUpdate());
    this.#readerObserver.observe(reader, {
      attributes: true,
      attributeFilter: ["hidden", "readeractive"],
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    gBrowser.tabContainer.removeEventListener("TabSelect", this);
    gBrowser.removeProgressListener(this);
    window.removeEventListener("draggableregionleftmousedown", this);
    window.removeEventListener("mousedown", this, true);
    window.removeEventListener("mouseup", this, true);
    window.removeEventListener("OrbitoAssistantToggle", this);
    window.removeEventListener("OrbitoPermissionModeChange", this);
    window.removeEventListener("OrbitoSiteInfoToggle", this);
    window.removeEventListener("OrbitoExtensionsToggle", this);
    window.removeEventListener("OrbitoDownloadsToggle", this);
    window.removeEventListener("OrbitoFrameStateChange", this);
    this.#removeDownloadsView();
    clearTimeout(this.#downloadNotificationTimer);
    clearTimeout(this.#holdTimer);
    clearTimeout(this.#reloadSpin);
    this.#reloadSpin = 0;
    this.#navigationObserver.disconnect();
    this.#readerObserver.disconnect();
    this.#requestsObserver.disconnect();
    let doorhanger = document.getElementById("notification-popup");
    doorhanger.removeEventListener("popupshown", this);
    doorhanger.removeEventListener("popuphidden", this);
  }

  handleEvent(event) {
    switch (event.type) {
      case "mousedown":
        // Any new press forgets an earlier one; one on the URL display is
        // remembered again by #onURLPress.
        this.#press = null;
        window.removeEventListener("mouseup", this, true);
        break;
      case "draggableregionleftmousedown":
        if (this.urlDisplay?.matches(":hover")) {
          this.#pressed(null);
        }
        break;
      case "mouseup":
        this.#released(event);
        break;
      case "popuphidden":
        // PopupNotifications marks the requests dismissed in its own
        // listener, which may run after this one.
        setTimeout(() => this.requestUpdate());
        break;
      default:
        this.requestUpdate();
    }
  }

  // Progress listener of the selected browser.
  onLocationChange(webProgress) {
    if (webProgress.isTopLevel) {
      this.requestUpdate();
    }
  }

  onSecurityChange() {
    this.requestUpdate();
  }

  QueryInterface = ChromeUtils.generateQI([
    "nsIWebProgressListener",
    "nsISupportsWeakReference",
  ]);

  /** The Top bar's own controls that show, in order. */
  get controls() {
    // A narrow window hides some (orbito-top-bar.css).
    return [...this.renderRoot.querySelectorAll("[data-control]")].filter(el =>
      el.checkVisibility()
    );
  }

  focusRegion() {
    let control =
      this.controls.find(el => el.dataset.control == this.#current) ??
      this.urlDisplay;
    control.focus({ focusVisible: true });
  }

  /**
   * The Shell element a doorhanger shows under when Firefox's anchor is in
   * the hidden urlbar or toolbar (see anchorPlace).
   *
   * @param {Element} anchor Firefox's anchor for the doorhanger, if any.
   * @returns {Element}
   */
  anchorFor(anchor) {
    let shown = el => el?.checkVisibility() && el;
    switch (anchorPlace(anchor)) {
      case "extensions":
        return shown(this.extensionsButton) || this.urlDisplay;
      case "site-info":
        return shown(this.siteInfoButton) || this.urlDisplay;
    }
    return this.urlDisplay;
  }

  /**
   * Shows on the downloads button, for a moment, that a download started
   * or finished (Firefox's downloads button animation).
   *
   * @param {"start"|"finish"} type
   */
  notifyDownload(type) {
    clearTimeout(this.#downloadNotificationTimer);
    this.#downloadNotification = type;
    this.requestUpdate();
    this.#downloadNotificationTimer = setTimeout(() => {
      this.#downloadNotification = "";
      this.requestUpdate();
    }, DOWNLOAD_NOTIFICATION_MS[type] ?? 0);
  }

  /**
   * A press on the URL display (macOS mousedown, or on Windows the drag
   * region's press, which has no pointer position).
   *
   * @param {MouseEvent} [event]
   */
  #pressed(event) {
    this.#press = {
      windowX: window.screenX,
      windowY: window.screenY,
      pointer: event && { x: event.screenX, y: event.screenY },
    };
    window.addEventListener("mouseup", this, true);
  }

  /**
   * The press ended. A click, unless the window moved (it was dragged) or
   * the pointer did (a drag that could not move the window). On Windows the
   * mouseup after a drag comes from the OS move loop and carries no
   * position, so there only the window's position decides.
   *
   * @param {MouseEvent} event
   */
  #released(event) {
    let press = this.#press;
    if (event.button != 0 || !press) {
      return;
    }
    this.#press = null;
    window.removeEventListener("mouseup", this, true);
    let stayed =
      window.screenX == press.windowX && window.screenY == press.windowY;
    let still =
      !press.pointer ||
      Math.hypot(
        event.screenX - press.pointer.x,
        event.screenY - press.pointer.y
      ) <= CLICK_SLOP;
    if (stayed && still) {
      this.#openCommandBar();
    }
  }

  #onURLPress(event) {
    if (event.button != 0) {
      return;
    }
    // Focus stays where it was, so closing the Command bar goes back there.
    event.preventDefault();
    this.#pressed(event);
  }

  #onURLKey(event) {
    if (event.key == "Enter" || event.key == " ") {
      event.preventDefault();
      this.#openCommandBar();
    }
  }

  #onURLClick(event) {
    // Mouse clicks are decided by the press and release; this is for
    // clicks without a mouse (accessibility tools).
    if (event.detail == 0) {
      this.#openCommandBar();
    }
  }

  #openCommandBar() {
    if (!gURLBar.readOnly) {
      window.OrbitoShell.commandBar.open("current");
    }
  }

  #onKeyDown(event) {
    let controls = this.controls;
    let index = controls.indexOf(event.target);
    if (index == -1 || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    let rtl = this.matches(":dir(rtl)");
    let next;
    switch (event.key) {
      case "ArrowRight":
        next = controls[index + (rtl ? -1 : 1)];
        break;
      case "ArrowLeft":
        next = controls[index + (rtl ? 1 : -1)];
        break;
      case "Home":
        next = controls[0];
        break;
      case "End":
        next = controls.at(-1);
        break;
      default:
        return;
    }
    event.preventDefault();
    next?.focus({ focusVisible: true });
  }

  /** The control focus lands on, by keyboard or pointer, is the tab stop. */
  #onFocusIn(event) {
    let name = event.target.dataset?.control;
    if (name && name != this.#current) {
      this.#current = name;
      this.requestUpdate();
    }
  }

  /**
   * Runs one of Firefox's navigation commands as its toolbar button would,
   * with the click's modifiers and button (a middle click or Ctrl/Cmd opens
   * the page in a new tab).
   *
   * @param {string} name A NAVIGATION key.
   * @param {MouseEvent|KeyboardEvent} event
   */
  #runNavigation(name, event) {
    let command = document.createEvent("xulcommandevent");
    command.initCommandEvent(
      "command",
      true,
      true,
      window,
      0,
      event.ctrlKey,
      event.altKey,
      event.shiftKey,
      event.metaKey,
      0,
      event,
      event.inputSource ?? 0
    );
    document.getElementById(NAVIGATION[name].command).dispatchEvent(command);
  }

  /** Whether Firefox has a navigation command disabled. */
  #navigationDisabled(name) {
    return document
      .getElementById(NAVIGATION[name].state)
      .hasAttribute("disabled");
  }

  #onNavigationClick(event) {
    let held = this.#held;
    this.#held = false;
    let name = event.currentTarget.dataset.navigation;
    // A press that opened the history menu is no click; keyboard and
    // accessibility clicks (detail 0) always are.
    if ((held && event.detail) || this.#navigationDisabled(name)) {
      return;
    }
    this.#runNavigation(name, event);
    if (name == "reload") {
      this.#spinReload();
    }
  }

  /**
   * Turns Reload's icon once, for twice the long motion token as
   * orbito-top-bar.css says. The page starts loading at once, so the icon
   * stays Reload's while it turns and only then shows Stop.
   */
  #spinReload() {
    if (this.#reloadSpin || reducedMotion()) {
      return;
    }
    this.#reloadSpin = setTimeout(() => {
      this.#reloadSpin = 0;
      this.requestUpdate();
    }, motionMs(this, "long") * 2);
    this.requestUpdate();
  }

  #onNavigationAuxClick(event) {
    let name = event.currentTarget.dataset.navigation;
    if (event.button == 1 && name != "stop" && !this.#navigationDisabled(name)) {
      this.#runNavigation(name, event);
    }
  }

  #onHistoryPress(event) {
    this.#held = false;
    this.#cancelHold();
    if (event.button != 0) {
      return;
    }
    let button = event.currentTarget;
    this.#holdTimer = setTimeout(() => {
      this.#held = true;
      this.openHistoryMenu(button);
    }, HOLD_MS);
  }

  #cancelHold() {
    clearTimeout(this.#holdTimer);
    this.#holdTimer = 0;
  }

  #onHistoryContextMenu(event) {
    event.preventDefault();
    this.#cancelHold();
    this.openHistoryMenu(event.currentTarget, event);
  }

  #onHistoryKey(event) {
    if (isMenuKey(event)) {
      event.preventDefault();
      this.openHistoryMenu(event.currentTarget, event);
    }
  }

  /**
   * Opens Firefox's back and forward history menu (#backForwardMenu, which
   * Firefox fills and runs: FillHistoryMenu, gotoHistoryIndex) at Back or
   * Forward, or at the pointer for a right-click. It does not open with
   * one page of history.
   *
   * @param {Element} anchor
   * @param {Event} [event]
   */
  openHistoryMenu(anchor, event = null) {
    let menu = document.getElementById("backForwardMenu");
    if (event?.type == "contextmenu" && (event.screenX || event.screenY)) {
      menu.openPopupAtScreen(event.screenX, event.screenY, true, event);
    } else {
      menu.openPopup(anchor, "after_start", 0, 0, true, false, event);
    }
  }

  #toggleSiteInfo(event) {
    window.OrbitoShell.siteInfo.toggle(event);
  }

  #toggleExtensions(event) {
    window.OrbitoShell.extensions.toggle(event);
  }

  #toggleDownloads(event) {
    window.OrbitoShell.downloads.toggle(event);
  }

  #downloadsLabel() {
    let { percentComplete, attention } = this.#downloads;
    if (percentComplete >= 0) {
      return t("orbito-top-bar-downloads-progress", {
        percent: percentComplete,
      });
    }
    switch (attention) {
      case DownloadsCommon.ATTENTION_NONE:
        return t("orbito-downloads-title");
      case DownloadsCommon.ATTENTION_SUCCESS:
        return t("orbito-top-bar-downloads-finished");
    }
    return t("orbito-top-bar-downloads-attention");
  }

  #toggleReaderView(event) {
    AboutReaderParent.toggleReaderMode(event);
  }

  #toggleAssistant() {
    window.OrbitoAssistant?.toggle();
  }

  #showSidebar() {
    window.OrbitoShell.toggleSidebar();
  }

  #tabIndex(name) {
    return name == this.#current ? 0 : -1;
  }

  /**
   * Back or Forward. Disabled ones stay focusable (aria-disabled), so that
   * focus stays put when the last page that way is reached.
   */
  #navigationButton(name, label, key) {
    return html`<button
      class=${name}
      data-control=${name}
      data-navigation=${name}
      tabindex=${this.#tabIndex(name)}
      aria-label=${label}
      aria-disabled=${this.#navigationDisabled(name)}
      title=${t("orbito-top-bar-history-tooltip", { label, key })}
      @click=${this.#onNavigationClick}
      @auxclick=${this.#onNavigationAuxClick}
      @mousedown=${this.#onHistoryPress}
      @mouseup=${this.#cancelHold}
      @mouseleave=${this.#cancelHold}
      @contextmenu=${this.#onHistoryContextMenu}
      @keydown=${this.#onHistoryKey}
    >
      ${ICONS[name]}
    </button>`;
  }

  render() {
    let uri = gBrowser.currentURI;
    let { empty, host, rest } = urlParts(uri);
    // Popups opened by sites show only where they are.
    let popup = !window.toolbar.visible;
    let reader = document.getElementById("reader-mode-button");
    let readerShown = !popup && !reader.hidden;
    let readerActive = reader.hasAttribute("readeractive");
    let { state } = gBrowser.securityUI;
    let secure = state & Ci.nsIWebProgressListener.STATE_IS_SECURE;
    // Orbito's and Firefox's own pages (the new tab page too).
    let internal = uri.schemeIs("about");
    let notSecure =
      state & Ci.nsIWebProgressListener.STATE_IS_BROKEN ||
      (uri.schemeIs("http") && !gIdentityHandler._isSecureContext) ||
      gIdentityHandler._isCertErrorPage;
    let siteInfoOpen = !!window.OrbitoShell?.siteInfo?.isOpen;
    let waiting = popup ? 0 : waitingRequests().length;
    let extensionsOpen = !!window.OrbitoShell?.extensions?.isOpen;
    let extensionsWaiting = popup ? 0 : waitingRequests("extensions").length;
    let downloads = this.#downloads;
    let downloadsShown = !popup && downloads.hasDownloads;
    let downloadsOpen = !!window.OrbitoShell?.downloads?.isOpen;
    let assistantOpen = !!window.OrbitoAssistant?.isOpen;
    let bypass = window.OrbitoAssistant?.permissionMode == "bypass";
    let mac = AppConstants.platform == "macosx";
    let isPrivate = !popup && PrivateBrowsingUtils.isWindowPrivate(window);
    let showSidebar = !popup && this.sidebarCollapsed;
    let assistantKey = mac ? "⌥⌘A" : "Ctrl+Shift+Space";
    let askStatus = window.OrbitoShell?.frameState?.activity ?? null;
    let stopShown = !this.#navigationDisabled("stop");
    let reloadName = stopShown ? "stop" : "reload";
    if (
      (this.#current == "reader" && !readerShown) ||
      (this.#current == "downloads" && !downloadsShown) ||
      (this.#current == "show-sidebar" && !showSidebar) ||
      (popup && !["url", "site-info"].includes(this.#current))
    ) {
      this.#current = "url";
    }
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/orbito/shell/orbito-top-bar.css"
      />
      <slot name="start"></slot>
      ${popup
        ? nothing
        : html`<div
            class="navigation"
            @keydown=${this.#onKeyDown}
            @focusin=${this.#onFocusIn}
          >
            ${showSidebar
              ? html`<button
                  class="show-sidebar"
                  orbito-sidebar-toggle
                  data-control="show-sidebar"
                  tabindex=${this.#tabIndex("show-sidebar")}
                  aria-label=${t("orbito-top-bar-show-sidebar")}
                  title=${t("orbito-top-bar-with-key", {
                    label: t("orbito-top-bar-show-sidebar"),
                    key: mac ? "⌘S" : "Ctrl+S",
                  })}
                  @click=${this.#showSidebar}
                >
                  ${ICONS.sidebar}
                </button>`
              : nothing}
            ${this.#navigationButton(
              "back",
              t("orbito-top-bar-back"),
              mac ? "⌘[" : "Alt+Left"
            )}
            ${this.#navigationButton(
              "forward",
              t("orbito-top-bar-forward"),
              mac ? "⌘]" : "Alt+Right"
            )}
            <button
              class="reload"
              data-control="reload"
              data-navigation=${reloadName}
              tabindex=${this.#tabIndex("reload")}
              aria-label=${stopShown
                ? t("orbito-top-bar-stop")
                : t("orbito-top-bar-reload")}
              aria-disabled=${this.#navigationDisabled(reloadName)}
              title=${stopShown
                ? t("orbito-top-bar-with-key", {
                    label: t("orbito-top-bar-stop"),
                    key: "Esc",
                  })
                : t("orbito-top-bar-with-key", {
                    label: t("orbito-top-bar-reload"),
                    key: mac ? "⌘R" : "Ctrl+R",
                  })}
              ?stop=${stopShown}
              ?spin=${!!this.#reloadSpin}
              @click=${this.#onNavigationClick}
              @auxclick=${this.#onNavigationAuxClick}
            >
              ${stopShown && !this.#reloadSpin ? ICONS.stop : ICONS.reload}
            </button>
          </div>`}
      <div
        class="ident"
        ?popup=${popup}
        @keydown=${this.#onKeyDown}
        @focusin=${this.#onFocusIn}
      >
        <button
          class="site-info"
          data-control="site-info"
          tabindex=${this.#tabIndex("site-info")}
          aria-label=${waiting
            ? t("orbito-top-bar-site-info-waiting", { count: waiting })
            : t("orbito-top-bar-site-info")}
          aria-haspopup="dialog"
          aria-expanded=${siteInfoOpen}
          title=${t("orbito-top-bar-site-info")}
          ?waiting=${waiting > 0}
          @click=${this.#toggleSiteInfo}
        >
          ${internal
            ? html`<span class="orbito-mark">${ORBITO_LOGO}</span>`
            : secure
              ? ICONS.lock
              : notSecure
                ? ICONS.notSecure
                : ICONS.info}
        </button>
        <div
          class="url"
          data-control="url"
          role="textbox"
          aria-readonly="true"
          aria-label=${t("orbito-top-bar-address")}
          tabindex=${this.#tabIndex("url")}
          title=${empty ? "" : forDisplay(uri.displaySpec)}
          @mousedown=${this.#onURLPress}
          @keydown=${this.#onURLKey}
          @click=${this.#onURLClick}
        >
          ${empty
            ? html`<span class="placeholder"
                >${t("orbito-top-bar-address-placeholder")}</span
              >`
            : html`<span class="host">${host}</span
                ><span class="rest">${rest}</span>`}
        </div>
      </div>
      ${isPrivate
        ? html`<span class="private"
            >${ICONS.mask}${t("orbito-top-bar-private")}</span
          >`
        : nothing}
      ${popup
        ? nothing
        : html`<div
            class="actions"
            @keydown=${this.#onKeyDown}
            @focusin=${this.#onFocusIn}
          >
            ${readerShown
              ? html`<button
                  class="reader"
                  data-control="reader"
                  tabindex=${this.#tabIndex("reader")}
                  aria-label=${t("orbito-top-bar-reader-view")}
                  aria-pressed=${readerActive}
                  title=${readerActive
                    ? t("orbito-top-bar-close-reader-view")
                    : t("orbito-top-bar-reader-view")}
                  @click=${this.#toggleReaderView}
                >
                  ${ICONS.reader}
                </button>`
              : nothing}
            <button
              class="extensions"
              data-control="extensions"
              tabindex=${this.#tabIndex("extensions")}
              aria-label=${extensionsWaiting
                ? t("orbito-top-bar-extensions-waiting", {
                    count: extensionsWaiting,
                  })
                : t("orbito-top-bar-extensions")}
              aria-haspopup="dialog"
              aria-expanded=${extensionsOpen}
              title=${t("orbito-top-bar-extensions")}
              ?waiting=${extensionsWaiting > 0}
              @click=${this.#toggleExtensions}
            >
              ${ICONS.puzzle}
            </button>
            ${downloadsShown
              ? html`<button
                  class="downloads"
                  data-control="downloads"
                  tabindex=${this.#tabIndex("downloads")}
                  aria-label=${this.#downloadsLabel()}
                  aria-haspopup="dialog"
                  aria-expanded=${downloadsOpen}
                  title=${t("orbito-downloads-title")}
                  attention=${downloads.attention || nothing}
                  notification=${this.#downloadNotification || nothing}
                  ?running=${downloads.percentComplete >= 0}
                  style=${`--progress: ${Math.max(downloads.percentComplete, 0)}%`}
                  @click=${this.#toggleDownloads}
                >
                  ${ICONS.download}<span class="progress"></span>
                </button>`
              : nothing}
            <slot name="end"></slot>
            <button
              class="ask"
              data-control="ask"
              tabindex=${this.#tabIndex("ask")}
              aria-pressed=${assistantOpen}
              aria-label=${askStatus
                ? t("orbito-top-bar-ask-label", {
                    status: ASK_STATUS[askStatus],
                  })
                : nothing}
              title=${t("orbito-top-bar-with-key", {
                label: t("orbito-top-bar-assistant-panel"),
                key: assistantKey,
              })}
              status=${askStatus ?? nothing}
              ?bypass=${bypass}
              @click=${this.#toggleAssistant}
            >
              ${ORBITO_LOGO}<span class="label"
                >${t("orbito-top-bar-ask")}</span
              ><span class="dot"></span>
            </button>
          </div>`}
      <slot name="window-controls"></slot>
    `;
  }
}
customElements.define("orbito-top-bar", OrbitoTopBar);
