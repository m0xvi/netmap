import { useMemo } from 'react';
import { useStore } from './store';
import { confirmDialog } from './Modal';

const COLORS = ['#0D9488', '#60a5fa', '#f59e0b', '#f472b6', '#a78bfa', '#f87171', '#34d399', '#fbbf24', '#94a3b8'];

export function GroupPanel() {
  const selectedGroupId = useStore(s => s.selectedGroupId);
  const doc = useStore(s => s.doc);
  const updateGroup = useStore(s => s.updateGroup);
  const removeGroup = useStore(s => s.removeGroup);
  const updateDevice = useStore(s => s.updateDevice);

  const group = useMemo(
    () => (doc.groups || []).find(g => g.id === selectedGroupId) || null,
    [selectedGroupId, doc.groups]
  );

  if (!group) return null;

  const children = doc.devices.filter(d => d.groupId === group.id);

  return (
    <aside style={panelStyle}>
      <div style={{ padding: 14, borderBottom: '1px solid #E5E7EB' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6B7280"
               strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 3 }}>
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          <input
            value={group.name}
            onChange={e => updateGroup(group.id, { name: e.target.value })}
            style={{ ...inputStyle, fontSize: 15, fontWeight: 600, flex: 1 }}
          />
          <button onClick={async () => {
                    if (children.length === 0) {
                      removeGroup(group.id, { deleteChildren: false });
                      return;
                    }
                    const alsoDelete = await confirmDialog(
                      `Удалить группу «${group.name}»?`,
                      `В группе ${children.length} устройств. Хотите удалить и их?`,
                      { danger: true, okText: 'Удалить всё', cancelText: 'Только группу' }
                    );
                    removeGroup(group.id, { deleteChildren: alsoDelete });
                  }}
                  style={btnDanger}>✕</button>
        </div>
      </div>

      <div style={{ padding: 12, display: 'grid', gap: 12, overflowY: 'auto', flex: 1 }}>
        <Field label="Подпись (subtitle)">
          <input value={group.subtitle || ''}
                 onChange={e => updateGroup(group.id, { subtitle: e.target.value })}
                 placeholder={`${children.length} устр.`}
                 style={inputStyle} />
        </Field>

        <Field label="Цвет">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {COLORS.map(c => (
              <button key={c}
                      onClick={() => updateGroup(group.id, { color: c })}
                      style={{
                        width: 24, height: 24, borderRadius: 6,
                        background: c,
                        border: group.color === c ? '2px solid #fff' : '2px solid transparent',
                        cursor: 'pointer'
                      }} />
            ))}
          </div>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Ширина">
            <input type="number" value={group.width}
                   onChange={e => updateGroup(group.id, { width: Math.max(120, +e.target.value) })}
                   style={inputStyle} />
          </Field>
          <Field label="Высота">
            <input type="number" value={group.height}
                   onChange={e => updateGroup(group.id, { height: Math.max(80, +e.target.value) })}
                   style={inputStyle} />
          </Field>
        </div>

        <button style={btnSecondary}
                onClick={() => updateGroup(group.id, { collapsed: !group.collapsed })}>
          {group.collapsed ? '▶ Развернуть' : '▼ Свернуть'}
        </button>

        <div>
          <div style={{ fontSize: 10, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            Устройства внутри ({children.length})
          </div>
          <div style={{ display: 'grid', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
            {children.length === 0 && (
              <div style={{ color: '#9CA3AF', fontSize: 12, padding: 8 }}>
                Пусто. Перетащите устройства мышью внутрь рамки — они «прилипнут».
              </div>
            )}
            {children.map(d => (
              <div key={d.id} style={rowStyle}>
                <span style={{ flex: 1, fontSize: 12 }}>{d.name}</span>
                <span style={{ fontSize: 10, opacity: 0.6 }}>{d.kind}</span>
                <button style={btnDangerSmall}
                        onClick={() => {
                          // detach: convert relative coords to absolute
                          updateDevice(d.id, {
                            groupId: null,
                            x: d.x + group.x,
                            y: d.y + group.y
                          });
                        }}
                        title="Вынуть из группы">⇱</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 10, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      {children}
    </label>
  );
}

const panelStyle: React.CSSProperties = {
  width: 340, background: '#F9FAFB', borderLeft: '1px solid #E5E7EB',
  display: 'flex', flexDirection: 'column', height: '100%'
};
const inputStyle: React.CSSProperties = {
  background: '#F9FAFB', border: '1px solid #D1D5DB', color: '#111827',
  padding: '6px 8px', borderRadius: 6, fontSize: 12, outline: 'none', width: '100%'
};
const rowStyle: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'center',
  background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6, padding: '4px 8px'
};
const btnSecondary: React.CSSProperties = {
  background: '#E5E7EB', border: '1px solid #D1D5DB', color: '#111827',
  padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12
};
const btnDanger: React.CSSProperties = {
  background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#B91C1C',
  padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12
};
const btnDangerSmall: React.CSSProperties = { ...btnDanger, padding: '2px 6px' };
