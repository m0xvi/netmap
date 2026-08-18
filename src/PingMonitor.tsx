import { useEffect, useRef } from 'react';
import { useStore } from './store';
import { hasPingBackend, pingBatch } from './pingClient';

/**
 * Headless component: runs the ping loop when the monitor is enabled and a native backend is present.
 * Marks every device with a valid IP as 'checking' during the run, then applies the result.
 */
export function PingMonitor() {
  const doc = useStore(s => s.doc);
  const enabled = useStore(s => s.monitorEnabled);
  const intervalSec = useStore(s => s.monitorIntervalSec);
  const applyPingResults = useStore(s => s.applyPingResults);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);

  // Extract candidate targets fresh each cycle (so newly added devices are included).
  const runCycle = async () => {
    if (runningRef.current) return;
    if (!enabled || !hasPingBackend) return;

    const cur = useStore.getState().doc;
    const targets = cur.devices
      .filter(d => !!d.ip && d.kind !== 'cloud' && d.kind !== 'vm')  // skip ISP nodes and VMs (VMs get status from host anyway)
      .map(d => ({ id: d.id, ip: (d.ip as string).split('/')[0] }));

    if (targets.length === 0) return;

    runningRef.current = true;
    // Mark as checking
    applyPingResults(targets.map(t => ({ id: t.id, liveStatus: 'checking' })));

    const results = await pingBatch(targets, { timeoutMs: 1500, concurrency: 8 });
    const now = Date.now();
    applyPingResults(results.map(r => ({
      id: r.id,
      liveStatus: r.alive ? 'up' : 'down',
      lastRttMs: r.rttMs,
      lastCheckedAt: now,
    })));
    runningRef.current = false;
  };

  useEffect(() => {
    // Clear any previous timer
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (!enabled || !hasPingBackend) return;
    // Kick off immediately, then on interval
    runCycle();
    timerRef.current = setInterval(runCycle, Math.max(5, intervalSec) * 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalSec]);

  return null;
}
