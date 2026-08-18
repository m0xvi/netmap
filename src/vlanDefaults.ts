/**
 * Default VLAN palette + typical VLAN preset that most hotels reuse.
 *
 * Colors chosen to match the light-theme inspector chips in the mockup
 * (Corporate blue / Guest green / IoT amber / Servers purple / CCTV red / Voice teal).
 */

import type { Vlan } from './types';

export const VLAN_COLORS = [
  '#3B82F6', // blue     — corporate
  '#10B981', // green    — guest
  '#F59E0B', // amber    — iot
  '#8B5CF6', // purple   — servers
  '#EF4444', // red      — cctv
  '#14B8A6', // teal     — voice
  '#EC4899', // pink
  '#6366F1', // indigo
  '#64748B', // slate    — mgmt
];

/**
 * Pick a color from the palette by index (round-robin). Deterministic.
 */
export function vlanColorForIndex(i: number): string {
  return VLAN_COLORS[((i % VLAN_COLORS.length) + VLAN_COLORS.length) % VLAN_COLORS.length];
}

/**
 * Standard preset used to bootstrap a fresh project — 4 VLANs matching the mockup.
 * Third octet mirrors the VLAN id (10 → 192.168.10.0/24 etc.) for consistency with
 * the hotel networks; callers can override the second octet for hotels with a
 * different addressing scheme (e.g. 10.11.x.x for Усадьба).
 */
export function defaultVlanPreset(subnetPrefix: string = '192.168'): Vlan[] {
  return [
    { id: 'vlan-corp',    vlanId: 10, name: 'CORPORATE', color: '#3B82F6',
      cidr: `${subnetPrefix}.10.0/24`, gateway: `${subnetPrefix}.10.1`,
      description: 'Основная корпоративная сеть — ПК, серверы, принтеры' },
    { id: 'vlan-guest',   vlanId: 20, name: 'GUEST',     color: '#10B981',
      cidr: `${subnetPrefix}.20.0/24`, gateway: `${subnetPrefix}.20.1`,
      description: 'Гостевой Wi-Fi, изолирован от корпоративной сети' },
    { id: 'vlan-iot',     vlanId: 30, name: 'IOT',       color: '#F59E0B',
      cidr: `${subnetPrefix}.30.0/24`, gateway: `${subnetPrefix}.30.1`,
      description: 'Замки SALTO, датчики, термостаты' },
    { id: 'vlan-srv',     vlanId: 40, name: 'SERVERS',   color: '#8B5CF6',
      cidr: `${subnetPrefix}.40.0/24`, gateway: `${subnetPrefix}.40.1`,
      description: 'Серверный сегмент (Hyper-V, СУБД, шара)' },
    { id: 'vlan-cctv',    vlanId: 50, name: 'CCTV',      color: '#EF4444',
      cidr: `${subnetPrefix}.50.0/24`, gateway: `${subnetPrefix}.50.1`,
      description: 'IP-камеры видеонаблюдения' },
  ];
}
