import { useStore } from './store';
import type { Device, DeviceKind } from './types';
import { ICONS, KIND_META } from './icons';

interface Section {
  title: string;
  items: { kind: DeviceKind; label: string; hint?: string }[];
}

const SECTIONS: Section[] = [
  {
    title: 'Сеть',
    items: [
      { kind: 'router',     label: 'Роутер',       hint: 'Маршрутизатор / шлюз' },
      { kind: 'switch',     label: 'Свитч',        hint: 'Управляемый / неуправляемый коммутатор' },
      { kind: 'patchpanel', label: 'Патч-панель',  hint: 'Пассивная 24/48-портовая панель' },
    ]
  },
  {
    title: 'Оконечные',
    items: [
      { kind: 'ap',      label: 'Wi-Fi', hint: 'Access Point с PoE-uplink' },
      { kind: 'camera',  label: 'CCTV',  hint: 'IP-камера с PoE' },
      { kind: 'printer', label: 'Принтер', hint: 'Сетевой принтер' },
      { kind: 'lock',    label: 'Замок',   hint: 'SALTO / контроллер СКУД' },
    ]
  },
  {
    title: 'Компьютеры',
    items: [
      { kind: 'pc',     label: 'ПК',     hint: 'Рабочая станция' },
      { kind: 'pos',    label: 'POS',    hint: 'Кассовый терминал' },
      { kind: 'server', label: 'Сервер', hint: 'Физический хост (Hyper-V/ESXi/bare-metal)' },
      { kind: 'vm',     label: 'VM',     hint: 'Виртуальная машина — привяжите к серверу' },
      { kind: 'vps',    label: 'VPS',    hint: 'Арендованный VDS/VPS у провайдера' },
    ]
  },
  {
    title: 'Внешнее',
    items: [
      { kind: 'cloud', label: 'Провайдер', hint: 'ISP / внешняя сеть' },
    ]
  },
];

export function defaultPortsFor(kind: DeviceKind) {
  const rj45 = (id: string, label = ''): any => ({
    id, label, type: 'RJ45', speed: '1G', status: 'down'
  });
  switch (kind) {
    case 'switch':     return Array.from({ length: 8 },  (_, i) => rj45(`eth${i+1}`));
    case 'router':     return Array.from({ length: 5 },  (_, i) => rj45(`eth${i+1}`));
    case 'patchpanel': return Array.from({ length: 24 }, (_, i) => rj45(`port${i+1}`));
    case 'server':     return [rj45('nic1'), rj45('nic2'),
                               { id: 'ipmi', label: 'IPMI', type: 'RJ45', speed: '100M', status: 'down' }];
    case 'ap':         return [{ id: 'poe',  label: '', type: 'RJ45', speed: '1G',   poe: true, poeActive: true, status: 'down' }];
    case 'camera':     return [{ id: 'poe',  label: '', type: 'RJ45', speed: '100M', poe: true, poeActive: true, status: 'down' }];
    case 'printer':    return [rj45('lan')];
    case 'lock':       return [{ id: 'ctrl', label: '', type: 'RJ45', speed: '100M', status: 'down' }];
    case 'cloud':      return [{ id: 'wan',  label: 'WAN', type: 'RJ45', status: 'up' }];
    case 'vm':         return [{ id: 'vnic1', label: 'vSwitch', type: 'RJ45', speed: '1G', status: 'up' }];
    case 'vps':        return [{ id: 'wan',   label: 'Public',  type: 'RJ45', speed: '1G', status: 'up' }];
    default:           return [rj45('lan')];
  }
}

export function Palette() {
  const addDevice = useStore(s => s.addDevice);
  const select = useStore(s => s.select);

  function createOne(kind: DeviceKind, x = 400, y = 300) {
    const id = `${kind}-${Math.random().toString(36).slice(2, 7)}`;
    const meta = KIND_META[kind];
    const d: Device = {
      id, name: `Новый ${meta.label.toLowerCase()}`,
      kind, x, y,
      ports: defaultPortsFor(kind),
      display: 'compact',
      ...(kind === 'vm' ? { vmInfo: { vcpu: 2, ramGb: 4, os: 'Linux' } } : {})
    };
    addDevice(d);
    select(id);
  }

  return (
    <aside style={{
      width: 56,
      background: '#F9FAFB',
      borderRight: '1px solid #E5E7EB',
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto', flexShrink: 0,
    }}>
      {SECTIONS.map((section, si) => (
        <div key={section.title} style={{
          borderTop: si === 0 ? 'none' : '1px solid #E5E7EB33',
          padding: '4px 0'
        }}>
          <div title={section.title} style={{
            fontSize: 8, opacity: 0.4, textAlign: 'center', letterSpacing: 0.5,
            padding: '4px 2px 2px', fontWeight: 700, textTransform: 'uppercase'
          }}>
            {section.title}
          </div>
          {section.items.map(item => (
            <PaletteButton key={item.kind}
                           kind={item.kind}
                           label={item.label}
                           hint={item.hint}
                           onClick={() => createOne(item.kind)} />
          ))}
        </div>
      ))}

      <div style={{ flex: 1 }} />

      <div style={{ borderTop: '1px solid #E5E7EB33', padding: '4px 0' }}>
        <GroupButton />
      </div>
    </aside>
  );
}

function PaletteButton({ kind, label, hint, onClick }: {
  kind: DeviceKind; label: string; hint?: string; onClick: () => void;
}) {
  const meta = KIND_META[kind];
  const Icon = ICONS[kind];

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-netmap-kind', kind);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onClick}
      title={`${label}${hint ? ' — ' + hint : ''}\n(перетащите или кликните)`}
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 2, padding: '6px 2px', margin: '2px 4px',
        borderRadius: 6, cursor: 'grab',
        background: '#FFFFFF', border: '1px solid transparent',
        transition: 'all 0.12s',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.background = meta.bg;
        el.style.borderColor = meta.color + '66';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.background = '#FFFFFF';
        el.style.borderColor = 'transparent';
      }}
    >
      <div style={{ color: meta.color, display: 'flex' }}><Icon size={22} /></div>
      <div style={{ fontSize: 8, color: '#111827', textAlign: 'center', lineHeight: 1.1, opacity: 0.85 }}>
        {label}
      </div>
    </div>
  );
}

function GroupButton() {
  const addGroup = useStore(s => s.addGroup);
  const selectGroup = useStore(s => s.selectGroup);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-netmap-kind', '__group__');
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => {
        const id = `group-${Math.random().toString(36).slice(2, 7)}`;
        addGroup({
          id, name: 'Новая группа',
          x: 200, y: 200, width: 480, height: 320,
          color: '#0D9488', collapsed: false, parentId: null
        });
        selectGroup(id);
      }}
      title="Группа/зона (Site, Room, Rack)"
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 2, padding: '6px 2px', margin: '2px 4px',
        borderRadius: 6, cursor: 'grab',
        background: '#FFFFFF', border: '1px dashed #0D9488aa',
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      </svg>
      <div style={{ fontSize: 8, color: '#111827', textAlign: 'center' }}>Группа</div>
    </div>
  );
}
