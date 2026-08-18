import { useEffect, useRef, useState } from 'react';
import type { StickyNote as SN, StickyColor } from './types';
import { useStore } from './store';

// v0.25: proper light sticky palette — pastel background + dark text.
// Previously bg and text were both dark (sed migration dark→light stripped
// the light-bg values), making notes unreadable.
export const STICKY_COLORS: Record<StickyColor, { bg: string; edge: string; shadow: string; text: string }> = {
  yellow: { bg: '#FEF3C7', edge: '#F59E0B', shadow: 'rgba(146,64,14,0.20)', text: '#78350F' },
  pink:   { bg: '#FBCFE8', edge: '#EC4899', shadow: 'rgba(157,23,77,0.20)', text: '#831843' },
  blue:   { bg: '#BFDBFE', edge: '#60A5FA', shadow: 'rgba(30,64,175,0.20)', text: '#1E3A8A' },
  green:  { bg: '#D1FAE5', edge: '#10B981', shadow: 'rgba(6,95,70,0.20)',   text: '#064E3B' },
};

const COLORS = STICKY_COLORS;

/** A single sticky. Position (offsetX/Y) is passed by parent stack. */
export function StickyNoteCard({
  note, offsetX, offsetY, isTop, isNew, onDoneAnim
}: {
  note: SN;
  offsetX: number;
  offsetY: number;
  isTop: boolean;
  isNew: boolean;
  onDoneAnim: () => void;
}) {
  const updateSticky = useStore(s => s.updateSticky);
  const removeSticky = useStore(s => s.removeSticky);
  const openContextMenu = useStore(s => s.openContextMenu);
  const [editing, setEditing] = useState(isNew);
  const [text, setText] = useState(note.text);
  const [pop, setPop] = useState(isNew);
  const textRef = useRef<HTMLDivElement>(null);
  const col = COLORS[note.color] || COLORS.yellow;
  const [hover, setHover] = useState(false);

  // Live-resize state (drag on the corner grip)
  const [resizing, setResizing] = useState(false);
  const [liveSize, setLiveSize] = useState<{ w: number; h: number } | null>(null);
  const width  = liveSize?.w ?? note.width  ?? 130;
  const height = liveSize?.h ?? note.height ?? 84;

  // Live-drag state — user moving the sticky around the device
  const [dragging, setDragging] = useState(false);
  const [liveOffset, setLiveOffset] = useState<{ x: number; y: number } | null>(null);
  const shownX = liveOffset?.x ?? offsetX;
  const shownY = liveOffset?.y ?? offsetY;

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    // Don't start a drag when editing text or interacting with a control
    if (editing) return;
    const target = e.target as HTMLElement;
    if (target.closest('.sticky-nodrag')) return;   // pin, resize grip
    e.stopPropagation();
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startOX = offsetX;
    const startOY = offsetY;
    let moved = false;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      if (!moved && Math.hypot(dx, dy) > 4) { moved = true; setDragging(true); }
      if (moved) setLiveOffset({ x: startOX + dx, y: startOY + dy });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) {
        const dx = ev.clientX - startClientX;
        const dy = ev.clientY - startClientY;
        updateSticky(note.id, { offsetX: startOX + dx, offsetY: startOY + dy });
        setLiveOffset(null);
        setDragging(false);
      } else {
        // Treat as a click → enter edit mode
        setEditing(true);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX, startY = e.clientY;
    const startW = width, startH = height;
    const onMove = (ev: PointerEvent) => {
      const nw = Math.max(90,  Math.round((startW + (ev.clientX - startX)) / 2) * 2);
      const nh = Math.max(60, Math.round((startH + (ev.clientY - startY)) / 2) * 2);
      setLiveSize({ w: nw, h: nh });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setResizing(false);
      const nw = Math.max(90,  Math.round((startW + (ev.clientX - startX)) / 2) * 2);
      const nh = Math.max(60, Math.round((startH + (ev.clientY - startY)) / 2) * 2);
      updateSticky(note.id, { width: nw, height: nh });
      setLiveSize(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // On mount for a fresh note: trigger the pop animation (0.4 → 1) and focus the text.
  // We use two requestAnimationFrame calls to guarantee the initial pop=true is painted
  // before we flip it — otherwise React batches and no transition plays.
  useEffect(() => {
    if (!isNew) return;
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        setPop(false);
        if (textRef.current) {
          textRef.current.focus();
          document.getSelection()?.selectAllChildren(textRef.current);
        }
      });
      // schedule the "done" callback well after the transition ends
      const done = setTimeout(() => onDoneAnim(), 500);
      // no clean up needed for the second RAF, but we do cancel the timer
      return () => { cancelAnimationFrame(raf2); clearTimeout(done); };
    });
    return () => cancelAnimationFrame(raf1);
  }, [isNew, onDoneAnim]);

  const commit = () => {
    updateSticky(note.id, { text });
    setEditing(false);
  };

  // ---- Collapsed "rolled scroll" mode ----
  if (note.collapsed) {
    return (
      <RolledSticky
        note={note}
        color={col}
        offsetX={shownX} offsetY={shownY}
        rotation={note.rotation}
        onExpand={() => updateSticky(note.id, { collapsed: false })}
        onDelete={() => removeSticky(note.id)}
        onContextMenu={(e) => {
          e.preventDefault(); e.stopPropagation();
          openContextMenu({ x: e.clientX, y: e.clientY, target: { type: 'sticky', id: note.id } });
        }}
      />
    );
  }

  return (
    <div
      className="nodrag"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onPointerDown={startDrag}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openContextMenu({ x: e.clientX, y: e.clientY, target: { type: 'sticky', id: note.id } });
      }}
      style={{
        position: 'absolute',
        left: shownX, top: shownY,
        width, height,
        background: col.bg,
        color: col.text,
        borderRadius: 3,
        padding: '18px 10px 10px',
        fontFamily: '"Comic Sans MS", "Segoe Print", "Bradley Hand", cursive',
        fontSize: 11,
        lineHeight: 1.25,
        boxShadow: `
          0 1px 0 ${col.edge}55,
          2px 3px 3px ${col.shadow},
          6px 10px 12px rgba(0,0,0,0.35)
        `,
        transform: `rotate(${note.rotation}deg) scale(${pop ? 0.4 : 1})`,
        transformOrigin: 'top center',
        transition: pop
          ? 'transform 380ms cubic-bezier(.34,1.56,.64,1), opacity 200ms ease'
          : (resizing || dragging)
            ? 'none'
            : 'transform 220ms cubic-bezier(.34,1.56,.64,1), box-shadow 150ms ease',
        cursor: dragging ? 'grabbing' : (editing ? 'text' : 'grab'),
        opacity: pop ? 0 : 1,
        zIndex: dragging ? 999 : (isTop ? 10 : 1),
        userSelect: editing ? 'text' : 'none',
        // NB: intentionally NOT overflow:hidden — otherwise the pin (positioned at top:-6)
        // gets clipped away by the sticky's own bounds.
      }}
    >
      {/* Pin at the top */}
      <Pin color={col.edge} onDelete={() => removeSticky(note.id)} />

      {/* Curled corner (bottom-right) */}
      <div style={{
        position: 'absolute', right: 0, bottom: 0, width: 14, height: 14,
        background: `linear-gradient(135deg, transparent 50%, ${col.edge}66 50%, ${col.edge}88 100%)`,
        borderTopLeftRadius: 3,
        clipPath: 'polygon(100% 0, 100% 100%, 0 100%)',
        pointerEvents: 'none',
      }} />
      {/* Little dog-eared shadow underneath curl */}
      <div style={{
        position: 'absolute', right: 4, bottom: 4, width: 8, height: 8,
        background: 'rgba(0,0,0,0.15)',
        filter: 'blur(1px)',
        clipPath: 'polygon(100% 0, 100% 100%, 0 100%)',
        pointerEvents: 'none',
      }} />

      {/* Collapse button (top-right) — rolls the note into a scroll icon */}
      {hover && !editing && (
        <button
          className="sticky-nodrag"
          onClick={(e) => { e.stopPropagation(); updateSticky(note.id, { collapsed: true }); }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Свернуть в свиток"
          style={{
            position: 'absolute', top: 2, right: 2,
            background: 'rgba(0,0,0,0.3)', border: `1px solid ${col.edge}88`,
            color: col.text, borderRadius: 3, padding: '1px 5px',
            fontSize: 10, lineHeight: 1, cursor: 'pointer', zIndex: 22,
          }}
        >📜</button>
      )}

      {/* Resize handle (bottom-right, over the "curl") */}
      {(hover || resizing) && (
        <div
          className="sticky-nodrag"
          onPointerDown={startResize}
          title="Растянуть заметку"
          style={{
            position: 'absolute', right: 0, bottom: 0,
            width: 18, height: 18,
            cursor: 'nwse-resize',
            zIndex: 25,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
            padding: 2,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 9 L9 0 M4 9 L9 4 M8 9 L9 8"
                  stroke={col.text} strokeOpacity="0.6" strokeWidth="1" strokeLinecap="round" fill="none" />
          </svg>
        </div>
      )}

      {/* Text — when editing, disable outer drag handler on this area */}
      {editing ? (
        <div
          ref={textRef}
          className="sticky-nodrag"
          contentEditable suppressContentEditableWarning
          onPointerDown={(e) => e.stopPropagation()}
          onInput={(e) => setText((e.currentTarget as HTMLDivElement).innerText)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); setText(note.text); setEditing(false); }
          }}
          style={{ outline: 'none', height: '100%', whiteSpace: 'pre-wrap', overflow: 'auto' }}
        >{note.text}</div>
      ) : (
        // Non-editing: no onClick — the outer drag handler will detect a tap (no movement)
        // and enter edit mode. This lets both drag AND click-to-edit work from one interaction.
        <div style={{ height: '100%', whiteSpace: 'pre-wrap', pointerEvents: 'none' }}>{note.text}</div>
      )}
    </div>
  );
}

function Pin({ color, onDelete }: { color: string; onDelete: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="sticky-nodrag"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => { e.stopPropagation(); onDelete(); }}
      onPointerDown={(e) => e.stopPropagation()}
      title="Убрать заметку"
      style={{
        position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)',
        width: 18, height: 18, cursor: 'pointer',
        zIndex: 20,
      }}
    >
      <svg viewBox="0 0 20 20" width="18" height="18">
        {/* pin shadow on paper */}
        <ellipse cx="10" cy="15" rx="4" ry="1.5" fill="rgba(0,0,0,0.25)" />
        {/* metal shaft */}
        <path d="M10 8 L10 14" stroke="#71717a" strokeWidth="1.5" strokeLinecap="round" />
        {/* head */}
        <circle cx="10" cy="6" r="5.5" fill={hover ? '#ef4444' : color}
                stroke="rgba(0,0,0,0.35)" strokeWidth="0.7" />
        {/* highlight */}
        <ellipse cx="8" cy="4.5" rx="1.6" ry="1" fill="rgba(255,255,255,0.6)" />
      </svg>
    </div>
  );
}

/**
 * Rolled-up scroll view — a tiny paper roll icon that expands back on click.
 * Uses SVG for the paper-scroll look. Very cute.
 */
function RolledSticky({ note, color, offsetX, offsetY, rotation, onExpand, onDelete, onContextMenu }: {
  note: SN;
  color: { bg: string; edge: string; text: string; shadow: string };
  offsetX: number; offsetY: number; rotation: number;
  onExpand: () => void;
  onDelete: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [hover, setHover] = useState(false);
  // First line of the text as a tooltip / peek
  const peek = (note.text || '').split('\n')[0].slice(0, 40);

  return (
    <div
      className="nodrag"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => { e.stopPropagation(); onExpand(); }}
      onContextMenu={onContextMenu}
      title={peek ? `📜 ${peek}` : '📜 Заметка (клик — развернуть)'}
      style={{
        position: 'absolute',
        left: offsetX + 40, top: offsetY + 30,
        width: 48, height: 22,
        cursor: 'pointer',
        transform: `rotate(${rotation}deg) scale(${hover ? 1.1 : 1})`,
        transformOrigin: 'center',
        transition: 'transform 180ms cubic-bezier(.34,1.56,.64,1)',
        filter: hover ? `drop-shadow(0 4px 8px ${color.edge}aa)` : 'drop-shadow(2px 3px 3px rgba(0,0,0,0.4))',
      }}
    >
      <svg viewBox="0 0 48 22" width="48" height="22">
        {/* Left roll cap */}
        <ellipse cx="5" cy="11" rx="4" ry="10" fill={color.edge} stroke="rgba(0,0,0,0.25)" strokeWidth="0.4" />
        <ellipse cx="5" cy="11" rx="2.5" ry="8" fill={color.bg} stroke={color.edge} strokeWidth="0.5" />
        {/* Middle paper */}
        <rect x="5" y="1" width="38" height="20" fill={color.bg} stroke={color.edge} strokeWidth="0.5" />
        {/* Text lines to mimic writing */}
        <line x1="9"  y1="6"  x2="38" y2="6"  stroke={color.text} strokeWidth="0.6" strokeOpacity="0.35" />
        <line x1="9"  y1="10" x2="34" y2="10" stroke={color.text} strokeWidth="0.6" strokeOpacity="0.35" />
        <line x1="9"  y1="14" x2="36" y2="14" stroke={color.text} strokeWidth="0.6" strokeOpacity="0.35" />
        <line x1="9"  y1="18" x2="28" y2="18" stroke={color.text} strokeWidth="0.6" strokeOpacity="0.35" />
        {/* Right roll cap */}
        <ellipse cx="43" cy="11" rx="4" ry="10" fill={color.edge} stroke="rgba(0,0,0,0.25)" strokeWidth="0.4" />
        <ellipse cx="43" cy="11" rx="2.5" ry="8" fill={color.bg} stroke={color.edge} strokeWidth="0.5" />
      </svg>
      {hover && (
        <button
          className="sticky-nodrag"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Удалить заметку"
          style={{
            position: 'absolute', top: -8, right: -8,
            width: 16, height: 16, borderRadius: '50%',
            background: '#FCA5A5', color: '#fff', border: '1px solid #B91C1C',
            fontSize: 9, lineHeight: '14px', cursor: 'pointer', padding: 0,
          }}
        >✕</button>
      )}
    </div>
  );
}
