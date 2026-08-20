/**
 * v0.46.0 — Port picker dialog: full rewrite for the drag-drop workflow.
 *
 * Called when a user drags device A onto device B (Canvas.onNodeDragStop).
 * The dialog lists ALL ports on both sides in a grid — free ports are
 * clickable, occupied ports show which device they're currently connected
 * to and offer a «Заменить» action that will remove the existing link and
 * create a new one to the source device.
 *
 * Improvements over v0.35.6:
 *   - Port grid instead of <select> (visual, faster)
 *   - Occupied ports show `→ Camera-1` chip with «Заменить» button
 *   - No more "no free ports" hard-block — user can always resolve by replacing
 *   - Auto-cable detection updates on every port click
 *   - VLAN hint on port (from port.vlan)
 *   - PoE badge, speed badge, port-type icon
 *   - Search filter for switches with 24-48 ports
 *
 * The `resolve` callback returns either:
 *   { sourcePortId, targetPortId, cable, replaceLinks: string[] } — user confirmed
 *   null — user cancelled
 *
 * `replaceLinks` = ids of existing links that must be deleted BEFORE the new
 * link is created (used when the user picks a port already in use).
 */
import { useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Device, Port, Link } from './types';

export interface PortOption {
  port: Port;
  /** Human label for the header — «eth3 · RJ45 · 1G · PoE» */
  label: string;
  free: boolean;
  /** If !free, the existing link id and the *other* endpoint description */
  usedBy?: {
    linkId: string;
    peerDeviceId: string;
    peerDeviceName: string;
    peerPortId?: string;
    peerKind?: string;
  };
}

export interface PortPickerResult {
  sourcePortId: string;
  targetPortId: string;
  cable: 'copper' | 'fiber' | 'wifi';
  /** link ids to remove before creating the new one (from picking occupied ports) */
  replaceLinks: string[];
}

interface DialogSpec {
  source: { device: Device; options: PortOption[] };
  target: { device: Device; options: PortOption[] };
  resolve: (v: PortPickerResult | null) => void;
}

let dialogRoot: Root | null = null;
let setSpec: ((s: DialogSpec | null) => void) | null = null;

function ensureRoot() {
  if (dialogRoot) return;
  const el = document.createElement('div');
  el.id = 'netmap-portpicker-root';
  document.body.appendChild(el);
  dialogRoot = createRoot(el);
  dialogRoot.render(<Host onReady={(s) => { setSpec = s; }} />);
}

/**
 * Build port options for a device — attaches `usedBy` metadata by scanning links.
 * Exported so Canvas can call it once, avoiding a duplicate pass.
 */
export function buildPortOptions(
  device: Device,
  allLinks: Link[],
  allDevices: Device[],
): PortOption[] {
  const devById = new Map(allDevices.map(d => [d.id, d]));
  const labelOf = (p: Port) =>
    `${p.id.toUpperCase()}${p.label ? ' · ' + p.label : ''}` +
    `${p.type ? ' · ' + p.type : ''}` +
    `${p.speed ? ' · ' + p.speed : ''}` +
    `${p.poe ? ' · PoE' : ''}`;

  return device.ports.map(p => {
    // Find the link using this specific port on this specific device.
    const link = allLinks.find(l =>
      (l.fromDeviceId === device.id && l.fromPortId === p.id) ||
      (l.toDeviceId   === device.id && l.toPortId   === p.id)
    );
    if (!link) return { port: p, label: labelOf(p), free: true };
    const peerId = link.fromDeviceId === device.id ? link.toDeviceId : link.fromDeviceId;
    const peerPortId = link.fromDeviceId === device.id ? link.toPortId : link.fromPortId;
    const peer = devById.get(peerId);
    return {
      port: p, label: labelOf(p), free: false,
      usedBy: {
        linkId: link.id,
        peerDeviceId: peerId,
        peerDeviceName: peer?.name || peerId,
        peerPortId,
        peerKind: peer?.kind,
      },
    };
  });
}

export function openPortPicker(
  source: { device: Device; options: PortOption[] },
  target: { device: Device; options: PortOption[] },
): Promise<PortPickerResult | null> {
  ensureRoot();
  return new Promise((resolve) => {
    const spec: DialogSpec = { source, target, resolve };
    if (setSpec) setSpec(spec);
    else requestAnimationFrame(() => setSpec?.(spec));
  });
}

function Host({ onReady }: { onReady: (setter: (s: DialogSpec | null) => void) => void }) {
  const [spec, setState] = useState<DialogSpec | null>(null);
  useEffect(() => { onReady(setState); }, [onReady]);
  if (!spec) return null;
  return <Card spec={spec} onClose={(v) => { spec.resolve(v); setState(null); }} />;
}

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

function Card({ spec, onClose }: { spec: DialogSpec; onClose: (v: PortPickerResult | null) => void }) {
  const { source, target } = spec;

  // Prefer the first FREE port; otherwise fall back to the first port
  // (occupied — user will need to explicitly choose «Заменить»).
  const initSrc = source.options.find(o => o.free)?.port.id || source.options[0]?.port.id || '';
  const initTgt = target.options.find(o => o.free)?.port.id || target.options[0]?.port.id || '';

  const [srcPortId, setSrc] = useState(initSrc);
  const [tgtPortId, setTgt] = useState(initTgt);
  // Track which existing links user has chosen to REPLACE.
  const [replaceLinkIds, setReplaceLinkIds] = useState<Set<string>>(new Set());

  const [cable, setCable] = useState<'copper' | 'fiber' | 'wifi'>(() =>
    guessCable(source.options, target.options, initSrc, initTgt)
  );

  // Every time user changes a port, re-guess cable type.
  useEffect(() => {
    setCable(guessCable(source.options, target.options, srcPortId, tgtPortId));
  }, [srcPortId, tgtPortId, source.options, target.options]);

  // When user picks an occupied port, we need their explicit confirmation
  // to replace. This function toggles the link into `replaceLinkIds`.
  const chooseSide = (side: 'src' | 'tgt', opt: PortOption) => {
    if (side === 'src') setSrc(opt.port.id); else setTgt(opt.port.id);
    if (!opt.free && opt.usedBy) {
      setReplaceLinkIds(s => {
        const next = new Set(s);
        next.add(opt.usedBy!.linkId);
        return next;
      });
    }
  };

  // Given current selection, which link ids will actually be replaced?
  const activeReplaces = useMemo(() => {
    const ids: string[] = [];
    const srcSel = source.options.find(o => o.port.id === srcPortId);
    const tgtSel = target.options.find(o => o.port.id === tgtPortId);
    if (srcSel && !srcSel.free && srcSel.usedBy) ids.push(srcSel.usedBy.linkId);
    if (tgtSel && !tgtSel.free && tgtSel.usedBy) ids.push(tgtSel.usedBy.linkId);
    return ids;
  }, [srcPortId, tgtPortId, source.options, target.options]);

  const canOk = srcPortId && tgtPortId;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(null);
      else if (e.key === 'Enter' && canOk) {
        onClose({ sourcePortId: srcPortId, targetPortId: tgtPortId, cable, replaceLinks: activeReplaces });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canOk, srcPortId, tgtPortId, cable, activeReplaces, onClose]);

  const willReplace = activeReplaces.length > 0;

  return (
    <div style={overlay} onClick={() => onClose(null)}>
      <div style={card} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={headerBadge}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 9V3h6v6M9 15v6h6v-6M3 9h6M15 9h6M3 15h6M15 15h6"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0F172A' }}>Соединить устройства</div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
              <b>{source.device.name}</b> ({source.device.kind}) → <b>{target.device.name}</b> ({target.device.kind})
            </div>
          </div>
          <button style={closeBtn} onClick={() => onClose(null)} title="Отмена (Esc)">✕</button>
        </div>

        {/* Two panels */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <SidePanel
            title={source.device.name}
            deviceKind={source.device.kind}
            options={source.options}
            selectedId={srcPortId}
            onPick={(o) => chooseSide('src', o)}
          />
          <SidePanel
            title={target.device.name}
            deviceKind={target.device.kind}
            options={target.options}
            selectedId={tgtPortId}
            onPick={(o) => chooseSide('tgt', o)}
          />
        </div>

        {/* Cable type */}
        <div style={{ marginTop: 14 }}>
          <div style={labelStyle}>Тип кабеля</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            {(['copper', 'fiber', 'wifi'] as const).map(c => (
              <button key={c} onClick={() => setCable(c)}
                style={{
                  flex: 1, padding: '6px 10px', borderRadius: 6,
                  border: cable === c ? '1.5px solid #2563EB' : '1px solid #D1D5DB',
                  background: cable === c ? '#EFF6FF' : '#FFFFFF',
                  color: cable === c ? '#1D4ED8' : '#374151',
                  cursor: 'pointer', fontSize: 12, fontWeight: cable === c ? 600 : 400,
                }}>
                {c === 'copper' ? 'Медь RJ-45' : c === 'fiber' ? 'Оптика (SFP)' : 'Wi-Fi'}
              </button>
            ))}
          </div>
        </div>

        {/* Replace warning */}
        {willReplace && (
          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 8,
            background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E',
            fontSize: 11, display: 'flex', alignItems: 'flex-start', gap: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12" y2="17.01"/>
            </svg>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>
                Будут удалены существующие связи ({activeReplaces.length})
              </div>
              <div>
                {activeReplaces.map(linkId => {
                  const src = source.options.find(o => o.usedBy?.linkId === linkId);
                  const tgt = target.options.find(o => o.usedBy?.linkId === linkId);
                  const opt = src || tgt;
                  const side = src ? source.device.name : target.device.name;
                  return opt?.usedBy ? (
                    <div key={linkId}>
                      • {side} :{opt.port.id.toUpperCase()} ↔ {opt.usedBy.peerDeviceName}
                      {opt.usedBy.peerPortId ? ` :${opt.usedBy.peerPortId.toUpperCase()}` : ''}
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={() => onClose(null)} style={btnSecondary}>Отмена</button>
          <button disabled={!canOk}
                  onClick={() => onClose({ sourcePortId: srcPortId, targetPortId: tgtPortId, cable, replaceLinks: activeReplaces })}
                  style={{
                    ...(willReplace ? btnDanger : btnPrimary),
                    opacity: canOk ? 1 : 0.5,
                    cursor: canOk ? 'pointer' : 'not-allowed',
                  }}>
            {willReplace ? 'Заменить связь' : 'Соединить'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side panel — port grid with free/occupied states
// ---------------------------------------------------------------------------

function SidePanel({
  title, deviceKind, options, selectedId, onPick,
}: {
  title: string; deviceKind: string;
  options: PortOption[]; selectedId: string;
  onPick: (o: PortOption) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      o.port.id.toLowerCase().includes(q) ||
      (o.port.label || '').toLowerCase().includes(q) ||
      (o.usedBy?.peerDeviceName || '').toLowerCase().includes(q)
    );
  }, [options, query]);

  const freeCount = options.filter(o => o.free).length;
  const showSearch = options.length > 8;

  return (
    <div style={panelBox}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
        <div style={{ fontSize: 10, color: '#64748B' }}>
          {freeCount === 0
            ? <span style={{ color: '#DC2626', fontWeight: 600 }}>все заняты</span>
            : <>свободно <b>{freeCount}</b>/{options.length}</>}
        </div>
      </div>
      <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {deviceKind}
      </div>

      {showSearch && (
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Поиск порта…"
          style={searchInput}
        />
      )}

      <div style={portGrid}>
        {filtered.length === 0 && (
          <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#94A3B8', textAlign: 'center', padding: 12 }}>
            Портов не найдено
          </div>
        )}
        {filtered.map(o => (
          <PortTile key={o.port.id} option={o} selected={o.port.id === selectedId} onClick={() => onPick(o)} />
        ))}
      </div>
    </div>
  );
}

function PortTile({ option, selected, onClick }: { option: PortOption; selected: boolean; onClick: () => void }) {
  const { port, free, usedBy } = option;
  const speedColor = speedTint(port.speed);
  const bg = selected
    ? (free ? '#DBEAFE' : '#FEE2E2')
    : (free ? '#F0FDF4' : '#FEF3C7');
  const borderColor = selected
    ? (free ? '#2563EB' : '#DC2626')
    : (free ? '#BBF7D0' : '#FDE68A');

  return (
    <button
      onClick={onClick}
      title={
        (free ? 'Свободный порт' : `Занят: ${usedBy?.peerDeviceName || '?'}${usedBy?.peerPortId ? ' :' + usedBy.peerPortId : ''}`)
        + (port.vlan ? ` · VLAN ${port.vlan}` : '')
      }
      style={{
        border: '1.5px solid ' + borderColor,
        background: bg,
        padding: '6px 8px',
        borderRadius: 6,
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 3,
        textAlign: 'left', minHeight: 52,
        transition: 'transform 100ms ease, box-shadow 100ms ease',
        transform: selected ? 'translateY(-1px)' : 'none',
        boxShadow: selected ? '0 4px 12px rgba(37,99,235,0.15)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 11, color: '#0F172A', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
          {port.id.toUpperCase()}
        </span>
        {port.speed && (
          <span style={{
            fontSize: 8, fontWeight: 700,
            padding: '1px 4px', borderRadius: 3,
            background: speedColor.bg, color: speedColor.fg,
          }}>{port.speed}</span>
        )}
        {port.poe && (
          <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: '#FEF3C7', color: '#92400E' }}>PoE</span>
        )}
      </div>
      {free ? (
        <span style={{ fontSize: 9, color: '#166534', fontStyle: port.label ? undefined : 'italic' }}>
          {port.label || 'свободен'}
        </span>
      ) : (
        <span style={{ fontSize: 9, color: '#92400E', display: 'flex', alignItems: 'center', gap: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
            <path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1"/>
            <path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/>
          </svg>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {usedBy?.peerDeviceName}
            {usedBy?.peerPortId ? ` :${usedBy.peerPortId}` : ''}
          </span>
        </span>
      )}
      {port.vlan && (
        <span style={{ fontSize: 8, color: '#4338CA', fontWeight: 600 }}>VLAN {port.vlan}</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function guessCable(
  srcOptions: PortOption[],
  tgtOptions: PortOption[],
  srcId: string,
  tgtId: string,
): 'copper' | 'fiber' | 'wifi' {
  const s = srcOptions.find(o => o.port.id === srcId)?.port;
  const t = tgtOptions.find(o => o.port.id === tgtId)?.port;
  if (s?.type === 'SFP' || s?.type === 'SFP+' || t?.type === 'SFP' || t?.type === 'SFP+') return 'fiber';
  if (s?.type === 'WiFi' || t?.type === 'WiFi') return 'wifi';
  return 'copper';
}

function speedTint(speed?: string): { bg: string; fg: string } {
  switch (speed) {
    case '10G': case '25G': case '40G': case '100G':
      return { bg: '#EDE9FE', fg: '#6D28D9' };
    case '2.5G': case '1G':
      return { bg: '#DBEAFE', fg: '#1D4ED8' };
    case '100M':
      return { bg: '#FEF9C3', fg: '#854D0E' };
    case '10M':
      return { bg: '#FEE2E2', fg: '#991B1B' };
    case 'PoE':
      return { bg: '#FEF3C7', fg: '#92400E' };
    default:
      return { bg: '#F1F5F9', fg: '#475569' };
  }
}

// ---- styles ----
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 200000, backdropFilter: 'blur(2px)',
};
const card: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: 12, padding: 18,
  width: 720, maxWidth: 'calc(100vw - 32px)', maxHeight: '92vh',
  boxShadow: '0 20px 40px rgba(15,23,42,0.28)',
  border: '1px solid #E5E7EB', color: '#111827',
  fontFamily: 'system-ui, sans-serif',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
};
const headerBadge: React.CSSProperties = {
  width: 34, height: 34, borderRadius: 8,
  background: 'linear-gradient(135deg, #3B82F6, #6366F1)',
  color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0,
};
const closeBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6, border: '1px solid #E2E8F0',
  background: '#fff', color: '#64748B', cursor: 'pointer',
  fontSize: 14, lineHeight: 1,
};
const panelBox: React.CSSProperties = {
  background: '#F8FAFC', border: '1px solid #E2E8F0',
  borderRadius: 8, padding: 10, minHeight: 200, maxHeight: '48vh',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
};
const searchInput: React.CSSProperties = {
  padding: '4px 8px', border: '1px solid #CBD5E1', borderRadius: 4,
  fontSize: 11, marginBottom: 6, background: '#fff',
};
const portGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 4,
  overflow: 'auto', flex: 1,
};
const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#6B7280',
  textTransform: 'uppercase', letterSpacing: 0.4,
};
const btnSecondary: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #D1D5DB',
  color: '#374151', padding: '7px 14px', borderRadius: 6,
  cursor: 'pointer', fontSize: 12, fontWeight: 500,
};
const btnPrimary: React.CSSProperties = {
  background: '#2563EB', border: 'none', color: '#FFFFFF',
  padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
  fontSize: 12, fontWeight: 600,
};
const btnDanger: React.CSSProperties = {
  background: '#DC2626', border: 'none', color: '#FFFFFF',
  padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
  fontSize: 12, fontWeight: 600,
};
