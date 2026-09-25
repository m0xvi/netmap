/**
 * v0.36.2 — Traceroute dialog.
 *
 * Открывается через глобальное событие `netmap:open-traceroute` с деталями:
 *   { targetDeviceId?, targetIp?, sourceDeviceId? }
 * или без деталей — тогда пользователь сам выбирает target из dropdown.
 *
 * Показывает две панели:
 *   • Внутренний путь по кабелям (traceCable) — сверху, «как по бумаге»:
 *     src → patch → switch → target через link-ids.
 *   • ICMP traceroute — стриминговая таблица hop'ов с host + RTT.
 *     Обновляется по мере поступления результата (не ждём завершения).
 *
 * Escape / клик по фону закрывает + автоматически прерывает активный
 * ICMP-traceroute.
 *
 * v0.62.0: каркас переведён на DialogShell (единая тема окон).
 */

import { useEffect, useMemo, useState } from 'react';
import { useStore } from './store';
import { startTraceroute, type TraceHop, type TracerouteHandle } from './tracerouteClient';
import { traceCable } from './traceCable';
import { DialogShell, DlgBtn } from './DialogTheme';

// ============================================================================
// Host component: слушает event, монтирует dialog. Ставится один раз в App.
// ============================================================================
export function TracerouteDialogHost() {
  const [target, setTarget] = useState<{ ip?: string; deviceId?: string; sourceDeviceId?: string } | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ targetIp?: string; targetDeviceId?: string; sourceDeviceId?: string }>).detail;
      setTarget(d || {});
    };
    window.addEventListener('netmap:open-traceroute', onOpen as EventListener);
    return () => window.removeEventListener('netmap:open-traceroute', onOpen as EventListener);
  }, []);
  if (!target) return null;
  return <TracerouteDialog initial={target} onClose={() => setTarget(null)} />;
}

// ============================================================================
// Dialog
// ============================================================================
function TracerouteDialog({ initial, onClose }: {
  initial: { ip?: string; deviceId?: string; sourceDeviceId?: string };
  onClose: () => void;
}) {
  const doc = useStore(s => s.doc);
  const devicesWithIp = useMemo(
    () => doc.devices.filter(d => !!d.ip).sort((a, b) => a.name.localeCompare(b.name)),
    [doc.devices]
  );

  const [srcDeviceId, setSrcDeviceId] = useState<string>(initial.sourceDeviceId || '');
  const [tgtDeviceId, setTgtDeviceId] = useState<string>(initial.deviceId || '');
  const [tgtIp, setTgtIp] = useState<string>(initial.ip || '');

  // If tgtDeviceId is set, tgtIp is derived from it.
  useEffect(() => {
    if (tgtDeviceId) {
      const d = doc.devices.find(x => x.id === tgtDeviceId);
      if (d?.ip) setTgtIp(d.ip.split('/')[0]);
    }
  }, [tgtDeviceId, doc.devices]);

  const srcDev = doc.devices.find(d => d.id === srcDeviceId);
  const tgtDev = doc.devices.find(d => d.id === tgtDeviceId);

  // ---- Internal path via traceCable — computed synchronously from doc ----
  const internal = useMemo(() => {
    if (!srcDev) return null;
    // Pick the first port of the source that has a link — best guess.
    const firstConnectedPort = srcDev.ports.find(p =>
      doc.links.some(l =>
        (l.fromDeviceId === srcDev.id && l.fromPortId === p.id) ||
        (l.toDeviceId === srcDev.id && l.toPortId === p.id)
      )
    );
    if (!firstConnectedPort) return null;
    return traceCable(doc, srcDev.id, firstConnectedPort.id);
  }, [srcDev, doc]);

  // ---- Live ICMP traceroute ----
  const [hops, setHops] = useState<TraceHop[]>([]);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [handle, setHandle] = useState<TracerouteHandle | null>(null);

  const startRun = async () => {
    if (!tgtIp) return;
    setHops([]); setErr(null); setRunning(true);
    const h = await startTraceroute({
      target: tgtIp,
      maxHops: 30,
      timeoutMs: 2000,
      onHop: (hop) => setHops(prev => {
        // Replace by hop number if it already existed (should not, but safety).
        const filtered = prev.filter(x => x.n !== hop.n);
        return [...filtered, hop].sort((a, b) => a.n - b.n);
      }),
      onDone: (ok, error) => {
        setRunning(false);
        if (!ok && error) setErr(error);
        setHandle(null);
      },
    });
    setHandle(h);
  };
  const stopRun = () => {
    if (handle) handle.stop();
    setRunning(false);
  };

  // Cleanup on unmount / dialog close.
  useEffect(() => {
    return () => {
      if (handle) { try { handle.stop(); handle.dispose(); } catch {} }
    };
  }, [handle]);

  return (
    <DialogShell
      title="Traceroute"
      subtitle="Путь по кабелям (внутренний) + реальный ICMP-трейс"
      icon="route"
      width={900}
      onClose={onClose}
    >
      {/* Src / Tgt pickers */}
      <div style={{
        background: '#fff', border: '1px solid #E4E9F2', borderRadius: 12, padding: 12,
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, alignItems: 'end',
      }}>
        <label className="fld">Источник (устройство)
          <select value={srcDeviceId} onChange={e => setSrcDeviceId(e.target.value)}>
            <option value="">— выбрать —</option>
            {devicesWithIp.map(d => (
              <option key={d.id} value={d.id}>{d.name} · {d.ip}</option>
            ))}
          </select>
        </label>
        <label className="fld">Цель (устройство)
          <select value={tgtDeviceId} onChange={e => { setTgtDeviceId(e.target.value); }}>
            <option value="">— свой IP ниже —</option>
            {devicesWithIp.map(d => (
              <option key={d.id} value={d.id}>{d.name} · {d.ip}</option>
            ))}
          </select>
        </label>
        <label className="fld">Цель IP (для ICMP)
          <input value={tgtIp} onChange={e => setTgtIp(e.target.value)} placeholder="8.8.8.8" />
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          {!running ? (
            <DlgBtn kind="primary" className="sm" onClick={startRun} disabled={!tgtIp}>
              Запустить
            </DlgBtn>
          ) : (
            <DlgBtn kind="danger" className="sm" onClick={stopRun}>
              Остановить
            </DlgBtn>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, minHeight: 0 }}>
        {/* Internal path */}
        <div style={panel}>
          <div style={panelHeader}>Путь по кабелям</div>
          <div style={{ padding: 10, overflowY: 'auto', flex: 1, minHeight: 120, maxHeight: 360 }}>
            {!srcDev && <div className="empty">Выберите источник, чтобы увидеть путь по внутренним кабелям.</div>}
            {srcDev && !internal && <div className="empty">Источник не подключён ни к одному кабелю.</div>}
            {internal && (
              <div style={{ display: 'grid', gap: 4 }}>
                {internal.hops.map((h, i) => {
                  const dev = doc.devices.find(x => x.id === h.deviceId);
                  return (
                    <div key={i} style={hopRow}>
                      <span style={hopNum}>{i + 1}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <b style={{ color: '#111827' }}>{dev?.name || h.deviceId}</b>
                        {h.portId && (
                          <span style={{ color: '#6B7280', fontFamily: 'ui-monospace, monospace',
                                          marginLeft: 6, fontSize: 10 }}>
                            · {h.portId}
                          </span>
                        )}
                        {h.transitPp && (
                          <span style={{ marginLeft: 6, fontSize: 9, color: '#9333EA',
                                          background: '#FAF5FF', padding: '1px 5px', borderRadius: 3 }}>
                            patch transit
                          </span>
                        )}
                        {dev?.ip && (
                          <div style={{ fontSize: 10, color: '#9CA3AF', fontFamily: 'ui-monospace, monospace' }}>
                            {dev.ip}
                          </div>
                        )}
                      </span>
                    </div>
                  );
                })}
                {internal.aborted && (
                  <div className="infobox warn" style={{ marginTop: 6 }}>
                    Трейс прерван (обнаружен цикл через патч-панели).
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ICMP live */}
        <div style={panel}>
          <div style={panelHeader}>
            ICMP traceroute → <span style={{ fontFamily: 'ui-monospace, monospace' }}>{tgtIp || '—'}</span>
            {running && <span style={{ marginLeft: 8, fontSize: 10, color: '#2563EB' }}>идёт…</span>}
          </div>
          <div style={{ padding: 10, overflowY: 'auto', flex: 1, minHeight: 120, maxHeight: 360 }}>
            {!tgtIp && <div className="empty">Укажите целевой IP и нажмите «Запустить».</div>}
            {tgtIp && hops.length === 0 && !running && !err && (
              <div className="empty">Готово к запуску.</div>
            )}
            {hops.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead style={{ position: 'sticky', top: 0, background: '#F9FAFB' }}>
                  <tr>
                    <th style={th}>#</th>
                    <th style={th}>Host / IP</th>
                    <th style={{ ...th, textAlign: 'right' }}>RTT</th>
                  </tr>
                </thead>
                <tbody>
                  {hops.map(h => (
                    <tr key={h.n}>
                      <td style={td}>{h.n}</td>
                      <td style={{ ...td, fontFamily: 'ui-monospace, monospace' }}>
                        {h.timeout ? <span style={{ color: '#9CA3AF' }}>* * *</span>
                         : h.host || <span style={{ color: '#9CA3AF' }}>—</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace',
                                   color: h.timeout ? '#9CA3AF'
                                        : (h.rttMs || 0) > 100 ? '#DC2626'
                                        : (h.rttMs || 0) > 30  ? '#F59E0B' : '#059669' }}>
                        {h.rttMs != null ? `${h.rttMs} ms` : (h.timeout ? '—' : '')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {err && (
              <div className="infobox danger" style={{ marginTop: 8 }}>
                {err}
              </div>
            )}
          </div>
        </div>
      </div>
    </DialogShell>
  );
}

// ---- styles ----
const panel: React.CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column',
  background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8,
  minHeight: 0, overflow: 'hidden',
};
const panelHeader: React.CSSProperties = {
  padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#374151',
  textTransform: 'uppercase', letterSpacing: 0.4,
  background: '#F9FAFB', borderBottom: '1px solid #F3F4F6',
};
const hopRow: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'flex-start',
  padding: '6px 8px', borderBottom: '1px solid #F3F4F6',
};
const hopNum: React.CSSProperties = {
  width: 22, height: 22, borderRadius: '50%',
  background: '#EFF6FF', color: '#1D4ED8',
  fontSize: 11, fontWeight: 700,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0,
};
const th: React.CSSProperties = {
  textAlign: 'left', padding: '5px 8px', fontSize: 10, fontWeight: 700,
  color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.4,
  borderBottom: '1px solid #E5E7EB',
};
const td: React.CSSProperties = {
  padding: '4px 8px', fontSize: 11,
  borderBottom: '1px solid #F3F4F6',
};
