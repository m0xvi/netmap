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
 *
 * v0.55.0 — perf: раньше КАЖДЫЙ узел подписывался на ВЕСЬ doc.devices и
 * doc.links, поэтому любое изменение (перетаскивание, hover-подсветка, тик
 * мониторинга) перерисовывало все 200+ карточек — слайд-шоу. Теперь узел
 * подписан только на своё: «Connected Devices» вынесены в HubEndpoints с
 * узкими селекторами (ссылки хаба + соседи, сравнение через shallow),
 * строки EndpointRow берут по одному устройству по id.
 *
 * v0.57 — семантический зум (store.zoomBand): 'mid' ужимает карточки
 * (листы без IP-строки, хабы без чипов — только шапка с итогом), 'far'
 * рисует хаб «маяком» (FarBeacon: крупное имя, статус, CORE-плашка для
 * ядра, полоса FarEndpointStrip со счётчиками оконечных по типам).
 * Оконечные на 'far' прячет сам Canvas (hideAsEndpoint) — ручной
 * тумблер collapseEndpoints при этом не трогаем.
 */

import { useMemo, useState, useEffect } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { useStore } from './store';
import { useShallow } from 'zustand/shallow';
import { ICONS, KIND_META } from './icons';
import type { Device, DeviceKind } from './types';
import { getFavicon } from './faviconClient';
import { portSides } from './portSides';
import { inferLayer } from './layers';
import { showDeviceTip, hideDeviceTip } from './DeviceTooltip';

interface Props {
  id: string;
  data: { device: Device };
  selected?: boolean;
}

/** Kinds that qualify as "endpoints" — get folded into their upstream hub
 *  when store.collapseEndpoints is true. Exported for Canvas (v0.60). */
export const ENDPOINT_KINDS: DeviceKind[] = ['ap', 'camera', 'pc', 'pos', 'printer', 'lock', 'other'];

/** Kinds that render as "hub cards" (bigger, with optional endpoint list) */
const HUB_KINDS: DeviceKind[] = ['router', 'switch', 'patchpanel', 'server', 'cloud', 'vps', 'vm'];

const ENDPOINT_ORDER: DeviceKind[] = ['ap', 'camera', 'lock', 'pc', 'pos', 'printer', 'other'];

/** Group already-connected peer devices by endpoint kind. */
function groupPeerEndpoints(peers: Device[]): Array<{
  kind: DeviceKind; count: number; ids: string[];
}> {
  const byKind = new Map<DeviceKind, string[]>();
  for (const d of peers) {
    if (!ENDPOINT_KINDS.includes(d.kind)) continue;
    const arr = byKind.get(d.kind) || [];
    arr.push(d.id);
    byKind.set(d.kind, arr);
  }
  return ENDPOINT_ORDER
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
  // v0.57: ступень семантического зума — mid ужимает, far рисует «маяк».
  const zoomBand = useStore(s => s.zoomBand);
  const setFocus = useStore(s => s.focusDevice);
  const rf = useReactFlow();

  const [favicon, setFavicon] = useState<string | null>(null);
  useEffect(() => {
    if (device.mgmtUrl) getFavicon(device.mgmtUrl).then(setFavicon);
  }, [device.mgmtUrl]);

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
        // v0.64 — живой тултип (имя/IP/MAC/статус) вместо native title.
        onMouseEnter={(e) => showDeviceTip(id, e.clientX, e.clientY)}
        onMouseMove={(e) => showDeviceTip(id, e.clientX, e.clientY)}
        onMouseLeave={hideDeviceTip}
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
          {/* v0.57: на средней ступени лист — только имя (IP/статус не читаются). */}
          {zoomBand !== 'mid' && (
            <div style={{ fontSize: 11, color: '#64748B', display: 'flex', gap: 6, alignItems: 'center' }}>
              {device.ip && <span style={{ fontFamily: 'ui-monospace, monospace' }}>{device.ip}</span>}
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
            </div>
          )}
        </div>
        {/* v0.42.1: per-port handles (invisible) + fallback edge-hugging
            handles so React Flow can route edges to the exact port defined
            in the link, or fall back to a side handle when there's no
            port id (matches DeviceNode behaviour). */}
        <PortHandles device={device} />
      </div>
    );
  }

  // v0.57: дальняя ступень — хаб рисуется «маяком»: крупно, читаемо издалека.
  if (isHub && zoomBand === 'far') {
    return <FarBeacon id={id} device={device} selected={selected} />;
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
        // v0.64 — живой тултип вместо native title.
        onMouseEnter={(e) => showDeviceTip(id, e.clientX, e.clientY)}
        onMouseMove={(e) => showDeviceTip(id, e.clientX, e.clientY)}
        onMouseLeave={hideDeviceTip}
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
            // v0.65: кегль 10 → 11 px — второстепенная строка читается на 1080p.
            fontSize: 11, color: '#64748B', marginTop: 2,
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
      {isHub && collapseEndpoints && <HubEndpoints hubId={id} />}

      <PortHandles device={device} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// v0.55.0: «Connected Devices» — отдельный компонент с узкими подписками.
// Раньше весь узел слушал doc.devices + doc.links целиком.

function HubEndpoints({ hubId }: { hubId: string }) {
  const [expanded, setExpanded] = useState(true);
  // v0.57: mid — только шапка с итогом, far — секция не нужна (есть полоса «маяка»).
  // v0.64: точки-клиенты видны и на mid (макет B) — это дёшево и кликабельно.
  const zoomBand = useStore(s => s.zoomBand);
  // Только ссылки этого хаба (useShallow: новые массивы с теми же
  // ссылками ре-рендера не вызывают).
  const links = useStore(useShallow(
    (s) => s.doc.links.filter(l => l.fromDeviceId === hubId || l.toDeviceId === hubId),
  ));
  const peerIds = useMemo(() => {
    const set = new Set<string>();
    for (const l of links) set.add(l.fromDeviceId === hubId ? l.toDeviceId : l.fromDeviceId);
    return set;
  }, [links, hubId]);
  const peers = useStore(useShallow(
    (s) => s.doc.devices.filter(d => peerIds.has(d.id)),
  ));
  // v0.64: оконечные сортируются по типу (ENDPOINT_ORDER), внутри типа — по имени.
  // Каждая точка подписана на своё устройство отдельно (EndpointDot) — тик
  // мониторинга перерисовывает только изменившуюся точку.
  const endpointIds = useMemo(() => {
    return peers
      .filter(d => ENDPOINT_KINDS.includes(d.kind))
      .slice()
      .sort((a, b) => {
        const ka = ENDPOINT_ORDER.indexOf(a.kind);
        const kb = ENDPOINT_ORDER.indexOf(b.kind);
        return (ka - kb) || a.name.localeCompare(b.name);
      })
      .map(d => d.id);
  }, [peers]);
  const offlineCount = useMemo(
    () => peers.reduce((a, d) => a + (ENDPOINT_KINDS.includes(d.kind) && d.liveStatus === 'down' ? 1 : 0), 0),
    [peers],
  );
  if (endpointIds.length === 0) return null;
  if (zoomBand === 'far') return null;
  return (
    <div style={{ borderTop: '1px solid #F1F5F9' }}>
      <button
        className="nodrag"
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%', padding: '10px 14px', border: 'none', background: 'transparent',
          display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
          fontSize: 11, color: '#64748B', fontWeight: 600, textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 9 }}>{expanded ? '▼' : '▶'}</span>
        <span>Connected Devices</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.7, display: 'inline-flex', gap: 6 }}>
          {offlineCount > 0 && (
            <span style={{ color: '#EF4444', fontWeight: 700, opacity: 1 }}>{offlineCount} down</span>
          )}
          <span>{endpointIds.length}</span>
        </span>
      </button>
      {expanded && <EndpointDots ids={endpointIds} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// v0.64 — интерактивные точки-клиенты (приём из макета B, map-variants.html):
// каждое свёрнутое оконечное устройство — цветной квадратик 13 px на карточке
// хаба. Цвет = тип устройства (KIND_META), красный = offline, полупрозрачные =
// нет данных/проверка. Клик — выбрать (правая панель), Ctrl+клик — добавить
// к мульти-выделению, двойной клик — крупный вид, ПКМ — меню устройства,
// ховер — общий тултип (DeviceTooltip). «nodrag» не даёт клику превратиться
// в перетаскивание хаба (конвенция React Flow).

function EndpointDots({ ids }: { ids: string[] }) {
  return (
    <div style={{ padding: '0 14px 12px', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {ids.map(devId => <EndpointDot key={devId} devId={devId} />)}
    </div>
  );
}

function EndpointDot({ devId }: { devId: string }) {
  // Подписка на примитивы своего устройства — ре-рендер только своей точки.
  const d = useStore(useShallow((s) => {
    const x = s.doc.devices.find(z => z.id === devId);
    if (!x) return null;
    return { kind: x.kind, liveStatus: x.liveStatus || 'unknown' };
  }));
  const selected = useStore(s => s.selectedDeviceId === devId || s.multiSelectedIds.has(devId));
  if (!d) return null;
  const meta = KIND_META[d.kind];
  const down = d.liveStatus === 'down';
  const dim = d.liveStatus === 'unknown' || d.liveStatus === 'checking';
  return (
    <span
      className="nodrag"
      onClick={(e) => {
        e.stopPropagation();
        const st = useStore.getState();
        if (e.ctrlKey || e.metaKey) {
          const cur = new Set(st.multiSelectedIds);
          // Ранее выбранное одиночным кликом устройство «подхватываем» в набор —
          // ctrl+клик расширяет выбор, а не начинает его с нуля.
          if (st.selectedDeviceId && !cur.has(st.selectedDeviceId)) cur.add(st.selectedDeviceId);
          if (cur.has(devId)) cur.delete(devId); else cur.add(devId);
          st.setMultiSelection(Array.from(cur));
        } else {
          st.select(devId);
        }
      }}
      onDoubleClick={(e) => { e.stopPropagation(); useStore.getState().focusDevice(devId); }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        hideDeviceTip();
        useStore.getState().openContextMenu({
          x: e.clientX, y: e.clientY, target: { type: 'device', id: devId },
        });
      }}
      onMouseEnter={(e) => showDeviceTip(devId, e.clientX, e.clientY)}
      onMouseMove={(e) => showDeviceTip(devId, e.clientX, e.clientY)}
      onMouseLeave={hideDeviceTip}
      style={{
        width: 13, height: 13, borderRadius: 4,
        background: down ? '#EF4444' : meta.color,
        opacity: dim ? 0.45 : 1,
        cursor: 'pointer',
        boxShadow: selected ? '0 0 0 2px #FFFFFF, 0 0 0 3.5px #2563EB' : 'none',
        transition: 'box-shadow 100ms, opacity 200ms, background 200ms',
      }}
    />
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
// v0.64: бывшие EndpointChip/EndpointRow (аккордеон списков по типам) удалены —
// их заменили интерактивные точки EndpointDots (см. выше). История — в git.

const ENDPOINT_LABEL: Partial<Record<DeviceKind, string>> = {
  ap: 'Wi-Fi Access Points',
  camera: 'IP Cameras',
  lock: 'Smart Locks',
  pc: 'PCs',
  pos: 'POS Terminals',
  printer: 'Printers',
};

// ---------------------------------------------------------------------------
// v0.57: «маяк» — хаб на дальней ступени семантического зума. Крупная
// контрастная карточка: имя читается издалека, оконечные — счётчиками
// по типам. Ядро (inferLayer === 'core') — с синим кольцом и плашкой CORE.

function FarBeacon({ id, device, selected }: { id: string; device: Device; selected?: boolean }) {
  const meta = KIND_META[device.kind];
  const Icon = ICONS[device.kind];
  const setFocus = useStore(s => s.focusDevice);
  const isOnline = device.liveStatus !== 'down';
  const statusColor = isOnline ? '#22C55E' : '#EF4444';
  const isCore = inferLayer(device) === 'core';
  return (
    <div
      style={{
        background: 'white',
        // v0.60: маяк крупнее на треть — RF меряет немасштабированный бокс,
        // рёбра аккуратно уходят под карточку (для обзора это ок).
        transform: 'scale(1.3)',
        transformOrigin: 'center',
        border: isCore ? '2.5px solid #2563EB' : `1.5px solid ${selected ? meta.color : '#CBD5E1'}`,
        borderRadius: 18,
        minWidth: 300, maxWidth: 340,
        boxShadow: isCore
          ? '0 0 0 4px #2563EB22, 0 8px 28px rgba(37,99,235,0.25)'
          : (selected
            ? `0 0 0 4px ${meta.color}22, 0 6px 20px rgba(15,23,42,0.12)`
            : '0 4px 16px rgba(15,23,42,0.10)'),
        overflow: 'hidden',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px 12px', cursor: 'pointer' }}
        onDoubleClick={(e) => { e.stopPropagation(); setFocus(id); }}
        onMouseEnter={(e) => showDeviceTip(id, e.clientX, e.clientY)}
        onMouseMove={(e) => showDeviceTip(id, e.clientX, e.clientY)}
        onMouseLeave={hideDeviceTip}
      >
        <div
          style={{
            width: 64, height: 64, borderRadius: '50%',
            background: `linear-gradient(135deg, ${meta.color} 0%, ${meta.color}CC 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            boxShadow: `0 6px 16px ${meta.color}50`,
          }}
        >
          <Icon size={32} color="#FFFFFF" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 17, fontWeight: 800, color: '#0F172A',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {device.name}
          </div>
          <div style={{
            fontSize: 12, color: '#64748B', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {device.model && <span>{device.model}</span>}
            {device.model && device.ip && <span> · </span>}
            {device.ip && <span style={{ fontFamily: 'ui-monospace, monospace' }}>{device.ip}</span>}
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 11, padding: '2px 10px', borderRadius: 999,
                background: isOnline ? '#F0FDF4' : '#FEF2F2',
                color: statusColor, fontWeight: 700,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor }} />
              {isOnline ? 'Online' : 'Offline'}
            </span>
            {isCore && (
              <span style={{
                fontSize: 10, fontWeight: 800, letterSpacing: 1,
                padding: '2px 10px', borderRadius: 999,
                background: '#2563EB', color: '#FFFFFF',
              }}>
                CORE
              </span>
            )}
          </div>
        </div>
      </div>

      <FarEndpointStrip hubId={id} />
      <PortHandles device={device} />
    </div>
  );
}

// Полоса агрегации оконечных для «маяка»: иконка типа + счётчик.
// Подписки узкие (ссылки хаба + соседи), как у HubEndpoints.
function FarEndpointStrip({ hubId }: { hubId: string }) {
  const links = useStore(useShallow(
    (s) => s.doc.links.filter(l => l.fromDeviceId === hubId || l.toDeviceId === hubId),
  ));
  const peerIds = useMemo(() => {
    const set = new Set<string>();
    for (const l of links) set.add(l.fromDeviceId === hubId ? l.toDeviceId : l.fromDeviceId);
    return set;
  }, [links, hubId]);
  const peers = useStore(useShallow(
    (s) => s.doc.devices.filter(d => peerIds.has(d.id)),
  ));
  const groups = useMemo(() => groupPeerEndpoints(peers), [peers]);
  const vmCount = useMemo(() => peers.filter(d => d.kind === 'vm').length, [peers]);
  const total = groups.reduce((a, g) => a + g.count, 0) + vmCount;
  if (total === 0) return null;
  const vmMeta = KIND_META['vm'];
  const VmIcon = ICONS['vm'];
  const chip = (color: string, bg: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5,
    background: bg, border: `1px solid ${color}35`, borderRadius: 999,
    padding: '3px 10px 3px 6px', fontSize: 12, fontWeight: 800, color,
  });
  return (
    <div style={{
      borderTop: '1px solid #F1F5F9', padding: '10px 14px 12px',
      display: 'flex', flexWrap: 'wrap', gap: 6,
    }}>
      {groups.map(g => {
        const m = KIND_META[g.kind];
        const I = ICONS[g.kind];
        return (
          <span key={g.kind} title={`${ENDPOINT_LABEL[g.kind] || m.label}: ${g.count}`} style={chip(m.color, m.bg)}>
            <I size={14} color={m.color} />{g.count}
          </span>
        );
      })}
      {vmCount > 0 && (
        <span title={`VM: ${vmCount}`} style={chip(vmMeta.color, vmMeta.bg)}>
          <VmIcon size={14} color={vmMeta.color} />{vmCount}
        </span>
      )}
    </div>
  );
}
