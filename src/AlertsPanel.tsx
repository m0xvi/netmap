/**
 * v0.42 — AlertsPanel — notifications centre shown in the ActivityBar.
 *
 * Renders store.alerts as a chronological feed. Actions per entry: click →
 * focus device on canvas (if bound). Top toolbar: filter by severity /
 * mark all read / clear all.
 */

import { useMemo, useState } from 'react';
import { useStore } from './store';
import { confirmDialog } from './Modal';

type SevFilter = 'all' | 'critical' | 'warn' | 'info' | 'success';

export function AlertsPanel() {
  const alerts = useStore(s => s.alerts);
  const markAllAlertsRead = useStore(s => s.markAllAlertsRead);
  const clearAlerts = useStore(s => s.clearAlerts);
  const [filter, setFilter] = useState<SevFilter>('all');

  const counts = useMemo(() => ({
    all: alerts.length,
    critical: alerts.filter(a => a.severity === 'critical').length,
    warn: alerts.filter(a => a.severity === 'warn').length,
    info: alerts.filter(a => a.severity === 'info').length,
    success: alerts.filter(a => a.severity === 'success').length,
    unread: alerts.filter(a => !a.read).length,
  }), [alerts]);

  const visible = useMemo(() => {
    if (filter === 'all') return alerts;
    return alerts.filter(a => a.severity === filter);
  }, [alerts, filter]);

  const doClear = async () => {
    if (!(await confirmDialog('Очистить все уведомления?', undefined, { danger: true, okText: 'Очистить' }))) return;
    clearAlerts();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #E5E7EB' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>
            Уведомления {counts.unread > 0 && <span style={{ color: '#DC2626' }}>· {counts.unread} новых</span>}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={markAllAlertsRead} style={smallBtn} title="Отметить прочитанными">✓</button>
            <button onClick={doClear} style={{ ...smallBtn, color: '#B91C1C' }} title="Очистить всё">🗑</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <Chip active={filter === 'all'}      onClick={() => setFilter('all')}      color="#64748B" label={`Все ${counts.all}`} />
          <Chip active={filter === 'critical'} onClick={() => setFilter('critical')} color="#DC2626" label={`🔴 ${counts.critical}`} />
          <Chip active={filter === 'warn'}     onClick={() => setFilter('warn')}     color="#F59E0B" label={`🟡 ${counts.warn}`} />
          <Chip active={filter === 'info'}     onClick={() => setFilter('info')}     color="#3B82F6" label={`ℹ ${counts.info}`} />
          <Chip active={filter === 'success'}  onClick={() => setFilter('success')}  color="#22C55E" label={`✓ ${counts.success}`} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {visible.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>
            🎉 Пусто. Всё под контролем.
          </div>
        )}
        {visible.slice().reverse().map(a => {
          const sev = SEVERITY_META[a.severity || 'info'];
          return (
            <div
              key={a.id}
              onClick={() => {
                if (a.deviceId) {
                  useStore.getState().focusDevice(a.deviceId);
                  useStore.getState().select(a.deviceId);
                  window.dispatchEvent(new CustomEvent('netmap:focus-device', { detail: { id: a.deviceId } }));
                }
              }}
              style={{
                padding: '10px 12px',
                borderBottom: '1px solid #F1F5F9',
                cursor: a.deviceId ? 'pointer' : 'default',
                background: a.read ? 'transparent' : sev.bgSubtle,
                borderLeft: `3px solid ${a.read ? 'transparent' : sev.color}`,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = a.read ? '#F8FAFC' : sev.bgSubtle; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: sev.color, fontSize: 14 }}>{sev.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {a.title && (
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.title}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 2, wordBreak: 'break-word' }}>
                    {a.message}
                  </div>
                  <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 4, display: 'flex', gap: 6 }}>
                    <span>{formatRelative(a.ts)}</span>
                    {a.deviceName && <span>· {a.deviceName}</span>}
                    {a.origin && <span>· {a.origin}</span>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const SEVERITY_META = {
  critical: { icon: '🔴', color: '#DC2626', bgSubtle: '#FEF2F2' },
  warn:     { icon: '🟡', color: '#F59E0B', bgSubtle: '#FFFBEB' },
  info:     { icon: 'ℹ',  color: '#3B82F6', bgSubtle: '#EFF6FF' },
  success:  { icon: '✓',  color: '#22C55E', bgSubtle: '#F0FDF4' },
} as const;

function Chip({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 8px', border: '1px solid ' + (active ? color : '#E5E7EB'),
        background: active ? color + '15' : 'white',
        color: active ? color : '#64748B',
        borderRadius: 999, fontSize: 10, cursor: 'pointer',
        fontWeight: active ? 700 : 500,
      }}
    >
      {label}
    </button>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'только что';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} мин назад`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} ч назад`;
  return new Date(ts).toLocaleString();
}

const smallBtn: React.CSSProperties = {
  padding: '4px 8px', border: '1px solid #E5E7EB', borderRadius: 5,
  background: 'white', fontSize: 11, cursor: 'pointer', color: '#64748B',
};
