/**
 * Small floating banner shown at the top-center of the canvas when a VLAN filter
 * is active. Lets the user see the current filter and clear it in one click.
 */

import { useStore } from './store';

export function VlanFilterBanner() {
  const filterVlan = useStore(s => s.filters.vlan);
  const vlans = useStore(s => s.doc.vlans);
  const setVlanFilter = useStore(s => s.setVlanFilter);

  if (filterVlan == null) return null;

  const v = (vlans || []).find(x => x.vlanId === filterVlan);
  const color = v?.color || '#6B7280';
  const name = v?.name || `VLAN ${filterVlan}`;

  return (
    <div style={{
      position: 'absolute', top: 12, left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 25,
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 6px 6px 10px',
      background: '#FFFFFF',
      border: `1px solid ${color}`,
      borderRadius: 999,
      boxShadow: '0 4px 12px rgba(15,23,42,0.10)',
      fontSize: 12,
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        color: '#374151',
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
             stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        Показан только
      </span>
      <span style={{
        background: color, color: '#FFFFFF',
        fontSize: 10, fontWeight: 800,
        padding: '2px 7px', borderRadius: 999,
        fontFamily: 'ui-monospace, monospace',
      }}>{filterVlan}</span>
      <span style={{ fontWeight: 600, color: '#111827', letterSpacing: 0.3, textTransform: 'uppercase' }}>
        {name}
      </span>
      <button
        onClick={() => setVlanFilter(null)}
        title="Сбросить VLAN-фильтр"
        style={{
          background: '#F3F4F6', border: '1px solid #E5E7EB', color: '#6B7280',
          borderRadius: '50%', width: 22, height: 22,
          fontSize: 14, lineHeight: 1, cursor: 'pointer', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginLeft: 4,
        }}
      >×</button>
    </div>
  );
}
