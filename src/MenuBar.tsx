/**
 * v0.42 — Custom HTML menubar (File / View / Tools / Monitor / Help).
 *
 * Reference-style top strip that replaces the old hamburger ☰ AppMenu.
 * Sits above the toolbar. Each root menu opens a dropdown with grouped
 * MenuItem's + Separators.
 *
 * Keyboard:
 *   Alt+F / Alt+V / Alt+T / Alt+M / Alt+H — open respective root menu
 *   Arrow left/right cycles between roots when one is open
 *   Escape closes any open menu
 *   Enter activates focused item
 *
 * All actions dispatch either an existing custom event or call a store
 * action directly — nothing new here on the backend side, just a nicer UX.
 */

import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { alertDialog, confirmDialog } from './Modal';
import { MikrotikImportDialog } from './MikrotikImportDialog';
import { ImportDialog } from './ImportDialog';
import { DiscoveryDialog } from './DiscoveryDialog';
import { BackupsDialog } from './BackupsDialog';
import type { ImportVendor } from './importClient';

type RootKey = 'file' | 'view' | 'tools' | 'monitor' | 'help';

export function MenuBar() {
  const [open, setOpen] = useState<RootKey | null>(null);
  const rootRefs = useRef<Record<RootKey, HTMLButtonElement | null>>({
    file: null, view: null, tools: null, monitor: null, help: null,
  });
  const barRef = useRef<HTMLDivElement>(null);

  // Sub-dialogs that some menu items open
  const [mikrotikOpen, setMikrotikOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importVendor, setImportVendor] = useState<ImportVendor | undefined>(undefined);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!barRef.current) return;
      if (!barRef.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // v0.43.6: open Import dialog from anywhere in the app via CustomEvent.
  // Sidebar "Импорт" icon uses this.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { vendor?: ImportVendor } | undefined;
      setImportVendor(detail?.vendor);
      setImportOpen(true);
    };
    window.addEventListener('netmap:open-import-dialog', handler);
    return () => window.removeEventListener('netmap:open-import-dialog', handler);
  }, []);

  // v0.44: open Auto-Discovery dialog from anywhere via CustomEvent.
  useEffect(() => {
    const handler = () => setDiscoveryOpen(true);
    window.addEventListener('netmap:open-discovery', handler);
    return () => window.removeEventListener('netmap:open-discovery', handler);
  }, []);

  // v0.44.1: bug-fix — ImportDialog redirects to MikroTik via this event but
  // MenuBar had no listener → next click on sidebar "Импорт" opened+closed
  // ImportDialog silently (because last-selected vendor in LS was 'mikrotik').
  useEffect(() => {
    const handler = () => setMikrotikOpen(true);
    window.addEventListener('netmap:open-mikrotik-import', handler);
    return () => window.removeEventListener('netmap:open-mikrotik-import', handler);
  }, []);

  // Alt+key shortcuts and Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(null); return; }
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const map: Record<string, RootKey> = {
          f: 'file', в: 'file',
          v: 'view', м: 'view',
          t: 'tools', е: 'tools',
          m: 'monitor', ь: 'monitor',
          h: 'help', р: 'help',
        };
        const k = map[e.key.toLowerCase()];
        if (k) { e.preventDefault(); setOpen(prev => prev === k ? null : k); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const cycleRoot = (dir: -1 | 1) => {
    const order: RootKey[] = ['file', 'view', 'tools', 'monitor', 'help'];
    if (!open) { setOpen(order[0]); return; }
    const idx = order.indexOf(open);
    setOpen(order[(idx + dir + order.length) % order.length]);
  };

  return (
    <div ref={barRef} style={bar}>
      {/* NetMap brand */}
      <div style={brand}>
        <div style={brandIcon}>N</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>NetMap</div>
      </div>

      <div style={{ width: 1, height: 16, background: '#E5E7EB', margin: '0 4px' }} />

      {(['file', 'view', 'tools', 'monitor', 'help'] as RootKey[]).map(key => (
        <button
          key={key}
          ref={(el) => { rootRefs.current[key] = el; }}
          onClick={() => setOpen(prev => prev === key ? null : key)}
          onMouseEnter={() => { if (open) setOpen(key); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); cycleRoot(-1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); cycleRoot(1); }
          }}
          style={rootBtn(open === key)}
        >
          <span style={{ textDecoration: 'underline', textDecorationColor: '#94A3B8', textUnderlineOffset: 2 }}>
            {ROOT_LABELS[key][0]}
          </span>
          {ROOT_LABELS[key].slice(1)}
        </button>
      ))}

      {/* Dropdowns */}
      {open === 'file' && (
        <Dropdown anchor={rootRefs.current.file}>
          <FileMenu onClose={() => setOpen(null)}
                    onBackups={() => { setOpen(null); setBackupsOpen(true); }} />
        </Dropdown>
      )}
      {open === 'view' && (
        <Dropdown anchor={rootRefs.current.view}>
          <ViewMenu onClose={() => setOpen(null)} />
        </Dropdown>
      )}
      {open === 'tools' && (
        <Dropdown anchor={rootRefs.current.tools}>
          <ToolsMenu
            onClose={() => setOpen(null)}
            onMikrotik={() => { setOpen(null); setMikrotikOpen(true); }}
            onImport={(v) => { setOpen(null); setImportVendor(v); setImportOpen(true); }}
            onDiscovery={() => { setOpen(null); setDiscoveryOpen(true); }}
          />
        </Dropdown>
      )}
      {open === 'monitor' && (
        <Dropdown anchor={rootRefs.current.monitor}>
          <MonitorMenu onClose={() => setOpen(null)} />
        </Dropdown>
      )}
      {open === 'help' && (
        <Dropdown anchor={rootRefs.current.help}>
          <HelpMenu onClose={() => setOpen(null)} />
        </Dropdown>
      )}

      {/* Hosted dialogs */}
      <MikrotikImportDialog open={mikrotikOpen} onClose={() => setMikrotikOpen(false)} />
      <ImportDialog open={importOpen} initialVendor={importVendor} onClose={() => setImportOpen(false)} />
      <DiscoveryDialog open={discoveryOpen} onClose={() => setDiscoveryOpen(false)} />
      <BackupsDialog open={backupsOpen} onClose={() => setBackupsOpen(false)} />
    </div>
  );
}

const ROOT_LABELS: Record<RootKey, string> = {
  file: 'File',
  view: 'View',
  tools: 'Tools',
  monitor: 'Monitor',
  help: 'Help',
};

// ---------------------------------------------------------------------------
// Individual menus

function FileMenu({ onClose, onBackups }: { onClose: () => void; onBackups: () => void }) {
  const workspace = useStore(s => s.workspace);
  const exportProject = useStore(s => s.exportProject);
  const importProject = useStore(s => s.importProject);
  const resetToSeed = useStore(s => s.resetToSeed);
  const active = workspace.projects.find(p => p.id === workspace.activeId);

  const doExport = () => {
    onClose();
    if (!active) return;
    const json = exportProject(active.id);
    downloadBlob(json, `${active.name.replace(/\s+/g, '_')}.netmap.json`, 'application/json');
    useStore.getState().pushAlert({
      severity: 'success', origin: 'export', title: 'Экспорт готов',
      message: active.name,
    });
  };
  const doExportAll = () => {
    onClose();
    downloadBlob(JSON.stringify(workspace, null, 2), 'netmap_workspace.json', 'application/json');
  };
  const doImportFile = () => {
    onClose();
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json';
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      try {
        const text = await f.text();
        const id = importProject(text);
        if (id) await alertDialog('Импортировано', 'Проект добавлен в рабочую область.');
        else await alertDialog('Ошибка', 'Формат файла не распознан.');
      } catch (err) {
        await alertDialog('Ошибка', (err as Error).message);
      }
    };
    inp.click();
  };
  const doReset = async () => {
    onClose();
    const name = active?.name || 'проект';
    if (await confirmDialog(`Сбросить проект «${name}»?`, 'Демо-схема заменит текущее содержимое.', { danger: true, okText: 'Сбросить' })) {
      resetToSeed();
    }
  };

  return (
    <>
      <Section>Проект</Section>
      <Item icon="💾" label="Сохранить сейчас" shortcut="Ctrl+S"
            onClick={() => {
              onClose();
              useStore.getState().pushAlert({ severity: 'success', origin: 'app', title: 'Сохранено', message: 'Записано в локальную базу.' });
            }} />
      <Item icon="⏮" label="Резервные копии…" shortcut="" onClick={onBackups} />
      <Separator />
      <Section>Файл</Section>
      <Item icon="⤒" label="Импортировать проект…" shortcut="" onClick={doImportFile} />
      <Item icon="⤓" label="Экспортировать активный…" shortcut="" onClick={doExport} disabled={!active} />
      <Item icon="⤓⤓" label="Экспортировать всю рабочую область…" shortcut="" onClick={doExportAll} />
      <Separator />
      <Item icon="↺" label="Сбросить к демо-схеме" shortcut="" onClick={doReset} danger />
      <Separator />
      <Item icon="⏻" label="Выход" shortcut="Alt+F4"
            onClick={() => { onClose(); window.close(); }} />
    </>
  );
}

function ViewMenu({ onClose }: { onClose: () => void }) {
  const viewMode = useStore(s => s.viewMode);
  const setViewMode = useStore(s => s.setViewMode);
  const collapseEndpoints = useStore(s => s.collapseEndpoints);
  const toggleCollapseEndpoints = useStore(s => s.toggleCollapseEndpoints);
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const toggleSidebar = useStore(s => s.toggleSidebar);
  const rightPanelOpen = useStore(s => s.rightPanelOpen);
  const toggleRightPanel = useStore(s => s.toggleRightPanel);
  const focusRelated = useStore(s => s.focusRelated);
  const toggleFocusRelated = useStore(s => s.toggleFocusRelated);
  const showGrid = useStore(s => s.showGrid);
  const toggleGrid = useStore(s => s.toggleGrid);
  const snap = useStore(s => s.snapToGrid);
  const toggleSnap = useStore(s => s.toggleSnap);

  return (
    <>
      <Section>Стиль карточек</Section>
      <Item icon={viewMode === 'modern' ? '●' : '○'} label="Modern (референс-стиль)" shortcut=""
            onClick={() => { setViewMode('modern'); onClose(); }} />
      <Item icon={viewMode === 'legacy' ? '●' : '○'} label="Legacy (rack/compact)" shortcut=""
            onClick={() => { setViewMode('legacy'); onClose(); }} />
      {viewMode === 'modern' && (
        <Item icon={collapseEndpoints ? '☑' : '☐'} label="Сворачивать endpoint'ы" shortcut=""
              onClick={() => { toggleCollapseEndpoints(); onClose(); }} />
      )}
      <Separator />
      <Section>Панели</Section>
      <Item icon={sidebarOpen ? '☑' : '☐'} label="Боковая панель" shortcut=""
            onClick={() => { toggleSidebar(); onClose(); }} />
      <Item icon={rightPanelOpen ? '☑' : '☐'} label="Правая панель" shortcut=""
            onClick={() => { toggleRightPanel(); onClose(); }} />
      <Separator />
      <Section>Канвас</Section>
      <Item icon="⤢" label="Восстановить вид (fit)" shortcut="F"
            onClick={() => { window.dispatchEvent(new CustomEvent('netmap:fit-view')); onClose(); }} />
      <Item icon="⚡" label="Умная раскладка (по локациям / VLAN)" shortcut=""
            onClick={async () => {
              onClose();
              try {
                useStore.getState().autoLayout('TB', { groupBy: 'hybrid' });
                setTimeout(() => window.dispatchEvent(new CustomEvent('netmap:fit-view')), 400);
              } catch (e: any) { await alertDialog('Ошибка', e?.message || 'smart-layout failed'); }
            }} />
      <Item icon="🔧" label="Разложить заново (без группировки)" shortcut=""
            onClick={async () => {
              onClose();
              try { useStore.getState().autoLayout('TB'); setTimeout(() => window.dispatchEvent(new CustomEvent('netmap:fit-view')), 400); }
              catch (e: any) { await alertDialog('Ошибка', e?.message || 'auto-layout failed'); }
            }} />
      {/* v0.43.5: сколько колонок для «орфанов» без uplink-свитча. */}
      <OrphanGridInline />
      <Separator />
      <Separator />
      <Item icon={snap ? '☑' : '☐'} label="Прилипание к сетке" shortcut=""
            onClick={() => { toggleSnap(); onClose(); }} />
      <Item icon={showGrid ? '☑' : '☐'} label="Показывать сетку" shortcut=""
            onClick={() => { toggleGrid(); onClose(); }} />
      <Item icon={focusRelated ? '☑' : '☐'} label="Фокус связанных при hover" shortcut=""
            onClick={() => { toggleFocusRelated(); onClose(); }} />
    </>
  );
}

function ToolsMenu({ onClose, onMikrotik, onImport, onDiscovery }: {
  onClose: () => void;
  onMikrotik: () => void;
  onImport: (v: ImportVendor | undefined) => void;
  onDiscovery: () => void;
}) {
  return (
    <>
      <Section>Автообнаружение</Section>
      <Item icon="◎" label="Автообнаружение топологии…" shortcut=""
            onClick={onDiscovery} />
      <Separator />
      <Section>Импорт с оборудования</Section>
      <Item icon="↯" label="MikroTik (SSH / REST)…" shortcut="" onClick={onMikrotik} />
      <Item icon="⌘" label="UniFi Controller…" shortcut="" onClick={() => onImport('unifi')} />
      <Item icon="◈" label="TP-Link Omada Cloud…" shortcut="" onClick={() => onImport('omada-cloud')} />
      <Item icon="…" label="Другое (Ruijie / D-Link / EdgeSwitch)…" shortcut=""
            onClick={() => onImport(undefined)} />
      <Separator />
      <Section>Менеджер паролей</Section>
      <Item icon="🔐" label="Vault Studio…" shortcut="Ctrl+K"
            onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('netmap:open-vault-studio')); }} />
      <Separator />
      <Section>Диагностика</Section>
      <Item icon="🛣" label="Traceroute…" shortcut=""
            onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('netmap:open-traceroute', { detail: {} })); }} />
    </>
  );
}

function MonitorMenu({ onClose }: { onClose: () => void }) {
  const monitorEnabled = useStore(s => s.monitorEnabled);
  const setMonitor = useStore(s => s.setMonitorEnabled);
  const interval = useStore(s => s.monitorIntervalSec);
  return (
    <>
      <Section>Ping мониторинг</Section>
      <Item icon={monitorEnabled ? '☑' : '☐'} label={`Фоновый ping (${interval}с)`}
            shortcut=""
            onClick={() => { setMonitor(!monitorEnabled); onClose(); }} />
      <Item icon="⚙" label="Настройки мониторинга…" shortcut=""
            onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('netmap:open-dialog', { detail: { name: 'settings' } })); }} />
      <Separator />
      <Section>Уведомления</Section>
      <Item icon="🔔" label="Центр уведомлений…" shortcut=""
            onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('netmap:open-alerts')); }} />
    </>
  );
}

function HelpMenu({ onClose }: { onClose: () => void }) {
  return (
    <>
      <Item icon="🎓" label="Показать введение (onboarding)…" shortcut=""
            onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('netmap:open-onboarding')); }} />
      <Item icon="?" label="Помощь · горячие клавиши" shortcut="F1"
            onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('netmap:open-dialog', { detail: { name: 'help' } })); }} />
      <Separator />
      <Item icon="⇩" label="Проверить обновления…" shortcut=""
            onClick={async () => {
              onClose();
              try {
                const { checkForUpdatesNow } = await import('./updaterClient');
                const r = await checkForUpdatesNow();
                if (r && (r as any).disabled) {
                  useStore.getState().pushAlert({
                    severity: 'info', origin: 'app', title: 'Обновления',
                    message: 'Auto-updater недоступен (dev-режим).',
                  });
                }
              } catch (e: any) {
                useStore.getState().pushAlert({ severity: 'warn', origin: 'app', title: 'Проверка обновлений', message: e?.message || String(e) });
              }
            }} />
      <Item icon="⚙" label="Настройки…" shortcut=""
            onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('netmap:open-dialog', { detail: { name: 'settings' } })); }} />
      <Separator />
      <Item icon="ℹ" label="О программе" shortcut=""
            onClick={() => {
              onClose();
              window.dispatchEvent(new CustomEvent('netmap:open-dialog', { detail: { name: 'settings' } }));
            }} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Reusable UI atoms

function Dropdown({ anchor, children }: { anchor: HTMLElement | null; children: React.ReactNode }) {
  const rect = anchor?.getBoundingClientRect();
  return (
    <div style={{
      position: 'fixed',
      top: rect ? rect.bottom + 2 : 30,
      left: rect ? rect.left : 0,
      minWidth: 240,
      background: 'white',
      border: '1px solid #E5E7EB',
      borderRadius: 8,
      boxShadow: '0 10px 30px rgba(15,23,42,0.15)',
      zIndex: 1000,
      padding: 4,
    }}>
      {children}
    </div>
  );
}

// v0.43.5: inline row of chip-buttons for the orphan-grid column count.
// Sits inside View menu, next to "Разложить заново".
function OrphanGridInline() {
  const cols = useStore(s => (s as any).orphanGridCols || 0);
  const setCols = useStore(s => (s as any).setOrphanGridCols);
  const options: Array<{ value: number; label: string }> = [
    { value: 0,  label: 'Авто' },
    { value: 6,  label: '6' },
    { value: 10, label: '10' },
    { value: 15, label: '15' },
    { value: 20, label: '20' },
  ];
  return (
    <div style={{ padding: '4px 10px 6px' }}>
      <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 4 }}>
        Плитка для орфанов при auto-layout
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {options.map(o => (
          <button
            key={o.value}
            onClick={() => setCols(o.value)}
            style={{
              flex: 1, padding: '5px 4px', border: 'none', borderRadius: 5,
              background: cols === o.value ? '#DBEAFE' : '#F1F5F9',
              color: cols === o.value ? '#1D4ED8' : '#64748B',
              fontSize: 10, fontWeight: cols === o.value ? 700 : 500,
              cursor: 'pointer',
            }}
          >{o.label}</button>
        ))}
      </div>
    </div>
  );
}

function Item({ icon, label, shortcut, onClick, disabled, danger }: {
  icon: string; label: string; shortcut: string;
  onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{
        width: '100%', padding: '6px 10px', border: 'none', background: 'transparent',
        display: 'flex', alignItems: 'center', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer',
        borderRadius: 5, textAlign: 'left', fontSize: 12,
        color: disabled ? '#94A3B8' : (danger ? '#B91C1C' : '#334155'),
        opacity: disabled ? 0.6 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = '#F1F5F9'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
    >
      <span style={{ width: 14, textAlign: 'center', fontSize: 11 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {shortcut && <span style={{ fontSize: 10, color: '#94A3B8' }}>{shortcut}</span>}
    </button>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '4px 10px 2px', fontSize: 9, color: '#94A3B8',
      textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700,
    }}>{children}</div>
  );
}

function Separator() {
  return <div style={{ height: 1, background: '#E5E7EB', margin: '4px 6px' }} />;
}

// ---------------------------------------------------------------------------
// Styles

const bar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 2,
  height: 28, padding: '0 8px',
  background: '#F8FAFC', borderBottom: '1px solid #E5E7EB',
  flexShrink: 0,
  // WebkitAppRegion removed — draggable title bar reserved for Electron frame
};
const brand: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  marginRight: 6, padding: '0 4px',
  
};
const brandIcon: React.CSSProperties = {
  width: 18, height: 18, borderRadius: 4,
  background: 'linear-gradient(135deg, #2563EB, #7C3AED)',
  color: 'white', fontSize: 11, fontWeight: 800,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'ui-monospace, monospace',
};

function rootBtn(active: boolean): React.CSSProperties {
  return {
    padding: '3px 10px', border: 'none',
    background: active ? '#DBEAFE' : 'transparent',
    color: active ? '#1E40AF' : '#334155',
    fontSize: 12, fontWeight: active ? 600 : 500,
    cursor: 'pointer', borderRadius: 4,
    
  };
}

function downloadBlob(text: string, filename: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
