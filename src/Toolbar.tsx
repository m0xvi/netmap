import { useEffect, useMemo, useState, useRef } from 'react';
import { useStore } from './store';
import { ProjectMenu } from './FileMenu';
import { SettingsDialogHost } from './SettingsDialog';

/**
 * v0.35.7 top toolbar redesign:
 *
 *   [Logo] [ProjectMenu ⌄]  [Health widget]  [🔎 search ⌘K …]         [☰ AppMenu] [Focus] [🔔] [?]
 *
 * — «Add Device» removed: there's already a full left-sidebar palette.
 * — «Import» removed: moved into the AppMenu hamburger.
 * — Kebab «⋮» removed: undo/redo/knife/auto-layout/export moved into the
 *   floating FAB on the canvas (LayoutFAB, radial fan-out on click).
 * — ProjectMenu and AppMenu are visually separated so the user can tell
 *   "which project I'm on" apart from "what can I do with it".
 */
export function Toolbar() {
  const doc = useStore(s => s.doc);
  const select = useStore(s => s.select);
  const setHighlight = useStore(s => s.setHighlight);

  // ---- Global search ----
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Search grammar (v0.19):
   *   free text        → fuzzy match on name / IP / MAC / model / vendor / location / tags
   *   vlan:10          → devices that have VLAN 10 on any port or link
   *   ip:192.168       → devices whose IP starts with "192.168"
   *   kind:switch      → devices where kind === switch (accepts multiple: kind:router,switch)
   *   mac:AA:BB        → substring match on MAC
   *   tag:cctv         → devices that have a tag matching "cctv"
   *   vendor:cisco     → devices with vendor including "cisco"
   *   status:up|down|unknown → filter by liveStatus
   *   Multiple terms are AND-combined; each term without a `:` prefix is fuzzy.
   */
  const results = useMemo(() => {
    const query = q.trim();
    if (!query) return [];

    // Tokenize into structured filters + free-text words
    const tokens = query.match(/\S+/g) || [];
    const filters: Array<(d: typeof doc.devices[number]) => boolean> = [];
    const freeText: string[] = [];

    for (const tok of tokens) {
      const colon = tok.indexOf(':');
      if (colon <= 0) { freeText.push(tok.toLowerCase()); continue; }
      const key = tok.slice(0, colon).toLowerCase();
      const val = tok.slice(colon + 1).toLowerCase();
      if (!val) continue;
      switch (key) {
        case 'vlan': {
          const vid = parseInt(val, 10);
          if (Number.isNaN(vid)) break;
          filters.push(d => {
            if (d.ports.some(p => p.vlan === vid || p.vlans?.includes(vid))) return true;
            return doc.links.some(l =>
              (l.fromDeviceId === d.id || l.toDeviceId === d.id) &&
              (l.vlan === vid || l.vlans?.includes(vid))
            );
          });
          break;
        }
        case 'ip':
          filters.push(d => !!d.ip && d.ip.toLowerCase().includes(val));
          break;
        case 'mac':
          filters.push(d => !!d.mac && d.mac.toLowerCase().includes(val));
          break;
        case 'kind': {
          const kinds = val.split(',').map(k => k.trim());
          filters.push(d => kinds.includes(d.kind));
          break;
        }
        case 'tag':
          filters.push(d => (d.tags || []).some(t => t.toLowerCase().includes(val)));
          break;
        case 'vendor':
          filters.push(d => (d.vendor || '').toLowerCase().includes(val));
          break;
        case 'model':
          filters.push(d => (d.model || '').toLowerCase().includes(val));
          break;
        case 'status':
          filters.push(d => (d.liveStatus || 'unknown') === val);
          break;
        case 'loc':
        case 'location':
          filters.push(d => (d.location || '').toLowerCase().includes(val));
          break;
        default:
          // Unknown prefix → treat the whole token as free text
          freeText.push(tok.toLowerCase());
      }
    }

    // Free-text: every word must match SOMEWHERE across a set of fields
    if (freeText.length > 0) {
      filters.push(d => {
        const hay = [
          d.name, d.ip, d.mac, d.model, d.vendor, d.location,
          ...(d.tags || []),
        ].filter(Boolean).join(' ').toLowerCase();
        return freeText.every(w => hay.includes(w));
      });
    }

    if (filters.length === 0) return [];
    return doc.devices.filter(d => filters.every(f => f(d))).slice(0, 12);
  }, [q, doc.devices, doc.links]);

  useEffect(() => { setHighlight(results.map(r => r.id)); }, [results, setHighlight]);

  const health = useMemo(() => {
    const withIp = doc.devices.filter(d => !!d.ip);
    if (withIp.length === 0) return { pct: null as number | null, up: 0, total: 0 };
    const up = withIp.filter(d => d.liveStatus === 'up').length;
    return { pct: Math.round((up / withIp.length) * 1000) / 10, up, total: withIp.length };
  }, [doc.devices]);

  return (
    <div style={bar}>
      {/* v0.42: AppMenu (☰) убран — его роль взяла на себя MenuBar сверху
          (File/View/Tools/Monitor/Help). Project switcher остаётся здесь. */}
      <ProjectMenu />

      {/* v0.42.1: HealthWidget убран — то же самое видно в правой панели
          Network Overview (Uptime плитка) и там не перекрывается menubar'ом. */}

      {/* Global search — fills all remaining space (v0.35: removed maxWidth
          cap so wide monitors don't leave the search box tiny in the middle). */}
      <div style={{ position: 'relative', flex: 1, minWidth: 200, marginLeft: 12, marginRight: 8 }}>
        <input
          ref={searchRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Поиск: имя, IP, VLAN… (vlan:10, kind:switch, ip:192.168, status:down)"
          style={search}
        />
        <span style={searchIcon}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>
          </svg>
        </span>
        <kbd style={kbdHint}>⌘ K</kbd>
        {q && results.length > 0 && (
          <div style={dropdown}>
            {results.map(r => (
              <div key={r.id} style={ddItem}
                   onClick={() => {
                     select(r.id); setQ(''); setHighlight([]);
                     // v0.23: pan/zoom canvas to the found device
                     window.dispatchEvent(new CustomEvent('netmap:focus-device', { detail: { id: r.id } }));
                   }}>
                <b style={{ color: '#111827' }}>{r.name}</b>
                <span style={{ color: '#6B7280', marginLeft: 6, fontSize: 11 }}>
                  {r.ip || r.kind}{r.location ? ` · ${r.location}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
        {q && results.length === 0 && (
          <div style={dropdown}>
            <div style={{ ...ddItem, color: '#9CA3AF' }}>Ничего не найдено</div>
            <div style={{ padding: '6px 10px 8px', fontSize: 10, color: '#9CA3AF', borderTop: '1px solid #F3F4F6' }}>
              <div style={{ marginBottom: 2, fontWeight: 600 }}>Синтаксис:</div>
              <div><code style={codeHint}>vlan:10</code> — устройства с VLAN 10</div>
              <div><code style={codeHint}>ip:192.168</code> — префикс IP</div>
              <div><code style={codeHint}>kind:switch,router</code> — по типу</div>
              <div><code style={codeHint}>status:down</code> — не отвечают</div>
              <div><code style={codeHint}>tag:cctv</code> — по тегу</div>
            </div>
          </div>
        )}
      </div>

      {/* v0.43.6: quick Modern/Legacy card style toggle — was buried in
          Settings, users wanted it 1-click accessible. */}
      <ViewModeToggle />

      {/* v0.41: panel-toggle buttons. When sidebar / right-panel are hidden
          (default first-run state), user can bring them back from here or
          from the edge-tab buttons on the map itself. */}
      <PanelToggles />

      {/* v0.36.1: right cluster stripped to essentials. FocusRelated / Help
          moved into AppMenu (☰). Only Notifications stay here — visibility
          + unread badge are critical enough to keep at the top level. */}
      <AlertsButton />
      {/* Hidden listeners for netmap:open-dialog — they render the actual
          modal above the rest of the app. Zero visual footprint here. */}
      <HelpButton />
      <SettingsDialogHost />
    </div>
  );
}

/**
 * v0.41 — panel toggle buttons. Sidebar + right-panel are hidden by default
 * on first launch so the map takes the whole screen; user can bring them
 * back from here or from edge-tab buttons on the map.
 */
/**
 * v0.43.6 — Modern / Legacy card style toggle in the top toolbar.
 * Was inside Settings → «Оформление карты», users complained it's too many
 * clicks. Now it's a persistent 2-button segmented control.
 */
function ViewModeToggle() {
  const viewMode = useStore(s => s.viewMode);
  const setViewMode = useStore(s => s.setViewMode);
  return (
    <div style={{
      display: 'flex', gap: 2, marginRight: 6,
      background: '#F1F5F9', borderRadius: 6, padding: 2,
    }}>
      <button
        onClick={() => setViewMode('modern')}
        title="Стиль карточек: Modern (референс-стиль)"
        style={viewModeBtn(viewMode === 'modern')}
      >Modern</button>
      <button
        onClick={() => setViewMode('legacy')}
        title="Стиль карточек: Legacy (rack / compact)"
        style={viewModeBtn(viewMode === 'legacy')}
      >Legacy</button>
    </div>
  );
}
function viewModeBtn(active: boolean): React.CSSProperties {
  return {
    padding: '4px 10px', border: 'none', borderRadius: 4,
    background: active ? 'white' : 'transparent',
    color: active ? '#1D4ED8' : '#64748B',
    fontSize: 11, fontWeight: active ? 700 : 500, cursor: 'pointer',
    boxShadow: active ? '0 1px 2px rgba(15,23,42,0.06)' : undefined,
  };
}

function PanelToggles() {
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const rightPanelOpen = useStore(s => s.rightPanelOpen);
  const toggleSidebar = useStore(s => s.toggleSidebar);
  const toggleRightPanel = useStore(s => s.toggleRightPanel);
  return (
    <div style={{ display: 'flex', gap: 2, marginRight: 6 }}>
      <button
        onClick={toggleSidebar}
        title={sidebarOpen ? 'Скрыть боковую панель' : 'Показать боковую панель'}
        style={panelBtn(sidebarOpen)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      </button>
      <button
        onClick={toggleRightPanel}
        title={rightPanelOpen ? 'Скрыть правую панель' : 'Показать правую панель'}
        style={panelBtn(rightPanelOpen)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      </button>
    </div>
  );
}
function panelBtn(active: boolean): React.CSSProperties {
  return {
    padding: '4px 6px',
    background: active ? '#DBEAFE' : 'transparent',
    color: active ? '#1D4ED8' : '#64748B',
    border: '1px solid ' + (active ? '#93C5FD' : 'transparent'),
    borderRadius: 5, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}

function HealthWidget({ pct, up, total }: { pct: number | null; up: number; total: number }) {
  const good = pct === null || pct >= 95;
  const warn = pct !== null && pct >= 80 && pct < 95;
  const dotColor = good ? '#10B981' : warn ? '#F59E0B' : '#EF4444';
  const label = pct === null ? 'Нет IP' : `${pct}% Online`;

  return (
    <div style={{
      marginLeft: 8, display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 10px 4px 8px',
      border: '1px solid #E5E7EB', borderRadius: 6,
      background: '#FFFFFF',
    }} title={pct === null
      ? 'В проекте нет устройств с IP-адресом'
      : `${up} / ${total} устройств отвечают на ping`}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: dotColor, boxShadow: `0 0 6px ${dotColor}88`,
      }} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#111827', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
          {label}
        </span>
        <span style={{ fontSize: 9, color: '#6B7280', whiteSpace: 'nowrap' }}>
          Network Health
        </span>
      </div>
      {/* Tiny sparkline */}
      <svg width="46" height="16" viewBox="0 0 46 16" style={{ flexShrink: 0, marginLeft: 2 }}>
        <polyline points="0,10 6,9 12,11 18,7 24,8 30,5 36,7 42,4 46,6"
                  fill="none" stroke="#10B981" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/**
 * Toggle button for "Focus related" — when ON, hovering / selecting a device
 * dims all unrelated cables and nodes to help trace a specific device's links.
 */
function FocusRelatedButton() {
  const focusRelated = useStore(s => s.focusRelated);
  const toggle = useStore(s => s.toggleFocusRelated);
  return (
    <IconBtn
      title={focusRelated
        ? 'Подсветка связей включена — наведи курсор на устройство, чтобы приглушить остальные'
        : 'Подсветка связей выключена — все кабели показаны одинаково'}
      onClick={toggle}
      active={focusRelated}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {focusRelated ? (
          // "eye" — focus/hide-siblings mode is on
          <>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </>
        ) : (
          // "eye-off" — everything visible, no dimming
          <>
            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.77 19.77 0 0 1 5.06-5.94M9.9 4.24A10.05 10.05 0 0 1 12 4c7 0 11 8 11 8a19.5 19.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </>
        )}
      </svg>
    </IconBtn>
  );
}

/** Bell icon with alert count badge and a dropdown listing recent ping alerts. */
/**
 * v0.35.6 — Notification centre.
 *
 * Now covers not just ping alerts but also errors caught by ErrorBoundary,
 * import/export events, drag-connect notifications, etc. Everything the app
 * wants to tell the sysadmin flows through here.
 *
 * Badge:
 *   count = UNREAD entries (read once the user opens the dropdown)
 *   color = red if any critical, amber if any warn, blue otherwise
 * Filter tabs: All / Errors / Ping / Events
 */
function AlertsButton() {
  const alerts = useStore(s => s.alerts);
  const clearAlerts = useStore(s => s.clearAlerts);
  const markAllRead = useStore(s => s.markAllAlertsRead);
  const select = useStore(s => s.select);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'critical' | 'ping' | 'app'>('all');

  const unread = alerts.filter(a => !a.read).length;
  const anyCritical = alerts.some(a => !a.read && a.severity === 'critical');
  const anyWarn = alerts.some(a => !a.read && a.severity === 'warn');
  const badgeColor = anyCritical ? '#EF4444' : anyWarn ? '#F59E0B' : '#2563EB';

  const filtered = alerts.filter(a => {
    if (filter === 'all') return true;
    if (filter === 'critical') return a.severity === 'critical' || a.severity === 'warn' || a.origin === 'error';
    if (filter === 'ping') return a.origin === 'ping';
    if (filter === 'app') return a.origin !== 'ping';
    return true;
  });

  const toggle = () => {
    setOpen(v => {
      const next = !v;
      // Mark everything read on OPEN so the badge clears immediately.
      if (next) setTimeout(() => markAllRead(), 0);
      return next;
    });
  };

  const copyAll = async () => {
    const text = alerts.map(a =>
      `[${new Date(a.ts).toLocaleString()}] ` +
      `${(a.severity || 'info').toUpperCase()} · ${a.origin || 'app'}` +
      (a.title ? ` — ${a.title}` : '') +
      `\n${a.message}` +
      (a.deviceName ? `\n(device: ${a.deviceName})` : '')
    ).join('\n\n');
    try { await navigator.clipboard.writeText(text); } catch { /* noop */ }
  };

  return (
    <div style={{ position: 'relative' }}>
      <IconBtn title={unread > 0 ? `${unread} новых уведомлений` : (alerts.length ? `${alerts.length} уведомлений в истории` : 'Уведомлений нет')}
               onClick={toggle} active={open}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/>
        </svg>
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            minWidth: 14, height: 14, padding: '0 3px',
            background: badgeColor, color: '#FFFFFF',
            borderRadius: 7, fontSize: 9, fontWeight: 700, lineHeight: '14px',
            textAlign: 'center', boxShadow: '0 0 0 2px #FFFFFF',
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </IconBtn>
      {open && (
        <>
          <div onClick={() => setOpen(false)}
               style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
          <div style={{
            position: 'absolute', top: '110%', right: 0, zIndex: 30,
            width: 380, maxHeight: 480, display: 'flex', flexDirection: 'column',
            background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 10,
            boxShadow: '0 12px 28px rgba(15,23,42,0.14)',
            padding: 0, overflow: 'hidden',
          }}>
            <div style={{
              padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8,
              borderBottom: '1px solid #F3F4F6',
            }}>
              <b style={{ fontSize: 12, color: '#111827' }}>Уведомления</b>
              <span style={{ fontSize: 10, color: '#9CA3AF' }}>· всего {alerts.length}</span>
              <div style={{ flex: 1 }} />
              {alerts.length > 0 && (
                <>
                  <button onClick={copyAll} title="Скопировать все в буфер"
                          style={{ background: 'transparent', border: 'none', color: '#6B7280',
                                   cursor: 'pointer', fontSize: 11, padding: 0 }}>
                    Копировать
                  </button>
                  <span style={{ color: '#D1D5DB', fontSize: 10 }}>·</span>
                  <button onClick={() => { clearAlerts(); setOpen(false); }}
                          style={{ background: 'transparent', border: 'none', color: '#DC2626',
                                   cursor: 'pointer', fontSize: 11, padding: 0 }}>
                    Очистить
                  </button>
                </>
              )}
            </div>
            {alerts.length > 0 && (
              <div style={{ display: 'flex', gap: 4, padding: '6px 8px',
                            borderBottom: '1px solid #F3F4F6', background: '#F9FAFB' }}>
                {([
                  ['all',      'Все',      alerts.length],
                  ['critical', 'Ошибки',   alerts.filter(a => a.severity === 'critical' || a.severity === 'warn' || a.origin === 'error').length],
                  ['ping',     'Ping',     alerts.filter(a => a.origin === 'ping').length],
                  ['app',      'События',  alerts.filter(a => a.origin !== 'ping').length],
                ] as const).map(([k, label, n]) => (
                  <button key={k} onClick={() => setFilter(k as any)}
                          style={{
                            padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                            border: 'none', cursor: 'pointer',
                            background: filter === k ? '#EFF6FF' : 'transparent',
                            color: filter === k ? '#1D4ED8' : '#6B7280',
                          }}>
                    {label} <span style={{ opacity: 0.6 }}>{n}</span>
                  </button>
                ))}
              </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filtered.length === 0 && (
                <div style={{ padding: '32px 12px', textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>
                  {alerts.length === 0
                    ? <>Пока ничего.<br/>Здесь появятся события мониторинга,<br/>ошибки и оповещения приложения.</>
                    : <>Нет уведомлений в этом фильтре.</>}
                </div>
              )}
              {filtered.map(a => <AlertRow key={a.id} entry={a}
                                            onClick={() => {
                                              if (a.deviceId) select(a.deviceId);
                                              setOpen(false);
                                            }} />)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** One row inside the notification dropdown. */
function AlertRow({ entry, onClick }: { entry: import('./store').AlertEntry; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const sev = entry.severity || 'info';
  const dotColor =
    sev === 'critical' ? '#EF4444' :
    sev === 'warn'     ? '#F59E0B' :
    sev === 'success'  ? '#10B981' :
                          '#3B82F6';
  const bg =
    sev === 'critical' ? '#FEF2F2' :
    sev === 'warn'     ? '#FFFBEB' :
    sev === 'success'  ? '#ECFDF5' :
                          '#FFFFFF';
  return (
    <div onClick={onClick}
         onMouseEnter={() => setHover(true)}
         onMouseLeave={() => setHover(false)}
         style={{
           padding: '8px 12px',
           borderBottom: '1px solid #F3F4F6',
           display: 'flex', gap: 8, alignItems: 'flex-start',
           cursor: entry.deviceId ? 'pointer' : 'default',
           background: hover ? '#F9FAFB' : (entry.read ? '#FFFFFF' : bg),
           transition: 'background 0.1s',
         }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', marginTop: 5,
        background: dotColor, flexShrink: 0,
        boxShadow: entry.read ? 'none' : `0 0 0 3px ${dotColor}22`,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {entry.title && (
          <div style={{ fontSize: 11, fontWeight: 600, color: '#111827', lineHeight: 1.35 }}>
            {entry.title}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.4,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      maxHeight: 100, overflow: 'hidden' }}>
          {entry.message}
        </div>
        <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2,
                      display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>{new Date(entry.ts).toLocaleString()}</span>
          {entry.origin && entry.origin !== 'app' && (
            <>
              <span>·</span>
              <span style={{ textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>
                {entry.origin}
              </span>
            </>
          )}
          {entry.deviceName && (
            <>
              <span>·</span>
              <span style={{ color: '#2563EB' }}>{entry.deviceName}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Question-mark icon opening a modal with quick help / hotkeys. */
/**
 * v0.36.1: HelpButton больше не рендерит IconBtn (иконка «?» уехала в AppMenu).
 * Остался невидимый listener — слушает `netmap:open-dialog` (из AppMenu) и
 * показывает модальное окно. Компонент оставлен под тем же именем чтобы не
 * ломать импорты в других местах.
 */
function HelpButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const name = (e as CustomEvent<{ name: string }>).detail?.name;
      if (name === 'help') setOpen(true);
    };
    window.addEventListener('netmap:open-dialog', onOpen as EventListener);
    return () => window.removeEventListener('netmap:open-dialog', onOpen as EventListener);
  }, []);
  return open ? <HelpModal onClose={() => setOpen(false)} /> : null;
}

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
      zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 520, maxHeight: '80vh', overflowY: 'auto',
        background: '#FFFFFF', borderRadius: 12,
        boxShadow: '0 20px 60px rgba(15,23,42,0.30)',
        padding: '22px 26px', color: '#111827',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <b style={{ fontSize: 16 }}>Быстрая справка</b>
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: 'transparent', border: '1px solid #E5E7EB',
            color: '#6B7280', width: 28, height: 28, borderRadius: 6,
            cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0,
          }}>×</button>
        </div>

        <HelpSection title="Работа со схемой">
          <HelpRow k="Двойной клик по устройству" v="Focus mode — крупный вид с портами" />
          <HelpRow k="Клик" v="Выделить, открыть детали в правой панели" />
          <HelpRow k="Ctrl / Shift + клик" v="Мультивыделение устройств" />
          <HelpRow k="Наведение на устройство" v="Подсвечивает связанные (см. иконка глаза)" />
          <HelpRow k="ПКМ" v="Контекстное меню" />
          <HelpRow k="Перетаскивание" v="Устройства раздвигают друг друга (collision)" />
        </HelpSection>

        <HelpSection title="Горячие клавиши">
          <HelpRow k="Ctrl+K / ⌘K" v="Фокус на поиск" />
          <HelpRow k="Ctrl+Z / Ctrl+Y" v="Отменить / повторить" />
          <HelpRow k="Delete" v="Удалить выделенное" />
          <HelpRow k="T" v="Режим ножа (обрезать кабели)" />
          <HelpRow k="Esc" v="Закрыть модалку / focus mode" />
          <HelpRow k="F2" v="Переименовать выделенное" />
        </HelpSection>

        <HelpSection title="Синтаксис поиска">
          <HelpRow k="vlan:10" v="Устройства в VLAN 10" />
          <HelpRow k="kind:switch,router" v="По типу устройства" />
          <HelpRow k="ip:192.168" v="По префиксу IP" />
          <HelpRow k="status:down" v="Не отвечают на ping" />
          <HelpRow k="tag:cctv" v="По тегу" />
        </HelpSection>

        <HelpSection title="Плавающая кнопка">
          <HelpRow k="Разложить" v="Автоматическая раскладка по Cisco 3-tier" />
        </HelpSection>

        <div style={{
          marginTop: 16, padding: 12, background: '#F9FAFB',
          border: '1px solid #E5E7EB', borderRadius: 8,
          fontSize: 11, color: '#6B7280', lineHeight: 1.5,
        }}>
          <b style={{ color: '#111827' }}>Совет:</b> начните с готовой схемы отеля (File → Сбросить к «Усадьбе»),
          затем нажмите синюю плавающую кнопку в правом верхнем углу канваса, чтобы схема разложилась красиво.
        </div>
      </div>
    </div>
  );
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280',
                    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ display: 'grid', gap: 4 }}>{children}</div>
    </div>
  );
}
function HelpRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10, fontSize: 12 }}>
      <span style={{
        fontFamily: 'ui-monospace, monospace', fontSize: 11,
        color: '#374151', background: '#F3F4F6', padding: '1px 6px', borderRadius: 4,
        width: 'fit-content',
      }}>{k}</span>
      <span style={{ color: '#6B7280' }}>{v}</span>
    </div>
  );
}

function IconBtn({ title, children, onClick, active }: {
  title: string; children: React.ReactNode; onClick?: () => void; active?: boolean;
}) {
  return (
    <button onClick={onClick} title={title} style={{
      background: active ? '#F3F4F6' : 'transparent',
      border: '1px solid ' + (active ? '#E5E7EB' : 'transparent'),
      color: '#374151',
      width: 34, height: 34, borderRadius: 6,
      cursor: 'pointer', padding: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}
    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = '#F3F4F6'; }}
    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
      {children}
    </button>
  );
}

// ---- Styles ----

const bar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4,
  padding: '8px 12px', background: '#FFFFFF', borderBottom: '1px solid #E5E7EB',
  position: 'relative', zIndex: 10, flexShrink: 0,
};
const logoWrap: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginRight: 6,
};
const logoMark: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  background: 'linear-gradient(135deg, #2563EB 0%, #7C3AED 100%)',
  color: '#FFFFFF', fontSize: 15, fontWeight: 800,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'ui-monospace, monospace',
};
const logoText: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: '#111827', letterSpacing: -0.2,
};
const search: React.CSSProperties = {
  width: '100%', background: '#F9FAFB', border: '1px solid #E5E7EB', color: '#111827',
  padding: '8px 60px 8px 32px', borderRadius: 6, fontSize: 13, outline: 'none',
};
const searchIcon: React.CSSProperties = {
  position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
  color: '#9CA3AF', pointerEvents: 'none',
};
const kbdHint: React.CSSProperties = {
  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
  fontSize: 10, color: '#6B7280', background: '#F3F4F6',
  border: '1px solid #E5E7EB', borderRadius: 4, padding: '1px 5px',
  fontFamily: 'ui-monospace, monospace',
};
const dropdown: React.CSSProperties = {
  position: 'absolute', top: '110%', left: 0, right: 0, zIndex: 20,
  background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8,
  boxShadow: '0 8px 24px rgba(15,23,42,0.10)', overflow: 'hidden',
};
const ddItem: React.CSSProperties = {
  padding: '8px 10px', cursor: 'pointer', fontSize: 12,
  borderBottom: '1px solid #F3F4F6', color: '#111827',
};
const codeHint: React.CSSProperties = {
  background: '#F3F4F6', padding: '0 4px', borderRadius: 3,
  fontFamily: 'ui-monospace, monospace', fontSize: 10, color: '#374151',
};

