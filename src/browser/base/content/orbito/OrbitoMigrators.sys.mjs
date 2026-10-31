/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Migrators for Chromium browsers Firefox has none for, which the migration
 * wizard lists with Firefox's own (MigrationUtils' patched module list).
 * They read the browser's profiles as Firefox's Chrome migrator does; the
 * data folders are in ChromeMigrationUtils' patched table.
 *
 * Arc keeps most of what a user saved in its sidebar rather than in
 * Chrome's bookmarks: its Favorites and each Space's pinned tabs and
 * folders. Those come in as bookmarks too, in an "Arc" folder, and on the
 * Shell: the Favorites as Pins, the Spaces as Spaces, the pinned tabs and
 * folders on their Docks.
 */

import { ChromeProfileMigrator } from "resource:///modules/ChromeProfileMigrator.sys.mjs";
import { MigrationUtils } from "resource:///modules/MigrationUtils.sys.mjs";
import {
  addSpace,
  checkSpaces,
} from "chrome://browser/content/orbito/shell/OrbitoSpaces.sys.mjs";
import { checkPins } from "chrome://browser/content/orbito/shell/OrbitoPins.sys.mjs";
import {
  checkDocks,
  dockEntries,
  dockList,
  isDockFolder,
  withDockList,
} from "chrome://browser/content/orbito/shell/OrbitoDocks.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  OrbitoShellStore:
    "chrome://browser/content/orbito/shell/OrbitoShellStore.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
});

const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

// The Shell's stored lists (OrbitoShellStore).
const PINS = "pins";
const SPACES = "spaces";
const DOCKS = "docks";

// The schemes a saved tab keeps; Arc's own pages (arc://) don't open here.
const SCHEMES = new Set(["http:", "https:", "file:"]);

/** Arc stores maps as flat [key, value, key, value, ...] lists. */
function pairs(list = []) {
  let map = new Map();
  for (let i = 0; i + 1 < list.length; i += 2) {
    map.set(list[i], list[i + 1]);
  }
  return map;
}

/** The profile folder (as in Local State) an Arc Space or Favorites belong to. */
function profileFolder(profile) {
  return (
    profile?.custom?._0?.directoryBasename ??
    (profile?.default ? "Default" : null)
  );
}

/**
 * What Arc's sidebar (StorableSidebar.json) holds for one profile: its
 * Favorites, and its Spaces with their pinned tabs and folders, each in
 * Arc's order. A tab is {title, url}, a folder {title, children}; untitled
 * folders (tab groups) give their children to their parent, and empty
 * folders are left out.
 *
 * @param {object} sidebar
 *   The parsed StorableSidebar.json.
 * @param {string} profileId
 *   The profile's folder name, e.g. "Default" or "Profile 1".
 * @returns {{favorites: Array<object>, spaces: Array<{title: string, pinned: Array<object>}>}}
 */
function arcSidebar(sidebar, profileId) {
  // Arc may keep more than one container of Spaces (one of them all but
  // empty): their items, Spaces and Favorites together.
  let containers = (sidebar?.sidebar?.containers ?? []).filter(c => c?.spaces);
  let all = key => containers.flatMap(c => c[key] ?? []);
  let items = pairs(all("items"));

  let nodes = id => {
    let item = items.get(id);
    if (!item) {
      return [];
    }
    let tab = item.data?.tab;
    if (tab) {
      let url = URL.parse(tab.savedURL ?? "");
      if (!url || !SCHEMES.has(url.protocol)) {
        return [];
      }
      return [{ title: item.title || tab.savedTitle || url.href, url: url.href }];
    }
    let children = (item.childrenIds ?? []).flatMap(nodes);
    if (!item.title) {
      return children;
    }
    return children.length ? [{ title: item.title, children }] : [];
  };
  let contents = containerId =>
    (items.get(containerId)?.childrenIds ?? []).flatMap(nodes);

  let favorites = [...pairs(all("topAppsContainerIDs"))]
    .filter(([profile]) => profileFolder(profile) == profileId)
    .flatMap(([, containerId]) => contents(containerId));
  let spaces = [...pairs(all("spaces")).values()]
    .filter(space => profileFolder(space.profile) == profileId)
    .map(space => {
      let ids = space.containerIDs ?? [];
      let pinned = ids.includes("pinned")
        ? contents(ids[ids.indexOf("pinned") + 1])
        : [];
      return { title: space.title?.trim() || "", pinned };
    });
  return { favorites, spaces };
}

/**
 * Arc's sidebar as bookmark trees for one profile (arcSidebar): a
 * "Favorites" folder, then a folder per Space of its pinned tabs and
 * folders. Empty folders are left out.
 *
 * @param {object} sidebar
 * @param {string} profileId
 * @returns {Array<object>}
 */
export function arcSidebarBookmarks(sidebar, profileId) {
  let { favorites, spaces } = arcSidebar(sidebar, profileId);
  return [
    { title: t("orbito-import-arc-favorites"), children: favorites },
    ...spaces.map(space => ({ title: space.title, children: space.pinned })),
  ].filter(folder => folder.children.length);
}

/**
 * The Shell's lists with Arc's sidebar for one profile (arcSidebar) added:
 * the Favorites' tabs as Pins, each Space as the Space of the same name or
 * a new one (while there is room for one), and its pinned tabs and folders
 * on that Space's Dock. A Dock folder holds entries only, so a folder in a
 * folder gives its tabs to the outer one; a folder goes into the Dock's
 * folder of the same title when there is one. A Pin or Dock entry of a URL
 * its list (a Dock's folders included) already has is left out.
 *
 * @param {object} sidebar
 * @param {string} profileId
 * @param {{pins: Array<object>, spaces: Array<object>, docks: object}} lists
 *   The lists as checked (checkPins, checkSpaces, checkDocks).
 * @param {() => string} newId
 * @returns {{pins: Array<object>, spaces: Array<object>, docks: object}}
 */
export function arcShellLists(sidebar, profileId, lists, newId) {
  let { favorites, spaces: arcSpaces } = arcSidebar(sidebar, profileId);
  let entries = (list, nodes) => {
    let urls = new Set(list.map(entry => entry.url));
    let added = nodes
      .filter(node => node.url && !urls.has(node.url) && urls.add(node.url))
      .map(node => ({ id: newId(), url: node.url, title: node.title, icon: "" }));
    return [...list, ...added];
  };

  let pins = entries(lists.pins, favorites);
  let spaces = lists.spaces;
  let docks = lists.docks;
  for (let arcSpace of arcSpaces) {
    // A Space with neither a name nor pinned tabs is Arc's own placeholder.
    if (!arcSpace.title && !arcSpace.pinned.length) {
      continue;
    }
    let space = arcSpace.title && spaces.find(s => s.name == arcSpace.title);
    if (!space) {
      // An untitled Space gets a new Space's default name.
      let name = arcSpace.title ? () => arcSpace.title : undefined;
      let added = addSpace(spaces, newId(), name);
      if (!added) {
        continue;
      }
      ({ spaces, space } = added);
    }
    docks = withDockList(
      docks,
      space.id,
      withArcPinned(dockList(docks, space.id), arcSpace.pinned, newId)
    );
  }
  return { pins, spaces, docks };
}

/** A Dock list with a Space's pinned tabs and folders added (arcShellLists). */
function withArcPinned(list, pinned, newId) {
  let urls = new Set(dockEntries(list).map(entry => entry.url));
  let tabs = nodes =>
    nodes.flatMap(node => (node.children ? tabs(node.children) : [node]));
  let entries = nodes =>
    tabs(nodes)
      .filter(node => !urls.has(node.url) && urls.add(node.url))
      .map(node => ({ id: newId(), url: node.url, title: node.title, icon: "" }));
  for (let node of pinned) {
    if (!node.children) {
      list = [...list, ...entries([node])];
      continue;
    }
    let children = entries(node.children);
    let same = list.find(item => isDockFolder(item) && item.title == node.title);
    if (same) {
      list = list.map(item =>
        item == same ? { ...item, children: [...item.children, ...children] } : item
      );
    } else if (children.length) {
      list = [...list, { id: newId(), title: node.title, children }];
    }
  }
  return list;
}

/**
 * Adds Arc's sidebar to the Shell's stored lists (arcShellLists); every
 * window takes them in. The Spaces go first, as the Docks belong to them.
 */
function addToShell(sidebar, profileId) {
  let store = lazy.OrbitoShellStore;
  let newId = () => crypto.randomUUID();
  let lists = arcShellLists(
    sidebar,
    profileId,
    {
      pins: checkPins(store.get(PINS)),
      spaces: checkSpaces(store.get(SPACES), newId),
      docks: checkDocks(store.get(DOCKS)),
    },
    newId
  );
  store.set(SPACES, lists.spaces);
  store.set(DOCKS, lists.docks);
  store.set(PINS, lists.pins);
}

/** Bookmark trees as PlacesUtils.bookmarks.insertTree() children. */
function placesTree(nodes) {
  return nodes.map(node =>
    node.children
      ? {
          type: lazy.PlacesUtils.bookmarks.TYPE_FOLDER,
          title: node.title,
          children: placesTree(node.children),
        }
      : { url: node.url, title: node.title }
  );
}

export class ArcProfileMigrator extends ChromeProfileMigrator {
  static get key() {
    return "arc";
  }

  // A browser's name: the wizard shows it as it is (MigrationWizardParent's
  // patch), as no Firefox string names it.
  static get displayName() {
    return "Arc";
  }

  static get brandImage() {
    return "moz-icon://file:///Applications/Arc.app?size=32";
  }

  _chromeUserDataPathSuffix = "Arc";
  _keychainServiceName = "Arc Safe Storage";
  _keychainAccountName = "Arc";

  async getResources(profile) {
    let resources = await super.getResources(profile);
    let dataPath = await this._getChromeUserDataPathIfExists();
    if (dataPath && profile) {
      let sidebar = await this.#sidebarResource(dataPath, profile.id);
      if (sidebar) {
        resources.push(sidebar);
      }
    }
    return resources;
  }

  /**
   * The sidebar for a profile, as a migrator resource of bookmarks: its
   * bookmarks, and its Favorites, Spaces and pinned tabs on the Shell's
   * Pins, Spaces and Docks (arcShellLists).
   */
  async #sidebarResource(dataPath, profileId) {
    let path = PathUtils.join(PathUtils.parent(dataPath), "StorableSidebar.json");
    let sidebar = await IOUtils.readJSON(path).catch(() => null);
    let bookmarks = arcSidebarBookmarks(sidebar, profileId);
    if (!bookmarks.length) {
      return null;
    }
    return {
      type: MigrationUtils.resourceTypes.BOOKMARKS,
      async migrate(callback) {
        try {
          await MigrationUtils.insertManyBookmarksWrapper(
            [
              {
                type: lazy.PlacesUtils.bookmarks.TYPE_FOLDER,
                title: "Arc",
                children: placesTree(bookmarks),
              },
            ],
            lazy.PlacesUtils.bookmarks.toolbarGuid
          );
          addToShell(sidebar, profileId);
          callback(true);
        } catch (error) {
          console.error(error);
          callback(false);
        }
      },
    };
  }
}

export class DiaProfileMigrator extends ChromeProfileMigrator {
  static get key() {
    return "dia";
  }

  static get displayName() {
    return "Dia";
  }

  static get brandImage() {
    return "moz-icon://file:///Applications/Dia.app?size=32";
  }

  _chromeUserDataPathSuffix = "Dia";
  _keychainServiceName = "Dia Safe Storage";
  _keychainAccountName = "Dia";
}
