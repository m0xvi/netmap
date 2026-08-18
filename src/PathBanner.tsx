import { useState } from 'react';
import { useStore } from './store';

export function PathBanner() {
  const doc = useStore(s => s.doc);
  const pathA = useStore(s => s.pathA);
  const pathB = useStore(s => s.pathB);
  const pathIds = useStore(s => s.pathIds);
  const pathLinkIds = useStore(s => s.pathLinkIds);
  const pathSteps = useStore(s => s.pathSteps);
  const clearPath = useStore(s => s.clearPath);
  const [expanded, setExpanded] = useState(false);

  if (!pathA && !pathB) return null;

  const devA = doc.devices.find(d => d.id === pathA);
  const devB = doc.devices.find(d => d.id === pathB);
  const byId = new Map(doc.devices.map(d => [d.id, d]));

  const status = !pathA
    ? null
    : !pathB
      ? `Shift+клик по второму устройству`
      : pathIds.size === 0
        ? 'Путь не найден — устройства не связаны'
        : `${pathIds.size - 1} хопов · ${pathLinkIds.size} кабелей`;

  return (
    <div style={{
      position: 'absolute',
      top: 10, left: '50%', transform: 'translateX(-50%)',
      zIndex: 20,
      background: 'rgba(255,255,255,0.95)',
      border: '1px solid #2563EB88',
      borderRadius: 8,
      padding: '8px 14px',
      color: '#111827',
      fontSize: 12,
      boxShadow: '0 4px 16px rgba(15,23,42,0.12)',
      display: 'flex', flexDirection: 'column', gap: 6,
      maxWidth: '85%', minWidth: 320,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 14 }}>🧭</span>
        <span style={endpoint}>{devA?.name || '?'}</span>
        <span style={{ opacity: 0.5 }}>→</span>
        <span style={endpoint}>{devB?.name || '?'}</span>
        <span style={{ opacity: 0.7, fontSize: 11, flex: 1 }}>{status}</span>
        {pathSteps.length > 0 && (
          <button onClick={() => setExpanded(v => !v)}
                  title={expanded ? 'Свернуть детали' : 'Показать порт-в-порт'}
                  style={miniBtn}>
            {expanded ? '▲' : '▼'}
          </button>
        )}
        <button onClick={clearPath} title="Escape"
                style={{ ...miniBtn, color: '#B91C1C', borderColor: '#FCA5A5', background: '#FEE2E2' }}>
          ✕
        </button>
      </div>

      {expanded && pathSteps.length > 0 && (
        <div style={{
          borderTop: '1px solid #E5E7EB',
          paddingTop: 6, marginTop: 2,
          display: 'grid', gap: 4,
          maxHeight: 280, overflowY: 'auto',
          fontFamily: '-apple-system, monospace', fontSize: 11,
        }}>
          {pathSteps.map((step, i) => {
            const from = byId.get(step.fromDeviceId);
            const to   = byId.get(step.toDeviceId);
            const isSynthetic = !step.linkId;
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '3px 6px', borderRadius: 4,
                background: 'rgba(88,166,255,0.08)',
                border: '1px solid rgba(88,166,255,0.2)',
              }}>
                <span style={{ opacity: 0.5, minWidth: 16, textAlign: 'right' }}>{i + 1}.</span>
                <span style={{ fontWeight: 600, color: '#111827' }}>{from?.name || step.fromDeviceId}</span>
                {step.fromPortId && <span style={portTag}>{step.fromPortId}</span>}
                <span style={{ opacity: 0.5 }}>
                  {isSynthetic ? '⇢' : step.cable === 'fiber' ? '━━' : step.cable === 'wifi' ? '···' : '──'}
                </span>
                {step.toPortId && <span style={portTag}>{step.toPortId}</span>}
                <span style={{ fontWeight: 600, color: '#111827' }}>{to?.name || step.toDeviceId}</span>
                {isSynthetic && (
                  <span style={{ marginLeft: 'auto', fontSize: 9, color: '#a78bfa', fontStyle: 'italic' }}>
                    hosted on
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const endpoint: React.CSSProperties = {
  background: '#2563EB', color: '#fff',
  padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200,
};

const portTag: React.CSSProperties = {
  background: '#D1FAE5', color: '#065F46',
  padding: '1px 5px', borderRadius: 3, fontSize: 10,
  border: '1px solid #10B981',
  fontFamily: 'monospace',
};

const miniBtn: React.CSSProperties = {
  background: '#E5E7EB', border: '1px solid #D1D5DB', color: '#111827',
  borderRadius: 4, padding: '2px 8px', fontSize: 10, cursor: 'pointer',
};
