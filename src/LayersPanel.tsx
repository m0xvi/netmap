/**
 * Панель «Слои / фильтры»: пресеты, Cisco 3-tier, типы устройств/кабелей,
 * PoE, теги, VLAN. Вся логика фильтрации — в сторе (filters/*), здесь
 * только представление.
 *
 * v0.53.0 — визуальный редизайн: минималистичные карточки, SVG-иконки
 * вместо текстовых глифов (●/⊘/↯/▣), складные секции, пилюли-счётчики,
 * счётчики связей у типов кабелей, пустые секции скрываются целиком.
 */
import { useMemo, useState } from 'react';
import { useStore, activeFilterCount } from './store';
import type { DeviceKind, NetworkLayer } from './types';
import { ICONS, KIND_META } from './icons';
import { LAYER_PRESETS } from './layerPresets';
import { LAYER_META, countByLayer } from './layers';

const KINDS: DeviceKind[] = [
  'router','switch','patchpanel','ap','camera','server','vm','vps',
  'pc','pos','printer','lock','cloud','pbx','dvr','other'
];

// ---------------------------------------------------------------------------
// SVG-иконки (по конвенции проекта — без эмодзи/редких юникод-символов)
// ---------------------------------------------------------------------------

const IconEye = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const IconEyeOff = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.5 10.5 0 0 1 12 19c-6.5 0-10-7-10-7a17.6 17.6 0 0 1 4.06-4.94M9.9 4.24A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a17.7 17.7 0 0 1-2.16 3.19M14.12 14.12A3 3 0 1 1 9.88 9.88" />
    <path d="M2 2l20 20" />
  </svg>
);
const IconChevron = ({ open }: { open: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
       style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
const IconX = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2.5" strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
const IconBolt = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2L3 14h7l-1 8 10-12h-7z" />
  </svg>
);

/** Пиктограммы пресетов по их id. */
function PresetIcon({ id }: { id: string }) {
  const common = {
    width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  } as const;
  switch (id) {
    case 'all':
      return (<svg {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" fill="currentColor" /></svg>);
    case 'data':
      return (<svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 12h18M12 3v18" /></svg>);
    case 'cctv':
      return (<svg {...common}><rect x="2" y="7" width="13" height="10" rx="2" /><path d="M15 10l7-3v10l-7-3" /></svg>);
    case 'wifi':
      return (<svg {...common}><path d="M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10 10 0 0 1 13 0M8.6 16a5 5 0 0 1 6.8 0" /><circle cx="12" cy="19" r="1.4" fill="currentColor" /></svg>);
    case 'salto':
      return (<svg {...common}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>);
    case 'poe':
      return (<svg {...common}><path d="M13 2L3 14h7l-1 8 10-12h-7z" /></svg>);
    case 'external':
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" /></svg>);
    case 'core-only':
      return (<svg {...common}><path d="M12 2l8 10-8 10-8-10z" fill="currentColor" stroke="none" /></svg>);
    case 'core-dist':
      return (<svg {...common}><path d="M12 2l8 10-8 10-8-10z" /></svg>);
    default:
      return (<svg {...common}><circle cx="12" cy="12" r="8" /></svg>);
  }
}

/** Ромб/круг уровня Cisco 3-tier. */
function LayerGlyph({ layer, color }: { layer: NetworkLayer; color: string }) {
  if (layer === 'core') {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24">
        <path d="M12 2l8 10-8 10-8-10z" fill={color} />
      </svg>
    );
  }
  if (layer === 'distribution') {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2">
        <path d="M12 2l8 10-8 10-8-10z" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2">
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Панель
// ---------------------------------------------------------------------------

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
  const visibleKinds = useMemo(() => KINDS.filter(k => (kindCounts.get(k) || 0) > 0), [kindCounts]);

  // v0.53.0: счётчики связей по типам кабелей.
  const cableCounts = useMemo(() => {
    const c = { copper: 0, fiber: 0, wifi: 0 };
    for (const l of doc.links) {
      const k = (l.cable || 'copper') as keyof typeof c;
      if (k in c) c[k]++;
    }
    return c;
  }, [doc.links]);

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
    <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', gap: 2 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10, padding: '0 2px',
      }}>
        <div style={{
          fontSize: 11, color: '#64748B',
          fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
        }}>
          Слои / фильтры
        </div>
        {active > 0 ? (
          <button onClick={resetFilters}
                  title="Сбросить все фильтры"
                  style={{
                    background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C',
                    fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 999,
                    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
                  }}>
            <IconX /> {active}
          </button>
        ) : (
          <span style={{ fontSize: 10, color: '#CBD5E1' }}>Всё видно</span>
        )}
      </div>

      {/* ---- Presets ---- */}
      <div style={{ marginBottom: 10 }}>
        <SectionLabel>Пресеты</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          {LAYER_PRESETS.map(p => {
            const isActive = activePresetId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setFilters(p.build())}
                title={p.hint}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '7px 9px',
                  background: isActive ? '#EFF6FF' : '#FFFFFF',
                  border: `1px solid ${isActive ? '#93C5FD' : '#E5E7EB'}`,
                  boxShadow: isActive ? '0 0 0 1px #BFDBFE' : 'none',
                  color: isActive ? '#1D4ED8' : '#374151', borderRadius: 9,
                  fontSize: 11, fontWeight: isActive ? 700 : 500, cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = '#93C5FD';
                    (e.currentTarget as HTMLButtonElement).style.background = '#F8FAFC';
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = '#E5E7EB';
                    (e.currentTarget as HTMLButtonElement).style.background = '#FFFFFF';
                  }
                }}
              >
                <PresetIcon id={p.id} />
                <span style={{ flex: 1, textAlign: 'left' }}>{p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Cisco 3-tier hierarchy ---- */}
      <Section title="Иерархия сети">
        {(['core','distribution','access'] as NetworkLayer[]).map(l => {
          const lm = LAYER_META[l];
          const count = layerCounts[l];
          const visible = !filters.hiddenLayers.has(l);
          return (
            <div key={l} className="lyr-row" style={rowStyle(visible)}
                 onClick={() => setLayerVisibility(l, !visible)}>
              <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: lm.color, flexShrink: 0 }} />
              <LayerGlyph layer={l} color={lm.color} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: lm.color, letterSpacing: 0.3 }}>{lm.label}</div>
                <div style={{ fontSize: 9.5, color: '#94A3B8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lm.description}</div>
              </div>
              <CountBadge value={count} />
              <EyeToggle visible={visible} />
            </div>
          );
        })}
      </Section>

      {/* ---- Device kinds (hidden entirely when the doc has no devices) ---- */}
      {visibleKinds.length > 0 && (
        <Section title="Типы устройств">
          {visibleKinds.map(k => {
            const meta = KIND_META[k];
            const Icon = ICONS[k];
            const count = kindCounts.get(k) || 0;
            const visible = !filters.hiddenKinds.has(k);
            return (
              <div key={k} className="lyr-row" style={rowStyle(visible)}
                   onClick={() => setKindVisibility(k, !visible)}>
                <div style={{ color: meta.color, display: 'flex', width: 18, justifyContent: 'center' }}><Icon size={15} /></div>
                <span style={{ flex: 1, textTransform: 'capitalize', fontSize: 11.5, fontWeight: 500 }}>{meta.label.toLowerCase()}</span>
                <CountBadge value={count} />
                <EyeToggle visible={visible} />
              </div>
            );
          })}
        </Section>
      )}

      {/* ---- Cable types ---- */}
      <Section title="Типы кабелей">
        {(['copper','fiber','wifi'] as const).map(c => {
          const visible = !filters.hiddenCables.has(c);
          const meta = CABLE_META[c];
          return (
            <div key={c} className="lyr-row" style={rowStyle(visible)}
                 onClick={() => setCableVisibility(c, !visible)}>
              <div style={{
                width: 16, height: 3, borderRadius: 2, flexShrink: 0,
                background: c === 'wifi' ? 'transparent' : meta.color,
                border: c === 'wifi' ? `1.5px dashed ${meta.color}` : 'none',
              }} />
              <span style={{ flex: 1, fontSize: 11.5, fontWeight: 500 }}>{meta.label}</span>
              <CountBadge value={cableCounts[c]} />
              <EyeToggle visible={visible} />
            </div>
          );
        })}
      </Section>

      {/* ---- PoE only toggle ---- */}
      <Section title="Питание">
        <div className="lyr-row" style={rowStyle(true)} onClick={() => setPoeOnly(!filters.poeOnly)}>
          <span style={{ color: filters.poeOnly ? '#D97706' : '#9CA3AF', display: 'flex', width: 18, justifyContent: 'center' }}>
            <IconBolt />
          </span>
          <span style={{ flex: 1, fontSize: 11.5, fontWeight: 500 }}>Только PoE-активные</span>
          <span style={{
            width: 30, height: 17, borderRadius: 999, flexShrink: 0,
            background: filters.poeOnly ? '#2563EB' : '#E5E7EB',
            position: 'relative', transition: 'background 0.15s',
          }}>
            <span style={{
              position: 'absolute', top: 2, left: filters.poeOnly ? 15 : 2,
              width: 13, height: 13, borderRadius: '50%', background: '#fff',
              boxShadow: '0 1px 2px rgba(0,0,0,0.2)', transition: 'left 0.15s',
            }} />
          </span>
        </div>
      </Section>

      {/* ---- Tags ---- */}
      {allTags.length > 0 && (
        <Section title="Теги" right={filters.tag ? (
          <button onClick={(e) => { e.stopPropagation(); setTagFilter(null); }}
                  title="Снять фильтр по тегу"
                  style={{
                    background: 'transparent', border: 'none', color: '#059669',
                    fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                  }}>
            {filters.tag} <IconX />
          </button>
        ) : undefined}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {allTags.map(t => {
              const isActive = filters.tag === t;
              return (
                <button key={t}
                        onClick={() => setTagFilter(isActive ? null : t)}
                        style={{
                          background: isActive ? '#D1FAE5' : '#FFFFFF',
                          border: `1px solid ${isActive ? '#6EE7B7' : '#E5E7EB'}`,
                          color: isActive ? '#065F46' : '#4B5563',
                          fontSize: 10, fontWeight: isActive ? 700 : 500,
                          padding: '3px 9px', borderRadius: 999,
                          cursor: 'pointer', transition: 'all 0.12s',
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
        <Section title="VLAN" right={filters.vlan != null ? (
          <button onClick={(e) => { e.stopPropagation(); setVlanFilter(null); }}
                  title="Снять фильтр по VLAN"
                  style={{
                    background: 'transparent', border: 'none', color: '#1D4ED8',
                    fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                  }}>
            {filters.vlan} <IconX />
          </button>
        ) : undefined}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {vlans.map(v => {
              const isActive = filters.vlan === v;
              return (
                <button key={v}
                        onClick={() => setVlanFilter(isActive ? null : v)}
                        style={{
                          background: isActive ? '#DBEAFE' : '#FFFFFF',
                          border: `1px solid ${isActive ? '#93C5FD' : '#E5E7EB'}`,
                          color: isActive ? '#1D4ED8' : '#4B5563',
                          fontSize: 10, fontWeight: isActive ? 700 : 500,
                          padding: '3px 9px', borderRadius: 999,
                          fontFamily: 'monospace', cursor: 'pointer', transition: 'all 0.12s',
                        }}>
                  {v}
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {vlans.length === 0 && (
        <div style={{
          fontSize: 10, color: '#9CA3AF', textAlign: 'center', marginTop: 6,
          border: '1px dashed #E5E7EB', borderRadius: 9, padding: '10px 8px',
          background: '#FAFAFA', lineHeight: 1.5,
        }}>
          VLANов пока нет.<br />Задайте VLAN в свойствах порта.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9.5, color: '#9CA3AF', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: 0.6,
      marginBottom: 5, padding: '0 3px',
    }}>
      {children}
    </div>
  );
}

function Section({ title, right, children }: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        marginBottom: open ? 5 : 0, padding: '0 3px', cursor: 'pointer',
        userSelect: 'none',
      }}
        onClick={() => setOpen(o => !o)}
        title={open ? 'Свернуть' : 'Развернуть'}>
        <span style={{ color: '#CBD5E1', display: 'flex' }}><IconChevron open={open} /></span>
        <span style={{
          fontSize: 9.5, color: '#9CA3AF', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: 0.6,
        }}>
          {title}
        </span>
        <span style={{ flex: 1 }} />
        {right}
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function CountBadge({ value }: { value: number }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, color: '#475569',
      background: '#F1F5F9', borderRadius: 999, padding: '1px 7px',
      minWidth: 22, textAlign: 'center', fontVariantNumeric: 'tabular-nums',
    }}>
      {value}
    </span>
  );
}

function EyeToggle({ visible }: { visible: boolean }) {
  return (
    <span style={{
      color: visible ? '#64748B' : '#CBD5E1',
      display: 'flex', width: 18, justifyContent: 'center', flexShrink: 0,
    }}>
      {visible ? <IconEye /> : <IconEyeOff />}
    </span>
  );
}

const rowStyle = (visible: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '6px 8px', borderRadius: 9,
  background: '#FFFFFF', border: '1px solid #EFEFEF',
  fontSize: 11, cursor: 'pointer', color: '#111827',
  opacity: visible ? 1 : 0.5,
  transition: 'all 0.15s',
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

// Hover-подсветка строк (инлайн-стили :hover не умеют — один класс на всех).
if (typeof document !== 'undefined' && !document.getElementById('nm-layers-styles')) {
  const s = document.createElement('style');
  s.id = 'nm-layers-styles';
  s.textContent = '.lyr-row:hover { border-color: #CBD5E1 !important; background: #F8FAFC !important; }';
  document.head.appendChild(s);
}
