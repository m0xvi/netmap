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

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from './store';
import { alertDialog } from './Modal';
import {
  discoveryScan, discoveryTest,
  type DiscoveryConfig, type DiscoveryScanResult,
  type DiscoveryDeviceProposal, type DiscoveryLinkProposal,
} from './discoveryClient';

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

  // --- scan state --------------------------------------------------------
  const [phase, setPhase] = useState<Phase>('form');
  const [testMsg, setTestMsg] = useState<string>('');
  const [scan, setScan] = useState<DiscoveryScanResult | null>(null);
  const [devPick, setDevPick] = useState<Record<string, boolean>>({});
  const [linkPick, setLinkPick] = useState<Record<string, boolean>>({});
  const [applyReport, setApplyReport] = useState<{ dev: number; link: number } | null>(null);

  // Reset when re-opened
  useEffect(() => {
    if (open) {
      setPhase('form');
      setScan(null);
      setDevPick({});
      setLinkPick({});
      setTestMsg('');
      setApplyReport(null);
    }
  }, [open]);

  const doc = useStore(s => s.doc);
  const applyDiscovery = useStore(s => s.applyDiscovery);
  const pushAlert = useStore(s => s.pushAlert);

  const currentCfg: DiscoveryConfig = {
    mode, host, port, username, password,
    snmpCommunity: community,
    snmpSweep,
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
      // Default: all rows selected
      const dp: Record<string, boolean> = {};
      for (const d of r.proposedDevices) dp[d.tempId] = true;
      const lp: Record<string, boolean> = {};
      for (const l of r.proposedLinks) lp[l.tempId] = true;
      setDevPick(dp); setLinkPick(lp);
      setPhase('review');
    } catch (e: any) {
      setPhase('form');
      await alertDialog('Не удалось выполнить сканирование', e?.message || String(e));
    }
  }

  async function onApply() {
    if (!scan) return;
    setPhase('applying');

    // Build final devices/links using selection state.
    // Because a link's tempId ref may point to a device that user unchecked,
    // we drop such links automatically (with a warning count).
    const acceptedDevIds = new Set<string>();
    const devicesToCreate: any[] = [];
    for (const d of scan.proposedDevices) {
      if (!devPick[d.tempId]) continue;
      const finalId = `dsc-${d.tempId.replace(/^new_/, '')}`;
      devicesToCreate.push({
        id: finalId,
        name: d.name,
        kind: d.kind,
        ip: d.ip,
        mac: d.mac,
        vendor: d.vendor,
        tags: d.hint ? ['discovered', d.hint] : ['discovered'],
      });
      acceptedDevIds.add(d.tempId); // by tempId for resolving refs
      (d as any).__finalId = finalId;
    }

    const scanRef = scan;
    function resolveRef(ref: { existingId?: string; tempId?: string }): string | null {
      if (ref.existingId) return ref.existingId;
      if (ref.tempId) {
        const src = scanRef.proposedDevices.find(x => x.tempId === ref.tempId);
        return src && acceptedDevIds.has(src.tempId) ? (src as any).__finalId : null;
      }
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
    pushAlert({
      severity: 'success', origin: 'import',
      title: 'Автообнаружение применено',
      message: `Добавлено устройств: ${report.addedDevices}, связей: ${report.addedLinks}` +
               (droppedLinks ? ` (пропущено связей: ${droppedLinks}, без обеих сторон)` : ''),
    });
    setPhase('done');
  }

  // --- pre-render aggregates --------------------------------------------
  const selDev = useMemo(() => Object.values(devPick).filter(Boolean).length, [devPick]);
  const selLink = useMemo(() => Object.values(linkPick).filter(Boolean).length, [linkPick]);

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
      return p ? `${p.name}` : ref.tempId;
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
              <div style={{ fontSize: 11, color: '#64748b' }}>LLDP · MikroTik neighbors · Bridge FDB · ARP</div>
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
                {mode === 'mikrotik' && 'Заходим по SSH на MikroTik, читаем /ip neighbor, /ip arp и /interface bridge host.'}
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
                  </>
                )}
                {(mode === 'snmp' || mode === 'both') && (
                  <>
                    <label style={S.label}>SNMP community
                      <input value={community} onChange={e => setCommunity(e.target.value)} placeholder="public" style={S.input} />
                    </label>
                    <label style={{ ...S.label, gridColumn: 'span 2', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={snmpSweep} onChange={e => setSnmpSweep(e.target.checked)} />
                      <span style={{ fontSize: 12 }}>Опросить SNMP на всех ARP-адресах (медленнее, но глубже)</span>
                    </label>
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
              <button style={S.btnSecondary} disabled={phase === 'testing'} onClick={onTest}>
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
          <div style={{ ...S.body, alignItems: 'center', justifyContent: 'center', minHeight: 240 }}>
            <div style={S.spinner} />
            <div style={{ marginTop: 16, fontSize: 13, color: '#475569' }}>Опрашиваем сеть…</div>
            <div style={{ marginTop: 4, fontSize: 11, color: '#94a3b8' }}>SSH + SNMP walks. Обычно 5–30 сек.</div>
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

            {/* Devices */}
            <div style={S.section}>
              <div style={S.sectionTitle}>
                <IconDevice /> <span>Новые устройства ({scan.proposedDevices.length})</span>
                <div style={{ flex: 1 }} />
                <button style={S.linkBtn} onClick={() => {
                  const all = scan.proposedDevices.every(d => devPick[d.tempId]);
                  const next: Record<string, boolean> = {};
                  scan.proposedDevices.forEach(d => next[d.tempId] = !all);
                  setDevPick(next);
                }}>{scan.proposedDevices.every(d => devPick[d.tempId]) ? 'Снять все' : 'Выбрать все'}</button>
              </div>
              {scan.proposedDevices.length === 0 && <EmptyRow text="Всё, что нашли — уже есть в текущей карте." />}
              <div style={S.rows}>
                {scan.proposedDevices.map(d => (
                  <label key={d.tempId} style={{ ...S.row, ...(devPick[d.tempId] ? S.rowChecked : {}) }}>
                    <input type="checkbox" checked={!!devPick[d.tempId]}
                      onChange={e => setDevPick(p => ({ ...p, [d.tempId]: e.target.checked }))} />
                    <KindChip kind={d.kind} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>
                        {[d.ip, d.mac, d.vendor].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', maxWidth: 160, textAlign: 'right' }}>{d.hint}</div>
                  </label>
                ))}
              </div>
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
                {scan.proposedLinks.map(l => (
                  <label key={l.tempId} style={{ ...S.row, ...(linkPick[l.tempId] ? S.rowChecked : {}) }}>
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
                ))}
              </div>
            </div>

            <div style={S.footer}>
              <button style={S.btnSecondary} onClick={() => setPhase('form')}>Назад</button>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 12, color: '#64748b', alignSelf: 'center', marginRight: 12 }}>
                Выбрано: {selDev} устройств · {selLink} связей
              </div>
              <button style={S.btnPrimary} disabled={selDev + selLink === 0} onClick={onApply}>
                <IconCheck /> Применить выбранное
              </button>
            </div>
          </div>
        )}

        {/* ============ APPLYING / DONE ============ */}
        {phase === 'applying' && (
          <div style={{ ...S.body, alignItems: 'center', justifyContent: 'center', minHeight: 180 }}>
            <div style={S.spinner} />
            <div style={{ marginTop: 12, fontSize: 13, color: '#475569' }}>Добавляем в карту…</div>
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
                  Добавлено устройств: <b>{applyReport.dev}</b>, связей: <b>{applyReport.link}</b>. Ctrl+Z отменит одной операцией.
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
