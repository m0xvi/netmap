import type { Device, DeviceKind, NetworkLayer } from './types';

/**
 * Auto-derive the Cisco 3-tier network layer from a device kind.
 * Users can always override via `device.layer` — this is just the fallback.
 *
 * Heuristics:
 *  - router                  → core
 *  - switch with SFP+/10G    → distribution (aggregation)
 *  - regular switch          → distribution
 *  - server                  → distribution (backbone-adjacent)
 *  - everything else         → access
 *
 * `cloud` (ISP) sits above core — we treat it as core visually.
 */
export function inferLayer(d: Device): NetworkLayer {
  if (d.layer) return d.layer;
  switch (d.kind) {
    case 'cloud':
    case 'router':
      return 'core';
    case 'switch': {
      // If any port is SFP+ or 10G — likely a distribution/core aggregation switch
      const has10G = d.ports.some(p => p.type === 'SFP+' || p.speed === '10G');
      const hasFiber = d.ports.some(p => p.type === 'SFP' || p.type === 'SFP+');
      if (has10G) return 'distribution';
      if (hasFiber) return 'distribution';
      return 'access';   // small unmanaged / edge switches
    }
    case 'server':
    case 'vps':
      return 'distribution';
    case 'patchpanel':
    case 'ap':
    case 'camera':
    case 'printer':
    case 'pc':
    case 'pos':
    case 'lock':
    case 'vm':
      return 'access';
  }
}

export const LAYER_META: Record<NetworkLayer, {
  label: string;
  emoji: string;
  color: string;
  bg: string;
  description: string;
  /** Rank for dagre layout — smaller = higher on canvas (in TB direction) */
  rank: number;
}> = {
  core: {
    label: 'CORE',
    emoji: '🏛',
    color: '#f87171',   // red — most critical
    bg: '#3b1d1d',
    description: 'Ядро — высокоскоростная магистраль',
    rank: 0,
  },
  distribution: {
    label: 'DIST',
    emoji: '🌉',
    color: '#fbbf24',   // yellow — mid tier
    bg: '#3f2b17',
    description: 'Распределение — интерфейс между ядром и пользователями',
    rank: 1,
  },
  access: {
    label: 'ACCESS',
    emoji: '📱',
    color: '#10B981',   // green — user-facing
    bg: '#0d2818',
    description: 'Доступ — пользователи и оконечные устройства',
    rank: 2,
  },
};

/** Count of devices by layer for the mini-legend / filter panel */
export function countByLayer(devices: Device[]): Record<NetworkLayer, number> {
  const c: Record<NetworkLayer, number> = { core: 0, distribution: 0, access: 0 };
  for (const d of devices) c[inferLayer(d)]++;
  return c;
}
