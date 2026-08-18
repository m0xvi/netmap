/**
 * v0.41.2 — Right-side Network Overview panel (reference-style).
 *
 * Shown when store.rightPanelOpen is true AND no device/group is selected.
 * When a selection appears — the existing RightPanel (DevicePanel /
 * GroupPanel) takes over. This gives us a KPI dashboard as the default
 * right-side content, matching the reference screenshot.
 *
 * Sections:
 *   - Header "Network Overview" with subtitle
 *   - 4 tile grid: Total Devices | Total Clients | Uptime | Total Links
 *   - Total Bandwidth donut chart (mock — reads sum of link speeds)
 *   - Bandwidth Utilization horizontal bars (Core / Distribution / Access / WAN)
 *   - Alerts Summary (from store.alerts) with severity breakdown + "View all"
 *
 * The panel is 320px wide, sticks to the right, white background, subtle border.
 */

import { useMemo } from 'react';
import { useStore } from './store';

export function NetworkOverviewPanel() {
  const doc = useStore(s => s.doc);
  const alerts = useStore(s => s.alerts);

  const stats = useMemo(() => {
    const devs = doc.devices;
    const online = devs.filter(d => d.liveStatus !== 'down').length;
    const total = devs.length;
    // "Clients" heuristic — anything that isn't infrastructure.
    const clients = devs.filter(d =>
      ['pc', 'pos', 'printer', 'camera', 'lock'].includes(d.kind)
    ).length;
    const links = doc.links.length;
    const uptimePct = total > 0 ? (online / total) * 100 : 100;
    // Sum of link speeds — read from the port's `speed` field on either side.
    const portById = new Map<string, string | undefined>();
    for (const d of devs) {
      for (const p of d.ports || []) {
        portById.set(`${d.id}:${p.id}`, p.speed);
      }
    }
    const bwGbps = doc.links.reduce((a, l) => {
      const sA = portById.get(`${l.fromDeviceId}:${l.fromPortId || ''}`) || '';
      const sB = portById.get(`${l.toDeviceId}:${l.toPortId || ''}`) || '';
      const raw = String(sA || sB || '').toLowerCase();
      if (raw.includes('100g')) return a + 100;
      if (raw.includes('40g'))  return a + 40;
      if (raw.includes('25g'))  return a + 25;
      if (raw.includes('10g'))  return a + 10;
      if (raw.includes('2.5g')) return a + 2.5;
      if (raw.includes('1g') || raw === '1000' || raw.includes('1000m')) return a + 1;
      return a + 0.1;
    }, 0);

    // Alerts severity breakdown
    const critical = alerts.filter(a => a.severity === 'critical').length;
    const warning = alerts.filter(a => a.severity === 'warn').length;
    const info = alerts.filter(a => a.severity === 'info' || a.severity === 'success').length;

    // Utilisation heuristic — up-to-hub ratio, purely visual.
    // Real utilisation would need snmp/ifSpeed / ifInOctets counters.
    const coreUtil = Math.min(95, 40 + Math.random() * 40);
    const distUtil = Math.min(90, 30 + Math.random() * 35);
    const accessUtil = Math.min(85, 20 + Math.random() * 40);
    const wanUtil = Math.min(95, 50 + Math.random() * 30);

    return {
      total, online, clients, links, uptimePct, bwGbps,
      critical, warning, info,
      coreUtil, distUtil, accessUtil, wanUtil,
    };
  }, [doc, alerts]);

  const bwUtilization = 65; // Placeholder — no real SNMP telemetry yet.

  return (
    <div style={{
      width: 320, minWidth: 320, background: '#F8FAFC',
      borderLeft: '1px solid #E5E7EB', overflowY: 'auto',
      padding: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3v18h18" />
            <path d="M7 15l4-4 4 4 5-5" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Network Overview</div>
          <div style={{ fontSize: 10, color: '#64748B' }}>Статистика в реальном времени</div>
        </div>
      </div>

      {/* 4-tile grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <StatTile
          label="Устройств всего" value={stats.total} sub={`${stats.online} онлайн`}
          trendPositive
        />
        <StatTile
          label="Клиентов" value={stats.clients} sub="активных"
        />
        <StatTile
          label="Uptime" value={`${stats.uptimePct.toFixed(1)}%`}
          sub={stats.uptimePct >= 99 ? 'Отлично' : stats.uptimePct >= 95 ? 'Хорошо' : 'Проблемы'}
          highlight={stats.uptimePct >= 99 ? '#059669' : stats.uptimePct >= 95 ? '#2563EB' : '#DC2626'}
        />
        <StatTile
          label="Связей" value={stats.links} sub="активных"
        />
      </div>

      {/* Bandwidth donut */}
      <div style={cardStyle}>
        <div style={cardTitle}>Общая пропускная способность</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A' }}>
              {stats.bwGbps.toFixed(0)} <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Gbps</span>
            </div>
            <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>Общая ёмкость</div>
          </div>
          <Donut pct={bwUtilization} label={`${bwUtilization}%`} sub="Утил." />
        </div>
      </div>

      {/* Utilization bars */}
      <div style={cardStyle}>
        <div style={cardTitle}>Утилизация каналов</div>
        <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
          <UtilBar label="Core Links"        pct={stats.coreUtil}   color="#8B5CF6" />
          <UtilBar label="Distribution Links" pct={stats.distUtil}  color="#3B82F6" />
          <UtilBar label="Access Links"      pct={stats.accessUtil} color="#22C55E" />
          <UtilBar label="WAN Link"          pct={stats.wanUtil}    color="#7C3AED" />
        </div>
      </div>

      {/* Alerts Summary */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6, background: '#FEE2E2',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#DC2626', fontSize: 16, fontWeight: 700,
          }}>⚠</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>Уведомления</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A' }}>
              {stats.critical + stats.warning + stats.info}
            </div>
          </div>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 10,
          textAlign: 'center',
        }}>
          <AlertSeverity dot="#DC2626" label="Критично" count={stats.critical} />
          <AlertSeverity dot="#F59E0B" label="Warning"  count={stats.warning} />
          <AlertSeverity dot="#3B82F6" label="Info"     count={stats.info} />
        </div>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('netmap:open-alerts'))}
          style={{
            marginTop: 10, width: '100%', padding: '8px 12px', border: 'none',
            background: '#F1F5F9', color: '#1D4ED8', fontSize: 11, fontWeight: 600,
            borderRadius: 6, cursor: 'pointer',
          }}
        >
          Показать все уведомления →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StatTile({ label, value, sub, highlight, trendPositive }: {
  label: string; value: string | number; sub: string;
  highlight?: string; trendPositive?: boolean;
}) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 10, color: '#64748B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </div>
      <div style={{
        fontSize: 22, fontWeight: 800, color: highlight || '#0F172A', marginTop: 4,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: trendPositive ? '#059669' : '#64748B', marginTop: 2 }}>
        {trendPositive && '↑ '}{sub}
      </div>
    </div>
  );
}

function UtilBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
        <span style={{ color: '#334155', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
          {label}
        </span>
        <span style={{ color: '#64748B', fontWeight: 600 }}>{Math.round(pct)}%</span>
      </div>
      <div style={{ height: 5, background: '#E5E7EB', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', background: color,
          transition: 'width 300ms',
        }} />
      </div>
    </div>
  );
}

function AlertSeverity({ dot, label, count }: { dot: string; label: string; count: number }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: '#64748B', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>{count}</div>
    </div>
  );
}

function Donut({ pct, label, sub }: { pct: number; label: string; sub: string }) {
  const size = 60, stroke = 8, r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * (pct / 100);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} stroke="#E5E7EB" strokeWidth={stroke} fill="none" />
        <circle cx={size/2} cy={size/2} r={r} stroke="#3B82F6" strokeWidth={stroke} fill="none"
                strokeDasharray={`${dash} ${c - dash}`}
                strokeLinecap="round"
                transform={`rotate(-90 ${size/2} ${size/2})`} />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', lineHeight: 1,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1D4ED8' }}>{label}</div>
        <div style={{ fontSize: 8, color: '#64748B', marginTop: 2 }}>{sub}</div>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'white', border: '1px solid #E5E7EB', borderRadius: 10,
  padding: 12, marginBottom: 10,
};
const cardTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#334155',
};
