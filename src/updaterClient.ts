/**
 * v0.36.2 — auto-updater renderer client.
 * Просто прокидываем IPC и subscribe.
 */
const w = typeof window !== 'undefined' ? (window as any) : {};
export const hasUpdaterBackend = !!(w.netmap && typeof w.netmap.updateCheck === 'function');

export type UpdateState =
  | 'checking' | 'available' | 'not-available'
  | 'downloading' | 'downloaded' | 'error' | 'disabled';

export interface UpdateInfo {
  version?: string;
  releaseName?: string;
  releaseNotes?: string;
  releaseDate?: string;
}

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdateStatus {
  state: UpdateState;
  info?: UpdateInfo;
  progress?: UpdateProgress;
  error?: string;
}

export function onUpdateStatus(cb: (s: UpdateStatus) => void): () => void {
  if (!hasUpdaterBackend) return () => {};
  return w.netmap.onUpdateStatus(cb);
}
export function checkForUpdatesNow() {
  if (!hasUpdaterBackend) return Promise.resolve({ ok: false, disabled: true });
  return w.netmap.updateCheck();
}
export function downloadUpdateNow() {
  if (!hasUpdaterBackend) return Promise.resolve({ ok: false, disabled: true });
  return w.netmap.updateDownload();
}
export function installUpdateNow() {
  if (!hasUpdaterBackend) return Promise.resolve({ ok: false, disabled: true });
  return w.netmap.updateInstall();
}
