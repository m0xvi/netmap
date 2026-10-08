/**
 * v0.75 — WinBox launcher client — тонкий мост над window.netmap.winboxLaunch.
 * Как rdpClient: в браузере (dev/preview) честно говорит «только в Electron».
 */

interface WinboxCfg { path?: string; ip: string; login?: string; password?: string }
interface WinboxResult { ok: boolean; error?: string }

export function winboxAvailable(): boolean {
  const w = window as any;
  return !!w.netmap?.winboxLaunch;
}

export async function winboxLaunch(cfg: WinboxCfg): Promise<WinboxResult> {
  const w = window as any;
  if (!w.netmap?.winboxLaunch) {
    return { ok: false, error: 'WinBox доступен только в desktop-версии (Electron)' };
  }
  return w.netmap.winboxLaunch(cfg);
}

export const isMikrotikDevice = (d: { vendor?: string; model?: string }): boolean => {
  const v = (d.vendor || '').toLowerCase();
  const m = (d.model || '').toLowerCase();
  return v.includes('mikrotik') || m.includes('mikrotik') || m.includes('routeros');
};
