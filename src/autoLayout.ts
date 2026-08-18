import dagre from 'dagre';
import type { Device, Group, NetMapDoc, Link } from './types';
import { inferLayer, LAYER_META } from './layers';
// v0.43.5: orphan grid width preference lives in the store.
import { useStore } from './store';

export type LayoutDirection = 'TB' | 'LR';

/**
 * Approximate rendered size of a node depending on its kind and display mode.
 * The autolayout needs correct sizes so nodes don't overlap.
 */
function nodeSize(d: Device): { width: number; height: number } {
  const expanded = d.display === 'rack';
  // v0.28: sizes bumped to match new bigger port slots (22×20) and richer cards.
  if (d.kind === 'switch') {
    if (expanded) {
      // v0.35.8 redesign: 12-col port grid + summary sidebar + generous padding.
      const copperCount = d.ports.filter(p => p.type !== 'SFP' && p.type !== 'SFP+' && p.type !== 'WiFi' && p.type !== 'Console').length;
      const cols = Math.ceil(Math.max(copperCount, 2) / 2);   // 2 rows
      const w = Math.max(360, cols * 30 + 140);               // grid + right sidebar
      return { width: w, height: 200 };
    }
    // Compact segmented-bar view — horizontal single-row card.
    return { width: 320, height: 64 };
  }
  if (d.kind === 'router') {
    if (expanded) return { width: 300, height: 130 };
    return { width: 240, height: 120 };
  }
  if (d.kind === 'patchpanel') {
    if (expanded) return { width: 460, height: 100 };
    return { width: 240, height: 90 };
  }
  if (d.kind === 'server') {
    if (expanded) return { width: 320, height: 240 };
    return { width: 210, height: 100 };
  }
  if (d.kind === 'cloud') return { width: 220, height: 110 };
  // Round-card endpoints (ap / camera / printer / lock / pos)
  if (d.kind === 'ap' || d.kind === 'camera' || d.kind === 'printer' || d.kind === 'lock' || d.kind === 'pos') {
    return { width: 160, height: 130 };
  }
  // Box-card computers (pc / vm / vps)
  return { width: 190, height: 70 };
}

interface LayoutOptions {
  direction?: LayoutDirection;
  /** Extra spacing between nodes (px). Larger = airier layout. */
  nodeSep?: number;
  /** Extra spacing between "ranks" (layers). */
  rankSep?: number;
  /** If true, run a separate layout inside each group, then arrange groups themselves. */
  respectGroups?: boolean;
}

interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;      // absolute or relative-to-group positions
  groupPositions: Map<string, { x: number; y: number; width: number; height: number }>;
}

/**
 * Run dagre on the doc. Returns new positions for devices (and updated group sizes).
 * VMs whose host is expanded are skipped (they live inside the server card).
 */
export function computeAutoLayout(doc: NetMapDoc, opts: LayoutOptions = {}): LayoutResult {
  const direction  = opts.direction  ?? 'TB';
  // v0.20: much airier defaults so cards never touch and layers read clearly.
  const nodeSep    = opts.nodeSep    ?? 60;
  const rankSep    = opts.rankSep    ?? 120;
  const respectGroups = opts.respectGroups ?? true;

  const positions       = new Map<string, { x: number; y: number }>();
  const groupPositions  = new Map<string, { x: number; y: number; width: number; height: number }>();

  const expandedServerIds = new Set(
    doc.devices.filter(d => d.kind === 'server' && d.display === 'rack').map(d => d.id)
  );

  const relevantDevices = doc.devices.filter(d => {
    // Hide VMs of expanded servers
    if (d.kind === 'vm' && d.hostDeviceId && expandedServerIds.has(d.hostDeviceId)) return false;
    return true;
  });

  if (!respectGroups || (doc.groups || []).length === 0) {
    layoutFlat(relevantDevices, doc.links, direction, nodeSep, rankSep, positions);
    return { positions, groupPositions };
  }

  // ---- Group-aware layout ----
  // 1) For each group, layout its children into a small sub-graph, get bounding box
  // 2) Layout groups (as super-nodes) at the top level, plus ungrouped devices
  const groups = doc.groups;
  const groupById = new Map(groups.map(g => [g.id, g]));

  interface SubResult { size: { width: number; height: number }; positions: Map<string, {x:number;y:number}> }
  const groupSubResults = new Map<string, SubResult>();

  // Compute sub-layouts per group
  for (const g of groups) {
    const children = relevantDevices.filter(d => d.groupId === g.id);
    if (children.length === 0) {
      groupSubResults.set(g.id, { size: { width: 300, height: 200 }, positions: new Map() });
      continue;
    }
    const childIds = new Set(children.map(c => c.id));
    // Only consider intra-group links
    const intraLinks = doc.links.filter(l => childIds.has(l.fromDeviceId) && childIds.has(l.toDeviceId));

    const subPositions = new Map<string, { x: number; y: number }>();
    const bbox = layoutFlat(children, intraLinks, direction, nodeSep, rankSep, subPositions, /*returnBbox*/ true);
    groupSubResults.set(g.id, { size: bbox!, positions: subPositions });
  }

  // Top-level: super-nodes for groups + individual ungrouped devices
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: false });
  // v0.29: tighter top-level spacing + tight-tree ranker for compact hierarchy.
  // Was `nodesep * 2 = 120, ranksep * 2 = 240` — schemas came out 4000+px wide.
  g.setGraph({
    rankdir: direction,
    nodesep: nodeSep + 20,     // ~80 px between sibling groups
    ranksep: rankSep,           // 120 px between layers
    marginx: 40, marginy: 40,
    ranker: 'tight-tree',
  });
  g.setDefaultEdgeLabel(() => ({}));

  const HEADER_H = 44;
  // v0.20: extra breathing room inside groups so children never touch the border.
  const GROUP_PAD_X = 32;   // left/right padding
  const GROUP_PAD_TOP = HEADER_H + 20;   // header + top padding
  const GROUP_PAD_BOTTOM = 20;

  for (const grp of groups) {
    const sub = groupSubResults.get(grp.id)!;
    const w = Math.max(220, sub.size.width + GROUP_PAD_X * 2);
    const h = Math.max(140, sub.size.height + GROUP_PAD_TOP + GROUP_PAD_BOTTOM);
    g.setNode(grp.id, { width: w, height: h });
  }
  const ungrouped = relevantDevices.filter(d => !d.groupId);
  for (const d of ungrouped) {
    const s = nodeSize(d);
    g.setNode(d.id, { width: s.width, height: s.height });
  }

  // Edges between "super-nodes": links whose endpoints live in different groups (or ungrouped)
  const nodeGroupOf = (deviceId: string): string => {
    const d = relevantDevices.find(x => x.id === deviceId);
    return d?.groupId || deviceId;   // ungrouped device uses its own id at top level
  };
  const seenEdges = new Set<string>();
  for (const l of doc.links) {
    const a = nodeGroupOf(l.fromDeviceId);
    const b = nodeGroupOf(l.toDeviceId);
    if (a === b) continue;   // intra-group edge
    if (!g.hasNode(a) || !g.hasNode(b)) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    g.setEdge(a, b, {}, l.id);
  }

  dagre.layout(g);

  // Emit group positions & absolute device positions
  for (const grp of groups) {
    const n = g.node(grp.id);
    if (!n) continue;
    const sub = groupSubResults.get(grp.id)!;
    const w = Math.max(220, sub.size.width + GROUP_PAD_X * 2);
    const h = Math.max(140, sub.size.height + GROUP_PAD_TOP + GROUP_PAD_BOTTOM);
    // dagre gives us the CENTER of a node; convert to top-left
    const x = Math.round((n.x - w / 2) / 20) * 20;
    const y = Math.round((n.y - h / 2) / 20) * 20;
    groupPositions.set(grp.id, { x, y, width: w, height: h });

    // Child positions inside the group are RELATIVE to the group
    for (const [devId, p] of sub.positions.entries()) {
      positions.set(devId, {
        x: Math.round((p.x + GROUP_PAD_X) / 20) * 20,
        y: Math.round((p.y + GROUP_PAD_TOP) / 20) * 20,
      });
    }
  }
  for (const d of ungrouped) {
    const n = g.node(d.id);
    if (!n) continue;
    const s = nodeSize(d);
    positions.set(d.id, {
      x: Math.round((n.x - s.width  / 2) / 20) * 20,
      y: Math.round((n.y - s.height / 2) / 20) * 20,
    });
  }

  return { positions, groupPositions };
}

/**
 * Flat dagre layout: writes absolute positions into `outPositions`.
 * Returns overall bounding box size (0-based) if `returnBbox` is true.
 */
function layoutFlat(
  devices: Device[],
  links: Link[],
  direction: LayoutDirection,
  nodeSep: number,
  rankSep: number,
  outPositions: Map<string, { x: number; y: number }>,
  returnBbox = false
): { width: number; height: number } | undefined {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: direction, nodesep: nodeSep, ranksep: rankSep, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  const deviceIds = new Set(devices.map(d => d.id));
  for (const d of devices) {
    const s = nodeSize(d);
    g.setNode(d.id, { width: s.width, height: s.height });
  }
  // Add edges (dedupe multi-links between the same pair — dagre supports multi but nicer without)
  const seen = new Set<string>();
  for (const l of links) {
    if (!deviceIds.has(l.fromDeviceId) || !deviceIds.has(l.toDeviceId)) continue;
    const key = l.fromDeviceId < l.toDeviceId
      ? `${l.fromDeviceId}|${l.toDeviceId}`
      : `${l.toDeviceId}|${l.fromDeviceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    g.setEdge(l.fromDeviceId, l.toDeviceId, {}, l.id);
  }
  // Host edges (VM ↔ server) — treat as regular for layout purposes
  for (const d of devices) {
    if (d.kind === 'vm' && d.hostDeviceId && deviceIds.has(d.hostDeviceId)) {
      g.setEdge(d.id, d.hostDeviceId, {}, `host-${d.id}`);
    }
  }

  dagre.layout(g);

  // ---- Post-process: enforce Cisco 3-tier layering ----
  // v0.27: for compact schemas (typically inside a group), if the "access" band
  // gets too wide we wrap endpoints into multiple rows and align each endpoint
  // under its upstream switch. That produces the tidy "star" look from the
  // reference screenshot instead of everyone in one massive row.
  const axis = direction === 'TB' ? 'y' : 'x';
  // Compute a per-band Y offset so bands are stacked cleanly with gap = rankSep
  const perBand: Record<string, { devs: Device[]; sizes: Map<string, {w:number;h:number}>; height: number; width: number }> = {
    core: { devs: [], sizes: new Map(), height: 0, width: 0 },
    distribution: { devs: [], sizes: new Map(), height: 0, width: 0 },
    access: { devs: [], sizes: new Map(), height: 0, width: 0 },
  };
  for (const d of devices) {
    const s = nodeSize(d);
    perBand[inferLayer(d)].devs.push(d);
    perBand[inferLayer(d)].sizes.set(d.id, { w: s.width, h: s.height });
  }

  // For each band, find max height/width of items in it (band thickness)
  const BAND_ORDER: (keyof typeof perBand)[] = ['core', 'distribution', 'access'];
  const BAND_INNER_PAD = 20;
  for (const layer of BAND_ORDER) {
    const b = perBand[layer];
    for (const d of b.devs) {
      const n = g.node(d.id);
      if (!n) continue;
      const s = b.sizes.get(d.id)!;
      b.height = Math.max(b.height, s.h);
      b.width  = Math.max(b.width, s.w);
    }
  }

  // v0.28: identify "anchor" nodes — devices that act as hubs (switch/router/
  // patch/server, OR anything with 2+ links in this subgraph). Every OTHER
  // access-layer device (AP/camera/PC/etc.) becomes a "leaf" that stacks in a
  // vertical column under its anchor. This gives the star topology from the
  // reference screenshot even inside a group where every device happens to
  // infer as "access" layer.
  const deviceIdSet = new Set(devices.map(d => d.id));
  // Count intra-subgraph links per device
  const linkCount = new Map<string, number>();
  for (const l of links) {
    if (!deviceIdSet.has(l.fromDeviceId) || !deviceIdSet.has(l.toDeviceId)) continue;
    linkCount.set(l.fromDeviceId, (linkCount.get(l.fromDeviceId) || 0) + 1);
    linkCount.set(l.toDeviceId, (linkCount.get(l.toDeviceId) || 0) + 1);
  }
  const isAnchor = (d: Device): boolean => {
    if (d.kind === 'switch' || d.kind === 'router' || d.kind === 'patchpanel' || d.kind === 'server') return true;
    if ((linkCount.get(d.id) || 0) >= 2) return true;
    return false;
  };
  const isLeaf = (d: Device): boolean => {
    if (isAnchor(d)) return false;
    // Leaves are endpoints — access-layer + typically 0-1 links
    return true;
  };

  const upstreamOf = new Map<string, string>();  // leaf.id → anchor.id
  for (const d of devices) {
    if (!isLeaf(d)) continue;
    for (const l of links) {
      if (l.fromDeviceId === d.id && deviceIdSet.has(l.toDeviceId)) {
        const other = devices.find(x => x.id === l.toDeviceId);
        if (other && isAnchor(other)) { upstreamOf.set(d.id, other.id); break; }
      }
      if (l.toDeviceId === d.id && deviceIdSet.has(l.fromDeviceId)) {
        const other = devices.find(x => x.id === l.fromDeviceId);
        if (other && isAnchor(other)) { upstreamOf.set(d.id, other.id); break; }
      }
    }
  }

  // Compute the horizontal position of each anchor from dagre — these are our
  // column centres for the leaves below.
  const anchorX = new Map<string, number>();
  for (const d of devices) {
    if (!isAnchor(d)) continue;
    const n = g.node(d.id);
    if (n) anchorX.set(d.id, n.x);
  }
  const useStar = anchorX.size > 0 && upstreamOf.size > 0;

  // Compute Y-start of each band
  const bandStart: Record<string, number> = {};
  {
    let cursor = 0;
    for (const layer of BAND_ORDER) {
      bandStart[layer] = cursor;
      cursor += perBand[layer].height + rankSep + BAND_INNER_PAD;
    }
  }

  // Access-band special layout: for each upstream switch, stack its endpoints
  // in a vertical column starting under it. Wrap into multiple sub-columns
  // when a switch has > MAX_PER_COLUMN endpoints.
  const MAX_PER_COLUMN = 4;
  const ENDPOINT_ROW_H = 130;   // vertical spacing between endpoint rows (was 100)
  const ENDPOINT_COL_W = 200;   // horizontal spacing between endpoint sub-columns (was 170)
  const accessPositions = new Map<string, { x: number; y: number }>();

  // v0.28: when star-layout is on, leaves start BELOW the anchor band with a
  // predictable gap so the "star" reads cleanly.
  const LEAVES_START_Y = useStar
    ? Math.max(160, perBand.core.height + perBand.distribution.height + 100)
    : bandStart.access;

  if (useStar && axis === 'y') {
    // Group leaves by their upstream anchor
    const byUpstream = new Map<string, Device[]>();
    const orphans: Device[] = [];
    for (const d of devices) {
      if (!isLeaf(d)) continue;
      const up = upstreamOf.get(d.id);
      if (up != null && anchorX.has(up)) {
        const arr = byUpstream.get(up) || [];
        arr.push(d);
        byUpstream.set(up, arr);
      } else {
        orphans.push(d);
      }
    }

    // For each upstream switch, position its endpoints starting under it
    for (const [upId, endpoints] of byUpstream.entries()) {
      const centreX = anchorX.get(upId)!;
      const cols = Math.ceil(endpoints.length / MAX_PER_COLUMN);
      // Center the sub-column bundle horizontally under the switch
      const totalW = (cols - 1) * ENDPOINT_COL_W;
      const startX = centreX - totalW / 2;
      endpoints.forEach((d, i) => {
        const col = Math.floor(i / MAX_PER_COLUMN);
        const row = i % MAX_PER_COLUMN;
        const s = nodeSize(d);
        const x = startX + col * ENDPOINT_COL_W - s.width / 2;
        const y = LEAVES_START_Y + row * ENDPOINT_ROW_H;
        accessPositions.set(d.id, { x, y });
      });
    }
    // v0.43.5: orphans (no known upstream) — used to be a single 4-row
    // vertical strip that stretched to 10 000 px+ for 200 devices from a
    // MikroTik ARP import. Now we lay them out on a proper grid:
    //   - GRID_COLS from store (0 = auto: ceil(sqrt(N)))
    //   - Each row = ENDPOINT_ROW_H, each col = ENDPOINT_COL_W
    //   - The bundle starts either to the right of the last anchor OR at
    //     x=0 if there are none, so it doesn't shift the whole scene.
    if (orphans.length > 0) {
      const anchorXs = Array.from(anchorX.values());
      const rightmost = anchorXs.length > 0 ? Math.max(...anchorXs) : 0;
      const startX = anchorXs.length > 0 ? rightmost + ENDPOINT_COL_W : 0;

      // Grid columns: user setting from store, or auto ~sqrt(N) capped at 20.
      let cols: number;
      try {
        const userCols = (useStore.getState() as any).orphanGridCols || 0;
        cols = userCols > 0
          ? userCols
          : Math.max(1, Math.min(20, Math.ceil(Math.sqrt(orphans.length))));
      } catch {
        cols = Math.max(1, Math.min(20, Math.ceil(Math.sqrt(orphans.length))));
      }

      orphans.forEach((d, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const s = nodeSize(d);
        accessPositions.set(d.id, {
          x: startX + col * ENDPOINT_COL_W - s.width / 2,
          y: LEAVES_START_Y + row * ENDPOINT_ROW_H,
        });
      });
    }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of devices) {
    const n = g.node(d.id);
    if (!n) continue;
    const s = nodeSize(d);
    const layer = inferLayer(d);
    const b = perBand[layer];
    let x: number, y: number;

    // Use the star position if we computed one (leaves under their anchor).
    const starPos = accessPositions.get(d.id);
    if (starPos) {
      x = starPos.x;
      y = starPos.y;
    } else if (useStar && isAnchor(d) && axis === 'y') {
      // Anchors always sit on the TOP band regardless of their inferred layer.
      x = n.x - s.width / 2;
      y = 0;
    } else if (axis === 'y') {
      x = n.x - s.width / 2;
      y = bandStart[layer] + (b.height - s.height) / 2;
    } else {
      // LR direction — swap axes: bands go vertically down the left
      x = bandStart[layer] + (b.height - s.width) / 2;
      y = n.y - s.height / 2;
    }
    outPositions.set(d.id, { x, y });
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + s.width  > maxX) maxX = x + s.width;
    if (y + s.height > maxY) maxY = y + s.height;
  }

  // Normalize so bounding box starts at (0, 0) — useful when this is a sub-layout inside a group
  if (returnBbox && isFinite(minX)) {
    for (const [id, p] of outPositions.entries()) {
      outPositions.set(id, { x: p.x - minX, y: p.y - minY });
    }
    return { width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
  }
  return undefined;
}
