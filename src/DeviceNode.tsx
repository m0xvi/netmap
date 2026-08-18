import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useState } from 'react';
import { useStore } from './store';
import type { Device, DeviceKind, Port } from './types';
import { ICONS, KIND_META } from './icons';
import { inferLayer, LAYER_META } from './layers';
import { PoeButton } from './PoeButton';
import { StickyStack } from './StickyStack';
import { portSides } from './portSides';

interface Data {
  device: Device;
  highlighted?: boolean;
}

/** Which side of the icon ports appear on when the device is EXPANDED. */
const PORT_SIDE: Record<DeviceKind, Position> = {
  router:     Position.Right,
  switch:     Position.Right,
  patchpanel: Position.Right,
  ap:         Position.Top,
  camera:     Position.Right,
  server:     Position.Right,
  vm:         Position.Right,
  vps:        Position.Bottom,
  pc:         Position.Right,
  pos:        Position.Bottom,
  printer:    Position.Bottom,
  lock:       Position.Right,
  cloud:      Position.Bottom,
};

const POE_APPLICABLE: Record<DeviceKind, boolean> = {
  router: false, switch: true, patchpanel: false,
  ap: true, camera: true, printer: true, lock: true,
  server: false, vm: false, vps: false, pc: false, pos: false, cloud: false,
};

/**
 * v0.17: three visual card styles depending on device kind, all matching the
 * reference mockup:
 *
 *   'rack1u' — Router / Firewall / Patch panel / ISP:
 *              a wide white card with a mini rack-unit strip on top,
 *              name below, IP under name. Looks like the Edge Router / Firewall
 *              cards in the mockup.
 *
 *   'round'  — AP / Camera / Printer / Lock / POS:
 *              a card with a big round icon on top (ring around it), name and IP under.
 *              Looks like the Wi-Fi AP and Dome Camera cards in the mockup.
 *
 *   'box'    — PC / Server / VM / VPS:
 *              a small card with a square icon + name/IP side by side.
 */
type CardStyle = 'rack1u' | 'round' | 'box';

const CARD_STYLE: Record<DeviceKind, CardStyle> = {
  router:     'rack1u',
  switch:     'rack1u',   // (never reached — SwitchNode handles it)
  patchpanel: 'rack1u',
  ap:         'round',
  camera:     'round',
  printer:    'round',
  lock:       'round',
  pos:        'round',
  pc:         'box',
  server:     'box',
  vm:         'box',
  vps:        'box',
  cloud:      'rack1u',
};

export function DeviceNode({ id, data, selected }: NodeProps<any>) {
  const d = (data as Data).device;
  const highlighted = (data as Data).highlighted;
  const meta = KIND_META[d.kind];
  const layer = inferLayer(d);
  const layerMeta = LAYER_META[layer];
  const Icon = ICONS[d.kind];
  const selectPort = useStore(s => s.selectPort);
  const updateDevice = useStore(s => s.updateDevice);
  const togglePoeAll = useStore(s => s.togglePoeAll);
  const focusDevice = useStore(s => s.focusDevice);
  const [nodeHover, setNodeHover] = useState(false);

  const isExpanded = d.display === 'rack';
  const poeApplicable = POE_APPLICABLE[d.kind];
  const anyPoe = d.ports.some(p => p.poe);

  const cardStyle = CARD_STYLE[d.kind];

  // Border / shadow states are computed once and reused inside all three styles.
  const borderColor = selected ? '#2563EB'
                    : highlighted ? '#F59E0B'
                    : '#E5E7EB';
  const cardShadow = selected
    ? '0 0 0 2px #2563EB, 0 4px 12px rgba(15,23,42,0.10)'
    : highlighted
      ? '0 0 0 3px rgba(245,158,11,0.35)'
      : '0 1px 3px rgba(15,23,42,0.08)';

  const commonProps = {
    onMouseEnter: () => setNodeHover(true),
    onMouseLeave: () => setNodeHover(false),
    onDoubleClick: (e: React.MouseEvent) => { e.stopPropagation(); focusDevice(id); },
    title: 'Двойной клик — крупный вид с подписями подключений',
  };

  return (
    <div style={{ position: 'relative' }} {...commonProps}>
      <StickyStack deviceId={d.id} />

      {/* Layer stripe on the top edge */}
      <div title={`${layerMeta.label} · ${layerMeta.description}`} style={{
        position: 'absolute', left: 4, right: 4, top: -2, height: 3,
        background: layerMeta.color, borderRadius: 3,
        pointerEvents: 'none', zIndex: 1,
        opacity: 0.85,
      }} />

      {/* Live status dot (top-left) */}
      {d.liveStatus && d.liveStatus !== 'unknown' && (
        <LiveStatusDot status={d.liveStatus} rttMs={d.lastRttMs} at={d.lastCheckedAt} />
      )}

      {/* PoE bolt in top-right corner */}
      {poeApplicable && (
        <div style={{ position: 'absolute', top: -8, right: -8, zIndex: 15 }}>
          <PoeButton
            active={anyPoe}
            parentHover={nodeHover || selected}
            onToggle={() => togglePoeAll(id)}
            title={anyPoe ? 'Устройство запитано по PoE — отключить' : 'Пометить как PoE'}
          />
        </div>
      )}

      {isExpanded ? (
        <ExpandedCard d={d} meta={meta} Icon={Icon}
                      borderColor={borderColor} cardShadow={cardShadow}
                      onPortClick={pid => selectPort(id, pid)} />
      ) : cardStyle === 'rack1u' ? (
        <Rack1UCard d={d} meta={meta} Icon={Icon}
                    borderColor={borderColor} cardShadow={cardShadow} />
      ) : cardStyle === 'round' ? (
        <RoundCard d={d} meta={meta} Icon={Icon}
                   borderColor={borderColor} cardShadow={cardShadow} />
      ) : (
        <BoxCard d={d} meta={meta} Icon={Icon}
                 borderColor={borderColor} cardShadow={cardShadow} />
      )}

      {/* Toggle rack view for kinds that support it.
          v0.35.4: added AP — its expanded card shows SSIDs / bands / VLAN / model. */}
      {(d.kind === 'router' || d.kind === 'patchpanel' || d.kind === 'ap') && (
        <button
          className="nodrag"
          onClick={(e) => { e.stopPropagation();
                            updateDevice(id, { display: isExpanded ? 'compact' : 'rack' }); }}
          title={isExpanded ? 'Свернуть' : 'Развернуть в rack-view'}
          style={{
            position: 'absolute', top: 6, right: 6, zIndex: 5,
            background: 'rgba(255,255,255,0.9)', border: '1px solid #E5E7EB',
            color: '#6B7280', borderRadius: 4, padding: '1px 5px',
            fontSize: 10, cursor: 'pointer',
            opacity: nodeHover ? 1 : 0, transition: 'opacity 0.15s',
          }}
        >◱</button>
      )}

      {/* Handles */}
      {isExpanded ? (
        <ExpandedPorts device={d} side={PORT_SIDE[d.kind]}
                       onPortClick={pid => selectPort(id, pid)} />
      ) : (
        <CompactHandles device={d} side={PORT_SIDE[d.kind]} />
      )}
    </div>
  );
}

// ---------- Card variant 1: 1U rack strip (Router / Firewall / Patch / ISP) ----------

function Rack1UCard({ d, meta, borderColor, cardShadow }: {
  d: Device; meta: (typeof KIND_META)[DeviceKind]; Icon: any;
  borderColor: string; cardShadow: string;
}) {
  const isFirewall = /firewall|fw|pfsense|fortigate|palo/i.test(d.name) ||
                     /firewall|fw|pfsense|fortigate|palo/i.test(d.model || '');
  const vendor = detectVendor(d);
  // v0.22: routers & firewalls now render as fully-dark 1U appliances (Cisco/MikroTik look).
  // Patch panels & cloud/ISP nodes stay light so they don't compete visually with the switches.
  const isDarkKind = d.kind === 'router' || isFirewall;

  const cardBg = isDarkKind
    ? 'linear-gradient(180deg, #1F2937 0%, #111827 100%)'
    : '#FFFFFF';
  const nameColor = isDarkKind ? '#F9FAFB' : '#111827';
  const ipColor   = isDarkKind ? '#9CA3AF' : '#6B7280';
  const modelColor= isDarkKind ? '#9CA3AF' : '#6B7280';

  return (
    <div style={{
      minWidth: 220, maxWidth: 280,
      background: cardBg,
      border: `1px solid ${isDarkKind ? '#000000' : borderColor}`,
      borderRadius: 8,
      overflow: 'hidden',
      color: nameColor,
      fontSize: 11, cursor: 'grab',
      boxShadow: cardShadow,
    }}>
      {/* Name row (compact, above the faceplate) */}
      <div style={{ padding: '8px 12px 4px', textAlign: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: nameColor,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {d.name}
        </div>
        {d.ip && (
          <div style={{ fontSize: 10, color: ipColor, fontFamily: 'ui-monospace, monospace' }}>
            {d.ip}
          </div>
        )}
      </div>

      {/* 1U faceplate — full-width port strip */}
      <div style={isDarkKind ? rackStripDark() : rackStripFor(vendor)}>
        {isFirewall
          ? <FirewallFaceplate color={meta.color} vendor={vendor} />
          : d.kind === 'router' ? <RouterFaceplate color={meta.color} ports={d.ports} vendor={vendor} />
          : d.kind === 'patchpanel' ? <PatchStrip ports={d.ports} />
          : d.kind === 'cloud' ? <CloudFaceplate color={meta.color} />
          : <RouterFaceplate color={meta.color} ports={d.ports} vendor={vendor} />}
      </div>

      {/* Vendor + model row — subtle */}
      {(vendor !== 'generic' || d.model) && (
        <div style={{
          padding: '4px 10px 6px',
          fontSize: 9, color: modelColor, textAlign: 'center',
          fontFamily: 'ui-monospace, monospace', letterSpacing: 0.3,
        }}>
          {vendor !== 'generic' && (
            <span style={{
              display: 'inline-block',
              background: VENDOR_META[vendor].brandBg,
              color: VENDOR_META[vendor].brandFg,
              padding: '1px 5px', borderRadius: 3,
              fontWeight: 700, marginRight: 4,
            }}>{VENDOR_META[vendor].label}</span>
          )}
          {d.model || ''}
        </div>
      )}
    </div>
  );
}

/** Faceplate strip for the black router/firewall variant — full width, dark. */
function rackStripDark(): React.CSSProperties {
  return {
    background: 'linear-gradient(180deg, #0A0F1A 0%, #050810 100%)',
    borderTop: '1px solid #000000',
    borderBottom: '1px solid #000000',
    padding: '8px 12px',
    display: 'flex', alignItems: 'center', gap: 6,
    height: 36,
    width: '100%',
  };
}

// ---------- Vendor detection & per-vendor faceplate colours ----------

type Vendor = 'cisco' | 'mikrotik' | 'ubiquiti' | 'tplink' | 'hp' | 'dlink' | 'juniper' | 'generic';

interface VendorTheme {
  label: string;
  brandBg: string;   // background of the little vendor pill
  brandFg: string;   // text of the vendor pill
  chassis: string;   // gradient of the 1U strip
  bezel:   string;   // left accent bar next to the LEDs
  ledSys:  string;   // dominant LED colour
}

const VENDOR_META: Record<Vendor, VendorTheme> = {
  cisco:    { label: 'Cisco',     brandBg: '#1BA0D7', brandFg: '#FFFFFF',
              chassis: 'linear-gradient(180deg, #E5E7EB 0%, #C9CFD6 55%, #A9B1BB 100%)',
              bezel: '#1BA0D7', ledSys: '#10B981' },
  mikrotik: { label: 'MikroTik',  brandBg: '#293239', brandFg: '#FFFFFF',
              chassis: 'linear-gradient(180deg, #2C3238 0%, #1E2226 100%)',
              bezel: '#293239', ledSys: '#10B981' },
  ubiquiti: { label: 'UniFi',     brandBg: '#0559C9', brandFg: '#FFFFFF',
              chassis: 'linear-gradient(180deg, #FFFFFF 0%, #EBEEF2 100%)',
              bezel: '#0559C9', ledSys: '#0559C9' },
  tplink:   { label: 'TP-Link',   brandBg: '#4ACBD6', brandFg: '#0F172A',
              chassis: 'linear-gradient(180deg, #F1F5F9 0%, #CBD5E1 100%)',
              bezel: '#4ACBD6', ledSys: '#10B981' },
  hp:       { label: 'HP/Aruba',  brandBg: '#0096D6', brandFg: '#FFFFFF',
              chassis: 'linear-gradient(180deg, #E5E7EB 0%, #B9BFC7 100%)',
              bezel: '#0096D6', ledSys: '#10B981' },
  dlink:    { label: 'D-Link',    brandBg: '#FDB515', brandFg: '#0F172A',
              chassis: 'linear-gradient(180deg, #F3F4F6 0%, #C9CFD6 100%)',
              bezel: '#FDB515', ledSys: '#10B981' },
  juniper:  { label: 'Juniper',   brandBg: '#84B135', brandFg: '#FFFFFF',
              chassis: 'linear-gradient(180deg, #E5E7EB 0%, #B9BFC7 100%)',
              bezel: '#84B135', ledSys: '#84B135' },
  generic:  { label: '',          brandBg: '#E5E7EB', brandFg: '#374151',
              chassis: 'linear-gradient(180deg, #F3F4F6 0%, #E5E7EB 50%, #D1D5DB 100%)',
              bezel: '#9CA3AF', ledSys: '#10B981' },
};

function detectVendor(d: Device): Vendor {
  const hay = `${d.vendor || ''} ${d.model || ''} ${d.name || ''}`.toLowerCase();
  if (/cisco|catalyst|meraki|nexus/.test(hay)) return 'cisco';
  if (/mikrotik|routeros|routerboard|crs\d|ccr\d|hex/.test(hay)) return 'mikrotik';
  if (/ubiquiti|ubnt|unifi|edgemax|edgerouter/.test(hay)) return 'ubiquiti';
  if (/tp[-_ ]?link|tp-l|tplink|tl-/.test(hay)) return 'tplink';
  if (/hp[e]?|aruba|procurve/.test(hay)) return 'hp';
  if (/d[-_ ]?link|dlink|dgs|dis-/.test(hay)) return 'dlink';
  if (/juniper|junos|ex[234]\d|srx/.test(hay)) return 'juniper';
  return 'generic';
}

function rackStripFor(v: Vendor): React.CSSProperties {
  return {
    background: VENDOR_META[v].chassis,
    borderTop: `1px solid ${v === 'mikrotik' ? '#111827' : '#D1D5DB'}`,
    borderBottom: `1px solid ${v === 'mikrotik' ? '#000000' : '#9CA3AF'}`,
    padding: '6px 8px',
    display: 'flex', alignItems: 'center', gap: 6,
    height: 32,
  };
}

function RouterFaceplate({ color, ports, vendor }: { color: string; ports: Port[]; vendor: Vendor }) {
  void color;
  const upCount = ports.filter(p => p.status === 'up').length;
  const totalPorts = Math.min(8, ports.length || 4);
  const theme = VENDOR_META[vendor];
  const bezelColor = theme.bezel;
  const brandText = vendor === 'generic' ? 'NET' : theme.label.toUpperCase().slice(0, 5);
  return (
    <>
      {/* Left bezel accent */}
      <div style={{ width: 3, height: 22, background: bezelColor, borderRadius: 1, flexShrink: 0 }} />
      {/* Brand vertical text */}
      <div style={{
        fontSize: 8, color: '#E5E7EB', fontFamily: 'ui-monospace, monospace',
        fontWeight: 700, letterSpacing: 0.5,
        writingMode: 'vertical-rl', transform: 'rotate(180deg)',
        flexShrink: 0,
      }}>{brandText}</div>
      {/* LED cluster */}
      <div style={{ display: 'flex', gap: 3, marginLeft: 2, flexShrink: 0 }}>
        <FLed color={theme.ledSys} on pulse />
        <FLed color="#3B82F6" on={upCount > 0} />
        <FLed color="#F59E0B" on={false} />
      </div>
      {/* Port slots — stretch across whole width */}
      <div style={{
        display: 'flex', gap: 3, flex: 1,
        justifyContent: 'space-evenly',
        alignItems: 'center',
        marginLeft: 6,
      }}>
        {Array.from({ length: totalPorts }).map((_, i) => {
          const p = ports[i];
          return (
            <div key={i} style={{
              width: 12, height: 14,
              background: '#000000',
              border: `1px solid #1F2937`,
              borderRadius: 1,
              position: 'relative',
              boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.6)',
              flexShrink: 0,
            }}>
              {p?.status === 'up' && (
                <span style={{
                  position: 'absolute', bottom: -3, left: '50%', transform: 'translateX(-50%)',
                  width: 4, height: 4, borderRadius: '50%',
                  background: p.uplink ? '#3B82F6' : '#10B981',
                  boxShadow: `0 0 4px ${p.uplink ? '#3B82F6' : '#10B981'}`,
                }} />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function FirewallFaceplate({ color, vendor }: { color: string; vendor: Vendor }) {
  void color;
  const theme = VENDOR_META[vendor];
  return (
    <>
      {/* Left bezel + FW label */}
      <div style={{ width: 3, height: 22, background: theme.bezel, borderRadius: 1, flexShrink: 0 }} />
      <div style={{
        fontSize: 8, color: '#E5E7EB', fontFamily: 'ui-monospace, monospace',
        fontWeight: 700, letterSpacing: 0.5,
        writingMode: 'vertical-rl', transform: 'rotate(180deg)',
        flexShrink: 0,
      }}>FW</div>
      <div style={{ display: 'flex', gap: 3, marginLeft: 2, flexShrink: 0 }}>
        <FLed color="#EF4444" on pulse />
        <FLed color={theme.ledSys} on />
        <FLed color="#F59E0B" on />
      </div>
      {/* Vent grille + port slots — spread across full width */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, marginLeft: 6 }}>
        <div style={{ flex: 1, display: 'flex', gap: 1.5, justifyContent: 'center' }}>
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} style={{
              width: 1.5, height: 18,
              background: '#000000', borderRadius: 1,
            }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{
              width: 12, height: 14, background: '#000000',
              border: `1px solid #1F2937`,
              borderRadius: 1, boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.6)',
            }} />
          ))}
        </div>
      </div>
    </>
  );
}

function CloudFaceplate({ color }: { color: string }) {
  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        color: color, fontSize: 10, fontWeight: 700,
        fontFamily: 'ui-monospace, monospace', letterSpacing: 0.5,
        width: '100%', justifyContent: 'center',
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 18a5 5 0 0 1 0-10 7 7 0 0 1 13.5 2 4 4 0 0 1-1.5 8H6z"/>
        </svg>
        ISP · UPLINK
      </div>
    </>
  );
}

function PatchStrip({ ports }: { ports: Port[] }) {
  const shown = ports.slice(0, 16);
  return (
    <div style={{ display: 'flex', gap: 1, width: '100%', justifyContent: 'center' }}>
      {shown.map((p, i) => (
        <div key={i} style={{
          width: 6, height: 14,
          background: p.status === 'up' ? '#111827' : '#4B5563',
          border: '1px solid #6B7280', borderRadius: 1,
        }} />
      ))}
    </div>
  );
}

function FLed({ color, on, pulse }: { color: string; on: boolean; pulse?: boolean }) {
  return (
    <span style={{
      width: 4, height: 4, borderRadius: '50%',
      background: on ? color : '#1F2937',
      boxShadow: on ? `0 0 3px ${color}` : 'none',
      animation: pulse && on ? 'netmap-led-pulse 2s infinite' : undefined,
    }} />
  );
}

// ---------- Card variant 2: Round (AP / Camera / Printer / Lock / POS) ----------

function RoundCard({ d, meta, Icon, borderColor, cardShadow }: {
  d: Device; meta: (typeof KIND_META)[DeviceKind]; Icon: any;
  borderColor: string; cardShadow: string;
}) {
  return (
    <div style={{
      minWidth: 130, maxWidth: 170,
      background: '#FFFFFF',
      border: `1px solid ${borderColor}`,
      borderRadius: 10,
      padding: '10px 8px 8px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      color: '#111827', fontSize: 11, cursor: 'grab',
      boxShadow: cardShadow,
      position: 'relative',
    }}>
      {/* Round icon medallion */}
      <div style={{
        width: 44, height: 44, borderRadius: '50%',
        background: meta.bg,
        border: `2px solid ${meta.color}22`,
        color: meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 2,
      }}>
        <Icon size={24} />
      </div>
      <div style={{
        fontSize: 11, fontWeight: 600, color: '#111827',
        textAlign: 'center', lineHeight: 1.2,
        maxWidth: 150,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        width: '100%',
      }}>{d.name}</div>
      {d.ip && (
        <div style={{
          fontSize: 10, color: '#6B7280',
          fontFamily: 'ui-monospace, monospace',
        }}>{d.ip}</div>
      )}
      {/* Wi-Fi arc for APs */}
      {d.kind === 'ap' && (
        <div style={{ position: 'absolute', bottom: 6, right: 8, color: '#3B82F6' }}>
          <svg width="14" height="10" viewBox="0 0 24 18" fill="none" stroke="currentColor"
               strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 8a15 15 0 0 1 20 0"/>
            <path d="M6 12a9 9 0 0 1 12 0"/>
            <circle cx="12" cy="16" r="1.2" fill="currentColor" />
          </svg>
        </div>
      )}

      {/* v0.35.5: camera → DVR chip. Small pill under the IP with the
          recorder's name — sysadmin sees at a glance who's writing this
          camera's stream. Set via Inspector → Hardware → «Пишет на регистратор». */}
      {d.kind === 'camera' && d.attachedToRegistrarId && (
        <CameraDvrChip regId={d.attachedToRegistrarId} />
      )}

      {/* v0.35: SSIDs broadcast by this AP — small chips under the IP row.
          Guest SSIDs get a lighter tint; hidden ones get a dashed border. */}
      {d.kind === 'ap' && d.ssids && d.ssids.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 3,
          justifyContent: 'center', marginTop: 3, maxWidth: 150,
        }}>
          {d.ssids.slice(0, 4).map((s, i) => (
            <span key={s.name + i} title={`${s.name}${s.band ? ' · ' + s.band : ''}${s.hidden ? ' · скрытая' : ''}${s.guest ? ' · гостевая' : ''}`}
              style={{
                fontSize: 8.5, lineHeight: '12px',
                padding: '0 5px', borderRadius: 6,
                background: s.guest ? '#FEF3C7' : '#DBEAFE',
                color: s.guest ? '#92400E' : '#1E40AF',
                border: s.hidden ? '1px dashed #94A3B8' : '1px solid transparent',
                fontFamily: 'ui-monospace, monospace',
                maxWidth: 90, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
              {s.name}
            </span>
          ))}
          {d.ssids.length > 4 && (
            <span style={{
              fontSize: 8.5, lineHeight: '12px', padding: '0 4px',
              color: '#9CA3AF',
            }}>+{d.ssids.length - 4}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Card variant 3: Box (PC / Server / VM / VPS) ----------

function BoxCard({ d, meta, Icon, borderColor, cardShadow }: {
  d: Device; meta: (typeof KIND_META)[DeviceKind]; Icon: any;
  borderColor: string; cardShadow: string;
}) {
  return (
    <div style={{
      minWidth: 150, maxWidth: 200,
      background: '#FFFFFF',
      border: `1px solid ${borderColor}`,
      borderRadius: 8,
      padding: '8px 10px',
      display: 'flex', alignItems: 'center', gap: 10,
      color: '#111827', fontSize: 11, cursor: 'grab',
      boxShadow: cardShadow,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 6,
        background: meta.bg,
        color: meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#111827',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {d.name}
        </div>
        {d.ip && (
          <div style={{ fontSize: 10, color: '#6B7280', fontFamily: 'ui-monospace, monospace' }}>
            {d.ip}
          </div>
        )}
        {d.kind === 'vm' && d.vmInfo && (
          <div style={{ fontSize: 9, color: '#9CA3AF', marginTop: 1 }}>
            {d.vmInfo.vcpu ? `${d.vmInfo.vcpu}vCPU` : ''}
            {d.vmInfo.ramGb ? ` · ${d.vmInfo.ramGb}GB` : ''}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Expanded: original behaviour retained for backward compat ----------

function ExpandedCard({ d, meta, Icon, borderColor, cardShadow, onPortClick }: {
  d: Device; meta: (typeof KIND_META)[DeviceKind]; Icon: any;
  borderColor: string; cardShadow: string;
  onPortClick: (pid: string) => void;
}) {
  void onPortClick; // ports are rendered by ExpandedPorts (handles side); this card is just the visual body

  // v0.35.4: AP gets a dedicated expanded card showing vendor/model, SSIDs
  // with bands + guest/hidden flags, per-port VLAN membership, PoE status.
  if (d.kind === 'ap') {
    return <ApExpandedCard d={d} meta={meta} Icon={Icon}
                           borderColor={borderColor} cardShadow={cardShadow} />;
  }

  return (
    <div style={{
      minWidth: 180, maxWidth: 240,
      background: '#FFFFFF',
      border: `1px solid ${borderColor}`,
      borderRadius: 10,
      padding: '10px 12px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      color: '#111827', fontSize: 12,
      boxShadow: cardShadow, cursor: 'grab',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 8,
        background: meta.bg, color: meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 4,
      }}>
        <Icon size={40} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{d.name}</div>
      {d.ip && (
        <div style={{ fontSize: 11, color: '#6B7280', fontFamily: 'ui-monospace, monospace' }}>
          {d.ip}
        </div>
      )}
      {d.model && (
        <div style={{ fontSize: 10, color: '#9CA3AF' }}>{d.model}</div>
      )}
      {d.kind === 'vm' && !d.hostDeviceId && (
        <div style={{ fontSize: 10, color: '#D97706' }}>⚠ нет хоста</div>
      )}
    </div>
  );
}

/**
 * v0.35.4 — AP expanded card.
 * Left: dome/icon + name + IP + vendor/model.
 * Middle: SSIDs with band chips (2.4 / 5 / 6 / dual), guest/hidden flags,
 *         VLAN tag if the SSID has one (from device.ssids[].vlan — not yet
 *         a first-class field, so we fall back to the ports' vlan for now).
 * Bottom: uplink port summary (name → speed → VLAN, PoE indicator).
 */
function ApExpandedCard({ d, meta, Icon, borderColor, cardShadow }: {
  d: Device; meta: (typeof KIND_META)[DeviceKind]; Icon: any;
  borderColor: string; cardShadow: string;
}) {
  const vlansStore = useStore(s => s.doc.vlans) || [];
  const vlansById = new Map(vlansStore.map(v => [v.vlanId, v]));

  // Uplink port(s) — usually the only port on the AP, but iterate to be safe
  const ports = d.ports;
  const primaryPort = ports.find(p => p.uplink) || ports[0];

  // Collect all VLAN ids touched by this AP (access + trunk on any port)
  const vlanIds = new Set<number>();
  for (const p of ports) {
    if (p.vlan != null) vlanIds.add(p.vlan);
    for (const v of p.vlans || []) vlanIds.add(v);
  }

  return (
    <div style={{
      minWidth: 240, maxWidth: 300,
      background: '#FFFFFF',
      border: `1px solid ${borderColor}`,
      borderRadius: 10,
      padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 8,
      color: '#111827', fontSize: 12,
      boxShadow: cardShadow, cursor: 'grab',
      position: 'relative',
    }}>
      {/* Header row — icon + name/model */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 8,
          background: meta.bg, color: meta.color, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={26} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#111827',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {d.name}
          </div>
          <div style={{ fontSize: 10, color: '#6B7280',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {[d.vendor, d.model].filter(Boolean).join(' · ') || 'ACCESS POINT'}
            {d.ip && ` · ${d.ip}`}
          </div>
        </div>
      </div>

      {/* SSIDs list */}
      {d.ssids && d.ssids.length > 0 ? (
        <div style={{
          borderTop: '1px solid #F3F4F6', paddingTop: 6,
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: '#9CA3AF',
            textTransform: 'uppercase', letterSpacing: 0.5,
          }}>SSIDs · {d.ssids.length}</div>
          {d.ssids.slice(0, 6).map((s, i) => (
            <div key={s.name + i} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '3px 5px', borderRadius: 4,
              background: s.guest ? '#FFFBEB' : '#F9FAFB',
              border: s.hidden ? '1px dashed #D1D5DB' : '1px solid transparent',
            }}>
              <span style={{
                fontSize: 11, fontWeight: 600, color: '#111827',
                fontFamily: 'ui-monospace, monospace', flex: 1,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {s.hidden ? '· ' : ''}{s.name}
              </span>
              <BandBadge band={s.band} />
              {s.guest && <TagBadge label="Guest" color="#92400E" bg="#FEF3C7" />}
              {s.hidden && <TagBadge label="Hidden" color="#374151" bg="#F3F4F6" />}
            </div>
          ))}
          {d.ssids.length > 6 && (
            <div style={{ fontSize: 10, color: '#9CA3AF', textAlign: 'center' }}>
              +{d.ssids.length - 6} SSID
            </div>
          )}
        </div>
      ) : (
        <div style={{
          borderTop: '1px solid #F3F4F6', paddingTop: 6,
          fontSize: 10, color: '#9CA3AF', fontStyle: 'italic',
        }}>Нет SSID · настройте на вкладке Hardware</div>
      )}

      {/* Uplink port summary — the physical connection */}
      {primaryPort && (
        <div style={{
          borderTop: '1px solid #F3F4F6', paddingTop: 6,
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: '#9CA3AF',
            textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 4,
          }}>UPLINK</div>
          <span style={{
            fontFamily: 'ui-monospace, monospace', fontSize: 10, color: '#374151',
            background: '#F3F4F6', padding: '1px 6px', borderRadius: 3,
          }}>{primaryPort.id.toUpperCase()}</span>
          {primaryPort.speed && (
            <span style={{ fontSize: 10, color: '#6B7280' }}>{primaryPort.speed}</span>
          )}
          {primaryPort.poeActive && (
            <span style={{
              fontSize: 9, fontWeight: 700, color: '#B45309', background: '#FEF3C7',
              padding: '1px 5px', borderRadius: 3,
            }}>⚡ PoE</span>
          )}
          <span style={{
            fontSize: 9, fontWeight: 700,
            color: primaryPort.status === 'up' ? '#059669'
                 : primaryPort.status === 'error' ? '#DC2626' : '#9CA3AF',
          }}>{(primaryPort.status || 'down').toUpperCase()}</span>
        </div>
      )}

      {/* VLANs summary — collected from port.vlan + port.vlans[] */}
      {vlanIds.size > 0 && (
        <div style={{
          display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: '#9CA3AF',
            textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 2,
          }}>VLAN</div>
          {Array.from(vlanIds).sort((a, b) => a - b).map(vid => {
            const v = vlansById.get(vid);
            return (
              <span key={vid} title={v ? `${v.name} · ${v.cidr || ''}` : `VLAN ${vid}`}
                style={{
                  fontSize: 10, fontWeight: 700,
                  background: v?.color || '#E5E7EB',
                  color: '#FFFFFF',
                  padding: '1px 6px', borderRadius: 3,
                  fontFamily: 'ui-monospace, monospace',
                }}>{vid}</span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BandBadge({ band }: { band?: '2.4GHz' | '5GHz' | '6GHz' | 'both' }) {
  if (!band) return null;
  const label = band === 'both' ? '2.4 + 5' : band.replace('GHz', 'G');
  const bg = band === '2.4GHz' ? '#DBEAFE'
           : band === '5GHz'   ? '#D1FAE5'
           : band === '6GHz'   ? '#EDE9FE'
                                : '#F3E8FF';
  const color = band === '2.4GHz' ? '#1E40AF'
              : band === '5GHz'   ? '#065F46'
              : band === '6GHz'   ? '#5B21B6'
                                  : '#6B21A8';
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
      background: bg, color, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

function TagBadge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
      background: bg, color, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

// ---------- COMPACT: invisible handles per side ----------

/**
 * Compact-mode handles.
 *
 * v0.21 fix: previously we exposed only 8 side-hugging handles named
 * `_top / _right / _bottom / _left`. Cables in seed docs reference specific
 * port ids like 'poe', 'lan', 'eth1' — React Flow could not find a matching
 * handle and silently dropped those cables. Result: on the canvas most APs,
 * cameras and endpoints looked disconnected.
 *
 * Now every port gets its OWN invisible handle distributed evenly along the
 * `side` edge of the card. Plus we keep the 4 fallback handles (_top/_right/…)
 * for links without a port id.
 */
function CompactHandles({ device, side }: { device: Device; side: Position }) {
  const ports = device.ports;
  const invisible = {
    width: 6, height: 6,
    background: 'transparent', border: 'none', opacity: 0,
  } as React.CSSProperties;

  // v0.34.1: subscribe via a zustand version tick — see PortEdge for the
  // reasoning (per-listener subscribe caused error #185 render storm).
  const psVersion = useStore(s => s.portSidesVersion);
  void psVersion;

  const posStyleFor = (s: Position, pct: number): React.CSSProperties =>
    (s === Position.Left || s === Position.Right)
      ? { top: `${pct}%` }
      : { left: `${pct}%` };

  return (
    <>
      {ports.map((port, idx) => {
        // v0.34: prefer the dynamic side computed from link geometry; fall
        // back to the kind's static `side` for unconnected ports.
        const dynSide = portSides.getSide(device.id, port.id);
        const dynPct  = portSides.getOffsetPct(device.id, port.id);
        const effSide = dynSide ?? side;
        const pct = dynSide != null
          ? (dynPct ?? 50)
          : ((idx + 1) / (ports.length + 1)) * 100;
        return (
          <div key={port.id}>
            <Handle id={port.id} type="source" position={effSide}
                    style={{ ...invisible, ...posStyleFor(effSide, pct) }} />
            <Handle id={port.id} type="target" position={effSide}
                    style={{ ...invisible, ...posStyleFor(effSide, pct) }} />
          </div>
        );
      })}
      {/* Fallback edge-hugging handles for cables without an explicit port id */}
      <Handle id="_top"    type="source" position={Position.Top}    style={invisible} />
      <Handle id="_top"    type="target" position={Position.Top}    style={invisible} />
      <Handle id="_right"  type="source" position={Position.Right}  style={invisible} />
      <Handle id="_right"  type="target" position={Position.Right}  style={invisible} />
      <Handle id="_bottom" type="source" position={Position.Bottom} style={invisible} />
      <Handle id="_bottom" type="target" position={Position.Bottom} style={invisible} />
      <Handle id="_left"   type="source" position={Position.Left}   style={invisible} />
      <Handle id="_left"   type="target" position={Position.Left}   style={invisible} />
    </>
  );
}

// ---------- EXPANDED: port dots ----------

function ExpandedPorts({ device, side, onPortClick }: {
  device: Device; side: Position; onPortClick: (portId: string) => void;
}) {
  const ports = device.ports;
  if (ports.length === 0) return null;
  return (
    <>
      {ports.map((port, idx) => {
        const total = ports.length;
        const pct = ((idx + 1) / (total + 1)) * 100;
        return (
          <PortDot key={port.id} port={port} side={side} percent={pct}
                   onClick={() => onPortClick(port.id)} deviceId={device.id} />
        );
      })}
    </>
  );
}

function PortDot({ port, side, percent, onClick, deviceId }: {
  port: Port; side: Position; percent: number;
  onClick: () => void; deviceId: string;
}) {
  const [hover, setHover] = useState(false);
  const col = statusColor(port);
  const openContextMenu = useStore(s => s.openContextMenu);
  // v0.26: participate in the port-trace highlight
  const setHoveredPort = useStore(s => s.setHoveredPort);
  const traceKeys = useStore(s => s.hoveredTracePortKeys);
  const onTrace = traceKeys.has(`${deviceId}:${port.id}`);

  const isVertical = side === Position.Left || side === Position.Right;
  const styleWrap: React.CSSProperties = {
    position: 'absolute',
    ...(side === Position.Right  && { right: -6, top: `${percent}%` }),
    ...(side === Position.Left   && { left:  -6, top: `${percent}%` }),
    ...(side === Position.Top    && { top:   -6, left: `${percent}%` }),
    ...(side === Position.Bottom && { bottom:-6, left: `${percent}%` }),
    transform: isVertical ? 'translateY(-50%)' : 'translateX(-50%)',
    zIndex: 5,
  };

  return (
    <div className="nodrag" style={styleWrap}
         onMouseEnter={() => { setHover(true); setHoveredPort(deviceId, port.id); }}
         onMouseLeave={() => { setHover(false); setHoveredPort(null, null); }}
         onClick={(e) => { e.stopPropagation(); onClick(); }}
         onContextMenu={(e) => {
           e.preventDefault(); e.stopPropagation();
           openContextMenu({ x: e.clientX, y: e.clientY,
             target: { type: 'port', deviceId, portId: port.id } });
         }}>
      <div style={{
        width: 12, height: 12, borderRadius: 3,
        background: onTrace ? '#F59E0B' : col.bg,
        border: `1.5px solid ${onTrace ? '#F59E0B' : col.border}`,
        cursor: 'pointer',
        boxShadow: onTrace ? '0 0 8px #F59E0B' : hover ? `0 0 0 3px ${col.border}44` : 'none',
        transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
      }} />
      <Handle type="source" position={side} id={port.id}
              style={{ width: 8, height: 8, background: col.border, border: 'none', opacity: hover ? 1 : 0 }} />
      <Handle type="target" position={side} id={port.id}
              style={{ width: 8, height: 8, background: col.border, border: 'none', opacity: hover ? 1 : 0 }} />

      {hover && (
        <div style={{
          position: 'absolute',
          [side === Position.Right ? 'left' : side === Position.Left ? 'right' : 'top']: '150%',
          background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 6,
          padding: '6px 10px', fontSize: 10, whiteSpace: 'nowrap',
          color: '#111827', pointerEvents: 'auto', zIndex: 100,
          boxShadow: '0 4px 12px rgba(15,23,42,0.12)',
        }}>
          <div style={{ fontWeight: 600 }}>
            {port.id.toUpperCase()} · {port.type || 'RJ45'} {port.speed || ''}
          </div>
          {port.label && <div style={{ color: '#6B7280' }}>→ {port.label}</div>}
        </div>
      )}
    </div>
  );
}

function statusColor(p: Port): { bg: string; border: string } {
  const s = p.status || 'down';
  if (p.uplink && s === 'up') return { bg: '#DBEAFE', border: '#2563EB' };
  if (s === 'up')       return { bg: '#D1FAE5', border: '#10B981' };
  if (s === 'error')    return { bg: '#FEE2E2', border: '#EF4444' };
  if (s === 'disabled') return { bg: '#F3F4F6', border: '#9CA3AF' };
  return { bg: '#F3F4F6', border: '#9CA3AF' };
}

// ============================================================================
// Live status dot — small indicator in the top-left corner of the card.
// Exported so SwitchNode/PatchPanelNode/ServerNode can reuse it.

export function LiveStatusDot({ status, rttMs, at }: {
  status: 'unknown' | 'up' | 'down' | 'checking'; rttMs?: number; at?: number;
}) {
  const color = status === 'up' ? '#10B981'
              : status === 'down' ? '#EF4444'
              : status === 'checking' ? '#F59E0B'
              : '#9CA3AF';
  const label = status === 'up' ? 'Online'
              : status === 'down' ? 'Offline'
              : status === 'checking' ? 'Проверка…'
              : 'Неизвестно';
  const rttLabel = rttMs != null ? ` · ${rttMs.toFixed(0)} ms` : '';
  const ago = at ? `${Math.max(0, Math.round((Date.now() - at) / 1000))} сек назад` : '';
  return (
    <div title={`${label}${rttLabel}${ago ? ` (${ago})` : ''}`}
         style={{
           position: 'absolute', top: -4, left: -4, zIndex: 10,
           width: 10, height: 10, borderRadius: '50%',
           background: color,
           boxShadow: `0 0 0 2px #FFFFFF, 0 0 6px ${color}88`,
           animation: status === 'checking' ? 'netmap-led-pulse 1.4s infinite' : undefined,
         }} />
  );
}

/**
 * v0.35.5 — small pill on a camera card showing which DVR/NVR records it.
 * Read-only display; edit via Inspector → Hardware.
 */
function CameraDvrChip({ regId }: { regId: string }) {
  // Selector picks JUST the registrar's name — the doc.devices reference is
  // stable, and we only care about one field.
  const regName = useStore(s => s.doc.devices.find(d => d.id === regId)?.name);
  if (!regName) return null;
  return (
    <div title={`Пишет на регистратор: ${regName}`}
         style={{
           marginTop: 3,
           display: 'inline-flex', alignItems: 'center', gap: 3,
           fontSize: 9, lineHeight: '13px',
           padding: '0 6px', borderRadius: 6,
           background: '#ECFEFF', color: '#0F766E',
           border: '1px solid #A5F3FC',
           maxWidth: 130, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
         }}>
      <span style={{ fontSize: 10 }}>📹</span>
      <span style={{ fontFamily: 'ui-monospace, monospace' }}>{regName}</span>
    </div>
  );
}
