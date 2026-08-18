/**
 * v0.42 — DevicesTablePanel — flat searchable / sortable table of every device
 * in the current project. Shown from the new ActivityBar → Devices icon.
 *
 * Columns: type · name · IP · MAC · group · online-status
 * Actions: click row → focus on canvas + open inspector
 *          shift-click → multi-select
 *          bulk toolbar at bottom (Delete / Assign group / …)
 */

import { useMemo, useState } from 'react';
import { useStore } from './store';
import { ICONS, KIND_META } from './icons';
import type { DeviceKind } from './types';
import { confirmDialog } from './Modal';

type SortKey = 'name' | 'kind' | 'ip' | 'group' | 'status';
type SortDir = 'asc' | 'desc';

export function DevicesTablePanel() {
  const devices = useStore(s => s.doc.devices);
  const groups = useStore(s => s.doc.groups);
  const focusDevice = useStore(s => s.focusDevice);
  const select = useStore(s => s.select);
  const removeDevice = useStore(s => s.removeDevice);

  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<DeviceKind | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const groupById = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);

  // Available kinds in this project (for the filter chips)
  const kinds = useMemo(() => {
    const s = new Set<DeviceKind>();
    devices.forEach(d => s.add(d.kind));
    return Array.from(s);
  }, [devices]);

  const rows = useMemo(() => {
    let arr = devices.slice();
    if (kindFilter !== 'all') arr = arr.filter(d => d.kind === kindFilter);
    if (statusFilter === 'online')  arr = arr.filter(d => d.liveStatus !== 'down');
    if (statusFilter === 'offline') arr = arr.filter(d => d.liveStatus === 'down');
    const q = query.trim().toLowerCase();
    if (q) {
      arr = arr.filter(d =>
        d.name.toLowerCase().includes(q) ||
        (d.ip || '').toLowerCase().includes(q) ||
        (d.mac || '').toLowerCase().includes(q) ||
        (d.vendor || '').toLowerCase().includes(q) ||
        (d.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    // Sort
    arr.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'name':   return dir * a.name.localeCompare(b.name, 'ru', { numeric: true });
        case 'kind':   return dir * a.kind.localeCompare(b.kind);
        case 'ip':     return dir * (a.ip || '').localeCompare(b.ip || '', undefined, { numeric: true });
        case 'group': {
          const ga = a.groupId ? (groupById.get(a.groupId)?.name || '') : '';
          const gb = b.groupId ? (groupById.get(b.groupId)?.name || '') : '';
          return dir * ga.localeCompare(gb);
        }
        case 'status': {
          const sa = a.liveStatus === 'down' ? 1 : 0;
          const sb = b.liveStatus === 'down' ? 1 : 0;
          return dir * (sa - sb);
        }
      }
    });
    return arr;
  }, [devices, query, kindFilter, statusFilter, sortKey, sortDir, groupById]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };
  const toggleSelected = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const selectAllVisible = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map(r => r.id)));
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!(await confirmDialog(
      `Удалить ${selected.size} устройств(а)?`,
      'Также будут удалены все связи с этими устройствами. Отменить нельзя.',
      { danger: true, okText: 'Удалить' }
    ))) return;
    for (const id of selected) removeDevice(id);
    setSelected(new Set());
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header + filters */}
      <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #E5E7EB' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', marginBottom: 8, letterSpacing: 0.3 }}>
          Устройства · {rows.length} из {devices.length}
        </div>
        <input
          placeholder="🔎 поиск по имени / IP / MAC / vendor / тегу"
          value={query} onChange={(e) => setQuery(e.target.value)}
          style={inputStyle}
        />

        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
          <FilterChip active={statusFilter === 'all'}     onClick={() => setStatusFilter('all')}     label="Все" />
          <FilterChip active={statusFilter === 'online'}  onClick={() => setStatusFilter('online')}  label="🟢 Онлайн" />
          <FilterChip active={statusFilter === 'offline'} onClick={() => setStatusFilter('offline')} label="🔴 Оффлайн" />
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
          <FilterChip active={kindFilter === 'all'} onClick={() => setKindFilter('all')} label={`Все типы (${kinds.length})`} />
          {kinds.map(k => {
            const meta = KIND_META[k];
            const Ic = ICONS[k];
            const count = devices.filter(d => d.kind === k).length;
            return (
              <FilterChip key={k} active={kindFilter === k} onClick={() => setKindFilter(k)}
                          label={`${meta.label} ${count}`}
                          icon={<Ic size={10} color={meta.color} />}
                          color={meta.color} />
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: '#F8FAFC', position: 'sticky', top: 0, zIndex: 1 }}>
              <th style={{ ...th, width: 26 }}>
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selected.size === rows.length}
                  onChange={selectAllVisible}
                />
              </th>
              <SortableTh label="Тип" k="kind" cur={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortableTh label="Имя" k="name" cur={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortableTh label="IP" k="ip" cur={sortKey} dir={sortDir} onClick={toggleSort} />
              <th style={th}>MAC</th>
              <SortableTh label="Группа" k="group" cur={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortableTh label="Статус" k="status" cur={sortKey} dir={sortDir} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>
                {devices.length === 0 ? 'В проекте пока нет устройств' : 'Ничего не найдено'}
              </td></tr>
            )}
            {rows.map(d => {
              const meta = KIND_META[d.kind];
              const Ic = ICONS[d.kind];
              const online = d.liveStatus !== 'down';
              const g = d.groupId ? groupById.get(d.groupId) : null;
              return (
                <tr
                  key={d.id}
                  onClick={(e) => {
                    if (e.shiftKey) { toggleSelected(d.id); return; }
                    focusDevice(d.id);
                    select(d.id);
                    window.dispatchEvent(new CustomEvent('netmap:focus-device', { detail: { id: d.id } }));
                  }}
                  style={{
                    borderTop: '1px solid #F1F5F9', cursor: 'pointer',
                    background: selected.has(d.id) ? '#EFF6FF' : 'transparent',
                  }}
                  onMouseEnter={(e) => { if (!selected.has(d.id)) (e.currentTarget as HTMLTableRowElement).style.background = '#F8FAFC'; }}
                  onMouseLeave={(e) => { if (!selected.has(d.id)) (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'; }}
                >
                  <td style={td} onClick={(e) => { e.stopPropagation(); toggleSelected(d.id); }}>
                    <input type="checkbox" checked={selected.has(d.id)} onChange={() => {}} />
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{
                        width: 20, height: 20, borderRadius: '50%',
                        background: meta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Ic size={11} color={meta.color} />
                      </div>
                      <span style={{ fontSize: 9, color: meta.color, fontWeight: 700 }}>{meta.label}</span>
                    </div>
                  </td>
                  <td style={{ ...td, fontWeight: 600, color: '#0F172A' }}>{d.name}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace' }}>{d.ip || <span style={{ color: '#94A3B8' }}>—</span>}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', color: '#64748B' }}>{d.mac || <span style={{ color: '#CBD5E1' }}>—</span>}</td>
                  <td style={td}>{g ? <span style={{ color: g.color || '#64748B' }}>{g.name}</span> : <span style={{ color: '#CBD5E1' }}>—</span>}</td>
                  <td style={td}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 10, padding: '2px 8px', borderRadius: 999,
                      background: online ? '#F0FDF4' : '#FEF2F2',
                      color: online ? '#059669' : '#DC2626', fontWeight: 600,
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: online ? '#22C55E' : '#EF4444' }} />
                      {online ? 'Онлайн' : 'Оффлайн'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div style={{
          padding: '10px 12px', borderTop: '1px solid #E5E7EB', background: '#F8FAFC',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
            Выбрано: {selected.size}
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={() => setSelected(new Set())} style={smallBtn}>Снять</button>
          <button onClick={bulkDelete} style={{ ...smallBtn, background: '#FEE2E2', borderColor: '#FCA5A5', color: '#B91C1C' }}>🗑 Удалить</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SortableTh({ label, k, cur, dir, onClick }: {
  label: string; k: SortKey; cur: SortKey; dir: SortDir; onClick: (k: SortKey) => void;
}) {
  return (
    <th style={{ ...th, cursor: 'pointer', userSelect: 'none' }} onClick={() => onClick(k)}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {label}
        {cur === k && <span style={{ fontSize: 9, color: '#2563EB' }}>{dir === 'asc' ? '▲' : '▼'}</span>}
      </span>
    </th>
  );
}

function FilterChip({ label, active, onClick, icon, color }: {
  label: string; active: boolean; onClick: () => void;
  icon?: React.ReactNode; color?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 8px', border: '1px solid ' + (active ? (color || '#2563EB') : '#E5E7EB'),
        background: active ? ((color || '#2563EB') + '15') : 'white',
        color: active ? (color || '#1D4ED8') : '#64748B',
        borderRadius: 999, fontSize: 10, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontWeight: active ? 700 : 500,
      }}
    >
      {icon}{label}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', border: '1px solid #E5E7EB', borderRadius: 6,
  fontSize: 12, background: 'white', outline: 'none', boxSizing: 'border-box',
};
const th: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'left', fontSize: 9, fontWeight: 700,
  color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.3,
  borderBottom: '1px solid #E5E7EB',
};
const td: React.CSSProperties = { padding: '6px 10px', fontSize: 11, verticalAlign: 'middle' };
const smallBtn: React.CSSProperties = {
  padding: '5px 12px', border: '1px solid #CBD5E1', borderRadius: 6, background: 'white',
  fontSize: 11, cursor: 'pointer', color: '#334155',
};
