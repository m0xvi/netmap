/**
 * v0.90.0 — «SSH-ключ для этого ПК»: создание пары ключей прямо в NetMap.
 * v0.91.0 — выбор типа: RSA (по умолчанию, импортируется на любой RouterOS)
 *           или ed25519 (RouterOS 7.12+). Сохранённый путь уходит в окно
 *           автообнаружения событием `netmap:ssh-key-saved`.
 *
 * Открывается из меню «Инструменты» → «SSH-ключ для этого ПК…», из окна
 * автообнаружения (кнопка в блоке «Вход по SSH-ключу») и событием
 * `netmap:open-ssh-key`.
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

type KeyType = 'rsa' | 'ed25519';

interface KeyResult {
  privatePem: string;
  publicLine: string;
  fingerprint: string;
  type: KeyType;
  encrypted: boolean;
}

/** Событие для окна автообнаружения: путь к закрытому ключу сохранён. */
export const SSH_KEY_SAVED_EVENT = 'netmap:ssh-key-saved';

function keyBaseName(t: KeyType): string {
  return t === 'ed25519' ? 'netmap_ed25519' : 'netmap_rsa';
}

function SshKeyDialog({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState<KeyType>('rsa');
  // v0.92.0: 2048 — размер, с которым дружит собственный SSH-стек RouterOS.
  const [bits, setBits] = useState<2048 | 3072 | 4096>(2048);
  const [comment, setComment] = useState('netmap-pc');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState<'' | 'gen' | 'save-key' | 'save-pub' | 'vault'>('');
  const [key, setKey] = useState<KeyResult | null>(null);
  const [keyPath, setKeyPath] = useState('');
  const [pubPath, setPubPath] = useState('');
  const [msg, setMsg] = useState<{ kind: 'info' | 'ok' | 'err'; text: string } | null>(null);
  const native = hasNetTools();
  const base = keyBaseName(key ? key.type : type);

  const generate = async () => {
    if (pass && pass !== pass2) { setMsg({ kind: 'err', text: 'Пароли к ключу не совпадают.' }); return; }
    setBusy('gen');
    setMsg({ kind: 'info', text: type === 'rsa' ? `Создаю ключ RSA ${bits} — это может занять несколько секунд…` : 'Создаю ключ ed25519…' });
    const r = await sshKeyGenerate({ type, bits, comment: comment.trim() || 'netmap-pc', passphrase: pass });
    setBusy('');
    if (!r.ok || !r.privatePem) { setMsg({ kind: 'err', text: r.error || 'Ключ не создан.' }); return; }
    setKey({
      privatePem: r.privatePem,
      publicLine: r.publicLine || '',
      fingerprint: r.fingerprint || '',
      type,
      encrypted: !!r.encrypted,
    });
    setKeyPath(''); setPubPath('');
    setMsg({ kind: 'ok', text: 'Ключ создан. Теперь сохраните файлы: закрытый и открытый.' });
  };

  const saveKey = async () => {
    if (!key) return;
    setBusy('save-key');
    const r = await saveTextFile({
      defaultPath: `.ssh/${base}`,
      content: key.privatePem,
      title: 'Сохранить закрытый ключ',
      mode: '600',
    });
    setBusy('');
    if (r.ok && r.path) {
      setKeyPath(r.path);
      // Автообнаружение подставит путь в поле «Файл приватного ключа».
      window.dispatchEvent(new CustomEvent(SSH_KEY_SAVED_EVENT, { detail: { path: r.path, encrypted: key.encrypted } }));
      setMsg({ kind: 'ok', text: `Закрытый ключ сохранён: ${r.path}` });
    } else if (!r.canceled) setMsg({ kind: 'err', text: r.error || 'Не удалось сохранить файл.' });
  };

  const savePub = async () => {
    if (!key) return;
    setBusy('save-pub');
    const r = await saveTextFile({
      defaultPath: `.ssh/${base}.pub`,
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
    const suggested = `Ключ ПК · ${comment.trim() || 'netmap-pc'}`;
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
      chips={['RSA для MikroTik', 'ed25519', 'OpenSSH']} icon="lock" onClose={onClose} width={780} level="top" footer={footer}>
      <div style={{ padding: '14px 20px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={explainBox}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#0F172A' }}>Что такое ключ простыми словами</div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li><b>Ключ — это пара файлов.</b> Закрытый файл остаётся только на этом ПК. Открытый — короткая строка, её можно отдавать устройствам.</li>
            <li><b>Устройство пускает того, у кого есть закрытый ключ,</b> чей открытый ключ записан на нём. Пароль при входе не нужен.</li>
            <li><b>NetMap входит по SSH этим ключом:</b> путь к закрытому файлу или текст ключа в записи Vault.</li>
          </ul>
        </div>

        <DlgSection title="1. Создать ключ">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button disabled={!!key} onClick={() => setType('rsa')} style={{ ...segBtn, ...(type === 'rsa' ? segBtnOn : {}) }}>
              RSA (рекомендуется)
            </button>
            <button disabled={!!key} onClick={() => setType('ed25519')} style={{ ...segBtn, ...(type === 'ed25519' ? segBtnOn : {}) }}>
              ed25519
            </button>
          </div>
          <div style={hintTxt}>
            <b>RSA</b> импортируется на любой MikroTik (RouterOS 6 и 7). Для MikroTik оставляйте размер <b>2048</b>:
            с ключами 3072/4096 SSH-стек RouterOS у ряда версий не проверяет подпись при входе — ключ виден на устройстве, но не пускает.
            <b>ed25519</b> короче, но MikroTik принимает его только с RouterOS 7.12 и новее; на старой версии импорт выдаёт
            «unable to load key file (wrong format?)». Linux-серверы и Windows понимают оба типа и любой размер.
          </div>
          {type === 'rsa' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#334155' }}>Размер RSA:</span>
              {([2048, 3072, 4096] as const).map(b => (
                <button key={b} disabled={!!key} onClick={() => setBits(b)} style={{ ...segBtn, ...(bits === b ? segBtnOn : {}) }}>
                  {b}{b === 2048 ? ' — для MikroTik' : ''}
                </button>
              ))}
            </div>
          )}
          <div style={{ ...grid2, marginTop: 10 }}>
            <Field label="Комментарий (латиница, цифры, дефис)">
              <input value={comment} onChange={e => setComment(e.target.value)} maxLength={64} style={inp} disabled={!!key} />
            </Field>
            <div />
            <Field label="Пароль к ключу (необязательно, но рекомендуется)">
              <input type="password" value={pass} onChange={e => setPass(e.target.value)} style={inp} autoComplete="new-password" disabled={!!key} />
            </Field>
            <Field label="Повторите пароль">
              <input type="password" value={pass2} onChange={e => setPass2(e.target.value)} style={inp} autoComplete="new-password" disabled={!!key} />
            </Field>
          </div>
          <div style={hintTxt}>
            Пароль защищает закрытый файл, если его украдут. Длина — любая, ограничений нет; пустое поле — ключ без пароля.
            С паролем нужна утилита ssh-keygen (в Windows: «Клиент OpenSSH» в дополнительных компонентах; обычно уже установлена).
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <DlgBtn kind="primary" disabled={!native || busy !== ''} onClick={generate}>
              {busy === 'gen' ? 'Создаю…' : key ? 'Создать другой ключ' : 'Создать ключ'}
            </DlgBtn>
            {key && (
              <DlgBtn kind="ghost" disabled={busy !== ''} onClick={() => { setKey(null); setKeyPath(''); setPubPath(''); setMsg(null); }}>
                Сбросить
              </DlgBtn>
            )}
          </div>
        </DlgSection>

        {key && (
          <DlgSection title="2. Сохранить файлы" hint={`Отпечаток: ${key.fingerprint}`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <DlgBtn kind="ghost" disabled={!!busy} onClick={saveKey}>
                {keyPath ? 'Закрытый ключ сохранён' : `Сохранить закрытый ключ (${base})…`}
              </DlgBtn>
              <DlgBtn kind="ghost" disabled={!!busy} onClick={savePub}>
                {pubPath ? 'Открытый ключ сохранён' : `Сохранить открытый ключ (${base}.pub)…`}
              </DlgBtn>
              <DlgBtn kind="ghost" disabled={!!busy} onClick={copyPub}>Скопировать открытый ключ</DlgBtn>
              <DlgBtn kind="primary" disabled={!!busy || !hasNativeVault} onClick={saveToVault}>
                {busy === 'vault' ? 'Сохраняю…' : 'Сохранить в Vault…'}
              </DlgBtn>
            </div>
            <div style={hintTxt}>
              Папка по умолчанию — <code>.ssh</code> в вашей домашней папке. Закрытый файл — секрет: не отправляйте его по почте и в мессенджеры.
              Сохранённый путь сам подставится в окно автообнаружения.
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: '#334155', marginBottom: 4 }}>Открытый ключ (одна строка, по ней можно сверить файл .pub):</div>
              <textarea readOnly value={key.publicLine} rows={3}
                onFocus={e => e.currentTarget.select()}
                style={{ ...inp, fontFamily: 'Consolas, monospace', fontSize: 11, resize: 'vertical' }} />
            </div>
          </DlgSection>
        )}

        {msg && <div style={msg.kind === 'err' ? errBox : msg.kind === 'ok' ? okBox : infoBox}>{msg.text}</div>}

        <DlgSection title="3. Как пустить ключ на устройство">
          <Step n={1} title="MikroTik (RouterOS) — через WinBox">
            <ol style={olStyle}>
              <li>Сохраните открытый ключ в файл (кнопка «Сохранить открытый ключ» выше).</li>
              <li>В WinBox откройте <b>Files</b> и перетащите туда файл <code>{base}.pub</code>.</li>
              <li>Откройте <b>System → Users</b>, вкладку <b>SSH Keys</b>, нажмите <b>Import SSH Key</b>.</li>
              <li>Выберите <b>User</b> (тот, под которым NetMap заходит по SSH, обычно admin) и <b>Key File</b> — ваш <code>{base}.pub</code>. Нажмите <b>Import SSH Key</b>.</li>
            </ol>
            <div style={hintTxt}>То же одной строкой в терминале (WinBox → New Terminal), заменив admin на нужного пользователя:</div>
            <code style={codeBlock}>/user ssh-keys import public-key-file={base}.pub user=admin</code>
            <div style={hintTxt}>
              Если снова «unable to load key file (wrong format?)»: проверьте, что создан ключ <b>RSA</b>, а не ed25519 (ed25519 нужен RouterOS 7.12+),
              и что в файле одна строка, начинающаяся с <code>ssh-rsa</code>.
            </div>
          </Step>
          <Step n={2} title="Linux-сервер">
            <code style={codeBlock}>ssh-copy-id -i ~/.ssh/{base}.pub пользователь@адрес</code>
            <div style={hintTxt}>Если ssh-copy-id нет: добавьте строку открытого ключа в файл <code>~/.ssh/authorized_keys</code> на сервере.</div>
          </Step>
          <Step n={3} title="Проверка из терминала Windows">
            <code style={codeBlock}>ssh -i %USERPROFILE%\.ssh\{base} пользователь@адрес</code>
            <div style={hintTxt}>Если вход прошёл без запроса пароля от учётки — ключ работает.</div>
          </Step>
          <Step n={4} title="Что дальше в NetMap">
            <div style={hintTxt}>
              Автообнаружение: поле «Файл приватного ключа» уже заполнено. Если задавали пароль, введите его в поле «Passphrase».
              Для постоянного хранения сохраните ключ в Vault — тогда путь и пароль подставляются из записи.
            </div>
          </Step>
        </DlgSection>

        <div style={hintTxt}>
          Ключ не даёт доступ сам по себе: без записи открытого ключа на устройстве вход не сработает.
          Отменить доступ — удалить ключ в System → Users → SSH Keys (или <code>/user ssh-keys remove</code>).
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
const segBtn: CSSProperties = {
  padding: '6px 12px', borderRadius: 7, border: '1px solid #CBD5E1', background: '#F8FAFC',
  color: '#475569', fontSize: 12, cursor: 'pointer',
};
const segBtnOn: CSSProperties = { background: '#EFF6FF', borderColor: '#93C5FD', color: '#1D4ED8', fontWeight: 700 };
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
const base0: CSSProperties = { fontSize: 12, borderRadius: 8, padding: '8px 10px', lineHeight: 1.45 };
const infoBox: CSSProperties = { ...base0, background: '#EFF6FF', color: '#1E3A8A', border: '1px solid #BFDBFE' };
const okBox: CSSProperties = { ...base0, background: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' };
const errBox: CSSProperties = { ...base0, background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' };
