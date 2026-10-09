/**
 * v0.51.21 — интеграция Vault в формы учётных данных.
 * v0.51.22 — SVG-иконки вместо «▣» (символ рендерился квадратом на части
 *            систем) и инлайн-окно разблокировки хранилища прямо из диалога:
 *            нажатие «Из Vault»/«В Vault» на заблокированном хранилище сразу
 *            спрашивает мастер-пароль и продолжает действие, без похода в
 *            другое место.
 * v0.76.8 — сохранение: та же запись (хост+логин+порт) обновляется, а не
 *            дублируется; обновление не затирает заметки/TOTP/историю; папка
 *            пишется по id (как в дереве Vault); пикер показывает логин, порт,
 *            ключ, дату и какие поля формы заполнятся; дубли помечены.
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
  vaultFoldersAll, vaultFolderUpsert,
  type VaultItemMeta, type VaultItemFull, type VaultFolder,
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

// ---------------------------------------------------------------------------
// v0.76.8: разбор записи — одна функция и для подстановки в форму, и для
// подписи «что заполнится» в пикере, чтобы показанное совпадало с реальной
// подстановкой.

const SSH_TOP = ['sshKey', 'sshKeyPath', 'sshPassphrase'];
const SECRET_KEY_RE = /pass|secret|community|token|key/i;

function valueFromItem(item: VaultItemFull, key: string): string {
  const f = item.fields || {};
  switch (key) {
    case 'username': return item.username || '';
    case 'password': return item.password || '';
    case 'sshKey': return item.sshKey || f['sshKey'] || '';
    case 'sshKeyPath': return item.sshKeyPath || f['sshKeyPath'] || '';
    case 'sshPassphrase': return item.sshPassphrase || f['sshPassphrase'] || '';
    default: {
      if (f[key]) return f[key];
      // community в записях, заведённых вручную через Vault Studio, часто лежит в поле пароля.
      if (key === 'community' && item.password) return item.password;
      return '';
    }
  }
}

/** Что форма отдаёт в запись: пароль (или community), поля, SSH-ключ. */
function incomingPassword(props: Props): string {
  const v = props.values;
  if (v['password'] !== undefined) return v['password'] || '';
  const first = props.fields.find(f => f.key !== 'username' && v[f.key]);
  return first ? v[first.key] : '';
}

function makeIncoming(props: Props) {
  const v = props.values;
  const fields: Record<string, string> = {};
  for (const f of props.fields) {
    if (f.key === 'username' || f.key === 'password' || SSH_TOP.includes(f.key)) continue;
    if (v[f.key]) fields[f.key] = v[f.key];
  }
  return {
    username: v['username'] || '',
    password: incomingPassword(props),
    sshKey: v['sshKey'] || '',
    sshKeyPath: v['sshKeyPath'] || '',
    sshPassphrase: v['sshPassphrase'] || '',
    fields,
  };
}

const portOf = (it: { fields?: Record<string, string> }) => it.fields?.['port'] || '';

/** Одна и та же запись: тот же хост, логин и порт (порт не сравнивается, если в одной из записей не задан). */
function sameRecord(a: VaultItemFull, b: VaultItemFull): boolean {
  const ua = (a.url || '').toLowerCase();
  if (!ua || ua !== (b.url || '').toLowerCase()) return false;
  if ((a.username || '') !== (b.username || '')) return false;
  const pa = portOf(a), pb = portOf(b);
  return !pa || !pb || pa === pb;
}

async function resolveFolderId(name: string | undefined): Promise<string | null> {
  if (!name) return null;
  // Дерево Vault хранит папку по id. Раньше сюда писалось имя («SNMP»), и запись
  // не попадала ни в одну папку дерева.
  const list = await vaultFoldersAll().catch(() => [] as VaultFolder[]);
  const hit = list.find(f => (f.name || '').toLowerCase() === name.toLowerCase());
  if (hit) return hit.id;
  const r = await vaultFolderUpsert({ name, parent: null }).catch(() => null);
  return r?.ok && r.id ? r.id : null;
}

async function findSameRecord(props: Props, incoming: VaultItemFull): Promise<VaultItemFull | null> {
  if (!incoming.url) return null;
  const metas = await vaultList().catch(() => [] as VaultItemMeta[]);
  for (const m of metas) {
    if (!(m.tags || []).includes(props.purpose)) continue;
    if ((m.url || '').toLowerCase() !== (incoming.url || '').toLowerCase()) continue;
    const full = await vaultGet(m.id).catch(() => null);
    const it = full?.item;
    if (it && sameRecord(it, incoming)) return it;
  }
  return null;
}

/** Что изменится в существующей записи. Пустые поля формы ничего не перетирают. */
function describeChanges(existing: VaultItemFull, props: Props): string[] {
  const out: string[] = [];
  for (const f of props.fields) {
    const next = props.values[f.key] || '';
    if (!next.trim()) continue;
    const old = valueFromItem(existing, f.key);
    if (next === old) continue;
    if (SECRET_KEY_RE.test(f.key)) out.push(`${f.label}: будет заменён`);
    else out.push(`${f.label}: ${old || '—'} → ${next}`);
  }
  return out;
}

/** Обновление: берём существующую запись целиком и накладываем только непустые поля формы. */
function mergeIntoExisting(existing: VaultItemFull, props: Props, folderId: string | null, tags: string[]): VaultItemFull {
  const inc = makeIncoming(props);
  const keep = (next: string, old: string | undefined) => (next && next.trim() !== '' ? next : (old || ''));
  const fields: Record<string, string> = { ...(existing.fields || {}) };
  for (const [k, val] of Object.entries(inc.fields)) fields[k] = val;
  const deviceIds = props.deviceId ? [props.deviceId] : [];
  return {
    ...existing,
    id: existing.id,
    name: existing.name,
    folder: folderId || existing.folder || null,
    url: existing.url || props.host || null,
    username: keep(inc.username, existing.username),
    password: keep(inc.password, existing.password),
    // Поля, которых нет в форме, сохраняются как были (заметки, TOTP, история паролей).
    notes: existing.notes || '',
    totpSecret: existing.totpSecret || '',
    history: existing.history || [],
    tags: Array.from(new Set([...(existing.tags || []), ...tags])),
    boundDeviceIds: Array.from(new Set([...(existing.boundDeviceIds || []), ...deviceIds])),
    fields: Object.keys(fields).length ? fields : undefined,
    sshKey: keep(inc.sshKey, existing.sshKey) || undefined,
    sshKeyPath: keep(inc.sshKeyPath, existing.sshKeyPath) || undefined,
    sshPassphrase: keep(inc.sshPassphrase, existing.sshPassphrase) || undefined,
  } as VaultItemFull;
}

function fmtTime(ms: number | null | undefined): string {
  if (!ms) return '—';
  try { return new Date(ms).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return '—'; }
}

/** Краткое содержимое записи для строки пикера (без секретов). */
function detailsOf(it: VaultItemFull): string[] {
  const f = it.fields || {};
  const parts: string[] = [];
  parts.push(it.username ? `логин ${it.username}` : 'без логина');
  const port = f['port'];
  if (port) parts.push(`порт ${port}`);
  const pem = it.sshKey || f['sshKey'];
  const path = it.sshKeyPath || f['sshKeyPath'];
  if (pem) parts.push('ключ: текст PEM');
  else if (path) parts.push(`ключ: файл ${path}`);
  if (it.sshPassphrase || f['sshPassphrase']) parts.push('passphrase: есть');
  if (it.notes) parts.push('заметки: есть');
  parts.push(`обновлено ${fmtTime(it.updated)}`);
  return parts;
}

async function saveToVault(props: Props) {
  const filled = props.fields.filter(f => (props.values[f.key] || '').trim() !== '');
  if (filled.length === 0) {
    await alertDialog('Нечего сохранять', 'Заполните поля учётных данных перед сохранением в Vault.');
    return;
  }
  const host = props.host || '';
  const portVal = (props.values['port'] || '').trim();
  const tags = ['creds', props.purpose, props.serviceLabel.toLowerCase()];
  const inc = makeIncoming(props);
  const probe = {
    id: '', name: '', url: host || null, username: inc.username,
    fields: portVal ? { port: portVal } : {},
  } as VaultItemFull;

  const folderId = await resolveFolderId(props.folder);
  const existing = await findSameRecord(props, probe);

  if (existing) {
    // v0.76.8: та же запись уже есть — обновляем её, а не плодим дубль.
    const changes = describeChanges(existing, props);
    if (changes.length === 0) {
      await alertDialog('Уже в Vault',
        `Такая запись уже есть: «${existing.name}». Новых данных нет, ничего не изменено.`);
      return;
    }
    const ok = await confirmDialog('Обновить запись в Vault?',
      `Найдена запись «${existing.name}». Изменится: ${changes.join('; ')}. Если пароль меняется, прежний уйдёт в историю записи.`,
      { okText: 'Обновить', cancelText: 'Отмена' });
    if (!ok) return;
    const res = await vaultUpsert(mergeIntoExisting(existing, props, folderId, tags));
    if (res?.ok) {
      await alertDialog('Запись обновлена', `«${existing.name}»: ${changes.join('; ')}.`);
    } else {
      await alertDialog('Не удалось сохранить', 'Хранилище отклонило запись (возможно, заблокировалось во время ввода).');
    }
    return;
  }

  // v0.55.0: порт — в имя записи. v0.76.8: логин тоже, чтобы записи с разными логинами различались.
  const hostPart = host || '(хост не указан)';
  const portPart = host && portVal ? `:${portVal}` : '';
  const userPart = inc.username ? ` · ${inc.username}` : '';
  const name = `${props.serviceLabel} · ${hostPart}${portPart}${userPart}`;
  const res = await vaultUpsert({
    name,
    folder: folderId,
    url: host || undefined,
    username: inc.username,
    password: inc.password,
    sshKey: inc.sshKey || undefined,
    sshKeyPath: inc.sshKeyPath || undefined,
    sshPassphrase: inc.sshPassphrase || undefined,
    fields: Object.keys(inc.fields).length ? inc.fields : undefined,
    tags,
    boundDeviceIds: props.deviceId ? [props.deviceId] : undefined,
  });
  if (res?.ok) {
    const saved = filled.map(f => f.label).join(', ');
    await alertDialog('Сохранено в Vault', `Создана запись «${name}» (назначение: ${props.purpose}). В записи: ${saved}.`);
  } else {
    await alertDialog('Не удалось сохранить', 'Хранилище отклонило запись (возможно, заблокировалось во время ввода).');
  }
}

// ---------------------------------------------------------------------------

function VaultPicker({ onClose, ...props }: Props & { onClose: () => void }) {
  const [metas, setMetas] = useState<VaultItemMeta[] | null>(null);
  // Расшифрованные записи (null — не удалось прочитать). Секреты в состоянии не
  // выводятся: строки показывают только логин, порт, наличие ключа и поля формы.
  const [full, setFull] = useState<Record<string, VaultItemFull | null>>({});
  const [showAll, setShowAll] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const requested = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const hostLc = (props.host || '').toLowerCase();
  const folderLc = (props.folder || '').toLowerCase();
  const svcTag = props.serviceLabel.toLowerCase();
  const isRelevant = (m: VaultItemMeta) =>
    (m.tags || []).includes(props.purpose)
    || (!!folderLc && (m.folder || '').toLowerCase() === folderLc)
    || (m.tags || []).includes(svcTag);

  useEffect(() => {
    (async () => {
      const all = await vaultList().catch(() => [] as VaultItemMeta[]);
      if (mounted.current) setMetas(all);
    })();
  }, []);

  const all = metas || [];
  // Сначала записи этого назначения; у совпавшего по хосту — выше.
  const rel = all.filter(isRelevant).sort((a, b) => {
    const ha = hostLc && (a.url || '').toLowerCase() === hostLc ? 0 : 1;
    const hb = hostLc && (b.url || '').toLowerCase() === hostLc ? 0 : 1;
    return ha - hb || a.name.localeCompare(b.name);
  });
  const relIds = new Set(rel.map(m => m.id));
  const others = all.filter(m => !relIds.has(m.id));
  const shown = showAll ? [...rel, ...others] : rel;

  useEffect(() => {
    const todo = shown.filter(m => !requested.current.has(m.id));
    todo.forEach(m => requested.current.add(m.id));
    (async () => {
      for (const m of todo) {
        const r = await vaultGet(m.id).catch(() => null);
        if (!mounted.current) return;
        setFull(prev => ({ ...prev, [m.id]: r?.item ?? null }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metas, showAll]);

  // Дубли: та же запись (хост, логин, порт) уже встречалась выше в списке.
  const dupIds = new Set<string>();
  const kept: VaultItemFull[] = [];
  for (const m of rel) {
    const it = full[m.id];
    if (!it) continue;
    if (kept.some(k => sameRecord(k, it))) dupIds.add(m.id);
    else kept.push(it);
  }

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
      const v = valueFromItem(r.item, f.key);
      // Логин и пароль переписываются всегда (как и раньше), остальное — только если заполнено.
      if (f.key === 'username' || f.key === 'password' || v !== '') vals[f.key] = v;
    }
    props.onApply(vals);
    onClose();
  };

  const removeItem = async (id: string, name: string) => {
    if (!await confirmDialog('Удалить запись Vault?',
        `«${name}» будет удалена безвозвратно.`, { danger: true, okText: 'Удалить' })) return;
    const r = await vaultDelete(id).catch(() => null);
    if (r?.ok) {
      setMetas(prev => (prev || []).filter(x => x.id !== id));
      setFull(prev => { const n = { ...prev }; delete n[id]; return n; });
    } else {
      await alertDialog('Не удалось удалить', 'Хранилище отклонило удаление (возможно, заблокировалось).');
    }
  };

  const renderRow = (m: VaultItemMeta, isRel: boolean) => {
    const it = full[m.id];
    const isDup = dupIds.has(m.id);
    const purposeTags = (m.tags || []).filter(t => t !== 'creds');
    const details = it === undefined ? 'читаю запись…'
      : it === null ? 'не удалось прочитать запись'
      : detailsOf(it).join(' · ');
    return (
      <div key={m.id}
           onClick={() => busyId == null && pick(m.id)}
           style={{
             padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
             display: 'flex', alignItems: 'flex-start', gap: 8,
             opacity: busyId === m.id ? 0.5 : 1,
           }}
           onMouseOver={e => { (e.currentTarget as HTMLDivElement).style.background = '#F1F5F9'; }}
           onMouseOut={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, background: '#EDE9FE',
                       color: '#5B21B6', display: 'flex', alignItems: 'center',
                       justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
          <IconVault size={12} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#0F172A',
                           overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.name}
            </span>
            {isDup && (
              <span title="Такая же запись (хост, логин, порт) уже есть выше — её можно удалить"
                    style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                             background: '#FEF3C7', color: '#92400E', flexShrink: 0 }}>дубль</span>
            )}
            {!isRel && (
              <span title="Назначение записи отличается от текущей формы"
                    style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
                             background: '#F1F5F9', color: '#475569', flexShrink: 0 }}>
                назначение: {purposeTags.join(', ') || '—'}
              </span>
            )}
          </span>
          <span style={{ display: 'block', fontSize: 10, color: '#475569', marginTop: 2,
                         overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {m.url ? `${m.url} · ` : ''}{details}
          </span>
          {it && (
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {props.fields.map(f => {
                const ok = valueFromItem(it, f.key) !== '';
                return (
                  <span key={f.key}
                        title={ok ? 'Поле заполнится из записи' : 'В записи этого поля нет — в форме останется как было'}
                        style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 999,
                                 background: ok ? '#DCFCE7' : '#F1F5F9',
                                 color: ok ? '#166534' : '#94A3B8' }}>
                    {f.label}: {ok ? 'заполнится' : 'нет в записи'}
                  </span>
                );
              })}
            </span>
          )}
        </span>
        <button type="button" title="Удалить запись из Vault"
                onClick={e => { e.stopPropagation(); void removeItem(m.id, m.name); }}
                style={trashBtnStyle}
                onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.color = '#DC2626'; (e.currentTarget as HTMLButtonElement).style.background = '#FEF2F2'; }}
                onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.color = '#CBD5E1'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
          <IconTrash />
        </button>
      </div>
    );
  };

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9600,
      background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: 560, maxHeight: '75vh', display: 'flex', flexDirection: 'column',
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
        <div style={{ padding: '6px 16px', fontSize: 11, color: '#64748B', borderBottom: '1px solid #F1F5F9' }}>
          Под каждой записью видно, какие поля формы она заполнит. «нет в записи» — поле останется как было.
        </div>
        <div style={{ overflowY: 'auto', padding: 8 }}>
          {metas === null && (
            <div style={{ padding: 16, fontSize: 12, color: '#64748B', textAlign: 'center' }}>
              Читаю хранилище…
            </div>
          )}
          {metas !== null && rel.length === 0 && !showAll && (
            <div style={{ padding: 16, fontSize: 12, color: '#64748B', textAlign: 'center' }}>
              Записей с назначением «{props.purpose}» пока нет. Заполните поля и нажмите «В Vault», чтобы сохранить.
            </div>
          )}
          {metas !== null && showAll && others.length === 0 && rel.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: '#64748B', textAlign: 'center' }}>
              В Vault пока нет записей.
            </div>
          )}
          {shown.map(m => renderRow(m, relIds.has(m.id)))}
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid #E5E7EB',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {others.length > 0 && (
              <button type="button" style={studioLinkStyle} onClick={() => setShowAll(v => !v)}>
                {showAll ? 'Скрыть записи других назначений' : `Показать остальные записи (${others.length})`}
              </button>
            )}
            <button type="button" style={studioLinkStyle}
                    onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('netmap:open-vault-studio')); }}>
              Открыть Vault Studio — изменить записи…
            </button>
          </span>
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
