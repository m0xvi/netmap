import { useState } from 'react';

/**
 * PoE lightning-bolt toggle.
 * - showAlways=false (default): semi-transparent, appears only on parent hover
 * - active=true: bright yellow, always visible
 *
 * Parent must have position:relative and provide the hover context (:hover CSS won't work
 * across React children, so we rely on the parent passing `parentHover`).
 */
interface Props {
  active: boolean;
  onToggle: () => void;
  size?: number;
  /** true when the parent element is hovered (so the button appears) */
  parentHover?: boolean;
  title?: string;
  style?: React.CSSProperties;
}

export function PoeButton({ active, onToggle, size = 14, parentHover = true, title, style }: Props) {
  const [hover, setHover] = useState(false);

  const visible = active || parentHover || hover;
  if (!visible) return null;

  const color =
    active ? '#fbbf24'      // bright yellow
    : hover ? '#facc15'
    : '#9CA3AF';
  const opacity =
    active ? 1
    : hover ? 0.9
    : 0.4;

  return (
    <button
      className="nodrag"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title={title || (active ? 'PoE активен — отключить' : 'Включить PoE')}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size + 4, height: size + 4,
        border: `1px solid ${active ? '#fbbf24' : '#4b5563'}`,
        background: active ? 'rgba(251,191,36,0.15)' : 'rgba(0,0,0,0.35)',
        borderRadius: 4,
        cursor: 'pointer',
        padding: 0,
        transition: 'all 0.12s',
        opacity,
        ...style,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24"
           fill={active ? color : 'none'}
           stroke={color}
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2 L4 14 h7 L10 22 L20 10 h-7 z" />
      </svg>
    </button>
  );
}
