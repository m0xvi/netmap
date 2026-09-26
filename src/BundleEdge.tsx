/**
 * v0.68.0 — агрегированное ребро обзора (far-ступень): один пучок «×N»
 * вместо N физических кабелей между теми же сущностями (см. scenePlan.ts).
 * Магистраль рисуется двойным штрихом, как PortEdge (визуальный словарь v0.65).
 */

import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

export const BundleEdge = memo(function BundleEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } = props as any;
  const count: number = data?.count || 1;
  const trunk: boolean = !!data?.trunk;

  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });

  const stroke = trunk ? '#64748B' : '#94A3B8';
  const width = selected ? 5 : trunk ? 3.5 : 2.5;

  return (
    <>
      {trunk && (
        <path d={path} fill="none" stroke="#64748B55" strokeWidth={width + 4} strokeLinecap="round" />
      )}
      <BaseEdge id={id} path={path} style={{ stroke, strokeWidth: width, strokeDasharray: undefined }} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'none',
            background: trunk ? '#475569' : '#94A3B8',
            color: '#fff',
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 800,
            lineHeight: '16px',
            padding: '0 6px',
            boxShadow: '0 1px 4px rgba(15,23,42,0.25)',
          }}
        >
          ×{count}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
