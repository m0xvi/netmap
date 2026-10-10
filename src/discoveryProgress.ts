// v0.77.0: состояние экрана опроса по реальным событиям бэкенда (вместо таймерной анимации).
// Чистая логика без React: редьюсер и сводка, тестируется отдельно.

export type DiscoveryProgressEvent =
  | { phase: 'mikrotik'; state: 'start' | 'done' }
  | { phase: 'wave'; hop: number; queued: number }
  | { phase: 'host'; host: string; state: 'start' | 'done'; ok?: boolean }
  | { phase: 'walk'; host: string; step: string; done: number; total: number }
  | { phase: 'dns'; state: 'start' | 'done' };

export type HostStatus = 'queued' | 'running' | 'ok' | 'fail';

export interface HostProgress {
  host: string;
  status: HostStatus;
  hop: number;
  walkDone: number;
  walkTotal: number;
  step: string;
}

export interface ScanProgressState {
  mikrotik: 'idle' | 'running' | 'done';
  dns: 'idle' | 'running' | 'done';
  hosts: Record<string, HostProgress>;
  order: string[];
  wave: { hop: number; queued: number } | null;
  lastStep: string;
}

export const WALK_LABELS: Record<string, string> = {
  ifTable: 'IF-MIB: интерфейсы',
  ifName: 'IF-MIB: имена портов',
  lldpChassis: 'LLDP-MIB: соседи',
  lldpPortId: 'LLDP-MIB: порты соседей',
  lldpPortDsc: 'LLDP-MIB: описания портов',
  lldpSysName: 'LLDP-MIB: имена соседей',
  lldpSysDsc: 'LLDP-MIB: описания соседей',
  lldpLocDsc: 'LLDP-MIB: локальные порты',
  lldpManAddr: 'LLDP-MIB: адреса соседей',
  arp: 'IP-MIB: ARP',
  vlanStatic: 'Q-BRIDGE: VLAN',
  vlanCur: 'Q-BRIDGE: текущие VLAN',
  pvid: 'Q-BRIDGE: PVID портов',
  basePort: 'BRIDGE-MIB: порты',
  qPort: 'Q-BRIDGE: таблица MAC',
};

export function initialProgress(): ScanProgressState {
  return { mikrotik: 'idle', dns: 'idle', hosts: {}, order: [], wave: null, lastStep: '' };
}

function ensureHost(s: ScanProgressState, host: string): ScanProgressState {
  if (s.hosts[host]) return s;
  return {
    ...s,
    order: [...s.order, host],
    hosts: { ...s.hosts, [host]: { host, status: 'queued', hop: s.wave ? s.wave.hop : 0, walkDone: 0, walkTotal: 0, step: '' } },
  };
}

/** Чистый редьюсер: возвращает новое состояние, исходное не меняет. */
export function reduceProgress(s: ScanProgressState, e: DiscoveryProgressEvent): ScanProgressState {
  switch (e.phase) {
    case 'mikrotik':
      return { ...s, mikrotik: e.state === 'start' ? 'running' : 'done' };
    case 'dns':
      return { ...s, dns: e.state === 'start' ? 'running' : 'done' };
    case 'wave':
      return { ...s, wave: { hop: e.hop, queued: e.queued } };
    case 'host': {
      const s1 = ensureHost(s, e.host);
      const cur = s1.hosts[e.host];
      const next: HostProgress = e.state === 'start'
        ? { ...cur, status: 'running' }
        : { ...cur, status: e.ok ? 'ok' : 'fail', walkDone: cur.walkTotal || cur.walkDone };
      return { ...s1, hosts: { ...s1.hosts, [e.host]: next } };
    }
    case 'walk': {
      const s1 = ensureHost(s, e.host);
      const cur = s1.hosts[e.host];
      const label = WALK_LABELS[e.step] || e.step;
      return {
        ...s1,
        lastStep: `${e.host}: ${label}`,
        hosts: {
          ...s1.hosts,
          [e.host]: { ...cur, status: cur.status === 'queued' ? 'running' : cur.status, walkDone: e.done, walkTotal: e.total, step: label },
        },
      };
    }
    default:
      return s;
  }
}

export interface ProgressSummary {
  hostsTotal: number;
  hostsDone: number;
  hostsFailed: number;
  hostsRunning: number;
  /** 0..100; null — пока не известно, сколько хостов будет (индикатор «бегущий»). */
  percent: number | null;
}

export function summarizeProgress(s: ScanProgressState): ProgressSummary {
  const list = s.order.map(h => s.hosts[h]).filter(Boolean);
  const hostsTotal = list.length;
  const hostsDone = list.filter(h => h.status === 'ok' || h.status === 'fail').length;
  const hostsFailed = list.filter(h => h.status === 'fail').length;
  const hostsRunning = list.filter(h => h.status === 'running').length;
  if (hostsTotal === 0) return { hostsTotal, hostsDone, hostsFailed, hostsRunning, percent: null };
  let units = 0;
  for (const h of list) {
    if (h.status === 'ok' || h.status === 'fail') units += 1;
    else if (h.status === 'running' && h.walkTotal > 0) units += Math.min(1, h.walkDone / h.walkTotal);
  }
  return { hostsTotal, hostsDone, hostsFailed, hostsRunning, percent: Math.round((units / hostsTotal) * 100) };
}
