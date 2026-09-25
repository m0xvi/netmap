/**
 * v0.61.0 — ToolsStrip: горизонтальная панель инструментов в стиле draw.io.
 *
 * Закреплена сверху (под Toolbar, на всю ширину окна) и собирает в одном
 * месте все инструменты, которыми можно пользоваться на карте:
 *   История (отмена/повтор) · Карта (fit, нож, связи) · Раскладка
 *   (умная, сверху-вниз, развернуть/свернуть свитчи) · Данные (discovery,
 *   импорты, traceroute, Vault) · Экспорт (PNG/SVG/JSON).
 *
 * Обработчики — те же самые действия, что в LayoutFAB и меню Tools
 * (те же store-функции и window-события), дублирования логики нет:
 * FAB/меню оставлены как есть, полоса — быстрый доступ в один клик.
 *
 * Сворачивается шевроном справа; состояние хранится в store
 * (toolsStripOpen) и переживает перезапуск через localStorage.
 */

import { Fragment, useState } from 'react';
import { useStore } from './store';
import { alertDialog } from './Modal';
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

  // Те же действия раскладки, что в LayoutFAB (прогресс + автовыкладка).
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
        autoLayout(dir, groupBy ? { groupBy } : undefined);
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
        id: 'smart', title: 'Умная раскладка · гибрид (локации / VLAN / подсети)',
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
    <div style={{
      display: 'flex', alignItems: 'center', gap: 2, padding: '3px 8px',
      background: '#FFFFFF', borderBottom: '1px solid #E2E8F0',
      overflowX: 'auto', flexShrink: 0,
    }}>
      {groups.map((g, gi) => (
        <Fragment key={gi}>
          {gi > 0 && <Divider />}
          {g.map(d => <ToolBtn key={d.id} def={d} />)}
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
  );
}
