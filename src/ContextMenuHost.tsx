import { useStore } from './store';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { promptText, confirmDialog, alertDialog } from './Modal';
import type { StickyColor, NetworkLayer } from './types';
import { inferLayer, LAYER_META } from './layers';

const STICKY_COLOR_META: Record<StickyColor, { emoji: string; label: string }> = {
  yellow: { emoji: '🟡', label: 'Жёлтая' },
  green:  { emoji: '🟢', label: 'Зелёная' },
  blue:   { emoji: '🔵', label: 'Синяя' },
  pink:   { emoji: '🩷', label: 'Розовая' },
};

export function ContextMenuHost() {
  const ctx = useStore(s => s.contextMenu);
  const close = useStore(s => s.closeContextMenu);
  const doc = useStore(s => s.doc);
  const updateDevice = useStore(s => s.updateDevice);
  const removeDevice = useStore(s => s.removeDevice);
  const duplicateDevice = useStore(s => s.duplicateDevice);
  const togglePoeAll = useStore(s => s.togglePoeAll);
  const updateGroup = useStore(s => s.updateGroup);
  const removeGroup = useStore(s => s.removeGroup);
  const addSticky = useStore(s => s.addSticky);
  const updateSticky = useStore(s => s.updateSticky);
  const removeSticky = useStore(s => s.removeSticky);
  const updatePort = useStore(s => s.updatePort);
  const removePort = useStore(s => s.removePort);
  const selectPort = useStore(s => s.selectPort);
  const select = useStore(s => s.select);

  if (!ctx) return null;

  let items: MenuItem[] = [];

  const target = ctx.target;
  if (target.type === 'device') {
    const dev = doc.devices.find(x => x.id === target.id);
    if (!dev) { close(); return null; }
    const isExpanded = dev.display === 'rack';
    const anyPoe = dev.ports.some(p => p.poe);
    const linksCount = doc.links.filter(l => l.fromDeviceId === dev.id || l.toDeviceId === dev.id).length;

    const addNoteWithColor = (color: StickyColor) => {
      const id = addSticky(dev.id, 'Новая заметка…', color);
      // notify StickyStack to run the pop-in animation
      window.dispatchEvent(new CustomEvent('netmap:sticky-added', { detail: { deviceId: dev.id, id } }));
    };

    items = [
      { label: `${dev.name}`, icon: '📎', disabled: true },
      { separator: true, label: '' },
      { label: 'Открыть свойства', icon: '⚙️', action: () => select(dev.id) },
      {
        label: isExpanded ? 'Свернуть' : 'Развернуть (порты)',
        icon: isExpanded ? '◲' : '◱',
        action: () => updateDevice(dev.id, { display: isExpanded ? 'compact' : 'rack' })
      },
      {
        label: 'Добавить заметку',
        icon: '📌',
        submenu: [
          { label: '🟡 Жёлтая',  action: () => addNoteWithColor('yellow') },
          { label: '🟢 Зелёная', action: () => addNoteWithColor('green')  },
          { label: '🔵 Синяя',   action: () => addNoteWithColor('blue')   },
          { label: '🩷 Розовая', action: () => addNoteWithColor('pink')   },
        ]
      },
      { label: 'Переименовать', icon: '✏️', action: async () => {
          const name = await promptText('Переименовать устройство', dev.name);
          if (name && name.trim()) updateDevice(dev.id, { name: name.trim() });
      }},
      { label: 'Дублировать', icon: '⧉', action: () => duplicateDevice(dev.id) },
      {
        label: `Уровень: ${LAYER_META[inferLayer(dev)].emoji} ${LAYER_META[inferLayer(dev)].label}${dev.layer ? '' : ' (авто)'}`,
        icon: '🏛',
        submenu: [
          {
            label: `🤖 Авто (сейчас ${LAYER_META[inferLayer({ ...dev, layer: undefined })].label})`,
            disabled: !dev.layer,
            action: () => updateDevice(dev.id, { layer: undefined }),
          },
          { separator: true, label: '' },
          ...(['core','distribution','access'] as NetworkLayer[]).map(l => ({
            label: `${LAYER_META[l].emoji} ${LAYER_META[l].label} — ${LAYER_META[l].description}`,
            disabled: dev.layer === l,
            action: () => updateDevice(dev.id, { layer: l }),
          })),
        ],
      },
      { separator: true, label: '' },
      ...(POE_APPLICABLE[dev.kind] ? [{
        label: anyPoe ? 'Убрать метку PoE' : 'Пометить как PoE',
        icon: '⚡',
        action: () => togglePoeAll(dev.id)
      }] : []),
      ...(dev.ip ? [{
        label: `Копировать IP · ${dev.ip}`,
        icon: '📋',
        action: () => navigator.clipboard.writeText(dev.ip!)
      }] : []),
      { label: `Копировать имя · ${dev.name}`, icon: '📋',
        action: () => navigator.clipboard.writeText(dev.name) },
      ...(dev.mgmtUrl ? [{
        label: 'Открыть mgmt URL',
        icon: '↗',
        action: () => window.open(dev.mgmtUrl, '_blank')
      }] : []),
      ...(dev.credential?.bitwardenUrl ? [{
        label: 'Открыть в Bitwarden',
        icon: '🔐',
        action: () => window.open(dev.credential!.bitwardenUrl, '_blank')
      }] : []),
      { separator: true, label: '' },
      {
        label: `Удалить (кабелей: ${linksCount})`,
        icon: '🗑️', danger: true,
        action: async () => {
          if (await confirmDialog(`Удалить ${dev.name}?`,
              linksCount ? `Также отключится ${linksCount} кабелей.` : undefined,
              { danger: true, okText: 'Удалить' }))
            removeDevice(dev.id);
        }
      },
    ];
  }

  if (target.type === 'group') {
    const g = doc.groups?.find(x => x.id === target.id);
    if (!g) { close(); return null; }
    const childCount = doc.devices.filter(d => d.groupId === g.id).length;
    items = [
      { label: g.name, disabled: true },
      { separator: true, label: '' },
      {
        label: g.collapsed ? 'Развернуть' : 'Свернуть',
        icon: g.collapsed ? '▶' : '▼',
        action: () => updateGroup(g.id, { collapsed: !g.collapsed })
      },
      { label: 'Переименовать', icon: '✏️', action: async () => {
          const name = await promptText('Переименовать группу', g.name);
          if (name && name.trim()) updateGroup(g.id, { name: name.trim() });
      }},
      { separator: true, label: '' },
      { label: `Удалить группу (детей: ${childCount})`, icon: '🗑️', danger: true, action: async () => {
          if (childCount === 0 || await confirmDialog(
              `Удалить группу «${g.name}»?`,
              `В группе ${childCount} устройств. Устройства останутся на канвасе.`,
              { danger: true, okText: 'Удалить группу' })) {
            removeGroup(g.id, { deleteChildren: false });
          }
      }},
      ...(childCount > 0 ? [{
        label: 'Удалить группу И устройства', icon: '💥', danger: true, action: async () => {
          if (await confirmDialog(
              `Удалить всё содержимое группы «${g.name}»?`,
              `Будет удалено ${childCount} устройств вместе с группой. Это можно отменить через Ctrl+Z.`,
              { danger: true, okText: 'Удалить всё' }))
            removeGroup(g.id, { deleteChildren: true });
        }
      }] : []),
    ];
  }

  // ---------- STICKY NOTE ----------
  if (target.type === 'sticky') {
    const note = (doc.stickies || []).find(n => n.id === target.id);
    if (!note) { close(); return null; }

    items = [
      { label: '📌 Заметка', disabled: true },
      { separator: true, label: '' },
      {
        label: 'Сменить цвет',
        icon: '🎨',
        submenu: (Object.keys(STICKY_COLOR_META) as StickyColor[]).map(c => ({
          label: `${STICKY_COLOR_META[c].emoji} ${STICKY_COLOR_META[c].label}${c === note.color ? ' · сейчас' : ''}`,
          disabled: c === note.color,
          action: () => updateSticky(note.id, { color: c }),
        })),
      },
      {
        label: 'Дублировать',
        icon: '⧉',
        action: () => {
          const newId = addSticky(note.deviceId, note.text, note.color);
          window.dispatchEvent(new CustomEvent('netmap:sticky-added',
            { detail: { deviceId: note.deviceId, id: newId } }));
        }
      },
      {
        label: note.collapsed ? 'Развернуть' : 'Свернуть в свиток',
        icon: note.collapsed ? '📄' : '📜',
        action: () => updateSticky(note.id, { collapsed: !note.collapsed }),
      },
      { separator: true, label: '' },
      {
        label: 'Убрать заметку', icon: '🗑️', danger: true,
        action: () => removeSticky(note.id),
      },
    ];
  }

  // ---------- PORT ----------
  if (target.type === 'port') {
    const dev = doc.devices.find(d => d.id === target.deviceId);
    const port = dev?.ports.find(p => p.id === target.portId);
    if (!dev || !port) { close(); return null; }

    const linksOnPort = doc.links.filter(l =>
      (l.fromDeviceId === dev.id && l.fromPortId === port.id) ||
      (l.toDeviceId === dev.id && l.toPortId === port.id)
    );

    items = [
      { label: `🔌 ${dev.name} · ${port.id.toUpperCase()}`, disabled: true },
      { separator: true, label: '' },
      {
        label: 'Открыть свойства порта',
        icon: '⚙️',
        action: () => selectPort(dev.id, port.id),
      },
      {
        label: 'Статус',
        icon: port.status === 'up' ? '🟢' : port.status === 'error' ? '🔴' : port.status === 'disabled' ? '⚫' : '⚪',
        submenu: [
          { label: '🟢 UP',      disabled: port.status === 'up',       action: () => updatePort(dev.id, port.id, { status: 'up' }) },
          { label: '⚪ DOWN',    disabled: port.status === 'down' || !port.status, action: () => updatePort(dev.id, port.id, { status: 'down' }) },
          { label: '⚫ DISABLED', disabled: port.status === 'disabled', action: () => updatePort(dev.id, port.id, { status: 'disabled' }) },
          { label: '🔴 ERROR',   disabled: port.status === 'error',    action: () => updatePort(dev.id, port.id, { status: 'error' }) },
        ],
      },
      {
        label: port.poeActive ? 'PoE активен ⚡ — выключить' : 'Включить PoE ⚡',
        icon: '⚡',
        action: () => updatePort(dev.id, port.id, {
          poeActive: !port.poeActive,
          poe: !port.poeActive || port.poe,
        }),
      },
      {
        label: port.uplink ? 'Снять флаг uplink' : 'Пометить как uplink',
        icon: '↑',
        action: () => updatePort(dev.id, port.id, { uplink: !port.uplink }),
      },
      {
        label: port.vlan != null ? `VLAN ${port.vlan} · изменить` : 'Задать VLAN',
        icon: '🏷',
        action: async () => {
          const raw = await promptText(
            port.vlan != null ? 'Изменить VLAN' : 'Задать VLAN',
            port.vlan?.toString() || '',
            'Номер VLAN (1..4094) или пусто чтобы снять'
          );
          if (raw === null) return;
          const trimmed = raw.trim();
          if (trimmed === '') {
            updatePort(dev.id, port.id, { vlan: undefined });
          } else {
            const n = parseInt(trimmed, 10);
            if (Number.isFinite(n) && n >= 1 && n <= 4094)
              updatePort(dev.id, port.id, { vlan: n });
            else await alertDialog('Некорректный VLAN', 'VLAN должен быть числом от 1 до 4094.');
          }
        },
      },
      { separator: true, label: '' },
      ...(port.label ? [{
        label: `Копировать "${port.label.length > 22 ? port.label.slice(0, 22) + '…' : port.label}"`,
        icon: '📋',
        action: () => navigator.clipboard.writeText(port.label!),
      }] : []),
      {
        label: 'Переименовать / описание',
        icon: '✏️',
        action: async () => {
          const raw = await promptText(
            `Описание порта ${port.id.toUpperCase()}`,
            port.label || '',
            'Что подключено к этому порту'
          );
          if (raw !== null) updatePort(dev.id, port.id, { label: raw.trim() });
        },
      },
      { separator: true, label: '' },
      {
        label: `Удалить порт (кабелей: ${linksOnPort.length})`,
        icon: '🗑️', danger: true,
        action: async () => {
          if (await confirmDialog(
              `Удалить порт ${port.id}?`,
              linksOnPort.length ? `Также отключится ${linksOnPort.length} кабелей.` : undefined,
              { danger: true, okText: 'Удалить' }))
            removePort(dev.id, port.id);
        },
      },
    ];
  }

  return <ContextMenu x={ctx.x} y={ctx.y} items={items} onClose={close} />;
}

const POE_APPLICABLE: Record<string, boolean> = {
  switch: true, ap: true, camera: true, printer: true, lock: true,
};
