/**
 * v0.66.0 — «Подключённые устройства» в инспекторе устройства (приём макета D,
 * map-variants.html: проводник слева синхронен с картой).
 *
 * Двусторонний синхрон «список ↔ карта» через store.hoveredDeviceId:
 *   - ховер строки  → карта затемняет всё, кроме этого устройства и его
 *     соседей (эффект Canvas), связи подсвечиваются (PortEdge.focusRelated);
 *   - ховер карточки на карте → строка подсвечивается и прокручивается в вид.
 * Клик — выбрать устройство (панель переключится на него), двойной клик —
 * крупный вид (Focus View), ПКМ на карте — обычное меню устройства.
 *
 * Подписки узкие: список — только ссылки и соседи своего устройства;
 * строка — только своё устройство (тик мониторинга перерисовывает одну строку).
 */

import { useEffect, useMemo, useRef } from 'react';
import { useStore } from './store';
import { useShallow } from 'zustand/shallow';
import { KIND_META } from './icons';
import type { DeviceKind } from './types';

const ENDPOINT_KINDS: DeviceKind[] = ['ap', 'camera', 'pc', 'pos', 'printer', 'lock', 'other'];
const ENDPOINT_ORDER: DeviceKind[] = ['ap', 'camera', 'lock', 'pc', 'pos', 'printer', 'other'];

export function HubPeersList({ deviceId }: { deviceId: string }) {
  const links = useStore(useShallow(
    (s) => s.doc.links.filter(l => l.fromDeviceId === deviceId || l.toDeviceId === deviceId),
  ));
  const peerIds = useMemo(() => {
    const set = new Set<string>();
    for (const l of links) set.add(l.fromDeviceId === deviceId ? l.toDeviceId : l.fromDeviceId);
    return set;
  }, [links, deviceId]);
  const peers = useStore(useShallow(
    (s) => s.doc.devices.filter(d => peerIds.has(d.id)),
  ));
  const hoveredId = useStore(s => s.hoveredDeviceId);

  const sorted = useMemo(() => peers.slice().sort((a, b) => {
    const ae = ENDPOINT_KINDS.includes(a.kind) ? 1 : 0;
    const be = ENDPOINT_KINDS.includes(b.kind) ? 1 : 0;
    if (ae !== be) return ae - be; // инфраструктура сверху, оконечные ниже
    const ka = ENDPOINT_ORDER.indexOf(a.kind), kb = ENDPOINT_ORDER.indexOf(b.kind);
    return (ka - kb) || a.name.localeCompare(b.name);
  }), [peers]);

  if (sorted.length === 0) return null;
  const offline = sorted.reduce((a, d) => a + (d.liveStatus === 'down' ? 1 : 0), 0);

  return (
    <section style={{ borderTop: '1px solid #F1F5F9', padding: '10px 14px 12px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
        fontSize: 10.5, fontWeight: 700, color: '#64748B',
        textTransform: 'uppercase', letterSpacing: 0.5,
      }}>
        <span>Подключённые устройства</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, textTransform: 'none' }}>
          {offline > 0 && <span style={{ color: '#EF4444' }}>{offline} down</span>}
          <span>{sorted.length}</span>
        </span>
      </div>
      <div style={{ maxHeight: 236, overflowY: 'auto', display: 'grid', gap: 1 }}>
        {sorted.map(d => (
          <PeerRow key={d.id} devId={d.id} highlighted={hoveredId === d.id} />
        ))}
      </div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 6, lineHeight: 1.4 }}>
        Наведение подсвечивает устройство на схеме · клик — выбрать · двойной клик — крупный вид
      </div>
    </section>
  );
}

function PeerRow({ devId, highlighted }: { devId: string; highlighted: boolean }) {
  const d = useStore(useShallow((s) => {
    const x = s.doc.devices.find(z => z.id === devId);
    if (!x) return null;
    return { name: x.name, kind: x.kind, ip: x.ip || '', liveStatus: x.liveStatus || 'unknown' };
  }));
  const select = useStore(s => s.select);
  const focusDevice = useStore(s => s.focusDevice);
  const setHovered = useStore(s => s.setHoveredDevice);
  const ref = useRef<HTMLDivElement>(null);

  // Карта → список: подсветка приезжает hoveredDeviceId'ом, строка сама
  // прокручивается в видимую область (scrollIntoView, как в макете D).
  useEffect(() => {
    if (highlighted) {
      try { ref.current?.scrollIntoView({ block: 'nearest' }); } catch { /* noop */ }
    }
  }, [highlighted]);

  if (!d) return null;
  const meta = KIND_META[d.kind];
  const stColor = d.liveStatus === 'up' ? '#22C55E' : d.liveStatus === 'down' ? '#EF4444' : '#94A3B8';

  return (
    <div
      ref={ref}
      onMouseEnter={() => setHovered(devId)}
      onMouseLeave={() => setHovered(null)}
      onClick={() => select(devId)}
      onDoubleClick={() => focusDevice(devId)}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '4px 7px', borderRadius: 6, cursor: 'pointer',
        background: highlighted ? '#EFF6FF' : 'transparent',
        boxShadow: highlighted ? 'inset 2px 0 0 #2563EB' : 'none',
        transition: 'background 100ms',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: stColor, flexShrink: 0 }} />
      <span style={{
        flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600, color: '#1F2937',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {d.name}
      </span>
      {d.ip && (
        <span style={{
          fontSize: 10, color: '#6B7280', fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
          flexShrink: 0,
        }}>{d.ip}</span>
      )}
      <span style={{
        fontSize: 9, fontWeight: 800, color: meta.color, background: meta.bg,
        borderRadius: 4, padding: '1px 5px', flexShrink: 0, letterSpacing: 0.3,
      }}>{meta.label}</span>
    </div>
  );
}
