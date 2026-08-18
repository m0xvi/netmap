import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from './store';
import {
  hasMikrotikBackend, scanMikrotik, guessVendorAndKind, debugMikrotik,
  summarizeSubnets, ipInAnyCidr,
  type MikrotikConfig, type ScanResult, type SubnetStat, type DebugRawResult,
} from './mikrotikClient';
import {
  vaultStatus, vaultList, vaultGet, vaultUnlock, vaultUpsert,
  type VaultItemMeta,
} from './vaultClient';
import { ICONS, KIND_META } from './icons';
import type { Device, Port, DeviceKind } from './types';
import type { ImportAction } from './importUtils';
import { defaultAction } from './importUtils';
import { alertDialog, confirmDialog, promptText } from './Modal';

interface Row {
  mac: string;
  ip: string | null;
  hostname: string;
  source: 'dhcp' | 'arp' | 'both';
  status: string;
  vendor?: string;
  suggestedKind: DeviceKind;
  existingId?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const LS_LAST = 'netmap:mikrotik:last-cfg';
const VAULT_FOLDER = 'MikroTik';   // convention — items in this folder are surfaced as credentials pickers

export function MikrotikImportDialog({ open, onClose }: Props) {
  const doc = useStore(s => s.doc);
  const addDevice = useStore(s => s.addDevice);
  const addGroup = useStore(s => s.addGroup);
  const updateDevice = useStore(s => s.updateDevice);

  // ---- Config form state ----
  const [host, setHost] = useState('');
  // v0.35.9: transport selector — SSH is the recommended fallback when
  // the router's web/REST service is disabled (very common on prod boxes).
  const [transport, setTransport] = useState<'ssh' | 'rest'>('ssh');
  const [sshPort, setSshPort] = useState<number>(22);
  const [username, setUsername] = useState('admin');
  // We store password ONLY in a ref for the duration of one scan — it never persists.
  const passwordRef = useRef<string>('');
  const [pwLength, setPwLength] = useState(0);   // shown as "•" count for feedback
  const [showPwField, setShowPwField] = useState(true);   // hidden after successful vault-load
  const [insecure, setInsecure] = useState(false);
  const [wantLeases, setWantLeases] = useState(true);
  const [wantArp, setWantArp] = useState(true);

  // ---- Vault integration ----
  const [vStatus, setVStatus] = useState<'unknown' | 'not-init' | 'locked' | 'unlocked'>('unknown');
  const [vaultItems, setVaultItems] = useState<VaultItemMeta[]>([]);
  const [selectedVaultId, setSelectedVaultId] = useState<string>('');

  // Load last-used config (never password)
  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(LS_LAST);
      if (raw) {
        const cfg = JSON.parse(raw);
        setHost(cfg.host || '');
        setUsername(cfg.username || 'admin');
        setInsecure(cfg.insecure ?? false);
        if (cfg.transport === 'ssh' || cfg.transport === 'rest') setTransport(cfg.transport);
        if (typeof cfg.sshPort === 'number') setSshPort(cfg.sshPort);
        setWantLeases(cfg.fetchLeases ?? true);
        setWantArp(cfg.fetchArp ?? true);
        setSelectedVaultId(cfg.lastVaultId || '');
      }
    } catch {}
    // Query vault status
    (async () => {
      const s = await vaultStatus();
      if (!s.initialized) setVStatus('not-init');
      else if (!s.unlocked) setVStatus('locked');
      else {
        setVStatus('unlocked');
        setVaultItems(await vaultList());
      }
    })();
    // Reset ephemeral password
    passwordRef.current = '';
    setPwLength(0);
    setShowPwField(true);
  }, [open]);

  // Purge password from memory when the dialog closes
  useEffect(() => {
    if (open) return;
    passwordRef.current = '';
    setPwLength(0);
  }, [open]);

  // ---- Unlock vault ----
  const doUnlockVault = async () => {
    const pw = await promptText('Мастер-пароль vault', '', 'Разблокировать vault, чтобы выбрать сохранённую учётку');
    if (!pw) return;
    const res = await vaultUnlock(pw);
    if (res.ok) {
      setVStatus('unlocked');
      setVaultItems(await vaultList());
    } else {
      await alertDialog('Ошибка', 'Неверный пароль');
    }
  };

  // Only MikroTik-tagged items in the picker
  const mikrotikVaultItems = useMemo(
    () => vaultItems.filter(i => (i.folder || '').toLowerCase() === 'mikrotik'),
    [vaultItems]
  );

  // When user picks a vault entry — load its credentials into the form
  const applyVaultItem = async (id: string) => {
    if (!id) {
      setSelectedVaultId('');
      setShowPwField(true);
      passwordRef.current = '';
      setPwLength(0);
      return;
    }
    const res = await vaultGet(id);
    if (!res.ok || !res.item) return;
    const it = res.item;
    setSelectedVaultId(id);
    if (it.url) setHost(it.url);
    if (it.username) setUsername(it.username);
    if (it.password) {
      passwordRef.current = it.password;
      setPwLength(it.password.length);
      setShowPwField(false);
    }
  };

  // ---- Scan state ----
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** v0.35.9: subnets the user has EXCLUDED from import (empty = keep all). */
  const [excludedCidrs, setExcludedCidrs] = useState<Set<string>>(new Set());
  /** v0.38: per-row action override — keys are MAC, values are 'add' | 'skip'
   *  | 'update' | 'replace'. Rows not present use defaultAction(row). */
  const [actions, setActions] = useState<Map<string, ImportAction>>(() => new Map());
  const subnetStats = useMemo(() => scan ? summarizeSubnets(scan) : [], [scan]);
  const activeCidrs = useMemo(
    () => subnetStats.filter(s => !excludedCidrs.has(s.cidr)).map(s => s.cidr),
    [subnetStats, excludedCidrs]
  );

  const rows: Row[] = useMemo(() => {
    if (!scan) return [];
    const byMac = new Map<string, Row>();
    const existingByMac = new Map<string, string>();
    for (const d of doc.devices) if (d.mac) existingByMac.set(d.mac.toUpperCase(), d.id);
    const put = (mac: string, patch: Partial<Row>, src: 'dhcp' | 'arp') => {
      const key = mac.toUpperCase();
      const existing = byMac.get(key);
      if (existing) {
        byMac.set(key, { ...existing, ...patch, source: existing.source !== src ? 'both' : existing.source });
      } else {
        const guess = guessVendorAndKind(mac, patch.hostname || '');
        byMac.set(key, {
          mac: key,
          ip: patch.ip ?? null,
          hostname: patch.hostname || '',
          source: src,
          status: patch.status || '',
          vendor: guess.vendor,
          suggestedKind: guess.kind,
          existingId: existingByMac.get(key),
        });
      }
    };
    for (const l of scan.leases) put(l.mac, { ip: l.ip, hostname: l.hostname || l.comment, status: l.status }, 'dhcp');
    for (const a of scan.arp) if (a.mac && a.mac !== '00:00:00:00:00:00') put(a.mac, {
      ip: a.ip, status: a.complete ? 'reachable' : 'incomplete',
    }, 'arp');
    return Array.from(byMac.values()).sort((a, b) => {
      if (!!a.existingId !== !!b.existingId) return a.existingId ? 1 : -1;
      return (a.ip || '').localeCompare(b.ip || '', undefined, { numeric: true });
    });
  }, [scan, doc.devices]);

  const [q, setQ] = useState('');
  const [showExisting, setShowExisting] = useState(true);
  const [showIncomplete, setShowIncomplete] = useState(false);
  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (!showExisting && r.existingId) return false;
      if (!showIncomplete && (r.status === 'incomplete' || !r.ip)) return false;
      // v0.35.9: drop rows whose IP does not fall into any active subnet.
      // v0.38 fix: previously rows without IP passed through even when subnets
      // were excluded — now we drop them too when ANY exclusion is active.
      // Rationale: if the user unchecked 10.11.0.0/16, they don't want MAC-only
      // entries from that subnet either. Rows without IP survive only when
      // NO subnet has been excluded.
      const noExclusion = excludedCidrs.size === 0;
      if (activeCidrs.length > 0 && r.ip && !ipInAnyCidr(r.ip, activeCidrs)) return false;
      if (!noExclusion && !r.ip) return false;
      if (!q.trim()) return true;
      const s = q.trim().toLowerCase();
      return r.mac.toLowerCase().includes(s)
          || (r.ip || '').toLowerCase().includes(s)
          || r.hostname.toLowerCase().includes(s)
          || (r.vendor || '').toLowerCase().includes(s);
    });
  }, [rows, q, showExisting, showIncomplete, activeCidrs, excludedCidrs]);

  /** v0.38: effective selection = intersection of user's `selected` set
   *  with the currently-filtered rows. Fixes "Выбрано 271 из 189" bug
   *  where the counter and Import button ignored subnet exclusions. */
  const filteredMacs = useMemo(() => new Set(filtered.map(r => r.mac)), [filtered]);
  const effectiveSelected = useMemo(
    () => new Set(Array.from(selected).filter(mac => filteredMacs.has(mac))),
    [selected, filteredMacs]
  );

  /** v0.38: preview of what will actually happen on Import — respects per-row
   *  actions and defaults 'skip' for existing devices. */
  const importPreview = useMemo(() => {
    let toAdd = 0, toUpdate = 0, toReplace = 0, toSkip = 0;
    for (const mac of effectiveSelected) {
      const row = filtered.find(r => r.mac === mac);
      if (!row) continue;
      const action = actions.get(mac) ?? defaultAction(row);
      if (action === 'add') toAdd++;
      else if (action === 'update') toUpdate++;
      else if (action === 'replace') toReplace++;
      else toSkip++;
    }
    return { toAdd, toUpdate, toReplace, toSkip, total: toAdd + toUpdate + toReplace };
  }, [effectiveSelected, filtered, actions]);

  if (!open) return null;

  const doScan = async () => {
    setScanning(true); setError(null); setScan(null); setSelected(new Set());
    // ---- Warn on insecure combos (REST only) ----
    if (transport === 'rest') {
      const isHttp = /^http:\/\//i.test(host.trim());
      if (isHttp) {
        const proceed = await confirmDialog(
          '⚠ Пароль будет отправлен открытым текстом',
          'Адрес начинается с http:// — Basic auth поверх незашифрованного соединения. Кто-то в сети может перехватить пароль. Продолжить?',
          { danger: true, okText: 'Да, я знаю' }
        );
        if (!proceed) { setScanning(false); return; }
      }
    }
    // v0.35.9: for SSH we accept "192.168.11.1" or "192.168.11.1:2222" — strip
    // any http(s):// prefix the user may have pasted from a browser tab.
    const cleanHost = host.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    let cleanPort = sshPort;
    const hostPortMatch = /^([^:]+):(\d+)$/.exec(cleanHost);
    const hostOnly = hostPortMatch ? hostPortMatch[1] : cleanHost;
    if (hostPortMatch) cleanPort = Number(hostPortMatch[2]);

    try {
      const cfg: MikrotikConfig = {
        // For REST keep the original (with scheme); for SSH — bare host.
        host: transport === 'ssh' ? hostOnly : host.trim(),
        port: transport === 'ssh' ? cleanPort : undefined,
        transport,
        username: username.trim(),
        password: passwordRef.current,   // read directly from ref, no state exposure
        insecure,
        fetchLeases: wantLeases,
        fetchArp: wantArp,
        fetchInterfaces: false,
      };
      const res = await scanMikrotik(cfg);
      if (!res.resource.ok) throw new Error(res.resource.error || 'Не удалось подключиться');
      setScan(res);
      // Reset subnet-picker selection to "all subnets included" on every
      // fresh scan — the user opts out via the checkboxes if needed.
      setExcludedCidrs(new Set());
      // Persist config (never password) + remember which vault item worked
      try {
        localStorage.setItem(LS_LAST, JSON.stringify({
          host: host.trim(), username: username.trim(),
          transport, sshPort: cleanPort,
          insecure, fetchLeases: wantLeases, fetchArp: wantArp,
          lastVaultId: selectedVaultId || undefined,
        }));
      } catch {}
    } catch (e: any) {
      setError(explainConnectionError(e, transport, hostOnly, cleanPort));
    } finally {
      setScanning(false);
      // Clear the password from memory as soon as the request is done.
      // Except when user has selected a vault item — in that case keeping it lets them re-scan quickly.
      if (!selectedVaultId) {
        passwordRef.current = '';
        setPwLength(0);
      }
    }
  };

  const doSaveToVault = async () => {
    if (vStatus !== 'unlocked') {
      await alertDialog('Vault не разблокирован', 'Сначала разблокируйте vault.');
      return;
    }
    if (!host.trim() || !passwordRef.current) {
      await alertDialog('Пусто', 'Введите host и password, чтобы сохранить учётку.');
      return;
    }
    const name = await promptText(
      'Сохранить учётку MikroTik',
      `MikroTik ${host.replace(/^https?:\/\//, '')}`,
      'Как назвать эту учётку'
    );
    if (!name) return;
    const res = await vaultUpsert({
      name,
      folder: 'MikroTik',
      url: host.trim(),
      username: username.trim(),
      password: passwordRef.current,
      notes: `Auto-saved by DHCP importer on ${new Date().toISOString()}`,
    });
    if (res.ok) {
      const list = await vaultList();
      setVaultItems(list);
      if (res.id) setSelectedVaultId(res.id);
      setShowPwField(false);
      await alertDialog('Сохранено', `Учётка «${name}» добавлена в vault.`);
    }
  };

  const toggleAll = () => {
    // v0.38: "select all" operates on the currently-visible rows only.
    const allSelected = filtered.length > 0 && filtered.every(r => selected.has(r.mac));
    if (allSelected) {
      // Remove only visible rows from the selection; keep any off-screen picks.
      const next = new Set(selected);
      for (const r of filtered) next.delete(r.mac);
      setSelected(next);
    } else {
      const next = new Set(selected);
      for (const r of filtered) next.add(r.mac);
      setSelected(next);
    }
  };

  /** v0.38: bulk-set action for all conflicts (rows with existingId) that are
   *  currently selected + visible. Used by the toolbar above the table. */
  const bulkSetAction = (a: ImportAction) => {
    const next = new Map(actions);
    for (const r of filtered) {
      if (!selected.has(r.mac)) continue;
      if (!r.existingId) continue;   // only conflict rows
      next.set(r.mac, a);
    }
    setActions(next);
  };

  const doImport = async () => {
    // v0.38: gate on effective selection so exclusions are honoured.
    if (effectiveSelected.size === 0) return;
    // v0.36.0: classify by subnet.
    // 1. For every selected row, figure out which CIDR its IP belongs to
    //    (from the router-declared /ip address list, subnetStats already
    //    computed this for us).
    // 2. For each distinct CIDR that has selected devices, create a group
    //    (or reuse an existing one with the same subtitle="CIDR" marker).
    // 3. Devices without an IP go into a "Без IP" catch-all group.
    // The old single "DHCP · host" group is gone — we spread new devices
    // across as many groups as subnets they occupy, which reads much better
    // on the canvas.

    // Helper: pick the best-matching CIDR for an IP among subnetStats.
    // Returns null when the IP doesn't fit any known subnet (falls back
    // to the /24 that summarizeSubnets already inferred, which IS in
    // subnetStats — so 'null' only happens for row.ip == null).
    const cidrOf = (ip: string | null | undefined): string | null => {
      if (!ip) return null;
      for (const s of subnetStats) {
        if (ipInAnyCidr(ip, [s.cidr])) return s.cidr;
      }
      return null;
    };

    // Compute palette for subnet groups — deterministic by CIDR string
    // so re-imports of the same subnet always get the same colour.
    const paletteColors = [
      '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444',
      '#14B8A6', '#EC4899', '#6366F1', '#F97316', '#0EA5E9',
    ];
    const colorFor = (cidr: string) => {
      let h = 0;
      for (let i = 0; i < cidr.length; i++) h = (h * 31 + cidr.charCodeAt(i)) >>> 0;
      return paletteColors[h % paletteColors.length];
    };

    // Group id resolver — reuse existing group with same CIDR subtitle if any,
    // otherwise create fresh. We STORE cidr in subtitle so future imports
    // can find the same group.
    const existingGroups = doc.groups || [];
    const findOrCreateGroup = (cidr: string | null): string => {
      const label = cidr || 'Без IP';
      const stat = cidr ? subnetStats.find(s => s.cidr === cidr) : null;
      // Prefer router-provided name (interface / comment) when available.
      const humanName = cidr
        ? (stat?.comment && stat.comment.length < 30 ? stat.comment
           : stat?.interfaces && stat.interfaces[0] ? `${stat.interfaces[0]} · ${cidr}`
           : `Подсеть ${cidr}`)
        : 'Без IP';

      // Match strategy: subtitle exactly equals CIDR (or 'Без IP').
      const existing = existingGroups.find(g => g.subtitle === label);
      if (existing) return existing.id;

      const gid = 'g-net-' + (cidr ? cidr.replace(/[^\w]/g, '-') : 'noip') + '-' + Math.random().toString(36).slice(2, 5);
      addGroup({
        id: gid, name: humanName, parentId: null,
        x: 40 + Math.random() * 200, y: 40 + Math.random() * 100,
        width: 560, height: 260,
        color: cidr ? colorFor(cidr) : '#94A3B8',
        subtitle: label,
      });
      return gid;
    };

    // v0.43.5: per-group placement cursors so devices don't stack on the same
    // spot. Grid columns come from the store setting (0 = auto ~sqrt(N)); the
    // per-group total is estimated from `selected.size / groupCount` so each
    // grid stays reasonably square.
    const cursors = new Map<string, { placed: number; cols: number }>();
    const orphanCols = (useStore.getState() as any).orphanGridCols || 0;
    // Estimate items-per-group so auto-sqrt targets the right shape.
    // Named `estGroupCount` to avoid colliding with `groupCount` used later
    // for the summary message.
    const estGroupCount = Math.max(1, subnetStats.filter(s => s.deviceCount > 0).length || 1);
    const estPerGroup = Math.max(4, Math.ceil(selected.size / estGroupCount));
    const autoCols = Math.max(4, Math.min(20, Math.ceil(Math.sqrt(estPerGroup))));
    const gridCols = orphanCols > 0 ? orphanCols : autoCols;
    const nextPos = (groupId: string) => {
      let cur = cursors.get(groupId);
      if (!cur) { cur = { placed: 0, cols: gridCols }; cursors.set(groupId, cur); }
      const col = cur.placed % cur.cols;
      const rowIdx = Math.floor(cur.placed / cur.cols);
      cur.placed++;
      return { x: 20 + col * 170, y: 50 + rowIdx * 100 };
    };

    let placed = 0;
    let updated = 0;
    let replaced = 0;
    let skipped = 0;
    for (const row of filtered) {
      // v0.38: obey both effective selection AND per-row action override.
      if (!effectiveSelected.has(row.mac)) continue;
      const action: ImportAction = actions.get(row.mac) ?? defaultAction(row);

      if (action === 'skip') { skipped++; continue; }

      if (row.existingId && (action === 'update' || action === 'replace')) {
        const existing = doc.devices.find(d => d.id === row.existingId);
        const patch: Partial<Device> = {};
        if (action === 'replace') {
          if (row.ip) patch.ip = row.ip;
          if (row.hostname) patch.name = row.hostname;
          if (row.vendor) patch.vendor = row.vendor;
        } else {
          // Update = merge only into empty / auto-generated fields.
          if (row.ip && !existing?.ip) patch.ip = row.ip;
          if (row.hostname) {
            const cur = existing?.name || '';
            const isAutoName = /^Device [0-9A-F:]+$/i.test(cur) || cur === row.mac.slice(-8) || cur === '';
            if (isAutoName || cur === row.hostname) patch.name = row.hostname;
          }
          if (row.vendor && !existing?.vendor) patch.vendor = row.vendor;
        }
        const comment = getLeaseComment(scan, row.mac);
        if (comment) {
          const existingNotes = existing?.credential?.notes || '';
          const marker = `[MikroTik: ${comment}]`;
          if (!existingNotes.includes(marker)) {
            patch.credential = {
              ...(existing?.credential || {}),
              notes: existingNotes ? `${existingNotes}\n${marker}` : marker,
            };
          }
        }
        const tags = new Set(existing?.tags || []);
        tags.add('mtk-synced');
        patch.tags = Array.from(tags);
        if (Object.keys(patch).length > 0) {
          updateDevice(row.existingId, patch);
          if (action === 'replace') replaced++;
          else updated++;
        } else {
          skipped++;
        }
        continue;
      }

      if (action !== 'add') { skipped++; continue; }

      const name = row.hostname || row.vendor || `Device ${row.mac.slice(-8)}`;
      const id = `${row.suggestedKind}-${Math.random().toString(36).slice(2, 7)}`;
      const cidr = cidrOf(row.ip);
      const gid = findOrCreateGroup(cidr);
      const pos = nextPos(gid);
      const ports: Port[] = [{
        id: 'lan', label: '', type: 'RJ45',
        speed: '1G', status: row.ip ? 'up' : 'down',
      }];
      const cidrTag = cidr ? `net:${cidr}` : 'net:none';
      const d: Device = {
        id, name, kind: row.suggestedKind,
        vendor: row.vendor, ip: row.ip || undefined, mac: row.mac,
        display: 'compact', groupId: gid,
        x: pos.x, y: pos.y,
        ports, tags: ['imported', 'dhcp', cidrTag],
      };
      addDevice(d);
      placed++;
    }
    const summary = [
      placed > 0 ? `добавлено ${placed}` : null,
      updated > 0 ? `обновлено ${updated}` : null,
      replaced > 0 ? `заменено ${replaced}` : null,
      skipped > 0 ? `пропущено ${skipped}` : null,
    ].filter(Boolean).join(', ') || 'без изменений';

    // v0.23: if new devices were added, run auto-layout so the new group
    // slots into the hierarchy cleanly instead of overlapping existing devices.
    if (placed > 0) {
      // Give React a tick to commit the addDevice / addGroup writes, then layout.
      setTimeout(() => {
        try { useStore.getState().autoLayout('TB'); } catch { /* ignore */ }
      }, 100);
    }

    // v0.36.0: report group count instead of a single group name — devices
    // are now spread across subnet-based groups.
    const groupCount = cursors.size;
    const groupInfo = groupCount === 0 ? '' :
      groupCount === 1 ? '\nВсё уложено в одну группу.' :
                         `\nРазложено по ${groupCount} подсетям.`;
    useStore.getState().pushAlert({
      severity: 'success', origin: 'import',
      title: 'Импорт из MikroTik завершён',
      message: `${summary}${placed > 0 ? groupInfo : ''}`,
    });
    await alertDialog('Импорт завершён', `Синхронизация с MikroTik: ${summary}.`
      + (placed > 0 ? `${groupInfo}\nСхема автоматически разложена.` : ''));
    onClose();
  };

  // Look up the DHCP-lease comment for a given MAC in the raw scan result.
  function getLeaseComment(scanRes: ScanResult | null, mac: string): string {
    if (!scanRes) return '';
    const l = scanRes.leases.find(x => (x.mac || '').toUpperCase() === mac.toUpperCase());
    // We already put lease.hostname||lease.comment into row.hostname earlier,
    // so return the raw MikroTik comment only if it differs from hostname (extra info).
    if (!l) return '';
    if (!l.comment) return '';
    if (l.comment === l.hostname) return '';
    return l.comment;
  }

  // ---------------------------------------------------------------------------
  // UI. v0.36.0: rendered via a Portal to document.body so the floating
  // LayoutFAB / LayerLegend (which live inside a `position:relative` canvas
  // container earlier in the DOM) don't paint over the modal. Without the
  // portal, z-index alone can't fight DOM order across sibling stacking
  // contexts — see e.g. that issue with the corner buttons in v0.35.
  return createPortal(
    <div onClick={onClose}
         style={{
           position: 'fixed', inset: 0,
           background: 'rgba(0,0,0,0.7)',
           backdropFilter: 'blur(4px)',
           zIndex: 4000,
           display: 'flex', alignItems: 'center', justifyContent: 'center',
           padding: 24,
         }}>
      <div onClick={e => e.stopPropagation()}
           style={{
             width: 'min(960px, 96vw)', maxHeight: '92vh',
             background: '#FFFFFF', border: '1px solid #D1D5DB', borderRadius: 12,
             color: '#111827', display: 'flex', flexDirection: 'column',
             boxShadow: '0 20px 60px rgba(0,0,0,0.8)', overflow: 'hidden',
           }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #E5E7EB',
                      display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#38bdf8"
               strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12a10 10 0 0 1 20 0"/><path d="M5 12a7 7 0 0 1 14 0"/>
            <path d="M8 12a4 4 0 0 1 8 0"/><circle cx="12" cy="12" r="1" fill="#38bdf8"/>
          </svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Импорт устройств из MikroTik</div>
            <div style={{ fontSize: 10, opacity: 0.6 }}>
              {transport === 'ssh' ? 'SSH · RouterOS CLI' : 'REST API v7+'} · DHCP · ARP · VLAN · подсети
            </div>
          </div>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        {!hasMikrotikBackend ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#fbbf24', fontSize: 13 }}>
            ⚠ Функция доступна только в собранной .exe (Electron).<br />
            В браузерном preview невозможно из-за CORS и отсутствия Node net-модулей.
          </div>
        ) : (
          <>
            {/* Security callout */}
            <div style={{ padding: '10px 18px', borderBottom: '1px solid #E5E7EB',
                          background: '#D1FAE5', fontSize: 11, color: '#065F46',
                          display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ fontSize: 14 }}>🔐</span>
              <div style={{ flex: 1 }}>
                Пароль <b>не сохраняется</b> в localStorage. Хранится только в памяти на время запроса,
                после — обнуляется. Для регулярного использования — сохраните учётку в
                <b>Vault</b> (AES-256-GCM + PBKDF2). Рекомендуется завести на MikroTik
                отдельного read-only юзера ограниченного по IP — см. подсказку ниже.
              </div>
            </div>

            {/* Vault picker (top row) */}
            <div style={{ padding: '10px 18px 4px', borderBottom: '1px solid #E5E7EB' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <Field label="Учётка из Vault">
                  {vStatus === 'unlocked' ? (
                    <select value={selectedVaultId}
                            onChange={e => applyVaultItem(e.target.value)}
                            style={inputStyle}>
                      <option value="">— вручную (без сохранения) —</option>
                      {mikrotikVaultItems.length === 0 && (
                        <option value="" disabled>(нет записей в папке «MikroTik»)</option>
                      )}
                      {mikrotikVaultItems.map(i => (
                        <option key={i.id} value={i.id}>{i.name}{i.url ? ` · ${i.url}` : ''}</option>
                      ))}
                    </select>
                  ) : vStatus === 'locked' ? (
                    <button onClick={doUnlockVault} style={smallBtn}>🔓 Разблокировать vault</button>
                  ) : vStatus === 'not-init' ? (
                    <div style={{ fontSize: 11, opacity: 0.6 }}>
                      Vault ещё не создан — откройте «Vault» в тулбаре и придумайте мастер-пароль
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, opacity: 0.6 }}>Загрузка…</div>
                  )}
                </Field>
                {vStatus === 'unlocked' && !selectedVaultId && (
                  <button onClick={doSaveToVault}
                          disabled={!host || !passwordRef.current}
                          style={{ ...smallBtn, opacity: (!host || !passwordRef.current) ? 0.5 : 1 }}
                          title="Сохранить введённые данные в vault для повторного использования">
                    💾 Сохранить в vault
                  </button>
                )}
              </div>
            </div>

            {/* v0.35.9 — transport selector (SSH vs REST). Placed on top of
                the config form because it changes the meaning of the "host"
                field and enables the SSH-port input on the right. */}
            <div style={{ padding: '10px 16px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>Транспорт:</span>
              <TransportRadio value={transport} onChange={setTransport} option="ssh"
                              label="SSH (CLI)" hint="RouterOS shell по SSH — работает даже если веб-интерфейс закрыт" />
              <TransportRadio value={transport} onChange={setTransport} option="rest"
                              label="REST API" hint="HTTP(S) /rest/* — быстро, но обычно выключено в проде" />
            </div>

            {/* Config form */}
            <div style={{ padding: '10px 16px 16px', borderBottom: '1px solid #E5E7EB',
                          display: 'grid',
                          gridTemplateColumns: transport === 'ssh'
                            ? '2fr 0.6fr 1fr 1fr auto'
                            : '2fr 1fr 1fr auto',
                          gap: 8, alignItems: 'end' }}>
              <Field label={transport === 'ssh' ? 'Адрес роутера (IP или host)' : 'Адрес роутера (URL)'}>
                <input value={host} onChange={e => setHost(e.target.value)}
                       placeholder={transport === 'ssh' ? '192.168.11.1' : 'https://192.168.11.1'}
                       style={inputStyle} />
              </Field>
              {transport === 'ssh' && (
                <Field label="SSH-порт">
                  <input type="number" min={1} max={65535}
                         value={sshPort}
                         onChange={e => setSshPort(Math.max(1, Math.min(65535, Number(e.target.value) || 22)))}
                         placeholder="22"
                         style={inputStyle} />
                </Field>
              )}
              <Field label="Пользователь">
                <input value={username} onChange={e => setUsername(e.target.value)}
                       style={inputStyle} />
              </Field>
              <Field label={selectedVaultId ? 'Пароль (из vault)' : 'Пароль'}>
                {selectedVaultId && !showPwField ? (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <div style={{
                      ...inputStyle, flex: 1,
                      background: '#D1FAE5', color: '#10B981',
                      fontFamily: 'monospace', border: '1px solid #10B981',
                    }}>
                      {'•'.repeat(Math.min(pwLength, 20)) || '(пусто)'}
                    </div>
                    <button onClick={() => {
                      passwordRef.current = '';
                      setPwLength(0);
                      setShowPwField(true);
                    }} title="Ввести пароль вручную" style={smallBtn}>✎</button>
                  </div>
                ) : (
                  <input
                    type="password"
                    defaultValue=""
                    onChange={e => {
                      passwordRef.current = e.target.value;
                      setPwLength(e.target.value.length);
                    }}
                    placeholder="•••"
                    autoComplete="new-password"
                    style={inputStyle}
                  />
                )}
              </Field>
              <button onClick={doScan} disabled={!host || scanning}
                      style={{ ...primaryBtn, opacity: (!host || scanning) ? 0.5 : 1 }}>
                {scanning ? 'Сканирую...' : '🔎 Сканировать'}
              </button>

              <div style={{ gridColumn: '1/-1', display: 'flex', gap: 12, fontSize: 11, opacity: 0.75,
                            flexWrap: 'wrap' }}>
                <label style={checkLabel}>
                  <input type="checkbox" checked={wantLeases} onChange={e => setWantLeases(e.target.checked)} />
                  DHCP leases
                </label>
                <label style={checkLabel}>
                  <input type="checkbox" checked={wantArp} onChange={e => setWantArp(e.target.checked)} />
                  ARP таблица
                </label>
                {transport === 'rest' && (
                  <label style={{ ...checkLabel, color: insecure ? '#fbbf24' : undefined }}>
                    <input type="checkbox" checked={insecure} onChange={e => setInsecure(e.target.checked)} />
                    {insecure ? '⚠ разрешить самоподписанный HTTPS (MITM-риск в LAN)' : 'разрешить самоподписанный HTTPS'}
                  </label>
                )}
              </div>
            </div>

            {/* MikroTik user setup hint */}
            <details style={{ padding: '8px 18px', borderBottom: '1px solid #E5E7EB', fontSize: 11 }}>
              <summary style={{ cursor: 'pointer', opacity: 0.75 }}>
                💡 Как создать безопасного read-only юзера на MikroTik
              </summary>
              <pre style={{
                margin: '8px 0 0', padding: 10, background: '#F9FAFB', borderRadius: 6,
                fontSize: 10.5, overflowX: 'auto', color: '#6B7280',
              }}>{`# 1. Включить HTTPS REST (не HTTP!)
/ip service enable www-ssl
/ip service disable www

# 2. Отдельный read-only юзер, привязанный к IP админа (пример: 192.168.11.100/32)
/user add name=netmap password=<длинный-пароль> group=read address=192.168.11.100/32

# 3. (RouterOS 7.13+) можно вместо пароля использовать API-token — легко отозвать:
/user/settings set allowed-authentication-types=plain,token
/user/token/add user=netmap
# Токен = пароль в этом диалоге.

# 4. Проверить логи входа:
/log print where topics~"account"`}
              </pre>
            </details>

            {error && (
              <div style={{
                margin: '10px 16px', padding: 12,
                background: '#FEE2E2', color: '#7F1D1D', fontSize: 12,
                border: '1px solid #FCA5A5', borderRadius: 6,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
                lineHeight: 1.5,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6,
                              fontWeight: 700, marginBottom: 6 }}>
                  <span>⚠</span> Не удалось подключиться
                </div>
                {error}
              </div>
            )}

            {scan?.resource.ok && (
              <div style={{ padding: '8px 16px', background: '#D1FAE5', color: '#065F46',
                            fontSize: 11, display: 'flex', gap: 10, alignItems: 'center',
                            flexWrap: 'wrap' }}>
                <span>✓ Подключено:</span>
                <b>{scan.resource.identity || scan.resource.boardName || 'router'}</b>
                {scan.resource.boardName && scan.resource.boardName !== 'unknown' && (
                  <span style={{ opacity: 0.7 }}>· {scan.resource.boardName}</span>
                )}
                {scan.resource.version && scan.resource.version !== 'unknown' && (
                  <span style={{ opacity: 0.7 }}>· RouterOS {scan.resource.version}</span>
                )}
                {scan.resource.uptime && (
                  <span style={{ opacity: 0.7 }}>· up {scan.resource.uptime}</span>
                )}
                <span style={{ marginLeft: 'auto' }}>
                  {scan.leases.length} DHCP · {scan.arp.length} ARP
                  {scan.vlans && scan.vlans.length > 0 ? ` · ${scan.vlans.length} VLAN` : ''}
                  {scan.addresses && scan.addresses.length > 0 ? ` · ${scan.addresses.length} сетей` : ''}
                  {' '}→ <b>{rows.length}</b> уникальных
                </span>
              </div>
            )}

            {/* VLAN import section — only shown when the router actually has VLANs configured */}
            {scan && scan.vlans && scan.vlans.length > 0 && (
              <VlanImportSection vlans={scan.vlans} />
            )}

            {/* v0.35.9 — Subnet picker. Shown when 2+ subnets are found so
                the user can uncheck subnets they don't want (e.g. guest wifi
                4-guest devices you don't want cluttering the schema). */}
            {scan && subnetStats.length >= 2 && (
              <SubnetPickerSection stats={subnetStats} excluded={excludedCidrs}
                                    onToggle={(cidr) => {
                                      setExcludedCidrs(prev => {
                                        const next = new Set(prev);
                                        if (next.has(cidr)) next.delete(cidr); else next.add(cidr);
                                        return next;
                                      });
                                    }}
                                    onAll={() => setExcludedCidrs(new Set())}
                                    onNone={() => setExcludedCidrs(new Set(subnetStats.map(s => s.cidr)))} />
            )}

            {scan && (
              <>
                <div style={{ padding: '8px 16px', display: 'flex', gap: 10, alignItems: 'center',
                              borderBottom: '1px solid #E5E7EB' }}>
                  <input value={q} onChange={e => setQ(e.target.value)}
                         placeholder="🔎 IP, MAC, hostname, vendor..."
                         style={{ ...inputStyle, flex: 1 }} />
                  <label style={checkLabel}>
                    <input type="checkbox" checked={showExisting} onChange={e => setShowExisting(e.target.checked)} />
                    <span>показать уже в схеме</span>
                  </label>
                  <label style={checkLabel}>
                    <input type="checkbox" checked={showIncomplete} onChange={e => setShowIncomplete(e.target.checked)} />
                    <span>показать без IP</span>
                  </label>
                  <button onClick={toggleAll} style={smallBtn}>
                    {filtered.length > 0 && filtered.every(r => selected.has(r.mac)) ? 'Снять всё' : 'Выбрать всё'}
                  </button>
                </div>

                {/* v0.38: bulk-action toolbar for conflict rows. Only shown
                    when the current filter contains rows that already exist
                    on the map — otherwise there's nothing to disambiguate. */}
                {filtered.some(r => r.existingId && selected.has(r.mac)) && (
                  <div style={{
                    padding: '6px 16px', display: 'flex', gap: 8, alignItems: 'center',
                    background: '#FFFBEB', borderBottom: '1px solid #FEF3C7',
                    fontSize: 11,
                  }}>
                    <span style={{ color: '#B45309', fontWeight: 600 }}>
                      ⚠ Найдено конфликтов: {filtered.filter(r => r.existingId && selected.has(r.mac)).length}
                    </span>
                    <span style={{ color: '#78350F', opacity: 0.75 }}>
                      По умолчанию — пропустить. Массово:
                    </span>
                    <button onClick={() => bulkSetAction('skip')} style={{ ...smallBtn, fontSize: 10 }}>
                      Пропустить все
                    </button>
                    <button onClick={() => bulkSetAction('update')} style={{ ...smallBtn, fontSize: 10 }}>
                      Обновить все (только пустые поля)
                    </button>
                    <button onClick={() => bulkSetAction('replace')} style={{ ...smallBtn, fontSize: 10, borderColor: '#F87171' }}>
                      Заменить все
                    </button>
                  </div>
                )}

                <div style={{ flex: 1, overflowY: 'auto', minHeight: 200 }}>
                  {filtered.length === 0 ? (
                    <EmptyResultDiagnostic
                      rowsTotal={rows.length}
                      scan={scan}
                      transport={transport}
                      buildCfg={() => ({
                        host: transport === 'ssh'
                          ? host.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '')
                          : host.trim(),
                        port: transport === 'ssh' ? sshPort : undefined,
                        transport,
                        username: username.trim(),
                        password: passwordRef.current,
                        insecure,
                      })}
                    />
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead style={{ position: 'sticky', top: 0, background: '#F9FAFB', zIndex: 1 }}>
                        <tr style={{ textAlign: 'left' }}>
                          <th style={th}></th>
                          <th style={th}>Тип</th>
                          <th style={th}>IP</th>
                          <th style={th}>MAC</th>
                          <th style={th}>Hostname</th>
                          <th style={th}>Vendor</th>
                          <th style={th}>Источник</th>
                          <th style={th}>Действие</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(r => {
                          const meta = KIND_META[r.suggestedKind];
                          const Icon = ICONS[r.suggestedKind];
                          const checked = selected.has(r.mac);
                          const rowBg = r.existingId ? 'rgba(251,191,36,0.08)' : (checked ? 'rgba(88,166,255,0.10)' : 'transparent');
                          return (
                            <tr key={r.mac}
                                onClick={() => {
                                  const s = new Set(selected);
                                  if (s.has(r.mac)) s.delete(r.mac); else s.add(r.mac);
                                  setSelected(s);
                                }}
                                style={{ cursor: 'pointer', background: rowBg, borderBottom: '1px solid #E5E7EB' }}>
                              <td style={td}><input type="checkbox" checked={checked} readOnly /></td>
                              <td style={td}>
                                <span style={{ color: meta.color, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <Icon size={14} />
                                  <span style={{ fontSize: 9, opacity: 0.7 }}>{meta.label}</span>
                                </span>
                              </td>
                              <td style={{ ...td, fontFamily: 'monospace' }}>{r.ip || '—'}</td>
                              <td style={{ ...td, fontFamily: 'monospace', opacity: 0.7 }}>{r.mac}</td>
                              <td style={td}>{r.hostname || <span style={{ opacity: 0.4 }}>—</span>}</td>
                              <td style={{ ...td, opacity: 0.7 }}>{r.vendor || <span style={{ opacity: 0.4 }}>?</span>}</td>
                              <td style={td}>
                                <span style={{
                                  fontSize: 9, padding: '1px 5px', borderRadius: 3,
                                  background: r.source === 'both' ? '#134e4a' : r.source === 'dhcp' ? '#DBEAFE' : '#FEF3C7',
                                  color: '#111827',
                                }}>{r.source}</span>
                              </td>
                              <td style={td} onClick={(e) => e.stopPropagation()}>
                                {r.existingId ? (
                                  // v0.38: per-row action selector for conflicts.
                                  // Default is 'skip' — no more silent updates.
                                  <select
                                    value={actions.get(r.mac) ?? 'skip'}
                                    onChange={(e) => {
                                      const next = new Map(actions);
                                      next.set(r.mac, e.target.value as ImportAction);
                                      setActions(next);
                                    }}
                                    style={{
                                      fontSize: 10, padding: '2px 4px',
                                      borderRadius: 4, border: '1px solid #FCD34D',
                                      background: (actions.get(r.mac) ?? 'skip') === 'skip' ? '#F3F4F6'
                                                : (actions.get(r.mac) === 'replace' ? '#FEE2E2' : '#FEF3C7'),
                                      color: '#111827',
                                    }}
                                    title="Что делать с этим устройством, которое уже есть на карте"
                                  >
                                    <option value="skip">пропустить</option>
                                    <option value="update">обновить пустые</option>
                                    <option value="replace">заменить всё</option>
                                  </select>
                                ) : (
                                  <span style={{
                                    fontSize: 9, color: '#059669', background: '#D1FAE5',
                                    padding: '1px 6px', borderRadius: 3,
                                  }}>добавить</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                <div style={{ padding: '10px 16px', borderTop: '1px solid #E5E7EB',
                              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {/* v0.38: honest counter — effective selection AND import preview */}
                  <span style={{ fontSize: 11, opacity: 0.75 }}>
                    Выделено: <b>{effectiveSelected.size}</b> из {filtered.length}
                    {selected.size > effectiveSelected.size && (
                      <span style={{ marginLeft: 6, color: '#B45309' }}
                            title="Отфильтровано подсетями/поиском">
                        ({selected.size - effectiveSelected.size} скрыто фильтром)
                      </span>
                    )}
                  </span>
                  {(importPreview.total + importPreview.toSkip) > 0 && (
                    <span style={{ fontSize: 11, display: 'inline-flex', gap: 8 }}>
                      {importPreview.toAdd > 0 && <span style={{ color: '#059669' }}>+{importPreview.toAdd} новых</span>}
                      {importPreview.toUpdate > 0 && <span style={{ color: '#B45309' }}>↻{importPreview.toUpdate} обновить</span>}
                      {importPreview.toReplace > 0 && <span style={{ color: '#DC2626' }}>⚡{importPreview.toReplace} заменить</span>}
                      {importPreview.toSkip > 0 && <span style={{ color: '#6B7280' }}>⊘{importPreview.toSkip} пропустить</span>}
                    </span>
                  )}
                  <div style={{ flex: 1 }} />
                  <button onClick={onClose} style={smallBtn}>Отмена</button>
                  <button onClick={doImport} disabled={importPreview.total === 0}
                          style={{ ...primaryBtn, opacity: importPreview.total === 0 ? 0.5 : 1 }}>
                    📥 Импортировать {importPreview.total}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// -----------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 3 }}>
      <span style={{ fontSize: 9, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#F9FAFB', border: '1px solid #D1D5DB', color: '#111827',
  padding: '6px 8px', borderRadius: 5, fontSize: 12, outline: 'none', width: '100%',
};
const primaryBtn: React.CSSProperties = {
  background: '#2563EB', border: '1px solid #2563EB', color: '#fff',
  padding: '7px 14px', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600,
};
const smallBtn: React.CSSProperties = {
  background: '#E5E7EB', border: '1px solid #D1D5DB', color: '#111827',
  padding: '5px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 11,
};
const closeBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid #D1D5DB', color: '#111827',
  padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 14, lineHeight: 1,
};
const checkLabel: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11,
};
const th: React.CSSProperties = {
  padding: '6px 10px', fontSize: 10, textTransform: 'uppercase',
  letterSpacing: 0.4, opacity: 0.6, fontWeight: 700, borderBottom: '1px solid #E5E7EB',
};
const td: React.CSSProperties = { padding: '6px 10px', fontSize: 11 };

// -----------------------------------------------------------------------------
// VlanImportSection — reads MikroTik VLANs (v0.19) and lets the user pick which
// ones to add to the current project's VLAN dictionary. Idempotent — VLANs that
// already exist with the same vlanId are skipped by default.

import type { MikrotikVlan } from './mikrotikClient';
import { vlanColorForIndex } from './vlanDefaults';

function VlanImportSection({ vlans }: { vlans: MikrotikVlan[] }) {
  const existingVlans = useStore(s => s.doc.vlans || []);
  const addVlanFn = useStore(s => s.addVlan);
  const [selected, setSelected] = useState<Set<number>>(() => {
    // Preselect only VLANs that aren't yet in the project
    const existing = new Set((useStore.getState().doc.vlans || []).map(v => v.vlanId));
    return new Set(vlans.filter(v => !existing.has(v.vlanId)).map(v => v.vlanId));
  });
  const [collapsed, setCollapsed] = useState(false);
  const [imported, setImported] = useState<number | null>(null);

  const existingIds = new Set(existingVlans.map(v => v.vlanId));
  const newCount = vlans.filter(v => !existingIds.has(v.vlanId)).length;

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const doImport = () => {
    const startColorIdx = existingVlans.length;
    let added = 0;
    for (const v of vlans) {
      if (!selected.has(v.vlanId)) continue;
      if (existingIds.has(v.vlanId)) continue;   // guard: skip duplicates
      addVlanFn({
        id: `vlan-mtk-${v.vlanId}-${Math.random().toString(36).slice(2, 5)}`,
        vlanId: v.vlanId,
        name: (v.name || v.comment || `VLAN${v.vlanId}`).toUpperCase().slice(0, 24),
        color: vlanColorForIndex(startColorIdx + added),
        description: [
          v.iface  ? `iface ${v.iface}` : null,
          v.bridge ? `bridge ${v.bridge}` : null,
          v.taggedPorts ? `tagged: ${v.taggedPorts}` : null,
          v.untaggedPorts ? `untagged: ${v.untaggedPorts}` : null,
          v.comment ? `// ${v.comment}` : null,
        ].filter(Boolean).join(' · '),
      });
      added++;
    }
    setImported(added);
    setTimeout(() => setImported(null), 3000);
  };

  return (
    <div style={{
      padding: '10px 16px', borderBottom: '1px solid #E5E7EB',
      background: '#F9FAFB',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
           onClick={() => setCollapsed(v => !v)}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B7280"
             strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
             style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
        <b style={{ fontSize: 12, color: '#111827' }}>
          VLAN'ы роутера ({vlans.length})
        </b>
        <span style={{ fontSize: 11, color: '#6B7280', marginLeft: 4 }}>
          {newCount > 0 ? `${newCount} новых` : 'все уже в проекте'}
        </span>
        {imported != null && (
          <span style={{
            marginLeft: 'auto',
            background: '#D1FAE5', color: '#065F46',
            padding: '2px 8px', borderRadius: 999,
            fontSize: 10, fontWeight: 700,
          }}>
            добавлено {imported}
          </span>
        )}
      </div>

      {!collapsed && (
        <>
          <div style={{
            marginTop: 8,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 4, maxHeight: 180, overflowY: 'auto',
          }}>
            {vlans.map(v => {
              const isExisting = existingIds.has(v.vlanId);
              const isSelected = selected.has(v.vlanId);
              return (
                <label key={v.vlanId} title={[
                  v.name, v.iface && `iface ${v.iface}`, v.bridge && `bridge ${v.bridge}`,
                  v.comment, v.taggedPorts && `T: ${v.taggedPorts}`,
                ].filter(Boolean).join(' · ')}
                       style={{
                         display: 'flex', alignItems: 'center', gap: 6,
                         padding: '5px 8px', borderRadius: 4,
                         background: isSelected ? '#EFF6FF' : '#FFFFFF',
                         border: `1px solid ${isSelected ? '#93C5FD' : '#E5E7EB'}`,
                         cursor: isExisting ? 'not-allowed' : 'pointer',
                         opacity: isExisting ? 0.5 : 1,
                         fontSize: 11,
                       }}>
                  <input type="checkbox"
                         checked={isSelected}
                         disabled={isExisting}
                         onChange={() => toggle(v.vlanId)}
                         style={{ margin: 0 }} />
                  <span style={{
                    fontFamily: 'ui-monospace, monospace', fontWeight: 700,
                    minWidth: 30, textAlign: 'right',
                  }}>{v.vlanId}</span>
                  <span style={{
                    flex: 1, minWidth: 0,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    color: '#374151',
                  }}>
                    {v.name || v.comment || `VLAN${v.vlanId}`}
                  </span>
                  {isExisting && (
                    <span style={{ fontSize: 9, color: '#9CA3AF' }}>уже есть</span>
                  )}
                </label>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button onClick={() => setSelected(new Set(vlans.filter(v => !existingIds.has(v.vlanId)).map(v => v.vlanId)))}
                    style={{ ...smallBtn, fontSize: 10 }}>
              Выделить все новые
            </button>
            <button onClick={() => setSelected(new Set())}
                    style={{ ...smallBtn, fontSize: 10 }}>
              Снять выделение
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={doImport}
                    disabled={selected.size === 0}
                    style={{
                      ...primaryBtn, fontSize: 11, padding: '5px 12px',
                      opacity: selected.size === 0 ? 0.5 : 1,
                      cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
                    }}>
              Импортировать {selected.size} VLAN в проект
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// v0.35.9 — Transport selector radio buttons
// ============================================================================
function TransportRadio({ value, onChange, option, label, hint }: {
  value: 'ssh' | 'rest';
  onChange: (v: 'ssh' | 'rest') => void;
  option: 'ssh' | 'rest';
  label: string; hint: string;
}) {
  const active = value === option;
  return (
    <button
      onClick={() => onChange(option)}
      title={hint}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 6,
        background: active ? '#EFF6FF' : '#FFFFFF',
        border: `1px solid ${active ? '#2563EB' : '#D1D5DB'}`,
        color: active ? '#1D4ED8' : '#374151',
        fontSize: 11, fontWeight: active ? 600 : 500,
        cursor: 'pointer',
      }}>
      <span style={{
        width: 12, height: 12, borderRadius: '50%',
        border: `2px solid ${active ? '#2563EB' : '#9CA3AF'}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {active && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563EB' }} />}
      </span>
      {label}
    </button>
  );
}

// ============================================================================
// v0.35.9 — Subnet picker section (shown between VLAN import and device table)
// ============================================================================
function SubnetPickerSection({ stats, excluded, onToggle, onAll, onNone }: {
  stats: SubnetStat[];
  excluded: Set<string>;
  onToggle: (cidr: string) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  const kept = stats.filter(s => !excluded.has(s.cidr));
  const keptDevices = kept.reduce((sum, s) => sum + s.deviceCount, 0);
  const totalDevices = stats.reduce((sum, s) => sum + s.deviceCount, 0);

  return (
    <div style={{
      padding: '10px 16px', borderBottom: '1px solid #E5E7EB',
      background: '#F9FAFB',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#374151',
                       textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Подсети · {kept.length} / {stats.length}
        </span>
        <span style={{ fontSize: 10, color: '#6B7280' }}>
          устройств в отфильтрованных: {keptDevices} из {totalDevices}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={onAll} style={{ ...smallBtn, fontSize: 10 }}>Оставить все</button>
        <button onClick={onNone} style={{ ...smallBtn, fontSize: 10 }}>Убрать все</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {stats.map(s => {
          const on = !excluded.has(s.cidr);
          return (
            <button key={s.cidr}
                    onClick={() => onToggle(s.cidr)}
                    title={[
                      s.fromRouter ? '📡 объявлена на роутере' : '🔎 определена из IP-адресов устройств',
                      s.interfaces?.length ? `Интерфейсы: ${s.interfaces.join(', ')}` : '',
                      s.comment ? `Комментарий: ${s.comment}` : '',
                    ].filter(Boolean).join('\n')}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '4px 10px', borderRadius: 20,
                      background: on ? '#DBEAFE' : '#F3F4F6',
                      border: `1px solid ${on ? '#93C5FD' : '#D1D5DB'}`,
                      color: on ? '#1E40AF' : '#9CA3AF',
                      fontSize: 11, fontWeight: 500,
                      cursor: 'pointer',
                      textDecoration: on ? 'none' : 'line-through',
                    }}>
              <span style={{ fontFamily: 'ui-monospace, monospace' }}>{s.cidr}</span>
              <span style={{
                padding: '1px 6px', borderRadius: 8,
                background: on ? '#2563EB' : '#9CA3AF',
                color: '#FFFFFF', fontSize: 9, fontWeight: 700,
                minWidth: 18, textAlign: 'center',
              }}>{s.deviceCount}</span>
              {s.fromRouter && (
                <span title="Из /ip address"
                      style={{ fontSize: 9, color: on ? '#059669' : '#9CA3AF' }}>📡</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// v0.35.9 — Friendly error messages for common connection failures.
// The raw Node errors ("ECONNREFUSED", "ETIMEDOUT", "Handshake failed") are
// useless to a sysadmin diagnosing a router — give them a clear next step.
// ============================================================================
function explainConnectionError(e: any, transport: 'ssh' | 'rest', host: string, port: number): string {
  const raw = String(e?.message || e?.code || e || '');
  const info = raw.trim();
  const target = `${host}${transport === 'ssh' && port !== 22 ? ':' + port : ''}`;

  if (/ECONNREFUSED/i.test(info)) {
    return transport === 'rest'
      ? `Порт закрыт: ${target}\n\nREST API (${host}:80 или :443) отключён или заблокирован. Варианты:\n\n1. Переключитесь на «SSH (CLI)» вверху диалога — работает даже когда web выключен.\n\n2. Или включите REST на роутере:\n   /ip service enable www\n   /ip service enable www-ssl\n   /user group set read policy=+api,+rest-api`
      : `SSH-порт закрыт: ${target}\n\nПроверьте:\n  • SSH включён:  /ip service enable ssh\n  • Порт правильный:  /ip service print  (стандарт 22)\n  • Firewall не блокирует SSH из вашей сети\n  • Address list в /ip service не ограничивает доступ`;
  }
  if (/ETIMEDOUT|ETIMEOUT|timeout/i.test(info)) {
    return `Таймаут при подключении к ${target}.\n\nВозможно:\n  • Роутер недоступен из вашей сети (маршрутизация, VPN)\n  • Firewall дропит пакеты (не отвечает — сессия висит)\n  • Неверный IP или роутер выключен`;
  }
  if (/EHOSTUNREACH|ENETUNREACH/i.test(info)) {
    return `Нет маршрута до ${target}.\n\nПроверьте:\n  • Ваш компьютер в той же сети, что и роутер\n  • VPN / маршруты  (ping ${host} из cmd)`;
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(info)) {
    return `Не удалось разрешить имя «${host}» в IP.\n\nПопробуйте указать IP напрямую (например 192.168.11.1).`;
  }
  if (/authentication|password|permission denied|invalid password|login failed|denied/i.test(info)) {
    return `Неверный логин или пароль.\n\nПроверьте учётку в /user print. Для SSH пользователю нужна политика ssh (плюс read для чтения таблиц).`;
  }
  if (/Unsupported algorithm:\s*(\S+)/i.test(info)) {
    const m = /Unsupported algorithm:\s*(\S+)/i.exec(info)!;
    return `Внутренняя проблема в клиенте: алгоритм «${m[1]}» не поддерживается сборкой ssh2 в этой версии Electron.\n\n` +
           `Это баг NetMap — теоретически исправлен авто-fallback'ом. Если видите это сообщение — обновите NetMap до 0.35.12+.`;
  }
  if (/no matching key exchange|no matching kex/i.test(info)) {
    return `SSH handshake: роутер и клиент не смогли договориться об алгоритме обмена ключами.\n\n` +
           `Возможные причины:\n\n` +
           `1. На роутере включён "strong-crypto=yes", а он старый и не имеет современных алгоритмов. Проверьте:\n` +
           `   /ip ssh print\n\n` +
           `   Если "strong-crypto=yes" — временно поставьте "no":\n` +
           `   /ip ssh set strong-crypto=no\n\n` +
           `2. Клиент запретил legacy алгоритмы. NetMap уже поддерживает group1-sha1 и group14-sha1 — если это не помогло, пришлите разработчику вывод\n` +
           `   /ip ssh print detail\n` +
           `   и мы подкрутим набор.`;
  }
  if (/no matching (server host key|cipher|hmac|mac)/i.test(info)) {
    return 'SSH handshake: сервер и клиент не смогли договориться об алгоритме шифрования / MAC / host-key.\n\n' +
           'Проверьте вывод:\n  /ip ssh print\n\nЕсли "strong-crypto=yes" — попробуйте временно "no". Иначе пришлите разработчику\n  /ip ssh print detail\nдля добавления недостающего алгоритма.';
  }
  if (/handshake|host key|kex|algorithm/i.test(info)) {
    return `SSH handshake не прошёл: ${info}\n\nВозможно очень старый RouterOS с legacy-crypto. Попробуйте:\n  /ip ssh set strong-crypto=no\n\nЛибо используйте REST-транспорт (если /ip service www включён).`;
  }
  if (transport === 'rest' && /certificate|self.signed|self signed|CERT_/i.test(info)) {
    return `Ошибка HTTPS-сертификата.\n\nВключите чекбокс «разрешить самоподписанный HTTPS» и попробуйте снова.`;
  }
  return `${info}\n\n(Транспорт: ${transport}, адрес: ${target})`;
}

// ============================================================================
// v0.35.10 — "Empty result" panel with raw-debug button.
//
// Displayed instead of "Ничего не найдено" when the scan succeeded but
// filtered rows are empty. It explains the most common causes and offers
// a one-click way to fetch the RAW output of each RouterOS command so the
// user (or dev) can see exactly what came back and why the parser dropped
// everything.
// ============================================================================
function EmptyResultDiagnostic({ rowsTotal, scan, transport, buildCfg }: {
  rowsTotal: number;
  scan: ScanResult;
  transport: 'ssh' | 'rest';
  buildCfg: () => MikrotikConfig;
}) {
  const [raw, setRaw] = useState<DebugRawResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setErr(null); setRaw(null);
    try { setRaw(await debugMikrotik(buildCfg())); }
    catch (e: any) { setErr(e?.message || String(e)); }
    finally { setLoading(false); }
  };

  // Reason inference
  const reasons: string[] = [];
  if (rowsTotal === 0) {
    if (scan.leases.length === 0) reasons.push('DHCP leases: пусто (нет DHCP-сервера, либо у пользователя нет прав на /ip/dhcp-server)');
    if (scan.arp.length === 0)    reasons.push('ARP таблица: пусто (либо ещё ничего не запрашивало роутер, либо нет прав на /ip/arp)');
    if (scan.leases.length === 0 && scan.arp.length === 0) {
      reasons.push('Скорее всего у пользователя нет политики read (или на MikroTik просто нет активных клиентов).');
    }
  } else {
    reasons.push(`Всего строк: ${rowsTotal}. Возможно всё отфильтровано выборкой подсетей или чекбоксом «показать без IP».`);
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{
        padding: 12, background: '#FFFBEB', border: '1px solid #FDE68A',
        borderRadius: 8, fontSize: 12, color: '#78350F',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 6 }}>
          <span>⚠</span> Список пуст
        </div>
        <div style={{ marginBottom: 8 }}>
          Подключение к роутеру прошло, но данных не пришло или парсер их отбросил.
        </div>
        <ul style={{ margin: '4px 0 8px 18px', padding: 0, lineHeight: 1.6 }}>
          {reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div style={{ fontSize: 11, opacity: 0.85 }}>
          Проверьте на MikroTik политику пользователя:<br/>
          <code style={{ background: '#F3F4F6', padding: '1px 5px', borderRadius: 3, color: '#111827',
                          fontFamily: 'ui-monospace, monospace' }}>
            /user group set read policy=read,ssh,api,rest-api,winbox
          </code>
        </div>
      </div>

      {transport === 'ssh' && (
        <div style={{ marginTop: 12 }}>
          <button onClick={run} disabled={loading} style={{
            ...primaryBtn, opacity: loading ? 0.5 : 1, cursor: loading ? 'wait' : 'pointer',
          }}>
            {loading ? 'Читаю…' : '🐞 Показать сырой ответ роутера'}
          </button>
          <div style={{ fontSize: 10, color: '#6B7280', marginTop: 4 }}>
            Выполнит команды напрямую по SSH и покажет что вернул MikroTik.
            Скопируйте вывод и пришлите разработчику, если что-то выглядит странно.
          </div>
        </div>
      )}

      {err && (
        <div style={{
          marginTop: 12, padding: 10, background: '#FEE2E2', border: '1px solid #FCA5A5',
          borderRadius: 6, color: '#B91C1C', fontSize: 12, whiteSpace: 'pre-wrap',
        }}>{err}</div>
      )}

      {raw && (
        <div style={{
          marginTop: 12, background: '#F9FAFB', border: '1px solid #E5E7EB',
          borderRadius: 8, padding: 10, maxHeight: 500, overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <b style={{ fontSize: 12, color: '#111827' }}>Сырой ответ роутера</b>
            <button onClick={() => {
              const text = Object.entries(raw).map(([cmd, r]) =>
                `\n=== ${cmd} ===\n${r.ok ? r.out : '[ошибка] ' + r.error}`).join('\n');
              try { navigator.clipboard.writeText(text); } catch {}
            }} style={{ ...smallBtn, marginLeft: 'auto', fontSize: 10 }}>📋 Скопировать всё</button>
          </div>
          {Object.entries(raw).map(([cmd, r]) => (
            <details key={cmd} style={{ marginBottom: 6 }}>
              <summary style={{
                cursor: 'pointer', fontSize: 11, fontFamily: 'ui-monospace, monospace',
                color: r.ok ? '#0F172A' : '#B91C1C', padding: '2px 0',
              }}>
                {r.ok ? '✓' : '✗'} {cmd} {r.ok ? `(${r.out.length} байт)` : ''}
              </summary>
              <pre style={{
                margin: '4px 0 0', padding: 8, background: '#111827', color: '#F9FAFB',
                borderRadius: 4, fontSize: 10.5, lineHeight: 1.4,
                fontFamily: 'ui-monospace, monospace',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                maxHeight: 200, overflow: 'auto',
              }}>{r.ok ? (r.out.trim() || '(пусто)') : r.error}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
