/**
 * v0.35.6 — Port picker dialog for the "drag device onto device → connect"
 * workflow.
 *
 * When a user drops device A on top of device B (Canvas.onNodeDragStop), we
 * open this modal listing FREE ports on both sides. User picks one from each
 * (or accepts pre-selected defaults) and we create a new link.
 *
 * Sits outside Modal.tsx because it needs a richer shape than
 * promptText/confirm/alert (two dropdowns + rich port option labels).
 */
import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Device, Port } from './types';

export interface PortOption {
  port: Port;
  /** Human label built once — "eth3 · RJ45 · 1G · PoE" */
  label: string;
  free: boolean;   // false = already used by another link (shown but disabled)
}

interface DialogSpec {
  source: { device: Device; options: PortOption[] };
  target: { device: Device; options: PortOption[] };
  resolve: (v: { sourcePortId: string; targetPortId: string; cable: 'copper' | 'fiber' | 'wifi' } | null) => void;
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

export function openPortPicker(
  source: { device: Device; options: PortOption[] },
  target: { device: Device; options: PortOption[] },
): Promise<{ sourcePortId: string; targetPortId: string; cable: 'copper' | 'fiber' | 'wifi' } | null> {
  ensureRoot();
  return new Promise((resolve) => {
    const spec: DialogSpec = { source, target, resolve };
    // If root just mounted, setSpec may still be null for a tick; wait.
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

function Card({ spec, onClose }: { spec: DialogSpec; onClose: (v: any) => void }) {
  const { source, target } = spec;
  const firstFreeSrc = source.options.find(o => o.free)?.port.id || source.options[0]?.port.id || '';
  const firstFreeTgt = target.options.find(o => o.free)?.port.id || target.options[0]?.port.id || '';
  const [srcPortId, setSrc] = useState(firstFreeSrc);
  const [tgtPortId, setTgt] = useState(firstFreeTgt);
  const [cable, setCable] = useState<'copper' | 'fiber' | 'wifi'>(() => {
    // Guess cable type from selected port types
    const s = source.options.find(o => o.port.id === firstFreeSrc)?.port;
    const t = target.options.find(o => o.port.id === firstFreeTgt)?.port;
    if (s?.type === 'SFP' || s?.type === 'SFP+' || t?.type === 'SFP' || t?.type === 'SFP+') return 'fiber';
    if (s?.type === 'WiFi' || t?.type === 'WiFi') return 'wifi';
    return 'copper';
  });

  const canOk = srcPortId && tgtPortId
    && source.options.find(o => o.port.id === srcPortId)?.free
    && target.options.find(o => o.port.id === tgtPortId)?.free;

  // Escape to cancel, Enter to confirm
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(null);
      else if (e.key === 'Enter' && canOk) onClose({ sourcePortId: srcPortId, targetPortId: tgtPortId, cable });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canOk, srcPortId, tgtPortId, cable, onClose]);

  return (
    <div style={overlay} onClick={() => onClose(null)}>
      <div style={card} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: '#DBEAFE', color: '#1D4ED8',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
          }}>🔌</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Соединить устройства</div>
            <div style={{ fontSize: 11, color: '#6B7280',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {source.device.name} → {target.device.name}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <SidePicker title={source.device.name} kind={source.device.kind}
                      options={source.options} value={srcPortId} onChange={setSrc} />
          <SidePicker title={target.device.name} kind={target.device.kind}
                      options={target.options} value={tgtPortId} onChange={setTgt} />
        </div>

        <div style={{ marginTop: 12 }}>
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
                {c === 'copper' ? 'Медь RJ-45' : c === 'fiber' ? 'Оптика' : 'Wi-Fi'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={() => onClose(null)} style={btnSecondary}>Отмена</button>
          <button disabled={!canOk}
                  onClick={() => onClose({ sourcePortId: srcPortId, targetPortId: tgtPortId, cable })}
                  style={{
                    ...btnPrimary,
                    opacity: canOk ? 1 : 0.5,
                    cursor: canOk ? 'pointer' : 'not-allowed',
                  }}>
            Соединить
          </button>
        </div>
      </div>
    </div>
  );
}

function SidePicker({ title, kind, options, value, onChange }: {
  title: string; kind: string;
  options: PortOption[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <div style={labelStyle}>{title}</div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 4 }}>{kind}</div>
      <select value={value} onChange={e => onChange(e.target.value)} style={select}>
        {options.map(o => (
          <option key={o.port.id} value={o.port.id} disabled={!o.free}>
            {o.label}{!o.free ? ' — занят' : ''}
          </option>
        ))}
      </select>
      <div style={{ marginTop: 6, fontSize: 10, color: '#6B7280' }}>
        Свободно: <b>{options.filter(o => o.free).length}</b> / {options.length}
      </div>
    </div>
  );
}

// ---- styles ----
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 200000, backdropFilter: 'blur(2px)',
};
const card: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: 10, padding: 18,
  width: 460, maxWidth: 'calc(100vw - 32px)',
  boxShadow: '0 20px 40px rgba(15,23,42,0.28)',
  border: '1px solid #E5E7EB', color: '#111827', fontFamily: 'system-ui, sans-serif',
};
const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#6B7280',
  textTransform: 'uppercase', letterSpacing: 0.4,
};
const select: React.CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 12,
  border: '1px solid #D1D5DB', borderRadius: 6,
  background: '#FFFFFF', color: '#111827', outline: 'none',
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
