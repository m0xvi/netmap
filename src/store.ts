import { create } from 'zustand';
import type { Device, Group, Link, NetMapDoc, StickyNote, StickyColor, Vlan } from './types';
import { usadbaSeed, donaSeed, chaikovskySeed } from './seed';

/** Single ping sample retained in the ring buffer for the sparkline. */
export interface PingSample {
  ts: number;              // epoch ms
  rttMs?: number;          // only set when alive
  alive: boolean;
}

/**
 * v0.35.6: unified notification / event entry — one type covers ping alerts,
 * app-level events (import completed, drag-connect done, error caught, etc.).
 * The AlertsButton in the toolbar shows a badge with unread count and lists
 * everything in reverse chronological order.
 */
/**
 * v0.36.1 — Пользовательские настройки нотификаций.
 * Хранится в localStorage под LS_NOTIFY_KEY отдельно от документа проекта:
 * это машинно-локальные настройки (bot token, прокси) которые не должны
 * ездить в export/import JSON вместе со схемой.
 */
export interface NotifSettings {
  inApp: boolean;                              // писать в notification centre
  windowsToast: boolean;                       // native Notification API (Chrome / Electron)
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  telegramProxyUrl: string;                    // http:// / socks5:// (для блокировок)
  minSeverity: 'critical' | 'warn' | 'info';   // фильтр — что отправлять во внешние каналы
}

export interface AlertEntry {
  id: string;              // unique event id
  ts: number;              // epoch ms
  /**
   * Severity — colours the row in the notification dropdown and the toolbar
   * badge. 'critical' = red badge, 'warn' = amber, 'info' / 'success' = blue/green.
   */
  severity?: 'critical' | 'warn' | 'info' | 'success';
  /** Where this event came from — used to filter / group later. */
  origin?: 'ping' | 'app' | 'error' | 'import' | 'export' | 'connect' | 'user';
  /** True once the user has seen the notification dropdown after this entry
   *  arrived. Drives the badge count. */
  read?: boolean;
  /** Optional device this notification is about (click to focus). */
  deviceId?: string;
  deviceName?: string;
  /** Ping-specific classification (kept for the ping monitor's existing UI). */
  kind?: 'up' | 'down' | 'flap' | 'event';
  message: string;
  /** Optional title above the message (used for app events / errors). */
  title?: string;
}

const PING_HISTORY_CAP = 288;   // 288 samples * 5min ≈ 24h
/** Stable empty Set reference — used as fallback so components with
 *  `useStore(s => s.hoveredTraceLinkIds)` don't re-render on every hover clear. */
const EMPTY_STR_SET: Set<string> = new Set();
const ALERTS_CAP = 100;

import {
  hasNativeBackend,
  persistLoadDoc, persistSaveDoc,
  persistLoadFilters, persistSaveFilters,
} from './persistence';
import { computeAutoLayout, type LayoutDirection } from './autoLayout';
// v0.32: when a device's display flips between compact ↔ rack its size can
// jump by 200+ px — nearby siblings suddenly overlap and cards may spill
// past the group border. Reflow after the update commits.
import { reflowGroupsForDevices } from './collide';
import { loadWorkspace, saveWorkspace, makeProject, type Workspace, type Project } from './workspace';
import { traceCable } from './traceCable';

export interface CtxMenuState {
  x: number; y: number;
  target:
    | { type: 'device'; id: string }
    | { type: 'group';  id: string }
    | { type: 'port';   deviceId: string; portId: string }
    | { type: 'sticky'; id: string };
}

export interface FilterState {
  /** map kind -> visible (missing = visible) */
  hiddenKinds: Set<string>;
  /** cable types visible on canvas */
  hiddenCables: Set<'copper' | 'fiber' | 'wifi'>;
  /** show only devices that have any PoE-active port */
  poeOnly: boolean;
  /** only devices whose tags include this string */
  tag: string | null;
  /** only devices whose any port has this VLAN, or whose links have it */
  vlan: number | null;
  /** hidden Cisco 3-tier layers */
  hiddenLayers: Set<'core' | 'distribution' | 'access'>;
}

const defaultFilters = (): FilterState => ({
  hiddenKinds: new Set(),
  hiddenCables: new Set(),
  poeOnly: false,
  tag: null,
  vlan: null,
  hiddenLayers: new Set(),
});

const LS_FILTERS = 'netmap:filters:v1';
const LS_NOTIFY  = 'netmap:notify';

/** Defaults for NotifSettings — inApp on, everything else off until user configures it. */
function defaultNotifSettings(): NotifSettings {
  return {
    inApp: true,
    windowsToast: false,
    telegramEnabled: false,
    telegramBotToken: '',
    telegramChatId: '',
    telegramProxyUrl: '',
    minSeverity: 'critical',
  };
}
function loadNotifSettings(): NotifSettings {
  try {
    const raw = localStorage.getItem(LS_NOTIFY);
    if (!raw) return defaultNotifSettings();
    return { ...defaultNotifSettings(), ...JSON.parse(raw) };
  } catch { return defaultNotifSettings(); }
}

function loadFilters(): FilterState {
  try {
    const raw = localStorage.getItem(LS_FILTERS);
    if (!raw) return defaultFilters();
    const parsed = JSON.parse(raw);
    return {
      hiddenKinds:  new Set<string>(parsed.hiddenKinds  ?? []),
      hiddenCables: new Set(parsed.hiddenCables ?? []) as Set<'copper'|'fiber'|'wifi'>,
      poeOnly: !!parsed.poeOnly,
      tag: parsed.tag ?? null,
      vlan: parsed.vlan ?? null,
      hiddenLayers: new Set(parsed.hiddenLayers ?? []) as Set<'core'|'distribution'|'access'>,
    };
  } catch {
    return defaultFilters();
  }
}

function persistFilters(f: FilterState) {
  const serial = {
    hiddenKinds:  Array.from(f.hiddenKinds),
    hiddenCables: Array.from(f.hiddenCables),
    poeOnly: f.poeOnly,
    tag: f.tag,
    vlan: f.vlan,
    hiddenLayers: Array.from(f.hiddenLayers),
  };
  try { localStorage.setItem(LS_FILTERS, JSON.stringify(serial)); } catch {}
  if (hasNativeBackend) persistSaveFilters(serial);
}

/** Count of active filter dimensions (for the badge on the layers icon). */
export function activeFilterCount(f: FilterState): number {
  return f.hiddenKinds.size + f.hiddenCables.size + f.hiddenLayers.size +
    (f.poeOnly ? 1 : 0) + (f.tag ? 1 : 0) + (f.vlan != null ? 1 : 0);
}

interface State {
  workspace: Workspace;
  /** Mirror of workspace.projects[activeId].doc for zero-friction reads. */
  doc: NetMapDoc;

  // ---- Projects (multi-schema workspace) ----
  switchProject: (id: string) => void;
  createProject: (name: string, fromExisting?: string) => string;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
  exportProject: (id: string) => string;         // JSON blob (single project)
  importProject: (json: string) => string | null; // returns new id or null
  selectedDeviceId: string | null;
  selectedGroupId: string | null;
  selectedPortId: string | null;
  /** Multi-select of device ids (superset of selectedDeviceId when > 1 selected) */
  multiSelectedIds: Set<string>;
  setMultiSelection: (ids: string[]) => void;

  /** Currently selected edge (cable) id — for the delete button overlay */
  selectedEdgeId: string | null;
  selectEdge: (id: string | null) => void;

  /** Focus mode — a single device is enlarged & centered, background dimmed */
  focusedDeviceId: string | null;
  focusDevice: (id: string | null) => void;

  /** Knife mode — cursor becomes a knife, any edge click cuts it */
  knifeMode: boolean;
  toggleKnifeMode: () => void;

  /** v0.34.1: version ticks pushed by the singleton port-side / edge-router
   *  caches. Components that need to react to routing changes select these
   *  from the store — much safer than per-instance subscribe listeners,
   *  which caused React error #185 on multi-select bulk operations. */
  portSidesVersion: number;
  edgeRouterVersion: number;
  bumpPortSidesVersion: (v: number) => void;
  bumpEdgeRouterVersion: (v: number) => void;

  /** Traceroute overlay: A + B, plus the resolved path (device ids). */
  pathA: string | null;
  pathB: string | null;
  pathIds: Set<string>;       // devices on the path
  pathLinkIds: Set<string>;   // links on the path
  pathSteps: PathStep[];      // ordered hop-by-hop breakdown
  setPathEndpoint: (which: 'a' | 'b', id: string | null) => void;
  clearPath: () => void;

  /** Undo/redo history (snapshots of `doc`) */
  history: NetMapDoc[];        // past states
  future:  NetMapDoc[];        // future states after undo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  highlightIds: Set<string>;
  /** Composite "deviceId:portId" key — currently highlighted port (from Port Matrix click). */
  highlightPortId: string | null;
  /** Highlighted link id — set together with highlightPortId to draw a glow on the cable. */
  highlightLinkId: string | null;
  setPortHighlight: (deviceId: string | null, portId: string | null) => void;

  /** Device the cursor is currently hovering over on the canvas (transient, not persisted). */
  hoveredDeviceId: string | null;
  setHoveredDevice: (id: string | null) => void;

  /** Composite `deviceId:portId` of the port the cursor is currently hovering
   *  on. Used to light up the whole cable path (including through patch panels). */
  hoveredPortKey: string | null;
  /** Derived: set of `deviceId:portId` keys involved in the trace from the
   *  hovered port. Updated by setHoveredPort — one traceCable per hover. */
  hoveredTracePortKeys: Set<string>;
  /** Derived: link ids that make up the trace from the hovered port. */
  hoveredTraceLinkIds: Set<string>;
  setHoveredPort: (deviceId: string | null, portId: string | null) => void;

  /** When true, non-related cables/nodes are dimmed on hover/select to help users
   *  trace which cables belong to the active device. Persisted to localStorage. */
  focusRelated: boolean;
  toggleFocusRelated: () => void;
  contextMenu: CtxMenuState | null;
  /** UI preferences */
  snapToGrid: boolean;
  showGrid: boolean;
  toggleSnap: () => void;
  toggleGrid: () => void;

  /**
   * v0.41: display mode for the topology canvas.
   *   'legacy' — original rack/compact device cards + one-node-per-endpoint
   *   'modern' — reference-style: rounded avatar cards, endpoint chips grouped
   *              inside their parent switch (Wi-Fi APs / IP Cameras / etc.)
   * Persisted in workspace so users don't lose the choice on reload.
   */
  viewMode: 'legacy' | 'modern';
  setViewMode: (m: 'legacy' | 'modern') => void;
  /**
   * v0.41: when true (modern mode), endpoints (cameras / APs / PCs / locks /
   * printers / POS terminals) are hidden from the canvas and shown only as
   * compact chip groups inside their upstream switch. When false — every
   * device is a standalone node like in legacy mode.
   */
  collapseEndpoints: boolean;
  toggleCollapseEndpoints: () => void;

  /**
   * v0.43.5: how many columns to use when auto-layout has to place many
   * "orphan" devices (no upstream switch link) — typical after a bulk
   * import from MikroTik/UniFi. 0 = auto (sqrt(N), capped by viewport).
   */
  orphanGridCols: number;
  setOrphanGridCols: (n: number) => void;

  /** v0.43.6: hide all edges on the canvas (useful for busy 200+ device maps). */
  hideEdges: boolean;
  toggleHideEdges: () => void;
  /**
   * v0.41: UI chrome visibility. By default (first launch) sidebar and
   * right panel are HIDDEN so the map takes the whole screen. Toolbar
   * stays on top for quick access. State persisted in localStorage.
   */
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  rightPanelOpen: boolean;
  toggleRightPanel: () => void;

  /** ---- Layer filters (v0.5) ---- */
  filters: FilterState;
  setKindVisibility: (kind: import('./types').DeviceKind, visible: boolean) => void;
  setCableVisibility: (cable: 'copper' | 'fiber' | 'wifi', visible: boolean) => void;
  setPoeOnly: (v: boolean) => void;
  setTagFilter: (tag: string | null) => void;
  setVlanFilter: (vlan: number | null) => void;
  setLayerVisibility: (layer: 'core' | 'distribution' | 'access', visible: boolean) => void;
  setFilters: (f: FilterState) => void;
  resetFilters: () => void;
  openContextMenu: (m: CtxMenuState) => void;
  closeContextMenu: () => void;
  select: (id: string | null) => void;
  selectGroup: (id: string | null) => void;
  selectPort: (deviceId: string, portId: string | null) => void;
  updatePort: (deviceId: string, portId: string, patch: Partial<import('./types').Port>) => void;
  addPort: (deviceId: string) => void;
  removePort: (deviceId: string, portId: string) => void;

  // devices
  updateDevice: (id: string, patch: Partial<Device>) => void;
  addDevice: (d: Device) => void;
  removeDevice: (id: string) => void;
  duplicateDevice: (id: string) => string | null;
  setPosition: (id: string, x: number, y: number, parentId?: string | null) => void;
  /** v0.35.5: batch-apply many position updates in ONE reducer call so
   *  React Flow / ResizeObserver / listeners fire only once per collision
   *  resolve. Previously N sequential setPosition calls in resolveCollisions
   *  caused N re-renders per drop; on rack cards this looked like flicker
   *  and sometimes drove ResizeObserver into a loop that blanked the scene. */
  applyPositions: (moves: Array<{ id: string; x: number; y: number; parentId?: string | null }>) => void;
  /** Toggle PoE-capability on the whole device: sets `poe` on every port. */
  togglePoeAll: (id: string) => void;

  /** Auto-arrange devices via dagre. Direction TB or LR. Writes to history. */
  autoLayout: (direction?: LayoutDirection, opts?: { preserveDisplay?: boolean }) => void;
  /** v0.31: expand/collapse EVERY rack-capable device at once.
   *  `mode='rack'`  → open every switch / router / patchpanel / server in rack view
   *  `mode='compact'` → collapse all of them back to compact cards */
  setAllRackDisplay: (mode: 'rack' | 'compact') => void;
  /**
   * Ping monitor: set runtime status on many devices at once WITHOUT touching history/persistence.
   * `liveStatus`, `lastRttMs`, `lastCheckedAt` are considered ephemeral.
   */
  applyPingResults: (updates: Array<{ id: string; liveStatus: 'up'|'down'|'checking'|'unknown'; lastRttMs?: number; lastCheckedAt?: number }>) => void;
  /** Ring buffer of ping samples per-device (kept in memory only, capped at 288 pts ≈ 24h @ 5min). */
  pingHistory: Record<string, PingSample[]>;
  /** Recent alerts (device status transitions), latest first, capped at 100. */
  alerts: AlertEntry[];
  clearAlerts: () => void;
  /** v0.35.6: push a single app-level notification (import done, error, connect
   *  created, etc.). Trimmed to ALERTS_CAP. Marks it unread by default. */
  pushAlert: (entry: Omit<AlertEntry, 'id' | 'ts' | 'read'> & Partial<Pick<AlertEntry, 'id' | 'ts'>>) => void;
  /** Mark ALL alerts as read (called when the user opens the notification
   *  dropdown). */
  markAllAlertsRead: () => void;
  /** Enable/disable the ping monitor (persisted). */
  monitorEnabled: boolean;
  setMonitorEnabled: (v: boolean) => void;
  monitorIntervalSec: number;
  setMonitorIntervalSec: (v: number) => void;

  /** v0.36.1 — notification settings (channels, Telegram, severity filter).
   *  Persisted to localStorage separately from the doc (per-machine, not per-project). */
  notifSettings: NotifSettings;
  updateNotifSettings: (patch: Partial<NotifSettings>) => void;

  // links
  addLink: (l: Link) => void;
  /** v0.44 — bulk-apply discovery diff (creates devices+links atomically, single undo). */
  applyDiscovery: (diff: {
    devices: Array<Partial<Device> & { id: string; name: string; kind: string }>;
    links: Array<Partial<Link> & { id: string; fromDeviceId: string; toDeviceId: string }>;
  }) => { addedDevices: number; addedLinks: number };
  removeLink: (id: string) => void;

  // sticky notes
  addSticky: (deviceId: string, text?: string, color?: StickyColor) => string;
  updateSticky: (id: string, patch: Partial<StickyNote>) => void;
  removeSticky: (id: string) => void;

  // groups
  addGroup: (g: Group) => void;
  updateGroup: (id: string, patch: Partial<Group>) => void;
  removeGroup: (id: string, opts?: { deleteChildren?: boolean }) => void;
  setGroupPosition: (id: string, x: number, y: number, parentId?: string | null) => void;

  // vlans (project-scoped, schema v3)
  addVlan: (v: Vlan) => void;
  updateVlan: (id: string, patch: Partial<Vlan>) => void;
  removeVlan: (id: string) => void;

  setHighlight: (ids: string[]) => void;
  exportJson: () => string;
  importJson: (json: string) => void;
  resetToSeed: () => void;
}

const LS_KEY = 'netmap:doc:v2';
const LS_KEY_V1 = 'netmap:doc:v1';

function migrateV1toV2(raw: any): NetMapDoc {
  return { ...raw, version: 2, groups: raw.groups ?? [] };
}

/** v2 → v3: add empty `vlans` array. Idempotent. */
function migrateV2toV3(raw: any): NetMapDoc {
  return { ...raw, version: 3, vlans: raw.vlans ?? [] };
}

/** Ensure every device has display/status/type defaults, even in v2 docs saved earlier. */
function normalize(doc: NetMapDoc): NetMapDoc {
  // Auto-bump v2 → v3 by ensuring vlans field exists
  if (!doc.vlans) doc = { ...doc, vlans: [], version: 3 };

  // v0.29: auto-heal for old docs (pre-v0.23) — cloud/ISP devices without a
  // group get gathered into a dedicated "Интернет" group at the top of the
  // canvas so they don't hang off in the void.
  const orphanClouds = doc.devices.filter(d => d.kind === 'cloud' && !d.groupId);
  const hasInternetGroup = (doc.groups || []).some(g => g.id === 'z-internet');
  if (orphanClouds.length >= 2 && !hasInternetGroup) {
    // Place the new group above the current bbox of all devices
    const minY = Math.min(0, ...doc.devices.map(d => d.y));
    const groups = [
      {
        id: 'z-internet', name: 'Интернет · Провайдеры',
        x: 0, y: minY - 220,
        width: Math.max(400, orphanClouds.length * 200),
        height: 140, color: '#94A3B8',
      },
      ...(doc.groups || []),
    ];
    const devices = doc.devices.map(d => {
      if (d.kind !== 'cloud' || d.groupId) return d;
      const idx = orphanClouds.findIndex(o => o.id === d.id);
      return { ...d, groupId: 'z-internet', x: 40 + idx * 180, y: 50 };
    });
    doc = { ...doc, groups, devices };
  }

  // v0.35.2: sanity-check every device position — v0.34.3 drag+reflow could
  // push a card to NaN / Infinity or far-negative coords, and with `extent:
  // 'parent'` React Flow then clamps it invisibly at (0,0) or off-screen,
  // making the user think the card was "deleted". Repair on load.
  // v0.35.4: also fix orphaned groupId (pointing at a group that no longer
  // exists) and rescue devices whose in-group coords would clip them.
  const groupById = new Map((doc.groups || []).map(g => [g.id, g]));
  const repairPosition = (d: typeof doc.devices[number]) => {
    // Orphaned groupId → drop the reference so the device shows on canvas
    // instead of vanishing under a non-existent parent.
    let groupId = d.groupId;
    if (groupId && !groupById.has(groupId)) groupId = null;
    const parent = groupId ? groupById.get(groupId) : null;
    let { x, y } = d;
    let fixed = groupId !== d.groupId;
    if (!Number.isFinite(x)) { x = parent ? 20 : 0; fixed = true; }
    if (!Number.isFinite(y)) { y = parent ? 48 : 0; fixed = true; }
    // Inside a group: coords are group-local. Header eats top ~44 px, keep
    // an 8 px margin. Clamp negatives to a safe cell.
    if (parent) {
      if (x < 8) { x = 20; fixed = true; }
      if (y < 48) { y = 52; fixed = true; }
      // Extremely far right/bottom (> 5000 px in-group) is almost certainly
      // corrupted — pull the card back to a safe spot so it becomes visible.
      if (x > 6000) { x = 20; fixed = true; }
      if (y > 6000) { y = 52; fixed = true; }
    } else {
      // Un-grouped: any coord in (-100000, 100000) is fine; only clip NaN.
      if (Math.abs(x) > 100000) { x = 0; fixed = true; }
      if (Math.abs(y) > 100000) { y = 0; fixed = true; }
    }
    return fixed ? { ...d, x, y, groupId } : d;
  };

  return {
    ...doc,
    stickies: doc.stickies ?? [],
    devices: doc.devices.map(d => {
      const repaired = repairPosition({
        ...d,
        // Every device now supports compact/expanded; default = compact
        display: d.display ?? 'compact',
        // v0.34.3: dedupe ports by id at load time — some documents on disk
        // accumulated duplicate port ids from old addPort() bug + MikroTik
        // re-import. Keeping the FIRST occurrence preserves user edits made
        // via the port matrix (which addresses ports by id and would target
        // the first one).
        ports: dedupePorts(d.ports).map(p => ({
          ...p,
          type: p.type ?? (p.id.startsWith('sfp') ? 'SFP' : 'RJ45'),
          status: p.status ?? 'down',
        })),
      });
      return repaired;
    })
  };
}

/** Return ports with duplicates by id removed (first occurrence wins). */
function dedupePorts<P extends { id: string }>(ports: P[]): P[] {
  const seen = new Set<string>();
  const out: P[] = [];
  for (const p of ports) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/** Add a device at an absolute or in-group point. Also toggles device.display. */


function loadInitialWorkspace(): Workspace {
  const ws = loadWorkspace(usadbaSeed);
  // On very first install, seed with all three sample hotels
  if (ws.projects.length === 1 && !localStorage.getItem('netmap:seeded-multi')) {
    ws.projects = [
      makeProject('Отель «Усадьба»',    usadbaSeed),
      makeProject('Отель «Дона»',       donaSeed),
      makeProject('Отель «Чайковский»', chaikovskySeed),
    ];
    ws.activeId = ws.projects[0].id;
    try { localStorage.setItem('netmap:seeded-multi', '1'); } catch {}
    saveWorkspace(ws);
  }
  // Normalize each doc
  ws.projects = ws.projects.map(p => ({ ...p, doc: normalize(p.doc) }));
  return ws;
}

function activeDoc(ws: Workspace): NetMapDoc {
  const p = ws.projects.find(x => x.id === ws.activeId);
  return p ? p.doc : (ws.projects[0]?.doc || usadbaSeed);
}

// Debounced save: coalesce bursts (dragging a node fires many updates).
// Saves the ENTIRE workspace (all projects), since a single doc mutation belongs
// to the active project which lives inside workspace.projects[].
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persistWorkspace(ws: Workspace) {
  saveWorkspace(ws);   // localStorage — synchronous, always up-to-date
  if (!hasNativeBackend) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // Native backend still holds a single doc for now (compat) — store active doc there
    persistSaveDoc(activeDoc(ws));
    saveTimer = null;
  }, 400);
}

/** Given a mutation on the ACTIVE doc, produce a new workspace with that doc replaced. */
function withActiveDoc(ws: Workspace, next: NetMapDoc): Workspace {
  const now = Date.now();
  return {
    ...ws,
    projects: ws.projects.map(p =>
      p.id === ws.activeId ? { ...p, doc: next, updatedAt: now } : p
    ),
  };
}

/**
 * Shim that keeps the existing `persist(doc)` call sites working: we take
 * the doc that a mutation just produced, sync it into the active project
 * of the current workspace snapshot, then debounce-save.
 *
 * NOTE: `withActiveDoc` needs the CURRENT workspace snapshot. The store's
 * `set((s) => …)` gives us `s.workspace` at mutation time.
 */
/**
 * Called from every mutation right before `return { doc }`. Piggy-backs onto the
 * store's own setState via a late-bound reference (set in `create` below).
 */
let storeRef: {
  getState: () => State;
  setState: (partial: Partial<State>) => void;
} | null = null;
function persist(doc: NetMapDoc) {
  if (!storeRef) return;
  const cur = storeRef.getState().workspace;
  const nextWs = withActiveDoc(cur, doc);
  storeRef.setState({ workspace: nextWs, doc } as Partial<State>);
  persistWorkspace(nextWs);
}

export interface PathStep {
  fromDeviceId: string;
  fromPortId?: string;
  toDeviceId: string;
  toPortId?: string;
  linkId?: string;              // undefined for synthetic VM↔host edges
  cable?: 'copper' | 'fiber' | 'wifi';
}

/** BFS shortest path over the physical + host graph. Returns node ids, link ids and ordered steps. */
function shortestPath(doc: NetMapDoc, srcId: string, dstId: string): { nodes: Set<string>; links: Set<string>; steps: PathStep[] } {
  // Build adjacency: nodeId -> [{ neighbor, linkId?, port pair? }]
  interface AdjEntry { neighbor: string; linkId?: string; fromPort?: string; toPort?: string; cable?: 'copper'|'fiber'|'wifi' }
  const adj = new Map<string, AdjEntry[]>();
  const push = (a: string, entry: AdjEntry) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(entry);
  };
  for (const l of doc.links) {
    push(l.fromDeviceId, { neighbor: l.toDeviceId,   linkId: l.id, fromPort: l.fromPortId, toPort: l.toPortId, cable: l.cable });
    push(l.toDeviceId,   { neighbor: l.fromDeviceId, linkId: l.id, fromPort: l.toPortId,   toPort: l.fromPortId, cable: l.cable });
  }
  for (const d of doc.devices) {
    if (d.kind === 'vm' && d.hostDeviceId) {
      push(d.id, { neighbor: d.hostDeviceId });
      push(d.hostDeviceId, { neighbor: d.id });
    }
  }

  // BFS with parent-tracking
  const parent = new Map<string, { from: string; entry: AdjEntry }>();
  const queue: string[] = [srcId];
  const visited = new Set<string>([srcId]);
  let found = false;
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === dstId) { found = true; break; }
    for (const e of adj.get(cur) || []) {
      if (visited.has(e.neighbor)) continue;
      visited.add(e.neighbor);
      parent.set(e.neighbor, { from: cur, entry: e });
      queue.push(e.neighbor);
    }
  }

  const nodes = new Set<string>();
  const links = new Set<string>();
  const stepsRev: PathStep[] = [];
  if (!found) return { nodes, links, steps: [] };

  let cur = dstId;
  nodes.add(cur);
  while (cur !== srcId) {
    const p = parent.get(cur);
    if (!p) break;
    if (p.entry.linkId) links.add(p.entry.linkId);
    stepsRev.push({
      fromDeviceId: p.from,
      fromPortId:   p.entry.fromPort,
      toDeviceId:   cur,
      toPortId:     p.entry.toPort,
      linkId:       p.entry.linkId,
      cable:        p.entry.cable,
    });
    cur = p.from;
    nodes.add(cur);
  }
  return { nodes, links, steps: stepsRev.reverse() };
}

const HISTORY_LIMIT = 50;
/**
 * Coalescing window: rapid changes within this window (e.g. dragging a node)
 * share the same history entry so undo doesn't have to click 30 times to undo one drag.
 */
const HISTORY_COALESCE_MS = 400;
let lastHistoryPushAt = 0;

/**
 * Push `previousDoc` (the doc BEFORE the change) into the history stack.
 * Returns updated history/future arrays.
 */
function historyPush(state: { history: NetMapDoc[]; future: NetMapDoc[]; doc: NetMapDoc }) {
  const now = Date.now();
  const coalesce = (now - lastHistoryPushAt) < HISTORY_COALESCE_MS && state.history.length > 0;
  lastHistoryPushAt = now;
  if (coalesce) {
    // Don't push another entry — keep the existing top as the pre-burst state
    return { history: state.history, future: [] as NetMapDoc[] };
  }
  const history = state.history.concat([state.doc]);
  if (history.length > HISTORY_LIMIT) history.shift();
  return { history, future: [] as NetMapDoc[] };
}

/**
 * Called once from App.tsx on mount when hasNativeBackend is true.
 * Pulls the authoritative doc from SQLite and swaps it into the store.
 */
export async function hydrateFromNativeBackend(): Promise<void> {
  if (!hasNativeBackend) return;
  try {
    const doc = await persistLoadDoc();
    if (doc) useStore.setState({ doc: normalize(doc as NetMapDoc) });
    const f = await persistLoadFilters();
    if (f) {
      useStore.setState({
        filters: {
          hiddenKinds:  new Set<string>(f.hiddenKinds ?? []),
          hiddenCables: new Set(f.hiddenCables ?? []) as Set<'copper'|'fiber'|'wifi'>,
          poeOnly: !!f.poeOnly,
          tag: f.tag ?? null,
          vlan: f.vlan ?? null,
          hiddenLayers: new Set(f.hiddenLayers ?? []) as Set<'core'|'distribution'|'access'>,
        }
      });
    }
  } catch {}
}

export const useStore = create<State>((set, get) => ({
  workspace: (() => { const ws = loadInitialWorkspace(); return ws; })(),
  doc: (() => { const ws = loadInitialWorkspace(); return activeDoc(ws); })(),

  switchProject: (id: string) => set((s) => {
    if (!s.workspace.projects.some((p: Project) => p.id === id)) return {};
    const nextWs: Workspace = { ...s.workspace, activeId: id };
    saveWorkspace(nextWs);
    return {
      workspace: nextWs,
      doc: activeDoc(nextWs),
      selectedDeviceId: null, selectedGroupId: null, selectedPortId: null,
      multiSelectedIds: new Set(),
      history: [], future: [],
      pathA: null, pathB: null, pathIds: new Set(), pathLinkIds: new Set(), pathSteps: [],
    };
  }),
  createProject: (name: string, fromExisting?: string): string => {
    const s = get();
    const src = fromExisting ? s.workspace.projects.find((p: Project) => p.id === fromExisting)?.doc : null;
    const newDoc: NetMapDoc = src
      ? JSON.parse(JSON.stringify(src))
      : { version: 3, name, groups: [], devices: [], links: [], stickies: [], vlans: [] };
    newDoc.name = name;
    const p = makeProject(name, newDoc);
    const nextWs: Workspace = { ...s.workspace, projects: [...s.workspace.projects, p], activeId: p.id };
    saveWorkspace(nextWs);
    set({
      workspace: nextWs,
      doc: p.doc,
      selectedDeviceId: null, selectedGroupId: null, selectedPortId: null,
      multiSelectedIds: new Set(),
      history: [], future: [],
    });
    return p.id;
  },
  renameProject: (id: string, name: string) => set((s) => {
    const nextWs: Workspace = {
      ...s.workspace,
      projects: s.workspace.projects.map((p: Project) => p.id === id ? { ...p, name, doc: { ...p.doc, name } } : p),
    };
    saveWorkspace(nextWs);
    return { workspace: nextWs, doc: activeDoc(nextWs) };
  }),
  deleteProject: (id: string) => set((s) => {
    if (s.workspace.projects.length <= 1) return {};
    const remaining = s.workspace.projects.filter((p: Project) => p.id !== id);
    const activeId = s.workspace.activeId === id ? remaining[0].id : s.workspace.activeId;
    const nextWs: Workspace = { ...s.workspace, projects: remaining, activeId };
    saveWorkspace(nextWs);
    return { workspace: nextWs, doc: activeDoc(nextWs), history: [], future: [] };
  }),
  exportProject: (id: string): string => {
    const s = get();
    const p = s.workspace.projects.find((x: Project) => x.id === id);
    if (!p) return '';
    return JSON.stringify({ version: 1, project: p }, null, 2);
  },
  importProject: (json: string): string | null => {
    try {
      const parsed = JSON.parse(json);
      const importedDoc: NetMapDoc = parsed.project?.doc || parsed.doc || parsed;
      if (!importedDoc.devices) return null;
      const p = makeProject(importedDoc.name || 'Импорт', normalize(importedDoc));
      const s = get();
      const nextWs: Workspace = { ...s.workspace, projects: [...s.workspace.projects, p], activeId: p.id };
      saveWorkspace(nextWs);
      set({
        workspace: nextWs, doc: p.doc,
        selectedDeviceId: null, selectedGroupId: null, selectedPortId: null,
        multiSelectedIds: new Set(),
        history: [], future: [],
      });
      return p.id;
    } catch {
      return null;
    }
  },
  selectedDeviceId: null,
  selectedGroupId: null,
  selectedPortId: null,
  multiSelectedIds: new Set<string>(),
  selectedEdgeId: null,
  selectEdge: (id) => set({ selectedEdgeId: id }),
  focusedDeviceId: null,
  focusDevice: (id) => set({ focusedDeviceId: id }),
  knifeMode: false,
  toggleKnifeMode: () => set(s => ({ knifeMode: !s.knifeMode })),

  // v0.34.1: version ticks for routing caches (see interface docs).
  portSidesVersion: 0,
  edgeRouterVersion: 0,
  bumpPortSidesVersion: (v) => set(s => s.portSidesVersion === v ? {} : { portSidesVersion: v }),
  bumpEdgeRouterVersion: (v) => set(s => s.edgeRouterVersion === v ? {} : { edgeRouterVersion: v }),
  setMultiSelection: (ids) => set((s) => {
    // Skip update if the selection didn't actually change — otherwise we create a new Set
    // instance on every render and drive React Flow into an infinite render loop.
    if (ids.length === s.multiSelectedIds.size &&
        ids.every(id => s.multiSelectedIds.has(id))) {
      return {};
    }
    return { multiSelectedIds: new Set(ids) };
  }),

  pathA: null, pathB: null,
  pathIds: new Set<string>(),
  pathLinkIds: new Set<string>(),
  pathSteps: [] as PathStep[],
  setPathEndpoint: (which, id) => set(s => {
    const pathA = which === 'a' ? id : s.pathA;
    const pathB = which === 'b' ? id : s.pathB;
    if (!pathA || !pathB || pathA === pathB) {
      return { pathA, pathB, pathIds: new Set(), pathLinkIds: new Set(), pathSteps: [] };
    }
    const { nodes, links, steps } = shortestPath(s.doc, pathA, pathB);
    return { pathA, pathB, pathIds: nodes, pathLinkIds: links, pathSteps: steps };
  }),
  clearPath: () => set({ pathA: null, pathB: null, pathIds: new Set(), pathLinkIds: new Set(), pathSteps: [] }),

  history: [] as NetMapDoc[],
  future:  [] as NetMapDoc[],
  undo: () => set(s => {
    if (s.history.length === 0) return {};
    const prev = s.history[s.history.length - 1];
    const history = s.history.slice(0, -1);
    const future = [s.doc, ...s.future].slice(0, HISTORY_LIMIT);
    lastHistoryPushAt = 0; // ensure the next real change coalesces separately
    persist(prev);
    return { doc: prev, history, future };
  }),
  redo: () => set(s => {
    if (s.future.length === 0) return {};
    const next = s.future[0];
    const future = s.future.slice(1);
    const history = s.history.concat([s.doc]).slice(-HISTORY_LIMIT);
    lastHistoryPushAt = 0;
    persist(next);
    return { doc: next, history, future };
  }),
  canUndo: () => get().history.length > 0,
  canRedo: () => get().future.length > 0,

  highlightIds: new Set(),
  highlightPortId: null,
  highlightLinkId: null,

  hoveredDeviceId: null,
  setHoveredDevice: (id) => {
    // Guard: only set if actually different — avoids extra renders.
    if (get().hoveredDeviceId !== id) set({ hoveredDeviceId: id });
  },
  hoveredPortKey: null,
  hoveredTracePortKeys: EMPTY_STR_SET,
  hoveredTraceLinkIds: EMPTY_STR_SET,
  setHoveredPort: (deviceId, portId) => {
    const key = deviceId && portId ? `${deviceId}:${portId}` : null;
    if (get().hoveredPortKey === key) return;
    if (!key || !deviceId || !portId) {
      set({
        hoveredPortKey: null,
        hoveredTracePortKeys: EMPTY_STR_SET,
        hoveredTraceLinkIds: EMPTY_STR_SET,
      });
      return;
    }
    // v0.26: compute the full cable trace (through patch panels) once per hover.
    const trace = traceCable(get().doc, deviceId, portId);
    set({
      hoveredPortKey: key,
      hoveredTracePortKeys: trace.portKeys,
      hoveredTraceLinkIds: trace.linkIds,
    });
  },
  focusRelated: (() => {
    try { const v = localStorage.getItem('netmap:focusRelated'); return v == null ? true : v === '1'; }
    catch { return true; }
  })(),
  toggleFocusRelated: () => set(s => {
    const next = !s.focusRelated;
    try { localStorage.setItem('netmap:focusRelated', next ? '1' : '0'); } catch {}
    return { focusRelated: next };
  }),

  contextMenu: null,

  pingHistory: {},
  alerts: [],
  clearAlerts: () => set({ alerts: [] }),
  pushAlert: (entry) => set((s) => {
    const full: AlertEntry = {
      id: entry.id || `al-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ts: entry.ts || Date.now(),
      read: false,
      severity: entry.severity || 'info',
      origin: entry.origin || 'app',
      message: entry.message,
      title: entry.title,
      deviceId: entry.deviceId,
      deviceName: entry.deviceName,
      kind: entry.kind,
    };
    const next = [full, ...s.alerts].slice(0, ALERTS_CAP);
    return { alerts: next };
  }),
  markAllAlertsRead: () => set((s) => {
    if (!s.alerts.some(a => !a.read)) return {};
    return { alerts: s.alerts.map(a => a.read ? a : { ...a, read: true }) };
  }),

  applyPingResults: (updates) => set(s => {
    if (updates.length === 0) return {};
    const byId = new Map(updates.map(u => [u.id, u]));
    const now = Date.now();

    // 1) Update device.liveStatus (runtime, not persisted)
    const devices = s.doc.devices.map(d => {
      const u = byId.get(d.id);
      if (!u) return d;
      return { ...d, liveStatus: u.liveStatus, lastRttMs: u.lastRttMs, lastCheckedAt: u.lastCheckedAt };
    });

    // 2) Append to ring buffer + collect alerts for up/down transitions.
    // We skip 'checking' probes (only real up/down get recorded).
    const nextHistory = { ...s.pingHistory };
    const newAlerts: AlertEntry[] = [];
    const priorById = new Map(s.doc.devices.map(d => [d.id, d]));
    for (const u of updates) {
      if (u.liveStatus !== 'up' && u.liveStatus !== 'down') continue;
      const prior = priorById.get(u.id);
      const priorStatus = prior?.liveStatus;
      const arr = (nextHistory[u.id] || []).concat({
        ts: u.lastCheckedAt || now,
        rttMs: u.lastRttMs,
        alive: u.liveStatus === 'up',
      });
      // Cap to the last N samples
      nextHistory[u.id] = arr.length > PING_HISTORY_CAP ? arr.slice(-PING_HISTORY_CAP) : arr;

      // Transition-based alert (only if we had a prior real status different from now)
      if (priorStatus === 'up' && u.liveStatus === 'down') {
        newAlerts.push({
          id: `alert-${u.id}-${now}`, ts: now,
          deviceId: u.id, deviceName: prior?.name || u.id,
          kind: 'down',
          severity: 'critical', origin: 'ping', read: false,
          title: 'Устройство не отвечает',
          message: `${prior?.name || u.id} перестал отвечать${prior?.ip ? ` (${prior.ip})` : ''}`,
        });
      } else if (priorStatus === 'down' && u.liveStatus === 'up') {
        newAlerts.push({
          id: `alert-${u.id}-${now}`, ts: now,
          deviceId: u.id, deviceName: prior?.name || u.id,
          kind: 'up',
          severity: 'success', origin: 'ping', read: false,
          title: 'Связь восстановлена',
          message: `${prior?.name || u.id} восстановил связь${u.lastRttMs != null ? ` (${u.lastRttMs}ms)` : ''}`,
        });
      }
    }

    const nextAlerts = newAlerts.length > 0
      ? [...newAlerts, ...s.alerts].slice(0, ALERTS_CAP)
      : s.alerts;

    return {
      doc: { ...s.doc, devices },
      pingHistory: nextHistory,
      alerts: nextAlerts,
    };
  }),
  monitorEnabled: (() => {
    try { return localStorage.getItem('netmap:monitor:enabled') === '1'; } catch { return false; }
  })(),
  setMonitorEnabled: (v) => {
    try { localStorage.setItem('netmap:monitor:enabled', v ? '1' : '0'); } catch {}
    set({ monitorEnabled: v });
  },
  monitorIntervalSec: (() => {
    try { return parseInt(localStorage.getItem('netmap:monitor:interval') || '30', 10); } catch { return 30; }
  })(),
  setMonitorIntervalSec: (v) => {
    const clamped = Math.max(5, Math.min(600, v));
    try { localStorage.setItem('netmap:monitor:interval', String(clamped)); } catch {}
    set({ monitorIntervalSec: clamped });
  },

  notifSettings: loadNotifSettings(),
  updateNotifSettings: (patch) => set(s => {
    const next = { ...s.notifSettings, ...patch };
    try { localStorage.setItem('netmap:notify', JSON.stringify(next)); } catch {}
    return { notifSettings: next };
  }),

  snapToGrid: true,
  viewMode: (typeof window !== 'undefined' && (localStorage.getItem('netmap:viewMode') as any)) || 'legacy',
  setViewMode: (m) => {
    try { localStorage.setItem('netmap:viewMode', m); } catch {}
    set({ viewMode: m });
  },
  collapseEndpoints: (typeof window !== 'undefined' && localStorage.getItem('netmap:collapseEndpoints') === '1'),
  toggleCollapseEndpoints: () => set(s => {
    const next = !s.collapseEndpoints;
    try { localStorage.setItem('netmap:collapseEndpoints', next ? '1' : '0'); } catch {}
    return { collapseEndpoints: next };
  }),
  // v0.43.5 — orphan-grid columns for auto-layout of unlinked bulk imports.
  orphanGridCols: (() => {
    if (typeof window === 'undefined') return 0;
    try { return Number(localStorage.getItem('netmap:orphanGridCols') || 0); } catch { return 0; }
  })(),
  setOrphanGridCols: (n: number) => {
    try { localStorage.setItem('netmap:orphanGridCols', String(n)); } catch {}
    set({ orphanGridCols: n });
  },
  hideEdges: (typeof window !== 'undefined' && localStorage.getItem('netmap:hideEdges') === '1'),
  toggleHideEdges: () => set(s => {
    const next = !s.hideEdges;
    try { localStorage.setItem('netmap:hideEdges', next ? '1' : '0'); } catch {}
    return { hideEdges: next };
  }),
  // v0.41: sidebar & right-panel default to CLOSED (map takes whole viewport).
  // '0' = closed, '1' = open. Persisted in localStorage so user's choice sticks.
  sidebarOpen: (typeof window !== 'undefined' && localStorage.getItem('netmap:sidebarOpen') === '1'),
  toggleSidebar: () => set(s => {
    const next = !s.sidebarOpen;
    try { localStorage.setItem('netmap:sidebarOpen', next ? '1' : '0'); } catch {}
    return { sidebarOpen: next };
  }),
  rightPanelOpen: (typeof window !== 'undefined' && localStorage.getItem('netmap:rightPanelOpen') === '1'),
  toggleRightPanel: () => set(s => {
    const next = !s.rightPanelOpen;
    try { localStorage.setItem('netmap:rightPanelOpen', next ? '1' : '0'); } catch {}
    return { rightPanelOpen: next };
  }),
  showGrid: true,
  toggleSnap: () => set(s => ({ snapToGrid: !s.snapToGrid })),
  toggleGrid: () => set(s => ({ showGrid: !s.showGrid })),

  filters: loadFilters(),
  setKindVisibility: (kind, visible) => set(s => {
    const hidden = new Set(s.filters.hiddenKinds);
    if (visible) hidden.delete(kind); else hidden.add(kind);
    const filters = { ...s.filters, hiddenKinds: hidden };
    persistFilters(filters);
    return { filters };
  }),
  setCableVisibility: (cable, visible) => set(s => {
    const hidden = new Set(s.filters.hiddenCables);
    if (visible) hidden.delete(cable); else hidden.add(cable);
    const filters = { ...s.filters, hiddenCables: hidden };
    persistFilters(filters);
    return { filters };
  }),
  setPoeOnly: (v) => set(s => {
    const filters = { ...s.filters, poeOnly: v };
    persistFilters(filters);
    return { filters };
  }),
  setTagFilter: (tag) => set(s => {
    const filters = { ...s.filters, tag };
    persistFilters(filters);
    return { filters };
  }),
  setVlanFilter: (vlan) => set(s => {
    const filters = { ...s.filters, vlan };
    persistFilters(filters);
    return { filters };
  }),
  setLayerVisibility: (layer, visible) => set(s => {
    const hidden = new Set(s.filters.hiddenLayers);
    if (visible) hidden.delete(layer); else hidden.add(layer);
    const filters = { ...s.filters, hiddenLayers: hidden };
    persistFilters(filters);
    return { filters };
  }),
  setFilters: (f) => { persistFilters(f); set({ filters: f }); },
  resetFilters: () => {
    const f = defaultFilters();
    persistFilters(f);
    set({ filters: f });
  },
  openContextMenu: (m) => set({ contextMenu: m }),
  closeContextMenu: () => set({ contextMenu: null }),

  select: (id) => set({ selectedDeviceId: id, selectedGroupId: null, selectedPortId: null }),
  selectGroup: (id) => set({ selectedGroupId: id, selectedDeviceId: null, selectedPortId: null }),
  selectPort: (deviceId, portId) => set({
    selectedDeviceId: deviceId, selectedGroupId: null, selectedPortId: portId
  }),
  updatePort: (deviceId, portId, patch) => set((s) => {
    const doc = {
      ...s.doc,
      devices: s.doc.devices.map(d =>
        d.id !== deviceId ? d :
        { ...d, ports: d.ports.map(p => p.id === portId ? { ...p, ...patch } : p) })
    };
    persist(doc); return { ...historyPush(s), doc };
  }),
  addPort: (deviceId) => set((s) => {
    const doc = {
      ...s.doc,
      devices: s.doc.devices.map(d => {
        if (d.id !== deviceId) return d;
        // v0.34.3: find the next FREE ethN slot instead of `length+1`. If
        // ports had been deleted in the middle (eth3 removed → array has
        // eth1/2/4/5), length+1 = eth5 = duplicate. That duplicate broke
        // hover-highlight ("two ports light up") and cable traces.
        const usedIds = new Set(d.ports.map(p => p.id));
        let n = 1;
        while (usedIds.has(`eth${n}`)) n++;
        return { ...d, ports: [...d.ports, {
          id: `eth${n}`, label: '', type: 'RJ45' as const, speed: '1G' as const, status: 'down' as const
        }]};
      })
    };
    persist(doc); return { ...historyPush(s), doc };
  }),
  removePort: (deviceId, portId) => set((s) => {
    const doc = {
      ...s.doc,
      devices: s.doc.devices.map(d => d.id !== deviceId ? d : { ...d, ports: d.ports.filter(p => p.id !== portId) }),
      // also remove any links using this port
      links: s.doc.links.filter(l =>
        !(l.fromDeviceId === deviceId && l.fromPortId === portId) &&
        !(l.toDeviceId === deviceId && l.toPortId === portId)
      )
    };
    persist(doc); return { ...historyPush(s), doc };
  }),

  updateDevice: (id, patch) => set((s) => {
    const prev = s.doc.devices.find(d => d.id === id);
    const doc = { ...s.doc, devices: s.doc.devices.map(d => d.id === id ? { ...d, ...patch } : d) };
    persist(doc);
    // v0.32: display toggle changes the card's size — reflow the group so
    // siblings don't overlap and the group grows to fit.
    if (patch.display && prev && prev.display !== patch.display) {
      reflowGroupsForDevices([id]);
    }
    return { ...historyPush(s), doc };
  }),
  addDevice: (d) => set((s) => {
    const doc = { ...s.doc, devices: [...s.doc.devices, d] };
    persist(doc); return { ...historyPush(s), doc };
  }),
  removeDevice: (id) => set((s) => {
    const doc = {
      ...s.doc,
      devices: s.doc.devices
        .filter(d => d.id !== id)
        .map(d => d.hostDeviceId === id ? { ...d, hostDeviceId: null } : d),
      links: s.doc.links.filter(l => l.fromDeviceId !== id && l.toDeviceId !== id),
      stickies: (s.doc.stickies || []).filter(n => n.deviceId !== id)
    };
    persist(doc); return { ...historyPush(s), doc, selectedDeviceId: null };
  }),
  duplicateDevice: (id) => {
    const state = get();
    const src = state.doc.devices.find(d => d.id === id);
    if (!src) return null;
    const newId = `${src.kind}-${Math.random().toString(36).slice(2, 7)}`;
    const copy: Device = {
      ...src,
      id: newId,
      name: `${src.name} (копия)`,
      x: src.x + 40, y: src.y + 40,
      // Deep-copy nested arrays/objects
      ports: src.ports.map(p => ({ ...p })),
      credential: src.credential ? { ...src.credential } : undefined,
      tags: src.tags ? [...src.tags] : undefined,
      vmInfo: src.vmInfo ? { ...src.vmInfo } : undefined,
    };
    set((s) => {
      const doc = { ...s.doc, devices: [...s.doc.devices, copy] };
      persist(doc); return { ...historyPush(s), doc, selectedDeviceId: newId };
    });
    return newId;
  },
  togglePoeAll: (id) => set((s) => {
    const dev = s.doc.devices.find(d => d.id === id);
    if (!dev) return {};
    const anyPoe = dev.ports.some(p => p.poe);
    const doc = {
      ...s.doc,
      devices: s.doc.devices.map(d => d.id !== id ? d : {
        ...d, ports: d.ports.map(p => ({
          ...p,
          poe: !anyPoe,
          // If turning off, also drop poeActive
          poeActive: anyPoe ? false : p.poeActive
        }))
      })
    };
    persist(doc); return { ...historyPush(s), doc };
  }),
  setAllRackDisplay: (mode) => set((s) => {
    const changed: string[] = [];
    const devices = s.doc.devices.map(d => {
      if (d.kind === 'switch' || d.kind === 'router' || d.kind === 'patchpanel' || d.kind === 'server') {
        if (d.display !== mode) changed.push(d.id);
        return { ...d, display: mode };
      }
      return d;
    });
    const doc = { ...s.doc, devices };
    persist(doc);
    // v0.32: bulk expand/collapse — reflow every affected group so nothing
    // overlaps and groups grow to fit the new sizes.
    if (changed.length) reflowGroupsForDevices(changed);
    return { ...historyPush(s), doc };
  }),

  autoLayout: (direction = 'TB', opts?: { preserveDisplay?: boolean }) => set((s) => {
    // v0.34.3: added `preserveDisplay` option — when true, we DON'T force
    // rack → compact before layout. Used by setAllRackDisplay('rack') so a
    // fresh "Развернуть все" isn't immediately undone by the auto-collapse.
    //
    // v0.30 default behaviour: collapse all rack-view switches/routers to
    // compact before layout. Rack-view is huge (400+ px wide) and stacks
    // poorly when a group has many switches. Users can still expand any
    // device manually (◱ button or ports tab) — this only affects the tidy
    // overview state right after "Разложить".
    const compacted = opts?.preserveDisplay
      ? s.doc
      : {
          ...s.doc,
          devices: s.doc.devices.map(d =>
            (d.kind === 'switch' || d.kind === 'router' || d.kind === 'patchpanel' || d.kind === 'server')
              && d.display === 'rack'
              ? { ...d, display: 'compact' as const }
              : d
          ),
        };
    const { positions, groupPositions } = computeAutoLayout(compacted, { direction });
    if (positions.size === 0 && groupPositions.size === 0) return {};
    // v0.35.8: NEVER commit non-finite coords from autoLayout — a corner-case
    // in star-layout (endpoint-only group with no anchors) used to produce
    // -Infinity → NaN → the endpoint vanished forever from the scene.
    const safeFinite = (v: number, fallback: number) => Number.isFinite(v) ? v : fallback;
    const devices = compacted.devices.map(d => {
      const p = positions.get(d.id);
      if (!p) return d;
      return {
        ...d,
        x: safeFinite(p.x, d.x),
        y: safeFinite(p.y, d.y),
      };
    });
    const groups = (compacted.groups || []).map(g => {
      const p = groupPositions.get(g.id);
      if (!p) return g;
      return {
        ...g,
        x: safeFinite(p.x, g.x),
        y: safeFinite(p.y, g.y),
        width:  safeFinite(p.width,  g.width),
        height: safeFinite(p.height, g.height),
      };
    });
    const doc = { ...compacted, devices, groups };
    persist(doc);
    // Notify Canvas to fit-view after react-flow has re-rendered the new positions
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => requestAnimationFrame(() =>
        window.dispatchEvent(new CustomEvent('netmap:layout-applied'))
      ));
    }
    return { ...historyPush(s), doc };
  }),
  setPosition: (id, x, y, parentId) => set((s) => {
    // v0.35.4: reject NaN / Infinity outright — otherwise a garbage coord
    // sneaks into `doc.devices`, React Flow's `extent:'parent'` clips the
    // node invisibly, and it looks like the card was "deleted". Better to
    // no-op and keep the previous position than to corrupt the doc.
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      // eslint-disable-next-line no-console
      console.warn('[netmap] setPosition rejected non-finite coords', { id, x, y });
      return {};
    }
    const doc = {
      ...s.doc,
      devices: s.doc.devices.map(d =>
        d.id === id ? { ...d, x, y, ...(parentId !== undefined ? { groupId: parentId } : {}) } : d
      )
    };
    persist(doc); return { ...historyPush(s), doc };
  }),
  applyPositions: (moves) => set((s) => {
    if (!moves.length) return {};
    // Sanitize
    const clean = moves.filter(m => Number.isFinite(m.x) && Number.isFinite(m.y));
    if (!clean.length) return {};
    const byId = new Map(clean.map(m => [m.id, m]));
    const devices = s.doc.devices.map(d => {
      const m = byId.get(d.id);
      if (!m) return d;
      return { ...d, x: m.x, y: m.y, ...(m.parentId !== undefined ? { groupId: m.parentId } : {}) };
    });
    const doc = { ...s.doc, devices };
    persist(doc); return { ...historyPush(s), doc };
  }),

  addLink: (l) => set((s) => {
    const doc = { ...s.doc, links: [...s.doc.links, l] };
    persist(doc); return { ...historyPush(s), doc };
  }),

  // v0.44 — bulk-apply auto-discovery results in a SINGLE undo step.
  // Rejects duplicates (device id / link (from,to) pair) so re-running scan is safe.
  applyDiscovery: (diff) => {
    let addedDevices = 0, addedLinks = 0;
    set((s) => {
      const existingIds = new Set(s.doc.devices.map(d => d.id));
      const nextDevices = [...s.doc.devices];
      // Place discovered orphans in a grid below existing content
      const maxY = s.doc.devices.reduce((m, d) => Math.max(m, (d.y || 0)), 0);
      const startY = maxY + 240;
      const cols = 8;
      let idx = 0;
      for (const dev of (diff.devices || [])) {
        if (!dev || !dev.id || existingIds.has(dev.id)) continue;
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        idx++;
        const placed: Device = {
          id: dev.id,
          name: dev.name || dev.id,
          kind: (dev.kind as any) || 'pc',
          model: dev.model,
          vendor: dev.vendor,
          ip: dev.ip,
          mac: dev.mac,
          location: dev.location,
          ports: Array.isArray(dev.ports) && dev.ports.length ? (dev.ports as any) : [
            { id: 'eth1', label: 'eth1', type: 'RJ45' as any },
          ],
          tags: Array.isArray(dev.tags) ? [...dev.tags, 'discovered'] : ['discovered'],
          x: 40 + col * 220,
          y: startY + row * 160,
          display: 'compact',
        };
        nextDevices.push(placed);
        existingIds.add(placed.id);
        addedDevices++;
      }

      const seenLinkPair = new Set<string>();
      for (const l of s.doc.links) {
        const a = l.fromDeviceId, b = l.toDeviceId;
        seenLinkPair.add(`${a}|${b}`); seenLinkPair.add(`${b}|${a}`);
      }
      const nextLinks = [...s.doc.links];
      for (const ln of (diff.links || [])) {
        if (!ln || !ln.fromDeviceId || !ln.toDeviceId) continue;
        if (ln.fromDeviceId === ln.toDeviceId) continue;
        if (!existingIds.has(ln.fromDeviceId) || !existingIds.has(ln.toDeviceId)) continue;
        const k1 = `${ln.fromDeviceId}|${ln.toDeviceId}`;
        if (seenLinkPair.has(k1)) continue;
        seenLinkPair.add(k1);
        seenLinkPair.add(`${ln.toDeviceId}|${ln.fromDeviceId}`);
        nextLinks.push({
          id: ln.id,
          fromDeviceId: ln.fromDeviceId,
          fromPortId: ln.fromPortId,
          toDeviceId: ln.toDeviceId,
          toPortId: ln.toPortId,
          cable: (ln.cable as any) || 'copper',
          label: ln.label,
        });
        addedLinks++;
      }

      const doc = { ...s.doc, devices: nextDevices, links: nextLinks };
      persist(doc);
      return { ...historyPush(s), doc };
    });
    return { addedDevices, addedLinks };
  },

  removeLink: (id) => set((s) => {
    const doc = { ...s.doc, links: s.doc.links.filter(l => l.id !== id) };
    persist(doc); return { ...historyPush(s), doc };
  }),

  // ---- Sticky notes ----
  addSticky: (deviceId, text = 'Новая заметка…', color = 'yellow') => {
    const id = `sn-${Math.random().toString(36).slice(2, 8)}`;
    const rotation = (Math.random() * 8 - 4); // -4..+4 deg
    const note: StickyNote = { id, deviceId, text, color, rotation, createdAt: Date.now() };
    set((s) => {
      const doc = { ...s.doc, stickies: [...(s.doc.stickies || []), note] };
      persist(doc); return { ...historyPush(s), doc };
    });
    return id;
  },
  updateSticky: (id, patch) => set((s) => {
    const doc = { ...s.doc, stickies: (s.doc.stickies || []).map(n => n.id === id ? { ...n, ...patch } : n) };
    persist(doc); return { ...historyPush(s), doc };
  }),
  removeSticky: (id) => set((s) => {
    const doc = { ...s.doc, stickies: (s.doc.stickies || []).filter(n => n.id !== id) };
    persist(doc); return { ...historyPush(s), doc };
  }),

  addGroup: (g) => set((s) => {
    const doc = { ...s.doc, groups: [...(s.doc.groups || []), g] };
    persist(doc); return { ...historyPush(s), doc };
  }),
  updateGroup: (id, patch) => set((s) => {
    const doc = { ...s.doc, groups: (s.doc.groups || []).map(g => g.id === id ? { ...g, ...patch } : g) };
    persist(doc); return { ...historyPush(s), doc };
  }),
  removeGroup: (id, opts) => set((s) => {
    const deleteChildren = opts?.deleteChildren ?? false;
    let devices = s.doc.devices;
    let links = s.doc.links;

    if (deleteChildren) {
      const doomed = new Set(devices.filter(d => d.groupId === id).map(d => d.id));
      devices = devices.filter(d => !doomed.has(d.id));
      links = links.filter(l => !doomed.has(l.fromDeviceId) && !doomed.has(l.toDeviceId));
    } else {
      // detach children: convert their relative coords back to absolute
      const g = (s.doc.groups || []).find(x => x.id === id);
      const gx = g?.x ?? 0, gy = g?.y ?? 0;
      devices = devices.map(d => d.groupId === id
        ? { ...d, groupId: null, x: d.x + gx, y: d.y + gy }
        : d
      );
    }

    const groups = (s.doc.groups || []).filter(g => g.id !== id);
    const doc = { ...s.doc, groups, devices, links };
    persist(doc); return { ...historyPush(s), doc, selectedGroupId: null };
  }),
  // -- VLAN CRUD ---------------------------------------------------------
  addVlan: (v) => set((s) => {
    const vlans = [...(s.doc.vlans || []), v];
    const doc = { ...s.doc, vlans };
    persist(doc); return { ...historyPush(s), doc };
  }),
  updateVlan: (id, patch) => set((s) => {
    const vlans = (s.doc.vlans || []).map(v => v.id === id ? { ...v, ...patch } : v);
    const doc = { ...s.doc, vlans };
    persist(doc); return { ...historyPush(s), doc };
  }),
  removeVlan: (id) => set((s) => {
    const vlan = (s.doc.vlans || []).find(v => v.id === id);
    const vlans = (s.doc.vlans || []).filter(v => v.id !== id);
    // Also clear this VLAN id from any port.vlan / port.vlans / link.vlan / link.vlans
    let devices = s.doc.devices;
    let links = s.doc.links;
    if (vlan) {
      devices = devices.map(d => ({
        ...d,
        ports: d.ports.map(p => ({
          ...p,
          vlan: p.vlan === vlan.vlanId ? undefined : p.vlan,
          vlans: p.vlans ? p.vlans.filter(x => x !== vlan.vlanId) : p.vlans,
        }))
      }));
      links = links.map(l => ({
        ...l,
        vlan: l.vlan === vlan.vlanId ? undefined : l.vlan,
        vlans: l.vlans ? l.vlans.filter(x => x !== vlan.vlanId) : l.vlans,
      }));
    }
    const doc = { ...s.doc, vlans, devices, links };
    persist(doc); return { ...historyPush(s), doc };
  }),

  setGroupPosition: (id, x, y, parentId) => set((s) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      // eslint-disable-next-line no-console
      console.warn('[netmap] setGroupPosition rejected non-finite coords', { id, x, y });
      return {};
    }
    const groups = (s.doc.groups || []).map(g =>
      g.id === id ? { ...g, x, y, ...(parentId !== undefined ? { parentId } : {}) } : g
    );
    const doc = { ...s.doc, groups };
    persist(doc); return { ...historyPush(s), doc };
  }),

  setHighlight: (ids) => set((s) => {
    if (ids.length === s.highlightIds.size && ids.every(id => s.highlightIds.has(id))) return {};
    return { highlightIds: new Set(ids) };
  }),

  setPortHighlight: (deviceId, portId) => set(s => {
    if (!deviceId || !portId) return { highlightPortId: null, highlightLinkId: null };
    const key = `${deviceId}:${portId}`;
    // Find the link connected to this port (if any)
    const link = s.doc.links.find(l =>
      (l.fromDeviceId === deviceId && l.fromPortId === portId) ||
      (l.toDeviceId === deviceId && l.toPortId === portId)
    );
    return { highlightPortId: key, highlightLinkId: link?.id || null };
  }),

  exportJson: () => JSON.stringify(get().doc, null, 2),
  importJson: (json) => {
    const parsed = JSON.parse(json);
    // Migration chain: any version → v3 → normalize
    let migrated: any = parsed;
    if (!migrated.version || migrated.version === 1) migrated = migrateV1toV2(migrated);
    if (migrated.version === 2) migrated = migrateV2toV3(migrated);
    const doc = normalize(migrated as NetMapDoc);
    persist(doc);
    set({ doc, selectedDeviceId: null, selectedGroupId: null, selectedPortId: null });
  },
  resetToSeed: () => {
    // v0.29: also clear the "layout has been done" flag so the welcome banner
    // + auto-layout hint fire again for the freshly-reset project.
    // v0.35.2: pick the seed that matches the active project's name so a
    // user working on Дона or Чайковский doesn't get their scene replaced
    // with Усадьба by accident.
    const state = useStore.getState();
    const active = state.workspace?.activeId;
    try {
      if (active) {
        const raw = localStorage.getItem('netmap:layoutDone') || '';
        const set2 = new Set(raw.split(',').filter(Boolean));
        set2.delete(active);
        localStorage.setItem('netmap:layoutDone', Array.from(set2).join(','));
      }
    } catch { /* ignore */ }
    const projectName = state.workspace?.projects.find(p => p.id === active)?.name || '';
    let seed = usadbaSeed;
    if (/дона|dona/i.test(projectName))              seed = donaSeed;
    else if (/чайков|chaikov/i.test(projectName))    seed = chaikovskySeed;
    const fresh = normalize(seed);
    persist(fresh);
    set({ doc: fresh, selectedDeviceId: null, selectedGroupId: null });
    // Auto-run layout on the fresh seed so it looks tidy immediately
    setTimeout(() => {
      try { useStore.getState().autoLayout('TB'); } catch { /* noop */ }
    }, 50);
  }
}));

// Wire the late-bound storeRef used by `persist()` after the store exists.
storeRef = {
  getState: () => useStore.getState() as State,
  setState: (partial) => useStore.setState(partial as any),
};
