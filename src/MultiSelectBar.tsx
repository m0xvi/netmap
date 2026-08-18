import { useMemo, useState } from 'react';
import { useStore } from './store';
import { promptText, confirmDialog } from './Modal';
import type { Group, Vlan } from './types';

// Stable empty ref shared across renders so zustand's Object.is check stays true
// when the project has no VLANs — otherwise infinite render loop (React #185).
const EMPTY_VLANS_MSB: readonly Vlan[] = Object.freeze([]);

/**
 * Floating action bar for bulk operations on multiple selected devices.
 * Appears when 2+ devices are selected (Ctrl/Shift+click or box selection).
 */
export function MultiSelectBar() {
  const ids = useStore(s => s.multiSelectedIds);
  const doc = useStore(s => s.doc);
  const updateDevice = useStore(s => s.updateDevice);
  const removeDevice = useStore(s => s.removeDevice);
  const togglePoeAll = useStore(s => s.togglePoeAll);
  const setMultiSelection = useStore(s => s.setMultiSelection);

  if (ids.size < 2) return null;

  const selected = doc.devices.filter(d => ids.has(d.id));
  const groups = doc.groups || [];

  const bulkAddTag = async () => {
    const t = await promptText('Добавить тег ко всем выбранным', '', 'Можно несколько через запятую');
    if (!t) return;
    const newTags = t.split(',').map(s => s.trim()).filter(Boolean);
    selected.forEach(d => {
      const merged = Array.from(new Set([...(d.tags || []), ...newTags]));
      updateDevice(d.id, { tags: merged });
    });
  };

  const bulkMoveToGroup = (groupId: string | null) => {
    selected.forEach(d => {
      const oldGroup = groups.find(g => g.id === d.groupId);
      const newGroup = groupId ? groups.find(g => g.id === groupId) : null;
      // Convert relative <-> absolute so the on-screen position stays consistent
      let x = d.x, y = d.y;
      if (oldGroup) { x += oldGroup.x; y += oldGroup.y; }
      if (newGroup) { x -= newGroup.x; y -= newGroup.y; }
      updateDevice(d.id, { x, y, groupId });
    });
  };

  const bulkTogglePoe = () => {
    selected.forEach(d => togglePoeAll(d.id));
  };

  const bulkDelete = async () => {
    if (!await confirmDialog(`Удалить ${ids.size} устройств?`, 'Это действие можно отменить (Ctrl+Z).', { danger: true, okText: 'Удалить' })) return;
    setMultiSelection([]);
    // v0.34.2: also tell React Flow to clear its internal selection so the
    // node styles reset without a bulk-selected → clear ping-pong that used
    // to trigger React error #185.
    window.dispatchEvent(new CustomEvent('netmap:clear-rf-selection'));
    const toRemove = Array.from(ids);
    toRemove.forEach(id => removeDevice(id));
  };

  const clearSelection = () => {
    setMultiSelection([]);
    // Same reason as above — must also clear React Flow's internal state.
    window.dispatchEvent(new CustomEvent('netmap:clear-rf-selection'));
  };

  return (
    <div style={{
      position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)',
      zIndex: 25,
      background: 'rgba(255,255,255,0.95)',
      border: '1px solid #2563EB88',
      borderRadius: 10,
      padding: '10px 14px',
      color: '#111827', fontSize: 12,
      boxShadow: '0 4px 20px rgba(15,23,42,0.15)',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span style={{
        background: '#2563EB', color: '#fff', padding: '3px 10px', borderRadius: 12,
        fontSize: 11, fontWeight: 600,
      }}>{ids.size} выбрано</span>

      <button onClick={bulkAddTag} style={btn()}>🏷 Тег</button>

      {/* Move to group */}
      <div style={{ position: 'relative' }}>
        <GroupSelect groups={groups} onPick={bulkMoveToGroup} />
      </div>

      <button onClick={bulkTogglePoe} style={btn()}>⚡ Toggle PoE</button>

      <BulkVlanSelect selectedIds={ids} />

      <button onClick={bulkDelete} style={btn('#FEE2E2', '#FCA5A5', '#B91C1C')}>🗑 Удалить</button>

      <button onClick={clearSelection} style={btn()}>✕</button>
    </div>
  );
}

function GroupSelect({ groups, onPick }: { groups: Group[]; onPick: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(v => !v)} style={btn()}>В группу ▾</button>
      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
          background: '#F9FAFB', border: '1px solid #D1D5DB', borderRadius: 6,
          padding: '4px 0', minWidth: 160,
          boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
        }}>
          <div onClick={() => { onPick(null); setOpen(false); }} style={item}>
            <span style={{ opacity: 0.6 }}>—</span> Вынести из группы
          </div>
          <div style={{ height: 1, background: '#E5E7EB', margin: '4px 0' }} />
          {groups.length === 0 && (
            <div style={{ ...item, opacity: 0.5, cursor: 'default' }}>Групп нет</div>
          )}
          {groups.map(g => (
            <div key={g.id} onClick={() => { onPick(g.id); setOpen(false); }} style={item}>
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                background: g.color || '#0D9488', marginRight: 6,
              }} />
              {g.name}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function btn(bg = '#E5E7EB', border = '#D1D5DB', color = '#111827'): React.CSSProperties {
  return {
    background: bg, border: `1px solid ${border}`, color,
    padding: '5px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 11,
  };
}
const item: React.CSSProperties = {
  padding: '6px 10px', fontSize: 11, cursor: 'pointer', color: '#111827',
};

/**
 * Bulk apply an access VLAN to every port of every selected device.
 * Useful for: "select all cameras → assign VLAN 50 (CCTV)".
 */
function BulkVlanSelect({ selectedIds }: { selectedIds: Set<string> }) {
  const [open, setOpen] = useState(false);
  const vlans = useStore(s => s.doc.vlans) || EMPTY_VLANS_MSB;
  const doc = useStore(s => s.doc);
  const updateDevice = useStore(s => s.updateDevice);

  const apply = async (vlanId: number | null) => {
    setOpen(false);
    const label = vlanId == null
      ? 'Снять VLAN со всех портов'
      : `Назначить VLAN ${vlanId} на все порты выделенных устройств?`;
    const detail = vlanId == null
      ? 'Со всех портов у выделенных устройств будет удалён access VLAN.'
      : `Access VLAN портов будет установлен на ${vlanId}. Trunk-настройки (список vlans) не затрагиваются.`;
    if (!await confirmDialog(label, detail, { okText: 'Применить' })) return;

    const targets = doc.devices.filter(d => selectedIds.has(d.id));
    for (const d of targets) {
      updateDevice(d.id, {
        ports: d.ports.map(p => ({ ...p, vlan: vlanId ?? undefined })),
      });
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(v => !v)} style={btnStyle()}>VLAN ▾</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)}
               style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
          <div style={{
            position: 'absolute', bottom: '100%', left: 0, marginBottom: 4, zIndex: 40,
            background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 6,
            padding: '4px 0', minWidth: 200, maxHeight: 300, overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
          }}>
            <div onClick={() => apply(null)} style={vlanItem}>
              <span style={{ color: '#9CA3AF' }}>—</span> Снять VLAN
            </div>
            {vlans.length === 0 && (
              <div style={{ ...vlanItem, color: '#9CA3AF', cursor: 'default' }}>
                В проекте нет VLAN
              </div>
            )}
            {vlans.map(v => (
              <div key={v.id} onClick={() => apply(v.vlanId)} style={vlanItem}>
                <span style={{
                  display: 'inline-block',
                  background: v.color, color: '#FFFFFF',
                  fontSize: 9, fontWeight: 800,
                  padding: '1px 5px', borderRadius: 999,
                  fontFamily: 'ui-monospace, monospace',
                  minWidth: 22, textAlign: 'center', marginRight: 6,
                }}>{v.vlanId}</span>
                {v.name}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const vlanItem: React.CSSProperties = {
  padding: '6px 10px', fontSize: 11, cursor: 'pointer', color: '#111827',
  display: 'flex', alignItems: 'center',
};

// small alias to reuse btn() from above
function btnStyle(bg = '#E5E7EB', border = '#D1D5DB', color = '#111827'): React.CSSProperties {
  return {
    background: bg, border: `1px solid ${border}`, color,
    padding: '5px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 11,
  };
}
