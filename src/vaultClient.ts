/**
 * Vault client.
 * Prefers the Electron IPC bridge (SQLite + AES-GCM in main process).
 * Fallback: encrypted localStorage using WebCrypto (AES-GCM + PBKDF2).
 */

const w = typeof window !== 'undefined' ? (window as any) : {};
export const hasNativeVault = !!(w.netmap && w.netmap.vaultStatus);

export interface VaultItemMeta {
  id: string;
  name: string;
  folder?: string | null;
  url?: string | null;
  updated: number;
  /** v0.38: shown as a chip in the list even while item is not decrypted. */
  hasTotp?: boolean;
  tags?: string[];
  accessed?: number | null;
  boundDeviceIds?: string[];
}

export interface VaultHistoryEntry {
  ts: number;
  password: string;
  username: string;
}

export interface VaultItemFull extends VaultItemMeta {
  username?: string;
  password?: string;
  notes?: string;
  tags?: string[];
  fields?: Record<string, string>;
  /** v0.38 — RFC 4648 base32 secret (as printed on 2FA setup screens). */
  totpSecret?: string;
  /** v0.38 — history[0] is the most recent previous password. */
  history?: VaultHistoryEntry[];
}

export interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
  itemCount: number;
  idleTimeoutMs?: number;
  lastActivity?: number;
}

/** v0.38 — folder tree (stored plaintext so sidebar renders while locked). */
export interface VaultFolder {
  id: string;
  parent: string | null;
  name: string;
  color?: string | null;
  updated: number;
}

/** v0.38 — audit log entry. */
export interface VaultAuditEntry {
  id: number;
  ts: number;
  action: string;
  itemId?: string | null;
  itemName?: string | null;
  detail?: string | null;
}

export interface PwGenOpts {
  length?: number;
  lower?: boolean;
  upper?: boolean;
  digits?: boolean;
  symbol?: boolean;
  excludeAmbiguous?: boolean;
}

export interface TotpNow {
  ok: boolean;
  code?: string;
  period?: number;
  remaining?: number;
  error?: string;
  locked?: boolean;
}

// --------- Native path ---------

async function nativeStatus(): Promise<VaultStatus> { return w.netmap.vaultStatus(); }
async function nativeInit(pw: string) { return w.netmap.vaultInit(pw); }
async function nativeUnlock(pw: string) { return w.netmap.vaultUnlock(pw); }
async function nativeLock() { return w.netmap.vaultLock(); }
async function nativeList(): Promise<VaultItemMeta[]> { return (await w.netmap.vaultList()) || []; }
async function nativeGet(id: string) { return w.netmap.vaultGet(id); }
async function nativeUpsert(item: any) { return w.netmap.vaultUpsert(item); }
async function nativeDelete(id: string) { return w.netmap.vaultDelete(id); }
async function nativeImport(payload: any) { return w.netmap.vaultImport(payload); }

// --------- Fallback path: WebCrypto + localStorage ---------

const LS_META  = 'netmap:vault:meta';
const LS_ITEMS = 'netmap:vault:items';
const VERIFIER_PLAIN = 'netmap-vault-v1';
const KDF_ITER = 200_000;

interface FbMeta {
  saltB64: string;
  verifierIvB64: string;
  verifierCtB64: string;
  iterations: number;
}

interface FbItemRow {
  id: string;
  name: string;
  folder: string | null;
  url: string | null;
  ivB64: string;
  ctB64: string;
  updated: number;
}

let currentKey: CryptoKey | null = null;

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(pw: string, salt: Uint8Array, iters: number): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(pw) as BufferSource, 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: iters, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
async function aesEncrypt(key: CryptoKey, plaintext: string): Promise<{ ivB64: string; ctB64: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as BufferSource
  );
  return { ivB64: b64(iv), ctB64: b64(ct) };
}
async function aesDecrypt(key: CryptoKey, ivB64: string, ctB64: string): Promise<string> {
  const iv = fromB64(ivB64);
  const ct = fromB64(ctB64);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ct as BufferSource
  );
  return new TextDecoder().decode(pt);
}

function readMeta(): FbMeta | null {
  try { const raw = localStorage.getItem(LS_META); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeMeta(m: FbMeta) { localStorage.setItem(LS_META, JSON.stringify(m)); }
function readItems(): FbItemRow[] {
  try { const raw = localStorage.getItem(LS_ITEMS); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function writeItems(items: FbItemRow[]) { localStorage.setItem(LS_ITEMS, JSON.stringify(items)); }

async function fbStatus(): Promise<VaultStatus> {
  const m = readMeta();
  return { initialized: !!m, unlocked: !!currentKey, itemCount: readItems().length };
}
async function fbInit(pw: string) {
  if (readMeta()) return { ok: false, error: 'already-initialized' };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pw, salt, KDF_ITER);
  const v = await aesEncrypt(key, VERIFIER_PLAIN);
  writeMeta({ saltB64: b64(salt), verifierIvB64: v.ivB64, verifierCtB64: v.ctB64, iterations: KDF_ITER });
  currentKey = key;
  return { ok: true };
}
async function fbUnlock(pw: string) {
  const m = readMeta();
  if (!m) return { ok: false, error: 'not-initialized' };
  const key = await deriveKey(pw, fromB64(m.saltB64), m.iterations);
  try {
    const p = await aesDecrypt(key, m.verifierIvB64, m.verifierCtB64);
    if (p !== VERIFIER_PLAIN) return { ok: false, error: 'wrong-password' };
  } catch {
    return { ok: false, error: 'wrong-password' };
  }
  currentKey = key;
  return { ok: true };
}
async function fbLock() { currentKey = null; return { ok: true }; }
async function fbList(): Promise<VaultItemMeta[]> {
  return readItems().map(r => ({
    id: r.id, name: r.name, folder: r.folder, url: r.url, updated: r.updated
  }));
}
async function fbGet(id: string) {
  if (!currentKey) return { locked: true } as any;
  const row = readItems().find(r => r.id === id);
  if (!row) return { ok: false, error: 'not-found' };
  try {
    const plain = await aesDecrypt(currentKey, row.ivB64, row.ctB64);
    const data = JSON.parse(plain);
    return { ok: true, item: {
      id: row.id, name: row.name, folder: row.folder, url: row.url,
      updated: row.updated, ...data,
    }};
  } catch { return { ok: false, error: 'decrypt-failed' }; }
}
async function fbUpsert(item: any) {
  if (!currentKey) return { locked: true } as any;
  const id = item.id || crypto.getRandomValues(new Uint8Array(8)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
  const secret = {
    username: item.username || '', password: item.password || '',
    notes: item.notes || '', tags: item.tags || [], fields: item.fields || {},
  };
  const { ivB64, ctB64 } = await aesEncrypt(currentKey, JSON.stringify(secret));
  const items = readItems();
  const row: FbItemRow = {
    id, ivB64, ctB64,
    folder: item.folder || null,
    name:   item.name   || '(без имени)',
    url:    item.url    || null,
    updated: Date.now(),
  };
  const idx = items.findIndex(r => r.id === id);
  if (idx >= 0) items[idx] = row; else items.push(row);
  writeItems(items);
  return { ok: true, id };
}
async function fbDelete(id: string) {
  writeItems(readItems().filter(r => r.id !== id));
  return { ok: true };
}
async function fbImport(payload: any) {
  if (!currentKey) return { locked: true } as any;
  const items = Array.isArray(payload) ? payload : (payload?.items || []);
  let added = 0;
  for (const it of items) {
    const login = it.login || {};
    const uris = (login.uris || []).map((u: any) => u.uri).filter(Boolean);
    await fbUpsert({
      name: it.name || login.username || 'imported',
      folder: it.folderId || it.folder || null,
      url: uris[0] || it.url || null,
      username: login.username || it.username || '',
      password: login.password || it.password || '',
      notes: it.notes || '',
    });
    added++;
  }
  return { ok: true, added };
}

// --------- Public API ---------

export async function vaultStatus(): Promise<VaultStatus> {
  return hasNativeVault ? nativeStatus() : fbStatus();
}
export async function vaultInit(pw: string) {
  return hasNativeVault ? nativeInit(pw) : fbInit(pw);
}
export async function vaultUnlock(pw: string) {
  return hasNativeVault ? nativeUnlock(pw) : fbUnlock(pw);
}
export async function vaultLock() {
  return hasNativeVault ? nativeLock() : fbLock();
}
export async function vaultList(): Promise<VaultItemMeta[]> {
  return hasNativeVault ? nativeList() : fbList();
}
export async function vaultGet(id: string): Promise<{ ok?: boolean; locked?: boolean; item?: VaultItemFull; error?: string }> {
  return hasNativeVault ? nativeGet(id) : fbGet(id);
}
export async function vaultUpsert(item: Partial<VaultItemFull>): Promise<{ ok?: boolean; locked?: boolean; id?: string }> {
  return hasNativeVault ? nativeUpsert(item) : fbUpsert(item);
}
export async function vaultDelete(id: string): Promise<{ ok: boolean }> {
  return hasNativeVault ? nativeDelete(id) : fbDelete(id);
}
export async function vaultImport(payload: any) {
  return hasNativeVault ? nativeImport(payload) : fbImport(payload);
}

// ---------- v0.38: extended API (native-only, fallback returns not-supported) ----

function nativeOnly<T>(fn: () => Promise<T>, msg = 'Функция доступна только в Electron .exe'): Promise<T> {
  if (!hasNativeVault) return Promise.reject(new Error(msg));
  return fn();
}

export async function vaultTotp(id: string): Promise<TotpNow> {
  return nativeOnly(() => w.netmap.vaultTotp(id));
}
export async function vaultGeneratePassword(opts: PwGenOpts): Promise<string> {
  if (!hasNativeVault) {
    // Fallback: WebCrypto random.
    const {
      length = 20, lower = true, upper = true, digits = true, symbol = true,
      excludeAmbiguous = false,
    } = opts;
    let pool = '';
    if (lower)  pool += 'abcdefghijklmnopqrstuvwxyz';
    if (upper)  pool += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (digits) pool += '0123456789';
    if (symbol) pool += '!@#$%^&*()-_=+[]{};:,.<>?/';
    if (excludeAmbiguous) pool = pool.replace(/[il1Lo0O]/g, '');
    if (!pool) return '';
    const buf = crypto.getRandomValues(new Uint8Array(length * 2));
    const cap = Math.floor(256 / pool.length) * pool.length;
    let out = '';
    for (let i = 0; out.length < length && i < buf.length; i++) {
      if (buf[i] < cap) out += pool[buf[i] % pool.length];
    }
    return out;
  }
  const res = await w.netmap.vaultGenPw(opts);
  return res && res.password ? res.password : '';
}
export async function vaultAuditList(limit = 100): Promise<VaultAuditEntry[]> {
  if (!hasNativeVault) return [];
  return (await w.netmap.vaultAuditList(limit)) || [];
}
export async function vaultAuditClear(): Promise<void> {
  if (hasNativeVault) await w.netmap.vaultAuditClear();
}
export async function vaultFoldersAll(): Promise<VaultFolder[]> {
  if (!hasNativeVault) return [];
  return (await w.netmap.vaultFoldersAll()) || [];
}
export async function vaultFolderUpsert(f: Partial<VaultFolder>): Promise<{ ok: boolean; id?: string }> {
  return nativeOnly(() => w.netmap.vaultFolderUpsert(f));
}
export async function vaultFolderDelete(id: string) {
  return nativeOnly(() => w.netmap.vaultFolderDelete(id));
}
export async function vaultSetIdleTimeout(ms: number) {
  if (hasNativeVault) await w.netmap.vaultSetIdle(ms);
}
export async function vaultTouch() {
  if (hasNativeVault) await w.netmap.vaultTouch();
}
export function onVaultAutoLocked(cb: () => void): () => void {
  if (!hasNativeVault) return () => {};
  return w.netmap.onVaultAutoLocked(cb);
}

// ---------- v0.39: KeePass .kdbx + bulk export ----------

export interface KdbxParseResult {
  ok: boolean;
  error?: string;
  items?: Array<{
    name: string; folder: string | null; folderPath?: string;
    url?: string; username?: string; password?: string; notes?: string;
    fields?: Record<string, string>; totpSecret?: string; tags?: string[];
  }>;
  folders?: Array<{ id: string; parent: string | null; name: string }>;
  stats?: { itemCount: number; folderCount: number; dbName?: string };
}

export interface KdbxBuildResult {
  ok: boolean;
  error?: string;
  base64?: string;
  size?: number;
}

/** Parse .kdbx file bytes into a normalized item list. Password is passed
 *  only for this call — never persisted in localStorage. */
export async function vaultKdbxParse(base64: string, password: string): Promise<KdbxParseResult> {
  if (!hasNativeVault) return { ok: false, error: 'Работает только в собранной .exe (Electron).' };
  return w.netmap.vaultKdbxParse({ base64, password });
}

export async function vaultKdbxBuild(payload: {
  items: any[]; folders: Array<{ id: string; parent: string | null; name: string }>;
  dbName?: string; password: string;
}): Promise<KdbxBuildResult> {
  if (!hasNativeVault) return { ok: false, error: 'Работает только в собранной .exe (Electron).' };
  return w.netmap.vaultKdbxBuild(payload);
}

export interface ExportAllResult {
  ok?: boolean; locked?: boolean; error?: string;
  items?: VaultItemFull[];
  folders?: VaultFolder[];
}

export async function vaultExportAll(opts?: { format?: string }): Promise<ExportAllResult> {
  if (!hasNativeVault) {
    // Fallback: use readItems + decrypt each locally (only works when we have currentKey).
    if (!currentKey) return { locked: true };
    const rows = readItems();
    const items: VaultItemFull[] = [];
    for (const r of rows) {
      try {
        const plain = await aesDecrypt(currentKey, r.ivB64, r.ctB64);
        const data = JSON.parse(plain);
        items.push({
          id: r.id, name: r.name, folder: r.folder, url: r.url, updated: r.updated,
          ...data,
        });
      } catch { /* skip */ }
    }
    return { ok: true, items, folders: [] };
  }
  return w.netmap.vaultExportAll(opts || {});
}

// --------- Bitwarden / CSV parsers ---------

/** Bitwarden export is a JSON with { encrypted:false, folders:[], items:[{...}] } */
export function parseBitwardenExport(text: string): any[] {
  try {
    const obj = JSON.parse(text);
    if (obj.encrypted) throw new Error('Экспорт зашифрован. Экспортируйте как "unencrypted" JSON.');
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj)) return obj;
    return [];
  } catch (e: any) {
    throw new Error('Не удалось прочитать Bitwarden JSON: ' + (e.message || e));
  }
}

/**
 * Very permissive CSV parser: needs a header row. Recognizes common column names
 * used by KeePass/1Password/Bitwarden CSV: name/title, url/uri, username/login,
 * password, notes/note, folder/group.
 */
export function parseGenericCsv(text: string): any[] {
  const rows = csvParseLines(text);
  if (rows.length < 2) return [];
  const header = rows[0].map(h => h.toLowerCase().trim());
  const idx = (names: string[]) => header.findIndex(h => names.includes(h));
  const iName   = idx(['name','title','entry','account']);
  const iUrl    = idx(['url','uri','website','login_uri']);
  const iUser   = idx(['username','user','login','email']);
  const iPass   = idx(['password','pass','pwd','login_password']);
  const iNotes  = idx(['notes','note','comments']);
  const iFolder = idx(['folder','group','category']);

  const out: any[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.every(c => !c.trim())) continue;
    out.push({
      name:     iName   >= 0 ? r[iName]   : (r[iUser] || 'imported'),
      url:      iUrl    >= 0 ? r[iUrl]    : undefined,
      username: iUser   >= 0 ? r[iUser]   : undefined,
      password: iPass   >= 0 ? r[iPass]   : undefined,
      notes:    iNotes  >= 0 ? r[iNotes]  : undefined,
      folder:   iFolder >= 0 ? r[iFolder] : undefined,
    });
  }
  return out;
}

/** Minimal CSV tokenizer with quoted-field support (RFC 4180-ish). */
function csvParseLines(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        cur.push(field); rows.push(cur); cur = []; field = '';
      } else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}
