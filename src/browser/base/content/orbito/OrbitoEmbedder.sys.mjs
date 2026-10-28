/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Browsing recall's text embeddings: Google's EmbeddingGemma 300M (q4),
 * shipped with the app in browser/orbito-models/ (scripts/recall-model.py,
 * which also makes its feature-extraction output the model's own
 * embedding), run by Firefox's ML engine on its native ONNX runtime.
 * Nothing is downloaded, so it works offline from the first run. Its
 * embeddings are cut to their first EMBEDDING_SIZE dimensions, which the
 * model is trained to keep useful on their own (Matryoshka). The engine
 * stops by itself when it has not been used for a while
 * (browser.ml.modelCacheTimeout) and starts again on the next use.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  createEngine: "chrome://global/content/ml/EngineProcess.sys.mjs",
  normalized: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
});

// Where the build puts the model (browser/orbito-models/), and the URL it
// is read from: Firefox's model hub builds file URLs from the hub URL's
// origin, which resource:/// does not have, so the directory gets a host
// of its own.
const MODEL_DIR = "resource:///orbito-models/";
const MODEL_HUB = "resource://orbito-models/";
const MODEL = "orbito/embeddinggemma-300m";
const REVISION = "main";
const ENGINE_ID = "orbito-recall";

export const EMBEDDING_SIZE = 256;

export const OrbitoEmbedder = {
  _engine: null,
  _available: null,

  /** Whether this build ships the model. */
  async available() {
    this._registerHub();
    // In omni.ja in packaged builds, as files in local builds.
    this._available ??= fetch(`${MODEL_HUB}${MODEL}/${REVISION}/config.json`)
      .then(response => response.ok)
      .catch(() => false);
    return this._available;
  },

  _registerHub() {
    let handler = Services.io
      .getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler);
    if (!handler.hasSubstitution("orbito-models")) {
      handler.setSubstitution(
        "orbito-models",
        Services.io.newURI(handler.resolveURI(Services.io.newURI(MODEL_DIR)))
      );
    }
  },

  _start() {
    this._registerHub();
    this._engine ??= lazy
      .createEngine({
        engineId: ENGINE_ID,
        taskName: "feature-extraction",
        modelId: MODEL,
        modelRevision: REVISION,
        modelHubRootUrl: MODEL_HUB,
        modelHubUrlTemplate: "{model}/{revision}",
        dtype: "q4",
        backend: "onnx-native",
        timeoutMS: -1,
      })
      .catch(e => {
        this._engine = null;
        throw e;
      });
    return this._engine;
  },

  /**
   * The unit-length embeddings of texts, with the prompts EmbeddingGemma
   * was trained with: a search as a "query", what is searched as a
   * "passage" of a page with a title.
   *
   * @param {string[]} texts
   * @param {"query"|"passage"} kind
   * @param {object} [options]
   * @param {string} [options.title] The passages' page title.
   * @returns {Promise<Float32Array[]>}
   */
  async embed(texts, kind, { title = "" } = {}) {
    if (!texts.length) {
      return [];
    }
    let prompt =
      kind == "query"
        ? text => `task: search result | query: ${text}`
        : text => `title: ${title.trim() || "none"} | text: ${text}`;
    let request = {
      args: [texts.map(prompt)],
      options: { pooling: "mean", normalize: true },
    };
    let output;
    try {
      output = await (await this._start()).run(request);
    } catch (e) {
      // The engine may have stopped for being idle; start it once more.
      this._engine = null;
      output = await (await this._start()).run(request);
    }
    return texts.map((text, i) =>
      lazy.normalized(Array.from(output[i]).slice(0, EMBEDDING_SIZE))
    );
  },
};
