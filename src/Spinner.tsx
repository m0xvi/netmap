/**
 * v0.44.2 — Shared visual loading primitives.
 *
 * Three components, all pure-SVG/CSS (no external deps):
 *   - <MiniSpinner light? size?>  — inline circular spinner for buttons
 *   - <ProgressStripe>            — animated barber-pole stripe for status rows
 *   - <ProgressBar value? max?>   — determinate progress bar
 *   - <FullscreenSpinner text?>   — centered spinner for modals/waiting screens
 *
 * All animations use pure CSS keyframes injected once into <head>.
 */

import type { CSSProperties } from 'react';

// ---------------------------------------------------------------------------
// Inject shared keyframes exactly once.
if (typeof document !== 'undefined' && !document.getElementById('nm-spinner-styles')) {
  const el = document.createElement('style');
  el.id = 'nm-spinner-styles';
  el.textContent = `
    @keyframes nm-spin { to { transform: rotate(360deg); } }
    @keyframes nm-stripe {
      0%   { background-position: 0 0; }
      100% { background-position: 32px 0; }
    }
    @keyframes nm-pulse {
      0%, 100% { opacity: 0.4; }
      50%      { opacity: 1; }
    }
    @keyframes nm-shimmer {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }
    @keyframes nm-fadein {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0);    }
    }
    .nm-skeleton {
      position: relative;
      overflow: hidden;
      background: #E2E8F0;
      border-radius: 4px;
    }
    .nm-skeleton::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(255,255,255,0.65) 50%,
        transparent 100%
      );
      transform: translateX(-100%);
      animation: nm-shimmer 1.4s ease-in-out infinite;
    }
  `;
  document.head.appendChild(el);
}

// ---------------------------------------------------------------------------
// MiniSpinner — inline circular spinner (button-sized by default)

export function MiniSpinner({
  size = 12,
  light = false,
  style,
}: { size?: number; light?: boolean; style?: CSSProperties }) {
  const border = Math.max(2, Math.round(size / 6));
  const track  = light ? 'rgba(255,255,255,0.35)' : '#E2E8F0';
  const arc    = light ? '#FFFFFF' : '#2563EB';
  return (
    <span
      role="status"
      aria-label="loading"
      style={{
        display: 'inline-block',
        width: size, height: size,
        border: `${border}px solid ${track}`,
        borderTopColor: arc,
        borderRadius: '50%',
        animation: 'nm-spin 700ms linear infinite',
        verticalAlign: '-2px',
        ...style,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// ProgressStripe — indeterminate barber-pole. Fixed height, fills width.

export function ProgressStripe({
  height = 4, color = '#2563EB', width = 80,
}: { height?: number; color?: string; width?: number | string }) {
  return (
    <span
      role="progressbar"
      aria-busy="true"
      style={{
        display: 'inline-block',
        width, height, borderRadius: height,
        background: `repeating-linear-gradient(
          45deg,
          ${color}CC 0 8px,
          ${color}66 8px 16px
        )`,
        backgroundSize: '32px 100%',
        animation: 'nm-stripe 900ms linear infinite',
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// ProgressBar — determinate bar with percentage

export function ProgressBar({
  value, max = 100, showLabel = false, color = '#2563EB',
}: { value: number; max?: number; showLabel?: boolean; color?: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{ width: '100%' }}>
      <div style={{
        width: '100%', height: 6, background: '#E2E8F0', borderRadius: 3, overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', background: color,
          borderRadius: 3, transition: 'width 200ms ease',
        }} />
      </div>
      {showLabel && (
        <div style={{ marginTop: 4, fontSize: 10, color: '#64748B', textAlign: 'right' }}>
          {value} / {max} ({Math.round(pct)}%)
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FullscreenSpinner — for modal loading screens (fills parent, centered)

export function FullscreenSpinner({
  text = 'Загрузка…',
  subtitle,
  size = 40,
}: { text?: string; subtitle?: string; size?: number }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: 220, padding: 24, gap: 12, animation: 'nm-fadein 200ms ease',
    }}>
      <MiniSpinner size={size} />
      <div style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>{text}</div>
      {subtitle && <div style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center' }}>{subtitle}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton — placeholder blocks with shimmer

export function Skeleton({
  width = '100%', height = 12, radius = 4, style,
}: { width?: number | string; height?: number | string; radius?: number; style?: CSSProperties }) {
  return (
    <div
      className="nm-skeleton"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

// ---------------------------------------------------------------------------
// Reusable disabled/busy button style

export const btnBusy: CSSProperties = {
  opacity: 0.85,
  cursor: 'wait',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};
