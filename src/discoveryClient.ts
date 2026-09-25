/**
 * v0.44.0 — Renderer-side facade for the auto-discovery backend.
 * All heavy lifting (SSH/SNMP) happens in electron/discovery.cjs.
 *
 * When running in the browser preview (no window.netmap), calls return a
 * deterministic mock so the UI can still be exercised.
 */

export type DiscoveryMode = 'mikrotik' | 'snmp' | 'both';

export interface DiscoveryConfig {
  mode: DiscoveryMode;
  host: string;
  port?: number;
  username?: string;
  password?: string;
  snmpCommunity?: string;
  snmpPort?: number;
  snmpTimeout?: number;
  sshTimeout?: number;
  snmpSweep?: boolean;
  snmpSeeds?: string[];
  // v0.51.20: рекурсивный обход LLDP-соседей (волнами по management-IP)
  snmpRecursive?: boolean;
  snmpMaxHops?: number;
}

// v0.52.0: откуда бэкенд взял имя. Приоритет: dhcp (комментарий лизы) >
// sysname (LLDP sysName / MikroTik identity) > hostname (host-name из DHCP) >
// ip > mac. Последние два именем не считаются («без имени»).
export type DiscoveryNameSource = 'dhcp' | 'sysname' | 'hostname' | 'ip' | 'mac';

export interface DiscoveryDeviceProposal {
  tempId: string;
  ip?: string;
  mac?: string;
  name: string;
  nameSource?: DiscoveryNameSource;
  vendor?: string;
  kind: string;
  /** v0.53.0: тип определён уверенно (по имени/OUI/descr/VLAN). Иначе —
      устройство уходит в группу «Тип не определён», тип выбирает пользователь. */
  kindConfident?: boolean;
  hint?: string;
  vlan?: number;
  dhcpComment?: string;
  dhcpHost?: string;
}
export interface DiscoveryDeviceRef {
  existingId?: string;
  tempId?: string;
}
export interface DiscoveryLinkProposal {
  tempId: string;
  fromRef: DiscoveryDeviceRef;
  fromPort?: string;
  toRef: DiscoveryDeviceRef;
  toPort?: string;
  cable?: 'copper' | 'fiber' | 'wifi';
  evidence?: string;
}
export interface DiscoveryScanResult {
  ok: boolean;
  error?: string;
  rootHost?: string;
  source?: DiscoveryMode;
  seeds?: Array<{ host: string; name?: string; vendor?: string; descr?: string; ok?: boolean }>;
  proposedDevices: DiscoveryDeviceProposal[];
  proposedLinks: DiscoveryLinkProposal[];
  // v0.52.0: справочники для фильтров (подсети из /ip/address, VLAN с именами)
  subnets?: Array<{ cidr: string; interface?: string; comment?: string }>;
  vlans?: Array<{ id: number; name?: string }>;
  warnings?: string[];
  stats?: {
    ms?: number;
    neighborsFound?: number;
    fdbEntries?: number;
    arpEntries?: number;
    leases?: number;
    snmpHosts?: number;
    snmpProbed?: number;   // v0.54.0: всего попыток SNMP-опроса (snmpHosts — только ответившие)
    lldpEntries?: number;
  };
}
export interface DiscoveryTestResult {
  ok: boolean;
  mikrotik?: { ok: boolean; identity?: string; error?: string } | null;
  snmp?: { ok: boolean; sysName?: string; sysDescr?: string; sysUpTime?: number; error?: string } | null;
}

function hasBackend() {
  return typeof window !== 'undefined' && !!(window as any).netmap && typeof (window as any).netmap.discoveryScan === 'function';
}

export async function discoveryTest(cfg: DiscoveryConfig): Promise<DiscoveryTestResult> {
  if (!hasBackend()) {
    // Browser-preview mock
    return {
      ok: true,
      mikrotik: cfg.mode !== 'snmp' ? { ok: true, identity: 'mock-router' } : null,
      snmp: cfg.mode !== 'mikrotik' ? { ok: true, sysName: 'mock-switch', sysDescr: 'MockOS 1.0', sysUpTime: 12345 } : null,
    };
  }
  return (window as any).netmap.discoveryTest(cfg);
}

export async function discoveryScan(cfg: DiscoveryConfig & { doc?: any }): Promise<DiscoveryScanResult> {
  if (!hasBackend()) {
    // Browser-preview mock — a couple of proposals so the dialog is testable.
    return {
      ok: true,
      rootHost: cfg.host || '192.168.1.1',
      source: cfg.mode,
      seeds: [{ host: cfg.host || '192.168.1.1', name: 'mock-router', vendor: 'MikroTik', ok: true }],
      proposedDevices: [
        { tempId: 'new_ap1', ip: '192.168.1.10', mac: 'AA:BB:CC:00:00:10', name: 'AP-Lobby (mock)', nameSource: 'sysname', vendor: 'Ubiquiti', kind: 'ap', kindConfident: true, hint: 'via LLDP', vlan: 20, dhcpComment: 'Точка холл (mock)' },
        { tempId: 'new_sw2', ip: '192.168.1.20', mac: 'AA:BB:CC:00:00:20', name: 'Access-Switch (mock)', nameSource: 'dhcp', dhcpComment: 'Access-Switch (mock)', vendor: 'MikroTik', kind: 'switch', kindConfident: true, hint: 'via /ip neighbor', vlan: 10 },
        { tempId: 'new_pc1', ip: '192.168.2.33', mac: 'AA:BB:CC:00:00:33', name: '192.168.2.33', nameSource: 'ip', kind: 'pc', kindConfident: false, hint: 'bridge FDB', dhcpHost: 'DESKTOP-MOCK' },
        { tempId: 'new_cam1', mac: 'AA:BB:CC:00:00:99', name: 'AA:BB:CC:00:00:99', nameSource: 'mac', kind: 'camera', kindConfident: true, hint: 'bridge FDB' },
      ],
      proposedLinks: [
        { tempId: 'lnk_1', fromRef: { tempId: 'new_ap1' }, toRef: { tempId: 'new_sw2' }, fromPort: 'eth0', toPort: 'ether3', cable: 'copper', evidence: 'LLDP mock' },
        { tempId: 'lnk_2', fromRef: { tempId: 'new_sw2' }, toRef: { tempId: 'new_cam1' }, fromPort: 'ether5', cable: 'copper', evidence: 'FDB mock' },
      ],
      subnets: [
        { cidr: '192.168.1.0/24', interface: 'v_Office', comment: 'office (mock)' },
        { cidr: '192.168.2.0/24', interface: 'v_Guest', comment: '' },
      ],
      vlans: [
        { id: 10, name: 'Office (mock)' },
        { id: 20, name: 'WiFi (mock)' },
      ],
      warnings: ['Browser preview mode — данные тестовые. В .exe будет реальный опрос.'],
      stats: { ms: 42, neighborsFound: 2, fdbEntries: 1, arpEntries: 5, leases: 2, snmpHosts: 1, lldpEntries: 1 },
    };
  }
  return (window as any).netmap.discoveryScan(cfg);
}
