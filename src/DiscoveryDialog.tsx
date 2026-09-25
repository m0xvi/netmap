/**
 * v0.44.0 — Auto-discovery dialog. Three phases:
 *
 *   1) FORM   — pick source (MikroTik SSH / SNMP / both), enter host+creds.
 *   2) SCAN   — spinner while backend runs LLDP+FDB+ARP collection.
 *   3) REVIEW — git-diff-style checklist of proposedDevices + proposedLinks
 *               with per-row Apply toggle. User confirms → store.applyDiscovery
 *               merges everything as a SINGLE undo step.
 *
 * Nothing here writes to the doc until user clicks «Применить выбранное».
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from './store';
import type { DeviceKind } from './types';
import { KIND_META } from './icons';
import { alertDialog } from './Modal';
import {
  discoveryScan, discoveryTest,
  type DiscoveryConfig, type DiscoveryScanResult,
  type DiscoveryDeviceProposal, type DiscoveryLinkProposal,
  type DiscoveryNameSource,
} from './discoveryClient';
import { ipInAnyCidr } from './mikrotikClient';
import { MiniSpinner, ProgressStripe, ProgressBar } from './Spinner';
import { VaultCredsButtons } from './VaultCreds';

// ============================================================================
// SVG icons (no emoji per project convention)
// ============================================================================

const IconSearch = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
  </svg>
);
const IconPlay = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
);
const IconCheck = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M4 12l6 6L20 6" /></svg>
);
const IconX = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
const IconLink = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
  </svg>
);
const IconDevice = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 20h8M12 18v2" />
  </svg>
);

// ============================================================================
// Kind chip color palette (shared with Catalog/Nodes)
// ============================================================================
const KIND_COLOR: Record<string, { bg: string; fg: string }> = {
  router:     { bg: '#e0f2fe', fg: '#0369a1' },
  switch:     { bg: '#dcfce7', fg: '#166534' },
  ap:         { bg: '#fef3c7', fg: '#92400e' },
  camera:     { bg: '#fce7f3', fg: '#9d174d' },
  server:     { bg: '#e0e7ff', fg: '#3730a3' },
  vm:         { bg: '#ede9fe', fg: '#6d28d9' },
  vps:        { bg: '#ede9fe', fg: '#6d28d9' },
  pc:         { bg: '#f1f5f9', fg: '#334155' },
  printer:    { bg: '#fee2e2', fg: '#991b1b' },
  pos:        { bg: '#fee2e2', fg: '#991b1b' },
  lock:       { bg: '#f5f5f4', fg: '#57534e' },
  patchpanel: { bg: '#f0fdf4', fg: '#15803d' },
  cloud:      { bg: '#e0e7ff', fg: '#3730a3' },
  pbx:        { bg: '#ccfbf1', fg: '#0f766e' },
  dvr:        { bg: '#c7d2fe', fg: '#4338ca' },
  other:      { bg: '#f1f5f9', fg: '#334155' },
};
function KindChip({ kind }: { kind: string }) {
  const c = KIND_COLOR[kind] || { bg: '#f1f5f9', fg: '#334155' };
  return (
    <span style={{
      background: c.bg, color: c.fg, padding: '2px 8px', borderRadius: 999,
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
    }}>{kind}</span>
  );
}

// ============================================================================
// v0.52.0 — фильтры предпросмотра и переименование: типы и бейдж источника имени
// ============================================================================
interface DiscSubnet {
  cidr: string; count: number; iface?: string; comment?: string; fromRouter: boolean;
  // v0.54.0: разбивка широкой подсети роутера по /24 (только если внутри ≥2 разных /24 с устройствами)
  parts?: Array<{ cidr: string; count: number }>;
}
interface DiscVlan { id: number; count: number; name?: string; }

const NAME_SRC_META: Record<DiscoveryNameSource, { label: string; bg: string; fg: string; title: string }> = {
  dhcp:     { label: 'DHCP', bg: '#dcfce7', fg: '#166534', title: 'Имя из комментария DHCP-лизы (задано администратором)' },
  sysname:  { label: 'имя',  bg: '#e0f2fe', fg: '#0369a1', title: 'Собственное имя устройства (LLDP sysName / MikroTik identity)' },
  hostname: { label: 'host', bg: '#fef3c7', fg: '#92400e', title: 'Host-name из DHCP-лизы (прислал сам клиент)' },
  ip:       { label: 'IP',   bg: '#f1f5f9', fg: '#64748b', title: 'Имени нет — показана заглушка IP. Задайте имя вручную в поле слева.' },
  mac:      { label: 'MAC',  bg: '#f1f5f9', fg: '#64748b', title: 'Имени и IP нет — показана заглушка MAC. Такое устройство добавить нельзя.' },
};
function NameSrcBadge({ src }: { src?: DiscoveryNameSource }) {
  if (!src) return null;
  const m = NAME_SRC_META[src];
  if (!m) return null;
  return (
    <span title={m.title} style={{
      background: m.bg, color: m.fg, padding: '1px 6px', borderRadius: 4,
      fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
    }}>{m.label}</span>
  );
}

/** Массовое выбрать/снять для одной секции (только видимые строки). */
function togglePickAll(
  list: DiscoveryDeviceProposal[],
  devPick: Record<string, boolean>,
  setDevPick: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
) {
  const all = list.length > 0 && list.every(d => devPick[d.tempId]);
  setDevPick(p => {
    const next = { ...p };
    for (const d of list) next[d.tempId] = !all;
    return next;
  });
}

const IconPencil = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
  </svg>
);

const ALL_KINDS: DeviceKind[] = [
  'router','switch','patchpanel','ap','camera','server','vm','vps',
  'pc','pos','printer','lock','cloud','pbx','dvr','other',
];

// v0.56.0: редизайн окна проверки — SVG-иконки (без экзотических глифов).
const D_PATHS = {
  radar: (<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><path d="M12 12l5.5-5.5" /></>),
  search: (<><circle cx="11" cy="11" r="6.5" /><path d="M15.8 15.8L20.5 20.5" /></>),
  close: (<path d="M6 6l12 12M18 6L6 18" />),
  chev: (<path d="M6 9.5l6 6 6-6" />),
  info: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5" /><circle cx="12" cy="7.8" r="1.05" fill="currentColor" stroke="none" /></>),
  warn: (<><path d="M12 3.5L22 20H2z" /><path d="M12 9.5v4.5" /><circle cx="12" cy="16.8" r="1.05" fill="currentColor" stroke="none" /></>),
  clock: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3.2 2" /></>),
  check: (<path d="M4.5 12.5l5 5 10-11" />),
  link: (<><path d="M10 14a4.2 4.2 0 006 0l3-3a4.24 4.24 0 00-6-6l-1.5 1.5" /><path d="M14 10a4.2 4.2 0 00-6 0l-3 3a4.24 4.24 0 006 6l1.5-1.5" /></>),
  back: (<path d="M15 5l-7 7 7 7" />),
  cpu: (<><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M10 2.5v3M14 2.5v3M10 18.5v3M14 18.5v3M2.5 10h3M2.5 14h3M18.5 10h3M18.5 14h3" /></>),
  fdb: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9.3h18M3 14.6h18M9.5 9.3v10.7" /></>),
  arp: (<><ellipse cx="12" cy="6" rx="6.5" ry="2.6" /><path d="M5.5 6v12c0 1.4 2.9 2.6 6.5 2.6s6.5-1.2 6.5-2.6V6" /><path d="M5.5 12c0 1.4 2.9 2.6 6.5 2.6s6.5-1.2 6.5-2.6" /></>),
  dhcp: (<path d="M13 2.5L4.5 13.5H11L10 21.5L18.5 10H12z" />),
  snmp: (<><path d="M4 17a8 8 0 0116 0" /><rect x="2.5" y="17" width="19" height="4.5" rx="1.5" /><path d="M12 6.5V9" /></>),
  lldp: (<><path d="M8.5 5.5a5 5 0 000 7M15.5 5.5a5 5 0 010 7M5.8 3a9 9 0 000 12M18.2 3a9 9 0 010 12" /><circle cx="12" cy="9" r="1.6" fill="currentColor" stroke="none" /></>),
  net: (<><circle cx="5.5" cy="12" r="2.5" /><circle cx="18.5" cy="5.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /><path d="M7.8 10.8l8-4M7.8 13.2l8 4" /></>),
  vlan: (<><path d="M4 5.5h16v13H4z" /><path d="M4 10h16M9 5.5v13" /></>),
  sparkle: (<><path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9z" /><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" /></>),
  eyeoff: (<><path d="M4 4l16 16" /><path d="M9.9 5.2A9.8 9.8 0 0112 5c5 0 8.5 4.5 10 7-.4.7-1.2 1.9-2.5 3.1M6 7C4.2 8.4 3 10.4 2 12c1.5 2.5 5 7 10 7 1.5 0 2.9-.4 4.1-1" /><path d="M9.5 9.8a3.2 3.2 0 004.5 4.5" /></>),
};
function DIcon({ n, size = 16, cls }: { n: keyof typeof D_PATHS; size?: number; cls?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={cls}
      style={{ flexShrink: 0 }} aria-hidden="true">
      {D_PATHS[n]}
    </svg>
  );
}
// Сворачивает технические hint'ы движка в короткий «Источник» для таблицы.
function hintSource(hint?: string) {
  if (!hint) return '—';
  let m = /via LLDP\/neighbor from (.+)/.exec(hint);
  if (m) return <>LLDP · <b>{m[1]}</b></>;
  m = /via bridge FDB on (.+)/.exec(hint);
  if (m) return <>FDB · <b>{m[1]}</b></>;
  m = /LLDP neighbour via (.+)/.exec(hint);
  if (m) return <>LLDP · <b>{m[1]}</b></>;
  m = /FDB on (.+)/.exec(hint);
  if (m) return <>FDB · <b>{m[1]}</b></>;
  return hint;
}
/**
 * Строка таблицы устройств в новом дизайне. Модульный компонент (НЕ внутри
 * render), иначе поля ввода пересоздавались бы при каждом нажатии клавиши.
 */
function DiscoveryTableRow({ d, effName, effKind, renamed, kindEdited, checked, disabled, onToggle, onRename, onKind }: {
  d: DiscoveryDeviceProposal;
  effName: string;
  effKind: string;
  renamed: boolean;
  kindEdited: boolean;
  checked: boolean;
  disabled: boolean;
  onToggle: (id: string, v: boolean) => void;
  onRename: (id: string, v: string) => void;
  onKind: (id: string, v: DeviceKind) => void;
}) {
  const km = KIND_META[effKind as DeviceKind] || KIND_META.other;
  const dhcpAlt = d.dhcpComment && d.dhcpComment !== effName ? d.dhcpComment
    : (d.dhcpHost && d.dhcpHost !== effName ? d.dhcpHost : '');
  return (
    <div className="tr dev"
      onClick={e => {
        if ((e.target as HTMLElement).closest('input,select,button,label,a')) return;
        if (disabled) return;
        onToggle(d.tempId, !checked);
      }}>
      <span className="c-check">
        <label className="cb" title={disabled ? 'Устройству нужен IP — добавить нельзя' : undefined}>
          <input type="checkbox" className="row-check" checked={checked} disabled={disabled}
            onChange={e => onToggle(d.tempId, e.target.checked)} />
          <span />
        </label>
      </span>
      <span className="type" style={{ color: km.color }}>
        <select className="type-sel" value={effKind}
          title={kindEdited ? 'Тип задан вручную' : 'Тип устройства — нажмите, чтобы изменить'}
          style={{ background: km.bg, color: km.color }}
          onChange={e => onKind(d.tempId, e.target.value as DeviceKind)}>
          {ALL_KINDS.map(k => <option key={k} value={k}>{KIND_META[k].label}</option>)}
        </select>
      </span>
      <span className="c-name">
        <input className="d-name" value={effName} placeholder="— без имени —" spellCheck={false} autoComplete="off"
          title={renamed ? 'Имя задано вручную' : 'Нажмите, чтобы задать имя'}
          onChange={e => onRename(d.tempId, e.target.value)} />
      </span>
      {d.ip
        ? <span className="c-ip mono">{d.ip}</span>
        : <span className="c-ip mono" style={{ color: 'var(--ink-3)' }}>—</span>}
      <span className="c-mac mono">{d.mac || ''}</span>
      <span className="c-tags">
        {d.nameSource === 'dhcp' && <span className="tag dhcp" title={d.dhcpComment || 'Имя из комментария DHCP-лизы'}>DHCP</span>}
        {d.nameSource === 'sysname' && <span className="tag nm" title="Имя из LLDP SysName">имя</span>}
        {d.nameSource === 'hostname' && <span className="tag host" title="Имя из hostname">host</span>}
        {d.vlan != null && <span className="tag vl" title={`VLAN ${d.vlan}`}>V{d.vlan}</span>}
        {d.vendor && <span className="tag mt" title={`Вендор: ${d.vendor}`}>{d.vendor}</span>}
        {dhcpAlt !== '' && <span className="tag mt" title="DHCP-имя устройства">→ {dhcpAlt}</span>}
        {renamed && <span className="tag nm">переименовано</span>}
        {kindEdited && <span className="tag vl">тип вручную</span>}
        {!d.ip && <span className="tag noip">нет IP</span>}
      </span>
      <span className="c-src" title={d.hint || undefined}>{hintSource(d.hint)}</span>
    </div>
  );
}

/**
 * Строка устройства в предпросмотре. Модульный компонент (НЕ внутри render),
 * иначе поле ввода пересоздавалось бы при каждом нажатии клавиши и теряло фокус.
 * v0.53.0: карандаш делает переименование очевидным; тип меняется селектором.
 */
function DiscoveryDeviceRow({ d, effName, effKind, renamed, kindEdited, checked, disabled, onToggle, onRename, onKind }: {
  d: DiscoveryDeviceProposal;
  effName: string;
  effKind: string;
  renamed: boolean;
  kindEdited: boolean;
  checked: boolean;
  disabled: boolean;
  onToggle: (tempId: string, v: boolean) => void;
  onRename: (tempId: string, v: string) => void;
  onKind: (tempId: string, v: DeviceKind) => void;
}) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const km = KIND_META[effKind as DeviceKind] || KIND_META.pc;
  const showEdit = !disabled && (hover || focused || renamed);
  // DHCP-подсказка, если она не стала именем — видно, откуда можно взять имя.
  const dhcpAlt = d.dhcpComment && d.dhcpComment !== effName ? d.dhcpComment
    : (d.dhcpHost && d.dhcpHost !== effName ? d.dhcpHost : '');
  return (
    <label style={{
      ...S.row,
      ...(checked && !disabled ? S.rowChecked : {}),
      ...(disabled ? { opacity: 0.6 } : {}),
    }}
      title={disabled ? 'Только MAC, без IP — добавить нельзя' : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={e => onToggle(d.tempId, e.target.checked)} />
      {disabled
        ? <KindChip kind={d.kind} />
        : (
          <select value={effKind}
            onClick={e => e.stopPropagation()}
            onChange={e => onKind(d.tempId, e.target.value as DeviceKind)}
            title={d.kindConfident === false
              ? 'Тип не распознан — выберите вручную'
              : 'Тип устройства — можно изменить'}
            style={{
              ...S.kindSelect, background: km.bg, color: km.color,
              borderColor: kindEdited ? km.color : 'transparent',
            }}>
            {ALL_KINDS.map(k => <option key={k} value={k}>{KIND_META[k].label}</option>)}
          </select>
        )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            ref={inputRef}
            value={effName} disabled={disabled}
            onClick={e => e.stopPropagation()}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={e => onRename(d.tempId, e.target.value)}
            title={disabled ? undefined : 'Имя устройства — нажмите на карандаш или кликните и правьте'}
            style={{
              ...S.nameInput,
              ...(showEdit ? S.nameInputActive : {}),
              ...(renamed ? S.nameInputEdited : {}),
            }}
          />
          {showEdit && (
            <button type="button" title="Переименовать"
              onClick={e => { e.stopPropagation(); e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); }}
              style={S.pencilBtn}>
              <IconPencil />
            </button>
          )}
          <NameSrcBadge src={d.nameSource} />
        </div>
        <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {d.ip && <span style={S.mono}>{d.ip}</span>}
          {d.mac && <span> · <span style={S.mono}>{d.mac}</span></span>}
          {d.vlan != null && <span style={S.vlanMini} title={`VLAN ${d.vlan}`}>V{d.vlan}</span>}
          {d.vendor && <span> · {d.vendor}</span>}
          {dhcpAlt ? <span style={{ color: '#166534' }}> · DHCP: {dhcpAlt}</span> : null}
          {renamed ? <span style={{ color: '#2563eb' }}> · переименовано</span> : null}
          {kindEdited ? <span style={{ color: '#7c3aed' }}> · тип вручную</span> : null}
        </div>
      </div>
      <div style={{ fontSize: 10, color: '#94a3b8', maxWidth: 150, textAlign: 'right' }}>{d.hint}</div>
    </label>
  );
}

// ============================================================================
// Component
// ============================================================================

interface Props { open: boolean; onClose: () => void; }

type Phase = 'form' | 'testing' | 'scanning' | 'review' | 'applying' | 'done';

export function DiscoveryDialog({ open, onClose }: Props) {
  // --- form state --------------------------------------------------------
  const [mode, setMode] = useState<DiscoveryConfig['mode']>('both');
  const [host, setHost] = useState('192.168.11.1');
  const [port, setPort] = useState<number>(22);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [community, setCommunity] = useState('public');
  const [snmpSweep, setSnmpSweep] = useState(false);
  // v0.51.20: рекурсивный обход — management-IP LLDP-соседей становятся
  // целями следующих волн SNMP-опроса.
  const [snmpRecursive, setSnmpRecursive] = useState(true);
  const [snmpMaxHops, setSnmpMaxHops] = useState(2);

  // --- scan state --------------------------------------------------------
  const [phase, setPhase] = useState<Phase>('form');
  const [testMsg, setTestMsg] = useState<string>('');
  const [scan, setScan] = useState<DiscoveryScanResult | null>(null);
  const [devPick, setDevPick] = useState<Record<string, boolean>>({});
  const [linkPick, setLinkPick] = useState<Record<string, boolean>>({});
  const [applyReport, setApplyReport] = useState<{ dev: number; link: number } | null>(null);
  // v0.52.0: фильтры предпросмотра (как в обычном импорте) + переименование.
  const [q, setQ] = useState('');
  const [excludedCidrs, setExcludedCidrs] = useState<Set<string>>(new Set());
  const [excludedVlans, setExcludedVlans] = useState<Set<number>>(new Set());
  const [showNoIp, setShowNoIp] = useState(false);
  const [nameEdits, setNameEdits] = useState<Record<string, string>>({});
  // v0.53.0: ручной выбор типа устройства прямо в предпросмотре.
  const [kindEdits, setKindEdits] = useState<Record<string, DeviceKind>>({});

  // Reset when re-opened
  useEffect(() => {
    if (open) {
      setPhase('form');
      setScan(null);
      setDevPick({});
      setLinkPick({});
      setTestMsg('');
      setApplyReport(null);
      setQ('');
      setExcludedCidrs(new Set());
      setExcludedVlans(new Set());
      setShowNoIp(false);
      setNameEdits({});
      setKindEdits({});
    }
  }, [open]);

  const doc = useStore(s => s.doc);
  const applyDiscovery = useStore(s => s.applyDiscovery);
  const pushAlert = useStore(s => s.pushAlert);

  const currentCfg: DiscoveryConfig = {
    mode, host, port, username, password,
    snmpCommunity: community,
    snmpSweep,
    snmpRecursive,
    snmpMaxHops,
  };

  // --- helpers -----------------------------------------------------------
  async function onTest() {
    setPhase('testing'); setTestMsg('');
    try {
      const r = await discoveryTest(currentCfg);
      const parts: string[] = [];
      if (r.mikrotik) parts.push(r.mikrotik.ok ? `MikroTik: ${r.mikrotik.identity || 'ok'}` : `MikroTik: ${r.mikrotik.error || 'fail'}`);
      if (r.snmp) parts.push(r.snmp.ok ? `SNMP: ${r.snmp.sysName || 'ok'}` : `SNMP: ${r.snmp.error || 'fail'}`);
      setTestMsg(parts.join('   ·   ') || 'Нет ответа.');
    } catch (e: any) {
      setTestMsg('Ошибка: ' + (e?.message || String(e)));
    } finally {
      setPhase('form');
    }
  }

  async function onScan() {
    setPhase('scanning');
    setScan(null);
    try {
      const r = await discoveryScan({ ...currentCfg, doc });
      setScan(r);
      // Default: all rows selected (MAC-only rows are visible but never apply —
      // v0.52.0 requires every added device to have an IP).
      const dp: Record<string, boolean> = {};
      for (const d of r.proposedDevices) dp[d.tempId] = true;
      const lp: Record<string, boolean> = {};
      for (const l of r.proposedLinks) lp[l.tempId] = true;
      setDevPick(dp); setLinkPick(lp);
      setQ('');
      setExcludedCidrs(new Set());
      setExcludedVlans(new Set());
      setShowNoIp(false);
      setNameEdits({});
      setKindEdits({});
      setPhase('review');
    } catch (e: any) {
      setPhase('form');
      await alertDialog('Не удалось выполнить сканирование', e?.message || String(e));
    }
  }

  async function onApply() {
    if (!scan) return;
    setPhase('applying');

    // v0.52.0: создаём только ЭФФЕКТИВНОЕ множество — выбранные галочкой,
    // видимые (не скрытые фильтрами подсетей/VLAN/поиска) и ОБЯЗАТЕЛЬНО с IP.
    // Устройства без IP добавить нельзя: галочки у них нет, а связи, висящие
    // на непринятых устройствах, пропускаются автоматически со счётчиком.
    const finalIdByTemp = new Map<string, string>();
    const devicesToCreate: any[] = [];
    for (const d of scan.proposedDevices) {
      if (!effectiveDevIds.has(d.tempId)) continue;
      const finalId = `dsc-${d.tempId.replace(/^new_/, '')}`;
      const finalName = (effNameOf(d).trim() || d.name).slice(0, 128);
      const tags = ['discovered'];
      if (d.hint) tags.push(d.hint);
      if (d.vlan != null) tags.push(`VLAN ${d.vlan}`);
      devicesToCreate.push({
        id: finalId,
        name: finalName,
        kind: effKindOf(d),
        ip: d.ip,
        mac: d.mac,
        vendor: d.vendor,
        vlan: d.vlan ?? undefined,   // v0.55.0: VLAN едет в порт — smart-раскладка группирует по VLAN
        tags,
      });
      finalIdByTemp.set(d.tempId, finalId);
    }

    function resolveRef(ref: { existingId?: string; tempId?: string }): string | null {
      if (ref.existingId) return ref.existingId;
      if (ref.tempId) return finalIdByTemp.get(ref.tempId) || null;
      return null;
    }

    const linksToCreate: any[] = [];
    let droppedLinks = 0;
    for (const l of scan.proposedLinks) {
      if (!linkPick[l.tempId]) continue;
      if (!isLinkVisible(l)) { droppedLinks++; continue; }
      const from = resolveRef(l.fromRef);
      const to   = resolveRef(l.toRef);
      if (!from || !to) { droppedLinks++; continue; }
      linksToCreate.push({
        id: `dsc-lnk-${l.tempId.replace(/^lnk_/, '')}`,
        fromDeviceId: from,
        toDeviceId: to,
        fromPortId: l.fromPort || undefined,
        toPortId: l.toPort || undefined,
        cable: l.cable || 'copper',
        label: l.evidence || undefined,
      });
    }

    const report = applyDiscovery({ devices: devicesToCreate, links: linksToCreate });
    setApplyReport({ dev: report.addedDevices, link: report.addedLinks });
    // v0.51.22: сразу раскладываем карту автоматически — иначе сетка из
    // сотен новых карточек остаётся налезать на существующие группы
    // (жалоба пользователя после автообнаружения). Умная раскладка группирует
    // по локация/VLAN/подсеть и растаскивает всё без пересечений.
    // Откатится тем же Ctrl+Z, что и применение (history snapshot внутри).
    if (report.addedDevices > 0) {
      try {
        useStore.getState().autoLayout('TB', { groupBy: 'hybrid' });
      } catch { /* раскладка не критична — карта останется как есть */ }
    }
    pushAlert({
      severity: 'success', origin: 'import',
      title: 'Автообнаружение применено',
      message: `Добавлено устройств: ${report.addedDevices}, связей: ${report.addedLinks}` +
               (report.addedDevices > 0 ? '. Карта разложена автоматически.' : '') +
               (droppedLinks ? ` (пропущено связей: ${droppedLinks}, без обеих сторон)` : ''),
    });
    // v0.55.0: вписываем разложенную карту в экран за диалогом — иначе после
    // большого импорта пользователь видит пустое место и жмёт F сам.
    setTimeout(() => window.dispatchEvent(new CustomEvent('netmap:fit-view')), 350);
    setPhase('done');
  }

  // --- pre-render aggregates --------------------------------------------
  // v0.52.0: имя с учётом ручной правки. Секции «с именем/без имени» строим
  // по ИСХОДНОМУ nameSource (не по правке), чтобы строка не прыгала между
  // секциями при каждом нажатии клавиши и не теряла фокус ввода.
  function effNameOf(d: DiscoveryDeviceProposal): string {
    return nameEdits[d.tempId] ?? d.name;
  }
  // v0.53.0: тип с учётом ручного выбора. Секция «неизвестных» строится по
  // ИСХОДНОМУ kindConfident, чтобы строка не прыгала при выборе типа.
  function effKindOf(d: DiscoveryDeviceProposal): string {
    return kindEdits[d.tempId] ?? d.kind;
  }
  function hasRealName(d: DiscoveryDeviceProposal): boolean {
    // Настоящее имя — из DHCP-комментария, имени устройства или host-name.
    // IP/MAC-заглушки — «без имени». Фолбэк для данных без nameSource:
    // имя отличается от IP и MAC.
    if (!d.nameSource) return !!d.name && d.name !== d.ip && d.name !== d.mac;
    return d.nameSource === 'dhcp' || d.nameSource === 'sysname' || d.nameSource === 'hostname';
  }

  // Подсети: сначала эталонные CIDR роутера (/ip/address), остаток — по /24.
  // Зеркалит summarizeSubnets из обычного импорта, но по proposedDevices.
  const subnetStats: DiscSubnet[] = useMemo(() => {
    if (!scan) return [];
    const stats = new Map<string, DiscSubnet>();
    for (const s of scan.subnets || []) {
      if (!s.cidr || stats.has(s.cidr)) continue;
      stats.set(s.cidr, {
        cidr: s.cidr, count: 0,
        iface: s.interface || undefined, comment: s.comment || undefined,
        fromRouter: true,
      });
    }
    for (const d of scan.proposedDevices) {
      if (!d.ip) continue;
      let hit: DiscSubnet | undefined;
      for (const s of stats.values()) {
        if (ipInAnyCidr(d.ip, [s.cidr])) { hit = s; break; }
      }
      if (hit) { hit.count++; continue; }
      const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(d.ip);
      if (!m) continue;
      const c = `${m[1]}.${m[2]}.${m[3]}.0/24`;
      const ex = stats.get(c);
      if (ex) ex.count++;
      else stats.set(c, { cidr: c, count: 1, fromRouter: false });
    }
    // v0.54.0: широкие подсети роутера (/16 и крупнее) раскрываем по /24,
    // иначе внутренние сети не видны и их нельзя исключать точечно.
    const byParent = new Map<string, Map<string, number>>();
    for (const s of stats.values()) {
      const bits = Number(/^.*\/(\d{1,2})$/.exec(s.cidr)?.[1]);
      if (!s.fromRouter || !Number.isFinite(bits) || bits >= 24) continue;
      byParent.set(s.cidr, new Map());
    }
    if (byParent.size > 0) {
      for (const d of scan.proposedDevices) {
        if (!d.ip) continue;
        const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(d.ip);
        if (!m) continue;
        for (const [pcidr, buckets] of byParent) {
          if (!ipInAnyCidr(d.ip, [pcidr])) continue;
          const c = `${m[1]}.${m[2]}.${m[3]}.0/24`;
          buckets.set(c, (buckets.get(c) || 0) + 1);
          break; // как и в основном подсчёте — первое совпадение
        }
      }
      for (const s of stats.values()) {
        const buckets = byParent.get(s.cidr);
        if (buckets && buckets.size >= 2) {
          s.parts = Array.from(buckets.entries())
            .map(([cidr, count]) => ({ cidr, count }))
            .sort((a, b) => b.count - a.count || (a.cidr < b.cidr ? -1 : 1));
        }
      }
    }
    return Array.from(stats.values())
      .sort((a, b) => b.count - a.count || (a.cidr < b.cidr ? -1 : 1));
  }, [scan]);

  const vlanStats: DiscVlan[] = useMemo(() => {
    if (!scan) return [];
    const names = new Map<number, string>();
    for (const v of scan.vlans || []) if (v.name) names.set(v.id, v.name);
    const counts = new Map<number, number>();
    for (const d of scan.proposedDevices) {
      if (d.vlan == null) continue;
      counts.set(d.vlan, (counts.get(d.vlan) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([id, count]) => ({ id, count, name: names.get(id) }))
      .sort((a, b) => a.id - b.id);
  }, [scan]);
  const noVlanCount = useMemo(
    () => scan ? scan.proposedDevices.filter(d => d.ip && d.vlan == null).length : 0,
    [scan]);

  const exclCidrArr = useMemo(() => Array.from(excludedCidrs), [excludedCidrs]);
  const qTrim = q.trim().toLowerCase();
  function isVisibleDevice(d: DiscoveryDeviceProposal): boolean {
    if (!d.ip && !showNoIp) return false;
    if (d.ip && exclCidrArr.length > 0 && ipInAnyCidr(d.ip, exclCidrArr)) return false;
    if (d.vlan != null && excludedVlans.has(d.vlan)) return false;
    if (qTrim) {
      const hay = [effNameOf(d), d.name, d.ip, d.mac, d.vendor, d.hint,
                   d.dhcpComment, d.dhcpHost].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(qTrim)) return false;
    }
    return true;
  }

  const namedDevs = useMemo(
    () => (scan?.proposedDevices || []).filter(d => d.ip && d.kindConfident !== false && hasRealName(d) && isVisibleDevice(d)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan, qTrim, exclCidrArr, excludedVlans, showNoIp, nameEdits]);
  const unnamedDevs = useMemo(
    () => (scan?.proposedDevices || []).filter(d => d.ip && d.kindConfident !== false && !hasRealName(d) && isVisibleDevice(d)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan, qTrim, exclCidrArr, excludedVlans, showNoIp, nameEdits]);
  // v0.53.0: тип не выдавили из отпечатков — отдельная группа, тип выбирает
  // пользователь селектором в строке (имеет приоритет над именем).
  const unknownDevs = useMemo(
    () => (scan?.proposedDevices || []).filter(d => d.ip && d.kindConfident === false && isVisibleDevice(d)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan, qTrim, exclCidrArr, excludedVlans, showNoIp, nameEdits]);
  // v0.56.0: редизайн окна проверки — сортировка таблицы, аккордеоны,
  // измерение липких отступов (ResizeObserver переживает зум и перестройку чипов).
  const [sortKey, setSortKey] = useState<'type' | 'name' | 'ip' | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [snmpOpen, setSnmpOpen] = useState(false);
  const [warnOpen, setWarnOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const devicesRef = useRef<HTMLDivElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLDivElement>(null);
  const masterCbRef = useRef<HTMLInputElement>(null);
  const theadCbRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (phase !== 'review') return;
    const apply = () => {
      const sc = scrollRef.current;
      if (!sc) return;
      sc.style.setProperty('--stick-top', `${filtersRef.current?.offsetHeight ?? 0}px`);
      sc.style.setProperty('--thead-h', `${theadRef.current?.offsetHeight ?? 36}px`);
    };
    apply();
    const t = setTimeout(apply, 60);
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(apply);
      if (filtersRef.current) ro.observe(filtersRef.current);
      if (theadRef.current) ro.observe(theadRef.current);
    } catch { /* старые движки — работаем на фолбэках из CSS */ }
    window.addEventListener('resize', apply);
    return () => {
      clearTimeout(t);
      try { ro?.disconnect(); } catch { /* noop */ }
      window.removeEventListener('resize', apply);
    };
  }, [phase, scan, q, showNoIp, excludedCidrs, excludedVlans, snmpOpen, warnOpen, sortKey, sortDir]);

  // v0.54.0: все видимые (под фильтрами) устройства с IP — для глобального тумблера.
  const visibleDevs = useMemo(
    () => [...namedDevs, ...unnamedDevs, ...unknownDevs],
    [namedDevs, unnamedDevs, unknownDevs]);
  const allVisiblePicked = visibleDevs.length > 0 && visibleDevs.every(d => devPick[d.tempId]);
  function toggleAllVisible() {
    const target = !allVisiblePicked;
    setDevPick(p => {
      const next = { ...p };
      for (const d of visibleDevs) next[d.tempId] = target;
      return next;
    });
  }
  // v0.56.0: промежуточное состояние мастер-галок («выбрано частично»).
  const someVisiblePicked = visibleDevs.some(d => devPick[d.tempId]);
  useEffect(() => {
    const ind = someVisiblePicked && !allVisiblePicked;
    if (masterCbRef.current) masterCbRef.current.indeterminate = ind;
    if (theadCbRef.current) theadCbRef.current.indeterminate = ind;
  });

  function plural(n: number, one: string, few: string, many: string): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  // Прокрутка шагов строго внутри скролл-контейнера (страница-карта сзади не едет).
  function scrollToEl(el: HTMLElement | null) {
    const sc = scrollRef.current;
    if (!sc || !el) return;
    const y = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    sc.scrollTo({ top: Math.max(0, y - 8), behavior: 'smooth' });
  }
  // --- Сортировка таблицы (внутри групп) ---
  const collator = useMemo(() => new Intl.Collator('ru', { numeric: true, sensitivity: 'base' }), []);
  function ipNum(ip?: string): number {
    if (!ip) return Number.MAX_SAFE_INTEGER;
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
    if (!m) return Number.MAX_SAFE_INTEGER;
    return (+m[1]) * 16777216 + (+m[2]) * 65536 + (+m[3]) * 256 + (+m[4]);
  }
  function sortRows(rows: DiscoveryDeviceProposal[]): DiscoveryDeviceProposal[] {
    if (!sortKey) return rows;
    const dir = sortDir;
    const arr = [...rows];
    const kindLabel = (d: DiscoveryDeviceProposal) =>
      (KIND_META[effKindOf(d) as DeviceKind] || KIND_META.other).label;
    if (sortKey === 'name') {
      arr.sort((a, b) => {
        const an = effNameOf(a).trim(), bn = effNameOf(b).trim();
        if (!an && !bn) return 0;
        if (!an) return 1;
        if (!bn) return -1;
        return collator.compare(an, bn) * dir;
      });
    } else if (sortKey === 'ip') {
      arr.sort((a, b) => (ipNum(a.ip) - ipNum(b.ip)) * dir
        || collator.compare(effNameOf(a), effNameOf(b)) * dir);
    } else {
      arr.sort((a, b) => collator.compare(kindLabel(a), kindLabel(b)) * dir
        || collator.compare(effNameOf(a), effNameOf(b)) * dir);
    }
    return arr;
  }
  function toggleSort(k: 'type' | 'name' | 'ip') {
    if (sortKey === k) setSortDir(d => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(1); }
  }
  // --- Поиск распространяется и на связи: невидимые не применяются ---
  function isLinkVisible(l: DiscoveryLinkProposal): boolean {
    if (!qTrim) return true;
    const hay = [refLabel(l.fromRef), refLabel(l.toRef), l.fromPort, l.toPort, l.evidence]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(qTrim);
  }
  const visibleLinks = useMemo(
    () => (scan?.proposedLinks || []).filter(isLinkVisible),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan, qTrim, nameEdits]);
  // --- Данные аккордеонов ---
  const realWarnings = useMemo(
    () => (scan?.warnings || []).filter(w => !/хостов:.*timed?\s*out/i.test(w)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan]);
  const snmpExample = useMemo(() => {
    for (const w of scan?.warnings || []) {
      const m = /\((например:[^)]+)\)/.exec(w);
      if (m) return m[1];
    }
    return '';
  }, [scan]);
  const snmpProbed = scan?.stats?.snmpProbed ?? scan?.stats?.snmpHosts ?? 0;
  const snmpAnswered = scan?.stats?.snmpHosts ?? 0;
  const snmpSilent = Math.max(0, snmpProbed - snmpAnswered);
  const snmpResponders = useMemo(
    () => (scan?.seeds || []).filter(s => s.ok).map(s => s.name || s.host).filter(Boolean) as string[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan]);
  const noIpDevs = useMemo(
    () => (scan?.proposedDevices || []).filter(d => !d.ip && isVisibleDevice(d)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan, qTrim, exclCidrArr, excludedVlans, showNoIp, nameEdits]);
  const noIpTotal = useMemo(
    () => scan ? scan.proposedDevices.filter(d => !d.ip).length : 0, [scan]);
  // v0.56.0: группы таблицы устройств (отсортированные внутри групп).
  const unknownGroup = useMemo(
    () => sortRows([...unknownDevs, ...(showNoIp ? noIpDevs : [])]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unknownDevs, noIpDevs, showNoIp, sortKey, sortDir, nameEdits, kindEdits]);
  const namedGroup = useMemo(
    () => sortRows(namedDevs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [namedDevs, sortKey, sortDir, nameEdits, kindEdits]);
  const unnamedGroup = useMemo(
    () => sortRows(unnamedDevs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unnamedDevs, sortKey, sortDir, nameEdits, kindEdits]);
  const unknownPickable = useMemo(() => unknownGroup.filter(d => d.ip), [unknownGroup]);
  const visibleRowCount = unknownGroup.length + namedGroup.length + unnamedGroup.length;

  // Эффективное множество: выбрано галочкой + видимо + есть IP.
  const effectiveDevIds = useMemo(() => {
    const s = new Set<string>();
    for (const d of namedDevs) if (devPick[d.tempId]) s.add(d.tempId);
    for (const d of unnamedDevs) if (devPick[d.tempId]) s.add(d.tempId);
    for (const d of unknownDevs) if (devPick[d.tempId]) s.add(d.tempId);
    return s;
  }, [namedDevs, unnamedDevs, unknownDevs, devPick]);
  const hiddenPicked = useMemo(
    () => (scan?.proposedDevices || []).filter(d => d.ip && devPick[d.tempId] && !isVisibleDevice(d)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan, devPick, qTrim, exclCidrArr, excludedVlans, showNoIp]);

  function linkEndpointsOk(l: DiscoveryLinkProposal): boolean {
    const okRef = (ref: { existingId?: string; tempId?: string }) =>
      ref.existingId ? true : (ref.tempId ? effectiveDevIds.has(ref.tempId) : false);
    return okRef(l.fromRef) && okRef(l.toRef);
  }
  // v0.56.0: поиск скрывает связи и в списке, и из применения.
  const willApplyLinks = useMemo(
    () => (scan?.proposedLinks || []).filter(l => linkPick[l.tempId] && linkEndpointsOk(l) && isLinkVisible(l)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan, linkPick, effectiveDevIds, qTrim, nameEdits]);
  const willDropLinks = useMemo(
    () => (scan?.proposedLinks || []).filter(l => linkPick[l.tempId] && (!linkEndpointsOk(l) || !isLinkVisible(l))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan, linkPick, effectiveDevIds, qTrim, nameEdits]);

  const selDev = effectiveDevIds.size;
  const selLink = willApplyLinks.length;

  const devByTempId = useMemo(() => {
    const m = new Map<string, DiscoveryDeviceProposal>();
    scan?.proposedDevices.forEach(d => m.set(d.tempId, d));
    return m;
  }, [scan]);
  const existingById = useMemo(() => {
    const m = new Map<string, string>(); // id -> displayName
    for (const d of doc.devices) m.set(d.id, d.name);
    return m;
  }, [doc]);
  function refLabel(ref: { existingId?: string; tempId?: string }) {
    if (ref.existingId) {
      const name = existingById.get(ref.existingId);
      return name ? `${name} (существующий)` : `${ref.existingId} (существующий)`;
    }
    if (ref.tempId) {
      const p = devByTempId.get(ref.tempId);
      return p ? effNameOf(p) : ref.tempId;
    }
    return '?';
  }

  if (!open) return null;

  return createPortal(
    <div style={S.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...S.dialog, ...(phase === 'review' ? { width: 1060, maxWidth: '96vw' } : {}) }} className="nm-disc">
        <header className="m-head">
          <div className="h-icon"><DIcon n="radar" size={26} /></div>
          <div className="h-txt">
            <h1>Автообнаружение топологии</h1>
            <div className="h-methods">
              <span>LLDP</span><span>MikroTik neighbors</span><span>Bridge FDB</span><span>ARP</span><span>DHCP</span>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} title="Закрыть"><DIcon n="close" size={18} /></button>
        </header>

        {/* ============ FORM ============ */}
        {(phase === 'form' || phase === 'testing') && (
          <div style={S.body}>
            <div style={S.section}>
              <div style={S.sectionTitle}>Источник данных</div>
              <div style={S.segRow}>
                {(['mikrotik', 'snmp', 'both'] as const).map(m => (
                  <button key={m}
                    onClick={() => setMode(m)}
                    style={{ ...S.segBtn, ...(mode === m ? S.segBtnActive : {}) }}>
                    {m === 'mikrotik' ? 'MikroTik (SSH)' : m === 'snmp' ? 'SNMP (LLDP)' : 'Оба'}
                  </button>
                ))}
              </div>
              <div style={S.hint}>
                {mode === 'mikrotik' && 'Заходим по SSH на MikroTik, читаем /ip neighbor, /ip arp, /interface bridge host, DHCP leases (имена) и VLAN.'}
                {mode === 'snmp' && 'Опрашиваем SNMP v2c: LLDP-MIB (соседи) + BRIDGE-MIB (FDB). Работает на любом managed switch/AP с включённым SNMP.'}
                {mode === 'both' && 'MikroTik → SSH, остальные вендоры → SNMP. Результаты объединяются, дубликаты фильтруются.'}
              </div>
            </div>

            <div style={S.section}>
              <div style={S.sectionTitle}>Целевое устройство</div>
              <div style={S.formGrid}>
                <label style={S.label}>Host / IP
                  <input value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.11.1" style={S.input} />
                </label>
                {(mode === 'mikrotik' || mode === 'both') && (
                  <>
                    <label style={S.label}>SSH порт
                      <input type="number" value={port} onChange={e => setPort(Number(e.target.value) || 22)} style={S.input} />
                    </label>
                    <label style={S.label}>Логин
                      <input value={username} onChange={e => setUsername(e.target.value)} style={S.input} />
                    </label>
                    <label style={S.label}>Пароль
                      <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={S.input} />
                    </label>
                    {/* v0.51.21: учётные данные из Vault / в Vault */}
                    <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'flex-end' }}>
                      <VaultCredsButtons
                        host={host} purpose="ssh" serviceLabel="MikroTik SSH" folder="MikroTik"
                        fields={[{ key: 'username', label: 'Логин' }, { key: 'password', label: 'Пароль' }, { key: 'port', label: 'Порт' }]}
                        values={{ username, password, port: String(port) }}
                        onApply={v => {
                          setUsername(v.username ?? '');
                          setPassword(v.password ?? '');
                          // v0.53.0: порт тоже храним в записи (раньше терялся).
                          if (v.port != null && v.port !== '') {
                            const p = parseInt(v.port, 10);
                            if (Number.isFinite(p) && p > 0 && p < 65536) setPort(p);
                          }
                        }}
                      />
                    </div>
                  </>
                )}
                {(mode === 'snmp' || mode === 'both') && (
                  <>
                    <label style={S.label}>SNMP community
                      <input value={community} onChange={e => setCommunity(e.target.value)} placeholder="public" style={S.input} />
                    </label>
                    {/* v0.51.21 */}
                    <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'flex-end' }}>
                      <VaultCredsButtons
                        host={host} purpose="snmp" serviceLabel="SNMP community" folder="SNMP"
                        fields={[{ key: 'community', label: 'Community' }]}
                        values={{ community }}
                        onApply={v => { if (v.community != null) setCommunity(v.community); }}
                      />
                    </div>
                    <label style={{ ...S.label, gridColumn: 'span 2', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={snmpSweep} onChange={e => setSnmpSweep(e.target.checked)} />
                      <span style={{ fontSize: 12 }}>Опросить SNMP на всех ARP-адресах (медленнее, но глубже)</span>
                    </label>
                    {/* v0.51.20 */}
                    <label style={{ ...S.label, gridColumn: 'span 2', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={snmpRecursive} onChange={e => setSnmpRecursive(e.target.checked)} />
                      <span style={{ fontSize: 12 }}>Рекурсивный обход по LLDP: опрашивать соседей найденных устройств</span>
                    </label>
                    {snmpRecursive && (
                      <label style={{ ...S.label, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12 }}>Глубина обхода</span>
                        <select value={snmpMaxHops} onChange={e => setSnmpMaxHops(Number(e.target.value))} style={S.input}>
                          <option value={1}>1 прыжок</option>
                          <option value={2}>2 прыжка</option>
                          <option value={3}>3 прыжка</option>
                        </select>
                      </label>
                    )}
                  </>
                )}
              </div>
            </div>

            {testMsg && (
              <div style={{ ...S.section, background: '#f8fafc', padding: 10, borderRadius: 8, fontSize: 12, color: '#334155' }}>
                {testMsg}
              </div>
            )}

            <div style={S.footer}>
              <button style={{ ...S.btnSecondary, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      disabled={phase === 'testing'} onClick={onTest}>
                {phase === 'testing' && <MiniSpinner />}
                {phase === 'testing' ? 'Проверяем…' : 'Проверить подключение'}
              </button>
              <div style={{ flex: 1 }} />
              <button style={S.btnPrimary} disabled={phase === 'testing' || !host} onClick={onScan}>
                <IconPlay /> Запустить сканирование
              </button>
            </div>
          </div>
        )}

        {/* ============ SCANNING ============ */}
        {phase === 'scanning' && (
          <div style={{ ...S.body, alignItems: 'center', justifyContent: 'center', minHeight: 260 }}>
            <MiniSpinner size={44} />
            <div style={{ marginTop: 16, fontSize: 14, fontWeight: 600, color: '#334155' }}>Опрашиваем сеть…</div>
            <div style={{ marginTop: 4, fontSize: 11, color: '#94a3b8', textAlign: 'center', maxWidth: 320 }}>
              SSH + SNMP walks (LLDP · Bridge FDB · ARP). Обычно 5–30 сек в зависимости от размера сети.
            </div>
            <div style={{ marginTop: 20, width: 240 }}>
              <ProgressStripe width="100%" height={6} />
            </div>
            <ScanStages mode={mode} />
          </div>
        )}

        {/* ============ REVIEW ============ */}
        {/* v0.54.0: футер — sibling скроллящегося body, всегда виден */}
        {phase === 'review' && scan && (
          <>
          <div ref={scrollRef} className="dscroll">
            {/* v0.56.0: саммари + кликабельные шаги. */}
            <section className="summary">
              <div>
                <div className="s-label"><DIcon n="sparkle" size={14} /> Сканирование завершено · найдено новых</div>
                <div className="s-big">
                  {scan.proposedDevices.filter(d => d.ip).length} <small>{plural(scan.proposedDevices.filter(d => d.ip).length, 'устройство', 'устройства', 'устройств')}</small>
                  <span className="dot">·</span>{scan.proposedLinks.length} <small>{plural(scan.proposedLinks.length, 'связь', 'связи', 'связей')}</small>
                </div>
                {noIpTotal > 0 && (
                  <div className="s-note" title="Известен только MAC — добавить такие устройства нельзя, устройству обязательно нужен IP.">
                    <DIcon n="warn" size={13} /> {noIpTotal} без IP — не добавятся
                  </div>
                )}
              </div>
              <ol className="steps">
                <li onClick={() => scrollToEl(filtersRef.current)} title="Прокрутить к фильтрам: снимите галки с чужих подсетей и VLAN">
                  <i>1</i><div><b>Исключите лишнее</b><small>подсети и VLAN</small></div>
                </li>
                <li onClick={() => scrollToEl(devicesRef.current)} title="Прокрутить к устройствам без типа — задайте тип селектором">
                  <i>2</i><div><b>Проверьте типы</b><small>и имена</small></div>
                </li>
                <li onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })} title="Прокрутить вниз — кнопка «Применить выбранное»">
                  <i>3</i><div><b>Примените</b><small>внизу окна</small></div>
                </li>
              </ol>
            </section>
            {/* v0.56.0: живая статистика движка — что реально отработало. */}
            <div className="metrics">
              <div className="metric" title="LLDP-соседей собрано">
                <div className="m-top"><DIcon n="lldp" size={14} />LLDP</div>
                <div className="m-val">{scan.stats?.lldpEntries ?? 0}</div>
                <div className="m-sub">соседей</div>
              </div>
              <div className="metric" title="Соседей через MikroTik API">
                <div className="m-top"><DIcon n="cpu" size={14} />Соседи MT</div>
                <div className="m-val">{scan.stats?.neighborsFound ?? 0}</div>
                <div className="m-sub">через API</div>
              </div>
              <div className="metric" title="Записей bridge FDB">
                <div className="m-top"><DIcon n="fdb" size={14} />Bridge FDB</div>
                <div className="m-val">{scan.stats?.fdbEntries ?? 0}</div>
                <div className="m-sub">записей</div>
              </div>
              <div className="metric" title="Записей ARP">
                <div className="m-top"><DIcon n="arp" size={14} />ARP</div>
                <div className="m-val">{scan.stats?.arpEntries ?? 0}</div>
                <div className="m-sub">записей</div>
              </div>
              <div className="metric" title="DHCP-лиз прочитано">
                <div className="m-top"><DIcon n="dhcp" size={14} />DHCP</div>
                <div className="m-val">{scan.stats?.leases ?? 0}</div>
                <div className="m-sub">лиз</div>
              </div>
              {snmpProbed > 0 && (
                <div className="metric tone-brand" title={`Опрошено хостов по SNMP: ${snmpProbed}, ответили: ${snmpAnswered}`}>
                  <div className="m-top"><DIcon n="snmp" size={14} />SNMP</div>
                  <div className="m-val">{snmpAnswered}<small>/{snmpProbed}</small></div>
                  <div className="m-bar"><i style={{ width: `${Math.round((snmpAnswered / snmpProbed) * 100)}%` }} /></div>
                </div>
              )}
              <div className="metric" title="Длительность сканирования">
                <div className="m-top"><DIcon n="clock" size={14} />Время</div>
                <div className="m-val">{((scan.stats?.ms ?? 0) / 1000).toFixed(1)}<small>с</small></div>
                <div className="m-sub">сканирование</div>
              </div>
            </div>

            {/* v0.56.0: аккордеоны SNMP и предупреждений. */}
            {snmpProbed > 0 && (
              <div className={'snmp' + (snmpOpen ? ' open' : '')}>
                <div className="snmp-head" onClick={() => setSnmpOpen(o => !o)} role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSnmpOpen(o => !o); } }}>
                  <DIcon n="info" size={16} />
                  <span>SNMP: {snmpSilent > 0
                    ? `${snmpSilent} ${plural(snmpSilent, 'хост молчит', 'хоста молчат', 'хостов молчат')}`
                    : `все ${snmpProbed} ${plural(snmpProbed, 'ответил', 'ответили', 'ответили')}`}</span>
                  {snmpSilent > 0 && <span className="pill-ok">это норма</span>}
                  <DIcon n="chev" size={16} cls="chev" />
                </div>
                <div className="snmp-body"><div>
                  <p>
                    Опросили {snmpProbed} {plural(snmpProbed, 'хост', 'хоста', 'хостов')} по SNMP —{' '}
                    {plural(snmpAnswered, 'ответил', 'ответили', 'ответили')} {snmpAnswered}
                    {snmpResponders.length > 0 && (
                      <>: <b>{snmpResponders.slice(0, 3).join(', ')}</b>{snmpResponders.length > 3 && <> и ещё {snmpResponders.length - 3}</>}
                    </>)}.
                    {snmpSilent > 0 && (
                      <> Остальные {snmpSilent} — обычные клиенты и принтеры, у которых SNMP-агент выключен. На полноту топологии это <b>не влияет</b>: связи восстановлены по Bridge FDB, имена — из DHCP и ARP.</>
                    )}
                  </p>
                  <ul>
                    <li>Включите SNMP на коммутаторах и точках доступа — получите порты, VLAN и счётчики трафика.</li>
                    <li>Для клиентских устройств опрашивать SNMP не требуется.</li>
                    <li>Если SNMP-опрос не нужен вовсе — снимите галку «SNMP на всех ARP-адресах» в форме сканирования.</li>
                  </ul>
                  {snmpExample !== '' && <span className="mono">{snmpExample}</span>}
                </div></div>
              </div>
            )}
            {realWarnings.length > 0 && (
              <div className={'snmp warn' + (warnOpen ? ' open' : '')}>
                <div className="snmp-head" onClick={() => setWarnOpen(o => !o)} role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setWarnOpen(o => !o); } }}>
                  <DIcon n="warn" size={16} />
                  <span>Предупреждения ({realWarnings.length})</span>
                  <DIcon n="chev" size={16} cls="chev" />
                </div>
                <div className="snmp-body"><div>
                  <ul>
                    {realWarnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div></div>
              </div>
            )}

            {/* v0.56.0: липкие фильтры — поиск, тумблеры, подсети, VLAN. */}
            <div className="filters" ref={filtersRef}>
              <div className="f-row">
                <div className={'search' + (q !== '' ? ' has-text' : '')}>
                  <DIcon n="search" size={16} />
                  <input placeholder="Поиск по имени / IP / MAC / DHCP" value={q}
                    onChange={e => setQ(e.target.value)} autoComplete="off" spellCheck={false} />
                  <button className="clear" title="Очистить поиск" onClick={() => setQ('')}>
                    <DIcon n="close" size={13} />
                  </button>
                </div>
                <div className="f-spacer" />
                <label className="tgl" title="Устройства, у которых известен только MAC. Добавить их нельзя — нужен IP.">
                  <span className="sw"><input type="checkbox" checked={showNoIp} onChange={e => setShowNoIp(e.target.checked)} /><i /></span>
                  Без IP <span className="cnt-txt">({noIpTotal})</span>
                </label>
                <label className="tgl" title="Выбрать/снять все устройства, видимые под текущими фильтрами">
                  <span className="cb"><input type="checkbox" checked={allVisiblePicked} onChange={toggleAllVisible} ref={masterCbRef} /><span /></span>
                  <span>{qTrim !== '' ? `Видимые (${visibleDevs.length})` : `Все видимые (${visibleDevs.length})`}</span>
                </label>
              </div>
              {subnetStats.some(s => s.count > 0) && (
                <div className="f-group">
                  <div className="f-glabel"><DIcon n="net" size={13} />Подсети</div>
                  <div className="f-gbody">
                    {/* v0.53.0: пустые подсети (/32 PPPoE-хвосты и т.п.) скрываем — исключать там нечего */}
                    {subnetStats.filter(s => s.count > 0).map(s => {
                      const excluded = excludedCidrs.has(s.cidr);
                      const seg = s.iface || s.comment || '';
                      return (
                        <button key={s.cidr} className={'fchip' + (excluded ? ' off' : '')}
                          title={(excluded ? 'Включить обратно: ' : 'Исключить из добавления: ') + s.cidr + (s.iface ? ` (${s.iface})` : '') + (s.comment ? ` — ${s.comment}` : '') + (s.parts ? ` — раскрыта по /24 ниже (${s.parts.length})` : '')}
                          onClick={() => setExcludedCidrs(prev => {
                            const next = new Set(prev);
                            if (next.has(s.cidr)) next.delete(s.cidr); else next.add(s.cidr);
                            return next;
                          })}>
                          <span className="fnm mono">{s.cidr}</span>
                          {seg !== '' && <span className="seg" title={seg}>{seg}</span>}
                          <span className="cnt">{s.count}</span>
                        </button>
                      );
                    })}
                    {/* v0.54.0: дочерние /24 внутри широких подсетей — точечное исключение */}
                    {subnetStats.filter(s => s.count > 0 && s.parts).map(s => (
                      <div key={s.cidr + '/parts'} className="f-sub">
                        {(s.parts || []).map(p => {
                          const parentOff = excludedCidrs.has(s.cidr);
                          const excluded = parentOff || excludedCidrs.has(p.cidr);
                          return (
                            <button key={p.cidr} disabled={parentOff} className={'fchip' + (excluded ? ' off' : '')}
                              title={(parentOff
                                ? 'Родительская подсеть уже исключена: '
                                : (excluded ? 'Включить обратно: ' : 'Исключить из добавления: ')) + p.cidr + ` (внутри ${s.cidr})`}
                              onClick={() => setExcludedCidrs(prev => {
                                const next = new Set(prev);
                                if (next.has(p.cidr)) next.delete(p.cidr); else next.add(p.cidr);
                                return next;
                              })}>
                              <span className="fnm mono">{p.cidr}</span>
                              <span className="cnt">{p.count}</span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                    {subnetStats.some(s => s.count === 0) && (
                      <span className="f-empty" title="Подсети роутера, в которых не найдено ни одного устройства.">
                        <DIcon n="eyeoff" size={13} /> +{subnetStats.filter(s => s.count === 0).length} пустых скрыто
                      </span>
                    )}
                    <button className="mini-link" onClick={() => setExcludedCidrs(new Set())}>Все</button>
                    <button className="mini-link" onClick={() => setExcludedCidrs(new Set(subnetStats.map(s => s.cidr)))}>Ни одной</button>
                  </div>
                </div>
              )}
              {vlanStats.length >= 1 && (
                <div className="f-group">
                  <div className="f-glabel" title={`Устройств без данных о VLAN: ${noVlanCount} — фильтр их не касается.`}>
                    <DIcon n="vlan" size={13} />VLAN
                  </div>
                  <div className="f-gbody">
                    {vlanStats.map(v => {
                      const excluded = excludedVlans.has(v.id);
                      return (
                        <button key={v.id} className={'fchip' + (excluded ? ' off' : '')}
                          title={(excluded ? 'Включить обратно' : 'Исключить из добавления') + `: VLAN ${v.id}` + (v.name ? ` (${v.name})` : '')}
                          onClick={() => setExcludedVlans(prev => {
                            const next = new Set(prev);
                            if (next.has(v.id)) next.delete(v.id); else next.add(v.id);
                            return next;
                          })}>
                          <span className="fnm">VLAN {v.id}</span>
                          {v.name ? <span className="seg" title={v.name}>{v.name}</span> : null}
                          <span className="cnt">{v.count}</span>
                        </button>
                      );
                    })}
                    <button className="mini-link" onClick={() => setExcludedVlans(new Set())}>Все</button>
                    <button className="mini-link" onClick={() => setExcludedVlans(new Set(vlanStats.map(v => v.id)))}>Ни одному</button>
                  </div>
                </div>
              )}
            </div>

            {/* v0.56.0: плотная таблица устройств с сортировкой и липкой шапкой. */}
            <div ref={devicesRef}>
              <div className="sec-head">
                <h2><DIcon n="sparkle" size={16} />Новые устройства</h2>
                <span className="g-count">{visibleRowCount}</span>
                <span className="g-hint">клик по строке — выбрать · сортировка — по заголовкам</span>
              </div>
              {scan.proposedDevices.length === 0 ? (
                <div className="empty show"><b>Новых устройств нет</b>Всё, что нашли — уже есть в текущей карте.</div>
              ) : visibleRowCount === 0 ? (
                <div className="empty show"><b>Все устройства скрыты фильтрами</b>Ослабьте поиск или включите подсети/VLAN.</div>
              ) : (
                <div className="tbl">
                  <div className="tr th" ref={theadRef}>
                    <span className="c-check">
                      <label className="cb" title="Выбрать/снять все видимые устройства">
                        <input type="checkbox" checked={allVisiblePicked} onChange={toggleAllVisible} ref={theadCbRef} />
                        <span />
                      </label>
                    </span>
                    <button className={'c-sort' + (sortKey === 'type' ? ' on' : '')} onClick={() => toggleSort('type')}
                      title="Сортировать по типу устройства">
                      Тип<span className="arr">{sortKey === 'type' ? (sortDir === 1 ? '↑' : '↓') : '↕'}</span>
                    </button>
                    <button className={'c-sort' + (sortKey === 'name' ? ' on' : '')} onClick={() => toggleSort('name')}
                      title="Сортировать по имени">
                      Имя<span className="arr">{sortKey === 'name' ? (sortDir === 1 ? '↑' : '↓') : '↕'}</span>
                    </button>
                    <button className={'c-sort' + (sortKey === 'ip' ? ' on' : '')} onClick={() => toggleSort('ip')}
                      title="Сортировать по IP-адресу">
                      IP<span className="arr">{sortKey === 'ip' ? (sortDir === 1 ? '↑' : '↓') : '↕'}</span>
                    </button>
                    <span className="th-mac">MAC</span>
                    <span className="th-tags">Метки</span>
                    <span className="th-src">Источник</span>
                  </div>
                  {unknownGroup.length > 0 && (
                    <>
                      <div className="tr g" title="Отпечатки (имя, MAC, описание, VLAN) тип не выдали. Выберите тип селектором в строке.">
                        <DIcon n="chev" size={14} />
                        Тип не определён <span className="pc">{unknownGroup.length}</span>
                        <span className="g-sub">— выберите тип</span>
                        <button className="gtoggle" onClick={() => togglePickAll(unknownPickable, devPick, setDevPick)}>
                          {unknownPickable.length > 0 && unknownPickable.every(d => devPick[d.tempId]) ? 'Снять все' : 'Выбрать все'}
                        </button>
                      </div>
                      {unknownGroup.map(d => d.ip ? (
                        <DiscoveryTableRow key={d.tempId} d={d}
                          effName={effNameOf(d)}
                          effKind={effKindOf(d)}
                          renamed={nameEdits[d.tempId] != null && nameEdits[d.tempId] !== d.name}
                          kindEdited={kindEdits[d.tempId] != null && kindEdits[d.tempId] !== d.kind}
                          checked={!!devPick[d.tempId]} disabled={false}
                          onToggle={(id, v) => setDevPick(p => ({ ...p, [id]: v }))}
                          onRename={(id, v) => setNameEdits(p => ({ ...p, [id]: v }))}
                          onKind={(id, v) => setKindEdits(p => ({ ...p, [id]: v }))} />
                      ) : (
                        <DiscoveryTableRow key={d.tempId} d={d}
                          effName={d.name} effKind={d.kind} renamed={false} kindEdited={false}
                          checked={false} disabled={true}
                          onToggle={() => {}} onRename={() => {}} onKind={() => {}} />
                      ))}
                    </>
                  )}
                  {namedGroup.length > 0 && (
                    <>
                      <div className="tr g named">
                        <DIcon n="chev" size={14} />
                        С именами <span className="pc">{namedGroup.length}</span>
                        <span className="g-sub">— имена из DHCP и LLDP</span>
                        <button className="gtoggle" onClick={() => togglePickAll(namedGroup, devPick, setDevPick)}>
                          {namedGroup.every(d => devPick[d.tempId]) ? 'Снять все' : 'Выбрать все'}
                        </button>
                      </div>
                      {namedGroup.map(d => (
                        <DiscoveryTableRow key={d.tempId} d={d}
                          effName={effNameOf(d)}
                          effKind={effKindOf(d)}
                          renamed={nameEdits[d.tempId] != null && nameEdits[d.tempId] !== d.name}
                          kindEdited={kindEdits[d.tempId] != null && kindEdits[d.tempId] !== d.kind}
                          checked={!!devPick[d.tempId]} disabled={false}
                          onToggle={(id, v) => setDevPick(p => ({ ...p, [id]: v }))}
                          onRename={(id, v) => setNameEdits(p => ({ ...p, [id]: v }))}
                          onKind={(id, v) => setKindEdits(p => ({ ...p, [id]: v }))} />
                      ))}
                    </>
                  )}
                  {unnamedGroup.length > 0 && (
                    <>
                      <div className="tr g plain" title="Устройства с IP, но без имени: ни DHCP, ни LLDP имени не дали. Имя можно задать прямо здесь — в поле строки.">
                        <DIcon n="chev" size={14} />
                        Без имени <span className="pc">{unnamedGroup.length}</span>
                        <span className="g-sub">— задайте имена</span>
                        <button className="gtoggle" onClick={() => togglePickAll(unnamedGroup, devPick, setDevPick)}>
                          {unnamedGroup.every(d => devPick[d.tempId]) ? 'Снять все' : 'Выбрать все'}
                        </button>
                      </div>
                      {unnamedGroup.map(d => (
                        <DiscoveryTableRow key={d.tempId} d={d}
                          effName={effNameOf(d)}
                          effKind={effKindOf(d)}
                          renamed={nameEdits[d.tempId] != null && nameEdits[d.tempId] !== d.name}
                          kindEdited={kindEdits[d.tempId] != null && kindEdits[d.tempId] !== d.kind}
                          checked={!!devPick[d.tempId]} disabled={false}
                          onToggle={(id, v) => setDevPick(p => ({ ...p, [id]: v }))}
                          onRename={(id, v) => setNameEdits(p => ({ ...p, [id]: v }))}
                          onKind={(id, v) => setKindEdits(p => ({ ...p, [id]: v }))} />
                      ))}
                    </>
                  )}
                </div>
              )}
              {showNoIp && noIpDevs.length === 0 && noIpTotal > 0 && (
                <div className="empty show" style={{ marginTop: 8 }}>Все {noIpTotal} без IP скрыты фильтрами.</div>
              )}
            </div>

            {/* v0.56.0: таблица связей — пара устройств + порты + источник. */}
            <div ref={linksRef}>
              <div className="sec-head">
                <h2><DIcon n="link" size={16} />Новые связи</h2>
                <span className="g-count">{scan.proposedLinks.length}</span>
                <span className="g-hint">связи к скрытым устройствам пропускаются автоматически</span>
                <button className="gtoggle" onClick={() => {
                  const all = scan.proposedLinks.every(l => linkPick[l.tempId]);
                  const next: Record<string, boolean> = {};
                  scan.proposedLinks.forEach(l => next[l.tempId] = !all);
                  setLinkPick(next);
                }}>{scan.proposedLinks.every(l => linkPick[l.tempId]) ? 'Снять все' : 'Выбрать все'}</button>
              </div>
              {scan.proposedLinks.length === 0 ? (
                <div className="empty show"><b>Связей не найдено</b>Проверьте что LLDP включён на устройствах.</div>
              ) : visibleLinks.length === 0 ? (
                <div className="empty show"><b>Связей по запросу «{qTrim}» не найдено</b>Ослабьте поиск.</div>
              ) : (
                <div className="tbl lnk-tbl">
                  <div className="tr th">
                    <span />
                    <span>Устройство</span>
                    <span className="th-iface">Порты</span>
                    <span>Устройство</span>
                    <span className="th-src">Источник</span>
                  </div>
                  {visibleLinks.map(l => {
                    const checked = !!linkPick[l.tempId];
                    const willDrop = checked && !linkEndpointsOk(l);
                    const ports = [l.fromPort, l.toPort].filter(Boolean).join(' → ') || '—';
                    return (
                      <div key={l.tempId} className="tr lnk"
                        style={willDrop ? { opacity: 0.55 } : undefined}
                        title={willDrop ? 'Пропустится: нет обеих сторон (устройство снято, скрыто фильтром или без IP)' : undefined}
                        onClick={e => {
                          if ((e.target as HTMLElement).closest('input,select,button,label,a')) return;
                          setLinkPick(p => ({ ...p, [l.tempId]: !checked }));
                        }}>
                        <span className="c-check">
                          <label className="cb">
                            <input type="checkbox" className="row-check" checked={checked}
                              onChange={e => setLinkPick(p => ({ ...p, [l.tempId]: e.target.checked }))} />
                            <span />
                          </label>
                        </span>
                        <span><span className="l-dev" title={refLabel(l.fromRef)}>{refLabel(l.fromRef)}</span></span>
                        <span className="l-iface mono" title={ports}>{ports}</span>
                        <span><span className="l-dev" title={refLabel(l.toRef)}>{refLabel(l.toRef)}</span></span>
                        <span className="c-src" title={l.evidence || undefined}>{l.evidence || '—'}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
          <footer className="m-foot">
            <button className="btn ghost" onClick={() => setPhase('form')}><DIcon n="back" size={15} />Назад</button>
            <div className="f-stats">
              <span className="f-pill" title="Устройств будет добавлено"><b>{selDev}</b> {plural(selDev, 'устройство', 'устройства', 'устройств')}</span>
              <span className="f-pill" title="Связей будет добавлено"><b>{selLink}</b> {plural(selLink, 'связь', 'связи', 'связей')}</span>
              {willDropLinks.length > 0 && (
                <span className="f-skip" title="Связи, у которых нет обеих сторон: устройство снято, скрыто фильтром/поиском или без IP.">
                  пропустится связей: <b>{willDropLinks.length}</b>
                </span>
              )}
              {hiddenPicked > 0 && (
                <span className="f-dim" title="Выбраны галочкой, но скрыты поиском или фильтрами подсетей/VLAN — применены не будут.">
                  {hiddenPicked} вне фильтра
                </span>
              )}
            </div>
            <button className="btn primary" disabled={selDev + selLink === 0} onClick={onApply}>
              <DIcon n="check" size={15} />Применить выбранное
            </button>
          </footer>
          </>
        )}

        {/* ============ APPLYING / DONE ============ */}
        {phase === 'applying' && (
          <div style={{ ...S.body, alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
            <MiniSpinner size={40} />
            <div style={{ marginTop: 14, fontSize: 13, fontWeight: 600, color: '#334155' }}>Добавляем в карту…</div>
            <div style={{ marginTop: 4, fontSize: 11, color: '#94a3b8' }}>
              {selDev} устройств, {selLink} связей
            </div>
            <div style={{ marginTop: 16, width: 200 }}>
              <ProgressStripe width="100%" height={5} />
            </div>
          </div>
        )}
        {phase === 'done' && applyReport && (
          <div style={S.body}>
            <div style={{
              background: '#dcfce7', padding: 16, borderRadius: 10,
              display: 'flex', gap: 12, alignItems: 'center',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 20, background: '#16a34a',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <IconCheck />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#166534' }}>Готово</div>
                <div style={{ fontSize: 12, color: '#166534' }}>
                  Добавлено устройств: <b>{applyReport.dev}</b>, связей: <b>{applyReport.link}</b>.
                  Карта разложена автоматически; Ctrl+Z отменит раскладку и применение (два нажатия).
                </div>
              </div>
            </div>
            {/* v0.55.0: большая карта — предлагаем компактный вид прямо здесь */}
            {applyReport.dev >= 60 && <BigMapTip />}
            <div style={S.footer}>
              <div style={{ flex: 1 }} />
              <button style={S.btnSecondary} onClick={() => setPhase('form')}>Ещё скан</button>
              <button style={S.btnPrimary} onClick={onClose}>Закрыть</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ============================================================================
// Sub-components
// ============================================================================
// v0.54.0: компактная однострочная пилюля — вся статистика в один ряд.
function StatChip({ label, value, muted }: { label: string; value: string | number; muted?: boolean }) {
  return (
    <div style={{
      background: muted ? '#f8fafc' : '#eff6ff',
      color: muted ? '#64748b' : '#1d4ed8',
      padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
      display: 'flex', gap: 6, alignItems: 'baseline', whiteSpace: 'nowrap',
    }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{value}</span>
      <span style={{ opacity: 0.8 }}>{label}</span>
    </div>
  );
}

// v0.55.0: нумерованный шаг в баннере итога («что делать дальше»).
function StepPill({ n, text }: { n: number; text: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#334155' }}>
      <span style={{
        width: 18, height: 18, borderRadius: '50%', background: '#2563eb', color: '#fff',
        fontSize: 10, fontWeight: 700, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>{n}</span>
      {text}
    </span>
  );
}

// v0.55.0: после большого импорта предлагаем свернуть оконечные устройства.
function BigMapTip() {
  const collapseEndpoints = useStore(s => s.collapseEndpoints);
  const toggleCollapseEndpoints = useStore(s => s.toggleCollapseEndpoints);
  const viewMode = useStore(s => s.viewMode);
  const setViewMode = useStore(s => s.setViewMode);
  if (collapseEndpoints && viewMode === 'modern') return null;
  return (
    <div style={{ background: '#eff6ff', padding: '10px 14px', borderRadius: 10, border: '1px solid #bfdbfe' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8' }}>Карта большая — включите компактный вид</div>
      <div style={{ fontSize: 11, color: '#334155', margin: '4px 0 8px' }}>
        Оконечные устройства свернутся внутрь своих свитчей: карта станет читаемой и перестанет тормозить.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {viewMode !== 'modern' && (
          <button style={S.btnSecondary} onClick={() => setViewMode('modern')}>Вид Modern</button>
        )}
        {!collapseEndpoints && (
          <button style={S.btnPrimary} onClick={() => toggleCollapseEndpoints()}>Свернуть endpoint'ы в свитчи</button>
        )}
      </div>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div style={{ fontSize: 12, color: '#94a3b8', padding: 12, textAlign: 'center', background: '#f8fafc', borderRadius: 8 }}>{text}</div>;
}

/**
 * v0.44.2 — animated "what we're doing right now" checklist during scanning.
 * Purely cosmetic — cycles through steps to give the user a sense of progress
 * for the ~5-30s SSH+SNMP walk.
 */
function ScanStages({ mode }: { mode: 'mikrotik' | 'snmp' | 'both' }) {
  const [step, setStep] = useState(0);
  const stages = useMemo(() => {
    const arr: string[] = [];
    if (mode !== 'snmp') {
      arr.push('SSH подключение к MikroTik…');
      arr.push('Читаем /ip neighbor (LLDP)…');
      arr.push('Читаем /interface bridge host (FDB)…');
      arr.push('Читаем /ip arp…');
      arr.push('Читаем DHCP leases (имена)…');
      arr.push('Читаем /ip address и VLAN…');
    }
    if (mode !== 'mikrotik') {
      arr.push('SNMP probe (sysDescr, sysName)…');
      arr.push('SNMP walk IF-MIB (интерфейсы)…');
      arr.push('SNMP walk LLDP-MIB (соседи)…');
      arr.push('SNMP walk BRIDGE-MIB (FDB + VLAN)…');
      arr.push('SNMP walk IP-MIB (ARP)…');
    }
    arr.push('Сшиваем данные, ищем дубликаты…');
    return arr;
  }, [mode]);

  useEffect(() => {
    setStep(0);
    const t = setInterval(() => setStep(s => Math.min(s + 1, stages.length - 1)), 900);
    return () => clearInterval(t);
  }, [stages.length]);

  return (
    <div style={{ marginTop: 22, minWidth: 300, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {stages.map((s, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 11, color: i > step ? '#CBD5E1' : (i === step ? '#2563EB' : '#334155'),
          fontWeight: i === step ? 600 : 400,
          animation: i === step ? 'nm-pulse 1.4s ease-in-out infinite' : undefined,
        }}>
          <span style={{
            width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: i < step ? '#22C55E' : (i === step ? '#EFF6FF' : '#F1F5F9'),
            border: i === step ? '1.5px solid #2563EB' : 'none',
          }}>
            {i < step && (
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4">
                <path d="M4 12l6 6L20 6" />
              </svg>
            )}
          </span>
          <span>{s}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Styles
// ============================================================================

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.42)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9500, backdropFilter: 'blur(2px)',
  },
  dialog: {
    background: '#fff', borderRadius: 14, width: 720, maxWidth: '92vw',
    maxHeight: '92vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 30px 60px -20px rgba(15,23,42,0.4)',
    overflow: 'hidden',
  },
  header: {
    padding: '14px 18px', borderBottom: '1px solid #e2e8f0',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: 'linear-gradient(180deg, #f8fafc, #fff)',
  },
  iconWrap: {
    width: 32, height: 32, borderRadius: 8, background: '#3b82f6',
    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  closeBtn: {
    width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0',
    background: '#fff', color: '#64748b', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  body: {
    padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, flex: 1,
  },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  sectionTitle: {
    fontSize: 12, fontWeight: 700, color: '#334155', letterSpacing: 0.3, textTransform: 'uppercase',
    display: 'flex', alignItems: 'center', gap: 6,
  },
  // v0.52.0: подзаголовки секций «с именем / без имени / без IP».
  subTitle: {
    fontSize: 11, fontWeight: 700, color: '#475569',
    display: 'flex', alignItems: 'center', gap: 6, marginTop: 2,
  },
  hint: { fontSize: 11, color: '#64748b', lineHeight: 1.5 },
  segRow: {
    display: 'flex', background: '#f1f5f9', padding: 3, borderRadius: 8, width: 'fit-content',
  },
  segBtn: {
    padding: '6px 14px', border: 'none', background: 'transparent',
    fontSize: 12, fontWeight: 600, color: '#64748b', cursor: 'pointer', borderRadius: 6,
  },
  segBtnActive: {
    background: '#fff', color: '#0f172a', boxShadow: '0 1px 3px rgba(15,23,42,0.1)',
  },
  formGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10,
  },
  label: {
    display: 'flex', flexDirection: 'column', gap: 4,
    fontSize: 11, fontWeight: 600, color: '#475569',
  },
  input: {
    padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 6,
    fontSize: 13, color: '#0f172a', background: '#fff', outline: 'none',
    fontWeight: 400,
  },
  footer: {
    display: 'flex', gap: 8, alignItems: 'center', marginTop: 4,
    paddingTop: 10, borderTop: '1px solid #f1f5f9',
  },
  btnPrimary: {
    padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none',
    borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  },
  btnSecondary: {
    padding: '8px 14px', background: '#fff', color: '#334155',
    border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  linkBtn: {
    background: 'transparent', border: 'none', color: '#3b82f6', fontSize: 11,
    fontWeight: 600, cursor: 'pointer', padding: 0,
  },
  statsRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  warnBox: {
    background: '#fef3c7', padding: '8px 10px', borderRadius: 8,
    border: '1px solid #fde68a',
  },
  // v0.55.0: спокойный синий блок SNMP-тишины + баннер итога сканирования.
  infoBox: {
    background: '#eff6ff', padding: '8px 10px', borderRadius: 8,
    border: '1px solid #bfdbfe',
  },
  resultBanner: {
    background: '#f8fafc', padding: '10px 14px', borderRadius: 10,
    border: '1px solid #e2e8f0',
  },
  resultTitle: {
    fontSize: 14, fontWeight: 700, color: '#0f172a',
  },
  resultSteps: {
    display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 6,
  },
  rows: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' },
  row: {
    display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px',
    background: '#f8fafc', borderRadius: 8, cursor: 'pointer',
    border: '1px solid transparent',
  },
  rowChecked: {
    background: '#eff6ff', border: '1px solid #bfdbfe',
  },
  // v0.52.0: чипы фильтров подсетей/VLAN (как в обычном импорте).
  chip: {
    padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
    border: '1px solid #3b82f6', background: '#dbeafe', color: '#1e40af',
    cursor: 'pointer', whiteSpace: 'nowrap',
  },
  chipOff: {
    border: '1px solid #cbd5e1', background: '#f1f5f9', color: '#64748b',
    opacity: 0.6, textDecoration: 'line-through',
  },
  // v0.52.0: поле имени прямо в строке устройства.
  nameInput: {
    flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: '#0f172a',
    border: '1px solid transparent', borderRadius: 5, background: 'transparent',
    padding: '1px 5px', outline: 'none',
  },
  // v0.53.0: рамка при наведении/фокусе (переименование стало очевидным).
  nameInputActive: {
    border: '1px solid #cbd5e1', background: '#fff',
  },
  nameInputEdited: {
    border: '1px solid #2563eb', background: '#eff6ff',
  },
  // v0.53.0: кнопка-карандаш и селектор типа в строке.
  pencilBtn: {
    background: '#eff6ff', border: '1px solid #bfdbfe', color: '#2563eb',
    borderRadius: 5, width: 20, height: 20, padding: 0, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  },
  kindSelect: {
    fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 4px',
    border: '1px solid transparent', cursor: 'pointer', outline: 'none',
    maxWidth: 96, flexShrink: 0,
  },
  // v0.54.0: липкая панель фильтров (во всю ширину body, поверх прокрутки).
  filterBar: {
    display: 'flex', flexDirection: 'column', gap: 8,
    position: 'sticky', top: 0, zIndex: 5, background: '#fff',
    margin: '0 -18px', padding: '10px 18px',
    borderTop: '1px solid #f1f5f9', borderBottom: '1px solid #e2e8f0',
  },
  // v0.54.0: футер review — вне скролла, «Применить» всегда видно.
  reviewFooter: {
    display: 'flex', gap: 8, alignItems: 'center',
    padding: '10px 18px', borderTop: '1px solid #e2e8f0', background: '#fff',
  },
  // v0.54.0: моноширинный IP/MAC и мини-чип VLAN в строке устройства.
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  vlanMini: {
    fontSize: 10, fontWeight: 700, background: '#eef2ff', color: '#4338ca',
    border: '1px solid #c7d2fe', borderRadius: 4, padding: '0 5px', marginLeft: 6,
    whiteSpace: 'nowrap',
  },
  spinner: {
    width: 36, height: 36, borderRadius: '50%',
    border: '3px solid #e2e8f0', borderTopColor: '#3b82f6',
    animation: 'nm-spin 800ms linear infinite',
  },
};

// Global keyframes for spinner (injected once)
if (typeof document !== 'undefined' && !document.getElementById('nm-discovery-styles')) {
  const s = document.createElement('style');
  s.id = 'nm-discovery-styles';
  s.textContent = '@keyframes nm-spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(s);
}

// v0.56.0: стили редизайна окна проверки (injected once, скоуп .nm-disc).
// Липкие отступы (--stick-top/--thead-h) замеряются в рантайме через
// ResizeObserver и переживают зум, перенос чипов и перестроение таблицы.
if (typeof document !== 'undefined' && !document.getElementById('nm-discovery-redesign')) {
  const s = document.createElement('style');
  s.id = 'nm-discovery-redesign';
  s.textContent = `
.nm-disc{
  --bg:#e9edf5; --panel:#ffffff; --body:#f6f8fc;
  --ink:#0f172a; --ink-2:#475569; --ink-3:#8b96ab;
  --line:#e4e9f2; --line-2:#eef2f9;
  --brand:#4361ee; --brand-2:#3550d4; --brand-soft:#edf1ff; --brand-line:#c9d4fb;
  --ok:#0e9f6e; --ok-soft:#e7f8f1; --ok-line:#b9e9d6;
  --warn:#b4630a; --warn-strong:#d97706; --warn-soft:#fdf6ea; --warn-line:#f2ddb6;
  --ap:#6d4ae0; --ap-soft:#f1edff; --ap-line:#ddd2ff;
  --sw:#0b7d72; --sw-soft:#e6f7f5; --sw-line:#bfe9e4;
  --host:#b4630a; --host-soft:#fdf3e2;
  --server:#0c6fce; --server-soft:#e8f3ff;
  --r:14px;
  --stick-top:190px; --thead-h:36px;
  font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Arial,sans-serif;
  color:var(--ink);
  animation:nm-disc-pop .28s cubic-bezier(.2,.9,.3,1.2);
}
@keyframes nm-disc-pop{from{opacity:0; transform:scale(.97)} to{opacity:1; transform:scale(1)}}
.nm-disc button, .nm-disc input, .nm-disc select{font-family:inherit}
.nm-disc .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12.5px}
.nm-disc .m-head{display:flex; align-items:center; gap:14px; padding:18px 24px 14px}
.nm-disc .h-icon{width:48px; height:48px; border-radius:14px; background:linear-gradient(135deg,#4361ee,#6d4ae0); color:#fff; display:flex; align-items:center; justify-content:center; box-shadow:0 6px 16px rgba(67,97,238,.35); flex-shrink:0}
.nm-disc .h-txt{flex:1; min-width:0}
.nm-disc .h-txt h1{margin:0; font-size:18px; font-weight:800; letter-spacing:-.01em}
.nm-disc .h-methods{display:flex; flex-wrap:wrap; gap:5px; margin-top:6px}
.nm-disc .h-methods span{font-size:10.5px; font-weight:600; color:var(--ink-2); background:#f1f4fa; border:1px solid var(--line); padding:1px 8px; border-radius:20px; white-space:nowrap}
.nm-disc .icon-btn{width:32px; height:32px; border-radius:9px; border:1px solid transparent; background:transparent; color:var(--ink-3); cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0}
.nm-disc .icon-btn:hover{background:#f1f4fa; color:var(--ink)}
.nm-disc .dscroll{flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; background:var(--body); border-top:1px solid var(--line); border-bottom:1px solid var(--line); padding:18px 24px 24px; display:flex; flex-direction:column}
.nm-disc .summary{display:flex; gap:20px; align-items:center; background:linear-gradient(120deg,#f4f6ff 0%,#f8f5ff 55%,#f3fbf8 100%); border:1px solid var(--line); border-radius:var(--r); padding:16px 20px}
.nm-disc .summary>div:first-child{flex:1; min-width:0}
.nm-disc .s-label{display:flex; align-items:center; gap:6px; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-2)}
.nm-disc .s-label svg{color:var(--brand)}
.nm-disc .s-big{font-size:26px; font-weight:800; margin-top:2px; letter-spacing:-.02em; white-space:nowrap}
.nm-disc .s-big small{font-size:13px; font-weight:600; color:var(--ink-2)}
.nm-disc .s-big .dot{color:var(--ink-3); margin:0 8px; font-weight:400}
.nm-disc .s-note{display:inline-flex; align-items:center; gap:5px; margin-top:6px; font-size:12px; font-weight:600; color:var(--warn); background:var(--warn-soft); border:1px solid var(--warn-line); padding:2px 10px; border-radius:20px}
.nm-disc .steps{list-style:none; margin:0; padding:0; display:flex; gap:8px; flex-shrink:0}
.nm-disc .steps li{display:flex; gap:9px; align-items:flex-start; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:9px 12px; min-width:128px; max-width:170px; cursor:pointer; transition:border-color .15s, box-shadow .15s, transform .15s; margin:0}
.nm-disc .steps li:hover{border-color:var(--brand-line); box-shadow:0 4px 14px rgba(67,97,238,.12); transform:translateY(-1px)}
.nm-disc .steps li i{font-style:normal; width:22px; height:22px; border-radius:50%; background:var(--brand-soft); color:var(--brand); font-size:12px; font-weight:800; display:flex; align-items:center; justify-content:center; flex-shrink:0}
.nm-disc .steps li b{display:block; font-size:12px}
.nm-disc .steps li small{font-size:11px; color:var(--ink-3)}
.nm-disc .metrics{display:grid; grid-template-columns:repeat(auto-fit,minmax(118px,1fr)); gap:8px; margin-top:12px}
.nm-disc .metric{background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:8px 10px; min-width:0}
.nm-disc .metric.tone-brand{background:var(--brand-soft); border-color:var(--brand-line)}
.nm-disc .m-top{display:flex; align-items:center; gap:6px; font-size:11px; font-weight:700; color:var(--ink-2)}
.nm-disc .m-top svg{color:var(--ink-3)}
.nm-disc .m-val{font-size:17px; font-weight:800; margin-top:1px; font-variant-numeric:tabular-nums}
.nm-disc .m-val small{font-size:11px; font-weight:600; color:var(--ink-3)}
.nm-disc .m-sub{font-size:10.5px; color:var(--ink-3); white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.nm-disc .m-bar{height:5px; border-radius:3px; background:var(--line-2); margin-top:6px; overflow:hidden}
.nm-disc .m-bar i{display:block; height:100%; border-radius:3px; background:linear-gradient(90deg,#4361ee,#6d4ae0)}
.nm-disc .snmp{margin-top:12px; background:#ecfbf4; border:1px solid var(--ok-line); border-radius:12px; overflow:hidden}
.nm-disc .snmp-head{display:flex; align-items:center; gap:8px; padding:9px 14px; font-size:12.5px; font-weight:700; color:#0b6e4f; cursor:pointer; user-select:none}
.nm-disc .snmp-head:hover{background:rgba(14,159,110,.07)}
.nm-disc .snmp-head .chev{margin-left:auto; transition:transform .2s}
.nm-disc .snmp.open .snmp-head .chev{transform:rotate(180deg)}
.nm-disc .pill-ok{font-size:10.5px; font-weight:700; background:#fff; border:1px solid var(--ok-line); color:var(--ok); padding:1px 9px; border-radius:20px; white-space:nowrap}
.nm-disc .snmp-body{max-height:0; overflow:hidden; transition:max-height .25s ease}
.nm-disc .snmp.open .snmp-body{max-height:600px}
.nm-disc .snmp-body>div{padding:2px 14px 12px 38px; font-size:12.5px; color:#14532d}
.nm-disc .snmp-body p{margin:0 0 8px}
.nm-disc .snmp-body ul{margin:0; padding-left:16px; display:flex; flex-direction:column; gap:3px; font-size:12px; color:#2c5c40}
.nm-disc .snmp-body .mono{display:block; margin-top:8px; font-size:11.5px; color:#2c5c40; opacity:.85}
.nm-disc .snmp.warn{background:var(--warn-soft); border-color:var(--warn-line)}
.nm-disc .snmp.warn .snmp-head{color:var(--warn)}
.nm-disc .snmp.warn .snmp-head:hover{background:rgba(217,119,6,.07)}
.nm-disc .snmp.warn .snmp-body>div{color:#7c4a03}
.nm-disc .snmp.warn .snmp-body ul{color:#7c4a03}
.nm-disc .filters{position:sticky; top:0; z-index:40; margin:14px -24px 0; padding:12px 24px; background:rgba(246,248,252,.94); backdrop-filter:blur(8px); border-top:1px solid var(--line); border-bottom:1px solid var(--line)}
.nm-disc .f-row{display:flex; align-items:center; gap:10px; flex-wrap:wrap}
.nm-disc .search{position:relative; flex:1 1 240px; min-width:170px; max-width:460px; display:flex; align-items:center}
.nm-disc .search>svg{position:absolute; left:11px; color:var(--ink-3); pointer-events:none}
.nm-disc .search input{width:100%; border:1.5px solid var(--line); border-radius:11px; padding:8px 30px 8px 34px; font-size:13px; outline:none; background:var(--panel); color:var(--ink); transition:border-color .15s, box-shadow .15s}
.nm-disc .search input:focus{border-color:var(--brand); box-shadow:0 0 0 3px rgba(67,97,238,.14)}
.nm-disc .search input::placeholder{color:var(--ink-3)}
.nm-disc .search .clear{position:absolute; right:6px; width:22px; height:22px; border-radius:7px; border:none; background:transparent; color:var(--ink-3); cursor:pointer; display:none; align-items:center; justify-content:center; padding:0}
.nm-disc .search .clear:hover{background:#eef1f7; color:var(--ink)}
.nm-disc .search.has-text .clear{display:flex}
.nm-disc .f-spacer{flex:1}
.nm-disc .tgl{display:inline-flex; align-items:center; gap:8px; font-size:12.5px; font-weight:600; color:var(--ink-2); cursor:pointer; user-select:none; white-space:nowrap}
.nm-disc .cnt-txt{color:var(--ink-3); font-weight:600}
.nm-disc .sw{position:relative; display:inline-flex; flex-shrink:0}
.nm-disc .sw input{position:absolute; opacity:0; width:100%; height:100%; margin:0; cursor:pointer}
.nm-disc .sw i{width:36px; height:21px; border-radius:20px; background:#cbd5e6; position:relative; transition:background .18s; font-style:normal}
.nm-disc .sw i::after{content:""; position:absolute; top:2.5px; left:3px; width:16px; height:16px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.25); transition:left .18s}
.nm-disc .sw input:checked+i{background:var(--brand)}
.nm-disc .sw input:checked+i::after{left:17px}
.nm-disc .sw input:focus-visible+i{outline:2px solid var(--brand); outline-offset:2px}
.nm-disc .cb{position:relative; display:inline-flex; flex-shrink:0; cursor:pointer}
.nm-disc .cb input{position:absolute; opacity:0; width:100%; height:100%; margin:0; cursor:pointer}
.nm-disc .cb span{width:17px; height:17px; border-radius:6px; border:1.5px solid #b9c4d6; background:#fff; display:inline-flex; align-items:center; justify-content:center; transition:background .15s, border-color .15s}
.nm-disc .cb span::after{content:""; width:9px; height:5px; border-left:2.4px solid #fff; border-bottom:2.4px solid #fff; transform:rotate(-45deg) translateY(-1px); opacity:0}
.nm-disc .cb input:checked+span{background:var(--brand); border-color:var(--brand)}
.nm-disc .cb input:checked+span::after{opacity:1}
.nm-disc .cb input:indeterminate+span{background:var(--brand); border-color:var(--brand)}
.nm-disc .cb input:indeterminate+span::after{opacity:1; width:8px; height:0; border-left:none; border-bottom-width:2.4px; transform:none}
.nm-disc .cb input:disabled{cursor:not-allowed}
.nm-disc .cb input:disabled+span{opacity:.4; background:#eef1f6}
.nm-disc .cb input:focus-visible+span{outline:2px solid var(--brand); outline-offset:1px}
.nm-disc .f-group{margin-top:10px; display:flex; gap:10px; align-items:flex-start}
.nm-disc .f-glabel{display:inline-flex; align-items:center; gap:6px; font-size:11.5px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-2); padding-top:7px; flex-shrink:0; min-width:74px}
.nm-disc .f-glabel svg{color:var(--ink-3)}
.nm-disc .f-gbody{display:flex; flex-wrap:wrap; gap:6px; align-items:center; min-width:0}
.nm-disc .fchip{display:inline-flex; align-items:center; gap:7px; border:1.5px solid var(--brand-line); background:var(--brand-soft); border-radius:10px; padding:4px 6px 4px 10px; font-size:12px; font-weight:700; cursor:pointer; transition:all .15s; max-width:100%}
.nm-disc .fchip .fnm{color:#2b3a67}
.nm-disc .fchip .seg{font-weight:600; font-size:11px; color:var(--ink-2); background:rgba(255,255,255,.7); border:1px solid var(--brand-line); padding:0 7px; border-radius:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:190px}
.nm-disc .fchip .cnt{background:var(--brand); color:#fff; font-size:11px; font-weight:800; min-width:22px; height:20px; display:inline-flex; align-items:center; justify-content:center; border-radius:7px; padding:0 6px; font-variant-numeric:tabular-nums}
.nm-disc .fchip:hover{transform:translateY(-1px); box-shadow:0 3px 10px rgba(67,97,238,.18)}
.nm-disc .fchip.off{background:#f1f4f9; border-color:var(--line); border-style:dashed}
.nm-disc .fchip.off .fnm{color:var(--ink-3); text-decoration:line-through}
.nm-disc .fchip.off .seg{opacity:.55}
.nm-disc .fchip.off .cnt{background:#b9c4d6}
.nm-disc .fchip:disabled{cursor:not-allowed; transform:none; box-shadow:none}
.nm-disc .f-sub{display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin:2px 0 2px 4px; padding:6px 0 6px 12px; border-left:2px dashed var(--brand-line)}
.nm-disc .mini-link{border:none; background:none; color:var(--brand); font-size:12px; font-weight:700; cursor:pointer; padding:4px 6px; border-radius:7px; white-space:nowrap}
.nm-disc .mini-link:hover{background:var(--brand-soft)}
.nm-disc .f-empty{font-size:11.5px; color:var(--ink-3); display:inline-flex; align-items:center; gap:5px}
.nm-disc .sec-head{display:flex; align-items:center; gap:9px; margin:20px 0 8px}
.nm-disc .sec-head h2{margin:0; font-size:14.5px; font-weight:800; display:flex; align-items:center; gap:8px}
.nm-disc .sec-head h2 svg{color:var(--brand)}
.nm-disc .g-count{font-size:11.5px; font-weight:800; background:var(--ink); color:#fff; border-radius:12px; padding:1px 9px; font-variant-numeric:tabular-nums}
.nm-disc .g-hint{font-size:11.5px; color:var(--ink-3); margin-left:auto}
.nm-disc .gtoggle{border:none; background:none; color:var(--brand); font-size:12px; font-weight:700; cursor:pointer; padding:3px 8px; border-radius:7px; white-space:nowrap}
.nm-disc .gtoggle:hover{background:var(--brand-soft)}
.nm-disc .tr.g .gtoggle{margin-left:auto; color:#fff; opacity:.92}
.nm-disc .tr.g .gtoggle:hover{background:rgba(255,255,255,.18)}
.nm-disc .tbl{background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; overflow:clip; --cols:34px minmax(120px,.85fr) minmax(150px,1.35fr) minmax(105px,.8fr) minmax(115px,.8fr) minmax(150px,1.2fr) minmax(130px,.7fr)}
.nm-disc .lnk-tbl{--cols:34px minmax(150px,1fr) minmax(130px,.7fr) minmax(150px,1fr) minmax(130px,.5fr)}
.nm-disc .tr{display:grid; grid-template-columns:var(--cols); gap:10px; align-items:center; padding:7px 12px}
.nm-disc .tr>*{min-width:0}
.nm-disc .tr.th{position:sticky; top:var(--stick-top); z-index:30; background:#f1f5fb; border-bottom:1px solid var(--line); font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-2); padding-top:8px; padding-bottom:8px}
.nm-disc .c-sort{border:none; background:none; padding:0; font-size:inherit; font-weight:inherit; text-transform:inherit; letter-spacing:inherit; color:inherit; cursor:pointer; display:inline-flex; align-items:center; gap:5px; justify-self:start; border-radius:6px}
.nm-disc .c-sort:hover{color:var(--brand)}
.nm-disc .c-sort .arr{font-size:10px; color:var(--ink-3); font-weight:400}
.nm-disc .c-sort.on{color:var(--brand)}
.nm-disc .c-sort.on .arr{color:var(--brand); font-weight:800}
.nm-disc .th-tags{text-align:right}
.nm-disc .tr.dev{border-bottom:1px solid var(--line-2); cursor:pointer; transition:background .12s}
.nm-disc .tr.dev:last-child{border-bottom:none}
.nm-disc .tr.dev:hover{background:#f6f9ff}
.nm-disc .tr.dev:has(.row-check:checked){background:var(--brand-soft)}
.nm-disc .tr.dev:has(.row-check:checked):hover{background:#e3e9ff}
.nm-disc .tr.g{position:sticky; top:calc(var(--stick-top) + var(--thead-h)); z-index:25; display:flex; align-items:center; gap:8px; background:#fff8ec; border-bottom:1px solid var(--warn-line); font-size:12px; font-weight:800; color:#92610a; cursor:default}
.nm-disc .tr.g svg{flex-shrink:0}
.nm-disc .tr.g.named{background:#f2f6ff; border-bottom-color:var(--brand-line); color:#2e4bb7}
.nm-disc .tr.g.plain{background:#f1f5fb; border-bottom-color:#dde4ee; color:#52627a}
.nm-disc .tr.g .pc{font-size:11px; font-weight:800; background:var(--warn-strong); color:#fff; border-radius:10px; padding:0 8px}
.nm-disc .tr.g.named .pc{background:var(--brand)}
.nm-disc .tr.g.plain .pc{background:#64748b}
.nm-disc .tr.g .g-sub{font-weight:600; color:inherit; opacity:.75; font-size:11.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.nm-disc .c-check{display:flex; align-items:center; justify-content:center}
.nm-disc .type{display:flex; min-width:0}
.nm-disc .type-sel{appearance:none; -webkit-appearance:none; border:1px solid transparent; border-radius:9px; font-size:11.5px; font-weight:700; padding:3px 22px 3px 9px; cursor:pointer; max-width:100%; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9.5l6 6 6-6'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 7px center}
.nm-disc .type-sel:hover{border-color:currentColor}
.nm-disc .type-sel:focus{outline:none; border-color:currentColor; box-shadow:0 0 0 2px rgba(67,97,238,.15)}
.nm-disc .c-name{display:flex; min-width:0}
.nm-disc .d-name{border:1px solid transparent; border-radius:8px; background:transparent; font-size:13px; font-weight:600; color:var(--ink); padding:3px 8px; width:100%; min-width:0; outline:none; text-overflow:ellipsis}
.nm-disc .d-name:hover{border-color:var(--line); background:#fff}
.nm-disc .d-name:focus{border-color:var(--brand); background:#fff; box-shadow:0 0 0 3px rgba(67,97,238,.14)}
.nm-disc .d-name::placeholder{color:var(--ink-3); font-weight:500}
.nm-disc .c-ip{font-weight:700; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.nm-disc .c-mac{color:var(--ink-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.nm-disc .c-tags{display:flex; flex-wrap:wrap; gap:4px; justify-content:flex-end; align-items:center}
.nm-disc .tag{font-size:10.5px; font-weight:700; padding:1px 8px; border-radius:12px; border:1px solid; white-space:nowrap; line-height:1.6}
.nm-disc .tag.dhcp{background:#e6f7f5; border-color:var(--sw-line); color:var(--sw)}
.nm-disc .tag.nm{background:#f1edff; border-color:var(--ap-line); color:var(--ap)}
.nm-disc .tag.host{background:var(--host-soft); border-color:#f0dfb8; color:var(--host)}
.nm-disc .tag.vl{background:#e8f3ff; border-color:#bcd9f7; color:var(--server)}
.nm-disc .tag.mt{background:#f1f4f9; border-color:var(--line); color:var(--ink-2)}
.nm-disc .tag.noip{background:#fdeaea; border-color:#f5c2c2; color:#b42323}
.nm-disc .c-src{font-size:11.5px; color:var(--ink-3); white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.nm-disc .c-src b{color:var(--ink-2); font-weight:700}
.nm-disc .tr.lnk{border-bottom:1px solid var(--line-2); cursor:pointer}
.nm-disc .tr.lnk:last-child{border-bottom:none}
.nm-disc .tr.lnk:hover{background:#f6f9ff}
.nm-disc .tr.lnk:has(.row-check:checked){background:var(--brand-soft)}
.nm-disc .l-dev{display:block; font-size:12.5px; font-weight:700; background:#f1f4fa; border:1px solid var(--line); border-radius:9px; padding:3px 10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.nm-disc .l-iface{font-size:12px; color:var(--ink-2); text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.nm-disc .empty{padding:26px 16px; text-align:center; color:var(--ink-2); font-size:13px; background:var(--panel); border:1px dashed var(--line); border-radius:12px; display:flex; flex-direction:column; gap:6px; align-items:center}
.nm-disc .empty b{color:var(--ink)}
.nm-disc .m-foot{display:flex; align-items:center; gap:12px; padding:14px 24px 16px; flex-wrap:wrap}
.nm-disc .f-stats{display:flex; align-items:center; gap:8px; margin-left:auto; flex-wrap:wrap}
.nm-disc .f-pill{font-size:12.5px; color:var(--ink-2); background:#f1f4fa; border:1px solid var(--line); border-radius:10px; padding:5px 12px; white-space:nowrap}
.nm-disc .f-pill b{font-size:14px; color:var(--ink); font-variant-numeric:tabular-nums}
.nm-disc .f-skip{font-size:12px; font-weight:600; color:var(--warn); background:var(--warn-soft); border:1px dashed var(--warn-line); border-radius:10px; padding:5px 12px; white-space:nowrap}
.nm-disc .f-dim{font-size:12px; color:var(--ink-3); white-space:nowrap}
.nm-disc .btn{display:inline-flex; align-items:center; gap:8px; border-radius:11px; font-size:13.5px; font-weight:700; padding:9px 18px; cursor:pointer; border:1.5px solid transparent; transition:all .15s; white-space:nowrap}
.nm-disc .btn.primary{background:linear-gradient(135deg,#4361ee,#5a3ee6); color:#fff; box-shadow:0 4px 14px rgba(67,97,238,.35)}
.nm-disc .btn.primary:hover{transform:translateY(-1px); box-shadow:0 6px 18px rgba(67,97,238,.45)}
.nm-disc .btn.primary:disabled{opacity:.55; cursor:not-allowed; transform:none; box-shadow:none}
.nm-disc .btn.ghost{background:var(--panel); border-color:var(--line); color:var(--ink-2)}
.nm-disc .btn.ghost:hover{border-color:#c3ccdd; color:var(--ink)}
@media (max-width:760px){
  .nm-disc .tbl{--cols:32px minmax(104px,.9fr) minmax(120px,1.3fr) minmax(96px,.8fr)}
  .nm-disc .lnk-tbl{--cols:32px minmax(110px,1fr) minmax(120px,1fr)}
  .nm-disc .c-mac, .nm-disc .th-mac, .nm-disc .c-tags, .nm-disc .th-tags, .nm-disc .c-src, .nm-disc .th-src, .nm-disc .l-iface, .nm-disc .th-iface{display:none}
  .nm-disc .summary{flex-direction:column; align-items:stretch}
  .nm-disc .steps{flex-wrap:wrap}
  .nm-disc .steps li{flex:1 1 140px; max-width:none}
  .nm-disc .g-hint{display:none}
}
`;
  document.head.appendChild(s);
}
