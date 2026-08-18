import { useState } from 'react';
import { useStore, activeFilterCount } from './store';
import type { Device, DeviceKind } from './types';
import { ICONS, KIND_META } from './icons';
import { defaultPortsFor } from './Palette';
import { CatalogPanel } from './CatalogPanel';
import { LayersPanel } from './LayersPanel';
import { VaultPanel } from './VaultPanel';
import { VlansPanel } from './VlansPanel';

interface Section {
  id: string;
  label: string;
  icon: React.ReactNode;
  items: { kind: DeviceKind; label: string; hint?: string }[];
}

/** Minimal 20x20 SVG icons for the rail — no emoji clutter. */
const rIcon = (path: React.ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
);

const SECTIONS: Section[] = [
  {
    id: 'network', label: 'Сеть',
    icon: rIcon(<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>),
    items: [
      { kind: 'router',     label: 'Роутер',       hint: 'Маршрутизатор / шлюз' },
      { kind: 'switch',     label: 'Свитч',        hint: 'Управляемый коммутатор' },
      { kind: 'patchpanel', label: 'Патч-панель',  hint: 'Пассивная 24/48-портовая' },
    ]
  },
  {
    id: 'endpoints', label: 'Оконечные',
    icon: rIcon(<><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10M9 16v4M15 16v4"/></>),
    items: [
      { kind: 'ap',      label: 'Wi-Fi точка', hint: 'Access Point с PoE' },
      { kind: 'camera',  label: 'IP-камера',   hint: 'CCTV с PoE' },
      { kind: 'printer', label: 'Принтер',     hint: 'Сетевой принтер' },
      { kind: 'lock',    label: 'Замок',       hint: 'SALTO / контроллер СКУД' },
    ]
  },
  {
    id: 'computers', label: 'Компьютеры',
    icon: rIcon(<><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></>),
    items: [
      { kind: 'pc',     label: 'ПК',      hint: 'Рабочая станция' },
      { kind: 'pos',    label: 'POS',     hint: 'Кассовый терминал' },
      { kind: 'server', label: 'Сервер',  hint: 'Физический хост (Hyper-V/ESXi)' },
      { kind: 'vm',     label: 'VM',      hint: 'Виртуальная машина (нужен хост)' },
      { kind: 'vps',    label: 'VPS',     hint: 'Арендованный VDS/VPS' },
    ]
  },
  {
    id: 'external', label: 'Внешнее',
    icon: rIcon(<path d="M6 18a5 5 0 0 1 0-10 7 7 0 0 1 13.5 2 4 4 0 0 1-1.5 8H6z"/>),
    items: [
      { kind: 'cloud', label: 'Провайдер', hint: 'ISP / внешняя сеть' },
    ]
  },
];

// Sidebar sizes — v0.12 makes the rail and panel noticeably bigger for readability.
const RAIL_W = 64;
const PANEL_W = 300;

export function ActivityBar() {
  const [open, setOpen] = useState<string | null>('network');
  const addDevice = useStore(s => s.addDevice);
  const select = useStore(s => s.select);
  const addGroup = useStore(s => s.addGroup);
  const selectGroup = useStore(s => s.selectGroup);
  const snapToGrid = useStore(s => s.snapToGrid);
  const showGrid = useStore(s => s.showGrid);
  const toggleSnap = useStore(s => s.toggleSnap);
  const toggleGrid = useStore(s => s.toggleGrid);
  const filters = useStore(s => s.filters);
  const filterCount = activeFilterCount(filters);
  const vlanCount = useStore(s => s.doc.vlans?.length || 0);
  const monitorEnabled = useStore(s => s.monitorEnabled);
  const monitorInterval = useStore(s => s.monitorIntervalSec);
  const setMonitorEnabled = useStore(s => s.setMonitorEnabled);
  const setMonitorIntervalSec = useStore(s => s.setMonitorIntervalSec);

  function createOne(kind: DeviceKind) {
    const id = `${kind}-${Math.random().toString(36).slice(2, 7)}`;
    const meta = KIND_META[kind];
    const d: Device = {
      id, name: `Новый ${meta.label.toLowerCase()}`,
      kind, x: 400, y: 300,
      ports: defaultPortsFor(kind),
      display: 'compact',
      ...(kind === 'vm' ? { vmInfo: { vcpu: 2, ramGb: 4, os: 'Linux' } } : {})
    };
    addDevice(d);
    select(id);
  }

  const activeSection = SECTIONS.find(s => s.id === open);

  return (
    <div style={{ display: 'flex', height: '100%', flexShrink: 0 }}>
      {/* Rail with big section icons */}
      <div style={{
        width: RAIL_W, background: '#F9FAFB',
        borderRight: '1px solid #E5E7EB',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '8px 0', gap: 4,
      }}>
        {SECTIONS.map(section => (
          <RailButton key={section.id}
                      icon={section.icon}
                      label={section.label}
                      active={open === section.id}
                      onClick={() => setOpen(open === section.id ? null : section.id)} />
        ))}

        <div style={railDivider} />

        <RailButton
          icon={rIcon(<><path d="M14.7 6.3l3 3M3 21l3.5-.5L20 7l-3-3L3.5 17.5 3 21z"/></>)}
          label="Каталог моделей"
          active={open === 'catalog'}
          onClick={() => setOpen(open === 'catalog' ? null : 'catalog')}
        />

        <RailButton
          icon={rIcon(<><path d="M4 6h16M6 12h12M9 18h6"/></>)}
          label={filterCount > 0 ? `Слои / фильтры · активно ${filterCount}` : 'Слои / фильтры'}
          active={open === 'layers'}
          badge={filterCount > 0 ? filterCount : undefined}
          onClick={() => setOpen(open === 'layers' ? null : 'layers')}
        />

        <RailButton
          icon={rIcon(<><circle cx="8" cy="15" r="4"/><path d="M10.85 12.15L19 4M17 6l2 2M15 8l2 2"/></>)}
          label="Vault — пароли"
          active={open === 'vault'}
          onClick={() => setOpen(open === 'vault' ? null : 'vault')}
        />

        <RailButton
          icon={rIcon(<><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="6" cy="6" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="18" r="1.5" fill="currentColor"/></>)}
          label="VLAN"
          active={open === 'vlans'}
          badge={vlanCount || undefined}
          onClick={() => setOpen(open === 'vlans' ? null : 'vlans')}
        />

        <div style={{ flex: 1 }} />
        <div style={railDivider} />

        {/* Group creation shortcut */}
        <RailButton
          icon={rIcon(<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>)}
          label="Создать группу" active={false}
          onClick={() => {
            const id = `group-${Math.random().toString(36).slice(2, 7)}`;
            addGroup({
              id, name: 'Новая группа',
              x: 200, y: 200, width: 480, height: 320,
              color: '#0D9488', collapsed: false, parentId: null
            });
            selectGroup(id);
          }}
        />

        {/* Settings toggles */}
        <RailButton
          icon={rIcon(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>)}
          label="Настройки"
          active={open === 'settings'}
          onClick={() => setOpen(open === 'settings' ? null : 'settings')}
        />
      </div>

      {/* Slide-out panel */}
      <div style={{
        width: open ? PANEL_W : 0,
        background: '#FFFFFF',
        borderRight: open ? '1px solid #E5E7EB' : 'none',
        overflow: 'hidden',
        transition: 'width 0.22s cubic-bezier(.34,1.56,.64,1)',
        display: 'flex', flexDirection: 'column',
      }}>
        {open === 'catalog' ? (
          <CatalogPanel />
        ) : open === 'layers' ? (
          <LayersPanel />
        ) : open === 'vault' ? (
          <VaultPanel />
        ) : open === 'vlans' ? (
          <VlansPanel />
        ) : open === 'settings' ? (
          <SettingsPanel
            snap={snapToGrid} grid={showGrid}
            onToggleSnap={toggleSnap} onToggleGrid={toggleGrid}
            monitorEnabled={monitorEnabled} monitorInterval={monitorInterval}
            onToggleMonitor={() => setMonitorEnabled(!monitorEnabled)}
            onChangeInterval={setMonitorIntervalSec}
          />
        ) : activeSection ? (
          <div style={{ padding: 14, overflowY: 'auto' }}>
            <div style={{
              fontSize: 12, opacity: 0.65, marginBottom: 12,
              fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ opacity: 0.7 }}>{activeSection.icon}</span>
              {activeSection.label}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {activeSection.items.map(item => (
                <BigButton key={item.kind}
                           kind={item.kind}
                           label={item.label}
                           hint={item.hint}
                           onClick={() => createOne(item.kind)} />
              ))}
            </div>
            <div style={{ marginTop: 14, fontSize: 11, opacity: 0.45, textAlign: 'center', lineHeight: 1.5 }}>
              Клик — создать в центре<br />Или перетащите на канвас
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RailButton({ icon, label, active, onClick, badge }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void; badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        position: 'relative',
        width: 52, height: 52,
        border: 'none',
        background: active ? '#E5E7EB' : 'transparent',
        borderLeft: active ? '3px solid #2563EB' : '3px solid transparent',
        borderRadius: 8,
        color: active ? '#111827' : '#6B7280',
        fontSize: 20,
        cursor: 'pointer',
        transition: 'all 0.12s',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 0, gap: 2,
      }}
      onMouseEnter={e => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = '#F9FAFB';
      }}
      onMouseLeave={e => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      {icon}
      <span style={{ fontSize: 9, opacity: 0.7, letterSpacing: 0.2, marginTop: 1,
                     maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label.split(' ')[0].split('/')[0]}
      </span>
      {badge != null && badge > 0 && (
        <span style={{
          position: 'absolute', top: 4, right: 4,
          minWidth: 16, height: 16, padding: '0 4px',
          background: '#da3633', color: '#fff',
          borderRadius: 8,
          fontSize: 9, fontWeight: 700, lineHeight: '16px',
          textAlign: 'center',
          boxShadow: '0 0 0 2px #F9FAFB',
        }}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

function BigButton({ kind, label, hint, onClick }: {
  kind: DeviceKind; label: string; hint?: string; onClick: () => void;
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
      onClick={onClick}
      title={hint ? `${label} — ${hint}` : label}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        padding: '14px 6px',
        borderRadius: 10, cursor: 'grab',
        background: '#F9FAFB', border: '1px solid #D1D5DB',
        transition: 'all 0.12s',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.background = meta.bg;
        el.style.borderColor = meta.color;
        el.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.background = '#F9FAFB';
        el.style.borderColor = '#D1D5DB';
        el.style.transform = 'none';
      }}
    >
      <div style={{ color: meta.color, display: 'flex' }}><Icon size={38} /></div>
      <div style={{ fontSize: 12, color: '#111827', textAlign: 'center', lineHeight: 1.2, fontWeight: 500 }}>
        {label}
      </div>
    </div>
  );
}

function SettingsPanel({
  snap, grid, onToggleSnap, onToggleGrid,
  monitorEnabled, monitorInterval, onToggleMonitor, onChangeInterval,
}: {
  snap: boolean; grid: boolean; onToggleSnap: () => void; onToggleGrid: () => void;
  monitorEnabled: boolean; monitorInterval: number;
  onToggleMonitor: () => void; onChangeInterval: (n: number) => void;
}) {
  const w: any = typeof window !== 'undefined' ? window : {};
  const hasBackend = !!(w.netmap && w.netmap.pingBatch);

  return (
    <div style={{ padding: 14, overflowY: 'auto', height: '100%' }}>
      <div style={sectionHeader}>Настройки холста</div>
      <label style={settingRow}>
        <input type="checkbox" checked={grid} onChange={onToggleGrid} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Показать сетку</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>Точки-ориентиры на фоне</div>
        </div>
      </label>
      <label style={settingRow}>
        <input type="checkbox" checked={snap} onChange={onToggleSnap} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Прилипание к сетке</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>Устройства становятся ровно по сетке 20px</div>
        </div>
      </label>

      <div style={{ ...sectionHeader, marginTop: 18 }}>Ping-мониторинг</div>
      {!hasBackend && (
        <div style={{
          background: '#FEF3C7', border: '1px solid #D97706',
          color: '#78350F', padding: 8, borderRadius: 6, fontSize: 11, marginBottom: 6,
        }}>
          В браузерном preview недоступно. Работает в собранной .exe (Electron).
        </div>
      )}
      <label style={{ ...settingRow, opacity: hasBackend ? 1 : 0.5 }}>
        <input type="checkbox" checked={monitorEnabled} disabled={!hasBackend} onChange={onToggleMonitor} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Включить проверку доступности</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>
            Периодический ICMP-ping (с fallback на TCP-connect) всех устройств с IP.
            Результат — цветная точка в углу устройства.
          </div>
        </div>
      </label>
      {monitorEnabled && hasBackend && (
        <div style={{ ...settingRow, display: 'block' }}>
          <div style={{ fontSize: 12, marginBottom: 4 }}>
            Интервал: <b>{monitorInterval}</b> сек
          </div>
          <input type="range" min={5} max={300} step={5}
                 value={monitorInterval}
                 onChange={e => onChangeInterval(parseInt(e.target.value, 10))}
                 style={{ width: '100%' }} />
          <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
            <span>5 с</span><span>5 мин</span>
          </div>
        </div>
      )}
    </div>
  );
}

const sectionHeader: React.CSSProperties = {
  fontSize: 12, opacity: 0.65, marginBottom: 10,
  fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
};

const settingRow: React.CSSProperties = {
  display: 'flex', gap: 10, alignItems: 'flex-start',
  padding: '12px', marginBottom: 8,
  background: '#F9FAFB', border: '1px solid #D1D5DB',
  borderRadius: 8, cursor: 'pointer',
  color: '#111827',
};

const railDivider: React.CSSProperties = {
  width: 30, height: 1, background: '#E5E7EB', margin: '4px 0',
};
