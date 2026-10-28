/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Firefox features Orbito does not have: Firefox View, the bookmarks
 * toolbar, the ☰ app menu and toolbar customize mode. Their DOM stays
 * (ADR 0001) and orbito.css hides it; this closes the ways in that are left:
 * keys, menu items, and the functions other Firefox code calls to open them.
 * The menu bar, Pocket, recommendations and the account button need no code
 * (orbito.css, orbito.js).
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ActionsProviderQuickActions:
    "moz-src:///browser/components/urlbar/ActionsProviderQuickActions.sys.mjs",
  QuickActionsLoaderDefault:
    "moz-src:///browser/components/urlbar/QuickActionsLoaderDefault.sys.mjs",
});

const nothing = () => {};

/** Blocks the removed features in a browser window. */
export function removeFirefoxFeatures(win) {
  let { document } = win;

  // Firefox View: the Tools menu, the tab menus, the urlbar's quick action
  // and messages all open it with openTab.
  win.FirefoxViewHandler.openTab = nothing;
  win.FirefoxViewHandler.openToolbarMouseEvent = nothing;
  lazy.QuickActionsLoaderDefault.ensureLoaded().then(() => {
    let action = lazy.ActionsProviderQuickActions.getAction("firefoxview");
    if (action) {
      action.isUnsupported = () => true;
    }
  });

  // The bookmarks toolbar: ⌘⇧B, the Bookmarks menu and the Library button
  // toggle it here.
  win.BookmarkingUI.toggleBookmarksToolbar = nothing;
  document
    .getElementById("viewBookmarksToolbarKb")
    .setAttribute("disabled", "true");

  // The ☰ app menu: its button and messages that point at it go through
  // show (toggle calls show).
  win.PanelUI.show = nothing;

  // Customize mode: the menus, the toolbar context menu and a customize tab
  // restored from a session all end in gCustomizeMode.enter().
  // It is a lazy getter until something first uses it.
  let { get, value } = Object.getOwnPropertyDescriptor(win, "gCustomizeMode");
  if (get) {
    ChromeUtils.defineLazyGetter(win, "gCustomizeMode", () => {
      let customizeMode = get.call(win);
      customizeMode.enter = nothing;
      return customizeMode;
    });
  } else {
    value.enter = nothing;
  }
  document
    .getElementById("cmd_CustomizeToolbars")
    .setAttribute("disabled", "true");

  // Menu items (the macOS menu bar; elsewhere the menu bar is hidden): View >
  // Toolbars holds only the toolbars and Customize.
  for (let id of ["menu_openFirefoxView", "viewToolbarsMenu"]) {
    document.getElementById(id).hidden = true;
  }
}
