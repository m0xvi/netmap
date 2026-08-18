import { useStore } from './store';
import { NodeResizer, type NodeProps } from '@xyflow/react';

interface Data {
  label: string;
  subtitle?: string;
  color?: string;
  collapsed?: boolean;
  childCount: number;
  width: number;
  height: number;
}

export function GroupNode({ id, data, selected }: NodeProps<any>) {
  const d = data as Data;
  const updateGroup = useStore(s => s.updateGroup);
  const color = d.color || '#0D9488';

  return (
    <div
      style={{
        width: d.width,
        height: d.collapsed ? 44 : d.height,
        borderRadius: 12,
        border: `2px ${selected ? 'solid' : 'dashed'} ${color}`,
        background: d.collapsed
          ? `${hexToRgba(color, 0.18)}`
          : `${hexToRgba(color, 0.06)}`,
        boxShadow: selected ? `0 0 0 3px ${hexToRgba(color, 0.25)}` : 'none',
        transition: d.collapsed ? 'height 0.2s, background 0.15s' : 'background 0.15s, box-shadow 0.15s',
        position: 'relative',
        overflow: 'visible',
        pointerEvents: 'all',
      }}
    >
      {/* Corner resize handles — only when the group is expanded and selected */}
      {!d.collapsed && (
        <NodeResizer
          isVisible={selected}
          minWidth={180}
          minHeight={100}
          color={color}
          handleStyle={{ width: 10, height: 10, borderRadius: 2, border: `2px solid ${color}`, background: '#F9FAFB' }}
          lineStyle={{ borderColor: color }}
          onResize={(_e, params) => {
            updateGroup(id, { width: Math.round(params.width / 20) * 20, height: Math.round(params.height / 20) * 20 });
          }}
        />
      )}

      {/* Header bar */}
      <div
        className="nodrag-none"
        style={{
          height: 36,
          padding: '0 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: hexToRgba(color, 0.18),
          borderBottom: d.collapsed ? 'none' : `1px solid ${hexToRgba(color, 0.35)}`,
          cursor: 'grab',
          fontSize: 13,
          fontWeight: 600,
          color: '#111827',
          userSelect: 'none',
        }}
      >
        <button
          className="nodrag"
          onClick={(e) => { e.stopPropagation(); updateGroup(id, { collapsed: !d.collapsed }); }}
          title={d.collapsed ? 'Развернуть' : 'Свернуть'}
          style={{
            background: 'transparent', border: 'none', color: '#111827',
            cursor: 'pointer', fontSize: 12, padding: '2px 4px'
          }}
        >
          {d.collapsed ? '▶' : '▼'}
        </button>
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {d.label}
        </span>
        <span style={{ fontSize: 11, opacity: 0.65, fontWeight: 400 }}>
          {d.subtitle || `${d.childCount} устр.`}
        </span>
      </div>
    </div>
  );
}

function hexToRgba(hex: string, a: number) {
  const h = hex.replace('#', '');
  const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
  return `rgba(${r},${g},${b},${a})`;
}
