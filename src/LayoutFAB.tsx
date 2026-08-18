/**
 * v0.35.7 — Floating action button with **fan-out radial menu**.
 *
 * When collapsed: a single circular blue button in the bottom-right corner
 * (like on the user's mockup screenshot — a solid blue circle with a 2×2
 * grid icon). When clicked: 6-7 action icons slide OUT to the LEFT with a
 * spring-like stagger, each pinned above/next to the main button. Click
 * again → the icons slide back INTO the main button.
 *
 * Actions (kept close to the old kebab-menu contents):
 *   Undo (Ctrl+Z)
 *   Redo (Ctrl+Y)
 *   Knife / cut cable mode (T)
 *   Auto-layout (top-down)
 *   Expand all / Collapse all
 *   Export PNG / SVG / JSON
 * All these are used often enough to deserve one-tap access without a menu.
 *
 * Uses CSS transitions on transform + opacity so the fan-out feels
 * "elastic". Escape closes.
 */

import { useEffect, useMemo, useState } from 'react';
import { useStore } from './store';
import { alertDialog } from './Modal';
import { exportPng, exportSvg, exportJson } from './exportCanvas';

const FLAG_KEY = 'netmap:layoutDone';

function isLayoutDoneFor(projectId: string): boolean {
  try {
    const raw = localStorage.getItem(FLAG_KEY);
    if (!raw) return false;
    return new Set(raw.split(',')).has(projectId);
  } catch { return false; }
}
function markLayoutDone(projectId: string) {
  try {
    const raw = localStorage.getItem(FLAG_KEY) || '';
    const set = new Set(raw.split(',').filter(Boolean));
    set.add(projectId);
    localStorage.setItem(FLAG_KEY, Array.from(set).join(','));
  } catch { /* noop */ }
}

/** Heuristic — did the schema get messy enough that the FAB should nudge? */
function useMessyHint(): boolean {
  const doc = useStore(s => s.doc);
  const workspace = useStore(s => s.workspace);
  const activeId = workspace?.activeId || 'default';
  return useMemo(() => {
    if (isLayoutDoneFor(activeId)) return false;
    if (doc.devices.length < 8) return false;
    const pts = doc.devices.map(d => ({ x: d.x, y: d.y }));
    let overlaps = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        if (Math.abs(pts[i].x - pts[j].x) < 20 && Math.abs(pts[i].y - pts[j].y) < 20) {
          if (++overlaps >= 2) return true;
        }
      }
    }
    return doc.devices.length >= 12;
  }, [doc.devices, activeId]);
}

interface Action {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export function LayoutFAB() {
  const autoLayout = useStore(s => s.autoLayout);
  const undo = useStore(s => s.undo);
  const redo = useStore(s => s.redo);
  const historyLen = useStore(s => s.history.length);
  const futureLen  = useStore(s => s.future.length);
  const knifeMode = useStore(s => s.knifeMode);
  const toggleKnifeMode = useStore(s => s.toggleKnifeMode);
  const setAllRackDisplay = useStore(s => s.setAllRackDisplay);
  const workspace = useStore(s => s.workspace);
  const activeId = workspace?.activeId || 'default';
  const messy = useMessyHint();
  // v0.43.6: toggle all edges off/on from the FAB
  const hideEdges = useStore(s => s.hideEdges);
  const toggleHideEdges = useStore(s => s.toggleHideEdges);

  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const showHint = messy && !dismissed && !open;

  useEffect(() => { setDismissed(false); setOpen(false); }, [activeId]);

  // Escape closes the fan-out
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const doLayout = (dir: 'TB' | 'LR' = 'TB') => {
    // v0.36.1: show loading overlay — on 100+ device schemas dagre takes
    // 0.5-2 s and the UI feels frozen without a spinner.
    window.dispatchEvent(new CustomEvent('netmap:progress-start', {
      detail: { id: 'auto-layout', title: 'Автораскладка схемы',
                message: 'Рассчитываем иерархию (dagre)…' },
    }));
    // Give the overlay one frame to actually paint before the sync work starts.
    requestAnimationFrame(() => {
      try {
        autoLayout(dir);
        markLayoutDone(activeId);
      } finally {
        window.dispatchEvent(new CustomEvent('netmap:progress-end',
          { detail: { id: 'auto-layout' } }));
      }
    });
    setDismissed(true);
    setOpen(false);
  };

  const actions: Action[] = [
    {
      id: 'undo',   label: `Отменить · Ctrl+Z${historyLen ? ` (${historyLen})` : ''}`,
      disabled: historyLen === 0,
      icon: <IconSvg><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/></IconSvg>,
      onClick: () => { undo(); },
    },
    {
      id: 'redo',   label: `Повторить · Ctrl+Y${futureLen ? ` (${futureLen})` : ''}`,
      disabled: futureLen === 0,
      icon: <IconSvg><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h4"/></IconSvg>,
      onClick: () => { redo(); },
    },
    {
      id: 'knife',  label: knifeMode ? 'Отключить нож' : 'Нож · обрезать кабель (T)',
      danger: knifeMode,
      icon: <IconSvg><path d="M14.5 3l6.5 6.5-11 11H3v-7z"/><path d="M13 6l5 5"/></IconSvg>,
      onClick: () => { toggleKnifeMode(); setOpen(false); },
    },
    {
      id: 'hideEdges', label: hideEdges ? 'Показать связи' : 'Скрыть все связи',
      icon: hideEdges
        ? (<IconSvg><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></IconSvg>)
        : (<IconSvg><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.85 20.85 0 0 1 5.36-5.51"/><path d="M22.54 11.88A20.29 20.29 0 0 0 12 4a10.86 10.86 0 0 0-2 .19"/><line x1="1" y1="1" x2="23" y2="23"/></IconSvg>),
      onClick: () => { toggleHideEdges(); setOpen(false); },
    },
    {
      id: 'layout', label: 'Разложить схему · сверху вниз',
      icon: <IconSvg><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></IconSvg>,
      onClick: () => doLayout('TB'),
    },
    {
      id: 'expand', label: 'Развернуть все свитчи',
      icon: <IconSvg><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></IconSvg>,
      onClick: () => {
        window.dispatchEvent(new CustomEvent('netmap:progress-start', {
          detail: { id: 'expand-all', title: 'Разворачиваем свитчи',
                    message: 'Меняем режим отображения и пересчитываем схему…' },
        }));
        requestAnimationFrame(() => {
          try {
            setAllRackDisplay('rack');
            setTimeout(() => {
              try { useStore.getState().autoLayout('TB', { preserveDisplay: true }); }
              finally {
                window.dispatchEvent(new CustomEvent('netmap:progress-end',
                  { detail: { id: 'expand-all' } }));
              }
            }, 30);
          } catch (e) {
            window.dispatchEvent(new CustomEvent('netmap:progress-end',
              { detail: { id: 'expand-all' } }));
            throw e;
          }
        });
        setOpen(false);
      },
    },
    {
      id: 'collapse', label: 'Свернуть все свитчи',
      icon: <IconSvg><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></IconSvg>,
      onClick: () => {
        window.dispatchEvent(new CustomEvent('netmap:progress-start', {
          detail: { id: 'collapse-all', title: 'Сворачиваем свитчи',
                    message: 'Пересчитываем схему…' },
        }));
        requestAnimationFrame(() => {
          try {
            setAllRackDisplay('compact');
            setTimeout(() => {
              try { useStore.getState().autoLayout('TB'); }
              finally {
                window.dispatchEvent(new CustomEvent('netmap:progress-end',
                  { detail: { id: 'collapse-all' } }));
              }
            }, 30);
          } catch (e) {
            window.dispatchEvent(new CustomEvent('netmap:progress-end',
              { detail: { id: 'collapse-all' } }));
            throw e;
          }
        });
        setOpen(false);
      },
    },
    {
      id: 'png', label: 'Экспорт в PNG',
      icon: <IconSvg><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="M21 15l-6-6-9 9"/></IconSvg>,
      onClick: async () => {
        setOpen(false);
        try { await exportPng(useStore.getState().doc.name); }
        catch (e) { await alertDialog('Ошибка экспорта', String((e as any)?.message || e)); }
      },
    },
    {
      id: 'svg', label: 'Экспорт в SVG',
      icon: <IconSvg><path d="M4 4h16v16H4z"/><path d="M8 12l3 3 5-7"/></IconSvg>,
      onClick: async () => {
        setOpen(false);
        try { await exportSvg(useStore.getState().doc.name); }
        catch (e) { await alertDialog('Ошибка экспорта', String((e as any)?.message || e)); }
      },
    },
    {
      id: 'json', label: 'Экспорт в JSON',
      icon: <IconSvg><path d="M6 4h9l4 4v12H6z"/><path d="M14 4v5h5"/><path d="M9 13l1.5 1.5L9 16M15 13l-1.5 1.5L15 16"/></IconSvg>,
      onClick: () => { exportJson(useStore.getState().doc.name); setOpen(false); },
    },
  ];

  return (
    <>
      {/* Messy-hint banner (only when collapsed) */}
      {showHint && (
        <div style={hintCard} data-netmap-overlay="true">
          <div style={hintIcon}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', marginBottom: 3 }}>
              Схема выглядит запутанно
            </div>
            <div style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.5, marginBottom: 8 }}>
              Разложить автоматически по иерархии — ядро сверху, доступ снизу?
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => doLayout('TB')} style={primaryBtn}>Разложить</button>
              <button onClick={() => { setDismissed(true); markLayoutDone(activeId); }} style={ghostBtn}>
                Не сейчас
              </button>
            </div>
          </div>
          <button onClick={() => { setDismissed(true); markLayoutDone(activeId); }}
                  title="Скрыть"
                  style={hintCloseBtn}>×</button>
        </div>
      )}

      {/* v0.35.7: FAB positioned bottom-right (like the user's mockup). */}
      <div style={fabWrap} data-netmap-overlay="true">
        {/* Backdrop — captures clicks outside the fan to close */}
        {open && <div onClick={() => setOpen(false)} style={backdrop} />}

        {/* Action pills — laid out horizontally to the LEFT of the main FAB.
            Each pill is absolutely positioned; on open we translate them from
            (offset=0) outward with an increasing stagger, so they visually
            "fly out of" the main button from right to left. */}
        {actions.map((a, i) => {
          // v0.43.6: FAB moved to TOP-RIGHT, actions fly out DOWNWARD.
          const gap = 50;                   // px between pill centres
          const targetY = gap * (i + 1);    // positive = below the FAB
          return (
            <button
              key={a.id}
              onClick={a.disabled ? undefined : a.onClick}
              disabled={a.disabled}
              title={a.label}
              aria-label={a.label}
              style={{
                ...actionBtn(a.danger, a.disabled),
                transform: open
                  ? `translate(0, ${targetY}px) scale(1)`
                  : 'translate(0, 0) scale(0.4)',
                opacity: open ? (a.disabled ? 0.4 : 1) : 0,
                pointerEvents: open && !a.disabled ? 'auto' : 'none',
                // Stagger: outer pills follow inner ones by ~35ms
                transitionDelay: open ? `${i * 35}ms` : `${(actions.length - 1 - i) * 20}ms`,
              }}>
              {a.icon}
            </button>
          );
        })}

        {/* Main FAB */}
        <button
          onClick={() => setOpen(v => !v)}
          title={open ? 'Закрыть меню' : 'Действия'}
          aria-label={open ? 'Закрыть меню' : 'Действия'}
          style={{
            ...mainBtn,
            transform: open ? 'rotate(45deg)' : 'rotate(0)',
          }}>
          {open ? (
            <IconSvg size={22} strokeWidth={2.5}>
              <line x1="6" y1="6" x2="18" y2="18"/>
              <line x1="6" y1="18" x2="18" y2="6"/>
            </IconSvg>
          ) : (
            <IconSvg size={22} strokeWidth={2}>
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </IconSvg>
          )}
        </button>
      </div>
    </>
  );
}

// ---- Small icon wrapper (24×24 viewBox, currentColor stroke) ----
function IconSvg({ children, size = 18, strokeWidth = 1.8 }: {
  children: React.ReactNode; size?: number; strokeWidth?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

// ---- styles ----

// v0.43.6: moved from bottom-left to TOP-RIGHT per user request. Sits above
// the map, actions fan out DOWN.
const fabWrap: React.CSSProperties = {
  position: 'absolute',
  top: 20, right: 20,
  zIndex: 30,
  width: 48, height: 48,
};
const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: -1, background: 'transparent',
};
const mainBtn: React.CSSProperties = {
  position: 'absolute', inset: 0,
  width: 48, height: 48, borderRadius: '50%',
  background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',
  border: '3px solid #FFFFFF',
  color: '#FFFFFF',
  cursor: 'pointer',
  boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35), 0 2px 4px rgba(15, 23, 42, 0.08)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 0, zIndex: 2,
  transition: 'transform 220ms cubic-bezier(.5, 1.5, .5, 1), box-shadow 200ms',
};
const actionBtn = (danger?: boolean, disabled?: boolean): React.CSSProperties => ({
  position: 'absolute',
  // v0.43.6: FAB in top-right → children hang directly UNDER the main button.
  top: 4, left: '50%',
  transform: 'translate(-50%, 0)',
  width: 40, height: 40, borderRadius: '50%',
  background: danger ? '#DC2626' : '#FFFFFF',
  border: `2px solid ${danger ? '#B91C1C' : '#E5E7EB'}`,
  color: danger ? '#FFFFFF' : disabled ? '#9CA3AF' : '#374151',
  cursor: disabled ? 'not-allowed' : 'pointer',
  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.18)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 0,
  transition:
    'transform 320ms cubic-bezier(.34, 1.56, .64, 1),' +
    ' opacity 260ms ease-out,' +
    ' background 120ms',
  willChange: 'transform, opacity',
});

// v0.43.6: FAB moved to top-right — hint sits BELOW the FAB (offset left
// so it doesn't slide under the actions column).
const hintCard: React.CSSProperties = {
  position: 'absolute', top: 20, right: 80, zIndex: 25,
  background: '#FFFFFF',
  border: '1px solid #BFDBFE',
  borderRadius: 10,
  boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
  padding: '10px 14px',
  maxWidth: 340,
  display: 'flex', gap: 10, alignItems: 'flex-start',
};
const hintIcon: React.CSSProperties = {
  width: 30, height: 30, borderRadius: '50%',
  background: '#EFF6FF', color: '#2563EB',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0,
};
const hintCloseBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#9CA3AF',
  cursor: 'pointer', padding: 2, fontSize: 16, lineHeight: 1, flexShrink: 0,
};
const primaryBtn: React.CSSProperties = {
  background: '#2563EB', border: '1px solid #2563EB', color: '#FFFFFF',
  padding: '5px 12px', borderRadius: 5, cursor: 'pointer',
  fontSize: 11, fontWeight: 600,
};
const ghostBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid #E5E7EB', color: '#6B7280',
  padding: '5px 12px', borderRadius: 5, cursor: 'pointer',
  fontSize: 11, fontWeight: 500,
};
