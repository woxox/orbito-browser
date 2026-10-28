/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Storage for assistant Threads, memories and documents. Only
 * OrbitoAssistantCore uses it.
 *
 * A Thread is {id, space_id, title, created_at, updated_at}, space_id
 * being the Space it belongs to (null for none in particular, as a
 * scheduled task's without a Space); a
 * message is {id, thread_id, seq, role, backend, model, created_at,
 * parts, input_tokens, output_tokens}, the tokens being what a reply used
 * (null for questions and for replies whose backend reported none); a
 * memory is {id, text, source_thread, source_url, created_at,
 * last_used_at, space_id}, space_id being the Space it is kept for (null
 * for all of them); a document (artifact) is {id, title,
 * thread_id, space_id, source_urls, created_at, updated_at,
 * current_version}, space_id being the Space it belongs to (null for none
 * in particular), with its Markdown content kept per version (getArtifact adds the
 * content and its version number). A scheduled task and its runs are
 * the rows of tasks and task_runs, with the task's schedule and
 * allowed_tools parsed and enabled a boolean, and space_id the Space it
 * belongs to (null for none in particular). The pages Browsing recall
 * remembers (OrbitoRecall.sys.mjs) are rows of pages, with their visits in
 * page_visits: a page's text is kept once, and each visit has the Space it
 * was in (space_id, null for one before Spaces). Stores hand out copies, so
 * callers save changes explicitly. Threads and documents of normal
 * windows live in the profile's sqlite file; private windows use a
 * MemoryStore so nothing reaches the disk. Private windows never use
 * memories, never show the library, never run tasks and are never
 * remembered, so only the sqlite store has them, what the library lists
 * and deletes, tasks and pages.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  excerpt: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  ftsQuery: "chrome://browser/content/orbito/tools/recall.sys.mjs",
  isExcludedHost: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  pageHash: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  pageRank: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  pageScore: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  pageTerms: "chrome://browser/content/orbito/OrbitoRecallSearch.sys.mjs",
  Sqlite: "resource://gre/modules/Sqlite.sys.mjs",
});

export const SCHEMA_VERSION = 13;

// Each entry upgrades the schema from its index to the next version.
export const MIGRATIONS = [
  async conn => {
    await conn.execute(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        forked_from TEXT NULL
      )`);
    await conn.execute(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        backend TEXT NULL,
        model TEXT NULL,
        created_at INTEGER,
        parts TEXT NOT NULL
      )`);
    await conn.execute(
      "CREATE INDEX messages_conversation ON messages (conversation_id, seq)"
    );
  },
  async conn => {
    await conn.execute(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        source_conversation TEXT NULL,
        source_url TEXT NULL,
        created_at INTEGER,
        last_used_at INTEGER NULL
      )`);
    // Full-text index of memories.text, kept in step by the triggers.
    await conn.execute(`
      CREATE VIRTUAL TABLE memories_fts USING fts5(
        text, content = 'memories', content_rowid = 'rowid'
      )`);
    await conn.execute(`
      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts (rowid, text) VALUES (new.rowid, new.text);
      END`);
    await conn.execute(`
      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts (memories_fts, rowid, text)
        VALUES ('delete', old.rowid, old.text);
      END`);
    await conn.execute(`
      CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts (memories_fts, rowid, text)
        VALUES ('delete', old.rowid, old.text);
        INSERT INTO memories_fts (rowid, text) VALUES (new.rowid, new.text);
      END`);
  },
  async conn => {
    await conn.execute(`
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        title TEXT,
        conversation_id TEXT NULL,
        source_urls TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        current_version INTEGER
      )`);
    await conn.execute(`
      CREATE TABLE artifact_versions (
        artifact_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER,
        PRIMARY KEY (artifact_id, version)
      )`);
    // Title and content of each document's current version, written by
    // saveArtifact in the same transaction as the version.
    await conn.execute(`
      CREATE VIRTUAL TABLE artifacts_fts USING fts5(
        artifact_id UNINDEXED, title, content
      )`);
  },
  async conn => {
    // Conversation titles and the text of their messages. The
    // conversations it indexed went with them, when they became Threads.
    await conn.execute(`
      CREATE VIRTUAL TABLE conversations_fts USING fts5(
        conversation_id UNINDEXED, text
      )`);
  },
  async conn => {
    // Scheduled tasks (OrbitoTasks.sys.mjs) and their runs.
    await conn.execute(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        name TEXT,
        prompt TEXT NULL,
        skill TEXT NULL,
        schedule TEXT,
        backend TEXT,
        model TEXT,
        allowed_tools TEXT,
        enabled INTEGER,
        created_at INTEGER,
        last_run_at INTEGER NULL,
        next_run_at INTEGER
      )`);
    await conn.execute(`
      CREATE TABLE task_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        started_at INTEGER,
        finished_at INTEGER NULL,
        status TEXT,
        conversation_id TEXT NULL,
        artifact_id TEXT NULL,
        input_tokens INTEGER NULL,
        output_tokens INTEGER NULL,
        error TEXT NULL
      )`);
    await conn.execute(
      "CREATE INDEX task_runs_task ON task_runs (task_id, started_at)"
    );
  },
  async conn => {
    // The tokens each reply used.
    await conn.execute(
      "ALTER TABLE messages ADD COLUMN input_tokens INTEGER NULL"
    );
    await conn.execute(
      "ALTER TABLE messages ADD COLUMN output_tokens INTEGER NULL"
    );
  },
  async conn => {
    // Browsing recall: the latest text of the pages the user read, and
    // their visits. The two full-text indexes of the pages' title and text
    // are written by the store with the text (see savePage), not by
    // triggers, so that a visit to an unchanged page leaves them be. A
    // page's embeddings (page_chunks) are of the text whose hash is its
    // embedded_hash, and are made later (OrbitoRecall.sys.mjs).
    await conn.execute(`
      CREATE TABLE pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        hash TEXT NOT NULL,
        first_visit_at INTEGER NOT NULL,
        last_visit_at INTEGER NOT NULL,
        embedded_hash TEXT NULL
      )`);
    await conn.execute(
      "CREATE INDEX pages_last_visit ON pages (last_visit_at)"
    );
    await conn.execute(`
      CREATE TABLE page_visits (
        id INTEGER PRIMARY KEY,
        page_id INTEGER NOT NULL,
        visited_at INTEGER NOT NULL,
        dwell_ms INTEGER NULL
      )`);
    await conn.execute(
      "CREATE INDEX page_visits_page ON page_visits (page_id, visited_at)"
    );
    await conn.execute(
      "CREATE INDEX page_visits_time ON page_visits (visited_at)"
    );
    // The embedding of each chunk of a page's text (see pageChunks), a
    // byte per dimension times scale (see quantize); start is where the
    // chunk starts in the text. Page ids are never reused, so that an
    // embedding kept in memory never stands for another page.
    await conn.execute(`
      CREATE TABLE page_chunks (
        page_id INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        start INTEGER NOT NULL,
        scale REAL NOT NULL,
        vector BLOB NOT NULL,
        PRIMARY KEY (page_id, seq)
      )`);
    // Any part of a word, for words of three or more characters.
    await conn.execute(`
      CREATE VIRTUAL TABLE pages_fts USING fts5(
        title, text, content = 'pages', content_rowid = 'id',
        tokenize = 'trigram'
      )`);
    // A word's start, for shorter words, which trigrams cannot find.
    await conn.execute(`
      CREATE VIRTUAL TABLE pages_fts_words USING fts5(
        title, text, content = 'pages', content_rowid = 'id',
        tokenize = 'unicode61'
      )`);
  },
  async conn => {
    // Conversations became Threads, which belong to a Space. They start
    // empty: the conversations and their messages are not carried over, and
    // what pointed at one (a document, a memory, a task's run) no longer
    // does.
    for (let table of ["conversations_fts", "messages", "conversations"]) {
      await conn.execute(`DROP TABLE ${table}`);
    }
    await conn.execute(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        space_id TEXT NULL,
        title TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )`);
    await conn.execute(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        backend TEXT NULL,
        model TEXT NULL,
        created_at INTEGER,
        parts TEXT NOT NULL,
        input_tokens INTEGER NULL,
        output_tokens INTEGER NULL
      )`);
    await conn.execute(
      "CREATE INDEX messages_thread ON messages (thread_id, seq)"
    );
    // Thread titles and the text of their messages (see indexThread and
    // indexMessage).
    await conn.execute(`
      CREATE VIRTUAL TABLE threads_fts USING fts5(
        thread_id UNINDEXED, text
      )`);
    for (let [table, from, to] of [
      ["artifacts", "conversation_id", "thread_id"],
      ["memories", "source_conversation", "source_thread"],
      ["task_runs", "conversation_id", "thread_id"],
    ]) {
      await conn.execute(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
      await conn.execute(`UPDATE ${table} SET ${to} = NULL`);
    }
  },
  async conn => {
    // A memory is kept for one Space or, as all earlier ones, for all.
    await conn.execute("ALTER TABLE memories ADD COLUMN space_id TEXT NULL");
  },
  async conn => {
    // A visit is in the Space of the tab the page was read in; the visits
    // before Spaces, in none in particular.
    await conn.execute("ALTER TABLE page_visits ADD COLUMN space_id TEXT NULL");
  },
  async conn => {
    // A document belongs to the Space of the Thread that made it; one of
    // no Thread (or of a scheduled task's), to none in particular.
    await conn.execute("ALTER TABLE artifacts ADD COLUMN space_id TEXT NULL");
    await conn.execute(
      `UPDATE artifacts SET space_id =
         (SELECT space_id FROM threads WHERE id = artifacts.thread_id)`
    );
    await conn.execute(
      "CREATE INDEX artifacts_thread ON artifacts (thread_id)"
    );
  },
  async conn => {
    // A scheduled task belongs to a Space, its runs' Threads with it; the
    // tasks before Spaces, to none in particular.
    await conn.execute("ALTER TABLE tasks ADD COLUMN space_id TEXT NULL");
  },
  async conn => {
    // The values a task gives the inputs of a skill made from a demo, as
    // JSON {name: value}.
    await conn.execute("ALTER TABLE tasks ADD COLUMN inputs TEXT NULL");
  },
];

const PAGE_INDEXES = ["pages_fts", "pages_fts_words"];

// Adds the pages that match where to the full-text indexes, or with
// remove, takes them out (an external-content index needs the indexed
// values to take a row out).
async function indexPages(conn, where, params, { remove = false } = {}) {
  for (let table of PAGE_INDEXES) {
    await conn.execute(
      remove
        ? `INSERT INTO ${table} (${table}, rowid, title, text)
           SELECT 'delete', id, title, text FROM pages WHERE ${where}`
        : `INSERT INTO ${table} (rowid, title, text)
           SELECT id, title, text FROM pages WHERE ${where}`,
      params
    );
  }
}

// Forgets pages with their visits and embeddings.
async function forgetPages(conn, ids) {
  for (let pageId of ids) {
    await indexPages(conn, "id = :pageId", { pageId }, { remove: true });
    for (let sql of [
      "DELETE FROM page_visits WHERE page_id = :pageId",
      "DELETE FROM page_chunks WHERE page_id = :pageId",
      "DELETE FROM pages WHERE id = :pageId",
    ]) {
      await conn.execute(sql, { pageId });
    }
  }
}

// A quantized vector as a BLOB's bytes and back.
function vectorBlob(bytes) {
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
}

function vectorOf(blob) {
  return new Int8Array(Uint8Array.from(blob).buffer);
}

// Pages found for each word of a search, best matches first, before the
// period is applied and recency counted.
const TERM_CANDIDATES = 1000;

// threads_fts has a row per message with text, under the message's
// rowid, and one per Thread for its title, under minus the
// Thread's rowid, so that saving either replaces its own row.
async function indexThread(conn, id) {
  await conn.execute(
    `DELETE FROM threads_fts
     WHERE rowid = (SELECT -rowid FROM threads WHERE id = :id)`,
    { id }
  );
  await conn.execute(
    `INSERT INTO threads_fts (rowid, thread_id, text)
     SELECT -rowid, id, coalesce(title, '') FROM threads WHERE id = :id`,
    { id }
  );
}

async function indexMessage(conn, id, parts) {
  await conn.execute(
    `DELETE FROM threads_fts
     WHERE rowid = (SELECT rowid FROM messages WHERE id = :id)`,
    { id }
  );
  let text = parts
    .filter(p => p.type == "text")
    .map(p => p.text)
    .join("\n");
  if (text) {
    await conn.execute(
      `INSERT INTO threads_fts (rowid, thread_id, text)
       SELECT rowid, thread_id, :text FROM messages WHERE id = :id`,
      { id, text }
    );
  }
}

// The memories (visits, documents) a Space sees: those for all Spaces (or none in
// particular) and its own (with :space null, space_id = :space is never
// true).
const IN_SPACE = "(space_id IS NULL OR space_id = :space)";

// The latest visit to page p between :since and :until, with space only
// those a Space sees, as visited_at.
function latestVisit(space) {
  return `(SELECT max(visited_at) FROM page_visits v
           WHERE v.page_id = p.id AND v.visited_at BETWEEN :since AND :until
             ${space !== undefined ? `AND ${IN_SPACE}` : ""})
            AS visited_at`;
}

export class SqliteStore {
  #path;
  #connection = null;

  /**
   * @param {string} path
   * @param {Function} [beforeClose] Awaited before the connection closes at
   *   shutdown, to write what is still pending.
   */
  constructor(path, beforeClose) {
    this.#path = path;
    this.beforeClose = beforeClose;
  }

  #db() {
    this.#connection ??= this.#open().catch(e => {
      this.#connection = null;
      throw e;
    });
    return this.#connection;
  }

  async #open() {
    let conn = await lazy.Sqlite.openConnection({
      path: this.#path,
      extensions: ["fts5"],
    });
    try {
      let version = await conn.getSchemaVersion();
      if (version < SCHEMA_VERSION) {
        await conn.executeTransaction(async () => {
          for (let migrate of MIGRATIONS.slice(version)) {
            await migrate(conn);
          }
          await conn.setSchemaVersion(SCHEMA_VERSION);
        });
      }
    } catch (e) {
      await conn.close();
      throw e;
    }
    lazy.Sqlite.shutdown.addBlocker("OrbitoAssistantStore: close", async () => {
      try {
        await this.beforeClose?.();
      } finally {
        await conn.close();
      }
    });
    return conn;
  }

  async getThread(id) {
    let rows = await (
      await this.#db()
    ).execute("SELECT * FROM threads WHERE id = :id", { id });
    if (!rows.length) {
      return null;
    }
    let row = rows[0];
    return {
      id: row.getResultByName("id"),
      title: row.getResultByName("title"),
      created_at: row.getResultByName("created_at"),
      updated_at: row.getResultByName("updated_at"),
      space_id: row.getResultByName("space_id"),
    };
  }

  async saveThread(thread) {
    let conn = await this.#db();
    await conn.executeTransaction(async () => {
      await conn.execute(
        `INSERT INTO threads (id, space_id, title, created_at, updated_at)
         VALUES (:id, :space_id, :title, :created_at, :updated_at)
         ON CONFLICT (id) DO UPDATE SET
           title = excluded.title, updated_at = excluded.updated_at`,
        thread
      );
      await indexThread(conn, thread.id);
    });
  }

  async getMessages(threadId) {
    let rows = await (
      await this.#db()
    ).execute(
      "SELECT * FROM messages WHERE thread_id = :id ORDER BY seq",
      { id: threadId }
    );
    return rows.map(row => ({
      id: row.getResultByName("id"),
      thread_id: row.getResultByName("thread_id"),
      seq: row.getResultByName("seq"),
      role: row.getResultByName("role"),
      backend: row.getResultByName("backend"),
      model: row.getResultByName("model"),
      created_at: row.getResultByName("created_at"),
      parts: JSON.parse(row.getResultByName("parts")),
      input_tokens: row.getResultByName("input_tokens"),
      output_tokens: row.getResultByName("output_tokens"),
    }));
  }

  async saveMessage(message) {
    let { id, thread_id, seq, role, backend, model, created_at } =
      message;
    let conn = await this.#db();
    await conn.executeTransaction(async () => {
      await conn.execute(
        `INSERT INTO messages
           (id, thread_id, seq, role, backend, model, created_at, parts,
            input_tokens, output_tokens)
         VALUES
           (:id, :thread_id, :seq, :role, :backend, :model, :created_at,
            :parts, :input_tokens, :output_tokens)
         ON CONFLICT (id) DO UPDATE SET parts = excluded.parts,
           input_tokens = excluded.input_tokens,
           output_tokens = excluded.output_tokens`,
        {
          id,
          thread_id,
          seq,
          role,
          backend,
          model,
          created_at,
          parts: JSON.stringify(message.parts),
          input_tokens: message.input_tokens ?? null,
          output_tokens: message.output_tokens ?? null,
        }
      );
      await indexMessage(conn, id, message.parts);
    });
  }

  /**
   * The Threads for the library and the Thread list, last asked first:
   * [{id, title, updated_at, space_id, scheduled, backend, documents}],
   * scheduled being whether a scheduled task ran in it, backend the one of
   * the latest reply and documents how many documents it made. With text, only those whose title or messages have any
   * of its words (as a word's start); with space, only those that Space
   * sees, as IN_SPACE says (null: only those of none).
   *
   * @param {string} [text]
   * @param {object} [options]
   * @param {?string} [options.space] A Space's id.
   */
  async listThreads(text = "", { space } = {}) {
    let match = text.trim() ? lazy.ftsQuery(text) : null;
    let where = [
      ...(match
        ? [
            `c.id IN (SELECT thread_id FROM threads_fts
               WHERE threads_fts MATCH :match)`,
          ]
        : []),
      ...(space !== undefined ? [IN_SPACE] : []),
    ];
    let rows = await (
      await this.#db()
    ).execute(
      `SELECT c.id, c.title, c.updated_at, c.space_id,
         EXISTS (SELECT 1 FROM task_runs r WHERE r.thread_id = c.id)
           AS scheduled,
         (SELECT backend FROM messages m
          WHERE m.thread_id = c.id AND m.backend IS NOT NULL
          ORDER BY m.seq DESC LIMIT 1) AS backend,
         (SELECT count(*) FROM artifacts a WHERE a.thread_id = c.id)
           AS documents
       FROM threads c
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY c.updated_at DESC`,
      {
        ...(match ? { match } : {}),
        ...(space !== undefined ? { space } : {}),
      }
    );
    return rows.map(row => ({
      id: row.getResultByName("id"),
      title: row.getResultByName("title"),
      updated_at: row.getResultByName("updated_at"),
      space_id: row.getResultByName("space_id"),
      scheduled: !!row.getResultByName("scheduled"),
      backend: row.getResultByName("backend"),
      documents: row.getResultByName("documents"),
    }));
  }

  /**
   * Deletes a Thread with its messages. The documents it made stay,
   * no longer linked to it.
   */
  async deleteThread(id) {
    let conn = await this.#db();
    await conn.executeTransaction(async () => {
      for (let sql of [
        "DELETE FROM threads_fts WHERE thread_id = :id",
        "DELETE FROM messages WHERE thread_id = :id",
        "DELETE FROM threads WHERE id = :id",
        "UPDATE artifacts SET thread_id = NULL WHERE thread_id = :id",
      ]) {
        await conn.execute(sql, { id });
      }
    });
  }

  async addMemory(memory) {
    await (
      await this.#db()
    ).execute(
      `INSERT INTO memories
         (id, text, source_thread, source_url, created_at, last_used_at,
          space_id)
       VALUES
         (:id, :text, :source_thread, :source_url, :created_at, :last_used_at,
          :space_id)`,
      memory
    );
  }

  async deleteMemory(id) {
    await (
      await this.#db()
    ).execute("DELETE FROM memories WHERE id = :id", { id });
  }

  async updateMemory(id, text) {
    await (
      await this.#db()
    ).execute("UPDATE memories SET text = :text WHERE id = :id", { id, text });
  }

  async deleteAllMemories() {
    await (await this.#db()).execute("DELETE FROM memories");
  }

  async setMemorySpace(id, space) {
    await (
      await this.#db()
    ).execute("UPDATE memories SET space_id = :space WHERE id = :id", {
      id,
      space,
    });
  }

  /**
   * All memories, most recently used (or, never used, created) first. With
   * space, only those kept for all Spaces and for that one (null: for no
   * Space, so only the former).
   *
   * @param {object} [options]
   * @param {?string} [options.space] A Space's id.
   */
  async listMemories({ space } = {}) {
    let rows = await (
      await this.#db()
    ).execute(
      `SELECT * FROM memories
       ${space !== undefined ? `WHERE ${IN_SPACE}` : ""}
       ORDER BY coalesce(last_used_at, created_at) DESC, created_at DESC`,
      space !== undefined ? { space } : {}
    );
    return rows.map(memoryOf);
  }

  /**
   * The best matches of an FTS5 query, at most limit of them; with space,
   * as for listMemories().
   */
  async searchMemories(match, limit, { space } = {}) {
    let rows = await (
      await this.#db()
    ).execute(
      `SELECT m.* FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
       WHERE memories_fts MATCH :match
         ${space !== undefined ? `AND ${IN_SPACE}` : ""}
       ORDER BY rank LIMIT :limit`,
      { match, limit, ...(space !== undefined ? { space } : {}) }
    );
    return rows.map(memoryOf);
  }

  async touchMemories(ids, time) {
    let params = Object.fromEntries(ids.map((id, i) => [`id${i}`, id]));
    await (
      await this.#db()
    ).execute(
      `UPDATE memories SET last_used_at = :time
       WHERE id IN (${ids.map((id, i) => `:id${i}`).join(", ")})`,
      { ...params, time }
    );
  }

  /**
   * Saves a document and its current version's content: a new document, or
   * a new version of one (artifact.current_version is that version's
   * number). Versions are never changed once saved.
   */
  async saveArtifact(artifact, content) {
    let conn = await this.#db();
    await conn.executeTransaction(async () => {
      await conn.execute(
        `INSERT INTO artifacts (id, title, thread_id, space_id, source_urls,
           created_at, updated_at, current_version)
         VALUES (:id, :title, :thread_id, :space_id, :source_urls,
           :created_at, :updated_at, :current_version)
         ON CONFLICT (id) DO UPDATE SET
           title = excluded.title, thread_id = excluded.thread_id,
           space_id = excluded.space_id, source_urls = excluded.source_urls,
           updated_at = excluded.updated_at,
           current_version = excluded.current_version`,
        {
          id: artifact.id,
          title: artifact.title,
          thread_id: artifact.thread_id,
          space_id: artifact.space_id ?? null,
          source_urls: JSON.stringify(artifact.source_urls),
          created_at: artifact.created_at,
          updated_at: artifact.updated_at,
          current_version: artifact.current_version,
        }
      );
      await conn.execute(
        `INSERT INTO artifact_versions (artifact_id, version, content, created_at)
         VALUES (:id, :version, :content, :created_at)`,
        {
          id: artifact.id,
          version: artifact.current_version,
          content,
          created_at: artifact.updated_at,
        }
      );
      await conn.execute(
        "DELETE FROM artifacts_fts WHERE artifact_id = :id",
        { id: artifact.id }
      );
      await conn.execute(
        `INSERT INTO artifacts_fts (artifact_id, title, content)
         VALUES (:id, :title, :content)`,
        { id: artifact.id, title: artifact.title, content }
      );
    });
  }

  /**
   * A document with the content of one of its versions (version), by
   * default the current one, or null.
   */
  async getArtifact(id, version = null) {
    let rows = await (
      await this.#db()
    ).execute(
      `SELECT a.*, v.version, v.content FROM artifacts a
       JOIN artifact_versions v
         ON v.artifact_id = a.id
         AND v.version = coalesce(:version, a.current_version)
       WHERE a.id = :id`,
      { id, version }
    );
    return rows.length ? artifactOf(rows[0]) : null;
  }

  /** A document's versions, [{version, created_at}], oldest first. */
  async artifactVersions(id) {
    let rows = await (
      await this.#db()
    ).execute(
      `SELECT version, created_at FROM artifact_versions
       WHERE artifact_id = :id ORDER BY version`,
      { id }
    );
    return rows.map(row => ({
      version: row.getResultByName("version"),
      created_at: row.getResultByName("created_at"),
    }));
  }

  /**
   * The documents whose current title or content has any of the words of
   * text (as a word's start), best first, at most limit of them:
   * [{id, title, updated_at, current_version, snippet}]. With space, only
   * those of that Space and of none (null: only the latter).
   *
   * @param {string} text
   * @param {number} limit
   * @param {object} [options]
   * @param {?string} [options.space] A Space's id.
   */
  async searchArtifacts(text, limit, { space } = {}) {
    let rows = await (
      await this.#db()
    ).execute(
      `SELECT a.id, a.title, a.updated_at, a.current_version,
         snippet(artifacts_fts, 2, '', '', '…', 24) AS snippet
       FROM artifacts_fts JOIN artifacts a ON a.id = artifacts_fts.artifact_id
       WHERE artifacts_fts MATCH :match
         ${space !== undefined ? `AND ${IN_SPACE}` : ""}
       ORDER BY rank LIMIT :limit`,
      {
        match: lazy.ftsQuery(text),
        limit,
        ...(space !== undefined ? { space } : {}),
      }
    );
    return rows.map(row => ({
      id: row.getResultByName("id"),
      title: row.getResultByName("title"),
      updated_at: row.getResultByName("updated_at"),
      current_version: row.getResultByName("current_version"),
      snippet: row.getResultByName("snippet"),
    }));
  }

  /**
   * The documents for the library and a Thread's document list, last
   * changed first: [{id, title, updated_at, thread_id, thread_title,
   * space_id}]. With text, only those whose current title or content has
   * any of its words; with space, only those of that Space and of none (as
   * for searchArtifacts()); with threadId, only those that Thread made.
   *
   * @param {string} [text]
   * @param {object} [options]
   * @param {?string} [options.space] A Space's id.
   * @param {string} [options.threadId]
   */
  async listArtifacts(text = "", { space, threadId } = {}) {
    let match = text.trim() ? lazy.ftsQuery(text) : null;
    let where = [
      ...(match
        ? [
            `a.id IN (SELECT artifact_id FROM artifacts_fts
               WHERE artifacts_fts MATCH :match)`,
          ]
        : []),
      ...(space !== undefined
        ? ["(a.space_id IS NULL OR a.space_id = :space)"]
        : []),
      ...(threadId != null ? ["a.thread_id = :threadId"] : []),
    ];
    let rows = await (
      await this.#db()
    ).execute(
      `SELECT a.id, a.title, a.updated_at, a.thread_id, a.space_id,
         c.title AS thread_title
       FROM artifacts a LEFT JOIN threads c ON c.id = a.thread_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY a.updated_at DESC`,
      {
        ...(match ? { match } : {}),
        ...(space !== undefined ? { space } : {}),
        ...(threadId != null ? { threadId } : {}),
      }
    );
    return rows.map(row => ({
      id: row.getResultByName("id"),
      title: row.getResultByName("title"),
      updated_at: row.getResultByName("updated_at"),
      thread_id: row.getResultByName("thread_id"),
      thread_title: row.getResultByName("thread_title"),
      space_id: row.getResultByName("space_id"),
    }));
  }

  /** Moves a document to a Space, or (null) to none in particular. */
  async setArtifactSpace(id, space) {
    await (
      await this.#db()
    ).execute("UPDATE artifacts SET space_id = :space WHERE id = :id", {
      id,
      space,
    });
  }

  /** Deletes a document with all its versions. */
  async deleteArtifact(id) {
    let conn = await this.#db();
    await conn.executeTransaction(async () => {
      for (let sql of [
        "DELETE FROM artifacts_fts WHERE artifact_id = :id",
        "DELETE FROM artifact_versions WHERE artifact_id = :id",
        "DELETE FROM artifacts WHERE id = :id",
      ]) {
        await conn.execute(sql, { id });
      }
    });
  }

  /* Scheduled tasks */

  /**
   * Every task, oldest first, each with its latest run as last_run (or
   * null) and the tokens all its runs used as total_input_tokens and
   * total_output_tokens.
   */
  async listTasks() {
    let conn = await this.#db();
    let tasks = (
      await conn.execute("SELECT * FROM tasks ORDER BY created_at, id")
    ).map(taskOf);
    for (let task of tasks) {
      task.last_run = (await this.listTaskRuns(task.id, 1))[0] ?? null;
      let [row] = await conn.execute(
        `SELECT coalesce(sum(input_tokens), 0) AS input,
           coalesce(sum(output_tokens), 0) AS output
         FROM task_runs WHERE task_id = :id`,
        { id: task.id }
      );
      task.total_input_tokens = row.getResultByName("input");
      task.total_output_tokens = row.getResultByName("output");
    }
    return tasks;
  }

  async getTask(id) {
    let rows = await (
      await this.#db()
    ).execute("SELECT * FROM tasks WHERE id = :id", { id });
    return rows.length ? taskOf(rows[0]) : null;
  }

  async saveTask(task) {
    await (
      await this.#db()
    ).execute(
      `INSERT INTO tasks (id, name, prompt, skill, inputs, schedule, backend,
         model, allowed_tools, enabled, created_at, last_run_at, next_run_at,
         space_id)
       VALUES (:id, :name, :prompt, :skill, :inputs, :schedule, :backend,
         :model, :allowed_tools, :enabled, :created_at, :last_run_at,
         :next_run_at, :space_id)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, prompt = excluded.prompt,
         skill = excluded.skill, inputs = excluded.inputs,
         schedule = excluded.schedule, space_id = excluded.space_id,
         backend = excluded.backend, model = excluded.model,
         allowed_tools = excluded.allowed_tools, enabled = excluded.enabled,
         last_run_at = excluded.last_run_at,
         next_run_at = excluded.next_run_at`,
      {
        id: task.id,
        name: task.name,
        prompt: task.prompt,
        skill: task.skill,
        inputs: JSON.stringify(task.inputs ?? {}),
        schedule: JSON.stringify(task.schedule),
        backend: task.backend,
        model: task.model,
        allowed_tools: JSON.stringify(task.allowed_tools),
        enabled: task.enabled ? 1 : 0,
        created_at: task.created_at,
        last_run_at: task.last_run_at,
        next_run_at: task.next_run_at,
        space_id: task.space_id ?? null,
      }
    );
  }

  /** Deletes a task with its runs; their Threads and documents stay. */
  async deleteTask(id) {
    let conn = await this.#db();
    await conn.executeTransaction(async () => {
      await conn.execute("DELETE FROM task_runs WHERE task_id = :id", { id });
      await conn.execute("DELETE FROM tasks WHERE id = :id", { id });
    });
  }

  async saveTaskRun(run) {
    await (
      await this.#db()
    ).execute(
      `INSERT INTO task_runs (id, task_id, started_at, finished_at, status,
         thread_id, artifact_id, input_tokens, output_tokens, error)
       VALUES (:id, :task_id, :started_at, :finished_at, :status,
         :thread_id, :artifact_id, :input_tokens, :output_tokens, :error)
       ON CONFLICT (id) DO UPDATE SET
         finished_at = excluded.finished_at, status = excluded.status,
         artifact_id = excluded.artifact_id,
         input_tokens = excluded.input_tokens,
         output_tokens = excluded.output_tokens, error = excluded.error`,
      run
    );
  }

  async getTaskRun(id) {
    let rows = await (
      await this.#db()
    ).execute("SELECT * FROM task_runs WHERE id = :id", { id });
    return rows.length ? taskRunOf(rows[0]) : null;
  }

  /** How many runs of any task started at or after since, not skipped. */
  async countTaskRunsSince(since) {
    let rows = await (
      await this.#db()
    ).execute(
      `SELECT count(*) AS n FROM task_runs
       WHERE started_at >= :since AND status != 'skipped'`,
      { since }
    );
    return rows[0].getResultByName("n");
  }

  /** A task's runs, latest first, at most limit of them. */
  async listTaskRuns(taskId, limit = 50) {
    let rows = await (
      await this.#db()
    ).execute(
      `SELECT * FROM task_runs WHERE task_id = :taskId
       ORDER BY started_at DESC, rowid DESC LIMIT :limit`,
      { taskId, limit }
    );
    return rows.map(taskRunOf);
  }

  /* Browsing recall */

  /**
   * Saves a page the user read with a visit to it. Its title and text are
   * written, and indexed again, only when they changed.
   *
   * @param {{url: string, title: string, text: string}} page With url as
   *   pageKey() gives it.
   * @param {number} visitedAt
   * @param {object} [options]
   * @param {?string} [options.space] The Space of the visit's tab.
   * @returns {Promise<{pageId: number, visitId: number, reindexed: boolean}>}
   */
  async savePage({ url, title, text }, visitedAt, { space = null } = {}) {
    let hash = lazy.pageHash(title, text);
    let conn = await this.#db();
    let saved;
    await conn.executeTransaction(async () => {
      let [row] = await conn.execute(
        "SELECT id, hash FROM pages WHERE url = :url",
        { url }
      );
      let pageId = row?.getResultByName("id");
      let reindexed = row?.getResultByName("hash") != hash;
      if (!row) {
        [row] = await conn.execute(
          `INSERT INTO pages
             (url, title, text, hash, first_visit_at, last_visit_at)
           VALUES (:url, :title, :text, :hash, :visitedAt, :visitedAt)
           RETURNING id`,
          { url, title, text, hash, visitedAt }
        );
        pageId = row.getResultByName("id");
        await indexPages(conn, "id = :pageId", { pageId });
      } else {
        if (reindexed) {
          await indexPages(conn, "id = :pageId", { pageId }, { remove: true });
          await conn.execute(
            `UPDATE pages SET title = :title, text = :text, hash = :hash
             WHERE id = :pageId`,
            { title, text, hash, pageId }
          );
          await indexPages(conn, "id = :pageId", { pageId });
          await conn.execute(
            "DELETE FROM page_chunks WHERE page_id = :pageId",
            { pageId }
          );
        }
        await conn.execute(
          `UPDATE pages SET
             first_visit_at = min(first_visit_at, :visitedAt),
             last_visit_at = max(last_visit_at, :visitedAt)
           WHERE id = :pageId`,
          { visitedAt, pageId }
        );
      }
      let [visit] = await conn.execute(
        `INSERT INTO page_visits (page_id, visited_at, space_id)
         VALUES (:pageId, :visitedAt, :space) RETURNING id`,
        { pageId, visitedAt, space }
      );
      saved = { pageId, visitId: visit.getResultByName("id"), reindexed };
    });
    return saved;
  }

  /** Records how long a visit from savePage lasted. */
  async setVisitDwell(visitId, dwellMs) {
    await (
      await this.#db()
    ).execute("UPDATE page_visits SET dwell_ms = :dwellMs WHERE id = :visitId", {
      visitId,
      dwellMs,
    });
  }

  /**
   * The pages with any word of text (see pageTerms) visited between since
   * and until, those with more of the words first, then the better matches
   * counting recent visits more (see pageRank), at most limit of them:
   * [{id, url, title, visited_at, coverage, excerpt}], visited_at being the
   * latest visit in that period and coverage the share of the words the
   * page has. With space, only the visits that Space sees count: its own
   * and those in no Space in particular (null: only those). No word long
   * enough finds nothing.
   */
  async searchPages(
    text,
    { since = null, until = null, limit = 20, now = Date.now(), space } = {}
  ) {
    let terms = lazy.pageTerms(text);
    if (!terms.length) {
      return [];
    }
    let conn = await this.#db();
    // Each word in its index (FTS5's functions work in a plain query only):
    // page id -> {matched, bm25}, how many of the words the page has and
    // its bm25 for them together.
    let hits = new Map();
    for (let { table, query } of terms) {
      let rows = await conn.execute(
        `SELECT rowid AS id, bm25(${table}, 2.0, 1.0) AS bm25 FROM ${table}
         WHERE ${table} MATCH :query ORDER BY rank LIMIT :limit`,
        { query, limit: TERM_CANDIDATES }
      );
      for (let row of rows) {
        let id = row.getResultByName("id");
        let hit = hits.get(id) ?? { matched: 0, bm25: 0 };
        hit.matched++;
        hit.bm25 += row.getResultByName("bm25");
        hits.set(id, hit);
      }
    }
    if (!hits.size) {
      return [];
    }
    let rows = await conn.execute(
      `SELECT * FROM (
         SELECT p.id, p.url, p.title, ${latestVisit(space)}
         FROM pages p WHERE p.id IN (SELECT value FROM json_each(:ids)))
       WHERE visited_at IS NOT NULL`,
      {
        ids: JSON.stringify([...hits.keys()]),
        since: since ?? 0,
        until: until ?? Number.MAX_SAFE_INTEGER,
        ...(space !== undefined ? { space } : {}),
      }
    );
    let found = rows
      .map(row => {
        let id = row.getResultByName("id");
        let { matched, bm25 } = hits.get(id);
        let visited_at = row.getResultByName("visited_at");
        return {
          id,
          url: row.getResultByName("url"),
          title: row.getResultByName("title"),
          visited_at,
          matched,
          score: lazy.pageScore(bm25, visited_at, now),
        };
      })
      .sort(lazy.pageRank)
      .slice(0, limit);
    let texts = new Map();
    if (found.length) {
      let ids = Object.fromEntries(found.map((p, i) => [`id${i}`, p.id]));
      for (let row of await conn.execute(
        `SELECT id, text FROM pages
         WHERE id IN (${Object.keys(ids).map(k => `:${k}`).join(", ")})`,
        ids
      )) {
        texts.set(row.getResultByName("id"), row.getResultByName("text"));
      }
    }
    return found.map(({ id, url, title, visited_at, matched }) => ({
      id,
      url,
      title,
      visited_at,
      coverage: matched / terms.length,
      excerpt: lazy.excerpt(texts.get(id), text),
    }));
  }

  /**
   * Pages with a visit between since and until, of those with the ids:
   * [{id, url, title, text, visited_at}], visited_at being the latest visit
   * in that period; with space, of the visits it sees (see searchPages).
   * With limit, the first that many of them in the order of ids, which
   * the filters apply to first.
   */
  async pagesByIds(ids, { since = null, until = null, space, limit } = {}) {
    if (!ids.length) {
      return [];
    }
    // The text only for the pages kept.
    let rows = await (
      await this.#db()
    ).execute(
      `SELECT p.id, p.url, p.title, p.text, x.visited_at
       FROM (SELECT * FROM (
               SELECT j.key AS rank, p.id, ${latestVisit(space)}
               FROM json_each(:ids) j JOIN pages p ON p.id = j.value)
             WHERE visited_at IS NOT NULL ORDER BY rank LIMIT :limit) x
       JOIN pages p ON p.id = x.id
       ORDER BY x.rank`,
      {
        ids: JSON.stringify(ids),
        since: since ?? 0,
        until: until ?? Number.MAX_SAFE_INTEGER,
        limit: limit ?? -1,
        ...(space !== undefined ? { space } : {}),
      }
    );
    return rows.map(row =>
      Object.fromEntries(
        ["id", "url", "title", "text", "visited_at"].map(name => [
          name,
          row.getResultByName(name),
        ])
      )
    );
  }

  /**
   * Pages whose text has no embeddings yet, last visited first, at most
   * limit of them: [{id, title, text, hash}].
   */
  async pagesToEmbed(limit) {
    let rows = await (
      await this.#db()
    ).execute(
      `SELECT id, title, text, hash FROM pages
       WHERE embedded_hash IS NOT hash
       ORDER BY last_visit_at DESC LIMIT :limit`,
      { limit }
    );
    return rows.map(row =>
      Object.fromEntries(
        ["id", "title", "text", "hash"].map(name => [
          name,
          row.getResultByName(name),
        ])
      )
    );
  }

  /**
   * Saves the embeddings of a page's chunks, [{start, scale, bytes}], made
   * from its text with that hash; not if the text changed since.
   *
   * @returns {Promise<boolean>} Whether they were saved.
   */
  async savePageChunks(pageId, hash, chunks) {
    let conn = await this.#db();
    let saved = false;
    await conn.executeTransaction(async () => {
      let [row] = await conn.execute(
        "SELECT hash FROM pages WHERE id = :pageId",
        { pageId }
      );
      if (row?.getResultByName("hash") != hash) {
        return;
      }
      await conn.execute("DELETE FROM page_chunks WHERE page_id = :pageId", {
        pageId,
      });
      for (let [seq, { start, scale, bytes }] of chunks.entries()) {
        await conn.execute(
          `INSERT INTO page_chunks (page_id, seq, start, scale, vector)
           VALUES (:pageId, :seq, :start, :scale, :vector)`,
          { pageId, seq, start, scale, vector: vectorBlob(bytes) }
        );
      }
      await conn.execute(
        "UPDATE pages SET embedded_hash = :hash WHERE id = :pageId",
        { hash, pageId }
      );
      saved = true;
    });
    return saved;
  }

  /**
   * Calls onChunk({page_id, start, scale, bytes}) for the embedding of
   * every chunk of every page.
   */
  async forEachPageChunk(onChunk) {
    await (
      await this.#db()
    ).execute(
      "SELECT page_id, start, scale, vector FROM page_chunks",
      null,
      row =>
        onChunk({
          page_id: row.getResultByName("page_id"),
          start: row.getResultByName("start"),
          scale: row.getResultByName("scale"),
          bytes: vectorOf(row.getResultByName("vector")),
        })
    );
  }

  /**
   * How much Browsing recall keeps: {pages, bytes}, bytes being what the
   * pages' text and their full-text indexes take.
   */
  async pageStats() {
    let [row] = await (
      await this.#db()
    ).execute(
      `SELECT (SELECT count(*) FROM pages) AS pages,
         (SELECT coalesce(sum(length(CAST(text AS BLOB))), 0) FROM pages) +
         (SELECT coalesce(sum(length(block)), 0) FROM pages_fts_data) +
         (SELECT coalesce(sum(length(block)), 0) FROM pages_fts_words_data) +
         (SELECT coalesce(sum(length(vector)), 0) FROM page_chunks)
           AS bytes`
    );
    return {
      pages: row.getResultByName("pages"),
      bytes: row.getResultByName("bytes"),
    };
  }

  /** Forgets the pages on the domains, or under them, with their visits. */
  async deletePagesOf(domains) {
    if (!domains.length) {
      return;
    }
    let conn = await this.#db();
    await conn.executeTransaction(async () => {
      let ids = [];
      for (let row of await conn.execute("SELECT id, url FROM pages")) {
        let host = URL.parse(row.getResultByName("url"))?.hostname ?? "";
        if (lazy.isExcludedHost(host, domains)) {
          ids.push(row.getResultByName("id"));
        }
      }
      await forgetPages(conn, ids);
    });
  }

  /** Forgets a page with its visits. */
  async deletePage(url) {
    let conn = await this.#db();
    await conn.executeTransaction(async () => {
      let rows = await conn.execute("SELECT id FROM pages WHERE url = :url", {
        url,
      });
      await forgetPages(
        conn,
        rows.map(row => row.getResultByName("id"))
      );
    });
  }

  /** A remembered page, {url, title, text}, or null. */
  async getPage(url) {
    let [row] = await (
      await this.#db()
    ).execute("SELECT url, title, text FROM pages WHERE url = :url", { url });
    return row
      ? {
          url: row.getResultByName("url"),
          title: row.getResultByName("title"),
          text: row.getResultByName("text"),
        }
      : null;
  }

  /**
   * The timeline: the remembered pages by the local days they were visited
   * on, latest first, one entry per page and day, at most limit of them,
   * from the entries whose latest visit is before before:
   * [{url, title, start, day, visited_at, dwell_ms}], start being the first
   * characters of the page's text, day the local date (YYYY-MM-DD),
   * visited_at the latest visit that day and dwell_ms the time spent on it
   * that day.
   */
  async listPageDays({ before = Number.MAX_SAFE_INTEGER, limit = 50 } = {}) {
    let rows = await (
      await this.#db()
    ).execute(
      `SELECT p.url, p.title, substr(p.text, 1, 400) AS start,
         date(v.visited_at / 1000, 'unixepoch', 'localtime') AS day,
         max(v.visited_at) AS visited_at,
         sum(coalesce(v.dwell_ms, 0)) AS dwell_ms
       FROM page_visits v JOIN pages p ON p.id = v.page_id
       GROUP BY p.id, day
       HAVING max(v.visited_at) < :before
       ORDER BY visited_at DESC
       LIMIT :limit`,
      { before, limit }
    );
    return rows.map(row =>
      Object.fromEntries(
        ["url", "title", "start", "day", "visited_at", "dwell_ms"].map(name => [
          name,
          row.getResultByName(name),
        ])
      )
    );
  }

  /**
   * Deletes everything the assistant kept from what the user did: the
   * Threads, memories, documents, scheduled tasks' runs and
   * remembered pages. Scheduled tasks themselves stay.
   */
  async deleteAllData() {
    let conn = await this.#db();
    await conn.executeTransaction(async () => {
      for (let table of PAGE_INDEXES) {
        await conn.execute(
          `INSERT INTO ${table} (${table}) VALUES ('delete-all')`
        );
      }
      for (let table of [
        "page_chunks",
        "page_visits",
        "pages",
        "task_runs",
        "artifacts_fts",
        "artifact_versions",
        "artifacts",
        // memories_fts follows by its triggers.
        "memories",
        "threads_fts",
        "messages",
        "threads",
      ]) {
        await conn.execute(`DELETE FROM ${table}`);
      }
    });
  }

  /**
   * What is kept in a Space goes to another: its Threads, memories,
   * documents, page visits and tasks.
   */
  async moveSpace(from, to) {
    let conn = await this.#db();
    await conn.executeTransaction(async () => {
      for (let table of SPACE_TABLES) {
        await conn.execute(
          `UPDATE ${table} SET space_id = :to WHERE space_id = :from`,
          { from, to }
        );
      }
    });
  }

  /**
   * Deletes what is kept in a Space: its Threads with their messages, its
   * memories, its documents with their versions, its tasks with their runs
   * and its page visits, with the pages no other visit is left of. The
   * documents of other Spaces its Threads made stay, no longer linked to
   * them.
   */
  async deleteSpace(space) {
    let conn = await this.#db();
    await conn.executeTransaction(async () => {
      let threads = "SELECT id FROM threads WHERE space_id = :space";
      let artifacts = "SELECT id FROM artifacts WHERE space_id = :space";
      let pages = (
        await conn.execute(
          "SELECT DISTINCT page_id FROM page_visits WHERE space_id = :space",
          { space }
        )
      ).map(row => row.getResultByName("page_id"));
      for (let sql of [
        `DELETE FROM threads_fts WHERE thread_id IN (${threads})`,
        `DELETE FROM messages WHERE thread_id IN (${threads})`,
        `UPDATE artifacts SET thread_id = NULL WHERE thread_id IN (${threads})`,
        "DELETE FROM threads WHERE space_id = :space",
        // memories_fts follows by its triggers.
        "DELETE FROM memories WHERE space_id = :space",
        `DELETE FROM artifacts_fts WHERE artifact_id IN (${artifacts})`,
        `DELETE FROM artifact_versions WHERE artifact_id IN (${artifacts})`,
        "DELETE FROM artifacts WHERE space_id = :space",
        `DELETE FROM task_runs WHERE task_id IN
           (SELECT id FROM tasks WHERE space_id = :space)`,
        "DELETE FROM tasks WHERE space_id = :space",
        "DELETE FROM page_visits WHERE space_id = :space",
      ]) {
        await conn.execute(sql, { space });
      }
      let left = [];
      for (let pageId of pages) {
        let rows = await conn.execute(
          "SELECT 1 FROM page_visits WHERE page_id = :pageId LIMIT 1",
          { pageId }
        );
        if (!rows.length) {
          left.push(pageId);
        }
      }
      await forgetPages(conn, left);
    });
  }

  /**
   * Forgets the visits before a time, and the pages last visited before
   * it.
   */
  async prunePages(before) {
    let conn = await this.#db();
    await conn.executeTransaction(async () => {
      await conn.execute("DELETE FROM page_visits WHERE visited_at < :before", {
        before,
      });
      await conn.execute(
        `DELETE FROM page_chunks WHERE page_id IN
           (SELECT id FROM pages WHERE last_visit_at < :before)`,
        { before }
      );
      await indexPages(
        conn,
        "last_visit_at < :before",
        { before },
        { remove: true }
      );
      await conn.execute("DELETE FROM pages WHERE last_visit_at < :before", {
        before,
      });
    });
  }
}

function taskOf(row) {
  return {
    id: row.getResultByName("id"),
    name: row.getResultByName("name"),
    prompt: row.getResultByName("prompt"),
    skill: row.getResultByName("skill"),
    inputs: JSON.parse(row.getResultByName("inputs") || "{}"),
    schedule: JSON.parse(row.getResultByName("schedule")),
    backend: row.getResultByName("backend"),
    model: row.getResultByName("model"),
    allowed_tools: JSON.parse(row.getResultByName("allowed_tools") || "[]"),
    enabled: !!row.getResultByName("enabled"),
    created_at: row.getResultByName("created_at"),
    last_run_at: row.getResultByName("last_run_at"),
    next_run_at: row.getResultByName("next_run_at"),
    space_id: row.getResultByName("space_id"),
  };
}

function taskRunOf(row) {
  return Object.fromEntries(
    [
      "id",
      "task_id",
      "started_at",
      "finished_at",
      "status",
      "thread_id",
      "artifact_id",
      "input_tokens",
      "output_tokens",
      "error",
    ].map(name => [name, row.getResultByName(name)])
  );
}

function artifactOf(row) {
  return {
    id: row.getResultByName("id"),
    title: row.getResultByName("title"),
    thread_id: row.getResultByName("thread_id"),
    space_id: row.getResultByName("space_id"),
    source_urls: JSON.parse(row.getResultByName("source_urls") || "[]"),
    created_at: row.getResultByName("created_at"),
    updated_at: row.getResultByName("updated_at"),
    current_version: row.getResultByName("current_version"),
    version: row.getResultByName("version"),
    content: row.getResultByName("content"),
  };
}

function memoryOf(row) {
  return {
    id: row.getResultByName("id"),
    text: row.getResultByName("text"),
    source_thread: row.getResultByName("source_thread"),
    source_url: row.getResultByName("source_url"),
    created_at: row.getResultByName("created_at"),
    last_used_at: row.getResultByName("last_used_at"),
    space_id: row.getResultByName("space_id"),
  };
}

// The tables whose rows are kept in a Space, by space_id.
const SPACE_TABLES = ["threads", "memories", "artifacts", "page_visits", "tasks"];

// Whether a record is one a Space sees, as IN_SPACE says (space undefined:
// every one).
function inSpace(record, space) {
  return (
    space === undefined || record.space_id == null || record.space_id == space
  );
}

export class MemoryStore {
  #threads = new Map();
  #messages = new Map();
  // id -> {artifact, versions: Map(version -> {version, content,
  // created_at})}.
  #artifacts = new Map();

  async getThread(id) {
    let thread = this.#threads.get(id);
    return thread ? structuredClone(thread) : null;
  }

  async saveThread(thread) {
    this.#threads.set(thread.id, structuredClone(thread));
  }

  async getMessages(threadId) {
    return [...this.#messages.values()]
      .filter(m => m.thread_id == threadId)
      .sort((a, b) => a.seq - b.seq)
      .map(m => structuredClone(m));
  }

  async saveMessage(message) {
    this.#messages.set(message.id, structuredClone(message));
  }

  /**
   * Like SqliteStore's, without text: private windows never run scheduled
   * tasks, nor show the library.
   */
  async listThreads(text = "", { space } = {}) {
    return [...this.#threads.values()]
      .filter(c => inSpace(c, space))
      .sort((a, b) => b.updated_at - a.updated_at)
      .map(({ id, title, updated_at, space_id }) => {
        let reply = [...this.#messages.values()]
          .filter(m => m.thread_id == id && m.backend)
          .sort((a, b) => b.seq - a.seq)[0];
        return {
          id,
          title,
          updated_at,
          space_id,
          scheduled: false,
          backend: reply?.backend ?? null,
          documents: [...this.#artifacts.values()].filter(
            ({ artifact }) => artifact.thread_id == id
          ).length,
        };
      });
  }

  async saveArtifact(artifact, content) {
    let entry = this.#artifacts.get(artifact.id) || { versions: new Map() };
    entry.artifact = structuredClone(artifact);
    entry.versions.set(artifact.current_version, {
      version: artifact.current_version,
      content,
      created_at: artifact.updated_at,
    });
    this.#artifacts.set(artifact.id, entry);
  }

  async getArtifact(id, version = null) {
    let entry = this.#artifacts.get(id);
    version ??= entry?.artifact.current_version;
    return entry?.versions.has(version)
      ? {
          ...structuredClone(entry.artifact),
          version,
          content: entry.versions.get(version).content,
        }
      : null;
  }

  async artifactVersions(id) {
    return [...(this.#artifacts.get(id)?.versions.values() ?? [])].map(
      ({ version, created_at }) => ({ version, created_at })
    );
  }

  /** Like SqliteStore's, matching words anywhere, newest first. */
  async searchArtifacts(text, limit, { space } = {}) {
    lazy.ftsQuery(text); // Throws without words.
    let words = text.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    let found = [];
    for (let { artifact, versions } of this.#artifacts.values()) {
      if (!inSpace(artifact, space)) {
        continue;
      }
      let content = versions.get(artifact.current_version).content;
      let title = artifact.title.toLocaleLowerCase();
      let lower = content.toLocaleLowerCase();
      if (words.some(word => title.includes(word) || lower.includes(word))) {
        let at = Math.max(0, ...words.map(word => lower.indexOf(word)));
        found.push({
          id: artifact.id,
          title: artifact.title,
          updated_at: artifact.updated_at,
          current_version: artifact.current_version,
          snippet: content.slice(Math.max(0, at - 60), at + 120),
        });
      }
    }
    return found
      .sort((a, b) => b.updated_at - a.updated_at)
      .slice(0, limit);
  }

  /**
   * Like SqliteStore's, without text: a private window's documents are
   * only listed by their Thread.
   */
  async listArtifacts(text = "", { space, threadId } = {}) {
    return [...this.#artifacts.values()]
      .map(({ artifact }) => artifact)
      .filter(
        a =>
          inSpace(a, space) && (threadId == null || a.thread_id == threadId)
      )
      .sort((a, b) => b.updated_at - a.updated_at)
      .map(a => ({
        id: a.id,
        title: a.title,
        updated_at: a.updated_at,
        thread_id: a.thread_id,
        thread_title: this.#threads.get(a.thread_id)?.title ?? null,
        space_id: a.space_id ?? null,
      }));
  }

  /** Like SqliteStore's, for the Threads and documents it keeps. */
  async moveSpace(from, to) {
    for (let record of [
      ...this.#threads.values(),
      ...[...this.#artifacts.values()].map(entry => entry.artifact),
    ]) {
      if (record.space_id == from) {
        record.space_id = to;
      }
    }
  }

  async deleteSpace(space) {
    for (let [id, thread] of this.#threads) {
      if (thread.space_id != space) {
        continue;
      }
      this.#threads.delete(id);
      for (let [messageId, message] of this.#messages) {
        if (message.thread_id == id) {
          this.#messages.delete(messageId);
        }
      }
      for (let { artifact } of this.#artifacts.values()) {
        if (artifact.thread_id == id) {
          artifact.thread_id = null;
        }
      }
    }
    for (let [id, { artifact }] of this.#artifacts) {
      if (artifact.space_id == space) {
        this.#artifacts.delete(id);
      }
    }
  }

  clear() {
    this.#threads.clear();
    this.#messages.clear();
    this.#artifacts.clear();
  }
}
