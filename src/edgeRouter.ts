/**
 * v0.33 — Node-avoiding orthogonal edge router.
 *
 * Goal: cables must not run THROUGH device cards. Before v0.33 we used
 * React Flow's built-in smoothstep / bezier which naïvely draws the shortest
 * corner-radiused path — and if a card happens to sit between the two
 * endpoints, the cable crosses it, hiding the port and confusing the eye.
 *
 * Approach — a lightweight greedy Manhattan router:
 *   1. Build an obstacle map: every device's bounding rect (in FLOW coords —
 *      i.e. group-child positions are converted to absolute).
 *   2. For each link, generate a small set of orthogonal candidate polylines
 *      that leave each endpoint along the port's side (Top/Right/Bottom/Left):
 *        - direct L-shape (2 legs)
 *        - Z-shape (3 legs) with the mid-line at a few sensible offsets
 *        - a wide detour going around the first blocking obstacle
 *   3. Score each candidate by:
 *        + huge penalty for crossing an obstacle rect (per crossing)
 *        + small penalty for total length
 *        + small penalty for number of bends
 *        + tiny penalty for co-linear overlap with other already-routed paths
 *          (so parallel cables spread out into separate "lanes")
 *   4. Pick the lowest score. Convert to an SVG `d` string with rounded corners.
 *
 * The router is a singleton keyed by input signature. `rebuild()` is idempotent
 * — call it whenever positions/sizes/links change and it recomputes the whole
 * cache. Individual PortEdges read `getPath(linkId)` synchronously.
 *
 * Performance: for ~70 cables on the Усадьба map the whole rebuild is <20 ms
 * on a mid-range laptop. Called from Canvas.tsx on a debounce.
 */

import type { Device, Group, Link } from './types';
import { Position } from '@xyflow/react';

/** Grid resolution — smaller = smoother/slower, larger = jaggier/faster. */
const OBSTACLE_INFLATE = 10;   // px of extra clearance around every card
const STUB_LEN = 22;           // how far a cable exits its port before turning
const CORNER_R = 10;           // SVG rounded-corner radius
const OBSTACLE_CROSS_COST = 5000;
const LENGTH_COST = 0.05;
const BEND_COST = 40;
const OVERLAP_COST = 25;
const DETOUR_MARGIN = 24;      // gap between detour and obstacle edge

/** Rect in absolute flow coords. */
export interface ObstacleRect { x: number; y: number; w: number; h: number; id: string; }

/** Convenience: side → outward unit vector. */
function outwardDir(side: Position): { dx: number; dy: number } {
  switch (side) {
    case Position.Top:    return { dx: 0,  dy: -1 };
    case Position.Bottom: return { dx: 0,  dy:  1 };
    case Position.Left:   return { dx: -1, dy:  0 };
    case Position.Right:  return { dx: 1,  dy:  0 };
  }
}

/** Segment [a → b] treated as axis-aligned. */
interface Seg { x1: number; y1: number; x2: number; y2: number; }

function segmentsFromPoints(pts: Array<{ x: number; y: number }>): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    out.push({ x1: pts[i].x, y1: pts[i].y, x2: pts[i + 1].x, y2: pts[i + 1].y });
  }
  return out;
}

/** Does an axis-aligned segment (horizontal OR vertical) intersect the given rect?
 *  Returns true if the segment enters the interior of the rect (touching an edge
 *  from outside doesn't count — the endpoint is on the rim). */
function segCrossesRect(s: Seg, r: ObstacleRect): boolean {
  const rx1 = r.x, ry1 = r.y, rx2 = r.x + r.w, ry2 = r.y + r.h;
  if (s.x1 === s.x2) {
    // Vertical segment at x = s.x1, y in [min, max]
    const x = s.x1;
    if (x <= rx1 || x >= rx2) return false; // touching side = ok
    const ymin = Math.min(s.y1, s.y2);
    const ymax = Math.max(s.y1, s.y2);
    return ymax > ry1 && ymin < ry2;
  } else {
    // Horizontal segment at y = s.y1, x in [min, max]
    const y = s.y1;
    if (y <= ry1 || y >= ry2) return false;
    const xmin = Math.min(s.x1, s.x2);
    const xmax = Math.max(s.x1, s.x2);
    return xmax > rx1 && xmin < rx2;
  }
}

/** Count how many obstacle rects the polyline crosses. `ignoreIds` — skip
 *  the endpoint devices' own rects (path always starts/ends at their edge). */
function countCrossings(segs: Seg[], obstacles: ObstacleRect[], ignoreIds: Set<string>): number {
  let n = 0;
  for (const s of segs) {
    for (const r of obstacles) {
      if (ignoreIds.has(r.id)) continue;
      if (segCrossesRect(s, r)) n++;
    }
  }
  return n;
}

/** Length of an orthogonal polyline. */
function polyLength(pts: Array<{ x: number; y: number }>): number {
  let sum = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    sum += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
  }
  return sum;
}

/** How much overlapping length does this polyline share with any already-routed
 *  polyline? Used to nudge parallel cables into separate lanes. */
function overlapWithExisting(segs: Seg[], existing: Seg[][]): number {
  let overlap = 0;
  const OVERLAP_TOL = 6; // px — considered "same lane" if within this
  for (const s of segs) {
    for (const other of existing) {
      for (const e of other) {
        // Both must be axis-aligned in the same direction (both H or both V)
        const sHoriz = s.y1 === s.y2, eHoriz = e.y1 === e.y2;
        const sVert  = s.x1 === s.x2, eVert  = e.x1 === e.x2;
        if (sHoriz && eHoriz && Math.abs(s.y1 - e.y1) < OVERLAP_TOL) {
          const a1 = Math.min(s.x1, s.x2), a2 = Math.max(s.x1, s.x2);
          const b1 = Math.min(e.x1, e.x2), b2 = Math.max(e.x1, e.x2);
          overlap += Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
        } else if (sVert && eVert && Math.abs(s.x1 - e.x1) < OVERLAP_TOL) {
          const a1 = Math.min(s.y1, s.y2), a2 = Math.max(s.y1, s.y2);
          const b1 = Math.min(e.y1, e.y2), b2 = Math.max(e.y1, e.y2);
          overlap += Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
        }
      }
    }
  }
  return overlap;
}

/**
 * Generate a family of candidate polylines from (sx, sy) leaving side `ss`
 * to (tx, ty) entering side `ts`. All candidates start with a `STUB_LEN`
 * stub outward from each port so cables don't immediately turn back into
 * their own device.
 */
function generateCandidates(
  sx: number, sy: number, ss: Position,
  tx: number, ty: number, ts: Position,
  obstacles: ObstacleRect[],
  ignoreIds: Set<string>,
): Array<Array<{ x: number; y: number }>> {
  const sd = outwardDir(ss);
  const td = outwardDir(ts);
  const sxOut = sx + sd.dx * STUB_LEN;
  const syOut = sy + sd.dy * STUB_LEN;
  const txOut = tx + td.dx * STUB_LEN;
  const tyOut = ty + td.dy * STUB_LEN;

  const cands: Array<Array<{ x: number; y: number }>> = [];

  // 1) Direct L-shape (2 legs after stubs) — HV first
  cands.push([
    { x: sx, y: sy }, { x: sxOut, y: syOut },
    { x: txOut, y: syOut }, { x: txOut, y: tyOut },
    { x: tx, y: ty },
  ]);
  // 2) Direct L-shape — VH first
  cands.push([
    { x: sx, y: sy }, { x: sxOut, y: syOut },
    { x: sxOut, y: tyOut }, { x: txOut, y: tyOut },
    { x: tx, y: ty },
  ]);

  // 3) Z-shape — mid-X at various offsets. Useful when neither pure L works.
  const midXs = [
    (sxOut + txOut) / 2,
    (sxOut + txOut) / 2 + 60,
    (sxOut + txOut) / 2 - 60,
    (sxOut + txOut) / 2 + 120,
    (sxOut + txOut) / 2 - 120,
  ];
  for (const mx of midXs) {
    cands.push([
      { x: sx, y: sy }, { x: sxOut, y: syOut },
      { x: mx, y: syOut }, { x: mx, y: tyOut },
      { x: txOut, y: tyOut }, { x: tx, y: ty },
    ]);
  }
  // 4) Z-shape mid-Y at various offsets
  const midYs = [
    (syOut + tyOut) / 2,
    (syOut + tyOut) / 2 + 60,
    (syOut + tyOut) / 2 - 60,
    (syOut + tyOut) / 2 + 120,
    (syOut + tyOut) / 2 - 120,
  ];
  for (const my of midYs) {
    cands.push([
      { x: sx, y: sy }, { x: sxOut, y: syOut },
      { x: sxOut, y: my }, { x: txOut, y: my },
      { x: txOut, y: tyOut }, { x: tx, y: ty },
    ]);
  }

  // 5) Detour AROUND the first blocking obstacle on the direct L.
  // For each obstacle blocking the naïve HV/VH path, propose going around
  // the top, bottom, left, right side of it.
  const directSegs = segmentsFromPoints(cands[0]);
  for (const r of obstacles) {
    if (ignoreIds.has(r.id)) continue;
    if (!directSegs.some(s => segCrossesRect(s, r))) continue;
    const topY = r.y - DETOUR_MARGIN;
    const botY = r.y + r.h + DETOUR_MARGIN;
    const lftX = r.x - DETOUR_MARGIN;
    const rgtX = r.x + r.w + DETOUR_MARGIN;
    // Over-the-top detour (HV-VH-HV style)
    cands.push([
      { x: sx, y: sy }, { x: sxOut, y: syOut },
      { x: sxOut, y: topY }, { x: txOut, y: topY },
      { x: txOut, y: tyOut }, { x: tx, y: ty },
    ]);
    cands.push([
      { x: sx, y: sy }, { x: sxOut, y: syOut },
      { x: sxOut, y: botY }, { x: txOut, y: botY },
      { x: txOut, y: tyOut }, { x: tx, y: ty },
    ]);
    cands.push([
      { x: sx, y: sy }, { x: sxOut, y: syOut },
      { x: lftX, y: syOut }, { x: lftX, y: tyOut },
      { x: txOut, y: tyOut }, { x: tx, y: ty },
    ]);
    cands.push([
      { x: sx, y: sy }, { x: sxOut, y: syOut },
      { x: rgtX, y: syOut }, { x: rgtX, y: tyOut },
      { x: txOut, y: tyOut }, { x: tx, y: ty },
    ]);
  }

  return cands;
}

/** Remove collinear intermediate points ("A–B–C on the same line" → "A–C"). */
function simplify(pts: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      const abH = a.y === b.y, bcH = b.y === p.y;
      const abV = a.x === b.x, bcV = b.x === p.x;
      if ((abH && bcH) || (abV && bcV)) {
        out[out.length - 1] = p;
        continue;
      }
    }
    // dedupe consecutive identical points
    if (out.length && out[out.length - 1].x === p.x && out[out.length - 1].y === p.y) continue;
    out.push(p);
  }
  return out;
}

/** Convert an orthogonal polyline to an SVG `d` string with softly rounded corners. */
function polylineToSvgPath(pts: Array<{ x: number; y: number }>): string {
  const p = simplify(pts);
  if (p.length === 0) return '';
  if (p.length === 1) return `M ${p[0].x} ${p[0].y}`;
  if (p.length === 2) return `M ${p[0].x} ${p[0].y} L ${p[1].x} ${p[1].y}`;

  let d = `M ${p[0].x} ${p[0].y}`;
  for (let i = 1; i < p.length - 1; i++) {
    const prev = p[i - 1], cur = p[i], next = p[i + 1];
    // Segments in/out from `cur`
    const inLen = Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
    const outLen = Math.abs(next.x - cur.x) + Math.abs(next.y - cur.y);
    const r = Math.min(CORNER_R, inLen / 2, outLen / 2);
    if (r < 1) {
      d += ` L ${cur.x} ${cur.y}`;
      continue;
    }
    // Point along incoming segment, `r` back from cur
    const inSign = { dx: Math.sign(cur.x - prev.x), dy: Math.sign(cur.y - prev.y) };
    const outSign = { dx: Math.sign(next.x - cur.x), dy: Math.sign(next.y - cur.y) };
    const p1 = { x: cur.x - inSign.dx * r, y: cur.y - inSign.dy * r };
    const p2 = { x: cur.x + outSign.dx * r, y: cur.y + outSign.dy * r };
    d += ` L ${p1.x} ${p1.y} Q ${cur.x} ${cur.y} ${p2.x} ${p2.y}`;
  }
  const last = p[p.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

// -------- Public API: singleton router with a link-id → path cache --------

interface RouteRequest {
  linkId: string;
  sx: number; sy: number; ss: Position;
  tx: number; ty: number; ts: Position;
  sourceDevId: string; targetDevId: string;
}

class EdgeRouter {
  private cache = new Map<string, string>();
  private version = 0;

  // v0.33: edges self-register their endpoint geometry every render.
  // A debounced rebuild consumes the current registry and repopulates cache.
  private registry = new Map<string, RouteRequest>();
  private obstacles: ObstacleRect[] = [];
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private rebuilding = false;
  /** External version-tick setter — Canvas hooks this up to a zustand slice
   *  so components can rerender via a normal store selector instead of
   *  per-instance subscribe listeners (which caused #185 storms). */
  private onVersionBump: ((v: number) => void) | null = null;

  setVersionSink(fn: (v: number) => void): void { this.onVersionBump = fn; }

  getVersion(): number { return this.version; }
  getPath(linkId: string): string | null { return this.cache.get(linkId) ?? null; }

  /** Called by each PortEdge on every render. Cheap — just a map set. */
  register(req: RouteRequest): void {
    const prev = this.registry.get(req.linkId);
    if (prev
      && prev.sx === req.sx && prev.sy === req.sy
      && prev.tx === req.tx && prev.ty === req.ty
      && prev.ss === req.ss && prev.ts === req.ts
      && prev.sourceDevId === req.sourceDevId && prev.targetDevId === req.targetDevId
    ) return;
    this.registry.set(req.linkId, req);
    this.scheduleRebuild();
  }

  unregister(linkId: string): void {
    if (this.registry.delete(linkId)) this.scheduleRebuild();
  }

  /** Called by Canvas whenever obstacle geometry might have changed. */
  setObstacles(obs: ObstacleRect[]): void {
    this.obstacles = obs;
    this.scheduleRebuild();
  }

  private scheduleRebuild(): void {
    if (this.rebuildTimer) return;
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      if (this.rebuilding) return;   // re-entrancy guard
      this.rebuilding = true;
      try { this.rebuildNow(); }
      finally { this.rebuilding = false; }
    }, 120);
  }

  private rebuildNow(): void {
    this.rebuild([...this.registry.values()], this.obstacles);
  }

  /** Recompute paths for the given requests + obstacle set. */
  rebuild(requests: RouteRequest[], obstacles: ObstacleRect[]): void {
    // Inflate obstacles a bit so cables don't hug card edges
    const infl: ObstacleRect[] = obstacles.map(o => ({
      id: o.id,
      x: o.x - OBSTACLE_INFLATE,
      y: o.y - OBSTACLE_INFLATE,
      w: o.w + OBSTACLE_INFLATE * 2,
      h: o.h + OBSTACLE_INFLATE * 2,
    }));

    // Route in a stable order (by linkId) so results don't jitter frame-to-frame.
    const sorted = [...requests].sort((a, b) => a.linkId.localeCompare(b.linkId));
    const routedSegs: Seg[][] = [];
    const next = new Map<string, string>();

    for (const r of sorted) {
      const ignore = new Set([r.sourceDevId, r.targetDevId]);
      const cands = generateCandidates(r.sx, r.sy, r.ss, r.tx, r.ty, r.ts, infl, ignore);

      let best: { pts: Array<{ x: number; y: number }>; score: number; segs: Seg[] } | null = null;
      for (const c of cands) {
        const segs = segmentsFromPoints(c);
        const crossings = countCrossings(segs, infl, ignore);
        const length = polyLength(c);
        const bends = Math.max(0, c.length - 2);
        const overlap = overlapWithExisting(segs, routedSegs);
        const score =
          crossings * OBSTACLE_CROSS_COST +
          length * LENGTH_COST +
          bends * BEND_COST +
          overlap * OVERLAP_COST;
        if (!best || score < best.score) best = { pts: c, score, segs };
      }
      if (best) {
        next.set(r.linkId, polylineToSvgPath(best.pts));
        routedSegs.push(best.segs);
      }
    }

    this.cache = next;
    this.version++;
    if (this.onVersionBump) this.onVersionBump(this.version);
  }

  clear(): void {
    if (this.cache.size === 0) return;
    this.cache.clear();
    this.version++;
    if (this.onVersionBump) this.onVersionBump(this.version);
  }
}

export const edgeRouter = new EdgeRouter();

/** Build obstacle rects for every device, in absolute flow coords.
 *  Handles group-child positions (Device.x/y is group-local when groupId is set). */
export function buildObstacles(
  devices: Device[], groups: Group[] | undefined,
  sizeOf: (d: Device) => { w: number; h: number },
): ObstacleRect[] {
  const grpById = new Map<string, Group>();
  for (const g of groups || []) grpById.set(g.id, g);
  const out: ObstacleRect[] = [];
  for (const d of devices) {
    const par = d.groupId ? grpById.get(d.groupId) : null;
    const ax = d.x + (par?.x ?? 0);
    const ay = d.y + (par?.y ?? 0);
    const sz = sizeOf(d);
    out.push({ id: d.id, x: ax, y: ay, w: sz.w, h: sz.h });
  }
  return out;
}

/** Build a RouteRequest list from React Flow edge data + node positions.
 *  Called from Canvas.tsx — we pass in the resolved sx/sy/tx/ty (as React Flow
 *  computes them from handle positions) so the router doesn't need to guess. */
export type { RouteRequest };
