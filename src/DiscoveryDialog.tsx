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
  'pc','pos','printer','lock','cloud',
];

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
  const sub: string[] = [];
  if (d.ip) sub.push(d.ip);
  if (d.mac) sub.push(d.mac);
  if (d.vendor) sub.push(d.vendor);
  if (d.vlan != null) sub.push(`VLAN ${d.vlan}`);
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
          {sub.join(' · ')}
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
  const noIpDevs = useMemo(
    () => (scan?.proposedDevices || []).filter(d => !d.ip && isVisibleDevice(d)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan, qTrim, exclCidrArr, excludedVlans, showNoIp, nameEdits]);
  const noIpTotal = useMemo(
    () => scan ? scan.proposedDevices.filter(d => !d.ip).length : 0, [scan]);

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
  const willApplyLinks = useMemo(
    () => (scan?.proposedLinks || []).filter(l => linkPick[l.tempId] && linkEndpointsOk(l)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan, linkPick, effectiveDevIds]);
  const willDropLinks = useMemo(
    () => (scan?.proposedLinks || []).filter(l => linkPick[l.tempId] && !linkEndpointsOk(l)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan, linkPick, effectiveDevIds]);

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
      <div style={S.dialog}>
        <div style={S.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={S.iconWrap}><IconSearch /></div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Автообнаружение топологии</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>LLDP · MikroTik neighbors · Bridge FDB · ARP · DHCP</div>
            </div>
          </div>
          <button style={S.closeBtn} onClick={onClose} title="Закрыть"><IconX /></button>
        </div>

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
        {phase === 'review' && scan && (
          <div style={S.body}>
            <div style={S.statsRow}>
              <StatChip label="LLDP-соседей" value={scan.stats?.lldpEntries ?? 0} />
              <StatChip label="MikroTik-соседей" value={scan.stats?.neighborsFound ?? 0} />
              <StatChip label="FDB-записей" value={scan.stats?.fdbEntries ?? 0} />
              <StatChip label="ARP-записей" value={scan.stats?.arpEntries ?? 0} />
              <StatChip label="DHCP-лиз" value={scan.stats?.leases ?? 0} />
              <StatChip label="SNMP-хостов" value={scan.stats?.snmpHosts ?? 0} />
              <StatChip label="Время" value={((scan.stats?.ms ?? 0) / 1000).toFixed(1) + 'с'} muted />
            </div>

            {scan.warnings && scan.warnings.length > 0 && (
              <details style={S.warnBox}>
                <summary style={{ cursor: 'pointer', color: '#92400e', fontWeight: 600, fontSize: 12 }}>
                  Предупреждения ({scan.warnings.length})
                </summary>
                <ul style={{ margin: '8px 0 0 20px', padding: 0, fontSize: 11, color: '#78350f' }}>
                  {scan.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </details>
            )}

            {/* v0.52.0: фильтры — как в обычном импорте: поиск, подсети, VLAN */}
            <div style={S.section}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  placeholder="Поиск по имени / IP / MAC / DHCP"
                  value={q} onChange={e => setQ(e.target.value)}
                  style={{ ...S.input, flex: 1, minWidth: 180 }}
                />
                <label style={{ ...S.label, flexDirection: 'row', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                  <input type="checkbox" checked={showNoIp} onChange={e => setShowNoIp(e.target.checked)} />
                  <span style={{ fontSize: 11 }} title="Устройства, у которых известен только MAC. Добавить их нельзя — нужен IP.">
                    Показывать без IP ({noIpTotal})
                  </span>
                </label>
              </div>
              {subnetStats.some(s => s.count > 0) && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Подсети:</span>
                  {/* v0.53.0: пустые подсети (/32 PPPoE-хвосты и т.п.) скрываем — исключать там нечего */}
                  {subnetStats.filter(s => s.count > 0).map(s => {
                    const excluded = excludedCidrs.has(s.cidr);
                    return (
                      <button key={s.cidr}
                        title={(excluded ? 'Включить обратно: ' : 'Исключить из добавления: ') + s.cidr + (s.iface ? ` (${s.iface})` : '') + (s.comment ? ` — ${s.comment}` : '')}
                        onClick={() => setExcludedCidrs(prev => {
                          const next = new Set(prev);
                          if (next.has(s.cidr)) next.delete(s.cidr); else next.add(s.cidr);
                          return next;
                        })}
                        style={{ ...S.chip, ...(excluded ? S.chipOff : {}) }}>
                        {s.cidr} · {s.count}
                        {s.iface ? ` · ${s.iface}` : ''}
                      </button>
                    );
                  })}
                  {subnetStats.some(s => s.count === 0) && (
                    <span style={{ fontSize: 10, color: '#94a3b8' }} title="Подсети роутера, в которых не найдено ни одного устройства.">
                      +{subnetStats.filter(s => s.count === 0).length} пустых скрыто
                    </span>
                  )}
                  <button style={S.linkBtn} onClick={() => setExcludedCidrs(new Set())}>Все</button>
                  <button style={S.linkBtn} onClick={() => setExcludedCidrs(new Set(subnetStats.map(s => s.cidr)))}>Ни одной</button>
                </div>
              )}
              {vlanStats.length >= 1 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}
                        title={`Устройств без данных о VLAN: ${noVlanCount} — фильтр их не касается.`}>
                    VLAN:
                  </span>
                  {vlanStats.map(v => {
                    const excluded = excludedVlans.has(v.id);
                    return (
                      <button key={v.id}
                        title={(excluded ? 'Включить обратно' : 'Исключить из добавления') + `: VLAN ${v.id}` + (v.name ? ` (${v.name})` : '')}
                        onClick={() => setExcludedVlans(prev => {
                          const next = new Set(prev);
                          if (next.has(v.id)) next.delete(v.id); else next.add(v.id);
                          return next;
                        })}
                        style={{ ...S.chip, ...(excluded ? S.chipOff : {}) }}>
                        {v.id}{v.name ? ` · ${v.name}` : ''} · {v.count}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

              {/* Devices — v0.52.0: секции; v0.53.0: + «тип не определён» */}
            <div style={S.section}>
              <div style={S.sectionTitle}>
                <IconDevice /> <span>Новые устройства ({namedDevs.length + unnamedDevs.length + unknownDevs.length}{showNoIp ? ` + ${noIpDevs.length} без IP` : ''})</span>
              </div>
              {scan.proposedDevices.length === 0 && <EmptyRow text="Всё, что нашли — уже есть в текущей карте." />}

              {unknownDevs.length > 0 && (
                <>
                  <div style={S.subTitle}>
                    <span title="Отпечатки (имя, MAC, описание, VLAN) тип не выдали. Выберите тип селектором в строке.">
                      Тип не определён ({unknownDevs.length}) — выберите тип
                    </span>
                    <div style={{ flex: 1 }} />
                    <button style={S.linkBtn} onClick={() => togglePickAll(unknownDevs, devPick, setDevPick)}>
                      {unknownDevs.every(d => devPick[d.tempId]) ? 'Снять все' : 'Выбрать все'}
                    </button>
                  </div>
                  <div style={S.rows}>
                    {unknownDevs.map(d => (
                      <DiscoveryDeviceRow key={d.tempId} d={d}
                        effName={effNameOf(d)}
                        effKind={effKindOf(d)}
                        renamed={nameEdits[d.tempId] != null && nameEdits[d.tempId] !== d.name}
                        kindEdited={kindEdits[d.tempId] != null && kindEdits[d.tempId] !== d.kind}
                        checked={!!devPick[d.tempId]} disabled={false}
                        onToggle={(id, v) => setDevPick(p => ({ ...p, [id]: v }))}
                        onRename={(id, v) => setNameEdits(p => ({ ...p, [id]: v }))}
                        onKind={(id, v) => setKindEdits(p => ({ ...p, [id]: v }))} />
                    ))}
                  </div>
                </>
              )}

              {namedDevs.length > 0 && (
                <>
                  <div style={S.subTitle}>
                    <span>С именами ({namedDevs.length})</span>
                    <div style={{ flex: 1 }} />
                    <button style={S.linkBtn} onClick={() => togglePickAll(namedDevs, devPick, setDevPick)}>
                      {namedDevs.every(d => devPick[d.tempId]) ? 'Снять все' : 'Выбрать все'}
                    </button>
                  </div>
                  <div style={S.rows}>
                    {namedDevs.map(d => (
                      <DiscoveryDeviceRow key={d.tempId} d={d}
                        effName={effNameOf(d)}
                        effKind={effKindOf(d)}
                        renamed={nameEdits[d.tempId] != null && nameEdits[d.tempId] !== d.name}
                        kindEdited={kindEdits[d.tempId] != null && kindEdits[d.tempId] !== d.kind}
                        checked={!!devPick[d.tempId]} disabled={false}
                        onToggle={(id, v) => setDevPick(p => ({ ...p, [id]: v }))}
                        onRename={(id, v) => setNameEdits(p => ({ ...p, [id]: v }))}
                        onKind={(id, v) => setKindEdits(p => ({ ...p, [id]: v }))} />
                    ))}
                  </div>
                </>
              )}

              {unnamedDevs.length > 0 && (
                <>
                  <div style={S.subTitle}>
                    <span title="Устройства с IP, но без имени: ни DHCP, ни LLDP имени не дали. Имя можно задать прямо здесь — в поле строки.">
                      Без имени ({unnamedDevs.length}) — задайте имена
                    </span>
                    <div style={{ flex: 1 }} />
                    <button style={S.linkBtn} onClick={() => togglePickAll(unnamedDevs, devPick, setDevPick)}>
                      {unnamedDevs.every(d => devPick[d.tempId]) ? 'Снять все' : 'Выбрать все'}
                    </button>
                  </div>
                  <div style={S.rows}>
                    {unnamedDevs.map(d => (
                      <DiscoveryDeviceRow key={d.tempId} d={d}
                        effName={effNameOf(d)}
                        effKind={effKindOf(d)}
                        renamed={nameEdits[d.tempId] != null && nameEdits[d.tempId] !== d.name}
                        kindEdited={kindEdits[d.tempId] != null && kindEdits[d.tempId] !== d.kind}
                        checked={!!devPick[d.tempId]} disabled={false}
                        onToggle={(id, v) => setDevPick(p => ({ ...p, [id]: v }))}
                        onRename={(id, v) => setNameEdits(p => ({ ...p, [id]: v }))}
                        onKind={(id, v) => setKindEdits(p => ({ ...p, [id]: v }))} />
                    ))}
                  </div>
                </>
              )}

              {showNoIp && noIpDevs.length > 0 && (
                <>
                  <div style={S.subTitle}>
                    <span title="Известен только MAC — добавить такие устройства нельзя, устройству обязательно нужен IP.">
                      Без IP ({noIpDevs.length}) — добавлены не будут
                    </span>
                  </div>
                  <div style={S.rows}>
                    {noIpDevs.map(d => (
                      <DiscoveryDeviceRow key={d.tempId} d={d}
                        effName={d.name} effKind={d.kind} renamed={false} kindEdited={false}
                        checked={false} disabled={true}
                        onToggle={() => {}} onRename={() => {}} onKind={() => {}} />
                    ))}
                  </div>
                </>
              )}
              {showNoIp && noIpDevs.length === 0 && noIpTotal > 0 && (
                <EmptyRow text={`Все ${noIpTotal} без IP скрыты фильтрами.`} />
              )}
              {namedDevs.length === 0 && unnamedDevs.length === 0 && unknownDevs.length === 0 && scan.proposedDevices.length > 0 && (
                <EmptyRow text="Все устройства скрыты фильтрами — ослабьте поиск или включите подсети/VLAN." />
              )}
            </div>

            {/* Links */}
            <div style={S.section}>
              <div style={S.sectionTitle}>
                <IconLink /> <span>Новые связи ({scan.proposedLinks.length})</span>
                <div style={{ flex: 1 }} />
                <button style={S.linkBtn} onClick={() => {
                  const all = scan.proposedLinks.every(l => linkPick[l.tempId]);
                  const next: Record<string, boolean> = {};
                  scan.proposedLinks.forEach(l => next[l.tempId] = !all);
                  setLinkPick(next);
                }}>{scan.proposedLinks.every(l => linkPick[l.tempId]) ? 'Снять все' : 'Выбрать все'}</button>
              </div>
              {scan.proposedLinks.length === 0 && <EmptyRow text="Связей не найдено. Проверьте что LLDP включён на устройствах." />}
              <div style={S.rows}>
                {scan.proposedLinks.map(l => {
                  const checked = !!linkPick[l.tempId];
                  const willDrop = checked && !linkEndpointsOk(l);
                  return (
                  <label key={l.tempId}
                    title={willDrop ? 'Пропустится: нет обеих сторон (устройство снято, скрыто фильтром или без IP)' : undefined}
                    style={{ ...S.row, ...(checked ? S.rowChecked : {}), ...(willDrop ? { opacity: 0.55 } : {}) }}>
                    <input type="checkbox" checked={!!linkPick[l.tempId]}
                      onChange={e => setLinkPick(p => ({ ...p, [l.tempId]: e.target.checked }))} />
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {refLabel(l.fromRef)}{l.fromPort ? ` :${l.fromPort}` : ''}
                        </div>
                      </div>
                      <div style={{ color: '#94a3b8' }}>—</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {refLabel(l.toRef)}{l.toPort ? ` :${l.toPort}` : ''}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', maxWidth: 200, textAlign: 'right' }}>{l.evidence}</div>
                  </label>
                  );
                })}
              </div>
            </div>

            <div style={S.footer}>
              <button style={S.btnSecondary} onClick={() => setPhase('form')}>Назад</button>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 12, color: '#64748b', alignSelf: 'center', marginRight: 12 }}>
                Выбрано: {selDev} устройств · {selLink} связей
                {willDropLinks.length > 0 && (
                  <span style={{ color: '#b45309' }} title="Связи, у которых нет обеих сторон: устройство снято, скрыто фильтром или без IP.">
                    {' '}· пропустится связей: {willDropLinks.length}
                  </span>
                )}
                {hiddenPicked > 0 && (
                  <span title="Выбраны галочкой, но скрыты поиском или фильтрами подсетей/VLAN — применены не будут.">
                    {' '}· {hiddenPicked} вне фильтра
                  </span>
                )}
              </div>
              <button style={S.btnPrimary} disabled={selDev + selLink === 0} onClick={onApply}>
                <IconCheck /> Применить выбранное
              </button>
            </div>
          </div>
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
function StatChip({ label, value, muted }: { label: string; value: string | number; muted?: boolean }) {
  return (
    <div style={{
      background: muted ? '#f8fafc' : '#eff6ff',
      color: muted ? '#64748b' : '#1d4ed8',
      padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600,
      display: 'flex', flexDirection: 'column', minWidth: 82,
    }}>
      <span style={{ fontSize: 16, fontWeight: 700 }}>{value}</span>
      <span style={{ opacity: 0.8 }}>{label}</span>
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
