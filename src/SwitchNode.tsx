import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useMemo, useRef, useState } from 'react';
import type { Device, Port } from './types';
import { useStore } from './store';
import { PoeButton } from './PoeButton';
import { LiveStatusDot } from './DeviceNode';
import { inferLayer, LAYER_META } from './layers';
import { KIND_META, ICONS } from './icons';
import { traceCable, type TraceHop } from './traceCable';
import { portSides } from './portSides';

interface Data {
  device: Device;
  highlighted?: boolean;
}

// v0.15 realistic switch faceplate — matches the reference mockup.
// Dark chassis + light port slots with green/blue LED dots on top of each slot.
// v0.22: switch chassis palette repainted to the light-grey "Cisco/UniFi" look
// from the reference mockup. Bezel light-silver, port slots dark for contrast.
const CHASSIS_BG = 'linear-gradient(180deg, #F1F3F5 0%, #D8DCE0 55%, #B8BEC5 100%)';
const CHASSIS_BORDER = '#A0A6AE';
const CHASSIS_TEXT = '#1F2937';
const SLOT_BG = '#111827';          // recessed port hole — still dark for contrast
const SLOT_BORDER = '#4B5563';

// v0.28: bigger, easier-to-hit ports. Was 16×14 → felt tiny for reliable hover.
const PORT_W = 22;
const PORT_H = 20;
const PORT_GAP = 3;
const GROUP_GAP = 8;
const HEADER_H = 36;

export function SwitchNode({ id, data, selected }: NodeProps<any>) {
  const d = (data as Data).device;
  const highlighted = (data as Data).highlighted;
  const updateDevice = useStore(s => s.updateDevice);
  const select = useStore(s => s.select);
  const selectPort = useStore(s => s.selectPort);

  const focusDevice = useStore(s => s.focusDevice);
  const isRack = d.display === 'rack';
  const toggle = () => updateDevice(id, { display: isRack ? 'compact' : 'rack' });
  const openFocus = () => focusDevice(id);

  if (!isRack) {
    return <CompactSwitchView device={d} selected={selected} highlighted={highlighted}
                              onToggle={toggle} onFocus={openFocus} />;
  }

  // v0.34.3: dedupe by port.id — some imports (MikroTik REST + manual
  // additions) leave duplicate ids in the array, which then made hover
  // "light up" two slots for the same trace key.
  const seenIds = new Set<string>();
  const uniquePorts = d.ports.filter(p => {
    if (seenIds.has(p.id)) return false;
    seenIds.add(p.id);
    return true;
  });
  const copper = uniquePorts.filter(p => p.type !== 'SFP' && p.type !== 'SFP+' && p.type !== 'WiFi' && p.type !== 'Console');
  const sfp    = uniquePorts.filter(p => p.type === 'SFP' || p.type === 'SFP+');
  const other  = uniquePorts.filter(p => p.type === 'WiFi' || p.type === 'Console');

  // Split copper ports into pairs of 4 (matches real 24/48-port switch layout).
  // Two rows: top = odd-numbered, bottom = even, exactly like a rackmount face.
  const groupsOfFour = Math.ceil(copper.length / 4);
  const copperRowWidth = groupsOfFour * (4 * (PORT_W + PORT_GAP) + GROUP_GAP);
  const sfpWidth = sfp.length > 0 ? (sfp.length * (PORT_W + PORT_GAP) + 24) : 0;
  const width = Math.max(280, copperRowWidth + sfpWidth + 40);

  const topRow = copper.filter((_, i) => i % 2 === 0);
  const botRow = copper.filter((_, i) => i % 2 === 1);

  const borderColor = selected ? '#2563EB' : highlighted ? '#F59E0B' : CHASSIS_BORDER;

  // v0.35.8 REDESIGN: clean vector rack view matching the reference mockup.
  // The old dark chassis look is replaced with a light card + tight typography
  // + color-coded chips over each port (speed / PoE / VLAN).
  // Layout:
  //   Header row:  [icon]  Name  [Online]        [chip legend]
  //                        Model · IP
  //   Port grid:   2 rows × N cols
  //     Row 1 (top ports):  [chip]  [RJ-45]     ← chip above, dot below
  //                          [dot]  ↑ number
  //     Row 2 (bottom ports): number ↓          ← number above, chip+RJ45 below
  //                           [chip]  [RJ-45]
  //                                   [dot]
  //   Right summary column:  N Ports · PoE budget · N VLANs  · «…» kebab
  const totalPorts = copper.length + sfp.length;
  const poeActive = copper.filter(p => p.poeActive).length;
  const poeBudget = poeActive * 30;   // rough estimate: 30W per active PoE port
  const vlanSet = new Set<number>();
  for (const p of d.ports) {
    if (p.vlan != null) vlanSet.add(p.vlan);
    for (const v of p.vlans || []) vlanSet.add(v);
  }
  const online = d.liveStatus === 'up' || (!d.liveStatus && !d.ip)   // no IP → assume online
    ? true : d.liveStatus !== 'down';

  return (
    <div
      onDoubleClick={(e) => { e.stopPropagation(); openFocus(); }}
      style={{
        minWidth: width + 100,
        background: '#FFFFFF',
        border: `1px solid ${selected ? '#2563EB' : highlighted ? '#F59E0B' : '#E5E7EB'}`,
        borderRadius: 12,
        color: '#111827',
        fontSize: 11,
        boxShadow: selected
          ? '0 0 0 3px rgba(37,99,235,0.15), 0 8px 24px rgba(15,23,42,0.10)'
          : '0 2px 8px rgba(15,23,42,0.08)',
        overflow: 'visible',
        position: 'relative',
      }}>
      {d.liveStatus && d.liveStatus !== 'unknown' && (
        <LiveStatusDot status={d.liveStatus} rttMs={d.lastRttMs} at={d.lastCheckedAt} />
      )}
      {/* Layer stripe (Core/Distribution/Access) */}
      {(() => { const l = LAYER_META[inferLayer(d)]; return (
        <div title={`${l.label} · ${l.description}`} style={{
          position: 'absolute', left: -1, top: 12, bottom: 12, width: 3,
          background: l.color, borderRadius: '2px 0 0 2px',
          pointerEvents: 'none', zIndex: 1,
        }} />
      ); })()}

      {/* Header — light theme, icon + name + status + model */}
      <div style={{
        padding: '12px 16px 10px',
        display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid #F3F4F6',
        cursor: 'grab', userSelect: 'none',
      }} onClick={() => select(id)}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: '#EFF6FF', color: '#2563EB',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <SwitchIconSvg />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: '#111827',
                           whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                           maxWidth: 240 }}>{d.name}</span>
            <span style={{
              fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
              background: online ? '#D1FAE5' : '#FEE2E2',
              color: online ? '#065F46' : '#991B1B',
              whiteSpace: 'nowrap',
            }}>{online ? 'Online' : 'Offline'}</span>
          </div>
          <div style={{ fontSize: 10, color: '#6B7280', marginTop: 1,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {[d.model, d.ip].filter(Boolean).join(' · ') || 'switch'}
          </div>
        </div>
        {/* Chip legend — right side of header (mirrors reference mockup) */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <LegendChip color="#3B82F6" bg="#DBEAFE" label="1G" />
          <LegendChip color="#059669" bg="#D1FAE5" label="PoE+" />
          <LegendChip color="#7C3AED" bg="#EDE9FE" label="VLAN" />
        </div>
      </div>

      {/* Body: port grid + summary sidebar */}
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        {/* Ports grid */}
        <div style={{ flex: 1, padding: '14px 16px 16px' }}>
          {copper.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Top row — chip above, RJ-45, then number below */}
              <PortGridRow ports={topRow} nodeId={id} device={d}
                            onPortClick={selectPort} rowSide="top" />
              {/* Bottom row — number above, RJ-45, chip below */}
              <PortGridRow ports={botRow} nodeId={id} device={d}
                            onPortClick={selectPort} rowSide="bottom" />
            </div>
          )}
          {sfp.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 12,
                          borderTop: '1px dashed #E5E7EB',
                          display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF',
                             textTransform: 'uppercase', letterSpacing: 0.5 }}>SFP+</span>
              <div style={{ display: 'flex', gap: PORT_GAP }}>
                {sfp.map(p => (
                  <PortSlot
                    key={p.id} port={p} nodeId={id} device={d}
                    onPortClick={selectPort} rowSide="top" isSfp
                  />
                ))}
              </div>
            </div>
          )}
          {other.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, fontSize: 9, color: '#9CA3AF' }}>
              {other.map(p => <span key={p.id}>{p.type} {p.label || p.id}</span>)}
            </div>
          )}
        </div>

        {/* Right sidebar summary */}
        <div style={{
          padding: '14px 14px 14px 12px', borderLeft: '1px solid #F3F4F6',
          display: 'flex', flexDirection: 'column', gap: 14,
          alignItems: 'flex-start', minWidth: 96, flexShrink: 0,
        }}>
          <SummaryRow icon={<PortsSummaryIcon />} value={String(totalPorts)} label="Ports" color="#374151" />
          {poeActive > 0 && (
            <SummaryRow icon={<PoeSummaryIcon />}
                         value={`${poeBudget}W`} label="PoE Budget" color="#059669" />
          )}
          {vlanSet.size > 0 && (
            <SummaryRow icon={<VlansSummaryIcon />}
                         value={String(vlanSet.size)} label="VLANs" color="#7C3AED" />
          )}
          <button
            className="nodrag"
            title="Свернуть в компакт"
            onClick={(e) => { e.stopPropagation(); updateDevice(id, { display: 'compact' }); }}
            style={{
              background: '#F9FAFB', border: '1px solid #E5E7EB',
              color: '#6B7280', borderRadius: 6, padding: '3px 8px',
              fontSize: 11, cursor: 'pointer', alignSelf: 'flex-end',
            }}>…</button>
        </div>
      </div>
    </div>
  );
}

// ---- v0.35.8 mini components for the redesigned rack view ----
function SwitchIconSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="8" rx="1.5" />
      <path d="M6 12h.01M9 12h.01M12 12h.01M15 12h.01M18 12h.01" />
      <path d="M12 4v4M12 16v4" />
    </svg>
  );
}
function LegendChip({ color, bg, label }: { color: string; bg: string; label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 10,
      background: '#FFFFFF', border: '1px solid #E5E7EB',
      fontSize: 10, fontWeight: 600, color: '#374151',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      <span>{label}</span>
      {void bg}
    </span>
  );
}
function PortGridRow({ ports, nodeId, device, onPortClick, rowSide }: {
  ports: Port[]; nodeId: string; device: Device;
  onPortClick: (nodeId: string, portId: string) => void;
  rowSide: 'top' | 'bottom';
}) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
      {ports.map(p => (
        <PortSlot
          key={p.id} port={p} nodeId={nodeId} device={device}
          onPortClick={onPortClick} rowSide={rowSide}
        />
      ))}
    </div>
  );
}
function SummaryRow({ icon, value, label, color }: {
  icon: React.ReactNode; value: string; label: string; color: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color, display: 'inline-flex', width: 18, height: 18,
                     alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{value}</span>
        <span style={{ fontSize: 9, color: '#9CA3AF' }}>{label}</span>
      </div>
    </div>
  );
}
function PortsSummaryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="9" width="18" height="7" rx="1"/>
      <path d="M6 12h.01M10 12h.01M14 12h.01M18 12h.01"/>
    </svg>
  );
}
function PoeSummaryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 11 14 9 22 21 10 13 10 13 2" fill="currentColor" fillOpacity="0.15"/>
    </svg>
  );
}
function VlansSummaryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 3 7l9 5 9-5-9-5z"/>
      <path d="M3 12l9 5 9-5"/>
      <path d="M3 17l9 5 9-5"/>
    </svg>
  );
}

// ============================================================================

function ChassisLed({ color, pulse, title }: { color: string; pulse?: boolean; title: string }) {
  return (
    <span title={title} style={{
      width: 5, height: 5, borderRadius: '50%',
      background: color, boxShadow: `0 0 4px ${color}, 0 0 1px ${color}`,
      animation: pulse ? 'netmap-led-pulse 2s infinite' : undefined,
    }} />
  );
}

function PortRow({ ports, onPortClick, nodeId, device, rowSide }: {
  ports: Port[];
  onPortClick: (nodeId: string, portId: string) => void;
  nodeId: string; device: Device;
  rowSide: 'top' | 'bottom';
}) {
  const chunks: Port[][] = [];
  for (let i = 0; i < ports.length; i += 2) chunks.push(ports.slice(i, i + 2));

  return (
    <div style={{ display: 'flex', gap: GROUP_GAP }}>
      {chunks.map((chunk, ci) => (
        <div key={ci} style={{ display: 'flex', gap: PORT_GAP }}>
          {chunk.map(p => (
            <PortSlot
              key={p.id} port={p} nodeId={nodeId} device={device}
              onPortClick={onPortClick} rowSide={rowSide}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * A single realistic port slot on the switch faceplate.
 * Structure (top-row example):
 *   [ number label ]
 *   [ LED dot         ]  ← link/PoE indicator
 *   [ RJ45 slot       ]
 *   [ handle "tail"   ]  ← invisible until hover, used by React Flow for cables
 */
function PortSlot({ port, nodeId, device, onPortClick, rowSide, isSfp }: {
  port: Port; nodeId: string; device: Device;
  onPortClick: (nodeId: string, portId: string) => void;
  rowSide: 'top' | 'bottom';
  isSfp?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelLeave = () => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
  };
  const scheduleLeave = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      setHover(false); setHoveredPort(null, null);
      leaveTimer.current = null;
    }, 220);
  };
  const highlightPortId = useStore(s => s.highlightPortId);
  const hoveredPortKey = useStore(s => s.hoveredPortKey);
  const setHoveredPort = useStore(s => s.setHoveredPort);
  const myKey = `${nodeId}:${port.id}`;
  const isHighlighted = highlightPortId === myKey;
  // v0.26: light up the port if it's anywhere on the currently-hovered
  // cable trace (source, patch-through, or terminal endpoint).
  const traceKeys = useStore(s => s.hoveredTracePortKeys);
  const onTrace = traceKeys.has(myKey);
  const num = port.id.replace(/^(eth|sfp|port)/i, '');
  const updatePort = useStore(s => s.updatePort);
  const openContextMenu = useStore(s => s.openContextMenu);

  const handlePos = rowSide === 'top' ? Position.Top : Position.Bottom;
  const numberOnTop = rowSide === 'top';

  const ledColor = ledColorFor(port);
  const ledOn = port.status === 'up' || port.status === 'error';

  return (
    <div
      className="nodrag"
      style={{
        position: 'relative',
        width: PORT_W, height: PORT_H + 18,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        // v0.28: invisible hover-buffer around the port so the cursor snaps
        // easily. Padding doesn't affect layout but expands the hover hitbox.
        cursor: 'pointer',
      }}
      // v0.35: track hover via a small delay-on-leave so the user has time
      // to move the cursor from the port to the popover (Focus mode / Показать
      // на канвасе buttons). The popover itself keeps hover=true while cursor
      // is inside it (see PortHoverCard onMouseEnter/Leave below).
      onMouseEnter={() => { cancelLeave(); setHover(true); setHoveredPort(nodeId, port.id); }}
      onMouseLeave={scheduleLeave}
      onClick={(e) => { e.stopPropagation(); onPortClick(nodeId, port.id); }}
      onContextMenu={(e) => {
        e.preventDefault(); e.stopPropagation();
        openContextMenu({ x: e.clientX, y: e.clientY,
          target: { type: 'port', deviceId: nodeId, portId: port.id } });
      }}
    >
      {/* v0.35.8 REDESIGN: chip above, RJ-45 icon in the middle, link-status
          dot on the "inside" side of the row (below for top row, above for
          bottom row), number label at the outer edge. Matches the
          "clean vector grid" reference mockup. */}
      {/* Chip (top row only for top position) */}
      {numberOnTop && <PortChip port={port} />}
      {/* Link-status dot for BOTTOM row goes ABOVE the icon */}
      {!numberOnTop && <StatusDot port={port} />}

      {/* Port icon — RJ-45 socket (or SFP slot). Selected/hover glow. */}
      <div style={{
        width: PORT_W, height: PORT_H,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        borderRadius: 3,
        outline: onTrace
          ? '3px solid #F59E0B'
          : isHighlighted ? '2px solid #F59E0B'
          : hover           ? '2px solid #FBBF24'
                            : 'none',
        outlineOffset: 2,
        transform: hover && !onTrace ? 'scale(1.35)' : 'scale(1)',
        transformOrigin: 'center',
        transition: 'outline 0.12s, box-shadow 0.12s, transform 0.12s',
        position: 'relative',
        zIndex: hover || onTrace ? 20 : 1,
        boxShadow: onTrace ? '0 0 8px #F59E0B' : undefined,
      }}>
        {isSfp
          ? <SfpSlotSvg width={PORT_W} height={PORT_H} port={port} />
          : <Rj45SlotSvg width={PORT_W} height={PORT_H} port={port} />}
        {port.uplink && (
          <span style={{
            position: 'absolute', top: 3, left: '50%', transform: 'translateX(-50%)',
            fontSize: 8, fontWeight: 900, color: '#F59E0B',
            textShadow: '0 0 3px #FEF3C7', lineHeight: 1,
            pointerEvents: 'none',
          }}>↑</span>
        )}
      </div>

      {/* Link-status dot for TOP row goes BELOW the icon */}
      {numberOnTop && <StatusDot port={port} />}
      {/* Chip (bottom row) — below RJ-45 */}
      {!numberOnTop && <PortChip port={port} />}
      {/* Number label at the outer edge */}
      <div style={{ ...numLabel, order: numberOnTop ? 99 : -1,
                    color: '#6B7280', fontWeight: 500, fontSize: 10 }}>{num}</div>

      {/* React Flow handle — tiny "tail" outside the chassis */}
      <Handle
        type="source"
        position={handlePos}
        id={port.id}
        isConnectableStart={true}
        isConnectableEnd={true}
        style={{
          [handlePos === Position.Top ? 'top' : 'bottom']: -6,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 8, height: 3,
          background: ledOn ? ledColor : '#4B5563',
          border: 'none', borderRadius: 1,
          boxShadow: hover ? `0 0 0 2px ${ledColor}55` : 'none',
          opacity: 1, zIndex: 15,
        } as any}
      />

      {/* v0.26: rich port popover with the full cable trace.
          v0.35: bridged hover — the card cancels the leave-timer while cursor
          is inside it, so buttons stay clickable. */}
      {hover && (
        <PortHoverCard
          port={port}
          nodeId={nodeId}
          rowSide={rowSide}
          onCardEnter={cancelLeave}
          onCardLeave={scheduleLeave}
          onTogglePoe={() => updatePort(nodeId, port.id, {
            poeActive: !port.poeActive,
            poe: !port.poeActive || port.poe,
          })}
        />
      )}
    </div>
  );
}

/**
 * Floating card that appears when hovering a port.
 * Shows the entire cable path through patch panels — the killer feature for
 * "where does this cable actually go?" trouble-shooting.
 */
function PortHoverCard({ port, nodeId, rowSide, onTogglePoe, onCardEnter, onCardLeave }: {
  port: Port; nodeId: string; rowSide: 'top' | 'bottom';
  onTogglePoe: () => void;
  onCardEnter?: () => void;
  onCardLeave?: () => void;
}) {
  const doc = useStore(s => s.doc);
  const focusDevice = useStore(s => s.focusDevice);
  const select = useStore(s => s.select);

  // Cable trace (through patch panels) — computed on demand for the hovered port
  const trace = useMemo(
    () => traceCable(doc, nodeId, port.id),
    [doc, nodeId, port.id]
  );

  // Skip the origin hop from the visible list — we already show the port header
  const visibleHops = trace.hops.slice(1);
  const terminalHop = visibleHops[visibleHops.length - 1];
  const terminalDev = terminalHop ? doc.devices.find(d => d.id === terminalHop.deviceId) : null;

  return (
    <div
      className="nodrag nopan"
      onMouseEnter={onCardEnter}
      onMouseLeave={onCardLeave}
      style={{
        position: 'absolute',
        [rowSide === 'top' ? 'bottom' : 'top']: '100%',
        left: '50%', transform: 'translateX(-50%)',
        background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8,
        padding: 0, fontSize: 11,
        color: '#111827', pointerEvents: 'auto', zIndex: 200,
        boxShadow: '0 8px 24px rgba(15,23,42,0.18)',
        // v0.35: no gap between port and card so cursor can move without
        // exiting a hover-zone. A separate transparent bridge below fills any
        // sub-pixel space just in case.
        [rowSide === 'top' ? 'marginBottom' : 'marginTop']: 0,
        minWidth: 260, maxWidth: 320,
      } as any}>
      {/* Invisible hover-bridge — covers the 12-px gap between port and card
          so the cursor never lands on empty space and closes the popover. */}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: 14,
        [rowSide === 'top' ? 'bottom' : 'top']: '-14px',
        background: 'transparent',
      } as any} />
      {/* Header — port meta */}
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid #F3F4F6',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 12 }}>
            {port.id.toUpperCase()} · {port.type || 'RJ45'} {port.speed || ''}
          </div>
          <div style={{ color: '#6B7280', marginTop: 2, fontSize: 10 }}>
            {(port.status || 'down').toUpperCase()}
            {port.vlan != null ? ` · VLAN ${port.vlan}` : ''}
            {port.uplink ? ' · UPLINK' : ''}
          </div>
        </div>
        <PoeButton active={!!port.poeActive} parentHover size={11} onToggle={onTogglePoe} />
      </div>

      {/* Cable trace body */}
      {visibleHops.length === 0 ? (
        <div style={{ padding: '10px 12px', color: '#9CA3AF', fontSize: 11 }}>
          Порт свободен — кабель не подключён.
        </div>
      ) : (
        <div style={{ padding: '8px 12px' }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: '#6B7280',
            textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
          }}>
            Кабель ведёт к {trace.hops.length > 2 ? `(через ${trace.hops.length - 2} PP)` : ''}
          </div>
          {visibleHops.map((hop, i) => (
            <TraceHopRow key={i} hop={hop} doc={doc}
                         isLast={i === visibleHops.length - 1}
                         onFocus={() => {
                           select(hop.deviceId);
                           window.dispatchEvent(new CustomEvent('netmap:focus-device', { detail: { id: hop.deviceId } }));
                         }} />
          ))}

          {terminalDev && terminalDev.kind !== 'patchpanel' && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button onClick={() => focusDevice(terminalDev.id)} style={popoverBtnPrimary}>
                Focus mode
              </button>
              <button onClick={() => {
                select(terminalDev.id);
                window.dispatchEvent(new CustomEvent('netmap:focus-device', { detail: { id: terminalDev.id } }));
              }} style={popoverBtnGhost}>
                Показать на канвасе
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TraceHopRow({ hop, doc, isLast, onFocus }: {
  hop: TraceHop; doc: import('./types').NetMapDoc; isLast: boolean; onFocus: () => void;
}) {
  const dev = doc.devices.find(d => d.id === hop.deviceId);
  if (!dev) return null;
  const meta = KIND_META[dev.kind];
  const Icon = ICONS[dev.kind];
  return (
    <div onClick={onFocus}
         title="Клик — центрировать на этом устройстве"
         style={{
           display: 'flex', alignItems: 'center', gap: 8,
           padding: '5px 6px', borderRadius: 5,
           cursor: 'pointer',
           background: hop.transitPp ? '#FEF3C7' : 'transparent',
           marginBottom: isLast ? 0 : 2,
         }}
         onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = hop.transitPp ? '#FDE68A' : '#F3F4F6'}
         onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = hop.transitPp ? '#FEF3C7' : 'transparent'}>
      <div style={{
        width: 22, height: 22, borderRadius: 4,
        background: meta.bg, color: meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#111827',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {dev.name}
          {hop.transitPp && <span style={{
            marginLeft: 4, fontSize: 9, color: '#78350F',
            background: '#FDE68A', padding: '0 4px', borderRadius: 3, fontWeight: 700,
          }}>PATCH</span>}
        </div>
        {hop.portId && (
          <div style={{ fontSize: 10, color: '#6B7280', fontFamily: 'ui-monospace, monospace' }}>
            {hop.portId.toUpperCase()}{dev.ip ? ` · ${dev.ip}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}

const popoverBtnPrimary: React.CSSProperties = {
  flex: 1, padding: '5px 8px',
  background: '#2563EB', color: '#FFFFFF',
  border: '1px solid #2563EB', borderRadius: 5,
  fontSize: 10, fontWeight: 600, cursor: 'pointer',
};
const popoverBtnGhost: React.CSSProperties = {
  flex: 1, padding: '5px 8px',
  background: '#FFFFFF', color: '#374151',
  border: '1px solid #D1D5DB', borderRadius: 5,
  fontSize: 10, fontWeight: 500, cursor: 'pointer',
};

const numLabel: React.CSSProperties = {
  fontSize: 7, textAlign: 'center', color: '#6B7280',
  height: 8, lineHeight: '8px', fontFamily: 'ui-monospace, monospace',
  width: '100%',
};

function ledStyle(color: string, on: boolean, poe?: boolean): React.CSSProperties {
  return {
    width: 4, height: 4, borderRadius: '50%',
    background: on ? color : '#1F2937',
    boxShadow: on ? `0 0 3px ${color}, 0 0 1px ${color}` : 'none',
    border: poe ? '0.5px solid #FBBF24' : 'none',
  };
}

/** LED color per port state — mirrors the mockup: green up, blue 10G-uplink, red error. */
function ledColorFor(port: Port): string {
  if (port.status === 'error') return '#EF4444';
  if (port.status === 'disabled') return '#4B5563';
  if (port.uplink && port.status === 'up') return '#3B82F6';
  if (port.speed === '10G' && port.status === 'up') return '#3B82F6';
  if (port.status === 'up') return '#10B981';
  return '#4B5563';
}

/** RJ45 slot color — dark recessed hole with a subtle tint by state. */
function slotRj45Bg(port: Port): string {
  if (port.status === 'error')    return '#FEE2E2';
  if (port.status === 'disabled') return '#1E1E1E';
  return SLOT_BG;
}

function slotSfpBg(port: Port): string {
  if (port.status === 'error')    return '#FEE2E2';
  return '#000000';
}

/**
 * v0.35.8 — port speed / capability chip drawn ABOVE (or BELOW) each port
 * in the redesigned rack view. Priority (highest wins):
 *   - VLAN (purple, shows the trunk vlan id or the access vlan)
 *   - PoE / PoE+ (green)
 *   - speed (blue: 1G / 10G / 2.5G / 100M)
 */
function PortChip({ port }: { port: Port }) {
  let label: string, bg: string, color: string;
  const vlan = port.vlan ?? (port.vlans && port.vlans[0]);
  if (vlan != null) {
    label = `V${vlan}`; bg = '#EDE9FE'; color = '#5B21B6';
  } else if (port.poeActive) {
    label = 'PoE+'; bg = '#D1FAE5'; color = '#065F46';
  } else if (port.poe) {
    label = 'PoE'; bg = '#DCFCE7'; color = '#166534';
  } else {
    const s = port.speed || '1G';
    label =
      s === '10G'  ? '10G' :
      s === '2.5G' ? '2.5G' :
      s === '100M' ? '100M' : '1G';
    bg = '#DBEAFE'; color = '#1E40AF';
  }
  return (
    <span style={{
      fontSize: 8, fontWeight: 700, lineHeight: '12px',
      padding: '0 4px', borderRadius: 3,
      background: bg, color, letterSpacing: 0.2,
      whiteSpace: 'nowrap',
      // Guarantee fixed height so chips of different lengths still align rows.
      minWidth: 20, textAlign: 'center',
    }}>{label}</span>
  );
}

/** Small round dot showing whether the port has an active cable / link. */
function StatusDot({ port }: { port: Port }) {
  const on = port.status === 'up';
  const err = port.status === 'error';
  const color = err ? '#EF4444' : on ? '#10B981' : '#D1D5DB';
  return (
    <span style={{
      width: 5, height: 5, borderRadius: '50%', background: color,
      boxShadow: on ? `0 0 4px ${color}88` : 'none',
      flexShrink: 0,
    }} />
  );
}

/** Vector RJ-45 socket — a clean dark rectangle with a pin slit inside.
 *  Used in the redesigned rack view instead of the old raw <div> "hole". */
function Rj45SlotSvg({ width, height, port }: { width: number; height: number; port: Port }) {
  const bodyFill = port.status === 'up' ? '#1F2937'
                 : port.status === 'error' ? '#450A0A'
                                            : '#374151';
  return (
    <svg width={width} height={height} viewBox="0 0 24 22"
         xmlns="http://www.w3.org/2000/svg">
      {/* Outer body */}
      <rect x="1.5" y="2" width="21" height="17" rx="2"
            fill={bodyFill} stroke="#111827" strokeWidth="1"/>
      {/* Top pin bar (metal contacts) */}
      <rect x="4.5" y="5" width="15" height="1" fill="#6B7280" />
      {/* Notch / retention clip on the bottom */}
      <path d="M 8 19 L 8 21 L 16 21 L 16 19" fill={bodyFill} stroke="#111827" strokeWidth="1"/>
      {/* Pin slits — 8 thin vertical marks */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
        <line key={i} x1={4.8 + i * 2} y1="7" x2={4.8 + i * 2} y2="15"
              stroke="#4B5563" strokeWidth="0.6" />
      ))}
    </svg>
  );
}

/** Vector SFP cage — long slit with light-guide dot. */
function SfpSlotSvg({ width, height, port }: { width: number; height: number; port: Port }) {
  const bodyFill = port.status === 'up' ? '#1E3A8A' : '#1F2937';
  return (
    <svg width={width} height={height} viewBox="0 0 24 22"
         xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="6" width="22" height="10" rx="1.5"
            fill={bodyFill} stroke="#111827" strokeWidth="1"/>
      <rect x="3" y="8.5" width="18" height="1" fill="#93C5FD" opacity="0.65" />
      <circle cx="20.5" cy="11" r="0.9"
              fill={port.status === 'up' ? '#22D3EE' : '#4B5563'} />
    </svg>
  );
}

function PortSummary({ ports }: { ports: Port[] }) {
  const up  = ports.filter(p => p.status === 'up').length;
  const dn  = ports.length - up;
  const poe = ports.filter(p => p.poeActive).length;
  return (
    <div style={{ display: 'flex', gap: 3, fontSize: 9, alignItems: 'center' }}>
      <span style={pillStyle('#065F46', '#D1FAE5')}>{up}↑</span>
      <span style={pillStyle('#374151', '#D1D5DB')}>{dn}↓</span>
      {poe > 0 && <span style={pillStyle('#78350F', '#FEF3C7')}>{poe}⚡</span>}
    </div>
  );
}

function pillStyle(bg: string, color: string): React.CSSProperties {
  return {
    background: bg, color, padding: '1px 5px',
    borderRadius: 3, fontWeight: 700, fontSize: 9,
    fontFamily: 'ui-monospace, monospace',
  };
}

// ============================================================================
// Compact view — small light-theme card matching the rest of the UI.

/**
 * v0.35.8 REDESIGN — Compact Segmented Bar view.
 * Matches variant 2 of the user's reference mockup:
 *   [icon] Name (Online)              Ports 18/24  ▮▮▮▮▮▮▮▮▮▯▯▯▯▯▯   PoE 245W/370W  VLANs 4
 *          Model · IP                                                                          [◱]
 * Horizontal single-line card that reads at a glance.
 */
function CompactSwitchView({ device, selected, highlighted, onToggle, onFocus }: {
  device: Device; selected: boolean; highlighted?: boolean; onToggle: () => void; onFocus: () => void;
}) {
  const psVersion = useStore(s => s.portSidesVersion);
  void psVersion;

  const totalPorts  = device.ports.length;
  const activePorts = device.ports.filter(p => p.status === 'up').length;
  const poeActive   = device.ports.filter(p => p.poeActive).length;
  const poeBudget   = poeActive * 30;
  const vlanSet     = new Set<number>();
  for (const p of device.ports) {
    if (p.vlan != null) vlanSet.add(p.vlan);
    for (const v of p.vlans || []) vlanSet.add(v);
  }
  const online = device.liveStatus !== 'down';

  return (
    <div
      onDoubleClick={(e) => { e.stopPropagation(); onFocus(); }}
      style={{
        minWidth: 260, maxWidth: 380,
        padding: '10px 12px', borderRadius: 10,
        background: '#FFFFFF',
        border: `1px solid ${selected ? '#2563EB' : highlighted ? '#F59E0B' : '#E5E7EB'}`,
        boxShadow: selected
          ? '0 0 0 3px rgba(37,99,235,0.15), 0 4px 12px rgba(15,23,42,0.10)'
          : '0 1px 3px rgba(15,23,42,0.08)',
        color: '#111827', fontSize: 11, cursor: 'grab', position: 'relative',
        overflow: 'visible',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
      {device.liveStatus && device.liveStatus !== 'unknown' && (
        <LiveStatusDot status={device.liveStatus} rttMs={device.lastRttMs} at={device.lastCheckedAt} />
      )}
      {(() => { const l = LAYER_META[inferLayer(device)]; return (
        <div title={`${l.label} · ${l.description}`} style={{
          position: 'absolute', left: 0, top: 8, bottom: 8, width: 3,
          background: l.color, borderRadius: '2px 0 0 2px',
          pointerEvents: 'none', zIndex: 1,
        }} />
      ); })()}

      {/* Icon + name/model column */}
      <div style={{
        width: 28, height: 28, borderRadius: 6,
        background: '#EFF6FF', color: '#2563EB',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <SwitchIconSvg />
      </div>
      <div style={{ minWidth: 90, maxWidth: 140, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontWeight: 700, fontSize: 12, color: '#111827',
                         whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                         maxWidth: 110 }}>{device.name}</span>
          <span style={{
            fontSize: 8, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
            background: online ? '#D1FAE5' : '#FEE2E2',
            color: online ? '#065F46' : '#991B1B',
          }}>{online ? 'Online' : 'Offline'}</span>
        </div>
        <div style={{ fontSize: 9, color: '#6B7280', marginTop: 1,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      fontFamily: 'ui-monospace, monospace' }}>
          {[device.model, device.ip].filter(Boolean).join(' · ') || 'switch'}
        </div>
      </div>

      {/* Segmented ports bar */}
      <div style={{ flex: 1, minWidth: 90, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={{ fontSize: 9, color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Ports</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>
            {activePorts}<span style={{ color: '#9CA3AF' }}>/{totalPorts}</span>
          </span>
        </div>
        <SegmentedPortsBar active={activePorts} total={totalPorts} />
      </div>

      {/* PoE budget mini chip */}
      {poeActive > 0 && (
        <div style={{ minWidth: 62, flexShrink: 0, textAlign: 'right' }}>
          <div style={{ fontSize: 9, color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>PoE</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#059669' }}>{poeBudget}W</div>
        </div>
      )}
      {/* VLANs chip */}
      {vlanSet.size > 0 && (
        <div style={{ minWidth: 34, flexShrink: 0, textAlign: 'right' }}>
          <div style={{ fontSize: 9, color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>VLAN</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#7C3AED' }}>{vlanSet.size}</div>
        </div>
      )}
      {/* Expand toggle */}
      <button
        className="nodrag"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        title="Развернуть в детальный вид"
        style={{
          background: '#F9FAFB', border: '1px solid #E5E7EB',
          color: '#6B7280', borderRadius: 4, padding: '3px 7px',
          fontSize: 12, cursor: 'pointer', flexShrink: 0,
        }}
      >◱</button>

      {/* Handles — same dynamic-side wiring as before */}
      {device.ports.map((port, idx, arr) => {
        const dynSide = portSides.getSide(device.id, port.id);
        const dynPct  = portSides.getOffsetPct(device.id, port.id);
        let side: Position;
        let pct: number;
        if (dynSide != null) { side = dynSide; pct = dynPct ?? 50; }
        else {
          if (port.uplink) side = Position.Top;
          else {
            const mod = idx % 4;
            side = mod === 0 ? Position.Bottom
                 : mod === 1 ? Position.Right
                 : mod === 2 ? Position.Bottom
                 : Position.Left;
          }
          pct = ((idx + 1) / (arr.length + 1)) * 100;
        }
        const isHorizontal = side === Position.Top || side === Position.Bottom;
        return (
          <div key={port.id}>
            <Handle
              type="source" id={port.id}
              position={side}
              style={{
                [isHorizontal ? 'left' : 'top']: `${pct}%`,
                width: 6, height: 6, background: 'transparent', border: 'none', opacity: 0,
              } as any}
            />
            <Handle
              type="target" id={port.id}
              position={side}
              style={{
                [isHorizontal ? 'left' : 'top']: `${pct}%`,
                width: 6, height: 6, background: 'transparent', border: 'none', opacity: 0,
              } as any}
            />
          </div>
        );
      })}
      <Handle type="target" position={Position.Left}   id="_left"   style={{ background: 'transparent', border: 'none', opacity: 0 }} />
      <Handle type="source" position={Position.Right}  id="_right"  style={{ background: 'transparent', border: 'none', opacity: 0 }} />
      <Handle type="target" position={Position.Bottom} id="_bottom" style={{ background: 'transparent', border: 'none', opacity: 0 }} />
      <Handle type="source" position={Position.Top}    id="_top"    style={{ background: 'transparent', border: 'none', opacity: 0 }} />
    </div>
  );
}

/** Horizontal port-status bar for the compact view. Filled squares = active,
 *  empty = inactive. Capped at 20 segments (real port count in the summary). */
function SegmentedPortsBar({ active, total }: { active: number; total: number }) {
  const shown = Math.min(total, 20);
  const activeShown = Math.round((active / Math.max(1, total)) * shown);
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {Array.from({ length: shown }).map((_, i) => (
        <span key={i} style={{
          flex: 1, height: 8, borderRadius: 1,
          background: i < activeShown ? '#2563EB' : '#E5E7EB',
        }} />
      ))}
    </div>
  );
}

/**
 * Miniature faceplate strip shown on the compact card — a rack of tiny colored
 * squares matching the real port state. Purely decorative but reads at-a-glance.
 */
function MiniFaceplate({ ports }: { ports: Port[] }) {
  // Cap to 24 slots to keep the compact card small
  const shown = ports.slice(0, 24);
  return (
    <div style={{
      background: CHASSIS_BG,
      padding: '5px 8px 5px 12px',
      borderBottom: `1px solid ${CHASSIS_BORDER}`,
      display: 'flex', gap: 1, alignItems: 'center',
    }}>
      {shown.map(p => (
        <span key={p.id} title={p.id.toUpperCase()} style={{
          width: 6, height: 10, borderRadius: 1,
          background: p.status === 'up' ? '#10B981'
                    : p.status === 'error' ? '#EF4444'
                    : '#334155',
          boxShadow: p.status === 'up' ? '0 0 3px #10B98188' : 'none',
        }} />
      ))}
      {ports.length > 24 && (
        <span style={{ fontSize: 8, color: '#9CA3AF', marginLeft: 4, fontFamily: 'ui-monospace, monospace' }}>
          +{ports.length - 24}
        </span>
      )}
    </div>
  );
}
