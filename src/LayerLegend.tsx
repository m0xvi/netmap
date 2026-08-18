import { useMemo, useState } from 'react';
import { useStore } from './store';
import { LAYER_META, countByLayer } from './layers';
import type { NetworkLayer } from './types';

/**
 * Small legend in the bottom-left corner of the canvas showing the Cisco
 * 3-tier layer colors and per-layer counts.
 */
export function LayerLegend() {
  const doc = useStore(s => s.doc);
  const filters = useStore(s => s.filters);
  const setLayerVisibility = useStore(s => s.setLayerVisibility);
  const [expanded, setExpanded] = useState(true);
  const counts = useMemo(() => countByLayer(doc.devices), [doc.devices]);

  if (doc.devices.length === 0) return null;

  return (
    <div style={{
      position: 'absolute', left: 10, bottom: 10, zIndex: 15,
      background: 'rgba(255,255,255,0.95)',
      border: '1px solid #E5E7EB',
      borderRadius: 8,
      padding: expanded ? '8px 10px' : '4px 8px',
      color: '#111827',
      fontSize: 10,
      minWidth: expanded ? 140 : 'auto',
      backdropFilter: 'blur(4px)',
      boxShadow: '0 4px 12px rgba(15,23,42,0.10)',
    }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 6,
                 cursor: 'pointer', fontSize: 9, opacity: 0.6,
                 textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700,
                 marginBottom: expanded ? 6 : 0 }}
      >
        <span>🏛 Иерархия</span>
        <span style={{ marginLeft: 'auto', fontSize: 8 }}>{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (['core','distribution','access'] as NetworkLayer[]).map(l => {
        const lm = LAYER_META[l];
        const visible = !filters.hiddenLayers.has(l);
        const count = counts[l];
        return (
          <div key={l}
               onClick={() => setLayerVisibility(l, !visible)}
               title={`Клик — ${visible ? 'скрыть' : 'показать'} ${lm.label}`}
               style={{
                 display: 'flex', alignItems: 'center', gap: 6,
                 padding: '2px 4px', borderRadius: 3,
                 cursor: 'pointer', opacity: visible ? 1 : 0.4,
                 transition: 'opacity 0.1s',
               }}
               onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#F3F4F6'}
               onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}>
            <div style={{
              width: 12, height: 4, borderRadius: 1,
              background: lm.color, boxShadow: `0 0 4px ${lm.color}66`,
            }} />
            <span style={{ flex: 1, color: lm.color, fontWeight: 600 }}>{lm.label}</span>
            <span style={{ opacity: 0.6 }}>{count}</span>
            <span style={{ fontSize: 9 }}>{visible ? '' : '⊘'}</span>
          </div>
        );
      })}
    </div>
  );
}
