/**
 * AABB collision resolver for canvas devices — v0.22 rewrite.
 *
 * Design goals after user feedback:
 *   1. Do NOT nudge siblings unless the dragged node actually overlaps them.
 *      Previously we push-away'd cards even on empty space because our size
 *      estimates were wrong → false overlaps.
 *   2. Use the REAL rendered size via `document.querySelector`, not guesses.
 *   3. Skip resolution while dragging over empty space (nothing overlapping).
 *   4. Animation happens via CSS transitions on the node wrappers.
 *
 * Called from Canvas.onNodeDrag (live) / onNodeDragStop.
 */

import { useStore } from './store';
import type { Node } from '@xyflow/react';
import type { Device } from './types';

/** Minimum overlap (px) that counts as a real collision. Small drift due to
 *  layout shifts / measurement rounding is ignored. */
const OVERLAP_THRESHOLD = 2;

/** Extra breathing room to leave between cards after pushing them apart. */
const GAP = 16;

/** Invisible "personal space" padded around every card. Even when the user
 *  drops a card right next to a sibling, our collision check inflates the
 *  dragged rect by this amount so a small gap is always preserved.
 *  Applied only during collision detection — the actual card doesn't grow. */
const PERSONAL_SPACE = 12;

/** Max iterations for chain-collision resolution. Usually 1–2 is enough. */
const MAX_ITERS = 3;

interface Rect { x: number; y: number; w: number; h: number; id: string; }

/**
 * Read the actual rendered size of a node from the DOM.
 * React Flow renders every node with a `data-id="<node-id>"` attribute, so we
 * can grab its bounding box — divided by the current zoom so we get flow
 * (untransformed) coordinates.
 */
function readRenderedSize(nodeId: string): { w: number; h: number } | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`) as HTMLElement | null;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  // We need the size in flow coords, not screen coords. The React Flow viewport
  // has a CSS transform like `translate(...) scale(z)`; parse the zoom out of
  // it so we can divide.
  const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  let zoom = 1;
  if (viewport) {
    const t = viewport.style.transform || '';
    const m = /scale\(([-\d.]+)\)/.exec(t);
    if (m) zoom = parseFloat(m[1]) || 1;
  }
  return { w: rect.width / zoom, h: rect.height / zoom };
}

/**
 * Fallback size estimator — used only if the node hasn't rendered yet.
 * Keep numbers on the SMALLER side so we err toward NOT colliding, not toward
 * false-positive nudges. Bigger cards may briefly overlap for one frame; that
 * self-corrects once the DOM measurement kicks in.
 */
function estimateSize(dev: Device, node?: Node): { w: number; h: number } {
  const measured = readRenderedSize(dev.id);
  if (measured) return measured;
  const w = (node as any)?.width ?? (node as any)?.measured?.width;
  const h = (node as any)?.height ?? (node as any)?.measured?.height;
  if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) return { w, h };

  switch (dev.kind) {
    case 'switch':     return { w: dev.display === 'rack' ? 480 : 320, h: dev.display === 'rack' ? 200 : 64 };
    case 'router':     return { w: 220, h: 100 };
    case 'patchpanel': return { w: dev.display === 'rack' ? 460 : 240, h: dev.display === 'rack' ? 130 : 90 };
    case 'cloud':      return { w: 200, h: 90 };
    case 'ap':
    case 'camera':
    case 'printer':
    case 'lock':
    case 'pos':        return { w: 140, h: 110 };
    case 'server':     return { w: 200, h: 100 };
    case 'vm':
    case 'vps':
    case 'pc':         return { w: 180, h: 60 };
    default:           return { w: 160, h: 84 };
  }
}

/**
 * Nudge overlapping siblings out of the way of the dragged node.
 * If the dragged node overlaps nothing, this is a no-op — no more phantom pushes.
 */
export function resolveCollisions(
  draggedNode: Node,
  groupIdOverride: string | null | undefined = undefined,
  anchorDragged = true,
) {
  const state = useStore.getState();
  const devices = state.doc.devices;
  const groups = state.doc.groups || [];

  const dragged = devices.find(d => d.id === draggedNode.id);
  if (!dragged) return;

  const parentId = groupIdOverride === undefined ? dragged.groupId : groupIdOverride;
  const parent = parentId ? groups.find(g => g.id === parentId) : null;

  const draggedSize = estimateSize(dragged, draggedNode);
  const dragAbsX = draggedNode.position.x + (parent?.x ?? 0);
  const dragAbsY = draggedNode.position.y + (parent?.y ?? 0);
  // v0.24: inflate the dragged rect by PERSONAL_SPACE on every side. This is a
  // virtual halo — cards never end up touching, they always keep a gap.
  const draggedRect: Rect = {
    x: dragAbsX - PERSONAL_SPACE,
    y: dragAbsY - PERSONAL_SPACE,
    w: draggedSize.w + PERSONAL_SPACE * 2,
    h: draggedSize.h + PERSONAL_SPACE * 2,
    id: dragged.id,
  };

  // Collect siblings in the same parent
  const siblings: Array<{ dev: Device; rect: Rect; origAbsX: number; origAbsY: number }> = [];
  for (const other of devices) {
    if (other.id === dragged.id) continue;
    if ((other.groupId || null) !== (parentId || null)) continue;
    const sz = estimateSize(other);
    const par = other.groupId ? groups.find(g => g.id === other.groupId) : null;
    const absX = other.x + (par?.x ?? 0);
    const absY = other.y + (par?.y ?? 0);
    siblings.push({
      dev: other,
      rect: { x: absX, y: absY, w: sz.w, h: sz.h, id: other.id },
      origAbsX: absX, origAbsY: absY,
    });
  }

  // ---- EARLY EXIT — the whole point of v0.22 ----
  // If dragged doesn't overlap ANY sibling, we're on empty space. Do nothing.
  const directHits = siblings.filter(s => aabbOverlap(s.rect, draggedRect));
  if (directHits.length === 0) return;

  // Iterative resolution — push overlapping siblings, then fix chain-collisions.
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    let moved = false;
    const anchors: Rect[] = anchorDragged ? [draggedRect] : [];
    for (const sib of siblings) {
      let dx = 0, dy = 0;
      for (const anc of anchors) {
        const ov = aabbOverlap(sib.rect, anc);
        if (!ov) continue;
        // Push along axis of least penetration for a smaller, more natural move
        if (ov.dx <= ov.dy) {
          const sign = sib.rect.x + sib.rect.w / 2 < anc.x + anc.w / 2 ? -1 : 1;
          dx += sign * (ov.dx + GAP);
        } else {
          const sign = sib.rect.y + sib.rect.h / 2 < anc.y + anc.h / 2 ? -1 : 1;
          dy += sign * (ov.dy + GAP);
        }
      }
      if (dx !== 0 || dy !== 0) {
        sib.rect.x += dx;
        sib.rect.y += dy;
        moved = true;
      }
      anchors.push(sib.rect);
    }
    if (!moved) break;
  }

  // Commit: only siblings whose rect actually changed
  // v0.35.5: batch all sibling moves into ONE store update instead of N
  // sequential setPosition calls. Sequential calls used to trigger N
  // re-renders of the whole ReactFlow tree and occasionally hit
  // ResizeObserver's loop guard, blanking the scene.
  const moves: Array<{ id: string; x: number; y: number; parentId: string | null }> = [];
  for (const sib of siblings) {
    const dxMoved = Math.abs(sib.rect.x - sib.origAbsX);
    const dyMoved = Math.abs(sib.rect.y - sib.origAbsY);
    if (dxMoved < 0.5 && dyMoved < 0.5) continue;
    const sibParent = sib.dev.groupId ? groups.find(g => g.id === sib.dev.groupId) : null;
    let relX = sib.rect.x - (sibParent?.x ?? 0);
    let relY = sib.rect.y - (sibParent?.y ?? 0);
    // v0.35.4: SAFETY clamp — a chain of nudges could otherwise push a
    // sibling past the group header (y<0) or into deeply-negative x, where
    // React Flow's `extent:'parent'` clips it invisibly. If a sibling is
    // "pushed off" its group, keep it inside instead.
    if (sibParent) {
      if (!Number.isFinite(relX)) relX = 20;
      if (!Number.isFinite(relY)) relY = 52;
      if (relX < 8)  relX = 8;
      if (relY < 48) relY = 48;
    } else {
      if (!Number.isFinite(relX)) relX = 0;
      if (!Number.isFinite(relY)) relY = 0;
    }
    moves.push({ id: sib.dev.id, x: relX, y: relY, parentId: sib.dev.groupId ?? null });
  }
  if (moves.length) state.applyPositions(moves);
}

/** Return per-axis overlap amounts (positive = they overlap), or null if the
 *  overlap is below the noise threshold. */
function aabbOverlap(a: Rect, b: Rect): { dx: number; dy: number } | null {
  const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (dx > OVERLAP_THRESHOLD && dy > OVERLAP_THRESHOLD) return { dx, dy };
  return null;
}

/**
 * If children have been pushed past the group's current bounds, grow the group
 * so it visually contains them again. Used after drop / collision resolve so
 * groups feel "flexible" — you can push a card past the right edge and the
 * group stretches to include it.
 *
 * Never SHRINKS a group (that would fight the user resizing it manually).
 */
export function growGroupToFitChildren(groupId: string | null) {
  if (!groupId) return;
  const state = useStore.getState();
  const groups = state.doc.groups || [];
  const g = groups.find(x => x.id === groupId);
  if (!g) return;
  const children = state.doc.devices.filter(d => d.groupId === groupId);
  if (children.length === 0) return;

  // header + padding constants matching autoLayout
  const HEADER_H = 44;
  const PAD_X = 20;
  const PAD_BOTTOM = 20;
  const MIN_W = 220;
  const MIN_H = 140;

  // Compute max right/bottom of any child (in group-local coords)
  let maxRight = 0, maxBottom = 0;
  for (const c of children) {
    const sz = readSizeForKind(c);
    maxRight = Math.max(maxRight, c.x + sz.w);
    maxBottom = Math.max(maxBottom, c.y + sz.h);
  }
  const wantedW = Math.max(MIN_W, maxRight + PAD_X);
  const wantedH = Math.max(MIN_H, maxBottom + PAD_BOTTOM);

  // Only grow — never shrink. Also avoid tiny (< 4px) changes to stop write
  // storms that would re-render the whole canvas for no visible reason.
  const newW = Math.max(g.width, wantedW);
  const newH = Math.max(g.height, wantedH);
  if (Math.abs(newW - g.width) < 4 && Math.abs(newH - g.height) < 4) return;

  state.updateGroup(groupId, { width: newW, height: newH });
}

/**
 * v0.32: reflow ALL siblings inside a group after their sizes changed
 * (e.g. compact→rack toggle blows a 200×110 card up to 420×130).
 *
 * Unlike `resolveCollisions` which pushes siblings AWAY FROM one dragged
 * anchor, this runs a symmetric multi-body pair-wise iteration — every
 * pair of overlapping cards is separated equally. Then we clamp everything
 * inside the group bounds (with padding) and grow the group if needed.
 *
 * We deliberately use kind-based sizes (`readSizeForKind`) instead of DOM
 * measurement because at the moment updateDevice() commits the new
 * `display`, React hasn't re-rendered yet so the DOM still reports the
 * old size. `readSizeForKind` reads `dev.display` directly so it always
 * returns the *target* size.
 */
export function reflowGroupChildren(groupId: string | null) {
  const state = useStore.getState();
  const groups = state.doc.groups || [];
  const group = groupId ? groups.find(g => g.id === groupId) : null;

  // All devices inside this group (or all ungrouped devices if groupId is null).
  const kids = state.doc.devices.filter(d => (d.groupId || null) === (groupId || null));
  if (kids.length < 2) {
    if (groupId) growGroupToFitChildren(groupId);
    return;
  }

  // Work in group-local coords (that's what Device.x/y stores when in a group).
  // For ungrouped devices, absolute canvas coords are used.
  interface Body { id: string; x: number; y: number; w: number; h: number; ox: number; oy: number; }
  const bodies: Body[] = kids.map(d => {
    const sz = readSizeForKind(d);
    return { id: d.id, x: d.x, y: d.y, w: sz.w, h: sz.h, ox: d.x, oy: d.y };
  });

  // Group inner bounds — matches autoLayout / growGroupToFitChildren constants.
  const HEADER_H = 44;
  const PAD_X = 20;
  const PAD_TOP = 8;   // small gap below the header
  // No hard right/bottom clamp — we let the group grow instead of squishing kids.
  const minX = group ? PAD_X : -Infinity;
  const minY = group ? HEADER_H + PAD_TOP : -Infinity;

  // Iteratively separate every pair of overlapping bodies.
  const MAX_PASSES = 40;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        // Inflated rects so cards keep a personal-space gap.
        const ax1 = a.x - PERSONAL_SPACE, ay1 = a.y - PERSONAL_SPACE;
        const ax2 = a.x + a.w + PERSONAL_SPACE, ay2 = a.y + a.h + PERSONAL_SPACE;
        const bx1 = b.x - PERSONAL_SPACE, by1 = b.y - PERSONAL_SPACE;
        const bx2 = b.x + b.w + PERSONAL_SPACE, by2 = b.y + b.h + PERSONAL_SPACE;
        const dx = Math.min(ax2, bx2) - Math.max(ax1, bx1);
        const dy = Math.min(ay2, by2) - Math.max(ay1, by1);
        if (dx <= OVERLAP_THRESHOLD || dy <= OVERLAP_THRESHOLD) continue;

        // Push along the axis of least penetration; split the move 50/50.
        if (dx <= dy) {
          const push = (dx + GAP) / 2;
          const acx = a.x + a.w / 2, bcx = b.x + b.w / 2;
          if (acx <= bcx) { a.x -= push; b.x += push; }
          else            { a.x += push; b.x -= push; }
        } else {
          const push = (dy + GAP) / 2;
          const acy = a.y + a.h / 2, bcy = b.y + b.h / 2;
          if (acy <= bcy) { a.y -= push; b.y += push; }
          else            { a.y += push; b.y -= push; }
        }
        moved = true;
      }
    }
    // Re-clamp to group bounds (top-left minimums) every pass so a body
    // pushed off the header snaps back down.
    for (const b of bodies) {
      if (b.x < minX) b.x = minX;
      if (b.y < minY) b.y = minY;
    }
    if (!moved) break;
  }

  // Commit only bodies that actually shifted (≥ 0.5 px). v0.35.5: single batch.
  const moves: Array<{ id: string; x: number; y: number; parentId: string | null }> = [];
  for (const b of bodies) {
    if (Math.abs(b.x - b.ox) < 0.5 && Math.abs(b.y - b.oy) < 0.5) continue;
    moves.push({ id: b.id, x: b.x, y: b.y, parentId: groupId ?? null });
  }
  if (moves.length) state.applyPositions(moves);

  if (groupId) growGroupToFitChildren(groupId);
}

/**
 * v0.32: convenience wrapper — reflow every group that contains any of the
 * given device ids. Called after display toggles (single ◱ button or
 * "Развернуть/Свернуть все"). Runs on a rAF so React has a chance to
 * commit the display change first.
 */
export function reflowGroupsForDevices(deviceIds: string[]) {
  if (deviceIds.length === 0) return;
  const run = () => {
    const state = useStore.getState();
    const affected = new Set<string | null>();
    for (const id of deviceIds) {
      const d = state.doc.devices.find(x => x.id === id);
      if (!d) continue;
      affected.add(d.groupId || null);
    }
    for (const gid of affected) reflowGroupChildren(gid);
  };
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => requestAnimationFrame(run));
  } else {
    run();
  }
}

/** Same kind-based estimator as `estimateSize`, but for children of a group
 *  we don't have a React Flow `Node` at hand. */
export function readSizeForKind(dev: Device): { w: number; h: number } {
  const measured = typeof document !== 'undefined'
    ? (() => {
        const el = document.querySelector(`.react-flow__node[data-id="${dev.id}"]`) as HTMLElement | null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        const vp = document.querySelector('.react-flow__viewport') as HTMLElement | null;
        let zoom = 1;
        if (vp) {
          const m = /scale\(([-\d.]+)\)/.exec(vp.style.transform || '');
          if (m) zoom = parseFloat(m[1]) || 1;
        }
        return { w: r.width / zoom, h: r.height / zoom };
      })()
    : null;
  if (measured) return measured;
  switch (dev.kind) {
    // Switch: rack view is much bigger than compact — reflow needs this delta.
    // v0.35.8: rack redesigned (12-col grid + sidebar) → wider & taller,
    // compact redesigned into a horizontal segmented bar → wider & thinner.
    case 'switch':     return { w: dev.display === 'rack' ? 480 : 320, h: dev.display === 'rack' ? 200 : 64 };
    case 'router':     return { w: 240, h: 110 };
    // Patch panel: rack view is a wide 24/48-port strip (~440×90); compact is a small pill.
    case 'patchpanel': return { w: dev.display === 'rack' ? 440 : 260, h: 90 };
    case 'cloud':      return { w: 200, h: 90 };
    case 'ap':
    case 'camera':
    case 'printer':
    case 'lock':
    case 'pos':        return { w: 150, h: 120 };
    // Server: rack view exposes port-grid, larger than the compact card.
    case 'server':     return { w: dev.display === 'rack' ? 260 : 200, h: dev.display === 'rack' ? 140 : 100 };
    case 'vm':
    case 'vps':
    case 'pc':         return { w: 180, h: 60 };
    default:           return { w: 160, h: 84 };
  }
}
