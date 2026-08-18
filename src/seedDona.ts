// Отель "Дона" — reconstructed from the original diagram
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
  { id: 'z-internet', name: 'Интернет · Провайдеры', x: 0, y: -200, width: 620, height: 120, color: '#94A3B8' },
  { id: 'z-serv',  name: 'Серверная',    x:    0, y:   0, width: 640, height: 340, color: '#60a5fa' },
  { id: 'z-buh',   name: 'Бухгалтерия',  x:  700, y:   0, width: 600, height: 260, color: '#c084fc' },
  { id: 'z-lobby', name: 'Лобби / 1-4 этажи', x: 0, y: 380, width: 640, height: 340, color: '#5eead4' },
  { id: 'z-conf',  name: 'Конференц-зал', x: 700, y: 300, width: 400, height: 220, color: '#a78bfa' },
  { id: 'z-dv',    name: 'Ресторан «Dolce»', x: 0, y: 760, width: 900, height: 460, color: '#f59e0b' },
];

const devices: Device[] = [
  // Providers
  { id: 'isp-rt', name: 'Rostelecom', kind: 'cloud', ...g('z-internet',  40, 40), ports: [{ id: 'wan', label: 'WAN', status: 'up' }] },
  { id: 'isp-bl', name: 'BeeLine',    kind: 'cloud', ...g('z-internet', 220, 40), ports: [{ id: 'wan', label: 'WAN', status: 'up' }] },
  { id: 'isp-et', name: 'E-type',     kind: 'cloud', ...g('z-internet', 400, 40), ports: [{ id: 'wan', label: 'WAN', status: 'up' }] },

  // ---- Server room: GW, SW_CORE, HyperV, Synology, Agat ----
  {
    id: 'gw', name: 'GW', kind: 'router',
    vendor: 'MikroTik', model: 'RB3011 UiAS-RM',
    ip: '192.168.10.1/24', mgmtUrl: 'https://192.168.10.1',
    display: 'compact', ...g('z-serv', 20, 40),
    ports: [
      { id: 'eth1', label: 'WAN Rostelecom',    type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth2', label: 'WAN BeeLine',       type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth3', label: 'WAN E-type',        type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth4', label: 'to SW_CORE',        type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth5', label: 'to HyperV_IPMI',    type: 'RJ45', speed: '100M', status: 'up' },
      { id: 'eth6', label: 'to HyperV Physical',type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth7', label: 'NAS Synology',      type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth8', label: 'to SW_BUH',         type: 'RJ45', speed: '1G', status: 'up' },
      ...eth(2),
    ],
    tags: ['core'],
    credential: { username: 'admin' },
  },
  {
    id: 'sw-core', name: 'SW_CORE', kind: 'switch',
    vendor: 'MikroTik', model: 'Cloud Router Switch',
    ip: '192.168.10.85',
    display: 'compact', ...g('z-serv', 20, 180),
    ports: [
      { id: 'eth1', label: 'to GW eth4',     type: 'RJ45', speed: '1G',  status: 'up', uplink: true },
      { id: 'sfp1', label: 'to SW_DV',       type: 'SFP+', speed: '10G', status: 'up' },
      { id: 'eth2', label: 'to SW_GUEST',    type: 'RJ45', speed: '1G',  status: 'up' },
      { id: 'eth3', label: 'to SW-4FL_tp-link', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth4', label: 'AP_lobby',       type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth5', label: 'HyperV2',        type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth6', label: 'HyperV_Virtual', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth7', label: 'ADMIN-PC',       type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth8', label: 'AP_3FL',         type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth9', label: 'AP_4FL_UniFi',   type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth10',label: 'Nataly_Vyach',   type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth11',label: 'CCTV_Cafe01',    type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth12',label: 'CCTV_Vhod',      type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth13',label: 'CCTV_RCP_R',     type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth14',label: 'CCTV_BACKDOOR',  type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth15',label: 'CCTV_?',         type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth16',label: 'to Agat UX-3710',type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth17',label: 'SALTO (1-16)',   type: 'RJ45', speed: '100M', status: 'up' },
      ...eth(7),
    ],
  },
  {
    id: 'srv-hyperv', name: 'HyperV2', kind: 'server',
    vendor: 'Custom', model: 'Hyper-V Host',
    ip: '192.168.10.5',
    display: 'compact', ...g('z-serv', 340, 40),
    ports: [
      { id: 'phys', label: 'to SW_CORE eth5', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'virt', label: 'to SW_CORE eth6', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'ipmi', label: 'to GW eth5',       type: 'RJ45', speed: '100M', status: 'up' },
    ],
  },
  {
    id: 'nas', name: 'Synology DS420j', kind: 'server',
    vendor: 'Synology', model: 'DS420j', ip: '192.168.10.7',
    display: 'compact', ...g('z-serv', 500, 40),
    ports: [{ id: 'lan', label: 'to GW eth7', type: 'RJ45', speed: '1G', status: 'up' }],
  },
  { id: 'agat',     name: 'Agat UX-3710', kind: 'switch', display: 'compact', ...g('z-serv', 340, 180),
    ports: [
      { id: 'eth1', label: 'to SW_CORE eth16', type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      ...eth(7),
    ] },
  { id: 'salto-16', name: 'SALTO (1-16)', kind: 'lock',   display: 'compact', ...g('z-serv', 500, 180),
    ports: [{ id: 'ctrl', label: '', type: 'RJ45', speed: '100M', status: 'up' }] },
  { id: 'admin-pc',  name: 'ADMIN-PC',  kind: 'pc', display: 'compact', ...g('z-serv', 340, 260),
    ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },
  { id: 'nataly-pc', name: 'Nataly_Vyach', kind: 'pc', display: 'compact', ...g('z-serv', 500, 260),
    ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },

  // ---- Бухгалтерия ----
  {
    id: 'sw-buh', name: 'SW_BUH', kind: 'switch',
    vendor: 'MikroTik', model: 'Cloud Router Switch',
    ip: '192.168.10.245',
    display: 'compact', ...g('z-buh', 20, 40),
    ports: [
      { id: 'eth1', label: 'to GW eth8', type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth2', label: 'PC_BUH_01', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth3', label: 'PC_BUH_02', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth4', label: 'PC_BUH_03', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth5', label: 'PC_BUH_04', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth6', label: 'PC_BUH_05', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth7', label: 'PC_BUH_06', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth8', label: 'PC_BUH_07', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth9', label: 'BUH_Printer', type: 'RJ45', speed: '100M', status: 'up' },
      ...eth(15),
    ],
  },
  ...['01','02','03','04','05','06','07'].map((n, i): Device => ({
    id: `pc-buh-${n}`, name: `PC_BUH_${n}`, kind: 'pc',
    ip: `192.168.10.${n === '01' ? '61' : n === '02' ? '57' : n === '03' ? '44' : n === '04' ? '68' : n === '05' ? '33' : n === '06' ? '28' : '23'}`,
    display: 'compact', ...g('z-buh', 260 + (i % 4) * 80, 40 + Math.floor(i / 4) * 90),
    ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }],
  })),
  { id: 'buh-printer', name: 'BUH_Printer', kind: 'printer', display: 'compact', ...g('z-buh', 260, 200),
    ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '100M', status: 'up' }] },

  // ---- Лобби / 1-4 этажи ----
  { id: 'rpc-kassa-sw', name: 'RPC_KASSA', kind: 'switch',
    vendor: 'D-Link', model: 'DGS-1210-16', ip: '192.168.10.251',
    display: 'compact', ...g('z-lobby', 20, 40),
    ports: [
      { id: 'eth1', label: 'POS-PC (PayTor IB-502)', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth2', label: 'AP_4FL',      type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth3', label: 'CCTV_Cafe02', type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth4', label: 'CCTV_RCP_L',  type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth5', label: 'AP_2FL_Server', type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      ...eth(11),
    ],
  },
  { id: 'pos-pc',   name: 'PayTor IB-502 (POS-PC)', kind: 'pos', display: 'compact', ...g('z-lobby', 340, 40),
    ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },
  { id: 'ap-lobby',      name: 'AP_lobby',      kind: 'ap', display: 'compact', ...g('z-lobby', 20, 180),  ports: single() },
  { id: 'ap-3fl',        name: 'AP_3FL',        kind: 'ap', display: 'compact', ...g('z-lobby', 120, 180), ports: single() },
  { id: 'ap-4fl-unifi',  name: 'AP_4FL_UniFi',  kind: 'ap', display: 'compact', ...g('z-lobby', 220, 180), ports: single() },
  { id: 'ap-4fl',        name: 'AP_4FL',        kind: 'ap', display: 'compact', ...g('z-lobby', 320, 180), ports: single() },
  { id: 'ap-2fl-srv',    name: 'AP_2FL_Server', kind: 'ap', display: 'compact', ...g('z-lobby', 420, 180), ports: single() },
  { id: 'cctv-cafe01',   name: 'CCTV_Cafe01',   kind: 'camera', display: 'compact', ...g('z-lobby',  20, 260), ports: single('poe', true, '100M') },
  { id: 'cctv-cafe02',   name: 'CCTV_Cafe02',   kind: 'camera', display: 'compact', ...g('z-lobby', 100, 260), ports: single('poe', true, '100M') },
  { id: 'cctv-vhod-do',  name: 'CCTV_Vhod',     kind: 'camera', display: 'compact', ...g('z-lobby', 180, 260), ports: single('poe', true, '100M') },
  { id: 'cctv-rcp-l',    name: 'CCTV_RCP_L',    kind: 'camera', display: 'compact', ...g('z-lobby', 260, 260), ports: single('poe', true, '100M') },
  { id: 'cctv-rcp-r',    name: 'CCTV_RCP_R',    kind: 'camera', display: 'compact', ...g('z-lobby', 340, 260), ports: single('poe', true, '100M') },
  { id: 'cctv-backdoor', name: 'CCTV_BACKDOOR', kind: 'camera', display: 'compact', ...g('z-lobby', 420, 260), ports: single('poe', true, '100M') },
  { id: 'sw-4fl-tp',     name: 'SW-4FL_tp-link', kind: 'switch', vendor: 'TP-Link',
    display: 'compact', ...g('z-lobby', 500, 40),
    ports: [
      { id: 'eth1', label: 'to SW_CORE eth3', type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      ...eth(15),
    ],
  },

  // ---- Конференц-зал ----
  { id: 'sw-guest', name: 'SW_GUEST', kind: 'switch',
    vendor: 'D-link', model: 'DES-1100-16', ip: '192.168.10.253',
    display: 'compact', ...g('z-conf', 20, 40),
    ports: [
      { id: 'eth1', label: 'to SW_CORE eth2', type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth2', label: 'AP_3FL_ConfZal',  type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth3', label: 'AP_2FL_Hall',     type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      ...eth(13),
    ],
  },
  { id: 'ap-conf-zal', name: 'AP_3FL_ConfZal', kind: 'ap', display: 'compact', ...g('z-conf', 300, 40),  ports: single() },
  { id: 'ap-2fl-hall', name: 'AP_2FL_Hall',    kind: 'ap', display: 'compact', ...g('z-conf', 300, 130), ports: single() },

  // ---- Ресторан Dolce ----
  { id: 'sw-dv', name: 'SW_DV', kind: 'switch',
    vendor: 'MikroTik', model: 'Cloud Router Switch', ip: '192.168.10.21',
    display: 'compact', ...g('z-dv', 20, 40),
    ports: [
      { id: 'sfp1', label: 'to SW_CORE sfp1', type: 'SFP+', speed: '10G', status: 'up', uplink: true },
      { id: 'eth1', label: 'POS_RK',       type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth2', label: 'POS_KASSA',    type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth3', label: 'Printer (grill)', type: 'RJ45', speed: '100M', status: 'up' },
      { id: 'eth4', label: 'Printer',       type: 'RJ45', speed: '100M', status: 'up' },
      { id: 'eth5', label: 'AP_DV',        type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth6', label: 'to POE_SW_1',  type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth7', label: 'to POE_SW_2',  type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth8', label: 'Kolonna',      type: 'RJ45', speed: '1G', status: 'up' },
    ],
  },
  { id: 'poe-sw-1', name: 'POE_SW_1', kind: 'switch',
    vendor: 'D-Link', model: '8×10/100Mbps PoE',
    display: 'compact', ...g('z-dv', 20, 180),
    ports: [
      { id: 'eth1', label: 'to SW_DV eth6',      type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth2', label: 'CCTV_dolce_kitchen', type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth3', label: 'CCTV_dolce_cold_10', type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth4', label: 'CCTV_dolce_cam_06',  type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth5', label: 'dolce_cam_02',       type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth6', label: 'CCTV_d-kitchen_hot_11', type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth7', label: 'CCTV_dolce_sigar_09', type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      ...eth(1, { poe: true }),
    ],
  },
  { id: 'poe-sw-2', name: 'POE_SW_2', kind: 'switch',
    vendor: 'D-Link', model: '8×10/100Mbps PoE',
    display: 'compact', ...g('z-dv', 20, 320),
    ports: [
      { id: 'eth1', label: 'to SW_DV eth7',    type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth2', label: 'CCTV_dolce_cam_04', type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth3', label: 'CCTV_dolce_cam_05', type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth4', label: 'CCTV_dolce_cam_07', type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth5', label: 'CCTV_dolce_bar',    type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth6', label: 'CCTV_vhod_dv',      type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      ...eth(2, { poe: true }),
    ],
  },
  { id: 'pos-rk',    name: 'POS_RK',    kind: 'pos',     display: 'compact', ...g('z-dv', 340, 40),  ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },
  { id: 'pos-kassa-dv', name: 'POS_KASSA', kind: 'pos',  display: 'compact', ...g('z-dv', 460, 40),  ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },
  { id: 'ap-dv',     name: 'AP_DV',     kind: 'ap',      display: 'compact', ...g('z-dv', 580, 40),  ports: single() },
  { id: 'printer-dv1', name: 'Printer (grill)', kind: 'printer', display: 'compact', ...g('z-dv', 340, 140), ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '100M', status: 'up' }] },
  { id: 'printer-dv2', name: 'Printer',       kind: 'printer', display: 'compact', ...g('z-dv', 460, 140), ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '100M', status: 'up' }] },
  // Dolce cameras — 12 штук
  ...['dolce_kitchen','dolce_cold_10','dolce_cam_06','dolce_cam_02','d-kitchen_hot_11','dolce_sigar_09',
      'dolce_cam_04','dolce_cam_05','dolce_cam_07','dolce_bar','vhod_dv'].map((n, i): Device => ({
    id: `cctv-${n}`, name: `CCTV_${n}`, kind: 'camera',
    display: 'compact', ...g('z-dv', 340 + (i % 4) * 130, 250 + Math.floor(i / 4) * 90),
    ports: single('poe', true, '100M'),
  })),
];

const links: Link[] = [
  // WAN
  { id: 'l-rt', fromDeviceId: 'isp-rt', fromPortId: 'wan', toDeviceId: 'gw', toPortId: 'eth1', cable: 'fiber', color: '#e5484d', label: 'Rostelecom' },
  { id: 'l-bl', fromDeviceId: 'isp-bl', fromPortId: 'wan', toDeviceId: 'gw', toPortId: 'eth2', cable: 'fiber', color: '#e5484d', label: 'BeeLine' },
  { id: 'l-et', fromDeviceId: 'isp-et', fromPortId: 'wan', toDeviceId: 'gw', toPortId: 'eth3', cable: 'fiber', color: '#e5484d', label: 'E-type' },

  // Server room
  { id: 'l-gw-core', fromDeviceId: 'gw', fromPortId: 'eth4', toDeviceId: 'sw-core',    toPortId: 'eth1', cable: 'copper' },
  { id: 'l-gw-ipmi', fromDeviceId: 'gw', fromPortId: 'eth5', toDeviceId: 'srv-hyperv', toPortId: 'ipmi', cable: 'copper' },
  { id: 'l-gw-nas',  fromDeviceId: 'gw', fromPortId: 'eth7', toDeviceId: 'nas',        toPortId: 'lan',  cable: 'copper' },
  { id: 'l-core-phys', fromDeviceId: 'sw-core', fromPortId: 'eth5', toDeviceId: 'srv-hyperv', toPortId: 'phys', cable: 'copper' },
  { id: 'l-core-virt', fromDeviceId: 'sw-core', fromPortId: 'eth6', toDeviceId: 'srv-hyperv', toPortId: 'virt', cable: 'copper' },
  { id: 'l-core-admin',fromDeviceId: 'sw-core', fromPortId: 'eth7', toDeviceId: 'admin-pc',   toPortId: 'lan', cable: 'copper' },
  { id: 'l-core-natal',fromDeviceId: 'sw-core', fromPortId: 'eth10', toDeviceId: 'nataly-pc', toPortId: 'lan', cable: 'copper' },
  { id: 'l-core-agat', fromDeviceId: 'sw-core', fromPortId: 'eth16', toDeviceId: 'agat',      toPortId: 'eth1', cable: 'copper' },
  { id: 'l-core-salto',fromDeviceId: 'sw-core', fromPortId: 'eth17', toDeviceId: 'salto-16',  toPortId: 'ctrl', cable: 'copper' },

  // BUH
  { id: 'l-gw-buh',   fromDeviceId: 'gw',      fromPortId: 'eth8', toDeviceId: 'sw-buh', toPortId: 'eth1', cable: 'copper' },
  { id: 'l-buh-p1',   fromDeviceId: 'sw-buh', fromPortId: 'eth2', toDeviceId: 'pc-buh-01', toPortId: 'lan', cable: 'copper' },
  { id: 'l-buh-p2',   fromDeviceId: 'sw-buh', fromPortId: 'eth3', toDeviceId: 'pc-buh-02', toPortId: 'lan', cable: 'copper' },
  { id: 'l-buh-p3',   fromDeviceId: 'sw-buh', fromPortId: 'eth4', toDeviceId: 'pc-buh-03', toPortId: 'lan', cable: 'copper' },
  { id: 'l-buh-p4',   fromDeviceId: 'sw-buh', fromPortId: 'eth5', toDeviceId: 'pc-buh-04', toPortId: 'lan', cable: 'copper' },
  { id: 'l-buh-p5',   fromDeviceId: 'sw-buh', fromPortId: 'eth6', toDeviceId: 'pc-buh-05', toPortId: 'lan', cable: 'copper' },
  { id: 'l-buh-p6',   fromDeviceId: 'sw-buh', fromPortId: 'eth7', toDeviceId: 'pc-buh-06', toPortId: 'lan', cable: 'copper' },
  { id: 'l-buh-p7',   fromDeviceId: 'sw-buh', fromPortId: 'eth8', toDeviceId: 'pc-buh-07', toPortId: 'lan', cable: 'copper' },
  { id: 'l-buh-prn',  fromDeviceId: 'sw-buh', fromPortId: 'eth9', toDeviceId: 'buh-printer', toPortId: 'lan', cable: 'copper' },

  // Lobby - from RPC_KASSA + SW_CORE
  { id: 'l-rpc-pos',   fromDeviceId: 'rpc-kassa-sw', fromPortId: 'eth1', toDeviceId: 'pos-pc',       toPortId: 'lan', cable: 'copper' },
  { id: 'l-rpc-4fl',   fromDeviceId: 'rpc-kassa-sw', fromPortId: 'eth2', toDeviceId: 'ap-4fl',       toPortId: 'poe', cable: 'copper' },
  { id: 'l-rpc-cafe2', fromDeviceId: 'rpc-kassa-sw', fromPortId: 'eth3', toDeviceId: 'cctv-cafe02',  toPortId: 'poe', cable: 'copper' },
  { id: 'l-rpc-rcpl',  fromDeviceId: 'rpc-kassa-sw', fromPortId: 'eth4', toDeviceId: 'cctv-rcp-l',   toPortId: 'poe', cable: 'copper' },
  { id: 'l-rpc-2fl-s', fromDeviceId: 'rpc-kassa-sw', fromPortId: 'eth5', toDeviceId: 'ap-2fl-srv',   toPortId: 'poe', cable: 'copper' },
  { id: 'l-core-lobby',fromDeviceId: 'sw-core', fromPortId: 'eth4', toDeviceId: 'ap-lobby',   toPortId: 'poe', cable: 'copper' },
  { id: 'l-core-3fl',  fromDeviceId: 'sw-core', fromPortId: 'eth8', toDeviceId: 'ap-3fl',     toPortId: 'poe', cable: 'copper' },
  { id: 'l-core-4fl',  fromDeviceId: 'sw-core', fromPortId: 'eth9', toDeviceId: 'ap-4fl-unifi', toPortId: 'poe', cable: 'copper' },
  { id: 'l-core-cafe1',fromDeviceId: 'sw-core', fromPortId: 'eth11', toDeviceId: 'cctv-cafe01',  toPortId: 'poe', cable: 'copper' },
  { id: 'l-core-vhod', fromDeviceId: 'sw-core', fromPortId: 'eth12', toDeviceId: 'cctv-vhod-do', toPortId: 'poe', cable: 'copper' },
  { id: 'l-core-rcpr', fromDeviceId: 'sw-core', fromPortId: 'eth13', toDeviceId: 'cctv-rcp-r',   toPortId: 'poe', cable: 'copper' },
  { id: 'l-core-back', fromDeviceId: 'sw-core', fromPortId: 'eth14', toDeviceId: 'cctv-backdoor',toPortId: 'poe', cable: 'copper' },
  { id: 'l-core-4tp',  fromDeviceId: 'sw-core', fromPortId: 'eth3', toDeviceId: 'sw-4fl-tp',    toPortId: 'eth1', cable: 'copper' },

  // Guest / conference
  { id: 'l-core-guest', fromDeviceId: 'sw-core',  fromPortId: 'eth2', toDeviceId: 'sw-guest', toPortId: 'eth1', cable: 'copper' },
  { id: 'l-guest-conf', fromDeviceId: 'sw-guest', fromPortId: 'eth2', toDeviceId: 'ap-conf-zal', toPortId: 'poe', cable: 'copper' },
  { id: 'l-guest-hall', fromDeviceId: 'sw-guest', fromPortId: 'eth3', toDeviceId: 'ap-2fl-hall', toPortId: 'poe', cable: 'copper' },

  // Restaurant DV (inter-group fiber)
  { id: 'l-core-dv',    fromDeviceId: 'sw-core', fromPortId: 'sfp1', toDeviceId: 'sw-dv', toPortId: 'sfp1', cable: 'fiber' },
  { id: 'l-dv-posrk',   fromDeviceId: 'sw-dv',   fromPortId: 'eth1', toDeviceId: 'pos-rk',        toPortId: 'lan', cable: 'copper' },
  { id: 'l-dv-poskassa',fromDeviceId: 'sw-dv',   fromPortId: 'eth2', toDeviceId: 'pos-kassa-dv',  toPortId: 'lan', cable: 'copper' },
  { id: 'l-dv-prn1',    fromDeviceId: 'sw-dv',   fromPortId: 'eth3', toDeviceId: 'printer-dv1',   toPortId: 'lan', cable: 'copper' },
  { id: 'l-dv-prn2',    fromDeviceId: 'sw-dv',   fromPortId: 'eth4', toDeviceId: 'printer-dv2',   toPortId: 'lan', cable: 'copper' },
  { id: 'l-dv-ap',      fromDeviceId: 'sw-dv',   fromPortId: 'eth5', toDeviceId: 'ap-dv',         toPortId: 'poe', cable: 'copper' },
  { id: 'l-dv-poe1',    fromDeviceId: 'sw-dv',   fromPortId: 'eth6', toDeviceId: 'poe-sw-1',      toPortId: 'eth1', cable: 'copper' },
  { id: 'l-dv-poe2',    fromDeviceId: 'sw-dv',   fromPortId: 'eth7', toDeviceId: 'poe-sw-2',      toPortId: 'eth1', cable: 'copper' },

  // POE_SW_1 cameras
  { id: 'l-poe1-c1', fromDeviceId: 'poe-sw-1', fromPortId: 'eth2', toDeviceId: 'cctv-dolce_kitchen', toPortId: 'poe', cable: 'copper' },
  { id: 'l-poe1-c2', fromDeviceId: 'poe-sw-1', fromPortId: 'eth3', toDeviceId: 'cctv-dolce_cold_10', toPortId: 'poe', cable: 'copper' },
  { id: 'l-poe1-c3', fromDeviceId: 'poe-sw-1', fromPortId: 'eth4', toDeviceId: 'cctv-dolce_cam_06',  toPortId: 'poe', cable: 'copper' },
  { id: 'l-poe1-c4', fromDeviceId: 'poe-sw-1', fromPortId: 'eth5', toDeviceId: 'cctv-dolce_cam_02',  toPortId: 'poe', cable: 'copper' },
  { id: 'l-poe1-c5', fromDeviceId: 'poe-sw-1', fromPortId: 'eth6', toDeviceId: 'cctv-d-kitchen_hot_11', toPortId: 'poe', cable: 'copper' },
  { id: 'l-poe1-c6', fromDeviceId: 'poe-sw-1', fromPortId: 'eth7', toDeviceId: 'cctv-dolce_sigar_09', toPortId: 'poe', cable: 'copper' },

  // POE_SW_2 cameras
  { id: 'l-poe2-c1', fromDeviceId: 'poe-sw-2', fromPortId: 'eth2', toDeviceId: 'cctv-dolce_cam_04', toPortId: 'poe', cable: 'copper' },
  { id: 'l-poe2-c2', fromDeviceId: 'poe-sw-2', fromPortId: 'eth3', toDeviceId: 'cctv-dolce_cam_05', toPortId: 'poe', cable: 'copper' },
  { id: 'l-poe2-c3', fromDeviceId: 'poe-sw-2', fromPortId: 'eth4', toDeviceId: 'cctv-dolce_cam_07', toPortId: 'poe', cable: 'copper' },
  { id: 'l-poe2-c4', fromDeviceId: 'poe-sw-2', fromPortId: 'eth5', toDeviceId: 'cctv-dolce_bar',    toPortId: 'poe', cable: 'copper' },
  { id: 'l-poe2-c5', fromDeviceId: 'poe-sw-2', fromPortId: 'eth6', toDeviceId: 'cctv-vhod_dv',      toPortId: 'poe', cable: 'copper' },
];

// Дона — 192.168.10.x сеть
const donaVlans: Vlan[] = [
  { id: 'vlan-d-mgmt', vlanId:  1, name: 'MGMT',      color: '#64748B',
    cidr: '192.168.10.0/24', gateway: '192.168.10.1',
    description: 'Management-сегмент оборудования' },
  { id: 'vlan-d-buh',  vlanId: 15, name: 'BUH',       color: '#3B82F6',
    cidr: '192.168.15.0/24', gateway: '192.168.15.1',
    description: 'Бухгалтерия — изолирована, 1С, банк-клиент' },
  { id: 'vlan-d-kass', vlanId: 25, name: 'KASSA',     color: '#8B5CF6',
    cidr: '192.168.25.0/24', gateway: '192.168.25.1',
    description: 'Кассовые терминалы (POS)' },
  { id: 'vlan-d-guest',vlanId: 20, name: 'GUEST',     color: '#10B981',
    cidr: '192.168.20.0/24', gateway: '192.168.20.1',
    description: 'Гостевой Wi-Fi' },
  { id: 'vlan-d-cctv', vlanId: 50, name: 'CCTV',      color: '#EF4444',
    cidr: '192.168.50.0/24', gateway: '192.168.50.1',
    description: 'Камеры Dolce (11 шт) на этажах' },
];

export const donaSeed: NetMapDoc = {
  version: 3,
  name: 'Отель «Дона»',
  groups, devices, links,
  vlans: donaVlans,
  stickies: [],
};
