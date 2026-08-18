/**
 * v0.36.1 — Notification Dispatcher.
 *
 * Слушает store.alerts и, для каждой НОВОЙ записи (не рендерил ранее),
 * решает куда её продублировать за пределы приложения:
 *   • Windows toast (Notification API) — если включено в настройках.
 *   • Telegram bot — если настроен + severity >= minSeverity.
 *
 * Компонент — невидимый listener. Логика по одному alert = один "fan-out".
 * Никакой ретроспективы: если пользователь открыл приложение через час
 * после падения устройства, мы НЕ шлём старый alert повторно.
 */

import { useEffect, useRef } from 'react';
import { useStore, type AlertEntry, type NotifSettings } from './store';

const SEVERITY_RANK: Record<NonNullable<AlertEntry['severity']>, number> = {
  info: 0, success: 0, warn: 1, critical: 2,
};
const MIN_SEVERITY_RANK: Record<NotifSettings['minSeverity'], number> = {
  info: 0, warn: 1, critical: 2,
};

export function NotificationDispatcher() {
  const alerts   = useStore(s => s.alerts);
  const settings = useStore(s => s.notifSettings);
  /** IDs alerts мы уже обработали. Заводим на mount пустой, чтобы старые
   *  сохранённые alerts не выстрелили повторно после перезапуска. */
  const seenRef = useRef<Set<string>>(new Set());
  const initedRef = useRef(false);

  useEffect(() => {
    // First mount: mark ALL existing alerts as already-seen so we don't
    // spam the user with history when opening the app.
    if (!initedRef.current) {
      initedRef.current = true;
      for (const a of alerts) seenRef.current.add(a.id);
      return;
    }
    // Process only alerts we haven't seen yet, oldest first (alerts array is newest-first).
    const fresh: AlertEntry[] = [];
    for (const a of alerts) {
      if (seenRef.current.has(a.id)) continue;
      seenRef.current.add(a.id);
      fresh.push(a);
    }
    fresh.reverse();   // dispatch in chronological order

    for (const a of fresh) {
      dispatchAlert(a, settings);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts]);

  return null;
}

function dispatchAlert(a: AlertEntry, settings: NotifSettings) {
  const sev = a.severity || 'info';
  const rank = SEVERITY_RANK[sev];
  const minRank = MIN_SEVERITY_RANK[settings.minSeverity];
  if (rank < minRank) return;   // filtered out

  // 1) Native Windows toast via Notification API.
  if (settings.windowsToast) {
    try { fireWindowsToast(a); } catch (e) { console.warn('[toast] failed', e); }
  }
  // 2) Telegram
  if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
    fireTelegram(a, settings).catch(e => console.warn('[tg] failed', e));
  }
}

function fireWindowsToast(a: AlertEntry) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'denied') return;
  const emitOne = () => {
    const n = new Notification(a.title || 'NetMap', {
      body: a.message,
      // Silent for success/info — устройство поднялось не так важно как оно упало.
      silent: a.severity !== 'critical',
      tag: a.id,
    });
    // Click on toast → focus main window (Electron catches focus automatically when the
    // Notification origin equals the window). Also fire a custom event so the app can
    // navigate to the specific device.
    n.onclick = () => {
      window.focus();
      if (a.deviceId) {
        window.dispatchEvent(new CustomEvent('netmap:focus-device', { detail: { id: a.deviceId } }));
      }
    };
  };
  if (Notification.permission === 'granted') {
    emitOne();
  } else if (Notification.permission === 'default') {
    Notification.requestPermission().then(p => { if (p === 'granted') emitOne(); });
  }
}

async function fireTelegram(a: AlertEntry, settings: NotifSettings) {
  const w = window as any;
  if (!w.netmap?.telegramSend) return;
  const emoji =
    a.severity === 'critical' ? '🔴' :
    a.severity === 'warn'     ? '🟡' :
    a.severity === 'success'  ? '🟢' :
                                 'ℹ️';
  const msg =
    `${emoji} <b>${escapeHtml(a.title || 'NetMap')}</b>\n` +
    `${escapeHtml(a.message)}` +
    (a.deviceName ? `\n\n<b>Устройство:</b> ${escapeHtml(a.deviceName)}` : '') +
    `\n<i>${new Date(a.ts).toLocaleString()}</i>`;
  await w.netmap.telegramSend({
    botToken: settings.telegramBotToken,
    chatId: settings.telegramChatId,
    proxyUrl: settings.telegramProxyUrl,
    message: msg,
    parseMode: 'HTML',
  });
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
