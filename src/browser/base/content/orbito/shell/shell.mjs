/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Orbito Shell (ADR 0001): the window's chrome is these Lit components,
 * laid over the Firefox chrome DOM, which stays in the document and is only
 * hidden by orbito.css. The model and controllers are Firefox's own: the
 * components read gBrowser and follow its tab events.
 *
 * Loaded as a module from browser.xhtml, so it runs before DOMContentLoaded;
 * the components go in after gBrowserInit has made gBrowser.
 */

import "chrome://browser/content/orbito/shell/orbito-sidebar.mjs";
import "chrome://browser/content/orbito/shell/orbito-top-bar.mjs";
import "chrome://browser/content/orbito/shell/orbito-window-controls.mjs";
import "chrome://browser/content/orbito/shell/orbito-spaces.mjs";
import "chrome://browser/content/orbito/shell/orbito-pins.mjs";
import "chrome://browser/content/orbito/shell/orbito-dock.mjs";
import "chrome://browser/content/orbito/shell/orbito-assistant-panel.mjs";
import { OrbitoSiteInfo } from "chrome://browser/content/orbito/shell/orbito-site-info.mjs";
import { OrbitoExtensions } from "chrome://browser/content/orbito/shell/orbito-extensions.mjs";
import { OrbitoDownloads } from "chrome://browser/content/orbito/shell/orbito-downloads.mjs";
import { OrbitoSidePanelHeader } from "chrome://browser/content/orbito/shell/orbito-side-panel.mjs";
import { CommandBar } from "chrome://browser/content/orbito/shell/command-bar.mjs";
import { Spaces } from "chrome://browser/content/orbito/shell/spaces.mjs";
import { Pins } from "chrome://browser/content/orbito/shell/pins.mjs";
import { Docks } from "chrome://browser/content/orbito/shell/docks.mjs";
import { FrameState } from "chrome://browser/content/orbito/shell/frame-state.mjs";
import { ShowOrbito } from "chrome://browser/content/orbito/shell/show-orbito.mjs";
import { removeFirefoxFeatures } from "chrome://browser/content/orbito/shell/removed-features.mjs";


const { OrbitoAppearance } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/shell/OrbitoAppearance.sys.mjs"
);

// Before the first paint, so the window never shows another look.
OrbitoAppearance.init();
OrbitoAppearance.follow(document);

/**
 * Doorhangers (permission prompts, extension installs, saved passwords)
 * anchor to icons in the urlbar and toolbar, which are hidden. When Firefox
 * finds no visible anchor for one, the Top bar picks a button or the URL
 * display. PopupNotifications is a lazy getter until first used.
 *
 * @param {OrbitoTopBar} topBar
 */
function anchorDoorhangers(topBar) {
  let redirect = popupNotifications => {
    let getVisible = popupNotifications?._getVisibleAnchorElement;
    if (getVisible) {
      popupNotifications._getVisibleAnchorElement = anchor =>
        getVisible(anchor) ?? topBar.anchorFor(anchor);
    }
    return popupNotifications;
  };
  let { get, value } = Object.getOwnPropertyDescriptor(
    window,
    "PopupNotifications"
  );
  if (get) {
    ChromeUtils.defineLazyGetter(window, "PopupNotifications", () =>
      redirect(get.call(window))
    );
  } else {
    redirect(value);
  }
}

/**
 * Firefox opens its identity and permission popups (from the hidden urlbar
 * icons, or webrtcUI's sharing indicator) by these calls; they open the
 * site information panel instead.
 *
 * @param {OrbitoSiteInfo} siteInfo
 */
function openSiteInfoForFirefox(siteInfo) {
  gPermissionPanel.openPopup = event => siteInfo.open(event);
  gIdentityHandler._openPopup = event => siteInfo.open(event);
}

/**
 * Firefox opens its extensions panel (from the hidden toolbar button, the
 * app menu's command, or before an extension's popup when the extension's
 * button is in that panel) by this call; it opens the extensions panel
 * instead, except before a popup, which needs no panel.
 *
 * @param {OrbitoExtensions} extensions
 */
function openExtensionsForFirefox(extensions) {
  gUnifiedExtensions.togglePanel = async (event, reason) => {
    if (reason != "extension_browser_action_popup") {
      extensions.toggle(event);
    }
    window.dispatchEvent(new CustomEvent("UnifiedExtensionsTogglePanel"));
  };
}

/**
 * Firefox opens its downloads panel (on a new download, from the hidden
 * downloads button, from download spam protection) and animates that
 * button on a download's start and end by these calls; they open the
 * downloads panel and animate the Top bar's downloads button instead.
 * Opened without the user asking (a new download), the panel leaves focus
 * where it is.
 *
 * @param {OrbitoDownloads} downloads
 * @param {OrbitoTopBar} topBar
 */
function openDownloadsForFirefox(downloads, topBar) {
  DownloadsPanel.showPanel = (openedManually = false, isKeyPress = false) => {
    // As Firefox's, a moment later: the button shows once the Top bar has
    // heard of the new download, and a closing dialog (where to save it)
    // would close the panel again.
    setTimeout(async () => {
      await topBar.updateComplete;
      downloads.open(null, { byKeyboard: openedManually && isKeyPress });
    });
  };
  let hidePanel = DownloadsPanel.hidePanel.bind(DownloadsPanel);
  DownloadsPanel.hidePanel = () => {
    hidePanel();
    downloads.close();
  };
  DownloadsIndicatorView.showEventNotification = type => {
    if (type == "start" || type == "finish") {
      topBar.notifyDownload(type);
    }
  };
}

/**
 * Popups of toolbar buttons open at the button, or at the button the
 * toolbar or panel holding it names (the overflow button, Firefox's
 * extensions button); all of these are hidden. Extensions' popups (their
 * views are marked "extension") open under the extensions button instead,
 * others under the Top bar part that stands for their anchor (see
 * anchorPlace).
 *
 * @param {OrbitoTopBar} topBar
 */
function anchorWidgetPopups(topBar) {
  let showSubView = PanelUI.showSubView.bind(PanelUI);
  PanelUI.showSubView = (viewId, anchor, event) => {
    if (anchor && !anchor.checkVisibility()) {
      let view = PanelMultiView.getViewNode(document, viewId);
      anchor = topBar.anchorFor(
        view?.hasAttribute("extension") ? gUnifiedExtensions.button : anchor
      );
    }
    return showSubView(viewId, anchor, event);
  };
}

/**
 * The first notification bar shown in Firefox's notification strip (the
 * window's own ones, then the selected tab's), or null.
 *
 * @param {Element} strip #notifications-toolbar
 */
function shownNotification(strip) {
  return (
    [...strip.querySelectorAll("notification-message")].find(bar =>
      bar.checkVisibility()
    ) ?? null
  );
}

/**
 * Focuses the first notification bar's first button or link, else its
 * close button.
 *
 * @param {Element} strip #notifications-toolbar
 */
function focusNotification(strip) {
  let bar = shownNotification(strip);
  let target =
    [...bar.querySelectorAll(".notification-button, .notification-link")].find(
      el => el.checkVisibility()
    ) ?? bar.closeButton;
  target?.focus();
}

/**
 * Whether ⌘S (Ctrl+S elsewhere) is the key event: the Sidebar's shortcut,
 * in place of Firefox's Save Page.
 *
 * @param {KeyboardEvent} event
 */
function isSidebarShortcut(event) {
  let accel =
    AppConstants.platform == "macosx"
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
  return accel && !event.altKey && !event.shiftKey && event.code == "KeyS";
}

const OrbitoShell = {
  /** Firefox's notification bar strip, over the Shell. */
  get notifications() {
    return document.getElementById("notifications-toolbar");
  },

  init() {
    removeFirefoxFeatures(window);

    // Popups (no Sidebar) have no Spaces, Pins or Docks.
    this.spaces = null;
    this.pins = null;
    this.docks = null;
    if (window.toolbar.visible) {
      this.spaces = new Spaces();
      this.spaces.init();
      this.pins = new Pins();
      this.pins.init();
      this.docks = new Docks(this.spaces, this.pins);
      this.docks.init();
      this.spaces.addMenuItems(this.pins);
    }
    this.frameState = new FrameState();
    this.frameState.init();
    this.show = new ShowOrbito(this.frameState);
    this.show.init();

    this.sidebar = document.createElement("orbito-sidebar");
    this.sidebar.id = "orbito-sidebar";
    if (this.spaces) {
      let title = document.createElement("orbito-space-title");
      title.id = "orbito-space-title";
      title.slot = "space-title";
      let switcher = document.createElement("orbito-space-switcher");
      switcher.id = "orbito-space-switcher";
      switcher.slot = "footer";
      let pins = document.createElement("orbito-pins");
      pins.id = "orbito-pins";
      pins.slot = "pins";
      let dock = document.createElement("orbito-dock");
      dock.id = "orbito-dock";
      dock.slot = "dock";
      this.sidebar.append(pins, title, dock, switcher);
    }
    this.topBar = document.createElement("orbito-top-bar");
    this.topBar.id = "orbito-top-bar";
    // Closed until the Ask button (assistant.js) opens it.
    this.assistant = document.createElement("orbito-assistant-panel");
    this.assistant.id = "orbito-assistant";
    this.assistant.hidden = true;

    // The strip on the window's left edge the collapsed Sidebar peeks from.
    let edge = document.createElement("div");
    edge.id = "orbito-sidebar-edge";
    edge.addEventListener("mouseenter", () => this.sidebar.peek());
    edge.addEventListener("mouseleave", () => this.sidebar.endPeek());

    // Where the OS draws its own window buttons: macOS puts the traffic
    // lights over the first box with this appearance (orbito.css), at the
    // top of the Sidebar, or at the start of the Top bar while the Sidebar
    // is collapsed. Elsewhere the Shell draws them on the Top bar.
    if (AppConstants.platform == "macosx") {
      let lights = document.createElement("div");
      lights.id = "orbito-window-buttons";
      let placeLights = () => {
        if (this.sidebar.collapsed) {
          lights.slot = "start";
          this.topBar.prepend(lights);
        } else {
          lights.slot = "window-buttons";
          this.sidebar.prepend(lights);
        }
      };
      placeLights();
      this.sidebar.addEventListener("OrbitoSidebarToggle", placeLights);
    } else {
      // On the Top bar, or at the top of the Assistant panel while it is
      // open, which then takes the window's full height. In a narrow window
      // the panel floats under the Top bar (orbito.css), which keeps them.
      let controls = document.createElement("orbito-window-controls");
      controls.id = "orbito-window-controls";
      controls.slot = "window-controls";
      let narrow = window.matchMedia("(max-width: 760px)");
      let placeControls = () => {
        let full = !this.assistant.hidden && !narrow.matches;
        this.assistant.full = full;
        (full ? this.assistant : this.topBar).append(controls);
      };
      placeControls();
      window.addEventListener("OrbitoAssistantToggle", placeControls);
      narrow.addEventListener("change", placeControls);
    }
    // The Top bar offers to show the Sidebar while it is collapsed.
    let showCollapsed = () =>
      (this.topBar.sidebarCollapsed = this.sidebar.collapsed);
    showCollapsed();
    this.sidebar.addEventListener("OrbitoSidebarToggle", showCollapsed);

    let browser = document.getElementById("browser");
    browser.prepend(this.sidebar, edge, this.topBar);
    browser.append(this.assistant);
    this.commandBar = new CommandBar();
    this.commandBar.init();
    anchorDoorhangers(this.topBar);
    this.siteInfo = OrbitoSiteInfo.create();
    openSiteInfoForFirefox(this.siteInfo);
    this.extensions = OrbitoExtensions.create();
    openExtensionsForFirefox(this.extensions);
    this.downloads = OrbitoDownloads.create();
    openDownloadsForFirefox(this.downloads, this.topBar);
    anchorWidgetPopups(this.topBar);
    // Firefox's sidebar, shown as an overlay card (none in popups).
    this.sidePanel = OrbitoSidePanelHeader.create();
    // ⌘S toggles the Sidebar instead of saving the page (popups have no
    // Sidebar and keep it).
    if (window.toolbar.visible) {
      document.getElementById("key_savePage").setAttribute("disabled", "true");
    }
    window.addEventListener("keydown", this, true);
  },

  /**
   * Collapses the Sidebar or keeps it out, for every window. In
   * a narrow window, where it is always collapsed, it peeks or goes away
   * instead.
   */
  toggleSidebar() {
    if (this.sidebar.narrow) {
      if (this.sidebar.peeking) {
        this.sidebar.hidePeek();
      } else {
        this.sidebar.peek();
      }
      return;
    }
    this.sidebar.toggleCollapsed();
  },

  /**
   * ⌘S over a page goes to the page first, as Firefox's own shortcuts do:
   * the page's answer comes back, and the Sidebar toggles only when the
   * page did not use the key (a web app saving its document).
   *
   * @param {KeyboardEvent} event
   */
  onSidebarShortcut(event) {
    if (event.isReplyEventFromRemoteContent) {
      if (!event.defaultPrevented) {
        event.preventDefault();
        this.toggleSidebar();
      }
      return;
    }
    if (event.target.localName == "browser" && event.target.isRemoteBrowser) {
      event.requestReplyFromRemoteContent();
      return;
    }
    if (!event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      this.toggleSidebar();
    }
  },

  handleEvent(event) {
    if (
      event.type == "keydown" &&
      window.toolbar.visible &&
      !event.repeat &&
      isSidebarShortcut(event)
    ) {
      this.onSidebarShortcut(event);
      return;
    }
    if (
      event.type == "keydown" &&
      event.key == "F6" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.cycleRegion(event.shiftKey ? -1 : 1);
    }
  },

  /**
   * The regions F6 moves between, in order. Each can tell whether it holds
   * an element and focus itself.
   */
  get regions() {
    let regions = [
      {
        // Firefox's notification bars, in their strip over the window,
        // while one shows.
        name: "notifications",
        contains: el => this.notifications.contains(el),
        focus: () => focusNotification(this.notifications),
        shown: () => !!shownNotification(this.notifications),
      },
      {
        name: "sidebar",
        contains: el => this.sidebar.contains(el),
        focus: () => this.sidebar.focusRegion(),
        shown: () => this.sidebar.checkVisibility(),
      },
      {
        // Firefox's sidebar, as the card next to the Sidebar, while open.
        name: "side-panel",
        contains: el => this.sidePanel.box.contains(el),
        focus: () => this.sidePanel.focusRegion(),
        shown: () => this.sidePanel.box.checkVisibility(),
      },
      {
        // With the panels that open from it.
        name: "top-bar",
        contains: el =>
          this.topBar.contains(el) ||
          this.siteInfo.panel.contains(el) ||
          this.extensions.panel.contains(el) ||
          this.downloads.panel.contains(el),
        focus: () => this.topBar.focusRegion(),
        shown: () => this.topBar.checkVisibility(),
      },
      {
        // Only while open; moving on from it closes it.
        name: "command-bar",
        contains: el => gURLBar.contains(el),
        focus: () => this.commandBar.open(),
        shown: () => this.commandBar.isOpen,
      },
      {
        name: "page",
        contains: el => gBrowser.tabpanels.contains(el),
        focus: () => gBrowser.selectedBrowser.focus(),
        shown: () => true,
      },
    ];
    regions.push({
      name: "assistant",
      contains: el => this.assistant.contains(el),
      focus: () => this.assistant.focusRegion(),
      // Not while it closes.
      shown: () => !!window.OrbitoAssistant?.isOpen,
    });
    return regions.filter(region => region.shown());
  },

  /** The name of the region focus is in, or null when it is in none. */
  get focusedRegion() {
    let el = document.activeElement;
    return this.regions.find(region => region.contains(el))?.name ?? null;
  },

  /** Focuses the next region (step 1) or the previous one (step -1). */
  cycleRegion(step) {
    let regions = this.regions;
    let el = document.activeElement;
    let index = regions.findIndex(region => region.contains(el));
    if (index == -1) {
      // Outside every region (e.g. the hidden Firefox toolbar): start over.
      index = step > 0 ? -1 : 0;
    }
    regions.at((index + step) % regions.length).focus();
  },
};

window.OrbitoShell = OrbitoShell;
window.addEventListener("DOMContentLoaded", () => OrbitoShell.init(), {
  once: true,
});
