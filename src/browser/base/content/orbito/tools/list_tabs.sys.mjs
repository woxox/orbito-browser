/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Imported once called: tool modules must not touch chrome globals when
// imported.
function t(id, args) {
  return ChromeUtils.importESModule(
    "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
  ).t(id, args);
}

export default {
  name: "list_tabs",
  description:
    "List the open tabs in the user's browser window (or, for a scheduled task, in every window) with their ids, titles, URLs and the tab group each is in. These are the tabs of the Space this conversation belongs to (a set of tabs for one kind of work) and the pinned ones (every tab for a scheduled task of no Space); a scheduled task also gets the Space of each tab. The tab of a popup window that one of these tabs' pages opened (to sign in or pay, say) comes last, with window \"popup\" and, as opened_by, the id of the tab whose page opened it.",
  schema: { type: "object", properties: {} },
  readOnly: true,
  concurrent: true,

  label() {
    return t("orbito-assistant-tool-looking-tabs");
  },

  run(ctx) {
    let describe = tab => ({
      id: ctx.tabId(tab),
      title: tab.label,
      url: tab.linkedBrowser.currentURI.spec,
      group: tab.group ? { id: tab.group.id, name: tab.group.label } : null,
    });
    // A windowless query (a scheduled task) sees the tabs of every normal
    // window, numbered from the most recently used: those of its Space and
    // the pinned ones, or all of them for a task of no Space.
    if (ctx.windowless) {
      let { BrowserWindowTracker } = ChromeUtils.importESModule(
        "resource:///modules/BrowserWindowTracker.sys.mjs"
      );
      let own = ctx.space;
      return JSON.stringify(
        BrowserWindowTracker.getOrderedWindows({ private: false }).flatMap(
          (win, i) => {
            let spaces = win.OrbitoShell?.spaces;
            let spaceName = tab => {
              let id = spaces?.spaceOf(tab);
              return spaces?.list.find(space => space.id == id)?.name ?? null;
            };
            return win.gBrowser.tabs
              .filter(
                tab =>
                  own == null ||
                  !spaces ||
                  tab.pinned ||
                  spaces.spaceOf(tab) == own
              )
              .map(tab => ({
                window: i + 1,
                ...describe(tab),
                space: spaceName(tab),
              }));
          }
        )
      );
    }
    // The tabs of the Thread's Space in the asking window and the
    // pinned ones, then those of the popup windows their pages opened.
    let { OrbitoTools } = ChromeUtils.importESModule(
      "chrome://browser/content/orbito/OrbitoTools.sys.mjs"
    );
    return JSON.stringify(
      ctx.tabs.map(tab => {
        let opener =
          tab.documentGlobal != ctx.window && OrbitoTools.openerOf(tab);
        return {
          ...describe(tab),
          active: tab == ctx.tab,
          ...(opener && { window: "popup", opened_by: ctx.tabId(opener) }),
        };
      })
    );
  },
};
