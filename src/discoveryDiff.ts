// v0.77.0: сравнение результата автообнаружения с прошлым сканом того же корня.
// Снимок хранится в localStorage (только то, что нужно для сравнения: без секретов).

import type { DiscoveryScanResult } from './discoveryClient';

export interface SnapDevice {
  key: string;
  name: string;
  ip?: string;
  mac?: string;
  kind: string;
  vlan?: number;
}

export interface SnapLink {
  key: string;
  from: string;
  to: string;
  fromPort?: string;
  toPort?: string;
}

export interface Snapshot {
  at: number;
  rootHost: string;
  cancelled: boolean;
  devices: SnapDevice[];
  links: SnapLink[];
}

export interface ScanDiff {
  added: SnapDevice[];
  removed: SnapDevice[];
  changed: Array<{ before: SnapDevice; after: SnapDevice; fields: string[] }>;
  linksAdded: SnapLink[];
  linksRemoved: SnapLink[];
  /** true — пропавшие устройства не считались (текущий опрос отменён, данные неполные). */
  removedIgnored: boolean;
}

export const SNAPSHOT_KEY = 'netmap.discovery.snapshots.v1';
const MAX_ROOTS = 5;
const MAX_DEVICES = 2000;

/** Ключ устройства: MAC — устойчивее IP (IP может смениться по DHCP). */
export function deviceKey(d: { mac?: string; ip?: string; tempId?: string }): string {
  return (d.mac || '').toUpperCase() || d.ip || d.tempId || '';
}

export function makeSnapshot(scan: DiscoveryScanResult, rootHost: string, at: number = Date.now()): Snapshot {
  const devices = (scan.proposedDevices || []).slice(0, MAX_DEVICES);
  const keyOf = new Map<string, string>();
  const snapDevices: SnapDevice[] = devices.map(d => {
    const key = deviceKey(d);
    keyOf.set(d.tempId, key);
    const sd: SnapDevice = { key, name: d.name || '', kind: d.kind || '' };
    if (d.ip) sd.ip = d.ip;
    if (d.mac) sd.mac = d.mac.toUpperCase();
    if (d.vlan != null) sd.vlan = d.vlan;
    return sd;
  });
  const endpoint = (ref: { tempId?: string; existingId?: string } | undefined): string =>
    (ref?.tempId && keyOf.get(ref.tempId)) || (ref?.existingId ? 'id:' + ref.existingId : '?');
  const links: SnapLink[] = (scan.proposedLinks || []).slice(0, MAX_DEVICES).map(l => {
    const from = endpoint(l.fromRef);
    const to = endpoint(l.toRef);
    const fromPort = l.fromPort || '';
    const toPort = l.toPort || '';
    return { key: `${from}|${fromPort}>${to}|${toPort}`, from, to, fromPort, toPort };
  });
  return { at, rootHost, cancelled: !!scan.cancelled, devices: snapDevices, links };
}

const FIELDS: Array<keyof SnapDevice> = ['name', 'ip', 'kind', 'vlan'];

export function diffSnapshots(prev: Snapshot, next: Snapshot): ScanDiff {
  const prevBy = new Map(prev.devices.map(d => [d.key, d]));
  const nextBy = new Map(next.devices.map(d => [d.key, d]));
  const added: SnapDevice[] = [];
  const changed: ScanDiff['changed'] = [];
  for (const d of next.devices) {
    const old = prevBy.get(d.key);
    if (!old) { added.push(d); continue; }
    const fields = FIELDS.filter(f => (old[f] ?? '') !== (d[f] ?? ''));
    if (fields.length) changed.push({ before: old, after: d, fields: fields.map(String) });
  }
  const removedIgnored = next.cancelled;
  const removed = removedIgnored ? [] : prev.devices.filter(d => !nextBy.has(d.key));
  const prevLinks = new Set(prev.links.map(l => l.key));
  const nextLinks = new Set(next.links.map(l => l.key));
  const linksAdded = next.links.filter(l => !prevLinks.has(l.key));
  const linksRemoved = removedIgnored ? [] : prev.links.filter(l => !nextLinks.has(l.key));
  return { added, removed, changed, linksAdded, linksRemoved, removedIgnored };
}

// ---------- хранение ------------------------------------------------------

type SnapMap = Record<string, Snapshot>;

function readMap(): SnapMap {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SNAPSHOT_KEY) : null;
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === 'object' ? o as SnapMap : {};
  } catch {
    return {};
  }
}

export function loadSnapshot(rootHost: string): Snapshot | null {
  const s = readMap()[rootHost];
  return s && Array.isArray(s.devices) && Array.isArray(s.links) ? s : null;
}

export function saveSnapshot(snap: Snapshot): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const map = readMap();
    map[snap.rootHost] = snap;
    // храним только последние MAX_ROOTS корней
    const keep = Object.values(map).sort((a, b) => b.at - a.at).slice(0, MAX_ROOTS);
    const out: SnapMap = {};
    for (const s of keep) out[s.rootHost] = s;
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(out));
  } catch {
    // квота — сравнение просто не сохранится
  }
}
