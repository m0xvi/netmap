/**
 * v0.45.0 — Smart auto-layout with hybrid grouping.
 *
 * Regular `computeAutoLayout(doc)` (autoLayout.ts) uses dagre on the raw doc.
 * If the doc has no groups, everything ends up in a single flat line which is
 * unreadable for hotel networks (100+ devices, 5-10 logical zones).
 *
 * This module PRE-processes the doc to auto-create Groups by a hybrid key:
 *   location → vlan → /24 subnet
 *
 * Then hands the augmented doc to `computeAutoLayout` which already knows how
 * to lay out grouped scenes properly (dagre-per-group + dagre-of-groups).
 *
 * The augmented groups are marked with `id` starting `auto-` so store.ts can
 * clean them up on the next Smart Layout run (avoid stale ghost groups).
 *
 * Grouping strategies (parameter `groupBy`):
 *   - 'hybrid'    (default) — location > VLAN > /24 (as fallback)
 *   - 'location'  — only device.location
 *   - 'vlan'      — only VLAN membership (via port.vlan / port.vlans / link.vlan)
 *   - 'ip'        — only IP /24
 *   - 'none'      — no auto-grouping (identical to raw computeAutoLayout)
 */

import type { Device, Group, NetMapDoc, Vlan } from './types';

export type GroupingStrategy = 'hybrid' | 'location' | 'vlan' | 'ip' | 'none';

interface SmartLayoutOpts {
  groupBy?: GroupingStrategy;
  /** Never touch existing user-created groups; only add auto-* groups for ungrouped devices. */
  preserveUserGroups?: boolean;
}

const AUTO_GROUP_PREFIX = 'auto-';

/** Deterministic short hash for stable auto-* group ids. */
function shortHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 6);
}

/** Get "192.168.10.0/24" for an IP; empty string if IP invalid. */
function ip24(ip: string | undefined): string {
  if (!ip) return '';
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return '';
  const parts = [m[1], m[2], m[3]].map(Number);
  if (parts.some(p => p > 255)) return '';
  return `${parts.join('.')}.0/24`;
}

/**
 * Best-effort VLAN membership for a device:
 *   - primary VLAN from any port.vlan (access)
 *   - or first port.vlans entry
 *   - or first link.vlan pointing at this device
 * Returns numeric VLAN id or undefined.
 */
function primaryVlan(dev: Device, doc: NetMapDoc): number | undefined {
  for (const p of dev.ports || []) {
    if (typeof p.vlan === 'number') return p.vlan;
  }
  for (const p of dev.ports || []) {
    if (Array.isArray(p.vlans) && p.vlans.length) return p.vlans[0];
  }
  for (const l of doc.links || []) {
    if ((l.fromDeviceId === dev.id || l.toDeviceId === dev.id) && typeof l.vlan === 'number') {
      return l.vlan;
    }
  }
  return undefined;
}

function vlanLabel(vlans: Vlan[] | undefined, vlanId: number | undefined): string {
  if (vlanId == null) return '';
  const meta = (vlans || []).find(v => v.vlanId === vlanId);
  return meta ? `VLAN ${vlanId} · ${meta.name}` : `VLAN ${vlanId}`;
}

function vlanCidr(vlans: Vlan[] | undefined, vlanId: number | undefined): string | undefined {
  if (vlanId == null) return undefined;
  const meta = (vlans || []).find(v => v.vlanId === vlanId);
  return meta?.cidr;
}

/**
 * Compute the grouping key for a device under the selected strategy.
 * Returns `{ key, name, subtitle, color }` or null if the device shouldn't
 * be auto-grouped (e.g. it belongs to a user-created group already).
 */
function groupKeyFor(
  dev: Device,
  doc: NetMapDoc,
  strategy: GroupingStrategy,
): { key: string; name: string; subtitle?: string; color?: string } | null {
  // Explicit user location wins for hybrid and location strategies.
  if ((strategy === 'hybrid' || strategy === 'location') && dev.location) {
    const loc = dev.location.trim();
    if (loc) return { key: `loc:${loc.toLowerCase()}`, name: loc, color: '#dbeafe' };
  }
  if (strategy === 'location') return null; // location-only + no location = ungrouped

  const vlanId = primaryVlan(dev, doc);
  if ((strategy === 'hybrid' || strategy === 'vlan') && vlanId != null) {
    const meta = (doc.vlans || []).find(v => v.vlanId === vlanId);
    return {
      key: `vlan:${vlanId}`,
      name: meta?.name ? `${meta.name} (VLAN ${vlanId})` : `VLAN ${vlanId}`,
      subtitle: meta?.cidr,
      color: meta?.color || '#e0e7ff',
    };
  }
  if (strategy === 'vlan') return null;

  const cidr = ip24(dev.ip);
  if ((strategy === 'hybrid' || strategy === 'ip') && cidr) {
    return { key: `ip:${cidr}`, name: cidr, color: '#fef3c7' };
  }
  return null;
}

/**
 * Preprocess: for each ungrouped device, assign it to an auto-* Group.
 * Returns a NEW doc (immutable) with generated groups + updated device.groupId.
 *
 * Devices with an existing groupId are LEFT ALONE (respect user grouping).
 * Any old `auto-*` groups from a previous run are cleared first.
 */
export function autoGroupDevices(
  doc: NetMapDoc,
  opts: SmartLayoutOpts = {},
): NetMapDoc {
  const strategy = opts.groupBy ?? 'hybrid';
  if (strategy === 'none') return doc;

  // 1) Strip previous auto-* groups. Devices assigned to them become ungrouped.
  const oldAutoGroupIds = new Set(
    (doc.groups || []).filter(g => g.id.startsWith(AUTO_GROUP_PREFIX)).map(g => g.id)
  );
  const preservedGroups = (doc.groups || []).filter(g => !g.id.startsWith(AUTO_GROUP_PREFIX));
  const preservedGroupIds = new Set(preservedGroups.map(g => g.id));

  const devicesCleaned = doc.devices.map(d => {
    if (d.groupId && oldAutoGroupIds.has(d.groupId)) {
      return { ...d, groupId: undefined };
    }
    return d;
  });

  // 2) Assign each still-ungrouped device to an auto-* group.
  interface AutoGroupSeed { key: string; name: string; subtitle?: string; color?: string; devIds: string[] }
  const seeds = new Map<string, AutoGroupSeed>();

  const devicesWithGroup = devicesCleaned.map(d => {
    if (d.groupId && preservedGroupIds.has(d.groupId)) return d; // untouched user group
    // Skip pure orphan "cloud" providers — they float freely.
    if (d.kind === 'cloud') return d;
    const gk = groupKeyFor(d, doc, strategy);
    if (!gk) return d;
    const gid = `${AUTO_GROUP_PREFIX}${shortHash(gk.key)}`;
    let seed = seeds.get(gid);
    if (!seed) {
      seed = { key: gk.key, name: gk.name, subtitle: gk.subtitle, color: gk.color, devIds: [] };
      seeds.set(gid, seed);
    }
    seed.devIds.push(d.id);
    return { ...d, groupId: gid };
  });

  // 3) Drop singleton auto-groups (a lone device looks worse in a box than alone).
  const singletonKeep = 1; // < singletonKeep + 1 = don't create group
  const dropIds = new Set<string>();
  for (const [gid, s] of seeds.entries()) {
    if (s.devIds.length <= singletonKeep) dropIds.add(gid);
  }
  const devicesFinal = devicesWithGroup.map(d =>
    (d.groupId && dropIds.has(d.groupId)) ? { ...d, groupId: undefined } : d
  );

  // 4) Emit auto Groups (placeholder x/y — computeAutoLayout will overwrite).
  const autoGroups: Group[] = [];
  for (const [gid, s] of seeds.entries()) {
    if (dropIds.has(gid)) continue;
    autoGroups.push({
      id: gid,
      name: s.name,
      subtitle: s.subtitle ? `${s.subtitle} · ${s.devIds.length}` : `${s.devIds.length} устройств`,
      x: 0, y: 0, width: 300, height: 200,
      color: s.color,
    });
  }

  return {
    ...doc,
    devices: devicesFinal,
    groups: [...preservedGroups, ...autoGroups],
  };
}

/**
 * Human-readable summary of what auto-grouping did — for post-layout toast.
 */
export function summarizeAutoGrouping(before: NetMapDoc, after: NetMapDoc): string {
  const beforeAuto = (before.groups || []).filter(g => g.id.startsWith(AUTO_GROUP_PREFIX)).length;
  const afterAuto  = (after.groups  || []).filter(g => g.id.startsWith(AUTO_GROUP_PREFIX)).length;
  const grouped    = after.devices.filter(d => d.groupId?.startsWith(AUTO_GROUP_PREFIX)).length;
  return `Автогрупп: ${afterAuto} (было ${beforeAuto}) · В них устройств: ${grouped}`;
}

export const IS_AUTO_GROUP = (id: string) => id.startsWith(AUTO_GROUP_PREFIX);
