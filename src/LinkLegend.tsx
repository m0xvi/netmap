/**
 * v0.41.2 — floating "Link Legend" widget shown in the top-left of the
 * canvas (like the reference design). Explains cable colours and speeds.
 *
 * Only rendered when store.viewMode === 'modern' AND the map has at least
 * one link — otherwise it's clutter. Can be hidden with the × button in
 * the corner (persisted in localStorage).
 */

import { useEffect, useState } from 'react';
import { useStore } from './store';

const LS_KEY = 'netmap:linkLegendHidden';

export function LinkLegend() {
  const viewMode = useStore(s => s.viewMode);
  const linkCount = useStore(s => s.doc.links.length);
  const [hidden, setHidden] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, hidden ? '1' : '0'); } catch {}
  }, [hidden]);

  if (viewMode !== 'modern') return null;
  if (linkCount === 0) return null;
  if (hidden) {
    return (
      <button
        onClick={() => setHidden(false)}
        title="Показать легенду связей"
        style={{
          position: 'absolute', top: 16, left: 16,
          padding: '5px 10px', border: '1px solid #E5E7EB',
          background: 'white', color: '#64748B',
          borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 600,
          boxShadow: '0 2px 6px rgba(15,23,42,0.06)',
          zIndex: 5,
        }}
      >☰ Легенда</button>
    );
  }

  return (
    <div style={{
      position: 'absolute', top: 16, left: 16,
      background: 'white', border: '1px solid #E5E7EB',
      borderRadius: 10, padding: '10px 12px',
      boxShadow: '0 2px 8px rgba(15,23,42,0.06)',
      minWidth: 160, zIndex: 5,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#0F172A' }}>Легенда связей</div>
        <button
          onClick={() => setHidden(true)}
          style={{
            border: 'none', background: 'transparent', color: '#94A3B8',
            cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1,
          }}
          title="Скрыть"
        >×</button>
      </div>
      <div style={{ display: 'grid', gap: 5 }}>
        <LegendRow color="#7C3AED" width={4} label="100 Gbps" />
        <LegendRow color="#3B82F6" width={3} label="10 Gbps" />
        <LegendRow color="#22C55E" width={2} label="1 Gbps" />
        <LegendRow color="#F59E0B" width={1.5} label="100 Mbps" />
      </div>
    </div>
  );
}

function LegendRow({ color, width, label }: { color: string; width: number; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: '#475569' }}>
      <div style={{
        width: 32, height: width, background: color, borderRadius: 2,
      }} />
      <span>{label}</span>
    </div>
  );
}
