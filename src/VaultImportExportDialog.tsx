/**
 * v0.39 — Vault Import/Export dialog.
 *
 * Three tabs:
 *   • Импорт  — из .kdbx (KeePass), Bitwarden JSON или CSV. Показывает
 *               preview, дает подтвердить и льёт через vaultImport().
 *   • Экспорт — все vault items в .kdbx (новый мастер-пароль), Bitwarden JSON
 *               (без шифрования!), CSV.
 *   • Мигратор — сканирует device.credential.password и предлагает перенести
 *                в vault (auto-bind по device.credentialId).
 *
 * Каркас — DialogShell (портал в body), чтобы не перекрывалось оверлеями канваса (LayerLegend и др.).
 */

import { useEffect, useMemo, useState } from 'react';
import { DialogShell, DlgBtn } from './DialogTheme';
import { useStore } from './store';
import { alertDialog, confirmDialog } from './Modal';
import {
  vaultStatus, vaultList, vaultImport, vaultUnlock,
  vaultKdbxParse, vaultExportAll, vaultUpsert,
  parseBitwardenExport, parseGenericCsv,
  type VaultItemFull, type VaultFolder,
} from './vaultClient';
import { exportBitwardenJson, exportCsv, exportKdbx, downloadFile } from './vaultExport';

interface Props {
  open: boolean;
  onClose: () => void;
  initialTab?: 'import' | 'export' | 'migrate';
}

type Tab = 'import' | 'export' | 'migrate';

export function VaultImportExportDialog({ open, onClose, initialTab = 'import' }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);

  const [status, setStatus] = useState<any>(null);
  useEffect(() => {
    if (!open) return;
    vaultStatus().then(setStatus).catch(() => {});
  }, [open]);

  if (!open) return null;

  const locked = status && (!status.initialized || !status.unlocked);

  return (
    <DialogShell
      title="Vault — Импорт / Экспорт / Миграция"
      subtitle="KeePass (.kdbx) · Bitwarden JSON · CSV · перенос паролей из устройств"
      icon="swap"
      width={780}
      onClose={onClose}
      footer={(
        <>
          <span className="f-spacer" />
          <DlgBtn kind="ghost" onClick={onClose}>Закрыть</DlgBtn>
        </>
      )}
    >
      <div className="seg">
        <button className={tab === 'import' ? 'on' : ''} onClick={() => setTab('import')}>Импорт</button>
        <button className={tab === 'export' ? 'on' : ''} onClick={() => setTab('export')}>Экспорт</button>
        <button className={tab === 'migrate' ? 'on' : ''} onClick={() => setTab('migrate')}>Мигратор из устройств</button>
      </div>
      {locked && (
        <div className="infobox warn">
          Vault {status?.initialized ? 'заблокирован' : 'не создан'}. Откройте панель Vault слева
          и {status?.initialized ? 'введите мастер-пароль' : 'создайте'}, чтобы продолжить.
        </div>
      )}
          {tab === 'import'  && <ImportTab onDone={onClose} disabled={locked} />}
          {tab === 'export'  && <ExportTab disabled={locked} />}
          {tab === 'migrate' && <MigrateTab onDone={onClose} disabled={locked} />}
    </DialogShell>
  );
}

// ===========================================================================
// Import tab

function ImportTab({ onDone, disabled }: { onDone: () => void; disabled: boolean }) {
  const [format, setFormat] = useState<'kdbx' | 'bitwarden' | 'csv'>('kdbx');
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState('');

  const parse = async () => {
    setError(''); setPreview(null);
    if (!file) return;
    setBusy(true);
    try {
      if (format === 'kdbx') {
        const buf = await file.arrayBuffer();
        const base64 = arrayBufferToBase64(buf);
        const res = await vaultKdbxParse(base64, password);
        if (!res.ok) { setError(res.error || 'Ошибка разбора .kdbx'); return; }
        setPreview({
          items: res.items || [],
          folders: res.folders || [],
          stats: res.stats,
        });
      } else if (format === 'bitwarden') {
        const text = await file.text();
        const items = parseBitwardenExport(text);
        setPreview({ items, folders: [], stats: { itemCount: items.length } });
      } else {
        const text = await file.text();
        const items = parseGenericCsv(text);
        setPreview({ items, folders: [], stats: { itemCount: items.length } });
      }
    } catch (e: any) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const payload = {
        items: preview.items,
        folders: preview.folders,
      };
      const res = await vaultImport(payload);
      if (res.locked) { setError('Vault заблокирован'); return; }
      await alertDialog(
        'Импорт завершён',
        `Добавлено записей: ${res.added || 0}` +
        (res.foldersAdded ? `\nПапок: ${res.foldersAdded}` : '')
      );
      onDone();
    } catch (e: any) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <label style={fieldLabel}>Формат файла</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <RadioPill checked={format === 'kdbx'}     onClick={() => setFormat('kdbx')}     label="▣ KeePass (.kdbx)" />
          <RadioPill checked={format === 'bitwarden'} onClick={() => setFormat('bitwarden')} label="□ Bitwarden JSON" />
          <RadioPill checked={format === 'csv'}      onClick={() => setFormat('csv')}      label="≡ CSV" />
        </div>
      </div>

      <div>
        <label style={fieldLabel}>Файл</label>
        <input
          type="file"
          accept={format === 'kdbx' ? '.kdbx' : format === 'bitwarden' ? '.json' : '.csv'}
          onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); }}
          style={{ ...inputStyle, padding: '4px 6px' }}
        />
      </div>

      {format === 'kdbx' && (
        <div>
          <label style={fieldLabel}>Мастер-пароль KeePass</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                 placeholder="Пароль от .kdbx" style={inputStyle}
                 onKeyDown={(e) => e.key === 'Enter' && parse()} />
          <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 3 }}>
            Пароль используется только для расшифровки — не сохраняется.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button style={primaryBtn} disabled={!file || busy || disabled} onClick={parse}>
          {busy ? 'Читаю…' : 'Проверить'}
        </button>
        {preview && (
          <button style={{ ...primaryBtn, background: '#059669' }} disabled={busy || disabled} onClick={commit}>
            {busy ? 'Импорт…' : `Импортировать (${preview.items.length})`}
          </button>
        )}
      </div>

      {error && (
        <div style={{
          padding: '10px 12px', borderRadius: 8, fontSize: 12,
          background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B',
        }}>
          <b>Ошибка:</b> {error}
        </div>
      )}

      {preview && (
        <div style={{
          padding: 12, background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Предпросмотр
            {preview.stats?.dbName && (
              <span style={{ marginLeft: 6, fontWeight: 400, color: '#64748B' }}>· {preview.stats.dbName}</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginBottom: 6 }}>
            Записей: <b>{preview.items.length}</b>
            {preview.folders?.length > 0 && <> · Папок: <b>{preview.folders.length}</b></>}
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', display: 'grid', gap: 2 }}>
            {preview.items.slice(0, 30).map((it: any, i: number) => (
              <div key={i} style={{ fontSize: 11, padding: '3px 6px', background: 'white', borderRadius: 4 }}>
                <span style={{ fontWeight: 600 }}>{it.name || '(без имени)'}</span>
                {it.username && <span style={{ color: '#64748B', marginLeft: 6 }}>{it.username}</span>}
                {it.folderPath && <span style={{ color: '#94A3B8', marginLeft: 6, fontSize: 10 }}>▤ {it.folderPath}</span>}
                {it.totpSecret && <span style={{ marginLeft: 6 }}>▣</span>}
              </div>
            ))}
            {preview.items.length > 30 && (
              <div style={{ fontSize: 10, opacity: 0.6, textAlign: 'center', padding: 4 }}>
                … и ещё {preview.items.length - 30}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Export tab

function ExportTab({ disabled }: { disabled: boolean }) {
  const [format, setFormat] = useState<'kdbx' | 'bitwarden' | 'csv'>('kdbx');
  const [kdbxPw1, setKdbxPw1] = useState('');
  const [kdbxPw2, setKdbxPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await vaultExportAll({ format });
      if (res.locked) { setError('Vault заблокирован'); return; }
      if (!res.ok || !res.items) { setError(res.error || 'Не удалось прочитать vault'); return; }
      const items = res.items as VaultItemFull[];
      const folders = (res.folders || []) as VaultFolder[];

      if (format === 'kdbx') {
        if (kdbxPw1.length < 6) { setError('Пароль слишком короткий (мин 6)'); return; }
        if (kdbxPw1 !== kdbxPw2) { setError('Пароли не совпадают'); return; }
        const file = await exportKdbx(items, folders, kdbxPw1);
        downloadFile(file);
      } else if (format === 'bitwarden') {
        const ok = await confirmDialog(
          'Экспорт в Bitwarden JSON',
          'Файл будет НЕ зашифрован — все пароли будут читаться открытым текстом. Продолжить?',
          { danger: true, okText: 'Экспортировать' }
        );
        if (!ok) return;
        downloadFile(exportBitwardenJson(items, folders));
      } else {
        const ok = await confirmDialog(
          'Экспорт в CSV',
          'Файл будет НЕ зашифрован — все пароли в открытом виде. Продолжить?',
          { danger: true, okText: 'Экспортировать' }
        );
        if (!ok) return;
        downloadFile(exportCsv(items, folders));
      }
      setKdbxPw1(''); setKdbxPw2('');
    } catch (e: any) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <label style={fieldLabel}>Формат</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <RadioPill checked={format === 'kdbx'}      onClick={() => setFormat('kdbx')}      label="▣ KeePass (.kdbx)" />
          <RadioPill checked={format === 'bitwarden'} onClick={() => setFormat('bitwarden')} label="□ Bitwarden JSON (не шифр.)" />
          <RadioPill checked={format === 'csv'}       onClick={() => setFormat('csv')}       label="≡ CSV (не шифр.)" />
        </div>
      </div>

      {format === 'kdbx' && (
        <>
          <div>
            <label style={fieldLabel}>Мастер-пароль для нового .kdbx</label>
            <input type="password" value={kdbxPw1} onChange={(e) => setKdbxPw1(e.target.value)}
                   placeholder="Новый пароль (мин 6 символов)" style={inputStyle} />
          </div>
          <div>
            <label style={fieldLabel}>Повторите пароль</label>
            <input type="password" value={kdbxPw2} onChange={(e) => setKdbxPw2(e.target.value)}
                   placeholder="Повторите" style={inputStyle} />
          </div>
          <div style={{ fontSize: 11, color: '#64748B', background: '#F1F5F9', padding: 8, borderRadius: 6 }}>
            ℹ Файл откроется в KeePass 2 / KeePassXC / KeeWeb. TOTP-секреты сохраняются как <code>otp</code>
            поле в формате <code>otpauth://</code>, совместимо с KeeOTP / KeePassXC.
          </div>
        </>
      )}

      {format !== 'kdbx' && (
        <div style={{
          padding: 12, borderRadius: 8, background: '#FEF3C7', border: '1px solid #FCD34D',
          fontSize: 12, color: '#92400E',
        }}>
          ⚠ Этот формат <b>не шифрует</b> пароли. Не оставляйте файл на общем диске / в облаке.
        </div>
      )}

      <button style={primaryBtn} disabled={busy || disabled} onClick={run}>
        {busy ? 'Экспорт…' : '⤓ Экспортировать сейчас'}
      </button>

      {error && (
        <div style={{
          padding: '10px 12px', borderRadius: 8, fontSize: 12,
          background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B',
        }}>
          <b>Ошибка:</b> {error}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Migrator tab — pulls embedded device.credential passwords into vault

interface MigrateCandidate {
  deviceId: string;
  deviceName: string;
  ip?: string;
  username?: string;
  notes?: string;
  existingVaultId?: string;   // already linked → suggest re-link only
  selected: boolean;
}

function MigrateTab({ onDone, disabled }: { onDone: () => void; disabled: boolean }) {
  const doc = useStore(s => s.doc);
  const updateDevice = useStore(s => s.updateDevice);
  const [items, setItems] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<MigrateCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ migrated: number; linked: number } | null>(null);

  useEffect(() => {
    (async () => {
      const list = await vaultList();
      setItems(list);
      // v0.39: candidates are devices that have username or notes but no
      // vaultItemId link yet. We create a starter vault entry (password blank
      // for user to fill in) and auto-link.
      const cands: MigrateCandidate[] = [];
      for (const d of doc.devices) {
        const c = d.credential;
        const hasSomething = c && (c.username || c.notes);
        if (!hasSomething) continue;
        cands.push({
          deviceId: d.id,
          deviceName: d.name,
          ip: d.ip,
          username: c!.username || '',
          notes: c!.notes || '',
          existingVaultId: c!.vaultItemId || undefined,
          selected: !c!.vaultItemId,
        });
      }
      setCandidates(cands);
    })();
  }, [doc.devices]);

  const stats = useMemo(() => {
    const selected = candidates.filter(c => c.selected).length;
    const linked = candidates.filter(c => c.existingVaultId).length;
    return { total: candidates.length, selected, linked };
  }, [candidates]);

  const toggleAll = () => {
    const all = candidates.every(c => c.selected);
    setCandidates(candidates.map(c => ({ ...c, selected: !all })));
  };

  const migrate = async () => {
    setBusy(true);
    let migrated = 0;
    let linked = 0;
    try {
      for (const c of candidates) {
        if (!c.selected) continue;
        // Look for existing vault item by URL/name match
        const guessName = `${c.deviceName}${c.ip ? ' (' + c.ip + ')' : ''}`;
        const existingByName = items.find((it: any) =>
          it.name === guessName || (c.ip && it.url && it.url.includes(c.ip))
        );
        let vaultItemId: string;
        if (existingByName) {
          vaultItemId = existingByName.id;
          linked++;
        } else {
          const res = await vaultUpsert({
            name: guessName,
            folder: null,
            url: c.ip ? `https://${c.ip}` : undefined,
            username: c.username,
            password: '',             // user fills in later
            notes: c.notes,
            tags: ['migrated'],
          });
          if (!res.ok || !res.id) continue;
          vaultItemId = res.id;
          migrated++;
        }
        // Link the device to the vault item. Keep username as reference
        // hint; source of truth for password is now the vault entry.
        updateDevice(c.deviceId, {
          credential: {
            ...(doc.devices.find(d => d.id === c.deviceId)?.credential || {}),
            vaultItemId,
          },
          credentialId: vaultItemId,
        });
      }
      setResult({ migrated, linked });
      useStore.getState().pushAlert({
        severity: 'success', origin: 'app',
        title: 'Миграция паролей завершена',
        message: `Перенесено: ${migrated} · привязано к существующим: ${linked}`,
      });
    } finally {
      setBusy(false);
    }
  };

  if (candidates.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#64748B', fontSize: 13 }}>
        {stats.total === 0
          ? '✓ Ни у одного устройства нет embedded-паролей. Ничего мигрировать.'
          : 'Все пароли уже привязаны к vault-записям.'}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{
        padding: 12, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8,
        fontSize: 12, color: '#1E40AF',
      }}>
        Найдено устройств с credentials без привязки к vault: <b>{stats.total}</b>.
        Для каждого будет создана запись в vault (пароль оставим пустым — заполните позже
        через редактор) и устройство будет к ней привязано (<code>credentialId</code>).
        Если по IP или имени уже есть подходящая запись — просто привяжем.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button style={smallBtn} onClick={toggleAll}>
          {candidates.every(c => c.selected) ? 'Снять всё' : 'Выбрать всё'}
        </button>
        <span style={{ fontSize: 11, color: '#64748B' }}>
          Выбрано: <b>{stats.selected}</b> из {stats.total}
          {stats.linked > 0 && <> · уже привязано: {stats.linked}</>}
        </span>
      </div>

      <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', maxHeight: 340, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              <th style={th}></th>
              <th style={th}>Устройство</th>
              <th style={th}>IP</th>
              <th style={th}>Логин</th>
              <th style={th}>Заметки</th>
              <th style={th}>Статус</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c, i) => (
              <tr key={c.deviceId} style={{
                borderTop: '1px solid #F1F5F9',
                opacity: c.existingVaultId ? 0.7 : 1,
              }}>
                <td style={td}>
                  <input type="checkbox" checked={c.selected}
                         onChange={(e) => {
                           const next = [...candidates];
                           next[i] = { ...c, selected: e.target.checked };
                           setCandidates(next);
                         }} />
                </td>
                <td style={td}><b>{c.deviceName}</b></td>
                <td style={{ ...td, fontFamily: 'monospace' }}>{c.ip || '—'}</td>
                <td style={td}>{c.username || <span style={{ color: '#94A3B8' }}>—</span>}</td>
                <td style={{ ...td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.notes ? <span title={c.notes} style={{ color: '#64748B' }}>{c.notes.slice(0, 40)}</span> : <span style={{ color: '#94A3B8' }}>—</span>}
                </td>
                <td style={td}>
                  {c.existingVaultId
                    ? <span style={{ color: '#059669', fontSize: 10 }}>↔ привязан</span>
                    : <span style={{ color: '#B45309', fontSize: 10 }}>новая запись</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button style={primaryBtn} disabled={busy || disabled || stats.selected === 0} onClick={migrate}>
        {busy ? 'Миграция…' : `⇄ Перенести ${stats.selected} в vault`}
      </button>

      {result && (
        <div style={{
          padding: 12, borderRadius: 8, fontSize: 12,
          background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#065F46',
        }}>
          ✓ Готово. Создано новых записей: <b>{result.migrated}</b> · привязано к существующим: <b>{result.linked}</b>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// UI atoms

// v0.62.0: табы — сегмент-контрол темы (класс .seg), TabBtn удалён.
function RadioPill({ checked, onClick, label }: { checked: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 12px', borderRadius: 999, fontSize: 11, cursor: 'pointer',
      border: '1.5px solid ' + (checked ? '#4361EE' : '#E4E9F2'),
      background: checked ? '#EDF1FF' : 'white',
      color: checked ? '#3550D4' : '#475569',
      fontWeight: checked ? 700 : 500,
    }}>{label}</button>
  );
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(bin);
}

// v0.62.0: значения кнопок/полей — из единой темы (DialogTheme).
const inputStyle: React.CSSProperties = {
  padding: '8px 10px', border: '1.5px solid #E4E9F2', borderRadius: 9,
  fontSize: 13, background: '#fff', color: '#0F172A', width: '100%', boxSizing: 'border-box',
};
const primaryBtn: React.CSSProperties = {
  padding: '9px 18px', border: 'none', borderRadius: 11, background: 'linear-gradient(135deg,#4361ee,#5a3ee6)',
  color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
};
const smallBtn: React.CSSProperties = {
  padding: '8px 14px', border: '1.5px solid #E4E9F2', borderRadius: 11, background: '#fff',
  fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#475569',
};
const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 11.5, color: '#475569', marginBottom: 4, fontWeight: 700,
};
const th: React.CSSProperties = {
  padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700,
  color: '#64748B', textTransform: 'uppercase',
};
const td: React.CSSProperties = { padding: '5px 8px', fontSize: 11 };
