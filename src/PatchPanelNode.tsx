import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useState } from 'react';
import { useStore } from './store';
import type { Device, Port } from './types';
import { PatchPanelIcon, KIND_META } from './icons';
import { inferLayer, LAYER_META } from './layers';

interface Data {
  device: Device;
  highlighted?: boolean;
}

// Visual constants
const PORT_W = 20;
const PORT_H = 22;
const PORT_GAP = 2;
const GROUP_GAP = 8; // every 6 ports (like a real panel: 6/6/6/6 grouping)
const GROUP_SIZE = 6;

export function PatchPanelNode({ id, data, selected }: NodeProps<any>) {
  const d = (data as Data).device;
  const highlighted = (data as Data).highlighted;
  const meta = KIND_META.patchpanel;
  const updateDevice = useStore(s => s.updateDevice);
  const selectPort = useStore(s => s.selectPort);
  const focusDevice = useStore(s => s.focusDevice);

  const isExpanded = d.display === 'rack';
  const border = selected ? '#fff' : highlighted ? '#fde047' : meta.color;
  const toggle = () => updateDevice(id, { display: isExpanded ? 'compact' : 'rack' });

  // --------- COMPACT: small label with summary ---------
  if (!isExpanded) {
    const used = d.ports.filter(p => p.status === 'up').length;
    return (
      <div
        onDoubleClick={(e) => { e.stopPropagation(); focusDevice(id); }}
        title="Двойной клик — развернуть патч-панель"
        style={{
          minWidth: 150, maxWidth: 200,
          padding: '6px 8px', borderRadius: 10,
          background: meta.bg,
          border: `2px solid ${border}`,
          boxShadow: selected ? '0 0 0 2px #2563EB' : '0 1px 3px rgba(15,23,42,0.08)',
          color: '#111827', fontSize: 12, cursor: 'grab', position: 'relative'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ color: meta.color, display: 'flex' }}><PatchPanelIcon size={18} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 11,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {d.name}
            </div>
            <div style={{ fontSize: 9, opacity: 0.65 }}>
              PATCH · {d.ports.length}p · {used} исп.
            </div>
          </div>
        </div>
        {/* Per-port handles (compact) — distributed along the top/bottom edges.
            Without these, cables referencing specific port ids fall back to the
            node center and become invisible. */}
        {d.ports.map((p, idx) => {
          const pct = ((idx + 1) / (d.ports.length + 1)) * 100;
          const side = idx % 2 === 0 ? Position.Top : Position.Bottom;
          const posStyle: React.CSSProperties = { left: `${pct}%` };
          return (
            <div key={p.id}>
              <Handle id={p.id} type="source" position={side} style={{ ...hiddenHandle, ...posStyle }} />
              <Handle id={p.id} type="target" position={side} style={{ ...hiddenHandle, ...posStyle }} />
            </div>
          );
        })}
        {/* Fallback edge handles */}
        <Handle id="_left"   type="source" position={Position.Left}   style={hiddenHandle} />
        <Handle id="_left"   type="target" position={Position.Left}   style={hiddenHandle} />
        <Handle id="_right"  type="source" position={Position.Right}  style={hiddenHandle} />
        <Handle id="_right"  type="target" position={Position.Right}  style={hiddenHandle} />
      </div>
    );
  }

  // --------- EXPANDED: horizontal 1U-style panel ---------
  // Two rows if > 24; each row is a "group" of 6 ports separated by wider gaps.
  const ROW_LIMIT = 24;
  const rows: Port[][] = [];
  for (let i = 0; i < d.ports.length; i += ROW_LIMIT) {
    rows.push(d.ports.slice(i, i + ROW_LIMIT));
  }

  const groupsPerRow = Math.ceil(Math.min(d.ports.length, ROW_LIMIT) / GROUP_SIZE);
  const rowPixelWidth = groupsPerRow * (GROUP_SIZE * (PORT_W + PORT_GAP)) + (groupsPerRow - 1) * GROUP_GAP;
  const panelWidth = Math.max(320, rowPixelWidth + 130);   // 130px = label column

  return (
    <div
      onDoubleClick={(e) => { e.stopPropagation(); focusDevice(id); }}
      title="Двойной клик — свернуть"
      style={{
        width: panelWidth,
        background: meta.bg,
        border: `2px solid ${border}`,
        borderRadius: 8,
        color: '#111827', fontSize: 11,
        boxShadow: selected
          ? '0 0 0 2px #2563EB, 0 6px 14px rgba(15,23,42,0.10)'
          : '0 4px 12px rgba(0,0,0,0.4)',
        overflow: 'visible', cursor: 'grab', position: 'relative',
      }}
    >
      {/* Header (label column on the left of the physical panel) */}
      <div style={{
        display: 'flex', alignItems: 'stretch',
        borderBottom: `1px solid ${meta.color}33`,
      }}>
        <div style={{ padding: '6px 10px', width: 120, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ color: meta.color, display: 'flex' }}><PatchPanelIcon size={16} /></div>
            <div style={{ fontWeight: 600, fontSize: 11,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {d.name}
            </div>
          </div>
          <div style={{ fontSize: 9, opacity: 0.6, marginTop: 2 }}>
            {d.model || 'patch panel'}
          </div>
          {d.location && (
            <div style={{ fontSize: 9, opacity: 0.5, marginTop: 1 }}>📍 {d.location}</div>
          )}
        </div>

        <div style={{ flex: 1, padding: '4px 10px 4px 4px', position: 'relative' }}>
          {/* Port rows */}
          {rows.map((row, ri) => (
            <PatchRow
              key={ri} row={row} nodeId={id}
              onPortClick={pid => selectPort(id, pid)}
            />
          ))}
        </div>

        <button
          className="nodrag"
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          title="Свернуть"
          style={{
            alignSelf: 'flex-start', margin: 6,
            background: 'rgba(0,0,0,0.3)', border: `1px solid ${meta.color}66`,
            color: '#111827', borderRadius: 4, padding: '1px 5px',
            fontSize: 10, cursor: 'pointer',
          }}
        >◲</button>
      </div>

      {/* Fallback edge handles so devices without portId can still target */}
      <Handle id="_left"   type="source" position={Position.Left}   style={hiddenHandle} />
      <Handle id="_left"   type="target" position={Position.Left}   style={hiddenHandle} />
      <Handle id="_right"  type="source" position={Position.Right}  style={hiddenHandle} />
      <Handle id="_right"  type="target" position={Position.Right}  style={hiddenHandle} />
    </div>
  );
}

// ----------------------------------------------------------------------------

function PatchRow({ row, nodeId, onPortClick }: {
  row: Port[]; nodeId: string;
  onPortClick: (portId: string) => void;
}) {
  const groups: Port[][] = [];
  for (let i = 0; i < row.length; i += GROUP_SIZE) groups.push(row.slice(i, i + GROUP_SIZE));

  return (
    <div style={{ display: 'flex', gap: GROUP_GAP, marginBottom: 4 }}>
      {groups.map((group, gi) => (
        <div key={gi} style={{ display: 'flex', gap: PORT_GAP }}>
          {group.map(port => (
            <PatchPort key={port.id} port={port} nodeId={nodeId} onClick={() => onPortClick(port.id)} />
          ))}
        </div>
      ))}
    </div>
  );
}

function PatchPort({ port, nodeId, onClick }: { port: Port; nodeId: string; onClick: () => void }) {
  const openContextMenu = useStore(s => s.openContextMenu);
  const [hover, setHover] = useState(false);
  const col = statusColor(port);
  const num = port.id.replace(/^(port|eth|p)/i, '');

  return (
    <div
      className="nodrag"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onContextMenu={(e) => {
        e.preventDefault(); e.stopPropagation();
        openContextMenu({ x: e.clientX, y: e.clientY,
          target: { type: 'port', deviceId: nodeId, portId: port.id } });
      }}
      style={{
        position: 'relative',
        width: PORT_W, height: PORT_H + 10,
        cursor: 'pointer',
      }}
    >
      {/* number above port */}
      <div style={{
        fontSize: 8, textAlign: 'center', color: '#6B7280',
        height: 10, lineHeight: '10px', fontFamily: 'monospace'
      }}>{num}</div>

      {/* the RJ45 keystone */}
      <div style={{
        width: PORT_W, height: PORT_H,
        background: col.bg,
        border: `1.5px solid ${col.border}`,
        borderRadius: 3,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: hover ? '0 0 0 2px rgba(94,234,212,0.4)' : 'none',
        transition: 'box-shadow 0.1s',
        position: 'relative'
      }}>
        {/* mini "8P8C" bars to look like a real keystone */}
        <div style={{
          display: 'flex', gap: 1, alignItems: 'flex-end',
          height: 8, opacity: 0.55
        }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ width: 1.5, height: 6 + (i%2), background: col.border }} />
          ))}
        </div>

        {/* Handles: BOTH sides map to the same portId (pass-through) */}
        <Handle
          type="source" id={port.id} position={Position.Top}
          style={{ top: -2, left: '50%', width: 6, height: 6, background: col.border, border: 'none', opacity: hover ? 1 : 0 }}
        />
        <Handle
          type="target" id={port.id} position={Position.Top}
          style={{ top: -2, left: '50%', width: 6, height: 6, background: col.border, border: 'none', opacity: hover ? 1 : 0 }}
        />
        <Handle
          type="source" id={port.id + ':back'} position={Position.Bottom}
          style={{ bottom: -2, left: '50%', width: 6, height: 6, background: col.border, border: 'none', opacity: hover ? 1 : 0 }}
        />
        <Handle
          type="target" id={port.id + ':back'} position={Position.Bottom}
          style={{ bottom: -2, left: '50%', width: 6, height: 6, background: col.border, border: 'none', opacity: hover ? 1 : 0 }}
        />
      </div>

      {/* Tooltip */}
      {hover && (
        <div style={{
          position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
          background: '#F9FAFB', border: '1px solid #D1D5DB', borderRadius: 6,
          padding: '6px 10px', fontSize: 10, whiteSpace: 'nowrap',
          color: '#111827', pointerEvents: 'none', zIndex: 100,
          boxShadow: '0 4px 12px rgba(15,23,42,0.12)', marginTop: 6,
        }}>
          <div style={{ fontWeight: 600 }}>Порт {num}</div>
          {port.label ? <div style={{ opacity: 0.8 }}>→ {port.label}</div>
                      : <div style={{ opacity: 0.4 }}>(не подписан)</div>}
          <div style={{ opacity: 0.6, marginTop: 2 }}>
            {(port.status || 'down').toUpperCase()}
          </div>
        </div>
      )}
    </div>
  );
}

function statusColor(p: Port): { bg: string; border: string } {
  const s = p.status || 'down';
  if (s === 'up')       return { bg: '#D1FAE5', border: '#10B981' };
  if (s === 'error')    return { bg: '#FCA5A5', border: '#f87171' };
  if (s === 'disabled') return { bg: '#F3F4F6', border: '#9CA3AF' };
  return { bg: '#E5E7EB', border: '#9CA3AF' };
}

const hiddenHandle: React.CSSProperties = {
  width: 8, height: 8, background: 'transparent', border: 'none',
};
