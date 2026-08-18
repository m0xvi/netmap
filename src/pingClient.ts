/**
 * Ping / reachability probe adapter.
 * ICMP + TCP fallback is available only in Electron (native `ping` binary + Node net).
 * In the browser preview we cannot probe — the feature is silently disabled.
 */
const w = typeof window !== 'undefined' ? (window as any) : {};
export const hasPingBackend = !!(w.netmap && typeof w.netmap.pingBatch === 'function');

export interface PingResult {
  id: string;
  alive: boolean;
  rttMs?: number;
  method?: string;
  port?: number;
  error?: string;
}

export async function pingBatch(items: { id: string; ip: string }[], opts?: { timeoutMs?: number; forceTcp?: boolean; concurrency?: number }): Promise<PingResult[]> {
  if (!hasPingBackend) return items.map(i => ({ id: i.id, alive: false, method: 'unavailable' }));
  try {
    return await w.netmap.pingBatch(items, opts || {});
  } catch {
    return items.map(i => ({ id: i.id, alive: false, method: 'error' }));
  }
}
