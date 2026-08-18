import { useEffect, useMemo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, getBezierPath, type EdgeProps } from '@xyflow/react';
import { useStore } from './store';
import { edgeRouter } from './edgeRouter';

interface PortEdgeData {
  sourcePort?: string;
  targetPort?: string;
  cable?: 'copper' | 'fiber' | 'wifi';
  centerLabel?: string;
  /** v0.42: speed-based colour for the reference-style metric badge. */
  centerBadgeColor?: string;
  isUplink?: boolean;
  arrowAtTarget?: boolean;
  arrowAtSource?: boolean;
  isInterGroup?: boolean;
  /** Access/native VLAN on this link (rendered as a colored badge in the middle). */
  vlan?: number;
  /** Trunk VLANs (allowed) — rendered as smaller chips clustered near the badge. */
  vlans?: number[];
  /** Parallel-cable bundle: which index in the bundle this cable has (0-based). */
  bundleIndex?: number;
  /** How many cables total in this bundle (parallel between same source-target pair). */
  bundleTotal?: number;
}

/** Perpendicular pixel offset per parallel-cable index — separates the paths visually. */
const BUNDLE_SPACING = 14;

/**
 * Edge renderer for NetMap cables. v0.15 additions:
 *   - Inter-group links use bezier routing (smooth curves), intra-group stay smoothstep.
 *   - VLAN badges rendered in the middle when link.vlan / link.vlans is set.
 *   - Highlight glow when store.highlightLinkId matches (Port Matrix ⇄ canvas link).
 */
export function PortEdge(props: EdgeProps) {
  const {
    id, sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, style, markerEnd, data,
    source, target,
  } = props;

  const d = (data || {}) as PortEdgeData;
  const selectedEdgeId = useStore(s => s.selectedEdgeId);
  const highlightLinkId = useStore(s => s.highlightLinkId);
  const traceLinkIds = useStore(s => s.hoveredTraceLinkIds);
  const knifeMode = useStore(s => s.knifeMode);
  const removeLink = useStore(s => s.removeLink);
  const selectEdge = useStore(s => s.selectEdge);
  // Focus-related (dim non-related cables) — one of the biggest usability wins.
  const focusRelated   = useStore(s => s.focusRelated);
  const hoveredId      = useStore(s => s.hoveredDeviceId);
  const selectedDevId  = useStore(s => s.selectedDeviceId);
  const multiSelected  = useStore(s => s.multiSelectedIds);
  const vlansList = useStore(s => s.doc.vlans);
  const vlansById = useMemo(
    () => new Map((vlansList || []).map(v => [v.vlanId, v])),
    [vlansList]
  );

  const isSelected = selectedEdgeId === id;
  const isHighlighted = highlightLinkId === id;
  // v0.26: on-trace = the port-hover cable-trace passes through this link.
  // Overrides normal dim/emphasise logic so the whole path lights up.
  const isOnTrace = traceLinkIds.has(id);

  // Compute the "active" set of device ids: hover has priority, otherwise
  // fall back to the current selection (single or multi). If none are active,
  // no dimming is applied — everything is fully visible.
  const activeIds: Set<string> | null = (() => {
    if (hoveredId) return new Set([hoveredId]);
    if (multiSelected && multiSelected.size > 0) return multiSelected;
    if (selectedDevId) return new Set([selectedDevId]);
    return null;
  })();
  const isRelated = !activeIds || activeIds.has(source) || activeIds.has(target);
  // If a port-trace is active, everything OFF the trace gets dimmed (regardless
  // of focus-related setting). Trace has the strongest visual priority.
  const traceActive = traceLinkIds.size > 0;
  const isDimmed = (traceActive && !isOnTrace && !isSelected && !isHighlighted)
                || (focusRelated && !!activeIds && !isRelated && !isSelected && !isHighlighted && !traceActive);
  const isEmphasised = !!activeIds && isRelated && !isSelected && !isHighlighted && !isOnTrace;

  // v0.23: bundle offset — for parallel cables between the same two nodes,
  // spread them perpendicular to the line SRC→TGT so they don't stack.
  // First / only cable in a bundle is unchanged (index 0 of total 1 → offset 0).
  const bundleTotal = d.bundleTotal ?? 1;
  const bundleIndex = d.bundleIndex ?? 0;
  let sx = sourceX, sy = sourceY, tx = targetX, ty = targetY;
  if (bundleTotal > 1) {
    // Signed offset: -1, 0, +1 for 3 cables; -1.5, -0.5, +0.5, +1.5 for 4
    const offsetSteps = bundleIndex - (bundleTotal - 1) / 2;
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const len = Math.hypot(dx, dy) || 1;
    // Unit perpendicular (rotate 90° clockwise: (dy, -dx) / len)
    const nx = dy / len;
    const ny = -dx / len;
    const off = offsetSteps * BUNDLE_SPACING;
    sx = sourceX + nx * off;
    sy = sourceY + ny * off;
    tx = targetX + nx * off;
    ty = targetY + ny * off;
  }

  // v0.33: fallback path using React Flow's built-ins — used until the
  // async node-avoiding router (edgeRouter) publishes a routed path for
  // this edge. Once routed, we prefer that path so cables don't cross cards.
  const [fallbackPath, labelX, labelY] = d.isInterGroup
    ? getBezierPath({
        sourceX: sx, sourceY: sy, targetX: tx, targetY: ty,
        sourcePosition, targetPosition, curvature: 0.35,
      })
    : getSmoothStepPath({
        sourceX: sx, sourceY: sy, targetX: tx, targetY: ty,
        sourcePosition, targetPosition,
        borderRadius: 12, offset: 20,
      });

  // v0.34.1: register endpoint geometry ONLY when it changes. No cleanup
  // unregister — the router keeps stale entries silently and prunes them
  // when the topology-level rebuild sees the whole registry. Removing the
  // cleanup avoids the register→unregister→register storm that used to
  // trigger #185 on multi-select bulk operations.
  useEffect(() => {
    edgeRouter.register({
      linkId: id,
      sx, sy, ss: sourcePosition,
      tx, ty, ts: targetPosition,
      sourceDevId: source, targetDevId: target,
    });
  }, [id, sx, sy, tx, ty, sourcePosition, targetPosition, source, target]);

  useEffect(() => {
    return () => { edgeRouter.unregister(id); };
  }, [id]);

  // v0.34.1: subscribe to the router's version tick via zustand so React can
  // batch and dedupe updates (was per-listener storm before → error #185).
  const routerVersion = useStore(s => s.edgeRouterVersion);
  void routerVersion;
  const routedPath = edgeRouter.getPath(id);
  const path = routedPath || fallbackPath;

  const strokeColor = (style as any)?.stroke || '#94A3B8';
  const baseWidth = (style as any)?.strokeWidth || 1.5;

  const finalStyle: React.CSSProperties = {
    ...(style || {}),
    // v0.26: on-trace cables win over everything else — bold yellow-orange path
    // so the user's eye locks onto the whole cable route at once.
    stroke: isOnTrace ? '#F59E0B' : (style as any)?.stroke,
    strokeWidth: isOnTrace
      ? baseWidth + 2.5
      : isSelected
        ? baseWidth + 2
        : isHighlighted
          ? baseWidth + 1.5
          : isEmphasised
            ? baseWidth + 0.8
            : baseWidth,
    filter: isOnTrace
      ? 'drop-shadow(0 0 8px #F59E0B)'
      : isSelected
        ? 'drop-shadow(0 0 6px #2563EB)'
        : isHighlighted
          ? 'drop-shadow(0 0 6px #F59E0B)'
          : isEmphasised
            ? `drop-shadow(0 0 4px ${strokeColor}88)`
            : d.isInterGroup
              ? `drop-shadow(0 0 3px ${strokeColor}66)`
              : (style as any)?.filter,
    opacity: isDimmed ? 0.12 : 1,
    transition: 'opacity 0.18s, stroke-width 0.18s, filter 0.18s, stroke 0.15s',
    cursor: knifeMode ? 'crosshair' : 'pointer',
  };

  // v0.18: arrows removed — cables are clean lines like in the reference.
  void markerEnd;

  // Prefer explicit vlan over first entry in vlans[]
  const primaryVlan = d.vlan ?? (d.vlans && d.vlans.length > 0 ? d.vlans[0] : undefined);
  const extraTrunkVlans = d.vlans ? d.vlans.filter(v => v !== primaryVlan) : [];

  return (
    <>
      <BaseEdge id={id} path={path} style={finalStyle} />

      {/* Wider transparent hit-path — makes it easier to click a thin cable */}
      <path
        d={path} fill="none" stroke="transparent" strokeWidth={20}
        style={{ cursor: knifeMode ? 'crosshair' : 'pointer', pointerEvents: 'stroke' }}
      />

      <EdgeLabelRenderer>
        {d.sourcePort && (
          <PortBubble
            x={sourceX} y={sourceY} side={sourcePosition}
            label={d.sourcePort} color={strokeColor} dimmed={isSelected || isDimmed}
          />
        )}
        {d.targetPort && (
          <PortBubble
            x={targetX} y={targetY} side={targetPosition}
            label={d.targetPort} color={strokeColor} dimmed={isSelected || isDimmed}
          />
        )}

        {/* VLAN badge — pill with VLAN ID + name in project color */}
        {primaryVlan != null && !isSelected && (
          <div style={{ opacity: isDimmed ? 0.2 : 1, transition: 'opacity 0.15s' }}>
            <VlanBadgeOnCable x={labelX} y={labelY}
                              vlanId={primaryVlan}
                              vlan={vlansById.get(primaryVlan)}
                              extra={extraTrunkVlans}
                              extraVlans={extraTrunkVlans.map(v => vlansById.get(v))}
                              onFilter={(vid) => useStore.getState().setVlanFilter(vid)} />
          </div>
        )}

        {/* Center label (speed etc.) — only when there is no VLAN badge.
            v0.42: reference-style metric badge — colored capsule matching
            the speed. Uses `centerBadgeColor` if set, otherwise falls back
            to the edge stroke color. */}
        {d.centerLabel && !isSelected && primaryVlan == null && (
          <div style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            background: d.centerBadgeColor || '#2563EB',
            color: '#FFFFFF',
            padding: '3px 10px', borderRadius: 999,
            fontSize: 10, fontWeight: 700,
            border: `1px solid ${d.centerBadgeColor || strokeColor}`,
            boxShadow: `0 2px 6px ${(d.centerBadgeColor || '#2563EB')}55`,
            pointerEvents: 'none', zIndex: 10,
            whiteSpace: 'nowrap',
            fontFamily: 'ui-monospace, monospace',
            opacity: isDimmed ? 0.25 : 1,
            transition: 'opacity 0.15s',
            letterSpacing: 0.2,
          }}>
            {d.centerLabel}
          </div>
        )}

        {/* Delete button when selected */}
        {isSelected && (
          <button
            className="nodrag nopan"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); removeLink(id); selectEdge(null); }}
            title="Удалить кабель (Delete)"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: '#FEE2E2', border: '2px solid #EF4444', color: '#B91C1C',
              borderRadius: '50%', width: 28, height: 28,
              cursor: 'pointer', fontSize: 14, fontWeight: 700, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(15,23,42,0.15)',
              pointerEvents: 'auto', zIndex: 9999,
              padding: 0,
            }}
          >✕</button>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

/**
 * Compact VLAN badge that hangs from the middle of a cable.
 * Format: "V10 CORPORATE  +2"  where +N shows there are trunk VLANs too.
 */
function VlanBadgeOnCable({ x, y, vlanId, vlan, extra, extraVlans, onFilter }: {
  x: number; y: number;
  vlanId: number;
  vlan?: { color: string; name: string };
  extra: number[];
  extraVlans: Array<{ color: string; name: string } | undefined>;
  onFilter?: (vlanId: number) => void;
}) {
  const color = vlan?.color || '#6B7280';
  return (
    <div
      className="nodrag nopan"
      onClick={(e) => { e.stopPropagation(); onFilter?.(vlanId); }}
      title={`Клик — показать на канвасе только VLAN ${vlanId}${vlan?.name ? ` (${vlan.name})` : ''}`}
      style={{
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
        display: 'flex', alignItems: 'center', gap: 4,
        background: '#FFFFFF', border: `1px solid ${color}55`,
        borderRadius: 999, padding: '1px 3px 1px 1px',
        boxShadow: '0 1px 3px rgba(15,23,42,0.10)',
        pointerEvents: 'auto', zIndex: 10,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
      }}
    >
      <span style={{
        display: 'inline-block',
        background: color, color: '#FFFFFF',
        fontSize: 9, fontWeight: 800,
        padding: '1px 5px', borderRadius: 999,
        fontFamily: 'ui-monospace, monospace',
        minWidth: 20, textAlign: 'center',
      }}>{vlanId}</span>
      {vlan?.name && (
        <span style={{
          fontSize: 9, fontWeight: 700, color: '#374151',
          letterSpacing: 0.3, textTransform: 'uppercase',
          maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {vlan.name}
        </span>
      )}
      {extra.length > 0 && (
        <span title={extra.map((v, i) => extraVlans[i]?.name ? `${v} ${extraVlans[i]!.name}` : String(v)).join(', ')}
              style={{
                fontSize: 8, fontWeight: 700, color: '#6B7280',
                background: '#F3F4F6', border: '1px solid #E5E7EB',
                borderRadius: 999, padding: '0 4px',
              }}>+{extra.length}</span>
      )}
    </div>
  );
}

function PortBubble({ x, y, side, label, color, dimmed }: {
  x: number; y: number; side: any; label: string; color?: string; dimmed?: boolean;
}) {
  const OFFSET = 18;
  let dx = 0, dy = 0;
  let originX = '50%', originY = '50%';

  const s = String(side);
  if (s === 'right')  { dx =  OFFSET; originX = '0%';   originY = '50%'; }
  if (s === 'left')   { dx = -OFFSET; originX = '100%'; originY = '50%'; }
  if (s === 'bottom') { dy =  OFFSET; originX = '50%';  originY = '0%';  }
  if (s === 'top')    { dy = -OFFSET; originX = '50%';  originY = '100%'; }

  const shortLabel = label
    .replace(/^eth/i, 'e')
    .replace(/^port/i, 'p')
    .replace(/^sfp\+?/i, 's')
    .replace(/^wan/i, 'W')
    .replace(/^lan/i, 'L')
    .replace(/^poe/i, 'PoE')
    .replace(/^vnic/i, 'v')
    .toUpperCase();

  return (
    <div
      className="nodrag nopan"
      style={{
        position: 'absolute',
        transform: `translate(-${originX}, -${originY}) translate(${x + dx}px, ${y + dy}px)`,
        background: '#FFFFFF',
        color: color || '#374151',
        border: `1px solid ${color || '#D1D5DB'}`,
        borderRadius: 3,
        padding: '1px 5px',
        fontSize: 9,
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        fontWeight: 700,
        lineHeight: '13px',
        pointerEvents: 'none',
        boxShadow: '0 1px 3px rgba(15,23,42,0.10)',
        whiteSpace: 'nowrap',
        zIndex: 20,
        opacity: dimmed ? 0.4 : 1,
      }}
    >
      {shortLabel}
    </div>
  );
}
