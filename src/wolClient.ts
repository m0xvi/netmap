/**
 * v0.36.2 — Wake-on-LAN клиент. Тонкая обёртка над window.netmap.wolSend.
 */
const w = typeof window !== 'undefined' ? (window as any) : {};
export const hasWolBackend = !!(w.netmap && typeof w.netmap.wolSend === 'function');

export interface WolResult {
  ok: boolean;
  sent: number;
  targets: string[];
  error?: string;
}

export async function sendWol(cfg: {
  mac: string;
  broadcastIp?: string;
  port?: number;
}): Promise<WolResult> {
  if (!hasWolBackend) {
    return { ok: false, sent: 0, targets: [], error: 'WoL доступен только в собранной .exe (Electron).' };
  }
  return w.netmap.wolSend(cfg);
}
