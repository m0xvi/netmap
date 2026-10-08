/**
 * v0.61.0 — ToolsStrip: горизонтальная панель инструментов в стиле draw.io.
 *
 * Закреплена сверху (под Toolbar, на всю ширину окна) и собирает в одном
 * месте все инструменты, которыми можно пользоваться на карте:
 *   История (отмена/повтор) · Карта (fit, нож, связи) · Раскладка
 *   (умная, сверху-вниз, развернуть/свернуть свитчи) · Данные (discovery,
 *   импорты, traceroute, Vault) · Экспорт (PNG/SVG/JSON).
 *
 * Обработчики — те же самые действия, что в меню Tools/Вид
 * (те же store-функции и window-события), дублирования логики нет.
 *
 * v0.63.0: плавающая кнопка LayoutFAB удалена вместе со своим дублирующим
 * фан-меню — все её действия жили и здесь. Единственное, что было только на
 * FAB, — выбор стратегии группировки умной раскладки. Он переехал сюда:
 * «Умная раскладка» стала split-кнопкой (иконка — гибрид в один клик,
 * шеврон — меню стратегий: локации / VLAN / подсети / гибрид).
 *
 * Сворачивается шевроном справа; состояние хранится в store
 * (toolsStripOpen) и переживает перезапуск через localStorage.
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { alertDialog } from './Modal';
import { summarizeAutoGrouping } from './smartLayout';
import { exportPng, exportSvg, exportJson } from './exportCanvas';

/** Иконка 16×16 в стиле feather (stroke = currentColor). Только SVG, без emoji. */
function TIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0 }}>
      {children}
    </svg>
  );
}

const P = {
  undo: (<Fragment><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-4" /></Fragment>),
  redo: (<Fragment><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h4" /></Fragment>),
  fit: (<Fragment>
    <path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" />
    <path d="M8 21H5a2 2 0 0 1-2-2v-3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" />
  </Fragment>),
  knife: (<Fragment><path d="M14.5 3l6.5 6.5-11 11H3v-7z" /><path d="M13 6l5 5" /></Fragment>),
  hideEdges: (<Fragment>
    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.85 20.85 0 0 1 5.36-5.51" />
    <path d="M22.54 11.88A20.29 20.29 0 0 0 12 4a10.86 10.86 0 0 0-2 .19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </Fragment>),
  showEdges: (<Fragment><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></Fragment>),
  smart: (<path d="M12 2l3 6 6 1-4.5 4.5L18 20l-6-3-6 3 1.5-6.5L3 9l6-1z" />),
  layout: (<Fragment>
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
  </Fragment>),
  expand: (<Fragment>
    <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
  </Fragment>),
  collapse: (<Fragment>
    <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
    <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
  </Fragment>),
  discovery: (<Fragment><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></Fragment>),
  mikrotik: (<Fragment>
    <rect x="4" y="13" width="16" height="7" rx="2" />
    <line x1="8" y1="13" x2="8" y2="6" /><line x1="16" y1="13" x2="16" y2="6" />
    <circle cx="8" cy="4.5" r="1" /><circle cx="16" cy="4.5" r="1" />
  </Fragment>),
  import: (<Fragment>
    <path d="M12 3v12" /><polyline points="7 10 12 15 17 10" /><path d="M4 19h16" />
  </Fragment>),
  traceroute: (<Fragment>
    <circle cx="5" cy="19" r="2" /><circle cx="19" cy="5" r="2" />
    <path d="M5 17V10a4 4 0 0 1 4-4h8" />
  </Fragment>),
  vault: (<Fragment><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Fragment>),
  png: (<Fragment><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="1.5" /><path d="M21 15l-6-6-9 9" /></Fragment>),
  svg: (<Fragment><path d="M4 4h16v16H4z" /><path d="M8 12l3 3 5-7" /></Fragment>),
  json: (<Fragment>
    <path d="M6 4h9l4 4v12H6z" /><path d="M14 4v5h5" />
    <path d="M9 13l1.5 1.5L9 16M15 13l-1.5 1.5L15 16" />
  </Fragment>),
  chevUp: (<polyline points="6 15 12 9 18 15" />),
  chevDown: (<polyline points="6 9 12 15 18 9" />),
  wrench: (<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />),
};

interface ToolDef {
  id: string;
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Подсветка включённого тумблера (нож, связи). */
  active?: boolean;
  /** Красная подсветка вместо синей (нож включён). */
  dangerActive?: boolean;
}

function ToolBtn({ def }: { def: ToolDef }) {
  const [hov, setHov] = useState(false);
  const bg = def.disabled
    ? 'transparent'
    : def.active
      ? (def.dangerActive ? '#FEE2E2' : '#DBEAFE')
      : hov ? '#F1F5F9' : 'transparent';
  const fg = def.disabled
    ? '#94A3B8'
    : def.active
      ? (def.dangerActive ? '#B91C1C' : '#1D4ED8')
      : '#334155';
  return (
    <button
      title={def.title}
      disabled={def.disabled}
      onClick={def.onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 30, height: 30, flexShrink: 0, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        border: 'none', borderRadius: 6, background: bg, color: fg,
        cursor: def.disabled ? 'not-allowed' : 'pointer',
        opacity: def.disabled ? 0.45 : 1,
      }}
    >
      <TIcon>{def.icon}</TIcon>
    </button>
  );
}

const Divider = () => (
  <div style={{ width: 1, height: 20, background: '#E2E8F0', margin: '0 5px', flexShrink: 0 }} />
);

// ---------------------------------------------------------------------------
// v0.63.0: стратегии «умной раскладки».
// Меню переехало сюда с удалённой плавающей кнопки LayoutFAB — там оно было
// единственным местом выбора стратегии, а сама кнопка дублировала полосу.

type GroupStrategy = 'hybrid' | 'location' | 'vlan' | 'ip';

const SMART_STRATEGIES: Array<{ id: GroupStrategy; title: string; subtitle: string }> = [
  { id: 'hybrid',   title: 'Гибрид (рекомендуется)', subtitle: 'Локация → VLAN → подсеть /24' },
  { id: 'location', title: 'Только по локациям',     subtitle: 'device.location: «Ресепшн», «Серверная», …' },
  { id: 'vlan',     title: 'Только по VLAN',         subtitle: 'Порт.vlan / trunk.vlans / link.vlan' },
  { id: 'ip',       title: 'Только по подсети /24',  subtitle: 'IP-адрес устройства' },
];

/** Split-кнопка: иконка — «умная раскладка» (гибрид) в один клик,
 *  шеврон — выбор стратегии группировки. */
function SmartSplit({ def, menuOpen, onToggleMenu }: {
  def: ToolDef; menuOpen: boolean; onToggleMenu: () => void;
}) {
  const [hovMain, setHovMain] = useState(false);
  const [hovCaret, setHovCaret] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      <button
        title={def.title}
        onClick={def.onClick}
        onMouseEnter={() => setHovMain(true)}
        onMouseLeave={() => setHovMain(false)}
        style={{
          width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', padding: 0,
          borderTopLeftRadius: 6, borderBottomLeftRadius: 6,
          background: hovMain ? '#F1F5F9' : 'transparent',
          color: '#334155', cursor: 'pointer',
        }}
      >
        <TIcon>{def.icon}</TIcon>
      </button>
      <button
        title="Стратегия раскладки: локации / VLAN / подсети / радиальная"
        onClick={onToggleMenu}
        onMouseEnter={() => setHovCaret(true)}
        onMouseLeave={() => setHovCaret(false)}
        style={{
          width: 15, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', padding: 0,
          borderTopRightRadius: 6, borderBottomRightRadius: 6,
          background: menuOpen ? '#DBEAFE' : hovCaret ? '#F1F5F9' : 'transparent',
          color: menuOpen ? '#1D4ED8' : '#94A3B8', cursor: 'pointer',
        }}
      >
        <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
             style={{ display: 'block' }}>{P.chevDown}</svg>
      </button>
    </div>
  );
}

/** Меню стратегий. position: fixed — потому что полоса имеет overflow-x: auto
 *  и absolute-поповер внутри неё обрезался бы по вертикали. */
function SmartMenu({ pos, onPick, onRadial }: {
  pos: { top: number; left: number };
  onPick: (g: GroupStrategy) => void;
  onRadial: () => void;
}) {
  const [hov, setHov] = useState<GroupStrategy | null>(null);
  const [hovRadial, setHovRadial] = useState(false);
  return (
    <div data-netmap-overlay="true" style={{
      position: 'fixed', top: pos.top, left: pos.left, zIndex: 9000,
      background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10,
      boxShadow: '0 12px 32px rgba(15,23,42,0.18)', padding: 6, minWidth: 266,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase',
        letterSpacing: 0.6, padding: '4px 8px 6px',
      }}>
        Стратегия группировки
      </div>
      {SMART_STRATEGIES.map(s => (
        <button
          key={s.id}
          onClick={() => onPick(s.id)}
          onMouseEnter={() => setHov(s.id)}
          onMouseLeave={() => setHov(null)}
          style={{
            display: 'block', width: '100%', textAlign: 'left', border: 'none',
            background: hov === s.id ? '#F1F5F9' : 'transparent',
            borderRadius: 8, padding: '7px 8px', cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: '#0F172A' }}>{s.title}</div>
          <div style={{ fontSize: 10, color: '#64748B', marginTop: 1 }}>{s.subtitle}</div>
        </button>
      ))}
      {/* v0.66.0: радиальная геометрия — не группировка, поэтому отделена. */}
      <div style={{ borderTop: '1px solid #F1F5F9', margin: '4px 6px 2px' }} />
      <button
        onClick={onRadial}
        onMouseEnter={() => setHovRadial(true)}
        onMouseLeave={() => setHovRadial(false)}
        style={{
          display: 'block', width: '100%', textAlign: 'left', border: 'none',
          background: hovRadial ? '#F1F5F9' : 'transparent',
          borderRadius: 8, padding: '7px 8px', cursor: 'pointer',
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: '#0F172A' }}>Радиальная · «радуга»</div>
        <div style={{ fontSize: 10, color: '#64748B', marginTop: 1 }}>Ядро в центре, хабы по орбите, клиенты дугами</div>
      </button>
      <div style={{
        borderTop: '1px solid #F1F5F9', marginTop: 4, padding: '7px 8px 3px',
        fontSize: 10, color: '#94A3B8', lineHeight: 1.45,
      }}>
        Классическая раскладка без группировки — соседняя кнопка
      </div>
    </div>
  );
}

const FLAG_KEY = 'netmap:layoutDone';
function markLayoutDone(projectId: string) {
  try {
    const raw = localStorage.getItem(FLAG_KEY) || '';
    const set = new Set(raw.split(',').filter(Boolean));
    set.add(projectId);
    localStorage.setItem(FLAG_KEY, Array.from(set).join(','));
  } catch { /* noop */ }
}

export function ToolsStrip() {
  const open = useStore(s => s.toolsStripOpen);
  const toggle = useStore(s => s.toggleToolsStrip);
  const autoLayout = useStore(s => s.autoLayout);
  const undo = useStore(s => s.undo);
  const redo = useStore(s => s.redo);
  const historyLen = useStore(s => s.history.length);
  const futureLen = useStore(s => s.future.length);
  const knifeMode = useStore(s => s.knifeMode);
  const toggleKnifeMode = useStore(s => s.toggleKnifeMode);
  const hideEdges = useStore(s => s.hideEdges);
  const toggleHideEdges = useStore(s => s.toggleHideEdges);
  const setAllRackDisplay = useStore(s => s.setAllRackDisplay);
  const activeId = useStore(s => s.workspace?.activeId || 'default');

  // Действия раскладки: прогресс-оверлей + автовыкладка (то же, что в меню «Вид»).
  const doLayout = (
    dir: 'TB' | 'LR' = 'TB',
    groupBy?: 'none' | 'hybrid' | 'location' | 'vlan' | 'ip',
  ) => {
    const isSmart = groupBy && groupBy !== 'none';
    window.dispatchEvent(new CustomEvent('netmap:progress-start', {
      detail: {
        id: 'auto-layout',
        title: isSmart ? 'Умная раскладка' : 'Автораскладка схемы',
        message: isSmart
          ? 'Группируем по локациям / VLAN / подсетям…'
          : 'Рассчитываем иерархию (dagre)…',
      },
    }));
    requestAnimationFrame(() => {
      try {
        // v0.67: честная обратная связь — что стратегия фактически сделала.
        const before = useStore.getState().doc;
        autoLayout(dir, groupBy ? { groupBy } : undefined);
        const after = useStore.getState().doc;
        if (isSmart) {
          const grouped = after.devices.filter(d => (d.groupId || '').startsWith('auto-')).length;
          const msg = grouped > 0
            ? summarizeAutoGrouping(before, after)
            : 'Не нашлось данных для группировки (локации / VLAN / IP) — карта разложена без групп.';
          useStore.getState().pushAlert({ severity: 'info', origin: 'user', title: 'Умная раскладка', message: msg });
        }
        markLayoutDone(activeId);
      } finally {
        window.dispatchEvent(new CustomEvent('netmap:progress-end',
          { detail: { id: 'auto-layout' } }));
      }
    });
  };

  // v0.66.0: радиальная раскладка «радуга» (макет C) — отдельная геометрия,
  // не группировка: ядро в центре, хабы по орбите, клиенты дугами.
  const doRadial = () => {
    window.dispatchEvent(new CustomEvent('netmap:progress-start', {
      detail: {
        id: 'auto-layout',
        title: 'Радиальная раскладка',
        message: 'Ядро — в центр, хабы — по орбите…',
      },
    }));
    requestAnimationFrame(() => {
      try {
        useStore.getState().radialLayout();
        markLayoutDone(activeId);
      } finally {
        window.dispatchEvent(new CustomEvent('netmap:progress-end',
          { detail: { id: 'auto-layout' } }));
      }
    });
  };

  const doExpandCollapse = (mode: 'rack' | 'compact') => {
    const id = mode === 'rack' ? 'expand-all' : 'collapse-all';
    window.dispatchEvent(new CustomEvent('netmap:progress-start', {
      detail: {
        id,
        title: mode === 'rack' ? 'Разворачиваем свитчи' : 'Сворачиваем свитчи',
        message: mode === 'rack'
          ? 'Меняем режим отображения и пересчитываем схему…'
          : 'Пересчитываем схему…',
      },
    }));
    requestAnimationFrame(() => {
      try {
        setAllRackDisplay(mode);
        setTimeout(() => {
          try {
            if (mode === 'rack') useStore.getState().autoLayout('TB', { preserveDisplay: true });
            else useStore.getState().autoLayout('TB');
          } finally {
            window.dispatchEvent(new CustomEvent('netmap:progress-end', { detail: { id } }));
          }
        }, 30);
      } catch (e) {
        window.dispatchEvent(new CustomEvent('netmap:progress-end', { detail: { id } }));
        throw e;
      }
    });
  };

  const fire = (name: string, detail?: unknown) =>
    window.dispatchEvent(new CustomEvent(name, detail === undefined ? undefined : { detail }));

  // v0.63.0: меню стратегий «умной раскладки» (переехало с удалённого LayoutFAB).
  const [smartMenu, setSmartMenu] = useState(false);
  const [smartPos, setSmartPos] = useState<{ top: number; left: number } | null>(null);
  const smartAnchorRef = useRef<HTMLSpanElement>(null);

  const closeSmartMenu = () => { setSmartMenu(false); setSmartPos(null); };

  const toggleSmartMenu = () => {
    if (smartMenu) { closeSmartMenu(); return; }
    const r = smartAnchorRef.current?.getBoundingClientRect();
    setSmartPos({
      top: r ? r.bottom + 4 : 44,
      left: r ? Math.max(8, Math.min(r.left, window.innerWidth - 282)) : 8,
    });
    setSmartMenu(true);
  };

  // Закрытие: Escape, клик мимо, скролл/ресайз, сворачивание полосы.
  useEffect(() => {
    if (!open) { setSmartMenu(false); setSmartPos(null); return; }
    if (!smartMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSmartMenu(); };
    const onDown = (e: MouseEvent) => {
      // target может быть не-узлом (например, само window) — тогда меню закрываем,
      // а не бросаем исключение на contains().
      const t = e.target as unknown as Node | null;
      const inside = !!t && typeof (t as Node).nodeType === 'number'
        && !!smartAnchorRef.current?.contains(t);
      if (!inside) closeSmartMenu();
    };
    const onViewport = () => closeSmartMenu();
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onViewport);
    window.addEventListener('scroll', onViewport, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onViewport);
      window.removeEventListener('scroll', onViewport, true);
    };
  }, [smartMenu, open]);

  const pickStrategy = (g: GroupStrategy) => {
    doLayout('TB', g);
    closeSmartMenu();
  };

  const groups: ToolDef[][] = [
    // История
    [
      {
        id: 'undo', title: `Отменить · Ctrl+Z${historyLen ? ` (${historyLen})` : ''}`,
        icon: P.undo, disabled: historyLen === 0, onClick: () => undo(),
      },
      {
        id: 'redo', title: `Повторить · Ctrl+Y${futureLen ? ` (${futureLen})` : ''}`,
        icon: P.redo, disabled: futureLen === 0, onClick: () => redo(),
      },
    ],
    // Карта
    [
      { id: 'fit', title: 'Вписать схему в экран (F)', icon: P.fit, onClick: () => fire('netmap:fit-view') },
      {
        id: 'knife', title: knifeMode ? 'Отключить нож' : 'Нож · обрезать кабель (T)',
        icon: P.knife, active: knifeMode, dangerActive: knifeMode, onClick: () => toggleKnifeMode(),
      },
      {
        id: 'hideEdges', title: hideEdges ? 'Показать связи' : 'Скрыть все связи',
        icon: hideEdges ? P.showEdges : P.hideEdges, active: hideEdges,
        onClick: () => toggleHideEdges(),
      },
    ],
    // Раскладка
    [
      {
        id: 'smart', title: 'Умная раскладка · гибрид (локации / VLAN / подсети). Шеврон справа — выбор стратегии',
        icon: P.smart, onClick: () => doLayout('TB', 'hybrid'),
      },
      { id: 'layout', title: 'Разложить схему · сверху вниз', icon: P.layout, onClick: () => doLayout('TB') },
      { id: 'expand', title: 'Развернуть все свитчи', icon: P.expand, onClick: () => doExpandCollapse('rack') },
      { id: 'collapse', title: 'Свернуть все свитчи', icon: P.collapse, onClick: () => doExpandCollapse('compact') },
    ],
    // Данные
    [
      { id: 'discovery', title: 'Автообнаружение устройств…', icon: P.discovery, onClick: () => fire('netmap:open-discovery') },
      { id: 'mikrotik', title: 'Импорт из MikroTik…', icon: P.mikrotik, onClick: () => fire('netmap:open-mikrotik-import') },
      { id: 'import', title: 'Импорт… (UniFi / Omada / другой)', icon: P.import, onClick: () => fire('netmap:open-import-dialog') },
      { id: 'traceroute', title: 'Traceroute…', icon: P.traceroute, onClick: () => fire('netmap:open-traceroute', {}) },
      { id: 'vault', title: 'Vault Studio · пароли (Ctrl+K)', icon: P.vault, onClick: () => fire('netmap:open-vault-studio') },
    ],
    // Экспорт
    [
      {
        id: 'png', title: 'Экспорт в PNG', icon: P.png,
        onClick: () => {
          exportPng(useStore.getState().doc.name)
            .catch((e) => { void alertDialog('Ошибка экспорта', String((e as Error)?.message || e)); });
        },
      },
      {
        id: 'svg', title: 'Экспорт в SVG', icon: P.svg,
        onClick: () => {
          exportSvg(useStore.getState().doc.name)
            .catch((e) => { void alertDialog('Ошибка экспорта', String((e as Error)?.message || e)); });
        },
      },
      {
        id: 'json', title: 'Экспорт в JSON', icon: P.json,
        onClick: () => exportJson(useStore.getState().doc.name),
      },
    ],
  ];

  if (!open) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px',
        background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', flexShrink: 0,
      }}>
        <button
          title="Показать панель инструментов"
          onClick={toggle}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, border: 'none',
            background: 'transparent', borderRadius: 6, padding: '3px 6px',
            color: '#64748B', fontSize: 12, cursor: 'pointer',
          }}
        >
          <TIcon>{P.wrench}</TIcon>
          <span>Инструменты</span>
          <TIcon>{P.chevDown}</TIcon>
        </button>
      </div>
    );
  }

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, padding: '3px 8px',
        background: '#FFFFFF', borderBottom: '1px solid #E2E8F0',
        overflowX: 'auto', flexShrink: 0,
      }}>
        {groups.map((g, gi) => (
          <Fragment key={gi}>
            {gi > 0 && <Divider />}
            {g.map(d => d.id === 'smart' ? (
              <span key={d.id} ref={smartAnchorRef} style={{ display: 'inline-flex', flexShrink: 0 }}>
                <SmartSplit def={d} menuOpen={smartMenu} onToggleMenu={toggleSmartMenu} />
              </span>
            ) : (
              <ToolBtn key={d.id} def={d} />
            ))}
          </Fragment>
        ))}
        <div style={{ flex: 1, minWidth: 8 }} />
        <button
          title="Свернуть панель инструментов"
          onClick={toggle}
          style={{
            width: 30, height: 30, flexShrink: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            border: 'none', borderRadius: 6, background: 'transparent',
            color: '#64748B', cursor: 'pointer',
          }}
        >
          <TIcon>{P.chevUp}</TIcon>
        </button>
      </div>
      {smartMenu && smartPos && (
        <SmartMenu
          pos={smartPos}
          onPick={pickStrategy}
          onRadial={() => { doRadial(); closeSmartMenu(); }}
        />
      )}
    </>
  );
}
