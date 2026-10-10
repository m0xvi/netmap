// v0.77.0: настройки автообнаружения, которые запоминаются между открытиями диалога,
// и разбор ручного списка SNMP-хостов.
//
// В localStorage НИКОГДА не попадают секреты: пароли SSH, community, ключи и пароли
// SNMPv3, passphrase SSH-ключа. Сохраняем только логины, адреса, режимы, фильтры
// и подобранные протоколы SNMPv3 (MD5/SHA/AES — не секреты).

export type V3AuthProto = 'md5' | 'sha' | 'sha256' | 'sha512';
export type V3PrivProto = 'des' | 'aes' | 'aes256b' | 'aes256r';

export interface V3Protocols {
  auth: V3AuthProto;
  priv?: V3PrivProto;
}

export interface DiscoveryPrefs {
  mode?: 'mikrotik' | 'snmp' | 'both';
  host?: string;
  port?: number;
  username?: string;
  snmpVersion?: '1' | '2c' | '3';
  v3User?: string;
  v3Level?: 'noAuthNoPriv' | 'authNoPriv' | 'authPriv';
  v3AuthProto?: V3AuthProto;
  v3PrivProto?: V3PrivProto;
  snmpSweep?: boolean;
  snmpRecursive?: boolean;
  snmpMaxHops?: number;
  manualHosts?: string;
  excludedCidrs?: string[];
  excludedVlans?: number[];
  /** Подобранный SNMPv3-протокол по адресу хоста (без ключей). */
  v3Protocols?: Record<string, V3Protocols>;
}

export const DISCOVERY_PREFS_KEY = 'netmap.discovery.prefs.v1';

const MODES = ['mikrotik', 'snmp', 'both'] as const;
const SNMP_VERSIONS = ['1', '2c', '3'] as const;
const V3_LEVELS = ['noAuthNoPriv', 'authNoPriv', 'authPriv'] as const;
const V3_AUTH = ['md5', 'sha', 'sha256', 'sha512'] as const;
const V3_PRIV = ['des', 'aes', 'aes256b', 'aes256r'] as const;

function pick<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}
function str(v: unknown, max = 200): string | undefined {
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}
function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

/** Приводит сохранённый JSON к известной форме; мусор отбрасывается. */
export function sanitizePrefs(raw: unknown): DiscoveryPrefs {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const out: DiscoveryPrefs = {};
  const mode = pick(o.mode, MODES); if (mode) out.mode = mode;
  const host = str(o.host); if (host) out.host = host;
  if (typeof o.port === 'number' && o.port > 0 && o.port < 65536) out.port = Math.floor(o.port);
  const username = str(o.username); if (username != null) out.username = username;
  const ver = pick(o.snmpVersion, SNMP_VERSIONS); if (ver) out.snmpVersion = ver;
  const v3User = str(o.v3User); if (v3User != null) out.v3User = v3User;
  const lvl = pick(o.v3Level, V3_LEVELS); if (lvl) out.v3Level = lvl;
  const ap = pick(o.v3AuthProto, V3_AUTH); if (ap) out.v3AuthProto = ap;
  const pp = pick(o.v3PrivProto, V3_PRIV); if (pp) out.v3PrivProto = pp;
  const sw = bool(o.snmpSweep); if (sw != null) out.snmpSweep = sw;
  const rec = bool(o.snmpRecursive); if (rec != null) out.snmpRecursive = rec;
  if (typeof o.snmpMaxHops === 'number' && [1, 2, 3].includes(o.snmpMaxHops)) out.snmpMaxHops = o.snmpMaxHops;
  const mh = str(o.manualHosts, 2000); if (mh != null) out.manualHosts = mh;
  if (Array.isArray(o.excludedCidrs)) {
    out.excludedCidrs = o.excludedCidrs.filter((c): c is string => typeof c === 'string' && c.length < 64).slice(0, 500);
  }
  if (Array.isArray(o.excludedVlans)) {
    out.excludedVlans = o.excludedVlans.filter((v): v is number => Number.isInteger(v) && v >= 1 && v <= 4094).slice(0, 500);
  }
  if (o.v3Protocols && typeof o.v3Protocols === 'object') {
    const map: Record<string, V3Protocols> = {};
    for (const [h, rec2] of Object.entries(o.v3Protocols as Record<string, unknown>)) {
      if (!h || h.length > 64 || !rec2 || typeof rec2 !== 'object') continue;
      const auth = pick((rec2 as any).auth, V3_AUTH);
      if (!auth) continue;
      const priv = pick((rec2 as any).priv, V3_PRIV);
      map[h] = priv ? { auth, priv } : { auth };
    }
    out.v3Protocols = map;
  }
  return out;
}

export function loadDiscoveryPrefs(): DiscoveryPrefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(DISCOVERY_PREFS_KEY) : null;
    return raw ? sanitizePrefs(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveDiscoveryPrefs(p: DiscoveryPrefs): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(DISCOVERY_PREFS_KEY, JSON.stringify(sanitizePrefs(p)));
  } catch {
    // квота/приватный режим — настройки просто не запомнятся
  }
}

// ---------- ручной список SNMP-хостов ------------------------------------

const MAX_MANUAL_HOSTS = 256;

function ipToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some(n => n < 0 || n > 255)) return null;
  return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}

function intToIp(n: number): string {
  return [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join('.');
}

/**
 * Разбирает строку вида «10.0.0.2, 10.0.1.10-20, 10.0.2.5-10.0.2.9, 10.0.5.0/28».
 * Разделители — пробелы, запятые, точки с запятой, переводы строк.
 * ips — уникальные IPv4 в порядке ввода (не больше 256); errors — фрагменты, которые не разобрались.
 */
export function parseHostList(text: string): { ips: string[]; errors: string[] } {
  const ips: string[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  const tokens = (text || '').split(/[\s,;]+/).map(t => t.trim()).filter(Boolean);
  const add = (n: number) => {
    const ip = intToIp(n);
    if (!seen.has(ip)) { seen.add(ip); ips.push(ip); }
  };
  for (const tok of tokens) {
    let m: RegExpExecArray | null;
    if ((m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(tok))) {
      const base = ipToInt(m[1]);
      const bits = Number(m[2]);
      if (base == null || bits < 24 || bits > 32) { errors.push(tok); continue; }
      const size = 2 ** (32 - bits);
      if (size > 256) { errors.push(tok); continue; } // больше /24 — слишком много адресов
      const start = Math.floor(base / size) * size;
      // у /31 и /32 — все адреса; у остальных — без сети и широковещания
      const from = bits >= 31 ? start : start + 1;
      const to = bits >= 31 ? start + size - 1 : start + size - 2;
      for (let n = from; n <= to; n++) add(n);
    } else if ((m = /^(\d+\.\d+\.\d+\.\d+)-(\d+\.\d+\.\d+\.\d+|\d{1,3})$/.exec(tok))) {
      const a = ipToInt(m[1]);
      if (a == null) { errors.push(tok); continue; }
      let b: number | null;
      if (m[2].includes('.')) {
        b = ipToInt(m[2]);
      } else {
        const last = Number(m[2]);
        b = last <= 255 ? (a - (a % 256)) + last : null; // «10.0.0.1-20» — последний октет
      }
      if (b == null || b < a || b - a > 255) { errors.push(tok); continue; }
      for (let n = a; n <= b; n++) add(n);
    } else if ((m = /^\d+\.\d+\.\d+\.\d+$/.exec(tok))) {
      const n = ipToInt(tok);
      if (n == null) errors.push(tok); else add(n);
    } else {
      errors.push(tok);
    }
  }
  if (ips.length > MAX_MANUAL_HOSTS) errors.push(`лимит ${MAX_MANUAL_HOSTS} адресов`);
  return { ips: ips.slice(0, MAX_MANUAL_HOSTS), errors: errors.slice(0, 20) };
}
