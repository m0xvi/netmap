/**
 * v0.35.7 — split into TWO separate menus in the toolbar:
 *
 *   <ProjectMenu />  — active project name button, dropdown lists all projects
 *                      in the workspace + "New / Duplicate / Rename / Delete".
 *   <AppMenu />      — hamburger (☰) button, dropdown with Import / Export /
 *                      MikroTik import / Reset. All the "file-level"
 *                      operations that used to sit in a huge combined menu.
 *
 * The old single <FileMenu /> was doing too much — user asked to visually
 * separate "which project am I on" from "what can I do with it".
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { promptText, confirmDialog, alertDialog } from './Modal';
import { MikrotikImportDialog } from './MikrotikImportDialog';
import { ImportDialog } from './ImportDialog';
import { BackupsDialog } from './BackupsDialog';
import type { ImportVendor } from './importClient';

// ============================================================================
// Shared helpers (menu item + separator + close-on-outside-click)
// ============================================================================

function useOutsideClick(ref: React.RefObject<HTMLElement>, open: boolean, close: () => void) {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [ref, open, close]);
}

function MenuItem({ icon, label, onClick, disabled, active, danger, sub }: {
  icon?: string; label: string; sub?: string;
  onClick?: () => void; disabled?: boolean; active?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        width: '100%', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 12px',
        background: active ? '#EFF6FF' : 'transparent',
        color: disabled ? '#9CA3AF' : danger ? '#DC2626' : '#111827',
        border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 12, fontWeight: active ? 600 : 400,
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = active ? '#DBEAFE' : '#F3F4F6'; }}
      onMouseLeave={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = active ? '#EFF6FF' : 'transparent'; }}
    >
      {icon && <span style={{ width: 18, textAlign: 'center', fontSize: 13, opacity: 0.75 }}>{icon}</span>}
      <span style={{ flex: 1, minWidth: 0,
                     whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {sub && <span style={{ fontSize: 10, color: '#9CA3AF' }}>{sub}</span>}
    </button>
  );
}
function Separator() {
  return <div style={{ height: 1, background: '#F3F4F6', margin: '4px 0' }} />;
}

const dropdownBase: React.CSSProperties = {
  position: 'absolute', top: '110%', left: 0, zIndex: 100,
  minWidth: 240,
  background: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderRadius: 8,
  boxShadow: '0 8px 24px rgba(15,23,42,0.14)',
  padding: '4px 0',
  color: '#111827', fontSize: 12,
};

// ============================================================================
// ProjectMenu — active project button + project list
// ============================================================================

export function ProjectMenu() {
  const workspace = useStore(s => s.workspace);
  const switchProject = useStore(s => s.switchProject);
  const createProject = useStore(s => s.createProject);
  const renameProject = useStore(s => s.renameProject);
  const deleteProject = useStore(s => s.deleteProject);

  const active = workspace.projects.find(p => p.id === workspace.activeId);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useOutsideClick(menuRef, open, () => setOpen(false));

  const doNew = async () => {
    setOpen(false);
    const name = await promptText('Новый проект', 'Новая схема', 'Название проекта');
    if (name && name.trim()) createProject(name.trim());
  };
  const doDuplicate = async () => {
    setOpen(false);
    if (!active) return;
    const name = await promptText('Дублировать проект', active.name + ' (копия)');
    if (name && name.trim()) createProject(name.trim(), active.id);
  };
  const doRename = async () => {
    setOpen(false);
    if (!active) return;
    const name = await promptText('Переименовать проект', active.name);
    if (name && name.trim()) renameProject(active.id, name.trim());
  };
  const doDelete = async () => {
    setOpen(false);
    if (!active || workspace.projects.length <= 1) return;
    if (await confirmDialog(
      `Удалить проект «${active.name}»?`,
      'Это действие нельзя отменить.',
      { danger: true, okText: 'Удалить' }
    )) {
      deleteProject(active.id);
    }
  };

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={projectBtn(open)}
        title="Проекты рабочей области"
      >
        <span style={{ display: 'inline-flex', width: 18, height: 18, alignItems: 'center', justifyContent: 'center', color: '#2563EB' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          </svg>
        </span>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>
          {active?.name || 'Проект'}
        </span>
        <span style={{ opacity: 0.5, fontSize: 10 }}>▼</span>
      </button>

      {open && (
        <div style={dropdownBase}>
          <div style={sectionHeader}>Проекты · {workspace.projects.length}</div>
          {workspace.projects.map(p => (
            <MenuItem key={p.id}
                      icon={p.id === workspace.activeId ? '✓' : ' '}
                      label={p.name}
                      onClick={() => { switchProject(p.id); setOpen(false); }}
                      active={p.id === workspace.activeId} />
          ))}

          <Separator />
          <MenuItem icon="＋" label="Новый проект…"       onClick={doNew} />
          <MenuItem icon="⧉" label="Дублировать активный…" onClick={doDuplicate} disabled={!active} />
          <MenuItem icon="✎" label="Переименовать…"       onClick={doRename} disabled={!active} />

          <Separator />
          <MenuItem icon="🗑" label="Удалить активный проект…" onClick={doDelete} danger
                    disabled={workspace.projects.length <= 1} />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// AppMenu — hamburger button (Import / Export / MikroTik / Reset)
// ============================================================================

export function AppMenu() {
  const workspace = useStore(s => s.workspace);
  const exportProject = useStore(s => s.exportProject);
  const importProject = useStore(s => s.importProject);
  const resetToSeed = useStore(s => s.resetToSeed);
  const active = workspace.projects.find(p => p.id === workspace.activeId);
  // v0.36.1: focus-related toggle moved into the menu.
  const focusRelated = useStore(s => s.focusRelated);
  const toggleFocusRelated = useStore(s => s.toggleFocusRelated);
  // v0.41: reference redesign view mode
  const viewMode = useStore(s => s.viewMode);
  const setViewMode = useStore(s => s.setViewMode);
  const collapseEndpoints = useStore(s => s.collapseEndpoints);
  const toggleCollapseEndpoints = useStore(s => s.toggleCollapseEndpoints);

  const [open, setOpen] = useState(false);
  const [mikrotikOpen, setMikrotikOpen] = useState(false);
  // v0.37: unified per-vendor import dialog (UniFi / Omada / Ruijie / D-Link / EdgeSwitch)
  const [importOpen, setImportOpen] = useState(false);
  const [importVendor, setImportVendor] = useState<ImportVendor | undefined>(undefined);
  // v0.41.1: backup snapshots dialog
  const [backupsOpen, setBackupsOpen] = useState(false);
  // v0.37: also open MikroTik dialog when the unified ImportDialog dispatches
  // 'netmap:open-mikrotik-import' (happens when user selects MikroTik from
  // the dropdown inside the unified dialog).
  useEffect(() => {
    const onMtk = () => setMikrotikOpen(true);
    window.addEventListener('netmap:open-mikrotik-import', onMtk as EventListener);
    return () => window.removeEventListener('netmap:open-mikrotik-import', onMtk as EventListener);
  }, []);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useOutsideClick(menuRef, open, () => setOpen(false));

  // v0.36.1: broadcast an event that other UI hosts (SettingsDialog,
  // HelpModal) listen to. Keeps AppMenu free of dialog state.
  const openDialog = (name: 'settings' | 'help') => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent('netmap:open-dialog', { detail: { name } }));
  };
  const doSave = () => {
    setOpen(false);
    // Persist happens automatically on every store mutation (debounced 400ms).
    // This action just forces a flush + shows a confirmation toast.
    useStore.getState().pushAlert({
      severity: 'success', origin: 'app',
      title: 'Сохранено',
      message: 'Все изменения записаны в локальную базу.',
    });
  };

  const doExport = () => {
    setOpen(false);
    if (!active) return;
    const json = exportProject(active.id);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${active.name.replace(/\s+/g, '_')}.netmap.json`;
    a.click();
    URL.revokeObjectURL(url);
    useStore.getState().pushAlert({
      severity: 'success', origin: 'export',
      title: 'Экспорт готов',
      message: `Файл: ${a.download}`,
    });
  };
  const doExportAll = () => {
    setOpen(false);
    const json = JSON.stringify(workspace, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'netmap_workspace.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  const doImportFile = () => {
    setOpen(false);
    fileInputRef.current?.click();
  };
  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const id = importProject(text);
      if (id) {
        useStore.getState().pushAlert({
          severity: 'success', origin: 'import',
          title: 'Импорт проекта',
          message: `Файл «${f.name}» добавлен в рабочую область.`,
        });
        await alertDialog('Импортировано', 'Проект добавлен в рабочую область.');
      } else {
        await alertDialog('Ошибка', 'Не удалось распознать формат файла.');
      }
    } catch (err) {
      await alertDialog('Ошибка', (err as Error).message);
    }
    e.target.value = '';
  };
  const doReset = async () => {
    setOpen(false);
    const projName = workspace.projects.find(p => p.id === workspace.activeId)?.name || 'проект';
    if (await confirmDialog(
      `Сбросить проект «${projName}»?`,
      'Демо-схема заменит текущее содержимое проекта. Все ваши изменения потеряются. Отменить нельзя.',
      { danger: true, okText: 'Сбросить' }
    )) {
      resetToSeed();
    }
  };

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <MikrotikImportDialog open={mikrotikOpen} onClose={() => setMikrotikOpen(false)} />
      <ImportDialog open={importOpen} initialVendor={importVendor}
                    onClose={() => setImportOpen(false)} />
      <BackupsDialog open={backupsOpen} onClose={() => setBackupsOpen(false)} />
      <input ref={fileInputRef} type="file" accept="application/json" onChange={onFileChosen}
             style={{ display: 'none' }} />
      <button
        onClick={() => setOpen(v => !v)}
        style={hamburgerBtn(open)}
        title="Главное меню"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <line x1="4" y1="7"  x2="20" y2="7"/>
          <line x1="4" y1="12" x2="20" y2="12"/>
          <line x1="4" y1="17" x2="20" y2="17"/>
        </svg>
      </button>

      {open && (
        <div style={dropdownBase}>
          {/* v0.36.1: brand row inside the menu — was the top-of-toolbar
              logo. Non-clickable, just gives the panel identity. */}
          <div style={{
            padding: '10px 12px 8px', display: 'flex', alignItems: 'center', gap: 8,
            borderBottom: '1px solid #F3F4F6',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'linear-gradient(135deg, #2563EB 0%, #7C3AED 100%)',
              color: '#FFFFFF', fontSize: 14, fontWeight: 800,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'ui-monospace, monospace',
            }}>N</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>NetMap</div>
              <div style={{ fontSize: 9, color: '#9CA3AF' }}>Интерактивная схема сети</div>
            </div>
          </div>

          <div style={sectionHeader}>Проект</div>
          <MenuItem icon="💾" label="Сохранить сейчас" sub="Ctrl+S"
                    onClick={doSave} />
          <MenuItem icon="⤢" label="Восстановить вид (вписать всё)" sub="F"
                    onClick={() => {
                      setOpen(false);
                      window.dispatchEvent(new CustomEvent('netmap:fit-view'));
                    }} />
          <MenuItem icon="🔧" label="Разложить заново (авто-layout)"
                    sub="Если ноды спрятались или сжались в одну точку"
                    onClick={async () => {
                      setOpen(false);
                      try {
                        useStore.getState().autoLayout('TB');
                        setTimeout(() => window.dispatchEvent(new CustomEvent('netmap:fit-view')), 400);
                      } catch (e: any) {
                        await alertDialog('Ошибка', e?.message || 'auto-layout failed');
                      }
                    }} />
          <MenuItem icon="⏮" label="Резервные копии…"
                    sub="Последние 20 сохранений"
                    onClick={() => { setOpen(false); setBackupsOpen(true); }} />
          <MenuItem icon="↺" label="Сбросить к демо-схеме" onClick={doReset} danger />

          <Separator />
          <div style={sectionHeader}>Файл</div>
          <MenuItem icon="⤒" label="Импортировать проект…" sub="JSON"
                    onClick={doImportFile} />
          <MenuItem icon="⤓" label="Экспортировать активный…" sub="JSON"
                    onClick={doExport} disabled={!active} />
          <MenuItem icon="⤓⤓" label="Экспортировать всю рабочую область…"
                    onClick={doExportAll} />

          <Separator />
          <div style={sectionHeader}>Импорт с оборудования</div>
          <MenuItem icon="↯" label="MikroTik (SSH / REST)…"
                    onClick={() => { setOpen(false); setMikrotikOpen(true); }} />
          <MenuItem icon="⌘" label="UniFi Controller…"
                    sub="self-hosted :8443"
                    onClick={() => { setOpen(false); setImportVendor('unifi'); setImportOpen(true); }} />
          <MenuItem icon="◈" label="TP-Link Omada Cloud…"
                    sub="omada.tplinkcloud.com"
                    onClick={() => { setOpen(false); setImportVendor('omada-cloud'); setImportOpen(true); }} />
          <MenuItem icon="…" label="Другое (Ruijie / D-Link / EdgeSwitch)…"
                    sub="в разработке · v0.38"
                    onClick={() => { setOpen(false); setImportVendor(undefined); setImportOpen(true); }} />

          <Separator />
          <div style={sectionHeader}>Инструменты</div>
          <MenuItem icon="🔐" label="Vault Studio…"
                    sub="Ctrl+K"
                    onClick={() => {
                      setOpen(false);
                      window.dispatchEvent(new CustomEvent('netmap:open-vault-studio'));
                    }} />

          <Separator />
          <div style={sectionHeader}>Вид</div>
          <MenuItem
            icon={viewMode === 'modern' ? '✦' : '⬒'}
            label={viewMode === 'modern' ? 'Стиль: Modern' : 'Стиль: Legacy'}
            sub="Переключить"
            onClick={() => { setViewMode(viewMode === 'modern' ? 'legacy' : 'modern'); }}
          />
          {viewMode === 'modern' && (
            <MenuItem
              icon={collapseEndpoints ? '✓' : ' '}
              label="Свернуть endpoint'ы в свитч"
              sub={collapseEndpoints ? 'вкл' : 'выкл'}
              onClick={() => { toggleCollapseEndpoints(); }}
            />
          )}
          <MenuItem icon={focusRelated ? '✓' : ' '}
                    label="Фокус связанных при hover"
                    sub={focusRelated ? 'вкл' : 'выкл'}
                    onClick={() => { toggleFocusRelated(); }} />

          <Separator />
          <MenuItem icon="⚙" label="Настройки…"
                    onClick={() => openDialog('settings')} />
          <MenuItem icon="⇩" label="Проверить обновления…"
                    sub="GitHub Releases"
                    onClick={async () => {
                      setOpen(false);
                      try {
                        const { checkForUpdatesNow } = await import('./updaterClient');
                        const r = await checkForUpdatesNow();
                        if (r && (r as any).disabled) {
                          useStore.getState().pushAlert({
                            severity: 'info', origin: 'app',
                            title: 'Обновления',
                            message: 'Auto-updater недоступен (dev-режим или отсутствует electron-updater).',
                          });
                        }
                      } catch (e: any) {
                        useStore.getState().pushAlert({
                          severity: 'warn', origin: 'app',
                          title: 'Проверка обновлений',
                          message: e?.message || String(e),
                        });
                      }
                    }} />
          <MenuItem icon="?" label="Помощь · горячие клавиши"
                    onClick={() => openDialog('help')} />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Legacy default export — kept so existing imports of <FileMenu /> keep
// working, but now it just renders <ProjectMenu /> so callers don't crash.
// New code should use <ProjectMenu /> and <AppMenu /> explicitly.
// ============================================================================
export function FileMenu() {
  return <ProjectMenu />;
}

// ---- styles ----
const projectBtn = (open: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 8,
  background: open ? '#F3F4F6' : '#FFFFFF',
  border: '1px solid #D1D5DB',
  color: '#111827',
  padding: '6px 10px 6px 8px', borderRadius: 6,
  fontSize: 12, fontWeight: 500,
  cursor: 'pointer',
});
const hamburgerBtn = (open: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 34, height: 34,
  background: open ? '#F3F4F6' : 'transparent',
  border: '1px solid transparent',
  color: '#374151',
  borderRadius: 6, cursor: 'pointer',
});
const sectionHeader: React.CSSProperties = {
  padding: '6px 12px 4px', fontSize: 9, opacity: 0.55,
  textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700,
};
