/**
 * v0.36.1 — Настройки приложения (открывается из AppMenu → Настройки…).
 *
 * Tabs:
 *   • Общие          — тема (заглушка на будущее), snap to grid.
 *   • Мониторинг     — фоновый ping (интервал, включён/нет).
 *   • Уведомления    — Telegram bot + прокси, native Windows toast, severity фильтр.
 *   • О программе    — версия, ссылки.
 *
 * State хранится в:
 *   - store.monitorEnabled, store.monitorIntervalSec — уже были в v0.14.
 *   - Новый slice `notifSettings` (см. store.ts) для Telegram и toast.
 *
 * Рендерится через createPortal(document.body) чтобы всплывающие FAB /
 * legend не перекрывали (как MikrotikImportDialog в v0.36.0).
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from './store';
import { alertDialog } from './Modal';

type Tab = 'general' | 'monitor' | 'notify' | 'security' | 'about';

export function SettingsDialogHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const name = (e as CustomEvent<{ name: string }>).detail?.name;
      if (name === 'settings') setOpen(true);
    };
    window.addEventListener('netmap:open-dialog', onOpen as EventListener);
    return () => window.removeEventListener('netmap:open-dialog', onOpen as EventListener);
  }, []);
  if (!open) return null;
  return <SettingsDialog onClose={() => setOpen(false)} />;
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('general');
  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={card}>
        <div style={header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>⚙</span>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Настройки</div>
          </div>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={sidebar}>
            <TabBtn active={tab === 'general'}  onClick={() => setTab('general')}  icon="⚙" label="Общие" />
            <TabBtn active={tab === 'monitor'}  onClick={() => setTab('monitor')}  icon="📡" label="Мониторинг" />
            <TabBtn active={tab === 'notify'}   onClick={() => setTab('notify')}   icon="🔔" label="Уведомления" />
            <TabBtn active={tab === 'security'} onClick={() => setTab('security')} icon="🔒" label="Безопасность" />
            <TabBtn active={tab === 'about'}    onClick={() => setTab('about')}    icon="ℹ" label="О программе" />
          </div>
          <div style={content}>
            {tab === 'general' && <GeneralTab />}
            {tab === 'monitor' && <MonitorTab />}
            {tab === 'notify'  && <NotifyTab />}
            {tab === 'security' && <SecurityTab />}
            {tab === 'about'   && <AboutTab />}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ------------------------------------------------------------------------
// General
// ------------------------------------------------------------------------
function GeneralTab() {
  const snap = useStore(s => s.snapToGrid);
  const toggleSnap = useStore(s => s.toggleSnap);
  const showGrid = useStore(s => s.showGrid);
  const toggleGrid = useStore(s => s.toggleGrid);
  const focusRelated = useStore(s => s.focusRelated);
  const toggleFocusRelated = useStore(s => s.toggleFocusRelated);
  const viewMode = useStore(s => s.viewMode);
  const setViewMode = useStore(s => s.setViewMode);
  const collapseEndpoints = useStore(s => s.collapseEndpoints);
  const toggleCollapseEndpoints = useStore(s => s.toggleCollapseEndpoints);
  return (
    <>
      <Section title="Оформление карты">
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
            Стиль карточек устройств
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <ViewModeCard
              active={viewMode === 'modern'} onClick={() => setViewMode('modern')}
              label="Modern" desc="Круглые аватары, минимализм, endpoint'ы группами"
            />
            <ViewModeCard
              active={viewMode === 'legacy'} onClick={() => setViewMode('legacy')}
              label="Legacy" desc="Rack/compact карточки, каждое устройство отдельно"
            />
          </div>
        </div>
        {viewMode === 'modern' && (
          <Toggle
            label="Сворачивать endpoint'ы в свитч"
            sub="Камеры / AP / PC / замки прячутся из карты и показываются как список внутри карточки своего свитча"
            checked={collapseEndpoints} onChange={toggleCollapseEndpoints}
          />
        )}
      </Section>
      <Section title="Канвас">
        <Toggle label="Прилипание к сетке (Snap to grid)"
                sub="Устройства выравниваются по сетке 20 px"
                checked={snap} onChange={toggleSnap} />
        <Toggle label="Показывать сетку"
                sub="Фоновая dot-grid на канвасе"
                checked={showGrid} onChange={toggleGrid} />
        <Toggle label="Фокус связанных при hover"
                sub="Наведение на устройство приглушает несвязанные кабели и карточки"
                checked={focusRelated} onChange={toggleFocusRelated} />
      </Section>
      <OrphanGridSection />
    </>
  );
}

// v0.43.6: how many columns to use when auto-layout has to place many
// unlinked "orphan" devices — typical after a bulk ARP/DHCP import.
// 0 = auto (~sqrt(N)). Otherwise a fixed number.
function OrphanGridSection() {
  const cols = useStore(s => (s as any).orphanGridCols || 0);
  const setCols = useStore(s => (s as any).setOrphanGridCols);
  const options: Array<{ value: number; label: string; desc: string }> = [
    { value: 0,  label: 'Авто',   desc: '~sqrt(N), сбалансированный квадрат' },
    { value: 6,  label: '6',      desc: 'узкая сетка' },
    { value: 10, label: '10',     desc: 'средняя' },
    { value: 15, label: '15',     desc: 'широкая' },
    { value: 20, label: '20',     desc: 'максимально широкая' },
  ];
  return (
    <Section title="Раскладка после импорта">
      <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8, lineHeight: 1.5 }}>
        Сколько колонок использовать для «орфан»-устройств (без известного uplink-свитча) — обычно после
        массового ARP/DHCP импорта из MikroTik/UniFi. Раньше все они ложились в одну длинную полосу.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {options.map(o => (
          <button
            key={o.value}
            onClick={() => setCols(o.value)}
            style={{
              padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
              border: '2px solid ' + (cols === o.value ? '#2563EB' : '#E5E7EB'),
              background: cols === o.value ? '#EFF6FF' : 'white',
              color: cols === o.value ? '#1D4ED8' : '#334155',
              fontSize: 12, fontWeight: cols === o.value ? 700 : 500,
              minWidth: 80, textAlign: 'left',
            }}
          >
            <div>{o.label}</div>
            <div style={{ fontSize: 9, opacity: 0.75, marginTop: 2 }}>{o.desc}</div>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 8 }}>
        Настройка применяется к следующему импорту и следующему запуску auto-layout.
      </div>
    </Section>
  );
}

function ViewModeCard({ active, onClick, label, desc }: {
  active: boolean; onClick: () => void; label: string; desc: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: 10, borderRadius: 8,
        border: '2px solid ' + (active ? '#2563EB' : '#E5E7EB'),
        background: active ? '#EFF6FF' : 'white',
        cursor: 'pointer', textAlign: 'left',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: active ? '#1D4ED8' : '#111827' }}>{label}</div>
      <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>{desc}</div>
    </button>
  );
}

// ------------------------------------------------------------------------
// Monitor (background ping)
// ------------------------------------------------------------------------
function MonitorTab() {
  const enabled = useStore(s => s.monitorEnabled);
  const setEnabled = useStore(s => s.setMonitorEnabled);
  const interval = useStore(s => s.monitorIntervalSec);
  const setInterval = useStore(s => s.setMonitorIntervalSec);
  const doc = useStore(s => s.doc);
  const withIp = useMemo(() => doc.devices.filter(d => d.ip).length, [doc.devices]);
  return (
    <>
      <Section title="Фоновый ping-мониторинг">
        <Toggle label="Пинговать устройства фоном"
                sub={`Проверяет ${withIp} устройств с IP-адресом · при недоступности — уведомление`}
                checked={enabled} onChange={() => setEnabled(!enabled)} />
        <Field label="Интервал проверки, секунд">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="range" min={10} max={300} step={5}
                   value={interval}
                   onChange={e => setInterval(Number(e.target.value))}
                   disabled={!enabled}
                   style={{ flex: 1 }} />
            <span style={{ minWidth: 60, fontFamily: 'ui-monospace, monospace',
                            fontSize: 12, color: '#111827' }}>
              {interval < 60 ? `${interval}с` : `${Math.floor(interval / 60)}м ${interval % 60}с`}
            </span>
          </div>
          <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>
            Меньше — быстрее реакция на падение, но больше нагрузка на сеть.
            Рекомендуется 30-60 сек для 100+ устройств.
          </div>
        </Field>
      </Section>
    </>
  );
}

// ------------------------------------------------------------------------
// Notifications
// ------------------------------------------------------------------------
function NotifyTab() {
  const settings = useStore(s => s.notifSettings);
  const update = useStore(s => s.updateNotifSettings);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const doTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const w = window as any;
      if (!w.netmap?.telegramSend) throw new Error('IPC недоступен');
      const res = await w.netmap.telegramSend({
        botToken: settings.telegramBotToken,
        chatId: settings.telegramChatId,
        proxyUrl: settings.telegramProxyUrl,
        message: '✅ NetMap — тестовое сообщение.\nЕсли вы это видите, интеграция настроена правильно.',
      });
      if (res.ok) setTestResult('✓ Отправлено. Проверьте чат.');
      else setTestResult('✗ ' + (res.error || 'Не удалось'));
    } catch (e: any) {
      setTestResult('✗ ' + (e?.message || String(e)));
    } finally { setTesting(false); }
  };

  return (
    <>
      <Section title="Каналы доставки">
        <Toggle label="Показывать в панели уведомлений"
                sub="Значок 🔔 в верхней панели"
                checked={settings.inApp}
                onChange={v => update({ inApp: v })} />
        <Toggle label="Системные Windows toast'ы"
                sub="Всплывают в углу экрана, даже когда окно NetMap свёрнуто"
                checked={settings.windowsToast}
                onChange={v => update({ windowsToast: v })} />
        <Toggle label="Отправлять в Telegram"
                sub="Требует настройки бота ниже"
                checked={settings.telegramEnabled}
                onChange={v => update({ telegramEnabled: v })} />
      </Section>

      <Section title="Фильтр уведомлений">
        <Field label="Уровень серьёзности (что отправлять)">
          <select value={settings.minSeverity}
                  onChange={e => update({ minSeverity: e.target.value as any })}
                  style={inputStyle}>
            <option value="critical">Только критичные (устройство упало)</option>
            <option value="warn">Критичные + предупреждения</option>
            <option value="info">Всё, включая события восстановления</option>
          </select>
        </Field>
      </Section>

      {settings.telegramEnabled && (
        <Section title="Telegram">
          <Field label="Bot Token"
                 hint="Получить у @BotFather: /newbot → скопировать токен вида 1234567890:AAH...">
            <input type="password" value={settings.telegramBotToken}
                   onChange={e => update({ telegramBotToken: e.target.value })}
                   placeholder="1234567890:AAHexampleTokenHere..."
                   style={inputStyle} />
          </Field>
          <Field label="Chat ID"
                 hint="Ваш ID (положительное число) или ID группы (обычно отрицательное со знаком). Узнать: напишите боту, потом откройте https://api.telegram.org/bot<TOKEN>/getUpdates">
            <input value={settings.telegramChatId}
                   onChange={e => update({ telegramChatId: e.target.value })}
                   placeholder="123456789 или -1001234567890"
                   style={inputStyle} />
          </Field>
          <Field label="HTTP-прокси (необязательно)"
                 hint="Для стран, где Telegram заблокирован. Формат: http://user:pass@host:port или socks5://host:port">
            <input value={settings.telegramProxyUrl}
                   onChange={e => update({ telegramProxyUrl: e.target.value })}
                   placeholder="socks5://127.0.0.1:1080"
                   style={inputStyle} />
          </Field>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <button onClick={doTest} disabled={testing || !settings.telegramBotToken || !settings.telegramChatId}
                    style={{
                      ...primaryBtn,
                      opacity: (testing || !settings.telegramBotToken || !settings.telegramChatId) ? 0.5 : 1,
                    }}>
              {testing ? 'Отправка…' : 'Проверить'}
            </button>
            {testResult && (
              <span style={{
                fontSize: 11,
                color: testResult.startsWith('✓') ? '#065F46' : '#B91C1C',
                fontFamily: 'ui-monospace, monospace',
              }}>{testResult}</span>
            )}
          </div>
        </Section>
      )}
    </>
  );
}

// ------------------------------------------------------------------------
// About
// ------------------------------------------------------------------------
function SecurityTab() {
  const LS_KEY = 'netmap:vault:idleMs';
  const [idleMinutes, setIdleMinutes] = useState<number>(() => {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) return Math.max(0, Math.floor(Number(raw) / 60000)); } catch {}
    return 15;
  });
  const [clipMs, setClipMs] = useState<number>(() => {
    try { const raw = localStorage.getItem('netmap:vault:clipMs'); if (raw) return Number(raw); } catch {}
    return 20000;
  });
  const [status, setStatus] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);

  useEffect(() => {
    import('./vaultClient').then(m => {
      m.vaultStatus().then(setStatus);
      m.vaultAuditList(30).then(setAudit);
      m.vaultSetIdleTimeout(idleMinutes * 60_000).catch(() => {});
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyIdle = async (mins: number) => {
    setIdleMinutes(mins);
    localStorage.setItem(LS_KEY, String(mins * 60_000));
    try {
      const m = await import('./vaultClient');
      await m.vaultSetIdleTimeout(mins * 60_000);
    } catch {}
  };

  return (
    <>
      <Section title="Vault (менеджер паролей)">
        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.6, marginBottom: 12 }}>
          AES-256-GCM + PBKDF2-SHA256 (200k итераций). Все секреты хранятся в SQLite локально —
          никогда не покидают компьютер. Мастер-пароль <b>не восстанавливается</b>.
        </div>
        {status && (
          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 12 }}>
            Статус: {status.initialized ? (status.unlocked ? '🔓 разблокирован' : '🔒 заблокирован') : 'не создан'}
            {' · '}записей: {status.itemCount}
          </div>
        )}
        <Field label="Автоблокировка при неактивности" hint="0 = отключено. Учитываются мышь и клавиатура.">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="range" min={0} max={60} step={1} value={idleMinutes}
                   onChange={(e) => applyIdle(Number(e.target.value))}
                   style={{ flex: 1 }} />
            <span style={{ fontSize: 12, minWidth: 90, textAlign: 'right', color: '#374151' }}>
              {idleMinutes === 0 ? 'выключено' : `${idleMinutes} мин`}
            </span>
          </div>
        </Field>
        <Field label="Очистка буфера обмена после копирования пароля">
          <select value={clipMs}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setClipMs(v);
                    localStorage.setItem('netmap:vault:clipMs', String(v));
                  }}
                  style={{ padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 12 }}>
            <option value={0}>Не очищать</option>
            <option value={10000}>10 секунд</option>
            <option value={20000}>20 секунд</option>
            <option value={30000}>30 секунд</option>
            <option value={60000}>60 секунд</option>
          </select>
        </Field>
      </Section>

      <Section title={`Журнал доступа (${audit.length})`}>
        <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 8 }}>
          Последние операции с vault-ом. Хранятся в SQLite (лимит 500 записей).
        </div>
        <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: 6 }}>
          {audit.length === 0 && <div style={{ padding: 12, fontSize: 11, color: '#94A3B8', textAlign: 'center' }}>Пусто</div>}
          {audit.map(a => (
            <div key={a.id} style={{
              padding: '4px 8px', borderBottom: '1px solid #F1F5F9',
              display: 'flex', gap: 8, fontSize: 10, alignItems: 'center',
            }}>
              <span style={{ minWidth: 130, opacity: 0.65 }}>{new Date(a.ts).toLocaleString()}</span>
              <span style={{
                padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                background: auditColor(a.action).bg, color: auditColor(a.action).fg,
              }}>{a.action}</span>
              {a.itemName && <span style={{ opacity: 0.8 }}>{a.itemName}</span>}
              {a.detail && <span style={{ opacity: 0.6 }}>{a.detail}</span>}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
          <button
            onClick={async () => {
              // v0.39: export full audit log (up to 500 entries) as CSV
              const { vaultAuditList } = await import('./vaultClient');
              const { exportAuditCsv, downloadFile } = await import('./vaultExport');
              const full = await vaultAuditList(500);
              downloadFile(exportAuditCsv(full));
            }}
            style={{ padding: '4px 10px', border: '1px solid #93C5FD', background: '#DBEAFE',
                     color: '#1E40AF', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
          >
            ⤓ Экспорт CSV
          </button>
          <button
            onClick={async () => {
              const { vaultAuditClear, vaultAuditList } = await import('./vaultClient');
              await vaultAuditClear();
              setAudit(await vaultAuditList(30));
            }}
            style={{ padding: '4px 10px', border: '1px solid #FCA5A5', background: '#FEE2E2',
                     color: '#B91C1C', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
          >
            🗑 Очистить журнал
          </button>
        </div>
      </Section>
    </>
  );
}
function auditColor(action: string): { bg: string; fg: string } {
  if (action === 'unlock' || action === 'init') return { bg: '#D1FAE5', fg: '#065F46' };
  if (action === 'lock')                        return { bg: '#F1F5F9', fg: '#475569' };
  if (action === 'unlock-fail')                 return { bg: '#FEE2E2', fg: '#991B1B' };
  if (action === 'delete')                      return { bg: '#FEF3C7', fg: '#92400E' };
  if (action.startsWith('folder'))              return { bg: '#EDE9FE', fg: '#5B21B6' };
  return { bg: '#DBEAFE', fg: '#1E40AF' };
}

function AboutTab() {
  return (
    <>
      <Section title="NetMap">
        <div style={{ fontSize: 13, color: '#111827', lineHeight: 1.6 }}>
          Интерактивная схема сети для сисадмина.<br/>
          Локальная база (SQLite) · vault для паролей (AES-256-GCM) · ping-мониторинг · импорт с MikroTik/UniFi/Omada.
        </div>
        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 12 }}>
          <b>Версия:</b> 0.44.2
        </div>
      </Section>
      <Section title="Обратная связь">
        <div style={{ fontSize: 12, color: '#374151' }}>
          Ошибки и запросы фич — присылайте разработчику. Используйте кнопку «🐞 Показать сырой ответ» в диалогах импорта и «Скопировать отчёт» в баннере ошибок — это ускорит диагностику.
        </div>
      </Section>
    </>
  );
}

// ------------------------------------------------------------------------
// Reusable UI atoms
// ------------------------------------------------------------------------
function TabBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: string; label: string;
}) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px', borderRadius: 6,
      background: active ? '#EFF6FF' : 'transparent',
      color: active ? '#1D4ED8' : '#374151',
      border: 'none',
      fontSize: 12, fontWeight: active ? 600 : 500,
      cursor: 'pointer', textAlign: 'left',
      width: '100%',
    }}>
      <span style={{ width: 18, textAlign: 'center' }}>{icon}</span>
      {label}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#9CA3AF',
        textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10,
      }}>{title}</div>
      <div style={{ display: 'grid', gap: 12 }}>{children}</div>
    </div>
  );
}

function Toggle({ label, sub, checked, onChange }: {
  label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label style={{
      display: 'flex', gap: 10, alignItems: 'flex-start',
      cursor: 'pointer', padding: '6px 0',
    }}>
      <span onClick={() => onChange(!checked)} style={{
        width: 34, height: 20, borderRadius: 10,
        background: checked ? '#2563EB' : '#D1D5DB',
        position: 'relative', flexShrink: 0,
        transition: 'background 0.15s',
        marginTop: 1,
      }}>
        <span style={{
          position: 'absolute', top: 2, left: checked ? 16 : 2,
          width: 16, height: 16, borderRadius: '50%',
          background: '#FFFFFF',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'left 0.15s',
        }} />
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: '#111827', fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: '#6B7280', marginTop: 1 }}>{sub}</div>}
      </div>
    </label>
  );
}

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{
        fontSize: 10, fontWeight: 600, color: '#374151',
        textTransform: 'uppercase', letterSpacing: 0.3,
      }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

// ---- styles ----
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
  backdropFilter: 'blur(4px)', zIndex: 4000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 24,
};
const card: React.CSSProperties = {
  width: 'min(760px, 96vw)', maxHeight: '92vh',
  background: '#FFFFFF', borderRadius: 10,
  boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
  display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
  color: '#111827', fontFamily: 'system-ui, sans-serif',
};
const header: React.CSSProperties = {
  padding: '12px 16px', borderBottom: '1px solid #E5E7EB',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};
const closeBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid #E5E7EB',
  color: '#6B7280', padding: '4px 10px', borderRadius: 6,
  cursor: 'pointer', fontSize: 14,
};
const sidebar: React.CSSProperties = {
  width: 170, borderRight: '1px solid #F3F4F6',
  padding: 8, display: 'flex', flexDirection: 'column', gap: 2,
  background: '#F9FAFB', flexShrink: 0,
};
const content: React.CSSProperties = {
  flex: 1, padding: 20, overflowY: 'auto',
  minHeight: 0,
};
const inputStyle: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827',
  padding: '6px 10px', borderRadius: 6, fontSize: 12, outline: 'none',
  width: '100%',
};
const primaryBtn: React.CSSProperties = {
  background: '#2563EB', border: 'none', color: '#FFFFFF',
  padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
  fontSize: 12, fontWeight: 600,
};

// Suppress unused-import warning if alertDialog isn't reached
void alertDialog;
