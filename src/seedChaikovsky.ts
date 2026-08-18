// Отель "Чайковский" — reconstructed from the original diagram
import type { NetMapDoc, Port, Device, Group, Link, Vlan } from './types';

const eth = (n: number, opts: { poe?: boolean; speed?: '100M'|'1G'|'2.5G'|'10G' } = {}): Port[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `eth${i + 1}`, label: '',
    type: 'RJ45', speed: opts.speed ?? '1G',
    poe: opts.poe ?? false,
    status: 'down' as const,
  }));

const single = (id = 'poe', poe = true, speed: '100M'|'1G' = '1G'): Port[] => [{
  id, label: '', type: 'RJ45', speed,
  poe, poeActive: poe, status: 'up' as const,
}];

const g = (id: string, x: number, y: number) => ({ groupId: id, x, y });

const groups: Group[] = [
  { id: 'z-internet', name: 'Интернет · Провайдеры', x: 0, y: -200, width: 420, height: 120, color: '#94A3B8' },
  { id: 'z-core',  name: 'Ядро сети',    x:    0, y:   0, width: 640, height: 460, color: '#60a5fa' },
  { id: 'z-cctv1', name: 'CCTV Корпус 1', x: 700, y:   0, width: 500, height: 320, color: '#f87171' },
  { id: 'z-cctv2', name: 'CCTV Корпус 2', x: 700, y: 360, width: 500, height: 320, color: '#f87171' },
  { id: 'z-u1',    name: 'Корпус 1',      x:    0, y: 500, width: 640, height: 360, color: '#5eead4' },
  { id: 'z-u2',    name: 'Корпус 2',      x:  700, y: 720, width: 640, height: 460, color: '#c084fc' },
];

const devices: Device[] = [
  // Providers
  { id: 'isp-rt', name: 'Rostelecom', kind: 'cloud', ...g('z-internet',  40, 40), ports: [{ id: 'wan', label: 'WAN', status: 'up' }] },
  { id: 'isp-bl', name: 'BeeLine',    kind: 'cloud', ...g('z-internet', 220, 40), ports: [{ id: 'wan', label: 'WAN', status: 'up' }] },

  // Core
  { id: 'gw', name: 'GW (Router)', kind: 'router',
    vendor: 'MikroTik', model: 'RB3011 UiAS-RM',
    ip: '10.16.0.1/24', mgmtUrl: 'https://10.16.0.1',
    display: 'compact', ...g('z-core', 20, 40),
    ports: [
      { id: 'eth1', label: 'WAN Rostelecom', type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth2', label: 'WAN BeeLine',    type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth3', label: 'to SW_CORE',     type: 'RJ45', speed: '1G', status: 'up' },
      ...eth(7),
    ],
    tags: ['core'],
    credential: { username: 'admin' },
  },
  { id: 'sw-core', name: 'SW_CORE', kind: 'switch',
    vendor: 'TP-Link', model: 'Managed Switch',
    display: 'compact', ...g('z-core', 20, 180),
    ports: [
      { id: 'eth1', label: 'to GW eth3',      type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'sfp1', label: 'to D-Link TCH_U1', type: 'SFP+', speed: '10G', status: 'up' },
      { id: 'sfp2', label: 'to D-Link TCH_U2', type: 'SFP+', speed: '10G', status: 'up' },
      { id: 'eth2', label: 'POS_101',         type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth3', label: 'Printer_RCP',     type: 'RJ45', speed: '100M', status: 'up' },
      { id: 'eth4', label: 'PC_RCP',          type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth5', label: 'Printer_kitchen', type: 'RJ45', speed: '100M', status: 'up' },
      { id: 'eth6', label: 'mAP2nD',          type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth7', label: 'SRV-UTM-U',       type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth8', label: 'Agat UX-3710',    type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth9', label: 'AP_1FL_U1',       type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth10',label: 'AP_2FL_U1',       type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth11',label: 'AP_3FL_U1',       type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth12',label: 'AP_4FL_U1',       type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth13',label: 'to POE_1 (CCTV)', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth14',label: 'to POE_2 (CCTV)', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth15',label: 'Reg_CCTV_U1',     type: 'RJ45', speed: '1G', status: 'up' },
      ...eth(9),
    ],
  },
  { id: 'srv-utm', name: 'SRV-UTM-U', kind: 'server',
    model: 'PayTor IB-502', display: 'compact', ...g('z-core', 320, 40),
    ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },
  { id: 'pos-101', name: 'POS_101', kind: 'pos', display: 'compact', ...g('z-core', 320, 130),
    ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },
  { id: 'pc-rcp', name: 'PC_RCP', kind: 'pc', display: 'compact', ...g('z-core', 320, 210),
    ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },
  { id: 'printer-rcp', name: 'Printer_RCP', kind: 'printer', display: 'compact', ...g('z-core', 320, 290),
    ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '100M', status: 'up' }] },
  { id: 'printer-kit', name: 'Printer_kitchen', kind: 'printer', display: 'compact', ...g('z-core', 320, 370),
    ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '100M', status: 'up' }] },
  { id: 'agat-core', name: 'Agat UX-3710', kind: 'switch', display: 'compact', ...g('z-core', 460, 40),
    ports: [{ id: 'eth1', label: 'to SW_CORE eth8', type: 'RJ45', speed: '1G', status: 'up', uplink: true }, ...eth(7)] },
  { id: 'map2nd', name: 'mAP2nD', kind: 'ap',
    vendor: 'MikroTik', display: 'compact', ...g('z-core', 460, 140), ports: single() },

  // CCTV Корпус 1
  { id: 'poe-1', name: 'POE_1 (16-port)', kind: 'switch', vendor: 'PoE Switch',
    display: 'compact', ...g('z-cctv1', 20, 40),
    ports: [
      { id: 'eth1', label: 'to SW_CORE eth13', type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      ...Array.from({ length: 15 }, (_, i) => ({
        id: `eth${i+2}`, label: `CCTV_U1_${i+1}`, type: 'RJ45' as const, speed: '100M' as const, poe: true, poeActive: true, status: 'up' as const,
      })),
    ]},
  { id: 'reg-cctv-u1', name: 'Reg_CCTV_U1', kind: 'server',
    display: 'compact', ...g('z-cctv1', 340, 40),
    ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },
  // 16 cameras (grid 4x4)
  ...Array.from({ length: 16 }, (_, i): Device => ({
    id: `cctv-u1-${i+1}`, name: `CCTV_U1_${i+1}`, kind: 'camera',
    display: 'compact', ...g('z-cctv1', 20 + (i % 4) * 90, 140 + Math.floor(i / 4) * 45),
    ports: single('poe', true, '100M'),
  })),

  // CCTV Корпус 2
  { id: 'poe-2', name: 'POE_2 (16-port)', kind: 'switch', vendor: 'PoE Switch',
    display: 'compact', ...g('z-cctv2', 20, 40),
    ports: [
      { id: 'eth1', label: 'to SW_CORE eth14', type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      ...Array.from({ length: 15 }, (_, i) => ({
        id: `eth${i+2}`, label: `CCTV_U2_${i+1}`, type: 'RJ45' as const, speed: '100M' as const, poe: true, poeActive: true, status: 'up' as const,
      })),
    ]},
  { id: 'reg-cctv-u2', name: 'Reg_CCTV_U2', kind: 'server',
    display: 'compact', ...g('z-cctv2', 340, 40),
    ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },
  ...Array.from({ length: 16 }, (_, i): Device => ({
    id: `cctv-u2-${i+1}`, name: `CCTV_U2_${i+1}`, kind: 'camera',
    display: 'compact', ...g('z-cctv2', 20 + (i % 4) * 90, 140 + Math.floor(i / 4) * 45),
    ports: single('poe', true, '100M'),
  })),

  // Корпус 1: D-Link TCH_U1 + APs
  { id: 'dlink-u1', name: 'D-Link TCH_U1', kind: 'switch',
    vendor: 'D-Link', model: 'DGS 48-port',
    display: 'compact', ...g('z-u1', 20, 40),
    ports: [
      { id: 'sfp1', label: 'to SW_CORE sfp1', type: 'SFP+', speed: '10G', status: 'up', uplink: true },
      { id: 'eth1', label: 'AP_1FL_U1',       type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth2', label: 'AP_2FL_U1',       type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth3', label: 'AP_3FL_U1',       type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth4', label: 'AP_4FL_U1',       type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      ...eth(43, { poe: true }),
    ],
  },
  { id: 'ap-1fl-u1', name: 'AP_1FL_U1', kind: 'ap', display: 'compact', ...g('z-u1', 320, 40),  ports: single() },
  { id: 'ap-2fl-u1', name: 'AP_2FL_U1', kind: 'ap', display: 'compact', ...g('z-u1', 420, 40),  ports: single() },
  { id: 'ap-3fl-u1', name: 'AP_3FL_U1', kind: 'ap', display: 'compact', ...g('z-u1', 520, 40),  ports: single() },
  { id: 'ap-4fl-u1', name: 'AP_4FL_U1', kind: 'ap', display: 'compact', ...g('z-u1', 320, 130), ports: single() },

  // Корпус 2: D-Link TCH_U2 + Agat + APs + Reg + SRV_TCH + SALTO
  { id: 'dlink-u2', name: 'D-Link TCH_U2', kind: 'switch',
    vendor: 'D-Link', model: 'DGS 48-port',
    display: 'compact', ...g('z-u2', 20, 40),
    ports: [
      { id: 'sfp1', label: 'to SW_CORE sfp2', type: 'SFP+', speed: '10G', status: 'up', uplink: true },
      { id: 'eth1', label: 'AP_0FL_U2',    type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth2', label: 'AP_1FL_U2',    type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth3', label: 'AP_2FL_U2',    type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth4', label: 'AP_room_50',   type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth5', label: 'AP_room_54',   type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth6', label: 'to Agat UX-3710', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth7', label: 'SALTO',        type: 'RJ45', speed: '100M', status: 'up' },
      { id: 'eth8', label: 'SRV_TCH IPMI', type: 'RJ45', speed: '100M', status: 'up' },
      { id: 'eth9', label: 'SRV_TCH LAN',  type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth10',label: 'Reg_CCTV_U2',  type: 'RJ45', speed: '1G', status: 'up' },
      ...eth(37, { poe: true }),
    ],
  },
  { id: 'agat-u2-tch', name: 'Agat UX-3710 (U2)', kind: 'switch', display: 'compact', ...g('z-u2', 320, 40),
    ports: [{ id: 'eth1', label: 'to D-Link TCH_U2 eth6', type: 'RJ45', speed: '1G', status: 'up', uplink: true }, ...eth(7)] },
  { id: 'ap-0fl-u2', name: 'AP_0FL_U2', kind: 'ap', display: 'compact', ...g('z-u2', 320, 130), ports: single() },
  { id: 'ap-1fl-u2', name: 'AP_1FL_U2', kind: 'ap', display: 'compact', ...g('z-u2', 420, 130), ports: single() },
  { id: 'ap-2fl-u2', name: 'AP_2FL_U2', kind: 'ap', display: 'compact', ...g('z-u2', 520, 130), ports: single() },
  { id: 'ap-room-50',name: 'AP_room_50',kind: 'ap', display: 'compact', ...g('z-u2', 320, 220), ports: single() },
  { id: 'ap-room-54',name: 'AP_room_54',kind: 'ap', display: 'compact', ...g('z-u2', 420, 220), ports: single() },
  { id: 'salto-u2t', name: 'SALTO', kind: 'lock', display: 'compact', ...g('z-u2', 520, 220),
    ports: [{ id: 'ctrl', label: '', type: 'RJ45', speed: '100M', status: 'up' }] },
  { id: 'srv-tch', name: 'SRV_TCH', kind: 'server', display: 'compact', ...g('z-u2', 320, 300),
    ports: [
      { id: 'lan',  label: 'to D-Link TCH_U2 eth9', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'ipmi', label: 'IPMI', type: 'RJ45', speed: '100M', status: 'up' },
    ]},
  { id: 'reg-cctv-u2b', name: 'Reg_CCTV_U2', kind: 'server', display: 'compact', ...g('z-u2', 500, 300),
    ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },
];

const links: Link[] = [
  { id: 'l-rt', fromDeviceId: 'isp-rt', fromPortId: 'wan', toDeviceId: 'gw', toPortId: 'eth1', cable: 'fiber', color: '#e5484d', label: 'Rostelecom' },
  { id: 'l-bl', fromDeviceId: 'isp-bl', fromPortId: 'wan', toDeviceId: 'gw', toPortId: 'eth2', cable: 'fiber', color: '#e5484d', label: 'BeeLine' },
  { id: 'l-gw-core', fromDeviceId: 'gw', fromPortId: 'eth3', toDeviceId: 'sw-core', toPortId: 'eth1', cable: 'copper' },

  // SW_CORE to core-room devices
  { id: 'l-core-pos', fromDeviceId: 'sw-core', fromPortId: 'eth2', toDeviceId: 'pos-101',   toPortId: 'lan', cable: 'copper' },
  { id: 'l-core-prn', fromDeviceId: 'sw-core', fromPortId: 'eth3', toDeviceId: 'printer-rcp', toPortId: 'lan', cable: 'copper' },
  { id: 'l-core-pc',  fromDeviceId: 'sw-core', fromPortId: 'eth4', toDeviceId: 'pc-rcp',    toPortId: 'lan', cable: 'copper' },
  { id: 'l-core-kit', fromDeviceId: 'sw-core', fromPortId: 'eth5', toDeviceId: 'printer-kit', toPortId: 'lan', cable: 'copper' },
  { id: 'l-core-map', fromDeviceId: 'sw-core', fromPortId: 'eth6', toDeviceId: 'map2nd',    toPortId: 'poe', cable: 'copper' },
  { id: 'l-core-utm', fromDeviceId: 'sw-core', fromPortId: 'eth7', toDeviceId: 'srv-utm',   toPortId: 'lan', cable: 'copper' },
  { id: 'l-core-agat',fromDeviceId: 'sw-core', fromPortId: 'eth8', toDeviceId: 'agat-core', toPortId: 'eth1', cable: 'copper' },

  // Fiber backbone to U1/U2 (INTER-group)
  { id: 'l-core-u1', fromDeviceId: 'sw-core', fromPortId: 'sfp1', toDeviceId: 'dlink-u1', toPortId: 'sfp1', cable: 'fiber' },
  { id: 'l-core-u2', fromDeviceId: 'sw-core', fromPortId: 'sfp2', toDeviceId: 'dlink-u2', toPortId: 'sfp1', cable: 'fiber' },

  // PoE for CCTV (INTER-group)
  { id: 'l-core-poe1', fromDeviceId: 'sw-core', fromPortId: 'eth13', toDeviceId: 'poe-1', toPortId: 'eth1', cable: 'copper' },
  { id: 'l-core-poe2', fromDeviceId: 'sw-core', fromPortId: 'eth14', toDeviceId: 'poe-2', toPortId: 'eth1', cable: 'copper' },
  { id: 'l-core-regu1',fromDeviceId: 'sw-core', fromPortId: 'eth15', toDeviceId: 'reg-cctv-u1', toPortId: 'lan', cable: 'copper' },

  // APs U1 direct from SW_CORE
  { id: 'l-core-ap1u1', fromDeviceId: 'sw-core', fromPortId: 'eth9',  toDeviceId: 'ap-1fl-u1', toPortId: 'poe', cable: 'copper' },
  { id: 'l-core-ap2u1', fromDeviceId: 'sw-core', fromPortId: 'eth10', toDeviceId: 'ap-2fl-u1', toPortId: 'poe', cable: 'copper' },
  { id: 'l-core-ap3u1', fromDeviceId: 'sw-core', fromPortId: 'eth11', toDeviceId: 'ap-3fl-u1', toPortId: 'poe', cable: 'copper' },
  { id: 'l-core-ap4u1', fromDeviceId: 'sw-core', fromPortId: 'eth12', toDeviceId: 'ap-4fl-u1', toPortId: 'poe', cable: 'copper' },

  // Cameras U1
  ...Array.from({ length: 15 }, (_, i): Link => ({
    id: `l-poe1-${i+1}`, fromDeviceId: 'poe-1', fromPortId: `eth${i+2}`,
    toDeviceId: `cctv-u1-${i+1}`, toPortId: 'poe', cable: 'copper',
  })),
  // Cameras U2
  ...Array.from({ length: 15 }, (_, i): Link => ({
    id: `l-poe2-${i+1}`, fromDeviceId: 'poe-2', fromPortId: `eth${i+2}`,
    toDeviceId: `cctv-u2-${i+1}`, toPortId: 'poe', cable: 'copper',
  })),

  // D-Link U2 to devices
  { id: 'l-u2-ap0', fromDeviceId: 'dlink-u2', fromPortId: 'eth1', toDeviceId: 'ap-0fl-u2', toPortId: 'poe', cable: 'copper' },
  { id: 'l-u2-ap1', fromDeviceId: 'dlink-u2', fromPortId: 'eth2', toDeviceId: 'ap-1fl-u2', toPortId: 'poe', cable: 'copper' },
  { id: 'l-u2-ap2', fromDeviceId: 'dlink-u2', fromPortId: 'eth3', toDeviceId: 'ap-2fl-u2', toPortId: 'poe', cable: 'copper' },
  { id: 'l-u2-ap50',fromDeviceId: 'dlink-u2', fromPortId: 'eth4', toDeviceId: 'ap-room-50', toPortId: 'poe', cable: 'copper' },
  { id: 'l-u2-ap54',fromDeviceId: 'dlink-u2', fromPortId: 'eth5', toDeviceId: 'ap-room-54', toPortId: 'poe', cable: 'copper' },
  { id: 'l-u2-agat',fromDeviceId: 'dlink-u2', fromPortId: 'eth6', toDeviceId: 'agat-u2-tch', toPortId: 'eth1', cable: 'copper' },
  { id: 'l-u2-slt', fromDeviceId: 'dlink-u2', fromPortId: 'eth7', toDeviceId: 'salto-u2t',  toPortId: 'ctrl', cable: 'copper' },
  { id: 'l-u2-srvi',fromDeviceId: 'dlink-u2', fromPortId: 'eth8', toDeviceId: 'srv-tch',    toPortId: 'ipmi', cable: 'copper' },
  { id: 'l-u2-srvl',fromDeviceId: 'dlink-u2', fromPortId: 'eth9', toDeviceId: 'srv-tch',    toPortId: 'lan',  cable: 'copper' },
  { id: 'l-u2-reg', fromDeviceId: 'dlink-u2', fromPortId: 'eth10', toDeviceId: 'reg-cctv-u2b', toPortId: 'lan', cable: 'copper' },
];

// Чайковский — 10.16.x.x, D-Link SW + IB-502 PayTor
const chaikovskyVlans: Vlan[] = [
  { id: 'vlan-t-mgmt', vlanId:  1, name: 'MGMT',      color: '#64748B',
    cidr: '10.16.0.0/24',  gateway: '10.16.0.1',
    description: 'Management-сегмент' },
  { id: 'vlan-t-corp', vlanId: 10, name: 'CORPORATE', color: '#3B82F6',
    cidr: '10.16.10.0/24', gateway: '10.16.10.1',
    description: 'Ресепшн, ПК персонала' },
  { id: 'vlan-t-guest',vlanId: 20, name: 'GUEST',     color: '#10B981',
    cidr: '10.16.20.0/24', gateway: '10.16.20.1',
    description: 'Гостевой Wi-Fi (все mAP2nD)' },
  { id: 'vlan-t-pay',  vlanId: 25, name: 'PAY-POS',   color: '#8B5CF6',
    cidr: '10.16.25.0/24', gateway: '10.16.25.1',
    description: 'Терминал PayTor IB-502' },
  { id: 'vlan-t-cctv', vlanId: 50, name: 'CCTV',      color: '#EF4444',
    cidr: '10.16.50.0/24', gateway: '10.16.50.1',
    description: 'IP-камеры (30 шт через POE-свитчи)' },
];

export const chaikovskySeed: NetMapDoc = {
  version: 3,
  name: 'Отель «Чайковский»',
  groups, devices, links,
  vlans: chaikovskyVlans,
  stickies: [],
};
