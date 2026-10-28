/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Content side of the document page (OrbitoDocs.sys.mjs): asks the parent
 * for the document once the page is parsed and puts it in. The HTML comes
 * sanitized and is parsed with the sanitizer again here, so nothing in it
 * can run or load. The page has no script, so the version picker and the
 * restore, save and print buttons are wired up here too.
 */

// Orbito's strings reach this content process from the parent's L10n
// source, as the page's own (doc.html's <link rel="localization">) do.
const { t } = ChromeUtils.importESModule(
  "chrome://browser/content/orbito/OrbitoL10n.sys.mjs"
);

// What the page says of a document the model is writing.
const STATUS = {
  writing: t("orbito-doc-status-writing"),
  stopped: t("orbito-doc-status-stopped"),
};

// Matches OrbitoDocs.SANITIZER_FLAGS; that module is parent-only.
const SANITIZER_FLAGS =
  Ci.nsIParserUtils.SanitizerAllowStyle |
  Ci.nsIParserUtils.SanitizerDropForms |
  Ci.nsIParserUtils.SanitizerDropMedia;

export class OrbitoDocChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type == "DOMContentLoaded") {
      let doc = this.document;
      // Not on the <title> by data-l10n-id: that could land after the
      // document's own title.
      doc.title = t("orbito-doc-page-title");
      // Choosing a version only shows it, so untrusted events may do that.
      doc.getElementById("versions").addEventListener(
        "change",
        e => this._load(Number(e.target.value)).catch(console.error),
        false,
        true
      );
      // Only the user's clicks restore, save or print (open a dialog): a
      // listener on a content page also gets untrusted events unless told.
      for (let [button, message] of [
        ["restore", "restore"],
        ["save-markdown", "save"],
        ["print", "print"],
      ]) {
        doc.getElementById(button).addEventListener(
          "click",
          () => this._send(message).catch(console.error),
          false,
          false
        );
      }
      this._load().catch(console.error);
    }
  }

  receiveMessage({ name }) {
    if (name == "changed") {
      // A new version: show it, whichever version was shown.
      this._load().catch(console.error);
    }
  }

  async _load(version) {
    let result = await this.sendQuery("load", { version });
    let doc = this.document;
    if (!result || result.error) {
      let error = doc.getElementById("error");
      error.textContent = result?.error || t("orbito-doc-not-shown");
      error.hidden = false;
      return;
    }
    doc.getElementById("error").hidden = true;
    doc.title = result.title || t("orbito-doc-untitled");
    doc.getElementById("title").textContent = result.title;
    let status = doc.getElementById("status");
    status.textContent = STATUS[result.status] ?? "";
    status.hidden = !result.status;
    this._sources(result.sources);
    this._versions(result);
    // Nothing to export while it is written, or once that stopped unsaved.
    doc.getElementById("actions").hidden = !!result.status;
    let content = doc.getElementById("content");
    content.replaceChildren(
      Cc["@mozilla.org/parserutils;1"]
        .getService(Ci.nsIParserUtils)
        .parseFragment(
          result.html,
          SANITIZER_FLAGS,
          false,
          doc.documentURIObject,
          content
        )
    );
  }

  /** Fills the version picker; restoring is offered for older versions. */
  _versions({ version, current, versions }) {
    let doc = this.document;
    let select = doc.getElementById("versions");
    select.replaceChildren(
      ...versions.toReversed().map(v => {
        let option = doc.createElement("option");
        option.value = v.version;
        let date = new Date(v.created_at).toLocaleString();
        option.textContent = t(
          v.version == current
            ? "orbito-doc-version-current"
            : "orbito-doc-version",
          { version: v.version, date }
        );
        return option;
      })
    );
    select.value = version;
    doc.getElementById("restore").hidden = version == current;
    doc.getElementById("history").hidden = versions.length < 2;
  }

  /** Asks the parent to act on the version shown; shows what went wrong. */
  async _send(message) {
    let select = this.document.getElementById("versions");
    let result = await this.sendQuery(message, {
      version: Number(select.value),
    });
    let error = this.document.getElementById("error");
    error.textContent = result?.error ?? "";
    error.hidden = !result?.error;
  }

  /** "Sources:" and a link for each http(s) URL the document was based on. */
  _sources(urls) {
    let doc = this.document;
    let links = urls
      .filter(url => /^https?:\/\//i.test(url))
      .map(url => {
        let a = doc.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = url;
        return a;
      });
    let sources = doc.getElementById("sources");
    sources.replaceChildren(
      t("orbito-doc-sources"),
      ...links.flatMap((a, i) => (i ? [", ", a] : [a]))
    );
    sources.hidden = !links.length;
  }
}
