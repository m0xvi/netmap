/**
 * v0.88.0 — выпадающее меню, прижатое к кнопке-якорю и нарисованное в body.
 *
 * Нужно там, где кнопка стоит в строке с overflow-x: auto (панель инструментов):
 * обычное absolute-меню внутри такой строки обрезается. Закрывается кликом вне
 * меню и клавишей Escape; клик по самой кнопке обрабатывает владелец.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export function PortalMenu({ anchorRef, onClose, align = 'left', width = 220, children }: {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  align?: 'left' | 'right';
  width?: number;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const a = anchorRef.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const top = r.bottom + 6;
    setPos(align === 'right'
      ? { top, right: Math.max(0, window.innerWidth - r.right) }
      : { top, left: Math.max(0, r.left) });
  }, [anchorRef, align]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchorRef, onClose]);

  if (!pos) return null;
  return createPortal(
    <div ref={menuRef} style={{
      position: 'fixed', zIndex: 9000, width, padding: 6, boxSizing: 'border-box',
      background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10,
      boxShadow: '0 12px 28px -8px rgba(15,23,42,0.28)',
      ...pos,
    }}>
      {children}
    </div>,
    document.body,
  );
}
