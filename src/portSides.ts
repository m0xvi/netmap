/**
 * v0.34 — Dynamic port sides.
 *
 * Instead of hard-coding "uplink ports go Top, everything else goes
 * Bottom/Left/Right in a fixed rotation", we compute for each port which
 * SIDE of the card it should exit — based on the geometric direction to
 * its peer(s). This lets cables leave in a straight line instead of
 * spiraling around the card.
 *
 * Algorithm (per link):
 *   1. Compute src-center → tgt-center vector (in absolute flow coords,
 *      accounting for group parents).
 *   2. Pick the dominant-axis side for each endpoint: if |dx| >= |dy| the
 *      endpoints face each other along X (src → Right if dx>0 else Left,
 *      tgt → Left if dx>0 else Right); otherwise along Y.
 *   3. Store as portSide[deviceId + ':' + portId] = Position.
 *
 * For ports with multiple links (a switch uplink used for two peers, etc.)
 * we tally votes per side and pick the majority; ties fall back to the
 * original static side.
 *
 * Position along the chosen side (for switches with 24 ports crammed on
 * one edge) is computed by:
 *   - grouping ports by chosen side,
 *   - sorting each group by port.id order,
 *   - spreading evenly across the edge.
 * That position is exposed as `portOffset(deviceId, portId, side, sideCount)
 * → percent 0..100` so nodes can position their Handles.
 *
 * Consumers: SwitchNode (CompactSwitchView), DeviceNode (CompactHandles).
 * Rack-view of switch/patch/server keeps ports fixed to the front like the
 * real hardware — no dynamic sides there.
 */

import { Position } from '@xyflow/react';
import type { Device, Group, Link } from './types';

export interface PortSideInfo {
  side: Position;
  /** 0..100 % along the chosen edge (top→bottom for L/R, left→right for T/B). */
  offsetPct: number;
}

interface DeviceCenter { x: number; y: number; w: number; h: number; }

function centerOf(dev: Device, groupMap: Map<string, Group>, sizeOf: (d: Device) => { w: number; h: number }): DeviceCenter {
  const par = dev.groupId ? groupMap.get(dev.groupId) : null;
  const sz = sizeOf(dev);
  const ax = dev.x + (par?.x ?? 0);
  const ay = dev.y + (par?.y ?? 0);
  return { x: ax + sz.w / 2, y: ay + sz.h / 2, w: sz.w, h: sz.h };
}

/** Pick the side an endpoint should face given the vector to its peer.
 *  `isSource=true` means the port is the SRC end; it faces AWAY from own
 *  center toward the peer (positive dot with (dx, dy)). `isSource=false`
 *  reverses the vector for the TGT end. */
function sideFromVector(dx: number, dy: number, isSource: boolean): Position {
  const sign = isSource ? 1 : -1;
  const vx = dx * sign;
  const vy = dy * sign;
  if (Math.abs(vx) >= Math.abs(vy)) {
    return vx >= 0 ? Position.Right : Position.Left;
  }
  return vy >= 0 ? Position.Bottom : Position.Top;
}

class PortSidesCache {
  /** Key: `${deviceId}:${portId}` */
  private sideMap = new Map<string, Position>();
  /** Key: `${deviceId}:${portId}` → 0..100 percent along the chosen edge */
  private offsetMap = new Map<string, number>();
  private version = 0;

  /** Monotonically-increasing tick — components can read this via any
   *  external subscription mechanism to know when to re-render.
   *  v0.34.1: removed the per-listener subscribe API — it caused listener
   *  storms (every card + every edge subscribed → recompute triggered
   *  hundreds of setState calls in a single tick, blowing React error #185).
   *  Instead, Canvas keeps a version-tick in zustand and re-renders on it. */
  getVersion(): number { return this.version; }

  /** Look up computed side; return null if the port has no computed side
   *  (no links, or not in a device we compute sides for). Caller should
   *  fall back to its own default. */
  getSide(deviceId: string, portId: string): Position | null {
    return this.sideMap.get(`${deviceId}:${portId}`) ?? null;
  }

  getOffsetPct(deviceId: string, portId: string): number | null {
    return this.offsetMap.get(`${deviceId}:${portId}`) ?? null;
  }

  /**
   * Recompute all sides + offsets. Cheap enough to run on every doc change
   * (~1 ms for the Усадьба map of 66 devices / 63 links).
   *
   * `dynamicKinds` — which device kinds get dynamic sides. Others are
   * silently skipped (their consumers fall back to a static side).
   */
  recompute(
    devices: Device[],
    groups: Group[] | undefined,
    links: Link[],
    sizeOf: (d: Device) => { w: number; h: number },
    dynamicKinds: Set<string>,
  ): void {
    const groupMap = new Map<string, Group>();
    for (const g of groups || []) groupMap.set(g.id, g);
    const devById = new Map<string, Device>();
    for (const d of devices) devById.set(d.id, d);
    const centerCache = new Map<string, DeviceCenter>();
    const getCenter = (id: string) => {
      let c = centerCache.get(id);
      if (c) return c;
      const d = devById.get(id);
      if (!d) return null;
      c = centerOf(d, groupMap, sizeOf);
      centerCache.set(id, c);
      return c;
    };

    // Vote counters: for each portKey, count how many links point to each side.
    // A port with multiple links gets the majority-vote side.
    interface Votes { top: number; bottom: number; left: number; right: number; }
    const votes = new Map<string, Votes>();
    const bump = (key: string, side: Position) => {
      let v = votes.get(key);
      if (!v) { v = { top: 0, bottom: 0, left: 0, right: 0 }; votes.set(key, v); }
      if (side === Position.Top) v.top++;
      else if (side === Position.Bottom) v.bottom++;
      else if (side === Position.Left) v.left++;
      else v.right++;
    };

    for (const l of links) {
      if (!l.fromPortId || !l.toPortId) continue;
      const src = devById.get(l.fromDeviceId);
      const tgt = devById.get(l.toDeviceId);
      if (!src || !tgt) continue;
      const srcC = getCenter(l.fromDeviceId);
      const tgtC = getCenter(l.toDeviceId);
      if (!srcC || !tgtC) continue;
      const dx = tgtC.x - srcC.x;
      const dy = tgtC.y - srcC.y;
      if (dynamicKinds.has(src.kind)) {
        bump(`${src.id}:${l.fromPortId}`, sideFromVector(dx, dy, true));
      }
      if (dynamicKinds.has(tgt.kind)) {
        bump(`${tgt.id}:${l.toPortId}`, sideFromVector(dx, dy, false));
      }
    }

    // Collapse votes → chosen side.
    const sideMap = new Map<string, Position>();
    for (const [key, v] of votes) {
      let best: Position = Position.Right; let bestN = -1;
      if (v.right > bestN) { best = Position.Right; bestN = v.right; }
      if (v.bottom > bestN) { best = Position.Bottom; bestN = v.bottom; }
      if (v.left > bestN) { best = Position.Left; bestN = v.left; }
      if (v.top > bestN) { best = Position.Top; bestN = v.top; }
      sideMap.set(key, best);
    }

    // Compute per-port offset percentage along its chosen side.
    // Group all of a device's ports by side, sort them, spread evenly.
    const offsetMap = new Map<string, number>();
    for (const d of devices) {
      if (!dynamicKinds.has(d.kind)) continue;
      // Bucket ports by side (using the computed one; if a port has no vote,
      // it's not connected — skip, it won't render a handle anyway).
      const buckets: Record<'top'|'bottom'|'left'|'right', string[]> = {
        top: [], bottom: [], left: [], right: [],
      };
      const ordered = d.ports; // rely on ports being in canonical order
      for (const p of ordered) {
        const side = sideMap.get(`${d.id}:${p.id}`);
        if (!side) continue;
        if (side === Position.Top) buckets.top.push(p.id);
        else if (side === Position.Bottom) buckets.bottom.push(p.id);
        else if (side === Position.Left) buckets.left.push(p.id);
        else buckets.right.push(p.id);
      }
      for (const bucket of Object.values(buckets)) {
        const n = bucket.length;
        for (let i = 0; i < n; i++) {
          const pct = ((i + 1) / (n + 1)) * 100;
          offsetMap.set(`${d.id}:${bucket[i]}`, pct);
        }
      }
    }

    // Only bump version if something actually changed — otherwise Canvas'
    // dependent effects re-run needlessly.
    const changed = !mapsEqual(this.sideMap, sideMap)
                 || !numMapsEqual(this.offsetMap, offsetMap);
    if (!changed) return;
    this.sideMap = sideMap;
    this.offsetMap = offsetMap;
    this.version++;
  }
}

function mapsEqual(a: Map<string, Position>, b: Map<string, Position>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}
function numMapsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w === undefined) return false;
    if (Math.abs(w - v) > 0.5) return false;
  }
  return true;
}

/** Which kinds get dynamic port sides. Anything not in this set uses
 *  its own fixed sides (rack-view of switch/server/patch keeps front ports). */
export const DYNAMIC_KINDS = new Set<string>([
  'switch', 'router',
  // endpoints:
  'ap', 'camera', 'pc', 'pos', 'printer', 'lock', 'vm', 'vps',
]);

export const portSides = new PortSidesCache();
