import type { DeviceKind } from './types';
import type { FilterState } from './store';

/**
 * A preset is a factory that returns a fresh FilterState.
 * Presets don't touch tag/vlan (those are highly individual) — only kinds/cables/poe.
 */
export interface LayerPreset {
  id: string;
  label: string;
  emoji: string;
  hint?: string;
  build: () => FilterState;
}

const empty = (): FilterState => ({
  hiddenKinds: new Set(),
  hiddenCables: new Set(),
  poeOnly: false,
  tag: null,
  vlan: null,
  hiddenLayers: new Set(),
});

/** Hide everything except the given kinds. */
function keepOnly(kinds: DeviceKind[]): FilterState {
  const ALL: DeviceKind[] = [
    'router','switch','patchpanel','ap','camera','server','vm','vps',
    'pc','pos','printer','lock','cloud'
  ];
  const keep = new Set(kinds);
  return { ...empty(), hiddenKinds: new Set(ALL.filter(k => !keep.has(k))) };
}

export const LAYER_PRESETS: LayerPreset[] = [
  {
    id: 'all', label: 'Всё', emoji: '👁',
    hint: 'Сбросить все фильтры и показать всё',
    build: () => empty(),
  },
  {
    id: 'data', label: 'Data', emoji: '🖧',
    hint: 'Только сеть передачи данных: роутеры, свитчи, ПК, серверы, VM, VPS, POS, принтеры',
    build: () => keepOnly(['router','switch','patchpanel','pc','server','vm','vps','pos','printer','cloud']),
  },
  {
    id: 'cctv', label: 'CCTV', emoji: '📹',
    hint: 'Только видеонаблюдение: камеры + магистраль до них',
    build: () => keepOnly(['router','switch','patchpanel','camera']),
  },
  {
    id: 'wifi', label: 'Wi-Fi', emoji: '📶',
    hint: 'Wi-Fi инфраструктура: точки доступа + свитчи PoE',
    build: () => keepOnly(['router','switch','patchpanel','ap']),
  },
  {
    id: 'salto', label: 'SALTO', emoji: '🔐',
    hint: 'СКУД / замки + магистраль',
    build: () => keepOnly(['router','switch','patchpanel','lock']),
  },
  {
    id: 'poe', label: 'PoE only', emoji: '⚡',
    hint: 'Только устройства с активным PoE — быстро увидеть питание',
    build: () => ({ ...empty(), poeOnly: true }),
  },
  {
    id: 'external', label: 'Внешнее', emoji: '☁️',
    hint: 'Только провайдеры и VPS — что «наружу»',
    build: () => keepOnly(['cloud','vps','router']),
  },
  {
    id: 'core-only', label: 'Ядро', emoji: '🏛',
    hint: 'Только уровень CORE — магистраль сети',
    build: () => ({ ...empty(), hiddenLayers: new Set(['distribution','access'] as any) }),
  },
  {
    id: 'core-dist', label: 'Ядро+Дист', emoji: '🌉',
    hint: 'CORE и DISTRIBUTION — без пользовательских устройств',
    build: () => ({ ...empty(), hiddenLayers: new Set(['access'] as any) }),
  },
];
