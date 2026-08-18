// Отель "Усадьба" — reconstructed from the original diagram
// Colors: fiber uplinks = blue, copper = yellow, WAN = red
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
  { id: 'z-internet', name: 'Интернет · Провайдеры', x: 1200, y: -200, width: 620, height: 120, color: '#94A3B8' },
  { id: 'z-serv',  name: 'Серверная',      x: 1200, y:   0, width: 620, height: 340, color: '#60a5fa' },
  { id: 'z-u2',    name: 'Корпус U2',      x:    0, y: 380, width: 560, height: 500, color: '#5eead4' },
  { id: 'z-u4',    name: 'Корпус U4',      x:  600, y: 380, width: 480, height: 260, color: '#c084fc' },
  { id: 'z-rcp',   name: 'Ресепшн',        x:    0, y: 920, width: 520, height: 260, color: '#f472b6' },
  { id: 'z-karet', name: 'Каретная',       x:  560, y: 920, width: 480, height: 260, color: '#fbbf24' },
  { id: 'z-rest',  name: 'Ресторан',       x: 1080, y: 680, width: 640, height: 360, color: '#f59e0b' },
  { id: 'z-kit',   name: 'Кухня',          x: 1760, y: 680, width: 380, height: 260, color: '#f87171' },
  { id: 'z-kony',  name: 'Конференц-зал',  x: 1080, y:1080, width: 640, height: 240, color: '#a78bfa' },
];

const devices: Device[] = [
  // ---- Providers ----
  { id: 'isp-rt',  name: 'Rostelecom', kind: 'cloud', ...g('z-internet',  40, 40), ports: [{ id: 'wan', label: 'WAN', status: 'up' }] },
  { id: 'isp-bl',  name: 'BeeLine',    kind: 'cloud', ...g('z-internet', 220, 40), ports: [{ id: 'wan', label: 'WAN', status: 'up' }] },
  { id: 'isp-et',  name: 'E-type',     kind: 'cloud', ...g('z-internet', 400, 40), ports: [{ id: 'wan', label: 'WAN', status: 'up' }] },

  // ---- Серверная: GW, SW_OPT, SRV_HYPERV_U, SW_GUEST ----
  {
    id: 'gw', name: 'GW', kind: 'router',
    vendor: 'MikroTik', model: 'RB3011 UiAS-RM',
    ip: '192.168.11.1/24', mgmtUrl: 'https://192.168.11.1',
    display: 'compact', ...g('z-serv', 20, 60),
    ports: [
      { id: 'eth1', label: 'WAN Rostelecom', type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth2', label: 'WAN BeeLine',    type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth3', label: 'WAN E-type',     type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth4', label: 'to SW_OPT',      type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth5', label: 'to SW_GUEST',    type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth6', label: 'to SRV_HYPERV Physical', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth7', label: 'to SRV_HYPERV Virtual',  type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth8', label: 'IPMI',           type: 'RJ45', speed: '100M', status: 'up' },
      ...eth(2),
    ],
    tags: ['core'],
    credential: { username: 'admin' },
  },
  {
    id: 'sw-opt', name: 'SW_OPT', kind: 'switch',
    vendor: 'MikroTik', model: 'Cloud Router Switch',
    ip: '10.11.99.10',
    display: 'compact', ...g('z-serv', 20, 200),
    ports: [
      { id: 'eth1', label: 'to GW eth4',     type: 'RJ45', speed: '1G',  status: 'up', uplink: true },
      { id: 'sfp1', label: 'to SW_CORE',     type: 'SFP+', speed: '10G', status: 'up' },
      { id: 'sfp2', label: 'to SW_U2',       type: 'SFP+', speed: '10G', status: 'up' },
      { id: 'sfp3', label: 'to SW_Kitchen',  type: 'SFP+', speed: '10G', status: 'up' },
      { id: 'sfp4', label: 'to SW_KONY',     type: 'SFP+', speed: '10G', status: 'up' },
      { id: 'eth2', label: 'to SW_RCP',      type: 'RJ45', speed: '1G',  status: 'up' },
      { id: 'eth3', label: 'to SW_Karetnaya',type: 'RJ45', speed: '1G',  status: 'up' },
    ],
  },
  {
    id: 'sw-guest', name: 'SW_GUEST', kind: 'switch',
    vendor: 'D-Link', model: 'DGS-1016',
    ip: '10.11.99.252',
    display: 'compact', ...g('z-serv', 300, 30),
    ports: [
      { id: 'eth1', label: 'to GW eth5', type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      ...eth(15),
    ],
  },
  {
    id: 'srv-hyperv', name: 'SRV_HYPERV_U', kind: 'server',
    vendor: 'Custom', model: 'Hyper-V Host',
    ip: '192.168.11.5',
    display: 'compact', ...g('z-serv', 300, 130),
    ports: [
      { id: 'phys', label: 'to GW eth6',  type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'virt', label: 'to GW eth7',  type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'ipmi', label: 'IPMI',        type: 'RJ45', speed: '100M', status: 'up' },
    ],
    credential: { username: 'Administrator' },
    hostSpec: {
      cpu: 'Xeon E-2288G · 8c/16t · 3.7GHz',
      ramGb: 64,
      os: 'Windows Server', osVersion: '2019 Datacenter',
      formFactor: '2U',
      disks: [
        { sizeGB: 480,  kind: 'SSD',  model: 'Samsung PM893', role: 'system' },
        { sizeGB: 2048, kind: 'NVMe', model: 'Samsung 980 Pro', role: 'VM store' },
        { sizeGB: 8192, kind: 'HDD',  role: 'archive' },
      ],
      software: ['Hyper-V', 'Bitwarden', 'AD DS', 'File Server', 'Veeam B&R'],
    },
  },

  // VMs on Hyper-V
  {
    id: 'vm-bitwarden', name: 'VM_Bitwarden', kind: 'vm', hostDeviceId: 'srv-hyperv',
    vmInfo: { vcpu: 2, ramGb: 4, os: 'Ubuntu 22.04' },
    ip: '192.168.11.50', display: 'compact', ...g('z-serv', 480, 30),
    ports: [{ id: 'vnic1', label: 'vSwitch', type: 'RJ45', speed: '1G', status: 'up' }],
  },
  {
    id: 'vm-dc', name: 'VM_DomainController', kind: 'vm', hostDeviceId: 'srv-hyperv',
    vmInfo: { vcpu: 4, ramGb: 8, os: 'Win Server 2022' },
    ip: '192.168.11.10', display: 'compact', ...g('z-serv', 480, 130),
    ports: [{ id: 'vnic1', label: 'vSwitch', type: 'RJ45', speed: '1G', status: 'up' }],
  },
  {
    id: 'vm-fileserver', name: 'VM_FileServer', kind: 'vm', hostDeviceId: 'srv-hyperv',
    vmInfo: { vcpu: 2, ramGb: 8, os: 'Win Server 2019' },
    ip: '192.168.11.20', display: 'compact', ...g('z-serv', 480, 230),
    ports: [{ id: 'vnic1', label: 'vSwitch', type: 'RJ45', speed: '1G', status: 'up' }],
  },

  // ---- Корпус U2 ----
  {
    id: 'sw-u2', name: 'SW_U2', kind: 'switch',
    vendor: 'Cisco', model: 'Catalyst WS-CE500-24LC',
    ip: '10.11.99.11',
    display: 'compact', ...g('z-u2', 20, 40),
    ports: [
      { id: 'sfp1', label: 'to SW_OPT sfp2', type: 'SFP',  speed: '1G', uplink: true, status: 'up' },
      { id: 'eth1', label: 'to SW_U4',        type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth2', label: 'to Agat UX-3710', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth3', label: 'to SW_CCTV',      type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth4', label: 'AP_U2_Hall',      type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth5', label: 'AP_U2_1FL',       type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth6', label: 'AP_U2_Conf2',     type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth7', label: 'AP_U2_47Room',    type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth8', label: 'AP_U2_R59',       type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth9', label: 'AP_U2_2FL_Hall',  type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth10',label: 'AP_U2_Bridge',    type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth11',label: 'AP_U2_Pool',      type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth12',label: 'to PP_U2',        type: 'RJ45', speed: '1G', status: 'up' },
      ...eth(12, { poe: true }),
    ],
  },
  {
    id: 'agat-u2', name: 'Agat UX-3710 (U2)', kind: 'switch',
    vendor: 'АГАТ', model: 'UX-3710',
    display: 'compact', ...g('z-u2', 260, 40),
    ports: [
      { id: 'eth1', label: 'to SW_U2 eth2', type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth2', label: 'SALTO_door',    type: 'RJ45', speed: '100M', status: 'up' },
      { id: 'eth3', label: 'SALTO_SKLAD',   type: 'RJ45', speed: '100M', status: 'up' },
      ...eth(5),
    ],
  },
  {
    id: 'sw-cctv-u2', name: 'SW_CCTV', kind: 'switch',
    vendor: 'D-Link', model: 'DGS-1016P',
    display: 'compact', ...g('z-u2', 260, 140),
    ports: [
      { id: 'eth1', label: 'to SW_U2 eth3', type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth2', label: 'ubnt-1Fl-R',    type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth3', label: 'ubnt-1Fl-L',    type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth4', label: 'ubnt-2Fl',      type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth5', label: 'ubnt-3Fl-L',    type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth6', label: 'ubnt-3Fl-R',    type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth7', label: 'CCTV',          type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      ...eth(9, { poe: true }),
    ],
  },
  {
    id: 'pp-u2', name: 'PP_U2 (24p)', kind: 'patchpanel',
    vendor: 'Legrand', model: 'LCS³ 24-port cat.6',
    display: 'compact', ...g('z-u2', 20, 320),
    ports: [
      { id: 'port1',  label: 'Хол · роз 1',     type: 'RJ45', status: 'up' },
      { id: 'port2',  label: 'Хол · роз 2',     type: 'RJ45', status: 'up' },
      { id: 'port3',  label: 'Ресепшн U2',      type: 'RJ45', status: 'up' },
      { id: 'port4',  label: 'Комн. 47',        type: 'RJ45', status: 'up' },
      { id: 'port5',  label: 'Комн. 59',        type: 'RJ45', status: 'up' },
      { id: 'port6',  label: 'Бассейн · камера',type: 'RJ45', status: 'up' },
      ...Array.from({ length: 18 }, (_, i) => ({
        id: `port${i+7}`, label: '', type: 'RJ45' as const, status: 'down' as const,
      })),
    ],
  },
  { id: 'ap-u2-hall',  name: 'AP_U2_Hall',     kind: 'ap', display: 'compact', ...g('z-u2',  40, 420), ports: single() },
  { id: 'ap-u2-1fl',   name: 'AP_U2_1FL',      kind: 'ap', display: 'compact', ...g('z-u2', 180, 420), ports: single() },
  { id: 'ap-u2-conf2', name: 'AP_U2_Conf2',    kind: 'ap', display: 'compact', ...g('z-u2', 320, 420), ports: single() },
  { id: 'salto-door',  name: 'SALTO_door',     kind: 'lock', display: 'compact', ...g('z-u2', 400, 40),  ports: [{ id: 'ctrl', label: '', type: 'RJ45', speed: '100M', status: 'up' }] },
  { id: 'salto-sklad', name: 'SALTO_SKLAD',    kind: 'lock', display: 'compact', ...g('z-u2', 400, 140), ports: [{ id: 'ctrl', label: '', type: 'RJ45', speed: '100M', status: 'up' }] },

  // ---- Корпус U4 ----
  {
    id: 'sw-u4', name: 'SW_U4', kind: 'switch',
    vendor: 'MikroTik', model: 'CRS125-24G-1S-2HnD',
    display: 'compact', ...g('z-u4', 20, 40),
    ports: [
      { id: 'eth1',  label: 'to SW_U2 eth1',   type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth2',  label: 'to Agat UX-3710', type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth3',  label: 'AP_U4_1FL',       type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth4',  label: 'AP_U4_2FL',       type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth5',  label: 'CCTV_U4',         type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth6',  label: 'SALTO_U4',        type: 'RJ45', speed: '100M', status: 'up' },
      { id: 'sfp1',  label: 'SFP',             type: 'SFP',  speed: '1G', status: 'down' },
      ...eth(18, { poe: true }),
    ],
  },
  { id: 'agat-u4',   name: 'Agat UX-3710 (U4)', kind: 'switch', display: 'compact', ...g('z-u4', 320, 40),
    ports: [
      { id: 'eth1', label: 'to SW_U4', type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      ...eth(7),
    ]
  },
  { id: 'ap-u4-1fl', name: 'AP_U4_1FL', kind: 'ap',     display: 'compact', ...g('z-u4', 320, 140), ports: single() },
  { id: 'ap-u4-2fl', name: 'AP_U4_2FL', kind: 'ap',     display: 'compact', ...g('z-u4', 320, 200), ports: single() },
  { id: 'cctv-u4',   name: 'CCTV_U4',   kind: 'camera', display: 'compact', ...g('z-u4',  40, 180), ports: single('poe', true, '100M'), attachedToRegistrarId: 'reg-cctv-kony' },
  { id: 'salto-u4',  name: 'SALTO_U4',  kind: 'lock',   display: 'compact', ...g('z-u4', 180, 180), ports: [{ id: 'ctrl', label: '', type: 'RJ45', speed: '100M', status: 'up' }] },

  // ---- Ресепшн ----
  {
    id: 'sw-rcp', name: 'SW_RCP', kind: 'switch',
    vendor: 'MikroTik', model: 'CRS125-24G-1S-2HnD',
    ip: '10.11.99.252',
    display: 'compact', ...g('z-rcp', 20, 40),
    ports: [
      { id: 'eth1', label: 'to SW_OPT eth2', type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth2', label: 'to SW_Dlink',    type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth3', label: 'PC-2_Table',     type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth4', label: 'up_security',    type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth5', label: 'AP_Unifi_NEW',   type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth6', label: 'Printer_Canon',  type: 'RJ45', speed: '100M', status: 'up' },
      { id: 'eth7', label: 'SALTO1_Table',   type: 'RJ45', speed: '100M', status: 'up' },
      ...eth(17, { poe: true }),
    ],
  },
  { id: 'sw-dlink', name: 'SW_Dlink', kind: 'switch', vendor: 'D-Link', display: 'compact', ...g('z-rcp', 320, 40),
    ports: [
      { id: 'eth1', label: 'to SW_RCP', type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      ...eth(7),
    ]
  },
  { id: 'pc-table',   name: 'PC-2_Table',   kind: 'pc',      display: 'compact', ...g('z-rcp',  20, 180), ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },
  { id: 'up-security',name: 'up_security',  kind: 'pc',      display: 'compact', ...g('z-rcp', 160, 180), ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },
  { id: 'ap-unifi',   name: 'AP_Unifi_NEW', kind: 'ap',      display: 'compact', ...g('z-rcp', 300, 180), ports: single() },
  { id: 'printer-canon', name: 'Printer_Canon', kind: 'printer', display: 'compact', ...g('z-rcp',  20, 40),  ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '100M', status: 'up' }] },
  { id: 'salto-table',name: 'SALTO1_Table', kind: 'lock',    display: 'compact', ...g('z-rcp', 400, 180), ports: [{ id: 'ctrl', label: '', type: 'RJ45', speed: '100M', status: 'up' }] },

  // ---- Каретная ----
  {
    id: 'sw-karet', name: 'SW_Karetnaya', kind: 'switch',
    vendor: 'Cisco', model: 'Catalyst WS-CE500-24LC',
    display: 'compact', ...g('z-karet', 20, 40),
    ports: [
      { id: 'eth1', label: 'to SW_OPT eth3', type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth2', label: 'Terminal',      type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth3', label: 'AP_U3',         type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth4', label: 'AP_U2 (kar)',   type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth5', label: 'AP_Srv_Room',   type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth6', label: 'pc_eng_2',      type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth7', label: 'CCTV_karet',    type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      ...eth(17, { poe: true }),
    ],
  },
  { id: 'terminal',   name: 'Terminal',    kind: 'pos',    display: 'compact', ...g('z-karet', 320, 40),  ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },
  { id: 'pc-eng-2',   name: 'pc_eng_2',    kind: 'pc',     display: 'compact', ...g('z-karet', 320, 140), ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },
  { id: 'ap-u3',      name: 'AP_U3',       kind: 'ap',     display: 'compact', ...g('z-karet',  40, 180), ports: single() },
  { id: 'ap-srv-room',name: 'AP_Srv_Room', kind: 'ap',     display: 'compact', ...g('z-karet', 180, 180), ports: single() },
  { id: 'cctv-karet', name: 'CCTV_karet',  kind: 'camera', display: 'compact', ...g('z-karet', 320, 180), ports: single('poe', true, '100M'), attachedToRegistrarId: 'reg-cctv-u1' },

  // ---- Ресторан ----
  {
    id: 'sw-core', name: 'SW_CORE', kind: 'switch',
    vendor: 'TP-Link', model: 'TL-SG3428XMP',
    ip: '10.11.99.28',
    display: 'compact', ...g('z-rest', 20, 40),
    ports: [
      { id: 'sfp1', label: 'to SW_OPT sfp1',  type: 'SFP+', speed: '10G', status: 'up', uplink: true },
      { id: 'eth1', label: 'POE_SW',          type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth2', label: 'POS+kassa',       type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth3', label: 'Reg_CCTV_U1',     type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth4', label: 'SRV-UTM-U',       type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth5', label: 'AP_Restoran',     type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth6', label: 'AP_4FL',          type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth7', label: 'AP_2FL',          type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth8', label: 'AP_Vhod_veranda', type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth9', label: 'RK7_Bar',         type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth10',label: 'SALTO_Door',      type: 'RJ45', speed: '100M', status: 'up' },
      { id: 'eth11',label: 'CCTV_2fl_hall',   type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth12',label: 'CCTV_NewZal',     type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth13',label: 'CCTV_belZal',     type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      ...eth(11, { poe: true }),
    ],
  },
  {
    id: 'poe-sw', name: 'POE_SW', kind: 'switch',
    vendor: 'TP-Link', model: '8-port PoE Switch',
    display: 'compact', ...g('z-rest', 20, 180),
    ports: [
      { id: 'eth1', label: 'to SW_CORE eth1', type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      { id: 'eth2', label: 'CCTV_cmin_u1',    type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth3', label: 'CCTV_bar_u1',     type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth4', label: 'CCTV_Vhod_u1',    type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth5', label: 'CCTV_rest_u1',    type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth6', label: 'CCTV_kozrek',     type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
      { id: 'eth7', label: 'Printer_Grile',   type: 'RJ45', speed: '100M', status: 'up' },
      { id: 'eth8', label: 'CCTV_manager_u1', type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'up' },
    ],
  },
  { id: 'pos-kassa',   name: 'POS+kassa',     kind: 'pos',     display: 'compact', ...g('z-rest', 340, 40),  ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },
  { id: 'rk7-bar',     name: 'RK7_Bar',       kind: 'pos',     display: 'compact', ...g('z-rest', 470, 40),  ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },
  { id: 'reg-cctv-u1', name: 'Reg_CCTV_U1',   kind: 'server',  display: 'compact', ...g('z-rest', 340, 140),
    ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }],
    dvr: {
      channels: 16, activeChannels: 12, resolution: '1080p', retentionDays: 30,
      software: 'TRASSIR',
      disks: [
        { sizeGB: 4096, kind: 'HDD', model: 'Seagate SkyHawk' },
        { sizeGB: 4096, kind: 'HDD', model: 'Seagate SkyHawk' },
      ],
    },
    cameraIds: ['cctv-cmin', 'cctv-bar', 'cctv-vhod', 'cctv-rest', 'cctv-mgr', 'cctv-kozrek', 'cctv-karet'],
  },
  { id: 'srv-utm',     name: 'SRV-UTM-U',     kind: 'server',  model: 'PayTor IB-502', display: 'compact', ...g('z-rest', 470, 140),
    ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }],
    hostSpec: {
      cpu: 'Intel Core i5-9500 · 6c/6t · 3.0GHz',
      ramGb: 16, os: 'Ubuntu Server', osVersion: '22.04 LTS',
      formFactor: '1U',
      disks: [{ sizeGB: 480, kind: 'SSD', model: 'Kingston DC500' }],
      software: ['nginx', 'PostgreSQL 15', 'PayTor UTM', 'Docker 24'],
    },
  },
  { id: 'salto-door2', name: 'SALTO_Door',    kind: 'lock',    display: 'compact', ...g('z-rest', 340, 240), ports: [{ id: 'ctrl', label: '', type: 'RJ45', speed: '100M', status: 'up' }] },
  { id: 'ap-restoran', name: 'AP_Restoran',   kind: 'ap',      display: 'compact', ...g('z-rest', 470, 240), ports: single(),
    ssids: [{ name: 'Usadba-Guest', band: 'both', guest: true }, { name: 'Usadba-Staff', band: '5GHz' }],
  },
  { id: 'ap-4fl',      name: 'AP_4FL',        kind: 'ap',      display: 'compact', ...g('z-rest', 340, 290), ports: single(),
    ssids: [{ name: 'Usadba-Guest', band: 'both', guest: true }, { name: 'Usadba-Staff', band: '5GHz' }],
  },
  { id: 'ap-2fl',      name: 'AP_2FL',        kind: 'ap',      display: 'compact', ...g('z-rest', 470, 290), ports: single(),
    ssids: [{ name: 'Usadba-Guest', band: 'both', guest: true }, { name: 'Usadba-Staff', band: '5GHz' }],
  },
  { id: 'ap-vhod',     name: 'AP_Vhod_veranda', kind: 'ap',    display: 'compact', ...g('z-rest', 200, 290), ports: single(),
    ssids: [{ name: 'Usadba-Guest', band: 'both', guest: true }],
  },
  { id: 'printer-grile', name: 'Printer_Grile', kind: 'printer', display: 'compact', ...g('z-rest', 200, 340), ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '100M', status: 'up' }] },
  { id: 'cctv-cmin',   name: 'CCTV_cmin_u1',  kind: 'camera',  display: 'compact', ...g('z-rest', 200, 180), ports: single('poe', true, '100M'), attachedToRegistrarId: 'reg-cctv-u1' },
  { id: 'cctv-bar',    name: 'CCTV_bar_u1',   kind: 'camera',  display: 'compact', ...g('z-rest', 200, 230), ports: single('poe', true, '100M'), attachedToRegistrarId: 'reg-cctv-u1' },
  { id: 'cctv-vhod',   name: 'CCTV_Vhod_u1',  kind: 'camera',  display: 'compact', ...g('z-rest', 470, 180), ports: single('poe', true, '100M'), attachedToRegistrarId: 'reg-cctv-u1' },
  { id: 'cctv-rest',   name: 'CCTV_rest_u1',  kind: 'camera',  display: 'compact', ...g('z-rest', 550, 180), ports: single('poe', true, '100M'), attachedToRegistrarId: 'reg-cctv-u1' },
  { id: 'cctv-mgr',    name: 'CCTV_manager_u1', kind: 'camera', display: 'compact', ...g('z-rest', 340, 340), ports: single('poe', true, '100M'), attachedToRegistrarId: 'reg-cctv-u1' },
  { id: 'cctv-kozrek', name: 'CCTV_kozrek',   kind: 'camera',  display: 'compact', ...g('z-rest', 470, 340), ports: single('poe', true, '100M'), attachedToRegistrarId: 'reg-cctv-u1' },

  // ---- Кухня ----
  {
    id: 'sw-kitchen', name: 'SW_Kitchen', kind: 'switch',
    vendor: 'Cisco', model: 'Catalyst Express 500',
    ip: '10.11.99.251',
    display: 'compact', ...g('z-kit', 20, 40),
    ports: [
      { id: 'sfp1', label: 'to SW_OPT sfp3', type: 'SFP+', speed: '10G', status: 'up', uplink: true },
      { id: 'eth1', label: 'RK7_Leto',       type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth2', label: 'Printer_Hot',    type: 'RJ45', speed: '100M', status: 'up' },
      { id: 'eth3', label: 'AP_leto',        type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth4', label: 'AP_srv',         type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth5', label: 'to Agat Kitchen',type: 'RJ45', speed: '1G', status: 'up' },
      { id: 'eth6', label: 'Printer_COLD',   type: 'RJ45', speed: '100M', status: 'up' },
      ...eth(18),
    ],
  },
  { id: 'rk7-leto',     name: 'RK7_Leto',     kind: 'pos',     display: 'compact', ...g('z-kit', 240, 40),  ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }] },
  { id: 'ap-leto',      name: 'AP_leto',      kind: 'ap',      display: 'compact', ...g('z-kit', 240, 140), ports: single() },
  { id: 'ap-srv',       name: 'AP_srv',       kind: 'ap',      display: 'compact', ...g('z-kit', 240, 200), ports: single() },
  { id: 'printer-hot',  name: 'Printer_Hot',  kind: 'printer', display: 'compact', ...g('z-kit',  40, 180), ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '100M', status: 'up' }] },
  { id: 'printer-cold', name: 'Printer_COLD', kind: 'printer', display: 'compact', ...g('z-kit', 130, 180), ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '100M', status: 'up' }] },
  { id: 'agat-kitchen', name: 'Agat Kitchen', kind: 'switch',  display: 'compact', ...g('z-kit',  40, 240),
    ports: [
      { id: 'eth1', label: 'to SW_Kitchen', type: 'RJ45', speed: '1G', status: 'up', uplink: true },
      ...eth(7),
    ]
  },

  // ---- Конференц-зал ----
  {
    id: 'sw-kony', name: 'SW_KONY', kind: 'switch',
    vendor: 'Cisco', model: 'Catalyst WS-CE500-24LC',
    display: 'compact', ...g('z-kony', 20, 40),
    ports: [
      { id: 'sfp1', label: 'to SW_OPT sfp4', type: 'SFP+', speed: '10G', status: 'up', uplink: true },
      { id: 'eth1', label: 'AP_Zal',         type: 'RJ45', speed: '1G', poe: true, poeActive: true, status: 'up' },
      { id: 'eth2', label: 'Reg_CCTV_KONY',  type: 'RJ45', speed: '1G', status: 'up' },
      ...eth(22, { poe: true }),
    ],
  },
  { id: 'ap-zal',        name: 'AP_Zal',        kind: 'ap',     display: 'compact', ...g('z-kony', 340, 40),  ports: single(),
    ssids: [{ name: 'Usadba-Conf', band: '5GHz' }, { name: 'Usadba-Guest', band: 'both', guest: true }],
  },
  { id: 'reg-cctv-kony', name: 'Reg_CCTV_KONY', kind: 'server', display: 'compact', ...g('z-kony', 340, 140),
    ports: [{ id: 'lan', label: '', type: 'RJ45', speed: '1G', status: 'up' }],
    dvr: {
      channels: 8, activeChannels: 6, resolution: '1080p', retentionDays: 14,
      software: 'Xeoma',
      disks: [{ sizeGB: 2048, kind: 'HDD', model: 'WD Purple' }],
    },
    cameraIds: ['cctv-u4'],
  },
];

const links: Link[] = [
  // WAN
  { id: 'l-rt', fromDeviceId: 'isp-rt', fromPortId: 'wan', toDeviceId: 'gw', toPortId: 'eth1', cable: 'fiber', color: '#e5484d', label: 'Rostelecom' },
  { id: 'l-bl', fromDeviceId: 'isp-bl', fromPortId: 'wan', toDeviceId: 'gw', toPortId: 'eth2', cable: 'fiber', color: '#e5484d', label: 'BeeLine' },
  { id: 'l-et', fromDeviceId: 'isp-et', fromPortId: 'wan', toDeviceId: 'gw', toPortId: 'eth3', cable: 'fiber', color: '#e5484d', label: 'E-type' },

  // Server room (inter-group but within z-serv it's intra)
  { id: 'l-gw-opt',   fromDeviceId: 'gw',       fromPortId: 'eth4', toDeviceId: 'sw-opt',     toPortId: 'eth1', cable: 'copper',
    vlans: [1, 10, 20, 30, 40, 50] },   // trunk — все VLAN'ы вниз к оптике
  { id: 'l-gw-guest', fromDeviceId: 'gw',       fromPortId: 'eth5', toDeviceId: 'sw-guest',   toPortId: 'eth1', cable: 'copper',
    vlan: 20 },                           // access — только GUEST
  { id: 'l-gw-srv-p', fromDeviceId: 'gw',       fromPortId: 'eth6', toDeviceId: 'srv-hyperv', toPortId: 'phys', cable: 'copper',
    vlan: 40 },                           // access — SERVERS
  { id: 'l-gw-srv-v', fromDeviceId: 'gw',       fromPortId: 'eth7', toDeviceId: 'srv-hyperv', toPortId: 'virt', cable: 'copper',
    vlans: [10, 40] },                    // trunk CORP+SRV

  // SW_OPT fiber backbone (INTER-group)
  { id: 'l-opt-core',    fromDeviceId: 'sw-opt', fromPortId: 'sfp1', toDeviceId: 'sw-core',    toPortId: 'sfp1', cable: 'fiber',
    vlans: [1, 10, 20, 40, 50] },
  { id: 'l-opt-u2',      fromDeviceId: 'sw-opt', fromPortId: 'sfp2', toDeviceId: 'sw-u2',      toPortId: 'sfp1', cable: 'fiber',
    vlans: [1, 10, 20, 30, 50] },
  { id: 'l-opt-kitchen', fromDeviceId: 'sw-opt', fromPortId: 'sfp3', toDeviceId: 'sw-kitchen', toPortId: 'sfp1', cable: 'fiber',
    vlans: [1, 10] },
  { id: 'l-opt-kony',    fromDeviceId: 'sw-opt', fromPortId: 'sfp4', toDeviceId: 'sw-kony',    toPortId: 'sfp1', cable: 'fiber' },
  { id: 'l-opt-rcp',     fromDeviceId: 'sw-opt', fromPortId: 'eth2', toDeviceId: 'sw-rcp',     toPortId: 'eth1', cable: 'copper' },
  { id: 'l-opt-karet',   fromDeviceId: 'sw-opt', fromPortId: 'eth3', toDeviceId: 'sw-karet',   toPortId: 'eth1', cable: 'copper' },

  // U2 branch
  { id: 'l-u2-u4',    fromDeviceId: 'sw-u2', fromPortId: 'eth1',  toDeviceId: 'sw-u4',   toPortId: 'eth1', cable: 'copper' },
  { id: 'l-u2-agat',  fromDeviceId: 'sw-u2', fromPortId: 'eth2',  toDeviceId: 'agat-u2', toPortId: 'eth1', cable: 'copper' },
  { id: 'l-u2-cctv',  fromDeviceId: 'sw-u2', fromPortId: 'eth3',  toDeviceId: 'sw-cctv-u2', toPortId: 'eth1', cable: 'copper' },
  { id: 'l-u2-hall',  fromDeviceId: 'sw-u2', fromPortId: 'eth4',  toDeviceId: 'ap-u2-hall',  toPortId: 'poe', cable: 'copper' },
  { id: 'l-u2-1fl',   fromDeviceId: 'sw-u2', fromPortId: 'eth5',  toDeviceId: 'ap-u2-1fl',   toPortId: 'poe', cable: 'copper' },
  { id: 'l-u2-conf2', fromDeviceId: 'sw-u2', fromPortId: 'eth6',  toDeviceId: 'ap-u2-conf2', toPortId: 'poe', cable: 'copper' },
  { id: 'l-u2-pp',    fromDeviceId: 'sw-u2', fromPortId: 'eth12', toDeviceId: 'pp-u2',       toPortId: 'port1', cable: 'copper' },
  { id: 'l-agat-salto1', fromDeviceId: 'agat-u2', fromPortId: 'eth2', toDeviceId: 'salto-door',  toPortId: 'ctrl', cable: 'copper' },
  { id: 'l-agat-salto2', fromDeviceId: 'agat-u2', fromPortId: 'eth3', toDeviceId: 'salto-sklad', toPortId: 'ctrl', cable: 'copper' },

  // U4
  { id: 'l-u4-agat',  fromDeviceId: 'sw-u4', fromPortId: 'eth2', toDeviceId: 'agat-u4',   toPortId: 'eth1', cable: 'copper' },
  { id: 'l-u4-ap1',   fromDeviceId: 'sw-u4', fromPortId: 'eth3', toDeviceId: 'ap-u4-1fl', toPortId: 'poe', cable: 'copper' },
  { id: 'l-u4-ap2',   fromDeviceId: 'sw-u4', fromPortId: 'eth4', toDeviceId: 'ap-u4-2fl', toPortId: 'poe', cable: 'copper' },
  { id: 'l-u4-cctv',  fromDeviceId: 'sw-u4', fromPortId: 'eth5', toDeviceId: 'cctv-u4',   toPortId: 'poe', cable: 'copper' },
  { id: 'l-u4-salto', fromDeviceId: 'sw-u4', fromPortId: 'eth6', toDeviceId: 'salto-u4',  toPortId: 'ctrl', cable: 'copper' },

  // Reception
  { id: 'l-rcp-dlink',  fromDeviceId: 'sw-rcp', fromPortId: 'eth2', toDeviceId: 'sw-dlink',      toPortId: 'eth1', cable: 'copper' },
  { id: 'l-rcp-pc',     fromDeviceId: 'sw-rcp', fromPortId: 'eth3', toDeviceId: 'pc-table',      toPortId: 'lan',  cable: 'copper' },
  { id: 'l-rcp-sec',    fromDeviceId: 'sw-rcp', fromPortId: 'eth4', toDeviceId: 'up-security',   toPortId: 'lan',  cable: 'copper' },
  { id: 'l-rcp-unifi',  fromDeviceId: 'sw-rcp', fromPortId: 'eth5', toDeviceId: 'ap-unifi',      toPortId: 'poe', cable: 'copper' },
  { id: 'l-rcp-canon',  fromDeviceId: 'sw-rcp', fromPortId: 'eth6', toDeviceId: 'printer-canon', toPortId: 'lan', cable: 'copper' },
  { id: 'l-rcp-salto',  fromDeviceId: 'sw-rcp', fromPortId: 'eth7', toDeviceId: 'salto-table',   toPortId: 'ctrl', cable: 'copper' },

  // Karetnaya
  { id: 'l-kar-term',  fromDeviceId: 'sw-karet', fromPortId: 'eth2', toDeviceId: 'terminal',    toPortId: 'lan', cable: 'copper' },
  { id: 'l-kar-u3',    fromDeviceId: 'sw-karet', fromPortId: 'eth3', toDeviceId: 'ap-u3',       toPortId: 'poe', cable: 'copper' },
  { id: 'l-kar-srv',   fromDeviceId: 'sw-karet', fromPortId: 'eth5', toDeviceId: 'ap-srv-room', toPortId: 'poe', cable: 'copper' },
  { id: 'l-kar-pceng', fromDeviceId: 'sw-karet', fromPortId: 'eth6', toDeviceId: 'pc-eng-2',    toPortId: 'lan', cable: 'copper' },
  { id: 'l-kar-cctv',  fromDeviceId: 'sw-karet', fromPortId: 'eth7', toDeviceId: 'cctv-karet',  toPortId: 'poe', cable: 'copper' },

  // Restaurant
  { id: 'l-core-poe',    fromDeviceId: 'sw-core', fromPortId: 'eth1',  toDeviceId: 'poe-sw',        toPortId: 'eth1', cable: 'copper' },
  { id: 'l-core-pos',    fromDeviceId: 'sw-core', fromPortId: 'eth2',  toDeviceId: 'pos-kassa',     toPortId: 'lan',  cable: 'copper' },
  { id: 'l-core-reg',    fromDeviceId: 'sw-core', fromPortId: 'eth3',  toDeviceId: 'reg-cctv-u1',   toPortId: 'lan',  cable: 'copper' },
  { id: 'l-core-utm',    fromDeviceId: 'sw-core', fromPortId: 'eth4',  toDeviceId: 'srv-utm',       toPortId: 'lan',  cable: 'copper' },
  { id: 'l-core-restap', fromDeviceId: 'sw-core', fromPortId: 'eth5',  toDeviceId: 'ap-restoran',   toPortId: 'poe',  cable: 'copper' },
  { id: 'l-core-4fl',    fromDeviceId: 'sw-core', fromPortId: 'eth6',  toDeviceId: 'ap-4fl',        toPortId: 'poe',  cable: 'copper' },
  { id: 'l-core-2fl',    fromDeviceId: 'sw-core', fromPortId: 'eth7',  toDeviceId: 'ap-2fl',        toPortId: 'poe',  cable: 'copper' },
  { id: 'l-core-vhod',   fromDeviceId: 'sw-core', fromPortId: 'eth8',  toDeviceId: 'ap-vhod',       toPortId: 'poe',  cable: 'copper' },
  { id: 'l-core-rk7',    fromDeviceId: 'sw-core', fromPortId: 'eth9',  toDeviceId: 'rk7-bar',       toPortId: 'lan',  cable: 'copper' },
  { id: 'l-core-salto',  fromDeviceId: 'sw-core', fromPortId: 'eth10', toDeviceId: 'salto-door2',   toPortId: 'ctrl', cable: 'copper' },

  { id: 'l-poe-cmin',   fromDeviceId: 'poe-sw', fromPortId: 'eth2', toDeviceId: 'cctv-cmin',     toPortId: 'poe', cable: 'copper' },
  { id: 'l-poe-bar',    fromDeviceId: 'poe-sw', fromPortId: 'eth3', toDeviceId: 'cctv-bar',      toPortId: 'poe', cable: 'copper' },
  { id: 'l-poe-vhod',   fromDeviceId: 'poe-sw', fromPortId: 'eth4', toDeviceId: 'cctv-vhod',     toPortId: 'poe', cable: 'copper' },
  { id: 'l-poe-rest',   fromDeviceId: 'poe-sw', fromPortId: 'eth5', toDeviceId: 'cctv-rest',     toPortId: 'poe', cable: 'copper' },
  { id: 'l-poe-kozrek', fromDeviceId: 'poe-sw', fromPortId: 'eth6', toDeviceId: 'cctv-kozrek',   toPortId: 'poe', cable: 'copper' },
  { id: 'l-poe-grile',  fromDeviceId: 'poe-sw', fromPortId: 'eth7', toDeviceId: 'printer-grile', toPortId: 'lan', cable: 'copper' },
  { id: 'l-poe-mgr',    fromDeviceId: 'poe-sw', fromPortId: 'eth8', toDeviceId: 'cctv-mgr',      toPortId: 'poe', cable: 'copper' },

  // Kitchen
  { id: 'l-kit-rk7',    fromDeviceId: 'sw-kitchen', fromPortId: 'eth1', toDeviceId: 'rk7-leto',     toPortId: 'lan', cable: 'copper' },
  { id: 'l-kit-hot',    fromDeviceId: 'sw-kitchen', fromPortId: 'eth2', toDeviceId: 'printer-hot',  toPortId: 'lan', cable: 'copper' },
  { id: 'l-kit-apleto', fromDeviceId: 'sw-kitchen', fromPortId: 'eth3', toDeviceId: 'ap-leto',      toPortId: 'poe', cable: 'copper' },
  { id: 'l-kit-apsrv',  fromDeviceId: 'sw-kitchen', fromPortId: 'eth4', toDeviceId: 'ap-srv',       toPortId: 'poe', cable: 'copper' },
  { id: 'l-kit-agat',   fromDeviceId: 'sw-kitchen', fromPortId: 'eth5', toDeviceId: 'agat-kitchen', toPortId: 'eth1', cable: 'copper' },
  { id: 'l-kit-cold',   fromDeviceId: 'sw-kitchen', fromPortId: 'eth6', toDeviceId: 'printer-cold', toPortId: 'lan', cable: 'copper' },

  // KONY
  { id: 'l-kony-zal', fromDeviceId: 'sw-kony', fromPortId: 'eth1', toDeviceId: 'ap-zal',        toPortId: 'poe', cable: 'copper' },
  { id: 'l-kony-reg', fromDeviceId: 'sw-kony', fromPortId: 'eth2', toDeviceId: 'reg-cctv-kony', toPortId: 'lan', cable: 'copper' },
];

// Усадьба использует адресацию 10.11.x.x — VLAN'ы прописаны под неё
const usadbaVlans: Vlan[] = [
  { id: 'vlan-u-mgmt', vlanId:  1, name: 'MGMT',      color: '#64748B',
    cidr: '10.11.99.0/24',  gateway: '10.11.99.1',
    description: 'Management VLAN — доступ к оборудованию' },
  { id: 'vlan-u-corp', vlanId: 10, name: 'CORPORATE', color: '#3B82F6',
    cidr: '192.168.11.0/24', gateway: '192.168.11.1',
    description: 'Ресепшн, ПК персонала, POS-терминалы' },
  { id: 'vlan-u-guest',vlanId: 20, name: 'GUEST',     color: '#10B981',
    cidr: '10.11.20.0/24',  gateway: '10.11.20.1',
    description: 'Гостевой Wi-Fi во всех корпусах' },
  { id: 'vlan-u-iot',  vlanId: 30, name: 'IOT-SALTO', color: '#F59E0B',
    cidr: '10.11.30.0/24',  gateway: '10.11.30.1',
    description: 'Электронные замки SALTO номерного фонда' },
  { id: 'vlan-u-srv',  vlanId: 40, name: 'SERVERS',   color: '#8B5CF6',
    cidr: '10.11.40.0/24',  gateway: '10.11.40.1',
    description: 'Hyper-V хост, файловая шара, БД' },
  { id: 'vlan-u-cctv', vlanId: 50, name: 'CCTV',      color: '#EF4444',
    cidr: '10.11.50.0/24',  gateway: '10.11.50.1',
    description: 'IP-камеры видеонаблюдения' },
];

export const usadbaSeed: NetMapDoc = {
  version: 3,
  name: 'Отель «Усадьба»',
  groups, devices, links,
  vlans: usadbaVlans,
  stickies: [
    { id: 'sn-u1', deviceId: 'gw',         text: 'Плановая замена\nмарт 2027', color: 'yellow', rotation: -3, createdAt: 1 },
    { id: 'sn-u2', deviceId: 'sw-core',    text: 'Порт 5 глючит,\nне трогать', color: 'pink',   rotation: 2.5, createdAt: 2 },
    { id: 'sn-u3', deviceId: 'srv-hyperv', text: 'admin пароль\nв vault',     color: 'green',  rotation: -1.5, createdAt: 3 },
  ],
};
