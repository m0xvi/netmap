import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useMemo, useState } from 'react';
import { useStore } from './store';
import type { Device } from './types';
import { ICONS, KIND_META } from './icons';
import { StickyStack } from './StickyStack';
import { LiveStatusDot } from './DeviceNode';
import { inferLayer, LAYER_META } from './layers';

// (focusDevice is read inside the component from the store)

interface Data {
  device: Device;
  highlighted?: boolean;
}

export function ServerNode({ id, data, selected }: NodeProps<any>) {
  const d = (data as Data).device;
  const highlighted = (data as Data).highlighted;
  // v0.35.4: DVR/NVR gets its own icon + tinted colour so it doesn't look
  // like a generic server. A device is "recognized" as a recorder if `dvr`
  // is set OR the model/name contains a known DVR keyword.
  const isDvr = !!d.dvr ||
    /dvr|nvr|reg[_-]?cctv|trassir|hikvision|dahua/i.test(`${d.name} ${d.model || ''}`);
  const meta = isDvr
    ? { ...KIND_META.server, label: 'DVR', color: '#0891B2', bg: '#ECFEFF' }
    : KIND_META.server;
  const Icon = isDvr ? ICONS.dvr : ICONS.server;
  const updateDevice = useStore(s => s.updateDevice);
  const focusDevice = useStore(s => s.focusDevice);
  const select = useStore(s => s.select);
  const doc = useStore(s => s.doc);
  const [nodeHover, setNodeHover] = useState(false);

  const isExpanded = d.display === 'rack';
  const border = selected ? '#fff' : highlighted ? '#fde047' : meta.color;

  const vms = useMemo(
    () => doc.devices.filter(x => x.kind === 'vm' && x.hostDeviceId === d.id),
    [doc.devices, d.id]
  );

  // ---- COMPACT: same look as DeviceNode ----
  if (!isExpanded) {
    return (
      <div
        onMouseEnter={() => setNodeHover(true)}
        onMouseLeave={() => setNodeHover(false)}
        onDoubleClick={(e) => { e.stopPropagation(); focusDevice(id); }}
        style={{
          position: 'relative',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          // v0.35: give server-compact a proper solid card just like the other
          // device kinds — previously the background was transparent so on a
          // pale group tint the card looked "floating", the IP chip (dark on
          // dark) was unreadable and the outline wasn't visible.
          padding: '8px 10px', minWidth: 100, maxWidth: 150,
          borderRadius: 10,
          background: '#FFFFFF',
          border: `1.5px solid ${selected ? '#2563EB' : highlighted ? '#F59E0B' : '#E5E7EB'}`,
          boxShadow: selected
            ? '0 0 0 2px #2563EB, 0 4px 12px rgba(15,23,42,0.10)'
            : '0 1px 3px rgba(15,23,42,0.08)',
          color: '#111827', cursor: 'grab', transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
        title={`Двойной клик — раскрыть${vms.length ? ` (${vms.length} VM)` : ''}`}
      >
        <StickyStack deviceId={d.id} />
        {d.liveStatus && d.liveStatus !== "unknown" && (
          <LiveStatusDot status={d.liveStatus} rttMs={d.lastRttMs} at={d.lastCheckedAt} />
        )}
        {(() => { const l = LAYER_META[inferLayer(d)]; return (
          <div title={`${l.label} · ${l.description}`} style={{
            position: 'absolute', left: -2, top: -2, bottom: -2, width: 4,
            background: l.color, borderRadius: '3px 0 0 3px',
            boxShadow: `0 0 4px ${l.color}88`, pointerEvents: 'none', zIndex: 1,
          }} />
        ); })()}

        <div style={{ color: meta.color, display: 'flex',
                      filter: 'drop-shadow(0 1px 2px rgba(15,23,42,0.12))' }}>
          <Icon size={44} />
        </div>
        <div style={{ fontWeight: 600, fontSize: 10, textShadow: 'none',
                      textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      maxWidth: 120 }}>{d.name}</div>
        {d.ip && (
          <div style={{ fontSize: 9, color: '#4B5563', fontFamily: 'ui-monospace, monospace',
                        background: '#F3F4F6', padding: '1px 6px', borderRadius: 3 }}>{d.ip}</div>
        )}
        {vms.length > 0 && (
          <div style={{ fontSize: 9, color: '#7C3AED', background: '#F5F3FF',
                        padding: '1px 6px', borderRadius: 3, marginTop: 1 }}>
            {vms.length} VM
          </div>
        )}
        {/* v0.35: DVR/NVR summary chip — channels + storage */}
        {d.dvr && (
          <div style={{ fontSize: 9, color: '#0891B2', background: '#ECFEFF',
                        padding: '1px 6px', borderRadius: 3, marginTop: 1,
                        display: 'flex', gap: 6, alignItems: 'center' }}>
            <span>📹 {d.dvr.channels}ch</span>
            {d.dvr.disks && d.dvr.disks.length > 0 && (
              <span style={{ color: '#155E75' }}>
                {d.dvr.disks.length}×{Math.round(d.dvr.disks.reduce((s, x) => s + (x.sizeGB || 0), 0) / 1024)}TB
              </span>
            )}
          </div>
        )}
        <CompactHandles device={d} />
      </div>
    );
  }

  // ---- EXPANDED: card with hardware/OS spec, DVR summary and VM list ----
  return (
    <div
      onMouseEnter={() => setNodeHover(true)}
      onMouseLeave={() => setNodeHover(false)}
      onDoubleClick={(e) => { e.stopPropagation(); focusDevice(id); }}
      style={{
        position: 'relative',
        width: 300,
        // v0.35: light-themed card matching the rest of the redesign — the
        // previous dark bg + heavy shadow read as "night mode" and clashed
        // with switches / DeviceNode. Uses a subtle tinted header (meta.bg)
        // and a white body.
        background: '#FFFFFF',
        border: `1.5px solid ${selected ? '#2563EB' : highlighted ? '#F59E0B' : '#E5E7EB'}`,
        borderRadius: 10,
        color: '#111827', fontSize: 11,
        boxShadow: selected
          ? '0 0 0 2px #2563EB, 0 6px 14px rgba(15,23,42,0.10)'
          : '0 2px 8px rgba(15,23,42,0.08)',
        cursor: 'grab',
        overflow: 'hidden',
      }}
      // v0.35: no browser tooltip — those swallow hover on child buttons
    >
      <StickyStack deviceId={d.id} />
      {d.liveStatus && d.liveStatus !== "unknown" && (
        <LiveStatusDot status={d.liveStatus} rttMs={d.lastRttMs} at={d.lastCheckedAt} />
      )}
      {(() => { const l = LAYER_META[inferLayer(d)]; return (
        <div title={`${l.label} · ${l.description}`} style={{
          position: 'absolute', left: -2, top: -2, bottom: -2, width: 4,
          background: l.color, borderRadius: '3px 0 0 3px',
          boxShadow: `0 0 4px ${l.color}88`, pointerEvents: 'none', zIndex: 1,
        }} />
      ); })()}

      {/* Header — light theme, OS badge in top-right corner */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px 8px',
        borderBottom: '1px solid #F3F4F6', background: meta.bg,
      }}>
        <div style={{ color: meta.color, display: 'flex',
                      filter: 'drop-shadow(0 1px 2px rgba(15,23,42,0.12))' }}>
          <Icon size={28} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: '#111827',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {d.name}
          </div>
          <div style={{ fontSize: 10, color: '#6B7280',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {d.model || 'SERVER'}{d.ip ? ` · ${d.ip}` : ''}
          </div>
        </div>
        {/* v0.35: OS badge in the corner (Windows/Linux/Proxmox/etc.) */}
        {(d.hostSpec?.os || d.dvr?.software) && (
          <OsBadge os={d.hostSpec?.os || d.dvr?.software || ''} />
        )}
        <button
          className="nodrag"
          onClick={(e) => { e.stopPropagation(); updateDevice(id, { display: 'compact' }); }}
          title="Свернуть"
          style={{
            background: '#F9FAFB', border: '1px solid #E5E7EB',
            color: '#6B7280', borderRadius: 4, padding: '1px 5px',
            fontSize: 10, cursor: 'pointer',
          }}
        >◲</button>
      </div>

      {d.location && (
        <div style={{ fontSize: 10, color: '#9CA3AF', padding: '4px 12px 0' }}>📍 {d.location}</div>
      )}

      {/* v0.35: hardware spec block — CPU / RAM / OS / disks */}
      {d.hostSpec && (d.hostSpec.cpu || d.hostSpec.ramGb || d.hostSpec.disks?.length) && (
        <div style={{
          padding: '8px 12px', borderBottom: '1px solid #F3F4F6', fontSize: 10,
          color: '#374151', display: 'grid', gap: 3,
        }}>
          {d.hostSpec.cpu && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={specLabel}>CPU</span>
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    title={d.hostSpec.cpu}>{d.hostSpec.cpu}</span>
            </div>
          )}
          {(d.hostSpec.ramGb != null) && (
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={specLabel}>RAM</span>
              <span>{d.hostSpec.ramGb} GB</span>
            </div>
          )}
          {d.hostSpec.os && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={specLabel}>OS</span>
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    title={`${d.hostSpec.os}${d.hostSpec.osVersion ? ' ' + d.hostSpec.osVersion : ''}`}>
                {d.hostSpec.os}{d.hostSpec.osVersion ? ` ${d.hostSpec.osVersion}` : ''}
              </span>
            </div>
          )}
          {d.hostSpec.disks && d.hostSpec.disks.length > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={specLabel}>DISK</span>
              <span style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {d.hostSpec.disks.map((dk, i) => (
                  <span key={i} title={`${dk.kind || ''} ${dk.model || ''} ${dk.role || ''}`.trim()}
                    style={{ background: '#F1F5F9', color: '#0F172A', padding: '0 5px',
                             borderRadius: 3, fontFamily: 'ui-monospace, monospace', fontSize: 9 }}>
                    {dk.sizeGB >= 1024 ? `${(dk.sizeGB / 1024).toFixed(dk.sizeGB % 1024 === 0 ? 0 : 1)}TB` : `${dk.sizeGB}GB`}
                    {dk.kind ? ` ${dk.kind}` : ''}
                  </span>
                ))}
              </span>
            </div>
          )}
          {d.hostSpec.software && d.hostSpec.software.length > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={specLabel}>SW</span>
              <span style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {d.hostSpec.software.slice(0, 6).map((s, i) => (
                  <span key={i} style={{
                    background: '#EFF6FF', color: '#1D4ED8', padding: '0 5px',
                    borderRadius: 3, fontSize: 9,
                  }}>{s}</span>
                ))}
                {d.hostSpec.software.length > 6 && (
                  <span style={{ fontSize: 9, color: '#9CA3AF' }}>+{d.hostSpec.software.length - 6}</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {/* v0.35: DVR / NVR panel — channels, disks, retention */}
      {d.dvr && (
        <div style={{
          padding: '8px 12px', borderBottom: '1px solid #F3F4F6', fontSize: 10,
          color: '#0F766E', background: '#F0FDFA',
          display: 'grid', gap: 3,
        }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ ...specLabel, color: '#0F766E' }}>ВИДЕО</span>
            <span style={{ fontWeight: 600 }}>
              📹 {d.dvr.channels} канал{d.dvr.channels % 10 === 1 && d.dvr.channels !== 11 ? '' : d.dvr.channels % 10 >= 2 && d.dvr.channels % 10 <= 4 && (d.dvr.channels < 12 || d.dvr.channels > 14) ? 'а' : 'ов'}
              {d.dvr.activeChannels != null ? ` · ${d.dvr.activeChannels} активн.` : ''}
            </span>
          </div>
          {d.dvr.resolution && (
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{ ...specLabel, color: '#0F766E' }}>КАЧ-ВО</span>
              <span>{d.dvr.resolution}</span>
            </div>
          )}
          {d.dvr.disks && d.dvr.disks.length > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={{ ...specLabel, color: '#0F766E' }}>ДИСКИ</span>
              <span style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {d.dvr.disks.map((dk, i) => (
                  <span key={i} title={`${dk.kind || 'HDD'} ${dk.model || ''}`.trim()}
                    style={{ background: '#CCFBF1', color: '#134E4A', padding: '0 5px',
                             borderRadius: 3, fontFamily: 'ui-monospace, monospace', fontSize: 9 }}>
                    {dk.sizeGB >= 1024 ? `${(dk.sizeGB / 1024).toFixed(dk.sizeGB % 1024 === 0 ? 0 : 1)}TB` : `${dk.sizeGB}GB`}
                    {dk.kind ? ` ${dk.kind}` : ''}
                  </span>
                ))}
                <span style={{ color: '#0F766E', fontSize: 9, alignSelf: 'center' }}>
                  = {(d.dvr.disks.reduce((s, x) => s + (x.sizeGB || 0), 0) / 1024).toFixed(1)}TB всего
                </span>
              </span>
            </div>
          )}
          {d.dvr.retentionDays != null && (
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{ ...specLabel, color: '#0F766E' }}>АРХИВ</span>
              <span>~{d.dvr.retentionDays} дней</span>
            </div>
          )}
        </div>
      )}

      {/* VM list — hidden completely for pure DVR-only devices with 0 VMs */}
      {(vms.length > 0 || !d.dvr) && (
      <div style={{ padding: '8px 10px 10px' }}>
        <div style={{
          fontSize: 9, color: '#9CA3AF', marginBottom: 4,
          fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
        }}>
          Virtual Machines · {vms.length}
        </div>
        {vms.length === 0 ? (
          <div style={{
            fontSize: 10, color: '#9CA3AF', fontStyle: 'italic',
            padding: '10px 6px', textAlign: 'center',
            border: '1px dashed #E5E7EB', borderRadius: 6,
          }}>
            Нет VM. Создайте VM в палитре и выберите этот сервер как хост.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 3 }}>
            {vms.map(vm => (
              <VMRow key={vm.id} vm={vm} onClick={() => select(vm.id)}
                     onPopOut={() => {
                       // Detach VM: place it on canvas next to server, keep hostDeviceId
                       // (relation still shows as "hosted on" dashed line)
                       updateDevice(vm.id, { hostDeviceId: null });
                     }} />
            ))}
          </div>
        )}
      </div>
      )}

      {/* Ports (right side) */}
      {d.ports.map((port, idx) => {
        const pct = ((idx + 1) / (d.ports.length + 1)) * 100;
        return (
          <div key={port.id}
               style={{
                 position: 'absolute', right: -5,
                 top: `${pct}%`, transform: 'translateY(-50%)',
                 width: 10, height: 10, borderRadius: 3,
                 background: port.status === 'up' ? '#D1FAE5' : '#E5E7EB',
                 border: `1.5px solid ${port.status === 'up' ? '#10B981' : '#9CA3AF'}`,
               }}
               title={`${port.id}${port.label ? ' → ' + port.label : ''}`}
          >
            <Handle type="source" id={port.id} position={Position.Right}
                    style={{ width: 8, height: 8, background: 'transparent', border: 'none' }} />
            <Handle type="target" id={port.id} position={Position.Right}
                    style={{ width: 8, height: 8, background: 'transparent', border: 'none' }} />
          </div>
        );
      })}
    </div>
  );
}

function VMRow({ vm, onClick, onPopOut }: {
  vm: Device; onClick: () => void; onPopOut: () => void;
}) {
  const [hover, setHover] = useState(false);
  const meta = KIND_META.vm;
  const Icon = ICONS.vm;

  return (
    <div
      className="nodrag"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 6px',
        background: hover ? meta.bg : '#F9FAFB',
        border: `1px solid ${hover ? meta.color + '55' : '#F3F4F6'}`,
        borderRadius: 4, cursor: 'pointer',
        transition: 'all 0.1s',
        color: '#111827',
      }}
    >
      <div style={{ color: meta.color, display: 'flex', flexShrink: 0 }}>
        <Icon size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: '#111827',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {vm.name}
        </div>
        {(vm.ip || vm.vmInfo) && (
          <div style={{ fontSize: 9, color: '#6B7280', fontFamily: 'ui-monospace, monospace' }}>
            {vm.ip || ''}{vm.vmInfo?.vcpu ? ` · ${vm.vmInfo.vcpu}vCPU` : ''}
            {vm.vmInfo?.ramGb ? `/${vm.vmInfo.ramGb}GB` : ''}
          </div>
        )}
      </div>
      {hover && (
        <button
          onClick={(e) => { e.stopPropagation(); onPopOut(); }}
          title="Вынести VM на канвас (отвязать от хоста визуально)"
          style={{
            background: 'transparent', border: `1px solid ${meta.color}66`,
            color: meta.color, borderRadius: 3, fontSize: 9,
            padding: '1px 4px', cursor: 'pointer',
          }}
        >⇱</button>
      )}
    </div>
  );
}

/** v0.21 fix — same as DeviceNode/CompactHandles: expose one handle per port
    so cables referencing specific port ids ('phys', 'virt', 'lan', …) actually
    connect visually instead of collapsing into the node centre. */
function CompactHandles({ device }: { device: Device }) {
  const s = { width: 8, height: 8, background: 'transparent', border: 'none' } as const;
  return (
    <>
      {device.ports.map((p, idx) => {
        const pct = ((idx + 1) / (device.ports.length + 1)) * 100;
        return (
          <div key={p.id}>
            <Handle id={p.id} type="source" position={Position.Right} style={{ ...s, top: `${pct}%` }} />
            <Handle id={p.id} type="target" position={Position.Right} style={{ ...s, top: `${pct}%` }} />
          </div>
        );
      })}
      <Handle id="_top"    type="source" position={Position.Top}    style={s} />
      <Handle id="_top"    type="target" position={Position.Top}    style={s} />
      <Handle id="_right"  type="source" position={Position.Right}  style={s} />
      <Handle id="_right"  type="target" position={Position.Right}  style={s} />
      <Handle id="_bottom" type="source" position={Position.Bottom} style={s} />
      <Handle id="_bottom" type="target" position={Position.Bottom} style={s} />
      <Handle id="_left"   type="source" position={Position.Left}   style={s} />
      <Handle id="_left"   type="target" position={Position.Left}   style={s} />
    </>
  );
}

// ---- v0.35: helper styles + OsBadge component ----

const specLabel: React.CSSProperties = {
  fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4,
  color: '#9CA3AF', textTransform: 'uppercase',
  minWidth: 32, flexShrink: 0,
};

/**
 * Small pill in the server header showing the OS family.
 * We detect the family from the free-form string (Windows / Linux distro /
 * Proxmox / ESXi / etc.) and colour-code it. Recorder software (TRASSIR /
 * Xeoma / Hikvision) also gets its own pill.
 */
function OsBadge({ os }: { os: string }) {
  const low = os.toLowerCase();
  let bg = '#F3F4F6', color = '#374151', label = os.split(/\s+/)[0].toUpperCase();
  let icon: string | null = null;
  if (/windows|win\b|winserver/.test(low))      { bg = '#DBEAFE'; color = '#1E40AF'; label = 'WIN'; icon = '⊞'; }
  else if (/proxmox|pve/.test(low))              { bg = '#FEE2E2'; color = '#B91C1C'; label = 'PROXMOX'; }
  else if (/esxi|vsphere|vmware/.test(low))      { bg = '#DBEAFE'; color = '#1D4ED8'; label = 'ESXi'; }
  else if (/ubuntu/.test(low))                   { bg = '#FFE4C4'; color = '#9A3412'; label = 'UBUNTU'; }
  else if (/debian/.test(low))                   { bg = '#FCE7F3'; color = '#9D174D'; label = 'DEBIAN'; }
  else if (/centos|rhel|redhat|fedora|rocky|alma/.test(low))
                                                 { bg = '#FEE2E2'; color = '#B91C1C'; label = 'RHEL'; }
  else if (/linux|kernel/.test(low))             { bg = '#FEF3C7'; color = '#92400E'; label = 'LINUX'; icon = '🐧'; }
  else if (/trassir/.test(low))                  { bg = '#EDE9FE'; color = '#5B21B6'; label = 'TRASSIR'; }
  else if (/xeoma/.test(low))                    { bg = '#D1FAE5'; color = '#065F46'; label = 'XEOMA'; }
  else if (/hik|ivms|dahua/.test(low))           { bg = '#FEE2E2'; color = '#B91C1C'; label = 'CCTV'; }
  else if (/mikrotik|routeros/.test(low))        { bg = '#DBEAFE'; color = '#1E40AF'; label = 'ROS'; }

  return (
    <span
      title={os}
      style={{
        fontSize: 9, fontWeight: 700, letterSpacing: 0.4,
        padding: '2px 7px', borderRadius: 4,
        background: bg, color, whiteSpace: 'nowrap',
        display: 'inline-flex', alignItems: 'center', gap: 3,
      }}>
      {icon && <span style={{ fontSize: 10 }}>{icon}</span>}
      {label}
    </span>
  );
}
