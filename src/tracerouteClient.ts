/**
 * v0.36.2 — Traceroute клиент для renderer.
 * Один долгоживущий handler на сессию: startTraceroute() возвращает
 * `requestId` + отдельно навешенные listener'ы на hop/done события.
 */
const w = typeof window !== 'undefined' ? (window as any) : {};
export const hasTracerouteBackend = !!(w.netmap && typeof w.netmap.tracerouteStart === 'function');

export interface TraceHop {
  n: number;
  host: string | null;
  rttMs?: number | null;
  timeout?: boolean;
}
export interface TracerouteHandle {
  requestId: string;
  stop: () => void;
  /** Unsubscribe both event listeners — call when component unmounts. */
  dispose: () => void;
}

/**
 * Start a traceroute. Callbacks fire as hops arrive.
 * @returns handle you can `stop()` to abort and `dispose()` when done.
 */
export function startTraceroute(cfg: {
  target: string;
  maxHops?: number;
  timeoutMs?: number;
  onHop: (hop: TraceHop) => void;
  onDone: (ok: boolean, error?: string) => void;
}): Promise<TracerouteHandle | null> {
  if (!hasTracerouteBackend) {
    cfg.onDone(false, 'Traceroute доступен только в собранной .exe (Electron).');
    return Promise.resolve(null);
  }
  const requestId = 'tr-' + Math.random().toString(36).slice(2, 9);

  const offHop = w.netmap.onTracerouteHop((data: { requestId: string; hop: TraceHop }) => {
    if (data.requestId === requestId) cfg.onHop(data.hop);
  });
  const offDone = w.netmap.onTracerouteDone((data: { requestId: string; ok: boolean; error?: string }) => {
    if (data.requestId === requestId) cfg.onDone(data.ok, data.error);
  });
  const dispose = () => { try { offHop(); offDone(); } catch {} };

  return w.netmap.tracerouteStart({
    requestId,
    target: cfg.target,
    maxHops: cfg.maxHops ?? 30,
    timeoutMs: cfg.timeoutMs ?? 2000,
  }).then((res: { ok: boolean; error?: string }) => {
    if (!res.ok) { dispose(); cfg.onDone(false, res.error || 'старт не удался'); return null; }
    return {
      requestId,
      stop: () => { try { w.netmap.tracerouteStop({ requestId }); } catch {} },
      dispose,
    };
  }).catch((e: any) => {
    dispose();
    cfg.onDone(false, e?.message || String(e));
    return null;
  });
}
