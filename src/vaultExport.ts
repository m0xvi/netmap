/**
 * v0.39 — Exporters for vault items.
 *
 * All exporters receive an already-decrypted item list (typically from
 * `vaultExportAll()`). Each returns a { filename, blob } pair — the caller
 * triggers the browser download.
 *
 * Formats:
 *   - Bitwarden JSON (plain, no encryption — same shape as
 *     https://bitwarden.com/help/encrypted-export/#json-unencrypted)
 *   - KeePass .kdbx (encrypted with a fresh master password — round-trips
 *     into KeePass2 / KeePassXC / KeeWeb)
 *   - CSV (KeePass-compatible flat CSV: Group, Title, Username, Password,
 *     URL, Notes, TOTP)
 */

import type { VaultItemFull, VaultFolder } from './vaultClient';
import { vaultKdbxBuild } from './vaultClient';

export interface ExportedFile {
  filename: string;
  blob: Blob;
  mime: string;
}

// ---------------------------------------------------------------------------
// Bitwarden JSON (unencrypted)

export function exportBitwardenJson(
  items: VaultItemFull[],
  folders: VaultFolder[],
): ExportedFile {
  const payload = {
    encrypted: false,
    folders: folders.map(f => ({ id: f.id, name: f.name })),
    items: items.map(item => ({
      id: item.id,
      folderId: item.folder || null,
      organizationId: null,
      type: 1,          // 1 = Login
      name: item.name || 'entry',
      notes: item.notes || '',
      login: {
        username: item.username || '',
        password: item.password || '',
        totp:     item.totpSecret || '',
        uris: item.url ? [{ match: null, uri: item.url }] : [],
      },
      fields: Object.entries(item.fields || {}).map(([name, value]) => ({
        name, value, type: 0,   // 0 = Text
      })),
      collectionIds: null,
      favorite: false,
      reprompt: 0,
    })),
  };
  const json = JSON.stringify(payload, null, 2);
  return {
    filename: `netmap-vault-${dateStamp()}.bitwarden.json`,
    blob: new Blob([json], { type: 'application/json' }),
    mime: 'application/json',
  };
}

// ---------------------------------------------------------------------------
// CSV (KeePass-compatible)

export function exportCsv(items: VaultItemFull[], folders: VaultFolder[]): ExportedFile {
  const folderById = new Map(folders.map(f => [f.id, f]));
  const folderPath = (id: string | null | undefined): string => {
    if (!id) return '';
    const parts: string[] = [];
    let cur = folderById.get(id);
    let guard = 20;
    while (cur && guard-- > 0) {
      parts.unshift(cur.name);
      cur = cur.parent ? folderById.get(cur.parent) : undefined;
    }
    return parts.join('/');
  };

  const header = ['Group', 'Title', 'Username', 'Password', 'URL', 'Notes', 'TOTP', 'Tags'];
  const lines: string[] = [header.map(csvEscape).join(',')];
  for (const item of items) {
    lines.push([
      folderPath(item.folder),
      item.name || '',
      item.username || '',
      item.password || '',
      item.url || '',
      item.notes || '',
      item.totpSecret || '',
      (item.tags || []).join(';'),
    ].map(csvEscape).join(','));
  }
  return {
    filename: `netmap-vault-${dateStamp()}.csv`,
    blob: new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }),
    mime: 'text/csv',
  };
}

function csvEscape(s: any): string {
  const str = s == null ? '' : String(s);
  if (/[",\r\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

// ---------------------------------------------------------------------------
// KeePass .kdbx (encrypted)

export async function exportKdbx(
  items: VaultItemFull[],
  folders: VaultFolder[],
  masterPassword: string,
): Promise<ExportedFile> {
  const res = await vaultKdbxBuild({
    items: items.map(i => ({
      name: i.name, folder: i.folder,
      url: i.url, username: i.username, password: i.password, notes: i.notes,
      fields: i.fields, totpSecret: i.totpSecret, tags: i.tags,
    })),
    folders: folders.map(f => ({ id: f.id, parent: f.parent, name: f.name })),
    dbName: `NetMap Vault (${dateStamp()})`,
    password: masterPassword,
  });
  if (!res.ok || !res.base64) throw new Error(res.error || 'Экспорт .kdbx не удался');
  // Convert base64 → Uint8Array → Blob so browser download works.
  const bin = atob(res.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return {
    filename: `netmap-vault-${dateStamp()}.kdbx`,
    blob: new Blob([bytes], { type: 'application/octet-stream' }),
    mime: 'application/octet-stream',
  };
}

// ---------------------------------------------------------------------------
// Audit log CSV

export function exportAuditCsv(entries: Array<{
  id: number; ts: number; action: string; itemName?: string | null; detail?: string | null;
}>): ExportedFile {
  const header = ['Timestamp', 'Action', 'Item', 'Detail'];
  const lines: string[] = [header.map(csvEscape).join(',')];
  for (const e of entries) {
    lines.push([
      new Date(e.ts).toISOString(),
      e.action,
      e.itemName || '',
      e.detail || '',
    ].map(csvEscape).join(','));
  }
  return {
    filename: `netmap-vault-audit-${dateStamp()}.csv`,
    blob: new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }),
    mime: 'text/csv',
  };
}

// ---------------------------------------------------------------------------
// Trigger browser download

export function downloadFile(file: ExportedFile) {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 500);
}

function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
