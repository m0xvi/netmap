import { useEffect, useMemo, useState } from 'react';
import { useStore } from './store';
import { ICONS, KIND_META } from './icons';
import type { Device, Port, Link } from './types';
import { StickyStack } from './StickyStack';
import { confirmDialog, alertDialog, promptText } from './Modal';
import { vaultStatus, vaultList, vaultGet, vaultUnlock, type VaultItemFull } from './vaultClient';
import { bestVaultMatch } from './vaultMatcher';

/**
 * Full-screen "focus mode" — one device is enlarged and centered,
 * background is dimmed. Every port is shown big with a label of what's connected
 * (icon + name of neighbor). Escape / backdrop click = close.
 *
 * v0.9.2: ports are now INTERACTIVE — click free port to attach a new cable,
 * click connected port to reassign/disconnect.
 */
export function FocusView() {
  const focusedId = useStore(s => s.focusedDeviceId);
  const doc = useStore(s => s.doc);
  const close = () => useStore.getState().focusDevice(null);

  useEffect(() => {
    if (!focusedId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusedId]);

  const device = focusedId ? doc.devices.find(d => d.id === focusedId) : null;

  const links = useMemo(() => {
    if (!device) return [];
    return doc.links.filter(l => l.fromDeviceId === device.id || l.toDeviceId === device.id);
  }, [device, doc.links]);

  const deviceById = useMemo(() => new Map(doc.devices.map(d => [d.id, d])), [doc.devices]);

  if (!device) return null;

  const meta = KIND_META[device.kind];
  const Icon = ICONS[device.kind];

  const portConnections = device.ports.map(port => {
    const link = links.find(l =>
      (l.fromDeviceId === device.id && l.fromPortId === port.id) ||
      (l.toDeviceId === device.id && l.toPortId === port.id));
    if (!link) return { port, neighbor: null as Device | null, neighborPortId: undefined as string | undefined, link: null as Link | null };
    const neighborId = link.fromDeviceId === device.id ? link.toDeviceId : link.fromDeviceId;
    const neighborPortId = link.fromDeviceId === device.id ? link.toPortId : link.fromPortId;
    return { port, neighbor: deviceById.get(neighborId) || null, neighborPortId, link };
  });

  const useTwoColumns = device.ports.length > 8;
  const col1 = useTwoColumns ? portConnections.slice(0, Math.ceil(portConnections.length / 2)) : portConnections;
  const col2 = useTwoColumns ? portConnections.slice(Math.ceil(portConnections.length / 2)) : [];

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(6px)',
        zIndex: 5000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 40,
        animation: 'netmap-focus-fade 220ms ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          background: meta.bg,
          border: `3px solid ${meta.color}`,
          borderRadius: 16,
          minWidth: 640,
          width: 'min(1000px, 90vw)',
          maxHeight: '86vh',
          overflow: 'auto',
          color: '#111827',
          boxShadow: `0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px ${meta.color}66`,
          animation: 'netmap-focus-pop 260ms cubic-bezier(.34,1.56,.64,1)',
          padding: '20px 24px',
        }}
      >
        <div style={{ position: 'absolute', top: 30, left: 40 }}>
          <StickyStack deviceId={device.id} />
        </div>

        <button
          onClick={close}
          title="Закрыть (Esc)"
          style={{
            position: 'absolute', top: 12, right: 12,
            background: '#FFFFFF', border: '1px solid #E5E7EB', color: '#6B7280',
            width: 32, height: 32, borderRadius: 8,
            cursor: 'pointer', fontSize: 16, lineHeight: 1,
            boxShadow: '0 1px 3px rgba(15,23,42,0.08)',
          }}
        >✕</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div style={{ color: meta.color, filter: `drop-shadow(0 4px 12px ${meta.color})` }}>
            <Icon size={64} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{device.name}</div>
            <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>
              {meta.label} · {device.vendor || ''} {device.model || ''}
              {device.ip && ` · ${device.ip}`}
              {device.location && ` · loc: ${device.location}`}
            </div>
            <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
              {device.ports.length} портов ·
              {' '}{portConnections.filter(pc => pc.neighbor).length} занято ·
              {' '}{portConnections.filter(pc => !pc.neighbor).length} свободно
            </div>
          </div>
          <QuickActions device={device} />
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: useTwoColumns ? '1fr 1fr' : '1fr',
          gap: '8px 20px',
        }}>
          <PortColumn ports={col1} device={device} />
          {useTwoColumns && <PortColumn ports={col2} device={device} />}
        </div>

        <div style={{
          marginTop: 20, padding: '10px 12px',
          background: 'rgba(0,0,0,0.35)', borderRadius: 8,
          fontSize: 11, opacity: 0.75, textAlign: 'center',
        }}>
          <b>Esc</b> — закрыть · клик на свободный порт — подключить · клик на подключённое устройство — перейти
        </div>
      </div>

      <style>{`
        @keyframes netmap-focus-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes netmap-focus-pop {
          from { transform: scale(0.85); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function PortColumn({ ports, device }: {
  ports: Array<{ port: Port; neighbor: Device | null; neighborPortId?: string; link: Link | null }>;
  device: Device;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {ports.map(({ port, neighbor, neighborPortId, link }) => (
        <PortRow key={port.id} port={port} device={device}
                 neighbor={neighbor} neighborPortId={neighborPortId} link={link} />
      ))}
    </div>
  );
}

function PortRow({ port, device, neighbor, neighborPortId, link }: {
  port: Port; device: Device;
  neighbor: Device | null; neighborPortId?: string; link: Link | null;
}) {
  const focusDevice = useStore(s => s.focusDevice);
  const removeLink = useStore(s => s.removeLink);
  const [pickerOpen, setPickerOpen] = useState(false);

  const status = port.status || 'down';
  const statusColor =
    port.uplink && status === 'up' ? '#60a5fa'
    : status === 'up' ? '#10B981'
    : status === 'error' ? '#f87171'
    : '#4b5563';

  const NeighborIcon = neighbor ? ICONS[neighbor.kind] : null;
  const neighborMeta = neighbor ? KIND_META[neighbor.kind] : null;

  const handleDisconnect = async () => {
    if (!link) return;
    if (await confirmDialog(
      `Отключить кабель на ${port.id.toUpperCase()}?`,
      neighbor ? `Разорвётся связь с «${neighbor.name}».` : undefined,
      { danger: true, okText: 'Отключить' }
    )) {
      removeLink(link.id);
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '8px 12px',
      background: neighbor ? 'rgba(74,222,128,0.06)' : 'rgba(75,85,99,0.15)',
      border: `1px solid ${neighbor ? '#4ade8033' : '#4b556344'}`,
      borderRadius: 8,
      position: 'relative',
    }}>
      {/* Port indicator */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: 100, flexShrink: 0,
      }}>
        <div style={{
          width: 14, height: 14, borderRadius: 4,
          background: statusColor,
          boxShadow: status === 'up' ? `0 0 6px ${statusColor}` : 'none',
        }} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>
            {port.id.toUpperCase()}
          </span>
          <span style={{ fontSize: 9, opacity: 0.55 }}>
            {port.type || 'RJ45'}{port.speed ? ` · ${port.speed}` : ''}
            {port.uplink ? ' · ↑' : ''}{port.poeActive ? ' · ⚡' : ''}
          </span>
        </div>
      </div>

      <div style={{ opacity: 0.4, fontSize: 14 }}>
        {neighbor ? '━━━━' : '. . .'}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {neighbor && NeighborIcon && neighborMeta ? (
          <div
            onClick={() => focusDevice(neighbor.id)}
            title="Перейти к подключенному устройству"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 8px',
              background: neighborMeta.bg,
              border: `1px solid ${neighborMeta.color}`,
              borderRadius: 6,
              cursor: 'pointer',
              transition: 'transform 0.1s',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.transform = 'translateX(3px)'}
            onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.transform = 'none'}
          >
            <div style={{ color: neighborMeta.color, display: 'flex', flexShrink: 0 }}>
              <NeighborIcon size={20} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {neighbor.name}
              </div>
              {(neighbor.ip || neighborPortId) && (
                <div style={{ fontSize: 9, opacity: 0.7, fontFamily: 'monospace' }}>
                  {neighbor.ip || ''}{neighbor.ip && neighborPortId ? ' · ' : ''}
                  {neighborPortId ? `port ${neighborPortId.toUpperCase()}` : ''}
                </div>
              )}
            </div>
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setPickerOpen(true); }}
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 10px',
              background: 'transparent',
              color: '#6B7280',
              border: '1px dashed #4b5563',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 11,
              fontStyle: 'italic',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#0D9488';
                                 (e.currentTarget as HTMLButtonElement).style.color = '#0D9488'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#4b5563';
                                 (e.currentTarget as HTMLButtonElement).style.color = '#6B7280'; }}
          >
            <span>＋</span>
            <span>{port.label || 'свободен · подключить устройство'}</span>
          </button>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 4 }}>
        {neighbor && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setPickerOpen(true); }}
              title="Переподключить к другому устройству"
              style={miniBtn('#DBEAFE', '#0D9488')}
            >⇄</button>
            <button
              onClick={handleDisconnect}
              title="Отключить кабель"
              style={miniBtn('#FEE2E2', '#B91C1C', '#B91C1C')}
            >✕</button>
          </>
        )}
      </div>

      {pickerOpen && (
        <ConnectPicker
          device={device}
          port={port}
          currentLinkId={link?.id}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// ConnectPicker — modal-in-modal to choose a device+port to connect to

function ConnectPicker({ device, port, currentLinkId, onClose }: {
  device: Device; port: Port; currentLinkId?: string; onClose: () => void;
}) {
  const doc = useStore(s => s.doc);
  const addLink = useStore(s => s.addLink);
  const removeLink = useStore(s => s.removeLink);
  const [q, setQ] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Filter out the source device and devices whose ALL ports are occupied
  const candidates = useMemo(() => {
    return doc.devices
      .filter(d => d.id !== device.id)
      .filter(d => {
        // At least one port must be free
        return d.ports.some(p => !isPortOccupied(doc.links, d.id, p.id, currentLinkId));
      })
      .filter(d => {
        if (!q.trim()) return true;
        const s = q.trim().toLowerCase();
        return d.name.toLowerCase().includes(s)
            || d.ip?.toLowerCase().includes(s)
            || d.model?.toLowerCase().includes(s);
      });
  }, [doc.devices, doc.links, device.id, currentLinkId, q]);

  const selectedDev = selectedDeviceId ? doc.devices.find(d => d.id === selectedDeviceId) : null;
  const freePorts = selectedDev
    ? selectedDev.ports.filter(p => !isPortOccupied(doc.links, selectedDev.id, p.id, currentLinkId))
    : [];

  const confirmConnect = (targetPortId: string) => {
    if (!selectedDev) return;
    // If we were reassigning — remove the old link first
    if (currentLinkId) removeLink(currentLinkId);
    const id = `link-${Math.random().toString(36).slice(2, 8)}`;
    addLink({
      id,
      fromDeviceId: device.id, fromPortId: port.id,
      toDeviceId: selectedDev.id, toPortId: targetPortId,
      cable: 'copper',
    });
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 6000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560, maxHeight: '75vh',
          background: '#F9FAFB', border: '1px solid #D1D5DB', borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
          color: '#111827',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #E5E7EB' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {currentLinkId ? 'Переподключить' : 'Подключить'} {device.name}
            <span style={{ opacity: 0.6 }}> · порт </span>
            <code style={{ background: '#FFFFFF', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>
              {port.id.toUpperCase()}
            </code>
          </div>
          <div style={{ fontSize: 10, opacity: 0.55, marginTop: 4 }}>
            Выберите устройство и его свободный порт
          </div>
        </div>

        {!selectedDev ? (
          <>
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="🔎 Поиск по имени, IP, модели..."
              style={{
                background: '#FFFFFF', border: 'none', borderBottom: '1px solid #E5E7EB',
                color: '#111827', padding: '8px 16px', fontSize: 12, outline: 'none',
              }}
            />
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {candidates.map(d => {
                const meta = KIND_META[d.kind];
                const Icon = ICONS[d.kind];
                const freeCount = d.ports.filter(p => !isPortOccupied(doc.links, d.id, p.id, currentLinkId)).length;
                return (
                  <div key={d.id}
                       onClick={() => setSelectedDeviceId(d.id)}
                       style={{
                         display: 'flex', alignItems: 'center', gap: 10,
                         padding: '8px 16px',
                         cursor: 'pointer',
                         borderBottom: '1px solid #E5E7EB',
                       }}
                       onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#E5E7EB'}
                       onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}>
                    <div style={{ color: meta.color, display: 'flex' }}>
                      <Icon size={22} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600,
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {d.name}
                      </div>
                      <div style={{ fontSize: 10, opacity: 0.6 }}>
                        {meta.label}{d.ip ? ` · ${d.ip}` : ''}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 10, background: '#D1FAE5', color: '#10B981',
                      padding: '2px 6px', borderRadius: 3,
                    }}>{freeCount} свободных портов</span>
                  </div>
                );
              })}
              {candidates.length === 0 && (
                <div style={{ padding: 40, textAlign: 'center', opacity: 0.5, fontSize: 12 }}>
                  Нет подходящих устройств с свободными портами
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8,
                          borderBottom: '1px solid #E5E7EB' }}>
              <button onClick={() => setSelectedDeviceId(null)}
                      style={{
                        background: 'transparent', border: 'none', color: '#6B7280',
                        cursor: 'pointer', fontSize: 14, padding: 0,
                      }}>‹ назад</button>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{selectedDev.name}</span>
              <span style={{ fontSize: 10, opacity: 0.5 }}>· выберите порт</span>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6 }}>
                {freePorts.map(p => (
                  <button
                    key={p.id}
                    onClick={() => confirmConnect(p.id)}
                    style={{
                      background: '#D1FAE5', border: '1px solid #10B981',
                      color: '#065F46', borderRadius: 6, padding: '8px',
                      cursor: 'pointer', textAlign: 'left', fontSize: 11,
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#D1FAE5'}
                    onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = '#D1FAE5'}
                  >
                    <div style={{ fontFamily: 'monospace', fontWeight: 700 }}>{p.id.toUpperCase()}</div>
                    <div style={{ fontSize: 9, opacity: 0.8, marginTop: 2 }}>
                      {p.type || 'RJ45'}{p.speed ? ` · ${p.speed}` : ''}
                    </div>
                    {p.label && <div style={{ fontSize: 9, opacity: 0.6, marginTop: 2,
                                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.label}
                    </div>}
                  </button>
                ))}
                {freePorts.length === 0 && (
                  <div style={{ gridColumn: '1/-1', padding: 20, textAlign: 'center', opacity: 0.5, fontSize: 11 }}>
                    Нет свободных портов
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        <div style={{ padding: '8px 16px', borderTop: '1px solid #E5E7EB',
                      display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose}
                  style={{
                    background: '#E5E7EB', border: '1px solid #D1D5DB', color: '#111827',
                    padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                  }}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

function isPortOccupied(links: Link[], deviceId: string, portId: string, ignoreLinkId?: string): boolean {
  return links.some(l =>
    l.id !== ignoreLinkId && (
      (l.fromDeviceId === deviceId && l.fromPortId === portId) ||
      (l.toDeviceId === deviceId && l.toPortId === portId)
    ));
}

function miniBtn(bg: string, border: string, color = '#111827'): React.CSSProperties {
  return {
    background: bg, border: `1px solid ${border}`, color,
    borderRadius: 4, padding: '3px 8px', fontSize: 11,
    cursor: 'pointer', lineHeight: 1,
  };
}

// -----------------------------------------------------------------------------
// Quick actions in the focus header — Open in browser + linked vault credentials.

function QuickActions({ device }: { device: Device }) {
  const [vaultCreds, setVaultCreds] = useState<VaultItemFull | null>(null);
  const [vaultReady, setVaultReady] = useState(false);
  const [copiedKind, setCopiedKind] = useState<'user' | 'pw' | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const openUrl = buildOpenUrl(device);

  // Load & auto-match vault credentials on mount / when device changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const st = await vaultStatus();
      if (!st.initialized || !st.unlocked) { setVaultReady(false); return; }
      setVaultReady(true);
      const list = await vaultList();

      // 1) explicit link takes precedence
      let itemId = device.credential?.vaultItemId;
      // 2) otherwise auto-match by ip/name/mgmtUrl
      if (!itemId) {
        const match = bestVaultMatch(device, list);
        if (match) itemId = match.itemId;
      }
      if (!itemId) { if (!cancelled) setVaultCreds(null); return; }
      const res = await vaultGet(itemId);
      if (!cancelled && res.ok && res.item) setVaultCreds(res.item);
    })();
    return () => { cancelled = true; };
  }, [device.id, device.ip, device.name, device.mgmtUrl, device.credential?.vaultItemId]);

  const copy = async (kind: 'user' | 'pw', text: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedKind(kind);
    setTimeout(() => setCopiedKind(null), 1500);
    if (kind === 'pw') {
      setTimeout(() => {
        navigator.clipboard.readText().then(t => {
          if (t === text) navigator.clipboard.writeText('');
        }).catch(() => {});
      }, 20000);
    }
  };

  const doOpen = () => {
    if (!openUrl) return;
    // In Electron this is intercepted by setWindowOpenHandler → shell.openExternal.
    // In dev/browser preview it opens a new tab.
    window.open(openUrl, '_blank', 'noopener');
  };

  const unlockVault = async () => {
    const pw = await promptText('Мастер-пароль vault');
    if (!pw) return;
    const res = await vaultUnlock(pw);
    if (!res.ok) {
      await alertDialog('Ошибка', 'Неверный мастер-пароль');
      return;
    }
    // Re-run the effect
    setVaultReady(true);
    const list = await vaultList();
    let itemId = device.credential?.vaultItemId;
    if (!itemId) {
      const m = bestVaultMatch(device, list);
      if (m) itemId = m.itemId;
    }
    if (itemId) {
      const r = await vaultGet(itemId);
      if (r.ok && r.item) setVaultCreds(r.item);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch', minWidth: 200 }}>
      <button
        onClick={doOpen}
        disabled={!openUrl}
        title={openUrl ? `Открыть ${openUrl} в браузере` : 'Нет IP или mgmtUrl'}
        style={{
          background: openUrl ? '#2563EB' : '#E5E7EB',
          border: `1px solid ${openUrl ? '#388bfd' : '#D1D5DB'}`,
          color: openUrl ? '#fff' : '#6B7280',
          padding: '8px 12px', borderRadius: 6,
          cursor: openUrl ? 'pointer' : 'not-allowed',
          fontSize: 13, fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 3h7v7"/><path d="M10 14L21 3"/>
          <path d="M21 14v7H3V3h7"/>
        </svg>
        Открыть в браузере
      </button>

      {vaultCreds ? (
        <div style={{
          background: 'rgba(74, 222, 128, 0.08)', border: '1px solid #10B981',
          borderRadius: 6, padding: 8, display: 'grid', gap: 4,
        }}>
          <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Учётка: {vaultCreds.name}
          </div>
          {vaultCreds.username && (
            <div style={{ display: 'flex', gap: 4 }}>
              <input readOnly value={vaultCreds.username} style={credInput} />
              <button onClick={() => copy('user', vaultCreds.username!)} style={credCopyBtn}
                      title="Копировать имя пользователя">
                {copiedKind === 'user' ? '✓' : 'Копир'}
              </button>
            </div>
          )}
          {vaultCreds.password && (
            <div style={{ display: 'flex', gap: 4 }}>
              <input readOnly type="password" value={vaultCreds.password} style={credInput} />
              <button onClick={() => copy('pw', vaultCreds.password!)} style={credCopyBtn}
                      title="Копировать пароль (авто-очистка через 20с)">
                {copiedKind === 'pw' ? '✓' : 'Копир'}
              </button>
            </div>
          )}
        </div>
      ) : vaultReady ? (
        <div style={{ fontSize: 10, opacity: 0.5, textAlign: 'center', padding: '2px 4px' }}>
          Учётка не найдена в vault
        </div>
      ) : (
        <button onClick={unlockVault} style={{
          background: '#E5E7EB', border: '1px solid #D1D5DB', color: '#111827',
          padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
        }}>
          Разблокировать vault
        </button>
      )}
      {pickerOpen && null /* reserved */}
    </div>
  );
}

/** Build the URL to open in the browser for this device. */
function buildOpenUrl(device: Device): string | null {
  if (device.mgmtUrl && /^https?:\/\//i.test(device.mgmtUrl)) return device.mgmtUrl;
  if (device.mgmtUrl) return `http://${device.mgmtUrl}`;
  if (device.ip) {
    // Prefer https for known secure-first kinds
    const preferHttps = device.kind === 'camera' || device.kind === 'router' || device.kind === 'switch';
    return `${preferHttps ? 'https' : 'http'}://${device.ip}`;
  }
  return null;
}

const credInput: React.CSSProperties = {
  flex: 1, background: '#FFFFFF', border: '1px solid #E5E7EB',
  color: '#111827', padding: '4px 6px', borderRadius: 4,
  fontSize: 11, fontFamily: 'monospace', outline: 'none', minWidth: 0,
};
const credCopyBtn: React.CSSProperties = {
  background: '#E5E7EB', border: '1px solid #D1D5DB', color: '#111827',
  padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10,
  minWidth: 44,
};
