/**
 * v0.42 — Redesigned sidebar (5-icon activity bar + panel).
 *
 * Layout:
 *   ┌────┬──────────────────┐
 *   │ 📊 │                  │
 *   │ 📱 │  active panel    │
 *   │ 🔔 │  content         │
 *   │ 🔐 │                  │
 *   │ ⚙ │                  │
 *   └────┴──────────────────┘
 *
 * Icons: Topology (catalog + layers) / Devices (table) / Alerts /
 *        Vault (compact) / Settings.
 *
 * When user clicks the same icon twice — the panel collapses (activity bar
 * only). Selected panel + collapsed state persist in localStorage.
 */

import { useEffect, useState } from 'react';
import { useStore } from './store';
import { CatalogPanel } from './CatalogPanel';
import { LayersPanel } from './LayersPanel';
import { VaultPanel } from './VaultPanel';
import { VlansPanel } from './VlansPanel';
import { DevicesTablePanel } from './DevicesTablePanel';
import { AlertsPanel } from './AlertsPanel';

type PanelId = 'topology' | 'devices' | 'alerts' | 'vault' | 'settings';

const LS_PANEL     = 'netmap:sidebar:activePanel';
const LS_COLLAPSED = 'netmap:sidebar:collapsed';

export function NewSidebar() {
  const [panel, setPanel] = useState<PanelId>(() => {
    try {
      const v = localStorage.getItem(LS_PANEL);
      if (v === 'topology' || v === 'devices' || v === 'alerts' || v === 'vault' || v === 'settings') return v;
    } catch {}
    return 'topology';
  });
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_COLLAPSED) === '1'; } catch { return false; }
  });

  useEffect(() => { try { localStorage.setItem(LS_PANEL, panel); } catch {} }, [panel]);
  useEffect(() => { try { localStorage.setItem(LS_COLLAPSED, collapsed ? '1' : '0'); } catch {} }, [collapsed]);

  // v0.42: external event to open alerts (from NetworkOverview → "Show all")
  useEffect(() => {
    const onOpen = () => { setPanel('alerts'); setCollapsed(false); };
    window.addEventListener('netmap:open-alerts', onOpen);
    return () => window.removeEventListener('netmap:open-alerts', onOpen);
  }, []);

  const unread = useStore(s => s.alerts.filter(a => !a.read).length);

  const clickPanel = (p: PanelId) => {
    if (panel === p) {
      setCollapsed(v => !v);
    } else {
      setPanel(p);
      setCollapsed(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%', flexShrink: 0 }}>
      {/* Activity bar (icons) */}
      <div style={activityBar}>
        <ActBtn
          icon={<TopologyIcon />} label="Топология" active={panel === 'topology' && !collapsed}
          onClick={() => clickPanel('topology')}
        />
        <ActBtn
          icon={<DevicesIcon />} label="Устройства" active={panel === 'devices' && !collapsed}
          onClick={() => clickPanel('devices')}
        />
        <ActBtn
          icon={<AlertsIcon />} label="Уведомления" active={panel === 'alerts' && !collapsed}
          onClick={() => clickPanel('alerts')} badge={unread}
        />
        <ActBtn
          icon={<VaultIcon />} label="Vault" active={panel === 'vault' && !collapsed}
          onClick={() => clickPanel('vault')}
        />
        {/* v0.43.6: separate "Импорт с оборудования" button — opens the
            unified vendor import dialog (MikroTik / UniFi / Omada / …).
            Doesn't switch panel — it's an action, not navigation. */}
        <ActBtn
          icon={<ImportIcon />} label="Импорт с оборудования"
          active={false}
          onClick={() => window.dispatchEvent(new CustomEvent('netmap:open-import-dialog'))}
        />
        <div style={{ flex: 1 }} />
        <ActBtn
          icon={<SettingsIcon />} label="Настройки" active={panel === 'settings' && !collapsed}
          onClick={() => clickPanel('settings')}
        />
      </div>

      {/* Content panel */}
      {!collapsed && (
        <div style={panelWrap}>
          {panel === 'topology' && <TopologyPanel />}
          {panel === 'devices'  && <DevicesPanel />}
          {panel === 'alerts'   && <AlertsPanel />}
          {panel === 'vault'    && <VaultPanel />}
          {panel === 'settings' && <SettingsPanel />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Devices panel — v0.43.3: two tabs
//   • Каталог — drag'n'drop palette (build the schema)
//   • Таблица — flat table of every device in the project (navigate + bulk actions)
// The catalog used to live under Topology → Каталог, but users expected to
// find "how to add a device" under "Устройства", so we moved it here.

function DevicesPanel() {
  const [tab, setTab] = useState<'catalog' | 'table'>('catalog');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 2, padding: 6, borderBottom: '1px solid #E5E7EB', background: '#F8FAFC' }}>
        <TabBtn label="Каталог" active={tab === 'catalog'} onClick={() => setTab('catalog')} />
        <TabBtn label="Таблица всех" active={tab === 'table'} onClick={() => setTab('table')} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {tab === 'catalog' && <CatalogPanel />}
        {tab === 'table'   && <DevicesTablePanel />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Topology panel — v0.43.3: only Layers + VLAN (Catalog moved to Devices tab).

function TopologyPanel() {
  const [tab, setTab] = useState<'layers' | 'vlans'>('layers');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 2, padding: 6, borderBottom: '1px solid #E5E7EB', background: '#F8FAFC' }}>
        <TabBtn label="Слои" active={tab === 'layers'} onClick={() => setTab('layers')} />
        <TabBtn label="VLAN" active={tab === 'vlans'} onClick={() => setTab('vlans')} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {tab === 'layers' && <LayersPanel />}
        {tab === 'vlans'  && <VlansPanel />}
      </div>
    </div>
  );
}

function SettingsPanel() {
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', marginBottom: 12 }}>
        Настройки
      </div>
      <button
        onClick={() => window.dispatchEvent(new CustomEvent('netmap:open-dialog', { detail: { name: 'settings' } }))}
        style={{
          width: '100%', padding: '10px 12px', border: '1px solid #E5E7EB', borderRadius: 8,
          background: 'white', textAlign: 'left', cursor: 'pointer', fontSize: 12,
        }}
      >
        ⚙ Открыть полные настройки…
      </button>
      <div style={{ fontSize: 11, color: '#64748B', marginTop: 10, lineHeight: 1.5 }}>
        Настройки открываются в отдельном окне (5 вкладок: Общие, Мониторинг, Уведомления, Безопасность, О программе).
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity-bar button

function ActBtn({ icon, label, active, onClick, badge }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void; badge?: number;
}) {
  return (
    <button
      onClick={onClick} title={label}
      style={{
        width: 44, height: 44, padding: 0, border: 'none',
        background: 'transparent',
        color: active ? '#2563EB' : '#64748B',
        cursor: 'pointer', position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderLeft: '3px solid ' + (active ? '#2563EB' : 'transparent'),
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = '#334155'; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = '#64748B'; }}
    >
      {icon}
      {badge != null && badge > 0 && (
        <span style={{
          position: 'absolute', top: 8, right: 8,
          background: '#EF4444', color: 'white',
          fontSize: 8, fontWeight: 700,
          padding: '1px 4px', borderRadius: 999,
          minWidth: 14, textAlign: 'center', lineHeight: 1.3,
        }}>{badge > 99 ? '99+' : badge}</span>
      )}
    </button>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '5px 8px', border: 'none',
        background: active ? 'white' : 'transparent',
        color: active ? '#1D4ED8' : '#64748B',
        fontSize: 11, fontWeight: active ? 700 : 500,
        borderRadius: 5, cursor: 'pointer',
        boxShadow: active ? '0 1px 2px rgba(15,23,42,0.06)' : undefined,
      }}
    >{label}</button>
  );
}

// ---------------------------------------------------------------------------
// SVG icons (reference-style outline set)

const iconProps = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
function TopologyIcon() { return (
  <svg {...iconProps}>
    <circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>
    <line x1="7.5" y1="7" x2="16.5" y2="17"/><line x1="16.5" y1="7" x2="7.5" y2="17"/>
  </svg>
);}
function DevicesIcon() { return (
  <svg {...iconProps}>
    <rect x="3" y="4" width="18" height="12" rx="1"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/>
  </svg>
);}
function AlertsIcon() { return (
  <svg {...iconProps}>
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>
  </svg>
);}
function VaultIcon() { return (
  // v0.43.1: shield-with-dot icon matching the Vault Studio brand (reference design).
  <svg {...iconProps}>
    <path d="M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3z"/>
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>
  </svg>
);}
// v0.43.6 — download-arrow icon for "Import from equipment".
function ImportIcon() { return (
  <svg {...iconProps}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);}
function SettingsIcon() { return (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>
  </svg>
);}

// ---------------------------------------------------------------------------

const activityBar: React.CSSProperties = {
  width: 44, background: '#F8FAFC',
  borderRight: '1px solid #E5E7EB',
  display: 'flex', flexDirection: 'column', gap: 2,
  padding: '4px 0',
  flexShrink: 0,
};
const panelWrap: React.CSSProperties = {
  width: 320, minWidth: 260, maxWidth: 420,
  background: 'white', borderRight: '1px solid #E5E7EB',
  display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
};
