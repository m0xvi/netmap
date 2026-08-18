/**
 * v0.43 — Smart categories for vault items.
 *
 * Auto-detects the "kind" of each item from its URL / tags / fields so we
 * can render 1Password-style category filters in the sidebar. No schema
 * migration — the derivation is pure at read time.
 *
 * Recognised kinds:
 *   login       — anything with url + username + password (default)
 *   ssh         — url starts with ssh://, tag contains 'ssh', or fields has PrivateKey
 *   wifi        — tag 'wifi', or fields has SSID
 *   cert        — tag 'cert' or 'certificate', or fields has Certificate/PrivateKey
 *   secure_note — no url + no username, only notes
 *   api_token   — tag 'api' or 'token', or fields has ApiKey/Bearer
 *   database    — url starts with postgres://, mysql://, mongodb:// etc.
 *
 * Quick-connect action detection uses similar heuristics on url + tags.
 */

import type { VaultItemFull, VaultItemMeta } from './vaultClient';

export type VaultKind =
  | 'login' | 'ssh' | 'wifi' | 'cert' | 'secure_note'
  | 'api_token' | 'database';

export interface CategoryMeta {
  id: VaultKind;
  label: string;
  color: string;
}

// v0.43.1: emoji removed by user request. Icons rendered as SVG in NavRow.
export const CATEGORIES: CategoryMeta[] = [
  { id: 'login',       label: 'Logins',          color: '#2563EB' },
  { id: 'ssh',         label: 'SSH Keys',        color: '#0F172A' },
  { id: 'wifi',        label: 'Wi-Fi Passwords', color: '#F59E0B' },
  { id: 'cert',        label: 'Certificates',    color: '#059669' },
  { id: 'secure_note', label: 'Secure Notes',    color: '#64748B' },
  { id: 'api_token',   label: 'API Tokens',      color: '#DC2626' },
  { id: 'database',    label: 'Databases',       color: '#7C3AED' },
];

const DB_SCHEMES = ['postgres', 'postgresql', 'mysql', 'mariadb', 'mongodb', 'redis', 'mssql', 'oracle', 'clickhouse'];

/** Derive the kind of a vault item from its metadata (URL + tags + fields). */
export function deriveKind(
  item: Pick<VaultItemMeta, 'url' | 'tags'> & Partial<Pick<VaultItemFull, 'username' | 'password' | 'notes' | 'fields'>>,
): VaultKind {
  const url = (item.url || '').toLowerCase().trim();
  const tags = (item.tags || []).map(t => t.toLowerCase());
  const fieldKeys = Object.keys(item.fields || {}).map(k => k.toLowerCase());

  // Explicit URL schemes
  if (url.startsWith('ssh://') || tags.includes('ssh') || fieldKeys.some(k => k.includes('private') && k.includes('key'))) {
    return 'ssh';
  }
  for (const s of DB_SCHEMES) {
    if (url.startsWith(s + '://')) return 'database';
  }
  if (tags.includes('database') || tags.includes('db')) return 'database';

  // Wi-Fi (has SSID field, or wifi tag)
  if (tags.includes('wifi') || tags.includes('wi-fi') || fieldKeys.includes('ssid')) {
    return 'wifi';
  }

  // Certificate (has certificate / pem field)
  if (tags.includes('cert') || tags.includes('certificate')
      || fieldKeys.some(k => k.includes('certificate') || k === 'pem' || k === 'ca')) {
    return 'cert';
  }

  // API token
  if (tags.includes('api') || tags.includes('token') || tags.includes('bearer')
      || fieldKeys.some(k => k.includes('apikey') || k === 'api_key' || k === 'bearer' || k === 'access_token')) {
    return 'api_token';
  }

  // Secure note — no url, no username, only notes/fields
  const hasUrl = !!url;
  const hasUser = !!(item.username && item.username.trim());
  if (!hasUrl && !hasUser) return 'secure_note';

  return 'login';
}

// ---------------------------------------------------------------------------
// Quick-connect action detection

export type ConnectAction = 'ssh' | 'web' | 'rdp' | 'db' | 'none';

export interface ConnectTarget {
  action: ConnectAction;
  host: string;
  port?: number;
  scheme?: string;
  fullUrl?: string;
  label: string;      // "SSH" / "Web UI" / "RDP"
}

/** Determine the primary connect action for an item, from URL/tags/hints. */
export function deriveConnectAction(
  item: Pick<VaultItemMeta, 'url' | 'tags'>
): ConnectTarget | null {
  const url = (item.url || '').trim();
  const tags = (item.tags || []).map(t => t.toLowerCase());

  if (!url) {
    // Only hint we have: tags. Not enough to auto-launch.
    if (tags.includes('rdp'))  return { action: 'rdp', host: '', label: 'RDP' };
    if (tags.includes('ssh'))  return { action: 'ssh', host: '', label: 'SSH' };
    return null;
  }

  // Parse scheme + host
  const parsed = parseConnectUrl(url);
  if (!parsed) return null;

  const { scheme, host, port } = parsed;

  if (scheme === 'ssh' || tags.includes('ssh') || port === 22) {
    return { action: 'ssh', host, port: port || 22, scheme: 'ssh', fullUrl: url, label: 'SSH' };
  }
  if (scheme === 'rdp' || tags.includes('rdp') || port === 3389) {
    return { action: 'rdp', host, port: port || 3389, scheme: 'rdp', fullUrl: url, label: 'RDP' };
  }
  if (scheme === 'http' || scheme === 'https') {
    return { action: 'web', host, port, scheme, fullUrl: url, label: 'Web UI' };
  }
  if (DB_SCHEMES.includes(scheme)) {
    return { action: 'db', host, port, scheme, fullUrl: url, label: scheme.toUpperCase() };
  }

  // Default: assume web
  return { action: 'web', host, port, scheme: 'http', fullUrl: url.startsWith('http') ? url : 'http://' + url, label: 'Web UI' };
}

function parseConnectUrl(raw: string): { scheme: string; host: string; port?: number } | null {
  let s = raw.trim();
  const schemeMatch = /^([a-zA-Z][\w+.-]*):\/\//.exec(s);
  let scheme = 'http';
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase();
    s = s.slice(schemeMatch[0].length);
  }
  // Strip path / query
  s = s.replace(/\/.*$/, '').replace(/\?.*$/, '');
  // user@host:port form
  s = s.replace(/^[^@]+@/, '');
  const portMatch = /^([^:]+):(\d+)$/.exec(s);
  if (portMatch) {
    return { scheme, host: portMatch[1], port: Number(portMatch[2]) };
  }
  if (!s) return null;
  return { scheme, host: s };
}
