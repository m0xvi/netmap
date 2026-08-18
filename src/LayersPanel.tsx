import { useMemo } from 'react';
import { useStore, activeFilterCount } from './store';
import type { DeviceKind, NetworkLayer } from './types';
import { ICONS, KIND_META } from './icons';
import { LAYER_PRESETS } from './layerPresets';
import { LAYER_META, countByLayer } from './layers';

const KINDS: DeviceKind[] = [
  'router','switch','patchpanel','ap','camera','server','vm','vps',
  'pc','pos','printer','lock','cloud'
];

export function LayersPanel() {
  const doc = useStore(s => s.doc);
  const filters = useStore(s => s.filters);
  const setKindVisibility = useStore(s => s.setKindVisibility);
  const setLayerVisibility = useStore(s => s.setLayerVisibility);
  const layerCounts = useMemo(() => countByLayer(doc.devices), [doc.devices]);
  const setCableVisibility = useStore(s => s.setCableVisibility);
  const setPoeOnly = useStore(s => s.setPoeOnly);
  const setTagFilter = useStore(s => s.setTagFilter);
  const setVlanFilter = useStore(s => s.setVlanFilter);
  const setFilters = useStore(s => s.setFilters);
  const resetFilters = useStore(s => s.resetFilters);

  // Count devices per kind (for pretty numbers next to filter rows)
  const kindCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of doc.devices) m.set(d.kind, (m.get(d.kind) || 0) + 1);
    return m;
  }, [doc.devices]);

  // Collect all VLANs mentioned anywhere
  const vlans = useMemo(() => {
    const s = new Set<number>();
    doc.devices.forEach(d => d.ports.forEach(p => { if (p.vlan != null) s.add(p.vlan); }));
    doc.links.forEach(l => { if (l.vlan != null) s.add(l.vlan); });
    return [...s].sort((a, b) => a - b);
  }, [doc.devices, doc.links]);

  // Collect all tags
  const allTags = useMemo(() => {
    const s = new Set<string>();
    doc.devices.forEach(d => d.tags?.forEach(t => s.add(t)));
    return [...s].sort();
  }, [doc.devices]);

  const active = activeFilterCount(filters);

  // Detect which preset (if any) matches the current filter state exactly
  const activePresetId = useMemo(() => {
    for (const p of LAYER_PRESETS) {
      const b = p.build();
      if (
        b.poeOnly === filters.poeOnly &&
        setsEqual(b.hiddenKinds, filters.hiddenKinds) &&
        setsEqual(b.hiddenCables, filters.hiddenCables) &&
        setsEqual(b.hiddenLayers, filters.hiddenLayers) &&
        b.tag === filters.tag &&
        b.vlan === filters.vlan
      ) return p.id;
    }
    return null;
  }, [filters]);

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <div style={{
          fontSize: 11, opacity: 0.6,
          fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
        }}>
          Слои / фильтры
        </div>
        {active > 0 && (
          <button onClick={resetFilters}
                  style={{
                    background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#B91C1C',
                    fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                  }}
                  title="Сбросить все фильтры">
            ↺ сбросить {active}
          </button>
        )}
      </div>

      {/* ---- Presets ---- */}
      <div style={{ marginBottom: 12 }}>
        <div style={{
          fontSize: 9, opacity: 0.5, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: 0.4,
          marginBottom: 4, padding: '0 2px',
        }}>
          Пресеты
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {LAYER_PRESETS.map(p => {
            const isActive = activePresetId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setFilters(p.build())}
                title={p.hint}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 8px',
                  background: isActive ? '#2563EB' : '#F9FAFB',
                  border: `1px solid ${isActive ? '#2563EB' : '#D1D5DB'}`,
                  color: '#111827', borderRadius: 5,
                  fontSize: 11, cursor: 'pointer',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => {
                  if (!isActive)
                    (e.currentTarget as HTMLButtonElement).style.borderColor = '#2563EB88';
                }}
                onMouseLeave={e => {
                  if (!isActive)
                    (e.currentTarget as HTMLButtonElement).style.borderColor = '#D1D5DB';
                }}
              >
                <span style={{ fontSize: 14 }}>{p.emoji}</span>
                <span style={{ flex: 1, textAlign: 'left' }}>{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Cisco 3-tier hierarchy ---- */}
      <Section title="Иерархия сети (Cisco 3-tier)">
        {(['core','distribution','access'] as NetworkLayer[]).map(l => {
          const lm = LAYER_META[l];
          const count = layerCounts[l];
          const visible = !filters.hiddenLayers.has(l);
          return (
            <label key={l}
                   style={{ ...rowStyle(visible), borderLeft: `3px solid ${lm.color}` }}
                   onClick={() => setLayerVisibility(l, !visible)}>
              <span style={{ fontSize: 14, width: 16, textAlign: 'center' }}>{lm.emoji}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: lm.color }}>{lm.label}</div>
                <div style={{ fontSize: 9, opacity: 0.6 }}>{lm.description}</div>
              </div>
              <span style={{ opacity: 0.5, fontSize: 9 }}>{count}</span>
              <span style={{ fontSize: 12 }}>{visible ? '👁' : '⊘'}</span>
            </label>
          );
        })}
      </Section>

      {/* ---- Device kinds ---- */}
      <Section title="Типы устройств">
        {KINDS.map(k => {
          const meta = KIND_META[k];
          const Icon = ICONS[k];
          const count = kindCounts.get(k) || 0;
          if (count === 0) return null; // don't show empty categories
          const visible = !filters.hiddenKinds.has(k);
          return (
            <label key={k} style={rowStyle(visible)}
                   onClick={() => setKindVisibility(k, !visible)}>
              <div style={{ color: meta.color, display: 'flex', width: 16 }}><Icon size={14} /></div>
              <span style={{ flex: 1, textTransform: 'capitalize' }}>{meta.label.toLowerCase()}</span>
              <span style={{ opacity: 0.5, fontSize: 9 }}>{count}</span>
              <span style={{ fontSize: 12 }}>{visible ? '👁' : '⊘'}</span>
            </label>
          );
        })}
      </Section>

      {/* ---- Cable types ---- */}
      <Section title="Типы кабелей">
        {(['copper','fiber','wifi'] as const).map(c => {
          const visible = !filters.hiddenCables.has(c);
          const meta = CABLE_META[c];
          return (
            <label key={c} style={rowStyle(visible)}
                   onClick={() => setCableVisibility(c, !visible)}>
              <div style={{
                width: 14, height: 3, borderRadius: 1,
                background: c === 'wifi' ? 'transparent' : meta.color,
                border: c === 'wifi' ? `1px dashed ${meta.color}` : 'none',
              }} />
              <span style={{ flex: 1 }}>{meta.label}</span>
              <span style={{ fontSize: 12 }}>{visible ? '👁' : '⊘'}</span>
            </label>
          );
        })}
      </Section>

      {/* ---- PoE only toggle ---- */}
      <Section title="Питание">
        <label style={rowStyle(!filters.poeOnly)}
               onClick={() => setPoeOnly(!filters.poeOnly)}>
          <span style={{ width: 16, textAlign: 'center' }}>⚡</span>
          <span style={{ flex: 1 }}>Только PoE-активные</span>
          <span style={{ fontSize: 12 }}>{filters.poeOnly ? '✓' : ''}</span>
        </label>
      </Section>

      {/* ---- Tags ---- */}
      {allTags.length > 0 && (
        <Section title={`Теги${filters.tag ? ` · выбран: ${filters.tag}` : ''}`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {allTags.map(t => {
              const active = filters.tag === t;
              return (
                <button key={t}
                        onClick={() => setTagFilter(active ? null : t)}
                        style={{
                          background: active ? '#059669' : '#F9FAFB',
                          border: '1px solid #D1D5DB', color: '#111827',
                          fontSize: 9, padding: '2px 6px', borderRadius: 3,
                          cursor: 'pointer',
                        }}>
                  {t}
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {/* ---- VLANs ---- */}
      {vlans.length > 0 && (
        <Section title="VLAN">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {vlans.map(v => {
              const active = filters.vlan === v;
              return (
                <button key={v}
                        onClick={() => setVlanFilter(active ? null : v)}
                        style={{
                          background: active ? '#2563EB' : '#F9FAFB',
                          border: '1px solid #D1D5DB', color: '#111827',
                          fontSize: 10, padding: '2px 8px', borderRadius: 3,
                          fontFamily: 'monospace', cursor: 'pointer',
                        }}>
                  VLAN {v}
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {vlans.length === 0 && (
        <div style={{ fontSize: 10, opacity: 0.4, textAlign: 'center', marginTop: 8 }}>
          VLAN'ов пока нет.<br/>Задайте VLAN в свойствах порта.
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 9, opacity: 0.5, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: 0.4,
        marginBottom: 4, padding: '0 2px',
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {children}
      </div>
    </div>
  );
}

const rowStyle = (visible: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '4px 6px', borderRadius: 4,
  background: '#F9FAFB', border: '1px solid #E5E7EB',
  fontSize: 11, cursor: 'pointer', color: '#111827',
  opacity: visible ? 1 : 0.45,
  transition: 'opacity 0.12s',
});

const CABLE_META = {
  copper: { label: 'Медь (RJ45)', color: '#eab308' },
  fiber:  { label: 'Оптика (SFP)', color: '#3b82f6' },
  wifi:   { label: 'Wi-Fi',        color: '#f59e0b' },
} as const;

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
