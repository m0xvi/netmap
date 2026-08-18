/**
 * VlansPanel — manages the project-scoped VLAN dictionary (schema v3).
 * Opened from the ActivityBar left rail. Each VLAN has:
 *   - VLAN ID (1..4094)
 *   - name
 *   - color badge
 *   - CIDR + gateway
 *   - description
 *
 * Inline-edit rows, add via a compact form at the top.
 */

import { useState } from 'react';
import { useStore } from './store';
import type { Vlan } from './types';
import { VLAN_COLORS, vlanColorForIndex } from './vlanDefaults';
import { confirmDialog } from './Modal';

export function VlansPanel() {
  const doc = useStore(s => s.doc);
  const addVlan = useStore(s => s.addVlan);
  const updateVlan = useStore(s => s.updateVlan);
  const removeVlan = useStore(s => s.removeVlan);
  const filterVlan = useStore(s => s.filters.vlan);
  const setVlanFilter = useStore(s => s.setVlanFilter);
  const vlans = doc.vlans || [];

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Count VLAN usage across ports + links to warn on delete.
  function usageCount(vlanId: number): number {
    let n = 0;
    for (const d of doc.devices) {
      for (const p of d.ports) {
        if (p.vlan === vlanId) n++;
        if (p.vlans?.includes(vlanId)) n++;
      }
    }
    for (const l of doc.links) {
      if (l.vlan === vlanId) n++;
      if (l.vlans?.includes(vlanId)) n++;
    }
    return n;
  }

  async function onDelete(v: Vlan) {
    const uses = usageCount(v.vlanId);
    const detail = uses > 0
      ? `VLAN ${v.vlanId} назначен на ${uses} портах/линках. Ссылки будут очищены.`
      : undefined;
    if (await confirmDialog(`Удалить VLAN ${v.vlanId} · ${v.name}?`, detail, { danger: true, okText: 'Удалить' })) {
      removeVlan(v.id);
    }
  }

  return (
    <div style={{ padding: 14, overflowY: 'auto', height: '100%', color: '#111827' }}>
      <div style={sectionHeader}>
        VLAN проекта
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6B7280', fontWeight: 400 }}>
          {vlans.length} шт
        </span>
      </div>

      <button onClick={() => setShowAddForm(v => !v)} style={addBtn}>
        {showAddForm ? '× Отменить' : '+ Добавить VLAN'}
      </button>

      {showAddForm && (
        <AddForm
          onCancel={() => setShowAddForm(false)}
          onAdd={(v) => { addVlan(v); setShowAddForm(false); setExpandedId(v.id); }}
          existingIds={vlans.map(v => v.vlanId)}
          nextColor={vlanColorForIndex(vlans.length)}
        />
      )}

      <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
        {vlans.length === 0 && (
          <div style={emptyState}>
            Ещё нет VLAN. Добавьте первый или используйте шаблон в проекте.
          </div>
        )}
        {[...vlans].sort((a, b) => a.vlanId - b.vlanId).map(v => {
          const isExpanded = expandedId === v.id;
          const uses = usageCount(v.vlanId);
          return (
            <div key={v.id} style={{
              background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8,
              overflow: 'hidden',
            }}>
              {/* Row header — always visible */}
              <div
                onClick={() => setExpandedId(isExpanded ? null : v.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px', cursor: 'pointer',
                }}
              >
                <VlanBadge id={v.vlanId} color={v.color} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#111827',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {v.name}
                  </div>
                  <div style={{ fontSize: 10, color: '#6B7280', fontFamily: 'ui-monospace, monospace' }}>
                    {v.cidr || '—'}
                  </div>
                </div>
                {uses > 0 && (
                  <span title={`Используется на ${uses} портах/линках`} style={usesBadge}>
                    {uses}
                  </span>
                )}
                {/* Eye toggle — filter canvas to this VLAN only */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setVlanFilter(filterVlan === v.vlanId ? null : v.vlanId);
                  }}
                  title={filterVlan === v.vlanId
                    ? `Показать все VLAN (сейчас только ${v.vlanId})`
                    : `Показать на канвасе только VLAN ${v.vlanId}`}
                  style={{
                    background: filterVlan === v.vlanId ? v.color : 'transparent',
                    color: filterVlan === v.vlanId ? '#FFFFFF' : '#9CA3AF',
                    border: `1px solid ${filterVlan === v.vlanId ? v.color : '#E5E7EB'}`,
                    borderRadius: 4, padding: 3, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
                <span style={{ fontSize: 12, color: '#9CA3AF', marginLeft: 4 }}>
                  {isExpanded ? '▾' : '▸'}
                </span>
              </div>

              {/* Editable body */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid #F3F4F6', padding: 10, display: 'grid', gap: 8 }}>
                  <Field label="Название">
                    <input value={v.name}
                           onChange={e => updateVlan(v.id, { name: e.target.value })}
                           style={inp} />
                  </Field>
                  <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8 }}>
                    <Field label="VLAN ID">
                      <input type="number" min={1} max={4094} value={v.vlanId}
                             onChange={e => updateVlan(v.id, { vlanId: parseInt(e.target.value, 10) || v.vlanId })}
                             style={inp} />
                    </Field>
                    <Field label="Цвет">
                      <ColorPicker value={v.color} onChange={c => updateVlan(v.id, { color: c })} />
                    </Field>
                  </div>
                  <Field label="CIDR (подсеть)">
                    <input value={v.cidr || ''} placeholder="192.168.10.0/24"
                           onChange={e => updateVlan(v.id, { cidr: e.target.value || undefined })}
                           style={{ ...inp, fontFamily: 'ui-monospace, monospace' }} />
                  </Field>
                  <Field label="Шлюз">
                    <input value={v.gateway || ''} placeholder="192.168.10.1"
                           onChange={e => updateVlan(v.id, { gateway: e.target.value || undefined })}
                           style={{ ...inp, fontFamily: 'ui-monospace, monospace' }} />
                  </Field>
                  <Field label="Описание">
                    <textarea value={v.description || ''} rows={2}
                              onChange={e => updateVlan(v.id, { description: e.target.value || undefined })}
                              style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
                  </Field>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
                    <button onClick={() => onDelete(v)} style={btnDanger}>Удалить VLAN</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Sub-components ----------

function AddForm({ onCancel, onAdd, existingIds, nextColor }: {
  onCancel: () => void;
  onAdd: (v: Vlan) => void;
  existingIds: number[];
  nextColor: string;
}) {
  const [vlanId, setVlanId] = useState<number>(() => {
    for (let i = 10; i <= 4094; i += 10) if (!existingIds.includes(i)) return i;
    return 10;
  });
  const [name, setName] = useState('');
  const [cidr, setCidr] = useState('');
  const [color, setColor] = useState(nextColor);
  const isDup = existingIds.includes(vlanId);
  const canAdd = !!name.trim() && vlanId >= 1 && vlanId <= 4094 && !isDup;

  function submit() {
    if (!canAdd) return;
    const id = `vlan-${Math.random().toString(36).slice(2, 7)}`;
    onAdd({
      id, vlanId, color,
      name: name.trim().toUpperCase(),
      cidr: cidr.trim() || undefined,
    });
  }

  return (
    <div style={{
      marginTop: 10, padding: 10,
      background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8,
      display: 'grid', gap: 8,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8 }}>
        <Field label="ID">
          <input type="number" min={1} max={4094} value={vlanId}
                 onChange={e => setVlanId(parseInt(e.target.value, 10) || 0)}
                 style={{ ...inp, borderColor: isDup ? '#EF4444' : '#D1D5DB' }} />
        </Field>
        <Field label="Название">
          <input value={name} placeholder="CORPORATE"
                 onChange={e => setName(e.target.value)}
                 onKeyDown={e => e.key === 'Enter' && submit()}
                 autoFocus style={inp} />
        </Field>
      </div>
      <Field label="CIDR (необяз.)">
        <input value={cidr} placeholder="192.168.10.0/24"
               onChange={e => setCidr(e.target.value)}
               style={{ ...inp, fontFamily: 'ui-monospace, monospace' }} />
      </Field>
      <Field label="Цвет">
        <ColorPicker value={color} onChange={setColor} />
      </Field>
      {isDup && (
        <div style={{ color: '#DC2626', fontSize: 11 }}>
          VLAN {vlanId} уже существует в проекте
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={btnSecondary}>Отмена</button>
        <button onClick={submit} disabled={!canAdd}
                style={{ ...btnPrimary, opacity: canAdd ? 1 : 0.5, cursor: canAdd ? 'pointer' : 'not-allowed' }}>
          Добавить
        </button>
      </div>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {VLAN_COLORS.map(c => (
        <button key={c} onClick={() => onChange(c)}
                title={c}
                style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: c, cursor: 'pointer',
                  border: value === c ? '2px solid #111827' : '2px solid transparent',
                  padding: 0,
                }} />
      ))}
    </div>
  );
}

/**
 * Compact numeric badge used both here and in the Inspector — pill-shaped,
 * VLAN color as background tint, white text.
 */
export function VlanBadge({ id, color, size = 'md' }: { id: number; color: string; size?: 'sm' | 'md' }) {
  const dim = size === 'sm'
    ? { padding: '1px 6px', fontSize: 10, minWidth: 22 }
    : { padding: '2px 8px', fontSize: 11, minWidth: 28 };
  return (
    <span style={{
      ...dim, display: 'inline-block', textAlign: 'center',
      background: color, color: '#FFFFFF',
      borderRadius: 999, fontWeight: 700, letterSpacing: 0.3,
      fontFamily: 'ui-monospace, monospace',
      boxShadow: `0 0 0 2px ${color}22`,
    }}>
      {id}
    </span>
  );
}

// ---------- Styles ----------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const sectionHeader: React.CSSProperties = {
  fontSize: 12, color: '#6B7280', marginBottom: 10,
  fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
  display: 'flex', alignItems: 'center',
};

const inp: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #D1D5DB',
  color: '#111827', padding: '6px 8px', borderRadius: 6,
  fontSize: 12, outline: 'none', width: '100%',
};

const addBtn: React.CSSProperties = {
  width: '100%', background: '#2563EB', color: '#FFFFFF',
  border: 'none', borderRadius: 8, padding: '8px 12px',
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
};

const usesBadge: React.CSSProperties = {
  background: '#EFF6FF', color: '#2563EB', border: '1px solid #DBEAFE',
  fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
};

const btnPrimary: React.CSSProperties = {
  background: '#2563EB', border: 'none', color: '#FFFFFF',
  padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
};
const btnSecondary: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#374151',
  padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 500,
};
const btnDanger: React.CSSProperties = {
  background: '#FEE2E2', border: '1px solid #FECACA', color: '#B91C1C',
  padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500,
};
const emptyState: React.CSSProperties = {
  padding: '20px 12px', textAlign: 'center',
  color: '#9CA3AF', fontSize: 12,
  background: '#F9FAFB', border: '1px dashed #E5E7EB', borderRadius: 8,
};
