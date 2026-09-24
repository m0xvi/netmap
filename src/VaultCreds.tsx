/**
 * v0.51.21 — интеграция Vault в формы учётных данных.
 * v0.51.22 — SVG-иконки вместо «▣» (символ рендерился квадратом на части
 *            систем) и инлайн-окно разблокировки хранилища прямо из диалога:
 *            нажатие «Из Vault»/«В Vault» на заблокированном хранилище сразу
 *            спрашивает мастер-пароль и продолжает действие, без похода в
 *            другое место.
 * v0.55.0 — пикер показывает порт и логин (иначе две записи «MikroTik SSH ·
 *            192.168.11.1» с портом и без неразличимы); удаление записи
 *            прямо из пикера; кнопка «Открыть Vault Studio» для полного
 *            управления; порт попадает в имя новых записей.
 *
 * Записи категоризируются тегами: для чего (`ssh` / `snmp` / `api`), какой
 * службы (`mikrotik ssh`, `snmp community`, …), хост в `url`, привязка к
 * устройству схемы через `boundDeviceIds`, папка (`MikroTik` / `SNMP`).
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { alertDialog, confirmDialog } from './Modal';
import {
  vaultList, vaultGet, vaultUpsert, vaultStatus, vaultUnlock, vaultDelete,
  type VaultItemMeta,
} from './vaultClient';

export interface CredField {
  /** ключ значения в values; 'username'/'password' маппятся на поля записи,
      остальные — в fields[key]. */
  key: string;
  label: string;
}

interface Props {
  host: string;
  /** категория назначения: 'ssh' | 'snmp' | 'api' | 'web' */
  purpose: string;
  /** название службы для имени записи: 'MikroTik SSH', 'SNMP', 'UniFi API'… */
  serviceLabel: string;
  fields: CredField[];
  values: Record<string, string>;
  onApply: (vals: Record<string, string>) => void;
  deviceId?: string | null;
  /** папка Vault (для совместимости со старыми подборщиками): 'MikroTik', 'SNMP'… */
  folder?: string;
}

// ---------------------------------------------------------------------------
// SVG-иконки (по конвенции проекта — без эмодзи/редких юникод-символов)

const IconVault = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 8.5V7M12 17v-1.5M8.5 12H7M17 12h-1.5" />
  </svg>
);
const IconDown = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 4v12M6 10l6 6 6-6M4 20h16" />
  </svg>
);
const IconTrash = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 13h9l1-13" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

const btnStyle: React.CSSProperties = {
  background: '#F5F3FF', border: '1px solid #C4B5FD', color: '#5B21B6',
  borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 600,
  cursor: 'pointer', whiteSpace: 'nowrap',
  display: 'inline-flex', alignItems: 'center', gap: 5,
};

const trashBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', borderRadius: 6,
  color: '#CBD5E1', cursor: 'pointer', padding: 6, flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const studioLinkStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#5B21B6',
  fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0,
};

// ---------------------------------------------------------------------------

async function vaultState(): Promise<'ok' | 'locked' | 'noinit'> {
  try {
    const st = await vaultStatus();
    if (!st.initialized) return 'noinit';
    return st.unlocked ? 'ok' : 'locked';
  } catch {
    return 'ok'; // браузерный fallback без статуса — даём шанс действию
  }
}

export function VaultCredsButtons(props: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const pendingRef = useRef<null | (() => void)>(null);

  /** Запускает действие; если хранилище заблокировано — сначала инлайн-разблокировка. */
  const requireUnlocked = async (fn: () => void) => {
    const st = await vaultState();
    if (st === 'ok') { fn(); return; }
    if (st === 'noinit') {
      await alertDialog('Vault не создан',
        'Хранилище ещё не инициализировано. Откройте Vault Studio (Ctrl+K) → «Настройки безопасности» и создайте его один раз.');
      return;
    }
    pendingRef.current = fn;
    setUnlockOpen(true);
  };

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button type="button" style={btnStyle} title="Подставить учётные данные из Vault"
              onClick={() => requireUnlocked(() => setPickerOpen(true))}>
        <IconVault /> Из Vault
      </button>
      <button type="button" style={btnStyle} title="Сохранить эти учётные данные в Vault"
              onClick={() => requireUnlocked(() => void saveToVault(props))}>
        <IconDown /> В Vault
      </button>
      {pickerOpen && <VaultPicker {...props} onClose={() => setPickerOpen(false)} />}
      {unlockOpen && (
        <UnlockModal
          onDone={async (ok) => {
            setUnlockOpen(false);
            if (ok && pendingRef.current) {
              const fn = pendingRef.current;
              pendingRef.current = null;
              fn();
            }
          }}
        />
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Инлайн-разблокировка: мастер-пароль → vaultUnlock → продолжить действие.

function UnlockModal({ onDone }: { onDone: (ok: boolean) => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!pw || busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await vaultUnlock(pw);
      if (r?.ok) { onDone(true); }
      else { setErr('Неверный мастер-пароль.'); }
    } catch (e: any) {
      setErr(e?.message || 'Не удалось разблокировать.');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9700,
      background: 'rgba(15,23,42,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={() => onDone(false)}>
      <div style={{
        width: 360, background: '#fff', borderRadius: 12,
        boxShadow: '0 24px 64px rgba(15,23,42,0.35)', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E7EB',
                      display: 'flex', alignItems: 'center', gap: 8,
                      fontSize: 13, fontWeight: 700, color: '#0F172A' }}>
          <span style={{ color: '#5B21B6' }}><IconVault size={14} /></span>
          Разблокировать Vault
        </div>
        <div style={{ padding: 16, display: 'grid', gap: 10 }}>
          <input
            autoFocus
            type="password"
            value={pw}
            placeholder="Мастер-пароль"
            onChange={e => { setPw(e.target.value); setErr(''); }}
            onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
            style={{
              padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 8,
              fontSize: 13, outline: 'none',
            }}
          />
          {err && <div style={{ fontSize: 11, color: '#B91C1C' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => onDone(false)} style={{
              background: '#fff', border: '1px solid #D1D5DB', borderRadius: 6,
              padding: '6px 12px', fontSize: 12, cursor: 'pointer',
            }}>Отмена</button>
            <button onClick={() => void submit()} disabled={busy || !pw} style={{
              background: '#5B21B6', color: '#fff', border: 'none', borderRadius: 6,
              padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              opacity: busy || !pw ? 0.6 : 1,
            }}>{busy ? 'Секунду…' : 'Разблокировать'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------

async function saveToVault(props: Props) {
  const filled = props.fields.filter(f => (props.values[f.key] || '').trim() !== '');
  if (filled.length === 0) {
    await alertDialog('Нечего сохранять', 'Заполните поля учётных данных перед сохранением в Vault.');
    return;
  }
  const username = props.values['username'] || '';
  const firstSecret = props.fields.find(f => f.key !== 'username' && (props.values[f.key] || ''));
  const password = props.values['password'] ?? (firstSecret ? props.values[firstSecret.key] : '');
  const extraFields: Record<string, string> = {};
  for (const f of props.fields) {
    if (f.key !== 'username' && f.key !== 'password' && props.values[f.key]) {
      extraFields[f.key] = props.values[f.key];
    }
  }
  // v0.55.0: порт — в имя записи, иначе «с портом» и «без порта» неразличимы.
  const hostPart = props.host || '(хост не указан)';
  const portVal = (props.values['port'] || '').trim();
  const portPart = props.host && portVal ? `:${portVal}` : '';
  const name = `${props.serviceLabel} · ${hostPart}${portPart}`;
  const res = await vaultUpsert({
    name,
    username,
    password,
    fields: Object.keys(extraFields).length ? extraFields : undefined,
    tags: ['creds', props.purpose, props.serviceLabel.toLowerCase()],
    url: props.host || undefined,
    boundDeviceIds: props.deviceId ? [props.deviceId] : undefined,
    folder: props.folder,
  });
  if (res?.ok) {
    await alertDialog('Сохранено в Vault', `Запись «${name}» (назначение: ${props.purpose}).`);
  } else {
    await alertDialog('Не удалось сохранить', 'Хранилище отклонило запись (возможно, заблокировалось во время ввода).');
  }
}

// ---------------------------------------------------------------------------

function VaultPicker({ onClose, ...props }: Props & { onClose: () => void }) {
  const [items, setItems] = useState<VaultItemMeta[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // v0.55.0: порт/логин из расшифрованных записей — мета их не содержит,
  // а без них одинаковые записи неразличимы. Хранилище уже разблокировано
  // (requireUnlocked), так что догружаем первые 30 релевантных записей.
  const [extra, setExtra] = useState<Record<string, { port?: string; username?: string }>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      const all = await vaultList().catch(() => [] as VaultItemMeta[]);
      if (!alive) return;
      const hostLc = (props.host || '').toLowerCase();
      const folderLc = (props.folder || '').toLowerCase();
      const relevant = all.filter(it =>
        (it.tags || []).includes(props.purpose)
        || (folderLc && (it.folder || '').toLowerCase() === folderLc)
        || (it.tags || []).includes(props.serviceLabel.toLowerCase())
        || (hostLc && ((it.url || '').toLowerCase().includes(hostLc)
                       || it.name.toLowerCase().includes(hostLc)))
        || (props.deviceId && (it.boundDeviceIds || []).includes(props.deviceId))
      );
      const shown = relevant.length > 0 ? relevant : all;
      setItems(shown);
      const toEnrich = shown.slice(0, 30);
      if (toEnrich.length === 0) return;
      const pairs = await Promise.all(toEnrich.map(async (it) => {
        try {
          const full = await vaultGet(it.id);
          const f = full?.item;
          if (!f) return null;
          const port = f.fields?.['port'] || '';
          const username = f.username || '';
          if (!port && !username) return null;
          return [it.id, { port, username }] as const;
        } catch { return null; }
      }));
      if (!alive) return;
      const m: Record<string, { port?: string; username?: string }> = {};
      for (const p of pairs) if (p) m[p[0]] = p[1];
      setExtra(m);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = async (id: string) => {
    setBusyId(id);
    const r = await vaultGet(id).catch(() => null);
    setBusyId(null);
    if (!r || r.locked) {
      await alertDialog('Vault заблокирован', 'Хранилище автозаблокировалось — нажмите кнопку ещё раз и введите мастер-пароль.');
      onClose();
      return;
    }
    if (!r.item) { await alertDialog('Ошибка', 'Запись не найдена.'); return; }
    const vals: Record<string, string> = {};
    for (const f of props.fields) {
      if (f.key === 'username') vals.username = r.item.username || '';
      else if (f.key === 'password') vals.password = r.item.password || '';
      else {
        const fv = r.item.fields?.[f.key];
        // v0.53.0: подставляем только то, что реально сохранено. Раньше
        // отсутствующее поле молча подменялось паролем — так порт SSH
        // затирался паролем при применении старых записей без порта.
        if (fv != null && fv !== '') vals[f.key] = fv;
        // Исключение: community в записях, заведённых вручную через
        // Vault Studio, часто лежит в поле пароля — здесь фолбэк уместен.
        else if (f.key === 'community' && r.item.password) vals[f.key] = r.item.password;
      }
    }
    props.onApply(vals);
    onClose();
  };

  const removeItem = async (id: string, name: string) => {
    if (!await confirmDialog('Удалить запись Vault?',
        `«${name}» будет удалена безвозвратно.`, { danger: true, okText: 'Удалить' })) return;
    const r = await vaultDelete(id).catch(() => null);
    if (r?.ok) {
      setItems(prev => (prev || []).filter(x => x.id !== id));
      setExtra(prev => { const n = { ...prev }; delete n[id]; return n; });
    } else {
      await alertDialog('Не удалось удалить', 'Хранилище отклонило удаление (возможно, заблокировалось).');
    }
  };

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9600,
      background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: 460, maxHeight: '70vh', display: 'flex', flexDirection: 'column',
        background: '#fff', borderRadius: 12, boxShadow: '0 24px 64px rgba(15,23,42,0.35)',
        overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E7EB',
                      fontSize: 13, fontWeight: 700, color: '#0F172A',
                      display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#5B21B6' }}><IconVault size={14} /></span>
          Из Vault — {props.serviceLabel}
          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: '#64748B' }}>
            назначение: {props.purpose}{props.host ? ` · хост: ${props.host}` : ''}
          </span>
        </div>
        <div style={{ overflowY: 'auto', padding: 8 }}>
          {items === null && (
            <div style={{ padding: 16, fontSize: 12, color: '#64748B', textAlign: 'center' }}>
              Читаю хранилище…
            </div>
          )}
          {items !== null && items.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: '#64748B', textAlign: 'center' }}>
              В Vault пока нет записей. Заполните поля вручную и нажмите «В Vault».
            </div>
          )}
          {(items || []).map(it => {
            const ex = extra[it.id];
            const subParts = [...(it.tags || [])];
            if (it.url) subParts.push(it.url + (ex?.port ? `:${ex.port}` : ''));
            else if (ex?.port) subParts.push(`:${ex.port}`);
            if (ex?.username) subParts.push(ex.username);
            return (
              <div key={it.id}
                   onClick={() => busyId == null && pick(it.id)}
                   style={{
                     padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                     display: 'flex', alignItems: 'center', gap: 8,
                     opacity: busyId === it.id ? 0.5 : 1,
                   }}
                   onMouseOver={e => { (e.currentTarget as HTMLDivElement).style.background = '#F1F5F9'; }}
                   onMouseOut={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>
                <span style={{ width: 22, height: 22, borderRadius: 6, background: '#EDE9FE',
                               color: '#5B21B6', display: 'flex', alignItems: 'center',
                               justifyContent: 'center', flexShrink: 0 }}>
                  <IconVault size={12} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#0F172A',
                                 overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.name}
                  </span>
                  <span style={{ display: 'block', fontSize: 10, color: '#64748B',
                                 overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {subParts.join(' · ')}
                  </span>
                </span>
                <button type="button" title="Удалить запись из Vault"
                        onClick={e => { e.stopPropagation(); void removeItem(it.id, it.name); }}
                        style={trashBtnStyle}
                        onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.color = '#DC2626'; (e.currentTarget as HTMLButtonElement).style.background = '#FEF2F2'; }}
                        onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.color = '#CBD5E1'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
                  <IconTrash />
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid #E5E7EB',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button type="button" style={studioLinkStyle}
                  onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('netmap:open-vault-studio')); }}>
            Открыть Vault Studio — изменить записи…
          </button>
          <button onClick={onClose} style={{
            background: '#fff', border: '1px solid #D1D5DB', borderRadius: 6,
            padding: '5px 14px', fontSize: 12, cursor: 'pointer',
          }}>Отмена</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
