/**
 * v0.39 — KeePass (.kdbx) import/export bridge.
 *
 * We use `kdbxweb` for the file format and Node's built-in webcrypto for
 * primitives. Argon2 is required by KDBX4 — kdbxweb detects it via an
 * optional callback (`Argon2Impl`); if we don't register one, files that
 * use AES-KDF (KDBX3.x default) still work, and KDBX4 files that use
 * Argon2 fail with a clear error. We register a callback that shells
 * out to Node's built-in `crypto.createHash('sha256')` fallback via
 * argon2-browser — but only if the loader can find it.
 *
 * Public surface:
 *   parseKdbx(bufferOrBase64, masterPassword) → { ok, items[], folders[], stats }
 *   buildKdbx({ items, folders }, masterPassword) → { ok, base64 }
 *
 * item shape (matches vault-item as passed to upsertItem):
 *   { name, folder, url, username, password, notes, tags, fields, totpSecret }
 *
 * folder shape:
 *   { id, parent, name }
 *
 * NB: kdbxweb wants a WHATWG ArrayBuffer (not Node Buffer) for parseCredentials
 * password. We convert on the boundary.
 */

const path = require('path');

let kdbxweb = null;
let cryptoEngineReady = false;

function ensureLoaded() {
  if (kdbxweb) return kdbxweb;
  // Lazy require so the module isn't loaded (adds ~250KB) unless the user
  // actually opens the .kdbx import/export dialog.
  kdbxweb = require('kdbxweb');

  if (!cryptoEngineReady) {
    // Wire Node's built-in webcrypto into kdbxweb.
    // kdbxweb.CryptoEngine.setSubtle(subtleImpl) — modern API.
    const { webcrypto } = require('crypto');
    if (webcrypto && webcrypto.subtle && kdbxweb.CryptoEngine.setSubtle) {
      try {
        kdbxweb.CryptoEngine.setSubtle(webcrypto.subtle);
      } catch (e) {
        console.warn('[kdbx] setSubtle failed:', e && e.message);
      }
    }

    // Argon2 — required by KDBX4 files. We wire a callback that uses
    // argon2-browser if available; otherwise falls back to a soft-error
    // returned to the renderer ("Файл использует Argon2, зашифруйте KDBX
    // как AES-KDF"). We prefer NOT to spawn native compilers.
    try {
      const argon2 = require('argon2-browser');
      kdbxweb.CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type, version) => {
        // argon2-browser expects Uint8Array for password/salt.
        const pw = password instanceof Uint8Array ? password : new Uint8Array(password);
        const sl = salt instanceof Uint8Array ? salt : new Uint8Array(salt);
        const res = await argon2.hash({
          pass: pw, salt: sl,
          time: iterations, mem: memory / 1024, parallelism,
          hashLen: length,
          type: type === 0 ? argon2.ArgonType.Argon2d :
                type === 1 ? argon2.ArgonType.Argon2i :
                             argon2.ArgonType.Argon2id,
        });
        return res.hash;
      });
    } catch (e) {
      // argon2-browser missing / not usable in Electron main. KDBX3.x
      // AES-KDF files still work; KDBX4 Argon2 files will surface a
      // "no argon2 impl" error to the user with an actionable hint.
      console.warn('[kdbx] argon2 not available:', e && e.message);
    }

    cryptoEngineReady = true;
  }
  return kdbxweb;
}

// ---------------------------------------------------------------------------
// Import

function toArrayBuffer(input) {
  if (input instanceof ArrayBuffer) return input;
  if (Buffer.isBuffer(input)) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }
  if (typeof input === 'string') {
    // Assume base64
    const buf = Buffer.from(input, 'base64');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  if (input && typeof input === 'object' && input.buffer instanceof ArrayBuffer) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }
  throw new Error('parseKdbx: unsupported input type');
}

function extractItems(group, parentId, folders, items, path) {
  const kw = kdbxweb;
  const folderId = 'f-' + group.uuid.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  // Skip synthetic root group — its name is often 'Root' and we just want
  // its children as top-level folders.
  const isRoot = parentId === null && (group.parentGroup === undefined || group.parentGroup === null);
  const currentFolderId = isRoot ? null : folderId;
  if (!isRoot) {
    folders.push({
      id: folderId,
      parent: parentId,
      name: group.name || '(без имени)',
    });
  }
  // Path label for items (fallback if folder tree is not preserved by caller).
  const nextPath = isRoot ? (path || '') : (path ? path + '/' + group.name : group.name || '');

  for (const entry of group.entries) {
    const fields = entry.fields;
    const get = (k) => {
      const v = fields.get(k);
      if (!v) return '';
      // kdbxweb returns ProtectedValue for protected fields
      return typeof v === 'string' ? v : (v.getText ? v.getText() : String(v));
    };
    // Standard KeePass fields:
    const title    = get('Title') || get('title') || '';
    const username = get('UserName') || '';
    const password = get('Password') || '';
    const url      = get('URL') || '';
    const notes    = get('Notes') || '';
    // Custom fields = everything else
    const custom = {};
    for (const [k, v] of fields) {
      if (['Title', 'UserName', 'Password', 'URL', 'Notes'].includes(k)) continue;
      const s = typeof v === 'string' ? v : (v && v.getText ? v.getText() : '');
      if (s) custom[k] = s;
    }
    // TOTP — KeePass2 stores it either as "otp" (KeeOTP) or as fields
    // "TOTP Seed" + "TOTP Settings" or as "otpauth://" URL inside a field.
    let totpSecret = '';
    for (const key of ['otp', 'TOTP', 'TOTP Seed', 'HmacOtp-Secret-Base32']) {
      const v = get(key);
      if (v) {
        // If it's an otpauth:// URI extract the secret query param.
        const m = /secret=([A-Z2-7=]+)/i.exec(v);
        totpSecret = m ? m[1] : v.replace(/\s+/g, '');
        break;
      }
    }
    // Tags — KeePass entries have a tags array separated by ;
    const tags = Array.isArray(entry.tags) ? entry.tags
               : (entry.tags ? String(entry.tags).split(/[;,]\s*/).filter(Boolean) : []);

    items.push({
      name: title || username || 'imported',
      folder: currentFolderId,
      folderPath: nextPath,   // fallback for callers that don't want the tree
      url, username, password, notes,
      fields: custom,
      totpSecret,
      tags,
    });
  }

  for (const child of group.groups) {
    extractItems(child, currentFolderId, folders, items, nextPath);
  }
}

async function parseKdbx(input, masterPassword) {
  const kw = ensureLoaded();
  const ab = toArrayBuffer(input);
  const pwProtected = kw.ProtectedValue.fromString(String(masterPassword || ''));
  const creds = new kw.Credentials(pwProtected, null);
  let db;
  try {
    db = await kw.Kdbx.load(ab, creds);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (/argon/i.test(msg)) {
      return { ok: false, error: 'Файл KDBX4 использует Argon2 — Argon2 не смог инициализироваться. Пересохраните файл в KeePass как KDBX 3.1 (AES-KDF) или откройте issue на GitHub.' };
    }
    if (/invalid.*key|BadSignature|InvalidKey/i.test(msg)) {
      return { ok: false, error: 'Неверный мастер-пароль либо повреждённый файл.' };
    }
    return { ok: false, error: msg };
  }

  const folders = [];
  const items = [];
  extractItems(db.getDefaultGroup(), null, folders, items, '');

  return {
    ok: true,
    items, folders,
    stats: {
      itemCount: items.length,
      folderCount: folders.length,
      dbName: db.meta && db.meta.name ? db.meta.name : 'KeePass DB',
    },
  };
}

// ---------------------------------------------------------------------------
// Export

async function buildKdbx({ items, folders, dbName }, masterPassword) {
  const kw = ensureLoaded();
  const creds = new kw.Credentials(
    kw.ProtectedValue.fromString(String(masterPassword || '')),
    null
  );
  const db = kw.Kdbx.create(creds, dbName || 'NetMap Vault');

  // Build folder tree: map from our folder.id → KdbxGroup
  const rootGroup = db.getDefaultGroup();
  const folderGroups = new Map();
  folderGroups.set(null, rootGroup);
  // Two-pass so parent groups always exist before children.
  const remaining = [...(folders || [])];
  let guard = 100;
  while (remaining.length && guard-- > 0) {
    for (let i = remaining.length - 1; i >= 0; i--) {
      const f = remaining[i];
      const parentGroup = folderGroups.get(f.parent || null);
      if (!parentGroup) continue;
      const g = db.createGroup(parentGroup, f.name || '(без имени)');
      folderGroups.set(f.id, g);
      remaining.splice(i, 1);
    }
  }
  // Any orphans (broken parent refs) go under root.
  for (const f of remaining) {
    const g = db.createGroup(rootGroup, f.name || '(без имени)');
    folderGroups.set(f.id, g);
  }

  for (const item of items || []) {
    const parent = folderGroups.get(item.folder || null) || rootGroup;
    const entry = db.createEntry(parent);
    entry.fields.set('Title',    item.name || 'entry');
    entry.fields.set('UserName', item.username || '');
    entry.fields.set('Password', kw.ProtectedValue.fromString(String(item.password || '')));
    entry.fields.set('URL',      item.url || '');
    entry.fields.set('Notes',    item.notes || '');
    for (const [k, v] of Object.entries(item.fields || {})) {
      entry.fields.set(k, String(v));
    }
    if (item.totpSecret) {
      // Store as KeePass "otp" field in otpauth:// URI form (compatible with
      // KeeWeb / KeePassXC).
      const label = encodeURIComponent(item.name || 'NetMap');
      entry.fields.set('otp',
        `otpauth://totp/${label}?secret=${item.totpSecret}&period=30&digits=6`);
    }
    if (Array.isArray(item.tags) && item.tags.length) entry.tags = item.tags;
  }

  const ab = await db.save();
  const buf = Buffer.from(ab);
  return { ok: true, base64: buf.toString('base64'), size: buf.length };
}

module.exports = { parseKdbx, buildKdbx };
