import type { DeviceKind } from './types';

/**
 * Minimal monochrome SVG icons for each device kind.
 * Each icon is drawn on a 24x24 viewBox, single stroke color = currentColor.
 * Kept intentionally simple so they read well at any zoom.
 */

type IconProps = { size?: number; color?: string };

const S = (size = 22, color = 'currentColor') => ({
  width: size, height: size, viewBox: '0 0 24 24',
  fill: 'none', stroke: color, strokeWidth: 1.6,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
});

export function RouterIcon({ size, color }: IconProps) {
  return (
    <svg {...S(size, color)}>
      {/* box */}
      <rect x="3" y="12" width="18" height="7" rx="1.5" />
      {/* antennae */}
      <path d="M7 12 V6" /><path d="M12 12 V4" /><path d="M17 12 V6" />
      <path d="M5.5 5 L8.5 7 M9.5 7 L12 3.5 M13 3.5 L15.5 7 M15.5 7 L18.5 5" />
      {/* status LEDs */}
      <circle cx="7" cy="15.5" r="0.6" fill={color || 'currentColor'} />
      <circle cx="10" cy="15.5" r="0.6" fill={color || 'currentColor'} />
      <circle cx="13" cy="15.5" r="0.6" fill={color || 'currentColor'} />
    </svg>
  );
}

export function SwitchIcon({ size, color }: IconProps) {
  return (
    <svg {...S(size, color)}>
      <rect x="2" y="8" width="20" height="8" rx="1.5" />
      {/* ports */}
      <rect x="4" y="10.5" width="2" height="3" />
      <rect x="7" y="10.5" width="2" height="3" />
      <rect x="10" y="10.5" width="2" height="3" />
      <rect x="13" y="10.5" width="2" height="3" />
      <rect x="16" y="10.5" width="2" height="3" />
      <rect x="19" y="10.5" width="1.5" height="3" />
    </svg>
  );
}

export function PatchPanelIcon({ size, color }: IconProps) {
  return (
    <svg {...S(size, color)}>
      <rect x="2" y="6" width="20" height="12" rx="1" />
      {/* dual row of ports */}
      {[4,7,10,13,16,19].map(x => (
        <g key={x}>
          <rect x={x - 0.7} y="8" width="1.6" height="3" />
          <rect x={x - 0.7} y="13" width="1.6" height="3" />
        </g>
      ))}
      {/* mounting screws */}
      <circle cx="3.5" cy="7.5" r="0.4" fill={color || 'currentColor'} />
      <circle cx="20.5" cy="7.5" r="0.4" fill={color || 'currentColor'} />
      <circle cx="3.5" cy="16.5" r="0.4" fill={color || 'currentColor'} />
      <circle cx="20.5" cy="16.5" r="0.4" fill={color || 'currentColor'} />
    </svg>
  );
}

export function APIcon({ size, color }: IconProps) {
  return (
    <svg {...S(size, color)}>
      {/* puck body */}
      <ellipse cx="12" cy="17" rx="8" ry="2.5" />
      <path d="M4 17 V15 A8 2.5 0 0 1 20 15 V17" />
      {/* wifi waves above */}
      <path d="M8 10 Q12 6 16 10" />
      <path d="M6.5 12 Q12 5.5 17.5 12" opacity="0.6" />
      <circle cx="12" cy="12" r="0.8" fill={color || 'currentColor'} />
    </svg>
  );
}

export function CameraIcon({ size, color }: IconProps) {
  return (
    <svg {...S(size, color)}>
      {/* dome camera */}
      <path d="M4 14 Q4 6 12 6 Q20 6 20 14 L4 14 Z" />
      <line x1="4" y1="14" x2="20" y2="14" />
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="1" fill={color || 'currentColor'} />
      {/* mount screw */}
      <line x1="12" y1="14" x2="12" y2="18" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

export function ServerIcon({ size, color }: IconProps) {
  return (
    <svg {...S(size, color)}>
      <rect x="4" y="4" width="16" height="7" rx="1" />
      <rect x="4" y="13" width="16" height="7" rx="1" />
      <circle cx="7" cy="7.5" r="0.6" fill={color || 'currentColor'} />
      <circle cx="9" cy="7.5" r="0.6" fill={color || 'currentColor'} />
      <line x1="12" y1="7.5" x2="18" y2="7.5" />
      <circle cx="7" cy="16.5" r="0.6" fill={color || 'currentColor'} />
      <circle cx="9" cy="16.5" r="0.6" fill={color || 'currentColor'} />
      <line x1="12" y1="16.5" x2="18" y2="16.5" />
    </svg>
  );
}

/** v0.35.4 — DVR/NVR (video recorder). Wider "player-like" chassis with a
 *  film reel + a small camera icon so it reads instantly as a video
 *  surveillance device (not a generic server). Used when device.dvr is set. */
export function DvrIcon({ size, color }: IconProps) {
  return (
    <svg {...S(size, color)}>
      {/* Chassis body */}
      <rect x="2" y="7" width="20" height="11" rx="1.5" />
      {/* Front panel line */}
      <line x1="2" y1="14" x2="22" y2="14" />
      {/* Play triangle in centre */}
      <path d="M10.5 9.5 L14.5 12 L10.5 14.5 Z" fill={color || 'currentColor'} />
      {/* LED dots on the front-right */}
      <circle cx="17.5" cy="10.8" r="0.55" fill={color || 'currentColor'} />
      <circle cx="19.5" cy="10.8" r="0.55" fill={color || 'currentColor'} />
      {/* Bottom-panel HDD slots (three ticks) */}
      <line x1="5"  y1="16.5" x2="8"  y2="16.5" />
      <line x1="10.5" y1="16.5" x2="13.5" y2="16.5" />
      <line x1="16" y1="16.5" x2="19" y2="16.5" />
      {/* Little dome camera on top-left, tethered by a thin line */}
      <path d="M4 5.5 Q4 3 6 3 Q8 3 8 5.5 L4 5.5 Z" />
      <line x1="6" y1="5.5" x2="6" y2="7" />
    </svg>
  );
}

export function PCIcon({ size, color }: IconProps) {
  return (
    <svg {...S(size, color)}>
      <rect x="3" y="5" width="18" height="11" rx="1" />
      <line x1="3" y1="14" x2="21" y2="14" />
      <line x1="9" y1="19" x2="15" y2="19" />
      <line x1="12" y1="16" x2="12" y2="19" />
    </svg>
  );
}

export function POSIcon({ size, color }: IconProps) {
  return (
    <svg {...S(size, color)}>
      {/* till / register */}
      <rect x="3" y="10" width="18" height="10" rx="1" />
      <rect x="6" y="4" width="12" height="6" rx="1" />
      <line x1="7" y1="14" x2="17" y2="14" />
      <line x1="7" y1="17" x2="12" y2="17" />
      <circle cx="16" cy="17" r="1" />
    </svg>
  );
}

export function PrinterIcon({ size, color }: IconProps) {
  return (
    <svg {...S(size, color)}>
      <rect x="6" y="3" width="12" height="6" />
      <rect x="3" y="9" width="18" height="8" rx="1" />
      <rect x="6" y="14" width="12" height="6" />
      <line x1="8" y1="17" x2="15" y2="17" />
      <circle cx="18" cy="12" r="0.6" fill={color || 'currentColor'} />
    </svg>
  );
}

export function LockIcon({ size, color }: IconProps) {
  return (
    <svg {...S(size, color)}>
      <rect x="5" y="10" width="14" height="10" rx="1.5" />
      <path d="M8 10 V7 A4 4 0 0 1 16 7 V10" />
      <circle cx="12" cy="15" r="1.2" />
      <line x1="12" y1="15" x2="12" y2="17.5" />
    </svg>
  );
}

export function CloudIcon({ size, color }: IconProps) {
  return (
    <svg {...S(size, color)}>
      <path d="M6 17 A4 4 0 0 1 6 9 A5 5 0 0 1 16 8 A3.5 3.5 0 0 1 18 17 Z" />
    </svg>
  );
}

export function VMIcon({ size, color }: IconProps) {
  return (
    <svg {...S(size, color)}>
      {/* screen with "VM" hint - a monitor inside a monitor */}
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <rect x="6" y="7" width="12" height="6" rx="0.5" />
      <line x1="9" y1="19" x2="15" y2="19" />
      <line x1="12" y1="16" x2="12" y2="19" />
      {/* corner "V" mark */}
      <path d="M8.5 8.5 L9.7 11.5 L10.9 8.5" strokeWidth="1.2" />
    </svg>
  );
}

export function VPSIcon({ size, color }: IconProps) {
  return (
    <svg {...S(size, color)}>
      {/* cloud with server bars inside */}
      <path d="M5 17 A3.5 3.5 0 0 1 5 10 A4.5 4.5 0 0 1 14 9 A3 3 0 0 1 16 17 Z" />
      <line x1="8" y1="14" x2="14" y2="14" strokeWidth="1.1" />
      <line x1="8" y1="12" x2="14" y2="12" strokeWidth="1.1" />
      <circle cx="9" cy="12" r="0.4" fill={color || 'currentColor'} />
      <circle cx="9" cy="14" r="0.4" fill={color || 'currentColor'} />
    </svg>
  );
}

// v0.35.4: `dvr` is not a DeviceKind (recorders are `kind: 'server'` with a
// `dvr` payload), but ServerNode picks the DVR icon when appropriate. We
// keep it in the same ICONS map for consistent lookups.
export const ICONS: Record<DeviceKind, (p: IconProps) => JSX.Element> & {
  dvr: (p: IconProps) => JSX.Element;
} = {
  router: RouterIcon,
  switch: SwitchIcon,
  patchpanel: PatchPanelIcon,
  ap: APIcon,
  camera: CameraIcon,
  server: ServerIcon,
  vm: VMIcon,
  vps: VPSIcon,
  pc: PCIcon,
  pos: POSIcon,
  printer: PrinterIcon,
  lock: LockIcon,
  cloud: CloudIcon,
  dvr: DvrIcon,
};

// Light-theme device palette (v0.14): fresh pastel-tinted backgrounds + saturated icon colors.
// bg = 8-12% tint of color, works on a white/gray page background.
export const KIND_META: Record<DeviceKind, { label: string; color: string; bg: string }> = {
  router:     { label: 'ROUTER',   color: '#2563EB', bg: '#EFF6FF' },
  switch:     { label: 'SWITCH',   color: '#0D9488', bg: '#F0FDFA' },
  patchpanel: { label: 'PATCH',    color: '#9333EA', bg: '#FAF5FF' },
  ap:         { label: 'AP',       color: '#EA580C', bg: '#FFF7ED' },
  camera:     { label: 'CCTV',     color: '#DC2626', bg: '#FEF2F2' },
  server:     { label: 'SERVER',   color: '#475569', bg: '#F1F5F9' },
  vm:         { label: 'VM',       color: '#7C3AED', bg: '#F5F3FF' },
  vps:        { label: 'VPS',      color: '#0891B2', bg: '#ECFEFF' },
  pc:         { label: 'PC',       color: '#525252', bg: '#F5F5F5' },
  pos:        { label: 'POS',      color: '#DB2777', bg: '#FDF2F8' },
  printer:    { label: 'PRINTER',  color: '#404040', bg: '#F5F5F4' },
  lock:       { label: 'LOCK',     color: '#D97706', bg: '#FFFBEB' },
  cloud:      { label: 'ISP',      color: '#0284C7', bg: '#F0F9FF' },
};
