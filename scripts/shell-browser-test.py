#!/usr/bin/env python3
"""Checks the Orbito Shell in a built Orbito, driven over Marionette.

Serves a few test pages from a local HTTP server and runs each test as
chrome JS in the app: drive the Shell (the Sidebar's tab list, the Top bar,
the keyboard) and check that it agrees with Firefox's own model (gBrowser).
Run it with mach's Python, which has the Marionette client:

    cd engine && ./mach python ../scripts/shell-browser-test.py [--repeat N] [test ...]

Names pick tests (in the suite's order); --repeat runs the picked tests N
times over in the same browser, to catch flaky ones.

ORBITO_BIN overrides the app binary (default: the artifact build).
"""

import base64
import json
import os
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from marionette_driver.keys import Keys
from marionette_driver.marionette import Marionette

ROOT = Path(__file__).resolve().parent.parent
ACCEL = Keys.META if sys.platform == "darwin" else Keys.CONTROL
BIN = os.environ.get(
    "ORBITO_BIN",
    str(ROOT / "engine/obj-artifact/dist/Orbito.app/Contents/MacOS/orbito"),
)

# Helpers available to every test script. arguments[0] is the pages' URL.
PRELUDE = r"""
const PAGES = arguments[0];
const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
);
const { setTimeout } = ChromeUtils.importESModule(
  "resource://gre/modules/Timer.sys.mjs"
);
// The first normal window; tests that open others close them again.
const win = [...Services.wm.getEnumerator("navigator:browser")].find(
  w => !w.closed && !PrivateBrowsingUtils.isWindowPrivate(w)
);
const doc = win.document;
const shell = win.OrbitoShell;
function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// A motion token (tokens.css: --orbito-duration-<length>) in ms, and as
// the computed style writes a duration, times a factor.
function motionMs(length) {
  return parseFloat(win.getComputedStyle(doc.documentElement).getPropertyValue(`--orbito-duration-${length}`));
}
function motionSeconds(length, times = 1) {
  return `${(motionMs(length) * times) / 1000}s`;
}
const { OrbitoAppearance, THEME_PREF, ACCENT_PREF, FIREFOX_SCHEME_PREFS } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/shell/OrbitoAppearance.sys.mjs"
);
async function wait(fn, what, ms = 30000) {
  let end = Date.now() + ms;
  while (true) {
    let value = await fn();
    if (value) {
      return value;
    }
    if (Date.now() > end) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await sleep(50);
  }
}
function pageURL(title) {
  return `${PAGES}/page/${encodeURIComponent(title)}`;
}
async function openPage(title, w = win) {
  let tab = w.gBrowser.addTab(pageURL(title), {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  w.gBrowser.selectedTab = tab;
  try {
    await wait(() => tab.linkedBrowser.contentTitle == title, `page ${title}`);
  } catch (e) {
    // Says where the load stopped, for a timeout that does not come back.
    let browser = tab.linkedBrowser;
    throw new Error(`${e.message}: ${JSON.stringify({
      open: w.gBrowser.tabs.includes(tab), selected: tab.selected, hidden: tab.hidden,
      uri: browser?.currentURI?.spec, title: browser?.contentTitle,
      loading: browser?.webProgress?.isLoadingDocument, remoteType: browser?.remoteType,
      pending: tab.hasAttribute("pending"), crashed: tab.hasAttribute("crashed"),
    })}`);
  }
  return tab;
}
// Closes every tab but a blank one, so each test starts from the same list.
async function onlyBlankTab(w = win) {
  let blank = w.gBrowser.addTab("about:blank", {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  w.gBrowser.selectedTab = blank;
  w.gBrowser.removeAllTabsBut(blank, { animate: false });
  await wait(() => w.gBrowser.tabs.length == 1, "the other tabs to close");
}
function tabList(w = win) {
  return w.OrbitoShell.sidebar.tabList;
}
// The rows of the Sidebar's tab list once it has caught up and its rows
// stand still.
async function rows(w = win) {
  let list = tabList(w);
  await list.updateComplete;
  await stillIn(list);
  return [...list.rows];
}
// Waits for the items of a Shell list (the tab list, the Pin grid, the
// Dock) to end their moves (ListMotion's), so that they are where they
// show.
async function stillIn(element) {
  let moving = [...element.renderRoot.querySelectorAll("*")]
    .flatMap(el => el.getAnimations())
    .filter(a => !a.animationName && !a.transitionProperty);
  await Promise.all(moving.map(a => a.finished.catch(() => {})));
}
function rowTitles(list) {
  return list.map(row => row.querySelector(".label").textContent).join(" | ");
}
// The tabs the Sidebar should list: gBrowser's tabs that are not hidden,
// nor in a collapsed group unless selected, nor pinned (the Pin grid's),
// nor Dock tabs (the Dock's).
function shownTabs(w = win) {
  return w.gBrowser.tabs.filter(t => t.visible && !t.pinned && !w.OrbitoShell.docks?.dockOf(t));
}
async function listMatchesGBrowser(w = win) {
  let list = await rows(w);
  let tabs = shownTabs(w);
  let titles = tabs.map(t => t.label).join(" | ");
  check(
    list.length == tabs.length && list.every((row, i) => row.tab == tabs[i]),
    `The list shows ${rowTitles(list)}, gBrowser has ${titles}`
  );
  check(rowTitles(list) == titles, `${rowTitles(list)} != ${titles}`);
  let selected = list.filter(row => row.getAttribute("aria-selected") == "true");
  check(
    !tabs.includes(w.gBrowser.selectedTab)
      ? !selected.length
      : selected.length == 1 && selected[0].tab == w.gBrowser.selectedTab,
    `selected rows: ${rowTitles(selected)}`
  );
}
async function urlShown(w = win) {
  let topBar = w.OrbitoShell.topBar;
  await topBar.updateComplete;
  return topBar.urlDisplay.textContent.replace(/\s+/g, " ").trim();
}
// The element focus is on, through shadow roots.
function deepActive(w = win) {
  let el = w.document.activeElement;
  while (el?.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  return el;
}
// What a screen reader would read for an element.
function accessibleName(el) {
  let a11y = Cc["@mozilla.org/accessibilityService;1"].getService(
    Ci.nsIAccessibilityService
  );
  return a11y.getAccessibleFor(el)?.name ?? null;
}
// Shown, and not hidden: a hidden menu still shows as it fades out.
function shown(el) {
  return el.checkVisibility() && el.getBoundingClientRect().width > 0 && !el.closest("[hidden]");
}
// The middle of an element, in the window's CSS pixels, for Browser.pointer.
function middle(el) {
  let r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}
function rowFor(tab, w = win) {
  return [...tabList(w).rows].find(r => r.tab == tab);
}
function headerFor(group, w = win) {
  return [...tabList(w).groupHeaders].find(h => h.group == group);
}
function byLabel(label, w = win) {
  return w.gBrowser.tabs.find(t => t.label == label);
}
// The accessible name, once the accessibility tree has it.
function named(el) {
  return wait(() => accessibleName(el), "an accessible name");
}
// What a token resolves to inside a surface: the computed property of a
// probe element styled with var(token), put in the surface for a moment.
function tokenIn(surface, token, property = "background-color") {
  let probe = surface.ownerDocument.createElementNS("http://www.w3.org/1999/xhtml", "div");
  probe.style.setProperty(property, `var(${token})`);
  surface.append(probe);
  try {
    return surface.ownerDocument.defaultView.getComputedStyle(probe).getPropertyValue(property);
  } finally {
    probe.remove();
  }
}
// Runs fn in light (false) or dark (true) mode; returns what it returns.
async function inScheme(dark, fn) {
  Services.prefs.setIntPref("ui.systemUsesDarkTheme", dark ? 1 : 0);
  await wait(() => win.matchMedia("(prefers-color-scheme: dark)").matches == dark, dark ? "dark mode" : "light mode");
  await sleep(100);
  return fn();
}
// Runs fn with another accent hue; returns what it returns.
async function withHue(hue, fn) {
  doc.documentElement.style.setProperty("--orbito-accent-hue", hue);
  try {
    await sleep(50);
    return await fn();
  } finally {
    OrbitoAppearance.apply(doc);
  }
}
// Shows a notification bar for the selected tab (or the window, global)
// with a primary and a plain button; returns it.
async function notificationBar(label, { global = false, type = "PRIORITY_WARNING_MEDIUM" } = {}) {
  let box = global ? win.gNotificationBox : win.gBrowser.getNotificationBox();
  let bar = await box.appendNotification(
    `orbito-test-${label}`,
    { label, priority: box[type] },
    [{ label: "Yes", primary: true, callback: () => true }, { label: "Later", callback: () => true }]
  );
  await wait(() => shown(bar) && bar.querySelector(".notification-button"), "the notification bar");
  // It slides in; measured before that ends, it is short of its place.
  await Promise.all(bar.getAnimations().map(a => a.finished));
  return bar;
}
function closeNotificationBars() {
  win.gNotificationBox.removeAllNotifications(true);
  for (let tab of win.gBrowser.tabs) {
    win.gBrowser.readNotificationBox(tab.linkedBrowser)?.removeAllNotifications(true);
  }
}
function addGroup(tabs, color, label, w = win) {
  return w.gBrowser.addTabGroup(tabs, { color, label });
}
const commandBar = shell.commandBar;
// The Command bar's result rows that show, as [{kind, result, row}]: kind is
// "ask" (Ask Orbito), "command" (Settings, History), or else the result
// source's name, e.g. "history", "bookmarks", "search".
async function commandBarResults(w = win) {
  let urlbar = w.gURLBar;
  await urlbar.lastQueryContextPromise;
  await sleep(300);
  let { UrlbarShared } = ChromeUtils.importESModule(
    "chrome://browser/content/urlbar/UrlbarShared.mjs"
  );
  let sources = Object.fromEntries(
    Object.entries(UrlbarShared.RESULT_SOURCE).map(([name, n]) => [n, name.toLowerCase()])
  );
  let rows = urlbar.view.panel.querySelector(".urlbarView-results").children;
  return [...rows]
    .filter(row => row.result && !row.hasAttribute("stale") && shown(row))
    .map(row => ({
      kind:
        row.result.providerName == "OrbitoAsk" ? "ask"
        : row.result.providerName == "OrbitoCommands" ? "command"
        : sources[row.result.source],
      result: row.result,
      row,
    }));
}
// Waits until the Command bar's results include one that fn picks.
async function resultWhere(fn, what, w = win) {
  return wait(async () => (await commandBarResults(w)).find(fn), what);
}
function commandBarShown(w = win) {
  let urlbar = w.gURLBar;
  return w.OrbitoShell.commandBar.isOpen && shown(urlbar) && urlbar.focused &&
    shown(w.OrbitoShell.commandBar.scrim);
}
// What the open Command bar says, null for a part that doesn't show: what
// to type over the empty input, the mode chip, the footer and its key chips.
function commandBarText(w = win) {
  let urlbar = w.gURLBar;
  let text = el => (el && shown(el) ? el.textContent : null);
  let footer = urlbar.panel.querySelector(".orbito-command-bar-footer");
  return {
    placeholder: text(urlbar.querySelector(".orbito-command-bar-placeholder")),
    mode: text(urlbar.querySelector(".orbito-command-bar-mode")),
    footer: text(footer),
    keys: [...(footer?.querySelectorAll("kbd") ?? [])].filter(shown).map(kbd => kbd.textContent),
  };
}
// The same, once the results and their footer show.
function commandBarTextWithFooter(w = win) {
  return wait(() => {
    let said = commandBarText(w);
    return said.footer && said;
  }, "the Command bar's footer");
}
// Closes the Command bar, if a test left it open.
function closeCommandBar(w = win) {
  w.OrbitoShell.commandBar.close();
}
const siteInfo = shell.siteInfo;
// Opens the site information panel as a click on its button does.
async function openSiteInfo() {
  await shell.topBar.updateComplete;
  let shownEvent = new Promise(r => siteInfo.panel.addEventListener("popupshown", r, { once: true }));
  shell.topBar.siteInfoButton.click();
  await shownEvent;
  await siteInfo.updateComplete;
}
async function closeSiteInfo() {
  if (siteInfo.panel.state != "closed") {
    let hidden = new Promise(r => siteInfo.panel.addEventListener("popuphidden", r, { once: true }));
    siteInfo.close();
    await hidden;
  }
}
// The permission row for a permission id in the open panel.
async function permissionRow(id) {
  await siteInfo.updateComplete;
  return [...siteInfo.permissionRows].find(row => row.dataset.permission == id);
}
// Loads a URL in a new selected tab and waits until it is done.
async function openURL(url) {
  let tab = win.gBrowser.addTab(url, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  win.gBrowser.selectedTab = tab;
  await wait(() => tab.linkedBrowser.webProgress && !tab.linkedBrowser.webProgress.isLoadingDocument &&
    tab.linkedBrowser.currentURI.spec != "about:blank", `${url} to load`);
  return tab;
}
const extensions = shell.extensions;
// Opens the extensions panel as a click on its button does.
async function openExtensions() {
  await shell.topBar.updateComplete;
  let shownEvent = new Promise(r => extensions.panel.addEventListener("popupshown", r, { once: true }));
  shell.topBar.extensionsButton.click();
  await shownEvent;
  await extensions.updateComplete;
}
async function closeExtensions() {
  if (extensions.panel.state != "closed") {
    let hidden = new Promise(r => extensions.panel.addEventListener("popuphidden", r, { once: true }));
    extensions.close();
    await hidden;
  }
}
// Installs a temporary extension from a manifest and files and waits until
// it runs (and its toolbar button is made, if it has one).
async function installExtension(name, manifest = {}, files = {}) {
  let id = `${name.toLowerCase().replace(/\W+/g, "-")}@orbito.test`;
  let dir = PathUtils.join(PathUtils.tempDir, `orbito-test-${id}`);
  await IOUtils.makeDirectory(dir, { ignoreExisting: true });
  await IOUtils.writeJSON(PathUtils.join(dir, "manifest.json"), {
    manifest_version: 2,
    name,
    version: "1.0",
    browser_specific_settings: { gecko: { id } },
    ...manifest,
  });
  for (let [file, text] of Object.entries(files)) {
    await IOUtils.writeUTF8(PathUtils.join(dir, file), text);
  }
  let { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  let folder = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  folder.initWithPath(dir);
  let addon = await AddonManager.installTemporaryAddon(folder);
  await wait(() => {
    let policy = WebExtensionPolicy.getByID(id);
    return policy?.extension && (!manifest.browser_action || win.gUnifiedExtensions.browserActionFor(policy)?.widget);
  }, `${name} to start`);
  return addon;
}
async function uninstallTestExtensions() {
  let { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  for (let addon of await AddonManager.getAddonsByTypes(["extension"])) {
    if (addon.id.endsWith("@orbito.test")) {
      await addon.uninstall();
    }
  }
}
// Where a panel's card shows: its box takes in a margin for the shadow
// (on Windows and Linux), which a panel on the platform's material lacks.
function cardBox(panel) {
  return panel.shadowRoot.querySelector("[part~=content]").getBoundingClientRect();
}
// The open extension popup (Firefox's panel for a toolbar button's view).
function extensionPopup() {
  let panel = doc.getElementById("customizationui-widget-panel");
  return panel?.state == "open" ? panel : null;
}
async function closeExtensionPopup() {
  let panel = extensionPopup();
  if (panel) {
    let hidden = new Promise(r => panel.addEventListener("popuphidden", r, { once: true }));
    panel.hidePopup();
    await hidden;
  }
}
const downloads = shell.downloads;
const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
// Opens the downloads panel as a click on its button does.
async function openDownloads() {
  await shell.topBar.updateComplete;
  if (downloads.panel.state == "open") {
    return;
  }
  let shownEvent = new Promise(r => downloads.panel.addEventListener("popupshown", r, { once: true }));
  shell.topBar.downloadsButton.click();
  await shownEvent;
  await downloads.updateComplete;
}
async function closeDownloads() {
  if (downloads.panel.state != "closed") {
    let hidden = new Promise(r => downloads.panel.addEventListener("popuphidden", r, { once: true }));
    downloads.close();
    await hidden;
  }
}
// Downloads land in a test folder without asking where, and open no panel
// on their own.
async function downloadsFolder() {
  let dir = PathUtils.join(PathUtils.tempDir, "orbito-test-downloads");
  await IOUtils.makeDirectory(dir, { ignoreExisting: true });
  Services.prefs.setIntPref("browser.download.folderList", 2);
  Services.prefs.setStringPref("browser.download.dir", dir);
  Services.prefs.setBoolPref("browser.download.useDownloadDir", true);
  Services.prefs.setBoolPref("browser.download.always_ask_before_handling_new_types", false);
  Services.prefs.setBoolPref("browser.download.alwaysOpenPanel", false);
  Services.prefs.setBoolPref("browser.download.panel.shown", true);
  return dir;
}
function fileURL(name, size = 1000, seconds = 0) {
  return `${PAGES}/file/${encodeURIComponent(name)}?size=${size}&seconds=${seconds}`;
}
// Starts a download with the Downloads API, as Firefox does for a link.
async function startDownload(name, size, seconds) {
  let dir = await downloadsFolder();
  let download = await Downloads.createDownload({
    source: fileURL(name, size, seconds),
    target: PathUtils.join(dir, name),
  });
  let list = await Downloads.getList(Downloads.PUBLIC);
  await list.add(download);
  download.start().catch(() => {});
  return download;
}
// Empties the downloads list (the button goes with it).
async function clearDownloads() {
  await closeDownloads();
  let list = await Downloads.getList(Downloads.ALL);
  for (let download of await list.getAll()) {
    await list.remove(download);
    await download.finalize(true).catch(() => {});
  }
  await wait(async () => (await shell.topBar.updateComplete) && !shell.topBar.downloadsButton,
    "the downloads button to go");
}
// The open panel's row for a download.
async function downloadRow(download) {
  await downloads.updateComplete;
  return downloads.rowFor(download);
}
function rowStatus(row) {
  return row.querySelector(".sub").textContent;
}
const { OrbitoShellStore } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/shell/OrbitoShellStore.sys.mjs"
);
function spaces(w = win) {
  return w.OrbitoShell.spaces;
}
function switcher(w = win) {
  return w.document.getElementById("orbito-space-switcher");
}
// The switcher's dot for a Space, once it has caught up.
async function dotFor(id, w = win) {
  await switcher(w).updateComplete;
  return [...switcher(w).dots].find(dot => dot.dataset.space == id);
}
function spaceOfTab(tab) {
  return tab.documentGlobal.OrbitoShell.spaces.spaceOf(tab);
}
// Makes a Space as its button does and waits until the window shows it.
async function newSpace(w = win) {
  await switcher(w).updateComplete;
  let before = spaces(w).current;
  switcher(w).addButton.click();
  await wait(() => spaces(w).current != before, "the new Space");
  await tabList(w).updateComplete;
  return spaces(w).currentSpace;
}
// Back to one Space (the first), shown with motion; the others go with
// their tabs.
async function resetSpaces() {
  Services.prefs.clearUserPref("ui.prefersReducedMotion");
  await wait(() => !win.matchMedia("(prefers-reduced-motion: reduce)").matches, "motion back");
  // A Space being removed comes back, to go with the others.
  for (let id of core.removingSpaces()) {
    core.undoRemoveSpace(id);
  }
  OrbitoShellStore.set("spaces", spaces().list.slice(0, 1));
  await wait(() => spaces().list.length == 1 && !win.gBrowser.tabs.some(t => t.hidden),
    "one Space and no hidden tab", 5000).catch(e => { throw new Error(JSON.stringify({list: spaces().list, cur: spaces().current, tabs: win.gBrowser.tabs.map(t => [t.label, t.hidden, t.selected, SessionStore.getCustomTabValue(t,"orbitoSpace"), SessionStore.getCustomTabValue(t,"hiddenBy")])})); });
  await switcher().updateComplete;
  await tabList().updateComplete;
}
function pinGrid(w = win) {
  return w.document.getElementById("orbito-pins");
}
// The Pin grid's buttons once it has caught up.
async function pinButtons(w = win) {
  await pinGrid(w).updateComplete;
  await stillIn(pinGrid(w));
  return [...pinGrid(w).buttons];
}
function pinButtonFor(tab, w = win) {
  return [...pinGrid(w).buttons].find(b => b.tab == tab);
}
function storedPins() {
  return OrbitoShellStore.get("pins") ?? [];
}
// The Pin ids of a window's pinned tabs, in order.
function pinIds(w = win) {
  let pins = w.OrbitoShell.pins;
  return pins.tabs.map(t => pins.pinOf(t)?.id ?? null);
}
// Waits until a window has a tab for each stored Pin, in order, and its
// grid shows them.
async function pinsMatch(w = win) {
  let ids = JSON.stringify(storedPins().map(p => p.id));
  await wait(() => JSON.stringify(pinIds(w)) == ids, "the window's Pin tabs to follow the list");
  let buttons = await pinButtons(w);
  let tabs = w.OrbitoShell.pins.tabs;
  check(buttons.length == tabs.length && buttons.every((b, i) => b.tab == tabs[i]),
    "the grid does not show the pinned tabs");
}
function pinLabels(w = win) {
  return w.OrbitoShell.pins.tabs.map(t => t.label).join();
}
// Opens the tab menu on an element as a right click does; picks an item if
// asked. Returns the ids of the items shown.
async function tabMenu(el, command, w = win) {
  let menu = w.OrbitoShell.pins.menu;
  let shownEvent = new Promise(r => menu.addEventListener("popupshown", r, { once: true }));
  let [x, y] = middle(el);
  el.dispatchEvent(new w.MouseEvent("contextmenu", {
    bubbles: true, cancelable: true, composed: true, button: 2,
    screenX: w.mozInnerScreenX + x, screenY: w.mozInnerScreenY + y,
  }));
  await shownEvent;
  let items = [...menu.children].filter(i => !i.hidden).map(i => i.id);
  let hidden = new Promise(r => menu.addEventListener("popuphidden", r, { once: true }));
  if (command) {
    menu.activateItem(menu.querySelector(`#orbito-tab-menu-${command}`));
  } else {
    menu.hidePopup();
  }
  await hidden;
  return items;
}
// Opens the Space menu on an element as a right click does; picks an item
// if asked. Returns the items shown, "id:disabled" for a disabled one.
async function spaceMenu(el, command, w = win) {
  let menu = w.OrbitoShell.spaces.menu;
  let shownEvent = new Promise(r => menu.addEventListener("popupshown", r, { once: true }));
  let [x, y] = middle(el);
  el.dispatchEvent(new w.MouseEvent("contextmenu", {
    bubbles: true, cancelable: true, composed: true, button: 2,
    screenX: w.mozInnerScreenX + x, screenY: w.mozInnerScreenY + y,
  }));
  await shownEvent;
  let items = [...menu.children].filter(i => !i.hidden).map(i =>
    i.id.replace("orbito-space-menu-", "") + (i.disabled ? ":disabled" : ""));
  let hidden = new Promise(r => menu.addEventListener("popuphidden", r, { once: true }));
  if (command) {
    menu.activateItem(menu.querySelector(`#orbito-space-menu-${command}`));
  } else {
    menu.hidePopup();
  }
  await hidden;
  return items;
}
// No Pins: their unloaded tabs close, loaded ones become plain tabs.
async function resetPins() {
  OrbitoShellStore.set("pins", []);
  for (let w of Services.wm.getEnumerator("navigator:browser")) {
    for (let tab of w.gBrowser.tabs.filter(t => t.pinned)) {
      w.gBrowser.unpinTab(tab);
    }
  }
  await wait(() => !win.gBrowser.tabs.some(t => t.pinned), "no pinned tab");
  await pinGrid().updateComplete;
}
function dock(w = win) {
  return w.document.getElementById("orbito-dock");
}
// The Dock's rows once it has caught up.
async function dockRows(w = win) {
  await dock(w).updateComplete;
  await stillIn(dock(w));
  return [...dock(w).rows];
}
function dockRowFor(tab, w = win) {
  return [...dock(w).rows].find(r => r.tab == tab);
}
function storedDocks() {
  return OrbitoShellStore.get("docks") ?? {};
}
// The stored Dock of a Space (the one the window shows by default).
function storedDock(space = spaces().current) {
  return storedDocks()[space] ?? [];
}
// The Dock entry ids of a window's Dock tabs in a Space, in order.
function dockIds(space, w = win) {
  let docks = w.OrbitoShell.docks;
  return docks.tabsIn(space ?? w.OrbitoShell.spaces.current).map(t => docks.dockOf(t).id);
}
// Waits until a window has a tab for each stored Dock entry of every Space,
// in order, and its Dock shows the Space's.
async function docksMatch(w = win) {
  for (let space of w.OrbitoShell.spaces.list) {
    let ids = JSON.stringify(storedDock(space.id).map(e => e.id));
    await wait(() => JSON.stringify(dockIds(space.id, w)) == ids, "the window's Dock tabs to follow the list");
  }
  let rows = await dockRows(w);
  let tabs = w.OrbitoShell.docks.tabsIn();
  check(rows.length == tabs.length && rows.every((r, i) => r.tab == tabs[i]),
    "the Dock does not show the Space's Dock tabs");
}
function dockLabels(w = win) {
  return w.OrbitoShell.docks.tabsIn().map(t => t.label).join();
}
// No Dock in any Space: unloaded Dock tabs close, loaded ones become plain
// tabs.
async function resetDocks() {
  OrbitoShellStore.set("docks", {});
  await wait(() => !win.gBrowser.tabs.some(t => SessionStore.getCustomTabValue(t, "orbitoDock")),
    "no Dock tab");
  await dock().updateComplete;
}
// The Sidebar as the user left it: open, at the default width.
async function resetSidebar() {
  Services.prefs.clearUserPref("orbito.sidebar.collapsed");
  Services.prefs.clearUserPref("orbito.sidebar.width");
  shell.sidebar.peeking = false;
  await shell.sidebar.updateComplete;
  await sidebarMoved();
}
// Waits for the page and the Sidebar to end their move as it collapses or
// comes back.
async function sidebarMoved(w = win) {
  let moving = [w.document.getElementById("browser"), w.OrbitoShell.sidebar]
    .flatMap(el => el.getAnimations())
    .filter(a => !a.transitionProperty);
  await Promise.all(moving.map(a => a.finished.catch(() => {})));
}
const assistant = shell.assistant;
const { OrbitoAssistantCore: core } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs"
);
// Both wait for the panel's motion to end.
async function openAssistant(w = win) {
  w.OrbitoAssistant.toggle(true);
  await w.OrbitoShell.assistant.updateComplete;
  await wait(() => !w.OrbitoShell.assistant.hasAttribute("motion"), "the panel's motion");
  return w.OrbitoShell.assistant;
}
async function closeAssistant(w = win) {
  w.OrbitoAssistant.toggle(false);
  await w.OrbitoShell.assistant.updateComplete;
  await wait(() => w.OrbitoShell.assistant.hidden, "the panel's motion");
}
// The open menu's items (session settings or model), by their label.
function menuItem(menu, label) {
  let item = [...menu.querySelectorAll('[role^="menuitem"]')].find(
    el => el.textContent.trim().startsWith(label)
  );
  check(item, `no ${label} in ${menu.textContent}`);
  return item;
}
// Back to a closed panel at its default width, context, backend and depth.
async function resetAssistant() {
  assistant.closeMenu();
  assistant.context = "tab";
  assistant.view = "chat";
  assistant.threadScope = "space";
  Services.prefs.clearUserPref("orbito.assistant.width");
  Services.prefs.clearUserPref("orbito.assistant.effort");
  core.backend = "claude";
  await closeAssistant();
}
const { OrbitoTools } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoTools.sys.mjs"
);
// A backend the test drives: each question runs fake.run with the
// backend's options (callTool, emit, signal, ...).
const fake = { run: async () => {} };
function useFakeBackend() {
  core.BACKENDS.orbittest ??= {
    label: "Test",
    modelPref: "orbito.test.model",
    defaultModel: "test",
    impl: { run: options => fake.run(options) },
  };
  if (!core._backendSettings.original) {
    let original = core._backendSettings;
    core._backendSettings = Object.assign(
      backend => (backend.startsWith("orbittest") ? Promise.resolve({}) : original.call(core, backend)),
      { original }
    );
  }
  core.backend = "orbittest";
}
function dropFakeBackend() {
  if (core._backendSettings.original) {
    core._backendSettings = core._backendSettings.original;
  }
  delete core.BACKENDS.orbittest;
  fake.run = async () => {};
}
// Asks in a new Thread from the panel, so that each test's question has one
// of its own; resolves with its id.
async function askFake(prompt, run) {
  fake.run = run;
  await openAssistant();
  let id = core.newThread(win);
  assistant.submit(prompt);
  await wait(() => core.isRunning(id), "the question to start");
  return id;
}
function finishedRun(id) {
  return wait(() => !core.isRunning(id), "the question to finish");
}
// The tab id a tool result like "Opened tab 4." names.
function openedTab(result) {
  let id = +result.content.match(/tab (\d+)/)[1];
  return win.gBrowser.tabs.find(t => OrbitoTools.tabId(t) == id);
}
function orbitBoxes(w = win) {
  return [...tabList(w).renderRoot.querySelectorAll(".orbit")];
}
function orbitTabsShown(box) {
  return [...box.querySelectorAll(".tab")].map(row => row.tab);
}
function orbitHeader(box) {
  return box.querySelector(".orbit-toggle");
}
// A button in the Assistant panel's Thread, by its text.
function logButton(text) {
  return [...assistant.log.querySelectorAll("button")].find(b => b.textContent.trim() == text);
}
// The Thread list's rows (the first New Thread), and a Thread's.
function threadRows() {
  return [...assistant.threadsView.querySelectorAll(".thread-row")];
}
function threadRow(id) {
  return threadRows().find(row => row.dataset.thread == id);
}
function threadRowIds() {
  return threadRows().slice(1).map(row => row.dataset.thread);
}
function scopeButton(label) {
  return [...assistant.threadsView.querySelectorAll(".scope button")].find(b => b.textContent.trim() == label);
}
// Every tab a plain tab again, and approvals asked again.
async function resetOrbits() {
  for (let w of Services.wm.getEnumerator("navigator:browser")) {
    for (let tab of w.gBrowser.tabs) {
      core.leaveOrbit(tab);
    }
  }
  core.setPermissionMode(win, "ask");
  dropFakeBackend();
  await resetAssistant();
}
const { OrbitoShow, MAX_RECORDING_MS } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoShow.sys.mjs"
);
// No demo in any window, stopping after 30 minutes again.
function resetShow() {
  for (let w of Services.wm.getEnumerator("navigator:browser")) {
    w.OrbitoShell?.show.cancel();
    if (w.OrbitoShell) {
      w.OrbitoShell.show.limit = MAX_RECORDING_MS;
    }
  }
}
// Waits for the window's Show Orbito to be in state, and the panel to show it.
async function showState(state, w = win) {
  await wait(() => w.OrbitoShell.show.state == state, `Show Orbito ${state} (${w.OrbitoShell.show.state})`);
  await w.OrbitoShell.assistant.updateComplete;
}
// Starts a demo in w as an entry point and the goal's Start do; returns its log.
async function startShow(goal = "", w = win) {
  check(w.OrbitoShell.show.begin(), "Show Orbito did not begin");
  await showState("goal", w);
  let panel = w.OrbitoShell.assistant;
  panel.goalInput.value = goal;
  panel.showStartButton.click();
  await showState("recording", w);
  return OrbitoShow.log(w);
}
const { PlacesUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/PlacesUtils.sys.mjs"
);
// The Orbito new tab page shown in a tab, once it has rendered, or null.
function newTabPageOf(tab) {
  let page = tab.linkedBrowser.contentDocument?.querySelector("orbito-new-tab");
  return page?.hasUpdated ? page : null;
}
// Opens url (the new tab page) in a new selected tab, as Spaces do (the
// urlbar not focused); returns {tab, page}.
async function openNewTabPage(url = "about:newtab", w = win) {
  let tab = w.gBrowser.addTrustedTab(url);
  w.gBrowser.selectedTab = tab;
  let page = await wait(() => newTabPageOf(tab), `the new tab page at ${url}`);
  return { tab, page };
}
// A page of the test server under another host name (see useSiteHosts).
function siteURL(host, title) {
  return `http://${host}.orbito.test:${new URL(PAGES).port}/page/${encodeURIComponent(title)}`;
}
// Host names for siteURL, served from here, without an HTTPS upgrade.
function useSiteHosts(hosts) {
  Services.prefs.setStringPref("network.dns.localDomains", hosts.map(h => `${h}.orbito.test`).join(","));
  Services.prefs.setBoolPref("dom.security.https_first", false);
}
function dropSiteHosts() {
  Services.prefs.clearUserPref("network.dns.localDomains");
  Services.prefs.clearUserPref("dom.security.https_first");
}
// History made of these visits ([url, title]), the first the latest.
async function setHistory(visits) {
  await PlacesUtils.history.clear();
  if (visits.length) {
    let now = Date.now();
    await PlacesUtils.history.insertMany(visits.map(([url, title], i) => ({
      url, title, visits: [{ date: new Date(now - (i + 1) * 60000) }],
    })));
  }
}
// The recent visits a new tab page shows: their labels, in order.
function siteLabels(page) {
  return [...page.siteLinks].map(link => link.textContent.trim()).join(",");
}
// Opens about:orbito-settings in w's selected tab; returns its document
// once its appearance and account controls are in.
async function openOrbitoSettings(w = win) {
  w.OrbitoAssistant.openSettings();
  return wait(() => {
    let page = w.gBrowser.selectedBrowser.contentDocument;
    if (page?.documentURI != "about:orbito-settings") {
      // A page that just loaded (about:addons) can take the selection back
      // when it focuses itself.
      w.OrbitoAssistant.openSettings();
      return false;
    }
    return page?.documentURI == "about:orbito-settings" &&
      page.querySelector("#accent [role=radio]") &&
      page.querySelector("#sync-actions button") && page;
  }, "Orbito's settings");
}
// The settings page's radio for value in a radio group (theme, accent).
function radioIn(page, group, value) {
  return page.querySelector(`#${group} [role=radio][data-value="${value}"]`);
}
// Back to the system's light or dark and the default accent.
function resetAppearance() {
  Services.prefs.clearUserPref(THEME_PREF);
  Services.prefs.clearUserPref(ACCENT_PREF);
}
// A web page (in a content process) that shows its prefers-color-scheme
// in its title; schemeOf(tab) reads it: "dark" or "light".
async function openSchemePage(w = win) {
  let tab = w.gBrowser.addTab(`${PAGES}/scheme`, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  w.gBrowser.selectedTab = tab;
  await wait(() => schemeOf(tab), "the scheme page");
  return tab;
}
function schemeOf(tab) {
  return tab.linkedBrowser.contentTitle.match(/^Scheme (dark|light)$/)?.[1];
}
const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
const DEFAULT_THEME_ID = "default-theme@mozilla.org";
// The themes the add-ons manager has: their ids, the active one first.
async function themeIds() {
  let themes = await AddonManager.getAddonsByTypes(["theme"]);
  return themes.sort((a, b) => b.isActive - a.isActive).map(t => t.id).join(",");
}
// Writes an add-on file (an .xpi: a zip) with that manifest at path.
function writeXPI(path, manifest) {
  let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  file.initWithPath(path);
  let zip = Cc["@mozilla.org/zipwriter;1"].createInstance(Ci.nsIZipWriter);
  zip.open(file, 0x04 | 0x08 | 0x20); // write, create, truncate
  let stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
  stream.setUTF8Data(JSON.stringify(manifest));
  zip.addEntryStream("manifest.json", Date.now() * 1000, Ci.nsIZipWriter.COMPRESSION_NONE, stream, false);
  zip.close();
  return file;
}
// A theme add-on's manifest: a red frame.
function themeManifest(id) {
  return {
    manifest_version: 2,
    name: "A theme",
    version: "1.0",
    browser_specific_settings: { gecko: { id } },
    theme: { colors: { frame: "#ff0000", tab_background_text: "#ffffff" } },
  };
}
// Whether w shows a Firefox theme's look: its root's attributes and colors
// and what its pages get (empty when it shows none).
function themeLook(w = win) {
  let root = w.document.documentElement;
  let look = [];
  if (root.hasAttribute("lwtheme")) {
    look.push("lwtheme");
  }
  if (root.getAttribute("theme-effective-id") != DEFAULT_THEME_ID) {
    look.push(`theme ${root.getAttribute("theme-effective-id")}`);
  }
  look.push(...[...root.style].filter(p => p.startsWith("--lwt-") || p == "--toolbar-bgcolor"));
  if (Services.ppmm.sharedData.get(`theme/${w.docShell.outerWindowID}`)?.hasTheme) {
    look.push("pages");
  }
  return look.join(",");
}
// about:addons in w's selected tab, once its categories are in.
async function openAddons(view = "addons://list/extension", w = win) {
  w.BrowserAddonUI.openAddonsMgr(view);
  return wait(() => {
    let page = w.gBrowser.selectedBrowser.contentDocument;
    return page?.documentURI.startsWith("about:addons") &&
      page.getElementById("category-extension")?.checkVisibility() && page;
  }, "about:addons");
}
// Firefox's settings in w's selected tab, once open at pane (a pane's
// name, as openPreferences takes it) with its group groupid shown.
async function firefoxSettingsAt(pane, groupid, w = win) {
  w.openPreferences(pane);
  return wait(() => {
    let page = w.gBrowser.selectedBrowser.contentDocument;
    return page?.documentURI.startsWith("about:preferences") &&
      page.querySelector(`setting-group[groupid="${groupid}"]`)?.checkVisibility() && page;
  }, `Firefox's settings at ${pane}`);
}
"""


class Pages(BaseHTTPRequestHandler):
    """/page/<title> answers a page with that title; /suggest?q=<text>
    answers two search suggestions for the text; /geo asks for the
    location, /notify to show notifications; /file/<name>?size=<bytes>&
    seconds=<s> sends a file to download (an attachment) over that long;
    /count answers a page titled "Count <n>", n counting its loads;
    /scheme a page titled "Scheme dark" or "Scheme light" after its
    prefers-color-scheme; /popup opens /page/Popup as a popup (a sized
    window.open) when it loads;
    /slow/<title>?seconds=<s> a page that takes that long to finish;
    /tall/<px> a page titled "Tall <px>" that tall, white but for its last
    600 px in red, scrolled to 1000 px once it has loaded."""

    loads = 0

    def do_GET(self):
        if self.path.startswith("/file/"):
            return self.send_file()
        if self.path.startswith("/slow/"):
            return self.send_slow_page()
        if self.path == "/count":
            Pages.loads += 1
            body = f"<!doctype html><title>Count {Pages.loads}</title><p>Count</p>".encode()
            content_type = "text/html; charset=utf-8"
        elif self.path.startswith("/suggest?q="):
            q = unquote(self.path.removeprefix("/suggest?q=").replace("+", " "))
            body = json.dumps([q, [f"{q} one", f"{q} two"]]).encode()
            content_type = "application/json"
        elif self.path == "/notify":
            body = (
                b"<!doctype html><title>Notify</title><p>Notify</p>"
                b"<script>Notification.requestPermission();</script>"
            )
            content_type = "text/html; charset=utf-8"
        elif self.path == "/scheme":
            body = (
                b"<!doctype html><title>Scheme</title><p>Scheme</p><script>"
                b"let dark = matchMedia('(prefers-color-scheme: dark)');"
                b"let show = () => document.title = dark.matches ? 'Scheme dark' : 'Scheme light';"
                b"dark.addEventListener('change', show); show();</script>"
            )
            content_type = "text/html; charset=utf-8"
        elif self.path == "/popup":
            body = (
                b"<!doctype html><title>Opener</title><p>Opener</p>"
                b"<script>window.open('/page/Popup', '', 'width=500,height=400');</script>"
            )
            content_type = "text/html; charset=utf-8"
        elif self.path.startswith("/tall/"):
            height = int(self.path.removeprefix("/tall/"))
            body = (
                f"<!doctype html><title>Tall {height}</title>"
                f"<body style='margin:0;background:white'>"
                f"<div style='height:{height - 600}px'>Top</div>"
                f"<div style='height:600px;background:red'>Bottom</div>"
                f"<script>onload = () => scrollTo(0, 1000);</script>"
            ).encode()
            content_type = "text/html; charset=utf-8"
        elif self.path == "/geo":
            body = (
                b"<!doctype html><title>Geo</title><p>Geo</p>"
                b"<script>navigator.geolocation.getCurrentPosition(() => {});</script>"
            )
            content_type = "text/html; charset=utf-8"
        else:
            title = unquote(self.path.removeprefix("/page/"))
            body = f"<!doctype html><title>{title}</title><p>{title}</p>".encode()
            content_type = "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self):
        url = urlsplit(self.path)
        query = parse_qs(url.query)
        size = int(query.get("size", ["1000"])[0])
        seconds = float(query.get("seconds", ["0"])[0])
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Disposition", f'attachment; filename="{unquote(url.path.removeprefix("/file/"))}"')
        self.send_header("Content-Length", str(size))
        self.end_headers()
        chunks = 20
        try:
            for i in range(chunks):
                self.wfile.write(b"x" * (size // chunks + (size % chunks if i == chunks - 1 else 0)))
                self.wfile.flush()
                time.sleep(seconds / chunks)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def send_slow_page(self):
        url = urlsplit(self.path)
        seconds = float(parse_qs(url.query).get("seconds", ["10"])[0])
        title = unquote(url.path.removeprefix("/slow/"))
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        try:
            self.wfile.write(f"<!doctype html><title>{title}</title><p>".encode())
            self.wfile.flush()
            end = time.time() + seconds
            while time.time() < end:
                time.sleep(0.2)
                self.wfile.write(b" ")
                self.wfile.flush()
            self.wfile.write(b"</p>")
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, *args):
        pass


class TLSPages(ThreadingHTTPServer):
    """The pages over HTTPS. The handshake is done in each request's thread,
    so a connection that never finishes one (a refused certificate, a
    speculative connection) does not hold up the others."""

    def __init__(self, cert):
        super().__init__(("127.0.0.1", 0), Pages)
        self.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.context.load_cert_chain(*cert)

    def finish_request(self, request, client_address):
        request.settimeout(10)
        request = self.context.wrap_socket(request, server_side=True)
        super().finish_request(request, client_address)

    def handle_error(self, request, client_address):
        pass


# The ports above 1023 the app refuses to load from (gBadPortList in
# netwerk/base/nsIOService.cpp), which some systems give out.
BAD_PORTS = {1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566,
             6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080}


def start_pages(cert=None):
    while True:
        server = TLSPages(cert) if cert else ThreadingHTTPServer(("127.0.0.1", 0), Pages)
        if server.server_port not in BAD_PORTS:
            break
        server.server_close()
    scheme = "https" if cert else "http"
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"{scheme}://127.0.0.1:{server.server_port}"


# The HTTPS pages: "secure" has a certificate from a test CA the app trusts
# ("ca", base64 DER), "untrusted" a self-signed one.
TLS = {}


def make_certs(folder):
    """Makes, with openssl, a test CA and a certificate for 127.0.0.1 it
    signed, and a self-signed one. Returns (cert, key) paths for both."""

    def openssl(*args):
        subprocess.run(["openssl", *args], cwd=folder, check=True, capture_output=True)

    days = ["-days", "30"]
    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key",
            "-out", "ca.pem", *days, "-subj", "/CN=Orbito Test CA",
            "-addext", "basicConstraints=critical,CA:TRUE",
            "-addext", "keyUsage=critical,keyCertSign,cRLSign")
    openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "leaf.key",
            "-out", "leaf.csr", "-subj", "/CN=127.0.0.1")
    Path(folder, "leaf.ext").write_text(
        "subjectAltName=IP:127.0.0.1\nbasicConstraints=CA:FALSE\n"
        "extendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\n"
    )
    openssl("x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key",
            "-CAcreateserial", "-out", "leaf.pem", *days, "-extfile", "leaf.ext")
    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "self.key",
            "-out", "self.pem", *days, "-subj", "/CN=127.0.0.1",
            "-addext", "subjectAltName=IP:127.0.0.1")
    der = ssl.PEM_cert_to_DER_cert(Path(folder, "ca.pem").read_text(encoding="utf-8"))
    TLS["ca"] = base64.b64encode(der).decode()
    f = lambda name: str(Path(folder, name))
    return (f("leaf.pem"), f("leaf.key")), (f("self.pem"), f("self.key"))


class Browser:
    def __init__(self, pages):
        self.pages = pages
        with socket.socket() as s:
            # Not the default 2828, so that suites can run side by side.
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        self.m = Marionette(
            bin=BIN, headless=True, port=port,
            # A log of its own: Windows can't replace one another app has open
            # (and apps started at once get the same name in a folder).
            gecko_log=os.path.join(tempfile.gettempdir(), f"gecko-{os.getpid()}.log"),
            # Fewer frames to paint: animations take as long.
            prefs={"layout.frame_rate": 20, "layout.css.stylo-threads": 0},
        )
        self.m.start_session()
        self.m.set_context("chrome")
        self.m.timeout.script = 120

    def js(self, body):
        return self.m.execute_script(
            PRELUDE + "return (async () => {\n" + body + "\n})();",
            script_args=[self.pages],
        )

    def keys(self, *keys):
        """Presses keys in the chrome window, as the user would; each item
        is a key or a (modifier, key) pair."""
        seq = self.m.actions.sequence("key", "keyboard")
        for key in keys:
            mods, key = (key[:-1], key[-1]) if isinstance(key, tuple) else ((), key)
            for mod in mods:
                seq.key_down(mod)
            seq.key_down(key).key_up(key)
            for mod in reversed(mods):
                seq.key_up(mod)
        seq.perform()
        self.m.actions.release()

    def pointer(self, *steps):
        """Moves and presses the mouse in the chrome window, as the user
        would; each step is an (x, y) to move to, "down", "up", or a pause
        in ms."""
        seq = self.m.actions.sequence(
            "pointer", "mouse", pointer_params={"pointerType": "mouse"}
        )
        for step in steps:
            if step == "down":
                seq.pointer_down()
            elif step == "up":
                seq.pointer_up()
            elif isinstance(step, (int, float)):
                seq.pause(step)
            else:
                seq.pointer_move(round(step[0]), round(step[1]), duration=50)
        seq.perform()
        self.m.actions.release()

    def drag(self, start, end):
        """Presses at start, moves to end in a few steps and lets go."""
        (x0, y0), (x1, y1) = start, end
        steps = [(x0 + (x1 - x0) * i / 4, y0 + (y1 - y0) * i / 4) for i in range(1, 5)]
        self.pointer(start, "down", *steps, "up")

    def quit(self):
        self.m.quit(in_app=False)
        self.m.cleanup()


TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


@test
def firefox_chrome_is_hidden_but_kept(b):
    b.js("""
    for (let el of [
      doc.getElementById("TabsToolbar"),
      doc.getElementById("tabbrowser-tabs"),
      doc.getElementById("nav-bar"),
      doc.getElementById("urlbar"),
      doc.querySelector("sidebar-main"),
    ]) {
      check(el, "a Firefox element is gone from the DOM");
      check(!shown(el), `#${el.id || el.localName} is shown`);
    }
    check(win.gURLBar && win.gBrowser.tabContainer, "Firefox's controllers are gone");
    check(shown(shell.sidebar) && shown(shell.topBar), "the Shell is not shown");
    """)


@test
def sidebar_top_bar_and_page_keep_their_places(b):
    b.js("""
    await openPage("Layout");
    let sidebar = shell.sidebar.getBoundingClientRect();
    let topBar = shell.topBar.getBoundingClientRect();
    let page = win.gBrowser.tabbox.getBoundingClientRect();
    let body = doc.body.getBoundingClientRect();
    check(sidebar.left == 0 && sidebar.top <= body.top + 1 && sidebar.bottom >= body.bottom - 1, `Sidebar at ${JSON.stringify(sidebar)}`);
    check(topBar.left >= sidebar.right && topBar.bottom <= page.top && topBar.right >= page.right, `Top bar at ${JSON.stringify(topBar)}`);
    check(page.left >= sidebar.right && page.top >= topBar.bottom, `page at ${JSON.stringify(page)}`);
    """)


@test
def the_tab_list_matches_gbrowser(b):
    b.js("""
    await onlyBlankTab();
    let one = await openPage("One");
    let two = await openPage("Two");
    let three = await openPage("Three");
    await listMatchesGBrowser();

    // Moving, hiding and showing a tab, as other parts of Firefox may.
    win.gBrowser.moveTabTo(three, { tabIndex: 1 });
    await listMatchesGBrowser();
    win.gBrowser.hideTab(two);
    await wait(() => two.hidden, "the tab to hide");
    await listMatchesGBrowser();
    win.gBrowser.showTab(two);
    await listMatchesGBrowser();

    // A new title shows, and a tab opened in the background.
    one.linkedBrowser.loadURI(Services.io.newURI(pageURL("One again")), {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    await wait(async () => rowTitles(await rows()).includes("One again"), "the new title");
    win.gBrowser.addTab(pageURL("Background"), {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    await wait(async () => rowTitles(await rows()).includes("Background"), "the background tab");
    await listMatchesGBrowser();
    """)


@test
def clicking_a_row_selects_its_tab_and_close_closes_it(b):
    b.js("""
    await onlyBlankTab();
    let one = await openPage("Pick one");
    let two = await openPage("Pick two");
    let row = (await rows()).find(r => r.tab == one);
    row.click();
    check(win.gBrowser.selectedTab == one, "the clicked tab is not selected");
    await listMatchesGBrowser();

    let count = win.gBrowser.tabs.length;
    row = (await rows()).find(r => r.tab == two);
    row.querySelector(".close").click();
    await wait(() => !win.gBrowser.tabs.includes(two), "the tab to close");
    check(win.gBrowser.tabs.length == count - 1, "not exactly one tab closed");
    await listMatchesGBrowser();
    check(!(await rows()).some(r => r.tab == two), "the closed tab still has a row");
    """)


@test
def the_url_display_follows_the_selected_tab(b):
    b.js("""
    await onlyBlankTab();
    check((await urlShown()) == "Enter an address or ask", await urlShown());
    let host = new URL(PAGES).host;
    let one = await openPage("Where am I");
    check((await urlShown()) == `${host}/page/Where am I`, await urlShown());
    let two = await openPage("Elsewhere");
    check((await urlShown()) == `${host}/page/Elsewhere`, await urlShown());
    win.gBrowser.selectedTab = one;
    check((await urlShown()) == `${host}/page/Where am I`, await urlShown());

    // Navigating in the selected tab updates it too.
    one.linkedBrowser.loadURI(Services.io.newURI(pageURL("Moved on")), {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    await wait(async () => (await urlShown()) == `${host}/page/Moved on`, "the new URL");
    """)


@test
def light_and_dark_follow_the_system_and_one_accent_tints_the_shell(b):
    b.js("""
    let label = () => tabList().renderRoot.querySelector(".tab[selected] .label");
    let colors = () => ({
      text: win.getComputedStyle(label()).color,
      frame: win.getComputedStyle(doc.body).backgroundImage,
    });
    try {
      Services.prefs.setIntPref("ui.systemUsesDarkTheme", 0);
      await wait(() => !win.matchMedia("(prefers-color-scheme: dark)").matches, "light mode");
      let light = colors();
      Services.prefs.setIntPref("ui.systemUsesDarkTheme", 1);
      await wait(() => win.matchMedia("(prefers-color-scheme: dark)").matches, "dark mode");
      let dark = colors();
      check(light.text != dark.text && light.frame != dark.frame, `light ${JSON.stringify(light)}, dark ${JSON.stringify(dark)}`);
    } finally {
      Services.prefs.clearUserPref("ui.systemUsesDarkTheme");
    }

    // The accent: the frame's tint and the focus ring both follow one hue.
    tabList().focusRegion();
    let row = await wait(() => deepActive().matches?.(".tab") && deepActive(), "a focused row");
    let tinted = () => ({
      ring: win.getComputedStyle(row).outlineColor,
      frame: win.getComputedStyle(doc.body).backgroundImage,
    });
    let before = tinted();
    doc.documentElement.style.setProperty("--orbito-accent-hue", "155");
    try {
      let after = tinted();
      check(before.ring != after.ring && before.frame != after.frame, `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
    } finally {
      OrbitoAppearance.apply(doc);
    }
    """)


@test
def window_buttons_sit_where_the_platform_puts_them(b):
    b.js("""
    let mac = AppConstants.platform == "macosx";
    let lights = doc.getElementById("orbito-window-buttons");
    let controls = doc.getElementById("orbito-window-controls");
    if (mac) {
      check(lights && !controls, "macOS has the Shell's window controls");
      check(lights.parentNode == shell.sidebar && lights.assignedSlot?.name == "window-buttons", "the traffic lights are not in the Sidebar");
      let top = shell.sidebar.renderRoot.querySelector(".top").getBoundingClientRect();
      check(top.top < tabList().getBoundingClientRect().top, "the Sidebar's top row is not at its top");
    } else {
      check(controls && !lights, "no window controls");
      check(controls.parentNode == shell.topBar && controls.assignedSlot?.name == "window-controls", "the window controls are not in the Top bar");
      let buttons = [...controls.renderRoot.querySelectorAll("button")];
      let names;
      if (doc.documentElement.hasAttribute("customtitlebar")) {
        let box = controls.getBoundingClientRect();
        check(Math.abs(box.right - doc.body.getBoundingClientRect().right) < 1 && box.top <= 1, `window controls at ${JSON.stringify(box)}`);
        names = [];
        for (let button of buttons) {
          names.push(await named(button));
        }
      } else {
        // Hidden with the OS's title bar (as in headless windows), so out
        // of the accessibility tree.
        check(!shown(controls), "window controls under the OS's title bar");
        names = buttons.map(button => button.getAttribute("aria-label"));
      }
      let size = win.windowState == win.STATE_MAXIMIZED ? "Restore" : "Maximize";
      check(names.join() == `Minimize,${size},Close window`, names.join());
    }
    """)


@test
def f6_moves_between_sidebar_top_bar_and_page(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Regions");
    win.OrbitoAssistant.toggle(false);
    win.gBrowser.selectedBrowser.focus();
    await wait(() => shell.focusedRegion == "page", "the page to have focus");
    """)
    order = []
    for _ in range(3):
        b.keys(Keys.F6)
        order.append(b.js('return await wait(() => shell.focusedRegion, "a region");'))
    assert order == ["sidebar", "top-bar", "page"], order
    b.keys((Keys.SHIFT, Keys.F6))
    region = b.js('return shell.focusedRegion;')
    assert region == "top-bar", region

    # With the Assistant panel open, it comes after the page.
    b.js("""
    win.OrbitoAssistant.toggle(true);
    win.gBrowser.selectedBrowser.focus();
    await wait(() => shell.focusedRegion == "page", "the page to have focus");
    """)
    try:
        b.keys(Keys.F6)
        region = b.js('return await wait(() => shell.focusedRegion, "a region");')
        assert region == "assistant", region
        b.keys(Keys.F6)
        region = b.js('return shell.focusedRegion;')
        assert region == "sidebar", region
    finally:
        b.js("win.OrbitoAssistant.toggle(false);")


@test
def arrow_keys_move_in_the_tab_list_and_enter_selects(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Arrow one");
    await openPage("Arrow two");
    win.gBrowser.selectedTab = win.gBrowser.tabs[0];
    tabList().focusRegion();
    await wait(() => deepActive()?.tab == win.gBrowser.tabs[0], "the selected row to have focus");
    check(deepActive().matches(":focus-visible"), "the focused row shows no focus");
    """)
    b.keys(Keys.ARROW_DOWN, Keys.ARROW_DOWN)
    b.js("""
    let tabs = win.gBrowser.tabs;
    await wait(() => deepActive()?.tab == tabs[2], "focus on the third row");
    check(win.gBrowser.selectedTab == tabs[0], "moving selected a tab");
    let rowsNow = await rows();
    check(rowsNow.filter(r => r.tabIndex == 0).length == 1 && rowsNow[2].tabIndex == 0, "the list is not one tab stop");
    """)
    b.keys(Keys.ENTER)
    b.js("""
    let tabs = win.gBrowser.tabs;
    await wait(() => win.gBrowser.selectedTab == tabs[2], "Enter to select");
    check(deepActive()?.tab == tabs[2], "focus left the list");
    """)
    b.keys(Keys.HOME)
    b.js("""
    await wait(() => deepActive()?.tab == win.gBrowser.tabs[0], "Home to go to the first row");
    """)
    b.keys(Keys.ARROW_UP, Keys.END)
    b.js("""
    await wait(() => deepActive()?.tab == win.gBrowser.tabs.at(-1), "End to go to the last row");
    """)


@test
def every_shell_control_has_a_name(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Names");
    await rows();
    let roots = [shell.sidebar, tabList(), shell.topBar, doc.getElementById("orbito-window-controls")]
      .filter(Boolean)
      .map(el => el.renderRoot);
    let controls = roots.flatMap(root => [...root.querySelectorAll("button, [tabindex], [role]")]);
    check(controls.length >= 4, `only ${controls.length} controls`);
    // The accessibility tree is built after the service starts.
    let unnamed = () => controls.filter(el => !accessibleName(el));
    await wait(() => !unnamed().length, "names").catch(() => {
      throw new Error(`unnamed: ${unnamed().map(el => el.outerHTML.slice(0, 80)).join(", ")}`);
    });
    let closes = tabList().renderRoot.querySelectorAll(".close");
    check([...closes].every(el => accessibleName(el) == "Close tab"), "a close button has another name");
    check(accessibleName(shell.topBar.urlDisplay) == "Address", accessibleName(shell.topBar.urlDisplay));
    """)


@test
def popup_windows_have_no_sidebar(b):
    b.js("""
    await onlyBlankTab();
    // A site's window.open with a size: a popup (no toolbar). The page opens
    // it as it loads, which the popup blocker allows here.
    Services.prefs.setBoolPref("dom.disable_open_during_load", false);
    let opened = new Promise(resolve => {
      let listener = {
        onOpenWindow(xulWin) {
          Services.wm.removeListener(listener);
          resolve(xulWin.docShell.domWindow);
        },
      };
      Services.wm.addListener(listener);
    });
    win.gBrowser.selectedTab = win.gBrowser.addTab(`${PAGES}/popup`, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    let popup = await opened;
    try {
      await wait(() => popup.gBrowserInit?.delayedStartupFinished, "the popup");
      await wait(() => popup.gBrowser.selectedBrowser.contentTitle == "Popup", "the popup's page");
      check(!popup.toolbar.visible, "the site's window has a toolbar");
      check(popup.document.documentElement.hasAttribute("popup-window"), "not a popup window");
      let ps = popup.OrbitoShell;
      check(!shown(ps.sidebar) && shown(ps.topBar), "the popup shows a Sidebar or no Top bar");
      check(!ps.spaces && !ps.pins && !ps.docks, "the popup has Spaces, Pins or a Dock");
      // The Top bar shows the URL display and its site information button,
      // nothing else.
      await ps.topBar.updateComplete;
      let controls = [...ps.topBar.renderRoot.querySelectorAll("button, [tabindex], [role=button]")].filter(shown);
      check(controls.length == 2 && controls.includes(ps.topBar.urlDisplay) && controls.includes(ps.topBar.siteInfoButton),
        `the popup's Top bar shows ${controls.map(c => c.className || c.localName).join(", ")}`);
      let host = new URL(PAGES).host;
      check((await urlShown(popup)) == `${host}/page/Popup`, await urlShown(popup));
      // No Assistant panel, no Firefox sidebar.
      popup.OrbitoAssistant.toggle(true);
      check(ps.assistant.hidden, "the Assistant panel opened in the popup");
      check(!(await popup.SidebarController.show("viewHistorySidebar")) && !shown(ps.sidePanel.box),
        "a side panel opened in the popup");
      check(ps.regions.map(r => r.name).join(" ") == "top-bar page", ps.regions.map(r => r.name).join(" "));
    } finally {
      popup.close();
      Services.prefs.clearUserPref("dom.disable_open_during_load");
    }
    """)


@test
def removed_firefox_ui_is_hidden_but_kept(b):
    b.js("""
    let ids = ["PersonalToolbar", "PanelUI-menu-button"];
    if (AppConstants.platform != "macosx") {
      ids.push("toolbar-menubar");
    }
    for (let id of ids) {
      let el = doc.getElementById(id);
      check(el, `#${id} is gone from the DOM`);
      check(!shown(el), `#${id} is shown`);
    }
    // Toolbar buttons CustomizableUI may not have built.
    for (let id of ["firefox-view-button", "fxa-toolbar-menu-button"]) {
      let el = doc.getElementById(id);
      check(!el || !shown(el), `#${id} is shown`);
    }
    check(!doc.documentElement.hasAttribute("fxatoolbarmenu"), "the account button is on");
    for (let pref of [
      "browser.newtabpage.activity-stream.feeds.section.topstories",
      "browser.newtabpage.activity-stream.showSponsored",
      "browser.newtabpage.activity-stream.showSponsoredTopSites",
      "browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons",
      "browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features",
      "extensions.htmlaboutaddons.recommendations.enabled",
      "extensions.getAddons.showPane",
    ]) {
      check(!Services.prefs.getBoolPref(pref), `${pref} is on`);
    }
    // macOS keeps its native menu bar, without the removed features' items.
    for (let id of ["menu_openFirefoxView", "viewToolbarsMenu", "menu_customizeToolbars"]) {
      let item = doc.getElementById(id);
      check(item.hidden || item.closest("[hidden]"), `#${id} is in the menu bar`);
    }
    """)


@test
def firefox_view_does_not_open(b):
    b.js("""
    await onlyBlankTab();
    doc.getElementById("menu_openFirefoxView").doCommand();
    win.FirefoxViewHandler.openTab("opentabs");
    let { ActionsProviderQuickActions } = ChromeUtils.importESModule(
      "moz-src:///browser/components/urlbar/ActionsProviderQuickActions.sys.mjs"
    );
    await wait(() => ActionsProviderQuickActions.getAction("firefoxview")?.isUnsupported?.(), "the quick action to go");
    await sleep(500);
    let views = win.gBrowser.tabs.filter(t => t.linkedBrowser.currentURI.spec.startsWith("about:firefoxview"));
    check(!views.length && !win.FirefoxViewHandler.tab, "Firefox View opened");
    check(win.gBrowser.tabs.length == 1, `${win.gBrowser.tabs.length} tabs`);
    """)


@test
def the_bookmarks_toolbar_does_not_open(b):
    mac = b.js("tabList().focusRegion(); return AppConstants.platform == 'macosx';")
    b.keys((Keys.META if mac else Keys.CONTROL, Keys.SHIFT, "b"))
    b.js("""
    win.BookmarkingUI.toggleBookmarksToolbar("test");
    await sleep(500);
    let toolbar = doc.getElementById("PersonalToolbar");
    check(toolbar.collapsed && !shown(toolbar), "the bookmarks toolbar opened");
    check(Services.prefs.getCharPref("browser.toolbars.bookmarks.visibility") == "never", "its pref changed");
    """)


@test
def the_app_menu_does_not_open(b):
    b.js("""
    win.PanelUI.toggle();
    win.PanelUI.show();
    await sleep(500);
    check(win.PanelUI.panel.state == "closed", `the app menu is ${win.PanelUI.panel.state}`);
    """)


@test
def customize_mode_cannot_be_entered(b):
    b.js("""
    await onlyBlankTab();
    check(doc.getElementById("cmd_CustomizeToolbars").hasAttribute("disabled"), "the command is on");
    doc.getElementById("cmd_CustomizeToolbars").doCommand();
    doc.getElementById("toolbar-context-customize")?.doCommand();
    win.gCustomizeMode.enter();
    await sleep(1000);
    check(!doc.documentElement.hasAttribute("customizing"), "customize mode is on");
    check(!win.gBrowser.tabs.some(t => t.hasAttribute("customizemode")), "a customize tab opened");
    check(win.gBrowser.tabs.length == 1, `${win.gBrowser.tabs.length} tabs`);
    """)


@test
def the_menu_bar_does_not_show(b):
    if b.js("tabList().focusRegion(); return AppConstants.platform == 'macosx';"):
        return  # The native menu bar; its items are checked above.
    b.keys(Keys.ALT)
    b.keys(Keys.F10)
    b.js("""
    await sleep(300);
    check(!shown(doc.getElementById("toolbar-menubar")), "the menu bar shows");
    check(shell.focusedRegion == "sidebar", `focus moved to ${deepActive()?.id || deepActive()?.localName}`);
    """)


@test
def tabs_addresses_and_session_restore_still_work(b):
    b.js("""
    await onlyBlankTab();
    let host = new URL(PAGES).host;
    // The urlbar is hidden, but Firefox code still loads through it.
    let tab = await openPage("Before");
    win.gURLBar.value = pageURL("Typed");
    win.gURLBar.handleCommand();
    await wait(() => tab.linkedBrowser.contentTitle == "Typed", "the typed address to load");
    check((await urlShown()) == `${host}/page/Typed`, await urlShown());
    await listMatchesGBrowser();

    // Closing a tab and bringing it back, with its history.
    let { SessionStore } = win;
    win.gBrowser.removeTab(tab, { animate: false });
    await wait(() => SessionStore.getClosedTabDataForWindow(win)[0]?.title == "Typed", "the closed tab to be kept");
    let restored = SessionStore.undoCloseTab(win, 0);
    await wait(() => restored.linkedBrowser.contentTitle == "Typed", "the tab to come back");
    win.gBrowser.selectedTab = restored;
    check(restored.linkedBrowser.canGoBack, "the restored tab lost its history");
    await listMatchesGBrowser();
    let state = SessionStore.getWindowState(win).windows[0];
    check(state.tabs.some(t => t.entries.some(e => e.url == pageURL("Typed"))), "the session lacks the tab");
    """)


@test
def the_new_tab_button_opens_the_new_tab_page(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Before new");
    let button = tabList().newTabButton;
    check((await named(button)) == "New tab", accessibleName(button));
    button.focus();
    button.click();
    check(win.gBrowser.tabs.length == 3, "no tab opened");
    let tab = win.gBrowser.selectedTab;
    check(tab == win.gBrowser.tabs.at(-1), "the new tab is not selected");
    let page = await wait(() => newTabPageOf(tab), "the new tab page");
    check(tab.linkedBrowser.currentURI.spec == "about:newtab", tab.linkedBrowser.currentURI.spec);
    check(!commandBar.isOpen, "the Command bar opened");
    await wait(() => page.shadowRoot.activeElement == page.input, "the page's input to take focus");
    """)


@test
def cmd_l_loads_what_is_typed_in_the_current_tab(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Edit");
    win.gBrowser.selectedBrowser.focus();
    check(!commandBar.isOpen && !shown(win.gURLBar), "the Command bar shows before ⌘L");
    """)
    b.keys((ACCEL, "l"))
    b.js("""
    await wait(() => commandBarShown(), "the Command bar");
    let urlbar = win.gURLBar;
    check(commandBar.mode == "current", commandBar.mode);
    check(urlbar.value == pageURL("Edit"), urlbar.value);
    check(urlbar.selectionStart == 0 && urlbar.selectionEnd == urlbar.value.length, "the address is not selected");
    // A floating card over the page, the results right under the input.
    let bar = urlbar.getBoundingClientRect();
    let page = win.gBrowser.tabbox.getBoundingClientRect();
    check(bar.top > page.top && bar.bottom < page.bottom && bar.width >= 400, `the bar at ${JSON.stringify(bar)}`);
    let said = await commandBarTextWithFooter();
    check(said.placeholder == null && said.mode == "This tab", JSON.stringify(said));
    check(said.footer.endsWith("Opens in this tab"), said.footer);
    """)
    # What to type shows once the address is cleared.
    b.keys(Keys.BACK_SPACE)
    b.js("""
    await wait(() => commandBarText().placeholder == "Edit the address or ask", "what to type");
    """)
    b.keys(*f"{b.pages}/page/Edited", Keys.ENTER)
    b.js("""
    await wait(() => win.gBrowser.selectedBrowser.contentTitle == "Edited", "the typed address to load");
    await wait(() => !commandBar.isOpen, "the Command bar to close");
    check(win.gBrowser.tabs.length == 2, `${win.gBrowser.tabs.length} tabs`);
    check(!shown(win.gURLBar) && !shown(commandBar.scrim), "the Command bar still shows");
    await listMatchesGBrowser();
    """)


@test
def cmd_t_opens_a_tab_only_on_enter(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Stay");
    win.gBrowser.selectedBrowser.focus();
    """)
    b.keys((ACCEL, "t"))
    b.js("""
    await wait(() => commandBarShown(), "the Command bar");
    check(commandBar.mode == "new" && win.gURLBar.value == "", `${commandBar.mode}: ${win.gURLBar.value}`);
    check(win.gBrowser.tabs.length == 2, "⌘T opened a tab");
    // Its words are Orbito's strings in the page, the keys drawn as chips;
    // none come from CSS.
    let said = await commandBarTextWithFooter();
    check(said.placeholder == "Search, enter an address, or ask", said.placeholder);
    check(said.mode == "New tab", said.mode);
    check(said.keys.join(" ") == "↑ ↓ ↵ esc", said.keys.join(" "));
    check(/Select.*Open.*Close.*Opens in a new tab$/.test(said.footer), said.footer);
    let kbd = win.getComputedStyle(win.gURLBar.panel.querySelector(".orbito-command-bar-footer kbd"));
    check(kbd.fontSize == "11px" && kbd.borderTopLeftRadius == "4px" && kbd.paddingInlineStart == "5px",
      `a key chip at ${kbd.fontSize}, ${kbd.borderTopLeftRadius}, ${kbd.paddingInlineStart}`);
    for (let [el, pseudo] of [
      [win.gURLBar.querySelector(".urlbar-input-box"), "::after"],
      [win.gURLBar.querySelector(".urlbar-input-container"), "::after"],
      [win.gURLBar.panel, "::before"],
      [win.gURLBar.panel, "::after"],
    ]) {
      let content = win.getComputedStyle(el, pseudo).content;
      check(content == "none" || content == "normal", `${el.className}${pseudo}: ${content}`);
    }
    """)
    b.keys(*"typed then dropped", Keys.ESCAPE)
    b.js("""
    await wait(() => !commandBar.isOpen, "the Command bar to close");
    check(win.gBrowser.tabs.length == 2, "Escape left a tab");
    check(win.gBrowser.selectedBrowser.contentTitle == "Stay", "the tab moved");
    check(!win.gBrowser.userTypedValue && win.gURLBar.value == pageURL("Stay"), `the urlbar kept ${win.gURLBar.value}`);
    check(deepActive() == win.gBrowser.selectedBrowser, `focus went to ${deepActive()?.localName}`);
    """)
    b.keys((ACCEL, "t"))
    b.js('await wait(() => commandBarShown(), "the Command bar");')
    b.keys(*f"{b.pages}/page/Opened", Keys.ENTER)
    b.js("""
    await wait(() => win.gBrowser.tabs.length == 3, "a new tab");
    let opened = win.gBrowser.selectedTab;
    check(opened == win.gBrowser.tabs.at(-1), "the new tab is not selected");
    await wait(() => opened.linkedBrowser.contentTitle == "Opened", "the address to load in it");
    await wait(() => !commandBar.isOpen, "the Command bar to close");
    check(byLabel("Stay"), "the first tab moved");
    await listMatchesGBrowser();
    """)


@test
def the_command_bar_shows_the_urlbar_result_groups(b):
    b.js("""
    await onlyBlankTab();
    // History (of a closed tab, or it would be a switch-to-tab result), a
    // bookmark, and an engine whose suggestions come from PAGES.
    win.gBrowser.removeTab(await openPage("Zebra visited"), { animate: false });
    let { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    await PlacesUtils.bookmarks.insert({
      parentGuid: PlacesUtils.bookmarks.unfiledGuid,
      url: pageURL("Kept"),
      title: "Zebra bookmarked",
    });
    let { SearchService: search } = ChromeUtils.importESModule(
      "moz-src:///toolkit/components/search/SearchService.sys.mjs"
    );
    let engine = await search.addUserEngine({
      name: "Zebra engine",
      url: `${PAGES}/page/search?q={searchTerms}`,
      suggestUrl: `${PAGES}/suggest?q={searchTerms}`,
    });
    let previous = await search.getDefault();
    await search.setDefault(engine, search.CHANGE_REASON.USER);
    Services.prefs.setBoolPref("browser.urlbar.suggest.searches", true);
    win.gBrowser.selectedBrowser.focus();
    win.testState = { search, engine, previous };
    """)
    try:
        b.keys((ACCEL, "l"))
        b.js('await wait(() => commandBarShown(), "the Command bar");')
        b.keys(*"zebra")
        b.js("""
        await resultWhere(r => r.kind == "history" && r.result.payload.url == pageURL("Zebra visited"), "the history result");
        await resultWhere(r => r.kind == "bookmarks" && r.result.payload.url == pageURL("Kept"), "the bookmark");
        await resultWhere(r => r.kind == "search" && r.result.payload.suggestion == "zebra one", "a search suggestion");
        await resultWhere(r => r.kind == "ask", "Ask Orbito");
        let results = await commandBarResults();
        // The view is the urlbar's own, right under the input (its background
        // reaches a little past the input on the sides).
        let bar = win.gURLBar.getBoundingClientRect();
        for (let { row } of results) {
          let r = row.getBoundingClientRect();
          check(
            r.top >= bar.bottom - 1 && r.left >= bar.left - 16 && r.right <= bar.right + 16,
            `a row at ${JSON.stringify(r)}, the bar at ${JSON.stringify(bar)}`
          );
        }
        check(results[0].result.heuristic, "the first result is not the heuristic one");
        """)
    finally:
        b.js("""
        closeCommandBar();
        let { search, engine, previous } = win.testState;
        await search.setDefault(previous, search.CHANGE_REASON.USER);
        await search.removeEngine(engine);
        Services.prefs.clearUserPref("browser.urlbar.suggest.searches");
        let { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
        await PlacesUtils.bookmarks.eraseEverything();
        """)


@test
def the_command_bar_rows_look_like_the_design(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Zebra open");
    await openPage("Rows");
    win.gBrowser.selectedBrowser.focus();
    """)
    b.keys((ACCEL, "l"))
    b.js("""
    await wait(() => commandBarShown(), "the Command bar");
    // It fades and pops in, unless motion is reduced.
    check(win.getComputedStyle(commandBar.scrim).animationName == "orbito-command-bar-fade",
      win.getComputedStyle(commandBar.scrim).animationName);
    check(win.getComputedStyle(win.gURLBar).animationName == "orbito-command-bar-pop-in",
      win.getComputedStyle(win.gURLBar).animationName);
    """)
    b.keys(*"zebra")
    b.js("""
    let tab = (await resultWhere(r => r.row.getAttribute("type") == "switchtab", "the open tab")).row;
    let ask = (await resultWhere(r => r.kind == "ask", "Ask Orbito")).row;
    let search = (await resultWhere(r => r.kind == "search", "the search")).row;
    let hint = row => win.getComputedStyle(row, "::after");
    // Each row says what Enter does with it; the picked one in the accent.
    for (let [row, words] of [[tab, "Switch to tab"], [ask, "Ask"], [search, "Search"]]) {
      check(hint(row).content.startsWith(`"${words}"`), `${row.getAttribute("type")}: ${hint(row).content}`);
      let style = win.getComputedStyle(row);
      let inner = win.getComputedStyle(row.querySelector(".urlbarView-row-inner"));
      check(row.getBoundingClientRect().height >= 38 && style.borderTopLeftRadius == "9px" &&
        inner.paddingTop == "4px" && inner.paddingInlineStart == "10px",
        `a row at ${row.getBoundingClientRect().height}, ${style.borderTopLeftRadius}, ${inner.paddingTop} ${inner.paddingInlineStart}`);
    }
    let selected = win.gURLBar.view.selectedElement.closest(".urlbarView-row");
    let unselected = [tab, ask, search].find(row => row != selected);
    check(hint(selected).fontWeight == "600" && hint(selected).color != hint(unselected).color,
      `the picked row's hint: ${hint(selected).fontWeight} ${hint(selected).color}`);
    check(hint(unselected).fontWeight == "400", hint(unselected).fontWeight);
    // Ask: the accent icon, the text in bold, then what it is.
    check(win.getComputedStyle(ask.querySelector(".urlbarView-favicon")).fill == hint(selected).color,
      win.getComputedStyle(ask.querySelector(".urlbarView-favicon")).fill);
    check(ask.querySelector(".urlbarView-title").textContent == "zebra" &&
      win.getComputedStyle(ask.querySelector(".urlbarView-title")).fontWeight == "600", "the Ask label");
    check(ask.querySelector(".urlbarView-action").textContent == "Ask Orbito" &&
      !shown(ask.querySelector(".urlbarView-title-separator")), "what Ask is");
    // The open tabs come under their own label.
    await wait(() => tab.getAttribute("label") == "Open tabs", `the open tabs' label, not ${tab.getAttribute("label")}`);
    let label = win.getComputedStyle(tab, "::before");
    check(label.fontSize == "11px" && label.fontWeight == "600" && label.letterSpacing == "0.44px",
      `the label at ${label.fontSize} ${label.fontWeight} ${label.letterSpacing}`);
    let view = win.getComputedStyle(win.gURLBar.view.panel);
    let list = win.getComputedStyle(win.gURLBar.view.panel.querySelector(".urlbarView-results"));
    check(parseFloat(list.maxHeight) <= 420 && view.paddingTop == "6px" && list.paddingBottom == "6px",
      `the list: ${list.maxHeight} ${view.paddingTop} ${list.paddingBottom}`);
    // The popover's shadow, all of it.
    let shadow = win.getComputedStyle(win.gURLBar.querySelector(".urlbar-background")).boxShadow;
    check(shadow.includes("24px 60px"), shadow);
    closeCommandBar();
    """)
    # Without motion it just shows.
    b.js("""
    Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
    await wait(() => win.matchMedia("(prefers-reduced-motion: reduce)").matches, "reduced motion");
    """)
    try:
        b.keys((ACCEL, "l"))
        b.js("""
        await wait(() => commandBarShown(), "the Command bar");
        check(win.getComputedStyle(commandBar.scrim).animationName == "none" &&
          win.getComputedStyle(win.gURLBar).animationName == "none", "it moves with reduced motion");
        closeCommandBar();
        """)
    finally:
        b.js('Services.prefs.clearUserPref("ui.prefersReducedMotion");')


def pick_command(b, name):
    """Types the command's name into an open Command bar, arrows down to
    its result and presses Enter."""
    # A page still loading can take focus from the bar, and the keys with it.
    b.js('await wait(() => commandBarShown() && !win.gBrowser.selectedBrowser.webProgress.isLoadingDocument, "the Command bar over a loaded page");')
    b.keys(*name)
    b.js(f"""
    await resultWhere(r => r.kind == "command" && r.result.payload.command == "{name}", "the {name} command")
      .catch(e => {{ throw new Error(`${{e.message}} (typed: ${{win.gURLBar.value}}, focus: ${{deepActive()?.localName}})`); }});
    """)
    for _ in range(10):
        if b.js("return win.gURLBar.view.selectedResult?.payload.command;") == name:
            break
        b.keys(Keys.ARROW_DOWN)
    b.keys(Keys.ENTER)


@test
def settings_and_history_commands_open_their_screens(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Commands");
    """)
    b.keys((ACCEL, "l"))
    pick_command(b, "settings")
    b.js("""
    await wait(() => win.gBrowser.currentURI.spec == "about:orbito-settings", "the settings page");
    await wait(() => !commandBar.isOpen, "the Command bar to close");
    check(byLabel("Commands").linkedBrowser.contentTitle == "Commands", "the page moved");
    // Firefox's own settings action (about:preferences) is not offered.
    let { ActionsProviderQuickActions } = ChromeUtils.importESModule(
      "moz-src:///browser/components/urlbar/ActionsProviderQuickActions.sys.mjs"
    );
    check(ActionsProviderQuickActions.getAction("settings").isUnsupported(), "Firefox's settings action is on");
    """)
    b.keys((ACCEL, "l"))
    pick_command(b, "history")
    b.js("""
    await wait(() => win.gBrowser.currentURI.spec == "about:orbito-timeline", "the timeline");
    await wait(() => !commandBar.isOpen, "the Command bar to close");
    check(byLabel("Commands").linkedBrowser.contentTitle == "Commands", "the page moved");
    """)


@test
def closing_the_command_bar_puts_focus_back(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Focus one");
    await openPage("Focus two");
    await tabList().focusRegion();
    await wait(() => shell.focusedRegion == "sidebar", "the tab list to have focus");
    win.testState = deepActive();
    """)
    # Escape, back to a tab list row.
    b.keys((ACCEL, "l"))
    b.js('await wait(() => commandBarShown(), "the Command bar");')
    b.keys(Keys.ESCAPE)
    b.js("""
    await wait(() => !commandBar.isOpen, "the Command bar to close");
    check(deepActive() == win.testState, `focus went to ${deepActive()?.localName}`);
    win.gBrowser.selectedBrowser.focus();
    """)
    # A click outside the bar, back to the page; nothing under it is clicked.
    b.keys((ACCEL, "t"))
    rect = b.js("""
    await wait(() => commandBarShown(), "the Command bar");
    let row = rowFor(byLabel("Focus one"));
    return middle(row);
    """)
    b.pointer(rect, "down", "up")
    b.js("""
    await wait(() => !commandBar.isOpen, "the Command bar to close");
    check(deepActive() == win.gBrowser.selectedBrowser, `focus went to ${deepActive()?.localName}`);
    check(win.gBrowser.selectedTab == byLabel("Focus two"), "the click went through to the tab list");
    check(win.gBrowser.tabs.length == 3, "a tab opened");
    """)


@test
def the_command_bar_follows_the_keyboard_rules(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Keys");
    win.OrbitoAssistant.toggle(false);
    win.gBrowser.selectedBrowser.focus();
    """)
    b.keys((ACCEL, "t"))
    b.keys(*"keys")
    b.js("""
    await wait(() => commandBarShown(), "the Command bar");
    let input = win.gURLBar.inputField;
    check(await named(input), "the input has no name");
    let a11y = Cc["@mozilla.org/accessibilityService;1"].getService(Ci.nsIAccessibilityService);
    let description = a11y.getAccessibleFor(input).description;
    check(description == "Opens in a new tab", `the input's description: ${description}`);
    await wait(async () => (await commandBarResults()).length >= 2, "results");
    check(win.gURLBar.view.selectedRowIndex == 0, `row ${win.gURLBar.view.selectedRowIndex} is selected`);
    """)
    # Arrows move the selection, which shows.
    b.keys(Keys.DOWN)
    b.js("""
    let view = win.gURLBar.view;
    check(view.selectedRowIndex == 1, `row ${view.selectedRowIndex} is selected`);
    let row = view.selectedElement.closest(".urlbarView-row");
    check(row.hasAttribute("selected"), "the selected row is not marked");
    let style = win.getComputedStyle(row);
    check(style.backgroundColor != "rgba(0, 0, 0, 0)", "the selected row looks the same");
    check(win.gURLBar.inputField.getAttribute("aria-activedescendant"), "the selection is not announced");
    """)
    b.keys(Keys.UP)
    # Any focus into the urlbar opens it, so it is never typed into unseen.
    b.js("""
    closeCommandBar();
    win.gURLBar.focus();
    check(commandBarShown() && commandBar.mode == "current", "focusing the urlbar left it hidden");
    """)
    # F6 moves on to the page, which closes it.
    b.keys(Keys.F6)
    b.js("""
    await wait(() => !commandBar.isOpen, "the Command bar to close");
    check(shell.focusedRegion == "page", `focus is in ${shell.focusedRegion}`);
    """)


def top_bar_point(b, name):
    """The middle of a Top bar part, in the window's CSS pixels."""
    return b.js(f"await shell.topBar.updateComplete; return middle(shell.topBar.{name});")


@test
def the_top_bar_holds_its_buttons_and_the_url_display_fills_the_rest(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Bar");
    let bar = shell.topBar;
    // Stop stands in for Reload until the page has finished loading.
    await wait(() => bar.reloadButton && !bar.reloadButton.hasAttribute("stop"), "the page to finish loading");
    await bar.updateComplete;
    let names = [];
    for (let el of bar.controls) {
      names.push(await named(el));
    }
    check(names.join(" | ") == "Back | Forward | Reload | Site information | Address | Extensions | Ask", names.join(" | "));
    // The URL display takes what the buttons leave.
    let used = [...bar.renderRoot.children, ...bar.children]
      .filter(el => el.localName != "link" && el.localName != "slot" && shown(el))
      .reduce((sum, el) => sum + el.getBoundingClientRect().width, 0);
    let free = bar.getBoundingClientRect().width - used;
    check(free < 40, `${free}px of the Top bar is unused`);
    check(bar.urlDisplay.getBoundingClientRect().width > 300, "the URL display is narrow");
    // The reader view button follows Firefox's.
    let reader = doc.getElementById("reader-mode-button");
    reader.hidden = false;
    try {
      await wait(() => bar.readerButton, "the reader view button");
      check((await named(bar.readerButton)) == "Reader view", accessibleName(bar.readerButton));
      check(bar.controls.indexOf(bar.readerButton) == 5, "the reader view button is out of place");
      reader.setAttribute("readeractive", "true");
      await wait(() => bar.readerButton.getAttribute("aria-pressed") == "true", "reader view to show as on");
    } finally {
      reader.removeAttribute("readeractive");
      reader.hidden = true;
    }
    await wait(() => !bar.readerButton, "the reader view button to go");
    """)


@test
def pressing_the_url_display_opens_the_command_bar(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Press");
    win.gBrowser.selectedBrowser.focus();
    """)
    url = top_bar_point(b, "urlDisplay")
    b.pointer(url, "down", 80, "up")
    b.js("""
    await wait(() => commandBarShown(), "the Command bar");
    check(commandBar.mode == "current", commandBar.mode);
    check(win.gURLBar.value == pageURL("Press"), win.gURLBar.value);
    """)
    b.keys(Keys.ESCAPE)
    b.js("""
    await wait(() => !commandBar.isOpen, "the Command bar to close");
    check(deepActive() == win.gBrowser.selectedBrowser, `focus went to ${deepActive()?.localName}`);
    """)

    # A drag that moves the pointer, whether or not the window can follow,
    # is no click.
    x, y = url
    b.drag((x, y), (x + 40, y + 12))
    b.js("""
    await sleep(300);
    check(!commandBar.isOpen, "dragging opened the Command bar");
    """)

    # The window moving while pressed (the OS drags it) is no click either,
    # however little the pointer moved, on macOS (mousedown) and Windows
    # (only draggableregionleftmousedown, without a position).
    b.pointer(url)
    b.js("""
    let bar = shell.topBar;
    let [x, y] = middle(bar.urlDisplay);
    // Mouse events as the platform sends them: the press on the URL
    // display, the release on the window, at window screen offsets.
    let mouse = (type, target, dx = 0, dy = 0) => target.dispatchEvent(new win.MouseEvent(type, {
      bubbles: true, composed: true, button: 0, buttons: type == "mousedown" ? 1 : 0,
      clientX: x + dx, clientY: y + dy,
      screenX: win.mozInnerScreenX + x + dx, screenY: win.mozInnerScreenY + y + dy,
    }));
    let [left, top] = [win.screenX, win.screenY];
    let moved = async () => {
      win.moveTo(left + 30, top + 20);
      await wait(() => win.screenX != left || win.screenY != top, "the window to move");
    };
    let back = async () => {
      win.moveTo(left, top);
      await wait(() => win.screenX == left && win.screenY == top, "the window to move back");
    };
    check(bar.urlDisplay.matches(":hover"), "the pointer is not over the URL display");
    try {
      mouse("mousedown", bar.urlDisplay);
      await moved();
      mouse("mouseup", doc.documentElement, 30, 20);
      await sleep(200);
      check(!commandBar.isOpen, "moving the window opened the Command bar (mousedown)");
      await back();

      win.dispatchEvent(new win.CustomEvent("draggableregionleftmousedown"));
      await moved();
      mouse("mouseup", doc.documentElement, -x, -y);
      await sleep(200);
      check(!commandBar.isOpen, "moving the window opened the Command bar (drag region)");
      await back();

      // A Windows press that stays put is a click, though its mouseup has
      // no position.
      win.dispatchEvent(new win.CustomEvent("draggableregionleftmousedown"));
      mouse("mouseup", doc.documentElement, -x, -y);
      await wait(() => commandBarShown(), "the Command bar from the drag region press");
    } finally {
      closeCommandBar();
      await back();
    }
    """)
    # A drag region press elsewhere on the bar is not one on the URL display.
    b.pointer(top_bar_point(b, "askButton"))
    b.js("""
    check(!shell.topBar.urlDisplay.matches(":hover"), "the pointer is still over the URL display");
    win.dispatchEvent(new win.CustomEvent("draggableregionleftmousedown"));
    doc.documentElement.dispatchEvent(new win.MouseEvent("mouseup", { bubbles: true, button: 0 }));
    await sleep(200);
    check(!commandBar.isOpen, "a press off the URL display opened the Command bar");
    """)


@test
def the_top_bar_follows_the_keyboard_rules(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Bar keys");
    win.OrbitoAssistant.toggle(false);
    win.gBrowser.selectedBrowser.focus();
    await wait(() => shell.focusedRegion == "page", "the page to have focus");
    """)
    b.keys((Keys.SHIFT, Keys.F6))
    b.js("""
    let bar = shell.topBar;
    await wait(() => deepActive() == bar.urlDisplay, "focus on the URL display");
    check(bar.urlDisplay.matches(":focus-visible"), "the URL display shows no focus");
    check(bar.controls.filter(el => el.tabIndex == 0).length == 1, "the Top bar is not one tab stop");
    """)
    b.keys(Keys.ARROW_RIGHT)
    b.js("""
    let bar = shell.topBar;
    await wait(() => deepActive() == bar.extensionsButton, "focus on the extensions button");
    check(bar.extensionsButton.matches(":focus-visible"), "the extensions button shows no focus");
    """)
    b.keys(Keys.END)
    b.js('await wait(() => deepActive() == shell.topBar.askButton, "End to go to Ask");')
    b.keys(Keys.HOME)
    b.js("""
    let bar = shell.topBar;
    await wait(() => deepActive() == bar.backButton, "Home to go to Back");
    """)
    b.keys(Keys.ARROW_RIGHT, Keys.ARROW_RIGHT, Keys.ARROW_RIGHT)
    b.js("""
    let bar = shell.topBar;
    await wait(() => deepActive() == bar.siteInfoButton, "Right to go to site information");
    await bar.updateComplete;
    check(bar.siteInfoButton.tabIndex == 0 && bar.urlDisplay.tabIndex == -1, "the tab stop did not follow focus");
    """)
    # Enter on the URL display opens the Command bar; Escape comes back.
    b.keys(Keys.ARROW_RIGHT, Keys.ENTER)
    b.js('await wait(() => commandBarShown(), "the Command bar");')
    b.keys(Keys.ESCAPE)
    b.js("""
    await wait(() => !commandBar.isOpen, "the Command bar to close");
    check(deepActive() == shell.topBar.urlDisplay, `focus went to ${deepActive()?.localName}`);
    """)


@test
def back_forward_and_reload_run_firefoxs_commands(b):
    b.js("""
    await onlyBlankTab();
    let tab = await openPage("Nav one");
    let bar = shell.topBar;
    await bar.updateComplete;
    let off = el => el.getAttribute("aria-disabled") == "true";
    check(off(bar.backButton) && off(bar.forwardButton), "Back or Forward on with one page");
    for (let title of ["Nav two", "Nav three"]) {
      win.openTrustedLinkIn(pageURL(title), "current");
      await wait(() => tab.linkedBrowser.contentTitle == title, title);
    }
    await wait(() => !off(bar.backButton), "Back to come on");
    check(off(bar.forwardButton), "Forward on at the last page");
    // They follow Firefox's commands.
    check(doc.getElementById("Browser:Back").hasAttribute("disabled") == off(bar.backButton), "Back and Browser:Back differ");
    check(doc.getElementById("Browser:Forward").hasAttribute("disabled") == off(bar.forwardButton), "Forward and Browser:Forward differ");
    """)
    b.pointer(top_bar_point(b, "backButton"), "down", 60, "up")
    b.js("""
    let tab = win.gBrowser.selectedTab;
    let bar = shell.topBar;
    let off = el => el.getAttribute("aria-disabled") == "true";
    await wait(() => tab.linkedBrowser.contentTitle == "Nav two", "Back to go back");
    await wait(() => !off(bar.forwardButton), "Forward to come on");

    // A middle click opens the page that way in a new tab.
    bar.forwardButton.dispatchEvent(new win.MouseEvent("auxclick", { bubbles: true, button: 1 }));
    let opened = await wait(() => win.gBrowser.tabs.find(t => t != tab && t.linkedBrowser.contentTitle == "Nav three"), "Forward in a new tab");
    check(tab.linkedBrowser.contentTitle == "Nav two", "the tab itself went forward");
    win.gBrowser.removeTab(opened);
    win.gBrowser.selectedTab = tab;

    // Right-click: Firefox's history menu, which goes where it is told.
    let menu = doc.getElementById("backForwardMenu");
    let [x, y] = middle(bar.backButton);
    bar.backButton.dispatchEvent(new win.MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, button: 2,
      clientX: x, clientY: y, screenX: win.mozInnerScreenX + x, screenY: win.mozInnerScreenY + y,
    }));
    await wait(() => menu.state == "open", "the history menu");
    let items = [...menu.querySelectorAll("menuitem[index]")];
    check(items.map(i => i.label).join(" | ") == "Nav three | Nav two | Nav one", items.map(i => i.label).join(" | "));
    let hidden = new Promise(resolve => menu.addEventListener("popuphidden", resolve, { once: true }));
    menu.activateItem(items[2]);
    await hidden;
    await wait(() => tab.linkedBrowser.contentTitle == "Nav one", "the menu to go back two pages");
    await wait(() => off(bar.backButton), "Back to go off at the first page");
    """)
    # A long press on Forward opens the menu and does not go forward.
    b.pointer(top_bar_point(b, "forwardButton"), "down", 800, "up")
    b.js("""
    let tab = win.gBrowser.selectedTab;
    let menu = doc.getElementById("backForwardMenu");
    await wait(() => menu.state == "open", "the history menu from a long press");
    await sleep(300);
    check(tab.linkedBrowser.contentTitle == "Nav one", "the long press also went forward");
    let hidden = new Promise(resolve => menu.addEventListener("popuphidden", resolve, { once: true }));
    menu.hidePopup();
    await hidden;
    """)
    # Reload loads the page again; it is Stop while the page loads.
    b.js("""
    let tab = win.gBrowser.selectedTab;
    let bar = shell.topBar;
    win.openTrustedLinkIn(`${PAGES}/count`, "current");
    let first = await wait(() => /^Count \\d+$/.test(tab.linkedBrowser.contentTitle) && tab.linkedBrowser.contentTitle, "the count page");
    let n = +first.split(" ")[1];
    await wait(() => bar.reloadButton.getAttribute("aria-disabled") == "false", "Reload to come on");
    check((await named(bar.reloadButton)) == "Reload", accessibleName(bar.reloadButton));
    bar.reloadButton.click();
    // Its icon turns once (twice the long motion), and stays Reload's while
    // it does.
    await bar.updateComplete;
    check(bar.reloadButton.hasAttribute("spin"), "Reload's icon does not turn");
    let turn = win.getComputedStyle(bar.reloadButton.querySelector("svg"));
    check(turn.animationName == "reload-spin" && turn.animationDuration == motionSeconds("long", 2), `the turn: ${turn.animationName} ${turn.animationDuration}`);
    await wait(() => tab.linkedBrowser.contentTitle == `Count ${n + 1}`, "Reload to load the page again");
    await wait(() => !bar.reloadButton.hasAttribute("spin"), "the turn to end", 2000);

    win.openTrustedLinkIn(`${PAGES}/slow/Slow?seconds=30`, "current");
    await wait(() => bar.reloadButton?.hasAttribute("stop"), "Stop while the page loads");
    await wait(() => accessibleName(bar.reloadButton) == "Stop", "the name Stop");
    check(bar.reloadButton.getAttribute("aria-disabled") == "false", "Stop is off");
    bar.reloadButton.click();
    await wait(() => !tab.linkedBrowser.webProgress.isLoadingDocument, "Stop to stop the load", 5000);
    await wait(() => !bar.reloadButton.hasAttribute("stop"), "Reload to come back");
    await wait(() => accessibleName(bar.reloadButton) == "Reload", "the name Reload");
    check(bar.reloadButton.getAttribute("aria-disabled") == "false", "Reload is off after Stop");
    """)


@test
def the_navigation_buttons_follow_the_keyboard_rules(b):
    b.js("""
    await onlyBlankTab();
    let tab = await openPage("Keys one");
    win.openTrustedLinkIn(pageURL("Keys two"), "current");
    await wait(() => tab.linkedBrowser.contentTitle == "Keys two", "the second page");
    await wait(() => shell.topBar.backButton.getAttribute("aria-disabled") == "false", "Back to come on");
    win.OrbitoAssistant.toggle(false);
    win.gBrowser.selectedBrowser.focus();
    await wait(() => shell.focusedRegion == "page", "the page to have focus");
    """)
    b.keys((Keys.SHIFT, Keys.F6), Keys.HOME)
    b.js("""
    let bar = shell.topBar;
    await wait(() => deepActive() == bar.backButton, "Home to go to Back");
    check(bar.backButton.matches(":focus-visible"), "Back shows no focus");
    check((await named(bar.backButton)) == "Back", accessibleName(bar.backButton));
    """)
    # Enter goes back; Back, now off, keeps focus.
    b.keys(Keys.ENTER)
    b.js("""
    let bar = shell.topBar;
    await wait(() => win.gBrowser.selectedBrowser.contentTitle == "Keys one", "Enter to go back");
    await wait(() => bar.backButton.getAttribute("aria-disabled") == "true", "Back to go off");
    check(deepActive() == bar.backButton, `focus went to ${deepActive()?.localName}`);
    """)
    # Shift+F10 on Forward opens the history menu.
    b.keys(Keys.ARROW_RIGHT)
    b.js("""
    let bar = shell.topBar;
    await wait(() => deepActive() == bar.forwardButton, "Right to go to Forward");
    check(bar.forwardButton.matches(":focus-visible"), "Forward shows no focus");
    check((await named(bar.forwardButton)) == "Forward", accessibleName(bar.forwardButton));
    """)
    b.keys((Keys.SHIFT, Keys.F10))
    b.js("""
    let menu = doc.getElementById("backForwardMenu");
    await wait(() => menu.state == "open", "the history menu");
    let hidden = new Promise(resolve => menu.addEventListener("popuphidden", resolve, { once: true }));
    menu.hidePopup();
    await hidden;
    shell.topBar.forwardButton.focus({ focusVisible: true });
    """)
    b.keys(Keys.ARROW_RIGHT)
    b.js("""
    let bar = shell.topBar;
    await wait(() => deepActive() == bar.reloadButton, "Right to go to Reload");
    check(bar.reloadButton.matches(":focus-visible"), "Reload shows no focus");
    check((await named(bar.reloadButton)) == "Reload", accessibleName(bar.reloadButton));
    """)
    b.keys(Keys.ARROW_RIGHT)
    b.js('await wait(() => deepActive() == shell.topBar.siteInfoButton, "Right to go on to site information");')
    b.keys(Keys.F6)
    b.js('await wait(() => shell.focusedRegion == "page", "F6 to go on to the page");')


@test
def the_ask_button_shows_whether_the_assistant_panel_is_open(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Ask");
    win.OrbitoAssistant.toggle(false);
    let ask = shell.topBar.askButton;
    await shell.topBar.updateComplete;
    check((await named(ask)) == "Ask", accessibleName(ask));
    check(ask.getAttribute("aria-pressed") == "false", "closed but pressed");
    let closed = win.getComputedStyle(ask);
    let [closedBackground, closedShadow, closedColor] =
      [closed.backgroundColor, closed.boxShadow, closed.color];
    let accent = win.getComputedStyle(doc.documentElement).getPropertyValue("--orbito-accent");
    check(closedShadow.includes("inset"), `closed: ${closedShadow}`);
    check(ask.getBoundingClientRect().height / 2 <= parseFloat(closed.borderTopLeftRadius), "closed: not a pill");

    ask.click();
    await wait(() => win.OrbitoAssistant.isOpen, "the Assistant panel to open");
    await wait(() => ask.getAttribute("aria-pressed") == "true", "Ask to show as pressed");
    let open = win.getComputedStyle(ask);
    // After the transition.
    await wait(() => open.backgroundColor != closedBackground && open.color != closedColor, "open looks like closed");
    check(!open.boxShadow.includes("inset") && open.boxShadow != "none", `open: ${open.boxShadow}`);

    win.OrbitoAssistant.toggle(false);
    await wait(() => ask.getAttribute("aria-pressed") == "false", "Ask to show as closed");
    """)


@test
def the_ask_button_opens_and_closes_the_assistant_panel_on_the_frame(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Panel");
    core.newThread(win);
    await resetAssistant();
    let page = () => win.gBrowser.tabbox.getBoundingClientRect();
    let closedPage = page();
    shell.topBar.askButton.click();
    // It widens as its content slides in.
    check(assistant.getAttribute("motion") == "open", "the panel did not move in");
    await wait(() => win.OrbitoAssistant.isOpen && shown(assistant), "the panel to open");
    await wait(() => !assistant.hasAttribute("motion"), "the panel's motion");
    await wait(() => shell.topBar.askButton.getAttribute("aria-pressed") == "true", "Ask to show as pressed");
    await wait(() => assistant.matches(":focus-within") && deepActive() == assistant.input, "focus in the input");
    let box = assistant.getBoundingClientRect();
    let topBar = shell.topBar.getBoundingClientRect();
    let body = doc.body.getBoundingClientRect();
    check(box.width == 340, `width ${box.width}`);
    check(box.left >= page().right && page().width < closedPage.width, `panel at ${JSON.stringify(box)}, page at ${JSON.stringify(page())}`);
    check(Math.abs(body.right - 8 - box.right) < 1 && Math.abs(body.bottom - box.bottom) < 1, `panel at ${JSON.stringify(box)}`);
    // On the frame: no card of its own.
    let style = win.getComputedStyle(assistant);
    check(style.boxShadow == "none" && style.backgroundColor == "rgba(0, 0, 0, 0)", `${style.boxShadow} ${style.backgroundColor}`);
    if (AppConstants.platform == "macosx") {
      // Under the Top bar, which spans over it.
      check(box.top >= topBar.bottom && topBar.right >= box.right, `Top bar at ${JSON.stringify(topBar)}`);
      check(!assistant.full && !shown(assistant.renderRoot.querySelector(".window-bar")), "a window bar on macOS");
    } else if (doc.documentElement.hasAttribute("customtitlebar")) {
      // Full height, with the window controls at its top.
      let controls = doc.getElementById("orbito-window-controls");
      check(assistant.full && controls.parentNode == assistant && controls.assignedSlot?.name == "window-controls", "the window controls are not in the panel");
      check(box.top <= body.top + 1 && topBar.right <= box.left + 1, `panel at ${JSON.stringify(box)}, Top bar at ${JSON.stringify(topBar)}`);
      check(controls.getBoundingClientRect().top <= 1, "the window controls are not at the top");
    }
    check(assistant.heading.textContent == "New Thread", assistant.heading.textContent);

    shell.topBar.askButton.click();
    // Closed at once, hidden once it has moved out.
    check(!win.OrbitoAssistant.isOpen && assistant.getAttribute("motion") == "close", "the panel did not move out");
    await wait(() => !win.OrbitoAssistant.isOpen && !shown(assistant), "the panel to close");
    await wait(() => shell.topBar.askButton.getAttribute("aria-pressed") == "false", "Ask to show as closed");
    check(page().width == closedPage.width, "the page did not take the room back");
    check(shell.focusedRegion == "page", `focus went to ${shell.focusedRegion}`);
    if (AppConstants.platform != "macosx") {
      let controls = doc.getElementById("orbito-window-controls");
      check(controls.parentNode == shell.topBar && !assistant.full, "the window controls did not go back");
    }
    """)


@test
def the_session_settings_pick_the_context_and_start_or_find_threads(b):
    b.js("""
    await onlyBlankTab();
    let tab = await openPage("Session");
    await resetAssistant();
    await openAssistant();
    assistant.sessionButton.click();
    await assistant.updateComplete;
    let menu = assistant.sessionMenu;
    check(shown(menu) && assistant.sessionButton.getAttribute("aria-expanded") == "true", "the menu did not open");
    let thisTab = menuItem(menu, "This tab");
    let allTabs = menuItem(menu, "All open tabs");
    check(thisTab.getAttribute("aria-checked") == "true" && allTabs.getAttribute("aria-checked") == "false", "This tab is not picked");
    // Picked: a check on an accent background.
    let pick = el => el.querySelector(".pick");
    check(win.getComputedStyle(pick(thisTab)).visibility == "visible" && win.getComputedStyle(pick(allTabs)).visibility == "hidden", "no check");
    check(win.getComputedStyle(thisTab).backgroundColor != win.getComputedStyle(allTabs).backgroundColor, "no accent background");
    allTabs.click();
    await assistant.updateComplete;
    check(assistant.context == "tabs" && !shown(menu), `context ${assistant.context}`);
    assistant.sessionButton.click();
    await assistant.updateComplete;
    check(menuItem(menu, "All open tabs").getAttribute("aria-checked") == "true", "the pick is not shown");
    // A press outside closes it.
    assistant.log.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true, composed: true }));
    await assistant.updateComplete;
    check(!shown(menu), "the menu stayed open");

    // New Thread keeps a Thread nothing was asked in yet.
    let before = core.threadFor(win);
    assistant.sessionButton.click();
    await assistant.updateComplete;
    menuItem(menu, "New Thread").click();
    check(core.threadFor(win) == before, "another Thread for an empty one");
    // The Thread list, and from it the library.
    assistant.sessionButton.click();
    await assistant.updateComplete;
    menuItem(menu, "Thread list").click();
    await wait(() => assistant.view == "threads" && shown(assistant.threadsView), "the Thread list");
    assistant.libraryButton.click();
    await wait(() => win.gBrowser.selectedBrowser.currentURI.spec == "about:orbito-library", "the library");
    await resetAssistant();
    """)


@test
def context_model_and_thinking_depth_go_into_the_question(b):
    b.js("""
    await onlyBlankTab();
    let tab = await openPage("Request");
    await resetAssistant();
    await openAssistant();
    let asked = [];
    let ask = core.ask;
    core.ask = async options => { asked.push(options); };
    try {
      // The defaults: this tab, the backend's model, medium.
      assistant.input.value = "First";
      assistant.input.dispatchEvent(new win.InputEvent("input"));
      await assistant.updateComplete;
      assistant.sendButton.click();
      let shownAs = o => JSON.stringify({ ...o, origin: undefined, confirm: undefined });
      let first = asked.at(-1);
      check(first?.prompt == "First" && first.origin.tab == tab, shownAs(first));
      check(first.backend == core.backend && first.model == core.model(core.backend) && first.instructions == null, shownAs(first));
      check(first.threadId == core.threadFor(win), "another thread");

      // All open tabs, another backend, high.
      assistant.sessionButton.click();
      await assistant.updateComplete;
      menuItem(assistant.sessionMenu, "All open tabs").click();
      assistant.modelButton.click();
      await assistant.updateComplete;
      let menu = assistant.modelMenu;
      check(shown(menu), "the model menu did not open");
      menu.querySelector('[data-backend="openai"]').click();
      await assistant.updateComplete;
      check(core.backend == "openai" && !shown(menu), "the backend was not picked");
      assistant.modelButton.click();
      await assistant.updateComplete;
      let high = menu.querySelector('[data-effort="high"]');
      high.click();
      await assistant.updateComplete;
      check(high.getAttribute("aria-checked") == "true" && shown(menu), "the depth was not picked");
      check(assistant.modelButton.textContent.includes(core.model("openai")) && assistant.modelButton.textContent.includes("High"), assistant.modelButton.textContent);
      assistant.closeMenu();
      assistant.input.value = "Second";
      assistant.input.dispatchEvent(new win.InputEvent("input"));
      assistant.input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      let second = asked.at(-1);
      check(second?.prompt == "Second" && second.backend == "openai" && second.model == core.model("openai"), shownAs(second));
      check(second.context == "tabs" && second.instructions.includes("open tabs listed") && second.instructions.includes("think tool"), second.instructions);
      check(Services.prefs.getStringPref("orbito.assistant.effort") == "high", "the depth is not kept");

      // No tab.
      assistant.context = "none";
      assistant.submit("Third");
      check(asked.at(-1).instructions.startsWith("The user shares no tab"), asked.at(-1).instructions);
    } finally {
      core.ask = ask;
      await resetAssistant();
    }
    """)


@test
def the_send_button_is_dim_without_words_and_stops_a_reply(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Send");
    await resetAssistant();
    await openAssistant();
    let send = () => assistant.sendButton;
    assistant.input.value = "";
    assistant.input.dispatchEvent(new win.InputEvent("input"));
    await assistant.updateComplete;
    check(send().disabled && (await named(send())) == "Send", `${send().disabled} ${accessibleName(send())}`);
    let dim = win.getComputedStyle(send()).backgroundColor;
    assistant.input.value = "   ";
    assistant.input.dispatchEvent(new win.InputEvent("input"));
    await assistant.updateComplete;
    check(send().disabled, "spaces are words");
    assistant.input.value = "Hello";
    assistant.input.dispatchEvent(new win.InputEvent("input"));
    await assistant.updateComplete;
    check(!send().disabled && win.getComputedStyle(send()).backgroundColor != dim, "not ready with words");

    // While a reply streams, it is the stop button, and stops it.
    let id = core.threadFor(win);
    let { isRunning, stop } = core;
    let stopped = [];
    core.isRunning = threadId => threadId == id || isRunning.call(core, threadId);
    core.stop = threadId => stopped.push(threadId);
    try {
      assistant.requestUpdate();
      await assistant.updateComplete;
      check(!send().disabled && send().classList.contains("stop"), send().className);
      await wait(() => accessibleName(send()) == "Stop response", "the stop button's name");
      send().click();
      check(stopped.join() == id, `stopped ${stopped}`);
      check(assistant.input.value == "Hello", "the words were sent");
    } finally {
      core.isRunning = isRunning;
      core.stop = stop;
    }
    assistant.input.value = "";
    assistant.input.dispatchEvent(new win.InputEvent("input"));
    await resetAssistant();
    """)


@test
def the_assistant_panel_brings_in_what_is_sent_and_answered_and_follows_it(b):
    try:
        b.js("""
        await resetOrbits();
        await onlyBlankTab();
        useFakeBackend();
        await openPage("Motion asker");
        // Every script animation the panel plays, and how the log scrolls.
        let played = [];
        let { animate } = win.Element.prototype;
        win.Element.prototype.animate = function (keyframes, options) {
          played.push({ el: this, keyframes, options });
          return animate.call(this, keyframes, options);
        };
        let came = el => played.some(p => p.el == el);
        let scrolls = [];
        let log = () => assistant.log;
        let messages = () => [...log().querySelectorAll(":scope > .message")];
        let atEnd = () => log().scrollHeight - log().scrollTop - log().clientHeight < 2;
        try {
          let gate = Promise.withResolvers();
          let more = Promise.withResolvers();
          let id = await askFake("Hello motion", async ({ callTool, emit }) => {
            emit({ type: "text", text: "First." });
            await gate.promise;
            await callTool("list_tabs", {});
            for (let i = 0; i < 40; i++) {
              emit({ type: "text", text: `\\n\\nLine ${i} of a long answer.` });
            }
            await more.promise;
            emit({ type: "text", text: "\\n\\nThe end." });
          });
          let [question, reply] = await wait(() => assistant.threadId == id && messages().length == 2 &&
            messages()[0].textContent.includes("Hello motion") && messages(), "the question and its reply");
          // The question rises from the input into the Thread, the reply
          // comes in, for the medium motion.
          let rise = played.find(p => p.el == question);
          check(rise && rise.options.duration == motionMs("medium"), "the question does not rise");
          check(parseFloat(String(rise.keyframes[0].transform).match(/translateY\\(([\\d.]+)px/)?.[1]) > 0,
            `the question comes from ${JSON.stringify(rise.keyframes)}`);
          check(came(reply), "the reply does not come in");
          // So does a step, once.
          let scrollTo = log().scrollTo;
          log().scrollTo = function (options) {
            scrolls.push(options?.behavior);
            return scrollTo.call(this, options);
          };
          gate.resolve();
          let step = await wait(() => reply.isConnected && reply.querySelector(".step"), "the step");
          await assistant.updateComplete;
          check(came(step), "the step does not come in");
          check(played.filter(p => p.el == question).length == 1, "the question came in again");
          // While the long answer streams in, the log follows it smoothly,
          // to its end.
          await wait(() => reply.textContent.includes("Line 39"), "the long answer");
          check(scrolls.length && scrolls.every(b => b == "smooth"), `the log scrolls ${scrolls}`);
          await wait(atEnd, "the log to reach the end");
          // Scrolled up to read, it stays there.
          log().dispatchEvent(new win.WheelEvent("wheel", { deltaY: -100, bubbles: true }));
          log().scrollTop = 0;
          scrolls.length = 0;
          more.resolve();
          await finishedRun(id);
          await assistant.updateComplete;
          await sleep(motionMs("long"));
          check(log().scrollTop == 0 && !scrolls.length, `the log scrolled down to ${log().scrollTop}`);
          // Another Thread and back, or the panel opened again: what is
          // there just shows, at the end.
          played.length = 0;
          core.newThread(win);
          await wait(() => assistant.threadId != id, "the new Thread");
          await core.openThread(win, id);
          await wait(() => assistant.threadId == id && messages().length == 2, "the Thread back");
          await assistant.updateComplete;
          await closeAssistant();
          await openAssistant();
          await wait(() => messages().length == 2, "the Thread again");
          await assistant.updateComplete;
          let inLog = played.filter(p => log().contains(p.el));
          check(!inLog.length, `${inLog.map(p => p.el.className)} came in again`);
          check(atEnd(), "the log did not go to its end");
          // Nothing comes in with reduced motion, and the log jumps.
          Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
          await wait(() => win.matchMedia("(prefers-reduced-motion: reduce)").matches, "reduced motion");
          played.length = 0;
          let still = await askFake("Still", async ({ emit }) => emit({ type: "text", text: "Still here." }));
          await finishedRun(still);
          await wait(() => assistant.threadId == still && log().textContent.includes("Still here."), "the still reply");
          await assistant.updateComplete;
          check(!played.filter(p => log().contains(p.el)).length, "something came in with reduced motion");
        } finally {
          win.Element.prototype.animate = animate;
          delete assistant.log?.scrollTo;
          Services.prefs.clearUserPref("ui.prefersReducedMotion");
        }
        """)
    finally:
        b.js("await resetOrbits();")


@test
def the_assistant_panel_width_stays_between_280_and_520(b):
    handle = b.js("""
    await onlyBlankTab();
    await resetAssistant();
    await openAssistant();
    let width = () => assistant.getBoundingClientRect().width;
    check(width() == 340, `the default width is ${width()}`);
    check((await named(assistant.resizer)) == "Resize assistant panel", accessibleName(assistant.resizer));
    return middle(assistant.resizer);
    """)
    b.drag(handle, (handle[0] - 60, handle[1]))
    handle = b.js("""
    await wait(() => Services.prefs.getIntPref("orbito.assistant.width", 0) == 400, "the pref");
    check(assistant.getBoundingClientRect().width == 400, `width ${assistant.getBoundingClientRect().width}`);
    check(win.gBrowser.tabbox.getBoundingClientRect().right <= assistant.getBoundingClientRect().left, "the page did not make room");
    return middle(assistant.resizer);
    """)
    b.drag(handle, (handle[0] - 500, handle[1]))
    handle = b.js("""
    await wait(() => Services.prefs.getIntPref("orbito.assistant.width", 0) == 520, "the pref at most");
    check(assistant.getBoundingClientRect().width == 520, "wider than 520");
    return middle(assistant.resizer);
    """)
    b.drag(handle, (handle[0] + 500, handle[1]))
    handle = b.js("""
    await wait(() => Services.prefs.getIntPref("orbito.assistant.width", 0) == 280, "the pref at least");
    check(assistant.getBoundingClientRect().width == 280, "narrower than 280");
    check(assistant.resizer.getAttribute("aria-valuenow") == "280", "aria-valuenow");
    return middle(assistant.resizer);
    """)
    # A double click goes back to the default.
    b.pointer(handle, "down", "up", "down", "up")
    b.js("""
    await wait(() => !Services.prefs.prefHasUserValue("orbito.assistant.width"), "the pref to reset");
    check(assistant.getBoundingClientRect().width == 340, "not back to 340");
    assistant.resizer.focus({ focusVisible: true });
    """)
    # The keyboard: arrows step (Left widens), End and Home go to the ends.
    b.keys(Keys.ARROW_LEFT, Keys.ARROW_LEFT)
    b.js("""
    await wait(() => assistant.width == 356, `Left twice: ${assistant.width}`);
    check(assistant.resizer.matches(":focus-visible"), "the handle shows no focus");
    """)
    b.keys(Keys.END)
    b.js("await wait(() => assistant.width == 520, 'End');")
    b.keys(Keys.HOME, Keys.ARROW_RIGHT)
    b.js("""
    await wait(() => assistant.width == 280, "Home, then Right stops at 280");
    // Every window follows.
    let other = win.OpenBrowserWindow();
    try {
      await wait(() => other.gBrowserInit?.delayedStartupFinished, "the new window");
      await openAssistant(other);
      check(other.OrbitoShell.assistant.getBoundingClientRect().width == 280, "a new window has another width");
    } finally {
      other.close();
    }
    await resetAssistant();
    """)


@test
def in_a_narrow_window_the_assistant_panel_is_a_sheet_8px_off_the_edges(b):
    b.js("""
    await onlyBlankTab();
    await resetAssistant();
    let [width, height] = [win.outerWidth, win.outerHeight];
    try {
      win.resizeTo(700, 800);
      await wait(() => win.innerWidth <= 760, "the window to narrow");
      await openAssistant();
      let sheet = assistant.getBoundingClientRect();
      let composer = assistant.renderRoot.querySelector(".composer").getBoundingClientRect();
      check(win.getComputedStyle(assistant).position == "fixed", "the panel is not a sheet");
      check(Math.round(win.innerWidth - sheet.right) == 8, `the sheet is ${win.innerWidth - sheet.right}px off the end`);
      // Only the input's own margin below it, not the sheet's padding too.
      check(Math.round(sheet.bottom - composer.bottom) == 8, `the input is ${sheet.bottom - composer.bottom}px off the sheet's bottom`);
      check(Math.round(composer.left - sheet.left) == 8 && Math.round(sheet.right - composer.right) == 8, "the input is not 8px off the sheet's sides");
    } finally {
      await resetAssistant();
      win.resizeTo(width, height);
      await wait(() => win.outerWidth == width, "the window to widen again");
    }
    """)

@test
def the_assistant_panel_follows_the_keyboard_rules(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Panel keys");
    await resetAssistant();
    await openAssistant();
    // Every control has a name.
    let controls = [...assistant.renderRoot.querySelectorAll("button, textarea, [tabindex], [role]")]
      .filter(el => el.checkVisibility({ visibilityProperty: true }) && !["group", "heading"].includes(el.getAttribute("role")) && !el.classList.contains("log"));
    check(controls.length >= 5, `only ${controls.length} controls`);
    let unnamed = () => controls.filter(el => !accessibleName(el));
    await wait(() => !unnamed().length, "names").catch(() => {
      throw new Error(`unnamed: ${unnamed().map(el => el.outerHTML.slice(0, 80)).join(", ")}`);
    });
    check(accessibleName(assistant.sessionButton) == "Session settings", accessibleName(assistant.sessionButton));
    check(accessibleName(assistant.modelButton).startsWith("Model and thinking depth: "), accessibleName(assistant.modelButton));
    win.gBrowser.selectedBrowser.focus();
    await wait(() => shell.focusedRegion == "page", "the page to have focus");
    """)
    # F6 from the page goes to the panel's input.
    b.keys(Keys.F6)
    b.js("""
    await wait(() => deepActive() == assistant.input, "focus on the input");
    check(shell.focusedRegion == "assistant", shell.focusedRegion);
    """)
    # Tab moves on past the ＋ button to the model button; the session
    # settings button opens its menu from the keyboard on the picked item.
    b.keys(Keys.TAB)
    b.js('await wait(() => deepActive() == assistant.plusButton, "focus on the ＋ button");')
    b.keys(Keys.TAB)
    b.js("""
    await wait(() => deepActive() == assistant.modelButton, `focus on ${deepActive()?.localName}.${deepActive()?.className}`);
    check(assistant.modelButton.matches(":focus-visible"), "the model button shows no focus");
    assistant.sessionButton.focus({ focusVisible: true });
    check(assistant.sessionButton.matches(":focus-visible"), "the button shows no focus");
    check(win.getComputedStyle(assistant.sessionButton).outlineStyle != "none", "no focus ring");
    """)
    b.keys(Keys.ENTER)
    b.js("""
    await wait(() => deepActive()?.dataset?.context == "tab", "focus on the picked context");
    check(deepActive().matches(":focus-visible"), "the item shows no focus");
    """)
    b.keys(Keys.ARROW_DOWN)
    b.js('await wait(() => deepActive()?.dataset?.context == "tabs", "Down to All open tabs");')
    b.keys(Keys.END)
    b.js('await wait(() => deepActive()?.dataset?.command == "threads", "End to the last item");')
    b.keys(Keys.ARROW_DOWN)
    b.js('await wait(() => deepActive()?.dataset?.context == "tab", "Down wraps to the first");')
    b.keys(Keys.ESCAPE)
    b.js("""
    await wait(() => deepActive() == assistant.sessionButton, "Escape back to the button");
    await assistant.updateComplete;
    check(!shown(assistant.sessionMenu) && assistant.context == "tab", "the menu stayed open or picked");
    check(win.OrbitoAssistant.isOpen, "Escape closed the panel");
    assistant.modelButton.focus({ focusVisible: true });
    """)
    # The model menu: arrows reach the thinking depths, Enter picks one.
    b.keys(Keys.ENTER)
    b.js('await wait(() => deepActive()?.dataset?.model == core.model(), "focus on the picked model");')
    b.keys(Keys.END, Keys.ARROW_UP)
    b.js('await wait(() => deepActive()?.dataset?.effort == "high", "End, then Up to High");')
    b.keys(Keys.ENTER)
    b.js("""
    await wait(() => assistant.effort == "high", "High picked");
    await resetAssistant();
    """)


@test
def the_context_ring_fills_as_the_thread_grows_and_its_parts_add_up(b):
    b.js("""
    await onlyBlankTab();
    let tab = await openPage("Context ring");
    core.newThread(win);
    await resetAssistant();
    await openAssistant();
    let ring = assistant.usageButton;
    let percent = () => +ring.dataset.percent;
    let dash = () => parseFloat(ring.querySelector(".value").getAttribute("stroke-dasharray"));
    await assistant.updateUsage();
    check(shown(ring), "no context ring");
    let before = assistant.usage;
    check(before.used > 0 && before.total == 200000, JSON.stringify(before));
    // The tab and page the question would share count as tab context; with
    // All open tabs, the other tabs too; with None, nothing.
    let shared = before.parts.find(p => p.id == "tabs").tokens;
    check(shared > 0, JSON.stringify(before));
    assistant.context = "tabs";
    await assistant.updateComplete;
    await assistant.updateUsage();
    check(assistant.usage.parts.find(p => p.id == "tabs").tokens > shared, JSON.stringify(assistant.usage));
    assistant.context = "none";
    await assistant.updateComplete;
    await assistant.updateUsage();
    check(assistant.usage.parts.find(p => p.id == "tabs").tokens == 0, JSON.stringify(assistant.usage));
    assistant.context = "tab";
    await assistant.updateComplete;
    await assistant.updateUsage();
    let [beforePercent, beforeDash] = [percent(), dash()];
    let id = core.threadFor(win);
    let messages = await core.getMessages(id);
    check(!messages.length, "the Thread is not new");
    try {
      // A long question, and a reply that read the page.
      let message = (role, parts) => ({ id: `ring-${role}`, thread_id: id, seq: messages.length, role, backend: role == "user" ? null : "claude", model: role == "user" ? null : "m", created_at: Date.now(), parts });
      messages.push(
        message("user", [{ type: "text", text: "Read this. " + "a".repeat(60000) }]),
        message("assistant", [
          { type: "tool_call", id: "ring-call", name: "get_page_text", input: {}, label: "Reading" },
          { type: "tool_result", call_id: "ring-call", content: "p".repeat(40000), is_error: false },
          { type: "text", text: "Done." },
        ])
      );
      await assistant.refresh();
      await wait(() => assistant.usage.used > before.used + 20000, "the estimate to grow");
      await assistant.updateComplete;
      let usage = assistant.usage;
      check(percent() > beforePercent && dash() > beforeDash, `${beforePercent}% -> ${percent()}%, ${beforeDash} -> ${dash()}`);
      check(percent() == Math.round((usage.used / usage.total) * 100), `${percent()}% of ${JSON.stringify(usage)}`);
      check((await named(ring)) == `Context usage: ${percent()}% used`, accessibleName(ring));
      check(!ring.classList.contains("hot"), "warns early");

      // The details: every part, and they add up to what the ring shows.
      ring.click();
      await assistant.updateComplete;
      let menu = assistant.usageMenu;
      check(shown(menu) && ring.getAttribute("aria-expanded") == "true", "the details did not open");
      let rows = [...menu.querySelectorAll(".legend li")];
      check(rows.map(r => r.dataset.part).join() == "system,tools,tabs,history,free", rows.map(r => r.dataset.part).join());
      check(rows.map(r => r.querySelector("span").textContent).join() == "System prompt,Tool definitions,Tab context · This tab,Thread,Free", menu.textContent);
      let tokens = rows.map(r => +r.dataset.tokens);
      let parts = tokens.slice(0, 4).reduce((a, b) => a + b, 0);
      check(parts == usage.used && parts + tokens[4] == usage.total, `${tokens} for ${usage.used} / ${usage.total}`);
      check(rows.every((r, i) => r.querySelector("b").textContent == tokens[i].toLocaleString()), "the numbers shown differ");
      check(menu.querySelector("#usage-context").textContent.includes(`${usage.used.toLocaleString()} / ${usage.total.toLocaleString()} tokens`), menu.textContent);
      check(ring.title.includes(`${usage.used.toLocaleString()} / ${usage.total.toLocaleString()}`), ring.title);
      check(tokens[2] == 10000 + shared && tokens[3] > 15000, `tabs ${tokens[2]}, thread ${tokens[3]}`);
      check(!menu.querySelector(".subscription"), "a subscription section without limits");

      // Past the window: the ring is full and warns, nothing is free. (The
      // budget would otherwise follow the window and drop the history.)
      Services.prefs.setIntPref("orbito.assistant.historyCharBudget", 200000);
      Services.prefs.setIntPref("orbito.assistant.contextWindow", 20000);
      await assistant.updateUsage();
      check(percent() == 100 && ring.classList.contains("hot") && assistant.usage.free == 0, `${percent()}% ${ring.className}`);
      check(win.getComputedStyle(ring.querySelector(".value")).stroke != win.getComputedStyle(ring.querySelector(".track")).stroke, "the ring is not drawn");
    } finally {
      Services.prefs.clearUserPref("orbito.assistant.contextWindow");
      Services.prefs.clearUserPref("orbito.assistant.historyCharBudget");
      messages.splice(0);
      await resetAssistant();
    }
    """)


@test
def the_subscription_section_shows_only_when_a_subscription_backend_gives_limits(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Limits");
    await resetAssistant();
    await openAssistant();
    let backends = ["claude", "openai", "chatgpt"];
    let impls = backends.map(id => core.BACKENDS[id].impl);
    let originals = impls.map(impl => Object.getOwnPropertyDescriptor(impl, "usageLimits"));
    let resetsAt = Date.now() + 3600000;
    let limits = {
      plan: "Plus",
      windows: [
        { label: "5-hour limit", percent: 42, resetsAt },
        { label: "Weekly limit", percent: 18, resetsAt: null },
      ],
    };
    let details = async backend => {
      core.backend = backend;
      assistant.closeMenu();
      await assistant.updateUsage();
      assistant.usageButton.click();
      await assistant.updateUsage();
      let menu = assistant.usageMenu;
      check(shown(menu), `no details for ${backend}`);
      return menu.querySelector(".subscription");
    };
    try {
      // No backend gives limits yet.
      for (let impl of impls) {
        delete impl.usageLimits;
      }
      for (let backend of backends) {
        check(!(await details(backend)), `a subscription section for ${backend}`);
      }
      for (let impl of impls) {
        impl.usageLimits = async () => limits;
      }
      // A subscription backend that gives them shows them.
      for (let backend of ["chatgpt", "claude"]) {
        let section = await details(backend);
        check(section && shown(section), `no subscription section for ${backend}`);
        let text = section.textContent.replace(/\\s+/g, " ");
        let rows = [...section.querySelectorAll(".line")].map(line => [...line.children].map(el => el.textContent).join(" "));
        check(text.includes("Subscription · Plus") && rows.join() == "5-hour limit 42%,Weekly limit 18%", text);
        check(section.querySelectorAll(".resets").length == 1, "one reset time");
        check(section.querySelector(".bar-track i").style.width == "42%", section.querySelector(".bar-track i").style.width);
      }
      // The local backend never has one.
      check(!(await details("openai")), "a subscription section for the local backend");
      check(await core.usageLimits("openai") == null, "limits for the local backend");
    } finally {
      impls.forEach((impl, i) => {
        delete impl.usageLimits;
        if (originals[i]) {
          Object.defineProperty(impl, "usageLimits", originals[i]);
        }
      });
      await resetAssistant();
    }
    """)


@test
def the_context_ring_follows_the_keyboard_rules(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Ring keys");
    await resetAssistant();
    await openAssistant();
    await assistant.updateUsage();
    check((await named(assistant.usageButton)).startsWith("Context usage: "), accessibleName(assistant.usageButton));
    assistant.modelButton.focus({ focusVisible: true });
    """)
    # Tab goes from the model button to the permission shield, then to the
    # ring, which shows its focus.
    b.keys(Keys.TAB)
    b.js("""
    await wait(() => deepActive() == assistant.permissionButton, `focus on ${deepActive()?.localName}.${deepActive()?.className}`);
    """)
    b.keys(Keys.TAB)
    b.js("""
    let ring = assistant.usageButton;
    await wait(() => deepActive() == ring, `focus on ${deepActive()?.localName}.${deepActive()?.className}`);
    check(ring.matches(":focus-visible") && win.getComputedStyle(ring).outlineStyle != "none", "the ring shows no focus");
    """)
    # Enter opens the details with focus in them; Escape closes them and goes
    # back to the ring.
    b.keys(Keys.ENTER)
    b.js("""
    let menu = assistant.usageMenu;
    await wait(() => deepActive() == menu, "focus in the details");
    check(shown(menu) && menu.matches(":focus-visible"), "the details show no focus");
    check((await named(menu)).startsWith("Context · "), accessibleName(menu));
    """)
    b.keys(Keys.ARROW_DOWN, Keys.ESCAPE)
    b.js("""
    let ring = assistant.usageButton;
    await wait(() => deepActive() == ring, "Escape back to the ring");
    await assistant.updateComplete;
    check(!shown(assistant.usageMenu) && ring.getAttribute("aria-expanded") == "false", "the details stayed open");
    check(win.OrbitoAssistant.isOpen, "Escape closed the panel");
    """)
    # F6 leaves the panel and Shift+F6 comes back to it.
    b.keys(Keys.F6)
    b.js('await wait(() => shell.focusedRegion != "assistant", "F6 to leave the panel");')
    b.keys((Keys.SHIFT, Keys.F6))
    b.js("""
    await wait(() => shell.focusedRegion == "assistant" && deepActive() == assistant.input, "Shift+F6 back to the input");
    // A press outside the details closes them.
    assistant.usageButton.click();
    await assistant.updateComplete;
    check(shown(assistant.usageMenu), "the details did not open on a click");
    assistant.log.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true, composed: true }));
    await assistant.updateComplete;
    check(!shown(assistant.usageMenu), "a press outside left the details open");
    await resetAssistant();
    """)


@test
def an_orbit_holds_the_tabs_a_task_opens_and_keeps_them_as_a_tab_group(b):
    try:
        b.js("""
        await resetOrbits();
        await onlyBlankTab();
        useFakeBackend();
        let mine = await openPage("Mine before");
        let asker = await openPage("Orbit asker");
        core.setPermissionMode(win, "bypass");
        let gate = Promise.withResolvers();
        let opened = [];
        let id = await askFake("Research", async ({ callTool, emit }) => {
          opened.push(openedTab(await callTool("open_tab", { url: pageURL("Orbit one") })));
          opened.push(openedTab(await callTool("open_tab", { url: pageURL("Orbit two") })));
          // A page tool with a tab_id touches that tab.
          await callTool("get_page_text", { tab_id: OrbitoTools.tabId(opened[0]) });
          await gate.promise;
          await callTool("create_artifact", { title: "Orbit result", content: "The result." });
          emit({ type: "text", text: "Done." });
        });
        let [one, two] = await wait(() => opened.length == 2 && opened, "the tabs to open");
        await wait(() => one.label == "Orbit one" && two.label == "Orbit two", "the pages");
        let box = await wait(() => orbitBoxes().length == 1 && orbitTabsShown(orbitBoxes()[0]).length == 2 && orbitBoxes()[0], "the Orbit");
        check(orbitTabsShown(box)[0] == one && orbitTabsShown(box)[1] == two, "the Orbit shows other tabs");
        check(core.orbitOf(one) && core.orbitOf(one) == core.orbitOf(two), "the tabs carry no task id");
        check(!core.orbitOf(mine) && !core.orbitOf(asker), "the user's tabs were put in the Orbit");
        check(!orbitTabsShown(box).includes(mine) && !orbitTabsShown(box).includes(asker), "the user's tabs show in the Orbit");
        check(!win.gBrowser.tabGroups.length && !one.group, "the Orbit made a Firefox tab group");
        await listMatchesGBrowser();

        // Working: a still icon, a progress bar in the header's row, a
        // stop button; between steps the touched tab keeps a still tint.
        check(box.getAttribute("state") == "running", box.getAttribute("state"));
        check(!orbitHeader(box).textContent.trim(), "the header has text");
        // The icon's tooltip names the task, then its last step.
        await wait(() => /^Research · ./.test(orbitHeader(box).title), `the task's name (${orbitHeader(box).title})`);
        check((await named(orbitHeader(box))) == orbitHeader(box).title, accessibleName(orbitHeader(box)));
        let bar = box.querySelector(".orbit-head > .orbit-bar");
        check(bar && (await named(bar)) == "Task in progress", "no progress bar in the header");
        check((await named(box.querySelector(".stop"))) == "Stop the task", "no stop button");
        check(win.getComputedStyle(orbitHeader(box).querySelector("svg")).animationName == "none", "the icon spins");
        await wait(() => rowFor(one).getAttribute("touching") == "", "the tint on the touched tab");
        let tint = win.getComputedStyle(rowFor(one), "::before");
        check(tint.backgroundColor != "rgba(0, 0, 0, 0)" && tint.animationName == "none", `no still tint (${tint.backgroundColor}, ${tint.animationName})`);
        check(!rowFor(one).querySelector(".step"), "a step between steps");
        check(tabList().renderRoot.querySelectorAll("[touching]").length == 1, "more than one tab touched");
        check(rowFor(one).getAttribute("aria-description") == "The assistant is working in this tab", "the tint has no description");

        gate.resolve();
        await finishedRun(id);
        box = await wait(() => orbitBoxes()[0]?.getAttribute("state") == "done" && orbitTabsShown(orbitBoxes()[0]).length == 3 && orbitBoxes()[0], "the Orbit to be done with the result");
        let result = orbitTabsShown(box).find(t => core.isOrbitResult(t));
        check(result && result != one && result != two, "no result tab");
        check(orbitHeader(box).title == "Research · Done, choose what to keep in the Assistant panel", orbitHeader(box).title);
        check(!box.querySelector(".orbit-bar") && !box.querySelector(".stop"), "still working");
        check(!tabList().renderRoot.querySelector("[touching]"), "a ring after the task");

        // The wrap-up card, as the design's: how the task ended on a row
        // with a still green dot, the result and the question under it,
        // and two answers, keeping them as a group first.
        await assistant.updateComplete;
        let card = await wait(() => assistant.log.querySelector(".orbit-card:not(.settled)"), "the wrap-up card");
        check(card.querySelector(".approval-row p")?.textContent.trim() == "The task is done", card.querySelector(".approval-row")?.textContent);
        let dot = card.querySelector(".approval-row .pulse.ok");
        check(dot && win.getComputedStyle(dot).animationName == "none", "no still green dot");
        let answers = () => [...assistant.log.querySelectorAll(".orbit-card:not(.settled) button[data-choice]")].map(b => `${b.dataset.choice}:${b.textContent.trim()}:${b.className}`).join(" | ");
        check(answers() == "close:Close tabs:secondary | group:Keep as group:primary", answers());
        check(win.getComputedStyle(card.querySelector(".approval-actions")).justifyContent == "flex-end", "the answers are not on the right");
        // A message's gap from the reply's words, as the design's cards are messages.
        check(win.getComputedStyle(card).marginTop == "14px", "the card is not 14px off the reply");
        // The result tab on the question's line (not a source chip), which
        // goes to it.
        let resultChip = () => assistant.log.querySelector(".orbit-card .approval-meta .result-chip");
        check(!assistant.log.querySelector(".orbit-card .src-chip"), "a source chip on the card");
        await wait(() => result.label == "Orbit result" && resultChip()?.textContent.trim() == "Orbit result",
          `the result chip (${resultChip()?.textContent.trim()})`);
        check(resultChip().querySelector("img"), "the result tab's chip has no icon");
        check(card.querySelector(".approval-meta").textContent.includes("What should happen to the 3 tabs it read?"), card.querySelector(".approval-meta").textContent);
        win.gBrowser.selectedTab = asker;
        resultChip().click();
        await wait(() => win.gBrowser.selectedTab == result, "the result tab to be selected");
        check(win.gBrowser.tabs.filter(t => core.isOrbitResult(t)).length == 1, "the chip opened the document again");
        win.gBrowser.selectedTab = asker;
        // Keep: the tabs stay, as a tab group named after the task.
        let tabs = orbitTabsShown(box);
        logButton("Keep as group").click();
        await wait(() => !orbitBoxes().length, "the Orbit to go");
        check(tabs.every(t => t.isConnected && !core.orbitOf(t)), "a tab closed or stayed in the Orbit");
        let group = one.group;
        check(group && win.gBrowser.tabGroups.length == 1 && group.label == "Research", `the group: ${group?.label}`);
        check(JSON.stringify(group.tabs.map(t => t.label)) == JSON.stringify(tabs.map(t => t.label)), group.tabs.map(t => t.label).join());
        check(!mine.group && !asker.group, "a user's tab went in the group");
        await wait(() => tabList().renderRoot.querySelector(".group")?.textContent.includes("Research"), "the group in the Sidebar");
        // Answered: one line with what was picked.
        let settled = await wait(() => assistant.log.querySelector(".orbit-card.settled"), "the card to settle");
        check(settled.textContent.replace(/\\s+/g, " ").trim() == "Orbit wrap-up · Kept them as a group.", settled.textContent);
        check(settled.querySelector(".approval-line b")?.textContent == "Orbit wrap-up", "the bold name");
        check(!settled.querySelector("button"), "the settled card has buttons");
        // The document the task made stays on the reply.
        check(assistant.log.querySelector(".artifact")?.textContent.includes("Orbit result"), "the document's card");
        let messages = await core.getMessages(id);
        check(messages.at(-1).parts.find(p => p.type == "orbit")?.choice == "group", JSON.stringify(messages.at(-1).parts));
        check(mine.isConnected && asker.isConnected, "a user's tab closed");
        await listMatchesGBrowser();
        """)
    finally:
        b.js("await resetOrbits(); await onlyBlankTab();")


@test
def every_tab_a_tool_call_works_in_shows_the_ring_with_its_step(b):
    try:
        b.js("""
        await resetOrbits();
        await onlyBlankTab();
        useFakeBackend();
        core.setPermissionMode(win, "bypass");
        // get_page_text holds each tab's read until its gate opens.
        let tool = OrbitoTools.get("get_page_text");
        let run = tool.run;
        let gates = new Map();
        tool.run = async (ctx, input) => {
          await gates.get(input.tab_id)?.promise;
          return run.call(tool, ctx, input);
        };
        try {
          let opened = [];
          let reads = null;
          let finish = Promise.withResolvers();
          let call = null;
          let id = await askFake("Compare", async ({ callTool }) => {
            call = callTool;
            opened.push(openedTab(await callTool("open_tab", { url: pageURL("Ring one") })));
            opened.push(openedTab(await callTool("open_tab", { url: pageURL("Ring two") })));
            await wait(() => opened[0].label == "Ring one" && opened[1].label == "Ring two", "the pages");
            for (let tab of opened) {
              gates.set(OrbitoTools.tabId(tab), Promise.withResolvers());
            }
            // Two reads at once, as a backend runs read-only calls.
            reads = opened.map(tab => callTool("get_page_text", { tab_id: OrbitoTools.tabId(tab) }));
            await Promise.all(reads);
            await finish.promise;
          });
          let [one, two] = await wait(() => reads && opened, "the reads to start");
          let ringed = () => [...tabList().renderRoot.querySelectorAll("[touching]")].map(r => r.tab);
          // The row says the step without the title it already shows; its
          // description and tooltip say the whole of it.
          let says = tab => [rowFor(tab).getAttribute("aria-description"), rowFor(tab).querySelector(".step")?.title];
          let shows = tab => rowFor(tab).querySelector(".step")?.textContent;
          await wait(() => ringed().length == 2 && ringed().includes(one) && ringed().includes(two), `both tabs ringed (${ringed().map(t => t.label)})`);
          check(says(one).every(s => s == "Reading “Ring one”"), says(one).join());
          check(says(two).every(s => s == "Reading “Ring two”"), says(two).join());
          for (let tab of [one, two]) {
            check(shows(tab) == "Reading the page", shows(tab));
            check(rowFor(tab).getAttribute("touching") == "running", rowFor(tab).getAttribute("touching"));
            let sweep = win.getComputedStyle(rowFor(tab), "::before").animationName;
            check(sweep == "touching-sweep", `no light sweeping ${tab.label} (${sweep})`);
          }

          // One read done: the ring stays only on the tab still being read.
          gates.get(OrbitoTools.tabId(one)).resolve();
          await reads[0];
          await wait(() => ringed().length == 1 && ringed()[0] == two, `only the read tab ringed (${ringed().map(t => t.label)})`);
          check(says(two).every(s => s == "Reading “Ring two”"), says(two).join());

          // Both done: the last tab touched keeps the ring, saying it works there.
          gates.get(OrbitoTools.tabId(two)).resolve();
          await reads[1];
          await wait(() => ringed().length == 1 && ringed()[0] == two && says(two)[0] == "The assistant is working in this tab", `the last touched tab ringed (${ringed().map(t => t.label)}, ${says(two)})`);
          check(rowFor(two).getAttribute("touching") == "" && !rowFor(two).querySelector(".step"), `still running (${rowFor(two).getAttribute("touching")})`);

          // A closed tab being read keeps no ring.
          let gate = Promise.withResolvers();
          gates.set(OrbitoTools.tabId(one), gate);
          let reading = call("get_page_text", { tab_id: OrbitoTools.tabId(one) });
          await wait(() => ringed().includes(one), "the ring on the tab read again");
          win.gBrowser.removeTab(one);
          check(!core.touchedTabs().has(one), "the closed tab is touched");
          gate.resolve();
          await reading;
          finish.resolve();
          await finishedRun(id);
          check(!ringed().length, "a ring after the question");
        } finally {
          tool.run = run;
        }
        """)
    finally:
        b.js("await resetOrbits(); await onlyBlankTab();")


@test
def a_reply_shows_the_tabs_it_read_as_source_chips(b):
    try:
        b.js("""
        await resetOrbits();
        await onlyBlankTab();
        useFakeBackend();
        let other = await openPage("Source other");
        let shot = await openPage("Source shot");
        let asker = await openPage("Source asker");
        let id = await askFake("Compare", async ({ callTool, emit }) => {
          emit({ type: "text", text: "Reading." });
          await callTool("get_page_text", {});
          await callTool("read_page", { tab_id: OrbitoTools.tabId(other) });
          // A screenshot is a source too (of a tab shown, to be drawn).
          win.gBrowser.selectedTab = shot;
          await callTool("screenshot", { tab_id: OrbitoTools.tabId(shot) });
          win.gBrowser.selectedTab = asker;
          // The tab asked from again, by its id, and a tool that reads no
          // page: no more chips.
          await callTool("get_page_text", { tab_id: OrbitoTools.tabId(asker) });
          await callTool("list_tabs", {});
          emit({ type: "text", text: " Compared." });
        });
        // No block caret while the reply streams.
        await wait(() => assistant.log.textContent.includes("Reading."), "the reply to stream");
        check(!assistant.log.querySelector(".caret"), "a caret while streaming");
        await finishedRun(id);
        let chips = () => [...assistant.log.querySelectorAll(".src-chip")];
        let titles = () => chips().map(c => c.textContent.trim()).join(" | ");
        await wait(() => chips().length == 3, `the source chips (${titles()})`);
        check(titles() == "Source asker | Source other | Source shot", titles());
        check(chips().every(c => c.querySelector("img")), "a chip without an icon");
        // No "backend · model" line under the reply.
        check(!assistant.log.querySelector(".label") && !assistant.log.textContent.includes("Test · "), "the backend line is shown");

        // A chip goes to its tab.
        chips()[1].click();
        await wait(() => win.gBrowser.selectedTab == other, "the read tab to be selected");

        // Once the tab is closed, it opens its page again.
        win.gBrowser.selectedTab = asker;
        win.gBrowser.removeTab(other, { animate: false });
        await wait(() => !other.isConnected && chips().length == 3, "the chips again");
        chips()[1].click();
        let reopened = await wait(() => {
          let tab = win.gBrowser.selectedTab;
          return tab != asker && tab.linkedBrowser.currentURI.spec == pageURL("Source other") && tab;
        }, "the page to open again");
        check(win.gBrowser.tabs.filter(t => t.linkedBrowser.currentURI.spec == pageURL("Source other")).length == 1, "more than one tab of the page");

        // A tab at the page in another window, at another fragment, is
        // the one a chip goes to.
        win.gBrowser.selectedTab = asker;
        win.gBrowser.removeTab(shot, { animate: false });
        let far = win.OpenBrowserWindow();
        try {
          await wait(() => far.gBrowserInit?.delayedStartupFinished, "the other window");
          let farTab = far.gBrowser.addTab(`${pageURL("Source shot")}#later`, {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          });
          await wait(() => farTab.linkedBrowser.contentTitle == "Source shot", "the page in the other window");
          check(far.gBrowser.selectedTab != farTab, "the tab is selected already");
          let tabs = win.gBrowser.tabs.length;
          win.focus();
          await wait(() => chips().length == 3, "the chips");
          chips()[2].click();
          await wait(() => far.gBrowser.selectedTab == farTab, "the other window's tab to be selected");
          check(win.gBrowser.tabs.length == tabs, "the page opened again");
        } finally {
          await new Promise(resolve => {
            far.addEventListener("unload", resolve, { once: true });
            far.close();
          });
        }

        // From the pages the tool results keep: a stored reply has them too.
        let messages = await core.getMessages(id);
        let reply = messages.at(-1);
        let sources = core.replySources(reply);
        check(JSON.stringify(sources.map(s => s.url)) == JSON.stringify([pageURL("Source asker"), pageURL("Source other"), pageURL("Source shot")]), JSON.stringify(sources));
        let kept = reply.parts.filter(p => p.type == "tool_result" && p.page);
        check(kept.length == 4 && kept.every(p => p.page.url && Number.isInteger(p.page.tabId)), JSON.stringify(kept.map(p => p.page)));
        // A reply stored before results kept their page: read from the
        // results' text, which a screenshot's does not name.
        let older = { ...reply, parts: reply.parts.map(({ page, ...part }) => part) };
        sources = core.replySources(older);
        check(JSON.stringify(sources.map(s => s.url)) == JSON.stringify([pageURL("Source asker"), pageURL("Source other")]), JSON.stringify(sources));
        win.gBrowser.removeTab(reopened, { animate: false });
        """)
    finally:
        b.js("await resetAssistant(); await onlyBlankTab();")


@test
def screenshot_takes_the_whole_page_or_a_part_without_scrolling_it(b):
    try:
        b.js("""
        await resetOrbits();
        await onlyBlankTab();
        useFakeBackend();
        const { OrbitoPage } = ChromeUtils.importESModule(
          "chrome://browser/content/orbito/OrbitoPage.sys.mjs"
        );
        let open = async height => {
          let tab = await openURL(`${PAGES}/tall/${height}`);
          await wait(async () => (await OrbitoPage.rect(tab)).scrollY == 1000, "the page to scroll");
          return tab;
        };
        // An image's size, and whether its pixel at (x, y), as fractions
        // of its size, is red.
        let decode = async ({ mimeType, data }) => {
          let img = new win.Image();
          img.src = `data:${mimeType};base64,${data}`;
          await img.decode();
          let canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          let context = canvas.getContext("2d");
          context.drawImage(img, 0, 0);
          let red = (x, y) => {
            let [r, g] = context.getImageData(Math.floor(x * (canvas.width - 1)), Math.floor(y * (canvas.height - 1)), 1, 1).data;
            return r > 200 && g < 80;
          };
          return { width: img.naturalWidth, height: img.naturalHeight, red };
        };
        let tab = await open(6000);
        let results = [];
        let id = await askFake("Look", async ({ callTool }) => {
          results.push(await callTool("screenshot", {}));
          results.push(await callTool("screenshot", { full_page: true }));
          results.push(await callTool("screenshot", { from_y: 5000, to_y: 6000 }));
          results.push(await callTool("screenshot", { full_page: true, ref: "e1" }));
          results.push(await callTool("screenshot", { full_page: true, from_y: 10 }));
        });
        await finishedRun(id);
        let [visible, whole, part, both, mixed] = results;

        // Without options, only what is on the screen, as before.
        check(visible.ok && visible.images.length == 1 && /^\\[screenshot \\d+×\\d+\\]$/.test(visible.content), visible.content);
        check(!(await decode(visible.images[0])).red(0.5, 0.5), "the screen shows the red part");

        // The whole page, past the screen: the red bottom is in the last
        // image, and each image says where on the page it is.
        check(whole.ok && whole.images.length > 1 && whole.images.length <= 6, whole.content);
        let lines = whole.content.split("\\n");
        check(lines.length == whole.images.length, whole.content);
        check(lines[0].includes("page y 0–") && lines.at(-1).includes("–6000 of 6000 px"), whole.content);
        let images = await Promise.all(whole.images.map(decode));
        check(images.every(i => Math.max(i.width, i.height) <= 1280), JSON.stringify(images));
        check(!images[0].red(0.5, 0.02) && images.at(-1).red(0.5, 0.98), "the bottom is not in the last image");

        // A part of the page, by its top and bottom.
        check(part.ok && part.images.length == 1 && part.content.includes("page y 5000–6000 of 6000 px"), part.content);
        let shot = await decode(part.images[0]);
        check(!shot.red(0.5, 0.05) && shot.red(0.5, 0.95), "the part is not the page's bottom");
        check(!both.ok && /not both/.test(both.content), both.content);
        check(!mixed.ok && /not both/.test(mixed.content), mixed.content);

        // The page did not scroll.
        check((await OrbitoPage.rect(tab)).scrollY == 1000, "the page scrolled");

        // A very long page: at most 6 images, the rest left for another call.
        win.gBrowser.removeTab(tab, { animate: false });
        tab = await open(100000);
        results = [];
        id = await askFake("Look again", async ({ callTool }) => {
          results.push(await callTool("screenshot", { full_page: true }));
        });
        await finishedRun(id);
        let [long] = results;
        check(long.ok && long.images.length == 6 && /from_y=\\d+/.test(long.content), long.content);
        images = await Promise.all(long.images.map(decode));
        check(images.every(i => Math.max(i.width, i.height) <= 1280), JSON.stringify(images));
        check((await OrbitoPage.rect(tab)).scrollY == 1000, "the long page scrolled");
        """)
    finally:
        b.js("await resetAssistant(); await onlyBlankTab();")


@test
def approvals_in_an_orbit_go_on_when_allowed_and_stop_when_denied(b):
    try:
        b.js("""
        await resetOrbits();
        await onlyBlankTab();
        useFakeBackend();
        await openPage("Approval asker");
        let calls = [];
        let id = await askFake("Open them", async ({ callTool }) => {
          for (let title of ["Asked one", "Asked two", "Asked three", "Asked four"]) {
            calls.push(await callTool("open_tab", { url: pageURL(title) }));
          }
        });
        let allow = () => assistant.log.querySelector(".approval .primary");
        let deny = () => assistant.log.querySelector(".approval .secondary");
        // Before any tab is open there is no Orbit yet.
        (await wait(allow, "the first approval")).click();
        let box = await wait(() => orbitBoxes()[0]?.getAttribute("state") == "waiting" && orbitBoxes()[0], "the Orbit to wait");
        await wait(() => orbitHeader(box).title == "Open them · Waiting for your approval in the Assistant panel", `the waiting tooltip (${orbitHeader(box).title})`);
        let edge = win.getComputedStyle(box);
        check(edge.animationName.split(", ").includes("orbit-nudge") && edge.animationIterationCount.split(", ").at(-1) == "2", "the waiting edge does not breathe twice");
        check(win.getComputedStyle(orbitHeader(box).querySelector("svg")).animationName == "none", "the icon spins while waiting");
        // As the design's: the question, Deny and Allow on one row; the
        // site it opens and the task's name under it.
        let host = new URL(pageURL("Asked two")).host;
        let meta = () => assistant.log.querySelector(".approval.waiting .approval-meta");
        await wait(() => meta()?.querySelector(".favicons img")?.src == `page-icon:${pageURL("Asked two")}`, "the card to show the site's icon");
        let words = () => [...meta().children].map(e => e.textContent.trim()).filter(Boolean).join(" ");
        check(words() == `${host} · Open them`, `the line under the question: ${words()}`);
        check(meta().title == pageURL("Asked two"), `the site's tooltip: ${meta().title}`);
        let row = [...assistant.log.querySelector(".approval.waiting .approval-row").children].map(e => e.textContent.trim()).filter(Boolean).join(" | ");
        check(row == "Open a new tab? | Deny | Allow", `the question's row: ${row}`);
        // The question on one line, cut short if it does not fit.
        let question = assistant.log.querySelector(".approval.waiting .approval-row p");
        let style = win.getComputedStyle(question);
        check(style.whiteSpace == "nowrap" && style.textOverflow == "ellipsis", `${style.whiteSpace} ${style.textOverflow}`);
        check(question.title == question.textContent, "the cut question has no tooltip");
        check(win.getComputedStyle(question.closest(".approval")).marginTop == "14px", "the card is not 14px off the reply");

        allow().click();
        await wait(() => calls.length == 2 && byLabel("Asked two"), "allowing to go on");
        await wait(() => orbitTabsShown(orbitBoxes()[0]).length == 2, "the second tab in the Orbit");
        await wait(() => calls.length == 2 && deny(), "the third approval");
        await wait(() => meta()?.title == pageURL("Asked three") && words() == `${host} · Open them`, "the next site");
        // Answered, an approval is one line with the step's short name in bold.
        let settled = assistant.log.querySelector(".approval.settled .approval-line");
        check(settled.querySelector("b").textContent == `Open ${new URL(pageURL("Asked two")).hostname}`, settled.textContent);
        check(settled.textContent.includes("Allowed"), settled.textContent);
        check(win.getComputedStyle(settled).whiteSpace == "nowrap", "the answered approval wraps");
        deny().click();
        await finishedRun(id);
        check(calls[2].ok === false && calls.length >= 3, JSON.stringify(calls));
        check(!byLabel("Asked three") && !win.gBrowser.tabs.some(t => t.linkedBrowser.currentURI.spec.includes("Asked%20four")), "the task went on after Deny");
        let messages = await core.getMessages(id);
        check(core.notices(messages.at(-1).id).includes("Stopped: you denied a step."), core.notices(messages.at(-1).id).join());
        box = await wait(() => orbitBoxes()[0]?.getAttribute("state") == "done" && orbitBoxes()[0], "the Orbit to be done");
        check(messages.at(-1).parts.find(p => p.type == "orbit")?.stopped, "not marked stopped");

        // Stopped, the same two answers, under how it ended and a dot that
        // still blinks.
        let card = await wait(() => assistant.log.querySelector(".orbit-card:not(.settled)"), "the wrap-up card");
        check(card.querySelector(".approval-row p").textContent.trim() == "The task stopped", card.textContent);
        check(card.querySelector(".pulse:not(.ok)"), "the dot of a stopped task");
        check(card.querySelector(".approval-meta").textContent.trim() == "What should happen to the 2 tabs it read?", `the question: ${card.querySelector(".approval-meta").textContent}`);
        check(!card.querySelector(".result-chip"), "a result chip without a result");
        let answers = [...card.querySelectorAll("button[data-choice]")].map(b => b.textContent.trim()).join(" | ");
        check(answers == "Close tabs | Keep as group", answers);
        let tabs = orbitTabsShown(box);
        logButton("Close tabs").click();
        await wait(() => !orbitBoxes().length, "the Orbit to go");
        check(tabs.every(t => !t.isConnected), "a tab stayed open");
        check(!win.gBrowser.tabGroups.length, "a group was made");
        await wait(() => assistant.log.querySelector(".orbit-card.settled")?.textContent.replace(/\s+/g, " ").trim() == "Orbit wrap-up · Closed the tabs.", "the card to say what was picked");
        await listMatchesGBrowser();
        """)
    finally:
        b.js("await resetOrbits(); await onlyBlankTab();")


@test
def orbits_and_firefox_tab_groups_stay_apart_and_close_all_closes_the_orbit(b):
    try:
        b.js("""
        await resetOrbits();
        await onlyBlankTab();
        useFakeBackend();
        let mine = await openPage("Grouped mine");
        let other = await openPage("Grouped by the tool");
        addGroup([mine], "blue", "Mine");
        let asker = await openPage("Group asker");
        core.setPermissionMode(win, "bypass");
        let opened = [];
        let id = await askFake("Group", async ({ callTool }) => {
          opened.push(openedTab(await callTool("open_tab", { url: pageURL("Kept in orbit") })));
          opened.push(openedTab(await callTool("open_tab", { url: pageURL("Grouped away") })));
          // A group of the user's tab, and one an Orbit tab is put in.
          await callTool("group_tabs", { tab_ids: [OrbitoTools.tabId(other)], name: "Tool group" });
          await callTool("group_tabs", { tab_ids: [OrbitoTools.tabId(opened[1])], name: "Away" });
        });
        await finishedRun(id);
        let [kept, away] = opened;
        let labels = win.gBrowser.tabGroups.map(g => g.label).sort().join();
        check(labels == "Away,Mine,Tool group", labels);
        check(!kept.group && core.orbitOf(kept), "the Orbit tab is in a group");
        check(away.group?.label == "Away" && !core.orbitOf(away), "a grouped tab stayed in the Orbit");
        check(!core.orbitOf(mine) && !core.orbitOf(other), "a group's tab is in the Orbit");
        let box = await wait(() => orbitBoxes().length == 1 && orbitBoxes()[0], "the Orbit");
        await wait(() => orbitTabsShown(box).length == 1 && orbitTabsShown(box)[0] == kept, "the Orbit to show only its own tab");
        let groups = [...tabList().renderRoot.querySelectorAll(".group")];
        check(groups.length == 3 && groups.every(g => !g.querySelector(".orbit")), "an Orbit inside a group");
        check(!box.querySelector(".group"), "a group inside the Orbit");

        await wait(() => logButton("Close tabs"), "the wrap-up card");
        logButton("Close tabs").click();
        await wait(() => !kept.isConnected, "the Orbit's tab to close");
        await wait(() => !orbitBoxes().length, "the Orbit to go");
        check(mine.isConnected && other.isConnected && away.isConnected && asker.isConnected, "a tab outside the Orbit closed");
        check(win.gBrowser.tabGroups.length == 3, "a group went away");
        await listMatchesGBrowser();
        """)
    finally:
        b.js("await resetOrbits(); await onlyBlankTab();")


@test
def the_orbit_follows_the_keyboard_rules(b):
    try:
        b.js("""
        await resetOrbits();
        await onlyBlankTab();
        useFakeBackend();
        await openPage("Keys asker");
        core.setPermissionMode(win, "bypass");
        let id = await askFake("One tab", async ({ callTool }) => {
          await callTool("open_tab", { url: pageURL("Keys orbit") });
        });
        await finishedRun(id);
        await wait(() => byLabel("Keys orbit"), "the page");
        await closeAssistant();
        await wait(() => orbitBoxes().length == 1, "the Orbit");
        win.gBrowser.selectedBrowser.focus();
        await wait(() => shell.focusedRegion == "page", "the page to have focus");
        """)
        # F6 reaches the Sidebar; the Orbit header is the list's first row.
        b.keys(Keys.F6)
        b.js("await wait(() => shell.focusedRegion == 'sidebar', 'the Sidebar');")
        b.keys(Keys.HOME)
        b.js("""
        let header = orbitHeader(orbitBoxes()[0]);
        await wait(() => deepActive() == header, "focus on the Orbit header");
        check(header.matches(":focus-visible") && win.getComputedStyle(header).outlineStyle != "none", "no focus ring");
        check((await named(header)) == "One tab · Done, choose what to keep in the Assistant panel", accessibleName(header));
        let stops = [...tabList().renderRoot.querySelectorAll("[tabindex='0']")];
        check(stops.length == 1 && stops[0] == header, "the list is not one tab stop");
        """)
        b.keys(Keys.ARROW_DOWN)
        b.js("await wait(() => deepActive()?.tab == byLabel('Keys orbit'), 'Down to the Orbit tab');")
        b.keys(Keys.ARROW_LEFT)
        b.js("await wait(() => deepActive() == orbitHeader(orbitBoxes()[0]), 'Left back to the header');")
        b.keys(Keys.ENTER)
        b.js("""
        await wait(() => win.OrbitoAssistant.isOpen && shell.focusedRegion == "assistant", "Enter to open the Assistant panel");
        let card = await wait(() => assistant.log.querySelector(".orbit-card:not(.settled)"), "the wrap-up card");
        check((await named(card)) == "Orbit wrap-up", accessibleName(card));
        for (let button of card.querySelectorAll("button")) {
          check(await named(button), "a card button has no name");
        }
        logButton("Keep as group").focus({ focusVisible: true });
        check(win.getComputedStyle(logButton("Keep as group")).outlineStyle != "none", "no focus ring on the card");
        """)
        b.keys((Keys.SHIFT, Keys.F6))
        region = b.js("return shell.focusedRegion;")
        assert region == "page", region
    finally:
        b.js("await resetOrbits(); await onlyBlankTab();")


@test
def only_the_orbit_icon_opens_its_task_and_the_stop_button_still_stops_it(b):
    try:
        b.js("""
        await resetOrbits();
        await onlyBlankTab();
        useFakeBackend();
        await openPage("Icon asker");
        core.setPermissionMode(win, "bypass");
        let id = await askFake("Icon task", async ({ callTool, signal }) => {
          await callTool("open_tab", { url: pageURL("Icon orbit") });
          await new Promise(resolve => signal.aborted ? resolve() : signal.addEventListener("abort", resolve, { once: true }));
        });
        let box = await wait(() => orbitBoxes()[0]?.getAttribute("state") == "running" && orbitBoxes()[0], "the Orbit");
        let icon = orbitHeader(box);
        await wait(() => icon.title.startsWith("Icon task · "), `the task's name (${icon.title})`);
        // The icon is the header's button: 22 by 22, rounded 6px, once the
        // box has popped in.
        await wait(() => !box.getAnimations().some(a => a.animationName == "orbit-pop-in" && a.playState != "finished"), "the pop-in");
        let rect = icon.getBoundingClientRect();
        let radius = win.getComputedStyle(icon).borderTopLeftRadius;
        check(rect.width == 22 && rect.height == 22 && radius == "6px", `${rect.width}x${rect.height}, ${radius}`);
        await closeAssistant();
        // Beside the icon, the header opens nothing.
        box.querySelector(".orbit-head").click();
        box.querySelector(".orbit-bar").click();
        await sleep(200);
        check(!win.OrbitoAssistant.isOpen, "a click beside the icon opened the Assistant panel");
        // The icon opens the task's Thread, from another one and from the
        // Thread list.
        core.newThread(win);
        assistant.view = "threads";
        icon.click();
        await wait(() => win.OrbitoAssistant.isOpen, "the icon to open the Assistant panel");
        await wait(() => assistant.threadId == id && assistant.view == "chat", "the task's Thread");
        await closeAssistant();
        // The stop button stops the task, and opens nothing.
        box.querySelector(".stop").click();
        await finishedRun(id);
        await wait(() => orbitBoxes()[0]?.getAttribute("state") == "done", "the Orbit to be done");
        check(!win.OrbitoAssistant.isOpen, "the stop button opened the Assistant panel");
        """)
        # Only the icon lights under the pointer, not the header.
        icon = b.js("return middle(orbitHeader(orbitBoxes()[0]));")
        b.pointer(icon)
        b.js("""
        let icon = orbitHeader(orbitBoxes()[0]);
        await wait(() => icon.matches(":hover"), "the pointer over the icon");
        await sleep(200);
        let head = icon.closest(".orbit-head");
        check(win.getComputedStyle(icon).backgroundColor != "rgba(0, 0, 0, 0)", "the icon does not light");
        check(win.getComputedStyle(head).backgroundColor == "rgba(0, 0, 0, 0)", "the header lights");
        """)
    finally:
        b.js("await resetOrbits(); await onlyBlankTab();")


@test
def the_frame_and_the_ask_dot_show_what_the_agent_does(b):
    try:
        b.js("""
        await resetOrbits();
        await onlyBlankTab();
        useFakeBackend();
        await openPage("Frame asker");
        let other = win.OpenBrowserWindow();
        try {
          await wait(() => other.gBrowserInit?.delayedStartupFinished && other.OrbitoShell?.topBar, "the other window");
          let root = doc.documentElement;
          let tint = () => win.getComputedStyle(doc.body, "::before");
          let bar = shell.topBar;
          let ask = bar.askButton;
          let dot = () => ask.querySelector(".dot");
          let status = async () => { await bar.updateComplete; return ask.getAttribute("status"); };
          let name = text => wait(() => accessibleName(ask) == text, `the name ${text} (${accessibleName(ask)})`);
          check(!root.hasAttribute("orbito-frame") && tint().backgroundImage == "none", "a Frame state before any question");
          check(!(await status()) && !shown(dot()), "a dot before any question");

          let gates = [Promise.withResolvers(), Promise.withResolvers()];
          let id = await askFake("Frame", async ({ callTool }) => {
            await gates[0].promise;
            await callTool("open_tab", { url: pageURL("Frame result") });
            await gates[1].promise;
          });
          await closeAssistant();
          // Working: a faint accent tint breathes every 7 seconds, with no
          // band moving across, and the dot shows with the panel closed.
          await wait(() => root.getAttribute("orbito-frame") == "agent", "the working frame");
          let breathing = (seconds) => tint().animationName == "orbito-frame-breathe" &&
            tint().animationDuration == `${seconds}s` && tint().animationIterationCount == "infinite";
          check(breathing(7), `${tint().animationName} ${tint().animationDuration} ${tint().animationIterationCount}`);
          check(tint().backgroundImage.includes("gradient") && tint().backgroundImage.includes("55%"), tint().backgroundImage);
          check(tint().backgroundSize == "auto", `a band: ${tint().backgroundSize}`);
          await wait(async () => (await status()) == "running", "the working dot");
          check(shown(dot()) && win.getComputedStyle(dot()).animationName == "ask-dot-blink", "the working dot does not show or blink");
          let workingColor = win.getComputedStyle(dot()).backgroundColor;
          await name("Ask: Working");
          // Only in the window that asked.
          await other.OrbitoShell.topBar.updateComplete;
          check(!other.document.documentElement.hasAttribute("orbito-frame"), "the other window shows the frame");
          check(!other.OrbitoShell.topBar.askButton.hasAttribute("status"), "the other window shows the dot");
          // Recording a demonstration wins over the agent's states.
          shell.frameState.recording = true;
          check(root.getAttribute("orbito-frame") == "record", root.getAttribute("orbito-frame"));
          shell.frameState.recording = false;
          check(root.getAttribute("orbito-frame") == "agent", "the working frame did not come back");

          // Waiting for an approval: faint amber in the corners only
          // breathes every 4 seconds, the dot turns amber.
          gates[0].resolve();
          await wait(() => root.getAttribute("orbito-frame") == "attention", "the waiting frame");
          check(breathing(4), `${tint().animationName} ${tint().animationDuration} ${tint().animationIterationCount}`);
          check(tint().backgroundImage.includes("transparent 55%") || /rgba\(0, 0, 0, 0\) 55%/.test(tint().backgroundImage), `amber in the middle: ${tint().backgroundImage}`);
          await wait(async () => (await status()) == "confirm", "the waiting dot");
          check(shown(dot()) && win.getComputedStyle(dot()).backgroundColor != workingColor, "the waiting dot looks like the working one");
          await name("Ask: Waiting for your approval");

          // Without motion only the colors show.
          Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
          try {
            await wait(() => tint().animationName == "none", "the frame to stand still");
            check(tint().backgroundImage.includes("gradient") && tint().opacity == "1", `no still color: ${tint().opacity}`);
            check(win.getComputedStyle(dot()).animationName == "none" && shown(dot()), "the dot blinks or goes");
          } finally {
            Services.prefs.clearUserPref("ui.prefersReducedMotion");
          }
          await wait(() => tint().animationName == "orbito-frame-breathe", "the breathing to come back");

          await openAssistant();
          (await wait(() => assistant.log.querySelector(".approval .primary"), "the approval card")).click();
          await wait(() => root.getAttribute("orbito-frame") == "agent", "working again after Allow");
          // The working tint stands still too.
          Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
          try {
            await wait(() => tint().animationName == "none", "the working frame to stand still");
            check(tint().backgroundImage.includes("gradient") && tint().opacity == "1", `no still color: ${tint().opacity}`);
          } finally {
            Services.prefs.clearUserPref("ui.prefersReducedMotion");
          }
          await wait(() => breathing(7), "the working breath to come back");
          gates[1].resolve();
          await finishedRun(id);

          // Done, with the task's tabs left to sort out: no frame, a still dot.
          await wait(() => !root.hasAttribute("orbito-frame"), "the frame to go");
          await wait(() => tint().backgroundImage == "none", "the tint to go");
          await wait(async () => (await status()) == "decide", "the deciding dot");
          check(win.getComputedStyle(dot()).animationName == "none", "the deciding dot blinks");
          await name("Ask: Waiting for your decision");

          (await wait(() => logButton("Close tabs"), "the wrap-up card")).click();
          await wait(async () => !(await status()), "the dot to go");
          check(!shown(dot()), "the dot still shows");
          await name("Ask");
        } finally {
          await new Promise(resolve => {
            other.addEventListener("unload", resolve, { once: true });
            other.close();
          });
        }
        """)
    finally:
        b.js("await resetOrbits(); await onlyBlankTab();")


@test
def recording_tints_the_frame_red(b):
    b.js("""
    let root = doc.documentElement;
    let tint = () => win.getComputedStyle(doc.body, "::before");
    check(!shell.frameState.recording && !root.hasAttribute("orbito-frame"), "a Frame state before recording");
    shell.frameState.recording = true;
    try {
      check(root.getAttribute("orbito-frame") == "record", root.getAttribute("orbito-frame"));
      await wait(() => +tint().opacity == 1, "the red tint");
      check(tint().backgroundImage.includes("gradient") && tint().animationName == "none", `${tint().backgroundImage} ${tint().animationName}`);
      // The Ask button has no dot for recording (#61 brings its own pill).
      await shell.topBar.updateComplete;
      check(!shell.topBar.askButton.hasAttribute("status"), "Ask shows a dot for recording");
    } finally {
      shell.frameState.recording = false;
    }
    check(!root.hasAttribute("orbito-frame"), "the frame stays red");
    await wait(() => tint().backgroundImage == "none", "the tint to go");
    """)


@test
def show_orbito_starts_from_the_plus_menu_the_command_bar_and_the_settings(b):
    try:
        # The ＋ menu by the input, with a goal.
        b.js("""
        await onlyBlankTab();
        await resetOrbits();
        resetShow();
        let tab = await openPage("Show start");
        await openAssistant();
        assistant.plusButton.click();
        await assistant.updateComplete;
        check(shown(assistant.plusMenu), "the ＋ menu does not open");
        menuItem(assistant.plusMenu, "Show Orbito").click();
        await showState("goal");
        check(!shown(assistant.plusMenu), "the ＋ menu stays open");
        await wait(() => deepActive() == assistant.goalInput, "focus on the goal");
        check(assistant.showView.textContent.includes("What will you show?"), assistant.showView.textContent);
        check(!assistant.log && !doc.documentElement.hasAttribute("orbito-frame"), "the conversation shows or the frame is red before Start");
        assistant.goalInput.value = "Order my usual coffee";
        assistant.showStartButton.click();
        await showState("recording");
        let log = OrbitoShow.log(win);
        check(OrbitoShow.isRecording(win) && log.goal == "Order my usual coffee", `goal ${log?.goal}`);
        // From the tab as it is: its page is the first step.
        let [first] = log.steps;
        check(first?.type == "navigate" && first.url == pageURL("Show start") && first.title == "Show start", JSON.stringify(first));
        check(doc.documentElement.getAttribute("orbito-frame") == "record", "the frame is not red");
        let view = assistant.showView.textContent.replace(/\\s+/g, " ");
        check(view.includes("Orbito is watching") && view.includes("Order my usual coffee"), view);
        check(assistant.showCount.textContent.trim() == "Recording · 1 action", assistant.showCount.textContent);
        check(tab.selected, "the demo moved off its tab");
        resetShow();
        await showState(null);
        check(!doc.documentElement.hasAttribute("orbito-frame") && assistant.log, "the frame or the view stayed");
        await closeAssistant();
        """)
        # The Command bar's "Show Orbito", Enter in the empty goal starts.
        b.keys((ACCEL, "l"))
        pick_command(b, "show")
        b.js("""
        await showState("goal");
        await wait(() => !commandBar.isOpen, "the Command bar to close");
        check(win.OrbitoAssistant.isOpen, "the panel did not open");
        await wait(() => deepActive() == assistant.goalInput, `focus on the goal, not ${deepActive()?.localName}`);
        """)
        b.keys(Keys.ENTER)
        b.js("""
        await showState("recording");
        check(OrbitoShow.log(win).goal == "", OrbitoShow.log(win).goal);
        resetShow();
        await showState(null);
        """)
        # The settings' Skills: from a page none is recorded from.
        b.js("""
        let settings = await openOrbitoSettings();
        let button = settings.getElementById("skill-from-demo");
        await wait(() => button.textContent == "Create from a demo", `the button says ${button.textContent}`);
        button.click();
        await showState("goal");
        check(win.OrbitoAssistant.isOpen, "the panel did not open");
        assistant.showStartButton.click();
        await showState("recording");
        check(OrbitoShow.log(win).length == 0, JSON.stringify(OrbitoShow.log(win).steps));
        """)
    finally:
        b.js("resetShow(); await resetOrbits(); await onlyBlankTab();")


@test
def show_orbito_stops_by_button_shortcut_or_after_30_minutes_and_cancel_drops_the_log(b):
    try:
        b.js("""
        await onlyBlankTab();
        await resetOrbits();
        resetShow();
        await openPage("Show stop");
        let stops = [];
        let listener = event => stops.push(event.detail);
        win.addEventListener("OrbitoShowStop", listener);
        try {
          // The Stop button: the log stays for the review.
          let log = await startShow("Stop me");
          await openPage("Show stop 2");
          await wait(() => log.length > 1, "the demo to record the new tab");
          assistant.showStopButton.click();
          await showState("stopped");
          check(stops.length == 1 && stops[0].reason == "button" && stops[0].log == log, JSON.stringify(stops.map(s => s.reason)));
          check(shell.show.reason == "button" && shell.show.log == log, "the stopped demo is not kept");
          check(!OrbitoShow.isRecording(win) && !log.discarded && log.length > 1, "the log is gone or records");
          check(!doc.documentElement.hasAttribute("orbito-frame"), "the frame stays red");
          let view = assistant.showView.textContent.replace(/\\s+/g, " ");
          check(view.includes("Demo recorded") && view.includes(`${log.length} actions recorded`), view);
          // Discard drops it.
          assistant.showCancelButton.click();
          await showState(null);
          check(log.discarded && !OrbitoShow.log(win), "the log stays after Discard");

          // Cancel while recording drops it at once.
          log = await startShow();
          assistant.showCancelButton.click();
          await showState(null);
          check(log.discarded && !OrbitoShow.log(win) && !doc.documentElement.hasAttribute("orbito-frame"), "Cancel kept the log or the frame");
          check(stops.length == 1, "Cancel handed the log on");

          // By itself once the time is up (shortened here from 30 minutes).
          shell.show.limit = 300;
          log = await startShow();
          await showState("stopped");
          check(stops.at(-1).reason == "timeout" && !log.discarded, stops.at(-1).reason);
          check(assistant.showView.textContent.includes("Stopped after 30 minutes."), assistant.showView.textContent);
          resetShow();
          await showState(null);
          check(shell.show.limit == MAX_RECORDING_MS && MAX_RECORDING_MS == 30 * 60 * 1000, `${shell.show.limit}`);

          log = await startShow();
          win.gBrowser.selectedBrowser.focus();
          await wait(() => shell.focusedRegion == "page", "the page to have focus");
        } finally {
          win.removeEventListener("OrbitoShowStop", listener);
        }
        """)
        # The shortcut, from the page.
        b.keys((ACCEL, Keys.SHIFT, "."))
        b.js("""
        await showState("stopped");
        check(shell.show.reason == "shortcut", shell.show.reason);
        // The shortcut does nothing more once stopped.
        resetShow();
        await showState(null);
        """)
        b.keys((ACCEL, Keys.SHIFT, "."))
        b.js("""
        await sleep(200);
        check(!shell.show.state, `the shortcut did ${shell.show.state}`);

        // Closing the window drops its demo.
        let other = win.OpenBrowserWindow();
        await wait(() => other.gBrowserInit?.delayedStartupFinished && other.OrbitoShell?.assistant, "the other window");
        let log = await startShow("", other);
        check(!OrbitoShow.isRecording(win), "this window records too");
        await new Promise(resolve => {
          other.addEventListener("unload", resolve, { once: true });
          other.close();
        });
        check(log.discarded, "the closed window's log stays");
        """)
    finally:
        b.js("resetShow(); await resetOrbits(); await onlyBlankTab();")


@test
def show_orbito_blocks_the_agent_of_its_window_only(b):
    try:
        b.js("""
        await onlyBlankTab();
        await resetOrbits();
        resetShow();
        useFakeBackend();
        let asked = 0;
        fake.run = async () => { asked++; };
        await openPage("Show blocks");
        let other = win.OpenBrowserWindow();
        try {
          await wait(() => other.gBrowserInit?.delayedStartupFinished && other.OrbitoShell?.assistant, "the other window");
          await startShow();
          await assistant.updateComplete;
          check(assistant.input.disabled && assistant.sendButton.disabled && assistant.plusButton.disabled, "the input takes questions");
          check(assistant.input.placeholder == "You can ask again once Show Orbito is done", assistant.input.placeholder);
          let id = core.threadFor(win);
          await assistant.submit("Are you there?");
          win.OrbitoAssistant.ask("Are you there?");
          await assistant.updateComplete;
          await sleep(200);
          check(!core.isRunning(id) && !asked, "a question was asked while recording");
          check(shown(assistant.inputNotice) && assistant.inputNotice.textContent == "You can ask again once Show Orbito is done", assistant.inputNotice.textContent);
          // The other window asks as before.
          let panel = await openAssistant(other);
          check(!other.OrbitoShell.show.state && !panel.input.disabled && panel.log, "the other window is blocked");
          check(!other.document.documentElement.hasAttribute("orbito-frame"), "the other window's frame is red");
          // The count follows the steps.
          let log = OrbitoShow.log(win);
          await openPage("Show blocks 2");
          await wait(() => assistant.showCount.textContent.trim() == `Recording · ${log.length} actions` && log.length > 1,
            `the count (${assistant.showCount.textContent}, ${log.length})`);
          resetShow();
          await showState(null);
          check(!assistant.input.disabled && !shown(assistant.inputNotice), "the input stays blocked");

          // No demo while the agent works in this window.
          let gate = Promise.withResolvers();
          id = await askFake("Work", () => gate.promise);
          check(!shell.show.begin() && !shell.show.state, "a demo began while the agent works");
          await assistant.updateComplete;
          check(assistant.inputNotice.textContent == "Show Orbito can start once Orbito has finished its work in this window.", assistant.inputNotice.textContent);
          // Nor if it started while the goal was asked.
          gate.resolve();
          await finishedRun(id);
          check(shell.show.begin(), "no demo after the agent's work");
          await showState("goal");
          gate = Promise.withResolvers();
          fake.run = () => gate.promise;
          // A question from a tab of this window that is not shown.
          let otherTab = win.gBrowser.addTrustedTab("about:blank");
          let run = core.ask({
            threadId: core.threadFor(win),
            prompt: "Work",
            origin: { tab: otherTab },
            confirm: async () => true,
            ...assistant.requestOptions(),
          });
          await wait(() => core.windowActivity(win), "the agent to work");
          assistant.showStartButton.click();
          await showState(null);
          check(!OrbitoShow.isRecording(win), "the demo started while the agent works");
          gate.resolve();
          await run.catch(() => {});
          // The other window can record meanwhile, and this one is left alone.
          await startShow("", other);
          check(!shell.show.state && !doc.documentElement.hasAttribute("orbito-frame"), "this window shows the other's demo");
        } finally {
          resetShow();
          await new Promise(resolve => {
            other.addEventListener("unload", resolve, { once: true });
            other.close();
          });
        }
        """)
    finally:
        b.js("resetShow(); await resetOrbits(); await onlyBlankTab();")


@test
def show_orbito_follows_the_keyboard_rules(b):
    try:
        b.js("""
        await onlyBlankTab();
        await resetOrbits();
        resetShow();
        await openPage("Show keys");
        await openAssistant();
        check(await named(assistant.plusButton) == "More actions", accessibleName(assistant.plusButton));
        assistant.plusButton.focus({ focusVisible: true });
        check(win.getComputedStyle(assistant.plusButton).outlineStyle != "none", "the ＋ button shows no focus ring");
        """)
        # The ＋ menu: Enter opens it on its item, arrows stay in it, Escape
        # goes back to the button.
        b.keys(Keys.ENTER)
        b.js("""
        await wait(() => deepActive()?.dataset?.command == "show", "focus on Show Orbito");
        check(deepActive().matches(":focus-visible"), "the item shows no focus");
        check(assistant.plusButton.getAttribute("aria-expanded") == "true", "the button does not say the menu is open");
        """)
        b.keys(Keys.ARROW_DOWN)
        b.js('await wait(() => deepActive()?.dataset?.command == "show", "Down stays on the only item");')
        b.keys(Keys.ESCAPE)
        b.js("""
        await wait(() => deepActive() == assistant.plusButton, "Escape back to the button");
        await assistant.updateComplete;
        check(!shown(assistant.plusMenu) && !shell.show.state, "the menu stayed open or began");
        """)
        # Enter on the item asks the goal; Escape there leaves it.
        b.keys(Keys.ENTER)
        b.js('await wait(() => deepActive()?.dataset?.command == "show", "focus on Show Orbito");')
        b.keys(Keys.ENTER)
        b.js("""
        await showState("goal");
        await wait(() => deepActive() == assistant.goalInput, "focus on the goal");
        check(await named(assistant.goalInput) == "What will you show?", accessibleName(assistant.goalInput));
        for (let [button, name] of [[assistant.showCancelButton, "Cancel"], [assistant.showStartButton, "Start"]]) {
          check(await named(button) == name, accessibleName(button));
        }
        """)
        b.keys(Keys.ESCAPE)
        b.js("""
        await showState(null);
        await wait(() => deepActive() == assistant.input, "focus back on the input");
        check(win.OrbitoAssistant.isOpen, "Escape closed the panel");
        shell.show.begin();
        await showState("goal");
        await wait(() => deepActive() == assistant.goalInput, "focus on the goal");
        """)
        # Tab reaches Cancel and Start; Enter on Start records, with focus
        # on Stop.
        b.keys(Keys.TAB, Keys.TAB)
        b.js('await wait(() => deepActive() == assistant.showStartButton, `focus on ${deepActive()?.className}`);')
        b.keys(Keys.ENTER)
        b.js("""
        await showState("recording");
        await wait(() => deepActive() == assistant.showStopButton, "focus on Stop");
        check(assistant.showStopButton.matches(":focus-visible"), "Stop shows no focus");
        check(win.getComputedStyle(assistant.showStopButton).outlineStyle != "none", "no focus ring on Stop");
        check(await named(assistant.showStopButton) == "Stop", accessibleName(assistant.showStopButton));
        check(await named(assistant.showCancelButton) == "Cancel", accessibleName(assistant.showCancelButton));
        let controls = [...assistant.showView.querySelectorAll("button, input, [tabindex]")].filter(shown);
        check(controls.every(el => accessibleName(el)), "a control without a name");
        win.gBrowser.selectedBrowser.focus();
        await wait(() => shell.focusedRegion == "page", "the page to have focus");
        """)
        # F6 from the page goes to Stop, the input being blocked.
        b.keys(Keys.F6)
        b.js("""
        await wait(() => deepActive() == assistant.showStopButton, `focus on ${deepActive()?.localName}.${deepActive()?.className}`);
        check(shell.focusedRegion == "assistant", shell.focusedRegion);
        """)
        b.keys(Keys.ENTER)
        b.js("""
        await showState("stopped");
        await wait(() => deepActive() == assistant.showCancelButton, "focus on Discard");
        check(await named(assistant.showCancelButton) == "Discard", accessibleName(assistant.showCancelButton));
        """)
        b.keys(Keys.ENTER)
        b.js("""
        await showState(null);
        await wait(() => deepActive() == assistant.input, "focus back on the input");
        """)
    finally:
        b.js("resetShow(); await resetOrbits(); await onlyBlankTab();")


@test
def show_orbito_summarizes_the_demo_live_with_the_window_backend(b):
    try:
        b.js("""
        await onlyBlankTab();
        await resetOrbits();
        resetShow();
        await openPage("Show summary");
        useFakeBackend();
        // Each request answers with its number once the gate, if any, opens.
        let asked = [];
        let gate = null;
        let inFlight = 0;
        let most = 0;
        fake.run = async options => {
          let n = asked.push(options);
          most = Math.max(most, ++inFlight);
          try {
            await gate?.promise;
            options.emit({ type: "text", text: `Draft:\\n1. Open page ${n}\\n2. Look around` });
          } finally {
            inFlight--;
          }
        };
        let counted = () => `Recording · ${log.length} ${log.length == 1 ? "action" : "actions"}`;
        let stepsShown = () => [...assistant.showSteps.querySelectorAll("li")].map(li => li.textContent).join(" | ");
        let id = core.newThread(win);
        let log = await startShow("Look around");
        await openAssistant();
        check(!shown(assistant.showSteps), "steps before the model wrote any");

        // The first page, sent once the user has done nothing for a while,
        // on its own: no history, no tools.
        await wait(() => asked.length == 1, "the first batch");
        let first = asked[0];
        check(first.history.length == 0 && first.tools.length == 0 && first.model == "test", JSON.stringify({ history: first.history, tools: first.tools, model: first.model }));
        check(first.prompt.includes('Goal: "Look around"') && first.prompt.includes(`Went to "Show summary" ("${pageURL("Show summary")}")`), first.prompt);
        await wait(() => stepsShown() == "Open page 1 | Look around", `the draft (${stepsShown()})`);
        check(shown(assistant.showSteps), "the steps do not show");
        check(assistant.showCount.textContent.trim() == counted(), assistant.showCount.textContent);

        // A page change sends at once; one request at a time, the batches
        // due meanwhile after it, with the draft so far.
        gate = Promise.withResolvers();
        await openPage("Show summary 2");
        await wait(() => asked.length == 2, "the page change's batch");
        await openPage("Show summary 3");
        await sleep(2000);
        check(asked.length == 2 && most == 1, `${asked.length} requests, ${most} at once`);
        gate.resolve();
        gate = null;
        await wait(() => asked.length >= 3 && !inFlight, "the batch that waited");
        let last = asked.at(-1);
        check(last.prompt.includes(pageURL("Show summary 3")) && /<draft>\\n1\\. Open page \\d+\\n2\\. Look around\\n<\\/draft>/.test(last.prompt), last.prompt);
        await wait(() => stepsShown() == `Open page ${asked.length} | Look around`, `the new draft (${stepsShown()})`);
        check(most == 1, `${most} requests at once`);
        // Not a question of any conversation.
        check(!core.isRunning(id) && (await core.getMessages(id)).length == 0, "the summary went into the conversation");

        // The backend fails: no steps, only the count, and the demo records on.
        fake.run = async options => {
          asked.push(options);
          throw new Error("The backend is down");
        };
        let before = asked.length;
        let length = log.length;
        await openPage("Show summary 4");
        await wait(() => asked.length > before, "the batch after the failure");
        await wait(() => !shown(assistant.showSteps), "the steps after the failure");
        check(shell.show.recording && OrbitoShow.isRecording(win), "the failure stopped the demo");
        await wait(() => log.length > length && assistant.showCount.textContent.trim() == counted(),
          `the count (${assistant.showCount.textContent})`);

        // No backend set up: the same.
        dropFakeBackend();
        core.backend = "claude";
        length = log.length;
        await openPage("Show summary 5");
        await wait(() => log.length > length, "the demo to record the new tab");
        await sleep(2000);
        check(!shown(assistant.showSteps) && shell.show.recording, "steps without a backend");
        check(assistant.showCount.textContent.trim() == counted(), assistant.showCount.textContent);

        // Once stopped, no more requests: only the one that turns the demo
        // into a skill.
        useFakeBackend();
        fake.run = async options => { asked.push(options); };
        before = asked.length;
        assistant.showStopButton.click();
        await showState("stopped");
        check(!assistant.showSteps && shell.show.summary == null, "the draft stays once stopped");
        await wait(() => asked.length == before + 1, "the conversion");
        check(asked.at(-1).system.includes("into a skill for Orbito"), asked.at(-1).system);
        await openPage("Show summary 6");
        await sleep(2000);
        check(asked.length == before + 1, "asked after the demo stopped");
        """)
    finally:
        b.js("resetShow(); await resetOrbits(); await onlyBlankTab();")


# The reply a fake backend gives for turning a demo into a skill, and what
# stands in for a page reporting a search, an email and a password.
SHOW_SKILL_JS = r"""
const SHOW_REPLY = JSON.stringify({
  name: "Order a mouse",
  description: "Orders a product from the shop",
  tools: ["navigate", "type", "click", "read_page"],
  inputs: [
    { name: "query", description: "The product to search for", example: "wireless mouse", placeholder: null },
    { name: "email", description: "The email for the receipt", placeholder: "[email]" },
  ],
  steps: [
    { text: "Go to the shop", user_enters: false },
    { text: "Search for {query}", user_enters: false },
    { text: "Enter [email] as the email", user_enters: false },
    { text: "Enter the password", user_enters: true },
    { text: "Press Buy", user_enters: false },
  ],
});
// Whether a request a backend got is the one that turns a demo into a skill.
const isConversion = options => options.system.includes("into a skill for Orbito");
function recordFields(w = win) {
  let browser = w.gBrowser.selectedBrowser;
  let field = { tag: "input", type: "text" };
  OrbitoShow.record(browser, { type: "input", label: "Search", field, value: "wireless mouse" });
  OrbitoShow.record(browser, { type: "input", label: "Email", field: { ...field, autocomplete: "email" }, value: "me@example.com" });
  OrbitoShow.record(browser, { type: "input", label: "Password", field: { tag: "input", type: "password" }, value: "hunter2" });
}
const reviewSteps = () => [...assistant.reviewSteps.querySelectorAll(".step-text")];
const reviewStepTexts = () => reviewSteps().map(f => f.value).join(" | ");
async function reviewReady() {
  await wait(() => shell.show.review?.phase == "ready", `the review (${shell.show.review?.phase}: ${shell.show.review?.error})`);
  await assistant.updateComplete;
}
const plain = text => text.replace(/[⁨⁩]/g, "").replace(/\s+/g, " ");
async function dropDemoSkills() {
  for (let skill of await core.skills()) {
    if (skill.source == "demo") {
      await core.deleteSkill(skill.dir);
    }
  }
}
"""


@test
def show_orbito_turns_the_demo_into_a_skill_the_user_reviews_and_saves(b):
    try:
        b.js(SHOW_SKILL_JS + """
        await onlyBlankTab();
        await resetOrbits();
        resetShow();
        await dropDemoSkills();
        await openPage("Show review");
        useFakeBackend();
        let conversions = [];
        let gate = null;
        let reply = SHOW_REPLY;
        fake.run = async options => {
          // The live summary writes no draft here.
          if (!isConversion(options)) {
            return;
          }
          conversions.push(options);
          await gate?.promise;
          options.emit({ type: "text", text: "Here it is:\\n```json\\n" + reply + "\\n```" });
        };
        let id = core.newThread(win);
        let log = await startShow("Order a mouse");
        recordFields();

        // One request on its own, with the masked steps: never the email
        // nor the password.
        gate = Promise.withResolvers();
        assistant.showStopButton.click();
        await showState("stopped");
        await wait(() => conversions.length == 1, "the conversion request");
        let request = conversions[0];
        check(request.history.length == 0 && request.tools.length == 0 && request.model == "test", JSON.stringify({ history: request.history, tools: request.tools }));
        check(request.prompt.includes('<demo_actions>\\nGoal: "Order a mouse"') && request.prompt.includes("Typed [email] into") &&
          request.prompt.includes("themselves (password"), request.prompt);
        check(!(request.prompt + request.system).includes("me@example.com") && !(request.prompt + request.system).includes("hunter2"), request.prompt);
        // While it converts.
        check(assistant.showView.getAttribute("aria-busy") == "true" && plain(assistant.showView.textContent).includes("Turning the demo into a skill"), assistant.showView.textContent);
        gate.resolve();
        gate = null;
        await reviewReady();
        check(!core.isRunning(id) && (await core.getMessages(id)).length == 0, "the conversion went into the conversation");

        // The review: name, description, inputs, steps.
        check(plain(assistant.showView.textContent).includes("Review the skill"), assistant.showView.textContent);
        check(assistant.reviewName.value == "Order a mouse" && assistant.reviewDescription.value == "Orders a product from the shop",
          `${assistant.reviewName.value} / ${assistant.reviewDescription.value}`);
        let inputs = [...assistant.reviewInputs.querySelectorAll(".review-input")];
        check(inputs.map(li => li.dataset.name).join() == "query,email", inputs.map(li => li.dataset.name).join());
        check(plain(inputs[0].textContent).includes('In the demo: wireless mouse') && plain(inputs[1].textContent).includes("In the demo: me@example.com"),
          plain(assistant.reviewInputs.textContent));
        check(reviewStepTexts() == "Go to the shop | Search for {query} | Enter {email} as the email | Enter the password | Press Buy", reviewStepTexts());
        let direct = assistant.reviewSteps.children[3];
        check(direct.hasAttribute("data-direct") && direct.textContent.includes("You enter this yourself"), direct.textContent);
        check(shown(assistant.showSaveButton) && shown(assistant.showRerecordButton) && shown(assistant.showCancelButton), "the review's buttons");

        // The email a fixed value, as in the demo: personal, so warned of.
        const WARNING = "saved in the skill file as it is";
        let fixed = inputs[1].querySelector('[data-value="fixed"]');
        check(!plain(inputs[1].textContent).includes(WARNING) && !fixed.hasAttribute("aria-describedby"), "warned of before Fixed value");
        fixed.click();
        await assistant.updateComplete;
        check(fixed.getAttribute("aria-checked") == "true" && plain(inputs[1].textContent).includes("Always: me@example.com"), plain(inputs[1].textContent));
        let warning = inputs[1].querySelector(".input-warning");
        check(warning && shown(warning) && plain(warning.textContent).includes(WARNING) &&
          fixed.getAttribute("aria-describedby") == warning.id, inputs[1].innerHTML);
        // The query, not personal, a fixed value and back: no warning.
        let queryFixed = inputs[0].querySelector('[data-value="fixed"]');
        queryFixed.click();
        await assistant.updateComplete;
        check(queryFixed.getAttribute("aria-checked") == "true" && !plain(inputs[0].textContent).includes(WARNING) &&
          !inputs[0].querySelector(".input-warning") && !queryFixed.hasAttribute("aria-describedby"), inputs[0].innerHTML);
        inputs[0].querySelector('[data-value="input"]').click();
        await assistant.updateComplete;
        // Step 1 edited, step 5 deleted, step 4 moved up.
        let first = reviewSteps()[0];
        first.value = "Open the shop";
        first.dispatchEvent(new win.Event("input"));
        assistant.reviewSteps.children[4].querySelector(".step-delete").click();
        await assistant.updateComplete;
        assistant.reviewSteps.children[3].querySelector(".step-up").click();
        await assistant.updateComplete;
        check(reviewStepTexts() == "Open the shop | Search for {query} | Enter the password | Enter {email} as the email", reviewStepTexts());

        // Saved: a user skill like any other, the log gone at once.
        assistant.showSaveButton.click();
        await showState(null);
        check(log.discarded && !OrbitoShow.log(win) && !shell.show.review, "the log stays after Save");
        await wait(() => plain(assistant.inputNotice?.textContent ?? "").includes("Saved /Order a mouse"), "the saved notice");
        let skill = (await core.skills()).find(s => s.name == "Order a mouse");
        check(skill && !skill.builtin && skill.source == "demo" && skill.enabled, JSON.stringify(skill));
        let body = [
          "## Inputs",
          "",
          '- query: The product to search for (e.g. "wireless mouse")',
          "",
          "Fill in the values from what the user added after the skill's name or from the conversation, and ask for any that are missing.",
          "",
          "## Steps",
          "",
          "1. Open the shop",
          "2. Search for {query}",
          "3. Enter the password The user enters this step themselves.",
          "4. Enter me@example.com as the email",
        ].join("\\n");
        check(skill.body == body, skill.body);
        const { parseSkill } = ChromeUtils.importESModule("chrome://browser/content/orbito/OrbitoSkills.sys.mjs");
        let file = await IOUtils.readUTF8(PathUtils.join(PathUtils.profileDir, "orbito-assistant", "skills", skill.dir, "SKILL.md"));
        check(file.includes("\\nsource: demo\\n"), file);
        check(JSON.stringify(parseSkill(file)) == JSON.stringify({
          name: "Order a mouse",
          description: "Orders a product from the shop",
          tools: ["navigate", "type", "click", "read_page"],
          output: "chat",
          source: "demo",
          body,
        }), file);

        // The settings' Skills mark it, with Record again.
        let settings = await openOrbitoSettings();
        let card = await wait(() => settings.querySelector(`.skill[data-dir="${CSS.escape(skill.dir)}"]`), "the skill's card");
        check(card.dataset.source == "demo" && card.querySelector(".skill-kind").textContent == "Made from a demo", card.textContent);
        let again = [...card.querySelectorAll("button")].find(button => button.textContent == "Record again");
        check(again, card.textContent);
        // Recording it again: the goal its description; saving replaces it,
        // under its name.
        reply = JSON.stringify({ name: "Something else", description: "Orders it again", tools: ["navigate"], inputs: [], steps: ["Open the shop again"] });
        again.click();
        await showState("goal");
        check(assistant.goalInput.value == "Orders a product from the shop" && shell.show.replacing?.dir == skill.dir, assistant.goalInput.value);
        assistant.showStartButton.click();
        await showState("recording");
        assistant.showStopButton.click();
        await reviewReady();
        check(assistant.reviewName.value == "Order a mouse" && plain(assistant.showView.textContent).includes("Review /Order a mouse, recorded again"),
          `${assistant.reviewName.value}: ${plain(assistant.showView.textContent)}`);
        check(!assistant.reviewInputs, "inputs without any");
        assistant.showSaveButton.click();
        await showState(null);
        let demos = (await core.skills()).filter(s => s.source == "demo");
        check(demos.length == 1 && demos[0].dir == skill.dir && demos[0].description == "Orders it again" &&
          demos[0].body == "## Steps\\n\\n1. Open the shop again", JSON.stringify(demos));
        """)
    finally:
        b.js(SHOW_SKILL_JS + "resetShow(); await dropDemoSkills(); await resetOrbits(); await onlyBlankTab();")


@test
def show_orbito_tries_the_conversion_again_records_again_and_discards(b):
    try:
        b.js(SHOW_SKILL_JS + """
        await onlyBlankTab();
        await resetOrbits();
        resetShow();
        await dropDemoSkills();
        await openPage("Show retry");
        useFakeBackend();
        let conversions = [];
        let gate = Promise.withResolvers();
        fake.run = async options => {
          if (!isConversion(options)) {
            return;
          }
          let n = conversions.push(options);
          if (n == 1) {
            await gate.promise;
          } else if (n == 2) {
            throw new Error("The backend is down");
          } else if (n == 3) {
            options.emit({ type: "text", text: "Sorry, I cannot help with that." });
          } else {
            options.emit({ type: "text", text: SHOW_REPLY });
          }
        };

        // Discarded while it converts: the request dropped, the log gone.
        let log = await startShow("Try");
        assistant.showStopButton.click();
        await wait(() => conversions.length == 1, "the conversion");
        assistant.showCancelButton.click();
        await showState(null);
        check(conversions[0].signal.aborted && log.discarded && !OrbitoShow.log(win), "Discard kept the request or the log");
        gate.resolve();
        await sleep(200);
        check(!shell.show.state && !shell.show.review, "the dropped request came back");

        // It fails: why, and Try again; a reply that is not a skill, the same.
        log = await startShow("Try");
        recordFields();
        assistant.showStopButton.click();
        await wait(() => shell.show.review?.phase == "failed", "the failure");
        await assistant.updateComplete;
        check(shown(assistant.showError) && plain(assistant.showError.textContent).includes("Could not turn the demo into a skill: The backend is down"), assistant.showError.textContent);
        check(await named(assistant.showRetryButton) == "Try again" && assistant.showView.getAttribute("aria-busy") == "false", "Try again");
        check(plain(assistant.showView.textContent).includes("Demo recorded") && !log.discarded, assistant.showView.textContent);
        assistant.showRetryButton.click();
        await wait(() => conversions.length == 3 && shell.show.review?.phase == "failed", "the second failure");
        await assistant.updateComplete;
        check(plain(assistant.showError.textContent).includes("The reply was not a skill"), assistant.showError.textContent);
        assistant.showRetryButton.click();
        await reviewReady();
        check(!conversions[3].prompt.includes("me@example.com") && !log.discarded, "the retry");

        // A skill that cannot be saved says why, and the demo stays.
        assistant.reviewName.value = "";
        assistant.reviewName.dispatchEvent(new win.Event("input"));
        assistant.showSaveButton.click();
        await wait(() => shown(assistant.showError) && assistant.showError.textContent.includes("no name"), "why it was not saved");
        check(shell.show.state == "stopped" && !log.discarded && !(await core.skills()).some(s => s.source == "demo"), "saved without a name");
        check(assistant.showError.getAttribute("role") == "alert", "the error is not an alert");

        // Record again: the log goes, the goal asked again.
        assistant.showRerecordButton.click();
        await showState("goal");
        check(log.discarded && !OrbitoShow.log(win) && assistant.goalInput.value == "Try", assistant.goalInput.value);
        assistant.showStartButton.click();
        await showState("recording");
        log = OrbitoShow.log(win);
        assistant.showStopButton.click();
        await reviewReady();
        // Discard: nothing saved, the log gone.
        assistant.showCancelButton.click();
        await showState(null);
        check(log.discarded && !OrbitoShow.log(win) && !shell.show.review, "the log stays after Discard");
        check(!(await core.skills()).some(s => s.source == "demo"), "Discard saved a skill");
        """)
    finally:
        b.js(SHOW_SKILL_JS + "resetShow(); await dropDemoSkills(); await resetOrbits(); await onlyBlankTab();")


@test
def show_orbito_review_follows_the_keyboard_rules(b):
    try:
        b.js(SHOW_SKILL_JS + """
        await onlyBlankTab();
        await resetOrbits();
        resetShow();
        await openPage("Show review keys");
        useFakeBackend();
        fake.run = async options => {
          if (isConversion(options)) {
            options.emit({ type: "text", text: SHOW_REPLY });
          }
        };
        await startShow();
        recordFields();
        assistant.showStopButton.focus({ focusVisible: true });
        """)
        # Stopped from the keyboard, focus goes on to the skill's name.
        b.keys(Keys.ENTER)
        b.js(SHOW_SKILL_JS + """
        await reviewReady();
        await wait(() => deepActive() == assistant.reviewName, `focus on the name, not ${deepActive()?.className}`);
        check(await named(assistant.reviewName) == "Name" && await named(assistant.reviewDescription) == "Description", "the fields' names");
        for (let [button, name] of [[assistant.showCancelButton, "Discard"], [assistant.showRerecordButton, "Record again"], [assistant.showSaveButton, "Save"]]) {
          check(await named(button) == name, accessibleName(button));
        }
        let up = assistant.reviewSteps.children[1].querySelector(".step-up");
        check(await named(up) == "Move step 2 up", accessibleName(up));
        check(await named(assistant.reviewSteps.children[1].querySelector(".step-delete")) == "Delete step 2", "Delete's name");
        check(await named(reviewSteps()[0]) == "Step 1", accessibleName(reviewSteps()[0]));
        let group = assistant.reviewInputs.querySelector('[role="radiogroup"]');
        check(plain(await named(group)).includes("{query}"), accessibleName(group));
        let controls = [...assistant.reviewView.querySelectorAll("button, input, [tabindex]")].filter(shown);
        check(controls.every(el => accessibleName(el)), "a control without a name");
        win.gBrowser.selectedBrowser.focus();
        await wait(() => shell.focusedRegion == "page", "the page to have focus");
        """)
        # F6 from the page goes to the name.
        b.keys(Keys.F6)
        b.js(SHOW_SKILL_JS + """
        await wait(() => deepActive() == assistant.reviewName, `focus on ${deepActive()?.localName}.${deepActive()?.className}`);
        check(shell.focusedRegion == "assistant", shell.focusedRegion);
        """)
        # Tab to the first input's choice, one tab stop; the arrows pick.
        b.keys(Keys.TAB, Keys.TAB)
        b.js(SHOW_SKILL_JS + """
        let query = shell.show.review.skill.inputs[0];
        let radio = deepActive();
        check(radio?.getAttribute("role") == "radio" && radio.dataset.value == "input" && radio.closest(".review-input").dataset.name == "query", `focus on ${radio?.outerHTML}`);
        check(radio.matches(":focus-visible") && win.getComputedStyle(radio).outlineStyle != "none", "no focus ring on the choice");
        check(!query.fixed, "fixed to start with");
        """)
        b.keys(Keys.ARROW_RIGHT)
        b.js(SHOW_SKILL_JS + """
        await wait(() => deepActive()?.dataset?.value == "fixed", "focus on Fixed value");
        check(shell.show.review.skill.inputs[0].fixed && deepActive().getAttribute("aria-checked") == "true", "Right did not pick Fixed value");
        """)
        b.keys(Keys.ARROW_LEFT)
        b.js(SHOW_SKILL_JS + """
        await wait(() => deepActive()?.dataset?.value == "input", "focus back on As input");
        check(!shell.show.review.skill.inputs[0].fixed, "Left did not pick As input");
        """)
        # The next input's choice, then the first step; Down goes to the next.
        b.keys(Keys.TAB)
        b.js(SHOW_SKILL_JS + 'await wait(() => deepActive()?.closest?.(".review-input")?.dataset.name == "email", `focus on ${deepActive()?.outerHTML}`);')
        b.keys(Keys.TAB)
        b.js(SHOW_SKILL_JS + 'await wait(() => deepActive() == reviewSteps()[0], `focus on ${deepActive()?.outerHTML}`);')
        b.keys(Keys.ARROW_DOWN)
        b.js(SHOW_SKILL_JS + 'await wait(() => deepActive() == reviewSteps()[1], "Down to step 2");')
        # Alt+Down moves the step, focus with it.
        b.keys((Keys.ALT, Keys.ARROW_DOWN))
        b.js(SHOW_SKILL_JS + """
        await wait(() => reviewStepTexts() == "Go to the shop | Enter {email} as the email | Search for {query} | Enter the password | Press Buy", reviewStepTexts());
        await wait(() => deepActive() == reviewSteps()[2], `focus on ${deepActive()?.value}`);
        """)
        b.keys((Keys.ALT, Keys.ARROW_UP))
        b.js(SHOW_SKILL_JS + """
        await wait(() => reviewStepTexts() == "Go to the shop | Search for {query} | Enter {email} as the email | Enter the password | Press Buy", reviewStepTexts());
        await wait(() => deepActive() == reviewSteps()[1], `focus on ${deepActive()?.value}`);
        """)
        # Tab to its Move up; Enter moves it, focus on the button still.
        b.keys(Keys.TAB)
        b.js(SHOW_SKILL_JS + """
        let up = assistant.reviewSteps.children[1].querySelector(".step-up");
        await wait(() => deepActive() == up, `focus on ${deepActive()?.className}`);
        check(up.matches(":focus-visible") && win.getComputedStyle(up).outlineStyle != "none", "no focus ring on Move up");
        """)
        b.keys(Keys.ENTER)
        b.js(SHOW_SKILL_JS + """
        await wait(() => reviewStepTexts().startsWith("Search for {query} | Go to the shop"), reviewStepTexts());
        // At the top Move up is off: focus on the step's field.
        await wait(() => deepActive() == reviewSteps()[0], `focus on ${deepActive()?.className}`);
        """)
    finally:
        b.js(SHOW_SKILL_JS + "resetShow(); await dropDemoSkills(); await resetOrbits(); await onlyBlankTab();")


SHOW_REPLAY_JS = r"""
const { demoSkill } = ChromeUtils.importESModule("chrome://browser/content/orbito/OrbitoShowSkill.sys.mjs");
const REPLAY_SKILL = "Replay mouse";
// A skill made from a demo: three steps, the second one the user enters.
async function saveReplaySkill() {
  await core.saveSkill(demoSkill({
    name: REPLAY_SKILL,
    description: "Orders a mouse again",
    tools: ["navigate", "click", "type"],
    inputs: [],
    steps: [
      { text: "Go to the shop", direct: false },
      { text: "Enter the password", direct: true },
      { text: "Press Buy", direct: false },
    ],
  }, { locale: "en-US" }));
}
// The running reply's steps, pinned above the input; once it ends, the
// last reply's.
const pinnedSteps = () => assistant.renderRoot.querySelector(".skill-steps.pinned");
const stepsCard = () => pinnedSteps() ?? [...assistant.log.querySelectorAll(".skill-steps")].at(-1);
// The list's rows: pinned, only once opened.
const stepRows = () => [...(stepsCard()?.querySelectorAll("li") ?? [])];
// Pinned, the bar's segments; in the reply, the list's rows.
const stepClasses = () =>
  [...(pinnedSteps()?.querySelectorAll(".skill-steps-bar i") ?? stepRows())].map(el => el.className).join();
const stepsPartOf = async id => (await core.getMessages(id)).at(-1).parts.findLast(p => p.type == "skill_steps");
"""


@test
def a_skill_made_from_a_demo_shows_its_steps_and_the_one_the_agent_is_on(b):
    try:
        b.js(SHOW_SKILL_JS + SHOW_REPLAY_JS + """
        await onlyBlankTab();
        await resetOrbits();
        await dropDemoSkills();
        useFakeBackend();
        await openPage("Replay shop");
        // Without a skill made from a demo there is nothing to report steps to.
        let asked = null;
        let id = await askFake("Hello", async options => { asked = options; });
        await finishedRun(id);
        check(!asked.tools.some(t => t.name == "skill_step"), "skill_step offered without a demo's skill");

        // Called with "/name": its steps show before the first.
        await saveReplaySkill();
        let gates = [Promise.withResolvers(), Promise.withResolvers()];
        let results = [];
        id = await askFake(`/${REPLAY_SKILL}`, async options => {
          asked = options;
          await gates[0].promise;
          results.push(await options.callTool("skill_step", { step: 1 }));
          await gates[1].promise;
          options.emit({ type: "text", text: "Done." });
        });
        await wait(() => stepClasses() == "pending,pending,pending", stepClasses());
        // Pinned while the reply runs, not in it: the step, the list folded.
        check(pinnedSteps() && !assistant.log.querySelector(".skill-steps"), "the steps are not pinned");
        let text = () => plain(stepsCard().querySelector(".skill-steps-now").textContent);
        check(pinnedSteps().getAttribute("aria-label").includes("/Replay mouse") && text().includes("3 steps"), text());
        check(!stepRows().length, "the list shows before it is opened");
        let toggle = pinnedSteps().querySelector(".skill-steps-toggle");
        toggle.click();
        await wait(() => stepRows().length == 3, "the opened list");
        check(toggle.getAttribute("aria-expanded") == "true", "the toggle is not expanded");
        check(stepRows()[1].textContent.includes("Enter the password") && stepRows()[1].textContent.includes("You enter this yourself"), stepRows()[1].textContent);
        check(!stepRows()[1].textContent.includes("The user enters this step themselves"), "the fixed phrase shows");
        // The rules come with the skill's instructions, and the tool to report with.
        check(asked.prompt.includes("call skill_step with its number") && asked.prompt.includes("Do not look for another way"), asked.prompt);
        check(asked.tools.some(t => t.name == "skill_step"), "no skill_step");

        // Reported, the step is the current one.
        gates[0].resolve();
        await wait(() => stepClasses() == "current,pending,pending", stepClasses());
        check(results[0].ok && results[0].content == "Step 1 of 3: Go to the shop", JSON.stringify(results));
        check(stepRows()[0].getAttribute("aria-current") == "step" && text().includes("Go to the shop") && text().includes("1/3"), text());
        check(stepsCard().querySelector(".skill-steps-count").title == "Step 1 of 3", stepsCard().querySelector(".skill-steps-count").title);
        // Folded again for the rest.
        toggle.click();
        await wait(() => !stepRows().length, "the folded list");
        // Got again with use_skill, the skill keeps the step it is on.
        results.push(await asked.callTool("use_skill", { name: REPLAY_SKILL }));
        check(results[1].ok && stepClasses() == "current,pending,pending", stepClasses());
        gates[1].resolve();
        await finishedRun(id);
        // Once it ends, the reply keeps them.
        await wait(() => !pinnedSteps() && assistant.log.querySelectorAll(".skill-steps").length == 1, "the steps in the reply");
        let reply = (await core.getMessages(id)).at(-1);
        let part = reply.parts.find(p => p.type == "skill_steps");
        check(part?.current == 1 && part.stopped === false && reply.parts.filter(p => p.type == "skill_steps").length == 1, JSON.stringify(reply.parts));
        // Kept as the steps only, as a thought is.
        check(!reply.parts.some(p => p.type == "tool_call" && p.name == "skill_step"), JSON.stringify(reply.parts));

        // Got with use_skill: the rules come with what it returns, the steps
        // show under it, and the last step reported in a reply that ended
        // well is done.
        results = [];
        id = await askFake("Order the mouse again", async ({ callTool }) => {
          results.push(await callTool("use_skill", { name: REPLAY_SKILL }));
          for (let step of [1, 2]) {
            results.push(await callTool("skill_step", { step }));
          }
        });
        // The step the user enters asks, in "ask" mode too.
        let go = await wait(() => assistant.log.querySelector(".approval.waiting .primary"), "the card at step 2");
        check(results[0].ok && results[0].content.includes("call skill_step with its number"), results[0].content);
        check(!assistant.log.querySelector(".skill-steps") && pinnedSteps() && stepClasses() == "done,current,pending", stepClasses());
        go.click();
        await finishedRun(id);
        part = await stepsPartOf(id);
        check(part?.current == 2 && part.entered.join() == "2", JSON.stringify(part));
        """)
    finally:
        b.js(SHOW_SKILL_JS + "await dropDemoSkills(); await resetOrbits(); await onlyBlankTab();")


@test
def a_skill_made_from_a_demo_stops_at_a_step_the_user_enters_even_in_bypass_mode(b):
    try:
        b.js(SHOW_SKILL_JS + SHOW_REPLAY_JS + """
        await onlyBlankTab();
        await resetOrbits();
        await dropDemoSkills();
        await saveReplaySkill();
        useFakeBackend();
        await openPage("Replay bypass");
        core.setPermissionMode(win, "bypass");
        let results = [];
        let id = await askFake(`/${REPLAY_SKILL}`, async ({ callTool }) => {
          results.push(await callTool("skill_step", { step: 1 }));
          // Past the user's step before it: refused.
          results.push(await callTool("skill_step", { step: 3 }));
          results.push(await callTool("skill_step", { step: 2 }));
          results.push(await callTool("skill_step", { step: 3 }));
        });
        let card = await wait(() => assistant.log.querySelector(".approval.waiting"), "the card at the step the user enters");
        check(results.length == 2 && results[0].ok && !results[1].ok && results[1].content.includes("Step 2 is one the user enters themselves"), JSON.stringify(results));
        check(card.querySelector(".approval-row p").textContent == "Enter it yourself, then press Continue", card.textContent);
        let buttons = [...card.querySelectorAll("button")].map(b => b.textContent.trim()).join(" | ");
        check(buttons == "Stop | Continue", buttons);
        check(stepClasses() == "done,current,pending", stepClasses());
        await wait(() => doc.documentElement.getAttribute("orbito-frame") == "attention", "the waiting frame");
        card.querySelector(".primary").click();
        await finishedRun(id);
        check(results.length == 4 && results[2].ok && results[2].content.includes("The user entered step 2 themselves") && results[3].ok, JSON.stringify(results));
        let reply = (await core.getMessages(id)).at(-1);
        let approval = reply.parts.find(p => p.type == "approval");
        check(approval?.name == "skill_step" && approval.result === true && approval.bypassed === false, JSON.stringify(approval));
        let settled = assistant.log.querySelector(".approval.settled .approval-line");
        check(plain(settled.textContent).includes("Step 2, entered by you") && plain(settled.textContent).includes("You entered it and went on"), settled.textContent);
        await wait(() => stepClasses() == "done,done,done", stepClasses());
        // The reply keeps one line of how it went, the list folded under it.
        check(!stepsCard().open && plain(stepsCard().querySelector("summary").textContent).includes("All 3 steps done"), stepsCard().outerHTML);

        // Stop stops the question there.
        results = [];
        id = await askFake(`/${REPLAY_SKILL}`, async ({ callTool }) => {
          results.push(await callTool("skill_step", { step: 1 }));
          results.push(await callTool("skill_step", { step: 2 }));
        });
        (await wait(() => assistant.log.querySelector(".approval.waiting .secondary"), "the card again")).click();
        await finishedRun(id);
        let messages = await core.getMessages(id);
        check(core.notices(messages.at(-1).id).includes("Stopped at a step you enter yourself."), core.notices(messages.at(-1).id).join());
        let part = await stepsPartOf(id);
        check(part.failed?.step == 2 && part.failed.entry && part.stopped, JSON.stringify(part));
        await wait(() => stepClasses() == "done,failed,pending", stepClasses());
        check(plain(stepsCard().textContent).includes("Stopped at step 2"), stepsCard().textContent);
        """)
    finally:
        b.js(SHOW_SKILL_JS + "await dropDemoSkills(); await resetOrbits(); await onlyBlankTab();")


@test
def a_skill_made_from_a_demo_stops_where_a_step_is_not_found(b):
    try:
        b.js(SHOW_SKILL_JS + SHOW_REPLAY_JS + """
        await onlyBlankTab();
        await resetOrbits();
        await dropDemoSkills();
        await saveReplaySkill();
        useFakeBackend();
        await openPage("Replay changed");
        let results = [];
        // Held until the question has started: it would end at once, before
        // askFake sees it running.
        let started = Promise.withResolvers();
        let id = await askFake(`/${REPLAY_SKILL}`, async ({ callTool, emit }) => {
          await started.promise;
          results.push(await callTool("skill_step", { step: 1, found: false, missing: "the shop's link" }));
          // Nothing else runs after: no other page, no next step; thinking does.
          results.push(await callTool("open_tab", { url: pageURL("Replay elsewhere") }));
          results.push(await callTool("skill_step", { step: 2 }));
          results.push(await callTool("think", { thought: "Tell the user." }));
          emit({ type: "text", text: "I could not find the shop's link." });
        });
        started.resolve();
        await finishedRun(id);
        check(results[0].ok && results[0].content.includes("“the shop's link” was not found") && results[0].content.includes("Do not look for another way"), results[0].content);
        check(!results[1].ok && results[1].content.includes("stopped at step 1"), results[1].content);
        check(!results[2].ok && results[2].content.includes("stopped at step 1"), results[2].content);
        check(results[3].ok, JSON.stringify(results[3]));
        check(!win.gBrowser.tabs.some(t => t.linkedBrowser.currentURI.spec.includes("Replay%20elsewhere")), "a tab opened after the stop");
        // Nothing was asked: the refusal comes before any approval.
        check(!assistant.log.querySelector(".approval"), "an approval after the stop");
        await wait(() => stepClasses() == "failed,pending,pending", stepClasses());
        check(plain(stepRows()[0].textContent).includes("Not found: the shop's link") && plain(stepsCard().textContent).includes("Stopped at step 1"), stepsCard().textContent);
        let part = await stepsPartOf(id);
        check(part.failed?.step == 1 && part.failed.missing == "the shop's link" && !part.failed.entry, JSON.stringify(part));
        """)
    finally:
        b.js(SHOW_SKILL_JS + "await dropDemoSkills(); await resetOrbits(); await onlyBlankTab();")


@test
def a_skill_made_from_a_demo_switches_to_a_tab_and_closes_one_again(b):
    try:
        b.js(SHOW_SKILL_JS + SHOW_REPLAY_JS + """
        await onlyBlankTab();
        await resetOrbits();
        await dropDemoSkills();
        const { OrbitoTools } = ChromeUtils.importESModule("chrome://browser/content/orbito/OrbitoTools.sys.mjs");
        await core.saveSkill(demoSkill({
          name: "Replay tabs",
          description: "Goes back to the shop and closes the receipt",
          tools: ["list_tabs", "select_tab", "close_tab"],
          inputs: [],
          steps: [
            { text: "Go back to the tab of the shop", direct: false },
            { text: "Close the tab of the receipt", direct: false },
          ],
        }, { locale: "en-US" }));
        useFakeBackend();
        let shop = await openPage("Replay tab shop");
        let receipt = await openPage("Replay tab receipt");
        let here = await openPage("Replay tab here");
        core.setPermissionMode(win, "auto");
        try {
          let asked = null;
          let results = [];
          let id = await askFake("/Replay tabs", async options => {
            asked = options;
            let { callTool } = options;
            let tabs = JSON.parse((await callTool("list_tabs", {})).content);
            let idOf = title => tabs.find(t => t.title == title).id;
            results.push(await callTool("skill_step", { step: 1 }));
            results.push(await callTool("select_tab", { tab_id: idOf("Replay tab shop") }));
            results.push(await callTool("skill_step", { step: 2 }));
            results.push(await callTool("close_tab", { tab_id: idOf("Replay tab receipt") }));
          });
          check(["select_tab", "close_tab"].every(name => asked.tools.some(t => t.name == name)), JSON.stringify(asked.tools.map(t => t.name)));
          // Switching runs at once under auto; closing asks.
          let allow = await wait(() => assistant.log.querySelector(".approval.waiting .primary"), "the approval to close the receipt");
          check(win.gBrowser.selectedTab == shop && receipt.isConnected, "not switched, or closed before asking");
          check(plain(assistant.log.querySelector(".approval.waiting").textContent).includes("Close “Replay tab receipt”?"), assistant.log.querySelector(".approval.waiting").textContent);
          allow.click();
          await finishedRun(id);
          check(results.every(r => r.ok) && results[1].content == `Switched to tab ${OrbitoTools.tabId(shop)} “Replay tab shop”.`, JSON.stringify(results));
          check(!receipt.isConnected && here.isConnected, "the receipt is open, or the tab asked from closed");
          let part = await stepsPartOf(id);
          check(part?.current == 2 && !part.failed, JSON.stringify(part));
        } finally {
          core.setPermissionMode(win, "ask");
        }
        """)
    finally:
        b.js(SHOW_SKILL_JS + "await dropDemoSkills(); await resetOrbits(); await onlyBlankTab();")


@test
def scheduling_a_skill_made_from_a_demo_warns_of_user_steps_and_takes_its_inputs(b):
    try:
        b.js(SHOW_SKILL_JS + SHOW_REPLAY_JS + """
        await onlyBlankTab();
        await resetOrbits();
        await dropDemoSkills();
        await saveReplaySkill();
        await core.saveSkill(demoSkill({
          name: "Replay search",
          description: "Searches the shop",
          tools: ["navigate", "type"],
          inputs: [{ name: "query", description: "What to search for", example: "mouse", placeholder: null, value: "", fixed: false }],
          steps: [{ text: "Search the shop for {query}", direct: false }],
        }, { locale: "en-US" }));
        const { OrbitoTasks } = ChromeUtils.importESModule("chrome://browser/content/orbito/OrbitoTasks.sys.mjs");
        useFakeBackend();
        let page = await openOrbitoSettings();
        let form = page.getElementById("task-form");
        let select = form.elements.namedItem("skill");
        let pick = name => {
          select.value = name;
          select.dispatchEvent(new page.defaultView.Event("change"));
        };
        page.getElementById("task-new").click();
        await wait(() => [...select.options].some(o => o.value == REPLAY_SKILL), "the demo skills to pick");
        let warning = form.querySelector(".direct-warning");
        let inputs = form.querySelector(".skill-inputs");
        check(warning.hidden && inputs.hidden, "a warning or inputs with no skill");
        // A step the user enters: the warning.
        pick(REPLAY_SKILL);
        await wait(() => !warning.hidden && warning.textContent == "It has steps you enter yourself, so its runs stop there", warning.textContent);
        check(page.defaultView.getComputedStyle(warning).display != "none" && inputs.hidden, "no warning shows");
        // Inputs: a field each, needed to save.
        pick("Replay search");
        check(warning.hidden && !inputs.hidden, "the inputs do not show");
        let field = inputs.querySelector('[data-input="query"]');
        check(field && field.placeholder == "mouse" && inputs.textContent.includes("query: What to search for"), inputs.textContent);
        form.elements.namedItem("name").value = "Search daily";
        form.requestSubmit();
        let error = form.querySelector(".error");
        await wait(() => !error.hidden, "the missing input's error");
        check(plain(error.textContent) == "Fill in the skill's input query.", error.textContent);
        field.value = "mouse pad";
        form.requestSubmit();
        await wait(() => form.hidden, "the task to save");
        let task = (await OrbitoTasks.list()).find(t => t.name == "Search daily");
        check(task?.skill == "Replay search" && JSON.stringify(task.inputs) == '{"query":"mouse pad"}', JSON.stringify(task));
        // Editing it shows them again.
        let card = await wait(() => page.querySelector(`.task[data-id="${task.id}"]`), "the task's card");
        [...card.querySelectorAll("button")].find(button => button.textContent == "Edit").click();
        await wait(() => !form.hidden && form.querySelector('[data-input="query"]')?.value == "mouse pad", "the input's value");
        form.querySelector("#task-cancel").click();

        // A run puts the values after the skill's name.
        let asked = null;
        fake.run = async options => { asked = options; };
        let run = await OrbitoTasks.save({ ...task, inputs: task.inputs, backend: "orbittest", allowedTools: [] }, task.id);
        await OrbitoTasks.runNow(run.id);
        check(asked?.prompt.startsWith("Skill instructions (/Replay search)") && asked.prompt.includes("query: mouse pad"), asked?.prompt);
        await OrbitoTasks.remove(task.id);
        """)
    finally:
        b.js(SHOW_SKILL_JS + "await dropDemoSkills(); await resetOrbits(); await onlyBlankTab();")


@test
def doorhangers_show_under_top_bar_buttons_or_the_url_display(b):
    b.js("""
    await onlyBlankTab();
    let bar = shell.topBar;
    let PN = win.PopupNotifications;
    let panel = PN.panel;
    // Shows a doorhanger as Firefox code does and returns where it shows.
    let under = async (show, id) => {
      let shownEvent = new Promise(r => panel.addEventListener("popupshown", r, { once: true }));
      let notification = await show();
      await shownEvent;
      let anchor = panel.anchorNode;
      let a = anchor.getBoundingClientRect();
      let p = panel.getBoundingClientRect();
      check(shown(anchor), `${id}: its anchor is hidden`);
      check(p.top >= a.bottom - 1 && p.top - a.bottom < 20 && p.left < a.right && p.right > a.left,
        `${id}: panel at ${JSON.stringify(p)}, anchor at ${JSON.stringify(a)}`);
      let hidden = new Promise(r => panel.addEventListener("popuphidden", r, { once: true }));
      (notification ?? PN.getNotification(id)).remove();
      await hidden;
      return anchor;
    };

    // A site asking for the location: the site information button.
    let tab = win.gBrowser.addTab(`${PAGES}/geo`, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    win.gBrowser.selectedTab = tab;
    let anchor = await under(() => null, "geolocation");
    check(anchor == bar.siteInfoButton, `the location prompt is under ${anchor.className || anchor.id}`);

    let browser = win.gBrowser.selectedBrowser;
    let show = (id, anchorID) => () => PN.show(browser, id, "Test", anchorID, { label: "OK", accessKey: "O", callback() {} }, []);
    // Saving a password: the URL display.
    anchor = await under(show("password", "password-notification-icon"), "password");
    check(anchor == bar.urlDisplay, `the password doorhanger is under ${anchor.className || anchor.id}`);
    // Installing an extension (anchored as browser-addons.js does): the
    // extensions button.
    anchor = await under(show("addon-install-confirmation", win.gUnifiedExtensions.getPopupAnchorID(browser, win)), "addon");
    check(anchor == bar.extensionsButton, `the extension doorhanger is under ${anchor.className || anchor.id}`);
    // An anchor that is not there: the URL display.
    anchor = await under(show("unknown", "no-such-notification-icon"), "unknown");
    check(anchor == bar.urlDisplay, `the unanchored doorhanger is under ${anchor.className || anchor.id}`);
    """)


def site_info_status(b, url):
    """Opens url, then the site information panel, and returns what it says
    about the connection: [mode, text]."""
    return b.js(f"""
    await closeSiteInfo();
    await openURL({json.dumps(url)});
    await openSiteInfo();
    let status = siteInfo.status;
    let result = [status.dataset.security, status.textContent.trim()];
    await closeSiteInfo();
    return result;
    """)


@test
def the_site_info_panel_shows_the_connection_security(b):
    b.js(f"""
    await onlyBlankTab();
    let certdb = Cc["@mozilla.org/security/x509certdb;1"].getService(Ci.nsIX509CertDB);
    certdb.addCertFromBase64({json.dumps(TLS["ca"])}, "C,,");
    // A host that is not this computer by name (127.0.0.1 counts as a secure
    // context), served from here; no HTTPS upgrade attempt for it.
    Services.prefs.setStringPref("network.dns.localDomains", "insecure.orbito.test");
    Services.prefs.setBoolPref("dom.security.https_first", false);
    """)
    port = b.pages.rsplit(":", 1)[1]
    try:
        cases = [
            (TLS["secure"] + "/page/Secure", "secure", "Connection is secure"),
            (f"http://insecure.orbito.test:{port}/page/Plain", "not-secure", "Connection is not secure"),
            (TLS["untrusted"] + "/page/Untrusted", "cert-error-page", "Certificate is not trusted"),
            ("about:robots", "chrome", "Orbito page"),
        ]
        for url, mode, text in cases:
            shown = site_info_status(b, url)
            assert shown == [mode, text], f"{url}: {shown}"
        # The button's icon follows: a lock, a crossed lock, the info icon.
        b.js(f"""
        await openURL({json.dumps(TLS["secure"] + "/page/Lock")});
        await shell.topBar.updateComplete;
        let icon = () => shell.topBar.siteInfoButton.querySelector("svg").innerHTML;
        let lock = icon();
        await openURL({json.dumps(TLS["untrusted"] + "/page/Broken")});
        await shell.topBar.updateComplete;
        check(icon() != lock, "a certificate error shows the secure lock");
        """)
    finally:
        b.js("""
        await closeSiteInfo();
        Services.prefs.clearUserPref("network.dns.localDomains");
        Services.prefs.clearUserPref("dom.security.https_first");
        """)


@test
def permissions_changed_in_the_site_info_panel_are_stored(b):
    b.js("""
    await closeSiteInfo();
    await onlyBlankTab();
    await openPage("Permissions");
    let { SitePermissions } = win;
    let principal = win.gBrowser.contentPrincipal;
    for (let id of ["camera", "microphone", "geo", "desktop-notification"]) {
      SitePermissions.removeFromPrincipal(principal, id);
    }
    await openSiteInfo();
    let stored = id => Services.perms.testExactPermissionFromPrincipal(principal, id);
    for (let id of ["camera", "microphone", "geo", "desktop-notification"]) {
      let row = await permissionRow(id);
      check(row, `no ${id} row`);
      check(/: Ask$/.test(await named(row)), `${id} starts as ${accessibleName(row)}`);
      // Ask, Allow, Block, then Ask again: each step lands in Firefox's
      // permission store.
      for (let [state, label] of [[Services.perms.ALLOW_ACTION, "Allow"],
          [Services.perms.DENY_ACTION, "Block"], [Services.perms.UNKNOWN_ACTION, "Ask"]]) {
        row.click();
        check(stored(id) == state, `${id} -> ${label}: the store has ${stored(id)}`);
        row = await permissionRow(id);
        check(row.querySelector(".state").textContent.trim() == label, `${id} row shows ${row.textContent}`);
      }
    }
    // A change made elsewhere (Firefox's own UI, another window) shows too.
    SitePermissions.setForPrincipal(principal, "geo", SitePermissions.BLOCK);
    await wait(async () => (await permissionRow("geo")).querySelector(".state").textContent.trim() == "Block",
      "the panel to follow the permission store");
    SitePermissions.removeFromPrincipal(principal, "geo");
    // The page needs a reload to see changes; the panel offers one.
    check(siteInfo.renderRoot.querySelector(".reload"), "no reload row after a change");
    await closeSiteInfo();
    """)


@test
def the_site_info_panel_opens_where_site_doorhangers_do(b):
    b.js("""
    await closeSiteInfo();
    await onlyBlankTab();
    let bar = shell.topBar;
    let PN = win.PopupNotifications;
    let doorhanger = PN.panel;
    let tab = win.gBrowser.addTab(`${PAGES}/geo`, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    let shownEvent = new Promise(r => doorhanger.addEventListener("popupshown", r, { once: true }));
    win.gBrowser.selectedTab = tab;
    await shownEvent;
    check(doorhanger.anchorNode == bar.siteInfoButton, "the location prompt is not under the site information button");
    let prompt = cardBox(doorhanger);
    let hidden = new Promise(r => doorhanger.addEventListener("popuphidden", r, { once: true }));
    PN.getNotification("geolocation").remove();
    await hidden;

    await openSiteInfo();
    check(siteInfo.panel.anchorNode == bar.siteInfoButton, "the panel is not under the site information button");
    let panel = cardBox(siteInfo.panel);
    check(Math.abs(panel.top - prompt.top) <= 1 && Math.abs(panel.left - prompt.left) <= 1,
      `panel at ${panel.left},${panel.top}, prompt at ${prompt.left},${prompt.top}`);
    check(bar.siteInfoButton.getAttribute("aria-expanded") == "true", "the button is not expanded");
    await closeSiteInfo();
    check(bar.siteInfoButton.getAttribute("aria-expanded") == "false", "the button stayed expanded");

    // Firefox's own ways to its permission popup open the panel.
    win.gPermissionPanel.openPopup();
    await wait(() => siteInfo.panel.state == "open", "the panel from gPermissionPanel");
    await closeSiteInfo();
    """)


@test
def top_bar_panels_pop_in_4px_under_their_button_over_a_blur(b):
    b.js("""
    await clearDownloads();
    await onlyBlankTab();
    await openPage("Popovers");
    // The downloads button shows once there is a download.
    let done = await startDownload("popover.txt", 1000);
    await wait(() => done.succeeded, "the download to finish");
    let bar = shell.topBar;
    let mac = AppConstants.platform == "macosx";
    // Where the platform has a popup material, it is the blur behind.
    let blur = win.matchMedia("(-moz-mac-tahoe-theme) or (-moz-windows-mica-popups)").matches;
    let panels = [
      [siteInfo, bar.siteInfoButton, openSiteInfo, closeSiteInfo],
      [extensions, bar.extensionsButton, openExtensions, closeExtensions],
      [downloads, bar.downloadsButton, openDownloads, closeDownloads],
    ];
    for (let [element, button, open, close] of panels) {
      let panel = element.panel;
      let id = panel.id;
      await close();
      // Closed, it waits where the pop-in starts, not Firefox's 70px off.
      let style = win.getComputedStyle(panel);
      if (mac) {
        // -moz-window-transform has no computed value to read: the rule
        // that sets it last wins.
        let moved = InspectorUtils.getMatchingCSSRules(panel)
          .map(rule => rule.style.cssText.match(/-moz-window-transform:\\s*([^;]+)/)?.[1])
          .filter(Boolean).at(-1);
        check(moved?.includes("0.98"), `${id} starts at ${moved}`);
      } else {
        // Once its pop-out on closing is over.
        await wait(() => ["none", "matrix(0.98, 0, 0, 0.98, 0, -4)"].includes(win.getComputedStyle(panel).transform),
          `${id} to start the pop-in`, 2000).catch(() => { throw new Error(`${id} starts at ${win.getComputedStyle(panel).transform}`); });
      }
      await open();
      style = win.getComputedStyle(panel);
      check(style.transitionDuration.split(", ").every(d => d == motionSeconds("medium")), `${id}: ${style.transitionDuration}`);
      check(style.transitionTimingFunction.startsWith("cubic-bezier(0.2, 0.8, 0.2, 1)"),
        `${id}: ${style.transitionTimingFunction}`);
      let gap = panel.panelContent.getBoundingClientRect().top - button.getBoundingClientRect().bottom;
      check(Math.abs(gap - 4) <= 0.5, `${id} is ${gap}px under its button`);
      let card = win.getComputedStyle(panel.panelContent).backgroundColor;
      if (blur) {
        check(style.appearance == "auto", `${id} has no popup material: ${style.appearance}`);
      } else {
        check(style.appearance == "none" && !card.includes("/") && !card.startsWith("rgba"),
          `${id} lets the window through: ${style.appearance} ${card}`);
      }
      await close();
    }

    // Without motion it just shows.
    Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
    try {
      await openSiteInfo();
      let duration = win.getComputedStyle(siteInfo.panel).transitionDuration;
      check(duration.split(", ").every(d => d == "0s"), `it moves with reduced motion: ${duration}`);
      await closeSiteInfo();
    } finally {
      Services.prefs.clearUserPref("ui.prefersReducedMotion");
    }
    await clearDownloads();
    """)


@test
def top_bar_panels_fade_out_and_give_way_to_the_next_at_once(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Fades");
    await closeSiteInfo();
    await closeExtensions();
    // Closing, the panel fades for the short motion before it goes.
    await openSiteInfo();
    let hidden = new Promise(r => siteInfo.panel.addEventListener("popuphidden", r, { once: true }));
    siteInfo.close();
    check(siteInfo.panel.state == "hiding", `the panel is ${siteInfo.panel.state} at once`);
    let style = win.getComputedStyle(siteInfo.panel);
    check(style.transitionDuration.split(", ").every(d => d == motionSeconds("short")), `it fades for ${style.transitionDuration}`);
    await hidden;
    // Another panel opening while one fades: the fading one goes at once.
    await openSiteInfo();
    siteInfo.close();
    let closedFirst = new Promise(r => extensions.panel.addEventListener("popupshowing",
      () => r(siteInfo.panel.state), { once: true }));
    await openExtensions();
    let state = await closedFirst;
    check(state == "closed", `the site information panel was ${state} as the extensions panel opened`);
    await closeExtensions();
    // Opening the same one again while it fades opens it.
    await openSiteInfo();
    siteInfo.close();
    await openSiteInfo();
    check(siteInfo.panel.state == "open", `the panel is ${siteInfo.panel.state}`);
    await closeSiteInfo();
    // Without motion it goes at once.
    Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
    try {
      await wait(() => win.matchMedia("(prefers-reduced-motion: reduce)").matches, "reduced motion");
      await openSiteInfo();
      siteInfo.close();
      await wait(() => siteInfo.panel.state == "closed", "the panel to go at once", 100);
    } finally {
      Services.prefs.clearUserPref("ui.prefersReducedMotion");
    }
    """)


@test
def dismissed_permission_requests_wait_in_the_site_info_panel(b):
    b.js("""
    await closeSiteInfo();
    await onlyBlankTab();
    let bar = shell.topBar;
    let PN = win.PopupNotifications;
    let doorhanger = PN.panel;
    // A site asking to show notifications without a click: Firefox keeps
    // the request dismissed, behind the (hidden) urlbar icon.
    let tab = win.gBrowser.addTab(`${PAGES}/notify`, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    win.gBrowser.selectedTab = tab;
    let request = await wait(() => PN.getNotification("web-notifications"), "the notification request");
    check(request.dismissed && doorhanger.state == "closed", "the request did not wait");
    await wait(() => bar.siteInfoButton.hasAttribute("waiting"), "the waiting dot");
    let name = await wait(() => /waiting/.test(accessibleName(bar.siteInfoButton)) && accessibleName(bar.siteInfoButton), "the name to say so");
    check(name == "Site information, 1 permission request waiting", name);

    // The panel lists it and brings it back, under the button.
    await openSiteInfo();
    let [row] = siteInfo.requestRows;
    check(row && /Notifications/.test(row.textContent), `request rows: ${siteInfo.requestRows.length}`);
    check(siteInfo.items[0] == row, "the request is not the first row");
    let shownEvent = new Promise(r => doorhanger.addEventListener("popupshown", r, { once: true }));
    row.click();
    await shownEvent;
    check(siteInfo.panel.state == "closed", "the panel stayed open");
    check(doorhanger.anchorNode == bar.siteInfoButton, "the request came back somewhere else");
    check(!request.dismissed, "the request is still dismissed");
    await wait(() => !bar.siteInfoButton.hasAttribute("waiting"), "the dot to go");
    let hidden = new Promise(r => doorhanger.addEventListener("popuphidden", r, { once: true }));
    request.remove();
    await hidden;
    """)


@test
def the_site_info_panel_follows_the_keyboard_rules(b):
    b.js("""
    await closeSiteInfo();
    await onlyBlankTab();
    await openPage("Panel keys");
    win.OrbitoAssistant.toggle(false);
    win.gBrowser.selectedBrowser.focus();
    await wait(() => shell.focusedRegion == "page", "the page to have focus");
    """)
    b.keys((Keys.SHIFT, Keys.F6), Keys.HOME, Keys.ARROW_RIGHT, Keys.ARROW_RIGHT, Keys.ARROW_RIGHT)
    b.js("""
    let button = shell.topBar.siteInfoButton;
    await wait(() => deepActive() == button, "focus on the site information button");
    check((await named(button)) == "Site information", accessibleName(button));
    """)
    b.keys(Keys.ENTER)
    b.js("""
    await wait(() => siteInfo.panel.state == "open", "the panel to open");
    let first = siteInfo.items[0];
    await wait(() => deepActive() == first, "focus on the first row");
    check(first.matches(":focus-visible"), "the first row shows no focus");
    for (let item of siteInfo.items) {
      check(await named(item), `a row without a name: ${item.className}`);
    }
    """)
    b.keys(Keys.ARROW_DOWN)
    b.js('await wait(() => deepActive() == siteInfo.items[1], "Down to the second row");')
    b.keys(Keys.END)
    b.js('await wait(() => deepActive() == [...siteInfo.items].at(-1), "End to the last row");')
    b.keys(Keys.ARROW_DOWN)
    b.js('await wait(() => deepActive() == siteInfo.items[0], "Down to wrap to the first row");')
    b.keys(Keys.ESCAPE)
    b.js("""
    let button = shell.topBar.siteInfoButton;
    await wait(() => siteInfo.panel.state == "closed", "Escape to close the panel");
    await wait(() => deepActive() == button, "focus back on the button");
    check(button.matches(":focus-visible"), "the button shows no focus");
    """)
    # F6 from inside the panel moves on to the page and closes it.
    b.keys(Keys.SPACE)
    b.js('await wait(() => siteInfo.panel.state == "open" && siteInfo.renderRoot.contains(deepActive()), "Space to open it");')
    b.keys(Keys.F6)
    b.js("""
    await wait(() => siteInfo.panel.state == "closed", "F6 to close the panel");
    await wait(() => shell.focusedRegion == "page", `F6 to go to the page, not ${shell.focusedRegion}`);
    """)


POPUP = "<!doctype html><title>{0}</title><body style='width:220px;height:80px'>{0}</body>"


@test
def the_extensions_panel_shows_an_empty_state_without_extensions(b):
    b.js("""
    await closeExtensions();
    await uninstallTestExtensions();
    await onlyBlankTab();
    await openPage("No extensions");
    await openExtensions();
    let bar = shell.topBar;
    check(extensions.panel.anchorNode == bar.extensionsButton, "the panel is not under the extensions button");
    check(bar.extensionsButton.getAttribute("aria-expanded") == "true", "the button is not expanded");
    check(extensions.extensionRows.length == 0,
      `rows for: ${[...extensions.extensionRows].map(r => r.textContent.trim()).join(", ")}`);
    check(extensions.emptyState && shown(extensions.emptyState), "no empty state");
    check(/No extensions/.test(extensions.emptyState.textContent), extensions.emptyState.textContent);
    check(shown(extensions.manageRow), "no way to the extensions manager");
    await closeExtensions();
    check(bar.extensionsButton.getAttribute("aria-expanded") == "false", "the button stayed expanded");
    """)


@test
def the_extensions_panel_lists_extensions_and_runs_their_buttons(b):
    b.js(f"""
    await closeExtensions();
    await uninstallTestExtensions();
    await onlyBlankTab();
    await installExtension("Panel Popup", {{
      browser_action: {{ default_popup: "popup.html", default_title: "Open the panel popup" }},
    }}, {{ "popup.html": {json.dumps(POPUP.format("Panel popup"))} }});
    // Placed in the (hidden) toolbar rather than Firefox's extensions panel.
    await installExtension("Toolbar Popup", {{
      browser_action: {{ default_popup: "popup.html", default_area: "navbar" }},
    }}, {{ "popup.html": {json.dumps(POPUP.format("Toolbar popup"))} }});
    await installExtension("Clicker", {{
      browser_action: {{ default_title: "Clicker" }},
      background: {{ scripts: ["background.js"] }},
    }}, {{ "background.js": "browser.browserAction.onClicked.addListener(() => browser.browserAction.setBadgeText({{ text: '1' }}));" }});
    await installExtension("Plain");
    await openPage("Extensions");
    """)
    try:
        b.js("""
        let bar = shell.topBar;
        await openExtensions();
        let row = name => [...extensions.extensionRows].find(r => r.dataset.extension.startsWith(name));
        let names = [...extensions.extensionRows].map(r => r.querySelector(".name").textContent);
        check(names.join(" | ") == "Clicker | Panel Popup | Plain | Toolbar Popup", names.join(" | "));
        check(!extensions.emptyState, "the empty state shows with extensions");
        check(/Open the panel popup/.test(row("panel-popup").textContent), "the action's title is not shown");
        for (let r of extensions.extensionRows) {
          check(r.querySelector("img.icon").getAttribute("src"), `${r.dataset.extension} has no icon`);
        }

        // A row opens the extension's popup under the extensions button,
        // wherever Firefox placed its toolbar button.
        for (let [name, title] of [["panel-popup", "Panel popup"], ["toolbar-popup", "Toolbar popup"]]) {
          if (extensions.panel.state != "open") {
            await openExtensions();
          }
          row(name).click();
          let popup = await wait(() => extensionPopup(), `the ${title}`);
          check(extensions.panel.state == "closed", "the panel stayed open");
          check(popup.anchorNode == bar.extensionsButton, `the ${title} is under ${popup.anchorNode?.id || popup.anchorNode?.className}`);
          let browser = await wait(() => popup.querySelector("browser"), "the popup's browser");
          await wait(() => browser.contentTitle == title, `${title} to load`);
          let a = bar.extensionsButton.getBoundingClientRect();
          let p = cardBox(popup);
          check(p.top >= a.bottom - 1 && p.top - a.bottom < 20 && p.left < a.right && p.right > a.left,
            `${title} at ${JSON.stringify(p)}, the button at ${JSON.stringify(a)}`);
          await closeExtensionPopup();
        }
        // The extension's shortcut (_execute_browser_action) opens it there
        // too, without the panel.
        win.gUnifiedExtensions.browserActionFor(WebExtensionPolicy.getByID("panel-popup@orbito.test")).triggerAction(win);
        let popup = await wait(() => extensionPopup(), "the popup from its shortcut");
        check(popup.anchorNode == bar.extensionsButton, "the popup from its shortcut is not under the button");
        check(extensions.panel.state == "closed", "the panel opened before the popup");
        await closeExtensionPopup();

        // Without a popup, the extension hears the click.
        await openExtensions();
        row("clicker").click();
        await wait(async () => {
          let action = win.gUnifiedExtensions.browserActionFor(WebExtensionPolicy.getByID("clicker@orbito.test"));
          return action.action.getContextData(win.gBrowser.selectedTab).badgeText == "1";
        }, "the extension to hear the click");
        await openExtensions();
        await wait(() => row("clicker").querySelector(".badge")?.textContent == "1", "the badge in the panel");

        // Without a toolbar button, the row opens its details.
        let tabs = win.gBrowser.tabs.length;
        row("plain").click();
        await wait(() => win.gBrowser.currentURI.spec.startsWith("about:addons"), "the extensions manager");
        let detail = await wait(() => win.gBrowser.selectedBrowser.contentDocument
          ?.querySelector("addon-card[expanded]")?.getAttribute("addon-id"), "the details");
        check(detail == "plain@orbito.test", `details of ${detail}`);
        check(win.gBrowser.tabs.length == tabs + 1, "the manager did not open in a tab");
        """)
        # The manage row opens the list of extensions.
        b.js("""
        await openPage("Manage");
        await openExtensions();
        extensions.manageRow.click();
        await wait(() => extensions.panel.state == "closed", "the panel to close");
        await wait(() => win.gBrowser.currentURI.spec.startsWith("about:addons"), "the extensions manager");
        await wait(() => win.gBrowser.selectedBrowser.contentDocument?.querySelector("addon-list"), "the extension list");
        // Firefox's own way to its extensions panel opens this one.
        win.gUnifiedExtensions.togglePanel();
        await wait(() => extensions.panel.state == "open", "the panel from gUnifiedExtensions");
        await closeExtensions();
        """)
    finally:
        b.js("await closeExtensions(); await closeExtensionPopup(); await uninstallTestExtensions();")


@test
def dismissed_extension_requests_wait_in_the_extensions_panel(b):
    b.js("""
    await closeExtensions();
    await onlyBlankTab();
    await openPage("Extension request");
    let bar = shell.topBar;
    let PN = win.PopupNotifications;
    let doorhanger = PN.panel;
    let browser = win.gBrowser.selectedBrowser;
    // An extension request (anchored as browser-addons.js does) that the
    // user dismissed: no toolbar icon brings it back.
    let request = PN.show(browser, "addon-install-confirmation", "Add Waiting Test?",
      win.gUnifiedExtensions.getPopupAnchorID(browser, win),
      { label: "Add", accessKey: "A", callback() {} }, [], { dismissed: true });
    check(request.dismissed && doorhanger.state == "closed", "the request did not wait");
    await wait(() => bar.extensionsButton.hasAttribute("waiting"), "the waiting dot");
    let name = await wait(() => /waiting/.test(accessibleName(bar.extensionsButton)) && accessibleName(bar.extensionsButton), "the name to say so");
    check(name == "Extensions, 1 request waiting", name);

    await openExtensions();
    let [row] = extensions.requestRows;
    check(row && /Add Waiting Test\\?/.test(row.textContent), `request rows: ${extensions.requestRows.length}`);
    check(extensions.items[0] == row, "the request is not the first row");
    let shownEvent = new Promise(r => doorhanger.addEventListener("popupshown", r, { once: true }));
    row.click();
    await shownEvent;
    check(extensions.panel.state == "closed", "the panel stayed open");
    check(doorhanger.anchorNode == bar.extensionsButton, "the request came back somewhere else");
    await wait(() => !bar.extensionsButton.hasAttribute("waiting"), "the dot to go");
    let hidden = new Promise(r => doorhanger.addEventListener("popuphidden", r, { once: true }));
    request.remove();
    await hidden;
    """)


@test
def the_extensions_panel_follows_the_keyboard_rules(b):
    b.js(f"""
    await closeExtensions();
    await uninstallTestExtensions();
    await onlyBlankTab();
    await installExtension("Keyboard Popup", {{
      browser_action: {{ default_popup: "popup.html" }},
    }}, {{ "popup.html": {json.dumps(POPUP.format("Keyboard popup"))} }});
    await openPage("Extension keys");
    win.OrbitoAssistant.toggle(false);
    win.gBrowser.selectedBrowser.focus();
    await wait(() => shell.focusedRegion == "page", "the page to have focus");
    """)
    try:
        b.keys((Keys.SHIFT, Keys.F6))
        b.js('await wait(() => shell.focusedRegion == "top-bar", "Shift+F6 to the Top bar");')
        b.keys(Keys.END, Keys.ARROW_LEFT)
        b.js("""
        let button = shell.topBar.extensionsButton;
        await wait(() => deepActive() == button, "focus on the extensions button");
        check((await named(button)) == "Extensions", accessibleName(button));
        """)
        b.keys(Keys.ENTER)
        b.js("""
        await wait(() => extensions.panel.state == "open", "the panel to open");
        let first = extensions.items[0];
        await wait(() => deepActive() == first, "focus on the first row");
        check(first.matches(":focus-visible"), "the first row shows no focus");
        for (let item of extensions.items) {
          check(await named(item), `a row without a name: ${item.className}`);
        }
        check(accessibleName(extensions.manageRow) == "Manage extensions", accessibleName(extensions.manageRow));
        """)
        b.keys(Keys.ARROW_DOWN)
        b.js('await wait(() => deepActive() == extensions.manageRow, "Down to the manage row");')
        b.keys(Keys.ARROW_DOWN)
        b.js('await wait(() => deepActive() == extensions.items[0], "Down to wrap to the first row");')
        b.keys(Keys.ESCAPE)
        b.js("""
        let button = shell.topBar.extensionsButton;
        await wait(() => extensions.panel.state == "closed", "Escape to close the panel");
        await wait(() => deepActive() == button, "focus back on the button");
        check(button.matches(":focus-visible"), "the button shows no focus");
        """)
        # Enter on an extension's row opens its popup.
        b.keys(Keys.SPACE)
        b.js('await wait(() => extensions.panel.state == "open" && deepActive() == extensions.items[0], "Space to open it");')
        b.keys(Keys.ENTER)
        b.js("""
        let popup = await wait(() => extensionPopup(), "the popup");
        check(popup.anchorNode == shell.topBar.extensionsButton, "the popup is not under the button");
        await closeExtensionPopup();
        """)
        # F6 from inside the panel moves on to the page and closes it.
        b.js("await openExtensions(); extensions.items[0].focus();")
        b.keys(Keys.F6)
        b.js("""
        await wait(() => extensions.panel.state == "closed", "F6 to close the panel");
        await wait(() => shell.focusedRegion == "page", `F6 to go to the page, not ${shell.focusedRegion}`);
        """)
    finally:
        b.js("await closeExtensions(); await closeExtensionPopup(); await uninstallTestExtensions();")


@test
def the_downloads_button_shows_only_with_downloads_and_their_progress(b):
    b.js("""
    await clearDownloads();
    await onlyBlankTab();
    await openPage("Downloads");
    let bar = shell.topBar;
    check(!bar.controls.some(el => el.dataset.control == "downloads"), "a downloads button without downloads");
    // A link to a file, downloaded as Firefox does; Firefox opens its panel
    // for the first one, which opens this one, leaving focus in the page.
    await downloadsFolder();
    Services.prefs.setBoolPref("browser.download.alwaysOpenPanel", true);
    win.gBrowser.selectedBrowser.focus();
    let firefoxPanel = doc.getElementById("downloadsPanel");
    win.openTrustedLinkIn(fileURL("progress.bin", 400000, 4), "current");
    let button = await wait(async () => (await bar.updateComplete) && bar.downloadsButton, "the downloads button");
    await wait(() => downloads.panel.state == "open", "the panel to open for the download");
    check(downloads.panel.anchorNode == button, "the panel opened away from the button");
    check(shell.focusedRegion == "page", `focus moved to ${shell.focusedRegion}`);
    Services.prefs.setBoolPref("browser.download.alwaysOpenPanel", false);
    await wait(() => button.hasAttribute("running"), "the button to show progress");
    let name = await wait(() => /% done/.test(accessibleName(button)) && accessibleName(button), "the progress in its name");
    check(/^Downloads, \\d+% done$/.test(name), name);
    check(shown(button.querySelector(".progress")), "no progress bar on the button");
    check(bar.controls.indexOf(button) == bar.controls.indexOf(bar.extensionsButton) + 1,
      "the downloads button is not after the extensions button");
    check(firefoxPanel.state == "closed", "Firefox's downloads panel opened");
    await closeDownloads();
    // Finished: no progress, a dot until the panel is seen.
    await wait(() => !button.hasAttribute("running"), "the download to finish", 60000);
    await wait(() => button.getAttribute("attention") == "success", "the finished dot");
    await wait(() => accessibleName(button) == "Downloads, finished", "the name to say it finished");
    check(firefoxPanel.state == "closed", "Firefox's downloads panel opened");
    await openDownloads();
    check(downloads.panel.anchorNode == button, "the panel is not under the button");
    check(button.getAttribute("aria-expanded") == "true", "the button is not expanded");
    await closeDownloads();
    await wait(() => !button.hasAttribute("attention"), "the dot to go once seen");
    // The accessibility tree makes the button's accessible again after
    // these changes: for a moment it has none (no name at all).
    await wait(() => accessibleName(button) == "Downloads", "the name to go back to Downloads");
    check(button.getAttribute("aria-expanded") == "false", "the button stayed expanded");
    await clearDownloads();
    """)


@test
def a_closed_window_leaves_no_downloads_views_behind(b):
    # The downloads data outlives a window, and closing one leaves its
    # elements connected.
    b.js("""
    let common = win.DownloadsCommon;
    let counts = async () => [
      common.getIndicatorData(win)._views.length,
      (await common.getData(win)._promiseList)._views.size,
    ].join();
    let before = await counts();
    let other = win.OpenBrowserWindow();
    await wait(() => other.gBrowserInit?.delayedStartupFinished, "the new window");
    let open = await counts();
    check(open != before, `the new window added no views: ${open}`);
    let closed = new Promise(resolve => other.addEventListener("unload", resolve, { once: true }));
    other.close();
    await closed;
    let after;
    await wait(async () => (after = await counts()) == before, "the views to go", 3000).catch(() => {});
    check(after == before, `views ${before} before the window, ${after} after it closed`);
    """)


@test
def the_downloads_panel_opens_shows_cancels_and_retries_downloads(b):
    b.js("""
    await clearDownloads();
    await onlyBlankTab();
    await openPage("Download rows");
    let common = win.DownloadsCommon;
    let { showDownloadedFile } = common;
    let { downloadsUI } = win.BrowserCommands;
    try {
      let done = await startDownload("done.txt", 2000);
      await wait(() => done.succeeded, "the first download to finish");
      let running = await startDownload("running.bin", 400000, 8);
      await wait(() => running.currentBytes > 0, "the second download to start");
      await openDownloads();
      let names = [...downloads.downloadRows].map(r => r.querySelector(".name").textContent);
      check(names.join(" | ") == "running.bin | done.txt", names.join(" | "));
      let row = await downloadRow(running);
      check(/ of .* · \\d+%$/.test(rowStatus(row)), rowStatus(row));
      check(row.querySelector(".bar"), "no progress bar on the running row");
      let doneStatus = rowStatus(await downloadRow(done));
      check(/^2\\.0 KB · Done$/.test(doneStatus), doneStatus);

      // Open the finished file, and show it in its folder.
      let launched = false;
      done.launch = async () => { launched = true; };
      (await downloadRow(done)).click();
      await wait(() => launched, "the file to open");
      check(downloads.panel.state != "open", "the panel stayed open after opening the file");
      await wait(() => downloads.panel.state == "closed", "the panel to close");
      let revealed = null;
      common.showDownloadedFile = file => { revealed = file.path; };
      await openDownloads();
      let show = (await downloadRow(done)).parentNode.querySelector(".action");
      check(await named(show) == "Show in folder: done.txt", accessibleName(show));
      show.click();
      await wait(() => revealed == done.target.path, "the file to show in its folder");

      // Cancel the running one, then retry it.
      await openDownloads();
      let cancel = (await downloadRow(running)).parentNode.querySelector(".action");
      check(await named(cancel) == "Cancel: running.bin", accessibleName(cancel));
      cancel.click();
      await wait(() => running.canceled && running.stopped, "the download to cancel");
      await wait(async () => rowStatus(await downloadRow(running)) == "Canceled", "the row to say canceled");
      check(downloads.panel.state == "open", "canceling closed the panel");
      row = await downloadRow(running);
      await wait(() => /Retry/.test(accessibleName(row)), `Retry in ${accessibleName(row)}`, 5000);
      row.click();
      await wait(() => !running.stopped || running.succeeded, "the download to start again");
      await wait(async () => (await downloadRow(running))?.querySelector(".bar"), "the progress again");
      await wait(() => running.succeeded, "the retried download to finish", 60000);
      await wait(async () => /Done$/.test(rowStatus(await downloadRow(running))), "the row to say done");

      // All downloads, in the Library.
      let library = false;
      win.BrowserCommands.downloadsUI = () => { library = true; };
      downloads.libraryRow.click();
      check(library, "the Library did not open");
      await wait(() => downloads.panel.state == "closed", "the panel to close");
    } finally {
      common.showDownloadedFile = showDownloadedFile;
      win.BrowserCommands.downloadsUI = downloadsUI;
      await clearDownloads();
    }
    """)


@test
def firefox_calls_for_its_downloads_panel_reach_the_top_bar(b):
    b.js("""
    await clearDownloads();
    await onlyBlankTab();
    await openPage("Firefox downloads");
    let done = await startDownload("calls.txt", 1000);
    await wait(() => done.succeeded, "the download to finish");
    await closeDownloads();
    let bar = shell.topBar;
    let button = await wait(async () => (await bar.updateComplete) && bar.downloadsButton, "the downloads button");
    // Firefox's way to its panel (a new download, its button) opens this one.
    win.DownloadsPanel.showPanel();
    await wait(() => downloads.panel.state == "open", "the panel from DownloadsPanel.showPanel");
    check(doc.getElementById("downloadsPanel").state == "closed", "Firefox's downloads panel opened");
    check(downloads.panel.anchorNode == button, "the panel is not under the button");
    win.DownloadsPanel.hidePanel();
    await wait(() => downloads.panel.state == "closed", "DownloadsPanel.hidePanel to close it");
    // Its start and finish animation plays on this button.
    win.DownloadsIndicatorView.showEventNotification("finish");
    await wait(() => button.getAttribute("notification") == "finish", "the finish animation");
    await wait(() => !button.hasAttribute("notification"), "the animation to end");
    await clearDownloads();
    """)


@test
def the_downloads_panel_follows_the_keyboard_rules(b):
    b.js("""
    await clearDownloads();
    await onlyBlankTab();
    let done = await startDownload("keys.txt", 1000);
    await wait(() => done.succeeded, "the download to finish");
    await openPage("Download keys");
    win.OrbitoAssistant.toggle(false);
    win.gBrowser.selectedBrowser.focus();
    await wait(() => shell.focusedRegion == "page", "the page to have focus");
    """)
    try:
        b.keys((Keys.SHIFT, Keys.F6), Keys.END, Keys.ARROW_LEFT)
        b.js("""
        let button = shell.topBar.downloadsButton;
        await wait(() => deepActive() == button, "focus on the downloads button");
        check(/^Downloads/.test(await named(button)), accessibleName(button));
        """)
        b.keys(Keys.ENTER)
        b.js("""
        await wait(() => downloads.panel.state == "open", "the panel to open");
        let first = downloads.items[0];
        await wait(() => deepActive() == first, "focus on the first row");
        check(first.matches(":focus-visible"), "the first row shows no focus");
        for (let item of downloads.items) {
          check(await named(item), `a row without a name: ${item.className}`);
        }
        check(/^keys\\.txt, .*Done, Open$/.test(accessibleName(first)), accessibleName(first));
        check(accessibleName(downloads.libraryRow) == "Show all downloads", accessibleName(downloads.libraryRow));
        """)
        b.keys(Keys.ARROW_DOWN)
        b.js('await wait(() => deepActive() == downloads.items[1], "Down to the show in folder button");')
        b.keys(Keys.END)
        b.js('await wait(() => deepActive() == downloads.libraryRow, "End to the last row");')
        b.keys(Keys.ARROW_DOWN)
        b.js('await wait(() => deepActive() == downloads.items[0], "Down to wrap to the first row");')
        b.keys(Keys.ESCAPE)
        b.js("""
        let button = shell.topBar.downloadsButton;
        await wait(() => downloads.panel.state == "closed", "Escape to close the panel");
        await wait(() => deepActive() == button, "focus back on the button");
        check(button.matches(":focus-visible"), "the button shows no focus");
        """)
        # F6 from inside the panel moves on to the page and closes it.
        b.keys(Keys.SPACE)
        b.js('await wait(() => downloads.panel.state == "open" && downloads.renderRoot.contains(deepActive()), "Space to open it");')
        b.keys(Keys.F6)
        b.js("""
        await wait(() => downloads.panel.state == "closed", "F6 to close the panel");
        await wait(() => shell.focusedRegion == "page", `F6 to go to the page, not ${shell.focusedRegion}`);
        """)
    finally:
        b.js("await clearDownloads();")


@test
def rows_line_up_on_the_sidebar_grid(b):
    b.js("""
    await onlyBlankTab();
    let [one, two] = [await openPage("Grid one"), await openPage("Grid two")];
    await openPage("Grid three");
    addGroup([one, two], "blue", "Grid group");
    await rows();
    let left = shell.sidebar.getBoundingClientRect().left + 8;
    let x = el => Math.round(el.getBoundingClientRect().left - left);
    let top = rowFor(byLabel("Grid three"));
    let inGroup = rowFor(one);
    let header = headerFor(one.group);
    let newTab = tabList().newTabButton;
    let at = {
      newTabIcon: x(newTab.querySelector(".icon")),
      newTabLabel: x(newTab.querySelector(".label")),
      icon: x(top.querySelector(".icon")),
      label: x(top.querySelector(".label")),
      dot: x(header.querySelector(".dot")),
      groupLabel: x(header.querySelector(".label")),
      groupedIcon: x(inGroup.querySelector(".icon")),
      groupedLabel: x(inGroup.querySelector(".label")),
    };
    let expected = { newTabIcon: 10, newTabLabel: 35, icon: 10, label: 35, dot: 10, groupLabel: 35, groupedIcon: 22, groupedLabel: 47 };
    check(JSON.stringify(at) == JSON.stringify(expected), JSON.stringify(at));
    let icon = top.querySelector(".icon").getBoundingClientRect();
    check(icon.width == 16, `icons are ${icon.width}px`);
    // A group stands apart from the rows around it, the Space's name from
    // the Sidebar's top row, and the tab list sits close under the name.
    let box = header.closest(".group").getBoundingClientRect();
    let above = top.getBoundingClientRect();
    check(Math.round(box.top - above.bottom) == 6, `${box.top - above.bottom}px before a group`);
    let row = shell.sidebar.renderRoot.querySelector(".top").getBoundingClientRect();
    let title = doc.getElementById("orbito-space-title");
    await title.updateComplete;
    let name = title.renderRoot.querySelector(".title");
    // The Pin grid between them keeps its place, with no Pin too: 8px
    // above it and under it.
    let grid = doc.getElementById("orbito-pins").getBoundingClientRect();
    let gap = grid.top - row.bottom;
    check(Math.round(gap) == 8, `${gap}px between the top row and the Pin grid`);
    gap = name.getBoundingClientRect().top - grid.bottom;
    check(Math.round(gap) == 8, `${gap}px between the Pin grid and the Space's name`);
    let nameStart = x(name) + parseFloat(win.getComputedStyle(name).paddingInlineStart);
    check(nameStart == 10 && name.getBoundingClientRect().height == 18, `the name at ${nameStart}`);
    gap = newTab.getBoundingClientRect().top - name.getBoundingClientRect().bottom;
    check(Math.round(gap) == 4, `${gap}px between the Space's name and the tab list`);
    """)


@test
def tab_rows_come_in_fold_away_and_slide_to_their_new_places(b):
    b.js("""
    await resetSpaces();
    await onlyBlankTab();
    let list = tabList();
    let layer = list.renderRoot.querySelector(".ghosts");
    let moves = el => el.getAnimations().filter(a => !a.animationName && !a.transitionProperty);
    let moved = el => moves(el).some(a => a.effect.getKeyframes().some(k => k.translate && k.translate != "0px"));
    let timing = a => a.effect.getComputedTiming().duration;
    // Until the list stands still, and long enough after that the next
    // change is not taken as part of the same batch.
    let settle = async () => {
      await list.updateComplete;
      let all = [...list.renderRoot.querySelectorAll("*")].flatMap(moves);
      await Promise.all(all.map(a => a.finished.catch(() => {})));
      await sleep(motionMs("medium") + 50);
    };
    let [a, b2, c] = [await openPage("Row A"), await openPage("Row B"), await openPage("Row C")];
    await settle();
    // A new tab between others comes in, and the rows under it make room.
    let fresh = win.gBrowser.addTab(pageURL("Row new"), {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      tabIndex: win.gBrowser.tabs.indexOf(b2),
    });
    await list.updateComplete;
    let row = rowFor(fresh);
    check(moves(row).length && !moved(row), "the new row does not come in");
    check(timing(moves(row)[0]) == motionMs("medium"), `it comes in for ${timing(moves(row)[0])}`);
    check(moved(rowFor(b2)) && moved(rowFor(c)), "the rows under it do not make room");
    check(!moved(rowFor(a)), "the row over it moves");
    await settle();
    // A closed tab folds away from where it was, and the rows under it
    // come up; the list's rows are still gBrowser's.
    win.gBrowser.removeTab(fresh, { animate: false });
    await list.updateComplete;
    check(layer.children.length == 1 && layer.firstElementChild.hasAttribute("ghost"), `${layer.children.length} rows fold away`);
    let ghost = layer.firstElementChild;
    check(!ghost.querySelector("button") && !ghost.hasAttribute("role") && ghost.inert, "the folding row can be used");
    check(moved(rowFor(b2)) && moved(rowFor(c)), "the rows under it do not come up");
    await listMatchesGBrowser();
    await settle();
    check(!layer.children.length, "the folded row stays");
    // A tab moved elsewhere slides to its place, as the rows it passes.
    win.gBrowser.moveTabBefore(c, a);
    await list.updateComplete;
    check(moved(rowFor(c)) && moved(rowFor(a)) && moved(rowFor(b2)), "the rows do not slide");
    await settle();
    // Many tabs closing at once just go.
    let many = [];
    for (let i = 0; i < 6; i++) {
      many.push(await openPage(`Row many ${i}`));
    }
    await settle();
    win.gBrowser.removeTabs(many, { animate: false });
    await list.updateComplete;
    check(!layer.children.length && ![...list.rows].some(r => moves(r).length), "many tabs closing move");
    // Nor does a Space switch move the rows.
    let first = spaces().current;
    let second = (await newSpace()).id;
    try {
      await openPage("Row other Space");
      await settle();
      spaces().switchTo(first);
      await list.updateComplete;
      check(!layer.children.length && ![...list.rows].some(r => moves(r).length), "the rows move on a Space switch");
      // Nor anything with reduced motion.
      Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
      await wait(() => win.matchMedia("(prefers-reduced-motion: reduce)").matches, "reduced motion");
      let last = await openPage("Row still");
      await list.updateComplete;
      win.gBrowser.moveTabBefore(last, a);
      await list.updateComplete;
      win.gBrowser.removeTab(last, { animate: false });
      await list.updateComplete;
      check(!layer.children.length && ![...list.rows].some(r => moves(r).length), "the rows move with reduced motion");
    } finally {
      Services.prefs.clearUserPref("ui.prefersReducedMotion");
      await resetSpaces();
    }
    """)


@test
def dragging_a_row_moves_its_tab(b):
    start, end = b.js("""
    await onlyBlankTab();
    for (let title of ["Drag A", "Drag B", "Drag C"]) {
      await openPage(title);
    }
    await rows();
    // Drag A below C: onto the lower half of C's row.
    let [, a, , c] = win.gBrowser.tabs;
    let target = rowFor(c).getBoundingClientRect();
    return [middle(rowFor(a)), [target.left + 40, target.bottom - 4]];
    """)
    b.drag(start, end)
    b.js("""
    await wait(() => win.gBrowser.tabs.map(t => t.label).join() == "New Tab,Drag B,Drag C,Drag A", "the tab to move");
    await listMatchesGBrowser();
    check(!tabList().dragging && !tabList().renderRoot.querySelector("[dragged]"), "the drag did not end");
    check(win.gBrowser.selectedTab.label == "Drag C", "dropping selected the tab");
    """)
    # Upwards, onto the upper half of the first row.
    start, end = b.js("""
    let [first, , c] = win.gBrowser.tabs;
    let target = rowFor(first).getBoundingClientRect();
    return [middle(rowFor(c)), [target.left + 40, target.top + 4]];
    """)
    b.drag(start, end)
    b.js("""
    await wait(() => win.gBrowser.tabs.map(t => t.label).join() == "Drag C,New Tab,Drag B,Drag A", "the tab to move up");
    await listMatchesGBrowser();
    """)
    # A short press is a click, not a drag; Escape cancels a drag.
    start = b.js("return middle(rowFor(win.gBrowser.tabs[2]));")
    b.pointer(start, "down", (start[0] + 2, start[1] + 1), "up")
    b.js("""
    await wait(() => win.gBrowser.selectedTab.label == "Drag B", "the click to select");
    check(win.gBrowser.tabs.map(t => t.label).join() == "Drag C,New Tab,Drag B,Drag A", "a click moved a tab");
    """)
    x, y = b.js("return middle(rowFor(win.gBrowser.tabs[0]));")
    mouse = b.m.actions.sequence("pointer", "mouse", pointer_params={"pointerType": "mouse"})
    keys = b.m.actions.sequence("key", "keyboard")
    mouse.pointer_move(round(x), round(y)).pointer_down()
    mouse.pointer_move(round(x), round(y + 40), duration=50).pointer_move(round(x), round(y + 80), duration=50)
    mouse.pause(0).pause(0).pointer_up()
    keys.pause(0).pause(0).pause(0).pause(0).key_down(Keys.ESCAPE).key_up(Keys.ESCAPE).pause(0)
    b.m.actions.perform([mouse.dict, keys.dict])
    b.m.actions.release()
    b.js("""
    await sleep(200);
    check(win.gBrowser.tabs.map(t => t.label).join() == "Drag C,New Tab,Drag B,Drag A", "a cancelled drag moved a tab");
    check(!tabList().dragging, "the drag did not end");
    """)


@test
def tab_groups_show_as_boxes_in_their_color_and_collapse(b):
    b.js("""
    await onlyBlankTab();
    let a = await openPage("Group A");
    let b2 = await openPage("Group B");
    let c = await openPage("Group C");
    let d = await openPage("Group D");
    let blue = addGroup([a, b2], "blue", "Research");
    let red = addGroup([c], "red", "");
    win.gBrowser.selectedTab = d;
    await listMatchesGBrowser();

    let header = headerFor(blue);
    let box = header.closest(".group");
    check(box.querySelector(".group-body").contains(rowFor(a)) && box.contains(rowFor(b2)), "the group's tabs are not in its box");
    check(!box.contains(rowFor(d)), "a tab outside the group is in its box");
    check(header.querySelector(".label").textContent == "Research", "the group's name is not shown");
    let tint = g => win.getComputedStyle(headerFor(g).closest(".group")).backgroundColor;
    check(tint(blue) != tint(red), `blue ${tint(blue)}, red ${tint(red)}`);
    check((await named(header)) == "Research" && header.getAttribute("aria-expanded") == "true", accessibleName(header));
    check((await named(headerFor(red))) == "Unnamed group", accessibleName(headerFor(red)));

    // Clicking anywhere on the header collapses and expands it.
    header.closest(".group-head").click();
    await wait(() => blue.collapsed, "the group to collapse");
    await listMatchesGBrowser();
    check(!rowFor(a) && !rowFor(b2) && headerFor(blue), "a collapsed group still shows its tabs");
    check(headerFor(blue).getAttribute("aria-expanded") == "false", "aria-expanded");
    headerFor(blue).querySelector(".chevron").click();
    await wait(() => !blue.collapsed, "the group to expand");
    await listMatchesGBrowser();

    // A collapsed group still shows its selected tab, as Firefox does.
    win.gBrowser.selectedTab = a;
    blue.collapsed = true;
    await listMatchesGBrowser();
    check(rowFor(a) && !rowFor(b2), "the selected tab is not shown in its collapsed group");
    blue.collapsed = false;

    // Closing the group closes its tabs.
    let close = headerFor(red).closest(".group-head").querySelector(".close");
    check((await named(close)) == "Close group", accessibleName(close));
    close.click();
    await wait(() => !c.isConnected, "the group's tab to close");
    await listMatchesGBrowser();
    check(!headerFor(red), "the closed group is still listed");
    """)


@test
def only_a_group_title_darkens_its_box(b):
    title, close = b.js("""
    await onlyBlankTab();
    addGroup([await openPage("Hover A")], "blue", "Hover");
    await listMatchesGBrowser();
    let header = headerFor(win.gBrowser.tabGroups[0]);
    return [middle(header), middle(header.closest(".group-head").querySelector(".close"))];
    """)
    tint = """
    let header = headerFor(win.gBrowser.tabGroups[0]);
    await sleep(200);
    return win.getComputedStyle(header.closest(".group")).backgroundColor;
    """
    rest = b.js(tint)
    b.pointer(close)
    assert b.js("return headerFor(win.gBrowser.tabGroups[0]).closest('.group-head').querySelector('.close').matches(':hover');"), "the pointer is not over the close button"
    assert b.js(tint) == rest, "the close button darkens the group"
    b.pointer(title)
    assert b.js(tint) != rest, "the title does not darken the group"


@test
def dragging_moves_tabs_into_and_out_of_groups_and_moves_groups(b):
    start, end = b.js("""
    await onlyBlankTab();
    let a = await openPage("In A");
    let b2 = await openPage("In B");
    await openPage("Out C");
    addGroup([a, b2], "green", "Box");
    await rows();
    // The group went last. C onto the lower half of A: into the group,
    // after A.
    let target = rowFor(a).getBoundingClientRect();
    return [middle(rowFor(byLabel("Out C"))), [target.left + 40, target.bottom - 4]];
    """)
    b.drag(start, end)
    start, end = b.js("""
    let names = () => win.gBrowser.tabs.map(t => `${t.label}${t.group ? "@" + t.group.label : ""}`).join();
    await wait(() => names() == "New Tab,In A@Box,Out C@Box,In B@Box", `C to join the group: ${names()}`);
    await listMatchesGBrowser();
    let c = byLabel("Out C");
    check(rowFor(c).closest(".group"), "C is not drawn in the group");
    // C onto the upper half of the group's header: out, before the group.
    let target = headerFor(c.group).getBoundingClientRect();
    return [middle(rowFor(c)), [target.left + 40, target.top + 3]];
    """)
    b.drag(start, end)
    start, end = b.js("""
    let names = () => win.gBrowser.tabs.map(t => `${t.label}${t.group ? "@" + t.group.label : ""}`).join();
    await wait(() => names() == "New Tab,Out C,In A@Box,In B@Box", `C to leave the group: ${names()}`);
    await listMatchesGBrowser();
    // The group by its header, above the first tab.
    let group = win.gBrowser.tabGroups[0];
    let target = rowFor(win.gBrowser.tabs[0]).getBoundingClientRect();
    return [middle(headerFor(group)), [target.left + 40, target.top + 4]];
    """)
    b.drag(start, end)
    b.js("""
    let names = () => win.gBrowser.tabs.map(t => `${t.label}${t.group ? "@" + t.group.label : ""}`).join();
    await wait(() => names() == "In A@Box,In B@Box,New Tab,Out C", `the group to move: ${names()}`);
    await listMatchesGBrowser();
    check(!win.gBrowser.tabGroups[0].collapsed, "dragging the header toggled the group");
    """)


@test
def holding_a_dragged_tab_over_another_groups_them(b):
    start, end = b.js("""
    await onlyBlankTab();
    for (let title of ["Hold A", "Hold B", "Hold C"]) {
      await openPage(title);
    }
    await rows();
    return [middle(rowFor(byLabel("Hold C"))), middle(rowFor(byLabel("Hold A")))];
    """)
    # Passing over a row does not arm it: the drop moves the tab.
    b.pointer(start, "down", (start[0], start[1] - 10), end, "up")
    start, end = b.js("""
    let names = () => win.gBrowser.tabs.map(t => `${t.label}${t.group ? "@" : ""}`).join();
    await wait(() => !tabList().dragging, "the drag to end");
    check(!win.gBrowser.tabGroups.length, `a quick drop made a group: ${names()}`);
    return [middle(rowFor(byLabel("Hold C"))), middle(rowFor(byLabel("Hold A")))];
    """)
    # Held over A's middle: A arms, then the drop makes a group of the two.
    x, y = start
    hold = b.m.actions.sequence("pointer", "mouse", pointer_params={"pointerType": "mouse"})
    hold.pointer_move(round(x), round(y)).pointer_down()
    hold.pointer_move(round(x), round(y - 10), duration=50).pointer_move(round(end[0]), round(end[1]), duration=50)
    hold.perform()
    try:
        b.js("""
        let a = byLabel("Hold A");
        await wait(() => rowFor(a).getAttribute("hold") == "", "A to be held over");
        // No line shows where a drop would land, in the list or around.
        let lines = [tabList(), pinGrid(), dock()].filter(el => el.renderRoot.querySelector("[drop]"));
        check(!lines.length, `drop lines in ${lines.map(el => el.localName)}`);
        await wait(() => rowFor(a).getAttribute("hold") == "armed", "A to arm");
        check(rowFor(a).getAttribute("hold-hint") == "Create group", rowFor(a).getAttribute("hold-hint"));
        check(win.getComputedStyle(rowFor(a).querySelector(".close")).visibility == "hidden", "the close button shows on an armed tab");
        """)
        drop = b.m.actions.sequence("pointer", "mouse", pointer_params={"pointerType": "mouse"})
        drop.pointer_up()
        drop.perform()
    finally:
        b.m.actions.release()
    start, end = b.js("""
    let a = byLabel("Hold A"), c = byLabel("Hold C");
    await wait(() => win.gBrowser.tabGroups.length == 1 && a.group && a.group == c.group, "A and C to be grouped");
    let group = a.group;
    check(group.tabs.join() == [a, c].join(), "the group is not A then C");
    check(group.label == "New group 1", `the new group is named ${group.label}`);
    check(!tabList().renderRoot.querySelector("[hold]") && !tabList().dragging, "the drag did not end");
    await listMatchesGBrowser();
    check(headerFor(group).closest(".group").hasAttribute("fresh"), "the new group does not pop in");
    // B held over C, in the group, joins it, last.
    return [middle(rowFor(byLabel("Hold B"))), middle(rowFor(c))];
    """)
    b.pointer(start, "down", (start[0], start[1] - 10), end, 700, "up")
    b.js("""
    let a = byLabel("Hold A"), b2 = byLabel("Hold B"), c = byLabel("Hold C");
    await wait(() => b2.group == a.group, "B to join the group");
    check(win.gBrowser.tabGroups.length == 1 && a.group.tabs.join() == [a, c, b2].join(), "B is not last in the group");
    await listMatchesGBrowser();
    """)
    # Tabs in one group do not arm each other: the drop only moves.
    start, end = b.js("""
    let [a, c] = [byLabel("Hold A"), byLabel("Hold C")];
    return [middle(rowFor(a)), middle(rowFor(c))];
    """)
    b.pointer(start, "down", (start[0], start[1] + 10), end, 700, "up")
    b.js("""
    await wait(() => !tabList().dragging, "the drag to end");
    check(win.gBrowser.tabGroups.length == 1 && win.gBrowser.tabGroups[0].tabs.length == 3, "tabs in one group grouped again");
    """)
    # Another new group takes the next number no group has.
    start, end = b.js("""
    let d = await openPage("Hold D");
    let e = await openPage("Hold E");
    await rows();
    return [middle(rowFor(e)), middle(rowFor(d))];
    """)
    b.pointer(start, "down", (start[0], start[1] - 10), end, 700, "up")
    b.js("""
    let d = byLabel("Hold D");
    await wait(() => d.group && d.group == byLabel("Hold E").group, "D and E to be grouped");
    check(d.group.label == "New group 2", `the second new group is named ${d.group.label}`);
    """)


@test
def arrow_keys_move_through_groups_and_toggle_them(b):
    b.js("""
    await onlyBlankTab();
    let a = await openPage("Key A");
    let b2 = await openPage("Key B");
    let group = addGroup([a, b2], "purple", "Keys");
    win.gBrowser.selectedTab = win.gBrowser.tabs[0];
    tabList().focusRegion();
    await wait(() => deepActive()?.tab == win.gBrowser.tabs[0], "the selected row to have focus");
    """)
    b.keys(Keys.ARROW_DOWN)
    b.js("""
    let group = win.gBrowser.tabGroups[0];
    await wait(() => deepActive() == headerFor(group), "focus on the group header");
    check(deepActive().matches(":focus-visible"), "the focused header shows no focus");
    """)
    b.keys(Keys.ENTER)
    b.js("""
    let group = win.gBrowser.tabGroups[0];
    await wait(() => group.collapsed, "Enter to collapse the group");
    check(deepActive() == headerFor(group), "focus left the header");
    """)
    b.keys(Keys.ARROW_DOWN)
    b.js("""
    // Nothing below the collapsed group: focus stays on its header.
    let group = win.gBrowser.tabGroups[0];
    await sleep(100);
    check(deepActive() == headerFor(group), "focus moved into the collapsed group");
    """)
    b.keys(Keys.ARROW_RIGHT, Keys.ARROW_DOWN, Keys.ARROW_DOWN)
    b.js("""
    let group = win.gBrowser.tabGroups[0];
    await wait(() => !group.collapsed && deepActive()?.tab == group.tabs[1], "Right to expand, Down into the group");
    """)
    b.keys(Keys.ARROW_LEFT)
    b.js("""
    let group = win.gBrowser.tabGroups[0];
    await wait(() => deepActive() == headerFor(group), "Left to go to the header");
    """)
    b.keys(Keys.ARROW_LEFT)
    b.js("""
    let group = win.gBrowser.tabGroups[0];
    await wait(() => group.collapsed, "Left to collapse");
    let list = await rows();
    let stops = [...tabList().renderRoot.querySelectorAll("[tabindex='0']")];
    check(stops.length == 1 && stops[0] == headerFor(group), "the list is not one tab stop");
    group.collapsed = false;
    """)


@test
def the_sidebar_collapses_and_peeks_from_the_left_edge(b):
    b.js("""
    await resetSidebar();
    await onlyBlankTab();
    await openPage("Peek");
    let button = shell.sidebar.collapseButton;
    check((await named(button)) == "Collapse sidebar", accessibleName(button));
    button.click();
    await wait(() => Services.prefs.getBoolPref("orbito.sidebar.collapsed"), "the pref");
    await wait(() => shell.sidebar.getBoundingClientRect().right <= 0, "the Sidebar to leave");
    // The page widens as it goes.
    await sidebarMoved();
    let page = win.gBrowser.tabbox.getBoundingClientRect();
    check(page.left <= 8, `the page starts at ${page.left}`);
    check(shell.topBar.getBoundingClientRect().left <= 8, "the Top bar did not widen");
    await wait(() => !shell.sidebar.checkVisibility({ visibilityProperty: true }), "the collapsed Sidebar to hide");
    if (AppConstants.platform == "macosx") {
      let lights = doc.getElementById("orbito-window-buttons");
      check(lights.parentNode == shell.topBar && lights.assignedSlot?.name == "start", "the traffic lights stayed in the Sidebar");
    }
    """)
    b.pointer((300, 300), (2, 300))
    b.js("""
    await wait(() => shell.sidebar.peeking, "the Sidebar to peek");
    await wait(() => shell.sidebar.getBoundingClientRect().left >= 8, "the Sidebar to come in");
    check(shell.sidebar.checkVisibility({ visibilityProperty: true }), "the peeking Sidebar is hidden");
    await wait(() => accessibleName(shell.sidebar.collapseButton) == "Keep sidebar open", "the button's new name");
    let page = win.gBrowser.tabbox.getBoundingClientRect();
    check(page.left <= 8, "peeking moved the page");
    """)
    # Onto the Sidebar it stays; onto the page it goes.
    b.pointer((100, 300), 400)
    b.js("check(shell.sidebar.peeking, 'the Sidebar left with the pointer on it');")
    b.pointer((700, 300))
    b.js("""
    await wait(() => !shell.sidebar.peeking, "the Sidebar to go");
    await wait(() => !shell.sidebar.checkVisibility({ visibilityProperty: true }), "the Sidebar to hide");
    """)
    # F6 brings it with focus; Escape sends it away and focus to the page.
    b.js("""
    win.gBrowser.selectedBrowser.focus();
    await wait(() => shell.focusedRegion == "page", "the page to have focus");
    """)
    b.keys(Keys.F6)
    b.js("""
    await wait(() => shell.focusedRegion == "sidebar" && shell.sidebar.peeking, "F6 to peek the Sidebar");
    check(deepActive()?.tab == win.gBrowser.selectedTab, "focus is not on the selected row");
    """)
    b.keys(Keys.ESCAPE)
    b.js("""
    await wait(() => !shell.sidebar.peeking && shell.focusedRegion == "page", "Escape to hide the Sidebar");
    // Until it has slid out, the card (over the edge strip) takes the
    // pointer at the window's edge, and the edge strip hears nothing.
    await wait(() => !shell.sidebar.checkVisibility({ visibilityProperty: true }), "the Sidebar to hide");
    """)
    # Keep it open again from the peeking Sidebar.
    b.pointer((2, 300), (60, 20))
    b.js("""
    await wait(() => shell.sidebar.peeking, "the Sidebar to peek");
    shell.sidebar.collapseButton.click();
    await wait(() => !Services.prefs.getBoolPref("orbito.sidebar.collapsed"), "the pref");
    await wait(() => shell.sidebar.getBoundingClientRect().left == 0, "the Sidebar to go back to the left");
    await sidebarMoved();
    check(win.gBrowser.tabbox.getBoundingClientRect().left >= shell.sidebar.getBoundingClientRect().right, "the Sidebar did not take its place");
    check(getComputedStyle(doc.getElementById("orbito-sidebar-edge")).display == "none", "the edge strip is still there");
    if (AppConstants.platform == "macosx") {
      let lights = doc.getElementById("orbito-window-buttons");
      check(lights.parentNode == shell.sidebar && lights.assignedSlot?.name == "window-buttons", "the traffic lights did not come back");
    }
    """)


@test
def the_page_moves_with_the_sidebar_as_it_collapses_and_comes_back(b):
    b.js("""
    await resetSidebar();
    await onlyBlankTab();
    await openPage("Moves");
    let grid = doc.getElementById("browser");
    let sidebar = shell.sidebar;
    let left = () => win.gBrowser.tabbox.getBoundingClientRect().left;
    let timing = a => a.effect.getComputedTiming().duration;
    let open = left();
    try {
      // Collapsing, the page widens over the long motion, as the Sidebar
      // slides out.
      sidebar.toggleCollapsed();
      await sidebar.updateComplete;
      let [widen] = grid.getAnimations();
      check(widen && timing(widen) == motionMs("long"), `the page widens for ${widen && timing(widen)}`);
      widen.pause();
      widen.currentTime = timing(widen) / 2;
      check(left() > 8 && left() < open, `halfway the page starts at ${left()} (${open} open)`);
      widen.play();
      await widen.finished;
      check(left() <= 8, `the page starts at ${left()}`);
      // Coming back, the Sidebar slides in at its width as the page
      // narrows.
      sidebar.toggleCollapsed();
      await sidebar.updateComplete;
      let [narrow] = grid.getAnimations();
      let [slide] = sidebar.getAnimations().filter(a => !a.transitionProperty);
      check(narrow && slide && timing(slide) == timing(narrow), "the Sidebar does not slide in with the page");
      narrow.pause();
      slide.pause();
      narrow.currentTime = slide.currentTime = timing(narrow) / 2;
      let box = sidebar.getBoundingClientRect();
      check(box.width == sidebar.width && box.left < 0 && box.right > 8, `halfway the Sidebar is at ${box.left} to ${box.right}`);
      check(Math.abs(left() - box.right) < 12, `the page (${left()}) does not follow the Sidebar (${box.right})`);
      narrow.play();
      slide.play();
      await narrow.finished;
      check(left() == open, `the page starts at ${left()}, not ${open}`);
      // A new width is not animated.
      Services.prefs.setIntPref("orbito.sidebar.width", 300);
      await sidebar.updateComplete;
      check(!grid.getAnimations().length && !sidebar.getAnimations().length, "the new width moves");
      // Nor anything with reduced motion.
      Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
      await wait(() => win.matchMedia("(prefers-reduced-motion: reduce)").matches, "reduced motion");
      sidebar.toggleCollapsed();
      await sidebar.updateComplete;
      check(!grid.getAnimations().length && !sidebar.getAnimations().length, "the Sidebar moves with reduced motion");
      check(left() <= 8, `with reduced motion the page starts at ${left()}`);
    } finally {
      Services.prefs.clearUserPref("ui.prefersReducedMotion");
      await resetSidebar();
    }
    """)


SAVES_ON_ACCEL_S = (
    "<title>ready</title><script>let n = 0; addEventListener('keydown', e => {"
    " if ((e.metaKey || e.ctrlKey) && e.key == 's') { e.preventDefault(); document.title = 'saved ' + ++n; } });"
    "</script><body>An editor"
)


@test
def accel_s_toggles_the_sidebar_unless_the_page_takes_it(b):
    b.js("""
    await onlyBlankTab();
    Services.prefs.clearUserPref("orbito.sidebar.collapsed");
    await openPage("Plain");
    win.gBrowser.selectedBrowser.focus();
    """)
    collapsed = 'return Services.prefs.getBoolPref("orbito.sidebar.collapsed", false);'
    try:
        # A page that does not use it: the Sidebar collapses, and back.
        b.keys((ACCEL, "s"))
        b.js('await wait(() => Services.prefs.getBoolPref("orbito.sidebar.collapsed", false), "⌘S to collapse");')
        b.keys((ACCEL, "s"))
        b.js('await wait(() => !Services.prefs.getBoolPref("orbito.sidebar.collapsed", false), "⌘S to keep it");')
        # A web app saving its document keeps the key; the Sidebar stays.
        b.js(f"""
        win.openTrustedLinkIn("data:text/html," + encodeURIComponent({SAVES_ON_ACCEL_S!r}), "current");
        await wait(() => win.gBrowser.selectedBrowser.contentTitle == "ready", "the editor");
        win.gBrowser.selectedBrowser.focus();
        """)
        b.keys((ACCEL, "s"))
        b.js('await wait(() => win.gBrowser.selectedBrowser.contentTitle == "saved 1", "the page to save");')
        b.js("await sleep(300);")
        assert not b.js(collapsed), "the Sidebar toggled over a page that saves"
        # With focus in the Shell, it is the Sidebar's.
        b.js("shell.sidebar.focusRegion();")
        b.keys((ACCEL, "s"))
        b.js('await wait(() => Services.prefs.getBoolPref("orbito.sidebar.collapsed", false), "⌘S from the Sidebar");')
    finally:
        b.js('Services.prefs.clearUserPref("orbito.sidebar.collapsed"); await onlyBlankTab();')


@test
def the_sidebar_width_stays_between_200_and_360(b):
    handle = b.js("""
    await resetSidebar();
    let width = () => shell.sidebar.getBoundingClientRect().width;
    check(width() == 244, `the default width is ${width()}`);
    let handle = shell.sidebar.resizer;
    check((await named(handle)) == "Resize sidebar", accessibleName(handle));
    return middle(handle);
    """)
    b.drag(handle, (handle[0] + 60, handle[1]))
    handle = b.js("""
    let width = () => shell.sidebar.getBoundingClientRect().width;
    await wait(() => Services.prefs.getIntPref("orbito.sidebar.width") == 304, "the pref");
    check(width() == 304, `width ${width()}`);
    check(win.gBrowser.tabbox.getBoundingClientRect().left >= 304, "the page did not move");
    return middle(shell.sidebar.resizer);
    """)
    b.drag(handle, (handle[0] + 400, handle[1]))
    handle = b.js("""
    await wait(() => Services.prefs.getIntPref("orbito.sidebar.width") == 360, "the pref at most");
    check(shell.sidebar.getBoundingClientRect().width == 360, "wider than 360");
    return middle(shell.sidebar.resizer);
    """)
    b.drag(handle, (10, handle[1]))
    handle = b.js("""
    await wait(() => Services.prefs.getIntPref("orbito.sidebar.width") == 200, "the pref at least");
    check(shell.sidebar.getBoundingClientRect().width == 200, "narrower than 200");
    check(shell.sidebar.resizer.getAttribute("aria-valuenow") == "200", "aria-valuenow");
    return middle(shell.sidebar.resizer);
    """)
    # A double click goes back to the default.
    b.pointer(handle, "down", "up", "down", "up")
    b.js("""
    await wait(() => !Services.prefs.prefHasUserValue("orbito.sidebar.width"), "the pref to reset");
    check(shell.sidebar.getBoundingClientRect().width == 244, "not back to 244");
    shell.sidebar.resizer.focus({ focusVisible: true });
    """)
    # The keyboard: arrows step, End and Home go to the ends.
    b.keys(Keys.ARROW_RIGHT, Keys.ARROW_RIGHT)
    b.js("""
    await wait(() => shell.sidebar.width == 260, `Right twice: ${shell.sidebar.width}`);
    check(shell.sidebar.resizer.matches(":focus-visible"), "the handle shows no focus");
    """)
    b.keys(Keys.END)
    b.js("await wait(() => shell.sidebar.width == 360, 'End');")
    b.keys(Keys.HOME, Keys.ARROW_LEFT)
    b.js("""
    await wait(() => shell.sidebar.width == 200, "Home, then Left stops at 200");
    // Every window follows.
    let other = win.OpenBrowserWindow();
    try {
      await wait(() => other.gBrowserInit?.delayedStartupFinished, "the new window");
      check(other.OrbitoShell.sidebar.getBoundingClientRect().width == 200, "a new window has another width");
    } finally {
      other.close();
    }
    await resetSidebar();
    """)


@test
def switching_spaces_hides_the_other_spaces_tabs(b):
    b.js("""
    await resetSpaces();
    await onlyBlankTab();
    let first = spaces().current;
    check(spaces().list.length == 1 && spaces().currentSpace.name, "no first Space");
    let title = doc.getElementById("orbito-space-title");
    await title.updateComplete;
    check(title.renderRoot.textContent.trim() == spaces().currentSpace.name, "the Space title is not the Space's name");
    let home = await openPage("Home tab");
    let pinned = await openPage("Pinned tab");
    win.gBrowser.pinTab(pinned);
    win.gBrowser.selectedTab = home;
    try {
      let second = await newSpace();
      check(second.id != first && second.name == "Space 2", JSON.stringify(second));
      await title.updateComplete;
      check(title.renderRoot.textContent.trim() == "Space 2", "the Space title did not follow");
      check(SessionStore.getCustomWindowValue(win, "orbitoSpace") == second.id, "the window value is not the Space");
      // The new Space starts with a tab of its own; the first Space's tabs
      // are hidden in gBrowser, the pinned one stays.
      let selected = win.gBrowser.selectedTab;
      check(selected != home && spaceOfTab(selected) == second.id, "no tab of the new Space is selected");
      check(home.hidden && !pinned.hidden, `home hidden ${home.hidden}, pinned hidden ${pinned.hidden}`);
      check(win.gBrowser.tabs.filter(t => !t.pinned && spaceOfTab(t) == first).every(t => t.hidden), "a tab of the first Space shows");
      await listMatchesGBrowser();
      check(!(await rows()).some(r => r.tab == home), "the list shows another Space's tab");
      // New tabs go in the Space shown.
      let away = await openPage("Away tab");
      check(spaceOfTab(away) == second.id && !away.hidden, "a new tab is not in the current Space");
      // Back to the first: the tab used last there is selected again.
      let dot = await dotFor(first);
      dot.click();
      await wait(() => spaces().current == first, "the first Space");
      check(win.gBrowser.selectedTab == home, `selected ${win.gBrowser.selectedTab.label}`);
      check(away.hidden && !home.hidden && !pinned.hidden, "the tabs did not swap");
      await listMatchesGBrowser();
      // Selecting a tab of another Space (as a tool or a "switch to tab"
      // result does) shows its Space.
      win.gBrowser.selectedTab = away;
      await wait(() => spaces().current == second.id, "the tab's Space");
      check(!away.hidden && home.hidden, "the tab's Space is not shown");
      // Closing a Space's last tab leaves a new tab in it.
      for (let tab of spaces().tabsIn(second.id)) {
        win.gBrowser.removeTab(tab, { animate: false });
      }
      await wait(() => spaces().tabsIn(second.id).length == 1, "a new tab in the Space");
      check(spaces().current == second.id, "closing its last tab left the Space");
      let left = win.gBrowser.selectedTab;
      check(spaceOfTab(left) == second.id && !left.hidden, `selected ${left.label} in ${spaceOfTab(left)}`);
      await listMatchesGBrowser();
    } finally {
      await resetPins();
      win.gBrowser.removeTab(pinned);
      await resetSpaces();
    }
    """)


@test
def hovering_the_switcher_does_not_switch_a_click_does(b):
    b.js("""
    await resetSpaces();
    await onlyBlankTab();
    await newSpace();
    shell.spaces.switchTo(spaces().list[0].id);
    await tabList().updateComplete;
    """)
    try:
        dot = b.js("""
        let dot = await dotFor(spaces().list[1].id);
        return middle(dot);
        """)
        b.pointer((dot[0] - 30, dot[1]), (dot[0], dot[1]), 800, (dot[0] + 30, dot[1]), (dot[0], dot[1]), 400)
        b.js("""
        check(spaces().current == spaces().list[0].id, "hovering switched the Space");
        """)
        b.pointer((dot[0], dot[1]), "down", "up")
        b.js("""
        await wait(() => spaces().current == spaces().list[1].id, "a click to switch");
        """)
    finally:
        b.js("await resetSpaces();")


def space_keys(n=None, arrow=None):
    mods = (Keys.CONTROL,) if sys.platform == "darwin" else (Keys.CONTROL, Keys.ALT)
    if arrow:
        mods = (Keys.META, Keys.ALT) if sys.platform == "darwin" else (Keys.CONTROL, Keys.ALT)
        return (*mods, Keys.ARROW_RIGHT if arrow > 0 else Keys.ARROW_LEFT)
    return (*mods, str(n))


@test
def shortcuts_go_to_the_nth_previous_and_next_space(b):
    b.js("""
    await resetSpaces();
    await onlyBlankTab();
    await openPage("Shortcut one");
    await openPage("Shortcut two");
    await newSpace();
    await newSpace();
    await spaces().switchTo(spaces().list[0].id);
    win.gBrowser.selectedTab = byLabel("Shortcut one");
    closeCommandBar();
    // Again until the tab switch is done.
    await wait(() => {
      win.gBrowser.selectedBrowser.focus();
      return shell.focusedRegion == "page";
    }, "the page to have focus");
    """)
    try:
        ids = b.js("return spaces().list.map(s => s.id);")
        b.keys(space_keys(3))
        # Its new tab's page focuses its input as it loads; keys pressed
        # before are lost.
        b.js(f"""
        await wait(() => spaces().current == "{ids[2]}", "the third Space");
        await wait(() => Services.focus.focusedElement?.localName == "input", "the new tab's input to have focus");
        """)
        b.keys(space_keys(2))
        b.js(f'await wait(() => spaces().current == "{ids[1]}", "the second Space");')
        # No fourth Space: nothing happens.
        b.keys(space_keys(4))
        b.js(f'await sleep(200); check(spaces().current == "{ids[1]}", "a missing Space was shown");')
        b.keys(space_keys(1))
        b.js(f'await wait(() => spaces().current == "{ids[0]}", "the first Space");')
        # Next and previous, going round; Firefox's own use of these keys on
        # macOS (the next tab) does not happen.
        b.js("win.gBrowser.selectedBrowser.focus();")
        b.keys(space_keys(arrow=1))
        b.js(f"""
        await wait(() => spaces().current == "{ids[1]}", "the next Space");
        """)
        b.keys(space_keys(arrow=-1))
        b.js(f"""
        await wait(() => spaces().current == "{ids[0]}", "the previous Space");
        check(win.gBrowser.selectedTab == byLabel("Shortcut one"), `selected ${{win.gBrowser.selectedTab.label}}`);
        """)
        b.keys(space_keys(arrow=-1))
        b.js(f'await wait(() => spaces().current == "{ids[2]}", "round to the last Space");')
    finally:
        b.js("await resetSpaces();")


@test
def a_sideways_scroll_on_the_sidebar_goes_to_the_next_or_previous_space(b):
    b.js("""
    await resetSpaces();
    await onlyBlankTab();
    await newSpace();
    await newSpace();
    await spaces().switchTo(spaces().list[0].id);
    """)
    try:
        b.js("""
        let ids = spaces().list.map(s => s.id);
        let rtl = win.document.dir == "rtl" ? -1 : 1;
        // A swipe: many small scrolls, then its momentum.
        async function swipe(target, deltaX, deltaY = 0, times = 12) {
          for (let i = 0; i < times; i++) {
            target.dispatchEvent(new win.WheelEvent("wheel", {
              deltaX: rtl * deltaX, deltaY, bubbles: true, composed: true, cancelable: true,
            }));
            await sleep(16);
          }
          // The swipe is over.
          await sleep(400);
        }
        let list = shell.sidebar.tabList;
        await swipe(list, 15);
        check(spaces().current == ids[1], "one swipe goes one Space on");
        await swipe(shell.sidebar, -15);
        check(spaces().current == ids[0], "back to the previous Space");
        // Going round, like the shortcuts.
        await swipe(list, -15);
        check(spaces().current == ids[2], "round to the last Space");
        // A scroll mostly up or down is the tab list's.
        await swipe(list, 6, 40);
        check(spaces().current == ids[2], "a vertical scroll switched the Space");
        // A nudge is not a swipe.
        await swipe(list, 4, 0, 3);
        check(spaces().current == ids[2], "a nudge switched the Space");
        // Not over the page.
        await swipe(win.gBrowser.selectedBrowser, 15);
        check(spaces().current == ids[2], "a swipe over the page switched the Space");
        """)
    finally:
        b.js("await resetSpaces();")


@test
def undo_takes_back_a_new_space_and_its_tabs(b):
    b.js("""
    await resetSpaces();
    await onlyBlankTab();
    let home = await openPage("Undo home");
    let before = win.gBrowser.tabs.slice();
    let first = spaces().current;
    let made = await newSpace();
    let note = switcher().note;
    check(shown(note) && note.textContent.includes(made.name), `note: ${note.textContent}`);
    await openPage("Undo away");
    check(win.gBrowser.tabs.length == before.length + 2, `${win.gBrowser.tabs.length} tabs`);
    await named(switcher().undoButton);
    check(accessibleName(switcher().undoButton) == "Undo", accessibleName(switcher().undoButton));
    switcher().undoButton.click();
    await wait(() => spaces().list.length == 1, "the Space to go");
    check(spaces().current == first, "not back in the first Space");
    await wait(() => win.gBrowser.tabs.length == before.length, "the Space's tabs to close");
    check(win.gBrowser.tabs.every((t, i) => t == before[i]), "other tabs changed");
    check(win.gBrowser.selectedTab == home && !home.hidden, `selected ${win.gBrowser.selectedTab.label}`);
    check(!switcher().undoable && !shown(switcher().note), "the note stayed");
    await listMatchesGBrowser();
    // Without undo, the offer goes after five seconds and the Space stays.
    await newSpace();
    await sleep(5300);
    await switcher().updateComplete;
    check(!spaces().undoable && !shown(switcher().note), "the note is still there");
    check(spaces().list.length == 2, "the Space went");
    await resetSpaces();
    """)


@test
def the_space_menu_renames_a_space_and_opens_its_settings(b):
    b.js("""
    await resetSpaces();
    await onlyBlankTab();
    let title = doc.getElementById("orbito-space-title");
    await title.updateComplete;
    let name = () => title.renderRoot.querySelector(".title");
    // The only Space cannot be deleted.
    let items = await spaceMenu(name());
    check(JSON.stringify(items) == '["rename","settings","remove:disabled"]', JSON.stringify(items));
    await newSpace();
    items = await spaceMenu(name());
    check(JSON.stringify(items) == '["rename","settings","remove"]', JSON.stringify(items));
    // Renaming from the title: a field in its place, with the name, focused.
    await spaceMenu(name(), "rename");
    let field = await wait(() => title.renderRoot.querySelector("input.rename"), "the name field");
    await wait(() => deepActive() == field, "focus on the name field");
    check(field.value == spaces().currentSpace.name, field.value);
    check(await named(field) == "Space name", accessibleName(field));
    check(field.matches(":focus-visible"), "the field shows no focus");
    field.select();
    """)
    try:
        b.keys(*"Research")
        b.keys(Keys.ENTER)
        b.js("""
        await wait(() => spaces().currentSpace.name == "Research", "the new name");
        let title = doc.getElementById("orbito-space-title");
        await title.updateComplete;
        check(!title.renderRoot.querySelector("input.rename"), "the field stayed");
        check(title.renderRoot.querySelector(".title").textContent.trim() == "Research", "the title");
        check(OrbitoShellStore.get("spaces").find(s => s.id == spaces().current).name == "Research", "the name is not stored");
        // Escape keeps the name.
        await spaceMenu(title.renderRoot.querySelector(".title"), "rename");
        let field = await wait(() => title.renderRoot.querySelector("input.rename"), "the name field");
        await wait(() => deepActive() == field, "focus on the name field");
        field.value = "Dropped";
        """)
        b.keys(Keys.ESCAPE)
        b.js("""
        let title = doc.getElementById("orbito-space-title");
        await wait(() => !title.renderRoot.querySelector("input.rename"), "the field to go");
        check(spaces().currentSpace.name == "Research", spaces().currentSpace.name);
        // From another Space's dot, that Space is shown and renamed; a blank
        // name keeps the old one.
        let [first, second] = spaces().list.map(s => s.id);
        let before = spaces().list[0].name;
        await spaceMenu(await dotFor(first), "rename");
        await wait(() => spaces().current == first, "the dot's Space");
        let field = await wait(() => title.renderRoot.querySelector("input.rename"), "the name field");
        field.value = "   ";
        field.blur();
        await wait(() => !title.renderRoot.querySelector("input.rename"), "the field to go once left");
        check(spaces().currentSpace.name == before, spaces().currentSpace.name);
        // Space settings: the settings page, on the Space's card.
        await spaceMenu(await dotFor(second), "settings");
        let page = await wait(() => {
          let d = win.gBrowser.selectedBrowser.contentDocument;
          return d?.documentURI == "about:orbito-settings" && d.querySelector(`.space[data-space="${second}"] input.space-name`) && d;
        }, "the settings page");
        let input = page.querySelector(`.space[data-space="${second}"] input.space-name`);
        await wait(() => page.activeElement == input, "focus on the Space's name");
        check(input.value == "Research", input.value);
        check(spaces().current == first, "the window showed another Space");
        // Renamed there, the Sidebar follows.
        input.value = "Reading";
        input.dispatchEvent(new page.defaultView.Event("change"));
        await wait(() => spaces().list[1].name == "Reading", "the name from the settings");
        check((await dotFor(second)).getAttribute("aria-label") == "Reading", "the dot's name");
        (await dotFor(first)).focus({ focusVisible: true });
        """)
        # The menu from the keyboard, on a dot.
        b.keys((Keys.SHIFT, Keys.F10))
        b.js("""
        let menu = spaces().menu;
        await wait(() => menu.state == "open", "Shift+F10 to open the Space menu");
        let hidden = new Promise(r => menu.addEventListener("popuphidden", r, { once: true }));
        menu.hidePopup();
        await hidden;
        """)
    finally:
        b.js("await resetSpaces();")


SPACE_DATA = """
const { OrbitoTasks } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoTasks.sys.mjs"
);
// Something of each kind kept in a Space: a memory, a Thread, a document,
// a page read there, a scheduled task and a built-in skill.
async function spaceData(space, word) {
  let now = Date.now();
  let memory = await core.addMemory({ text: `${word} memory`, space });
  let thread = {
    id: Services.uuid.generateUUID().toString().slice(1, -1),
    space_id: space, title: `${word} thread`, created_at: now, updated_at: now,
  };
  await core.store.saveThread(thread);
  let artifact = await core.createArtifact({ title: `${word} document`, content: `${word} body`, space });
  let url = pageURL(`${word} read`);
  await core.store.savePage({ url, title: `${word} read`, text: `${word}zz page text` }, now, { space });
  let task = await OrbitoTasks.save({ name: `${word} task`, prompt: "Hi", schedule: { kind: "daily", hour: 8, minute: 0 }, space });
  let skill = (await core.skills()).find(s => s.builtin);
  core.setSkillSpace(skill, space);
  return { word, memory: memory.id, thread: thread.id, artifact: artifact.id, url, task: task.id, skill: skill.name };
}
// The Space each of it is in now, "gone" once deleted (the page: "kept").
async function whereData(d) {
  let memory = (await core.listMemories()).find(m => m.id == d.memory);
  let thread = await core.store.getThread(d.thread);
  let artifact = await core.getArtifact(d.artifact);
  let page = await core.store.getPage(d.url);
  let task = await OrbitoTasks.get(d.task);
  let skill = (await core.skills()).find(s => s.name == d.skill);
  return JSON.stringify({
    memory: memory ? memory.space_id : "gone",
    thread: thread ? thread.space_id : "gone",
    artifact: artifact ? artifact.space_id : "gone",
    page: page ? "kept" : "gone",
    task: task ? task.space_id : "gone",
    skill: skill.space,
  });
}
function dataIn(space) {
  return JSON.stringify({ memory: space, thread: space, artifact: space, page: "kept", task: space, skill: space });
}
// Whether a Space sees the page read there.
async function pageSeenIn(d, space) {
  return (await core.store.searchPages(`${d.word}zz`, { space })).some(p => p.url == d.url);
}
async function clearData(d) {
  await core.deleteMemory(d.memory).catch(() => {});
  await core.store.deleteThread(d.thread);
  await core.store.deleteArtifact(d.artifact);
  await core.store.deletePage(d.url);
  await OrbitoTasks.remove(d.task);
  Services.prefs.clearUserPref("orbito.assistant.skills.spaces");
}
"""


@test
def deleting_a_space_from_the_sidebar_moves_its_data_and_can_be_undone(b):
    b.js(SPACE_DATA + """
    await resetSpaces();
    await onlyBlankTab();
    let first = spaces().current;
    await openPage("Stays in the first");
    let second = (await newSpace()).id;
    let doomed = await openPage("Doomed tab");
    win.spaceTest = { first, second, doomed, data: await spaceData(second, "Moving") };
    // The dot's menu asks first: where the rest goes, the first Space by
    // default, or deleted with it.
    await spaceMenu(await dotFor(second), "remove");
    let dialog = await wait(() => shown(switcher().removeDialog) && switcher().removeDialog, "the dialog");
    check(dialog.getAttribute("role") == "dialog", "not a dialog");
    check(await named(dialog) == `Delete “${spaces().currentSpace.name}”?`, `the dialog's name: ${accessibleName(dialog)}`);
    // The new Space's first tab and the one opened since.
    check(dialog.textContent.includes("Its 2 tabs close."), `the dialog: ${dialog.textContent.trim()}`);
    let choice = dialog.querySelector("select");
    await wait(() => deepActive() == choice, "focus on the choice");
    check([...choice.options].map(o => o.value).join() == `${first},`, [...choice.options].map(o => o.value).join());
    check(choice.value == first, "moving is not the default");
    check(await named(choice) == "Dock, Threads, memories, skills, documents and scheduled tasks", `the choice: ${accessibleName(choice)}`);
    for (let button of dialog.querySelectorAll("button")) {
      check(await named(button), "a button without a name");
    }
    """)
    try:
        # Escape takes it back, with nothing changed.
        b.keys(Keys.ESCAPE)
        b.js("""
        let { second, doomed, data } = win.spaceTest;
        await wait(() => !shown(switcher().removeDialog), "the dialog to close");
        check(spaces().list.length == 2 && !doomed.hidden, "Escape deleted");
        await spaceMenu(await dotFor(second), "remove");
        await wait(() => shown(switcher().removeDialog), "the dialog");
        """)
        b.keys(Keys.TAB, Keys.TAB)
        b.js("""
        let confirm = switcher().removeDialog.querySelector(".remove-confirm");
        await wait(() => deepActive() == confirm, "Tab to Delete");
        check(confirm.matches(":focus-visible"), "Delete shows no focus");
        """)
        b.keys(Keys.ENTER)
        b.js(SPACE_DATA + """
        let { first, second, doomed, data } = win.spaceTest;
        // It goes at once; its tabs are hidden until the undo time is up.
        await wait(() => spaces().list.length == 1 && spaces().current == first, "the Space to go");
        check(win.gBrowser.tabs.includes(doomed) && doomed.hidden, "the tab closed at once");
        await switcher().updateComplete;
        check(shown(switcher().note) && switcher().note.textContent.includes("Deleted"), switcher().note.textContent);
        await wait(() => deepActive() == switcher().undoButton, "focus on Undo");
        await listMatchesGBrowser();
        // The last Space shown cannot be deleted.
        let title = doc.getElementById("orbito-space-title");
        check((await spaceMenu(title.renderRoot.querySelector(".title"))).includes("remove:disabled"), "the last Space can be deleted");
        check(await whereData(data) == dataIn(second), await whereData(data));
        // Undo: the Space is back, shown again, with its tab and data.
        switcher().undoButton.click();
        await wait(() => spaces().list.length == 2, "the Space to come back");
        await wait(() => spaces().current == second && win.gBrowser.selectedTab == doomed && !doomed.hidden, "the Space shown again");
        await listMatchesGBrowser();
        await sleep(5300);
        check(spaces().list.length == 2 && OrbitoShellStore.get("spaces").some(s => s.id == second), "removed after its undo");
        check(await whereData(data) == dataIn(second), await whereData(data));

        // Deleted again and left: once the time is up its tabs close and
        // the rest is the first Space's, its Dock after the first Space's
        // but for a URL already there.
        let stays = { id: "dock-stays", url: pageURL("Stays in the first"), title: "Stays in the first", icon: "" };
        OrbitoShellStore.set("docks", {
          [first]: [stays],
          [second]: [
            { id: "dock-moving", url: pageURL("Moving dock"), title: "Moving dock", icon: "" },
            { id: "dock-same", url: stays.url, title: "Same as the first's", icon: "" },
          ],
        });
        await docksMatch();
        await spaceMenu(await dotFor(second), "remove");
        let dialog = await wait(() => shown(switcher().removeDialog) && switcher().removeDialog, "the dialog");
        dialog.querySelector(".remove-confirm").click();
        await wait(() => spaces().list.length == 1, "the Space to go");
        await sleep(5300);
        await wait(() => !win.gBrowser.tabs.includes(doomed), "its tab to close");
        check(!OrbitoShellStore.get("spaces").some(s => s.id == second), "the Space is still stored");
        await wait(async () => (await whereData(data)) == dataIn(first), "the data to move");
        check(await pageSeenIn(data, first), "the first Space does not see the page");
        check(storedDock(first).map(e => e.id).join() == "dock-stays,dock-moving", JSON.stringify(storedDocks()));
        check(Object.keys(storedDocks()).join() == first, JSON.stringify(storedDocks()));
        await docksMatch();
        check(dockLabels() == "Stays in the first,Moving dock", dockLabels());
        await switcher().updateComplete;
        check(!shown(switcher().note) && !core.removingSpaces().length, "the note stayed");
        await listMatchesGBrowser();
        """)
    finally:
        b.js(SPACE_DATA + """
        await clearData(win.spaceTest.data);
        delete win.spaceTest;
        await resetDocks();
        await resetSpaces();
        """)


@test
def deleting_a_space_from_the_settings_deletes_its_data_with_it(b):
    b.js(SPACE_DATA + """
    await resetSpaces();
    await onlyBlankTab();
    let first = spaces().current;
    let second = (await newSpace()).id;
    let doomed = await openPage("Doomed with its data");
    let data = await spaceData(second, "Deleting");
    OrbitoShellStore.set("docks", {
      [second]: [{ id: "dock-deleting", url: pageURL("Deleting dock"), title: "Deleting dock", icon: "" }],
    });
    let everywhere = await core.addMemory({ text: "Every Space memory", space: null });
    try {
      spaces().switchTo(first);
      let page = await openOrbitoSettings();
      let card = () => page.querySelector(`.space[data-space="${second}"]`);
      // The card lists the memories and skills kept for that Space only.
      await wait(() => card()?.querySelector(".space-memories li"), "the Space's memories");
      check(card().querySelector(".space-memories").textContent.includes("Deleting memory"), card().querySelector(".space-memories").textContent);
      check(!card().querySelector(".space-memories").textContent.includes("Every Space memory"), "a memory of all Spaces is listed");
      check(card().querySelector(".space-skills").textContent.includes(`/${data.skill}`), card().querySelector(".space-skills").textContent);
      // The memory list has a Space menu, as the skills' do.
      let memorySpace = () => page.querySelector(`.memory[data-id="${everywhere.id}"] select.memory-space`);
      await wait(memorySpace, "the memory's Space");
      check(memorySpace().value == "" && [...memorySpace().options].map(o => o.value).join() == `,${first},${second}`,
        [...memorySpace().options].map(o => o.value).join());
      check(page.querySelector(`.memory[data-id="${data.memory}"] select.memory-space`).value == second, "the memory's Space is not picked");
      memorySpace().value = first;
      memorySpace().dispatchEvent(new page.defaultView.Event("change"));
      await wait(async () => (await core.listMemories()).find(m => m.id == everywhere.id).space_id == first, "the memory to move");

      // Deleting asks first, here too, then deletes the rest with it.
      card().querySelector("button.space-remove").click();
      let choice = await wait(() => card()?.querySelector("select.space-remove-data"), "the confirmation");
      check(card().querySelector("button.space-remove-confirm"), "no confirmation");
      check(choice.value == first, choice.value);
      choice.value = "";
      card().querySelector("button.space-remove-confirm").click();
      await wait(() => card()?.querySelector("button.space-undo"), "the undo");
      check(spaces().list.length == 1 && doomed.hidden, "the Space did not go");
      check(page.querySelector(`.space[data-space="${first}"] button.space-remove`).disabled, "the last Space can be deleted");
      await sleep(5300);
      await wait(() => !card(), "the card to go");
      await wait(() => !win.gBrowser.tabs.includes(doomed), "its tab to close");
      await wait(async () => JSON.parse(await whereData(data)).thread == "gone", "the data to go");
      check(await whereData(data) == JSON.stringify({ memory: "gone", thread: "gone", artifact: "gone", page: "gone", task: "gone", skill: null }), await whereData(data));
      check((await core.listMemories()).some(m => m.id == everywhere.id), "another Space's memory went");
      // Its Dock goes too.
      check(JSON.stringify(storedDocks()) == "{}", JSON.stringify(storedDocks()));
      await docksMatch();
    } finally {
      await core.deleteMemory(everywhere.id);
      await clearData(data);
      await resetDocks();
      await resetSpaces();
    }
    """)


@test
def a_tab_group_is_in_one_space_and_moves_with_its_tabs(b):
    b.js("""
    await resetSpaces();
    await onlyBlankTab();
    let first = spaces().current;
    let a = await openPage("Grouped A");
    let c = await openPage("Grouped C");
    let group = win.gBrowser.addTabGroup([a, c], { label: "Grouped" });
    let stay = await openPage("Not grouped");
    let second = (await newSpace()).id;
    let other = await openPage("Other Space tab");
    let rest = await openPage("Other Space rest");
    try {
      // A tab of another Space put in the group goes to the group's Space.
      group.addTabs([other]);
      await wait(() => spaceOfTab(other) == first, "the tab to join the group's Space");
      check(spaces().current == second && other.hidden && !rest.hidden, "the window followed a tab that is not selected");
      // The tab menu moves a tab, or for one in a group the whole group.
      spaces().switchTo(first);
      win.gBrowser.selectedTab = stay;
      await rows();
      check((await tabMenu(rowFor(stay))).includes("orbito-tab-menu-space"), "no Space item");
      let item = shell.pins.menu.querySelector("#orbito-tab-menu-space");
      check(item.getAttribute("label") == "Move to Space", item.getAttribute("label"));
      check([...item.querySelectorAll("menuitem")].map(i => i.value).join() == second, "it offers the Space shown");
      await tabMenu(rowFor(a));
      check(item.getAttribute("label") == "Move group to Space", item.getAttribute("label"));
      item.querySelector(`menuitem[value="${second}"]`).doCommand();
      await wait(() => [a, c, other].every(t => spaceOfTab(t) == second && t.hidden), "the group to move");
      check(a.group == group && c.group == group && other.group == group, "a tab left the group");
      check(spaces().current == first && win.gBrowser.selectedTab == stay && spaceOfTab(stay) == first, "the window changed");
      await listMatchesGBrowser();
      spaces().switchTo(second);
      await wait(() => [a, c, other].every(t => !t.hidden), "the group in the second Space");
      await listMatchesGBrowser();
      check(headerFor(group), "no header for the group");
    } finally {
      await resetSpaces();
    }
    """)


@test
def a_private_window_uses_the_spaces_but_keeps_nothing(b):
    b.js("""
    await resetSpaces();
    await onlyBlankTab();
    await newSpace();
    useFakeBackend();
    let pw = win.OpenBrowserWindow({ private: true });
    try {
      await wait(() => pw.gBrowserInit?.delayedStartupFinished && pw.OrbitoShell?.spaces, "the private window");
      check(JSON.stringify(pw.OrbitoShell.spaces.list) == JSON.stringify(spaces().list), "other Spaces");
      await openPage("Private question page", pw);
      let offered;
      fake.run = async ({ tools, emit }) => {
        offered = tools.map(tool => tool.name);
        emit({ type: "text", text: "A private answer." });
      };
      let panel = await openAssistant(pw);
      let id = core.newThread(pw);
      panel.submit("A private question");
      await wait(async () => (await core.getMessages(id)).length == 2 && !core.isRunning(id), "the answer");
      // No memory, no document, no scheduled task.
      check(offered && !offered.includes("create_artifact") && !offered.includes("remember"), JSON.stringify(offered));
      await panel.updateComplete;
      let buttons = [...panel.log.querySelectorAll("button")].map(b => b.textContent.trim());
      check(!buttons.includes("Open as document") && !buttons.includes("Schedule this question"), JSON.stringify(buttons));
      let reply = (await core.getMessages(id))[1];
      let refused = await core.openReplyAsArtifact(id, reply.id).then(() => "", e => e.message);
      check(refused, "a document was made");
      // The Thread is kept in memory and listed in the private window only.
      check(!(await core.store.getThread(id)), "the Thread was saved");
      check((await core.threadList(pw)).some(t => t.id == id), "not in the private window's list");
      check(!(await core.threadList(win)).some(t => t.id == id), "in a normal window's list");
    } finally {
      await new Promise(resolve => {
        pw.addEventListener("unload", resolve, { once: true });
        pw.close();
      });
      dropFakeBackend();
      await resetSpaces();
    }
    """)


@test
def two_windows_show_different_spaces(b):
    b.js("""
    await resetSpaces();
    await onlyBlankTab();
    await openPage("Window one");
    let second = await newSpace();
    let first = spaces().list[0].id;
    spaces().switchTo(first);
    let other = win.OpenBrowserWindow();
    try {
      await wait(() => other.gBrowserInit?.delayedStartupFinished && other.OrbitoShell?.spaces, "the new window");
      // The list is the profile's; the Space shown is the window's.
      check(JSON.stringify(spaces(other).list) == JSON.stringify(spaces().list), "the windows have different lists");
      spaces(other).switchTo(second.id);
      check(spaces(other).current == second.id && spaces().current == first, "one window switched the other");
      let tab = await openPage("Window two", other);
      check(spaceOfTab(tab) == second.id && !tab.hidden, "the other window's new tab is not in its Space");
      await listMatchesGBrowser(other);
      await listMatchesGBrowser();
      // A Space made in one window shows in the other's switcher.
      let third = await newSpace(other);
      await wait(async () => await dotFor(third.id), "the new Space in the first window");
      check(spaces().current == first, "the first window switched");
    } finally {
      await new Promise(resolve => {
        other.addEventListener("unload", resolve, { once: true });
        other.close();
      });
      await resetSpaces();
    }
    """)


@test
def reduced_motion_switches_without_sliding(b):
    b.js("""
    await resetSpaces();
    await onlyBlankTab();
    let [first, second] = [spaces().current, (await newSpace()).id];
    let body = shell.sidebar.spaceBody;
    try {
      spaces().switchTo(first);
      check(body.getAnimations().length, "the Space body did not slide");
      Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
      await wait(() => win.matchMedia("(prefers-reduced-motion: reduce)").matches, "reduced motion");
      await wait(() => !body.getAnimations().length, "the slide to end");
      spaces().switchTo(second);
      await shell.sidebar.updateComplete;
      check(!body.getAnimations().length, "the Space body slid with reduced motion");
      check(!(await dotFor(second)).getAnimations({ subtree: true }).length, "the dots move with reduced motion");
    } finally {
      await resetSpaces();
    }
    """)


@test
def reduced_motion_stills_the_whole_shell(b):
    b.js("""
    await resetSidebar();
    await onlyBlankTab();
    let durations = el => win.getComputedStyle(el).transitionDuration.split(", ");
    try {
      Services.prefs.setBoolPref("orbito.sidebar.collapsed", true);
      await wait(() => shell.sidebar.collapsed, "the Sidebar to collapse");
      check(durations(shell.sidebar).some(d => d != "0s"), "the collapsed Sidebar does not slide");
      Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
      await wait(() => win.matchMedia("(prefers-reduced-motion: reduce)").matches, "reduced motion");
      // The collapsed Sidebar comes and goes at once (orbito.css moves it;
      // the rule is in its shadow tree).
      await wait(() => durations(shell.sidebar).every(d => d == "0s"), `the collapsed Sidebar slides: ${durations(shell.sidebar)}`);
      shell.sidebar.peeking = true;
      await shell.sidebar.updateComplete;
      check(shell.sidebar.getBoundingClientRect().left >= 8, "the Sidebar did not come in at once");
      check(!shell.sidebar.getAnimations().length, "the Sidebar moves");
      shell.sidebar.peeking = false;
      await shell.sidebar.updateComplete;
      check(!shell.sidebar.checkVisibility({ visibilityProperty: true }), "the Sidebar did not go at once");
      // Inside the components' shadow trees too: the bypass chip does not
      // pop, Reload's icon does not turn.
      core.setPermissionMode(win, "bypass");
      await assistant.updateComplete;
      let chip = win.getComputedStyle(assistant.permissionButton);
      check(chip.animationName == "none" && chip.transitionDuration == "0s", `the chip moves: ${chip.animationName} ${chip.transitionDuration}`);
      let bar = shell.topBar;
      await openPage("Still");
      await wait(() => bar.reloadButton.getAttribute("aria-disabled") == "false", "Reload to come on");
      bar.reloadButton.click();
      await bar.updateComplete;
      check(!bar.reloadButton.hasAttribute("spin"), "Reload's icon turns");
      check(win.getComputedStyle(bar.reloadButton.querySelector("svg")).animationName == "none", "Reload's icon moves");
    } finally {
      core.setPermissionMode(win, "ask");
      Services.prefs.clearUserPref("ui.prefersReducedMotion");
      await resetSidebar();
    }
    """)


@test
def controls_and_menus_change_state_in_the_short_motion(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Controls");
    await resetAssistant();
    let fades = (el, ...properties) => {
      let style = el.ownerDocument.defaultView.getComputedStyle(el);
      let names = style.transitionProperty.split(", ");
      let lengths = style.transitionDuration.split(", ");
      return properties.every(p => names.includes(p) && lengths[names.indexOf(p) % lengths.length] == motionSeconds("short"));
    };
    // Buttons, under the pointer and pressed, in the components' shadow
    // trees.
    let bar = shell.topBar;
    check(fades(bar.reloadButton, "background-color", "color"), win.getComputedStyle(bar.reloadButton).transitionProperty);
    await openPage("Controls two");
    let close = rowFor(win.gBrowser.selectedTab).querySelector(".close");
    check(fades(close, "opacity", "background-color"), "the close button does not fade");
    // Menus pop in and fade out; their items change in the short motion.
    await openAssistant();
    try {
      assistant.sessionButton.click();
      await assistant.updateComplete;
      let menu = assistant.sessionMenu;
      let opening = menu.getAnimations().map(a => a.transitionProperty);
      check(opening.includes("opacity") && opening.includes("transform"), `the menu opens with ${opening}`);
      let item = menu.querySelector('[role^="menuitem"]');
      check(fades(item, "background-color"), win.getComputedStyle(item).transitionProperty);
      await Promise.all(menu.getAnimations().map(a => a.finished));
      assistant.log.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true, composed: true }));
      await assistant.updateComplete;
      let visible = () => menu.checkVisibility({ visibilityProperty: true });
      check(menu.hidden && visible(), "the menu goes at once");
      check(win.getComputedStyle(menu).pointerEvents == "none", "the fading menu takes the pointer");
      await wait(() => !visible(), "the menu to fade out");
      // Without motion, at once.
      Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
      await wait(() => win.matchMedia("(prefers-reduced-motion: reduce)").matches, "reduced motion");
      assistant.sessionButton.click();
      await assistant.updateComplete;
      check(!menu.getAnimations().length && win.getComputedStyle(item).transitionDuration == "0s", "the menu moves with reduced motion");
      assistant.closeMenu();
      await assistant.updateComplete;
      check(!visible(), "the menu fades with reduced motion");
    } finally {
      Services.prefs.clearUserPref("ui.prefersReducedMotion");
      await resetAssistant();
    }
    // The settings page's controls move to the same rhythm.
    let page = await openOrbitoSettings();
    let segment = page.querySelector("#theme [role=radio]");
    check(fades(segment, "background-color", "color"), page.defaultView.getComputedStyle(segment).transitionProperty);
    check(fades(page.querySelector("#sidebar-collapsed"), "background-color"), "the checkboxes do not change in the short motion");
    """)


@test
def the_shell_moves_to_its_motion_tokens(b):
    b.js("""
    await resetSpaces();
    await resetSidebar();
    await onlyBlankTab();
    // Short, medium and long, on the window and on Orbito's pages.
    let [short, medium, long] = ["short", "medium", "long"].map(motionMs);
    check(short > 0 && short < medium && medium < long, `${short} ${medium} ${long}`);
    let timing = animation => animation.effect.getComputedTiming().duration;
    // A Space switch slides for the long one.
    let [first, second] = [spaces().current, (await newSpace()).id];
    let body = shell.sidebar.spaceBody;
    try {
      spaces().switchTo(first);
      let slide = await wait(() => body.getAnimations()[0], "the Space to slide", 2000).catch(() => null);
      check(slide && timing(slide) == long, `the Space slides for ${slide && timing(slide)}`);
    } finally {
      await resetSpaces();
    }
    // The collapsed Sidebar slides for the long one too.
    try {
      Services.prefs.setBoolPref("orbito.sidebar.collapsed", true);
      await wait(() => shell.sidebar.collapsed, "the Sidebar to collapse");
      let style = win.getComputedStyle(shell.sidebar);
      check(style.transitionDuration.split(", ")[0] == motionSeconds("long"), style.transitionDuration);
    } finally {
      await resetSidebar();
    }
    // The Assistant panel opens for the long one, and closes for the medium.
    let motion = () => assistant.getAnimations().find(a => !a.animationName && !a.transitionProperty);
    win.OrbitoAssistant.toggle(true);
    check(timing(motion()) == long, `the panel opens for ${timing(motion())}`);
    await wait(() => !assistant.hasAttribute("motion"), "the panel's motion");
    win.OrbitoAssistant.toggle(false);
    check(timing(motion()) == medium, `the panel closes for ${timing(motion())}`);
    await wait(() => assistant.hidden, "the panel's motion");
    """)


@test
def the_panel_keeps_its_thread_across_tabs_and_each_space_has_its_own(b):
    try:
        b.js("""
        await resetSpaces();
        await onlyBlankTab();
        useFakeBackend();
        let first = spaces().current;
        let answer = text => async ({ emit }) => emit({ type: "text", text });
        let home = await openPage("Thread home");
        let id = await askFake("In the first Space", answer("First answer"));
        await finishedRun(id);
        await wait(() => assistant.log.textContent.includes("First answer"), "the answer");
        // Another tab of the Space, new or selected again: the same Thread.
        let away = await openPage("Thread away");
        await assistant.updateComplete;
        check(core.threadFor(win) == id && assistant.threadId == id, "a new tab shows another Thread");
        win.gBrowser.selectedTab = home;
        await assistant.updateComplete;
        check(assistant.threadId == id && assistant.log.textContent.includes("First answer"), "the panel lost the Thread");
        win.gBrowser.selectedTab = away;

        // Another Space shows a Thread of its own.
        let second = await newSpace();
        await wait(() => assistant.threadId && assistant.threadId != id, "the second Space's Thread");
        await assistant.updateComplete;
        check(!assistant.messages.length && !assistant.log.textContent.includes("First answer"), "the new Space's Thread is not new");
        fake.run = answer("Second answer");
        let id2 = assistant.threadId;
        assistant.submit("In the second Space");
        await wait(() => core.isRunning(id2), "the second question");
        await finishedRun(id2);
        await wait(() => assistant.log.textContent.includes("Second answer"), "the second answer");

        // Back to the first Space: its Thread again; and on to the second.
        (await dotFor(first)).click();
        await wait(() => assistant.threadId == id && assistant.log.textContent.includes("First answer"), "the first Space's Thread");
        check(win.gBrowser.selectedTab == away, "another tab of the first Space");
        spaces().switchTo(second.id);
        await wait(() => assistant.threadId == id2 && assistant.log.textContent.includes("Second answer"), "the second Space's Thread again");

        // Each Thread is kept with its Space, and the window remembers which
        // it shows in each.
        check((await core.store.getThread(id)).space_id == first, "the first Thread's Space");
        check((await core.store.getThread(id2)).space_id == second.id, "the second Thread's Space");
        let shownBy = JSON.parse(SessionStore.getCustomWindowValue(win, "orbito-threads"));
        check(shownBy[first] == id && shownBy[second.id] == id2, JSON.stringify(shownBy));
        """)
    finally:
        b.js("dropFakeBackend(); await resetAssistant(); await resetSpaces(); await onlyBlankTab();")


@test
def two_windows_show_threads_of_a_space_on_their_own_or_the_same_one_alike(b):
    try:
        b.js("""
        await resetSpaces();
        await onlyBlankTab();
        useFakeBackend();
        await openPage("Thread window one");
        let gate = Promise.withResolvers();
        let id = await askFake("Shared question", async ({ callTool, emit }) => {
          emit({ type: "text", text: "Before the tab." });
          await gate.promise;
          await callTool("open_tab", { url: pageURL("Shared result") });
          emit({ type: "text", text: " After the tab." });
        });
        let other = win.OpenBrowserWindow();
        try {
          await wait(() => other.gBrowserInit?.delayedStartupFinished && other.OrbitoShell?.spaces, "the other window");
          check(spaces(other).current == spaces().current, "the windows show different Spaces");
          // Its own Thread of the same Space.
          let panel = await openAssistant(other);
          await wait(() => panel.threadId, "the other window's Thread");
          check(panel.threadId != id && core.threadFor(other) != id, "the other window took the Thread");
          check(!panel.log.textContent.includes("Before the tab."), "the other window shows the question");

          // Opened there too, it shows the same, as it streams.
          await core.openThread(other, id);
          await wait(() => panel.threadId == id && panel.log.textContent.includes("Before the tab."), "the Thread in the other window");
          check(assistant.threadId == id, "the first window lost the Thread");
          gate.resolve();
          // The approval shows in both, and either may answer it.
          let allow = await wait(() => panel.log.querySelector(".approval .primary"), "the approval in the other window");
          await wait(() => assistant.log.querySelector(".approval .primary"), "the approval in the asking window");
          allow.click();
          await finishedRun(id);
          for (let shown of [assistant, panel]) {
            await wait(() => shown.log.textContent.includes("After the tab.") && !shown.log.querySelector(".approval .primary"), "the end in both windows");
          }
        } finally {
          other.close();
        }
        """)
    finally:
        b.js("await resetOrbits(); await onlyBlankTab();")


@test
def a_new_thread_leaves_the_one_working_going(b):
    try:
        b.js("""
        await resetSpaces();
        await onlyBlankTab();
        useFakeBackend();
        await openPage("Thread busy");
        let gate = Promise.withResolvers();
        let id = await askFake("Keep working", async ({ emit }) => {
          emit({ type: "text", text: "Started." });
          await gate.promise;
          emit({ type: "text", text: " Finished behind." });
        });
        await wait(() => assistant.log.textContent.includes("Started."), "the start");
        assistant.sessionButton.click();
        await assistant.updateComplete;
        menuItem(assistant.sessionMenu, "New Thread").click();
        await wait(() => assistant.threadId != id && !assistant.messages.length, "a new Thread");
        check(core.threadFor(win) == assistant.threadId, "the window shows another Thread");
        check(core.isRunning(id), "the Thread working stopped");
        // A new Thread nothing was asked in yet stays the one shown.
        let fresh = assistant.threadId;
        check(core.newThread(win) == fresh, "another Thread for an empty one");
        gate.resolve();
        await finishedRun(id);
        let messages = await core.getMessages(id);
        let text = messages.at(-1).parts.filter(p => p.type == "text").map(p => p.text).join("");
        check(text == "Started. Finished behind." && !core.notices(messages.at(-1).id).length, text);
        check(assistant.threadId == fresh && !assistant.log.textContent.includes("Finished behind."), "the panel went back to the old Thread");
        """)
    finally:
        b.js("dropFakeBackend(); await resetAssistant(); await onlyBlankTab();")


@test
def the_thread_list_shows_threads_newest_first_with_what_they_are_doing(b):
    try:
        b.js("""
        await resetSpaces();
        await onlyBlankTab();
        useFakeBackend();
        await openPage("Thread list");
        let first = spaces().current;
        let done = await askFake("Finished question", async ({ emit }) => emit({ type: "text", text: "Done." }));
        await finishedRun(done);
        // One works on, until it waits for an approval.
        let gate = Promise.withResolvers();
        let busy = await askFake("Working question", async ({ callTool, emit }) => {
          emit({ type: "text", text: "Working." });
          await gate.promise;
          await callTool("open_tab", { url: pageURL("Thread list result") });
        });
        // A scheduled task's Thread, of no Space, an hour old.
        let hourAgo = Date.now() - 3600000;
        await core.store.saveThread({ id: "thread-list-scheduled", space_id: null, title: "Scheduled summary", created_at: hourAgo, updated_at: hourAgo });
        await core.store.saveTaskRun({ id: "thread-list-run", task_id: "thread-list-task", started_at: hourAgo, finished_at: hourAgo, status: "done", thread_id: "thread-list-scheduled", artifact_id: null, input_tokens: null, output_tokens: null, error: null });
        // The panel shows a new Thread; the button says another works.
        let fresh = core.newThread(win);
        await wait(() => assistant.threadId == fresh, "the new Thread");
        let button = assistant.threadsButton;
        await wait(() => button.dataset.activity == "running", "the button's dot");
        check(await named(button) == "Thread list, another Thread is working", accessibleName(button));
        check(shown(button.querySelector(".dot")), "no dot on the button");

        // The list takes the Thread's place.
        button.click();
        await wait(() => assistant.view == "threads" && shown(assistant.threadsView), "the Thread list");
        check(!shown(assistant.input) && !shown(assistant.log) && !shown(assistant.heading), "the Thread is still shown");
        await wait(() => ["thread-list-scheduled", done, busy, fresh].every(id => threadRow(id)), `the Threads (${threadRowIds()})`);
        let rows = threadRows();
        check(rows[0].classList.contains("new") && await named(rows[0]) == "New Thread", accessibleName(rows[0]));
        // Newest first; the one shown is current.
        let ids = threadRowIds();
        let at = id => ids.indexOf(id);
        check(at(fresh) == 0 && at(fresh) < at(busy) && at(busy) < at(done) && at(done) < at("thread-list-scheduled"), ids.join());
        check(threadRow(fresh).getAttribute("aria-current") == "true" && !threadRow(done).hasAttribute("aria-current"), "the current Thread");
        check(threadRow(fresh).textContent.includes("New Thread") && threadRow(done).textContent.includes("Finished question"), threadRow(done).textContent);
        // Working: an accent dot; scheduled: a clock.
        check(threadRow(busy).dataset.state == "running", "the working Thread shows no state");
        await wait(() => accessibleName(threadRow(busy))?.includes("Working"), `Working in ${accessibleName(threadRow(busy))}`);
        check(!threadRow(done).dataset.state && !threadRow(done).querySelector(".state"), "a state on a finished Thread");
        check(threadRow("thread-list-scheduled").querySelector(".clock"), "no clock");
        await wait(() => accessibleName(threadRow("thread-list-scheduled"))?.includes("Scheduled task"), "the scheduled task's name");
        check(!threadRow(done).querySelector(".clock"), "a clock on an asked Thread");
        let running = win.getComputedStyle(threadRow(busy).querySelector(".state")).backgroundColor;

        // Waiting for an approval: amber, on the row and the button.
        gate.resolve();
        await wait(() => threadRow(busy)?.dataset.state == "waiting", "the waiting Thread");
        await wait(() => accessibleName(threadRow(busy))?.includes("Waiting for approval"), `Waiting in ${accessibleName(threadRow(busy))}`);
        check(win.getComputedStyle(threadRow(busy).querySelector(".state")).backgroundColor != running, "the same dot as working");
        // (Hidden behind the list, so not in the accessibility tree.)
        check(button.dataset.activity == "waiting" && button.getAttribute("aria-label") == "Thread list, another Thread is waiting for approval", button.getAttribute("aria-label"));

        // In another Space: its own Threads, and those of no Space. The
        // first Space's dot says a Thread there waits.
        let second = await newSpace();
        await wait(() => threadRow(assistant.threadId) && !threadRow(done) && !threadRow(busy), `the second Space's Threads (${threadRowIds()})`);
        check(threadRow("thread-list-scheduled"), "no Thread of no Space");
        let firstDot = await dotFor(first);
        await wait(() => firstDot.hasAttribute("alert"), "the waiting Space's dot");
        await wait(() => accessibleName(firstDot) == `${spaces().list[0].name}, waiting for approval`, `the dot's name (${accessibleName(firstDot)})`);
        check(!(await dotFor(second.id)).hasAttribute("alert"), "the Space shown is marked");
        // All Spaces: the first Space's too, with its name.
        check(scopeButton("This Space").getAttribute("aria-pressed") == "true", "This Space is not picked");
        scopeButton("All Spaces").click();
        await wait(() => threadRow(done) && threadRow(busy), "every Space's Threads");
        check(scopeButton("All Spaces").getAttribute("aria-pressed") == "true", "All Spaces is not picked");
        check(threadRow(done).textContent.includes(spaces().list[0].name), threadRow(done).textContent);
        // A Thread of another Space opens there.
        threadRow(done).click();
        await wait(() => spaces().current == first && assistant.threadId == done && assistant.view == "chat", "the first Space's Thread");
        await wait(() => assistant.log.textContent.includes("Done."), "its answer");
        check(shown(assistant.input), "no input");
        await wait(() => !firstDot.hasAttribute("alert"), "the Space shown is marked");
        core.stop(busy);
        await finishedRun(busy);
        await wait(() => !button.dataset.activity && !button.querySelector(".dot"), "the button's dot to go");

        // The back button goes back to the Thread, as Escape does.
        button.click();
        await wait(() => assistant.view == "threads", "the Thread list again");
        assistant.backButton.click();
        await wait(() => assistant.view == "chat" && shown(assistant.input), "back to the Thread");
        // New Thread in the list shows a new one.
        button.click();
        await wait(() => assistant.view == "threads", "the Thread list once more");
        threadRows()[0].click();
        await wait(() => assistant.view == "chat" && assistant.threadId != done && !assistant.messages.length, "a new Thread");
        """)
    finally:
        b.js("""
        for (let id of core._runs.keys()) {
          core.stop(id);
          await finishedRun(id);
        }
        await core.store.deleteThread("thread-list-scheduled");
        await core.store.deleteTask("thread-list-task");
        await resetOrbits();
        await resetSpaces();
        await onlyBlankTab();
        """)


@test
def the_thread_list_follows_the_keyboard_rules(b):
    b.js("""
    await resetSpaces();
    await onlyBlankTab();
    useFakeBackend();
    await openPage("Thread list keys");
    for (let prompt of ["Keys one", "Keys two"]) {
      await finishedRun(await askFake(prompt, async ({ emit }) => emit({ type: "text", text: "Fine." })));
    }
    let current = assistant.threadId;
    check(await named(assistant.threadsButton) == "Thread list", accessibleName(assistant.threadsButton));
    assistant.threadsButton.focus({ focusVisible: true });
    check(win.getComputedStyle(assistant.threadsButton).outlineStyle != "none", "no focus ring on the button");
    """)
    try:
        # Enter opens the list on the current Thread.
        b.keys(Keys.ENTER)
        b.js("""
        await wait(() => deepActive()?.dataset?.thread == assistant.threadId, `focus on the current Thread (${deepActive()?.outerHTML.slice(0, 80)})`);
        check(deepActive().matches(":focus-visible") && win.getComputedStyle(deepActive()).outlineStyle != "none", "the row shows no focus");
        // Every control has a name; the rows are one tab stop.
        let controls = [...assistant.threadsView.querySelectorAll("button")].filter(el => el.checkVisibility());
        for (let control of controls) {
          await named(control);
        }
        check(accessibleName(assistant.backButton) == "Back to the Thread", accessibleName(assistant.backButton));
        check(threadRows().filter(row => row.tabIndex == 0).length == 1, "the rows are not one tab stop");
        """)
        b.keys(Keys.ARROW_UP)
        b.js('await wait(() => deepActive() == threadRows()[0], "Up to New Thread");')
        b.keys(Keys.ARROW_DOWN, Keys.ARROW_DOWN)
        b.js('await wait(() => deepActive() == threadRows()[2], "Down to the Thread before");')
        b.keys(Keys.END)
        b.js('await wait(() => deepActive() == threadRows().at(-1), "End to the last row");')
        b.keys(Keys.HOME)
        b.js("""
        await wait(() => deepActive() == threadRows()[0], "Home to the first row");
        win.gBrowser.selectedBrowser.focus();
        await wait(() => shell.focusedRegion == "page", "the page to have focus");
        """)
        # F6 from the page comes back to the list's row.
        b.keys(Keys.F6)
        b.js("""
        await wait(() => deepActive() == threadRows()[0], `F6 to the list (${deepActive()?.outerHTML.slice(0, 80)})`);
        check(shell.focusedRegion == "assistant", shell.focusedRegion);
        """)
        # Escape goes back to the Thread, on the list's button.
        b.keys(Keys.ESCAPE)
        b.js("""
        await wait(() => assistant.view == "chat" && deepActive() == assistant.threadsButton, "Escape back to the Thread");
        check(win.OrbitoAssistant.isOpen, "Escape closed the panel");
        """)
    finally:
        b.js("dropFakeBackend(); await resetAssistant(); await onlyBlankTab();")


@test
def the_space_switcher_follows_the_keyboard_rules(b):
    b.js("""
    await resetSpaces();
    await onlyBlankTab();
    await newSpace();
    spaces().switchTo(spaces().list[0].id);
    await wait(() => {
      win.gBrowser.selectedBrowser.focus();
      return shell.focusedRegion == "page";
    }, "the page to have focus");
    let sw = switcher();
    await named(sw.renderRoot.querySelector("[role=tablist]"));
    check(accessibleName(sw.renderRoot.querySelector("[role=tablist]")) == "Spaces", "the switcher has another name");
    let names = [];
    for (let dot of sw.dots) {
      names.push(await named(dot));
    }
    check(JSON.stringify(names) == JSON.stringify(spaces().list.map(s => s.name)), `dots: ${names}`);
    check(await named(sw.addButton) == "New Space", accessibleName(sw.addButton));
    check([...sw.dots].filter(d => d.tabIndex == 0).length == 1, "the dots are not one tab stop");
    """)
    try:
        # F6 to the Sidebar (the tab list), Tab to the current dot.
        b.keys(Keys.F6)
        b.js('await wait(() => shell.focusedRegion == "sidebar", "the Sidebar");')
        b.keys(Keys.TAB)
        b.js("""
        await wait(() => deepActive()?.dataset?.space == spaces().current, "focus on the current dot");
        check(deepActive().matches(":focus-visible"), "the dot shows no focus");
        check(win.getComputedStyle(deepActive(), "::before").outlineStyle != "none", "no focus ring on the dot");
        """)
        b.keys(Keys.ARROW_RIGHT)
        b.js("""
        let second = spaces().list[1].id;
        await wait(() => deepActive()?.dataset?.space == second, "focus on the next dot");
        check(spaces().current == spaces().list[0].id, "moving switched the Space");
        """)
        b.keys(Keys.ENTER)
        b.js("""
        await wait(() => spaces().current == spaces().list[1].id, "Enter to switch");
        await switcher().updateComplete;
        check(deepActive()?.dataset?.space == spaces().current, `focus left the dot: ${deepActive()?.outerHTML.slice(0, 100)} ${shell.commandBar.isOpen}`);
        """)
        b.keys(Keys.HOME)
        b.js('await wait(() => deepActive()?.dataset?.space == spaces().list[0].id, "Home to the first dot");')
        b.keys(Keys.TAB)
        b.js("""
        await wait(() => deepActive() == switcher().addButton, "focus on the new Space button");
        check(deepActive().matches(":focus-visible"), "the button shows no focus");
        """)
        b.keys(Keys.ENTER)
        b.js("""
        await wait(() => spaces().list.length == 3, "Enter to make a Space");
        await switcher().updateComplete;
        """)
        b.keys(Keys.TAB)
        b.js('await wait(() => deepActive() == switcher().undoButton, "focus on Undo");')
        b.keys(Keys.ENTER)
        b.js("""
        await wait(() => spaces().list.length == 2, "Enter to undo");
        await wait(() => deepActive() == switcher().addButton, "focus back on the new Space button");
        check(shell.focusedRegion == "sidebar", shell.focusedRegion);
        """)
        b.keys(Keys.F6)
        b.js('await wait(() => shell.focusedRegion == "top-bar", "F6 to the Top bar");')
    finally:
        b.js("await resetSpaces();")


@test
def agent_tools_see_the_tabs_of_their_space(b):
    b.js("""
    await resetSpaces();
    await onlyBlankTab();
    let { OrbitoTools } = ChromeUtils.importESModule("chrome://browser/content/orbito/OrbitoTools.sys.mjs");
    let here = await openPage("Tool here");
    let first = spaces().current;
    await newSpace();
    let there = await openPage("Tool there");
    spaces().switchTo(first);
    let ctx = OrbitoTools.context({ tab: here });
    let listed = JSON.parse(OrbitoTools.get("list_tabs").run(ctx)).map(t => t.title);
    check(listed.includes("Tool here") && !listed.includes("Tool there"), `listed ${listed}`);
    // A tab opened for the thread goes in its tab's Space, even with
    // the window on another.
    spaces().switchTo(spaces().list[1].id);
    await OrbitoTools.get("open_tab").run(ctx, { url: pageURL("Tool opened") });
    let opened = win.gBrowser.tabs.at(-1);
    check(spaceOfTab(opened) == first && opened.hidden, `opened in ${spaceOfTab(opened)}`);
    check(spaces().current != first, "opening a tab switched the Space");
    // A scheduled task sees every tab, with its Space.
    let all = JSON.parse(OrbitoTools.get("list_tabs").run(OrbitoTools.context({})));
    let row = all.find(t => t.title == "Tool there");
    check(row?.space == spaces().list[1].name, JSON.stringify(row));
    // A scheduled task of a Space sees that Space's tabs and the pinned ones.
    let taskTabs = () => JSON.parse(OrbitoTools.get("list_tabs").run(OrbitoTools.context({ space: spaces().list[1].id }))).map(t => t.title);
    let mine = taskTabs();
    check(mine.includes("Tool there") && !mine.includes("Tool here"), `listed ${mine}`);
    win.gBrowser.pinTab(here);
    mine = taskTabs();
    check(mine.includes("Tool there") && mine.includes("Tool here"), `listed ${mine}`);
    win.gBrowser.unpinTab(here);
    await resetSpaces();
    """)


@test
def a_memory_of_another_space_is_neither_in_the_prompt_nor_recalled(b):
    b.js("""
    let clear = async () => {
      for (let memory of await core.listMemories()) {
        await core.deleteMemory(memory.id);
      }
    };
    await resetSpaces();
    await onlyBlankTab();
    useFakeBackend();
    await clear();
    try {
      let first = spaces().current;
      await core.addMemory({ text: "First Space tea fact", space: first });
      await openPage("Memories first");
      let second = (await newSpace()).id;
      await openPage("Memories second");

      // remember keeps a memory in the Thread's Space, or with all_spaces in
      // all of them.
      for (let input of [{ text: "Second Space tea fact" }, { text: "Every Space tea fact", all_spaces: true }]) {
        let result;
        let id = await askFake("Remember this", async ({ callTool }) => {
          let call = callTool("remember", input);
          (await wait(() => logButton("Allow"), "the approval")).click();
          result = await call;
        });
        await finishedRun(id);
        check(result.ok, JSON.stringify(result));
      }
      let saved = Object.fromEntries((await core.listMemories()).map(m => [m.text, m.space_id]));
      check(saved["Second Space tea fact"] == second && saved["Every Space tea fact"] === null, JSON.stringify(saved));

      // Back in the first Space, its own and all Spaces' memories are in the
      // prompt and recalled, never the second's.
      spaces().switchTo(first);
      await wait(() => spaces().current == first, "the first Space");
      let seen = {};
      let id = await askFake("What do you know about tea?", async ({ system, callTool }) => {
        seen.system = system;
        seen.recalled = await callTool("recall", { query: "tea" });
      });
      await finishedRun(id);
      check(seen.system.includes("- First Space tea fact") && seen.system.includes("- Every Space tea fact"), seen.system);
      check(!seen.system.includes("Second Space"), seen.system);
      let recalled = JSON.parse(seen.recalled.content).map(m => m.text).sort();
      check(JSON.stringify(recalled) == JSON.stringify(["Every Space tea fact", "First Space tea fact"]), seen.recalled.content);
      let used = (await core.getMessages(id)).at(-1).parts.find(p => p.type == "memories");
      check(used?.ids.length == 2, JSON.stringify(used));
    } finally {
      await clear();
      dropFakeBackend();
      await resetSpaces();
    }
    """)


@test
def a_skill_of_another_space_is_neither_in_the_slash_menu_nor_offered(b):
    b.js("""
    let folder = PathUtils.join(PathUtils.profileDir, "orbito-assistant", "skills");
    let type = text => {
      assistant.input.value = text;
      assistant.input.dispatchEvent(new win.InputEvent("input", { data: text.at(-1) }));
    };
    let menu = async () => {
      await sleep(200);
      return assistant.skillMenu.hidden ? [] : [...assistant.skillMenu.children].map(o => o.dataset.name);
    };
    let system = async () => {
      let seen = "";
      await finishedRun(await askFake("Hi", async options => {
        seen = options.system;
      }));
      return seen;
    };
    await resetSpaces();
    await onlyBlankTab();
    useFakeBackend();
    await IOUtils.makeDirectory(PathUtils.join(folder, "notes"));
    await IOUtils.writeUTF8(PathUtils.join(folder, "notes", "SKILL.md"), "---\\nname: notes\\ndescription: Take work notes.\\n---\\nNote it.");
    try {
      let first = spaces().current;
      let second = (await newSpace()).id;
      // A new skill is for all Spaces; its card keeps it for one.
      let page = await openOrbitoSettings();
      let select = await wait(() => page.querySelector('.skill[data-name="notes"] select.skill-space'), "the Space menu");
      check(select.value == "" && [...select.options].map(o => o.value).join() == `,${first},${second}`, [...select.options].map(o => o.value).join());
      select.value = second;
      select.dispatchEvent(new page.defaultView.Event("change"));
      check((await core.skills()).find(s => s.name == "notes").space == second, "notes is not kept for the second Space");

      await openPage("Skills second");
      await openAssistant();
      type("/no");
      check((await menu()).join() == "notes", "not in the menu of its Space");
      check((await system()).includes("- notes: Take work notes."), "not offered in its Space");

      spaces().switchTo(first);
      await wait(() => spaces().current == first, "the first Space");
      await openAssistant();
      type("/no");
      check(!(await menu()).length, "in the menu of another Space");
      type("/");
      check((await menu()).includes("번역"), "a built-in skill left the menu");
      check(!(await system()).includes("- notes:"), "offered in another Space");
      assistant.submit("/notes now");
      await wait(() => assistant.inputNotice.textContent.includes("/notes") && assistant.input.value == "/notes now", "the unknown skill notice");
      check(!core.isRunning(core.threadFor(win)), "another Space's skill was asked");
    } finally {
      type("");
      dropFakeBackend();
      await IOUtils.remove(folder, { recursive: true, ignoreAbsent: true });
      Services.prefs.clearUserPref("orbito.assistant.skills.userSpaces");
      await resetSpaces();
    }
    """)


@test
def a_page_read_in_another_space_is_found_there_first_or_with_all_spaces(b):
    try:
        b.js("""
        let word = `Spaced${Date.now()}`;
        win.testState = { word };
        let read = async title => {
          await openPage(title);
          await wait(async () => (await core.store.searchPages(title)).some(p => p.title == title), `${title} to be remembered`);
        };
        await resetSpaces();
        await onlyBlankTab();
        useFakeBackend();
        Services.prefs.setIntPref("orbito.recall.dwellSeconds", 1);
        let first = spaces().current;
        await read(`Firstread ${word}`);
        await newSpace();
        await read(`Secondread ${word}`);
        // Only this test's pages: others may be alike in meaning.
        let titles = found => found.map(p => p.title).filter(t => t.includes(word)).join();
        check(titles(await core.store.searchPages(word, { space: first })) == `Firstread ${word}`, "the visit's Space");

        // search_browsing searches the Thread's Space, or with all_spaces
        // every Space.
        let seen = {};
        let id = await askFake("What did I read?", async ({ callTool }) => {
          seen.here = await callTool("search_browsing", { query: word });
          seen.all = await callTool("search_browsing", { query: word, all_spaces: true });
        });
        await finishedRun(id);
        check(titles(JSON.parse(seen.here.content)) == `Secondread ${word}`, seen.here.content);
        check(titles(JSON.parse(seen.all.content).sort((a, b) => a.title.localeCompare(b.title))) == `Firstread ${word},Secondread ${word}`, seen.all.content);

        // Back in the first Space for the Command bar.
        spaces().switchTo(first);
        await wait(() => spaces().current == first, "the first Space");
        win.OrbitoAssistant.toggle(false);
        win.gBrowser.selectedBrowser.focus();
        const { OrbitoRecall } = ChromeUtils.importESModule(
          "chrome://browser/content/orbito/OrbitoRecall.sys.mjs"
        );
        let asked = [];
        let { suggest } = OrbitoRecall;
        OrbitoRecall.suggest = function (text, options) {
          asked.push([text, options]);
          return suggest.call(this, text, options);
        };
        Object.assign(win.testState, { first, asked, suggest });
        """)
        word = b.js("return win.testState.word;")
        b.keys((ACCEL, "l"))
        b.js('await wait(() => commandBarShown(), "the Command bar");')
        b.keys(*word)
        b.js("""
        // "From memory" searches the window's Space first.
        let { word, first, asked } = win.testState;
        let found = await resultWhere(r => r.result.providerName == "OrbitoRecall", "a page from memory");
        check(found.result.payload.title == `Firstread ${word}`, found.result.payload.title);
        check(asked.some(([text, options]) => text == word && options.space == first), JSON.stringify(asked));
        """)
    finally:
        b.js("""
        const { OrbitoRecall } = ChromeUtils.importESModule(
          "chrome://browser/content/orbito/OrbitoRecall.sys.mjs"
        );
        closeCommandBar();
        if (win.testState?.suggest) {
          OrbitoRecall.suggest = win.testState.suggest;
        }
        Services.prefs.clearUserPref("orbito.recall.dwellSeconds");
        let word = win.testState?.word;
        for (let name of word ? ["Firstread", "Secondread"] : []) {
          await OrbitoRecall.forget(pageURL(`${name} ${word}`));
        }
        delete win.testState;
        dropFakeBackend();
        await resetSpaces();
        """)


@test
def a_document_is_in_its_threads_space_and_the_panel_lists_the_threads_documents(b):
    try:
        b.js("""
        await resetSpaces();
        await resetOrbits();
        await onlyBlankTab();
        useFakeBackend();
        let first = spaces().current;
        await openPage("Documents asker");
        let made = [];
        let id = await askFake("Write two documents", async ({ callTool, emit }) => {
          for (let title of ["Panel doc one", "Panel doc two"]) {
            let result = await callTool("create_artifact", { title, content: `${title}: otterword notes.` });
            made.push(result.content.match(/document (\\S+) /)[1]);
            // The second one changes later than the first.
            await sleep(5);
          }
          emit({ type: "text", text: "Written." });
        });
        await finishedRun(id);
        check(made.length == 2, "the documents were not made");
        // Both in the Thread's Space.
        for (let docId of made) {
          check((await core.getArtifact(docId)).space_id == first, `${docId} is not in the Space`);
        }

        // The header's button says how many the Thread made.
        let button = await wait(() => shown(assistant.documentsButton) && assistant.documentsButton, "the documents button");
        await wait(() => button.textContent.trim() == "2", `the count (${button.textContent})`);
        check(await named(button) == "Documents of this Thread, 2", accessibleName(button));
        // It opens the list in the Thread's place, newest first.
        button.click();
        await wait(() => assistant.view == "documents" && shown(assistant.documentsView), "the documents list");
        check(!shown(assistant.input) && !shown(assistant.log) && !shown(assistant.heading), "the Thread is still shown");
        let docRows = () => [...assistant.documentsView.querySelectorAll(".document-row")];
        await wait(() => docRows().length == 2, "the documents' rows");
        check(docRows().map(r => r.dataset.id).join() == [...made].reverse().join(), docRows().map(r => r.textContent).join());
        check(docRows()[0].textContent.includes("Panel doc two") && docRows()[0].textContent.includes("Just now"), docRows()[0].textContent);
        // Escape goes back to the Thread, focus on the button.
        docRows()[0].focus();
        docRows()[0].dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
        await wait(() => assistant.view == "chat" && deepActive() == button, "back to the Thread");
        // A row opens its document in a tab.
        button.click();
        await wait(() => docRows().length == 2, "the list again");
        let asker = win.gBrowser.tabs.find(t => t.label == "Documents asker");
        win.gBrowser.selectedTab = asker;
        docRows()[1].click();
        let url = `about:orbito-doc?id=${made[0]}`;
        await wait(() => win.gBrowser.selectedBrowser.currentURI.spec == url, "the document's tab");
        // The foot opens the Library on its documents.
        await wait(() => assistant.view == "documents", "the list after opening");
        assistant.documentsLibraryButton.click();
        let library = await wait(() => win.gBrowser.selectedBrowser.currentURI.spec == "about:orbito-library" && win.gBrowser.selectedBrowser.contentDocument, "the library");
        await wait(() => library.readyState == "complete" && !library.getElementById("artifacts").hidden && library.getElementById("threads").hidden, "the library's documents");
        // The Thread list counts them.
        assistant.view = "chat";
        assistant.threadsButton.click();
        await wait(() => threadRow(id)?.textContent.includes("2 documents"), `the count in ${threadRow(id)?.textContent}`);
        assistant.backButton.click();
        await wait(() => assistant.view == "chat", "back from the list");

        // A new Thread has made none, so no button.
        core.newThread(win);
        await wait(() => assistant.threadId != id && !shown(assistant.documentsButton), "the button to go");

        // search_artifacts searches the Thread's Space, or with all_spaces
        // every Space.
        await newSpace();
        let seen = {};
        let other = await askFake("Find my notes", async ({ callTool }) => {
          seen.here = await callTool("search_artifacts", { query: "otterword" });
          seen.all = await callTool("search_artifacts", { query: "otterword", all_spaces: true });
        });
        await finishedRun(other);
        check(!made.some(docId => seen.here.content.includes(docId)), seen.here.content);
        check(made.every(docId => seen.all.content.includes(docId)), seen.all.content);
        win.testState = { made };
        """)
    finally:
        b.js("""
        for (let docId of win.testState?.made ?? []) {
          await core.deleteArtifact(docId);
        }
        delete win.testState;
        dropFakeBackend();
        await resetOrbits();
        await resetSpaces();
        await onlyBlankTab();
        """)


@test
def the_library_shows_this_space_or_all_and_moves_a_document_or_opens_its_thread(b):
    try:
        b.js("""
        await resetSpaces();
        await resetOrbits();
        await onlyBlankTab();
        useFakeBackend();
        let make = async (prompt, title) => {
          let docId;
          let id = await askFake(prompt, async ({ callTool }) => {
            docId = (await callTool("create_artifact", { title, content: "Library Space notes." })).content.match(/document (\\S+) /)[1];
          });
          await finishedRun(id);
          return { id, docId };
        };
        let first = spaces().current;
        await openPage("Library first asker");
        let a = await make("First Space document", "First Space doc");
        let second = (await newSpace()).id;
        await openPage("Library second asker");
        let b = await make("Second Space document", "Second Space doc");
        win.testState = { made: [a.docId, b.docId] };

        // The library opens on this Space's documents and Threads.
        win.OrbitoAssistant.toggle(false);
        ChromeUtils.importESModule("chrome://browser/content/orbito/OrbitoPages.sys.mjs").OrbitoPages.openLibrary(win);
        let tab = await wait(() => win.gBrowser.selectedBrowser.currentURI.spec == "about:orbito-library" && win.gBrowser.selectedTab, "the library");
        let library = await wait(() => {
          let d = tab.linkedBrowser.contentDocument;
          return d?.readyState == "complete" && d.querySelector("#tab-artifacts .count")?.textContent && d;
        }, "its lists");
        let items = list => [...library.querySelectorAll(`#${list} li`)].map(li => li.dataset.id);
        let scope = name => library.querySelector(`#scope button[data-scope="${name}"]`);
        check(scope("space").getAttribute("aria-pressed") == "true" && scope("space").textContent == "This Space", scope("space").textContent);
        await wait(() => items("artifacts").includes(b.docId) && !items("artifacts").includes(a.docId), `this Space's documents (${items("artifacts")})`);
        check(items("threads").includes(b.id) && !items("threads").includes(a.id), items("threads"));
        // All Spaces: both, each saying its Space.
        scope("all").click();
        await wait(() => items("artifacts").includes(a.docId) && items("threads").includes(a.id), "every Space's");
        check(scope("all").getAttribute("aria-pressed") == "true", "All Spaces is not picked");
        let item = docId => library.querySelector(`#artifacts li[data-id="${docId}"]`);
        let select = item(a.docId).querySelector("select.document-space");
        check(select.value == first && select.selectedOptions[0].textContent == spaces().list[0].name, select.value);
        check(library.querySelector(`#threads li[data-id="${a.id}"]`).textContent.includes(spaces().list[0].name), "no Space on the Thread");
        check(library.querySelector(`#threads li[data-id="${a.id}"]`).textContent.includes("1 document"), "no count on the Thread");

        // Moved to the second Space, it is one of this Space's.
        select.value = second;
        select.dispatchEvent(new library.defaultView.Event("change"));
        await wait(async () => (await core.getArtifact(a.docId)).space_id == second, "the document's new Space");
        scope("space").click();
        await wait(() => items("artifacts").includes(a.docId) && !items("threads").includes(a.id), `the moved document (${items("artifacts")})`);

        // Open Thread shows the Thread that made it, in its Space.
        let open = item(a.docId).querySelector(".open-thread");
        check(open.textContent == "Open Thread", open.textContent);
        open.click();
        await wait(() => spaces().current == first && core.threadFor(win) == a.id && win.OrbitoAssistant.isOpen, "the Thread in the panel");
        await wait(() => assistant.threadId == a.id && assistant.view == "chat" && assistant.messages.length == 2, "the Thread's messages");
        """)
    finally:
        b.js("""
        for (let docId of win.testState?.made ?? []) {
          await core.deleteArtifact(docId);
        }
        delete win.testState;
        dropFakeBackend();
        await resetOrbits();
        await resetSpaces();
        await onlyBlankTab();
        """)


# A second backend for the Space tests, besides the fake one useFakeBackend
# makes the profile's: each question runs spaceFake.run.
SPACE_BACKEND = """
const spaceFake = { run: async () => {} };
core.BACKENDS["orbittest-space"] = {
  label: "Space test",
  modelPref: "orbito.test.spaceModel",
  defaultModel: "space-default",
  impl: { run: options => spaceFake.run(options) },
};
"""


@test
def each_space_answers_with_its_own_backend_and_a_thread_keeps_its_own(b):
    b.js(SPACE_BACKEND + """
    let asked = [];
    let record = backend => async ({ model, emit }) => {
      asked.push([backend, model]);
      emit({ type: "text", text: "Answered." });
    };
    spaceFake.run = record("orbittest-space");
    await resetSpaces();
    await onlyBlankTab();
    useFakeBackend();
    let first = spaces().current;
    try {
      let second = (await newSpace()).id;
      // The second Space's settings: a backend and a model of its own.
      let page = await openOrbitoSettings();
      let card = () => page.querySelector(`.space[data-space="${second}"]`);
      await wait(card, "the Space's settings");
      check(page.querySelector(`.space[data-space="${first}"]`), "no settings for the first Space");
      let select = card().querySelector("select.space-backend");
      check(select.value == "" && card().querySelector("input.space-model").disabled, "a default before one is picked");
      select.value = "orbittest-space";
      select.dispatchEvent(new page.defaultView.Event("change"));
      let input = await wait(() => {
        let field = card()?.querySelector("input.space-model");
        return !field?.disabled && field;
      }, "the model field");
      check(input.placeholder == "space-default", `placeholder ${input.placeholder} ${JSON.stringify(core.spaceBackend(second))}`);
      input.value = "space-model";
      input.dispatchEvent(new page.defaultView.Event("change"));
      check(JSON.stringify(core.spaceBackend(second)) == '{"backend":"orbittest-space","model":"space-model"}', JSON.stringify(core.spaceBackend(second)));
      check(!core.spaceBackend(first).backend, "the first Space has a default");

      let id = await askFake("In the second Space", record("orbittest"));
      await finishedRun(id);
      check(JSON.stringify(asked) == '[["orbittest-space","space-model"]]', `asked ${JSON.stringify(asked)}`);
      await assistant.updateComplete;
      check(assistant.modelButton.textContent.includes("space-model"), `the model button: ${assistant.modelButton.textContent}`);

      // The Thread keeps its backend when the Space's default changes.
      core.setSpaceBackend(second, {});
      assistant.submit("Again");
      await wait(() => core.isRunning(id), "the second question");
      await finishedRun(id);
      check(JSON.stringify(asked.at(-1)) == '["orbittest-space","space-default"]', JSON.stringify(asked));
      check((await core.getMessages(id)).filter(m => m.role == "assistant").every(m => m.backend == "orbittest-space"), "a reply went elsewhere");

      // Picking another backend in the menu moves this Thread alone, and
      // for good; the Space's and the profile's stay as they are.
      core.setSpaceBackend(second, { backend: "orbittest-space", model: "space-model" });
      core.backend = "orbittest-space";
      assistant.modelButton.click();
      await assistant.updateComplete;
      check(assistant.modelMenu.querySelector('[data-backend="orbittest-space"]').getAttribute("aria-checked") == "true", "the Thread's backend is not checked");
      let other = assistant.modelMenu.querySelector('[data-backend="orbittest"]');
      check(!other.hasAttribute("aria-disabled") && !assistant.modelMenu.querySelector(".backend-note"), "another backend cannot be picked");
      other.click();
      check(core.backend == "orbittest-space", "the profile's backend changed");
      check(JSON.stringify(core.spaceBackend(second)) == '{"backend":"orbittest-space","model":"space-model"}', JSON.stringify(core.spaceBackend(second)));
      core.backend = "orbittest";
      await assistant.updateComplete;
      check(!assistant.modelButton.textContent.includes("space-model"), `the model button: ${assistant.modelButton.textContent}`);
      for (let prompt of ["Switched", "Still switched"]) {
        assistant.submit(prompt);
        await wait(() => core.isRunning(id), "the question");
        await finishedRun(id);
        check(JSON.stringify(asked.at(-1)) == '["orbittest","test"]', JSON.stringify(asked));
      }
      core.setSpaceBackend(second, {});

      // A new Thread there takes the profile's now, and the first Space's
      // always did.
      await finishedRun(await askFake("A new Thread", record("orbittest")));
      check(JSON.stringify(asked.at(-1)) == '["orbittest","test"]', JSON.stringify(asked));
      core.setSpaceBackend(second, { backend: "orbittest-space" });
      spaces().switchTo(first);
      await wait(() => spaces().current == first, "the first Space");
      await finishedRun(await askFake("In the first Space", record("orbittest")));
      check(JSON.stringify(asked.at(-1)) == '["orbittest","test"]', JSON.stringify(asked));
    } finally {
      assistant.closeMenu();
      dropFakeBackend();
      delete core.BACKENDS["orbittest-space"];
      core.setSpaceBackend(first, {});
      await resetSpaces();
    }
    """)


@test
def a_failed_sign_in_shows_in_the_panel_and_no_other_backend_answers(b):
    b.js(SPACE_BACKEND + """
    let profile = 0;
    await resetSpaces();
    await onlyBlankTab();
    useFakeBackend();
    let first = spaces().current;
    let errorText = () => assistant.log.querySelector(".error")?.textContent ?? "";
    try {
      // The Space's backend has no key: the question fails there.
      core.setSpaceBackend(first, { backend: "openai" });
      fake.run = async () => void profile++;
      await openAssistant();
      let id = core.newThread(win);
      assistant.submit("Without a key");
      await wait(() => !core.isRunning(id) && errorText(), "the error");
      check(!profile, "the profile's backend answered");
      check((await core.getMessages(id)).at(-1).backend == "openai", "not asked of the Space's backend");
      // Its settings are the failed backend's, and keep the profile's.
      logButton("Open settings").click();
      await wait(() => !assistant.settingsForm.hidden && assistant.backendInput.value == "openai", "the backend's settings");
      await assistant.toggleSettings(false);
      check(core.backend == "orbittest", core.backend);

      // A sign-in that fails while answering is shown, and the Thread's
      // next question goes to the same backend again.
      core.setSpaceBackend(first, { backend: "orbittest-space" });
      let tries = 0;
      spaceFake.run = async () => {
        tries++;
        throw Object.assign(new Error("Signed out."), { needsLogin: true });
      };
      id = await askFake("Signed out", async () => void profile++);
      await finishedRun(id);
      await wait(() => errorText().includes("Signed out."), "the sign-in error");
      core.setSpaceBackend(first, {});
      assistant.submit("Once more");
      await wait(() => tries == 2, "the second try");
      await finishedRun(id);
      check(!profile && tries == 2, `${profile} ${tries}`);
      check((await core.getMessages(id)).filter(m => m.role == "assistant").every(m => m.backend == "orbittest-space"), "a reply went elsewhere");
    } finally {
      dropFakeBackend();
      delete core.BACKENDS["orbittest-space"];
      core.setSpaceBackend(first, {});
      await resetSpaces();
    }
    """)


@test
def a_scheduled_task_runs_in_its_space_while_another_is_shown(b):
    b.js(SPACE_BACKEND + """
    const { OrbitoTasks } = ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoTasks.sys.mjs"
    );
    let folder = PathUtils.join(PathUtils.profileDir, "orbito-assistant", "skills");
    let clear = async () => {
      for (let memory of await core.listMemories()) {
        await core.deleteMemory(memory.id);
      }
    };
    let notify = OrbitoTasks._notify;
    OrbitoTasks._notify = () => {};
    await resetSpaces();
    await onlyBlankTab();
    useFakeBackend();
    await clear();
    await IOUtils.makeDirectory(PathUtils.join(folder, "tasknotes"));
    await IOUtils.writeUTF8(PathUtils.join(folder, "tasknotes", "SKILL.md"), "---\\nname: tasknotes\\ndescription: Take task notes.\\n---\\nNote the task.");
    let first = spaces().current;
    let task;
    try {
      let second = (await newSpace()).id;
      await openPage("Task Space page");
      // The second Space's context: its own backend, memory and skill.
      core.setSpaceBackend(second, { backend: "orbittest-space", model: "space-model" });
      await core.addMemory({ text: "Second Space task fact", space: second });
      await core.addMemory({ text: "First Space task fact", space: first });
      core.setSkillSpace((await core.skills()).find(s => s.name == "tasknotes"), second);

      // Made while the second Space is shown, the task is for it, and
      // follows the Space's backend unless one is picked.
      let page = await openOrbitoSettings();
      let form = page.getElementById("task-form");
      let field = n => form.elements.namedItem(n);
      page.getElementById("task-new").click();
      await wait(() => [...field("skill").options].some(o => o.value == "tasknotes"), "the skill to pick");
      field("skill").value = "tasknotes";
      field("skill").dispatchEvent(new page.defaultView.Event("change"));
      field("prompt").value = "the news";
      check(field("space").value == second, `the form's Space ${field("space").value}`);
      check([...field("space").options].map(o => o.value).join() == `,${first},${second}`, [...field("space").options].map(o => o.value).join());
      check(field("backend").value == "" && field("model").disabled, `backend ${field("backend").value}`);
      field("name").value = "Space digest";
      form.querySelector('.tool-list input[value="open_tab"]').checked = true;
      form.querySelector("button[type=submit]").click();
      await wait(() => form.hidden, "the form to close");
      task = (await OrbitoTasks.list()).find(t => t.name == "Space digest");
      check(task.space_id == second && task.backend == null && task.model == null, JSON.stringify(task));
      // A new task is for the Space shown.
      form.ownerDocument.getElementById("task-new").click();
      check(field("space").value == second && field("backend").value == "", field("space").value);
      form.ownerDocument.getElementById("task-cancel").click();

      // Run while the first Space is shown: it all goes to the second.
      spaces().switchTo(first);
      await wait(() => spaces().current == first, "the first Space");
      let selected = win.gBrowser.selectedTab;
      let seen = {};
      spaceFake.run = async ({ system, model, callTool, emit }) => {
        seen.system = system;
        seen.model = model;
        seen.opened = openedTab(await callTool("open_tab", { url: pageURL("Task opened") }));
        await callTool("create_artifact", { title: "Space digest result", content: "Done." });
        emit({ type: "text", text: "Done." });
      };
      let run = await OrbitoTasks.runNow(task.id);
      check(run.status == "ok" && !run.error, JSON.stringify(run));
      check(seen.model == "space-model", `asked ${seen.model}`);
      check(seen.system.includes("- Second Space task fact") && !seen.system.includes("First Space task fact"), seen.system);
      let [question] = await core.getMessages(run.thread_id);
      check(question.parts[0].type == "skill" && question.parts[0].name == "tasknotes", JSON.stringify(question.parts));
      check((await core.store.getThread(run.thread_id)).space_id == second, "the Thread's Space");
      check((await core.getArtifact(run.artifact_id)).space_id == second, "the document's Space");
      check(spaceOfTab(seen.opened) == second && seen.opened.hidden, "the opened tab's Space");
      check(spaces().current == first && win.gBrowser.selectedTab == selected, "the window changed");
      let listed = async space => (await core.store.listThreads("", { space })).find(t => t.id == run.thread_id);
      check((await listed(second))?.scheduled, "not in the second Space's Threads");
      check(!(await listed(first)), "in the first Space's Threads");
      // A Space removed since is none.
      check(OrbitoTools.context({ space: second }).space == second && OrbitoTools.context({ space: "gone" }).space === null, "a windowless Space");
    } finally {
      OrbitoTasks._notify = notify;
      if (task) {
        await OrbitoTasks.remove(task.id);
      }
      await clear();
      dropFakeBackend();
      delete core.BACKENDS["orbittest-space"];
      for (let space of spaces().list) {
        core.setSpaceBackend(space.id, {});
      }
      await IOUtils.remove(folder, { recursive: true, ignoreAbsent: true });
      Services.prefs.clearUserPref("orbito.assistant.skills.userSpaces");
      await resetSpaces();
    }
    """)


@test
def a_question_shares_and_acts_on_the_tabs_of_its_space_in_its_window(b):
    try:
        b.js("""
        await resetSpaces();
        await onlyBlankTab();
        useFakeBackend();
        useSiteHosts(["mail"]);
        Services.prefs.setStringPref("orbito.recall.excludedDomains", '["mail.orbito.test"]');
        let first = spaces().current;
        let here = await openPage("Shared here");
        let mail = win.gBrowser.addTab(siteURL("mail", "Shared inbox"), {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
        await wait(() => mail.linkedBrowser.contentTitle == "Shared inbox", "the excluded page");
        await newSpace();
        let there = await openPage("Shared there");
        spaces().switchTo(first);
        let asker = await openPage("Shared asker");
        let other = win.OpenBrowserWindow();
        try {
          await wait(() => other.gBrowserInit?.delayedStartupFinished && other.OrbitoShell?.spaces, "the other window");
          let elsewhere = await openPage("Shared elsewhere", other);
          check(spaceOfTab(elsewhere) == first, "the other window's tab is in another Space");
          win.focus();
          win.gBrowser.selectedTab = asker;

          // This tab: the question carries the selected tab and its page's
          // text only, while the tools see and act on the tabs of its Space
          // in its window; never an excluded site's tab.
          let seen = {};
          let id = await askFake("What is here?", async ({ prompt, system, callTool }) => {
            seen.prompt = prompt;
            seen.system = system;
            seen.listed = JSON.parse((await callTool("list_tabs", {})).content).map(t => t.title);
            seen.there = await callTool("get_page_text", { tab_id: OrbitoTools.tabId(there) });
            seen.elsewhere = await callTool("get_page_text", { tab_id: OrbitoTools.tabId(elsewhere) });
            seen.group = await callTool("group_tabs", { tab_ids: [OrbitoTools.tabId(there)], name: "Away" });
          });
          await finishedRun(id);
          let { prompt } = seen;
          check(prompt.startsWith("What is here?"), prompt);
          check(prompt.includes("the tab they are looking at"), prompt);
          for (let left of ["Shared here", "Shared there", "Shared elsewhere", "Shared inbox", "mail.orbito.test"]) {
            check(!prompt.includes(left), `${left} is shared: ${prompt}`);
          }
          check(prompt.includes(`<page_tabs>\\n{"id":${OrbitoTools.tabId(asker)},"title":"Shared asker","url":"${pageURL("Shared asker")}","selected":true}\\n</page_tabs>`), prompt);
          check(prompt.includes("<page_content>\\nShared asker\\n</page_content>"), `the selected page's text is not shared: ${prompt}`);
          check(prompt.split("<page_content>").length == 2, "another tab's text is shared");
          check(!seen.system.includes("page_tabs") && !seen.system.includes("Shared asker"), seen.system);
          // The tools see and act on the Space's tabs in the window only.
          check(seen.listed.includes("Shared here") && seen.listed.includes("Shared asker"), `listed ${seen.listed}`);
          check(!seen.listed.includes("Shared there") && !seen.listed.includes("Shared elsewhere"), `listed ${seen.listed}`);
          for (let refused of [seen.there, seen.elsewhere, seen.group]) {
            check(!refused.ok && /no tab/i.test(refused.content), JSON.stringify(refused));
          }
          check(!there.group, "a tab of another Space was grouped");

          // All open tabs: the tabs of its Space in its window, the selected
          // one marked, and the selected page's text, the model told to read
          // those that matter; None: nothing.
          assistant.context = "tabs";
          id = await askFake("And all of them?", async ({ prompt, system }) => Object.assign(seen, { prompt, system }));
          await finishedRun(id);
          prompt = seen.prompt;
          for (let title of ["Shared here", "Shared asker"]) {
            check(prompt.includes(title), `${title} is not shared: ${prompt}`);
          }
          for (let left of ["Shared there", "Shared elsewhere", "Shared inbox", "mail.orbito.test"]) {
            check(!prompt.includes(left), `${left} is shared: ${prompt}`);
          }
          check(prompt.includes(`"id":${OrbitoTools.tabId(asker)},"title":"Shared asker","url":"${pageURL("Shared asker")}","selected":true`), prompt);
          check(prompt.includes("<page_content>\\nShared asker\\n</page_content>") && prompt.split("<page_content>").length == 2, prompt);
          check(/read the ones that matter/.test(seen.system), seen.system);
          check(!seen.system.includes("page_tabs") && !seen.system.includes("Shared here"), seen.system);
          assistant.context = "none";
          id = await askFake("And none?", async ({ prompt }) => (seen.prompt = prompt));
          await finishedRun(id);
          check(!seen.prompt.includes("Shared here") && !seen.prompt.includes("Shared asker"), seen.prompt);
        } finally {
          other.close();
          assistant.context = "tab";
        }
        """)
    finally:
        b.js("""
        Services.prefs.clearUserPref("orbito.recall.excludedDomains");
        dropSiteHosts();
        dropFakeBackend();
        await resetAssistant();
        await resetSpaces();
        await onlyBlankTab();
        """)


@test
def what_a_question_opens_goes_in_its_space_and_leaves_the_screen_be(b):
    try:
        b.js("""
        await resetSpaces();
        await resetOrbits();
        await onlyBlankTab();
        useFakeBackend();
        let first = spaces().current;
        await openPage("Opener asker");
        core.setPermissionMode(win, "bypass");
        let gate = Promise.withResolvers();
        let opened = [];
        let id = await askFake("Open things", async ({ callTool }) => {
          await gate.promise;
          opened.push(openedTab(await callTool("open_tab", { url: pageURL("Opened away") })));
          opened.push(openedTab(await callTool("create_artifact", { title: "Made away", content: "Made." })));
        });
        // The user goes on to another Space while the question works.
        let second = await newSpace();
        let looking = await openPage("Looking elsewhere");
        gate.resolve();
        await finishedRun(id);
        check(opened.length == 2 && opened.every(Boolean), "the tabs did not open");
        for (let tab of opened) {
          check(spaceOfTab(tab) == first && tab.hidden, `${tab.label} is in ${spaceOfTab(tab)}`);
        }
        check(spaces().current == second.id && win.gBrowser.selectedTab == looking, "the screen changed");
        """)
    finally:
        b.js("""
        core.setPermissionMode(win, "ask");
        dropFakeBackend();
        await resetOrbits();
        await resetAssistant();
        await resetSpaces();
        await onlyBlankTab();
        """)

@test
def the_menu_pins_a_tab_into_the_grid_and_unpins_it(b):
    b.js("""
    await resetPins();
    await onlyBlankTab();
    let a = await openPage("Pin menu A");
    let other = await openPage("Pin menu B");
    try {
      // An empty grid keeps its place, with no height: the gap under it
      // stays, so the first Pin does not move the rows below by it.
      let box = pinGrid().getBoundingClientRect();
      let name = doc.getElementById("orbito-space-title").getBoundingClientRect();
      check(pinGrid().hasAttribute("empty") && pinGrid().checkVisibility() && box.height == 0, `an empty grid is ${box.height}px`);
      check(Math.round(name.top - box.bottom) == 8, `${name.top - box.bottom}px under the empty grid`);
      // A tab's menu offers to pin it; picking it makes it a Pin.
      let items = await tabMenu(rowFor(a), "pin");
      check(JSON.stringify(items) == '["orbito-tab-menu-pin","orbito-tab-menu-dock"]', `items ${items}`);
      await pinsMatch();
      check(a.pinned && shell.pins.pinOf(a), "the tab is not a Pin");
      let [pin] = storedPins();
      check(pin.url == pageURL("Pin menu A") && pin.title == "Pin menu A", JSON.stringify(pin));
      // The grid shows it, the tab list no longer; it stays selectable.
      await listMatchesGBrowser();
      check(!(await rows()).some(r => r.tab == a), "the tab list shows a Pin's tab");
      check(shown(pinGrid()) && shown(pinButtonFor(a)), "the Pin does not show");
      check(await named(pinButtonFor(a)) == "Pin menu A", accessibleName(pinButtonFor(a)));
      check(pinButtonFor(a).getAttribute("aria-selected") == "false", "a Pin not selected shows selected");
      pinButtonFor(a).click();
      await wait(() => win.gBrowser.selectedTab == a, "the Pin's tab to be selected");
      await pinGrid().updateComplete;
      check(pinButtonFor(a).hasAttribute("selected") && pinButtonFor(a).getAttribute("aria-selected") == "true", "the selected Pin shows no selection");
      await listMatchesGBrowser();
      // The Pin's menu unpins it: back in the tab list, gone from the list.
      items = await tabMenu(pinButtonFor(a), "unpin");
      check(JSON.stringify(items) == '["orbito-tab-menu-unpin"]', `items ${items}`);
      await wait(() => !a.pinned && !storedPins().length, "the Pin to go");
      check(rowFor(a) && !(await pinButtons()).length, "the tab did not come back to the list");
      await listMatchesGBrowser();
    } finally {
      await resetPins();
    }
    """)


@test
def about_pages_show_the_orbito_tile_and_the_pin_grid_says_it_is_shared(b):
    b.js("""
    await resetPins();
    await onlyBlankTab();
    let page = await openPage("Tile site");
    let about = win.gBrowser.addTab("about:robots", {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    try {
      await listMatchesGBrowser();
      // An about: page's icon is the Orbit mark on the accent; a site's
      // is its favicon.
      let tile = await wait(() => rowFor(about)?.querySelector(".icon.orbito-tile"), "the Orbito tile in the about: page's row");
      check(tile.querySelector("svg"), "no Orbit mark on the tile");
      check(win.getComputedStyle(tile).backgroundColor == tokenIn(tabList().renderRoot.querySelector(".list"), "--orbito-accent"), "the tile is not on the accent");
      check(rowFor(page).querySelector("img.icon"), "a site shows the Orbito tile");
      shell.pins.pinTab(about);
      shell.pins.pinTab(page);
      await pinsMatch();
      check(pinButtonFor(about).querySelector(".icon.orbito-tile svg"), "no Orbito tile on the about: page's Pin");
      check(pinButtonFor(page).querySelector("img.icon"), "a site's Pin shows the Orbito tile");
      check(pinGrid().renderRoot.querySelector(".grid").title == "Pins: shared by every Space", "the grid has no tooltip");
      check(pinButtonFor(page).title == "Tile site", "a Pin's tooltip is not its name");
    } finally {
      await resetPins();
    }
    """)


@test
def pins_and_dock_tabs_come_in_shrink_away_and_slide_to_their_new_places(b):
    b.js("""
    await resetSpaces();
    await resetPins();
    await resetDocks();
    await onlyBlankTab();
    let grid = pinGrid();
    let moves = el => el.getAnimations().filter(a => !a.animationName && !a.transitionProperty);
    let moved = el => moves(el).some(a => a.effect.getKeyframes().some(k => k.translate && k.translate != "0px"));
    let timing = a => a.effect.getComputedTiming().duration;
    let ghosts = list => list.renderRoot.querySelector(".ghosts").children;
    // Until both stand still, and long enough after that the next change
    // is not taken as part of the same batch.
    let settle = async () => {
      for (let list of [grid, dock()]) {
        await list.updateComplete;
        await stillIn(list);
      }
      await sleep(motionMs("medium") + 50);
    };
    let pins = shell.pins;
    let docks = shell.docks;
    try {
      let [a, b2, c, d] = [await openPage("Pin A"), await openPage("Pin B"), await openPage("Dock C"), await openPage("Dock D")];
      pins.pinTab(a, 0);
      await settle();
      // A new Pin comes in at its place, the others make room.
      pins.pinTab(b2, 0);
      await grid.updateComplete;
      let fresh = pinButtonFor(b2);
      check(moves(fresh).length && !moved(fresh), "the new Pin does not come in");
      check(timing(moves(fresh)[0]) == motionMs("medium"), `it comes in for ${timing(moves(fresh)[0])}`);
      check(moved(pinButtonFor(a)), "the other Pin does not make room");
      await settle();
      // Moved, the Pins slide to their places.
      win.gBrowser.moveTabBefore(a, b2);
      await grid.updateComplete;
      check(moved(pinButtonFor(a)) && moved(pinButtonFor(b2)), "the Pins do not slide");
      await settle();
      // Unpinned, a Pin shrinks away where it was and the others fill in.
      pins.unpinTab(a);
      await grid.updateComplete;
      check(ghosts(grid).length == 1 && ghosts(grid)[0].inert, `${ghosts(grid).length} Pins shrink away`);
      check(moved(pinButtonFor(b2)), "the other Pin does not fill in");
      check((await pinButtons()).length == 1, "the grid's buttons count the ghost");
      await settle();
      check(!ghosts(grid).length, "the ghost stays");
      // The Dock: the same.
      docks.dockTab(c, 0);
      await settle();
      docks.dockTab(d, 0);
      await dock().updateComplete;
      check(moves(dockRowFor(d)).length && moved(dockRowFor(c)), "the Dock does not make room for its new tab");
      await settle();
      win.gBrowser.moveTabBefore(c, d);
      await dock().updateComplete;
      check(moved(dockRowFor(c)) && moved(dockRowFor(d)), "the Dock's rows do not slide");
      await settle();
      docks.undockTab(c);
      await dock().updateComplete;
      check(ghosts(dock()).length == 1 && moved(dockRowFor(d)), "the undocked row does not go away from its place");
      check((await dockRows()).length == 1, "the Dock's rows count the ghost");
      await settle();
      // Another Space's Dock shows at once.
      let first = spaces().current;
      let second = (await newSpace()).id;
      await openPage("Dock other Space");
      docks.dockTab(win.gBrowser.selectedTab, 0);
      await settle();
      spaces().switchTo(first);
      await dock().updateComplete;
      check(!ghosts(dock()).length && ![...dock().rows].some(r => moves(r).length), "the Dock's rows move on a Space switch");
      // Nothing moves with reduced motion.
      await settle();
      Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
      await wait(() => win.matchMedia("(prefers-reduced-motion: reduce)").matches, "reduced motion");
      pins.pinTab(c, 0);
      await grid.updateComplete;
      pins.unpinTab(c);
      await grid.updateComplete;
      check(!ghosts(grid).length && ![...grid.buttons].some(p => moves(p).length), "the Pins move with reduced motion");
    } finally {
      Services.prefs.clearUserPref("ui.prefersReducedMotion");
      await resetPins();
      await resetDocks();
      await resetSpaces();
    }
    """)


@test
def dragging_tabs_onto_the_grid_pins_them_and_pins_move_and_unpin_by_drag(b):
    start, end = b.js("""
    await resetPins();
    await onlyBlankTab();
    for (let title of ["Drag pin A", "Drag pin B", "Drag pin C"]) {
      await openPage(title);
    }
    await rows();
    return [middle(rowFor(byLabel("Drag pin A"))), null];
    """)
    # With no Pin, a drag opens an invisible place to drop on, over the
    # Sidebar's top row.
    x, y = start
    hold = b.m.actions.sequence("pointer", "mouse", pointer_params={"pointerType": "mouse"})
    hold.pointer_move(round(x), round(y)).pointer_down()
    hold.pointer_move(round(x), round(y + 10), duration=50).pointer_move(round(x), round(y + 20), duration=50)
    hold.perform()
    try:
        hint = b.js("""
        await wait(() => pinGrid().grid.hasAttribute("dropping") && shown(pinGrid().grid), "the grid's drop place");
        let grid = pinGrid().grid;
        let style = win.getComputedStyle(grid);
        check(style.outlineStyle == "none" && style.backgroundColor == "rgba(0, 0, 0, 0)" && !grid.textContent.trim(), `the drop place shows: ${style.outlineStyle} ${style.backgroundColor} ${grid.textContent}`);
        check(grid.getBoundingClientRect().height >= 40, `the drop place is ${grid.getBoundingClientRect().height}px`);
        return middle(grid);
        """)
        drop = b.m.actions.sequence("pointer", "mouse", pointer_params={"pointerType": "mouse"})
        drop.pointer_move(round(hint[0]), round(hint[1] + 2), duration=50).pointer_move(round(hint[0]), round(hint[1]), duration=50).pointer_up()
        drop.perform()
    finally:
        b.m.actions.release()
    start, end = b.js("""
    let a = byLabel("Drag pin A");
    await wait(() => a.pinned && storedPins().length == 1, "the dropped tab to be a Pin");
    await pinsMatch();
    check(!pinGrid().grid.hasAttribute("dropping") && !tabList().dragging, "the drag did not end");
    await listMatchesGBrowser();
    // C onto the first half of A's button: before it.
    let c = byLabel("Drag pin C");
    let r = pinButtonFor(a).getBoundingClientRect();
    return [middle(rowFor(c)), [r.left + 4, r.top + r.height / 2]];
    """)
    b.drag(start, end)
    start, end = b.js("""
    await wait(() => pinLabels() == "Drag pin C,Drag pin A", "C to be pinned before A");
    await pinsMatch();
    check(storedPins().map(p => p.title).join() == "Drag pin C,Drag pin A", "the list is in another order");
    // Dragging a Pin moves it: C after A.
    let [c, a] = shell.pins.tabs;
    let r = pinButtonFor(a).getBoundingClientRect();
    return [middle(pinButtonFor(c)), [r.right - 4, r.top + r.height / 2]];
    """)
    b.drag(start, end)
    start, end = b.js("""
    await wait(() => storedPins().map(p => p.title).join() == "Drag pin A,Drag pin C", "the Pins to swap");
    await pinsMatch();
    check(pinLabels() == "Drag pin A,Drag pin C", pinLabels());
    // Dropped on the tab list, a Pin is unpinned.
    let c = byLabel("Drag pin C");
    return [middle(pinButtonFor(c)), middle(rowFor(byLabel("Drag pin B")))];
    """)
    b.drag(start, end)
    x, y = b.js("""
    let c = byLabel("Drag pin C");
    await wait(() => !c.pinned && storedPins().length == 1, "the Pin dropped on the list to go");
    await pinsMatch();
    await listMatchesGBrowser();
    check(!tabList().hasAttribute("unpin-drop"), "the list still shows a drop");
    return middle(pinButtonFor(byLabel("Drag pin A")));
    """)
    # A short press on a Pin selects it; it does not move it.
    b.pointer((x, y), "down", (x + 2, y + 1), "up")
    b.js("""
    await wait(() => win.gBrowser.selectedTab == byLabel("Drag pin A"), "the click to select the Pin");
    check(storedPins().length == 1 && byLabel("Drag pin A").pinned, "a click moved the Pin");
    await resetPins();
    """)


@test
def every_window_follows_the_pin_list_and_loads_a_pin_when_selected(b):
    b.js("""
    await resetPins();
    await onlyBlankTab();
    let a = await openPage("Shared A");
    let bTab = await openPage("Shared B");
    shell.pins.pinTab(a);
    shell.pins.pinTab(bTab);
    await pinsMatch();
    let other = win.OpenBrowserWindow();
    try {
      await wait(() => other.gBrowserInit?.delayedStartupFinished && other.OrbitoShell?.pins, "the new window");
      // A new window shows the same Pins, none loaded.
      await pinsMatch(other);
      let pins = other.OrbitoShell.pins;
      await wait(() => pinLabels(other) == "Shared A,Shared B", `labels ${pinLabels(other)}`);
      check(pins.tabs.every(t => !t.linkedPanel), "a Pin's tab loaded with the window");
      check(pins.tabs.every(t => t.linkedBrowser.currentURI.spec.startsWith(PAGES)), "a Pin's tab has another URL");
      // Added in one window, a Pin shows unloaded in the other.
      let c = await openPage("Shared C");
      shell.pins.pinTab(c);
      await pinsMatch(other);
      check(!pins.tabs[2].linkedPanel && pins.tabs[2].label == "Shared C", "the new Pin's tab in the other window");
      // Moved in the other window, it moves in this one.
      other.gBrowser.moveTabBefore(pins.tabs[2], pins.tabs[0]);
      await wait(() => pinLabels() == "Shared C,Shared A,Shared B", `order ${pinLabels()}`);
      await pinsMatch();
      await pinsMatch(other);
      // Selecting a Pin loads its page.
      let first = pins.tabs[0];
      await pinButtons(other);
      pinButtonFor(first, other).click();
      await wait(() => first.linkedPanel && first.linkedBrowser.contentTitle == "Shared C", "the Pin to load");
      check(!pins.tabs[1].linkedPanel, "selecting a Pin loaded another");
      // Removed in one window: the other's loaded tab stays as a plain tab,
      // its unloaded ones close.
      shell.pins.unpinTab(c);
      shell.pins.unpinTab(a);
      await pinsMatch(other);
      check(pinLabels(other) == "Shared B", pinLabels(other));
      check(first.isConnected && !first.pinned && !first.hidden, "the loaded tab of a removed Pin is gone");
      check(!other.gBrowser.tabs.some(t => t.label == "Shared A"), "the unloaded tab of a removed Pin stayed");
      await listMatchesGBrowser(other);
    } finally {
      await new Promise(resolve => {
        other.addEventListener("unload", resolve, { once: true });
        other.close();
      });
      await resetPins();
    }
    """)


@test
def private_windows_show_the_pins_but_add_none(b):
    b.js("""
    await resetPins();
    await onlyBlankTab();
    shell.pins.pinTab(await openPage("Public pin"));
    let other = win.OpenBrowserWindow({ private: true });
    try {
      await wait(() => other.gBrowserInit?.delayedStartupFinished && other.OrbitoShell?.pins, "the private window");
      await pinsMatch(other);
      check(!other.OrbitoShell.pins.canAdd, "a private window can add Pins");
      let tab = await openPage("Private page", other);
      other.OrbitoShell.pins.pinTab(tab);
      check(!tab.pinned && storedPins().length == 1, "a private tab became a Pin");
      // Its tab menu would be empty, so it does not open.
      await rows(other);
      rowFor(tab, other).dispatchEvent(new other.MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
      await sleep(300);
      check(other.OrbitoShell.pins.menu.state == "closed", "the empty menu opened");
    } finally {
      await new Promise(resolve => {
        other.addEventListener("unload", resolve, { once: true });
        other.close();
      });
      await resetPins();
    }
    """)


@test
def closing_a_pins_tab_keeps_the_pin_unloaded(b):
    b.js("""
    await resetPins();
    await onlyBlankTab();
    let a = await openPage("Close pin A");
    let c = await openPage("Close pin B");
    shell.pins.pinTab(a);
    shell.pins.pinTab(c);
    await pinsMatch();
    try {
      win.gBrowser.selectedTab = a;
      win.gBrowser.removeTab(a, { animate: false });
      await wait(() => shell.pins.tabs.length == 2 && !shell.pins.tabs.includes(a), "a tab for the Pin again");
      await pinsMatch();
      let again = shell.pins.tabs[0];
      check(storedPins().length == 2 && again.label == "Close pin A", pinLabels());
      check(!again.linkedPanel && !again.selected, "the Pin's new tab is loaded");
      // Reopening the closed tab gives the Pin that tab back, not a second one.
      // SessionStore keeps it once the tab's last state comes in.
      await wait(() => SessionStore.getClosedTabDataForWindow(win)[0]?.title == "Close pin A", "the closed tab to be the last closed", 5000);
      SessionStore.undoCloseTab(win, 0);
      await wait(() => shell.pins.tabs.some(t => t.linkedPanel && t.label == "Close pin A"), "the reopened tab");
      await pinsMatch();
      check(shell.pins.tabs.length == 2 && storedPins().length == 2, pinLabels());
    } finally {
      await resetPins();
    }
    """)


@test
def pins_show_in_every_space(b):
    b.js("""
    await resetSpaces();
    await resetPins();
    await onlyBlankTab();
    let first = spaces().current;
    let a = await openPage("Everywhere");
    shell.pins.pinTab(a);
    await pinsMatch();
    try {
      let second = await newSpace();
      await pinsMatch();
      check(!a.hidden && shown(pinButtonFor(a)), "the Pin is hidden in another Space");
      check(!shell.sidebar.spaceBody.contains(pinGrid()), "the grid slides with the Space");
      // Selecting it keeps the Space.
      pinButtonFor(a).click();
      await wait(() => win.gBrowser.selectedTab == a, "the Pin to be selected");
      check(spaces().current == second.id, "selecting a Pin switched the Space");
      spaces().switchTo(first);
      await pinsMatch();
      check(win.gBrowser.selectedTab == a && shown(pinButtonFor(a)), "the Pin left with the Space");
    } finally {
      await resetPins();
      await resetSpaces();
    }
    """)


@test
def the_pin_grid_follows_the_keyboard_rules(b):
    b.js("""
    await resetPins();
    await onlyBlankTab();
    for (let title of ["Key pin A", "Key pin B", "Key pin C"]) {
      shell.pins.pinTab(await openPage(title));
    }
    await openPage("Key page");
    await pinsMatch();
    await wait(() => {
      win.gBrowser.selectedBrowser.focus();
      return shell.focusedRegion == "page";
    }, "the page to have focus");
    check(await named(pinGrid().grid) == "Pins", accessibleName(pinGrid().grid));
    let names = [];
    for (let button of await pinButtons()) {
      names.push(await named(button));
    }
    check(names.join() == "Key pin A,Key pin B,Key pin C", `names ${names}`);
    check((await pinButtons()).filter(p => p.tabIndex == 0).length == 1, "the grid is not one tab stop");
    """)
    try:
        # F6 to the Sidebar (the tab list), Shift+Tab back to the grid.
        b.keys(Keys.F6)
        b.js('await wait(() => shell.focusedRegion == "sidebar", "the Sidebar");')
        for _ in range(3):
            if b.js("return deepActive()?.classList.contains('pin');"):
                break
            b.keys((Keys.SHIFT, Keys.TAB))
        b.js("""
        await wait(() => deepActive()?.tab == shell.pins.tabs[0], "focus on the first Pin");
        check(deepActive().matches(":focus-visible"), "the Pin shows no focus");
        check(win.getComputedStyle(deepActive()).outlineStyle != "none", "no focus ring on the Pin");
        """)
        b.keys(Keys.ARROW_RIGHT)
        b.js('await wait(() => deepActive()?.tab == shell.pins.tabs[1], "Right to the next Pin");')
        b.keys(Keys.END)
        b.js('await wait(() => deepActive()?.tab == shell.pins.tabs[2], "End to the last Pin");')
        b.keys(Keys.ARROW_UP)
        b.js('check(deepActive()?.tab == shell.pins.tabs[2], "Up left the first row");')
        b.keys(Keys.HOME)
        b.js('await wait(() => deepActive()?.tab == shell.pins.tabs[0], "Home to the first Pin");')
        b.keys(Keys.ENTER)
        b.js("""
        let tab = shell.pins.tabs[0];
        await wait(() => win.gBrowser.selectedTab == tab, "Enter to select the Pin");
        """)
        b.keys((Keys.SHIFT, Keys.F10))
        b.js("""
        let menu = shell.pins.menu;
        await wait(() => menu.state == "open", "Shift+F10 to open the Pin's menu");
        check(!menu.querySelector("#orbito-tab-menu-unpin").hidden && menu.querySelector("#orbito-tab-menu-pin").hidden, "the menu offers another item");
        let hidden = new Promise(r => menu.addEventListener("popuphidden", r, { once: true }));
        menu.hidePopup();
        await hidden;
        await wait(() => {
          let pin = pinButtonFor(shell.pins.tabs[0]);
          if (deepActive() != pin) {
            pin.focus();
          }
          return deepActive() == pin;
        }, "focus back on the Pin");
        """)
        b.keys(Keys.F6)
        b.js('await wait(() => shell.focusedRegion == "top-bar", "F6 from the grid to the Top bar");')
    finally:
        b.js("await resetPins();")


@test
def the_menu_docks_a_tab_and_undocks_it(b):
    b.js("""
    await resetDocks();
    await resetSpaces();
    await onlyBlankTab();
    let a = await openPage("Dock menu A");
    await openPage("Dock menu B");
    try {
      check(dock().hasAttribute("empty") && !shown(dock()), "an empty Dock shows");
      // A tab's menu offers to dock it; picking it adds it to the Space's Dock.
      let items = await tabMenu(rowFor(a), "dock");
      check(items.includes("orbito-tab-menu-dock") && !items.includes("orbito-tab-menu-undock"), `items ${items}`);
      await wait(() => storedDock().length == 1, "the tab to be docked");
      await docksMatch();
      let [entry] = storedDock();
      check(entry.url == pageURL("Dock menu A") && entry.title == "Dock menu A", JSON.stringify(entry));
      check(shell.docks.dockOf(a)?.id == entry.id && !a.pinned, "the tab is not the entry's tab");
      // The Dock shows it, the tab list no longer; it stays selectable.
      check(shown(dock()) && shown(dockRowFor(a)), "the Dock row does not show");
      check(!(await rows()).some(r => r.tab == a), "the tab list shows a Dock tab");
      await listMatchesGBrowser();
      check(await named(dockRowFor(a)) == "Dock menu A", accessibleName(dockRowFor(a)));
      check(await named(dock().list) == "Dock", accessibleName(dock().list));
      dockRowFor(a).click();
      await wait(() => win.gBrowser.selectedTab == a, "the Dock tab to be selected");
      await dock().updateComplete;
      check(dockRowFor(a).getAttribute("aria-selected") == "true", "the selected Dock tab shows no selection");
      await listMatchesGBrowser();
      // Its rows line up with the tab list's, and a line sets it apart.
      let left = shell.sidebar.getBoundingClientRect().left + 8;
      let x = el => Math.round(el.getBoundingClientRect().left - left);
      let row = dockRowFor(a);
      check(x(row.querySelector(".icon")) == 10 && x(row.querySelector(".label")) == 35,
        `icon at ${x(row.querySelector(".icon"))}, label at ${x(row.querySelector(".label"))}`);
      let line = dock().renderRoot.querySelector(".separator").getBoundingClientRect();
      check(line.height == 1 && line.top > row.getBoundingClientRect().bottom
        && line.bottom < tabList().newTabButton.getBoundingClientRect().top, "no line between the Dock and the tab list");
      // Its menu offers to undock it: back in the tab list, gone from the Dock.
      items = await tabMenu(dockRowFor(a), "undock");
      check(items.includes("orbito-tab-menu-undock") && !items.includes("orbito-tab-menu-dock"), `items ${items}`);
      await wait(() => !storedDock().length && !shell.docks.dockOf(a), "the entry to go");
      await docksMatch();
      await rows();
      check(rowFor(a) && a.isConnected, "the undocked tab did not come back to the list");
      await listMatchesGBrowser();
    } finally {
      await resetDocks();
    }
    """)


@test
def dragging_tabs_onto_the_dock_docks_them_and_rows_move_and_undock_by_drag(b):
    start = b.js("""
    await resetPins();
    await resetDocks();
    await resetSpaces();
    await onlyBlankTab();
    for (let title of ["Drag dock A", "Drag dock B", "Drag dock C"]) {
      await openPage(title);
    }
    await rows();
    return middle(rowFor(byLabel("Drag dock A")));
    """)
    # With no Dock tab, a drag opens a small invisible strip to drop on,
    # under the Pin grid's drop place.
    x, y = start
    hold = b.m.actions.sequence("pointer", "mouse", pointer_params={"pointerType": "mouse"})
    hold.pointer_move(round(x), round(y)).pointer_down()
    hold.pointer_move(round(x), round(y + 10), duration=50).pointer_move(round(x), round(y + 20), duration=50)
    hold.perform()
    try:
        hint = b.js("""
        await wait(() => dock().list.hasAttribute("dropping") && shown(dock().list), "the Dock's drop strip");
        let style = win.getComputedStyle(dock().list);
        check(style.outlineStyle == "none" && style.backgroundColor == "rgba(0, 0, 0, 0)", `the drop strip shows: ${style.outlineStyle} ${style.backgroundColor}`);
        let grid = pinGrid().grid.getBoundingClientRect();
        let list = dock().list.getBoundingClientRect();
        check(list.height >= 8, `the drop strip is ${list.height}px`);
        check(list.top >= grid.bottom, `the Dock's drop place (${list.top}) is under the grid's (${grid.bottom})`);
        return middle(dock().list);
        """)
        drop = b.m.actions.sequence("pointer", "mouse", pointer_params={"pointerType": "mouse"})
        drop.pointer_move(round(hint[0]), round(hint[1] + 2), duration=50).pointer_move(round(hint[0]), round(hint[1]), duration=50).pointer_up()
        drop.perform()
    finally:
        b.m.actions.release()
    start, end = b.js("""
    let a = byLabel("Drag dock A");
    await wait(() => storedDock().length == 1 && shell.docks.dockOf(a), "the dropped tab to be docked");
    await docksMatch();
    check(!a.pinned && !pinGrid().hasAttribute("dropping") && !dock().hasAttribute("dropping") && !tabList().dragging, "the drag did not end");
    await listMatchesGBrowser();
    // C onto the top half of A's row: before it. The empty Pin grid's drop
    // place stays off the Dock's rows meanwhile.
    let r = dockRowFor(a).getBoundingClientRect();
    return [middle(rowFor(byLabel("Drag dock C"))), [r.left + r.width / 2, r.top + 6]];
    """)
    x, y = start
    hold = b.m.actions.sequence("pointer", "mouse", pointer_params={"pointerType": "mouse"})
    hold.pointer_move(round(x), round(y)).pointer_down()
    hold.pointer_move(round(end[0]), round(end[1] + 8), duration=50).pointer_move(round(end[0]), round(end[1] + 4), duration=50)
    hold.perform()
    try:
        b.js("""
        await wait(() => pinGrid().grid.hasAttribute("dropping") && dock().list.hasAttribute("dropping"), "both drop places");
        let grid = pinGrid().grid.getBoundingClientRect();
        let row = dockRowFor(shell.docks.tabsIn()[0]).getBoundingClientRect();
        check(grid.bottom <= row.top, `the grid's drop place (${grid.bottom}) covers the Dock's row (${row.top})`);
        """)
        drop = b.m.actions.sequence("pointer", "mouse", pointer_params={"pointerType": "mouse"})
        drop.pointer_move(round(end[0]), round(end[1]), duration=50).pointer_up()
        drop.perform()
    finally:
        b.m.actions.release()
    start, end = b.js("""
    await wait(() => dockLabels() == "Drag dock C,Drag dock A", "C to be docked before A");
    await docksMatch();
    check(storedDock().map(e => e.title).join() == "Drag dock C,Drag dock A", "the list is in another order");
    // Dragging a row moves it: C after A.
    let [c, a] = shell.docks.tabsIn();
    let r = dockRowFor(a).getBoundingClientRect();
    return [middle(dockRowFor(c)), [r.left + r.width / 2, r.bottom - 4]];
    """)
    b.drag(start, end)
    start, end = b.js("""
    await wait(() => storedDock().map(e => e.title).join() == "Drag dock A,Drag dock C", "the rows to swap");
    await docksMatch();
    check(dockLabels() == "Drag dock A,Drag dock C", dockLabels());
    // Dropped on the tab list, a Dock tab is undocked.
    return [middle(dockRowFor(byLabel("Drag dock C"))), middle(rowFor(byLabel("Drag dock B")))];
    """)
    b.drag(start, end)
    x, y = b.js("""
    let c = byLabel("Drag dock C");
    await wait(() => !shell.docks.dockOf(c) && storedDock().length == 1, "the row dropped on the list to be undocked");
    await docksMatch();
    await listMatchesGBrowser();
    check(c.isConnected && rowFor(c), "the undocked tab is not in the list");
    check(!tabList().hasAttribute("undock-drop"), "the list still shows a drop");
    return middle(dockRowFor(byLabel("Drag dock A")));
    """)
    # A short press on a row selects it; it does not move it.
    b.pointer((x, y), "down", (x + 2, y + 1), "up")
    b.js("""
    await wait(() => win.gBrowser.selectedTab == byLabel("Drag dock A"), "the click to select the Dock tab");
    check(storedDock().length == 1, "a click moved the row");
    await resetDocks();
    """)


@test
def closing_a_dock_tab_keeps_its_place_unloaded_at_the_docked_url(b):
    b.js("""
    await resetDocks();
    await resetSpaces();
    await onlyBlankTab();
    let a = await openPage("Docked home");
    let other = await openPage("Dock close other");
    shell.docks.dockTab(a);
    await docksMatch();
    try {
      // It goes elsewhere, then is closed (selected, with its close button).
      win.gBrowser.selectedTab = a;
      a.linkedBrowser.loadURI(Services.io.newURI(pageURL("Dock went away")), {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
      await wait(() => a.linkedBrowser.contentTitle == "Dock went away", "the Dock tab to go elsewhere");
      check(storedDock()[0].url == pageURL("Docked home"), "the entry follows the tab's page");
      await dock().updateComplete;
      dockRowFor(a).querySelector(".close").click();
      await wait(() => !a.isConnected && shell.docks.tabsIn().length == 1, "a tab in the Dock's place again");
      await docksMatch();
      let again = shell.docks.tabsIn()[0];
      // The place stays, at the docked page, unloaded, not selected.
      check(storedDock().length == 1 && again.label == "Docked home", dockLabels());
      check(!again.linkedPanel && !again.selected, "the Dock's new tab is loaded");
      check(again.linkedBrowser.currentURI.spec == pageURL("Docked home"), again.linkedBrowser.currentURI.spec);
      check(win.gBrowser.selectedTab != again && !win.gBrowser.selectedTab.closing, "the resting tab was selected");
      check(dockRowFor(again).hasAttribute("resting") && !dockRowFor(again).querySelector(".close"),
        "the row does not show the tab at rest");
      // Selected again, it opens the docked page.
      dockRowFor(again).click();
      await wait(() => again.linkedPanel && again.linkedBrowser.contentTitle == "Docked home", "the docked page to load");
      await dock().updateComplete;
      check(!dockRowFor(again).hasAttribute("resting"), "the row still shows the tab at rest");
      // Reopening a closed Dock tab gives the place that tab back, not a second one.
      win.gBrowser.selectedTab = other;
      win.gBrowser.removeTab(again, { animate: false });
      await wait(() => shell.docks.tabsIn().length == 1 && !again.isConnected, "the place again");
      check(SessionStore.getClosedTabDataForWindow(win)[0].title == "Docked home", "the closed tab is not the last closed");
      SessionStore.undoCloseTab(win, 0);
      await wait(() => shell.docks.tabsIn().some(t => t.linkedPanel && t.label == "Docked home"), "the reopened tab");
      await docksMatch();
      check(shell.docks.tabsIn().length == 1 && storedDock().length == 1, dockLabels());
      // A Space whose other tabs all close gets a new tab: its Dock tab at
      // rest stays so.
      win.gBrowser.selectedTab = other;
      win.gBrowser.removeTab(shell.docks.tabsIn()[0], { animate: false });
      await wait(() => shell.docks.tabsIn().length == 1 && shell.docks.isResting(shell.docks.tabsIn()[0]), "the Dock tab at rest");
      let resting = shell.docks.tabsIn()[0];
      for (let tab of spaces().tabsIn(spaces().current).filter(t => t != other && t != resting)) {
        win.gBrowser.removeTab(tab, { animate: false });
      }
      win.gBrowser.removeTab(other, { animate: false });
      await wait(() => !other.isConnected && !win.gBrowser.selectedTab.closing, "the last tab to close");
      check(win.gBrowser.selectedTab != resting, "the Dock tab at rest was selected");
      // Firefox picks it as the closed tab's successor first: it goes back
      // to rest.
      await wait(() => !resting.linkedPanel, "the Dock tab to be unloaded again");
      await dock().updateComplete;
      check(shell.docks.isResting(resting) && dockRowFor(resting).hasAttribute("resting"), "the Dock tab is not at rest");
      check(shell.docks.isResting(resting), "closing the Space's last tab loaded its Dock tab");
    } finally {
      await resetDocks();
    }
    """)


@test
def every_window_follows_the_dock_of_its_space(b):
    b.js("""
    await resetDocks();
    await resetSpaces();
    await onlyBlankTab();
    let a = await openPage("Shared dock A");
    let bTab = await openPage("Shared dock B");
    shell.docks.dockTab(a);
    shell.docks.dockTab(bTab);
    await docksMatch();
    let other = win.OpenBrowserWindow();
    let priv = null;
    try {
      await wait(() => other.gBrowserInit?.delayedStartupFinished && other.OrbitoShell?.docks, "the new window");
      // A new window shows the same Dock, none of it loaded.
      await docksMatch(other);
      let docks = other.OrbitoShell.docks;
      await wait(() => dockLabels(other) == "Shared dock A,Shared dock B", `labels ${dockLabels(other)}`);
      check(docks.tabsIn().every(t => !t.linkedPanel), "a Dock tab loaded with the window");
      check((await dockRows(other)).every(r => r.hasAttribute("resting")), "a Dock tab at rest shows awake");
      // Added in one window, it shows unloaded in the other.
      let c = await openPage("Shared dock C");
      shell.docks.dockTab(c, 0);
      await docksMatch(other);
      check(dockLabels(other) == "Shared dock C,Shared dock A,Shared dock B", dockLabels(other));
      check(!docks.tabsIn()[0].linkedPanel, "the new entry's tab in the other window is loaded");
      // Moved in the other window, it moves in this one.
      let [oc, oa] = docks.tabsIn();
      other.gBrowser.moveTabAfter(oc, docks.tabsIn().at(-1));
      await wait(() => dockLabels() == "Shared dock A,Shared dock B,Shared dock C", `order ${dockLabels()}`);
      await docksMatch();
      await docksMatch(other);
      // Selecting a row loads its page.
      await dockRows(other);
      dockRowFor(oa, other).click();
      await wait(() => oa.linkedPanel && oa.linkedBrowser.contentTitle == "Shared dock A", "the Dock tab to load");
      check(!docks.tabsIn()[1].linkedPanel, "selecting a Dock tab loaded another");
      // Removed in one window: the other's loaded tab stays as a plain tab,
      // its unloaded ones close.
      shell.docks.undockTab(a);
      shell.docks.undockTab(c);
      await wait(() => storedDock().length == 1, "the entries to go");
      await docksMatch(other);
      check(dockLabels(other) == "Shared dock B", dockLabels(other));
      check(oa.isConnected && !docks.dockOf(oa), "the loaded tab of a removed entry is gone");
      check(!other.gBrowser.tabs.some(t => t.label == "Shared dock C"), "the unloaded tab of a removed entry stayed");
      await listMatchesGBrowser(other);
      // A private window shows the Dock but changes none.
      priv = win.OpenBrowserWindow({ private: true });
      await wait(() => priv.gBrowserInit?.delayedStartupFinished && priv.OrbitoShell?.docks, "the private window");
      await docksMatch(priv);
      check(!priv.OrbitoShell.docks.canAdd, "a private window can change the Dock");
      let tab = await openPage("Private dock page", priv);
      priv.OrbitoShell.docks.dockTab(tab);
      check(!priv.OrbitoShell.docks.dockOf(tab) && storedDock().length == 1, "a private tab was docked");
    } finally {
      for (let w of [other, priv].filter(Boolean)) {
        await new Promise(resolve => {
          w.addEventListener("unload", resolve, { once: true });
          w.close();
        });
      }
      await resetDocks();
    }
    """)


@test
def switching_spaces_switches_the_dock(b):
    b.js("""
    await resetDocks();
    await resetSpaces();
    await onlyBlankTab();
    let first = spaces().current;
    let a = await openPage("Space dock A");
    shell.docks.dockTab(a);
    await docksMatch();
    try {
      check(shell.sidebar.spaceBody.contains(dock().assignedSlot), "the Dock does not slide with the Space");
      let second = await newSpace();
      await docksMatch();
      // The new Space has a Dock of its own, empty.
      check(!dockRowFor(a) && dock().hasAttribute("empty") && a.hidden, "the first Space's Dock shows");
      let bTab = await openPage("Space dock B");
      shell.docks.dockTab(bTab);
      await wait(() => storedDock(second.id).length == 1, "the second Space's Dock");
      await docksMatch();
      check(storedDock(first).length == 1 && dockLabels() == "Space dock B", dockLabels());
      // Back and forth: each Space shows its own.
      spaces().switchTo(first);
      await docksMatch();
      check(dockLabels() == "Space dock A" && !a.hidden && bTab.hidden, dockLabels());
      spaces().switchTo(second.id);
      await docksMatch();
      check(dockLabels() == "Space dock B", dockLabels());
      // Closed, and the Space's other tabs closed while it is not shown:
      // switching back opens a new tab rather than load the tab at rest.
      spaces().switchTo(first);
      win.gBrowser.selectedTab = win.gBrowser.visibleTabs.find(t => !shell.docks.dockOf(t) && !t.pinned);
      win.gBrowser.removeTab(a, { animate: false });
      await wait(() => shell.docks.tabsIn().length == 1 && shell.docks.isResting(shell.docks.tabsIn()[0]), "the Dock tab at rest");
      let resting = shell.docks.tabsIn()[0];
      spaces().switchTo(second.id);
      for (let tab of spaces().tabsIn(first).filter(t => !shell.docks.dockOf(t))) {
        win.gBrowser.removeTab(tab, { animate: false });
      }
      await wait(() => spaces().tabsIn(first).length == 1, "only the Dock tab left in the first Space");
      spaces().switchTo(first);
      await docksMatch();
      check(shell.docks.isResting(resting) && win.gBrowser.selectedTab != resting, "switching loaded the Dock tab at rest");
    } finally {
      await resetDocks();
      await resetSpaces();
    }
    """)


@test
def the_dock_follows_the_keyboard_rules(b):
    b.js("""
    await resetPins();
    await resetDocks();
    await resetSpaces();
    await onlyBlankTab();
    for (let title of ["Key dock A", "Key dock B", "Key dock C"]) {
      shell.docks.dockTab(await openPage(title));
    }
    await openPage("Key dock page");
    await docksMatch();
    await wait(() => {
      win.gBrowser.selectedBrowser.focus();
      return shell.focusedRegion == "page";
    }, "the page to have focus");
    let names = [];
    for (let row of await dockRows()) {
      names.push(await named(row));
    }
    check(names.join() == "Key dock A,Key dock B,Key dock C", `names ${names}`);
    check((await dockRows()).filter(r => r.tabIndex == 0).length == 1, "the Dock is not one tab stop");
    """)
    try:
        # F6 to the Sidebar (the tab list), Shift+Tab back to the Dock.
        b.keys(Keys.F6)
        b.js('await wait(() => shell.focusedRegion == "sidebar", "the Sidebar");')
        for _ in range(4):
            if b.js("return !!deepActive()?.closest?.('.list[aria-label=Dock]');"):
                break
            b.keys((Keys.SHIFT, Keys.TAB))
        b.js("""
        await wait(() => deepActive()?.tab == shell.docks.tabsIn()[0], "focus on the first Dock row");
        check(deepActive().matches(":focus-visible"), "the row shows no focus");
        check(win.getComputedStyle(deepActive()).outlineStyle != "none", "no focus ring on the row");
        """)
        b.keys(Keys.ARROW_DOWN)
        b.js('await wait(() => deepActive()?.tab == shell.docks.tabsIn()[1], "Down to the next row");')
        b.keys(Keys.END)
        b.js('await wait(() => deepActive()?.tab == shell.docks.tabsIn()[2], "End to the last row");')
        b.keys(Keys.ARROW_DOWN)
        b.js('check(deepActive()?.tab == shell.docks.tabsIn()[2], "Down left the last row");')
        b.keys(Keys.HOME)
        b.js('await wait(() => deepActive()?.tab == shell.docks.tabsIn()[0], "Home to the first row");')
        b.keys(Keys.ENTER)
        b.js("""
        let tab = shell.docks.tabsIn()[0];
        await wait(() => win.gBrowser.selectedTab == tab, "Enter to select the Dock tab");
        """)
        b.keys((Keys.SHIFT, Keys.F10))
        b.js("""
        let menu = shell.pins.menu;
        await wait(() => menu.state == "open", "Shift+F10 to open the row's menu");
        check(!menu.querySelector("#orbito-tab-menu-undock").hidden && menu.querySelector("#orbito-tab-menu-dock").hidden, "the menu offers another item");
        let hidden = new Promise(r => menu.addEventListener("popuphidden", r, { once: true }));
        menu.hidePopup();
        await hidden;
        await wait(() => {
          let row = dockRowFor(shell.docks.tabsIn()[0]);
          if (deepActive() != row) {
            row.focus();
          }
          return deepActive() == row;
        }, "focus back on the row");
        """)
        b.keys(Keys.F6)
        b.js('await wait(() => shell.focusedRegion == "top-bar", "F6 from the Dock to the Top bar");')
    finally:
        b.js("await resetDocks();")


@test
def the_shell_text_focus_rings_and_icons_follow_the_design(b):
    b.js("""
    await onlyBlankTab();
    await openAssistant();
    try {
      // The design's UI stack at 13px/1.4, not the platform's chrome font.
      let row = (await rows())[0];
      for (let el of [row, shell.topBar.forwardButton, assistant.modelButton]) {
        let style = el.ownerDocument.defaultView.getComputedStyle(el);
        check(style.fontFamily.startsWith("-apple-system") && style.fontFamily.includes("Noto Sans KR"),
          `${el.localName}.${el.className}: ${style.fontFamily}`);
      }
      let text = win.getComputedStyle(shell.sidebar);
      check(text.fontSize == "13px" && Math.abs(parseFloat(text.lineHeight) - 18.2) < 0.1,
        `the Sidebar's text: ${text.fontSize}/${text.lineHeight}`);

      // Focus rings: 2px of accent, 1px outside the control.
      for (let el of [shell.topBar.forwardButton, row, assistant.modelButton]) {
        el.focus({ focusVisible: true });
        let style = win.getComputedStyle(el);
        check(el.matches(":focus-visible") && style.outlineStyle == "solid" && style.outlineWidth == "2px" &&
          style.outlineOffset == "1px" && style.outlineColor == tokenIn(el.parentNode, "--orbito-accent", "color"),
          `${el.localName}.${el.className}: ${style.outline} ${style.outlineOffset}`);
      }

      // Icons are drawn at 1.5; the window controls' stay at 1.2.
      for (let root of [shell.topBar.shadowRoot, assistant.shadowRoot, shell.sidebar.shadowRoot]) {
        let svg = root.querySelector("svg");
        check(svg && win.getComputedStyle(svg).strokeWidth == "1.5px", `${root.host.localName}: ${svg && win.getComputedStyle(svg).strokeWidth}`);
      }
      let controls = doc.getElementById("orbito-window-controls")?.shadowRoot?.querySelector("svg");
      check(!controls || win.getComputedStyle(controls).strokeWidth == "1.2px", "the window controls' icons");
    } finally {
      await closeAssistant();
    }
    """)


@test
def doorhangers_take_the_shell_tokens(b):
    b.js("""
    await onlyBlankTab();
    let PN = win.PopupNotifications;
    let panel = PN.panel;
    let shownEvent = new Promise(r => panel.addEventListener("popupshown", r, { once: true }));
    PN.show(win.gBrowser.selectedBrowser, "orbito-test", "A doorhanger", null,
      { label: "Allow", accessKey: "A", callback() {} },
      [{ label: "Block", accessKey: "B", callback() {} }]);
    await shownEvent;
    try {
      let content = panel.shadowRoot.querySelector("[part~=content]");
      let notification = panel.querySelector("popupnotification:not([hidden])");
      // moz-buttons: what shows is the box inside them.
      await notification.button.updateComplete;
      let primary = notification.button.backgroundEl;
      let secondary = notification.secondaryButton.backgroundEl;
      let look = () => ({
        background: win.getComputedStyle(content).backgroundColor,
        popover: tokenIn(panel, "--orbito-popover"),
        text: win.getComputedStyle(notification).color,
        popoverText: tokenIn(panel, "--orbito-popover-text", "color"),
        primary: win.getComputedStyle(primary).backgroundColor,
        primaryText: win.getComputedStyle(primary).color,
        accent: tokenIn(panel, "--orbito-accent"),
        accentInk: tokenIn(panel, "--orbito-accent-ink", "color"),
        secondaryBorder: win.getComputedStyle(secondary).borderTopColor,
        radius: win.getComputedStyle(content).borderTopLeftRadius,
      });
      let light = await inScheme(false, look);
      let dark = await inScheme(true, look);
      for (let [mode, l] of [["light", light], ["dark", dark]]) {
        check(l.background == l.popover && l.text == l.popoverText, `${mode}: the doorhanger is not the popover surface: ${JSON.stringify(l)}`);
        check(l.primary == l.accent && l.primaryText == l.accentInk && l.secondaryBorder == l.accent, `${mode}: its buttons are not in the accent: ${JSON.stringify(l)}`);
        check(l.radius == "12px", `${mode}: corners ${l.radius}`);
      }
      check(light.background != dark.background && light.primary != dark.primary, `light and dark look the same: ${JSON.stringify([light, dark])}`);
      let other = await withHue("155", look);
      check(other.primary == other.accent && other.primary != light.primary && other.primary != dark.primary,
        `the buttons do not follow the accent: ${JSON.stringify(other)}`);
    } finally {
      Services.prefs.clearUserPref("ui.systemUsesDarkTheme");
      let hidden = new Promise(r => panel.addEventListener("popuphidden", r, { once: true }));
      PN.getNotification("orbito-test").remove();
      await hidden;
    }
    """)


@test
def notification_bars_take_the_shell_tokens(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Bars");
    try {
      let global = await notificationBar("A window notification", { global: true, type: "PRIORITY_INFO_HIGH" });
      let bar = await notificationBar("A tab notification");
      let primary = bar.querySelector(".notification-button.primary");
      // Probes go next to the bar: its own children show only in its slots.
      let around = bar.parentNode;
      let look = () => ({
        background: win.getComputedStyle(bar).backgroundColor,
        surface: tokenIn(around, "--orbito-surface"),
        text: win.getComputedStyle(bar).color,
        orbitoText: tokenIn(around, "--orbito-text", "color"),
        icon: win.getComputedStyle(bar.shadowRoot.querySelector(".icon")).color,
        warn: tokenIn(around, "--orbito-warn", "color"),
        infoIcon: win.getComputedStyle(global.shadowRoot.querySelector(".icon")).color,
        primary: win.getComputedStyle(primary).backgroundColor,
        accent: tokenIn(around, "--orbito-accent"),
        accentColor: tokenIn(around, "--orbito-accent", "color"),
        radius: win.getComputedStyle(bar).borderTopLeftRadius,
      });
      let light = await inScheme(false, look);
      let dark = await inScheme(true, look);
      for (let [mode, l] of [["light", light], ["dark", dark]]) {
        check(l.background == l.surface && l.text == l.orbitoText, `${mode}: the bar is not a Shell surface: ${JSON.stringify(l)}`);
        check(l.primary == l.accent && l.infoIcon == l.accentColor && l.icon == l.warn, `${mode}: the accent and warning colors are not the Shell's: ${JSON.stringify(l)}`);
        check(l.radius == "10px", `${mode}: corners ${l.radius}`);
      }
      check(light.background != dark.background && light.text != dark.text, `light and dark look the same: ${JSON.stringify([light, dark])}`);
      let other = await withHue("155", look);
      check(other.primary == other.accent && other.primary != light.primary && other.primary != dark.primary,
        `the buttons do not follow the accent: ${JSON.stringify(other)}`);

      // Cards on the frame, one gap apart and from the window's edges.
      let g = global.getBoundingClientRect();
      let t = bar.getBoundingClientRect();
      let body = doc.body.getBoundingClientRect();
      check(g.left == body.left + 8 && g.right == body.right - 8 && g.top == body.top + 8, `the window's bar at ${JSON.stringify(g)}`);
      check(t.left == g.left && t.right == g.right && t.top - g.bottom == 8, `the tab's bar at ${JSON.stringify(t)}, the window's at ${JSON.stringify(g)}`);
    } finally {
      Services.prefs.clearUserPref("ui.systemUsesDarkTheme");
      closeNotificationBars();
    }
    """)


@test
def the_find_bar_opens_at_the_bottom_of_the_page_card(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Find in me");
    win.gBrowser.selectedBrowser.focus();
    await wait(() => shell.focusedRegion == "page", "the page to have focus");
    """)
    b.keys((ACCEL, "f"))
    b.js("""
    let findbar = await wait(() => win.gBrowser.getCachedFindBar(), "the find bar");
    await wait(() => !findbar.hidden && shown(findbar) && deepActive() == findbar._findField, "the find bar to open with focus");
    let container = findbar.parentNode;
    let stack = container.querySelector(".browserStack");
    let fits = async what => {
      await sleep(400); // the find bar's and the Sidebar's transitions
      let f = findbar.getBoundingClientRect();
      let c = container.getBoundingClientRect();
      let s = stack.getBoundingClientRect();
      let page = win.gBrowser.tabbox.getBoundingClientRect();
      check(f.left == s.left && f.right == s.right && Math.abs(f.bottom - c.bottom) < 1 && Math.abs(f.top - s.bottom) < 1,
        `${what}: the find bar at ${JSON.stringify(f)}, the page card at ${JSON.stringify(c)}`);
      check(c.left >= page.left && c.right <= page.right && c.bottom <= page.bottom, `${what}: the card at ${JSON.stringify(c)} is out of the page area ${JSON.stringify(page)}`);
      if (!shell.sidebar.collapsed) {
        check(f.left >= shell.sidebar.getBoundingClientRect().right, `${what}: the find bar is under the Sidebar`);
      }
      if (!shell.assistant.hidden) {
        check(f.right <= shell.assistant.getBoundingClientRect().left, `${what}: the find bar is under the Assistant panel`);
      }
    };
    await fits("open");
    let corners = el => win.getComputedStyle(el).borderBottomLeftRadius + " " + win.getComputedStyle(el).borderBottomRightRadius;
    check(corners(stack) == "0px 0px" && corners(container) == "12px 12px" && win.getComputedStyle(container).overflow == "clip",
      `the page card's corners: page ${corners(stack)}, card ${corners(container)}`);

    // It stays in the page area beside the Assistant panel and with the
    // Sidebar collapsed.
    win.OrbitoAssistant.toggle(true);
    try {
      await fits("with the Assistant panel");
    } finally {
      win.OrbitoAssistant.toggle(false);
    }
    try {
      shell.sidebar.toggleCollapsed();
      await wait(() => shell.sidebar.collapsed, "the Sidebar to collapse");
      await fits("with the Sidebar collapsed");
    } finally {
      await resetSidebar();
    }

    let look = () => ({
      background: win.getComputedStyle(findbar).backgroundColor,
      popover: tokenIn(findbar, "--orbito-popover"),
      text: win.getComputedStyle(findbar).color,
      popoverText: tokenIn(findbar, "--orbito-popover-text", "color"),
      check: win.getComputedStyle(findbar.querySelector("checkbox")).accentColor,
      accent: tokenIn(findbar, "--orbito-accent", "color"),
    });
    try {
      let light = await inScheme(false, look);
      let dark = await inScheme(true, look);
      for (let [mode, l] of [["light", light], ["dark", dark]]) {
        check(l.background == l.popover && l.text == l.popoverText && l.check == l.accent, `${mode}: the find bar is not a Shell surface: ${JSON.stringify(l)}`);
      }
      check(light.background != dark.background, `light and dark look the same: ${JSON.stringify([light, dark])}`);
      let other = await withHue("155", look);
      check(other.check == other.accent && other.check != light.check, `the find bar does not follow the accent: ${JSON.stringify(other)}`);
    } finally {
      Services.prefs.clearUserPref("ui.systemUsesDarkTheme");
    }

    // Its field shows focus in the accent; it belongs to the page's F6 region.
    let field = findbar._findField;
    field.focus();
    await wait(() => deepActive() == field, "focus in the find field");
    check(shell.focusedRegion == "page", `the find bar is in the ${shell.focusedRegion} region`);
    check(win.getComputedStyle(field).outlineColor == tokenIn(findbar, "--orbito-accent", "color") && win.getComputedStyle(field).outlineStyle == "solid",
      `the find field's focus ring: ${win.getComputedStyle(field).outline}`);
    """)
    b.keys(Keys.ESCAPE)
    b.js("""
    let findbar = win.gBrowser.getCachedFindBar();
    let stack = findbar.parentNode.querySelector(".browserStack");
    await wait(() => findbar.hidden, "the find bar to close");
    check(win.getComputedStyle(stack).borderBottomLeftRadius == "12px", `the page keeps square corners: ${win.getComputedStyle(stack).borderBottomLeftRadius}`);
    """)


@test
def menus_are_native_on_macos_and_take_the_tokens_elsewhere(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Menus");
    let menu = doc.getElementById("contentAreaContextMenu");
    let shownEvent = new Promise(r => menu.addEventListener("popupshown", r, { once: true }));
    menu.openPopup(shell.topBar, "after_start");
    await shownEvent;
    try {
      let item = [...menu.children].find(i => i.localName == "menuitem" && shown(i) && !i.disabled);
      if (AppConstants.platform == "macosx") {
        // The native menu: Firefox's look, none of the Shell's colors.
        let style = win.getComputedStyle(menu);
        check(style.appearance == "auto", `the context menu does not look native: ${style.appearance}`);
        check(style.getPropertyValue("--panel-background-color").trim() == "none", `the menu's background: ${style.getPropertyValue("--panel-background-color")}`);
        item.setAttribute("_moz-menuactive", "true");
        let active = win.getComputedStyle(item).backgroundColor;
        item.removeAttribute("_moz-menuactive");
        check(active != tokenIn(menu, "--orbito-accent-soft"), `the active item is in the accent: ${active}`);
        return;
      }
      let content = menu.shadowRoot.querySelector("[part~=content]");
      item.setAttribute("_moz-menuactive", "true");
      let look = () => ({
        background: win.getComputedStyle(content).backgroundColor,
        popover: tokenIn(menu, "--orbito-popover"),
        active: win.getComputedStyle(item).backgroundColor,
        soft: tokenIn(menu, "--orbito-accent-soft"),
      });
      let light = await inScheme(false, look);
      let dark = await inScheme(true, look);
      for (let [mode, l] of [["light", light], ["dark", dark]]) {
        check(l.background == l.popover && l.active == l.soft, `${mode}: the menu is not a Shell surface: ${JSON.stringify(l)}`);
      }
      check(light.background != dark.background, `light and dark look the same: ${JSON.stringify([light, dark])}`);
      let other = await withHue("155", look);
      check(other.active == other.soft && other.active != light.active, `the menu does not follow the accent: ${JSON.stringify(other)}`);
    } finally {
      Services.prefs.clearUserPref("ui.systemUsesDarkTheme");
      let hidden = new Promise(r => menu.addEventListener("popuphidden", r, { once: true }));
      menu.hidePopup();
      await hidden;
    }
    """)


@test
def f6_reaches_the_notification_bars(b):
    b.js("""
    await onlyBlankTab();
    await openPage("Regions with a bar");
    win.OrbitoAssistant.toggle(false);
    await notificationBar("A bar to reach");
    win.gBrowser.selectedBrowser.focus();
    await wait(() => shell.focusedRegion == "page", "the page to have focus");
    """)
    try:
        # From the page F6 wraps to the bars over the window, then on to
        # the Sidebar; Shift+F6 goes back.
        b.keys(Keys.F6)
        focus = b.js("""
        await wait(() => shell.focusedRegion == "notifications", "F6 to the notification bar");
        let el = deepActive();
        return [el.localName, el.classList.contains("primary"), await named(el), el.matches(":focus-visible"),
          win.getComputedStyle(el).outlineColor == tokenIn(el.parentNode, "--orbito-accent", "color")];
        """)
        assert focus == ["button", True, "Yes", True, True], focus
        b.keys(Keys.F6)
        b.js('await wait(() => shell.focusedRegion == "sidebar", "F6 from the bar to the Sidebar");')
        b.keys((Keys.SHIFT, Keys.F6))
        b.js('await wait(() => shell.focusedRegion == "notifications", "Shift+F6 back to the bar");')
        b.keys((Keys.SHIFT, Keys.F6))
        b.js('await wait(() => shell.focusedRegion == "page", "Shift+F6 from the bar to the page");')

        # The close button has a name and is reached with Tab.
        name = b.js("""
        let bar = shell.notifications.querySelector("notification-message");
        await bar.updateComplete;
        return accessibleName(bar.closeButton.buttonEl ?? bar.closeButton);
        """)
        assert name, name

        # Without a bar, F6 from the page goes to the Sidebar again.
        b.js("""
        closeNotificationBars();
        await wait(() => !shell.notifications.querySelector("notification-message"), "the bar to go");
        win.gBrowser.selectedBrowser.focus();
        await wait(() => shell.focusedRegion == "page", "the page to have focus");
        """)
        b.keys(Keys.F6)
        b.js('await wait(() => shell.focusedRegion == "sidebar", "F6 from the page to the Sidebar");')
    finally:
        b.js("closeNotificationBars();")


@test
def the_new_tab_page_shows_the_ask_input_and_recent_visits_only(b):
    b.js("""
    await onlyBlankTab();
    let hosts = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"];
    useSiteHosts(hosts);
    // Newest first: two pages of alpha (one chip, its latest page), a
    // non-web page, and seven sites for six places.
    await setHistory([
      [siteURL("alpha", "Alpha two"), "Alpha two"],
      [siteURL("alpha", "Alpha one"), "Alpha one"],
      ["file:///tmp/orbito-newtab-test.txt", "A file"],
      ...hosts.slice(1).map(h => [siteURL(h, h), h]),
    ]);
    let port = new URL(PAGES).port;
    try {
      for (let url of ["about:newtab", "about:home"]) {
        let { tab, page } = await openNewTabPage(url);
        let browser = tab.linkedBrowser;
        let pageDoc = browser.contentDocument;
        check(browser.currentURI.spec == url, browser.currentURI.spec);
        check(pageDoc.nodePrincipal.isSystemPrincipal && !browser.isRemoteBrowser,
          "the page is not Orbito's, in the parent process");
        check(tab.label == "New Tab", tab.label);
        // Nothing of Firefox's new tab page (Activity Stream, its search,
        // top sites, stories): only Orbito's element.
        check([...pageDoc.body.children].map(el => el.localName).join() == "orbito-new-tab",
          [...pageDoc.body.children].map(el => el.localName).join());
        check(!pageDoc.querySelector("#root, .outer-wrapper, .search-wrapper, .top-sites, [data-section-id]"),
          "Firefox's new tab page is in it");
        check([...pageDoc.scripts].every(s => s.src.startsWith("chrome://browser/content/orbito/newtab/")),
          [...pageDoc.scripts].map(s => s.src).join());
        let root = page.shadowRoot;
        let parts = () => [...root.querySelector("main").children].map(el => el.className || el.localName).join();
        // The recent visits come once the history is read.
        await wait(() => parts() == "mark,ask,nav", parts(), 5000);
        check(shown(page.input) && shown(page.recentList), "a part is not shown");
        // The input alone in its box, no send button, with the design's
        // words, padding and line.
        let box = root.querySelector(".ask");
        check(!box.querySelector("button"), "the input has a button");
        check(page.input.placeholder == "Ask anything or enter an address", page.input.placeholder);
        let boxStyle = getComputedStyle(box);
        check(boxStyle.padding == "14px 16px", boxStyle.padding);
        // The page focuses the input, which rings the box; without focus
        // it has the line.
        let focused = page.shadowRoot.activeElement == page.input;
        page.input.blur();
        check(boxStyle.boxShadow.startsWith(tokenIn(box, "--orbito-page-line", "color")) && boxStyle.boxShadow.includes(" 1px"),
          boxStyle.boxShadow);
        if (focused) {
          page.input.focus();
        }
        await wait(() => page.siteLinks.length == 6, "six recent visits");
        let labels = siteLabels(page);
        check(labels == ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"].map(h => `${h}.orbito.test:${port}`).join(), labels);
        check(page.siteLinks[0].href == siteURL("alpha", "Alpha two"), page.siteLinks[0].href);
        check(page.siteLinks[0].title == "Alpha two", page.siteLinks[0].title);
        check(page.siteLinks[0].querySelector("img").src == `page-icon:${siteURL("alpha", "Alpha two")}`, "no favicon");
        win.gBrowser.removeTab(tab);
      }

      // A page visited meanwhile comes first; with no history the list goes.
      let { tab, page } = await openNewTabPage();
      await wait(() => page.siteLinks.length == 6, "the recent visits");
      useSiteHosts([...hosts, "theta"]);
      await PlacesUtils.history.insert({ url: siteURL("theta", "Theta"), title: "Theta", visits: [{ date: new Date() }] });
      await wait(() => siteLabels(page).startsWith(`theta.orbito.test:${port},alpha`), "the new visit first");
      check(page.siteLinks.length == 6, siteLabels(page));
      await PlacesUtils.history.clear();
      await wait(() => !page.recentList, "the recent visits to go");
      check(shown(page.input), "the input went too");
      win.gBrowser.removeTab(tab);
    } finally {
      await setHistory([]);
      dropSiteHosts();
    }
    """)


@test
def asking_on_the_new_tab_page_opens_the_panel_and_shares_no_tab(b):
    b.js("""
    await onlyBlankTab();
    await resetAssistant();
    let { tab, page } = await openNewTabPage();
    // Kept on the core between scripts.
    core.testAsked = [];
    core.testAsk = core.ask;
    core.ask = async options => { core.testAsked.push(options); };
    // Typed for real: the page's input has focus once the page does.
    win.gBrowser.selectedBrowser.focus();
    await wait(() => page.shadowRoot.activeElement == page.input, "the input to take focus");
    """)
    try:
        b.keys(*"How far is the moon?", Keys.ENTER)
        b.js("""
        let tab = win.gBrowser.selectedTab;
        let page = newTabPageOf(tab);
        let asked = core.testAsked;
        await wait(() => asked.length == 1, "the question to be asked");
        let [options] = asked;
        check(options.prompt == "How far is the moon?", options.prompt);
        check(options.origin.tab == tab, "asked from another tab");
        check(options.threadId == core.threadFor(win), "another thread");
        check(options.instructions?.startsWith("The user shares no tab"), options.instructions);
        check(win.OrbitoAssistant.isOpen, "the panel did not open");
        await assistant.updateComplete;
        check(assistant.threadId == core.threadFor(win), "the panel shows another thread");
        // The panel's own setting stays; focus goes to the panel.
        check(assistant.context == "tab", assistant.context);
        await wait(() => shell.focusedRegion == "assistant", "focus in the panel");
        check(page.input.value == "", "the question stayed in the input");
        check(tab.linkedBrowser.currentURI.spec == "about:newtab", "the page navigated");
        """)
    finally:
        b.js("""
        if (core.testAsk) {
          core.ask = core.testAsk;
        }
        delete core.testAsk;
        delete core.testAsked;
        await resetAssistant();
        await onlyBlankTab();
        """)


@test
def enter_on_the_new_tab_page_goes_to_an_address_or_searches(b):
    # Enter runs what the Command bar would put first: an address loads in
    # the tab, a search goes to the default engine, and only a question
    # asks (asking_on_the_new_tab_page_opens_the_panel_and_shares_no_tab).
    b.js("""
    await onlyBlankTab();
    await resetAssistant();
    useSiteHosts(["alpha"]);
    // A typed address without a scheme stays http, as the test server is.
    Services.prefs.setBoolPref("dom.security.https_first_schemeless", false);
    let { SearchService: search } = ChromeUtils.importESModule(
      "moz-src:///toolkit/components/search/SearchService.sys.mjs"
    );
    let engine = await search.addUserEngine({
      name: "New tab engine",
      url: `${PAGES}/page/search?q={searchTerms}`,
    });
    let previous = await search.getDefault();
    await search.setDefault(engine, search.CHANGE_REASON.USER);
    win.testState = { search, engine, previous };
    core.testAsked = [];
    core.testAsk = core.ask;
    core.ask = async options => { core.testAsked.push(options); };
    let { page } = await openNewTabPage();
    win.gBrowser.selectedBrowser.focus();
    await wait(() => page.shadowRoot.activeElement == page.input, "the input to take focus");
    """)
    port = b.pages.rsplit(":", 1)[1]
    try:
        # An address without a scheme, as fixup makes it.
        b.keys(*f"alpha.orbito.test:{port}/page/Typed", Keys.ENTER)
        b.js("""
        let tab = win.gBrowser.selectedTab;
        await wait(() => tab.linkedBrowser.currentURI.spec == siteURL("alpha", "Typed") && tab.label == "Typed", "the address in the tab");
        check(core.testAsked.length == 0, "the address was asked");
        check(!win.OrbitoAssistant.isOpen, "the panel opened");
        let { page } = await openNewTabPage();
        win.gBrowser.selectedBrowser.focus();
        await wait(() => page.shadowRoot.activeElement == page.input, "the input to take focus");
        """)
        # A search, with the default engine.
        b.keys(*"zebra stripes", Keys.ENTER)
        b.js("""
        let tab = win.gBrowser.selectedTab;
        let { engine } = win.testState;
        let expected = engine.getSubmission("zebra stripes").uri.spec;
        await wait(() => tab.linkedBrowser.currentURI.spec == expected, `the search in the tab: ${tab.linkedBrowser.currentURI.spec}`);
        check(core.testAsked.length == 0, "the search was asked");
        check(!win.OrbitoAssistant.isOpen, "the panel opened");
        """)
    finally:
        b.js("""
        let { search, engine, previous } = win.testState;
        await search.setDefault(previous, search.CHANGE_REASON.USER);
        await search.removeEngine(engine);
        delete win.testState;
        if (core.testAsk) {
          core.ask = core.testAsk;
        }
        delete core.testAsk;
        delete core.testAsked;
        Services.prefs.clearUserPref("dom.security.https_first_schemeless");
        dropSiteHosts();
        await resetAssistant();
        await onlyBlankTab();
        """)


@test
def a_recent_visit_opens_its_page(b):
    b.js("""
    await onlyBlankTab();
    useSiteHosts(["alpha", "beta"]);
    await setHistory([[siteURL("alpha", "Alpha"), "Alpha"], [siteURL("beta", "Beta"), "Beta"]]);
    try {
      // A middle click opens it in a new tab (in the background or not,
      // as Firefox's setting says).
      let { tab, page } = await openNewTabPage();
      await wait(() => page.siteLinks.length == 2, "the recent visits");
      let count = win.gBrowser.tabs.length;
      let [alpha, beta] = page.siteLinks;
      let rect = beta.getBoundingClientRect();
      let options = { bubbles: true, cancelable: true, button: 1, clientX: rect.left + 4, clientY: rect.top + 4 };
      beta.dispatchEvent(new page.ownerDocument.defaultView.MouseEvent("auxclick", options));
      await wait(() => win.gBrowser.tabs.length == count + 1, "a new tab");
      await wait(() => byLabel("Beta"), "Beta to load");
      check(win.gBrowser.tabs.length == count + 1, "more than one tab opened");
      check(tab.linkedBrowser.currentURI.spec == "about:newtab", "the page navigated");
      win.gBrowser.selectedTab = tab;

      // A click (or Enter) opens it in this tab.
      alpha.click();
      await wait(() => tab.linkedBrowser.currentURI.spec == siteURL("alpha", "Alpha") && tab.label == "Alpha", "Alpha in the tab");
      check(win.gBrowser.tabs.length == count + 1, "the click opened a tab");
    } finally {
      await setHistory([]);
      dropSiteHosts();
      await onlyBlankTab();
    }
    """)


@test
def the_new_tab_page_follows_the_keyboard_rules(b):
    b.js("""
    await onlyBlankTab();
    await resetAssistant();
    useSiteHosts(["alpha", "beta", "gamma"]);
    await setHistory(["alpha", "beta", "gamma"].map(h => [siteURL(h, h), h]));
    let { page } = await openNewTabPage();
    await wait(() => page.siteLinks.length == 3, "the recent visits");
    shell.sidebar.focusRegion();
    await wait(() => shell.focusedRegion == "sidebar", "focus in the Sidebar");
    """)
    port = b.pages.rsplit(":", 1)[1]
    state = """
    let page = newTabPageOf(win.gBrowser.selectedTab);
    let el = page.shadowRoot.activeElement;
    let links = [...page.siteLinks];
    let focusedOn = el == page.input ? "input" : links.includes(el) ? `site ${links.indexOf(el)}` : el?.localName ?? "none";
    """
    try:
        # F6 from the Top bar lands in the page, on the Ask input.
        b.keys(Keys.F6, Keys.F6)
        b.js(state + """
        await wait(() => shell.focusedRegion == "page", "F6 to the page");
        await wait(() => page.shadowRoot.activeElement == page.input, "the input to take focus");
        """)
        # Names: the input, the list and each visit.
        names = b.js("""
        let page = newTabPageOf(win.gBrowser.selectedTab);
        return [await named(page.input),
          await named(page.shadowRoot.querySelector("nav")), ...await Promise.all([...page.siteLinks].map(named))];
        """)
        assert names == ["Ask or enter address", "Recent visits"] + [f"{h}.orbito.test:{port}" for h in ("alpha", "beta", "gamma")], names

        # Tab goes on to the visits, one tab stop that the arrows, Home and
        # End move in.
        steps = [
            (Keys.TAB, "site 0"),
            (Keys.ARROW_RIGHT, "site 1"),
            (Keys.END, "site 2"),
            (Keys.ARROW_RIGHT, "site 2"),
            (Keys.HOME, "site 0"),
            (Keys.ARROW_LEFT, "site 0"),
            (Keys.ARROW_DOWN, "site 1"),
            ((Keys.SHIFT, Keys.TAB), "input"),
            (Keys.TAB, "site 1"),
        ]
        for key, expected in steps:
            b.keys(key)
            got = b.js(state + "return focusedOn;")
            assert got == expected, f"{key!r}: {got} != {expected}"
        ring = b.js(state + """
        return [el.matches(":focus-visible"), getComputedStyle(el).outlineStyle,
          getComputedStyle(el).outlineColor == tokenIn(el.parentNode, "--orbito-accent", "color")];
        """)
        assert ring == [True, "solid", True], ring
        # The input's focus shows on its box.
        b.keys((Keys.SHIFT, Keys.TAB))
        ring = b.js(state + """
        let box = page.shadowRoot.querySelector(".ask");
        await wait(() => getComputedStyle(box).boxShadow.includes("1.5px"), "the box's ring");
        return getComputedStyle(box).boxShadow.startsWith(tokenIn(box, "--orbito-accent", "color"));
        """)
        assert ring, ring

        # F6 from the page moves on to the Sidebar; Enter on a visit opens it.
        b.keys(Keys.F6)
        b.js('await wait(() => shell.focusedRegion == "sidebar", "F6 from the page to the Sidebar");')
        b.keys((Keys.SHIFT, Keys.F6))
        b.js(state + """
        await wait(() => shell.focusedRegion == "page", "Shift+F6 back to the page");
        await wait(() => page.shadowRoot.activeElement == page.input, "focus back on the input");
        """)
        b.keys(Keys.TAB, Keys.ENTER)
        b.js("""
        let tab = win.gBrowser.selectedTab;
        await wait(() => tab.label == "beta", "Enter to open the visit");
        """)
    finally:
        b.js("await setHistory([]); dropSiteHosts(); await onlyBlankTab();")


@test
def the_command_bar_keeps_focus_over_the_new_tab_page(b):
    # Firefox focuses the urlbar for a new tab page it opens (a new window,
    # the last tab closed): the Command bar opens over the page, which
    # leaves focus there, and the page's input takes it once it closes.
    b.js("""
    await onlyBlankTab();
    await openPage("Before the new tab page");
    win.gBrowser.selectedBrowser.focus();
    win.openTrustedLinkIn("about:newtab", "tab");
    let tab = win.gBrowser.selectedTab;
    let page = await wait(() => newTabPageOf(tab), "the new tab page");
    check(shell.commandBar.isOpen && win.gURLBar.focused, "the Command bar did not open");
    await sleep(300);
    check(shell.commandBar.isOpen && win.gURLBar.focused, "the page took focus from the Command bar");
    """)
    try:
        b.keys(Keys.ESCAPE)
        b.js("""
        let page = newTabPageOf(win.gBrowser.selectedTab);
        await wait(() => !shell.commandBar.isOpen, "the Command bar to close");
        await wait(() => shell.focusedRegion == "page" && page.shadowRoot.activeElement == page.input, "focus on the page's input");
        """)
    finally:
        b.js("shell.commandBar.close(); await onlyBlankTab();")


@test
def light_dark_and_the_accent_from_the_settings_change_every_window_at_once(b):
    b.js("""
    await onlyBlankTab();
    resetAppearance();
    Services.prefs.setIntPref("ui.systemUsesDarkTheme", 0);
    let other = win.OpenBrowserWindow();
    try {
      await wait(() => other.gBrowserInit?.delayedStartupFinished && other.OrbitoShell?.topBar, "the other window");
      let newTab = (await openNewTabPage()).page.ownerDocument;
      // (From a new tab page, the settings would take its tab.)
      await openPage("Look");
      let settings = await openOrbitoSettings();
      // Accent, then text or page color: the Shell of both windows, the new
      // tab page (in the background) and the settings page itself.
      let look = () => ({
        window: [tokenIn(doc.body, "--orbito-accent", "color"), tokenIn(doc.body, "--orbito-text", "color")],
        other: [tokenIn(other.document.body, "--orbito-accent", "color"), tokenIn(other.document.body, "--orbito-text", "color")],
        newTab: [tokenIn(newTab.body, "--orbito-accent", "color"), newTab.defaultView.getComputedStyle(newTab.body).backgroundColor],
        settings: [tokenIn(settings.body, "--orbito-accent", "color"), settings.defaultView.getComputedStyle(settings.body).backgroundColor],
      });
      let checked = group => settings.querySelector(`#${group} [aria-checked=true]`)?.dataset.value;
      // The text on both pages is the page's ink, not the frame's.
      let pageInk = () => {
        for (let page of [newTab, settings]) {
          let color = page.defaultView.getComputedStyle(page.body).color;
          check(color == tokenIn(page.body, "--orbito-page-text", "color"), `${page.documentURI} text is ${color}`);
        }
      };
      let light = look();
      pageInk();
      check(checked("theme") == "system" && checked("accent") == "violet", `picked ${checked("theme")}, ${checked("accent")}`);

      radioIn(settings, "theme", "dark").click();
      await wait(() => checked("theme") == "dark", "Dark to be picked");
      let dark = look();
      pageInk();
      for (let [where, [accent, color]] of Object.entries(dark)) {
        check(color != light[where][1], `${where} stayed light: ${color}`);
      }
      for (let w of [win, other]) {
        check(w.getComputedStyle(w.document.documentElement).colorScheme == "dark", "a window is not dark");
      }

      radioIn(settings, "accent", "green").click();
      await wait(() => checked("accent") == "green", "Green to be picked");
      let green = look();
      for (let [where, [accent]] of Object.entries(green)) {
        check(accent != dark[where][0], `${where} kept its accent: ${accent}`);
      }
      check(Services.prefs.getStringPref(ACCENT_PREF) == "green", "the accent is not kept");

      // System follows the OS again: dark now, the same look as Dark.
      radioIn(settings, "theme", "system").click();
      await wait(() => checked("theme") == "system", "System to be picked");
      await wait(() => look().window[1] != green.window[1], "System to go back to the light OS");
      Services.prefs.setIntPref("ui.systemUsesDarkTheme", 1);
      await wait(() => win.matchMedia("(prefers-color-scheme: dark)").matches, "dark mode");
      await wait(() => JSON.stringify(look()) == JSON.stringify(green), `System to follow the OS: ${JSON.stringify(look())} != ${JSON.stringify(green)}`);
    } finally {
      other.close();
      resetAppearance();
      Services.prefs.clearUserPref("ui.systemUsesDarkTheme");
      await onlyBlankTab();
    }
    """)


@test
def the_advanced_link_opens_firefox_settings_without_the_shells_sections(b):
    b.js("""
    await onlyBlankTab();
    let settings = await openOrbitoSettings();
    let button = settings.getElementById("open-firefox-settings");
    check(await named(button) == "Open Firefox settings", "the link has no name");
    button.click();
    let page = await wait(() => {
      let d = win.gBrowser.selectedBrowser.contentDocument;
      return d?.documentURI.startsWith("about:preferences") && d.getElementById("category-search")?.checkVisibility() && d;
    }, "Firefox's settings");
    check(byLabel("Orbito Settings"), "Orbito's settings were replaced");
    // The Appearance pane (themes, website appearance, density) has no way in.
    check(!shown(page.getElementById("category-appearance")), "the Appearance pane is listed");
    for (let id of ["category-sync", "category-home", "category-search", "category-privacy", "category-tabs-browsing"]) {
      check(shown(page.getElementById(id)), `${id} is not listed`);
    }
    page = await firefoxSettingsAt("paneAppearance", "relatedSettings");
    for (let groupid of ["appearance", "browserTheme", "windowDensity"]) {
      let group = page.querySelector(`setting-group[groupid="${groupid}"]`);
      check(group && !group.checkVisibility(), `the ${groupid} group shows`);
    }
    // Tabs and browsing: no layout choice and no tab strip options, the rest stays.
    page = await firefoxSettingsAt("paneTabsBrowsing", "tabs");
    check(!page.querySelector('setting-group[groupid="browserLayout"]').checkVisibility(), "the layout choice shows");
    for (let id of ["tabPreviewShowThumbnails", "tabGroupDragToCreate"]) {
      check(!page.getElementById(`setting-control-${id}`).checkVisibility(), `${id} shows`);
    }
    for (let id of ["linkTargeting", "warnCloseMultiple"]) {
      check(page.getElementById(`setting-control-${id}`).checkVisibility(), `${id} is hidden`);
    }
    check(page.querySelector('setting-group[groupid="tabs"]').checkVisibility(), "the tab options are hidden");
    // Home: where new windows and tabs go stays.
    page = await firefoxSettingsAt("paneHome", "homepage");
    check(page.querySelector('setting-group[groupid="homepage"]').checkVisibility(), "the home page choice is hidden");
    check(!page.querySelector('setting-group[groupid="home"]')?.checkVisibility(), "Firefox Home's content shows");
    // Language: the app's is picked in Orbito's settings; the pages' stays.
    page = await firefoxSettingsAt("paneLanguages", "websiteLanguage");
    check(!page.querySelector('setting-group[groupid="browserLanguage"]').checkVisibility(), "Firefox's language picker shows");
    await onlyBlankTab();
    """)


@test
def the_account_section_signs_in_turns_on_and_manages_sync(b):
    b.js("""
    await onlyBlankTab();
    const { UIState } = ChromeUtils.importESModule("resource://services-sync/UIState.sys.mjs");
    let calls = [];
    let names = ["openFxAEmailFirstPage", "openSignInAgainPage", "verifyAccount", "openSyncSetupForEntryPoint",
      "doSync", "openPrefs", "openFxAManagePage", "disconnect"];
    let saved = Object.fromEntries(names.map(n => [n, win.gSync[n]]));
    for (let n of names) {
      win.gSync[n] = (...args) => calls.push([n, ...args]);
    }
    let get = UIState.get;
    let state = { status: UIState.STATUS_NOT_CONFIGURED };
    UIState.get = () => ({ ...state });
    try {
      let settings = await openOrbitoSettings();
      let status = () => settings.getElementById("sync-status").textContent;
      let buttons = () => [...settings.querySelectorAll("#sync-actions button")];
      let labels = () => buttons().map(button => button.textContent).join(",");
      let show = async next => {
        state = next;
        Services.obs.notifyObservers(null, UIState.ON_UPDATE);
        await sleep(0);
      };
      let press = label => {
        calls = [];
        buttons().find(button => button.textContent == label).click();
        return JSON.stringify(calls);
      };
      let email = "someone@example.com";

      check(status() == "Not signed in." && labels() == "Sign in", `${status()} [${labels()}]`);
      check(press("Sign in") == '[["openFxAEmailFirstPage","orbito-settings"]]', press("Sign in"));

      await show({ status: UIState.STATUS_SIGNED_IN, email, syncEnabled: false });
      check(status() == `Signed in as ${email}. Sync is off.` && labels() == "Manage account,Turn on sync", `${status()} [${labels()}]`);
      check(press("Turn on sync") == '[["openSyncSetupForEntryPoint","orbito-settings"]]', "Turn on sync");
      check(press("Manage account") == '[["openFxAManagePage","orbito-settings"]]', "Manage account");

      let lastSync = new Date(2026, 9, 23, 9, 30);
      await show({ status: UIState.STATUS_SIGNED_IN, email, syncEnabled: true, lastSync });
      check(status() == `Signed in as ${email}. Last synced ${lastSync.toLocaleString()}.`, status());
      check(labels() == "Manage account,Choose what to sync,Sync now", labels());
      check(press("Sync now") == '[["doSync"]]', "Sync now");
      check(press("Choose what to sync") == '[["openPrefs","orbito-settings",null,{"action":"choose-what-to-sync"}]]', "Choose what to sync");
      // While it syncs, Sync now waits; the same button stays (keeps focus).
      let syncNow = buttons().at(-1);
      syncNow.focus();
      await show({ status: UIState.STATUS_SIGNED_IN, email, syncEnabled: true, lastSync, syncing: true });
      check(status() == `Signed in as ${email}. Syncing…` && buttons().at(-1) == syncNow && syncNow.disabled, "Sync now while syncing");

      await show({ status: UIState.STATUS_LOGIN_FAILED, email });
      check(labels() == "Sign out,Sign in again" && status().includes(email), `${status()} [${labels()}]`);
      check(press("Sign in again") == '[["openSignInAgainPage","orbito-settings"]]', "Sign in again");
      check(press("Sign out") == '[["disconnect"]]', "Sign out");

      await show({ status: UIState.STATUS_NOT_VERIFIED, email });
      check(labels() == "Sign out,Confirm account", labels());
      check(press("Confirm account") == '[["verifyAccount"]]', "Confirm account");
    } finally {
      UIState.get = get;
      Object.assign(win.gSync, saved);
      Services.obs.notifyObservers(null, UIState.ON_UPDATE);
      await onlyBlankTab();
    }
    """)


@test
def the_orbito_settings_follow_the_keyboard_rules(b):
    b.js("""
    await onlyBlankTab();
    resetAppearance();
    await openOrbitoSettings();
    shell.sidebar.focusRegion();
    await wait(() => shell.focusedRegion == "sidebar", "focus in the Sidebar");
    """)
    state = """
    let page = win.gBrowser.selectedBrowser.contentDocument;
    let el = page.activeElement;
    let focusedOn = el?.getAttribute("role") == "radio" ? `${el.parentNode.id} ${el.dataset.value}`
      : el?.type == "checkbox" ? el.id : el?.textContent ?? "none";
    """
    try:
        b.keys(Keys.F6, Keys.F6)
        b.js('await wait(() => shell.focusedRegion == "page", "F6 to the page");')
        # Names: each radio group and radio, and the section's buttons.
        names = b.js("""
        let page = win.gBrowser.selectedBrowser.contentDocument;
        let els = [page.getElementById("theme"), ...page.querySelectorAll("#theme [role=radio]"),
          page.getElementById("accent"), ...page.querySelectorAll("#accent [role=radio]"),
          page.getElementById("language"), ...page.querySelectorAll("#language [role=radio]"),
          page.querySelector("#sync-actions button"), page.getElementById("open-firefox-settings")];
        return Promise.all(els.map(named));
        """)
        assert names == ["Theme", "System", "Light", "Dark", "Accent color", "Violet", "Blue", "Green", "Coral",
                         "Graphite", "Language", "English", "한국어", "Sign in", "Open Firefox settings"], names

        # The library link, then each radio group is one tab stop on its
        # picked radio; the arrows, Home and End pick another.
        steps = [
            (Keys.TAB, "library"),
            (Keys.TAB, "theme system"),
            (Keys.ARROW_RIGHT, "theme light"),
            (Keys.END, "theme dark"),
            (Keys.ARROW_RIGHT, "theme system"),
            (Keys.ARROW_LEFT, "theme dark"),
            (Keys.HOME, "theme system"),
            (Keys.ARROW_DOWN, "theme light"),
            (Keys.TAB, "accent violet"),
            (Keys.ARROW_LEFT, "accent graphite"),
            (Keys.ARROW_UP, "accent coral"),
            ((Keys.SHIFT, Keys.TAB), "theme light"),
            (Keys.TAB, "accent coral"),
            (Keys.TAB, "language en-US"),
            (Keys.TAB, "sidebar-collapsed"),
            (Keys.TAB, "assistant-auto-open"),
            (Keys.TAB, "Sign in"),
        ]
        for key, expected in steps:
            b.keys(key)
            got = b.js(state + "return focusedOn;")
            assert got == expected, f"{key!r}: {got} != {expected}"
        picked = b.js("return [Services.prefs.getStringPref(THEME_PREF), Services.prefs.getStringPref(ACCENT_PREF)];")
        assert picked == ["light", "coral"], picked

        # Back over the Layout checkboxes and the language to the accent.
        for _ in range(4):
            b.keys((Keys.SHIFT, Keys.TAB))
        assert b.js(state + "return focusedOn;") == "accent coral"
        ring = b.js(state + """
        return [el.matches(":focus-visible"), getComputedStyle(el).outlineStyle,
          getComputedStyle(el).outlineColor == tokenIn(el.parentNode, "--orbito-accent", "color")];
        """)
        assert ring == [True, "solid", True], ring

        # F6 from the page moves on; Shift+F6 comes back to the page.
        b.keys(Keys.F6)
        b.js('await wait(() => shell.focusedRegion != "page", "F6 out of the page");')
        b.keys((Keys.SHIFT, Keys.F6))
        b.js('await wait(() => shell.focusedRegion == "page", "Shift+F6 back to the page");')
    finally:
        b.js("resetAppearance(); await onlyBlankTab();")


@test
def add_ons_cannot_install_themes(b):
    b.js("""
    let id = "a-theme@orbito.test";
    let xpi = PathUtils.join(PathUtils.tempDir, "orbito-test-theme.xpi");
    let dir = PathUtils.join(PathUtils.tempDir, `orbito-test-${id}`);
    let looks = [];
    let observer = subject => looks.push(subject.wrappedJSObject.theme?.id);
    Services.obs.addObserver(observer, "lightweight-theme-styling-update");
    Services.prefs.setBoolPref("xpinstall.signatures.required", false);
    try {
      // From a file, as about:addons and sites install them: it stops
      // before it lands.
      let install = await AddonManager.getInstallForFile(writeXPI(xpi, themeManifest(id)));
      check(install.addon?.type == "theme" && !install.error, `not a theme to install: ${install.state} ${install.error}`);
      let error = await install.install().then(() => null, e => e);
      check(error, "the theme from a file installed");
      check(!(await AddonManager.getAddonByID(id)), "the theme from a file is there");

      // A temporary one (about:debugging) goes at once, and no window
      // takes its look.
      await IOUtils.makeDirectory(dir, { ignoreExisting: true });
      await IOUtils.writeJSON(PathUtils.join(dir, "manifest.json"), themeManifest(id));
      let folder = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      folder.initWithPath(dir);
      await AddonManager.installTemporaryAddon(folder);
      await wait(async () => await themeIds() == DEFAULT_THEME_ID, "the temporary theme to go");
      check((await AddonManager.getAddonByID(DEFAULT_THEME_ID)).isActive, "the default theme is not active");
      check(Services.prefs.getCharPref("extensions.activeThemeID") == DEFAULT_THEME_ID, "another theme id is recorded");
      check(looks.includes(id), `the theme did not start: ${looks}`);
      check(themeLook() == "", `the window took the theme: ${themeLook()}`);

      // The rest still installs.
      let extension = await installExtension("Still installs");
      check(extension.isActive, "an extension did not install");
    } finally {
      Services.obs.removeObserver(observer, "lightweight-theme-styling-update");
      Services.prefs.clearUserPref("xpinstall.signatures.required");
      await (await AddonManager.getAddonByID(id))?.uninstall();
      await uninstallTestExtensions();
      await IOUtils.remove(dir, { recursive: true });
      await IOUtils.remove(xpi);
    }
    """)


@test
def extensions_cannot_change_the_look_with_the_theme_api(b):
    b.js("""
    let looks = [];
    let observer = subject => looks.push(subject.wrappedJSObject.theme?.id);
    Services.obs.addObserver(observer, "lightweight-theme-styling-update");
    let dark = () => win.matchMedia("(prefers-color-scheme: dark)").matches;
    let wasDark = dark();
    try {
      // For every window, then for this one.
      let extension = await installExtension("Paints", {
        permissions: ["theme"],
        background: { scripts: ["background.js"] },
      }, {
        "background.js": `
          const colors = { frame: "#ff0000", tab_background_text: "#ffffff", toolbar: "#00ff00" };
          (async () => {
            await browser.theme.update({ colors });
            let { id } = await browser.windows.getCurrent();
            await browser.theme.update(id, { colors });
          })();
        `,
      });
      await wait(() => looks.filter(l => l == extension.id).length == 2, `the extension's two looks: ${looks}`);
      check(themeLook() == "", `the window took the extension's look: ${themeLook()}`);
      check(dark() == wasDark, "the window's scheme changed");
      check(extension.isActive, "the extension stopped");
    } finally {
      Services.obs.removeObserver(observer, "lightweight-theme-styling-update");
      await uninstallTestExtensions();
    }
    """)


@test
def no_enterprise_policy_and_no_managed_notice_hidden(b):
    b.js("""
    // Orbito keeps themes out without a policy, so Firefox is not an
    // enterprise's and its settings do not say an organization manages it.
    check(Services.policies.status != Services.policies.ACTIVE, "a policy is active");
    check(!Services.policies.isEnterprise, "Firefox is set up as an enterprise's");
    await onlyBlankTab();
    try {
      let page = await firefoxSettingsAt("paneTabsBrowsing", "tabs");
      let notice = page.getElementById("policies-container-content");
      check(notice.hidden, "Firefox's settings say an organization manages it");
      // Orbito's sheet leaves the notice alone (for policies of a real
      // organization).
      notice.hidden = false;
      check(notice.checkVisibility(), "Orbito's sheet hides the notice");
      notice.hidden = true;
    } finally {
      await onlyBlankTab();
    }
    """)


@test
def the_built_in_themes_are_not_there_to_switch_to(b):
    b.js("""
    const { BuiltInThemes } = ChromeUtils.importESModule("resource:///modules/BuiltInThemes.sys.mjs");
    // Firefox installs them once it is idle (and when its welcome page
    // offers them): none comes.
    await wait(() => win.gBrowserInit?.idleTasksFinished, "the idle tasks");
    await BuiltInThemes.ensureBuiltInThemes();
    check(await themeIds() == DEFAULT_THEME_ID, `themes: ${await themeIds()}`);
    for (let theme of ["firefox-compact-light@mozilla.org", "firefox-compact-dark@mozilla.org", "firefox-alpenglow@mozilla.org"]) {
      check(!(await AddonManager.getAddonByID(theme)), `${theme} is there`);
    }
    check((await AddonManager.getAddonByID(DEFAULT_THEME_ID)).isActive, "the default theme is not active");
    // What Firefox records as the theme stays the default one.
    check(Services.prefs.prefIsLocked("extensions.activeThemeID"), "the theme id is not locked");
    Services.prefs.setCharPref("extensions.activeThemeID", "firefox-compact-dark@mozilla.org");
    check(Services.prefs.getCharPref("extensions.activeThemeID") == DEFAULT_THEME_ID, "the theme id changed");
    Services.prefs.clearUserPref("extensions.activeThemeID");
    // One installed and turned on anyway (only Firefox's own code can) goes.
    let dark = await AddonManager.installBuiltinAddon("resource://builtin-themes/dark/");
    await dark.enable().catch(() => {});
    await wait(async () => await themeIds() == DEFAULT_THEME_ID, "the dark theme to go");
    check((await AddonManager.getAddonByID(DEFAULT_THEME_ID)).isActive, "the default theme is not active");
    await wait(() => themeLook() == "", `the window to drop the dark theme: ${themeLook()}`);
    """)


@test
def about_addons_has_no_themes_category(b):
    try:
        b.js("""
        await onlyBlankTab();
        let page = await openAddons();
        check(!page.getElementById("category-theme").checkVisibility(), "the Themes category shows");
        check(page.getElementById("category-plugin").checkVisibility(), "the Plugins category is hidden");
        win.gBrowser.selectedBrowser.focus();
        page.getElementById("category-extension").buttonEl.focus();
        await wait(() => page.activeElement?.id == "category-extension", "the Extensions category to focus");
        """)
        # The arrows skip it: Extensions, then Plugins.
        b.keys(Keys.DOWN)
        b.js("""
        let page = win.gBrowser.selectedBrowser.contentDocument;
        await wait(() => page.activeElement?.id == "category-plugin", "the arrow to go to Plugins");
        // The theme list (the view a profile may have shown last) has no
        // light and dark choice either.
        await onlyBlankTab();
        page = await openAddons("addons://list/theme");
        await wait(() => page.querySelector("addon-list"), "the theme list");
        check(!page.querySelector("aboutaddons-themes-mode")?.checkVisibility(), "the light and dark choice shows");
        """)
    finally:
        b.js("await onlyBlankTab();")


@test
def dark_in_the_orbito_settings_makes_firefox_and_its_pages_dark(b):
    b.js("""
    await onlyBlankTab();
    resetAppearance();
    Services.prefs.setIntPref("ui.systemUsesDarkTheme", 0);
    try {
      let web = await openSchemePage();
      let addons = await openAddons();
      let addonsTab = win.gBrowser.selectedTab;
      let settings = await openOrbitoSettings();
      check(settings.getElementById("no-firefox-themes").textContent.includes("Firefox themes are not used"), "no note on Firefox themes");
      // Firefox's chrome, a web page, about:addons (a Firefox page) and the
      // settings page, all in the scheme picked.
      let schemes = () => ({
        prefs: FIREFOX_SCHEME_PREFS.map(p => Services.prefs.getIntPref(p)).join(","),
        window: win.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
        web: schemeOf(web),
        addons: addons.defaultView.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
        settings: settings.defaultView.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      });
      let all = (prefs, scheme) => JSON.stringify({ prefs, window: scheme, web: scheme, addons: scheme, settings: scheme });
      await wait(() => JSON.stringify(schemes()) == all("2,2", "light"), `the light OS: ${JSON.stringify(schemes())}`);

      radioIn(settings, "theme", "dark").click();
      await wait(() => JSON.stringify(schemes()) == all("0,0", "dark"), `Dark: ${JSON.stringify(schemes())}`);
      for (let pref of FIREFOX_SCHEME_PREFS) {
        check(Services.prefs.prefIsLocked(pref), `${pref} is not locked`);
      }
      // Firefox's theme code writes them on a theme update: no effect.
      Services.prefs.setIntPref("browser.theme.toolbar-theme", 1);
      check(schemes().prefs == "0,0", "Firefox's theme code changed the scheme");

      // Light on a dark OS (Firefox's default theme would go dark with it).
      radioIn(settings, "theme", "light").click();
      Services.prefs.setIntPref("ui.systemUsesDarkTheme", 1);
      await sleep(200);
      await wait(() => JSON.stringify(schemes()) == all("1,1", "light"), `Light: ${JSON.stringify(schemes())}`);

      radioIn(settings, "theme", "system").click();
      await wait(() => JSON.stringify(schemes()) == all("2,2", "dark"), `System on a dark OS: ${JSON.stringify(schemes())}`);
      check(addonsTab.linkedBrowser.contentDocument == addons, "about:addons was reloaded");
    } finally {
      resetAppearance();
      Services.prefs.clearUserPref("ui.systemUsesDarkTheme");
      await onlyBlankTab();
    }
    """)


@test
def private_windows_have_their_own_frame_and_the_same_shell(b):
    b.js("""
    await onlyBlankTab();
    resetAppearance();
    let priv = win.OpenBrowserWindow({ private: true });
    try {
      await wait(() => priv.gBrowserInit?.delayedStartupFinished && priv.OrbitoShell?.topBar, "the private window");
      check(PrivateBrowsingUtils.isWindowPrivate(priv), "not a private window");
      let ps = priv.OrbitoShell;
      let frame = w => w.getComputedStyle(w.document.body).backgroundImage;
      let schemeOf = el => el.ownerDocument.defaultView.getComputedStyle(el).colorScheme;
      // The same Shell: Sidebar with its parts, Top bar with the same
      // controls, the Assistant panel.
      for (let part of ["sidebar", "topBar"]) {
        check(shown(ps[part]), `no ${part} in the private window`);
      }
      check(ps.spaces && ps.pins && ps.docks && priv.document.getElementById("orbito-space-switcher"),
        "the private window lacks Spaces, Pins or the Dock");
      await ps.topBar.updateComplete;
      let controls = w => [...w.OrbitoShell.topBar.controls].map(c => c.dataset.control).join(" ");
      check(controls(priv) == controls(win), `${controls(priv)} != ${controls(win)}`);
      let privText = null;
      for (let dark of [false, true]) {
        await inScheme(dark, async () => {
          // Another frame, the same whatever the scheme and the accent; the
          // Shell on it takes light ink, the accent and the page card keep
          // the theme.
          check(frame(priv) != frame(win), `the same frame in ${dark ? "dark" : "light"}: ${frame(win)}`);
          let privFrame = frame(priv);
          await withHue(150, async () => {
            check(frame(win) != privFrame || dark, "the window's frame did not follow the accent");
            check(frame(priv) == privFrame, "the private frame follows the accent");
          });
          let text = w => tokenIn(w.OrbitoShell.sidebar.renderRoot, "--orbito-text", "color");
          check(text(priv) == tokenIn(ps.topBar.renderRoot, "--orbito-text", "color"), "the Sidebar and Top bar texts differ");
          check(text(priv) != text(win), `the private text is the window's, ${text(win)}`);
          privText ??= text(priv);
          check(text(priv) == privText, `the private text is ${text(priv)} in ${dark ? "dark" : "light"}, ${privText} before`);
          let accent = w => tokenIn(w.OrbitoShell.topBar.renderRoot, "--orbito-accent", "color");
          check(accent(priv) == accent(win), `the private accent is ${accent(priv)}, the window's ${accent(win)}`);
          // Not Firefox's dark private-window theme: the rest follows the
          // theme as in the other window.
          check(schemeOf(priv.document.body) == schemeOf(win.document.body), `the private window is ${schemeOf(priv.document.body)}`);
          check(tokenIn(priv.gBrowser.tabbox, "--orbito-popover") == tokenIn(win.gBrowser.tabbox, "--orbito-popover"), "the popovers differ");
        });
      }
    } finally {
      priv.close();
      Services.prefs.clearUserPref("ui.systemUsesDarkTheme");
    }
    """)


SIDE_PANEL = "<!doctype html><title>{0}</title><body><button id=b>{0}</button></body>"


@test
def an_extensions_sidebar_opens_as_an_overlay_card(b):
    b.js(f"""
    await closeExtensions();
    await uninstallTestExtensions();
    await onlyBlankTab();
    await installExtension("Reading List", {{
      sidebar_action: {{ default_panel: "panel.html", default_title: "Reading list", open_at_install: false }},
    }}, {{ "panel.html": {json.dumps(SIDE_PANEL.format("Reading panel"))} }});
    await installExtension("No Panel");
    await openPage("Side panel");
    win.OrbitoAssistant.toggle(false);
    """)
    try:
        b.js("""
        let box = shell.sidePanel.box;
        let header = shell.sidePanel;
        let id = "reading-list_orbito_test-sidebar-action";
        await wait(() => win.SidebarController.sidebars.has(id), "the extension's sidebar");
        let page = win.gBrowser.tabbox.getBoundingClientRect();
        // The extensions panel opens it.
        await openExtensions();
        let buttons = [...extensions.sidePanelButtons];
        check(buttons.length == 1, `${buttons.length} panel buttons`);
        check((await named(buttons[0])) == "Open panel: Reading List", accessibleName(buttons[0]));
        buttons[0].click();
        await wait(() => shown(box) && win.SidebarController.currentID == id, "the side panel");
        await wait(() => box.getAnimations().every(a => a.playState == "finished"), "the card to settle");
        // A card next to the Sidebar, under the Top bar, over the page,
        // which keeps its width.
        let card = box.getBoundingClientRect();
        let top = shell.topBar.getBoundingClientRect();
        let sidebar = shell.sidebar.getBoundingClientRect();
        check(Math.abs(card.left - page.left) < 1 && card.left >= sidebar.right - 1, `card at ${card.left}, page at ${page.left}`);
        check(Math.abs(card.top - top.bottom) < 1 && Math.abs(card.bottom - page.bottom) < 1, `card ${card.top}-${card.bottom}`);
        check(Math.round(card.width) == 300, `card ${card.width} wide`);
        let over = doc.elementFromPoint(card.left + card.width / 2, card.top + card.height / 2);
        check(box.contains(over), `the page is over the card: ${over?.localName}#${over?.id}`);
        let now = win.gBrowser.tabbox.getBoundingClientRect();
        check(now.left == page.left && now.width == page.width, "the page moved or shrank");
        check(win.getComputedStyle(box).backgroundColor == tokenIn(box, "--orbito-popover"), "the card is not a popover");
        // Its head: icon, title, close; the role and name of the card.
        await header.updateComplete;
        check(shown(header) && header.heading.textContent == "Reading list", header.heading.textContent);
        check(box.getAttribute("role") == "complementary" && (await named(box)) == "Reading list panel", accessibleName(box));
        check((await named(header.closeButton)) == "Close extension panel", accessibleName(header.closeButton));
        // The extension's page, without Firefox's head.
        // Its document once it loads, not the blank one before.
        let content = await wait(() => win.SidebarController.browser.contentDocument.getElementById("webext-panels-browser"), "the extension's browser");
        let inner = content.ownerDocument;
        await wait(() => content.contentTitle == "Reading panel", "the extension's page");
        check(!inner.getElementById("sidebar-panel-header").checkVisibility(), "Firefox's head shows");
        // The extensions panel says it is open, and closes it.
        await openExtensions();
        let button = extensions.sidePanelButtons[0];
        check(button.getAttribute("aria-pressed") == "true" && /Close panel/.test(button.textContent), button.textContent);
        await closeExtensions();
        // The close button closes it.
        header.closeButton.click();
        await wait(() => !shown(box) && !win.SidebarController.isOpen, "the close button to close it");
        // The extension's own call opens it too; the extensions panel
        // button closes it.
        await win.SidebarController.show(id);
        await wait(() => shown(box), "the panel from the extension");
        await openExtensions();
        extensions.sidePanelButtons[0].click();
        await wait(() => !win.SidebarController.isOpen, "the panel button to close it");
        // Firefox's own panels (history) open as the card too, with their
        // own head.
        await win.SidebarController.show("viewHistorySidebar");
        await wait(() => shown(box), "the history panel");
        check(!header.checkVisibility(), "the extension head shows over Firefox's history");
        await wait(() => box.getAnimations().every(a => a.playState == "finished"), "the card to settle");
        check(Math.round(box.getBoundingClientRect().width) == 300, `the history panel is ${box.getBoundingClientRect().width} wide`);
        win.SidebarController.hide();
        await wait(() => !shown(box), "the history panel to close");
        """)
    finally:
        b.js("win.SidebarController.hide(); await closeExtensions(); await uninstallTestExtensions();")


@test
def the_side_panel_follows_the_keyboard_rules(b):
    b.js(f"""
    await closeExtensions();
    await uninstallTestExtensions();
    await onlyBlankTab();
    await installExtension("Key Panel", {{
      sidebar_action: {{ default_panel: "panel.html", default_title: "Key panel", open_at_install: false }},
    }}, {{ "panel.html": {json.dumps(SIDE_PANEL.format("Key panel page"))} }});
    await openPage("Side panel keys");
    win.OrbitoAssistant.toggle(false);
    let id = "key-panel_orbito_test-sidebar-action";
    await wait(() => win.SidebarController.sidebars.has(id), "the extension's sidebar");
    await win.SidebarController.show(id);
    // Its document once it loads, not the blank one before.
    let content = await wait(() => win.SidebarController.browser.contentDocument.getElementById("webext-panels-browser"), "the extension's browser");
    let inner = content.ownerDocument;
    await wait(() => content.contentTitle == "Key panel page", "the extension's page");
    win.gBrowser.selectedBrowser.focus();
    await wait(() => shell.focusedRegion == "page", "the page to have focus");
    """)
    try:
        # F6 order: Sidebar, the side panel, Top bar, page.
        names = b.js("return shell.regions.map(r => r.name);")
        assert names == ["sidebar", "side-panel", "top-bar", "page"], names
        b.keys(Keys.F6, Keys.F6)
        b.js("""
        await wait(() => shell.focusedRegion == "side-panel", `F6 to the side panel, not ${shell.focusedRegion}`);
        let inner = win.SidebarController.browser.contentDocument;
        await wait(() => inner.activeElement?.id == "webext-panels-browser", "focus on the extension's page");
        """)
        b.keys(Keys.F6)
        b.js('await wait(() => shell.focusedRegion == "top-bar", "F6 on to the Top bar");')
        b.keys((Keys.SHIFT, Keys.F6))
        b.js('await wait(() => shell.focusedRegion == "side-panel", "Shift+F6 back to the side panel");')
        # Shift+Tab from the panel's page (past its button) reaches its
        # close button, which shows focus.
        for _ in range(3):
            b.keys((Keys.SHIFT, Keys.TAB))
            if b.js("await sleep(200); return deepActive() == shell.sidePanel.closeButton;"):
                break
        b.js("""
        let close = shell.sidePanel.closeButton;
        await wait(() => deepActive() == close, `Shift+Tab to the close button, not ${deepActive()?.localName}#${deepActive()?.id} ${win.SidebarController.browser.contentDocument.activeElement?.id}`);
        check(close.matches(":focus-visible"), "the close button shows no focus");
        check(win.getComputedStyle(close).outlineColor == tokenIn(close.parentNode ?? shell.sidePanel, "--orbito-accent", "color"),
          "the focus ring is not the accent");
        """)
        # Escape closes the panel; focus goes to the page.
        b.keys(Keys.ESCAPE)
        b.js("""
        await wait(() => !win.SidebarController.isOpen, "Escape to close the panel");
        await wait(() => shell.focusedRegion == "page", `focus on the page, not ${shell.focusedRegion}`);
        check(!shell.regions.some(r => r.name == "side-panel"), "the closed panel is still a region");
        """)
        # Enter on the close button closes it too.
        b.js("""
        await win.SidebarController.show("key-panel_orbito_test-sidebar-action");
        await wait(() => shown(shell.sidePanel.box), "the panel again");
        shell.sidePanel.closeButton.focus({ focusVisible: true });
        """)
        b.keys(Keys.ENTER)
        b.js('await wait(() => !win.SidebarController.isOpen, "Enter on the close button to close it");')
    finally:
        b.js("win.SidebarController.hide(); await uninstallTestExtensions();")


@test
def pins_survive_a_restart_unloaded(b):
    expected = b.js("""
    await resetPins();
    await onlyBlankTab();
    let blank = win.gBrowser.selectedTab;
    for (let title of ["Kept pin A", "Kept pin B"]) {
      shell.pins.pinTab(await openPage(title));
    }
    win.gBrowser.selectedTab = blank;
    await pinsMatch();
    Services.prefs.setBoolPref("browser.sessionstore.resume_session_once", true);
    Services.prefs.savePrefFile(null);
    return storedPins();
    """)
    b.m.restart(in_app=True)
    b.m.set_context("chrome")
    b.m.timeout.script = 120
    try:
        b.js(f"""
        await wait(() => win.gBrowserInit?.delayedStartupFinished && shell?.pins, "the window");
        await SessionStore.promiseAllWindowsRestored;
        check(JSON.stringify(storedPins()) == JSON.stringify({json.dumps(expected)}), JSON.stringify(storedPins()));
        // Session Restore brings the tabs back: still one per Pin, in order,
        // none loaded.
        await pinsMatch();
        check(pinLabels() == "Kept pin A,Kept pin B", pinLabels());
        check(shell.pins.tabs.every(t => !t.linkedPanel || t.hasAttribute("pending")),
          `a Pin loaded at start: ${{shell.pins.tabs.map(t => [!!t.linkedPanel, t.hasAttribute("pending")])}}`);
        """)
    finally:
        b.js("await resetPins(); await onlyBlankTab();")


@test
def docks_survive_a_restart_unloaded(b):
    expected = b.js("""
    await resetDocks();
    await resetSpaces();
    await onlyBlankTab();
    let blank = win.gBrowser.selectedTab;
    for (let title of ["Kept dock A", "Kept dock B"]) {
      shell.docks.dockTab(await openPage(title));
    }
    win.gBrowser.selectedTab = blank;
    await docksMatch();
    Services.prefs.setBoolPref("browser.sessionstore.resume_session_once", true);
    Services.prefs.savePrefFile(null);
    return storedDocks();
    """)
    b.m.restart(in_app=True)
    b.m.set_context("chrome")
    b.m.timeout.script = 120
    try:
        b.js(f"""
        await wait(() => win.gBrowserInit?.delayedStartupFinished && shell?.docks, "the window");
        await SessionStore.promiseAllWindowsRestored;
        check(JSON.stringify(storedDocks()) == JSON.stringify({json.dumps(expected)}), JSON.stringify(storedDocks()));
        // Session Restore brings the tabs back: still one per entry, in
        // order, none loaded.
        await docksMatch();
        check(dockLabels() == "Kept dock A,Kept dock B", dockLabels());
        check(shell.docks.tabsIn().every(t => shell.docks.isResting(t)),
          `a Dock tab loaded at start: ${{shell.docks.tabsIn().map(t => [!!t.linkedPanel, t.hasAttribute("pending")])}}`);
        """)
    finally:
        b.js("await resetDocks(); await onlyBlankTab();")


@test
def orbits_survive_a_restart(b):
    b.js("""
    await resetOrbits();
    await onlyBlankTab();
    useFakeBackend();
    await openPage("Restart asker");
    core.setPermissionMode(win, "bypass");
    let id = await askFake("Two tabs", async ({ callTool }) => {
      await callTool("open_tab", { url: pageURL("Restart one") });
      await callTool("open_tab", { url: pageURL("Restart two") });
    });
    await finishedRun(id);
    await wait(() => byLabel("Restart one") && byLabel("Restart two"), "the pages");
    await wait(() => orbitBoxes().length == 1, "the Orbit");
    core.setPermissionMode(win, "ask");
    dropFakeBackend();
    await resetAssistant();
    Services.prefs.setBoolPref("browser.sessionstore.resume_session_once", true);
    Services.prefs.savePrefFile(null);
    """)
    b.m.restart(in_app=True)
    b.m.set_context("chrome")
    b.m.timeout.script = 120
    try:
        b.js("""
        await wait(() => win.gBrowserInit?.delayedStartupFinished && shell?.sidebar, "the window");
        await wait(() => byLabel("Restart one") && byLabel("Restart two"), "the tabs to come back");
        let [one, two] = [byLabel("Restart one"), byLabel("Restart two")];
        await wait(() => core.orbitOf(one) && core.orbitOf(one) == core.orbitOf(two), "the task id to come back");
        let box = await wait(() => orbitBoxes().length == 1 && orbitTabsShown(orbitBoxes()[0]).length == 2 && orbitBoxes()[0], "the Orbit");
        check(box.getAttribute("state") == "done", box.getAttribute("state"));
        check(!core.orbitOf(byLabel("Restart asker")), "the asking tab is in the Orbit");
        await listMatchesGBrowser();
        win.gBrowser.selectedTab = one;
        await openAssistant();
        await wait(() => logButton("Keep as group"), "the wrap-up card");
        """)
    finally:
        b.js("await resetOrbits(); await onlyBlankTab();")


@test
def the_assistant_panel_width_survives_a_restart(b):
    b.js("""
    await resetAssistant();
    Services.prefs.setIntPref("orbito.assistant.width", 420);
    Services.prefs.savePrefFile(null);
    """)
    b.m.restart(in_app=True)
    b.m.set_context("chrome")
    b.m.timeout.script = 120
    try:
        b.js("""
        await wait(() => win.gBrowserInit?.delayedStartupFinished && shell?.assistant && win.OrbitoAssistant, "the window");
        await openAssistant();
        check(assistant.getBoundingClientRect().width == 420, `width ${assistant.getBoundingClientRect().width}`);
        """)
    finally:
        b.js("await resetAssistant();")


@test
def sidebar_width_and_collapse_survive_a_restart(b):
    b.js("""
    await resetSidebar();
    Services.prefs.setIntPref("orbito.sidebar.width", 320);
    Services.prefs.setBoolPref("orbito.sidebar.collapsed", true);
    Services.prefs.savePrefFile(null);
    """)
    b.m.restart(in_app=True)
    b.m.set_context("chrome")
    b.m.timeout.script = 120
    try:
        b.js("""
        await wait(() => win.gBrowserInit?.delayedStartupFinished && shell?.sidebar, "the window");
        await shell.sidebar.updateComplete;
        check(shell.sidebar.collapsed, "the Sidebar is no longer collapsed");
        check(shell.sidebar.getBoundingClientRect().width == 320, `width ${shell.sidebar.getBoundingClientRect().width}`);
        """)
    finally:
        b.js("await resetSidebar();")


@test
def spaces_and_where_tabs_are_survive_a_restart(b):
    ids = b.js("""
    await resetSpaces();
    await onlyBlankTab();
    await openPage("Kept home");
    let away = await newSpace();
    await openPage("Kept away");
    // Session Restore brings the windows back once.
    Services.prefs.setBoolPref("browser.sessionstore.resume_session_once", true);
    Services.prefs.savePrefFile(null);
    return { list: spaces().list, current: spaces().current };
    """)
    b.m.restart(in_app=True)
    b.m.set_context("chrome")
    b.m.timeout.script = 120
    try:
        b.js(f"""
        let expected = {json.dumps(ids)};
        await wait(() => win.gBrowserInit?.delayedStartupFinished && shell?.spaces, "the window");
        await wait(() => byLabel("Kept away") && byLabel("Kept home"), "the tabs to come back");
        await wait(() => spaces().current == expected.current, "the window's Space");
        check(JSON.stringify(spaces().list) == JSON.stringify(expected.list), JSON.stringify(spaces().list));
        let [home, away] = [byLabel("Kept home"), byLabel("Kept away")];
        check(spaceOfTab(home) == expected.list[0].id && home.hidden, "the first Space's tab");
        check(spaceOfTab(away) == expected.current && !away.hidden, "the second Space's tab");
        await listMatchesGBrowser();
        await switcher().updateComplete;
        check(switcher().dots.length == 2, `${{switcher().dots.length}} dots`);
        """)
    finally:
        b.js("await resetSpaces(); await onlyBlankTab();")


@test
def no_firefox_theme_and_the_scheme_survive_a_restart(b):
    # A theme Firefox finds at startup (as a program can put one in the
    # profile, or an earlier run left one): it goes.
    b.js("""
    let xpi = PathUtils.join(PathUtils.profileDir, "extensions", "a-theme@orbito.test.xpi");
    await IOUtils.makeDirectory(PathUtils.parent(xpi), { ignoreExisting: true });
    writeXPI(xpi, themeManifest("a-theme@orbito.test"));
    // Firefox looks for add-ons put in the profile at startup.
    Services.prefs.setIntPref("extensions.startupScanScopes", AddonManager.SCOPE_PROFILE);
    Services.prefs.setBoolPref("xpinstall.signatures.required", false);
    OrbitoAppearance.setTheme("light");
    """)
    b.m.restart(in_app=True)
    b.m.set_context("chrome")
    b.m.timeout.script = 120
    try:
        b.js("""
        await wait(() => win.gBrowserInit?.delayedStartupFinished && shell?.topBar, "the window");
        await wait(async () => await themeIds() == DEFAULT_THEME_ID, `the theme to go: ${await themeIds()}`);
        check(!(await IOUtils.exists(PathUtils.join(PathUtils.profileDir, "extensions", "a-theme@orbito.test.xpi"))), "the theme's file is left");
        await wait(() => themeLook() == "", `the default theme to apply: ${themeLook()}`);
        check(Services.prefs.getCharPref("extensions.activeThemeID") == DEFAULT_THEME_ID, "another theme id is recorded");
        check(Services.policies.status != Services.policies.ACTIVE, "a policy is active");
        check(FIREFOX_SCHEME_PREFS.every(p => Services.prefs.prefIsLocked(p) && Services.prefs.getIntPref(p) == 1), "Firefox's scheme is not light");
        Services.prefs.setIntPref("ui.systemUsesDarkTheme", 1);
        await sleep(200);
        check(!win.matchMedia("(prefers-color-scheme: dark)").matches, "the window went dark");
        """)
    finally:
        b.js("""
        resetAppearance();
        Services.prefs.clearUserPref("ui.systemUsesDarkTheme");
        Services.prefs.clearUserPref("extensions.startupScanScopes");
        Services.prefs.clearUserPref("xpinstall.signatures.required");
        await (await AddonManager.getAddonByID("a-theme@orbito.test"))?.uninstall();
        """)


@test
def every_orbito_string_formats_in_every_language(b):
    b.js("""
    const { LANGUAGES } = ChromeUtils.importESModule("chrome://browser/content/orbito/OrbitoL10n.sys.mjs");
    let files = ["common", "sidebar", "top-bar", "assistant", "settings", "pages"].map(f => `orbito/${f}.ftl`);
    let ids = new Set();
    for (let file of files) {
      let text = await (await fetch(`chrome://browser/content/orbito/locales/en-US/${file}`)).text();
      for (let [, id] of text.matchAll(/^([a-z][a-z0-9-]*)\\s*=/gm)) {
        ids.add(id);
      }
    }
    check(ids.size > 500, `only ${ids.size} messages`);
    for (let language of LANGUAGES) {
      let l10n = new Localization(files, true, L10nRegistry.getInstance(), [language]);
      let missing = [];
      for (let id of ids) {
        let [message] = l10n.formatMessagesSync([{ id, args: {} }]);
        if (!message || (message.value == null && !message.attributes?.length)) {
          missing.push(id);
        }
      }
      check(!missing.length, `${language} lacks ${missing.slice(0, 10).join(", ")}`);
    }
    """)


@test
def the_language_picked_in_the_settings_shows_after_a_restart(b):
    b.js("""
    await onlyBlankTab();
    // No langpack to download: Orbito's strings change, Firefox's don't.
    Services.prefs.setStringPref("extensions.getAddons.langpacks.url", `${PAGES}/no-langpacks`);
    let settings = await openOrbitoSettings();
    let restart = settings.getElementById("language-restart");
    check(restart.hidden, "a restart is asked for before picking");
    radioIn(settings, "language", "ko").click();
    await wait(() => !restart.hidden, "the restart to be asked for");
    check(radioIn(settings, "language", "ko").getAttribute("aria-checked") == "true", "Korean is not picked");
    check(Services.locale.requestedLocales[0] == "ko", `requested ${Services.locale.requestedLocales}`);
    check(restart.querySelector("p").textContent.includes("한국어"), restart.querySelector("p").textContent);
    """)
    b.m.restart(in_app=True)
    b.m.set_context("chrome")
    b.m.timeout.script = 120
    try:
        b.js("""
        await wait(() => win.gBrowserInit?.delayedStartupFinished && shell?.topBar, "the window");
        check(Services.locale.appLocaleAsBCP47 == "ko", `the app is in ${Services.locale.appLocaleAsBCP47}`);
        check(win.customElements.get("orbito-downloads").label == "다운로드", "the Shell is not in Korean");
        let settings = await openOrbitoSettings();
        await wait(() => settings.querySelector("#theme-label").textContent == "테마", "the settings in Korean");
        check(settings.getElementById("language-restart").hidden, "a restart is still asked for");
        // A new Space is named in Korean; the ones already there keep theirs.
        await onlyBlankTab();
        await resetSpaces();
        let first = spaces().currentSpace.name;
        let made = await newSpace();
        check(/^새 Space [0-9]$/.test(made.name), JSON.stringify(made.name));
        check(spaces().list[0].name == first, `the first Space is now ${spaces().list[0].name}`);
        await resetSpaces();
        // The Command bar too, in each mode.
        win.OrbitoShell.commandBar.open("new");
        await wait(() => commandBarShown(), "the Command bar");
        let said = await commandBarTextWithFooter();
        check(said.placeholder == "주소, 검색어, 또는 질문" && said.mode == "새 탭", JSON.stringify(said));
        check(/고르기.*실행.*닫기.*Enter를 눌러야 탭이 생겨요$/.test(said.footer), said.footer);
        win.OrbitoShell.commandBar.open("current");
        said = await commandBarTextWithFooter();
        check(said.mode == "현재 탭" && said.footer.endsWith("지금 탭에서 열어요"), JSON.stringify(said));
        win.gURLBar.value = "";
        await wait(() => commandBarText().placeholder == "주소를 고치거나 질문하세요", "what to type in Korean");
        closeCommandBar();
        """)
    finally:
        b.js("""
        Services.locale.requestedLocales = ["en-US"];
        Services.prefs.clearUserPref("extensions.getAddons.langpacks.url");
        """)
        b.m.restart(in_app=True)
        b.m.set_context("chrome")
        b.js("""
        await wait(() => win.gBrowserInit?.delayedStartupFinished && shell?.topBar, "the window");
        check(Services.locale.appLocaleAsBCP47 == "en-US", `the app is in ${Services.locale.appLocaleAsBCP47}`);
        await onlyBlankTab();
        """)

def main():
    args = sys.argv[1:]
    repeat = 1
    if "--repeat" in args:
        at = args.index("--repeat")
        repeat = int(args[at + 1])
        del args[at : at + 2]
    names = args
    if names == ["-"]:
        # Names from stdin, one a line, as browser-tests.py hands them out.
        by_name = {t.__name__: t for t in TESTS}
        tests = (by_name[line.strip()] for line in sys.stdin)
    else:
        tests = [t for t in TESTS if not names or t.__name__ in names] * repeat
    server, url = start_pages()
    folder = tempfile.TemporaryDirectory()
    trusted, untrusted = make_certs(folder.name)
    tls_servers = []
    for name, cert in (("secure", trusted), ("untrusted", untrusted)):
        tls_server, TLS[name] = start_pages(cert)
        tls_servers.append(tls_server)
    browser = None
    failed = 0
    try:
        browser = Browser(url)
        for t in tests:
            began = time.time()
            try:
                t(browser)
                print(f"ok - {t.__name__} # {time.time() - began:.1f}s", flush=True)
            except Exception as e:
                failed += 1
                print(f"not ok - {t.__name__} # {time.time() - began:.1f}s", flush=True)
                print("  " + (str(e).strip().splitlines() or [repr(e)])[0][:2000], flush=True)
    finally:
        if browser:
            browser.quit()
        server.shutdown()
        for tls_server in tls_servers:
            tls_server.shutdown()
        folder.cleanup()
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
