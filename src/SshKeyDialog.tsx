/**
 * v0.90.0 — «SSH-ключ для этого ПК»: создание пары ключей прямо в NetMap.
 *
 * Открывается из меню «Инструменты» → «SSH-ключ для этого ПК…»
 * (событие `netmap:open-ssh-key`). Пишет ключ-файлы через диалог «Сохранить как»
 * и, по желанию, сохраняет ключ в Vault (поле SSH-ключ + путь + пароль к ключу).
 *
 * Закрытый ключ — секрет. Окно не отправляет его никуда, кроме выбранного файла
 * и Vault. Публичный ключ можно передавать устройствам.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { DialogShell, DlgBtn, DlgSection } from './DialogTheme';
import { hasNetTools, saveTextFile, sshKeyGenerate } from './netToolsClient';
import { hasNativeVault, vaultUpsert } from './vaultClient';
import { alertDialog, promptText } from './Modal';

export function SshKeyHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('netmap:open-ssh-key', onOpen);
    return () => window.removeEventListener('netmap:open-ssh-key', onOpen);
  }, []);
  if (!open) return null;
  return <SshKeyDialog onClose={() => setOpen(false)} />;
}

interface KeyResult {
  privatePem: string;
  publicLine: string;
  fingerprint: string;
  encrypted: boolean;
}

const KEY_NAME = 'netmap_ed25519';

function SshKeyDialog({ onClose }: { onClose: () => void }) {
  const [comment, setComment] = useState('netmap-пк');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState<'' | 'gen' | 'save-key' | 'save-pub' | 'vault'>('');
  const [key, setKey] = useState<KeyResult | null>(null);
  const [keyPath, setKeyPath] = useState('');
  const [pubPath, setPubPath] = useState('');
  const [msg, setMsg] = useState<{ kind: 'info' | 'ok' | 'err'; text: string } | null>(null);
  const native = hasNetTools();

  const generate = async () => {
    if (pass && pass !== pass2) { setMsg({ kind: 'err', text: 'Пароли к ключу не совпадают.' }); return; }
    setBusy('gen'); setMsg({ kind: 'info', text: 'Создаю ключ…' });
    const r = await sshKeyGenerate({ comment: comment.trim() || 'netmap', passphrase: pass });
    setBusy('');
    if (!r.ok || !r.privatePem) { setMsg({ kind: 'err', text: r.error || 'Ключ не создан.' }); return; }
    setKey({ privatePem: r.privatePem, publicLine: r.publicLine || '', fingerprint: r.fingerprint || '', encrypted: !!r.encrypted });
    setKeyPath(''); setPubPath('');
    setMsg({ kind: 'ok', text: 'Ключ создан. Теперь сохраните файлы — закрытый и открытый.' });
  };

  const saveKey = async () => {
    if (!key) return;
    setBusy('save-key');
    const r = await saveTextFile({
      defaultPath: `.ssh/${KEY_NAME}`,
      content: key.privatePem,
      title: 'Сохранить закрытый ключ',
      mode: '600',
    });
    setBusy('');
    if (r.ok && r.path) { setKeyPath(r.path); setMsg({ kind: 'ok', text: `Закрытый ключ сохранён: ${r.path}` }); }
    else if (!r.canceled) setMsg({ kind: 'err', text: r.error || 'Не удалось сохранить файл.' });
  };

  const savePub = async () => {
    if (!key) return;
    setBusy('save-pub');
    const r = await saveTextFile({
      defaultPath: `.ssh/${KEY_NAME}.pub`,
      content: key.publicLine,
      title: 'Сохранить открытый ключ',
      filters: [{ name: 'Открытый ключ', extensions: ['pub'] }],
    });
    setBusy('');
    if (r.ok && r.path) { setPubPath(r.path); setMsg({ kind: 'ok', text: `Открытый ключ сохранён: ${r.path}` }); }
    else if (!r.canceled) setMsg({ kind: 'err', text: r.error || 'Не удалось сохранить файл.' });
  };

  const copyPub = async () => {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key.publicLine);
      setMsg({ kind: 'ok', text: 'Открытый ключ скопирован в буфер обмена.' });
    } catch {
      setMsg({ kind: 'err', text: 'Не удалось скопировать. Выделите строку в поле и нажмите Ctrl+C.' });
    }
  };

  const saveToVault = async () => {
    if (!key) return;
    if (!hasNativeVault) { setMsg({ kind: 'err', text: 'Vault доступен только в приложении NetMap.' }); return; }
    const suggested = `Ключ ПК · ${comment.trim() || 'netmap'}`;
    const name = await promptText('Название записи в Vault', suggested,
      'Например «Ключ ПК — администратор». По этому названию запись будет видна в списке выбора.');
    if (name === null) return;
    const clean = name.trim();
    if (!clean) { await alertDialog('Нужно название', 'Без названия запись не сохраняется.'); return; }
    setBusy('vault');
    const res = await vaultUpsert({
      name: clean.slice(0, 120),
      sshKey: key.privatePem,
      sshKeyPath: keyPath || undefined,
      sshPassphrase: key.encrypted ? pass : undefined,
      notes: `Открытый ключ (вставьте на устройство):\n${key.publicLine}`,
      tags: ['ssh-key', 'pc'],
    });
    setBusy('');
    if (res?.ok) {
      setMsg({ kind: 'ok', text: `Запись «${clean}» сохранена в Vault.` });
    } else if (res?.locked) {
      await alertDialog('Vault закрыт', 'Откройте Vault Studio (Ctrl+K), разблокируйте хранилище и повторите сохранение.');
    } else {
      setMsg({ kind: 'err', text: 'Хранилище отклонило запись. Проверьте, что Vault открыт.' });
    }
  };

  const footer = (
    <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'flex-end' }}>
      <DlgBtn kind="ghost" onClick={onClose}>Закрыть</DlgBtn>
    </div>
  );

  return (
    <DialogShell title="SSH-ключ для этого ПК" subtitle="Пара ключей: закрытый остаётся у вас, открытый — на устройстве"
      chips={['ed25519', 'OpenSSH']} icon="lock" onClose={onClose} width={760} footer={footer}>
      <div style={{ padding: '14px 20px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={explainBox}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#0F172A' }}>Что такое ключ простыми словами</div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li><b>Ключ — это пара файлов.</b> Закрытый файл остаётся только на этом ПК. Открытый — короткая строка, её можно отдавать устройствам.</li>
            <li><b>Устройство пускает того, у кого есть закрытый ключ,</b> чей открытый ключ записан на нём. Пароль при входе не нужен.</li>
            <li><b>NetMap входит по SSH этим ключом:</b> путь к закрытому файлу или текст ключа — в записи Vault.</li>
          </ul>
        </div>

        <DlgSection title="1. Создать ключ">
          <div style={grid2}>
            <Field label="Комментарий (для кого ключ)">
              <input value={comment} onChange={e => setComment(e.target.value)} maxLength={64} style={inp} />
            </Field>
            <div />
            <Field label="Пароль к ключу (необязательно, но рекомендуется)">
              <input type="password" value={pass} onChange={e => setPass(e.target.value)} style={inp} autoComplete="new-password" />
            </Field>
            <Field label="Повторите пароль">
              <input type="password" value={pass2} onChange={e => setPass2(e.target.value)} style={inp} autoComplete="new-password" />
            </Field>
          </div>
          <div style={hintTxt}>
            Пароль защищает закрытый файл, если его украдут. Если пароль задан, нужна утилита ssh-keygen
            (в Windows: «Клиент OpenSSH» в дополнительных компонентах; обычно уже установлена).
          </div>
          <div style={{ marginTop: 10 }}>
            <DlgBtn kind="primary" disabled={!native || busy !== ''} onClick={generate}>
              {busy === 'gen' ? 'Создаю…' : key ? 'Создать заново' : 'Создать ключ'}
            </DlgBtn>
          </div>
        </DlgSection>

        {key && (
          <DlgSection title="2. Сохранить файлы" hint={`Отпечаток: ${key.fingerprint}`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <DlgBtn kind="ghost" disabled={!!busy} onClick={saveKey}>
                {keyPath ? 'Закрытый ключ сохранён' : 'Сохранить закрытый ключ…'}
              </DlgBtn>
              <DlgBtn kind="ghost" disabled={!!busy} onClick={savePub}>
                {pubPath ? 'Открытый ключ сохранён' : 'Сохранить открытый ключ (.pub)…'}
              </DlgBtn>
              <DlgBtn kind="ghost" disabled={!!busy} onClick={copyPub}>Скопировать открытый ключ</DlgBtn>
              <DlgBtn kind="primary" disabled={!!busy || !hasNativeVault} onClick={saveToVault}>
                {busy === 'vault' ? 'Сохраняю…' : 'Сохранить в Vault…'}
              </DlgBtn>
            </div>
            <div style={hintTxt}>
              Обычная папка для ключей: <code>.ssh</code> в вашей домашней папке. Закрытый файл — секрет: не отправляйте его по почте и в мессенджеры.
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: '#334155', marginBottom: 4 }}>Открытый ключ (одна строка):</div>
              <textarea readOnly value={key.publicLine} rows={2}
                onFocus={e => e.currentTarget.select()}
                style={{ ...inp, fontFamily: 'Consolas, monospace', fontSize: 11, resize: 'vertical' }} />
            </div>
          </DlgSection>
        )}

        {msg && <div style={msg.kind === 'err' ? errBox : msg.kind === 'ok' ? okBox : infoBox}>{msg.text}</div>}

        <DlgSection title="3. Как пустить ключ на устройство">
          <Step n={1} title="MikroTik (RouterOS)">
            <ol style={olStyle}>
              <li>Сохраните открытый ключ в файл (кнопка «Сохранить открытый ключ» выше).</li>
              <li>В WinBox откройте <b>Files</b> и перетащите туда файл <code>{KEY_NAME}.pub</code>.</li>
              <li>Откройте терминал: <b>WinBox → New Terminal</b>. Выполните строку, заменив <code>admin</code> на пользователя, под которым NetMap заходит по SSH:<br />
                <code style={codeBlock}>/user ssh-keys import public-key-file={KEY_NAME}.pub user=admin</code></li>
              <li>Закрытый ключ укажите в NetMap: запись Vault (кнопка «Сохранить в Vault») или путь к файлу.</li>
            </ol>
          </Step>
          <Step n={2} title="Linux-сервер">
            <code style={codeBlock}>ssh-copy-id -i ~/.ssh/{KEY_NAME}.pub пользователь@адрес</code>
            <div style={hintTxt}>Если ssh-copy-id нет: добавьте строку открытого ключа в файл <code>~/.ssh/authorized_keys</code> на сервере.</div>
          </Step>
          <Step n={3} title="Проверка из терминала Windows">
            <code style={codeBlock}>ssh -i %USERPROFILE%\.ssh\{KEY_NAME} пользователь@адрес</code>
            <div style={hintTxt}>Если вход прошёл без запроса пароля от учётки — ключ работает.</div>
          </Step>
        </DlgSection>

        <div style={hintTxt}>
          Ключ не создаёт доступ сам по себе: без записи открытого ключа на устройстве вход не сработает.
          Отменить доступ — удалить строку ключа на устройстве (MikroTik: <code>/user ssh-keys remove</code>).
        </div>
      </div>
    </DialogShell>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#334155', minWidth: 0 }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>{n}. {title}</div>
      {children}
    </div>
  );
}

const inp: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '7px 9px', border: '1px solid #CBD5E1',
  borderRadius: 7, fontSize: 12, color: '#0F172A', background: '#fff',
};
const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 };
const explainBox: CSSProperties = {
  fontSize: 12, lineHeight: 1.5, color: '#334155', background: '#F8FAFC', border: '1px solid #E2E8F0',
  borderRadius: 8, padding: '10px 12px',
};
const hintTxt: CSSProperties = { fontSize: 11, color: '#64748B', marginTop: 6, lineHeight: 1.45 };
const olStyle: CSSProperties = { margin: 0, paddingLeft: 18, fontSize: 12, color: '#334155', lineHeight: 1.6 };
const codeBlock: CSSProperties = {
  display: 'block', fontFamily: 'Consolas, monospace', fontSize: 11, background: '#0F172A', color: '#E2E8F0',
  padding: '6px 8px', borderRadius: 6, marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
};
const base: CSSProperties = { fontSize: 12, borderRadius: 8, padding: '8px 10px', lineHeight: 1.45 };
const infoBox: CSSProperties = { ...base, background: '#EFF6FF', color: '#1E3A8A', border: '1px solid #BFDBFE' };
const okBox: CSSProperties = { ...base, background: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' };
const errBox: CSSProperties = { ...base, background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' };
