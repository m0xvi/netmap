/**
 * Thin bridge over window.netmap.* IPC — available only in Electron.
 */

const w = typeof window !== 'undefined' ? (window as any) : {};
export const hasMikrotikBackend = !!(w.netmap && typeof w.netmap.mikrotikScan === 'function');

export interface MikrotikConfig {
  host: string;
  username: string;
  password: string;
  /** v0.35.9: transport selector. 'rest' = HTTP(S) `/rest/*` API (default,
   *  fast but often disabled on production boxes). 'ssh' = SSH into
   *  RouterOS CLI, drive `print terse` commands. */
  transport?: 'rest' | 'ssh';
  /** v0.35.9: SSH port (defaults to 22). Only used when transport='ssh'. */
  port?: number;
  insecure?: boolean;
  fetchLeases?: boolean;
  fetchArp?: boolean;
  fetchInterfaces?: boolean;
  fetchVlans?: boolean;
}

/** v0.35.9: IP address configured on the router — used for the subnet picker. */
export interface RouterAddress {
  address: string;      // "192.168.11.1/24"
  network: string;      // "192.168.11.0"
  interface: string;
  comment: string;
  disabled: boolean;
}

export interface MikrotikVlan {
  vlanId: number;
  name?: string;         // from /interface/vlan
  iface?: string;        // parent interface (e.g. ether1)
  bridge?: string;       // bridge name (from /interface/bridge/vlan)
  taggedPorts?: string;  // e.g. "ether2,ether3,sfp1"
  untaggedPorts?: string;
  comment?: string;
  source?: 'interface' | 'bridge';
  disabled?: boolean;
}

export interface DhcpLease {
  mac: string;
  ip: string | null;
  hostname: string;
  comment: string;
  dynamic: boolean;
  status: string;
  server: string;
  expiresAfter: string;
}

export interface ArpEntry {
  mac: string;
  ip: string | null;
  interface: string;
  dynamic: boolean;
  complete: boolean;
}

export interface RouterInterface {
  name: string;
  type: string;
  mac: string;
  running: boolean;
  disabled: boolean;
  comment: string;
}

export interface ScanResult {
  resource: {
    ok: boolean;
    boardName?: string;
    version?: string;
    uptime?: string;
    cpuLoad?: number | string;
    identity?: string | null;
    error?: string;
  };
  leases: DhcpLease[];
  arp: ArpEntry[];
  interfaces: RouterInterface[];
  vlans?: MikrotikVlan[];
  /** v0.35.9: list of /ip address entries for the subnet-picker UI. */
  addresses?: RouterAddress[];
}

export async function testMikrotik(cfg: MikrotikConfig) {
  if (!hasMikrotikBackend) throw new Error('MikroTik импорт доступен только в собранной .exe (Electron).');
  return w.netmap.mikrotikTest(cfg);
}

export async function scanMikrotik(cfg: MikrotikConfig): Promise<ScanResult> {
  if (!hasMikrotikBackend) throw new Error('MikroTik импорт доступен только в собранной .exe (Electron).');
  return w.netmap.mikrotikScan(cfg);
}

/** v0.35.10: RAW output of every command we normally parse. Used by the
 *  "Показать сырой ответ" debug button — appears in the dialog when a scan
 *  succeeded but parsing yielded no rows (so the user can copy-paste the
 *  actual RouterOS output for us to inspect). SSH transport only. */
export interface DebugRawResult {
  [cmd: string]: { ok: true; out: string } | { ok: false; error: string };
}
export async function debugMikrotik(cfg: MikrotikConfig): Promise<DebugRawResult> {
  if (!hasMikrotikBackend) throw new Error('Отладка доступна только в собранной .exe.');
  if (!w.netmap.mikrotikDebug) throw new Error('IPC handler отсутствует (пересоберите приложение).');
  return w.netmap.mikrotikDebug(cfg);
}

// ---------- v0.35.9 subnet filter utilities --------------------------------

/** Parse a CIDR ("192.168.11.0/24") into { network32, mask32, bits }. */
function parseCidr(cidr: string): { network: number; mask: number; bits: number } | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!m) return null;
  const a = +m[1], b = +m[2], c = +m[3], d = +m[4], bits = +m[5];
  if ([a, b, c, d].some(x => x < 0 || x > 255) || bits < 0 || bits > 32) return null;
  const ip = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
  return { network: (ip & mask) >>> 0, mask, bits };
}

/** Convert an IP dotted-quad to a 32-bit unsigned integer. */
function ipToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec((ip || '').trim());
  if (!m) return null;
  const a = +m[1], b = +m[2], c = +m[3], d = +m[4];
  if ([a, b, c, d].some(x => x < 0 || x > 255)) return null;
  return (((a << 24) | (b << 16) | (c << 8) | d) >>> 0);
}

/** True if `ip` falls into any of the given `cidrs`. */
export function ipInAnyCidr(ip: string | null | undefined, cidrs: string[]): boolean {
  if (!ip) return false;
  const n = ipToInt(ip);
  if (n == null) return false;
  for (const c of cidrs) {
    const p = parseCidr(c);
    if (!p) continue;
    if ((n & p.mask) >>> 0 === p.network) return true;
  }
  return false;
}

/**
 * Derive the list of distinct subnets present in a scan (based on discovered
 * IPs), and how many devices land in each. Used to populate the subnet picker.
 * If the router publishes /ip/address entries with CIDRs, those take
 * precedence (real router-side truth); otherwise we infer /24 subnets from
 * lease + ARP IPs.
 */
export interface SubnetStat {
  cidr: string;                 // "192.168.11.0/24"
  network: string;              // "192.168.11.0"
  bits: number;                 // 24
  deviceCount: number;
  interfaces?: string[];        // router interfaces bound to this subnet
  comment?: string;
  fromRouter: boolean;          // true if it came from /ip/address; false if inferred
}

export function summarizeSubnets(scan: ScanResult): SubnetStat[] {
  // Count IPs that fall into each candidate CIDR.
  const ips = [
    ...scan.leases.map(l => l.ip).filter((x): x is string => !!x),
    ...scan.arp.map(a => a.ip).filter((x): x is string => !!x),
  ];

  const stat = new Map<string, SubnetStat>();

  // 1) Prefer router-declared /ip/address CIDRs — they're the source of truth.
  for (const a of scan.addresses || []) {
    const p = parseCidr(a.address);
    if (!p) continue;
    const network = intToIp(p.network);
    const key = `${network}/${p.bits}`;
    if (!stat.has(key)) {
      stat.set(key, {
        cidr: key, network, bits: p.bits, deviceCount: 0,
        interfaces: [a.interface].filter(Boolean),
        comment: a.comment || undefined,
        fromRouter: true,
      });
    } else {
      const s = stat.get(key)!;
      if (a.interface && !s.interfaces?.includes(a.interface)) {
        s.interfaces = [...(s.interfaces || []), a.interface];
      }
    }
  }

  // 2) Infer /24 subnets for any IP not matched by router-declared CIDRs.
  for (const ip of ips) {
    const n = ipToInt(ip);
    if (n == null) continue;
    // If any router CIDR contains this IP, count into it.
    let matched: SubnetStat | undefined;
    for (const s of stat.values()) {
      const p = parseCidr(s.cidr);
      if (p && ((n & p.mask) >>> 0) === p.network) { matched = s; break; }
    }
    if (matched) { matched.deviceCount++; continue; }
    // Otherwise fall back to /24
    const network = intToIp((n & 0xFFFFFF00) >>> 0);
    const key = `${network}/24`;
    if (!stat.has(key)) {
      stat.set(key, {
        cidr: key, network, bits: 24, deviceCount: 1, fromRouter: false,
      });
    } else {
      stat.get(key)!.deviceCount++;
    }
  }

  return Array.from(stat.values()).sort((a, b) => {
    // Router-declared first, then by device count desc.
    if (a.fromRouter !== b.fromRouter) return a.fromRouter ? -1 : 1;
    return b.deviceCount - a.deviceCount;
  });
}

function intToIp(n: number): string {
  return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF].join('.');
}

// ---------- Vendor-guess by MAC OUI (very small subset) ----------
// If a device has hostname === '' we try to guess its kind from MAC prefix.
const OUI_HINTS: Array<{ prefix: string; vendor: string; kind: 'ap'|'camera'|'printer'|'pc'|'pos'|'server'|'switch'|'lock' }> = [
  { prefix: 'B8:27:EB', vendor: 'Raspberry Pi',    kind: 'pc' },
  { prefix: 'DC:A6:32', vendor: 'Raspberry Pi',    kind: 'pc' },
  { prefix: '00:0C:29', vendor: 'VMware',          kind: 'server' },
  { prefix: '00:50:56', vendor: 'VMware',          kind: 'server' },
  { prefix: '00:15:5D', vendor: 'Microsoft HyperV',kind: 'server' },
  { prefix: '00:1B:0D', vendor: 'Cisco',           kind: 'switch' },
  { prefix: '00:1B:63', vendor: 'Apple',           kind: 'pc' },
  { prefix: 'AC:BC:32', vendor: 'Apple',           kind: 'pc' },
  { prefix: 'B4:FB:E4', vendor: 'Ubiquiti',        kind: 'ap' },
  { prefix: '24:5A:4C', vendor: 'Ubiquiti',        kind: 'ap' },
  { prefix: 'F0:9F:C2', vendor: 'Ubiquiti',        kind: 'ap' },
  { prefix: '48:8F:5A', vendor: 'Ubiquiti',        kind: 'ap' },
  { prefix: 'B8:27:EB', vendor: 'Raspberry Pi',    kind: 'pc' },
  { prefix: 'CC:2D:E0', vendor: 'MikroTik',        kind: 'switch' },
  { prefix: '4C:5E:0C', vendor: 'MikroTik',        kind: 'switch' },
  { prefix: '00:0C:42', vendor: 'MikroTik',        kind: 'switch' },
  { prefix: 'D4:CA:6D', vendor: 'MikroTik',        kind: 'switch' },
  { prefix: '00:11:32', vendor: 'Synology',        kind: 'server' },
  { prefix: '00:40:8C', vendor: 'Axis Camera',     kind: 'camera' },
  { prefix: 'AC:CC:8E', vendor: 'Axis Camera',     kind: 'camera' },
  { prefix: 'BC:AD:28', vendor: 'Hikvision',       kind: 'camera' },
  { prefix: '44:19:B6', vendor: 'Hikvision',       kind: 'camera' },
  { prefix: '4C:BD:8F', vendor: 'Hikvision',       kind: 'camera' },
  { prefix: '3C:1B:F8', vendor: 'Dahua',           kind: 'camera' },
  { prefix: '00:80:F0', vendor: 'Kyocera',         kind: 'printer' },
  { prefix: '00:00:74', vendor: 'Ricoh',           kind: 'printer' },
  { prefix: '00:26:73', vendor: 'HP Printer',      kind: 'printer' },
];

export function guessVendorAndKind(mac: string, hostname: string): {
  vendor?: string;
  kind: 'ap'|'camera'|'printer'|'pc'|'pos'|'server'|'switch'|'lock';
} {
  const m = (mac || '').toUpperCase();
  for (const h of OUI_HINTS) {
    if (m.startsWith(h.prefix)) return { vendor: h.vendor, kind: h.kind };
  }
  // Weak heuristics on hostname
  const hn = (hostname || '').toLowerCase();
  if (/(cam|cctv|hik|dahua)/.test(hn))   return { kind: 'camera' };
  if (/(print|hp|kyocera)/.test(hn))     return { kind: 'printer' };
  if (/(ap|unifi|ubnt|wifi)/.test(hn))   return { kind: 'ap' };
  if (/(pos|kass|rk7|atol|paytor)/.test(hn)) return { kind: 'pos' };
  if (/(salto|door|lock)/.test(hn))      return { kind: 'lock' };
  if (/(srv|server|hyperv|nas|synology|esxi)/.test(hn)) return { kind: 'server' };
  if (/(sw[-_]?|switch|dlink|tp[-_]?link)/.test(hn)) return { kind: 'switch' };
  return { kind: 'pc' };
}
