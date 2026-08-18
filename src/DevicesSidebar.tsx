/**
 * DevicesSidebar (v0.17) — replaces the rail+slide-out ActivityBar with a
 * single-column left sidebar matching the reference mockup:
 *
 *   ┌─────────────────┐
 *   │  Devices     ⌄  │  ← header + collapse
 *   │  🔎 Search…     │
 *   │                 │
 *   │  NETWORK    ⌄   │  ← accordion sections
 *   │  ▪ Core Switch  │  ← draggable rows
 *   │  ▪ Router …     │
 *   │  WIRELESS   ⌄   │
 *   │  ▪ Wi-Fi AP     │
 *   │  …              │
 *   │  [select bar]   │  ← tool mini-bar
 *   │  [ minimap ]    │
 *   └─────────────────┘
 */

import { useState, useMemo } from 'react';
import { useStore, activeFilterCount } from './store';
import type { Device, DeviceKind } from './types';
import { ICONS, KIND_META } from './icons';
import { defaultPortsFor } from './Palette';
import { CatalogPanel } from './CatalogPanel';
import { LayersPanel } from './LayersPanel';
import { VaultPanel } from './VaultPanel';
import { VlansPanel } from './VlansPanel';

const SIDEBAR_W = 260;

interface Section {
  id: string;
  label: string;
  items: {
    kind: DeviceKind;
    label: string;
    hint?: string;
    /** v0.35.7: preset payload copied to the new device on creation.
     *  Lets sidebar items pre-fill dvr/hostSpec/ssids so a "Регистратор 16 кан."
     *  arrives with 16 channels already configured. */
    preset?: {
      dvr?: Device['dvr'];
      hostSpec?: Device['hostSpec'];
      ssids?: Device['ssids'];
    };
  }[];
}

const SECTIONS: Section[] = [
  {
    id: 'network', label: 'Сеть',
    items: [
      { kind: 'switch',     label: 'Свитч (ядро)',       hint: 'Core switch — ядро сети' },
      { kind: 'switch',     label: 'Свитч агрегации',    hint: 'Distribution' },
      { kind: 'switch',     label: 'Свитч доступа',      hint: 'Access switch' },
      { kind: 'router',     label: 'Маршрутизатор',      hint: 'Router' },
      { kind: 'router',     label: 'Файервол',           hint: 'Firewall' },
      { kind: 'patchpanel', label: 'Патч-панель',        hint: 'Patch panel' },
    ]
  },
  {
    id: 'wireless', label: 'Wi-Fi',
    items: [
      { kind: 'ap', label: 'Точка доступа Wi-Fi',    hint: 'Обычный AP' },
      { kind: 'ap', label: 'Точка Wi-Fi 6',          hint: 'AP 802.11ax' },
      { kind: 'ap', label: 'Mesh-нода',              hint: 'Wireless mesh' },
    ]
  },
  {
    id: 'cameras', label: 'Видеонаблюдение',
    items: [
      { kind: 'camera', label: 'Камера цилиндрическая', hint: 'Bullet, уличная' },
      { kind: 'camera', label: 'Камера купольная',      hint: 'Dome' },
      { kind: 'camera', label: 'PTZ-камера',            hint: 'Поворотная' },
      // v0.35.7: DVR / NVR presets — created as kind='server' with a `dvr`
      // payload that ServerNode auto-detects to render the recorder icon.
      { kind: 'server', label: 'Регистратор 8 каналов',   hint: 'NVR · 1×HDD',
        preset: { dvr: {
          channels: 8, activeChannels: 0, resolution: '1080p', retentionDays: 14,
          software: 'Hikvision iVMS',
          disks: [{ sizeGB: 2048, kind: 'HDD', model: 'WD Purple' }],
        } } },
      { kind: 'server', label: 'Регистратор 16 каналов', hint: 'NVR · 2×HDD',
        preset: { dvr: {
          channels: 16, activeChannels: 0, resolution: '1080p', retentionDays: 30,
          software: 'TRASSIR',
          disks: [
            { sizeGB: 4096, kind: 'HDD', model: 'Seagate SkyHawk' },
            { sizeGB: 4096, kind: 'HDD', model: 'Seagate SkyHawk' },
          ],
        } } },
      { kind: 'server', label: 'Регистратор 32 кан. 4K', hint: 'NVR · 4×HDD',
        preset: { dvr: {
          channels: 32, activeChannels: 0, resolution: '4K', retentionDays: 30,
          software: 'Dahua DSS',
          disks: [
            { sizeGB: 8192, kind: 'HDD', model: 'WD Purple Pro' },
            { sizeGB: 8192, kind: 'HDD', model: 'WD Purple Pro' },
            { sizeGB: 8192, kind: 'HDD', model: 'WD Purple Pro' },
            { sizeGB: 8192, kind: 'HDD', model: 'WD Purple Pro' },
          ],
        } } },
    ]
  },
  {
    id: 'servers', label: 'Серверы',
    items: [
      { kind: 'server', label: 'Сервер',   hint: 'Физический хост' },
      { kind: 'server', label: 'Rack PDU', hint: 'PDU 1U' },
      { kind: 'server', label: 'СХД',      hint: 'NAS / SAN' },
      { kind: 'vm',     label: 'Виртуальная машина', hint: 'VM на сервере' },
    ]
  },
  {
    id: 'endpoints', label: 'Оконечные устройства',
    items: [
      { kind: 'pc',      label: 'ПК',              hint: 'Рабочая станция' },
      { kind: 'pos',     label: 'Касса',           hint: 'POS-терминал' },
      { kind: 'printer', label: 'Принтер',         hint: 'Сетевой принтер' },
      { kind: 'lock',    label: 'СКУД (замок)',    hint: 'SALTO / контроль доступа' },
      { kind: 'cloud',   label: 'Провайдер / облако', hint: 'ISP / cloud' },
    ]
  },
];

// The tool sub-panels (Catalog / Layers / Vault / VLANs) — hidden by default,
// opened from the mini toolbar at the bottom.
type PanelId = null | 'catalog' | 'layers' | 'vault' | 'vlans' | 'settings';

export function DevicesSidebar() {
  const [openSection, setOpenSection] = useState<Set<string>>(new Set(['network', 'wireless', 'cameras', 'servers']));
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<PanelId>(null);
  // v0.21: sidebar can be collapsed to a thin rail (mini-toolbar only) or expanded.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('netmap:sidebarCollapsed') === '1'; } catch { return false; }
  });
  const toggleCollapsed = () => {
    setCollapsed(v => {
      const nv = !v;
      try { localStorage.setItem('netmap:sidebarCollapsed', nv ? '1' : '0'); } catch {}
      if (nv) setPanel(null);   // close any sub-panel when collapsing
      return nv;
    });
  };

  const addDevice = useStore(s => s.addDevice);
  const select = useStore(s => s.select);
  const filters = useStore(s => s.filters);
  const filterCount = activeFilterCount(filters);
  const vlanCount = useStore(s => s.doc.vlans?.length || 0);

  const toggleSection = (id: string) => {
    const next = new Set(openSection);
    if (next.has(id)) next.delete(id); else next.add(id);
    setOpenSection(next);
  };

  const createOne = (kind: DeviceKind, presetName?: string, preset?: {
    dvr?: Device['dvr']; hostSpec?: Device['hostSpec']; ssids?: Device['ssids'];
  }) => {
    const id = `${kind}-${Math.random().toString(36).slice(2, 7)}`;
    const meta = KIND_META[kind];
    const d: Device = {
      id, name: presetName || `Новый ${meta.label.toLowerCase()}`,
      kind, x: 400, y: 300,
      ports: defaultPortsFor(kind),
      display: 'compact',
      ...(kind === 'vm' ? { vmInfo: { vcpu: 2, ramGb: 4, os: 'Linux' } } : {}),
      // v0.35.7: deep-copy preset payloads so edits to the new device
      // don't mutate the sidebar's SECTIONS constant.
      ...(preset?.dvr ? { dvr: {
        ...preset.dvr,
        disks: preset.dvr.disks ? preset.dvr.disks.map(x => ({ ...x })) : undefined,
      } } : {}),
      ...(preset?.hostSpec ? { hostSpec: {
        ...preset.hostSpec,
        disks: preset.hostSpec.disks ? preset.hostSpec.disks.map(x => ({ ...x })) : undefined,
        software: preset.hostSpec.software ? [...preset.hostSpec.software] : undefined,
      } } : {}),
      ...(preset?.ssids ? { ssids: preset.ssids.map(s => ({ ...s })) } : {}),
    };
    addDevice(d);
    select(id);
  };

  const filtered = useMemo(() => {
    if (!query.trim()) return SECTIONS;
    const q = query.toLowerCase();
    return SECTIONS.map(sec => ({
      ...sec,
      items: sec.items.filter(it =>
        it.label.toLowerCase().includes(q) ||
        it.hint?.toLowerCase().includes(q) ||
        it.kind.toLowerCase().includes(q)
      ),
    })).filter(sec => sec.items.length > 0);
  }, [query]);

  // ============ Collapsed rail — thin 44px column with just the expand button ============
  if (collapsed) {
    return (
      <div style={{ display: 'flex', height: '100%', flexShrink: 0 }}>
        <aside style={{
          width: 44,
          background: '#FFFFFF',
          borderRight: '1px solid #E5E7EB',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '8px 0',
        }}>
          <button onClick={toggleCollapsed}
                  title="Развернуть панель устройств"
                  style={{
                    width: 32, height: 32, borderRadius: 6,
                    background: '#EFF6FF', border: '1px solid #BFDBFE',
                    color: '#2563EB', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 0,
                  }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          <div style={{ flex: 1 }} />
          <MiniToolbarVertical panel={panel} setPanel={(p) => {
            setPanel(p);
            if (p) setCollapsed(false);   // opening a sub-panel expands the sidebar
          }} filterCount={filterCount} vlanCount={vlanCount} />
        </aside>
      </div>
    );
  }

  // ============ Expanded — full sidebar ============
  return (
    <div style={{ display: 'flex', height: '100%', flexShrink: 0 }}>
      <aside style={{
        width: SIDEBAR_W,
        background: '#FFFFFF',
        borderRight: '1px solid #E5E7EB',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 14px 10px',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Устройства</div>
          <button onClick={toggleCollapsed}
                  title="Свернуть панель"
                  style={{
                    marginLeft: 'auto',
                    background: 'transparent', border: 'none',
                    color: '#9CA3AF', cursor: 'pointer',
                    padding: 4, borderRadius: 4,
                    display: 'flex', alignItems: 'center',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#F3F4F6'; (e.currentTarget as HTMLButtonElement).style.color = '#374151'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#9CA3AF'; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '0 14px 10px', position: 'relative' }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Поиск устройств…"
            style={{
              width: '100%', padding: '8px 10px 8px 30px',
              background: '#F9FAFB', border: '1px solid #E5E7EB',
              borderRadius: 8, fontSize: 12, color: '#111827',
              outline: 'none',
            }}
          />
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
               style={{ position: 'absolute', left: 24, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>
          </svg>
        </div>

        {/* Sections */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 12px' }}>
          {filtered.map(sec => {
            const isOpen = openSection.has(sec.id);
            return (
              <div key={sec.id} style={{ marginBottom: 4 }}>
                <div
                  onClick={() => toggleSection(sec.id)}
                  style={{
                    padding: '6px 8px',
                    display: 'flex', alignItems: 'center', gap: 4,
                    cursor: 'pointer',
                    color: '#6B7280', fontSize: 10, fontWeight: 700,
                    letterSpacing: 0.6, textTransform: 'uppercase',
                    userSelect: 'none',
                  }}
                >
                  <span style={{ flex: 1 }}>{sec.label}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                       style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </div>
                {isOpen && (
                  <div>
                    {sec.items.map((item, i) => (
                      <DeviceRow key={`${sec.id}-${i}`}
                                 kind={item.kind}
                                 label={item.label}
                                 hint={item.hint}
                                 onCreate={() => createOne(item.kind, item.label, item.preset)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: '#9CA3AF', fontSize: 11 }}>
              Ничего не найдено
            </div>
          )}
        </div>

        {/* Mini toolbar */}
        <MiniToolbar panel={panel} setPanel={setPanel}
                     filterCount={filterCount}
                     vlanCount={vlanCount} />
      </aside>

      {/* Slide-out sub-panels (Catalog / Layers / Vault / VLANs / Settings) */}
      {panel && (
        <div style={{
          width: 300,
          background: '#FFFFFF',
          borderRight: '1px solid #E5E7EB',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {panel === 'catalog' && <CatalogPanel />}
          {panel === 'layers'  && <LayersPanel />}
          {panel === 'vault'   && <VaultPanel />}
          {panel === 'vlans'   && <VlansPanel />}
          {panel === 'settings'&& <SettingsSubPanel />}
        </div>
      )}
    </div>
  );
}

/** Draggable single-line device entry in the sidebar list. */
function DeviceRow({ kind, label, hint, onCreate }: {
  kind: DeviceKind; label: string; hint?: string; onCreate: () => void;
}) {
  const meta = KIND_META[kind];
  const Icon = ICONS[kind];
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-netmap-kind', kind);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onCreate}
      title={hint ? `${label} — ${hint}` : label}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 10px',
        borderRadius: 6, cursor: 'grab',
        color: '#374151', fontSize: 12,
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#F3F4F6'}
      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
    >
      <div style={{
        width: 24, height: 24, borderRadius: 4,
        background: meta.bg,
        color: meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon size={14} />
      </div>
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </span>
    </div>
  );
}

/** Small toolbar at the bottom of the sidebar (select / grid / line / text / notes). */
function MiniToolbar({ panel, setPanel, filterCount, vlanCount }: {
  panel: PanelId; setPanel: (p: PanelId) => void;
  filterCount: number; vlanCount: number;
}) {
  const items: Array<{ id: PanelId; label: string; icon: React.ReactNode; badge?: number }> = [
    {
      id: 'catalog', label: 'Каталог моделей',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H4z"/><path d="M4 10h16M10 4v16"/></svg>,
    },
    {
      id: 'layers', label: 'Слои / фильтры',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>,
      badge: filterCount,
    },
    {
      id: 'vlans', label: 'VLAN',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>,
      badge: vlanCount,
    },
    {
      id: 'vault', label: 'Vault (пароли)',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.85 12.15L19 4M17 6l2 2M15 8l2 2"/></svg>,
    },
    {
      id: 'settings', label: 'Настройки',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>,
    },
  ];

  return (
    <div style={{
      padding: '10px 12px',
      borderTop: '1px solid #E5E7EB',
      display: 'flex', gap: 4, alignItems: 'center',
    }}>
      {items.map(it => {
        const active = panel === it.id;
        return (
          <button key={String(it.id)}
                  onClick={() => setPanel(active ? null : it.id)}
                  title={it.label}
                  style={{
                    position: 'relative',
                    width: 32, height: 32,
                    background: active ? '#EFF6FF' : 'transparent',
                    border: '1px solid ' + (active ? '#BFDBFE' : 'transparent'),
                    color: active ? '#2563EB' : '#6B7280',
                    borderRadius: 6, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 0,
                    transition: 'all 0.1s',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = '#F3F4F6'; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
            {it.icon}
            {it.badge != null && it.badge > 0 && (
              <span style={{
                position: 'absolute', top: -3, right: -3,
                minWidth: 14, height: 14, padding: '0 3px',
                background: '#EF4444', color: '#FFFFFF',
                borderRadius: 7,
                fontSize: 9, fontWeight: 700, lineHeight: '14px',
                textAlign: 'center',
                boxShadow: '0 0 0 2px #FFFFFF',
              }}>
                {it.badge > 99 ? '99+' : it.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Vertical mini-toolbar used when the sidebar is collapsed — same icons as
 *  MiniToolbar but stacked and slightly larger for tap-ability. */
function MiniToolbarVertical(props: React.ComponentProps<typeof MiniToolbar>) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 4,
      padding: '6px 0',
      borderTop: '1px solid #E5E7EB', width: '100%',
      alignItems: 'center',
    }}>
      <MiniToolbar {...props} />
    </div>
  );
}

/** Compact settings panel used when the ⚙ button in mini-toolbar is toggled. */
function SettingsSubPanel() {
  const snap = useStore(s => s.snapToGrid);
  const grid = useStore(s => s.showGrid);
  const toggleSnap = useStore(s => s.toggleSnap);
  const toggleGrid = useStore(s => s.toggleGrid);
  const monitorEnabled = useStore(s => s.monitorEnabled);
  const monitorInterval = useStore(s => s.monitorIntervalSec);
  const setMonitorEnabled = useStore(s => s.setMonitorEnabled);
  const setMonitorIntervalSec = useStore(s => s.setMonitorIntervalSec);

  const w: any = typeof window !== 'undefined' ? window : {};
  const hasBackend = !!(w.netmap && w.netmap.pingBatch);

  const row: React.CSSProperties = {
    display: 'flex', gap: 10, alignItems: 'flex-start',
    padding: '10px 12px', marginBottom: 8,
    background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8,
    cursor: 'pointer', color: '#111827',
  };
  const header: React.CSSProperties = {
    fontSize: 11, color: '#6B7280', marginBottom: 10,
    fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
  };

  return (
    <div style={{ padding: 14, overflowY: 'auto', color: '#111827' }}>
      <div style={header}>Настройки холста</div>
      <label style={row}>
        <input type="checkbox" checked={grid} onChange={toggleGrid} style={{ marginTop: 2 }} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Показать сетку</div>
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>Точки-ориентиры на фоне</div>
        </div>
      </label>
      <label style={row}>
        <input type="checkbox" checked={snap} onChange={toggleSnap} style={{ marginTop: 2 }} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Прилипание к сетке</div>
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>Устройства становятся ровно по сетке 20px</div>
        </div>
      </label>

      <div style={{ ...header, marginTop: 18 }}>Ping-мониторинг</div>
      {!hasBackend && (
        <div style={{
          background: '#FEF3C7', border: '1px solid #F59E0B',
          color: '#78350F', padding: 8, borderRadius: 6, fontSize: 11, marginBottom: 6,
        }}>
          В браузерном preview недоступно. Работает в собранной .exe.
        </div>
      )}
      <label style={{ ...row, opacity: hasBackend ? 1 : 0.5 }}>
        <input type="checkbox" checked={monitorEnabled} disabled={!hasBackend}
               onChange={() => setMonitorEnabled(!monitorEnabled)} style={{ marginTop: 2 }} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Включить проверку доступности</div>
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
            Периодический ICMP-ping всех устройств с IP. Результат — цветная точка в углу.
          </div>
        </div>
      </label>
      {monitorEnabled && hasBackend && (
        <div style={{ ...row, display: 'block' }}>
          <div style={{ fontSize: 12, marginBottom: 4 }}>
            Интервал: <b>{monitorInterval}</b> сек
          </div>
          <input type="range" min={5} max={300} step={5}
                 value={monitorInterval}
                 onChange={e => setMonitorIntervalSec(parseInt(e.target.value, 10))}
                 style={{ width: '100%' }} />
          <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
            <span>5 с</span><span>5 мин</span>
          </div>
        </div>
      )}
    </div>
  );
}
