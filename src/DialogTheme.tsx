/**
 * v0.62.0 — единая тема модальных окон NetMap.
 *
 * Все диалоги (импорты, Vault, traceroute, настройки, …) выглядят как окно
 * «Автообнаружение топологии» (редизайн v0.56.0): тот же каркас, шапка,
 * кнопки и контролы. Значения скопированы из DiscoveryDialog (.nm-disc),
 * само окно discovery не тронуто — оно эталон.
 *
 * Что даёт модуль:
 *   DialogShell — каркас окна: backdrop + карточка + шапка (иконка,
 *     заголовок, чипы) + прокручиваемое тело + фиксированный футер.
 *   DlgBtn      — кнопки primary / ghost / danger.
 *   DlgSection  — заголовок секции (sec-head) + контент.
 *   DlgIcon     — SVG-иконки для шапок (только SVG, без emoji).
 *   CSS-классы  — .nm-dlg скоп: search, sw (тумблер), cb (чекбокс),
 *     seg (сегмент-контрол), fld (поле формы), fgrid, infobox
 *     (info/warn/danger/ok), fchip, tag, empty, spin, hint.
 *
 * Стек zIndex: base 9500 (как discovery) для обычных окон,
 * top 99900 — для окон поверх других (терминал, QR, выбор порта).
 * Примитивы Modal.tsx (prompt/confirm/alert) остаются выше всех (100000).
 */

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// ---------------------------------------------------------------------------
// Общая CSS-тема (инжектится один раз). Значения — из .nm-disc (v0.56.0).
// ---------------------------------------------------------------------------

export function ensureDialogTheme() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('nm-dialog-theme')) return;
  const s = document.createElement('style');
  s.id = 'nm-dialog-theme';
  s.textContent = `
.nm-dlg{
  --bg:#e9edf5; --panel:#ffffff; --body:#f6f8fc;
  --ink:#0f172a; --ink-2:#475569; --ink-3:#8b96ab;
  --line:#e4e9f2; --line-2:#eef2f9;
  --brand:#4361ee; --brand-2:#3550d4; --brand-soft:#edf1ff; --brand-line:#c9d4fb;
  --ok:#0e9f6e; --ok-soft:#e7f8f1; --ok-line:#b9e9d6;
  --warn:#b4630a; --warn-strong:#d97706; --warn-soft:#fdf6ea; --warn-line:#f2ddb6;
  --danger:#c81e1e; --danger-soft:#fdeaea; --danger-line:#f5c2c2;
  --ap:#6d4ae0; --ap-soft:#f1edff; --ap-line:#ddd2ff;
  --sw:#0b7d72; --sw-soft:#e6f7f5; --sw-line:#bfe9e4;
  --r:14px;
  font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Arial,sans-serif;
  color:var(--ink);
  animation:nm-dlg-pop .28s cubic-bezier(.2,.9,.3,1.2);
}
@keyframes nm-dlg-pop{from{opacity:0; transform:scale(.97)} to{opacity:1; transform:scale(1)}}
.nm-dlg button, .nm-dlg input, .nm-dlg select, .nm-dlg textarea{font-family:inherit}
.nm-dlg .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12.5px}
.nm-dlg .hint{font-size:11.5px; color:var(--ink-3); line-height:1.5}
.nm-dlg .m-head{display:flex; align-items:center; gap:14px; padding:18px 24px 14px}
.nm-dlg .h-icon{width:48px; height:48px; border-radius:14px; background:linear-gradient(135deg,#4361ee,#6d4ae0); color:#fff; display:flex; align-items:center; justify-content:center; box-shadow:0 6px 16px rgba(67,97,238,.35); flex-shrink:0}
.nm-dlg .h-txt{flex:1; min-width:0}
.nm-dlg .h-txt h1{margin:0; font-size:18px; font-weight:800; letter-spacing:-.01em}
.nm-dlg .h-sub{margin-top:3px; font-size:12.5px; color:var(--ink-2)}
.nm-dlg .h-methods{display:flex; flex-wrap:wrap; gap:5px; margin-top:6px}
.nm-dlg .h-methods span{font-size:10.5px; font-weight:600; color:var(--ink-2); background:#f1f4fa; border:1px solid var(--line); padding:1px 8px; border-radius:20px; white-space:nowrap}
.nm-dlg .icon-btn{width:32px; height:32px; border-radius:9px; border:1px solid transparent; background:transparent; color:var(--ink-3); cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0}
.nm-dlg .icon-btn:hover{background:#f1f4fa; color:var(--ink)}
.nm-dlg .dscroll{flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; background:var(--body); border-top:1px solid var(--line); border-bottom:1px solid var(--line); padding:18px 24px 24px; display:flex; flex-direction:column; gap:14px}
.nm-dlg .m-foot{display:flex; align-items:center; gap:12px; padding:14px 24px 16px; flex-wrap:wrap}
.nm-dlg .f-spacer{flex:1}
.nm-dlg .f-pill{font-size:12.5px; color:var(--ink-2); background:#f1f4fa; border:1px solid var(--line); border-radius:10px; padding:5px 12px; white-space:nowrap}
.nm-dlg .f-pill b{font-size:14px; color:var(--ink); font-variant-numeric:tabular-nums}
.nm-dlg .f-dim{font-size:12px; color:var(--ink-3); white-space:nowrap}
.nm-dlg .btn{display:inline-flex; align-items:center; gap:8px; border-radius:11px; font-size:13.5px; font-weight:700; padding:9px 18px; cursor:pointer; border:1.5px solid transparent; transition:all .15s; white-space:nowrap}
.nm-dlg .btn.primary{background:linear-gradient(135deg,#4361ee,#5a3ee6); color:#fff; box-shadow:0 4px 14px rgba(67,97,238,.35)}
.nm-dlg .btn.primary:hover{transform:translateY(-1px); box-shadow:0 6px 18px rgba(67,97,238,.45)}
.nm-dlg .btn.primary:disabled{opacity:.55; cursor:not-allowed; transform:none; box-shadow:none}
.nm-dlg .btn.ghost{background:var(--panel); border-color:var(--line); color:var(--ink-2)}
.nm-dlg .btn.ghost:hover{border-color:#c3ccdd; color:var(--ink)}
.nm-dlg .btn.ghost:disabled{opacity:.55; cursor:not-allowed}
.nm-dlg .btn.danger{background:var(--danger); color:#fff; box-shadow:0 4px 14px rgba(200,30,30,.3)}
.nm-dlg .btn.danger:hover{background:#a81818; transform:translateY(-1px)}
.nm-dlg .btn.danger:disabled{opacity:.55; cursor:not-allowed; transform:none; box-shadow:none}
.nm-dlg .btn.sm{font-size:12px; padding:6px 12px; border-radius:9px; gap:6px}
.nm-dlg .sec-head{display:flex; align-items:center; gap:9px; margin:6px 0 2px}
.nm-dlg .sec-head:first-child{margin-top:0}
.nm-dlg .sec-head h2{margin:0; font-size:14.5px; font-weight:800; display:flex; align-items:center; gap:8px}
.nm-dlg .sec-head h2 svg{color:var(--brand)}
.nm-dlg .sec-head .g-hint{font-size:11.5px; color:var(--ink-3); margin-left:auto}
.nm-dlg .search{position:relative; flex:1 1 240px; min-width:170px; max-width:460px; display:flex; align-items:center}
.nm-dlg .search>svg{position:absolute; left:11px; color:var(--ink-3); pointer-events:none}
.nm-dlg .search input{width:100%; border:1.5px solid var(--line); border-radius:11px; padding:8px 30px 8px 34px; font-size:13px; outline:none; background:var(--panel); color:var(--ink); transition:border-color .15s, box-shadow .15s}
.nm-dlg .search input:focus{border-color:var(--brand); box-shadow:0 0 0 3px rgba(67,97,238,.14)}
.nm-dlg .search input::placeholder{color:var(--ink-3)}
.nm-dlg .sw{position:relative; display:inline-flex; flex-shrink:0}
.nm-dlg .sw input{position:absolute; opacity:0; width:100%; height:100%; margin:0; cursor:pointer}
.nm-dlg .sw i{width:36px; height:21px; border-radius:20px; background:#cbd5e6; position:relative; transition:background .18s; font-style:normal}
.nm-dlg .sw i::after{content:""; position:absolute; top:2.5px; left:3px; width:16px; height:16px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.25); transition:left .18s}
.nm-dlg .sw input:checked+i{background:var(--brand)}
.nm-dlg .sw input:checked+i::after{left:17px}
.nm-dlg .sw input:focus-visible+i{outline:2px solid var(--brand); outline-offset:2px}
.nm-dlg .cb{position:relative; display:inline-flex; flex-shrink:0; cursor:pointer}
.nm-dlg .cb input{position:absolute; opacity:0; width:100%; height:100%; margin:0; cursor:pointer}
.nm-dlg .cb span{width:17px; height:17px; border-radius:6px; border:1.5px solid #b9c4d6; background:#fff; display:inline-flex; align-items:center; justify-content:center; transition:background .15s, border-color .15s}
.nm-dlg .cb span::after{content:""; width:9px; height:5px; border-left:2.4px solid #fff; border-bottom:2.4px solid #fff; transform:rotate(-45deg) translateY(-1px); opacity:0}
.nm-dlg .cb input:checked+span{background:var(--brand); border-color:var(--brand)}
.nm-dlg .cb input:checked+span::after{opacity:1}
.nm-dlg .cb input:focus-visible+span{outline:2px solid var(--brand); outline-offset:1px}
.nm-dlg .seg{display:flex; background:#eef1f7; padding:3px; border-radius:10px; width:fit-content; gap:2px}
.nm-dlg .seg button{padding:6px 14px; border:none; background:transparent; font-size:12.5px; font-weight:700; color:var(--ink-2); cursor:pointer; border-radius:8px; white-space:nowrap}
.nm-dlg .seg button.on{background:#fff; color:var(--ink); box-shadow:0 1px 3px rgba(15,23,42,.12)}
.nm-dlg .fgrid{display:grid; grid-template-columns:repeat(2,1fr); gap:10px}
.nm-dlg .fld{display:flex; flex-direction:column; gap:4px; font-size:11.5px; font-weight:700; color:var(--ink-2)}
.nm-dlg .fld input, .nm-dlg .fld select, .nm-dlg .fld textarea{padding:8px 10px; border:1.5px solid var(--line); border-radius:9px; font-size:13px; font-weight:400; color:var(--ink); background:#fff; outline:none; width:100%; box-sizing:border-box}
.nm-dlg .fld input:focus, .nm-dlg .fld select:focus, .nm-dlg .fld textarea:focus{border-color:var(--brand); box-shadow:0 0 0 3px rgba(67,97,238,.14)}
.nm-dlg .fld input::placeholder, .nm-dlg .fld textarea::placeholder{color:var(--ink-3)}
.nm-dlg .infobox{padding:9px 12px; border-radius:10px; font-size:12.5px; line-height:1.5; border:1px solid}
.nm-dlg .infobox.info{background:#eff6ff; border-color:#bfdbfe; color:#1e40af}
.nm-dlg .infobox.warn{background:var(--warn-soft); border-color:var(--warn-line); color:#7c4a03}
.nm-dlg .infobox.danger{background:var(--danger-soft); border-color:var(--danger-line); color:#991b1b}
.nm-dlg .infobox.ok{background:var(--ok-soft); border-color:var(--ok-line); color:#14532d}
.nm-dlg .fchip{display:inline-flex; align-items:center; gap:7px; border:1.5px solid var(--brand-line); background:var(--brand-soft); border-radius:10px; padding:4px 6px 4px 10px; font-size:12px; font-weight:700; cursor:pointer; transition:all .15s; max-width:100%; color:var(--ink)}
.nm-dlg .fchip:hover{transform:translateY(-1px); box-shadow:0 3px 10px rgba(67,97,238,.18)}
.nm-dlg .fchip.off{background:#f1f4f9; border-color:var(--line); border-style:dashed; color:var(--ink-3)}
.nm-dlg .fchip .cnt{background:var(--brand); color:#fff; font-size:11px; font-weight:800; min-width:22px; height:20px; display:inline-flex; align-items:center; justify-content:center; border-radius:7px; padding:0 6px; font-variant-numeric:tabular-nums}
.nm-dlg .fchip.off .cnt{background:#b9c4d6}
.nm-dlg .tag{font-size:10.5px; font-weight:700; padding:1px 8px; border-radius:12px; border:1px solid; white-space:nowrap; line-height:1.6}
.nm-dlg .tag.brand{background:var(--brand-soft); border-color:var(--brand-line); color:var(--brand-2)}
.nm-dlg .tag.ok{background:var(--ok-soft); border-color:var(--ok-line); color:var(--ok)}
.nm-dlg .tag.warn{background:var(--warn-soft); border-color:var(--warn-line); color:var(--warn)}
.nm-dlg .tag.mut{background:#f1f4f9; border-color:var(--line); color:var(--ink-2)}
.nm-dlg .tag.danger{background:var(--danger-soft); border-color:var(--danger-line); color:var(--danger)}
.nm-dlg .empty{padding:26px 16px; text-align:center; color:var(--ink-2); font-size:13px; background:var(--panel); border:1px dashed var(--line); border-radius:12px; display:flex; flex-direction:column; gap:6px; align-items:center}
.nm-dlg .empty b{color:var(--ink)}
.nm-dlg .spin{width:32px; height:32px; border-radius:50%; border:3px solid var(--line); border-top-color:var(--brand); animation:nm-spin 800ms linear infinite}
@keyframes nm-spin{to{transform:rotate(360deg)}}
.nm-dlg .mini-link{border:none; background:none; color:var(--brand); font-size:12px; font-weight:700; cursor:pointer; padding:4px 6px; border-radius:7px; white-space:nowrap}
.nm-dlg .mini-link:hover{background:var(--brand-soft)}
.nm-dlg .tgl{display:inline-flex; align-items:center; gap:8px; font-size:12.5px; font-weight:600; color:var(--ink-2); cursor:pointer; user-select:none; white-space:nowrap}
`;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// SVG-иконки для шапок (stroke = currentColor).
// ---------------------------------------------------------------------------

const ICON_PATHS: Record<string, ReactNode> = {
  import: (<><path d="M12 3v12" /><polyline points="7 10 12 15 17 10" /><path d="M4 19h16" /></>),
  router: (<><rect x="4" y="13" width="16" height="7" rx="2" /><line x1="8" y1="13" x2="8" y2="6" /><line x1="16" y1="13" x2="16" y2="6" /><circle cx="8" cy="4.5" r="1" /><circle cx="16" cy="4.5" r="1" /></>),
  route: (<><circle cx="5" cy="19" r="2" /><circle cx="19" cy="5" r="2" /><path d="M5 17V10a4 4 0 0 1 4-4h8" /></>),
  gear: (<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>),
  lock: (<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>),
  swap: (<><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>),
  database: (<><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></>),
  list: (<><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>),
  qr: (<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="4" height="4" rx="1" /><line x1="18.5" y1="18.5" x2="21" y2="21" /></>),
  terminal: (<><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></>),
  book: (<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>),
  bell: (<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></>),
  search: (<><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></>),
  grid: (<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>),
  close: (<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>),
};

export type DlgIconName = keyof typeof ICON_PATHS;

export function DlgIcon({ n, size = 26 }: { n: DlgIconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0 }}>
      {ICON_PATHS[n]}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Каркас окна.
// ---------------------------------------------------------------------------

export interface DialogShellProps {
  title: string;
  /** Подзаголовок под заголовком (одна строка). */
  subtitle?: string;
  /** Чипы методов/источников под заголовком (как h-methods в discovery). */
  chips?: string[];
  /** Имя иконки шапки. */
  icon?: DlgIconName;
  onClose: () => void;
  /** Ширина карточки (по умолчанию 720, как форма discovery). */
  width?: number;
  maxWidth?: string;
  /** base 9500 — обычные окна; top 99900 — поверх других окон. */
  level?: 'base' | 'top';
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  /** Фиксированный футер (m-foot). */
  footer?: ReactNode;
  /** Доп. стили тела (перекрывают .dscroll). */
  bodyStyle?: React.CSSProperties;
  children: ReactNode;
}

export function DialogShell({
  title, subtitle, chips, icon = 'grid', onClose,
  width = 720, maxWidth = '92vw', level = 'base',
  closeOnEscape = true, closeOnBackdrop = true,
  footer, bodyStyle, children,
}: DialogShellProps) {
  ensureDialogTheme();

  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeOnEscape, onClose]);

  return createPortal(
    <div
      onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.42)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: level === 'top' ? 99900 : 9500, backdropFilter: 'blur(2px)',
      }}
    >
      <div
        className="nm-dlg"
        style={{
          background: '#fff', borderRadius: 14, width, maxWidth,
          maxHeight: '92vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 30px 60px -20px rgba(15,23,42,0.4)',
          overflow: 'hidden',
        }}
      >
        <header className="m-head">
          <div className="h-icon"><DlgIcon n={icon} size={26} /></div>
          <div className="h-txt">
            <h1>{title}</h1>
            {subtitle && <div className="h-sub">{subtitle}</div>}
            {chips && chips.length > 0 && (
              <div className="h-methods">{chips.map(c => <span key={c}>{c}</span>)}</div>
            )}
          </div>
          <button className="icon-btn" onClick={onClose} title="Закрыть">
            <DlgIcon n="close" size={18} />
          </button>
        </header>
        <div className="dscroll" style={bodyStyle}>{children}</div>
        {footer && <footer className="m-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Кнопки и секции.
// ---------------------------------------------------------------------------

export function DlgBtn({
  kind = 'ghost', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'ghost' | 'danger' }) {
  const cls = `btn ${kind}${rest.className ? ` ${rest.className}` : ''}`;
  return <button {...rest} className={cls} />;
}

export function DlgSection({
  title, icon, hint, children,
}: { title: string; icon?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="sec-head">
        <h2>{icon}{title}</h2>
        {hint && <span className="g-hint">{hint}</span>}
      </div>
      {children}
    </>
  );
}
