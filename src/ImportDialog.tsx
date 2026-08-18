/**
 * v0.37 — Unified per-vendor Import dialog.
 *
 * Vendor selector at the top, dynamic form below (fields declared in
 * importClient.VENDORS). "Test" → identity/version. "Scan" → preview table
 * + subnet picker (reused from MikroTik dialog logic). "Import" → creates
 * subnet-based groups and adds devices via importUtils.commitImport().
 *
 * MikroTik entry in the dropdown redirects the user to the legacy
 * MikrotikImportDialog (open via netmap:open-mikrotik-import event) — its
 * SSH transport and raw-debug button warrant a dedicated screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from './store';
import {
  VENDORS, vendorMeta, testImport, scanImport,
  type ImportVendor, type ImportConfig, type TestResult,
} from './importClient';
import { MiniSpinner, ProgressStripe, btnBusy } from './Spinner';
import {
  summarizeSubnets, ipInAnyCidr,
  type ScanResult, type SubnetStat,
} from './mikrotikClient';
import {
  buildRows, filterRows, commitImport, defaultAction,
  type ImportRow, type ImportAction,
} from './importUtils';
import { ICONS, KIND_META } from './icons';
import { alertDialog } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Optional preselected vendor — allows AppMenu items to jump straight to a vendor. */
  initialVendor?: ImportVendor;
}

const LS_LAST_VENDOR = 'netmap:import:last-vendor';

// v0.44.1: one-time cleanup — users of v0.43.x may have 'mikrotik' stuck
// in LS, which caused sidebar "Импорт" to instantly close.
try {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(LS_LAST_VENDOR) === 'mikrotik') {
    localStorage.removeItem(LS_LAST_VENDOR);
  }
} catch { /* ignore */ }
const LS_CFG_PREFIX = 'netmap:import:cfg:';   // per-vendor last config (never password)

export function ImportDialog({ open, onClose, initialVendor }: Props) {
  const doc = useStore(s => s.doc);

  // v0.44.2 — full rewrite of vendor selection to fix the "sidebar Import
  // button becomes dead after picking MikroTik" bug. Root cause: previous
  // versions rendered `null` when vendor==='mikrotik' but kept `open===true`
  // in the parent, so subsequent clicks on the sidebar Import button had no
  // effect (React short-circuits identical state).
  //
  // New flow:
  //   - Sidebar/menu click → open ImportDialog with initialVendor optional
  //   - If initialVendor='mikrotik' → immediately delegate to MT dialog + close (via layout effect)
  //   - Otherwise show picker grid; picking MikroTik ALSO delegates + closes
  //   - Picker phase and form phase are explicit states (no null-return trick)

  const [vendor, setVendor] = useState<ImportVendor>(() => {
    if (initialVendor && initialVendor !== 'mikrotik') return initialVendor;
    try {
      const v = localStorage.getItem(LS_LAST_VENDOR);
      if (v && v !== 'mikrotik' && VENDORS.find(x => x.id === v)) return v as ImportVendor;
    } catch { /* ignore */ }
    return 'unifi';
  });

  // Sync vendor if caller passes an explicit choice while dialog is opening.
  useEffect(() => {
    if (open && initialVendor && initialVendor !== 'mikrotik' && initialVendor !== vendor) {
      setVendor(initialVendor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialVendor]);

  // Handle the "MikroTik path" — delegate to legacy dialog and close ourselves.
  // Guard `didRedirect` ensures we only fire once per open cycle, and we call
  // onClose() synchronously in the same tick so parent's `importOpen` becomes
  // false BEFORE user can click sidebar again.
  const didRedirect = useRef(false);
  useEffect(() => {
    if (!open) { didRedirect.current = false; return; }
    if (initialVendor === 'mikrotik' && !didRedirect.current) {
      didRedirect.current = true;
      window.dispatchEvent(new CustomEvent('netmap:open-mikrotik-import'));
      onClose();
    }
  }, [open, initialVendor, onClose]);

  // Picker action: user clicked a vendor tile. MikroTik → redirect. Others → switch form.
  const pickVendor = useCallback((id: ImportVendor) => {
    if (id === 'mikrotik') {
      window.dispatchEvent(new CustomEvent('netmap:open-mikrotik-import'));
      onClose();
      return;
    }
    setVendor(id);
  }, [onClose]);

  const meta = vendorMeta(vendor);

  // Per-vendor form state ---------------------------------------------------
  const [config, setConfig] = useState<ImportConfig>(() => ({ ...meta.defaults }));
  // Password is kept in a ref so it never persists to LS.
  const passwordRef = useRef<string>('');
  const [pwLength, setPwLength] = useState(0);

  useEffect(() => {
    // Reset form to defaults + LS-loaded values when vendor changes.
    const nextMeta = vendorMeta(vendor);
    let loaded: Partial<ImportConfig> = {};
    try {
      const raw = localStorage.getItem(LS_CFG_PREFIX + vendor);
      if (raw) loaded = JSON.parse(raw);
    } catch { /* ignore */ }
    setConfig({ ...nextMeta.defaults, ...loaded });
    passwordRef.current = '';
    setPwLength(0);
    setTest(null);
    setError('');
    setScan(null);
    setSelected(new Set());
    setExcludedCidrs(new Set());
  }, [vendor]);

  // Test / Scan state -------------------------------------------------------
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [error, setError] = useState('');

  // Table / filter state ----------------------------------------------------
  const [q, setQ] = useState('');
  const [showExisting, setShowExisting] = useState(true);
  const [showIncomplete, setShowIncomplete] = useState(false);
  const [excludedCidrs, setExcludedCidrs] = useState<Set<string>>(new Set());
  const subnetStats: SubnetStat[] = useMemo(() => scan ? summarizeSubnets(scan) : [], [scan]);
  const activeCidrs = useMemo(
    () => subnetStats.filter(s => !excludedCidrs.has(s.cidr)).map(s => s.cidr),
    [subnetStats, excludedCidrs]
  );

  const rows: ImportRow[] = useMemo(() => buildRows(scan, doc), [scan, doc]);
  const filtered = useMemo(
    () => filterRows(rows, { query: q, activeCidrs, showExisting, showIncomplete }),
    [rows, q, activeCidrs, showExisting, showIncomplete]
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** v0.38: per-row action override (add / skip / update / replace).
   *  Rows not present fall back to defaultAction(row). */
  const [actions, setActions] = useState<Map<string, ImportAction>>(() => new Map());

  const toggleAll = () => {
    const allVisible = filtered.length > 0 && filtered.every(r => selected.has(r.mac));
    const next = new Set(selected);
    if (allVisible) for (const r of filtered) next.delete(r.mac);
    else for (const r of filtered) next.add(r.mac);
    setSelected(next);
  };

  const bulkSetAction = (a: ImportAction) => {
    const next = new Map(actions);
    for (const r of filtered) {
      if (!selected.has(r.mac)) continue;
      if (!r.existingId) continue;
      next.set(r.mac, a);
    }
    setActions(next);
  };

  /** Effective selection = intersection with filtered rows (respects subnet
   *  exclusions, hide-existing checkbox, search query). */
  const filteredMacs = useMemo(() => new Set(filtered.map(r => r.mac)), [filtered]);
  const effectiveSelected = useMemo(
    () => new Set(Array.from(selected).filter(mac => filteredMacs.has(mac))),
    [selected, filteredMacs]
  );

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

  const [importing, setImporting] = useState(false);

  // Config field helpers ----------------------------------------------------
  const setField = (key: keyof ImportConfig, value: any) => {
    setConfig(c => ({ ...c, [key]: value }));
  };
  const persistConfig = (cfg: ImportConfig) => {
    // Never persist password.
    const clean = { ...cfg };
    delete clean.password;
    try { localStorage.setItem(LS_CFG_PREFIX + vendor, JSON.stringify(clean)); } catch { /* ignore */ }
    // v0.44.1: never save 'mikrotik' as "last vendor" — it would cause the
    // dialog to auto-close on next open. MikroTik always goes through its
    // dedicated legacy dialog anyway.
    if (vendor !== 'mikrotik') {
      try { localStorage.setItem(LS_LAST_VENDOR, vendor); } catch { /* ignore */ }
    }
  };

  // Actions -----------------------------------------------------------------
  const doTest = async () => {
    setError('');
    setTest(null);
    setTesting(true);
    const cfg: ImportConfig = { ...config, password: passwordRef.current };
    persistConfig(config);
    try {
      window.dispatchEvent(new CustomEvent('netmap:progress-start', {
        detail: { id: 'import-test', title: 'Проверка соединения', message: meta.label },
      }));
      const res = await testImport(vendor, cfg);
      setTest(res);
      if (!res.ok) setError(res.error || 'Тест не прошёл');
    } catch (e: any) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setTesting(false);
      window.dispatchEvent(new CustomEvent('netmap:progress-end', { detail: { id: 'import-test' } }));
    }
  };

  const doScan = async () => {
    setError('');
    setScan(null);
    setSelected(new Set());
    setExcludedCidrs(new Set());
    setScanning(true);
    const cfg: ImportConfig = { ...config, password: passwordRef.current };
    persistConfig(config);
    try {
      window.dispatchEvent(new CustomEvent('netmap:progress-start', {
        detail: { id: 'import-scan', title: 'Загрузка данных', message: meta.label },
      }));
      const res = await scanImport(vendor, cfg);
      setScan(res);
      if (res.resource && !res.resource.ok) setError(res.resource.error || 'Сканирование не удалось');
    } catch (e: any) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setScanning(false);
      window.dispatchEvent(new CustomEvent('netmap:progress-end', { detail: { id: 'import-scan' } }));
    }
  };

  const doImport = async () => {
    if (!scan || importPreview.total === 0) return;
    setImporting(true);
    try {
      const rowsToImport = filtered.filter(r => effectiveSelected.has(r.mac));
      const result = commitImport(scan, rowsToImport, vendor, actions);
      useStore.getState().pushAlert({
        severity: 'success', origin: 'import',
        title: `Импорт ${meta.label} завершён`,
        message: [
          result.placed > 0 ? `Добавлено: ${result.placed}` : null,
          result.updated > 0 ? `Обновлено: ${result.updated}` : null,
          result.replaced > 0 ? `Заменено: ${result.replaced}` : null,
          result.skipped > 0 ? `Пропущено: ${result.skipped}` : null,
          result.groupCount > 1 ? `Разложено по ${result.groupCount} подсетям` : null,
        ].filter(Boolean).join(' · ') || 'Без изменений',
      });
      await alertDialog(
        'Импорт завершён',
        [
          result.placed > 0 ? `Добавлено: ${result.placed}` : null,
          result.updated > 0 ? `Обновлено: ${result.updated}` : null,
          result.replaced > 0 ? `Заменено: ${result.replaced}` : null,
          result.skipped > 0 ? `Пропущено: ${result.skipped}` : null,
          result.placed === 0 && result.updated === 0 && result.replaced === 0
            ? 'Ничего не изменилось.' : null,
        ].filter(Boolean).join('\n')
      );
      onClose();
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;
  // v0.44.2: NEVER return null when vendor==='mikrotik' — that leaves parent
  // state.importOpen === true and the sidebar button becomes unresponsive.
  // MikroTik redirect is handled by useEffect above (calls onClose()).

  const busy = testing || scanning || importing;

  // ---- Render ----
  return createPortal(
    <div style={backdrop}>
      <div style={dialog}>
        <div style={header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={headerIconBadge}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Импорт с оборудования</div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                Единый диалог. Данные добавляются в текущий проект, группировка по подсетям.
              </div>
            </div>
          </div>
          <button style={closeBtn} onClick={onClose} disabled={busy}>✕</button>
        </div>

        {/* v0.44.2 — Vendor picker: grid of tiles instead of a <select>. */}
        <div style={{ padding: '14px 16px 6px 16px', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B', letterSpacing: 0.6, textTransform: 'uppercase' }}>Вендор</div>
            <div style={{ fontSize: 10, color: '#94A3B8' }}>MikroTik → откроется отдельный диалог с SSH-опциями</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
            {VENDORS.map(v => {
              const active = v.id === vendor;
              const isMt = v.id === 'mikrotik';
              const planned = v.status === 'planned';
              return (
                <button
                  key={v.id}
                  onClick={() => pickVendor(v.id)}
                  disabled={busy || planned}
                  style={{
                    ...vendorTile,
                    ...(active ? vendorTileActive : {}),
                    ...(planned ? vendorTileDisabled : {}),
                  }}
                  title={planned ? 'Планируется в будущих версиях' : v.label}
                >
                  <div style={{ ...vendorTileDot, background: vendorColor(v.id) }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.label}
                    </div>
                    {planned && <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 2 }}>Планируется</div>}
                    {isMt && !planned && <div style={{ fontSize: 9, color: '#64748B', marginTop: 2 }}>SSH-диалог →</div>}
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: '#64748B' }}>{meta.description}</div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16 }}>
          {/* Config form */}
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr', marginBottom: 12 }}>
            {meta.fields.map((f) => (
              <Field key={String(f.key)} label={f.label} hint={f.hint}>
                {f.type === 'checkbox' ? (
                  <label style={checkLabel}>
                    <input
                      type="checkbox"
                      checked={!!config[f.key]}
                      onChange={(e) => setField(f.key, e.target.checked)}
                    />
                    <span style={{ fontSize: 12, color: '#334155' }}>{f.hint || 'Включить'}</span>
                  </label>
                ) : f.type === 'password' ? (
                  <input
                    type="password"
                    placeholder={f.placeholder}
                    style={inputStyle}
                    onChange={(e) => { passwordRef.current = e.target.value; setPwLength(e.target.value.length); }}
                  />
                ) : (
                  <input
                    type={f.type}
                    placeholder={f.placeholder}
                    value={(config[f.key] as any) ?? ''}
                    onChange={(e) => {
                      const v = f.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value;
                      setField(f.key, v);
                    }}
                    style={inputStyle}
                  />
                )}
              </Field>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={{ ...smallBtn, ...(testing ? btnBusy : {}) }}
                    onClick={doTest} disabled={testing || meta.status !== 'ready'}>
              {testing && <MiniSpinner />} {testing ? 'Проверка…' : 'Проверить'}
            </button>
            <button style={{ ...primaryBtn, ...(scanning ? btnBusy : {}) }}
                    onClick={doScan} disabled={scanning || meta.status !== 'ready'}>
              {scanning && <MiniSpinner light />} {scanning ? 'Сканирование…' : 'Сканировать'}
            </button>
            {scanning && (
              <div style={{ fontSize: 11, color: '#64748B', display: 'flex', alignItems: 'center', gap: 8, marginLeft: 4 }}>
                <ProgressStripe />
                <span>Опрашиваем контроллер…</span>
              </div>
            )}
            {pwLength > 0 && <span style={{ fontSize: 11, color: '#64748B', alignSelf: 'center' }}>
              Пароль: {'•'.repeat(Math.min(pwLength, 10))}
            </span>}
            {meta.status === 'planned' && (
              <span style={{ fontSize: 11, color: '#B45309', alignSelf: 'center', background: '#FEF3C7', padding: '4px 8px', borderRadius: 6 }}>
                ⚠ Модуль в разработке — доступен в v0.38
              </span>
            )}
          </div>

          {/* Test result banner */}
          {test && (
            <div style={{
              marginBottom: 12, padding: '10px 12px', borderRadius: 8,
              background: test.ok ? '#ECFDF5' : '#FEF2F2',
              border: `1px solid ${test.ok ? '#A7F3D0' : '#FECACA'}`,
              fontSize: 12, color: test.ok ? '#065F46' : '#991B1B',
            }}>
              {test.ok ? (
                <>
                  <b>✓ Подключение работает.</b> {test.identity}{test.version ? ` · ${test.version}` : ''}
                  {test.sites && test.sites.length > 0 && (
                    <div style={{ marginTop: 4, fontSize: 11 }}>
                      Sites: {test.sites.map(s => s.name).join(', ')}
                    </div>
                  )}
                  {test.orgs && test.orgs.length > 0 && (
                    <div style={{ marginTop: 4, fontSize: 11 }}>
                      Organizations: {test.orgs.map(o => o.name).join(', ')}
                    </div>
                  )}
                </>
              ) : (
                <><b>✗ Ошибка:</b> {test.error}</>
              )}
            </div>
          )}

          {error && !test && (
            <div style={{
              marginBottom: 12, padding: '10px 12px', borderRadius: 8,
              background: '#FEF2F2', border: '1px solid #FECACA',
              fontSize: 12, color: '#991B1B',
            }}>
              <b>Ошибка:</b> {error}
            </div>
          )}

          {/* Subnet picker */}
          {scan && subnetStats.length >= 2 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#475569', marginBottom: 6, fontWeight: 600 }}>
                Подсети ({subnetStats.length}) — клик снимает/включает
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {subnetStats.map(s => {
                  const excluded = excludedCidrs.has(s.cidr);
                  return (
                    <button
                      key={s.cidr}
                      onClick={() => {
                        setExcludedCidrs(prev => {
                          const next = new Set(prev);
                          if (next.has(s.cidr)) next.delete(s.cidr); else next.add(s.cidr);
                          return next;
                        });
                      }}
                      style={{
                        fontSize: 11, padding: '4px 10px', borderRadius: 999,
                        border: '1px solid ' + (excluded ? '#CBD5E1' : '#3B82F6'),
                        background: excluded ? '#F1F5F9' : '#DBEAFE',
                        color: excluded ? '#64748B' : '#1E40AF',
                        opacity: excluded ? 0.6 : 1,
                        cursor: 'pointer',
                      }}
                    >
                      {s.fromRouter ? '📡 ' : ''}{s.cidr} · {s.deviceCount}
                    </button>
                  );
                })}
                <button style={{ ...smallBtn, fontSize: 11 }} onClick={() => setExcludedCidrs(new Set())}>Все</button>
                <button style={{ ...smallBtn, fontSize: 11 }} onClick={() => setExcludedCidrs(new Set(subnetStats.map(s => s.cidr)))}>Ни одной</button>
              </div>
            </div>
          )}

          {/* Preview table */}
          {scan && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <input
                  placeholder="Поиск по MAC / IP / hostname / vendor"
                  value={q} onChange={(e) => setQ(e.target.value)}
                  style={{ ...inputStyle, flex: 1, minWidth: 180 }}
                />
                <label style={checkLabel}>
                  <input type="checkbox" checked={showExisting} onChange={(e) => setShowExisting(e.target.checked)} />
                  <span style={{ fontSize: 11 }}>Показывать уже добавленные</span>
                </label>
                <label style={checkLabel}>
                  <input type="checkbox" checked={showIncomplete} onChange={(e) => setShowIncomplete(e.target.checked)} />
                  <span style={{ fontSize: 11 }}>Показывать без IP</span>
                </label>
              </div>

              {/* v0.38: bulk-action toolbar for conflicts */}
              {filtered.some(r => r.existingId && selected.has(r.mac)) && (
                <div style={{
                  padding: '6px 10px', display: 'flex', gap: 8, alignItems: 'center',
                  background: '#FFFBEB', border: '1px solid #FEF3C7',
                  borderRadius: 8, marginBottom: 8, fontSize: 11,
                }}>
                  <span style={{ color: '#B45309', fontWeight: 600 }}>
                    ⚠ Найдено конфликтов: {filtered.filter(r => r.existingId && selected.has(r.mac)).length}
                  </span>
                  <span style={{ color: '#78350F', opacity: 0.75 }}>По умолчанию — пропустить. Массово:</span>
                  <button onClick={() => bulkSetAction('skip')} style={{ ...smallBtn, fontSize: 10 }}>Пропустить все</button>
                  <button onClick={() => bulkSetAction('update')} style={{ ...smallBtn, fontSize: 10 }}>Обновить пустые</button>
                  <button onClick={() => bulkSetAction('replace')} style={{ ...smallBtn, fontSize: 10, borderColor: '#F87171' }}>Заменить все</button>
                </div>
              )}

              <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC' }}>
                      <th style={th}>
                        <input
                          type="checkbox"
                          checked={filtered.length > 0 && filtered.every(r => selected.has(r.mac))}
                          onChange={toggleAll}
                        />
                      </th>
                      <th style={th}>Тип</th>
                      <th style={th}>Hostname</th>
                      <th style={th}>IP</th>
                      <th style={th}>MAC</th>
                      <th style={th}>Vendor</th>
                      <th style={th}>Источник</th>
                      <th style={th}>Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>
                        {rows.length === 0 ? 'Нет данных — сначала выполните «Сканировать»' : 'Ничего не подходит под фильтр'}
                      </td></tr>
                    )}
                    {filtered.map(r => {
                      const meta = KIND_META[r.suggestedKind];
                      const Icon = ICONS[r.suggestedKind];
                      return (
                        <tr key={r.mac}
                            style={{ borderTop: '1px solid #F1F5F9', opacity: r.existingId ? 0.65 : 1 }}>
                          <td style={td}>
                            {/* v0.38: чекбокс работает и для существующих —
                                выбор нужен чтобы выбрать action «обновить/заменить» */}
                            <input
                              type="checkbox"
                              checked={selected.has(r.mac)}
                              onChange={() => {
                                const next = new Set(selected);
                                if (next.has(r.mac)) next.delete(r.mac); else next.add(r.mac);
                                setSelected(next);
                              }}
                            />
                          </td>
                          <td style={td}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {Icon && <Icon size={14} color={meta?.color || '#64748B'} />}
                              <span style={{ fontSize: 10, color: meta?.color || '#64748B' }}>{meta?.label || r.suggestedKind}</span>
                            </div>
                          </td>
                          <td style={td}>{r.hostname || <span style={{ color: '#94A3B8' }}>—</span>}</td>
                          <td style={{ ...td, fontFamily: 'monospace' }}>{r.ip || <span style={{ color: '#94A3B8' }}>—</span>}</td>
                          <td style={{ ...td, fontFamily: 'monospace' }}>{r.mac}</td>
                          <td style={td}>{r.vendor || <span style={{ color: '#94A3B8' }}>—</span>}</td>
                          <td style={td}>
                            {r.existingId ? <span style={{ color: '#B45309' }}>уже есть</span>
                              : <span style={{ color: '#64748B' }}>{r.source}</span>}
                          </td>
                          <td style={td} onClick={(e) => e.stopPropagation()}>
                            {r.existingId ? (
                              <select
                                value={actions.get(r.mac) ?? 'skip'}
                                onChange={(e) => {
                                  const next = new Map(actions);
                                  next.set(r.mac, e.target.value as ImportAction);
                                  setActions(next);
                                }}
                                style={{
                                  fontSize: 10, padding: '2px 4px', borderRadius: 4,
                                  border: '1px solid #FCD34D',
                                  background: (actions.get(r.mac) ?? 'skip') === 'skip' ? '#F3F4F6'
                                            : (actions.get(r.mac) === 'replace' ? '#FEE2E2' : '#FEF3C7'),
                                }}
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
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 16px', borderTop: '1px solid #E2E8F0', background: '#F8FAFC',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: 8,
        }}>
          <div style={{ fontSize: 11, color: '#64748B', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {scan && (
              <>
                <span>Найдено: {rows.length} · показано: {filtered.length}</span>
                <span>
                  Выделено: <b>{effectiveSelected.size}</b>
                  {selected.size > effectiveSelected.size && (
                    <span style={{ marginLeft: 4, color: '#B45309' }}>
                      ({selected.size - effectiveSelected.size} вне фильтра)
                    </span>
                  )}
                </span>
                {importPreview.toAdd > 0 && <span style={{ color: '#059669' }}>+{importPreview.toAdd} новых</span>}
                {importPreview.toUpdate > 0 && <span style={{ color: '#B45309' }}>↻{importPreview.toUpdate} обновить</span>}
                {importPreview.toReplace > 0 && <span style={{ color: '#DC2626' }}>⚡{importPreview.toReplace} заменить</span>}
                {importPreview.toSkip > 0 && <span style={{ color: '#6B7280' }}>⊘{importPreview.toSkip} пропустить</span>}
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {importing && (
              <div style={{ fontSize: 11, color: '#2563EB', display: 'flex', alignItems: 'center', gap: 8, marginRight: 6 }}>
                <ProgressStripe />
                <span>Записываем в проект…</span>
              </div>
            )}
            <button style={smallBtn} onClick={onClose} disabled={busy}>Закрыть</button>
            <button
              style={{ ...primaryBtn, ...(importing ? btnBusy : {}) }}
              onClick={doImport}
              disabled={!scan || importPreview.total === 0 || importing}
            >
              {importing && <MiniSpinner light />} {importing ? 'Импорт…' : `Импортировать (${importPreview.total})`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Reusable UI atoms

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: '#475569', marginBottom: 4, fontWeight: 600 }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)',
  zIndex: 100000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const dialog: React.CSSProperties = {
  background: 'white', width: '90vw', maxWidth: 1000, height: '85vh',
  borderRadius: 12, boxShadow: '0 20px 60px rgba(15, 23, 42, 0.25)',
  display: 'flex', flexDirection: 'column',
};
const header: React.CSSProperties = {
  padding: '14px 16px', borderBottom: '1px solid #E2E8F0',
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
};
const closeBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', fontSize: 18, color: '#64748B',
  cursor: 'pointer', padding: 4, lineHeight: 1,
};
const inputStyle: React.CSSProperties = {
  padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 12, background: 'white',
};
const primaryBtn: React.CSSProperties = {
  padding: '6px 14px', border: 'none', borderRadius: 6, background: '#2563EB',
  color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const smallBtn: React.CSSProperties = {
  padding: '6px 12px', border: '1px solid #CBD5E1', borderRadius: 6, background: 'white',
  fontSize: 12, cursor: 'pointer', color: '#334155',
};
const checkLabel: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
};
const th: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700,
  color: '#64748B', textTransform: 'uppercase',
};
const td: React.CSSProperties = { padding: '6px 10px', fontSize: 11 };

// v0.44.2 — vendor picker tiles + header badge
const headerIconBadge: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10,
  background: 'linear-gradient(135deg, #3B82F6, #6366F1)', color: 'white',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 4px 12px rgba(59, 130, 246, 0.35)',
};
const vendorTile: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '10px 12px', borderRadius: 10,
  background: 'white', border: '1px solid #E2E8F0',
  cursor: 'pointer', textAlign: 'left', outline: 'none',
  transition: 'transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease',
};
const vendorTileActive: React.CSSProperties = {
  border: '1px solid #3B82F6',
  background: 'linear-gradient(135deg, #EFF6FF, #FFFFFF)',
  boxShadow: '0 4px 12px rgba(59, 130, 246, 0.15)',
  transform: 'translateY(-1px)',
};
const vendorTileDisabled: React.CSSProperties = {
  opacity: 0.5, cursor: 'not-allowed', background: '#F8FAFC',
};
const vendorTileDot: React.CSSProperties = {
  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
};

function vendorColor(id: string): string {
  const map: Record<string, string> = {
    mikrotik: '#F97316',
    unifi: '#0EA5E9',
    'omada-cloud': '#22C55E',
    ruijie: '#EAB308',
    dlink: '#EC4899',
    edgeswitch: '#8B5CF6',
  };
  return map[id] || '#94A3B8';
}
