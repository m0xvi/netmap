// v0.77.0: плановый скан автообнаружения — пока приложение открыто.
// Что делает: раз в N минут запускает скан, сохраняет снимок для сравнения и
// показывает итог («новых 2, пропало 0»). В документ ничего не применяет.
// Что не делает: не запускается во время ручного скана; учётные данные живут
// только в памяти текущей сессии и на диск не пишутся.

import { makeSnapshot, diffSnapshots, loadSnapshot, saveSnapshot } from './discoveryDiff';
import type { DiscoveryScanResult } from './discoveryClient';

export interface ScheduleStatus {
  enabled: boolean;
  intervalMin: number;
  running: boolean;
  nextAt?: number;
  lastAt?: number;
  lastSummary?: string;
  lastError?: string;
}

type RunScan = (cfg: any) => Promise<DiscoveryScanResult>;
type Listener = (s: ScheduleStatus) => void;

let timer: ReturnType<typeof setInterval> | null = null;
let job: { cfg: any; intervalMs: number; runScan: RunScan } | null = null;
let busy = false; // ручной скан идёт — плановый пропускаем
let status: ScheduleStatus = { enabled: false, intervalMin: 0, running: false };
const listeners = new Set<Listener>();

function emit(patch: Partial<ScheduleStatus>) {
  status = { ...status, ...patch };
  for (const fn of listeners) {
    try { fn(status); } catch (_) { /* слушатель упал — остальные не страдают */ }
  }
}

export function getScheduleStatus(): ScheduleStatus {
  return status;
}

export function subscribeSchedule(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Диалог сообщает, что ручной скан начался/закончился. */
export function setDiscoveryBusy(v: boolean): void {
  busy = v;
}

export function describeDiff(added: number, removed: number, changed: number, ignored: boolean): string {
  return `новых ${added}, пропало ${ignored ? 'не считаем' : removed}, изменилось ${changed}`;
}

/** Один прогон: скан → снимок → сравнение. Не трогает документ. */
export async function runScheduledOnce(): Promise<void> {
  if (!job) return;
  if (busy) { emit({ lastSummary: 'пропущен: идёт ручной скан' }); return; }
  if (status.running) return;
  const { cfg, runScan } = job;
  const root = String(cfg.host || '').trim();
  emit({ running: true, lastError: undefined });
  try {
    const r = await runScan({ ...cfg, doc: { devices: [], links: [] } });
    if (!r || r.ok === false || !Array.isArray(r.proposedDevices)) {
      emit({ running: false, lastAt: Date.now(), lastError: (r && (r as any).error) || 'скан не вернул результат' });
      return;
    }
    const now = Date.now();
    const nextSnap = makeSnapshot(r, root, now);
    const prevSnap = loadSnapshot(root);
    let summary = 'первый снимок: ' + r.proposedDevices.length + ' устр.';
    if (prevSnap) {
      const d = diffSnapshots(prevSnap, nextSnap);
      summary = describeDiff(d.added.length, d.removed.length, d.changed.length, d.removedIgnored);
    }
    saveSnapshot(nextSnap);
    emit({
      running: false,
      lastAt: now,
      lastSummary: r.cancelled ? summary + ' (опрос отменён)' : summary,
      nextAt: status.enabled ? now + job.intervalMs : undefined,
    });
  } catch (e: any) {
    emit({ running: false, lastAt: Date.now(), lastError: e?.message || String(e) });
  }
}

/**
 * Включает плановый скан. cfg хранится в памяти — его нельзя сохранять на диск.
 * intervalMs — интервал между стартами (для тестов можно меньше минуты).
 */
export function startSchedule(opts: { cfg: any; intervalMs: number; runScan: RunScan }): void {
  stopSchedule();
  job = { cfg: opts.cfg, intervalMs: Math.max(1000, opts.intervalMs), runScan: opts.runScan };
  const intervalMin = Math.round(job.intervalMs / 60000);
  emit({ enabled: true, intervalMin, nextAt: Date.now() + job.intervalMs, lastError: undefined });
  timer = setInterval(() => { void runScheduledOnce(); }, job.intervalMs);
}

export function stopSchedule(): void {
  if (timer) clearInterval(timer);
  timer = null;
  job = null;
  emit({ enabled: false, nextAt: undefined, running: false });
}
