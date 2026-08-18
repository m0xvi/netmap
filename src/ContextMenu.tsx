import { useEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  icon?: string;
  action?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  submenu?: MenuItem[];
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const menuW = 240, menuH = items.length * 30 + 10;
  const vx = Math.min(x, window.innerWidth - menuW - 8);
  const vy = Math.min(y, window.innerHeight - menuH - 8);

  return (
    <div ref={ref} style={rootStyle(vx, vy)}>
      {items.map((item, i) => (
        <Row key={i} item={item} onClose={onClose} />
      ))}
    </div>
  );
}

function Row({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const [subOpen, setSubOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  if (item.separator) {
    return <div style={{ height: 1, background: '#E5E7EB', margin: '4px 0' }} />;
  }

  const hasSub = !!(item.submenu && item.submenu.length);

  return (
    <div
      ref={rowRef}
      onMouseEnter={() => hasSub && setSubOpen(true)}
      onMouseLeave={() => hasSub && setSubOpen(false)}
      onClick={() => {
        if (item.disabled) return;
        if (!hasSub) { item.action?.(); onClose(); }
      }}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px',
        cursor: item.disabled ? 'not-allowed' : 'pointer',
        opacity: item.disabled ? 0.4 : 1,
        color: item.danger ? '#B91C1C' : '#111827',
        transition: 'background 0.08s',
        background: subOpen ? '#E5E7EB' : 'transparent',
      }}
      onMouseOver={e => {
        if (item.disabled) return;
        (e.currentTarget as HTMLDivElement).style.background = item.danger ? '#FEE2E2' : '#E5E7EB';
      }}
      onMouseOut={e => {
        if (!subOpen)
          (e.currentTarget as HTMLDivElement).style.background = 'transparent';
      }}
    >
      <span style={{ width: 16, textAlign: 'center', opacity: 0.8 }}>{item.icon || ''}</span>
      <span style={{ flex: 1 }}>{item.label}</span>
      {hasSub && <span style={{ opacity: 0.4, fontSize: 10 }}>▶</span>}

      {hasSub && subOpen && (
        <div style={{
          ...rootStyle(0, 0),
          position: 'absolute', left: '100%', top: -4,
          margin: 0,
        }}>
          {item.submenu!.map((s, j) => <Row key={j} item={s} onClose={onClose} />)}
        </div>
      )}
    </div>
  );
}

const rootStyle = (left: number, top: number): React.CSSProperties => ({
  position: 'fixed', left, top,
  minWidth: 220, maxWidth: 280,
  background: '#F9FAFB', border: '1px solid #D1D5DB', borderRadius: 8,
  boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
  padding: '4px 0', zIndex: 1000,
  color: '#111827', fontSize: 12,
});
