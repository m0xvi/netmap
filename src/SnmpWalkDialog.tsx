/**
 * v0.90.0 — «SNMP walk»: отдельная сетевая утилита.
 *
 * Открывается из меню «Инструменты» → «SNMP walk…» и из окна автообнаружения
 * (событие `netmap:open-snmp-walk` с деталями { host? }).
 *
 * Зачем: проверить, отвечает ли устройство по SNMP, какой версии и с каким
 * шифрованием (v1, v2c, v3 MD5/SHA/SHA-2 и DES/AES). Дальше — walk нужной ветки.
 * Окно ничего не пишет в документ. Community и ключи SNMPv3 живут только в окне.
 */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { DialogShell, DlgBtn, DlgSection } from './DialogTheme';
import {
  hasNetTools, snmpProbe, snmpDetectV3, snmpWalk, saveTextFile,
  type SnmpCfg, type SnmpVersion, type SnmpWalkResult,
} from './netToolsClient';

export function SnmpWalkHost() {
  const [req, setReq] = useState<{ host?: string } | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => setReq((e as CustomEvent<{ host?: string }>).detail || {});
    window.addEventListener('netmap:open-snmp-walk', onOpen as EventListener);
    return () => window.removeEventListener('netmap:open-snmp-walk', onOpen as EventListener);
  }, []);
  if (!req) return null;
  return <SnmpWalkDialog initialHost={req.host || ''} onClose={() => setReq(null)} />;
}

const ROOTS: Array<{ oid: string; label: string }> = [
  { oid: '1.3.6.1.2.1.1', label: 'system — имя, описание, аптайм' },
  { oid: '1.3.6.1.2.1.2.2.1', label: 'interfaces — порты и их состояние' },
  { oid: '1.0.8802.1.1.2', label: 'LLDP — соседи устройства' },
  { oid: '1.3.6.1.2.1.17', label: 'BRIDGE-MIB — таблица MAC-адресов' },
  { oid: '1.3.6.1.2.1', label: 'MIB-2 целиком — может идти долго' },
  { oid: 'custom', label: 'Другой OID…' },
];

const V3_AUTH = [['sha', 'SHA'], ['md5', 'MD5'], ['sha256', 'SHA-256'], ['sha512', 'SHA-512']] as const;
const V3_PRIV = [['aes', 'AES'], ['des', 'DES'], ['aes256b', 'AES-256 (Blumenthal)'], ['aes256r', 'AES-256 (Reeder)']] as const;

function SnmpWalkDialog({ initialHost, onClose }: { initialHost: string; onClose: () => void }) {
  const [host, setHost] = useState(initialHost);
  const [port, setPort] = useState('161');
  const [version, setVersion] = useState<SnmpVersion>('2c');
  const [community, setCommunity] = useState('public');
  const [v3User, setV3User] = useState('');
  const [v3Level, setV3Level] = useState<'noAuthNoPriv' | 'authNoPriv' | 'authPriv'>('authPriv');
  const [v3AuthProto, setV3AuthProto] = useState('sha');
  const [v3AuthKey, setV3AuthKey] = useState('');
  const [v3PrivProto, setV3PrivProto] = useState('aes');
  const [v3PrivKey, setV3PrivKey] = useState('');
  const [rootPick, setRootPick] = useState('1.3.6.1.2.1.1');
  const [rootCustom, setRootCustom] = useState('');
  const [filter, setFilter] = useState('');

  const [busy, setBusy] = useState<'' | 'probe' | 'detect' | 'walk' | 'save'>('');
  const [msg, setMsg] = useState<{ kind: 'info' | 'ok' | 'err'; text: string } | null>(null);
  const [walk, setWalk] = useState<SnmpWalkResult | null>(null);
  // v0.91.0: список проверенных комбинаций SNMPv3 (что именно пробовали).
  const [checks, setChecks] = useState<string[]>([]);

  const root = rootPick === 'custom' ? rootCustom.trim() : rootPick;
  const native = hasNetTools();

  const cfg = (): SnmpCfg => ({
    host: host.trim(),
    port: Number(port) || 161,
    snmpVersion: version,
    community,
    v3User: v3User.trim(),
    v3Level,
    v3AuthProto,
    v3AuthKey,
    v3PrivProto,
    v3PrivKey,
    timeoutMs: 3000,
    rootOid: root,
  });

  const needHost = (): boolean => {
    if (!host.trim()) { setMsg({ kind: 'err', text: 'Укажите IP-адрес устройства.' }); return true; }
    return false;
  };

  const doProbe = async () => {
    if (needHost()) return;
    setBusy('probe'); setMsg({ kind: 'info', text: 'Проверяю связь…' });
    const r = await snmpProbe(cfg());
    setBusy('');
    if (r.ok) {
      const up = r.sysUpTime ? ` · аптайм ${formatUptime(r.sysUpTime)}` : '';
      setMsg({ kind: 'ok', text: `Связь есть: ${r.sysName || '(без имени)'}${up}. ${r.sysDescr || ''}`.trim() });
    } else {
      setMsg({ kind: 'err', text: r.error || 'Устройство не ответило.' });
    }
  };

  const doDetect = async () => {
    if (needHost()) return;
    setBusy('detect'); setChecks([]);
    setMsg({ kind: 'info', text: 'Перебираю уровни и протоколы SNMPv3: без аутентификации, аутентификация (MD5/SHA/SHA-256/SHA-512) и шифрование (DES/AES/AES-256). Это может занять до минуты…' });
    const r = await snmpDetectV3({ ...cfg(), snmpVersion: '3' });
    setBusy('');
    setChecks(r.checks || []);
    if (r.ok) {
      if (r.level) setV3Level(r.level);
      if (r.authProtocol) setV3AuthProto(r.authProtocol);
      if (r.privProtocol) setV3PrivProto(r.privProtocol);
      const lvl = r.level === 'noAuthNoPriv' ? 'без аутентификации' : r.level === 'authNoPriv' ? 'аутентификация без шифрования' : 'аутентификация и шифрование';
      setMsg({
        kind: r.authOnly ? 'err' : 'ok',
        text: `Подошло: уровень «${lvl}», аутентификация ${r.authProtocol || '—'}, шифрование ${r.privProtocol || '—'}${r.sysName ? `. Устройство: ${r.sysName}` : ''}.${r.warning ? ` ⚠ ${r.warning}` : ''}${r.authOnly ? '' : ' Настройки подставлены в поля выше — можно делать walk.'}`,
      });
    } else {
      setMsg({ kind: 'err', text: r.error || 'Ни одна комбинация не подошла.' });
    }
  };

  const doWalk = async () => {
    if (needHost()) return;
    if (!root || !/^\.?\d+(\.\d+)*$/.test(root.replace(/^\./, ''))) {
      setMsg({ kind: 'err', text: 'Укажите OID ветки в виде цифр через точку, например 1.3.6.1.2.1.1.' });
      return;
    }
    setBusy('walk'); setWalk(null); setMsg({ kind: 'info', text: `Опрос ветки ${root}…` });
    const r = await snmpWalk(cfg());
    setBusy('');
    setWalk(r);
    if (r.ok) setMsg({ kind: 'ok', text: `Получено строк: ${r.total ?? 0} за ${r.ms ?? 0} мс.${r.truncated ? ' Показаны первые 5000.' : ''}` });
    else setMsg({ kind: 'err', text: r.error || 'Walk не выполнен.' });
  };

  const visibleRows = useMemo(() => {
    if (!walk?.rows) return [];
    const q = filter.trim().toLowerCase();
    const rows = q ? walk.rows.filter(r => r.oid.includes(q) || r.value.toLowerCase().includes(q)) : walk.rows;
    return rows.slice(0, 500);
  }, [walk, filter]);

  const doSave = async () => {
    if (!walk?.rows?.length) return;
    setBusy('save');
    const safeHost = host.trim().replace(/[^A-Za-z0-9._-]+/g, '_');
    const text = walk.rows.map(r => `${r.oid} = ${r.value}`).join('\n') + '\n';
    const r = await saveTextFile({
      defaultPath: `snmpwalk-${safeHost}.txt`,
      content: text,
      title: 'Сохранить результат walk',
      filters: [{ name: 'Текст', extensions: ['txt'] }],
    });
    setBusy('');
    if (r.ok) setMsg({ kind: 'ok', text: `Сохранено: ${r.path}` });
    else if (!r.canceled) setMsg({ kind: 'err', text: r.error || 'Не удалось сохранить файл.' });
  };

  const footer = (
    <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: '#64748B' }}>Community и ключи не сохраняются в документ.</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <DlgBtn kind="ghost" onClick={onClose}>Закрыть</DlgBtn>
      </div>
    </div>
  );

  return (
    <DialogShell title="SNMP walk" subtitle="Проверка связи и опрос устройства по SNMP"
      chips={['v1', 'v2c', 'v3 · MD5/SHA/SHA-2 · DES/AES']} icon="search" onClose={onClose}
      width={780} footer={footer}>
      <div style={{ padding: '14px 20px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!native && (
          <div style={warnBox}>Окно работает в приложении NetMap. В браузере опрос недоступен.</div>
        )}

        <div style={hintBox}>
          <b>Что это.</b> SNMP — протокол, по которому устройство отдаёт свои параметры: имя, порты, соседей,
          таблицу MAC-адресов. Утилита нужна, чтобы выяснить, отвечает ли устройство, какой версией SNMP и каким
          шифрованием с ним работать. Порядок: <b>1)</b> «Проверить связь»; <b>2)</b> если SNMPv3 молчит —
          «Подобрать протокол»; <b>3)</b> «Walk» нужной ветки.
        </div>

        <DlgSection title="Устройство и версия">
          <div style={grid2}>
            <Field label="IP-адрес или имя">
              <input value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.11.1" style={inp} />
            </Field>
            <Field label="Порт">
              <input value={port} onChange={e => setPort(e.target.value.replace(/[^0-9]/g, ''))} style={inp} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {(['1', '2c', '3'] as SnmpVersion[]).map(v => (
              <button key={v} onClick={() => setVersion(v)} style={{ ...segBtn, ...(version === v ? segBtnOn : {}) }}>
                SNMP v{v}
              </button>
            ))}
          </div>
        </DlgSection>

        {version !== '3' ? (
          <DlgSection title="Community">
            <Field label="Community (пароль-строка v1/v2c, обычно public)">
              <input type="password" value={community} onChange={e => setCommunity(e.target.value)} style={inp} autoComplete="off" />
            </Field>
            <div style={hintTxt}>v1 и v2c не шифруют трафик: строка community передаётся открыто. Для проверки связи этого достаточно.</div>
          </DlgSection>
        ) : (
          <DlgSection title="SNMPv3 — пользователь и шифрование">
            <div style={grid2}>
              <Field label="Пользователь (USM)">
                <input value={v3User} onChange={e => setV3User(e.target.value)} placeholder="например, zbx" style={inp} />
              </Field>
              <Field label="Уровень безопасности">
                <select value={v3Level} onChange={e => setV3Level(e.target.value as typeof v3Level)} style={inp}>
                  <option value="noAuthNoPriv">без аутентификации и шифрования</option>
                  <option value="authNoPriv">аутентификация без шифрования</option>
                  <option value="authPriv">аутентификация и шифрование</option>
                </select>
              </Field>
            </div>
            {v3Level !== 'noAuthNoPriv' && (
              <div style={grid2}>
                <Field label="Аутентификация">
                  <select value={v3AuthProto} onChange={e => setV3AuthProto(e.target.value)} style={inp}>
                    {V3_AUTH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Ключ аутентификации">
                  <input type="password" value={v3AuthKey} onChange={e => setV3AuthKey(e.target.value)} style={inp} autoComplete="off" />
                </Field>
              </div>
            )}
            {v3Level === 'authPriv' && (
              <div style={grid2}>
                <Field label="Шифрование">
                  <select value={v3PrivProto} onChange={e => setV3PrivProto(e.target.value)} style={inp}>
                    {V3_PRIV.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Ключ шифрования">
                  <input type="password" value={v3PrivKey} onChange={e => setV3PrivKey(e.target.value)} style={inp} autoComplete="off" />
                </Field>
              </div>
            )}
            <div style={hintTxt}>Протоколы должны совпадать с настройками устройства. Не знаете их — нажмите «Подобрать протокол».</div>
          </DlgSection>
        )}

        <DlgSection title="Ветка для walk">
          <div style={grid2}>
            <Field label="Что опрашивать">
              <select value={rootPick} onChange={e => setRootPick(e.target.value)} style={inp}>
                {ROOTS.map(r => <option key={r.oid} value={r.oid}>{r.label}{r.oid !== 'custom' ? ` (${r.oid})` : ''}</option>)}
              </select>
            </Field>
            {rootPick === 'custom' && (
              <Field label="OID">
                <input value={rootCustom} onChange={e => setRootCustom(e.target.value)} placeholder="1.3.6.1.2.1.31" style={inp} />
              </Field>
            )}
          </div>
        </DlgSection>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <DlgBtn kind="primary" disabled={!native || !!busy} onClick={doProbe}>
            {busy === 'probe' ? 'Проверяю…' : 'Проверить связь'}
          </DlgBtn>
          {version === '3' && (
            <DlgBtn kind="ghost" disabled={!native || !!busy} onClick={doDetect}>
              {busy === 'detect' ? 'Перебираю…' : 'Подобрать протокол SNMPv3'}
            </DlgBtn>
          )}
          <DlgBtn kind="ghost" disabled={!native || !!busy} onClick={doWalk}>
            {busy === 'walk' ? 'Опрашиваю…' : 'Walk выбранной ветки'}
          </DlgBtn>
        </div>

        {msg && (
          <div style={msg.kind === 'err' ? errBox : msg.kind === 'ok' ? okBox : infoBox}>{msg.text}</div>
        )}

        {checks.length > 0 && (
          <details style={{ fontSize: 12, color: '#334155' }}>
            <summary style={{ cursor: 'pointer' }}>Проверено комбинаций: {checks.length} (нажмите, чтобы посмотреть)</summary>
            <ul style={{ margin: '6px 0 0 18px', padding: 0, lineHeight: 1.6 }}>
              {checks.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </details>
        )}

        {walk?.ok && walk.rows && (
          <DlgSection title={`Результат walk (${walk.total ?? 0})`}
            hint={walk.truncated ? 'показаны первые 5000' : undefined}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Фильтр по OID или значению"
                style={{ ...inp, flex: 1 }} />
              <DlgBtn kind="ghost" disabled={!!busy || !walk.rows.length} onClick={doSave}>Сохранить в файл…</DlgBtn>
            </div>
            <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #E2E8F0', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <tbody>
                  {visibleRows.map((r, i) => (
                    <tr key={r.oid + i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '4px 8px', fontFamily: 'Consolas, monospace', color: '#475569', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{r.oid}</td>
                      <td style={{ padding: '4px 8px', color: '#0F172A', wordBreak: 'break-all' }}>{r.value}</td>
                    </tr>
                  ))}
                  {visibleRows.length === 0 && (
                    <tr><td style={{ padding: 10, color: '#64748B' }}>Ничего не найдено по фильтру.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {walk.rows.length > visibleRows.length && (
              <div style={hintTxt}>Показаны первые {visibleRows.length}. Уточните фильтр или сохраните весь список в файл.</div>
            )}
          </DlgSection>
        )}
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

function formatUptime(ticks: number): string {
  const sec = Math.floor(ticks / 100);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d} д ${h} ч ${m} мин`;
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
const hintBox: CSSProperties = {
  fontSize: 12, lineHeight: 1.5, color: '#334155', background: '#F8FAFC', border: '1px solid #E2E8F0',
  borderRadius: 8, padding: '10px 12px',
};
const hintTxt: CSSProperties = { fontSize: 11, color: '#64748B', marginTop: 6, lineHeight: 1.45 };
const base: CSSProperties = { fontSize: 12, borderRadius: 8, padding: '8px 10px', lineHeight: 1.45 };
const infoBox: CSSProperties = { ...base, background: '#EFF6FF', color: '#1E3A8A', border: '1px solid #BFDBFE' };
const okBox: CSSProperties = { ...base, background: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' };
const errBox: CSSProperties = { ...base, background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' };
const warnBox: CSSProperties = { ...base, background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' };
