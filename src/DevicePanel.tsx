import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './store';
import type { Device, DeviceKind, Port, PortStatus, PortType, PortVlanMode, Vlan } from './types';
import { templateFromDevice } from './templates';
import { pushCustomTemplate } from './CatalogPanel';
import { vaultStatus, vaultList, vaultGet, vaultUnlock, vaultUpsert } from './vaultClient';
import { promptText, confirmDialog, alertDialog } from './Modal';
import { inferLayer } from './layers';
import { suggestVaultItems } from './vaultMatcher';
import { TotpChip } from './TotpChip';
import { ICONS, KIND_META } from './icons';
import { VLAN_COLORS, vlanColorForIndex } from './vlanDefaults';
import { MiniSpinner } from './Spinner';

const KINDS: DeviceKind[] = ['router','switch','patchpanel','ap','camera','server','vm','vps','pc','pos','printer','lock','cloud'];

// Stable empty references shared by all selectors so components don't re-render
// forever when the underlying field is undefined. `useStore(s => s.x || [])`
// would return a brand new [] every render → React error #185.
const EMPTY_VLANS: readonly import('./types').Vlan[] = Object.freeze([]);
const PORT_TYPES: PortType[] = ['RJ45', 'SFP', 'SFP+', 'Combo', 'WiFi', 'Console'];
const PORT_STATUSES: PortStatus[] = ['up', 'down', 'disabled', 'error'];

export function DevicePanel() {
  const selectedId = useStore(s => s.selectedDeviceId);
  const selectedPortId = useStore(s => s.selectedPortId);
  const doc = useStore(s => s.doc);
  const update = useStore(s => s.updateDevice);
  const remove = useStore(s => s.removeDevice);
  const removeLink = useStore(s => s.removeLink);
  const [tab, setTab] = useState<'info'|'ports'|'vlans'|'links'|'creds'|'alerts'|'config'|'hw'>('info');

  const device = useMemo(
    () => doc.devices.find(d => d.id === selectedId) || null,
    [selectedId, doc.devices]
  );

  // Auto-switch to ports tab when a port is selected
  useEffect(() => { if (selectedPortId) setTab('ports'); }, [selectedPortId]);

  if (!device) {
    return (
      <aside style={panelStyle}>
        <div style={{ padding: 20, color: '#9CA3AF', fontSize: 13 }}>
          👈 Кликните по устройству на схеме, чтобы увидеть детали.
          <br /><br />
          💡 <b>Совет:</b> для свитчей нажмите иконку <b>◱</b> справа в заголовке — развернётся rack-view со всеми портами. Клик по порту → редактирование прямо здесь.
        </div>
      </aside>
    );
  }

  const relatedLinks = doc.links.filter(l => l.fromDeviceId === device.id || l.toDeviceId === device.id);

  return (
    <aside style={panelStyle}>
      <InspectorHeader device={device} onRename={(n) => update(device.id, { name: n })}
                       onKindChange={(k) => update(device.id, { kind: k })}
                       onDelete={async () => {
                         if (await confirmDialog(`Удалить ${device.name}?`, undefined,
                             { danger: true, okText: 'Удалить' })) remove(device.id);
                       }} />

      <InspectorTabs tab={tab} onChange={setTab} />

      <div style={{ padding: 14, overflowY: 'auto', flex: 1, background: '#FFFFFF' }}>
        {tab === 'info' && <InfoTab device={device} update={update} />}
        {tab === 'ports' && <PortsTab device={device} focusedPortId={selectedPortId} />}
        {tab === 'vlans' && <VlansTab device={device} update={update} />}
        {tab === 'hw' && <HardwareTab device={device} update={update} />}
        {tab === 'links' && (
          <LinksTab
            deviceId={device.id}
            links={relatedLinks}
            devices={doc.devices}
            onRemove={removeLink}
          />
        )}
        {tab === 'creds' && <CredsTab device={device} update={update} />}
        {tab === 'alerts' && <AlertsTab deviceId={device.id} />}
        {tab === 'config' && <ConfigTab device={device} />}
      </div>
    </aside>
  );
}

// -----------------------------------------------------------------------------
// InspectorHeader — device preview thumbnail + name + status pill (matches mockup).

function InspectorHeader({ device, onRename, onKindChange, onDelete }: {
  device: Device;
  onRename: (name: string) => void;
  onKindChange: (kind: DeviceKind) => void;
  onDelete: () => void;
}) {
  const meta = KIND_META[device.kind];
  const Icon = ICONS[device.kind];

  const status = device.liveStatus;
  const statusColor = status === 'up' ? '#10B981'
                    : status === 'down' ? '#EF4444'
                    : status === 'checking' ? '#F59E0B'
                    : '#9CA3AF';
  const statusLabel = status === 'up' ? 'Online'
                    : status === 'down' ? 'Offline'
                    : status === 'checking' ? 'Checking'
                    : 'Unknown';

  const [editingName, setEditingName] = useState(false);
  const [editingKind, setEditingKind] = useState(false);

  return (
    <div style={{ padding: 14, borderBottom: '1px solid #E5E7EB', background: '#FFFFFF' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Preview thumbnail */}
        <div style={{
          width: 72, height: 42, borderRadius: 6,
          background: meta.bg,
          border: `1px solid ${meta.color}33`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: meta.color, flexShrink: 0,
        }}>
          <Icon size={26} />
        </div>

        {/* Name + subtitle */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {editingName ? (
            <input autoFocus value={device.name}
                   onChange={e => onRename(e.target.value)}
                   onBlur={() => setEditingName(false)}
                   onKeyDown={e => (e.key === 'Enter' || e.key === 'Escape') && setEditingName(false)}
                   style={{
                     width: '100%', fontSize: 16, fontWeight: 700, color: '#111827',
                     background: '#F9FAFB', border: '1px solid #D1D5DB',
                     borderRadius: 4, padding: '2px 6px', outline: 'none',
                   }} />
          ) : (
            <div onDoubleClick={() => setEditingName(true)}
                 title="Двойной клик — переименовать"
                 style={{ fontSize: 16, fontWeight: 700, color: '#111827',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          cursor: 'text' }}>
              {device.name}
            </div>
          )}
          <div style={{ fontSize: 11, color: '#6B7280', fontFamily: 'ui-monospace, monospace',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {device.model || device.id.toUpperCase()}
          </div>
        </div>

        {/* Status pill */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '3px 8px',
          background: `${statusColor}15`, border: `1px solid ${statusColor}40`,
          borderRadius: 999,
          flexShrink: 0,
        }} title={device.ip ? `Ping-статус: ${statusLabel}` : 'Нет IP'}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: statusColor, boxShadow: `0 0 4px ${statusColor}88`,
          }} />
          <span style={{ fontSize: 10, fontWeight: 600, color: statusColor }}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Compact meta row + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
        {editingKind ? (
          <select value={device.kind}
                  autoFocus
                  onBlur={() => setEditingKind(false)}
                  onChange={e => { onKindChange(e.target.value as DeviceKind); setEditingKind(false); }}
                  style={{
                    fontSize: 11, padding: '3px 6px',
                    border: '1px solid #D1D5DB', borderRadius: 4,
                    background: '#FFFFFF', color: '#111827', flex: 1,
                  }}>
            {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        ) : (
          <button onClick={() => setEditingKind(true)}
                  title="Изменить тип устройства"
                  style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: 0.5,
                    color: meta.color, background: meta.bg,
                    border: `1px solid ${meta.color}33`, borderRadius: 4,
                    padding: '3px 8px', cursor: 'pointer',
                  }}>
            {meta.label}
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={onDelete}
                title="Удалить устройство"
                style={{
                  background: 'transparent', border: '1px solid #E5E7EB',
                  color: '#9CA3AF', width: 28, height: 26, borderRadius: 4,
                  cursor: 'pointer', fontSize: 14, padding: 0,
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLButtonElement;
                  el.style.background = '#FEE2E2'; el.style.color = '#B91C1C';
                  el.style.borderColor = '#FCA5A5';
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLButtonElement;
                  el.style.background = 'transparent'; el.style.color = '#9CA3AF';
                  el.style.borderColor = '#E5E7EB';
                }}>✕</button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// InspectorTabs — icon+label tabs styled like the mockup (thin, monochrome).

const TABS = [
  { id: 'info',   label: 'Overview', icon: (<><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></>) },
  { id: 'ports',  label: 'Ports',    icon: (<><rect x="3" y="8" width="18" height="10" rx="1"/><path d="M7 12h.01M11 12h.01M15 12h.01M19 12h.01"/></>) },
  { id: 'vlans',  label: 'VLANs',    icon: (<><rect x="3" y="4"  width="7" height="7" rx="1"/><rect x="14" y="4"  width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>) },
  { id: 'links',  label: 'Links',    icon: (<><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></>) },
  { id: 'hw',     label: 'Hardware', icon: (<><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></>) },
  { id: 'alerts', label: 'Alerts',   icon: (<><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/></>) },
  { id: 'creds',  label: 'Access',   icon: (<><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>) },
  { id: 'config', label: 'Config',   icon: (<><path d="M6 4h9l4 4v12H6z"/><path d="M14 4v5h5"/><path d="M9 12h6M9 16h6"/></>) },
] as const;

function InspectorTabs({ tab, onChange }: {
  tab: string;
  onChange: (t: 'info'|'ports'|'vlans'|'links'|'creds'|'alerts'|'config'|'hw') => void;
}) {
  return (
    // v0.35.4: compact icon-only tab bar. Text labels used to overflow the
    // 360-px panel once we grew to 8 tabs. Now each tab is a 30×30 icon
    // button with tooltip; the active one gets a filled pill background.
    <div style={{
      display: 'flex', gap: 4,
      padding: '6px 8px',
      borderBottom: '1px solid #E5E7EB',
      background: '#FFFFFF',
      justifyContent: 'space-between',
    }}>
      {TABS.map(t => {
        const active = tab === t.id;
        return (
          <button key={t.id}
                  onClick={() => onChange(t.id as any)}
                  title={t.label}
                  aria-label={t.label}
                  style={{
                    flex: '1 1 0',
                    minWidth: 30, maxWidth: 44, height: 30,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: active ? '#EFF6FF' : 'transparent',
                    color: active ? '#2563EB' : '#6B7280',
                    border: 'none',
                    borderRadius: 6, cursor: 'pointer',
                    position: 'relative',
                    transition: 'all 0.1s',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = '#F3F4F6'; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              {t.icon}
            </svg>
            {active && (
              <span style={{
                position: 'absolute', bottom: -6, left: '15%', right: '15%',
                height: 2, background: '#2563EB', borderRadius: 1,
              }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

function InfoTab({ device, update }: { device: Device; update: (id: string, p: Partial<Device>) => void }) {
  const doc = useStore(s => s.doc);
  const potentialHosts = doc.devices.filter(d => d.kind === 'server' && d.id !== device.id);
  const [editMode, setEditMode] = useState(false);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Device Information — read-only summary matching the mockup */}
      <DeviceInfoBlock device={device} onEdit={() => setEditMode(v => !v)} editing={editMode} />

      {/* v0.36.2: Quick actions — Wake-on-LAN, Traceroute */}
      <QuickActionsBlock device={device} update={update} />

      {/* Ping mini-history with sparkline */}
      <PingBlock device={device} />

      {editMode && (
        <div style={{ marginTop: -4, padding: 10,
                      background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8,
                      display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280',
                        textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Редактирование
          </div>
      {device.kind === 'vm' && (
        <div style={{ background: '#2e1b52', border: '1px solid #a78bfa66', borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 6, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase' }}>
            Виртуальная машина
          </div>
          <Field label="Родительский сервер (хост)">
            <select value={device.hostDeviceId || ''}
                    onChange={e => update(device.id, { hostDeviceId: e.target.value || null })}
                    style={inputStyle}>
              <option value="">— не выбран —</option>
              {potentialHosts.map(h => (
                <option key={h.id} value={h.id}>{h.name}{h.ip ? ` · ${h.ip}` : ''}</option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 6 }}>
            <Field label="vCPU">
              <input type="number" value={device.vmInfo?.vcpu ?? ''}
                     onChange={e => update(device.id, { vmInfo: { ...device.vmInfo, vcpu: +e.target.value || undefined } })}
                     style={inputStyle} />
            </Field>
            <Field label="RAM (GB)">
              <input type="number" value={device.vmInfo?.ramGb ?? ''}
                     onChange={e => update(device.id, { vmInfo: { ...device.vmInfo, ramGb: +e.target.value || undefined } })}
                     style={inputStyle} />
            </Field>
            <Field label="OS">
              <input value={device.vmInfo?.os ?? ''}
                     onChange={e => update(device.id, { vmInfo: { ...device.vmInfo, os: e.target.value || undefined } })}
                     style={inputStyle} />
            </Field>
          </div>
        </div>
      )}

      <Field label="IP-адрес">
        <input value={device.ip || ''} onChange={e => update(device.id, { ip: e.target.value })}
               placeholder="192.168.11.1/24" style={inputStyle} />
      </Field>
      <Field label="MAC">
        <input value={device.mac || ''} onChange={e => update(device.id, { mac: e.target.value })}
               placeholder="AA:BB:CC:DD:EE:FF" style={inputStyle} />
      </Field>
      <Field label="Производитель">
        <input value={device.vendor || ''} onChange={e => update(device.id, { vendor: e.target.value })}
               style={inputStyle} />
      </Field>
      <Field label="Модель">
        <input value={device.model || ''} onChange={e => update(device.id, { model: e.target.value })}
               style={inputStyle} />
      </Field>
      <Field label="Расположение">
        <input value={device.location || ''} onChange={e => update(device.id, { location: e.target.value })}
               style={inputStyle} />
      </Field>
      <Field label="Уровень (Cisco 3-tier)">
        <select
          value={device.layer || 'auto'}
          onChange={e => {
            const v = e.target.value;
            update(device.id, { layer: v === 'auto' ? undefined : v as any });
          }}
          style={inputStyle}
        >
          <option value="auto">🤖 Авто ({inferLayer(device).toUpperCase()})</option>
          <option value="core">🏛 Core — магистраль</option>
          <option value="distribution">🌉 Distribution — распределение</option>
          <option value="access">Access — оконечные</option>
        </select>
      </Field>
      <Field label="URL управления">
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={device.mgmtUrl || ''} onChange={e => update(device.id, { mgmtUrl: e.target.value })}
                 placeholder="https://..." style={{ ...inputStyle, flex: 1 }} />
          {device.mgmtUrl && (
            <a href={device.mgmtUrl} target="_blank" rel="noreferrer" style={linkBtn}>Открыть ↗</a>
          )}
        </div>
      </Field>
      <Field label="Теги (через запятую)">
        <input value={(device.tags || []).join(', ')}
               onChange={e => update(device.id, { tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
               style={inputStyle} />
      </Field>

      <button
        style={{
          background: '#F9FAFB', border: '1px solid #D1D5DB', color: '#111827',
          padding: '8px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
          marginTop: 4,
        }}
        onClick={async () => {
          const vendor = await promptText('Сохранить как шаблон · шаг 1/2', device.vendor || 'Custom', 'Производитель');
          if (vendor === null) return;
          const model  = await promptText('Сохранить как шаблон · шаг 2/2', device.model || device.name, 'Модель');
          if (model === null) return;
          const t = templateFromDevice(device, { vendor: vendor.trim() || undefined, model: model.trim() || undefined });
          pushCustomTemplate(t);
          await alertDialog('Шаблон сохранён', `«${t.vendor} ${t.model}» появится в разделе «Каталог».`);
        }}
      >
        Сохранить как шаблон
      </button>
        </div>
      )}

      <VlanSummaryBlock device={device} />
    </div>
  );
}

/**
 * Compact read-only summary of key device fields — matches the "Device Information"
 * card on the mockup. Includes an inline "edit" toggle that unfolds the editable form.
 */
function DeviceInfoBlock({ device, onEdit, editing }: {
  device: Device;
  onEdit: () => void;
  editing: boolean;
}) {
  const rows: Array<[string, string | null | undefined]> = [
    ['IP Address',    device.ip],
    ['MAC Address',   device.mac],
    ['Model',         device.model],
    ['Vendor',        device.vendor],
    ['Location',      device.location],
    ['Uptime',        device.lastCheckedAt ? formatUptimeSince(device.lastCheckedAt) : null],
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <div style={sectionH}>Device Information</div>
        <button onClick={onEdit}
                title={editing ? 'Скрыть форму редактирования' : 'Редактировать'}
                style={{
                  marginLeft: 'auto', background: 'transparent', border: 'none',
                  padding: 4, cursor: 'pointer', color: editing ? '#2563EB' : '#9CA3AF',
                  display: 'flex', alignItems: 'center',
                }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3l3 3M3 21l3.5-.5L20 7l-3-3L3.5 17.5 3 21z"/>
          </svg>
        </button>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontSize: 11, color: '#6B7280' }}>{k}</span>
            <span style={{
              fontSize: 12, color: v ? '#111827' : '#9CA3AF',
              fontFamily: k === 'IP Address' || k === 'MAC Address' ? 'ui-monospace, monospace' : 'inherit',
              wordBreak: 'break-all',
            }}>
              {v || '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatUptimeSince(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/**
 * Ping card with big current RTT + 24h sparkline — matches the mockup.
 */
// Stable empty reference so a device without history returns the SAME array
// on every render — otherwise zustand's default equality check (Object.is)
// keeps returning a brand-new [] which triggers an infinite render loop
// via `useEffect`s downstream (React error #185).
const EMPTY_HISTORY: import('./store').PingSample[] = [];

// ============================================================================
// v0.36.2 — QuickActionsBlock: Wake-on-LAN + Traceroute row on Overview.
// Показывается ТОЛЬКО когда действия применимы (WoL — для устройств с MAC,
// traceroute — для устройств с IP). Пустой блок скрыт.
// ============================================================================
function QuickActionsBlock({ device, update }: {
  device: Device;
  update: (id: string, p: Partial<Device>) => void;
}) {
  const [wolBusy, setWolBusy] = useState(false);
  const [wolResult, setWolResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const canWol = !!device.mac;
  const canTrace = !!device.ip;
  if (!canWol && !canTrace) return null;

  const doWol = async () => {
    if (!device.mac) return;
    setWolBusy(true); setWolResult(null);
    try {
      const { sendWol } = await import('./wolClient');
      const r = await sendWol({
        mac: device.mac,
        broadcastIp: device.wolBroadcastIp || undefined,
      });
      if (r.ok) {
        setWolResult({ ok: true, msg: `Magic packet отправлен (${r.sent}/${r.targets.length} broadcast'ов)` });
        useStore.getState().pushAlert({
          severity: 'success', origin: 'app', title: 'Wake-on-LAN',
          message: `${device.name}: пакет отправлен на ${r.targets.join(', ')}`,
          deviceId: device.id, deviceName: device.name,
        });
      } else {
        setWolResult({ ok: false, msg: r.error || 'Не удалось отправить пакет' });
      }
    } catch (e: any) {
      setWolResult({ ok: false, msg: e?.message || String(e) });
    } finally { setWolBusy(false); }
  };

  const doTrace = () => {
    if (!device.ip) return;
    window.dispatchEvent(new CustomEvent('netmap:open-traceroute', {
      detail: {
        targetDeviceId: device.id,
        targetIp: device.ip.split('/')[0],
      },
    }));
  };

  return (
    <div style={{
      padding: 10, background: '#F9FAFB', border: '1px solid #E5E7EB',
      borderRadius: 8, display: 'grid', gap: 8,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280',
                     textTransform: 'uppercase', letterSpacing: 0.4 }}>
        Быстрые действия
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {canTrace && (
          <button onClick={doTrace} style={quickBtn}>
            <span>🛣</span> Traceroute
          </button>
        )}
        {canWol && (
          <button onClick={doWol} disabled={wolBusy}
                  style={{ ...quickBtn, opacity: wolBusy ? 0.5 : 1 }}>
            <span>⏻</span> {wolBusy ? 'Отправка…' : 'Wake-on-LAN'}
          </button>
        )}
      </div>
      {/* WoL — optional broadcast IP (edit inline) */}
      {canWol && (
        <details style={{ fontSize: 11, color: '#6B7280' }}>
          <summary style={{ cursor: 'pointer' }}>Настройки WoL</summary>
          <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
            <label style={{ fontSize: 10, color: '#374151' }}>
              Broadcast IP (опционально, для удалённой подсети)
            </label>
            <input
              value={device.wolBroadcastIp || ''}
              onChange={e => update(device.id, { wolBroadcastIp: e.target.value || undefined })}
              placeholder="192.168.11.255"
              style={{
                background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827',
                padding: '4px 8px', borderRadius: 4, fontSize: 11, outline: 'none',
                fontFamily: 'ui-monospace, monospace',
              }} />
            <div style={{ fontSize: 10, color: '#9CA3AF' }}>
              Пусто = отправить во ВСЕ локальные broadcast'ы + 255.255.255.255.
            </div>
          </div>
        </details>
      )}
      {wolResult && (
        <div style={{
          fontSize: 11, padding: 6, borderRadius: 4,
          background: wolResult.ok ? '#D1FAE5' : '#FEE2E2',
          color:      wolResult.ok ? '#065F46' : '#B91C1C',
        }}>{wolResult.ok ? '✓' : '⚠'} {wolResult.msg}</div>
      )}
    </div>
  );
}
const quickBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '6px 12px', borderRadius: 5,
  background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#374151',
  fontSize: 12, fontWeight: 500, cursor: 'pointer',
};

function PingBlock({ device }: { device: Device }) {
  const history = useStore(s => s.pingHistory[device.id]) || EMPTY_HISTORY;
  const monitorEnabled = useStore(s => s.monitorEnabled);
  const lastRtt = device.lastRttMs;

  if (!device.ip) return null;

  const avg = history.length > 0
    ? Math.round(history.filter(h => h.alive && h.rttMs != null).reduce((s, h) => s + (h.rttMs || 0), 0) /
                 Math.max(1, history.filter(h => h.alive && h.rttMs != null).length) * 10) / 10
    : null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <div style={sectionH}>Ping</div>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#9CA3AF' }}>
          {history.length > 0 ? `${history.length} проб` : monitorEnabled ? 'ожидание…' : 'ping отключён'}
        </span>
      </div>
      <div style={{
        padding: 12, background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: '#111827', lineHeight: 1 }}>
            {lastRtt != null ? lastRtt.toFixed(1) : '—'}
          </span>
          <span style={{ fontSize: 12, color: '#6B7280' }}>ms</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6B7280' }}>
            {avg != null ? `avg ${avg}ms` : ''}
          </span>
        </div>
        <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 8 }}>
          {history.length >= 2 ? 'Последние ' + Math.min(24, Math.round(history.length / 12)) + ' часов'
            : 'Собираем историю…'}
        </div>
        <PingSparkline samples={history} />
      </div>
    </div>
  );
}

function PingSparkline({ samples }: { samples: Array<{ ts: number; rttMs?: number; alive: boolean }> }) {
  const W = 320, H = 44;
  if (samples.length < 2) {
    return (
      <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#D1D5DB', fontSize: 10 }}>
        Недостаточно данных
      </div>
    );
  }
  const rtts = samples.map(s => s.alive && s.rttMs != null ? s.rttMs : 0);
  const maxR = Math.max(1, ...rtts) * 1.15;
  const points = samples.map((s, i) => {
    const x = (i / (samples.length - 1)) * W;
    const y = s.alive && s.rttMs != null
      ? H - (s.rttMs / maxR) * (H - 4) - 2
      : H - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
         style={{ display: 'block' }}>
      {/* Grid line */}
      <line x1="0" x2={W} y1={H - 2} y2={H - 2} stroke="#E5E7EB" strokeWidth="1" />
      {/* Area fill */}
      <polygon points={`0,${H} ${points} ${W},${H}`} fill="#2563EB" fillOpacity="0.10" />
      {/* Line */}
      <polyline points={points} fill="none" stroke="#2563EB" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round" />
      {/* Down markers */}
      {samples.map((s, i) => !s.alive && (
        <circle key={i} cx={(i / (samples.length - 1)) * W} cy={H - 2} r="1.5" fill="#EF4444" />
      ))}
    </svg>
  );
}

const sectionH: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: '#111827',
  textTransform: 'none', letterSpacing: 0,
};

/**
 * Small VLAN preview block for the InfoTab — matches the "VLANs" section
 * on the reference mockup. Read-only; editing happens on the VLAN tab.
 */
function VlanSummaryBlock({ device }: { device: Device }) {
  const projectVlans = useStore(s => s.doc.vlans) || (EMPTY_VLANS as import('./types').Vlan[]);
  const links = useStore(s => s.doc.links);

  const observed = new Set<number>();
  for (const p of device.ports) {
    if (p.vlan != null) observed.add(p.vlan);
    for (const v of p.vlans || []) observed.add(v);
  }
  for (const l of links) {
    if (l.fromDeviceId !== device.id && l.toDeviceId !== device.id) continue;
    if (l.vlan != null) observed.add(l.vlan);
    for (const v of l.vlans || []) observed.add(v);
  }

  if (observed.size === 0) return null;

  const vlanById = new Map(projectVlans.map(v => [v.vlanId, v]));
  const sorted = Array.from(observed).sort((a, b) => a - b);

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={sectionH}>VLANs</div>
        <a href="#" onClick={(e) => e.preventDefault()}
           style={{ marginLeft: 'auto', fontSize: 11, color: '#2563EB', textDecoration: 'none', fontWeight: 500 }}>
          Manage
        </a>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {sorted.map(vid => {
          const v = vlanById.get(vid);
          const color = v?.color || '#6B7280';
          return (
            <div key={vid} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '2px 0',
            }}>
              {/* Ring-style VLAN chip like the reference — colored circular outline with the ID inside */}
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 26, height: 26, borderRadius: '50%',
                border: `1.5px solid ${color}`,
                color: color, background: `${color}12`,
                fontSize: 10, fontWeight: 800,
                fontFamily: 'ui-monospace, monospace',
                flexShrink: 0,
              }}>{vid}</span>
              <span style={{
                fontSize: 11, fontWeight: 700, color: '#111827',
                letterSpacing: 0.4, textTransform: 'uppercase',
                flex: '0 1 auto', minWidth: 0,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {v?.name || 'не в проекте'}
              </span>
              <span style={{
                marginLeft: 'auto',
                fontSize: 10.5, color: '#6B7280',
                fontFamily: 'ui-monospace, monospace',
                whiteSpace: 'nowrap',
              }}>
                {v?.cidr || '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PortsTab({ device, focusedPortId }: { device: Device; focusedPortId: string | null }) {
  const doc = useStore(s => s.doc);
  const updatePort = useStore(s => s.updatePort);
  const removePort = useStore(s => s.removePort);
  const addPort = useStore(s => s.addPort);
  const selectPort = useStore(s => s.selectPort);
  const updateDevice = useStore(s => s.updateDevice);

  const focusedPort = focusedPortId ? device.ports.find(p => p.id === focusedPortId) : null;

  // Detailed editor when a port is selected
  if (focusedPort) {
    const linksOnThisPort = doc.links.filter(l =>
      (l.fromDeviceId === device.id && l.fromPortId === focusedPort.id) ||
      (l.toDeviceId === device.id && l.toPortId === focusedPort.id)
    );

    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <button style={btnSecondary} onClick={() => selectPort(device.id, null)}>← ко всем портам</button>

        <div style={{ background: portBgFor(focusedPort), border: '1px solid #D1D5DB',
                      borderRadius: 8, padding: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 22 }}>{focusedPort.uplink ? '🔵' : focusedPort.status === 'up' ? '🟢' : '⚫'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{focusedPort.id.toUpperCase()}</div>
            <div style={{ fontSize: 10, opacity: 0.7 }}>
              {focusedPort.type || 'RJ45'} · {focusedPort.speed || '1G'}
              {focusedPort.poeActive ? ' · PoE⚡' : focusedPort.poe ? ' · PoE-capable' : ''}
            </div>
          </div>
        </div>

        <Field label="ID порта">
          <input value={focusedPort.id}
                 onChange={e => updatePort(device.id, focusedPort.id, { id: e.target.value })}
                 style={inputStyle} />
        </Field>
        <Field label="Что подключено / описание">
          <input value={focusedPort.label || ''} placeholder="напр. AP_U2_Hall"
                 onChange={e => updatePort(device.id, focusedPort.id, { label: e.target.value })}
                 style={inputStyle} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Тип">
            <select value={focusedPort.type || 'RJ45'}
                    onChange={e => updatePort(device.id, focusedPort.id, { type: e.target.value as PortType })}
                    style={inputStyle}>
              {PORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Скорость">
            <select value={focusedPort.speed || '1G'}
                    onChange={e => updatePort(device.id, focusedPort.id, { speed: e.target.value as any })}
                    style={inputStyle}>
              {['100M','1G','2.5G','10G'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Статус">
            <select value={focusedPort.status || 'down'}
                    onChange={e => updatePort(device.id, focusedPort.id, { status: e.target.value as PortStatus })}
                    style={inputStyle}>
              {PORT_STATUSES.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
            </select>
          </Field>
          <Field label="VLAN">
            <input type="number" value={focusedPort.vlan ?? ''} placeholder="—"
                   onChange={e => updatePort(device.id, focusedPort.id, { vlan: e.target.value ? +e.target.value : undefined })}
                   style={inputStyle} />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <label style={checkLabel}>
            <input type="checkbox" checked={!!focusedPort.poe}
                   onChange={e => updatePort(device.id, focusedPort.id, { poe: e.target.checked })} />
            PoE
          </label>
          <label style={checkLabel}>
            <input type="checkbox" checked={!!focusedPort.poeActive}
                   onChange={e => updatePort(device.id, focusedPort.id, { poeActive: e.target.checked })} />
            ⚡ активен
          </label>
          <label style={checkLabel}>
            <input type="checkbox" checked={!!focusedPort.uplink}
                   onChange={e => updatePort(device.id, focusedPort.id, { uplink: e.target.checked })} />
            uplink
          </label>
        </div>
        <Field label="Заметки">
          <textarea value={focusedPort.notes || ''} rows={2}
                    onChange={e => updatePort(device.id, focusedPort.id, { notes: e.target.value })}
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
        </Field>

        <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 10 }}>
          <div style={{ fontSize: 10, opacity: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>
            Кабели на этом порту ({linksOnThisPort.length})
          </div>
          {linksOnThisPort.length === 0 && (
            <div style={{ fontSize: 12, opacity: 0.5 }}>Ничего не подключено.</div>
          )}
          {linksOnThisPort.map(l => {
            const otherId = l.fromDeviceId === device.id ? l.toDeviceId : l.fromDeviceId;
            const otherPort = l.fromDeviceId === device.id ? l.toPortId : l.fromPortId;
            const other = doc.devices.find(d => d.id === otherId);
            return (
              <div key={l.id} style={rowStyle}>
                <div style={{ flex: 1, fontSize: 12 }}>
                  → <b>{other?.name || '?'}</b>
                  <span style={{ opacity: 0.6 }}> ({otherPort || 'no port'})</span>
                </div>
              </div>
            );
          })}
        </div>

        <button style={{ ...btnDanger, width: '100%' }}
                onClick={async () => { if (await confirmDialog(`Удалить порт ${focusedPort.id}?`, undefined, { danger: true, okText: 'Удалить' })) removePort(device.id, focusedPort.id); }}>
          ✕ Удалить порт
        </button>
      </div>
    );
  }

  // List view: compact rows
  const isSwitch = device.kind === 'switch' || device.kind === 'router';
  return (
    <div>
      {isSwitch && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button style={{ ...btnSecondary, flex: 1 }}
                  onClick={() => updateDevice(device.id, { display: device.display === 'rack' ? 'compact' : 'rack' })}>
            {device.display === 'rack' ? '◱ Свернуть в compact' : '◱ Развернуть в rack'}
          </button>
        </div>
      )}

      {/* Port Matrix — grid of colored squares matching the mockup */}
      {device.ports.length >= 6 && (
        <PortMatrix device={device}
                    onSelect={pid => selectPort(device.id, pid)} />
      )}

      <div style={{ display: 'grid', gap: 4 }}>
        {device.ports.map(p => {
          const linked = doc.links.some(l =>
            (l.fromDeviceId === device.id && l.fromPortId === p.id) ||
            (l.toDeviceId === device.id && l.toPortId === p.id)
          );
          return (
            <div key={p.id}
                 onClick={() => selectPort(device.id, p.id)}
                 style={{ ...rowStyle, cursor: 'pointer', borderColor: p.uplink ? '#60a5fa' : '#E5E7EB' }}>
              <div style={{
                width: 10, height: 10, borderRadius: 2,
                background: p.status === 'up' ? '#10B981' : p.status === 'error' ? '#f87171' : '#374151'
              }} />
              <span style={{ fontFamily: 'monospace', fontSize: 11, width: 42 }}>{p.id}</span>
              <span style={{ flex: 1, fontSize: 12, opacity: p.label ? 1 : 0.4 }}>
                {p.label || '(не подписан)'}
              </span>
              {p.poeActive && <span title="PoE активен" style={{ fontSize: 10 }}>⚡</span>}
              {p.uplink && <span title="uplink" style={{ fontSize: 10, color: '#60a5fa' }}>↑</span>}
              {linked && <span title="есть кабель" style={{ fontSize: 10, opacity: 0.6 }}>🔗</span>}
            </div>
          );
        })}
      </div>
      <button style={{ ...btnPrimary, marginTop: 10, width: '100%' }}
              onClick={() => addPort(device.id)}>+ Порт</button>
    </div>
  );
}

function portBgFor(p: Port): string {
  if (p.uplink && p.status === 'up') return 'rgba(30, 58, 138, 0.35)';
  if (p.status === 'up') return 'rgba(22, 101, 52, 0.35)';
  if (p.status === 'error') return 'rgba(127, 29, 29, 0.35)';
  return 'rgba(30, 41, 59, 0.35)';
}

const checkLabel: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
  background: '#F9FAFB', border: '1px solid #D1D5DB', borderRadius: 6,
  padding: '6px 8px', cursor: 'pointer'
};

function LinksTab({ deviceId, links, devices, onRemove }:
  { deviceId: string; links: any[]; devices: Device[]; onRemove: (id: string) => void }) {
  const byId = new Map(devices.map(d => [d.id, d]));
  if (links.length === 0) return <div style={{ color: '#9CA3AF', fontSize: 12 }}>Нет связей.</div>;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {links.map(l => {
        const other = l.fromDeviceId === deviceId ? byId.get(l.toDeviceId) : byId.get(l.fromDeviceId);
        const myPort = l.fromDeviceId === deviceId ? l.fromPortId : l.toPortId;
        const otherPort = l.fromDeviceId === deviceId ? l.toPortId : l.fromPortId;
        return (
          <div key={l.id} style={rowStyle}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12 }}>
                <span style={{ opacity: 0.6 }}>{myPort || '—'}</span>
                {' → '}
                <b>{other?.name || '?'}</b>
                <span style={{ opacity: 0.6 }}> ({otherPort || '—'})</span>
              </div>
              <div style={{ fontSize: 10, opacity: 0.6 }}>
                {l.cable || 'copper'}{l.vlan ? ` · VLAN ${l.vlan}` : ''}{l.label ? ` · ${l.label}` : ''}
              </div>
            </div>
            <button onClick={() => onRemove(l.id)} style={btnDangerSmall}>✕</button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * v0.48 — CredsTab full rewrite. Bitwarden-inline style:
 *   • No linked item → «+ Добавить запись» button that expands an inline
 *     create form (URL / login / password / notes) — pre-filled with
 *     device.name / device.ip / device.mgmtUrl heuristics
 *   • Linked item + unlocked vault → full item preview:
 *       - URL (clickable + Copy)
 *       - Username (Copy)
 *       - Password (Show/Hide + Copy with auto-clear 45s)
 *       - TOTP (live 6-digit + progress ring via <TotpChip>)
 *       - Notes
 *       - «Открыть в Vault Studio» + «Отвязать»
 *   • Vault locked → inline password prompt (no separate dialog)
 *   • Vault not initialized → CTA «Создать vault» inline
 */
function CredsTab({ device, update }: { device: Device; update: (id: string, p: Partial<Device>) => void }) {
  const c = device.credential || {};
  const set = (patch: Partial<typeof c>) => update(device.id, { credential: { ...c, ...patch } });
  return <CredsTabInner device={device} c={c} set={set} />;
}

function CredsTabInner({ device, c, set }: {
  device: Device;
  c: NonNullable<Device['credential']>;
  set: (patch: Partial<NonNullable<Device['credential']>>) => void;
}) {
  const [vaultItems, setVaultItems] = useState<Array<{ id: string; name: string; folder?: string | null }>>([]);
  const [status, setStatus] = useState<'checking' | 'locked' | 'unlocked' | 'not-init'>('checking');
  const [linkedItem, setLinkedItem] = useState<any>(null);
  const [copyOK, setCopyOK] = useState<'user' | 'pw' | 'url' | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [inlineMasterPw, setInlineMasterPw] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockErr, setUnlockErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState(false);

  const refreshStatus = async () => {
    const st = await vaultStatus();
    if (!st.initialized) setStatus('not-init');
    else if (!st.unlocked) setStatus('locked');
    else {
      setStatus('unlocked');
      const list = await vaultList();
      setVaultItems(list);
    }
  };
  useEffect(() => { refreshStatus(); }, []);

  useEffect(() => {
    if (status !== 'unlocked' || !c.vaultItemId) { setLinkedItem(null); return; }
    (async () => {
      const res = await vaultGet(c.vaultItemId!);
      if (res.ok && res.item) setLinkedItem(res.item);
      else setLinkedItem(null);
    })();
  }, [status, c.vaultItemId]);

  async function unlockInline() {
    if (!inlineMasterPw) return;
    setUnlockErr(''); setUnlocking(true);
    try {
      const res = await vaultUnlock(inlineMasterPw);
      if (res.ok) {
        setInlineMasterPw('');
        await refreshStatus();
      } else {
        setUnlockErr((res as any).error === 'wrong-password' ? 'Неверный пароль' : String((res as any).error));
      }
    } finally {
      setUnlocking(false);
    }
  }

  const copy = async (kind: 'user' | 'pw' | 'url', text: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopyOK(kind); setTimeout(() => setCopyOK(null), 1400);
    if (kind === 'pw') {
      setTimeout(() => {
        navigator.clipboard.readText().then(t => {
          if (t === text) navigator.clipboard.writeText('');
        }).catch(() => {});
      }, 45000);
    }
  };

  // ---- Rendering per state ----------------------------------------------
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {/* Security note */}
      <div style={{
        background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 8, padding: 10,
        fontSize: 11, color: '#166534', display: 'flex', alignItems: 'flex-start', gap: 8,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
        <div>
          <b>AES-256-GCM</b> шифрование с ключом из мастер-пароля vault. Пароль автоматически очищается из буфера через 45 сек.
        </div>
      </div>

      {/* Username label for the schema (kept — this is device-level, not vault) */}
      <Field label="Имя пользователя (для схемы)">
        <input value={c.username || ''} onChange={e => set({ username: e.target.value })}
               placeholder="admin"
               style={inputStyle} />
      </Field>

      {/* ============ Vault state ============ */}

      {status === 'checking' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px', fontSize: 11, color: '#64748B' }}>
          <MiniSpinner /> Проверяем vault…
        </div>
      )}

      {status === 'not-init' && (
        <div style={{
          background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: 12,
          display: 'grid', gap: 8,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E' }}>Vault ещё не создан</div>
          <div style={{ fontSize: 11, color: '#78350F' }}>
            Откройте <b>Vault</b> в левой панели и придумайте мастер-пароль. После этого сможете добавлять сюда учётки одним кликом.
          </div>
          <button onClick={() => window.dispatchEvent(new CustomEvent('netmap:open-vault-studio'))}
                  style={{ ...btnPrimary, alignSelf: 'start' }}>
            Открыть Vault Studio
          </button>
        </div>
      )}

      {status === 'locked' && (
        <div style={{
          background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: 8, padding: 12,
          display: 'grid', gap: 8,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
            Vault заблокирован
          </div>
          <input type="password" placeholder="Мастер-пароль"
                 value={inlineMasterPw}
                 onChange={e => setInlineMasterPw(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') unlockInline(); }}
                 disabled={unlocking}
                 style={inputStyle} autoFocus />
          {unlockErr && <div style={{ fontSize: 11, color: '#DC2626' }}>{unlockErr}</div>}
          <button onClick={unlockInline} disabled={unlocking || !inlineMasterPw}
                  style={{ ...btnPrimary, display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center',
                           opacity: (unlocking || !inlineMasterPw) ? 0.6 : 1 }}>
            {unlocking && <MiniSpinner light />}{unlocking ? 'Проверяем…' : 'Разблокировать'}
          </button>
        </div>
      )}

      {status === 'unlocked' && (
        <>
          {/* Case 1: linked to a vault item — Bitwarden-style detail view */}
          {linkedItem && (
            <VaultLinkedCard
              item={linkedItem}
              copyOK={copyOK} onCopy={copy}
              showPw={showPw} setShowPw={setShowPw}
              onUnlink={() => set({ vaultItemId: undefined })}
            />
          )}

          {/* Case 2: no link yet — show create + pick + suggestions */}
          {!linkedItem && (
            <div style={{ display: 'grid', gap: 8 }}>
              {/* Suggestions row (auto-match by IP/name/URL) */}
              {(() => {
                const matches = suggestVaultItems(device, vaultItems).slice(0, 3);
                if (matches.length === 0) return null;
                return (
                  <div style={{
                    background: '#EFF6FF', border: '1px solid #93C5FD', borderRadius: 8, padding: 10, display: 'grid', gap: 6,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#1E40AF', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                      Найдено в vault
                    </div>
                    {matches.map(m => {
                      const it = vaultItems.find(x => x.id === m.itemId);
                      if (!it) return null;
                      return (
                        <button key={m.itemId} onClick={() => set({ vaultItemId: m.itemId })}
                                style={{
                                  background: '#FFFFFF', border: '1px solid #BFDBFE',
                                  color: '#111827', padding: '7px 10px', borderRadius: 6,
                                  cursor: 'pointer', textAlign: 'left', fontSize: 11,
                                  display: 'flex', alignItems: 'center', gap: 8,
                                }}
                                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#F0F9FF'}
                                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = '#FFFFFF'}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {it.folder ? `[${it.folder}] ` : ''}{it.name}
                            </div>
                            <div style={{ fontSize: 9, color: '#64748B' }}>{m.reason}</div>
                          </div>
                          <span style={{
                            fontSize: 10, color: '#065F46', background: '#DCFCE7',
                            padding: '3px 8px', borderRadius: 999, fontWeight: 700,
                          }}>Привязать</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={() => setCreating(v => !v)}
                        style={{
                          ...btnPrimary, display: 'inline-flex', alignItems: 'center', gap: 5,
                          background: creating ? '#94A3B8' : '#2563EB',
                        }}>
                  {creating ? (<>✕ Отменить</>) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                      Добавить запись
                    </>
                  )}
                </button>
                <button onClick={() => setPicking(v => !v)} style={btnSecondary}>
                  {picking ? 'Скрыть' : 'Выбрать из vault…'}
                </button>
              </div>

              {/* Picker dropdown */}
              {picking && (
                <select value={c.vaultItemId || ''}
                        onChange={e => { set({ vaultItemId: e.target.value || undefined }); setPicking(false); }}
                        style={inputStyle} autoFocus>
                  <option value="">— выбрать из {vaultItems.length} записей —</option>
                  {vaultItems.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.folder ? `[${i.folder}] ` : ''}{i.name}
                    </option>
                  ))}
                </select>
              )}

              {/* Inline create form */}
              {creating && (
                <VaultCreateInline
                  device={device}
                  existingUsername={c.username}
                  onCreated={async (newId) => {
                    setCreating(false);
                    set({ vaultItemId: newId });
                    // Refresh list so the picker sees the new item too
                    const list = await vaultList();
                    setVaultItems(list);
                  }} />
              )}
            </div>
          )}
        </>
      )}

      <Field label="Заметки (к устройству)">
        <textarea value={c.notes || ''} onChange={e => set({ notes: e.target.value })}
                  rows={3} placeholder="Локальные заметки для схемы (не шифруются)"
                  style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
      </Field>

      <BoundVaultRecords deviceId={device.id} />
    </div>
  );
}

/**
 * v0.48 — Bitwarden-style card for the currently-linked vault item.
 * Read-only view with copy buttons + show/hide password + TOTP + unlink.
 */
function VaultLinkedCard({ item, copyOK, onCopy, showPw, setShowPw, onUnlink }: {
  item: any;
  copyOK: 'user' | 'pw' | 'url' | null;
  onCopy: (k: 'user' | 'pw' | 'url', text: string) => void;
  showPw: boolean; setShowPw: (b: boolean) => void;
  onUnlink: () => void;
}) {
  return (
    <div style={{
      background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 12px', borderBottom: '1px solid #F1F5F9',
        background: 'linear-gradient(135deg, #EEF2FF, #FFFFFF)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: '#4338CA', color: '#FFFFFF',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.name}
          </div>
          {item.folder && (
            <div style={{ fontSize: 10, color: '#64748B' }}>{item.folder}</div>
          )}
        </div>
        <button onClick={onUnlink}
                title="Отвязать запись от устройства (сама запись в vault остаётся)"
                style={{
                  fontSize: 10, color: '#DC2626', background: 'transparent',
                  border: '1px solid #FCA5A5', borderRadius: 4, padding: '3px 8px',
                  cursor: 'pointer', fontWeight: 600,
                }}>
          Отвязать
        </button>
      </div>

      {/* Fields */}
      <div style={{ padding: 12, display: 'grid', gap: 10 }}>
        {item.url && (
          <VaultField label="Website URL">
            <div style={{ display: 'flex', gap: 4 }}>
              <a href={item.url} target="_blank" rel="noreferrer"
                 style={{ ...inputStyle, flex: 1, textDecoration: 'none', color: '#2563EB',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          display: 'flex', alignItems: 'center' }}>
                {item.url}
              </a>
              <CopyBtn ok={copyOK === 'url'} onClick={() => onCopy('url', item.url)} />
            </div>
          </VaultField>
        )}
        {item.username && (
          <VaultField label="Username">
            <div style={{ display: 'flex', gap: 4 }}>
              <input readOnly value={item.username}
                     style={{ ...inputStyle, flex: 1, fontFamily: 'ui-monospace, monospace' }} />
              <CopyBtn ok={copyOK === 'user'} onClick={() => onCopy('user', item.username)} />
            </div>
          </VaultField>
        )}
        {item.password && (
          <VaultField label="Password">
            <div style={{ display: 'flex', gap: 4 }}>
              <input readOnly type={showPw ? 'text' : 'password'} value={item.password}
                     style={{ ...inputStyle, flex: 1, fontFamily: 'ui-monospace, monospace', letterSpacing: showPw ? 0 : 3 }} />
              <button onClick={() => setShowPw(!showPw)} title={showPw ? 'Скрыть' : 'Показать'}
                      style={{ ...btnSecondary, padding: '6px 8px' }}>
                {showPw ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.94 10.94 0 0112 20c-7 0-11-8-11-8a20.85 20.85 0 015.36-5.51"/><path d="M22.54 11.88A20.29 20.29 0 0012 4a10.86 10.86 0 00-2 .19"/><line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
              <CopyBtn ok={copyOK === 'pw'} onClick={() => onCopy('pw', item.password)}
                       title="Копировать пароль (авто-очистка через 45 сек)" />
            </div>
          </VaultField>
        )}
        {item.hasTotp && (
          <VaultField label="Verification code (TOTP)">
            <TotpChip itemId={item.id} size="sm" />
          </VaultField>
        )}
        {item.notes && (
          <VaultField label="Notes">
            <div style={{
              ...inputStyle, whiteSpace: 'pre-wrap', minHeight: 40, background: '#F8FAFC',
              fontFamily: 'inherit',
            }}>{item.notes}</div>
          </VaultField>
        )}

        {/* Action: full studio */}
        <button onClick={() => window.dispatchEvent(new CustomEvent('netmap:open-vault-studio'))}
                style={{
                  fontSize: 11, background: 'transparent', border: '1px solid #CBD5E1',
                  color: '#334155', borderRadius: 6, padding: '6px 10px', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'start',
                  fontWeight: 600,
                }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          Открыть в Vault Studio
        </button>
      </div>
    </div>
  );
}

function VaultField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, color: '#64748B',
                    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function CopyBtn({ ok, onClick, title }: { ok: boolean; onClick: () => void; title?: string }) {
  return (
    <button onClick={onClick} title={title || 'Копировать'} style={{
      ...btnSecondary, padding: '6px 10px',
      background: ok ? '#DCFCE7' : '#FFFFFF',
      color: ok ? '#166534' : '#374151',
      borderColor: ok ? '#86EFAC' : '#D1D5DB',
      fontWeight: 600, minWidth: 60,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 3,
    }}>
      {ok ? (
        <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M4 12l6 6L20 6"/></svg> OK</>
      ) : (
        <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy</>
      )}
    </button>
  );
}

/**
 * v0.48 — Inline «+ Добавить запись» form. Pre-fills url / username from
 * device fields (mgmtUrl / credential.username). Password field has «Generate»
 * button (16-char alphanumeric, no ambiguous chars).
 */
function VaultCreateInline({ device, existingUsername, onCreated }: {
  device: Device;
  existingUsername?: string;
  onCreated: (newItemId: string) => void;
}) {
  const [name, setName]     = useState(() => device.name);
  const [url, setUrl]       = useState(() => device.mgmtUrl || (device.ip ? `https://${device.ip}` : ''));
  const [username, setUser] = useState(() => existingUsername || '');
  const [password, setPw]   = useState('');
  const [notes, setNotes]   = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');
  const [showPw, setShowPw] = useState(false);

  const genPassword = () => {
    // 16-char alphanumeric, no confusing chars
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    const buf = new Uint8Array(16);
    (window.crypto || (window as any).msCrypto).getRandomValues(buf);
    let out = '';
    for (let i = 0; i < 16; i++) out += alphabet[buf[i] % alphabet.length];
    setPw(out);
    setShowPw(true);
  };

  const doSave = async () => {
    if (!name.trim()) { setErr('Введите название записи'); return; }
    setSaving(true); setErr('');
    try {
      const res = await vaultUpsert({
        name: name.trim(),
        url: url.trim() || undefined,
        username: username.trim() || undefined,
        password: password || undefined,
        notes: notes.trim() || undefined,
        boundDeviceIds: [device.id],
      } as any);
      if (res.ok && res.id) {
        onCreated(res.id);
      } else {
        setErr((res as any).locked ? 'Vault был заблокирован — повторите' : 'Не удалось сохранить');
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 10, padding: 12,
      display: 'grid', gap: 10,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#334155',
                    textTransform: 'uppercase', letterSpacing: 0.4 }}>
        Новая запись в vault
      </div>

      <VaultField label="Название записи *">
        <input value={name} onChange={e => setName(e.target.value)}
               placeholder="Например: MikroTik ядро"
               style={inputStyle} autoFocus />
      </VaultField>

      <VaultField label="URL / mgmt-адрес">
        <input value={url} onChange={e => setUrl(e.target.value)}
               placeholder="https://192.168.1.1"
               style={inputStyle} />
      </VaultField>

      <VaultField label="Username">
        <input value={username} onChange={e => setUser(e.target.value)}
               placeholder="admin"
               style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace' }} />
      </VaultField>

      <VaultField label="Password">
        <div style={{ display: 'flex', gap: 4 }}>
          <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPw(e.target.value)}
                 placeholder="••••••••"
                 style={{ ...inputStyle, flex: 1, fontFamily: 'ui-monospace, monospace' }} />
          <button onClick={() => setShowPw(!showPw)} title={showPw ? 'Скрыть' : 'Показать'}
                  style={{ ...btnSecondary, padding: '6px 8px' }}>
            {showPw ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17.94 17.94A10.94 10.94 0 0112 20c-7 0-11-8-11-8a20.85 20.85 0 015.36-5.51"/><path d="M22.54 11.88A20.29 20.29 0 0012 4a10.86 10.86 0 00-2 .19"/><line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
            )}
          </button>
          <button onClick={genPassword} title="Сгенерировать 16-символьный пароль"
                  style={{ ...btnSecondary, padding: '6px 10px', fontWeight: 600 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M8 7h.01M12 7h.01M16 7h.01M8 12h.01M12 12h.01M16 12h.01M8 17h.01M12 17h.01M16 17h.01"/>
            </svg>
          </button>
        </div>
      </VaultField>

      <VaultField label="Notes">
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  placeholder="Например: доступ только с VLAN 10"
                  style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
      </VaultField>

      {err && <div style={{ fontSize: 11, color: '#DC2626' }}>{err}</div>}

      <button onClick={doSave} disabled={saving || !name.trim()}
              style={{ ...btnPrimary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                       opacity: (saving || !name.trim()) ? 0.6 : 1 }}>
        {saving && <MiniSpinner light />}{saving ? 'Сохраняем…' : 'Сохранить и привязать'}
      </button>
    </div>
  );
}

/** Shows vault records whose boundDeviceIds contain this device — a "reverse
 *  index" complement to credential.vaultItemId (which is a single 1:1 link). */
function BoundVaultRecords({ deviceId }: { deviceId: string }) {
  const [items, setItems] = useState<Array<{ id: string; name: string; url?: string | null; boundDeviceIds?: string[] }>>([]);
  const [status, setStatus] = useState<string>('checking');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await vaultStatus();
      if (cancelled) return;
      setStatus(s.unlocked ? 'unlocked' : (s.initialized ? 'locked' : 'not-init'));
      if (!s.unlocked) return;
      const all = await vaultList();
      if (cancelled) return;
      const bound = all.filter((i: any) => (i.boundDeviceIds || []).includes(deviceId));
      setItems(bound as any);
    })();
    return () => { cancelled = true; };
  }, [deviceId]);

  if (status !== 'unlocked') return null;
  if (items.length === 0) return null;

  return (
    <div style={{ marginTop: 12, padding: 10, background: '#F8FAFC', borderRadius: 6, border: '1px solid #E5E7EB' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#64748B', fontWeight: 700, marginBottom: 6, letterSpacing: 0.3 }}>
        Также связаны из Vault ({items.length})
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        {items.map(it => (
          <button
            key={it.id}
            onClick={() => {
              window.dispatchEvent(new CustomEvent('netmap:open-vault-studio'));
              // Would be nice to auto-select the item — future improvement.
            }}
            style={{
              padding: '6px 8px', border: '1px solid #E5E7EB', borderRadius: 5,
              background: 'white', textAlign: 'left', cursor: 'pointer', width: '100%',
            }}
            title="Открыть в Vault Studio"
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: '#0F172A' }}>{it.name}</div>
            {it.url && <div style={{ fontSize: 9, color: '#64748B', marginTop: 1 }}>{it.url.replace(/^https?:\/\//, '')}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- helpers ---
// ==============================================================
// v0.35.2: HardwareTab — edit hostSpec / dvr / ssids on any device.
// Which subsections appear depends on `device.kind`:
//   server  → HostSpec (CPU/RAM/OS/disks/software) + DVR (channels/disks)
//   ap      → SSIDs (name/band/hidden/guest)
//   vm      → link back to InfoTab's vmInfo editor
//   other   → generic "no hardware editor yet" hint
// ==============================================================
function HardwareTab({ device, update }: {
  device: Device; update: (id: string, p: Partial<Device>) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {device.kind === 'ap' && <SsidEditor device={device} update={update} />}
      {device.kind === 'server' && (
        <>
          <HostSpecEditor device={device} update={update} />
          <DvrEditor device={device} update={update} />
          {!!device.dvr && <RegistrarCamerasEditor device={device} />}
        </>
      )}
      {device.kind === 'camera' && <CameraRegistrarEditor device={device} />}
      {device.kind === 'vm' && (
        <div style={{ padding: 10, background: '#F9FAFB', border: '1px solid #E5E7EB',
                      borderRadius: 8, fontSize: 12, color: '#6B7280' }}>
          Параметры VM (vCPU / RAM / OS / storage) редактируются в <b>Overview → Редактирование</b>.
        </div>
      )}
      {!['ap', 'server', 'vm', 'camera'].includes(device.kind) && (
        <div style={{ padding: 10, background: '#F9FAFB', border: '1px solid #E5E7EB',
                      borderRadius: 8, fontSize: 12, color: '#6B7280' }}>
          Для этого типа устройства пока нет отдельного редактора железа. Используйте <b>Overview → Редактирование</b> для базовых полей (модель, вендор, IP…).
        </div>
      )}
    </div>
  );
}

// v0.35.5 — Camera→Registrar link (from the camera side).
// The user picks which DVR/NVR records this camera. Both sides stay in sync:
// when we set attachedToRegistrarId on the camera, we ALSO add the camera id
// to the target DVR's cameraIds (and remove from the previous one). The two
// fields are redundant but each side needs its own list for rendering perf.
function CameraRegistrarEditor({ device }: { device: Device }) {
  const doc = useStore(s => s.doc);
  const updateDevice = useStore(s => s.updateDevice);
  // Any server with a `dvr` block qualifies as a registrar. Also allow
  // servers whose name/model matches the DVR keywords, so users don't have
  // to fill the DVR block first.
  const registrars = doc.devices.filter(d =>
    d.id !== device.id && (
      !!d.dvr || (d.kind === 'server' && /dvr|nvr|reg[_-]?cctv|trassir|hikvision|dahua/i.test(`${d.name} ${d.model || ''}`))
    )
  );
  const currentId = device.attachedToRegistrarId || '';
  const current = registrars.find(r => r.id === currentId);

  const pick = (newId: string | '') => {
    const oldId = device.attachedToRegistrarId || null;
    const nextId = newId || null;
    if (oldId === nextId) return;
    // 1) update the camera
    updateDevice(device.id, { attachedToRegistrarId: nextId });
    // 2) detach from previous registrar
    if (oldId) {
      const oldReg = doc.devices.find(d => d.id === oldId);
      if (oldReg) {
        const next = (oldReg.cameraIds || []).filter(id => id !== device.id);
        updateDevice(oldId, { cameraIds: next.length ? next : undefined });
      }
    }
    // 3) attach to new registrar
    if (nextId) {
      const newReg = doc.devices.find(d => d.id === nextId);
      if (newReg) {
        const cur = newReg.cameraIds || [];
        if (!cur.includes(device.id)) {
          updateDevice(nextId, { cameraIds: [...cur, device.id] });
        }
      }
    }
  };

  return (
    <section>
      <SectionHeader title="Запись видео" />
      <div style={{ display: 'grid', gap: 8 }}>
        <Field label="Пишет на регистратор">
          <select value={currentId} onChange={e => pick(e.target.value as any)} style={inputStyle}>
            <option value="">— не задано —</option>
            {registrars.map(r => (
              <option key={r.id} value={r.id}>
                {r.name}{r.dvr ? ` · ${r.dvr.channels}ch` : ''}{r.ip ? ` · ${r.ip}` : ''}
              </option>
            ))}
          </select>
        </Field>
        {current && (
          <div style={{
            padding: 8, background: '#ECFEFF', border: '1px solid #A5F3FC',
            borderRadius: 6, fontSize: 11, color: '#0F766E',
            display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 14 }}>📹</span>
            <div style={{ flex: 1, minWidth: 120 }}>
              <div style={{ fontWeight: 600, color: '#0F172A' }}>{current.name}</div>
              {current.dvr && (
                <div style={{ fontSize: 10, opacity: 0.85 }}>
                  {current.dvr.channels} канал.{current.dvr.resolution ? ` · ${current.dvr.resolution}` : ''}
                  {current.dvr.retentionDays ? ` · архив ~${current.dvr.retentionDays} дн.` : ''}
                </div>
              )}
            </div>
            <button onClick={() => pick('')} style={btnDangerSmall} title="Отвязать">✕</button>
          </div>
        )}
        {registrars.length === 0 && (
          <EmptyHint>Нет ни одного видеорегистратора в проекте. Создайте сервер и включите DVR-блок в его Hardware.</EmptyHint>
        )}
      </div>
    </section>
  );
}

// v0.35.5 — Registrar→Cameras list (from the DVR side).
// Shows attached cameras + lets the user attach/detach existing cameras from
// this project. Also updates the counterpart `attachedToRegistrarId` on each
// affected camera so both sides stay consistent.
function RegistrarCamerasEditor({ device }: { device: Device }) {
  const doc = useStore(s => s.doc);
  const updateDevice = useStore(s => s.updateDevice);
  const cameraIds = device.cameraIds || [];
  const allCameras = doc.devices.filter(d => d.kind === 'camera');
  const attached = allCameras.filter(c => cameraIds.includes(c.id));
  const unattached = allCameras.filter(c => !cameraIds.includes(c.id));

  const attach = (camId: string) => {
    if (cameraIds.includes(camId)) return;
    const cam = doc.devices.find(d => d.id === camId);
    if (!cam) return;
    // Detach from previous registrar if any
    const prevRegId = cam.attachedToRegistrarId;
    if (prevRegId && prevRegId !== device.id) {
      const prev = doc.devices.find(d => d.id === prevRegId);
      if (prev) {
        updateDevice(prevRegId, {
          cameraIds: (prev.cameraIds || []).filter(id => id !== camId).length
            ? (prev.cameraIds || []).filter(id => id !== camId)
            : undefined,
        });
      }
    }
    updateDevice(camId, { attachedToRegistrarId: device.id });
    updateDevice(device.id, { cameraIds: [...cameraIds, camId] });
  };
  const detach = (camId: string) => {
    updateDevice(camId, { attachedToRegistrarId: null });
    const next = cameraIds.filter(id => id !== camId);
    updateDevice(device.id, { cameraIds: next.length ? next : undefined });
  };

  const channelsLeft = device.dvr ? Math.max(0, device.dvr.channels - attached.length) : 0;

  return (
    <section>
      <SectionHeader title={`Подключённые камеры · ${attached.length}${device.dvr ? ` / ${device.dvr.channels}` : ''}`} />
      {device.dvr && attached.length > device.dvr.channels && (
        <div style={{
          padding: 8, marginBottom: 8, background: '#FEE2E2', border: '1px solid #FCA5A5',
          borderRadius: 6, fontSize: 11, color: '#B91C1C',
        }}>
          ⚠ Привязано больше камер ({attached.length}), чем каналов у регистратора ({device.dvr.channels}).
        </div>
      )}
      {attached.length === 0 ? (
        <EmptyHint>Нет привязанных камер. Выберите из списка ниже или на карточке камеры укажите этот регистратор.</EmptyHint>
      ) : (
        <div style={{ display: 'grid', gap: 4 }}>
          {attached.map(c => (
            <div key={c.id} style={{
              ...rowStyle, alignItems: 'center', gap: 8, padding: '5px 8px',
            }}>
              <span style={{ fontSize: 14 }}>🎥</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, color: '#111827',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.name}
                </div>
                {c.ip && <div style={{ fontSize: 10, color: '#6B7280', fontFamily: 'ui-monospace, monospace' }}>{c.ip}</div>}
              </div>
              <button onClick={() => detach(c.id)} style={btnDangerSmall} title="Отвязать камеру">✕</button>
            </div>
          ))}
        </div>
      )}
      {unattached.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <SectionSubHeader title={`Добавить камеру${channelsLeft > 0 ? ` · свободно ${channelsLeft} канал.` : ''}`} />
          <select
            value=""
            onChange={e => { if (e.target.value) attach(e.target.value); }}
            style={{ ...inputStyle, marginTop: 4 }}>
            <option value="">— выбрать из проекта —</option>
            {unattached.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.ip ? ` · ${c.ip}` : ''}
                {c.attachedToRegistrarId ? '  (уже привязана к другому)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
    </section>
  );
}

// ------- SSID editor (kind === 'ap') -------
function SsidEditor({ device, update }: {
  device: Device; update: (id: string, p: Partial<Device>) => void;
}) {
  const ssids = device.ssids || [];
  const setSsids = (next: NonNullable<Device['ssids']>) =>
    update(device.id, { ssids: next.length ? next : undefined });
  const add = () => setSsids([...ssids, { name: 'New-SSID', band: 'both' }]);
  const patch = (i: number, p: Partial<NonNullable<Device['ssids']>[number]>) =>
    setSsids(ssids.map((s, k) => k === i ? { ...s, ...p } : s));
  const remove = (i: number) => setSsids(ssids.filter((_, k) => k !== i));

  return (
    <section>
      <SectionHeader title="Wi-Fi SSID" onAdd={add} addLabel="+ SSID" />
      {ssids.length === 0 && (
        <EmptyHint>Пока не задано ни одной SSID. Нажмите «+ SSID» чтобы добавить.</EmptyHint>
      )}
      <div style={{ display: 'grid', gap: 6 }}>
        {ssids.map((s, i) => (
          <div key={i} style={{ ...rowStyle, alignItems: 'stretch', flexWrap: 'wrap' }}>
            <input value={s.name} onChange={e => patch(i, { name: e.target.value })}
                   placeholder="SSID"
                   style={{ ...inputStyle, flex: '1 1 140px', minWidth: 100 }} />
            <select value={s.band || 'both'} onChange={e => patch(i, { band: e.target.value as any })}
                    style={{ ...inputStyle, width: 90, flex: '0 0 auto' }}>
              <option value="both">2.4+5</option>
              <option value="2.4GHz">2.4 GHz</option>
              <option value="5GHz">5 GHz</option>
              <option value="6GHz">6 GHz</option>
            </select>
            <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, color: '#6B7280' }}>
              <input type="checkbox" checked={!!s.guest}
                     onChange={e => patch(i, { guest: e.target.checked || undefined })} />
              guest
            </label>
            <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, color: '#6B7280' }}>
              <input type="checkbox" checked={!!s.hidden}
                     onChange={e => patch(i, { hidden: e.target.checked || undefined })} />
              hidden
            </label>
            <button onClick={() => remove(i)} style={btnDangerSmall} title="Удалить SSID">✕</button>
          </div>
        ))}
      </div>
    </section>
  );
}

// ------- HostSpec editor (kind === 'server') -------
function HostSpecEditor({ device, update }: {
  device: Device; update: (id: string, p: Partial<Device>) => void;
}) {
  const h = device.hostSpec || {};
  const setH = (patch: Partial<NonNullable<Device['hostSpec']>>) =>
    update(device.id, { hostSpec: { ...h, ...patch } });
  const disks = h.disks || [];
  const setDisks = (next: NonNullable<NonNullable<Device['hostSpec']>['disks']>) =>
    setH({ disks: next.length ? next : undefined });
  const addDisk = () => setDisks([...disks, { sizeGB: 500, kind: 'SSD' }]);
  const patchDisk = (i: number, p: Partial<{ sizeGB: number; kind: 'HDD'|'SSD'|'NVMe'; model?: string; role?: string }>) =>
    setDisks(disks.map((d, k) => k === i ? { ...d, ...p } : d));
  const rmDisk = (i: number) => setDisks(disks.filter((_, k) => k !== i));

  const sw = h.software || [];
  const swInput = sw.join(', ');

  return (
    <section>
      <SectionHeader title="Железо и ОС" />
      <div style={{ display: 'grid', gap: 8 }}>
        <Field label="CPU">
          <input value={h.cpu || ''} onChange={e => setH({ cpu: e.target.value || undefined })}
                 placeholder="Xeon E-2288G · 8c/16t · 3.7GHz" style={inputStyle} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="RAM (GB)">
            <input type="number" min={0} value={h.ramGb ?? ''}
                   onChange={e => setH({ ramGb: e.target.value ? +e.target.value : undefined })}
                   style={inputStyle} />
          </Field>
          <Field label="Форм-фактор">
            <select value={h.formFactor || ''} onChange={e => setH({ formFactor: (e.target.value || undefined) as any })}
                    style={inputStyle}>
              <option value="">—</option>
              <option value="1U">1U</option>
              <option value="2U">2U</option>
              <option value="4U">4U</option>
              <option value="Tower">Tower</option>
              <option value="Mini">Mini</option>
            </select>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
          <Field label="ОС">
            <input value={h.os || ''} onChange={e => setH({ os: e.target.value || undefined })}
                   placeholder="Windows Server / Ubuntu / Proxmox …" style={inputStyle} />
          </Field>
          <Field label="Версия">
            <input value={h.osVersion || ''} onChange={e => setH({ osVersion: e.target.value || undefined })}
                   placeholder="22.04 / 2019 …" style={inputStyle} />
          </Field>
        </div>
        <Field label="ПО (через запятую)">
          <input value={swInput}
                 onChange={e => setH({ software: e.target.value.split(',').map(x => x.trim()).filter(Boolean).length
                                       ? e.target.value.split(',').map(x => x.trim()).filter(Boolean)
                                       : undefined })}
                 placeholder="nginx, PostgreSQL 15, Docker 24 …" style={inputStyle} />
        </Field>

        <SectionSubHeader title="Диски" onAdd={addDisk} addLabel="+ Диск" />
        {disks.length === 0 && <EmptyHint>Нет дисков.</EmptyHint>}
        <div style={{ display: 'grid', gap: 6 }}>
          {disks.map((d, i) => (
            <div key={i} style={{ ...rowStyle, alignItems: 'stretch', flexWrap: 'wrap' }}>
              <input type="number" min={1} value={d.sizeGB}
                     onChange={e => patchDisk(i, { sizeGB: +e.target.value || 0 })}
                     placeholder="GB"
                     style={{ ...inputStyle, width: 80, flex: '0 0 80px' }} />
              <select value={d.kind || 'HDD'} onChange={e => patchDisk(i, { kind: e.target.value as any })}
                      style={{ ...inputStyle, width: 80, flex: '0 0 80px' }}>
                <option value="HDD">HDD</option>
                <option value="SSD">SSD</option>
                <option value="NVMe">NVMe</option>
              </select>
              <input value={d.model || ''} onChange={e => patchDisk(i, { model: e.target.value || undefined })}
                     placeholder="Модель"
                     style={{ ...inputStyle, flex: '1 1 100px', minWidth: 100 }} />
              <input value={d.role || ''} onChange={e => patchDisk(i, { role: e.target.value || undefined })}
                     placeholder="Роль (system / VM store …)"
                     style={{ ...inputStyle, flex: '1 1 100px', minWidth: 100 }} />
              <button onClick={() => rmDisk(i)} style={btnDangerSmall} title="Удалить диск">✕</button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ------- DVR editor (kind === 'server') -------
function DvrEditor({ device, update }: {
  device: Device; update: (id: string, p: Partial<Device>) => void;
}) {
  const v = device.dvr;
  const setV = (patch: Partial<NonNullable<Device['dvr']>>) =>
    update(device.id, { dvr: { ...(v || { channels: 8 }), ...patch } });
  const clear = () => update(device.id, { dvr: undefined });
  const disks = v?.disks || [];
  const setDisks = (next: NonNullable<NonNullable<Device['dvr']>['disks']>) =>
    setV({ disks: next.length ? next : undefined });
  const addDisk = () => setDisks([...disks, { sizeGB: 2048, kind: 'HDD' }]);
  const patchDisk = (i: number, p: Partial<{ sizeGB: number; kind: 'HDD'|'SSD'; model?: string }>) =>
    setDisks(disks.map((d, k) => k === i ? { ...d, ...p } : d));
  const rmDisk = (i: number) => setDisks(disks.filter((_, k) => k !== i));

  return (
    <section>
      <SectionHeader title="Видеорегистратор (DVR/NVR)"
        onAdd={v ? undefined : () => setV({ channels: 8, resolution: '1080p' })}
        addLabel={v ? undefined : '+ Настроить DVR'} />
      {!v ? (
        <EmptyHint>Устройство не помечено как DVR. Нажмите «+ Настроить DVR» чтобы добавить блок с каналами и дисками.</EmptyHint>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Каналов всего">
              <input type="number" min={1} max={256} value={v.channels}
                     onChange={e => setV({ channels: +e.target.value || 1 })}
                     style={inputStyle} />
            </Field>
            <Field label="Активных сейчас">
              <input type="number" min={0} max={v.channels} value={v.activeChannels ?? ''}
                     onChange={e => setV({ activeChannels: e.target.value ? +e.target.value : undefined })}
                     style={inputStyle} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Разрешение">
              <select value={v.resolution || ''} onChange={e => setV({ resolution: e.target.value || undefined })}
                      style={inputStyle}>
                <option value="">—</option>
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="4MP">4 MP</option>
                <option value="5MP">5 MP</option>
                <option value="4K">4K</option>
              </select>
            </Field>
            <Field label="Хранение, дней">
              <input type="number" min={0} value={v.retentionDays ?? ''}
                     onChange={e => setV({ retentionDays: e.target.value ? +e.target.value : undefined })}
                     placeholder="30" style={inputStyle} />
            </Field>
          </div>
          <Field label="ПО (TRASSIR / Xeoma / Hikvision …)">
            <input value={v.software || ''} onChange={e => setV({ software: e.target.value || undefined })}
                   style={inputStyle} />
          </Field>

          <SectionSubHeader title="Диски для архива" onAdd={addDisk} addLabel="+ Диск" />
          {disks.length === 0 && <EmptyHint>Нет дисков.</EmptyHint>}
          <div style={{ display: 'grid', gap: 6 }}>
            {disks.map((d, i) => (
              <div key={i} style={{ ...rowStyle, alignItems: 'stretch', flexWrap: 'wrap' }}>
                <input type="number" min={1} value={d.sizeGB}
                       onChange={e => patchDisk(i, { sizeGB: +e.target.value || 0 })}
                       placeholder="GB"
                       style={{ ...inputStyle, width: 80, flex: '0 0 80px' }} />
                <select value={d.kind || 'HDD'} onChange={e => patchDisk(i, { kind: e.target.value as any })}
                        style={{ ...inputStyle, width: 80, flex: '0 0 80px' }}>
                  <option value="HDD">HDD</option>
                  <option value="SSD">SSD</option>
                </select>
                <input value={d.model || ''} onChange={e => patchDisk(i, { model: e.target.value || undefined })}
                       placeholder="Модель (WD Purple / SkyHawk …)"
                       style={{ ...inputStyle, flex: '1 1 120px', minWidth: 100 }} />
                <button onClick={() => rmDisk(i)} style={btnDangerSmall} title="Удалить диск">✕</button>
              </div>
            ))}
          </div>

          {(disks.length > 0) && (
            <div style={{ fontSize: 11, color: '#6B7280', textAlign: 'right', marginTop: -2 }}>
              Итого: {(disks.reduce((s, x) => s + (x.sizeGB || 0), 0) / 1024).toFixed(1)} TB
            </div>
          )}

          <button onClick={clear} style={{ ...btnDanger, justifySelf: 'start', marginTop: 4 }}>
            Убрать DVR-блок
          </button>
        </div>
      )}
    </section>
  );
}

// ------- Small helpers -------
function SectionHeader({ title, onAdd, addLabel }: {
  title: string; onAdd?: () => void; addLabel?: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      marginBottom: 6,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#6B7280',
                     textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</span>
      {onAdd && (
        <button onClick={onAdd} style={{
          background: 'transparent', border: '1px solid #D1D5DB',
          color: '#374151', padding: '2px 8px', borderRadius: 4,
          fontSize: 11, cursor: 'pointer',
        }}>{addLabel}</button>
      )}
    </div>
  );
}
function SectionSubHeader({ title, onAdd, addLabel }: {
  title: string; onAdd?: () => void; addLabel?: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      marginTop: 6,
    }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF',
                     textTransform: 'uppercase', letterSpacing: 0.4 }}>{title}</span>
      {onAdd && (
        <button onClick={onAdd} style={{
          background: 'transparent', border: '1px solid #E5E7EB',
          color: '#6B7280', padding: '1px 6px', borderRadius: 4,
          fontSize: 10, cursor: 'pointer',
        }}>{addLabel}</button>
      )}
    </div>
  );
}
function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: 8, background: '#F9FAFB', border: '1px dashed #E5E7EB',
      borderRadius: 6, fontSize: 11, color: '#9CA3AF', fontStyle: 'italic',
    }}>{children}</div>
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
  width: 360, background: '#FFFFFF', borderLeft: '1px solid #E5E7EB',
  display: 'flex', flexDirection: 'column', height: '100%',
  color: '#111827',
};
const inputStyle: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827',
  padding: '6px 8px', borderRadius: 6, fontSize: 12, outline: 'none', width: '100%'
};
const rowStyle: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'center',
  background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6, padding: '6px 8px'
};
const tabBtn: React.CSSProperties = {
  background: 'transparent', color: '#6B7280', border: 'none',
  padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
};
const tabBtnActive: React.CSSProperties = { background: '#EFF6FF', color: '#2563EB', fontWeight: 600 };
const btnPrimary: React.CSSProperties = {
  background: '#2563EB', border: 'none', color: '#FFFFFF',
  padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
};
const btnSecondary: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#374151',
  padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 500,
};
const btnDanger: React.CSSProperties = {
  background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#B91C1C',
  padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
};
const btnDangerSmall: React.CSSProperties = { ...btnDanger, padding: '2px 6px' };
const linkBtn: React.CSSProperties = {
  background: '#2563EB', color: '#FFFFFF', padding: '6px 10px',
  borderRadius: 6, textDecoration: 'none', fontSize: 12, whiteSpace: 'nowrap',
};

// -----------------------------------------------------------------------------
// VlansTab — per-device VLAN assignment (access PVID + trunk allowed list).
// Also shows a summary of which VLANs are actually observed on this device's
// ports/links.

import { VlanBadge } from './VlansPanel';

/**
 * v0.48 — VlansTab full rewrite. Adds:
 *   • Explicit port mode dropdown (Access / Trunk / Hybrid / off)
 *   • Native VLAN separately from allowed list for trunks
 *   • Inline «+ Создать VLAN» form (no need to jump to left panel)
 *   • Validation: access mode ignores allowed-list, trunk requires ≥1 tagged
 *   • Bulk-mode dropdown: apply same access/trunk to all selected ports
 *   • Live warnings when link.vlan doesn't match port.vlan
 */
function VlansTab({ device, update }: {
  device: Device;
  update: (id: string, p: Partial<Device>) => void;
}) {
  const projectVlans = useStore(s => s.doc.vlans) || (EMPTY_VLANS as import('./types').Vlan[]);
  const addVlan = useStore(s => s.addVlan);
  const links = useStore(s => s.doc.links);
  const [showAllPorts, setShowAllPorts] = useState(false);
  const [creatingVlan, setCreatingVlan] = useState(false);

  // Collect distinct VLAN IDs referenced anywhere on this device
  const observed = new Set<number>();
  for (const p of device.ports) {
    if (p.vlan != null) observed.add(p.vlan);
    for (const v of p.vlans || []) observed.add(v);
  }
  for (const l of links) {
    if (l.fromDeviceId !== device.id && l.toDeviceId !== device.id) continue;
    if (l.vlan != null) observed.add(l.vlan);
    for (const v of l.vlans || []) observed.add(v);
  }

  const observedList = Array.from(observed).sort((a, b) => a - b);
  const vlanById = new Map(projectVlans.map(v => [v.vlanId, v]));

  const portsToShow = showAllPorts
    ? device.ports
    : device.ports.filter(p => p.vlan != null || (p.vlans && p.vlans.length > 0) || p.vlanMode);

  // ---- port mutators -----------------------------------------------------
  const updatePort = (portId: string, patch: Partial<Port>) => {
    update(device.id, {
      ports: device.ports.map(p => p.id === portId ? { ...p, ...patch } : p),
    });
  };
  const setPortMode = (portId: string, mode: PortVlanMode | undefined) => {
    // Clean up incoherent fields when switching modes.
    updatePort(portId, {
      vlanMode: mode,
      // If becoming pure access, drop allowed-list (kept native as PVID).
      ...(mode === 'access' ? { vlans: undefined } : {}),
    });
  };

  // ---- inline VLAN creation ----------------------------------------------
  const [newVlan, setNewVlan] = useState<{ id: string; name: string; cidr: string; color: string }>(() => {
    const nextId = suggestNextVlanId(projectVlans);
    return { id: String(nextId), name: '', cidr: '', color: vlanColorForIndex(projectVlans.length) };
  });
  useEffect(() => {
    // Refresh suggested next id whenever projectVlans changes and form is not open.
    if (!creatingVlan) {
      setNewVlan(s => ({ ...s, id: String(suggestNextVlanId(projectVlans)),
                                 color: vlanColorForIndex(projectVlans.length) }));
    }
  }, [projectVlans.length, creatingVlan]);
  const doCreateVlan = () => {
    const vlanId = parseInt(newVlan.id, 10);
    if (!Number.isFinite(vlanId) || vlanId < 1 || vlanId > 4094) return;
    if (projectVlans.some(v => v.vlanId === vlanId)) return; // already exists
    addVlan({
      id: `vlan-${vlanId}-${Math.random().toString(36).slice(2, 6)}`,
      vlanId, name: newVlan.name || `VLAN ${vlanId}`,
      cidr: newVlan.cidr || undefined,
      color: newVlan.color,
    });
    setCreatingVlan(false);
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* ============ Summary of VLANs seen on this device ============ */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
          <div style={{ fontSize: 10, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            VLAN на устройстве
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 10, color: '#64748B' }}>
            найдено: <b>{observedList.length}</b>
          </div>
        </div>
        {observedList.length === 0 ? (
          <div style={{ fontSize: 11, opacity: 0.55, padding: '8px 10px',
                        background: '#FFFFFF', border: '1px dashed #D1D5DB', borderRadius: 6 }}>
            Ни на одном порту не задан VLAN
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {observedList.map(vid => {
              const v = vlanById.get(vid);
              const isDefined = !!v;
              return (
                <div key={vid} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px 4px 4px',
                  background: isDefined ? '#FFFFFF' : '#FEF2F2',
                  border: `1px solid ${isDefined ? '#D1D5DB' : '#FCA5A5'}`,
                  borderRadius: 999,
                }}
                title={isDefined ? (v?.cidr || '') : 'Не определён в проекте — клик чтобы добавить'}
                onClick={() => {
                  if (!isDefined) {
                    setNewVlan(s => ({ ...s, id: String(vid), name: `VLAN ${vid}` }));
                    setCreatingVlan(true);
                  }
                }}
                >
                  <VlanBadge id={vid} color={v?.color || '#6B7280'} size="sm" />
                  <span style={{ fontSize: 11, color: '#111827' }}>
                    {v?.name || '(добавить в проект)'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ============ Inline VLAN creator ============ */}
      <div>
        {!creatingVlan ? (
          <button onClick={() => setCreatingVlan(true)} style={{
            ...btnSecondary, display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Создать VLAN
          </button>
        ) : (
          <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 8, padding: 10, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Новый VLAN в проекте
              </div>
              <button onClick={() => setCreatingVlan(false)} style={{
                marginLeft: 'auto', background: 'transparent', border: 'none', color: '#94A3B8',
                cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 2,
              }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 6 }}>
              <input value={newVlan.id} onChange={e => setNewVlan(s => ({ ...s, id: e.target.value.replace(/\D/g, '') }))}
                     placeholder="ID" style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace', textAlign: 'center' }}
                     maxLength={4} />
              <input value={newVlan.name} onChange={e => setNewVlan(s => ({ ...s, name: e.target.value }))}
                     placeholder="Имя (например GUEST)" style={inputStyle} />
            </div>
            <input value={newVlan.cidr} onChange={e => setNewVlan(s => ({ ...s, cidr: e.target.value }))}
                   placeholder="CIDR: 192.168.20.0/24 (необязательно)" style={inputStyle} />
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: '#64748B', marginRight: 4 }}>Цвет:</span>
              {VLAN_COLORS.slice(0, 9).map(c => (
                <button key={c} onClick={() => setNewVlan(s => ({ ...s, color: c }))}
                        style={{
                          width: 20, height: 20, borderRadius: '50%', background: c,
                          border: newVlan.color === c ? '2px solid #0F172A' : '2px solid transparent',
                          cursor: 'pointer',
                        }} />
              ))}
            </div>
            {parseInt(newVlan.id, 10) > 0 && projectVlans.some(v => v.vlanId === parseInt(newVlan.id, 10)) && (
              <div style={{ fontSize: 10, color: '#DC2626' }}>VLAN {newVlan.id} уже существует в проекте</div>
            )}
            <button onClick={doCreateVlan}
                    disabled={!newVlan.id || projectVlans.some(v => v.vlanId === parseInt(newVlan.id, 10))}
                    style={{ ...btnPrimary, opacity: (!newVlan.id) ? 0.5 : 1 }}>
              Добавить VLAN
            </button>
          </div>
        )}
      </div>

      {projectVlans.length === 0 && !creatingVlan && (
        <div style={{
          padding: 10, background: '#FEF3C7', border: '1px solid #D97706',
          color: '#78350F', borderRadius: 6, fontSize: 11,
        }}>
          В проекте нет VLAN. Нажмите <b>Создать VLAN</b> выше — можно назначать на порты.
        </div>
      )}

      {/* ============ Per-port VLAN table ============ */}
      {projectVlans.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 10, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Порты и VLAN
            </div>
            {device.ports.length > 8 && (
              <button onClick={() => setShowAllPorts(v => !v)}
                      style={{ ...tabBtn, marginLeft: 'auto', fontSize: 10 }}>
                {showAllPorts ? 'Только с VLAN' : `Все ${device.ports.length} портов`}
              </button>
            )}
          </div>

          {portsToShow.length === 0 ? (
            <div style={{ fontSize: 11, opacity: 0.55, padding: '8px 10px',
                          background: '#FFFFFF', border: '1px dashed #D1D5DB', borderRadius: 6 }}>
              Порты без VLAN. Нажмите «Все N портов» чтобы назначить.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {portsToShow.map(p => (
                <PortVlanRowV2 key={p.id}
                             port={p}
                             projectVlans={projectVlans}
                             updatePort={(patch) => updatePort(p.id, patch)}
                             setMode={(mode) => setPortMode(p.id, mode)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * v0.48 — new per-port row with explicit mode dropdown, native VLAN, and
 * mode-aware controls. Supersedes PortVlanRow.
 */
function PortVlanRowV2({ port, projectVlans, updatePort, setMode }: {
  port: Port;
  projectVlans: Vlan[];
  updatePort: (patch: Partial<Port>) => void;
  setMode: (mode: PortVlanMode | undefined) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const vlanById = new Map(projectVlans.map(v => [v.vlanId, v]));

  // Effective mode: explicit → use it. Legacy: trunk if vlans[] non-empty.
  const mode: PortVlanMode | undefined = port.vlanMode
    ?? ((port.vlans && port.vlans.length > 0) ? 'trunk' : (port.vlan != null ? 'access' : undefined));

  const accessVlan = port.vlan != null ? vlanById.get(port.vlan) : null;
  const nativeVlan = mode === 'trunk' && port.vlan != null ? vlanById.get(port.vlan) : null;

  const modeColors: Record<PortVlanMode, { bg: string; fg: string; label: string }> = {
    access:  { bg: '#DBEAFE', fg: '#1D4ED8', label: 'Access' },
    trunk:   { bg: '#F3E8FF', fg: '#7E22CE', label: 'Trunk' },
    hybrid:  { bg: '#FEF3C7', fg: '#92400E', label: 'Hybrid' },
  };

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', borderRadius: 6, overflow: 'hidden' }}>
      <div onClick={() => setExpanded(v => !v)}
           style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer' }}>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#111827',
                       minWidth: 46, fontWeight: 700 }}>
          {port.id.toUpperCase()}
        </span>
        {mode && (
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: 0.4,
            padding: '2px 6px', borderRadius: 999,
            background: modeColors[mode].bg, color: modeColors[mode].fg,
          }}>{modeColors[mode].label.toUpperCase()}</span>
        )}
        <div style={{ flex: 1, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }}>
          {mode === 'access' && accessVlan && (
            <VlanBadge id={accessVlan.vlanId} color={accessVlan.color} size="sm" />
          )}
          {mode === 'trunk' && (
            <>
              {nativeVlan && (
                <span title="Native VLAN (untagged)" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  padding: '1px 5px', borderRadius: 4,
                  background: '#F1F5F9', fontSize: 9, color: '#475569',
                }}>
                  <span style={{ fontWeight: 700 }}>native:</span>
                  <VlanBadge id={nativeVlan.vlanId} color={nativeVlan.color} size="sm" />
                </span>
              )}
              {(port.vlans || []).map(vid => {
                const v = vlanById.get(vid);
                return <VlanBadge key={vid} id={vid} color={v?.color || '#6B7280'} size="sm" />;
              })}
            </>
          )}
          {mode === 'hybrid' && (
            <>
              {accessVlan && <VlanBadge id={accessVlan.vlanId} color={accessVlan.color} size="sm" />}
              {(port.vlans || []).length > 0 && (
                <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 4 }}>+ tagged:</span>
              )}
              {(port.vlans || []).map(vid => {
                const v = vlanById.get(vid);
                return <VlanBadge key={vid} id={vid} color={v?.color || '#6B7280'} size="sm" />;
              })}
            </>
          )}
          {!mode && (
            <span style={{ fontSize: 10, opacity: 0.4, fontStyle: 'italic' }}>без VLAN</span>
          )}
        </div>
        <span style={{ fontSize: 11, color: '#6B7280' }}>{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid #E5E7EB', padding: 10, display: 'grid', gap: 10, background: '#F8FAFC' }}>
          {/* Mode selector */}
          <div>
            <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Режим порта
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
              {(['off', 'access', 'trunk', 'hybrid'] as const).map(m => {
                const isOff = m === 'off';
                const active = isOff ? !mode : mode === m;
                const modeVal = isOff ? undefined : (m as PortVlanMode);
                const info: Record<string, { label: string; bg: string; fg: string }> = {
                  off:    { label: 'Off',     bg: '#F1F5F9', fg: '#64748B' },
                  access: { label: 'Access',  bg: '#DBEAFE', fg: '#1D4ED8' },
                  trunk:  { label: 'Trunk',   bg: '#F3E8FF', fg: '#7E22CE' },
                  hybrid: { label: 'Hybrid',  bg: '#FEF3C7', fg: '#92400E' },
                };
                const c = info[m];
                return (
                  <button key={m}
                    onClick={() => {
                      if (isOff) {
                        // Clear mode + VLAN state entirely
                        updatePort({ vlanMode: undefined, vlan: undefined, vlans: undefined });
                      } else {
                        setMode(modeVal);
                      }
                    }}
                    style={{
                      padding: '5px 8px', borderRadius: 5,
                      border: `1px solid ${active ? c.fg : '#D1D5DB'}`,
                      background: active ? c.bg : '#FFFFFF',
                      color: active ? c.fg : '#475569',
                      fontSize: 11, fontWeight: active ? 700 : 500, cursor: 'pointer',
                    }}>{c.label}</button>
                );
              })}
            </div>
            <div style={{ fontSize: 10, color: '#64748B', marginTop: 5, minHeight: 26 }}>
              {mode === 'access' && 'Один untagged VLAN. Порт для конечного устройства (PC / IP-камера / принтер).'}
              {mode === 'trunk'  && 'Несколько tagged VLAN. Обычно uplink между свитчами. Native = untagged.'}
              {mode === 'hybrid' && 'Один untagged + несколько tagged. Используется на Cisco/HP для смешанных портов.'}
              {!mode && 'Порт без VLAN — трафик default VLAN 1.'}
            </div>
          </div>

          {/* Access VLAN or Native VLAN (depends on mode) */}
          {(mode === 'access' || mode === 'trunk' || mode === 'hybrid') && (
            <div>
              <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {mode === 'access' ? 'Access VLAN (untagged)' :
                 mode === 'trunk'  ? 'Native VLAN (untagged на trunk)' :
                                     'Untagged (access-часть hybrid)'}
              </div>
              <select value={port.vlan ?? ''}
                      onChange={e => updatePort({ vlan: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                      style={{ ...inputStyle, width: '100%' }}>
                <option value="">— не задан —</option>
                {projectVlans.map(v => (
                  <option key={v.id} value={v.vlanId}>VLAN {v.vlanId} · {v.name}{v.cidr ? ` · ${v.cidr}` : ''}</option>
                ))}
              </select>
            </div>
          )}

          {/* Trunk allowed list — only for trunk/hybrid */}
          {(mode === 'trunk' || mode === 'hybrid') && (
            <div>
              <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Tagged VLAN (allowed list)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {projectVlans.map(v => {
                  const on = (port.vlans || []).includes(v.vlanId);
                  const isNative = port.vlan === v.vlanId;
                  return (
                    <button key={v.id}
                            title={isNative ? 'Этот VLAN уже native (untagged) — обычно не добавляют в allowed' : (v.cidr || v.name)}
                            onClick={() => {
                              const cur = new Set(port.vlans || []);
                              if (cur.has(v.vlanId)) cur.delete(v.vlanId); else cur.add(v.vlanId);
                              updatePort({ vlans: cur.size ? Array.from(cur).sort((a, b) => a - b) : undefined });
                            }}
                            style={{
                              padding: '4px 9px', borderRadius: 999,
                              border: `1.5px solid ${on ? v.color : '#D1D5DB'}`,
                              background: on ? v.color : 'transparent',
                              color: on ? '#FFFFFF' : '#6B7280',
                              fontSize: 10, fontWeight: 700, cursor: 'pointer',
                              fontFamily: 'ui-monospace, monospace',
                              opacity: isNative && on ? 0.75 : 1,
                            }}>
                      {v.vlanId}
                    </button>
                  );
                })}
              </div>
              {mode === 'trunk' && (port.vlans || []).length === 0 && (
                <div style={{ fontSize: 10, color: '#DC2626', marginTop: 5 }}>
                  Trunk без tagged VLAN — фактически то же самое, что access-порт с native.
                </div>
              )}
            </div>
          )}

          {/* Delete port button — kept minimal */}
          {port.notes != null && (
            <div>
              <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 4 }}>Заметки</div>
              <input value={port.notes || ''} onChange={e => updatePort({ notes: e.target.value })}
                     placeholder="Куда идёт кабель…" style={{ ...inputStyle, width: '100%' }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Suggest next unused VLAN id — 10, 20, 30, … then jumps to next free integer. */
function suggestNextVlanId(existing: Vlan[]): number {
  const set = new Set(existing.map(v => v.vlanId));
  for (const seed of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
    if (!set.has(seed)) return seed;
  }
  for (let i = 1; i < 4094; i++) if (!set.has(i)) return i;
  return 1;
}

// -----------------------------------------------------------------------------
// PortMatrix — grid of colored squares showing port speed at a glance.
// Matches the "Port Matrix" section on the reference mockup.
//
// Color scheme (fixed):
//   1 Gbps  → #10B981 (green)
//   10 Gbps → #3B82F6 (blue)
//   2.5G    → #14B8A6 (teal)
//   100M    → #94A3B8 (slate)
//   disabled/down → #4B5563 (gray)
//   error   → #EF4444 (red)

function PortMatrix({ device, onSelect }: {
  device: Device;
  onSelect: (portId: string) => void;
}) {
  const setPortHighlight = useStore(s => s.setPortHighlight);
  const highlightPortId = useStore(s => s.highlightPortId);
  const highlightLinkId = useStore(s => s.highlightLinkId);
  const links = useStore(s => s.doc.links);
  // v0.19: bulk-select of ports via Shift-click / Ctrl-click. When >= 1 port is
  // selected we show a mini action bar with Set VLAN / Set Speed / Toggle PoE.
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<string | null>(null);

  // Clear bulk selection when the device changes (moving to another switch).
  useEffect(() => {
    setBulkSelected(new Set());
    lastClickedRef.current = null;
  }, [device.id]);
  // Map portId → linkId (if that port is connected). Lets us dim/hilite squares.
  const portToLinkId = new Map<string, string>();
  for (const l of links) {
    if (l.fromDeviceId === device.id && l.fromPortId) portToLinkId.set(l.fromPortId, l.id);
    if (l.toDeviceId === device.id && l.toPortId) portToLinkId.set(l.toPortId, l.id);
  }
  const cols = Math.min(12, Math.max(6, Math.ceil(device.ports.length / 2)));
  // Show first-half then second-half in two rows (like real switch faceplates)
  // but only if 12+ ports. Otherwise single row.
  const rows: Port[][] = [];
  if (device.ports.length > cols) {
    for (let i = 0; i < device.ports.length; i += cols) rows.push(device.ports.slice(i, i + cols));
  } else {
    rows.push(device.ports);
  }

  return (
    <div style={{ marginBottom: 12, padding: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={sectionH}>Port Matrix</div>
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <LegendDot color="#10B981" label="1 Gbps" />
        <LegendDot color="#3B82F6" label="10 Gbps" />
        <LegendDot color="#E5E7EB" label="Disabled" />
      </div>

      <div style={{ display: 'grid', gap: 3 }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 3,
          }}>
            {row.map(p => {
              const col = portMatrixColor(p);
              const idxLabel = p.id.replace(/[^0-9]/g, '') || p.id.slice(0, 2).toUpperCase();
              const key = `${device.id}:${p.id}`;
              const isHighlighted = highlightPortId === key ||
                (!!portToLinkId.get(p.id) && highlightLinkId === portToLinkId.get(p.id));
              const linkId = portToLinkId.get(p.id);
              const isBulkSelected = bulkSelected.has(p.id);
              return (
                <button
                  key={p.id}
                  onClick={(e) => {
                    if (e.shiftKey || e.ctrlKey || e.metaKey) {
                      // Bulk-select mode: toggle this port; shift+click supports range from lastClicked
                      const next = new Set(bulkSelected);
                      if (e.shiftKey && lastClickedRef.current && lastClickedRef.current !== p.id) {
                        // Range: select every port between last and current in the flat ports array
                        const ids = device.ports.map(x => x.id);
                        const a = ids.indexOf(lastClickedRef.current);
                        const b = ids.indexOf(p.id);
                        if (a >= 0 && b >= 0) {
                          const [lo, hi] = a < b ? [a, b] : [b, a];
                          for (let i = lo; i <= hi; i++) next.add(ids[i]);
                        }
                      } else if (next.has(p.id)) {
                        next.delete(p.id);
                      } else {
                        next.add(p.id);
                      }
                      setBulkSelected(next);
                      lastClickedRef.current = p.id;
                      setPortHighlight(device.id, p.id);
                    } else {
                      // Plain click — clear bulk selection, open editor
                      setBulkSelected(new Set());
                      lastClickedRef.current = p.id;
                      setPortHighlight(device.id, p.id);
                      onSelect(p.id);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setPortHighlight(device.id, p.id);
                  }}
                  title={`${p.id.toUpperCase()} · ${p.type || 'RJ45'} · ${p.speed || '—'} · ${p.status || 'down'}${p.uplink ? ' · uplink' : ''}${p.poeActive ? ' · PoE' : ''}${linkId ? ' · есть кабель' : ''}\n(Shift+клик — выделить диапазон, Ctrl+клик — добавить в выборку)`}
                  style={{
                    aspectRatio: '1',
                    background: col.bg,
                    border: isBulkSelected
                      ? '2px solid #2563EB'
                      : p.uplink ? '2px solid #F59E0B' : '1px solid rgba(0,0,0,0.05)',
                    borderRadius: 4,
                    color: col.text,
                    fontSize: 10,
                    fontFamily: 'ui-monospace, monospace',
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: 0,
                    minHeight: 24,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    outline: isHighlighted ? '2px solid #F59E0B' : 'none',
                    outlineOffset: 1,
                    boxShadow: isHighlighted ? '0 0 0 3px rgba(245,158,11,0.35)' : 'none',
                    transition: 'transform 0.08s, box-shadow 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.transform = 'none'}
                >
                  {idxLabel}
                </button>
              );
            })}
            {/* Pad the last row so alignment matches the mockup */}
            {row.length < cols && Array.from({ length: cols - row.length }).map((_, i) => (
              <div key={`pad-${i}`} />
            ))}
          </div>
        ))}
      </div>

      {bulkSelected.size > 0 && (
        <BulkPortActions
          device={device}
          selectedPorts={bulkSelected}
          onDone={() => setBulkSelected(new Set())} />
      )}
    </div>
  );
}

/**
 * Floating actions strip shown under the Port Matrix when the user has
 * shift/ctrl-selected multiple ports. Applies changes to all selected ports
 * at once — the classic "select and apply" workflow that avoids clicking
 * into every port individually on a 48-port switch.
 */
function BulkPortActions({ device, selectedPorts, onDone }: {
  device: Device; selectedPorts: Set<string>; onDone: () => void;
}) {
  const projectVlans = useStore(s => s.doc.vlans) || (EMPTY_VLANS as import('./types').Vlan[]);
  const updateDevice = useStore(s => s.updateDevice);
  const [openMenu, setOpenMenu] = useState<null | 'vlan' | 'speed'>(null);

  const applyPatch = (patch: Partial<Port>) => {
    updateDevice(device.id, {
      ports: device.ports.map(p => selectedPorts.has(p.id) ? { ...p, ...patch } : p),
    });
  };

  const togglePoe = () => {
    const anyOn = device.ports.some(p => selectedPorts.has(p.id) && p.poeActive);
    updateDevice(device.id, {
      ports: device.ports.map(p => selectedPorts.has(p.id)
        ? { ...p, poeActive: !anyOn, poe: !anyOn || p.poe }
        : p),
    });
  };

  const setSpeed = (speed: Port['speed'] | undefined) => {
    applyPatch({ speed });
    setOpenMenu(null);
  };

  const setVlan = (vid: number | undefined) => {
    applyPatch({ vlan: vid });
    setOpenMenu(null);
  };

  return (
    <div style={{
      marginTop: 8, padding: '8px 10px',
      background: '#EFF6FF', border: '1px solid #93C5FD', borderRadius: 6,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      position: 'relative',
    }}>
      <span style={{
        background: '#2563EB', color: '#FFFFFF',
        padding: '2px 8px', borderRadius: 999,
        fontSize: 10, fontWeight: 700,
      }}>
        {selectedPorts.size} портов
      </span>

      {/* VLAN dropdown */}
      <div style={{ position: 'relative' }}>
        <button onClick={() => setOpenMenu(openMenu === 'vlan' ? null : 'vlan')}
                style={bulkBtn}>
          VLAN ▾
        </button>
        {openMenu === 'vlan' && (
          <>
            <div onClick={() => setOpenMenu(null)}
                 style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
            <div style={bulkDropdown}>
              <div onClick={() => setVlan(undefined)} style={bulkItem}>
                <span style={{ color: '#9CA3AF' }}>—</span> Снять VLAN
              </div>
              {projectVlans.length === 0 && (
                <div style={{ ...bulkItem, color: '#9CA3AF', cursor: 'default' }}>
                  В проекте нет VLAN
                </div>
              )}
              {projectVlans.map(v => (
                <div key={v.id} onClick={() => setVlan(v.vlanId)} style={bulkItem}>
                  <span style={{
                    display: 'inline-block',
                    background: v.color, color: '#FFFFFF',
                    fontSize: 9, fontWeight: 800,
                    padding: '1px 5px', borderRadius: 999,
                    fontFamily: 'ui-monospace, monospace',
                    minWidth: 24, textAlign: 'center', marginRight: 6,
                  }}>{v.vlanId}</span>
                  {v.name}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Speed dropdown */}
      <div style={{ position: 'relative' }}>
        <button onClick={() => setOpenMenu(openMenu === 'speed' ? null : 'speed')}
                style={bulkBtn}>
          Скорость ▾
        </button>
        {openMenu === 'speed' && (
          <>
            <div onClick={() => setOpenMenu(null)}
                 style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
            <div style={bulkDropdown}>
              {(['100M', '1G', '2.5G', '10G'] as const).map(s => (
                <div key={s} onClick={() => setSpeed(s)} style={bulkItem}>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{s}</span>
                </div>
              ))}
              <div onClick={() => setSpeed(undefined)} style={{ ...bulkItem, color: '#9CA3AF' }}>
                — Сбросить
              </div>
            </div>
          </>
        )}
      </div>

      <button onClick={togglePoe} style={bulkBtn}>⚡ PoE</button>
      <button onClick={() => { applyPatch({ status: 'up' }); }} style={bulkBtn}>Up</button>
      <button onClick={() => { applyPatch({ status: 'disabled' }); }} style={bulkBtn}>Disable</button>

      <div style={{ flex: 1 }} />

      <button onClick={onDone} style={{
        ...bulkBtn, background: 'transparent', border: '1px solid transparent',
        color: '#6B7280',
      }} title="Снять выделение">✕</button>
    </div>
  );
}

const bulkBtn: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #93C5FD', color: '#1E40AF',
  padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
  fontSize: 11, fontWeight: 600,
};
const bulkDropdown: React.CSSProperties = {
  position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 50,
  background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 6,
  padding: '4px 0', minWidth: 180, maxHeight: 240, overflowY: 'auto',
  boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
};
const bulkItem: React.CSSProperties = {
  padding: '6px 10px', fontSize: 11, cursor: 'pointer', color: '#111827',
  display: 'flex', alignItems: 'center',
};

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#6B7280', fontSize: 10 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

/**
 * Port Matrix cell colour scheme (pastel, matches the reference mockup).
 * Returns { bg, text } — text stays readable on the pastel background.
 */
function portMatrixColor(p: Port): { bg: string; text: string } {
  if (p.status === 'error')    return { bg: '#FEE2E2', text: '#B91C1C' };
  if (p.status === 'disabled') return { bg: '#E5E7EB', text: '#9CA3AF' };
  const s = p.speed || '1G';
  if (p.status === 'down')     return { bg: '#E5E7EB', text: '#9CA3AF' };
  if (s === '10G')             return { bg: '#3B82F6', text: '#FFFFFF' };
  if (s === '2.5G')            return { bg: '#14B8A6', text: '#FFFFFF' };
  if (s === '100M')            return { bg: '#F1F5F9', text: '#64748B' };
  // 1G / PoE default — bright green pill like the mockup
  return { bg: '#10B981', text: '#FFFFFF' };
}

// -----------------------------------------------------------------------------
// AlertsTab — device-scoped feed of ping status transitions (up/down/flap).

function AlertsTab({ deviceId }: { deviceId: string }) {
  // Select the raw alerts array (stable reference until it truly changes),
  // then filter locally. Doing .filter() inside the selector would return a
  // new array on every render → infinite render loop (React error #185).
  const allAlerts = useStore(s => s.alerts);
  const alerts = useMemo(() => allAlerts.filter(a => a.deviceId === deviceId),
                         [allAlerts, deviceId]);

  if (alerts.length === 0) {
    return (
      <div style={{ padding: '32px 12px', textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>
        Событий пока нет.<br />
        Когда устройство пропадёт или восстановит связь — здесь появится запись.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {alerts.map(a => (
        <div key={a.id} style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '8px 10px',
          background: a.kind === 'down' ? '#FEF2F2' : '#F0FDF4',
          border: `1px solid ${a.kind === 'down' ? '#FECACA' : '#BBF7D0'}`,
          borderRadius: 6,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', marginTop: 6,
            background: a.kind === 'down' ? '#EF4444' : '#10B981', flexShrink: 0,
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: '#111827' }}>{a.message}</div>
            <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
              {new Date(a.ts).toLocaleString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// ConfigTab — raw JSON view of the selected device with copy + download.

function ConfigTab({ device }: { device: Device }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(device, (_k, v) => {
    // Strip transient runtime fields — they're noise in the exported config.
    if (_k === 'liveStatus' || _k === 'lastRttMs' || _k === 'lastCheckedAt') return undefined;
    return v;
  }, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const download = () => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${device.name.replace(/[^\w-]+/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const bytes = new Blob([json]).size;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={sectionH}>Raw JSON</div>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#9CA3AF' }}>
          {bytes} байт · {device.ports.length} портов
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={copy}
                style={{
                  flex: 1,
                  background: copied ? '#D1FAE5' : '#FFFFFF',
                  border: `1px solid ${copied ? '#10B981' : '#D1D5DB'}`,
                  color: copied ? '#065F46' : '#374151',
                  padding: '7px 12px', borderRadius: 6,
                  fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {copied
              ? <path d="M20 6L9 17l-5-5"/>
              : (<><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>)}
          </svg>
          {copied ? 'Скопировано' : 'Копировать JSON'}
        </button>
        <button onClick={download}
                style={{
                  flex: 1,
                  background: '#FFFFFF', border: '1px solid #D1D5DB',
                  color: '#374151',
                  padding: '7px 12px', borderRadius: 6,
                  fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Скачать .json
        </button>
      </div>

      <pre style={{
        margin: 0,
        background: '#0F172A', color: '#E5E7EB',
        border: '1px solid #1F2937', borderRadius: 6,
        padding: 12,
        fontSize: 11, lineHeight: 1.5,
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        overflow: 'auto',
        maxHeight: 480,
      }}>
        <code>{json}</code>
      </pre>

      <div style={{ fontSize: 10, color: '#9CA3AF', lineHeight: 1.5 }}>
        Runtime-поля (liveStatus, lastRttMs, lastCheckedAt) исключены.
        Можно вставить полученный JSON обратно через File-меню → Импортировать проект.
      </div>
    </div>
  );
}
