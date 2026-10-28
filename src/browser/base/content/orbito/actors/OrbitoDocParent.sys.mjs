/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Parent side of the document page (OrbitoDocs.sys.mjs): gives the page the
 * document its URL names, rendered and sanitized. The child runs in a web
 * content process, so the document is picked by the URL the parent knows,
 * never by what the child sends; the child only picks one of its versions.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  OrbitoAssistantCore:
    "chrome://browser/content/orbito/OrbitoAssistantCore.sys.mjs",
  DownloadPaths: "resource://gre/modules/DownloadPaths.sys.mjs",
  OrbitoDocs: "chrome://browser/content/orbito/OrbitoDocs.sys.mjs",
});
const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

export class OrbitoDocParent extends JSWindowActorParent {
  /**
   * "load" {version?}: the document's title, sources, versions and the
   * rendered content of version (by default the current one). While the
   * model is writing it, what it has written so far, with status "writing",
   * or "stopped" once it stopped without saving.
   * "restore" {version}: restores that version; every tab showing the
   * document is then told it changed.
   * "save" {version}: saves that version's Markdown to a file the user picks.
   * "print": opens Firefox's print dialog for the page (Save to PDF there).
   * All resolve to {error} on failure.
   */
  async receiveMessage({ name, data }) {
    let id = lazy.OrbitoDocs.idOf(this.manager.documentURI);
    let isPrivate = this.browsingContext.usePrivateBrowsing;
    let core = lazy.OrbitoAssistantCore;
    let version = Number.isInteger(data?.version) ? data.version : null;
    if (name == "restore") {
      try {
        await core.restoreArtifact(id, version, { isPrivate });
        return {};
      } catch (e) {
        return { error: e.message };
      }
    }
    if (name == "print") {
      try {
        this.browsingContext.topChromeWindow.PrintUtils.startPrintWindow(
          this.browsingContext
        );
        return {};
      } catch (e) {
        return { error: e.message };
      }
    }
    if (name == "save") {
      let artifact = id && (await core.getArtifact(id, { isPrivate, version }));
      if (!artifact) {
        return { error: t("orbito-doc-gone") };
      }
      try {
        await this._saveMarkdown(artifact);
        return {};
      } catch (e) {
        return { error: t("orbito-doc-save-failed", { error: e.message }) };
      }
    }
    if (name != "load") {
      return null;
    }
    let draft = id && version == null && core.draft(id, { isPrivate });
    if (draft) {
      return {
        title: draft.title,
        html: lazy.OrbitoDocs.render(draft.content),
        sources: [],
        version: null,
        current: null,
        versions: [],
        status: draft.stopped ? "stopped" : "writing",
      };
    }
    let artifact = id && (await core.getArtifact(id, { isPrivate, version }));
    if (!artifact) {
      return { error: t("orbito-doc-gone-private") };
    }
    return {
      title: artifact.title,
      html: lazy.OrbitoDocs.render(artifact.content),
      sources: artifact.source_urls,
      version: artifact.version,
      current: artifact.current_version,
      versions: await core.artifactVersions(id, { isPrivate }),
    };
  }

  /** Asks where to save the Markdown, named after the title, and saves it. */
  async _saveMarkdown(artifact) {
    let picker = Cc["@mozilla.org/filepicker;1"].createInstance(
      Ci.nsIFilePicker
    );
    picker.init(
      this.browsingContext,
      t("orbito-doc-save-markdown"),
      Ci.nsIFilePicker.modeSave
    );
    picker.defaultString = `${
      lazy.DownloadPaths.sanitize(artifact.title) || t("orbito-doc-file-name")
    }.md`;
    picker.defaultExtension = "md";
    picker.appendFilter("Markdown", "*.md");
    picker.appendFilters(Ci.nsIFilePicker.filterAll);
    let result = await new Promise(resolve => picker.open(resolve));
    if (result != Ci.nsIFilePicker.returnCancel) {
      await IOUtils.writeUTF8(picker.file.path, artifact.content);
    }
  }
}
