/**
 * Encrypted credentials vault — v0.38 extended.
 *
 * AES-256-GCM (per-item random IV) + PBKDF2-SHA256 (200k) for KDF.
 * All secret material lives inside `ciphertext`; only folder/name/url,
 * has_totp flag, tags cache, and bound device ids are stored as plaintext
 * columns for indexing / sidebar rendering while locked.
 *
 * v0.38 additions on top of the v0.6 baseline:
 *   - Extended item shape: `{ username, password, notes, tags[], fields{},
 *       totpSecret?, boundDeviceIds[], history: [{ ts, password, username }] }`
 *   - Access-time tracking (`accessedAt`), history versioning (last 10),
 *     TOTP HMAC generator (`totpNow`), auto-lock via idle timer, audit log.
 *   - Folder tree lives in a separate table (unencrypted, meta-only) so the
 *     sidebar renders while the vault is locked.
 */

const crypto = require('crypto');

const KDF_ITER = 200_000;
const VERIFIER_PLAIN = 'netmap-vault-v1';
const HISTORY_LIMIT = 10;

let currentKey = null;
let lastActivity = Date.now();
let idleTimeoutMs = 0;           // 0 = disabled
let idleTimer = null;
let onAutoLock = null;           // callback set by main.cjs to notify renderer

function toHex(b) { return b.toString('hex'); }
function fromHex(s) { return Buffer.from(s, 'hex'); }

function deriveKey(pw, saltHex, iters) {
  return crypto.pbkdf2Sync(pw, fromHex(saltHex), iters, 32, 'sha256');
}

function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: toHex(iv), ciphertext: toHex(Buffer.concat([enc, tag])) };
}
function decrypt(key, ivHex, ctHex) {
  const iv = fromHex(ivHex);
  const ctFull = fromHex(ctHex);
  const tag = ctFull.slice(ctFull.length - 16);
  const enc = ctFull.slice(0, ctFull.length - 16);
  const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(enc), dec.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Auto-lock (idle timer)

function touch() { lastActivity = Date.now(); }
function scheduleIdleCheck() {
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
  if (!idleTimeoutMs || !currentKey) return;
  idleTimer = setInterval(() => {
    if (!currentKey) return;
    if (Date.now() - lastActivity >= idleTimeoutMs) {
      _autoLock();
    }
  }, Math.min(30_000, Math.max(2_000, Math.floor(idleTimeoutMs / 4))));
}
function _autoLock() {
  if (currentKey) currentKey.fill(0);
  currentKey = null;
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
  if (typeof onAutoLock === 'function') try { onAutoLock(); } catch (e) { /* ignore */ }
}
function setAutoLockCallback(fn) { onAutoLock = typeof fn === 'function' ? fn : null; }
function setIdleTimeout(ms) {
  idleTimeoutMs = Math.max(0, Math.floor(ms) || 0);
  touch();
  scheduleIdleCheck();
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238 — SHA-1, 30s step, 6 digits)

function base32Decode(input) {
  if (!input) return Buffer.alloc(0);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input).toUpperCase().replace(/\s+/g, '').replace(/=+$/, '');
  const out = [];
  let buf = 0, bits = 0;
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error('TOTP secret: invalid base32 character');
    buf = (buf << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

function totpAt(secret, unixSec, digits = 6, stepSec = 30) {
  const key = base32Decode(secret);
  const counter = Math.floor(unixSec / stepSec);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset]     & 0x7f) << 24) |
              ((hmac[offset + 1] & 0xff) << 16) |
              ((hmac[offset + 2] & 0xff) <<  8) |
              ( hmac[offset + 3] & 0xff);
  const code = (bin % (10 ** digits)).toString().padStart(digits, '0');
  return code;
}
function totpNow(secret) {
  const now = Math.floor(Date.now() / 1000);
  return {
    code: totpAt(secret, now),
    period: 30,
    remaining: 30 - (now % 30),
  };
}

// ---------------------------------------------------------------------------
// Password generator (server-side so callers can request strong entropy)

const CHARSET = {
  lower:  'abcdefghijklmnopqrstuvwxyz',
  upper:  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbol: '!@#$%^&*()-_=+[]{};:,.<>?/',
};
const AMBIGUOUS = /[il1Lo0O]/g;

function generatePassword(opts = {}) {
  const {
    length = 20, lower = true, upper = true, digits = true, symbol = true,
    excludeAmbiguous = false,
  } = opts;
  let pool = '';
  if (lower)  pool += CHARSET.lower;
  if (upper)  pool += CHARSET.upper;
  if (digits) pool += CHARSET.digits;
  if (symbol) pool += CHARSET.symbol;
  if (excludeAmbiguous) pool = pool.replace(AMBIGUOUS, '');
  if (!pool) throw new Error('generatePassword: pool is empty');
  const buf = crypto.randomBytes(length * 2);
  let out = '';
  // Rejection-sample to keep uniform distribution.
  const cap = Math.floor(256 / pool.length) * pool.length;
  for (let i = 0; out.length < length && i < buf.length; i++) {
    if (buf[i] < cap) out += pool[buf[i] % pool.length];
  }
  if (out.length < length) return out + generatePassword({ ...opts, length: length - out.length });
  return out;
}

// ---------------------------------------------------------------------------
// Public API

function status(db) {
  const saltHex = db.vaultMetaGet('salt');
  const itemCount = db.vaultAllItems().length;
  return {
    initialized: !!saltHex,
    unlocked: !!currentKey,
    itemCount,
    idleTimeoutMs,
    lastActivity,
  };
}

function init(db, masterPassword) {
  if (db.vaultMetaGet('salt')) return { ok: false, error: 'already-initialized' };
  const salt = crypto.randomBytes(16);
  const saltHex = toHex(salt);
  db.vaultMetaSet('salt', saltHex);
  db.vaultMetaSet('iterations', String(KDF_ITER));
  const key = deriveKey(masterPassword, saltHex, KDF_ITER);
  const v = encrypt(key, VERIFIER_PLAIN);
  db.vaultMetaSet('verifier_iv', v.iv);
  db.vaultMetaSet('verifier_ct', v.ciphertext);
  currentKey = key;
  touch(); scheduleIdleCheck();
  db.vaultAuditPush({ action: 'init' });
  return { ok: true };
}

function unlock(db, masterPassword) {
  const saltHex = db.vaultMetaGet('salt');
  if (!saltHex) return { ok: false, error: 'not-initialized' };
  const iters = parseInt(db.vaultMetaGet('iterations') || String(KDF_ITER), 10);
  const key = deriveKey(masterPassword, saltHex, iters);
  const iv = db.vaultMetaGet('verifier_iv');
  const ct = db.vaultMetaGet('verifier_ct');
  try {
    const p = decrypt(key, iv, ct);
    if (p !== VERIFIER_PLAIN) {
      db.vaultAuditPush({ action: 'unlock-fail' });
      return { ok: false, error: 'wrong-password' };
    }
  } catch {
    db.vaultAuditPush({ action: 'unlock-fail' });
    return { ok: false, error: 'wrong-password' };
  }
  currentKey = key;
  touch(); scheduleIdleCheck();
  db.vaultAuditPush({ action: 'unlock' });
  return { ok: true };
}

function lock(db) {
  const wasUnlocked = !!currentKey;
  if (currentKey) currentKey.fill(0);
  currentKey = null;
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
  if (db && wasUnlocked) db.vaultAuditPush({ action: 'lock' });
  return { ok: true };
}

/** v0.38: return meta rows (never decrypt secrets). Sidebar/list uses this. */
function listItems(db) {
  const rows = db.vaultAllItems();
  return rows.map(r => ({
    id: r.id, folder: r.folder, name: r.name, url: r.url, updated: r.updated,
    hasTotp: !!r.has_totp,
    tags: r.tags_cache ? JSON.parse(r.tags_cache) : [],
    accessed: r.accessed || null,
    boundDeviceIds: r.bound_devices ? JSON.parse(r.bound_devices) : [],
  }));
}

function getItem(db, id) {
  if (!currentKey) return { locked: true };
  touch();
  const row = db.vaultGetItem(id);
  if (!row) return { ok: false, error: 'not-found' };
  try {
    const plain = decrypt(currentKey, row.iv, row.ciphertext);
    const data = JSON.parse(plain);
    db.vaultTouchAccessed(id);
    db.vaultAuditPush({ action: 'view', itemId: id, itemName: row.name });
    return { ok: true, item: {
      id: row.id, folder: row.folder, name: row.name, url: row.url,
      updated: row.updated, accessed: Date.now(),
      hasTotp: !!row.has_totp,
      boundDeviceIds: row.bound_devices ? JSON.parse(row.bound_devices) : [],
      ...data,
    }};
  } catch (e) {
    return { ok: false, error: 'decrypt-failed' };
  }
}

function upsertItem(db, item) {
  if (!currentKey) return { locked: true };
  touch();
  const id = item.id || crypto.randomBytes(8).toString('hex');
  const isUpdate = !!item.id && !!db.vaultGetItem(item.id);

  // Load history from existing item and push previous snapshot.
  let history = Array.isArray(item.history) ? [...item.history] : [];
  if (isUpdate && item.password !== undefined) {
    try {
      const existingRow = db.vaultGetItem(item.id);
      if (existingRow) {
        const prev = JSON.parse(decrypt(currentKey, existingRow.iv, existingRow.ciphertext));
        if (prev.password && prev.password !== item.password) {
          history = [
            { ts: Date.now(), password: prev.password, username: prev.username || '' },
            ...history,
          ].slice(0, HISTORY_LIMIT);
        }
      }
    } catch { /* ignore */ }
  }

  const secretPart = {
    username:  item.username || '',
    password:  item.password || '',
    notes:     item.notes || '',
    tags:      Array.isArray(item.tags) ? item.tags : [],
    fields:    (item.fields && typeof item.fields === 'object') ? item.fields : {},
    totpSecret: item.totpSecret || '',
    history,
  };
  const { iv, ciphertext } = encrypt(currentKey, JSON.stringify(secretPart));
  db.vaultUpsertItem({
    id, iv, ciphertext,
    folder: item.folder || null,
    name:   item.name   || '(без имени)',
    url:    item.url    || null,
    updated: Date.now(),
    has_totp: item.totpSecret ? 1 : 0,
    tags_cache: JSON.stringify(secretPart.tags),
    accessed: Date.now(),
    bound_devices: JSON.stringify(item.boundDeviceIds || []),
  });
  db.vaultAuditPush({
    action: isUpdate ? 'edit' : 'create',
    itemId: id, itemName: item.name,
  });
  return { ok: true, id };
}

function deleteItem(db, id) {
  const row = db.vaultGetItem(id);
  db.vaultDeleteItem(id);
  db.vaultAuditPush({ action: 'delete', itemId: id, itemName: row ? row.name : null });
  return { ok: true };
}

function importPayload(db, payload) {
  if (!currentKey) return { locked: true };
  const items = Array.isArray(payload) ? payload : (payload?.items || []);
  const folders = (payload && Array.isArray(payload.folders)) ? payload.folders : [];

  // v0.39: pre-create folders so item.folder ids resolve. Silently skip
  // folders that already exist (id collision).
  for (const f of folders) {
    if (!f || !f.id) continue;
    const existing = db.vaultFoldersAll().find(x => x.id === f.id);
    if (existing) continue;
    db.vaultFolderUpsert({
      id: f.id, parent: f.parent || null,
      name: f.name || '(без имени)',
      color: f.color || null,
      updated: Date.now(),
    });
  }

  let added = 0;
  for (const it of items) {
    const login = it.login || {};
    const uris = (login.uris || []).map(u => u.uri).filter(Boolean);
    upsertItem(db, {
      name:     it.name || login.username || 'imported',
      folder:   it.folderId || it.folder || null,
      url:      uris[0] || it.url || null,
      username: login.username || it.username || '',
      password: login.password || it.password || '',
      notes:    it.notes || '',
      fields:   it.fields || {},
      tags:     it.tags || [],
      totpSecret: login.totp || it.totp || it.totpSecret || '',
    });
    added++;
  }
  db.vaultAuditPush({ action: 'import', detail: `${added} items, ${folders.length} folders` });
  return { ok: true, added, foldersAdded: folders.length };
}

// v0.39: bulk-decrypt for export flows — returns full items (with secrets)
// so the renderer can hand them to buildKdbx / Bitwarden exporter. Never
// leaves the main process boundary except when explicitly requested by
// user action (SettingsDialog → Экспорт).
function exportAll(db, opts) {
  if (!currentKey) return { locked: true };
  const rows = db.vaultAllItems();
  const items = [];
  for (const row of rows) {
    try {
      const plain = decrypt(currentKey, row.iv, row.ciphertext);
      const data = JSON.parse(plain);
      items.push({
        id: row.id,
        name: row.name, folder: row.folder, url: row.url,
        username: data.username || '',
        password: data.password || '',
        notes:    data.notes || '',
        tags:     data.tags || [],
        fields:   data.fields || {},
        totpSecret: data.totpSecret || '',
      });
    } catch (e) {
      // Skip un-decryptable entries but continue with the rest.
      items.push({
        id: row.id, name: row.name, folder: row.folder, url: row.url,
        _error: 'decrypt-failed',
      });
    }
  }
  const folders = db.vaultFoldersAll();
  db.vaultAuditPush({
    action: 'export', detail: `${items.length} items → ${opts && opts.format ? opts.format : 'raw'}`,
  });
  return { ok: true, items, folders };
}

// ---------------------------------------------------------------------------
// v0.38: TOTP live code, audit list, folders, generator

function totp(db, id) {
  if (!currentKey) return { locked: true };
  const row = db.vaultGetItem(id);
  if (!row || !row.has_totp) return { ok: false, error: 'no-totp' };
  try {
    const plain = decrypt(currentKey, row.iv, row.ciphertext);
    const data = JSON.parse(plain);
    if (!data.totpSecret) return { ok: false, error: 'no-totp' };
    return { ok: true, ...totpNow(data.totpSecret) };
  } catch (e) {
    return { ok: false, error: 'decrypt-failed' };
  }
}

function auditList(db, limit) {
  return db.vaultAuditList(limit || 100);
}
function auditClear(db) {
  db.vaultAuditClear();
  return { ok: true };
}

function foldersAll(db) { return db.vaultFoldersAll(); }
function folderUpsert(db, f) {
  if (!currentKey) return { locked: true };
  const id = f.id || crypto.randomBytes(6).toString('hex');
  db.vaultFolderUpsert({ ...f, id });
  db.vaultAuditPush({ action: 'folder-upsert', itemId: id, detail: f.name });
  return { ok: true, id };
}
function folderDelete(db, id) {
  if (!currentKey) return { locked: true };
  db.vaultFolderDelete(id);
  db.vaultAuditPush({ action: 'folder-delete', itemId: id });
  return { ok: true };
}

/**
 * v0.39.1 — "Forgot password" hard reset. Wipes salt/verifier/items/audit
 * so the next call to status() reports `initialized:false` and the UI
 * shows the setup screen again. Does NOT touch the main document.
 */
function reset(db) {
  const wasUnlocked = !!currentKey;
  if (currentKey) currentKey.fill(0);
  currentKey = null;
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
  db.vaultResetAll();
  // Push an audit BEFORE the wipe? Table was just cleared, so log now for the
  // future — first audit entry of the new vault will be "reset".
  try { db.vaultAuditPush({ action: 'reset', detail: wasUnlocked ? 'from unlocked' : 'from locked' }); } catch {}
  return { ok: true };
}

module.exports = {
  status, init, unlock, lock,
  listItems, getItem, upsertItem, deleteItem, importPayload,
  // v0.38
  totp, generatePassword: (opts) => generatePassword(opts),
  auditList, auditClear,
  foldersAll, folderUpsert, folderDelete,
  setIdleTimeout, setAutoLockCallback, touch,
  // v0.39
  exportAll,
  // v0.39.1
  reset,
};
