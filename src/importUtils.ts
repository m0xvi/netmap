/**
 * v0.37 — Extracted helper for building Rows + committing a per-subnet import
 * from any ScanResult. Used by the new unified ImportDialog (UniFi / Omada /
 * future vendors). The legacy MikrotikImportDialog still has its own inline
 * copy for backwards compatibility.
 */

import {
  guessVendorAndKind, summarizeSubnets, ipInAnyCidr,
  type ScanResult, type SubnetStat,
} from './mikrotikClient';
import type { Device, DeviceKind, Group, NetMapDoc, Port } from './types';
import { useStore } from './store';

export interface ImportRow {
  mac: string;
  ip: string | null;
  hostname: string;
  source: 'dhcp' | 'arp' | 'both' | 'device';
  status: string;
  vendor?: string;
  suggestedKind: DeviceKind;
  existingId?: string;
  comment?: string;
}

/**
 * v0.38 — per-row action on import.
 * Default is 'skip' for rows that already exist on the map — the user must
 * explicitly opt into overwriting. This kills the "silent auto-update"
 * behaviour that was in v0.37 and earlier.
 *
 *   skip     — do nothing to this row
 *   update   — merge fresh data from scan into existing device, but only
 *              overwrite fields that are empty or clearly auto-generated
 *              (mac-derived names, missing vendor, missing IP…)
 *   replace  — overwrite name / ip / vendor / comment / port status
 *              unconditionally with the scan values
 *   add      — create a new device (only valid when existingId is empty)
 */
export type ImportAction = 'add' | 'skip' | 'update' | 'replace';

/** Returns the default action for a row: 'add' when new, 'skip' when it
 *  collides with an already-mapped device. Renderer stores per-row overrides
 *  in a Map<mac, ImportAction>. */
export function defaultAction(row: ImportRow): ImportAction {
  return row.existingId ? 'skip' : 'add';
}

/** Build a de-duped list of import candidates from a ScanResult. */
export function buildRows(scan: ScanResult | null, doc: NetMapDoc): ImportRow[] {
  if (!scan) return [];
  const byMac = new Map<string, ImportRow>();
  const existingByMac = new Map<string, string>();
  for (const d of doc.devices) if (d.mac) existingByMac.set(d.mac.toUpperCase(), d.id);

  const put = (mac: string, patch: Partial<ImportRow>, src: ImportRow['source']) => {
    if (!mac) return;
    const key = mac.toUpperCase();
    const existing = byMac.get(key);
    if (existing) {
      const merged: ImportRow = { ...existing, ...patch };
      // Preserve the "widest" source label.
      if (src === 'device' || existing.source === 'device') merged.source = 'device';
      else if (existing.source !== src) merged.source = 'both';
      byMac.set(key, merged);
    } else {
      const guess = guessVendorAndKind(mac, patch.hostname || '');
      byMac.set(key, {
        mac: key,
        ip: patch.ip ?? null,
        hostname: patch.hostname || '',
        source: src,
        status: patch.status || '',
        vendor: patch.vendor || guess.vendor,
        suggestedKind: (patch.suggestedKind as DeviceKind) || guess.kind,
        existingId: existingByMac.get(key),
        comment: patch.comment,
      });
    }
  };

  // 1) Infrastructure devices (interfaces list on UniFi/Omada) get priority so
  //    their type is preserved (ap/switch/router) instead of being guessed by MAC OUI.
  for (const iface of scan.interfaces || []) {
    if (!iface.mac || iface.mac === '00:00:00:00:00:00') continue;
    let kind: DeviceKind | undefined;
    const t = String(iface.type || '').toLowerCase();
    if (t === 'ap') kind = 'ap';
    else if (t === 'switch') kind = 'switch';
    else if (t === 'router') kind = 'router';
    put(iface.mac, {
      hostname: iface.name || '',
      status: iface.running ? 'reachable' : 'down',
      suggestedKind: kind,
      comment: iface.comment,
    }, 'device');
  }

  // 2) DHCP leases
  for (const l of scan.leases || []) {
    put(l.mac, {
      ip: l.ip,
      hostname: l.hostname || l.comment,
      status: l.status,
      comment: l.comment,
    }, 'dhcp');
  }

  // 3) ARP entries
  for (const a of scan.arp || []) {
    if (!a.mac || a.mac === '00:00:00:00:00:00') continue;
    put(a.mac, {
      ip: a.ip,
      status: a.complete ? 'reachable' : 'incomplete',
    }, 'arp');
  }

  return Array.from(byMac.values()).sort((a, b) => {
    if (!!a.existingId !== !!b.existingId) return a.existingId ? 1 : -1;
    if ((a.source === 'device') !== (b.source === 'device')) return a.source === 'device' ? -1 : 1;
    return (a.ip || '').localeCompare(b.ip || '', undefined, { numeric: true });
  });
}

/** Filter rows against the active subnet list and free-text query. */
export function filterRows(
  rows: ImportRow[],
  { query, activeCidrs, showExisting, showIncomplete }:
    { query: string; activeCidrs: string[]; showExisting: boolean; showIncomplete: boolean }
): ImportRow[] {
  return rows.filter(r => {
    if (!showExisting && r.existingId) return false;
    if (!showIncomplete && (r.status === 'incomplete' || !r.ip)) return false;
    if (activeCidrs.length > 0 && r.ip && !ipInAnyCidr(r.ip, activeCidrs)) return false;
    if (!query.trim()) return true;
    const s = query.trim().toLowerCase();
    return r.mac.toLowerCase().includes(s)
        || (r.ip || '').toLowerCase().includes(s)
        || r.hostname.toLowerCase().includes(s)
        || (r.vendor || '').toLowerCase().includes(s);
  });
}

/** Perform the per-subnet import — creates/reuses groups keyed by CIDR (via
 *  group.subtitle marker) and adds/patches devices. Returns a summary. */
export interface CommitResult {
  placed: number;
  updated: number;
  replaced: number;
  skipped: number;
  groupCount: number;
}

/**
 * v0.38 — commitImport respects per-row `actions` map:
 *   - action='add'      → new device (row.existingId must be empty)
 *   - action='update'   → patch missing/auto-name fields on existing device
 *   - action='replace'  → overwrite name/ip/vendor/comment unconditionally
 *   - action='skip'     → do nothing (default for existing rows)
 *   - not in map        → falls back to defaultAction(row)
 */
export function commitImport(
  scan: ScanResult,
  rowsToImport: ImportRow[],
  sourceTag: string,          // e.g. "unifi" — used as a tag on imported devices
  actions?: Map<string, ImportAction>,
): CommitResult {
  const store = useStore.getState();
  const doc = store.doc;
  const addDevice = store.addDevice;
  const addGroup = store.addGroup;
  const updateDevice = store.updateDevice;

  const subnetStats: SubnetStat[] = summarizeSubnets(scan);

  const cidrOf = (ip: string | null | undefined): string | null => {
    if (!ip) return null;
    for (const s of subnetStats) if (ipInAnyCidr(ip, [s.cidr])) return s.cidr;
    return null;
  };

  const paletteColors = [
    '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444',
    '#14B8A6', '#EC4899', '#6366F1', '#F97316', '#0EA5E9',
  ];
  const colorFor = (cidr: string) => {
    let h = 0;
    for (let i = 0; i < cidr.length; i++) h = (h * 31 + cidr.charCodeAt(i)) >>> 0;
    return paletteColors[h % paletteColors.length];
  };

  const existingGroups: Group[] = doc.groups || [];
  const findOrCreateGroup = (cidr: string | null): string => {
    const label = cidr || 'Без IP';
    const stat = cidr ? subnetStats.find(s => s.cidr === cidr) : null;
    const humanName = cidr
      ? (stat?.comment && stat.comment.length < 30 ? stat.comment
         : stat?.interfaces && stat.interfaces[0] ? `${stat.interfaces[0]} · ${cidr}`
         : `Подсеть ${cidr}`)
      : 'Без IP';
    const existing = existingGroups.find(g => g.subtitle === label);
    if (existing) return existing.id;
    const gid = 'g-net-' + (cidr ? cidr.replace(/[^\w]/g, '-') : 'noip') + '-' + Math.random().toString(36).slice(2, 5);
    addGroup({
      id: gid, name: humanName, parentId: null,
      x: 40 + Math.random() * 200, y: 40 + Math.random() * 100,
      width: 560, height: 260,
      color: cidr ? colorFor(cidr) : '#94A3B8',
      subtitle: label,
    });
    return gid;
  };

  // v0.43.5: honour orphanGridCols preference. Auto = ~sqrt(items/groupCount).
  const orphanCols = (useStore.getState() as any).orphanGridCols || 0;
  const groupCount = Math.max(1, subnetStats.filter(s => s.deviceCount > 0).length || 1);
  const estPerGroup = Math.max(4, Math.ceil(rowsToImport.length / groupCount));
  const autoCols = Math.max(4, Math.min(20, Math.ceil(Math.sqrt(estPerGroup))));
  const gridCols = orphanCols > 0 ? orphanCols : autoCols;
  const cursors = new Map<string, { placed: number }>();
  const nextPos = (groupId: string) => {
    let cur = cursors.get(groupId);
    if (!cur) { cur = { placed: 0 }; cursors.set(groupId, cur); }
    const col = cur.placed % gridCols;
    const rowIdx = Math.floor(cur.placed / gridCols);
    cur.placed++;
    return { x: 20 + col * 170, y: 50 + rowIdx * 100 };
  };

  let placed = 0;
  let updated = 0;
  let replaced = 0;
  let skipped = 0;
  for (const row of rowsToImport) {
    const action: ImportAction = actions?.get(row.mac) ?? defaultAction(row);
    if (action === 'skip') { skipped++; continue; }

    if (row.existingId && (action === 'update' || action === 'replace')) {
      const existing = doc.devices.find(d => d.id === row.existingId);
      const patch: Partial<Device> = {};

      if (action === 'replace') {
        // Overwrite unconditionally with scan values (still preserving
        // manual-only fields like x/y/groupId/ports/credential).
        if (row.ip) patch.ip = row.ip;
        if (row.hostname) patch.name = row.hostname;
        if (row.vendor) patch.vendor = row.vendor;
      } else {
        // 'update' = merge only into empty / auto-generated fields.
        if (row.ip && row.ip !== existing?.ip && !existing?.ip) patch.ip = row.ip;
        if (row.hostname) {
          const cur = existing?.name || '';
          const isAutoName = /^Device [0-9A-F:]+$/i.test(cur) || cur === row.mac.slice(-8) || cur === '';
          if (isAutoName || cur === row.hostname) patch.name = row.hostname;
        }
        if (row.vendor && !existing?.vendor) patch.vendor = row.vendor;
      }

      if (row.comment) {
        const existingNotes = existing?.credential?.notes || '';
        const marker = `[${sourceTag}: ${row.comment}]`;
        if (!existingNotes.includes(marker)) {
          patch.credential = {
            ...(existing?.credential || {}),
            notes: existingNotes ? `${existingNotes}\n${marker}` : marker,
          };
        }
      }
      const tags = new Set(existing?.tags || []);
      tags.add(`${sourceTag}-synced`);
      patch.tags = Array.from(tags);
      if (Object.keys(patch).length > 0) {
        updateDevice(row.existingId, patch);
        if (action === 'replace') replaced++;
        else updated++;
      } else {
        skipped++;
      }
      continue;
    }

    if (action !== 'add') { skipped++; continue; }

    const name = row.hostname || row.vendor || `Device ${row.mac.slice(-8)}`;
    const id = `${row.suggestedKind}-${Math.random().toString(36).slice(2, 7)}`;
    const cidr = cidrOf(row.ip);
    const gid = findOrCreateGroup(cidr);
    const pos = nextPos(gid);
    const ports: Port[] = [{
      id: 'lan', label: '', type: 'RJ45',
      speed: '1G', status: row.ip ? 'up' : 'down',
    }];
    const cidrTag = cidr ? `net:${cidr}` : 'net:none';
    const d: Device = {
      id, name, kind: row.suggestedKind,
      vendor: row.vendor, ip: row.ip || undefined, mac: row.mac,
      display: 'compact', groupId: gid,
      x: pos.x, y: pos.y,
      ports, tags: ['imported', sourceTag, cidrTag],
    };
    addDevice(d);
    placed++;
  }

  if (placed > 0) {
    // v0.45: use smart layout (hybrid grouping by location/VLAN/subnet) after
    // import — otherwise 40+ imported devices land in a single flat line and
    // are unusable. Falls back gracefully to flat if no groupable data.
    setTimeout(() => {
      try { useStore.getState().autoLayout('TB', { groupBy: 'hybrid' }); } catch { /* ignore */ }
    }, 100);
  }

  return { placed, updated, replaced, skipped, groupCount: cursors.size };
}
