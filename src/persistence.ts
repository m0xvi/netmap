/**
 * Persistence adapter.
 *
 * If running inside Electron (with the preload bridge exposed as window.netmap),
 * we use the SQLite-backed IPC API from electron/db.cjs.
 *
 * Otherwise (dev preview in a plain browser, or a fresh install without native
 * modules built), we transparently fall back to localStorage. This keeps the
 * web preview working AND survives if better-sqlite3 fails to compile on some host.
 */

import type { NetMapDoc } from './types';
import type { DeviceTemplate } from './templates';

const w = typeof window !== 'undefined' ? (window as any) : {};
export const hasNativeBackend = !!(w.netmap && typeof w.netmap.loadDoc === 'function');

// --------- Doc ---------
const LS_DOC = 'netmap:doc:v2';
const LS_DOC_V1 = 'netmap:doc:v1';

export async function persistLoadDoc(): Promise<NetMapDoc | null> {
  if (hasNativeBackend) {
    try { return await w.netmap.loadDoc(); } catch { return null; }
  }
  try {
    const raw = localStorage.getItem(LS_DOC) || localStorage.getItem(LS_DOC_V1);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * БАГ: IPC-обработчики в main оборачиваются в safeInvoke, который при ошибке
 * НЕ отклоняет промис, а возвращает {ok:false,error}. Поэтому прежний
 * `.catch(() => {})` никогда не срабатывал — неудачная запись тихо
 * терялась. Теперь ошибка хотя бы попадает в консоль (и в поддержку по логам).
 */
function reportNativeSaveResult(what: string, p: Promise<any>) {
  p.then((r) => {
    if (r && r.ok === false) console.error(`[netmap] ${what} save failed:`, r.error);
  }).catch((e) => console.error(`[netmap] ${what} save failed:`, e));
}

export function persistSaveDoc(doc: NetMapDoc) {
  if (hasNativeBackend) {
    // Fire and forget; debouncing done by caller
    reportNativeSaveResult('doc', w.netmap.saveDoc(doc));
    return;
  }
  try { localStorage.setItem(LS_DOC, JSON.stringify(doc)); } catch {}
}

// --------- Filters ---------
const LS_FILTERS = 'netmap:filters:v1';

export async function persistLoadFilters(): Promise<any | null> {
  if (hasNativeBackend) {
    try { return await w.netmap.loadFilters(); } catch { return null; }
  }
  try {
    const raw = localStorage.getItem(LS_FILTERS);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function persistSaveFilters(f: any) {
  if (hasNativeBackend) { reportNativeSaveResult('filters', w.netmap.saveFilters(f)); return; }
  try { localStorage.setItem(LS_FILTERS, JSON.stringify(f)); } catch {}
}

// --------- Templates ---------
const LS_TEMPLATES = 'netmap:templates:v1';

export async function persistLoadTemplates(): Promise<DeviceTemplate[]> {
  if (hasNativeBackend) {
    try { return (await w.netmap.loadTemplates()) || []; } catch { return []; }
  }
  try {
    const raw = localStorage.getItem(LS_TEMPLATES);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function persistSaveTemplates(list: DeviceTemplate[]) {
  if (hasNativeBackend) { reportNativeSaveResult('templates', w.netmap.saveTemplates(list)); return; }
  try { localStorage.setItem(LS_TEMPLATES, JSON.stringify(list)); } catch {}
}

// --------- Info ---------

export async function persistGetDbPath(): Promise<string | null> {
  if (hasNativeBackend) {
    try { return await w.netmap.getDbPath(); } catch { return null; }
  }
  return null;
}
