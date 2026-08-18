/**
 * v0.43 — RDP launcher client — thin bridge over window.netmap.rdpLaunch.
 */

const w = typeof window !== 'undefined' ? (window as any) : {};

export interface RdpConfig {
  host: string;
  port?: number;
  username?: string;
  password?: string;
}
export interface RdpResult {
  ok: boolean;
  error?: string;
  file?: string;
  clipCopied?: boolean;
}

export async function launchRdp(cfg: RdpConfig): Promise<RdpResult> {
  if (!w.netmap?.rdpLaunch) {
    return { ok: false, error: 'RDP запуск доступен только в собранной .exe' };
  }
  return w.netmap.rdpLaunch(cfg);
}
