/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, nothing } from "chrome://global/content/vendor/lit.all.mjs";
import { OrbitoTopBarPanel } from "chrome://browser/content/orbito/shell/top-bar-panel.mjs";
import { waitingRequests } from "chrome://browser/content/orbito/shell/orbito-top-bar.mjs";

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

/**
 * What the panel says about the connection, by gIdentityHandler's connection
 * security mode, and the color of the dot before it.
 */
const SECURITY = {
  secure: [t("orbito-site-info-secure"), "ok"],
  "secure-ev": [t("orbito-site-info-secure"), "ok"],
  "secure-etsi": [t("orbito-site-info-secure"), "ok"],
  "secure-cert-user-overridden": [t("orbito-site-info-cert-overridden"), "warn"],
  "not-secure": [t("orbito-site-info-not-secure"), "bad"],
  "cert-error-page": [t("orbito-site-info-cert-error"), "bad"],
  "https-only-error-page": [t("orbito-site-info-https-only-error"), "bad"],
  "net-error-page": [t("orbito-site-info-net-error"), "muted"],
  associated: [t("orbito-site-info-associated"), "muted"],
  chrome: [t("orbito-site-info-chrome"), "muted"],
  extension: [t("orbito-site-info-extension"), "muted"],
  file: [t("orbito-site-info-file"), "muted"],
  local: [t("orbito-site-info-local"), "muted"],
};

/** Firefox's tracking protection settings (browser.contentblocking.category). */
const TRACKING_CATEGORIES = {
  standard: t("orbito-site-info-tracking-standard"),
  strict: t("orbito-site-info-tracking-strict"),
  custom: t("orbito-site-info-tracking-custom"),
};

/**
 * How many sites' trackers (cookies, fingerprinters, cryptominers...) the
 * selected page had blocked, as Firefox's protections panel lists them.
 */
function blockedTrackers() {
  let log = JSON.parse(gBrowser.selectedBrowser.getContentBlockingLog());
  let blockers = Object.values(gProtectionsHandler.blockers);
  return Object.values(log).filter(actions =>
    actions.some(([state]) => blockers.some(b => b.isBlocking(state)))
  ).length;
}

/** The permissions the panel always lists; others show once they are set. */
const ALWAYS_LISTED = ["camera", "microphone", "geo", "desktop-notification"];

const PERMISSION_NAMES = {
  camera: t("orbito-site-info-permission-camera"),
  microphone: t("orbito-site-info-permission-microphone"),
  geo: t("orbito-site-info-permission-geo"),
  "desktop-notification": t("orbito-site-info-permission-desktop-notification"),
  screen: t("orbito-site-info-permission-screen"),
  speaker: t("orbito-site-info-permission-speaker"),
  popup: t("orbito-site-info-permission-popup"),
  "autoplay-media": t("orbito-site-info-permission-autoplay-media"),
  cookie: t("orbito-site-info-permission-cookie"),
  install: t("orbito-site-info-permission-install"),
  "persistent-storage": t("orbito-site-info-permission-persistent-storage"),
  "persist-data-on-shutdown": t("orbito-site-info-permission-persist-data-on-shutdown"),
  xr: t("orbito-site-info-permission-xr"),
  midi: t("orbito-site-info-permission-midi"),
  "midi-sysex": t("orbito-site-info-permission-midi-sysex"),
  serial: t("orbito-site-info-permission-serial"),
  shortcuts: t("orbito-site-info-permission-shortcuts"),
  canvas: t("orbito-site-info-permission-canvas"),
  "focus-tab-by-prompt": t("orbito-site-info-permission-focus-tab-by-prompt"),
  "local-network": t("orbito-site-info-permission-local-network"),
  "loopback-network": t("orbito-site-info-permission-loopback-network"),
};

/** Firefox's anchor icon for a permission request, as a name. */
const REQUEST_NAMES = {
  "geo-notification-icon": t("orbito-site-info-permission-geo"),
  "web-notifications-notification-icon": t("orbito-site-info-permission-desktop-notification"),
  "webRTC-shareDevices-notification-icon": t("orbito-site-info-request-camera-microphone"),
  "webRTC-shareMicrophone-notification-icon": t("orbito-site-info-permission-microphone"),
  "webRTC-shareScreen-notification-icon": t("orbito-site-info-permission-screen"),
  "webRTC-shareSpeaker-notification-icon": t("orbito-site-info-permission-speaker"),
  "persistent-storage-notification-icon": t("orbito-site-info-permission-persistent-storage"),
  "xr-notification-icon": t("orbito-site-info-permission-xr"),
  "midi-notification-icon": t("orbito-site-info-permission-midi"),
  "serial-notification-icon": t("orbito-site-info-permission-serial"),
  "storage-access-notification-icon": t("orbito-site-info-request-storage-access"),
  "local-network-notification-icon": t("orbito-site-info-permission-local-network"),
  "loopback-network-notification-icon": t("orbito-site-info-permission-loopback-network"),
};

/**
 * A permission state as the panel shows it.
 *
 * @param {string} id The permission's id.
 * @param {number} state A SitePermissions state.
 */
function stateLabel(id, state) {
  switch (state) {
    case SitePermissions.ALLOW:
      return t("orbito-site-info-state-allow");
    case SitePermissions.BLOCK:
      return id == "autoplay-media"
        ? t("orbito-site-info-state-block-audio")
        : t("orbito-site-info-state-block");
    case SitePermissions.AUTOPLAY_BLOCKED_ALL:
      return t("orbito-site-info-state-block-all");
    case SitePermissions.ALLOW_COOKIES_FOR_SESSION:
      return t("orbito-site-info-state-allow-session");
  }
  return t("orbito-site-info-state-ask");
}

/** "allow", "block" or "ask", for the state's color. */
function stateKind(state) {
  switch (state) {
    case SitePermissions.ALLOW:
    case SitePermissions.ALLOW_COOKIES_FOR_SESSION:
      return "allow";
    case SitePermissions.BLOCK:
    case SitePermissions.AUTOPLAY_BLOCKED_ALL:
      return "block";
  }
  return "ask";
}

/**
 * The site information panel the Top bar's site information button opens:
 * the connection's security, the permission requests waiting for an answer,
 * the site's permissions (each row steps through its states), tracking
 * protection and clearing the site's data. It is rebuilt over Firefox's
 * models (ADR 0001): gIdentityHandler for the connection, SitePermissions
 * for the permissions, PopupNotifications for the requests. Firefox's own
 * identity, permission and protections popups stay in the DOM, unused.
 *
 * It opens under the site information button, where the site's doorhangers
 * show too (see OrbitoTopBarPanel for the panel and its keys).
 */
export class OrbitoSiteInfo extends OrbitoTopBarPanel {
  static panelId = "orbito-site-info-panel";
  static label = t("orbito-site-info-title");
  static toggleEvent = "OrbitoSiteInfoToggle";

  static queries = {
    permissionRows: { all: ".permission" },
    requestRows: { all: ".request" },
    status: ".status",
  };

  /** A permission changed since the panel opened: the page needs a reload. */
  #changed = false;

  get button() {
    return window.OrbitoShell.topBar.siteInfoButton;
  }

  willOpen() {
    this.#changed = false;
  }

  panelShown() {
    Services.obs.addObserver(this.#onPermissionChanged, "perm-changed");
  }

  panelHidden() {
    Services.obs.removeObserver(this.#onPermissionChanged, "perm-changed");
  }

  #onPermissionChanged = () => this.requestUpdate();

  /**
   * The permissions to list for the selected tab's site, as
   * [{id, name, state, temporary}], or null when the page can have none.
   */
  #permissions() {
    let browser = gBrowser.selectedBrowser;
    let principal = gBrowser.contentPrincipal;
    if (!SitePermissions.isSupportedPrincipal(principal)) {
      return null;
    }
    let ids = new Set(ALWAYS_LISTED);
    for (let { id } of SitePermissions.getAllForBrowser(browser)) {
      // Keyed permissions (one per scheme or third party) and storage
      // access are left to Firefox's page info.
      if (!id.includes(SitePermissions.PERM_KEY_DELIMITER) && id != "storage-access") {
        ids.add(id);
      }
    }
    return [...ids].map(id => {
      let { state, scope } = SitePermissions.getForPrincipal(
        principal,
        id,
        browser
      );
      return {
        id,
        name:
          PERMISSION_NAMES[id] ?? SitePermissions.getPermissionLabel(id) ?? id,
        state,
        temporary: scope == SitePermissions.SCOPE_TEMPORARY,
      };
    });
  }

  /**
   * Steps a permission to its next state and stores it for the site, in
   * place of any answer given to a prompt for this tab only.
   *
   * @param {string} id
   */
  #step(id) {
    let browser = gBrowser.selectedBrowser;
    let principal = gBrowser.contentPrincipal;
    let { state } = SitePermissions.getForPrincipal(principal, id, browser);
    let states = SitePermissions.getAvailableStates(id);
    let next = states[(Math.max(states.indexOf(state), 0) + 1) % states.length];
    SitePermissions.removeFromPrincipal(principal, id, browser);
    // The default state (Ask) is no stored permission.
    SitePermissions.setForPrincipal(principal, id, next);
    browser.dispatchEvent(new CustomEvent("PermissionStateChange"));
    this.#changed = true;
    this.requestUpdate();
  }

  #reload() {
    this.close();
    BrowserCommands.reload();
  }

  /** Shows a waiting request's doorhanger again, under the button. */
  #reshow(notification) {
    this.closeThen(() => notification.reshow());
  }

  #toggleTrackingProtection(enabled) {
    let browser = gBrowser.selectedBrowser;
    if (enabled) {
      ContentBlockingAllowList.add(browser);
    } else {
      ContentBlockingAllowList.remove(browser);
    }
    this.#reload();
  }

  #clearSiteData() {
    let host = gIdentityHandler._uri.host;
    this.close();
    let baseDomain = SiteDataManager.getBaseDomainFromHost(host);
    if (SiteDataManager.promptSiteDataRemoval(window, [baseDomain])) {
      SiteDataManager.remove(baseDomain);
    }
  }

  #connectionDetails() {
    this.close();
    displaySecurityInfo();
  }

  #removeCertException() {
    this.close();
    gIdentityHandler.removeCertException();
  }

  #requestText(notification) {
    return (
      REQUEST_NAMES[notification.anchorID] ??
      Object.values(
        window.PopupNotifications._formatDescriptionMessage(notification)
      ).join("")
    );
  }

  render() {
    let uri = gBrowser.currentURI;
    let blank = isBlankPageURL(uri.spec);
    let mode = gIdentityHandler.getConnectionSecurityInformation();
    // Firefox's "file" mode also stands for internal pages and this
    // computer (localhost), which are trusted without a certificate.
    if (mode == "file" && !uri.schemeIs("file")) {
      mode = uri.schemeIs("about") || uri.schemeIs("chrome") ? "chrome" : "local";
    }
    let [status, tone] = (!blank && SECURITY[mode]) || SECURITY.chrome;
    if (mode == "not-secure" && uri.schemeIs("https")) {
      status = t("orbito-site-info-mixed-content");
    }
    let web = uri.schemeIs("http") || uri.schemeIs("https");
    let browser = gBrowser.selectedBrowser;
    let requests = waitingRequests();
    let permissions = blank ? null : this.#permissions();
    let trackingShown = web && ContentBlockingAllowList.canHandle(browser);
    let trackingOn = trackingShown && !ContentBlockingAllowList.includes(browser);
    let trackingStatus = t("orbito-site-info-tracking-off");
    if (trackingOn) {
      let category = Services.prefs.getStringPref(
        "browser.contentblocking.category",
        "standard"
      );
      let blocked = blockedTrackers();
      trackingStatus = t("orbito-site-info-tracking-blocked", {
        category: TRACKING_CATEGORIES[category] ?? TRACKING_CATEGORIES.custom,
        count: blocked,
      });
    }
    let secureConnection =
      gIdentityHandler._isSecureConnection || gIdentityHandler._isBrokenConnection;
    // The connection's details (Page Info) for a web page, secure or not;
    // not for this computer.
    let details = secureConnection || mode == "not-secure";
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/orbito/shell/top-bar-panel.css"
      />
      <link
        rel="stylesheet"
        href="chrome://browser/content/orbito/shell/orbito-site-info.css"
      />
      <div class="body" @keydown=${this.onKeyDown}>
        <div class="head">
          <div class="title">
            ${blank
              ? t("orbito-site-info-new-tab")
              : gIdentityHandler.getHostForDisplay()}
          </div>
          <div class="status" data-security=${blank ? "chrome" : mode}>
            ${blank || mode == "chrome"
              ? nothing
              : html`<span class="dot" data-tone=${tone}></span>`}${status}
          </div>
        </div>
        ${requests.length
          ? html`<div class="section">${t("orbito-site-info-waiting")}</div>
              ${requests.map(
                n => html`<button
                  class="item request"
                  data-item
                  @click=${() => this.#reshow(n)}
                >
                  <span class="grow">${this.#requestText(n)}</span>
                  <span class="mini">${t("orbito-site-info-answer")}</span>
                </button>`
              )}`
          : nothing}
        ${permissions
          ? html`<div class="section">${t("orbito-site-info-permissions")}</div>
              ${permissions.map(
                p => html`<button
                  class="item permission"
                  data-item
                  data-permission=${p.id}
                  aria-label=${t(
                    p.temporary
                      ? "orbito-site-info-permission-label-temporary"
                      : "orbito-site-info-permission-label",
                    { name: p.name, state: stateLabel(p.id, p.state) }
                  )}
                  title=${t("orbito-site-info-change")}
                  @click=${() => this.#step(p.id)}
                >
                  <span class="grow"
                    >${p.name}${p.temporary
                      ? html`<span class="sub"
                          >${t("orbito-site-info-temporary")}</span
                        >`
                      : nothing}</span
                  >
                  <span class="state" data-kind=${stateKind(p.state)}
                    >${stateLabel(p.id, p.state)}</span
                  >
                </button>`
              )}
              ${this.#changed
                ? html`<button
                    class="item reload"
                    data-item
                    @click=${this.#reload}
                  >
                    <span class="grow"
                      >${t("orbito-site-info-reload")}<span class="sub"
                        >${t("orbito-site-info-reload-needed")}</span
                      ></span
                    >
                  </button>`
                : nothing}`
          : nothing}
        ${web || secureConnection
          ? html`<div class="sep"></div>
              ${details
                ? html`<button
                    class="item details"
                    data-item
                    @click=${this.#connectionDetails}
                  >
                    ${t("orbito-site-info-connection-details")}
                  </button>`
                : nothing}
              ${gIdentityHandler._isCertUserOverridden
                ? html`<button
                    class="item remove-exception"
                    data-item
                    @click=${this.#removeCertException}
                  >
                    ${t("orbito-site-info-remove-exception")}
                  </button>`
                : nothing}
              ${trackingShown
                ? html`<button
                    class="item tracking"
                    data-item
                    role="switch"
                    aria-checked=${trackingOn}
                    @click=${() => this.#toggleTrackingProtection(trackingOn)}
                  >
                    <span class="grow"
                      >${t("orbito-site-info-tracking-protection")}<span
                        class="sub"
                        >${trackingStatus}</span
                      ></span
                    >
                  </button>`
                : nothing}
              ${web && gIdentityHandler._uriHasHost
                ? html`<button
                    class="item clear-data"
                    data-item
                    @click=${this.#clearSiteData}
                  >
                    ${t("orbito-site-info-clear-data")}
                  </button>`
                : nothing}`
          : nothing}
      </div>
    `;
  }
}
customElements.define("orbito-site-info", OrbitoSiteInfo);
