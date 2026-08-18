// SQLite-backed persistence layer for NetMap.
// Runs ONLY in Electron main process (better-sqlite3 is a native module).
//
// Schema (v1):
//   kv (key TEXT PRIMARY KEY, value TEXT)                 -- misc: filters, "doc" blob, etc.
//   templates (id TEXT PRIMARY KEY, json TEXT)           -- user templates
//   vault_meta (key TEXT PRIMARY KEY, value TEXT)        -- salt, verification tag, kdf params
//   vault_items (id TEXT PRIMARY KEY, iv TEXT, ciphertext TEXT, folder TEXT, name TEXT, url TEXT, updated INTEGER)
//
// The doc (schema JSON) is stored whole in kv['doc'] for now. Later we can normalize.

const path = require('path');
const fs = require('fs');

let db = null;
let dbPath = null;

function openDb(userDataDir) {
  if (db) return db;
  const dir = userDataDir;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  dbPath = path.join(dir, 'netmap.db');

  const Better = require('better-sqlite3');
  db = new Better(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS templates (
      id   TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vault_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vault_items (
      id         TEXT PRIMARY KEY,
      iv         TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      folder     TEXT,
      name       TEXT,
      url        TEXT,
      updated    INTEGER NOT NULL
    );
    /* v0.38: audit log for vault access (unlock/view/edit/delete/copy) */
    CREATE TABLE IF NOT EXISTS vault_audit (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      ts        INTEGER NOT NULL,
      action    TEXT NOT NULL,
      itemId    TEXT,
      itemName  TEXT,
      detail    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_vault_audit_ts ON vault_audit(ts DESC);
    /* v0.38: folder tree — separate from encrypted payload so it can be
       shown in the sidebar even when the vault is locked. Path is a
       forward-slash separated string, e.g. "Отели/Усадьба/MikroTik". */
    CREATE TABLE IF NOT EXISTS vault_folders (
      id      TEXT PRIMARY KEY,
      parent  TEXT,
      name    TEXT NOT NULL,
      color   TEXT,
      updated INTEGER NOT NULL
    );
    /* v0.41.1: rolling backups of the main document. Every successful
       saveDoc() first rotates the previous doc snapshot into here so we
       can roll back if the current save produces a corrupt/lost state. */
    CREATE TABLE IF NOT EXISTS doc_backups (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      ts      INTEGER NOT NULL,
      note    TEXT,
      json    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_doc_backups_ts ON doc_backups(ts DESC);
  `);

  /* v0.38 additive migration — has_totp/tags cache on vault_items so we can
     show TOTP indicator + tag chips without decrypting every row. */
  const cols = db.prepare("PRAGMA table_info(vault_items)").all().map(r => r.name);
  if (!cols.includes('has_totp')) {
    db.exec('ALTER TABLE vault_items ADD COLUMN has_totp INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('tags_cache')) {
    db.exec('ALTER TABLE vault_items ADD COLUMN tags_cache TEXT');
  }
  if (!cols.includes('accessed')) {
    db.exec('ALTER TABLE vault_items ADD COLUMN accessed INTEGER');
  }
  if (!cols.includes('bound_devices')) {
    db.exec('ALTER TABLE vault_items ADD COLUMN bound_devices TEXT');
  }

  return db;
}

// ---------- KV helpers ----------

function kvGet(key) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? row.value : null;
}
function kvSet(key, value) {
  db.prepare(`
    INSERT INTO kv (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

// ---------- Doc ----------

function loadDoc() {
  const raw = kvGet('doc');
  return raw ? JSON.parse(raw) : null;
}
function saveDoc(docObj) {
  // v0.41.1: rotate the previous saved doc into the backup table so we can
  // recover if this save (or a subsequent one) loses/corrupts data.
  try {
    const prev = kvGet('doc');
    if (prev) {
      const prevParsed = JSON.parse(prev);
      const nextJson = JSON.stringify(docObj);
      // Only make a backup if the doc actually changed structurally
      // (avoids spamming 100 backups per minute during ping updates).
      if (prev !== nextJson) {
        // De-dupe: skip if the very last backup is the same content.
        const last = db.prepare('SELECT json FROM doc_backups ORDER BY id DESC LIMIT 1').get();
        if (!last || last.json !== prev) {
          db.prepare('INSERT INTO doc_backups (ts, note, json) VALUES (?, ?, ?)')
            .run(Date.now(),
                 `auto: ${(prevParsed.devices || []).length} devices, ${(prevParsed.links || []).length} links`,
                 prev);
          // Keep last 20 backups.
          db.prepare(`DELETE FROM doc_backups
                      WHERE id IN (SELECT id FROM doc_backups ORDER BY id DESC LIMIT -1 OFFSET 20)`).run();
        }
      }
    }
  } catch (e) { /* backup failure never blocks a save */ }
  kvSet('doc', JSON.stringify(docObj));
}

// v0.41.1: backup listing + restoration helpers.
function listDocBackups() {
  return db.prepare('SELECT id, ts, note, LENGTH(json) as size FROM doc_backups ORDER BY id DESC').all();
}
function loadDocBackup(id) {
  const row = db.prepare('SELECT json FROM doc_backups WHERE id = ?').get(id);
  return row ? JSON.parse(row.json) : null;
}
function deleteDocBackup(id) {
  db.prepare('DELETE FROM doc_backups WHERE id = ?').run(id);
}

// ---------- Filters ----------

function loadFilters() {
  const raw = kvGet('filters');
  return raw ? JSON.parse(raw) : null;
}
function saveFilters(f) {
  kvSet('filters', JSON.stringify(f));
}

// ---------- Templates ----------

function loadTemplates() {
  const rows = db.prepare('SELECT json FROM templates').all();
  return rows.map(r => JSON.parse(r.json));
}
function saveTemplates(list) {
  const del = db.prepare('DELETE FROM templates');
  const ins = db.prepare('INSERT INTO templates (id, json) VALUES (?, ?)');
  const tx = db.transaction((arr) => {
    del.run();
    for (const t of arr) ins.run(t.id, JSON.stringify(t));
  });
  tx(list);
}

// ---------- Vault (see vault.cjs for encryption details) ----------

function vaultMetaGet(key) {
  const row = db.prepare('SELECT value FROM vault_meta WHERE key = ?').get(key);
  return row ? row.value : null;
}
function vaultMetaSet(key, value) {
  db.prepare(`
    INSERT INTO vault_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}
function vaultAllItems() {
  return db.prepare(`SELECT id, iv, ciphertext, folder, name, url, updated,
                            has_totp, tags_cache, accessed, bound_devices
                     FROM vault_items ORDER BY name`).all();
}
function vaultGetItem(id) {
  return db.prepare(`SELECT id, iv, ciphertext, folder, name, url, updated,
                            has_totp, tags_cache, accessed, bound_devices
                     FROM vault_items WHERE id = ?`).get(id);
}
function vaultUpsertItem(row) {
  db.prepare(`
    INSERT INTO vault_items (id, iv, ciphertext, folder, name, url, updated,
                             has_totp, tags_cache, accessed, bound_devices)
    VALUES (@id, @iv, @ciphertext, @folder, @name, @url, @updated,
            @has_totp, @tags_cache, @accessed, @bound_devices)
    ON CONFLICT(id) DO UPDATE SET
      iv=excluded.iv, ciphertext=excluded.ciphertext,
      folder=excluded.folder, name=excluded.name, url=excluded.url,
      updated=excluded.updated,
      has_totp=excluded.has_totp, tags_cache=excluded.tags_cache,
      accessed=excluded.accessed, bound_devices=excluded.bound_devices
  `).run({
    has_totp: 0, tags_cache: null, accessed: null, bound_devices: null,
    ...row,
  });
}
function vaultDeleteItem(id) {
  db.prepare('DELETE FROM vault_items WHERE id = ?').run(id);
}
function vaultTouchAccessed(id) {
  db.prepare('UPDATE vault_items SET accessed = ? WHERE id = ?').run(Date.now(), id);
}

// ---- v0.38: audit log ----
function vaultAuditPush(entry) {
  db.prepare(`INSERT INTO vault_audit (ts, action, itemId, itemName, detail)
              VALUES (?, ?, ?, ?, ?)`).run(
    entry.ts || Date.now(),
    entry.action,
    entry.itemId || null,
    entry.itemName || null,
    entry.detail || null
  );
  db.prepare(`DELETE FROM vault_audit
              WHERE id IN (SELECT id FROM vault_audit ORDER BY ts DESC LIMIT -1 OFFSET 500)`).run();
}
function vaultAuditList(limit = 100) {
  return db.prepare('SELECT * FROM vault_audit ORDER BY ts DESC LIMIT ?').all(limit);
}
function vaultAuditClear() {
  db.prepare('DELETE FROM vault_audit').run();
}

// ---- v0.38: folder tree (unencrypted meta so sidebar works when locked) ----
function vaultFoldersAll() {
  return db.prepare('SELECT * FROM vault_folders ORDER BY name').all();
}
function vaultFolderUpsert(f) {
  db.prepare(`INSERT INTO vault_folders (id, parent, name, color, updated)
              VALUES (@id, @parent, @name, @color, @updated)
              ON CONFLICT(id) DO UPDATE SET
                parent=excluded.parent, name=excluded.name,
                color=excluded.color, updated=excluded.updated`).run({
    parent: null, color: null, updated: Date.now(), ...f,
  });
}
function vaultFolderDelete(id) {
  db.prepare('UPDATE vault_items SET folder = NULL WHERE folder = ?').run(id);
  db.prepare('UPDATE vault_folders SET parent = NULL WHERE parent = ?').run(id);
  db.prepare('DELETE FROM vault_folders WHERE id = ?').run(id);
}

/**
 * v0.39.1 — wipe every vault artifact (meta, items, folders, audit).
 * Used by "Забыли пароль? Сбросить vault" from VaultUnlock. This does NOT
 * touch the main document (devices/groups/links) or filters/templates.
 */
function vaultResetAll() {
  db.exec(`
    DELETE FROM vault_items;
    DELETE FROM vault_folders;
    DELETE FROM vault_meta;
    DELETE FROM vault_audit;
  `);
}

function getDbPath() { return dbPath; }

module.exports = {
  openDb,
  loadDoc, saveDoc,
  listDocBackups, loadDocBackup, deleteDocBackup,
  loadFilters, saveFilters,
  loadTemplates, saveTemplates,
  vaultMetaGet, vaultMetaSet,
  vaultAllItems, vaultGetItem, vaultUpsertItem, vaultDeleteItem, vaultTouchAccessed,
  // v0.38
  vaultAuditPush, vaultAuditList, vaultAuditClear,
  vaultFoldersAll, vaultFolderUpsert, vaultFolderDelete,
  vaultResetAll,
  // v0.40: raw handle for modules that need to define their own tables
  // (e.g. favicon cache). Only main-process modules should call this.
  _raw: () => db,
  getDbPath,
};
