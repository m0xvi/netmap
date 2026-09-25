/**
 * v0.41.1 — Doc backups dialog. Shows the rolling snapshots main-process
 * keeps in the `doc_backups` SQLite table (last 20 saves). Lets the user
 * preview a snapshot (device / link / group counts) and restore it.
 *
 * Triggered from AppMenu → Проект → «⏮ Резервные копии…»
 *
 * Restore path:
 *   1. Fetch snapshot JSON via `loadDocBackup(id)`.
 *   2. Confirm with user (шоу diff-summary).
 *   3. Call `useStore.getState().replaceActiveProjectDoc(snapshot)` OR
 *      import as a NEW project (safer default).
 *
 * v0.62.0: каркас переведён на DialogShell (единая тема окон).
 */

import { useEffect, useState } from 'react';
import { useStore } from './store';
import { alertDialog, confirmDialog } from './Modal';
import { DialogShell, DlgBtn, DlgSection } from './DialogTheme';

interface Props { open: boolean; onClose: () => void; }
interface BackupRow { id: number; ts: number; note: string | null; size: number }

const w = typeof window !== 'undefined' ? (window as any) : {};

export function BackupsDialog({ open, onClose }: Props) {
  const [rows, setRows] = useState<BackupRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<any>(null);

  const refresh = async () => {
    if (!w.netmap?.listDocBackups) return;
    setRows(await w.netmap.listDocBackups());
  };
  useEffect(() => { if (open) refresh(); }, [open]);

  const doPreview = async (id: number) => {
    setSelected(id); setPreview(null);
    const snap = await w.netmap.loadDocBackup(id);
    setPreview(snap);
  };

  const doRestoreAsNew = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const json = JSON.stringify(preview);
      const id = useStore.getState().importProject(json);
      if (id) {
        useStore.getState().pushAlert({
          severity: 'success', origin: 'app',
          title: 'Резервная копия восстановлена',
          message: 'Создан новый проект из snapshot. Активный проект не тронут.',
        });
        onClose();
      } else {
        await alertDialog('Ошибка', 'Не удалось восстановить: формат snapshot невалидный.');
      }
    } finally { setBusy(false); }
  };

  const doRestoreInPlace = async () => {
    if (!preview) return;
    // v0.51.16: честный текст подтверждения — восстановление создаёт НОВЫЙ
    // проект из snapshot и делает его активным; старый проект остаётся в
    // списке (ничего не удаляется).
    if (!(await confirmDialog(
      'Восстановить вместо текущего проекта?',
      'Из резервной копии будет создан новый проект, и он станет активным. Текущий проект останется в списке — его можно удалить позже вручную.',
      { danger: true, okText: 'Восстановить' }
    ))) return;
    setBusy(true);
    try {
      // v0.41.1 approach: use importProject to make a new project, then
      // swap active. Simpler than adding a "replace doc in place" action.
      const json = JSON.stringify(preview);
      const newId = useStore.getState().importProject(json);
      if (newId) {
        // Switch to the newly-imported project.
        useStore.getState().switchProject(newId);
        useStore.getState().pushAlert({
          severity: 'success', origin: 'app',
          title: 'Восстановлено из резервной копии',
          message: `Snapshot от ${new Date(rows.find(r => r.id === selected)?.ts || 0).toLocaleString()}`,
        });
        onClose();
      }
    } finally { setBusy(false); }
  };

  const doDelete = async (id: number) => {
    if (!(await confirmDialog('Удалить резервную копию?', undefined, { danger: true, okText: 'Удалить' }))) return;
    await w.netmap.deleteDocBackup(id);
    setSelected(prev => prev === id ? null : prev);
    if (selected === id) setPreview(null);
    refresh();
  };

  if (!open) return null;

  return (
    <DialogShell
      title="Резервные копии проекта"
      subtitle="Автоматические snapshot'ы (последние 20 сохранений). Хранятся в SQLite локально."
      icon="database"
      width={900}
      onClose={onClose}
      bodyStyle={{ padding: 0, gap: 0 }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', flex: 1, minHeight: 0 }}>
        {/* List */}
        <div style={{
          borderRight: '1px solid #E2E8F0', overflowY: 'auto',
          background: '#fff', maxHeight: '60vh',
        }}>
          {rows.length === 0 && (
            <div className="empty" style={{ margin: 12 }}>
              Резервных копий ещё нет. Первый snapshot появится после следующего сохранения.
            </div>
          )}
          {rows.map(row => (
            <button
              key={row.id}
              onClick={() => doPreview(row.id)}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 14px',
                border: 'none', borderBottom: '1px solid #E2E8F0',
                background: selected === row.id ? '#EFF6FF' : 'transparent',
                cursor: 'pointer',
                borderLeft: '3px solid ' + (selected === row.id ? '#2563EB' : 'transparent'),
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: '#0F172A' }}>
                {new Date(row.ts).toLocaleString()}
              </div>
              {row.note && (
                <div style={{ fontSize: 10, color: '#64748B', marginTop: 3 }}>{row.note}</div>
              )}
              <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 2 }}>
                {(row.size / 1024).toFixed(1)} KB
              </div>
            </button>
          ))}
        </div>

        {/* Preview */}
        <div style={{ padding: 20, overflowY: 'auto', maxHeight: '60vh' }}>
          {!preview && (
            <div className="empty" style={{ marginTop: 40 }}>
              Выберите snapshot слева
            </div>
          )}
          {preview && (
            <DlgSection title="Содержимое snapshot">
              <div style={{
                padding: 12, background: '#F1F5F9', borderRadius: 8,
                fontSize: 12, color: '#334155', lineHeight: 1.7,
              }}>
                <div>Название проекта: <b>{preview.name || '(без названия)'}</b></div>
                <div>Устройств: <b>{(preview.devices || []).length}</b></div>
                <div>Связей: <b>{(preview.links || []).length}</b></div>
                <div>Групп: <b>{(preview.groups || []).length}</b></div>
                <div>VLAN'ов: <b>{(preview.vlans || []).length}</b></div>
                <div>Sticky-заметок: <b>{(preview.stickies || []).length}</b></div>
              </div>

              <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <DlgBtn kind="primary" className="sm" disabled={busy} onClick={doRestoreAsNew}>
                  + Восстановить как новый проект
                </DlgBtn>
                <DlgBtn kind="danger" className="sm" disabled={busy} onClick={doRestoreInPlace}>
                  Заменить текущий
                </DlgBtn>
                <DlgBtn kind="ghost" className="sm" onClick={() => selected && doDelete(selected)}>
                  Удалить
                </DlgBtn>
              </div>

              <div className="infobox info" style={{ marginTop: 12 }}>
                «Восстановить как новый проект» безопаснее — оригинал не пострадает,
                можно сравнить и уже потом решить оставить или удалить старый.
              </div>
            </DlgSection>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
