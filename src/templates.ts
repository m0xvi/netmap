import type { Device, DeviceKind, Port, PortType } from './types';

// -----------------------------------------------------------------------------
// Template schema
// -----------------------------------------------------------------------------

export interface TemplatePortGroup {
  /** Pattern like "eth{n}" — {n} is replaced with 1..count. If no {n}, single port. */
  idPattern: string;
  count?: number;                       // default 1
  labelPattern?: string;                // e.g. "PoE {n}"
  type: PortType;
  speed?: '100M' | '1G' | '2.5G' | '10G';
  poe?: boolean;
  poeActiveByDefault?: boolean;
  uplink?: boolean;
}

export interface DeviceTemplate {
  id: string;
  vendor: string;
  model: string;
  kind: DeviceKind;
  description?: string;
  defaultDisplay?: 'compact' | 'rack';
  portGroups: TemplatePortGroup[];
  tags?: string[];       // for filtering: 'poe', '10G', 'wifi6', 'outdoor', '48p'
  isCustom?: boolean;    // user-created (kept in localStorage)
  // v0.35.4 — preset payloads copied to a fresh device on instantiation
  dvr?: Device['dvr'];
  hostSpec?: Device['hostSpec'];
  ssids?: Device['ssids'];
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

export function instantiatePorts(t: DeviceTemplate): Port[] {
  const out: Port[] = [];
  for (const g of t.portGroups) {
    const n = g.count ?? 1;
    for (let i = 1; i <= n; i++) {
      const id = g.idPattern.replace('{n}', String(i));
      const label = g.labelPattern ? g.labelPattern.replace('{n}', String(i)) : '';
      out.push({
        id, label,
        type: g.type,
        speed: g.speed,
        poe: g.poe,
        poeActive: g.poeActiveByDefault,
        uplink: g.uplink,
        status: 'down',
      });
    }
  }
  return out;
}

export function makeDeviceFromTemplate(t: DeviceTemplate, x: number, y: number): Device {
  const id = `${t.kind}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: `${t.vendor} ${t.model}`,
    kind: t.kind,
    vendor: t.vendor,
    model: t.model,
    x, y,
    ports: instantiatePorts(t),
    display: t.defaultDisplay ?? 'compact',
    tags: t.tags ? [...t.tags] : undefined,
    // v0.35.4: deep-copy template presets so edits to the new device don't
    // mutate the template.
    dvr: t.dvr ? { ...t.dvr, disks: t.dvr.disks ? t.dvr.disks.map(d => ({ ...d })) : undefined } : undefined,
    hostSpec: t.hostSpec ? {
      ...t.hostSpec,
      disks: t.hostSpec.disks ? t.hostSpec.disks.map(d => ({ ...d })) : undefined,
      software: t.hostSpec.software ? [...t.hostSpec.software] : undefined,
    } : undefined,
    ssids: t.ssids ? t.ssids.map(s => ({ ...s })) : undefined,
  };
}

// -----------------------------------------------------------------------------
// Built-in catalog (curated for a hotel/office scenario)
// -----------------------------------------------------------------------------

export const BUILT_IN_TEMPLATES: DeviceTemplate[] = [
  // ---- Routers ----
  {
    id: 'mt-rb3011', vendor: 'MikroTik', model: 'RB3011UiAS-RM',
    kind: 'router',
    description: '10×Gigabit + 1×SFP, RouterOS L5, 1U rackmount',
    portGroups: [
      { idPattern: 'eth{n}', count: 10, type: 'RJ45', speed: '1G' },
      { idPattern: 'sfp1',   count: 1,  type: 'SFP',  speed: '1G', uplink: true },
    ],
    tags: ['mikrotik', 'routerboard', '1u'],
  },
  {
    id: 'mt-rb5009', vendor: 'MikroTik', model: 'RB5009UG+S+IN',
    kind: 'router',
    description: '7×Gigabit + 1×2.5G + 1×SFP+ 10G',
    portGroups: [
      { idPattern: 'eth{n}', count: 7, type: 'RJ45', speed: '1G' },
      { idPattern: 'eth8',   count: 1, type: 'RJ45', speed: '2.5G' },
      { idPattern: 'sfp1',   count: 1, type: 'SFP+', speed: '10G', uplink: true },
    ],
    tags: ['mikrotik', '10g', '2.5g'],
  },
  {
    id: 'ubnt-udm-pro', vendor: 'Ubiquiti', model: 'UDM-Pro',
    kind: 'router',
    description: 'Dream Machine Pro: 8×Gig, 1×SFP+ WAN, 1×SFP+ LAN',
    portGroups: [
      { idPattern: 'wan',    count: 1, type: 'SFP+', speed: '10G', uplink: true },
      { idPattern: 'wan2',   count: 1, type: 'RJ45', speed: '1G',  uplink: true },
      { idPattern: 'eth{n}', count: 8, type: 'RJ45', speed: '1G' },
      { idPattern: 'sfp+',   count: 1, type: 'SFP+', speed: '10G' },
    ],
    tags: ['unifi', 'udm', 'firewall'],
  },

  // ---- Switches ----
  {
    id: 'mt-crs328-24p', vendor: 'MikroTik', model: 'CRS328-24P-4S+RM',
    kind: 'switch',
    description: '24×Gigabit PoE + 4×SFP+ 10G, 500W PoE budget',
    defaultDisplay: 'rack',
    portGroups: [
      { idPattern: 'eth{n}', count: 24, type: 'RJ45', speed: '1G', poe: true },
      { idPattern: 'sfp{n}', count: 4,  type: 'SFP+', speed: '10G', uplink: true },
    ],
    tags: ['mikrotik', 'poe', '10g', '24p'],
  },
  {
    id: 'mt-crs305', vendor: 'MikroTik', model: 'CRS305-1G-4S+',
    kind: 'switch',
    description: '1×Gigabit + 4×SFP+ 10G — маленький агрегатор',
    defaultDisplay: 'rack',
    portGroups: [
      { idPattern: 'eth1',   count: 1, type: 'RJ45', speed: '1G' },
      { idPattern: 'sfp{n}', count: 4, type: 'SFP+', speed: '10G', uplink: true },
    ],
    tags: ['mikrotik', '10g', 'aggregation'],
  },
  {
    id: 'tp-tl-sg3428xmp', vendor: 'TP-Link', model: 'TL-SG3428XMP',
    kind: 'switch',
    description: '24×Gigabit PoE+ + 4×SFP+ 10G, L2+ managed',
    defaultDisplay: 'rack',
    portGroups: [
      { idPattern: 'eth{n}', count: 24, type: 'RJ45', speed: '1G', poe: true },
      { idPattern: 'sfp{n}', count: 4,  type: 'SFP+', speed: '10G', uplink: true },
    ],
    tags: ['tplink', 'poe', '10g', '24p', 'managed'],
  },
  {
    id: 'cisco-ce500-24lc', vendor: 'Cisco', model: 'WS-CE500-24LC',
    kind: 'switch',
    description: 'Catalyst Express 500: 24×10/100 + 2×Gig combo',
    defaultDisplay: 'rack',
    portGroups: [
      { idPattern: 'fa{n}',  count: 24, type: 'RJ45', speed: '100M' },
      { idPattern: 'gi{n}',  count: 2,  type: 'Combo', speed: '1G', uplink: true },
    ],
    tags: ['cisco', 'catalyst', 'legacy', '24p'],
  },
  {
    id: 'dlink-dgs-1210-28p', vendor: 'D-Link', model: 'DGS-1210-28P',
    kind: 'switch',
    description: '24×Gigabit PoE + 4×SFP smart-managed',
    defaultDisplay: 'rack',
    portGroups: [
      { idPattern: 'eth{n}', count: 24, type: 'RJ45', speed: '1G', poe: true },
      { idPattern: 'sfp{n}', count: 4,  type: 'SFP',  speed: '1G', uplink: true },
    ],
    tags: ['dlink', 'poe', 'smart', '24p'],
  },
  {
    id: 'ubnt-usw-pro-24-poe', vendor: 'Ubiquiti', model: 'USW-Pro-24-PoE',
    kind: 'switch',
    description: '24×Gigabit PoE+ + 2×SFP+ 10G L3-lite',
    defaultDisplay: 'rack',
    portGroups: [
      { idPattern: 'eth{n}', count: 24, type: 'RJ45', speed: '1G', poe: true },
      { idPattern: 'sfp{n}', count: 2,  type: 'SFP+', speed: '10G', uplink: true },
    ],
    tags: ['unifi', 'poe', '10g', '24p'],
  },

  // ---- Access Points ----
  {
    id: 'ubnt-u6-pro', vendor: 'Ubiquiti', model: 'UniFi U6-Pro',
    kind: 'ap',
    description: 'Wi-Fi 6 (802.11ax), 4×4 MU-MIMO, PoE+',
    portGroups: [{ idPattern: 'poe', count: 1, type: 'RJ45', speed: '1G', poe: true, poeActiveByDefault: true }],
    tags: ['unifi', 'wifi6', 'poe'],
  },
  {
    id: 'ubnt-uap-ac-lite', vendor: 'Ubiquiti', model: 'UniFi AC-Lite',
    kind: 'ap',
    description: 'Wi-Fi 5 (802.11ac), 2×2 MIMO, 24V PoE',
    portGroups: [{ idPattern: 'poe', count: 1, type: 'RJ45', speed: '1G', poe: true, poeActiveByDefault: true }],
    tags: ['unifi', 'wifi5', 'poe'],
  },
  {
    id: 'mt-hap-ac3', vendor: 'MikroTik', model: 'hAP ac³',
    kind: 'ap',
    description: 'Dual-band Wi-Fi 5 SOHO router/AP, 5×Gigabit',
    portGroups: [
      { idPattern: 'eth{n}', count: 5, type: 'RJ45', speed: '1G' },
    ],
    tags: ['mikrotik', 'wifi5'],
  },

  // ---- Cameras ----
  {
    id: 'hik-2cd2143g2', vendor: 'Hikvision', model: 'DS-2CD2143G2-IU',
    kind: 'camera',
    description: '4MP AcuSense dome, IP67, PoE, IR30m',
    portGroups: [{ idPattern: 'poe', count: 1, type: 'RJ45', speed: '100M', poe: true, poeActiveByDefault: true }],
    tags: ['hikvision', '4mp', 'outdoor', 'poe'],
  },
  {
    id: 'hik-2cd2143g0', vendor: 'Hikvision', model: 'DS-2CD2143G0-I',
    kind: 'camera',
    description: '4MP indoor dome, PoE, IR30m',
    portGroups: [{ idPattern: 'poe', count: 1, type: 'RJ45', speed: '100M', poe: true, poeActiveByDefault: true }],
    tags: ['hikvision', '4mp', 'indoor', 'poe'],
  },
  {
    id: 'dahua-hdbw1230', vendor: 'Dahua', model: 'IPC-HDBW1230E',
    kind: 'camera',
    description: '2MP outdoor dome IR PoE',
    portGroups: [{ idPattern: 'poe', count: 1, type: 'RJ45', speed: '100M', poe: true, poeActiveByDefault: true }],
    tags: ['dahua', '2mp', 'outdoor', 'poe'],
  },

  // ---- Patch panels ----
  {
    id: 'legrand-lcs3-24', vendor: 'Legrand', model: 'LCS³ 24-port RJ45 cat.6',
    kind: 'patchpanel',
    description: 'Кат.6 неэкранированная, 1U 19" — 24 порта',
    defaultDisplay: 'rack',
    portGroups: [{ idPattern: 'port{n}', count: 24, type: 'RJ45' }],
    tags: ['legrand', 'cat6', '24p'],
  },
  {
    id: 'legrand-lcs3-48', vendor: 'Legrand', model: 'LCS³ 48-port RJ45 cat.6',
    kind: 'patchpanel',
    description: 'Кат.6, 2U 19" — 48 портов',
    defaultDisplay: 'rack',
    portGroups: [{ idPattern: 'port{n}', count: 48, type: 'RJ45' }],
    tags: ['legrand', 'cat6', '48p'],
  },
  {
    id: 'hyperline-pp3-24', vendor: 'Hyperline', model: 'PP3-19-24-8P8C-C6-SH',
    kind: 'patchpanel',
    description: 'Кат.6 экранированная, 1U — 24 порта',
    defaultDisplay: 'rack',
    portGroups: [{ idPattern: 'port{n}', count: 24, type: 'RJ45' }],
    tags: ['hyperline', 'cat6', 'shielded', '24p'],
  },
  {
    id: 'cabeus-pp-24-cat6', vendor: 'Cabeus', model: 'PP-24-cat.6',
    kind: 'patchpanel',
    description: 'Кат.6, 1U — 24 порта, эконом',
    defaultDisplay: 'rack',
    portGroups: [{ idPattern: 'port{n}', count: 24, type: 'RJ45' }],
    tags: ['cabeus', 'cat6', '24p'],
  },

  // ---- Servers / POS / Printers ----
  {
    id: 'sm-1u-xeon', vendor: 'Supermicro', model: '1U Xeon Silver',
    kind: 'server',
    description: 'Типовой 1U-хост, 2×NIC + IPMI',
    portGroups: [
      { idPattern: 'nic{n}', count: 2, type: 'RJ45', speed: '1G' },
      { idPattern: 'ipmi',   count: 1, type: 'RJ45', speed: '100M' },
    ],
    tags: ['supermicro', '1u', 'hyperv'],
    hostSpec: {
      cpu: 'Xeon Silver 4210', ramGb: 64, os: 'Linux', formFactor: '1U',
      disks: [{ sizeGB: 480, kind: 'SSD', role: 'system' }],
    },
  },

  // ---- Video recorders (DVR / NVR) ----
  {
    id: 'nvr-8ch',   vendor: 'Hikvision', model: 'NVR 8ch',
    kind: 'server',
    description: 'Видеорегистратор на 8 IP-камер, 1×HDD',
    portGroups: [{ idPattern: 'lan', count: 1, type: 'RJ45', speed: '1G' }],
    tags: ['dvr', 'nvr', 'cctv', '8ch'],
    dvr: {
      channels: 8, activeChannels: 0, resolution: '1080p', retentionDays: 14,
      software: 'Hikvision iVMS',
      disks: [{ sizeGB: 2048, kind: 'HDD', model: 'WD Purple' }],
    },
  },
  {
    id: 'nvr-16ch',  vendor: 'Trassir', model: 'NVR 16ch',
    kind: 'server',
    description: 'Видеорегистратор на 16 камер, 2×HDD (RAID)',
    portGroups: [{ idPattern: 'lan', count: 1, type: 'RJ45', speed: '1G' }],
    tags: ['dvr', 'nvr', 'cctv', '16ch', 'trassir'],
    dvr: {
      channels: 16, activeChannels: 0, resolution: '1080p', retentionDays: 30,
      software: 'TRASSIR',
      disks: [
        { sizeGB: 4096, kind: 'HDD', model: 'Seagate SkyHawk' },
        { sizeGB: 4096, kind: 'HDD', model: 'Seagate SkyHawk' },
      ],
    },
  },
  {
    id: 'nvr-32ch',  vendor: 'Dahua', model: 'NVR 32ch 4K',
    kind: 'server',
    description: 'Видеорегистратор на 32 камеры 4K, 4×HDD',
    portGroups: [
      { idPattern: 'lan',   count: 1, type: 'RJ45', speed: '1G' },
      { idPattern: 'wan',   count: 1, type: 'RJ45', speed: '1G' },
    ],
    tags: ['dvr', 'nvr', 'cctv', '32ch', '4k', 'dahua'],
    dvr: {
      channels: 32, activeChannels: 0, resolution: '4K', retentionDays: 30,
      software: 'Dahua DSS',
      disks: [
        { sizeGB: 8192, kind: 'HDD', model: 'WD Purple Pro' },
        { sizeGB: 8192, kind: 'HDD', model: 'WD Purple Pro' },
        { sizeGB: 8192, kind: 'HDD', model: 'WD Purple Pro' },
        { sizeGB: 8192, kind: 'HDD', model: 'WD Purple Pro' },
      ],
    },
  },
  {
    id: 'epson-t88vi', vendor: 'Epson', model: 'TM-T88VI',
    kind: 'printer',
    description: 'Термопринтер чеков, LAN + USB',
    portGroups: [{ idPattern: 'lan', count: 1, type: 'RJ45', speed: '100M' }],
    tags: ['pos', 'thermal', 'receipt'],
  },
  {
    id: 'atol-sigma', vendor: 'Атол', model: 'Sigma',
    kind: 'pos',
    description: 'Кассовый терминал',
    portGroups: [{ idPattern: 'lan', count: 1, type: 'RJ45', speed: '1G' }],
    tags: ['pos', 'касса'],
  },
];

// -----------------------------------------------------------------------------
// User-defined templates: persisted in localStorage
// -----------------------------------------------------------------------------

const LS_TEMPLATES = 'netmap:templates:v1';
const w = typeof window !== 'undefined' ? (window as any) : {};
const hasNative = !!(w.netmap && w.netmap.saveTemplates);

export function loadCustomTemplates(): DeviceTemplate[] {
  try {
    const raw = localStorage.getItem(LS_TEMPLATES);
    if (raw) return JSON.parse(raw) as DeviceTemplate[];
  } catch {}
  return [];
}

/** Async hydrate — if native backend has newer data, replace localStorage cache with it. */
export async function hydrateTemplatesFromBackend(): Promise<DeviceTemplate[]> {
  if (!hasNative) return loadCustomTemplates();
  try {
    const list = (await w.netmap.loadTemplates()) as DeviceTemplate[] | null;
    if (list && list.length >= 0) {
      localStorage.setItem(LS_TEMPLATES, JSON.stringify(list));
      return list;
    }
  } catch {}
  return loadCustomTemplates();
}

export function saveCustomTemplates(list: DeviceTemplate[]) {
  try { localStorage.setItem(LS_TEMPLATES, JSON.stringify(list)); } catch {}
  if (hasNative) w.netmap.saveTemplates(list).catch(() => {});
}

/** Turn an existing device into a reusable template. */
export function templateFromDevice(dev: Device, name?: { vendor?: string; model?: string }): DeviceTemplate {
  const vendor = name?.vendor || dev.vendor || 'Custom';
  const model  = name?.model  || dev.model  || dev.name;

  // Group consecutive ports with the same properties into pattern groups
  const groups: TemplatePortGroup[] = [];
  let current: TemplatePortGroup | null = null;
  const numericId = (id: string) => id.match(/^(.+?)(\d+)$/);

  for (const p of dev.ports) {
    const m = numericId(p.id);
    const prefix = m ? m[1] : p.id;
    const num    = m ? Number(m[2]) : null;

    const sig = JSON.stringify({
      prefix,
      type: p.type,
      speed: p.speed,
      poe: !!p.poe,
      poeActive: !!p.poeActive,
      uplink: !!p.uplink,
      hasNum: num !== null,
    });

    if (current && (current as any)._sig === sig && num !== null) {
      current.count = (current.count || 1) + 1;
    } else {
      current = {
        idPattern: num !== null ? `${prefix}{n}` : p.id,
        count: 1,
        type: (p.type || 'RJ45') as PortType,
        speed: p.speed as any,
        poe: p.poe,
        poeActiveByDefault: p.poeActive,
        uplink: p.uplink,
      };
      (current as any)._sig = sig;
      groups.push(current);
    }
  }
  // strip helper signatures
  for (const g of groups) delete (g as any)._sig;

  return {
    id: `custom-${Math.random().toString(36).slice(2, 8)}`,
    vendor, model,
    kind: dev.kind,
    description: dev.model ? `Пользовательский шаблон на основе ${dev.name}` : undefined,
    defaultDisplay: dev.display,
    portGroups: groups,
    tags: dev.tags,
    isCustom: true,
  };
}
