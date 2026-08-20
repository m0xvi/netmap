/**
 * v0.41 — Modern node (reference-style redesign).
 *
 * Two variants, chosen by the node's `data.kind` and `store.collapseEndpoints`:
 *   - "hub"    (router / switch / patchpanel / server-with-children):
 *              white card, circular gradient avatar, name+model+IP+online badge.
 *              If it's a switch with connected endpoints AND collapseEndpoints
 *              is on — renders "Connected Devices" section with counted chips
 *              per endpoint kind (Wi-Fi APs / IP Cameras / Smart Locks / …).
 *   - "leaf"  (camera / pc / pos / printer / lock / ap / vm when standalone):
 *              small horizontal card, just avatar + name + IP.
 *
 * This is a NEW node component — legacy DeviceNode / SwitchNode stay untouched
 * so users can flip back via View → «Использовать старый вид» toggle.
 *
 * Registered in Canvas.tsx as node type `modernNode`. Canvas decides which
 * type to use based on store.viewMode.
 */

import { useMemo, useState, useEffect } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { useStore } from './store';
import { ICONS, KIND_META } from './icons';
import type { Device, DeviceKind } from './types';
import { getFavicon } from './faviconClient';
import { portSides } from './portSides';

interface Props {
  id: string;
  data: { device: Device };
  selected?: boolean;
}

/** Kinds that qualify as "endpoints" — get folded into their upstream hub
 *  when store.collapseEndpoints is true. */
const ENDPOINT_KINDS: DeviceKind[] = ['ap', 'camera', 'pc', 'pos', 'printer', 'lock'];

/** Kinds that render as "hub cards" (bigger, with optional endpoint list) */
const HUB_KINDS: DeviceKind[] = ['router', 'switch', 'patchpanel', 'server', 'cloud', 'vps', 'vm'];

/** Group endpoints by kind, returning [{kind, count, ids}] sorted by preferred order. */
function groupEndpoints(devices: Device[], hubId: string, links: any[]): Array<{
  kind: DeviceKind; count: number; ids: string[];
}> {
  // Find all devices connected to this hub whose kind is an endpoint.
  // v0.42.1 fix: was using wrong field names (aDeviceId/bDeviceId) — that's
  // why the "Connected Devices" section never showed. Correct names are
  // fromDeviceId/toDeviceId (see types.ts::Link).
  const connectedIds = new Set<string>();
  for (const link of links) {
    if (link.fromDeviceId === hubId) connectedIds.add(link.toDeviceId);
    if (link.toDeviceId === hubId)   connectedIds.add(link.fromDeviceId);
  }
  const byKind = new Map<DeviceKind, string[]>();
  for (const d of devices) {
    if (!connectedIds.has(d.id)) continue;
    if (!ENDPOINT_KINDS.includes(d.kind)) continue;
    const arr = byKind.get(d.kind) || [];
    arr.push(d.id);
    byKind.set(d.kind, arr);
  }
  // Also include cameras that are linked to this hub via camera-registrar
  // (dvr.cameraIds) — but as a proxy, look at the DVR device attached to us.
  const order: DeviceKind[] = ['ap', 'camera', 'lock', 'pc', 'pos', 'printer'];
  return order
    .filter(k => byKind.has(k))
    .map(k => ({ kind: k, count: byKind.get(k)!.length, ids: byKind.get(k)! }));
}

export function ModernDeviceNode({ id, data, selected }: Props) {
  const device = data.device;
  const meta = KIND_META[device.kind];
  const Icon = ICONS[device.kind];
  const isHub = HUB_KINDS.includes(device.kind);
  const isEndpoint = ENDPOINT_KINDS.includes(device.kind);

  const collapseEndpoints = useStore(s => s.collapseEndpoints);
  const links = useStore(s => s.doc.links);
  const devices = useStore(s => s.doc.devices);
  const setFocus = useStore(s => s.focusDevice);
  const rf = useReactFlow();

  const [expanded, setExpanded] = useState(true);
  const [favicon, setFavicon] = useState<string | null>(null);
  useEffect(() => {
    if (device.mgmtUrl) getFavicon(device.mgmtUrl).then(setFavicon);
  }, [device.mgmtUrl]);

  const endpointGroups = useMemo(
    () => (isHub && collapseEndpoints) ? groupEndpoints(devices, id, links) : [],
    [devices, links, id, isHub, collapseEndpoints]
  );

  const isOnline = device.liveStatus !== 'down';
  const statusColor = isOnline ? '#22C55E' : '#EF4444';
  const statusLabel = isOnline ? 'Online' : 'Offline';

  // ---------- LEAF (small) rendering ----------
  if (isEndpoint) {
    return (
      <div
        style={{
          background: 'white',
          border: `1px solid ${selected ? meta.color : '#E5E7EB'}`,
          borderRadius: 10,
          padding: '8px 12px',
          minWidth: 180,
          boxShadow: selected
            ? `0 0 0 3px ${meta.color}22, 0 2px 6px rgba(15,23,42,0.06)`
            : '0 1px 3px rgba(15,23,42,0.05)',
          display: 'flex', alignItems: 'center', gap: 10,
          cursor: 'pointer',
          transition: 'box-shadow 120ms, border-color 120ms',
        }}
        // v0.47 — single click selects (Canvas.onNodeClick handles it +
        // opens right panel). Double click enters focus view.
        onDoubleClick={(e) => { e.stopPropagation(); setFocus(id); }}
        title="Клик — выбрать · Двойной клик — крупный вид"
      >
        <div
          style={{
            width: 32, height: 32, borderRadius: '50%',
            background: meta.bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon size={16} color={meta.color} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: 600, color: '#0F172A',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {device.name}
          </div>
          <div style={{ fontSize: 10, color: '#64748B', display: 'flex', gap: 6, alignItems: 'center' }}>
            {device.ip && <span style={{ fontFamily: 'ui-monospace, monospace' }}>{device.ip}</span>}
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
          </div>
        </div>
        {/* v0.42.1: per-port handles (invisible) + fallback edge-hugging
            handles so React Flow can route edges to the exact port defined
            in the link, or fall back to a side handle when there's no
            port id (matches DeviceNode behaviour). */}
        <PortHandles device={device} />
      </div>
    );
  }

  // ---------- HUB (big card with optional endpoints) rendering ----------
  return (
    <div
      style={{
        background: 'white',
        border: `1px solid ${selected ? meta.color : '#E5E7EB'}`,
        borderRadius: 14,
        minWidth: 260, maxWidth: 300,
        boxShadow: selected
          ? `0 0 0 3px ${meta.color}22, 0 4px 12px rgba(15,23,42,0.08)`
          : '0 2px 8px rgba(15,23,42,0.05)',
        overflow: 'hidden',
        transition: 'box-shadow 120ms, border-color 120ms',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: 14, cursor: 'pointer',
        }}
        // v0.47 — inverted: single click selects (right panel opens via
        // Canvas.onNodeClick + store.select), double click = focus view.
        // Alt+double-click keeps the old "center on this node" gesture.
        onDoubleClick={(e) => {
          if (e.altKey) {
            try { rf.fitView({ nodes: [{ id }], duration: 300, padding: 0.5, maxZoom: 1.2 }); } catch {}
          } else {
            e.stopPropagation();
            setFocus(id);
          }
        }}
        title="Клик — выбрать · Двойной клик — крупный режим (focus)"
      >
        <div
          style={{
            width: 52, height: 52, borderRadius: '50%',
            background: `linear-gradient(135deg, ${meta.color} 0%, ${meta.color}CC 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            boxShadow: `0 4px 12px ${meta.color}40`,
          }}
        >
          {favicon
            ? <img src={favicon} alt="" style={{ width: 24, height: 24, borderRadius: 4 }} onError={() => setFavicon(null)} />
            : <Icon size={26} color="#FFFFFF" />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: '#0F172A',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {device.name}
          </div>
          <div style={{
            fontSize: 10, color: '#64748B', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {device.model && <span>{device.model}</span>}
            {device.model && device.ip && <span> · </span>}
            {device.ip && <span style={{ fontFamily: 'ui-monospace, monospace' }}>{device.ip}</span>}
          </div>
          <div style={{ marginTop: 4 }}>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 10, padding: '2px 8px', borderRadius: 999,
                background: isOnline ? '#F0FDF4' : '#FEF2F2',
                color: statusColor, fontWeight: 600,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
              {statusLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Endpoint groups (Connected Devices section) */}
      {endpointGroups.length > 0 && (
        <div style={{ borderTop: '1px solid #F1F5F9' }}>
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              width: '100%', padding: '10px 14px', border: 'none', background: 'transparent',
              display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
              fontSize: 11, color: '#64748B', fontWeight: 600, textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 9 }}>{expanded ? '▼' : '▶'}</span>
            <span>Connected Devices</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.7 }}>
              {endpointGroups.reduce((a, g) => a + g.count, 0)}
            </span>
          </button>
          {expanded && (
            <div style={{ padding: '0 8px 8px' }}>
              {endpointGroups.map(g => (
                <EndpointChip key={g.kind} kind={g.kind} count={g.count} ids={g.ids} />
              ))}
            </div>
          )}
        </div>
      )}

      <PortHandles device={device} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// v0.42.1: reusable port-handles renderer (same logic as DeviceNode's
// CompactHandles — invisible handles per port, positioned by portSides).

function PortHandles({ device }: { device: Device }) {
  const invisible: React.CSSProperties = {
    width: 6, height: 6, background: 'transparent', border: 'none', opacity: 0,
  };
  // Bump-based subscription so we re-render when portSides recompute.
  const psVersion = useStore(s => s.portSidesVersion);
  void psVersion;

  const posStyleFor = (s: Position, pct: number): React.CSSProperties =>
    (s === Position.Left || s === Position.Right)
      ? { top: `${pct}%` }
      : { left: `${pct}%` };

  const ports = device.ports || [];
  const defaultSide: Position =
    device.kind === 'router' || device.kind === 'switch' || device.kind === 'patchpanel'
      ? Position.Top
      : Position.Bottom;

  return (
    <>
      {ports.map((port, idx) => {
        const dynSide = portSides.getSide(device.id, port.id);
        const dynPct  = portSides.getOffsetPct(device.id, port.id);
        const effSide = dynSide ?? defaultSide;
        const pct = dynSide != null ? (dynPct ?? 50) : ((idx + 1) / (ports.length + 1)) * 100;
        return (
          <div key={port.id}>
            <Handle id={port.id} type="source" position={effSide}
                    style={{ ...invisible, ...posStyleFor(effSide, pct) }} />
            <Handle id={port.id} type="target" position={effSide}
                    style={{ ...invisible, ...posStyleFor(effSide, pct) }} />
          </div>
        );
      })}
      {/* Edge-hugging fallback handles for cables that don't specify a port. */}
      <Handle id="_top"    type="source" position={Position.Top}    style={invisible} />
      <Handle id="_top"    type="target" position={Position.Top}    style={invisible} />
      <Handle id="_right"  type="source" position={Position.Right}  style={invisible} />
      <Handle id="_right"  type="target" position={Position.Right}  style={invisible} />
      <Handle id="_bottom" type="source" position={Position.Bottom} style={invisible} />
      <Handle id="_bottom" type="target" position={Position.Bottom} style={invisible} />
      <Handle id="_left"   type="source" position={Position.Left}   style={invisible} />
      <Handle id="_left"   type="target" position={Position.Left}   style={invisible} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Endpoint chip (row inside "Connected Devices" section)

function EndpointChip({ kind, count, ids }: { kind: DeviceKind; count: number; ids: string[] }) {
  const meta = KIND_META[kind];
  const Icon = ICONS[kind];
  // v0.47 — expanded endpoint list uses select (single click) + double click
  // for focus, matching the main-card behaviour.
  const setFocus  = useStore(s => s.focusDevice);
  const selectDev = useStore(s => s.select);
  const devices = useStore(s => s.doc.devices);
  const [open, setOpen] = useState(false);

  const label = ENDPOINT_LABEL[kind] || meta.label;

  return (
    <div style={{ marginTop: 4 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '6px 8px', border: 'none',
          background: open ? meta.bg : 'transparent',
          borderRadius: 8, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8,
          transition: 'background 120ms',
        }}
        onMouseEnter={(e) => { if (!open) (e.currentTarget as HTMLButtonElement).style.background = '#F8FAFC'; }}
        onMouseLeave={(e) => { if (!open) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
      >
        <div
          style={{
            width: 22, height: 22, borderRadius: '50%',
            background: meta.bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon size={12} color={meta.color} />
        </div>
        <span style={{ fontSize: 11, color: '#334155', flex: 1, textAlign: 'left' }}>{label}</span>
        <span
          style={{
            fontSize: 10, fontWeight: 700, color: meta.color,
            background: 'white', padding: '1px 8px', borderRadius: 999,
            border: `1px solid ${meta.color}30`,
          }}
        >
          {count}
        </span>
      </button>
      {open && (
        <div style={{ margin: '4px 0 6px 30px', display: 'grid', gap: 2 }}>
          {ids.map(devId => {
            const d = devices.find(x => x.id === devId);
            if (!d) return null;
            const online = d.liveStatus !== 'down';
            return (
              <button
                key={devId}
                onClick={(e) => { e.stopPropagation(); selectDev(devId); }}
                onDoubleClick={(e) => { e.stopPropagation(); setFocus(devId); }}
                title="Клик — выбрать в правой панели · Двойной клик — крупный вид"
                style={{
                  padding: '3px 6px', border: 'none', background: 'transparent',
                  borderRadius: 4, cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 10, color: '#475569',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#F1F5F9'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <span style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: online ? '#22C55E' : '#EF4444',
                }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.name}
                </span>
                {d.ip && <span style={{ fontFamily: 'ui-monospace, monospace', opacity: 0.7 }}>{d.ip}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ENDPOINT_LABEL: Partial<Record<DeviceKind, string>> = {
  ap: 'Wi-Fi Access Points',
  camera: 'IP Cameras',
  lock: 'Smart Locks',
  pc: 'PCs',
  pos: 'POS Terminals',
  printer: 'Printers',
};


