/**
 * v0.51.21 — интеграция Vault в формы учётных данных.
 *
 * Рядом с полями логин/пароль/community появляются две кнопки:
 *   «▣ Из Vault»  — подбор существующей записи (отфильтрованной по назначению
 *                   и хосту) и подстановка значений в форму;
 *   «▣ В Vault»   — сохранить текущие значения формы как запись хранилища.
 *
 * Записи подразделяются тегами: для чего (`ssh` / `snmp` / `api` / `web`) и
 * какой службы (`MikroTik SSH`, `UniFi API`, …) + хост в `url` и привязка к
 * устройству схемы через `boundDeviceIds`.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { alertDialog } from './Modal';
import {
  vaultList, vaultGet, vaultUpsert, vaultStatus,
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

const btnStyle: React.CSSProperties = {
  background: '#F5F3FF', border: '1px solid #C4B5FD', color: '#5B21B6',
  borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 600,
  cursor: 'pointer', whiteSpace: 'nowrap',
};

export function VaultCredsButtons(props: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button type="button" style={btnStyle} title="Подставить учётные данные из Vault"
              onClick={() => setPickerOpen(true)}>▣ Из Vault</button>
      <button type="button" style={btnStyle} title="Сохранить эти учётные данные в Vault"
              onClick={() => saveToVault(props)}>▣ В Vault</button>
      {pickerOpen && <VaultPicker {...props} onClose={() => setPickerOpen(false)} />}
    </span>
  );
}

// ---------------------------------------------------------------------------

async function ensureUnlocked(): Promise<boolean> {
  try {
    const st = await vaultStatus();
    if (!st.initialized) {
      await alertDialog('Vault не создан',
        'Хранилище ещё не инициализировано. Откройте Vault Studio (Ctrl+K) → Настройки безопасности и создайте его.');
      return false;
    }
    if (!st.unlocked) {
      await alertDialog('Vault заблокирован',
        'Откройте Vault Studio (Ctrl+K) и разблокируйте хранилище, затем повторите.');
      return false;
    }
    return true;
  } catch {
    return true; // браузерный fallback не всегда отвечает статусом — дадим шанс
  }
}

async function saveToVault(props: Props) {
  if (!(await ensureUnlocked())) return;
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
  const name = `${props.serviceLabel} · ${props.host || '(хост не указан)'}`;
  const res = await vaultUpsert({
    name,
    username,
    password: props.values['password'] ?? extraFields[props.fields[0]?.key] ?? '',
    fields: Object.keys(extraFields).length ? extraFields : undefined,
    tags: ['creds', props.purpose, props.serviceLabel.toLowerCase()],
    url: props.host || undefined,
    boundDeviceIds: props.deviceId ? [props.deviceId] : undefined,
    folder: props.folder,
  });
  if (res?.ok) {
    await alertDialog('Сохранено в Vault', `Запись «${name}» (назначение: ${props.purpose}).`);
  } else {
    await alertDialog('Не удалось сохранить', 'Хранилище отклонило запись (возможно, заблокировано).');
  }
}

// ---------------------------------------------------------------------------

function VaultPicker({ onClose, ...props }: Props & { onClose: () => void }) {
  const [items, setItems] = useState<VaultItemMeta[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!(await ensureUnlocked())) { onClose(); return; }
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
      setItems(relevant.length > 0 ? relevant : all);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = async (id: string) => {
    setBusyId(id);
    const r = await vaultGet(id).catch(() => null);
    setBusyId(null);
    if (!r || r.locked) {
      await alertDialog('Vault заблокирован', 'Разблокируйте хранилище (Ctrl+K) и повторите.');
      return;
    }
    if (!r.item) { await alertDialog('Ошибка', 'Запись не найдена.'); return; }
    const vals: Record<string, string> = {};
    for (const f of props.fields) {
      if (f.key === 'username') vals.username = r.item.username || '';
      else if (f.key === 'password') vals.password = r.item.password || '';
      else vals[f.key] = r.item.fields?.[f.key] ?? r.item.password ?? '';
    }
    props.onApply(vals);
    onClose();
  };

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9600,
      background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: 440, maxHeight: '70vh', display: 'flex', flexDirection: 'column',
        background: '#fff', borderRadius: 12, boxShadow: '0 24px 64px rgba(15,23,42,0.35)',
        overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E7EB',
                      fontSize: 13, fontWeight: 700, color: '#0F172A' }}>
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
              В Vault пока нет записей. Заполните поля вручную и нажмите «▣ В Vault».
            </div>
          )}
          {(items || []).map(it => (
            <div key={it.id}
                 onClick={() => busyId == null && pick(it.id)}
                 style={{
                   padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                   display: 'flex', alignItems: 'center', gap: 8,
                   opacity: busyId === it.id ? 0.5 : 1,
                   border: '1px solid transparent',
                 }}
                 onMouseOver={e => { (e.currentTarget as HTMLDivElement).style.background = '#F1F5F9'; }}
                 onMouseOut={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, background: '#EDE9FE',
                             color: '#5B21B6', display: 'flex', alignItems: 'center',
                             justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                ▣
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#0F172A',
                               overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.name}
                </span>
                <span style={{ display: 'block', fontSize: 10, color: '#64748B',
                               overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(it.tags || []).join(' · ')}{it.url ? ` · ${it.url}` : ''}
                </span>
              </span>
            </div>
          ))}
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid #E5E7EB', textAlign: 'right' }}>
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
