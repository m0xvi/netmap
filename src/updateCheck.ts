/**
 * v0.88.0 — проверка обновлений для меню «Справка» и значка версии.
 * Результат пишется в журнал уведомлений, без alert/confirm.
 */

import { useStore } from './store';

export async function runUpdateCheck(): Promise<void> {
  try {
    const { checkForUpdatesNow } = await import('./updaterClient');
    const r = await checkForUpdatesNow();
    if (r && (r as any).disabled) {
      useStore.getState().pushAlert({
        severity: 'info', origin: 'app', title: 'Обновления',
        message: 'Auto-updater недоступен (dev-режим).',
      });
    }
  } catch (e: any) {
    useStore.getState().pushAlert({
      severity: 'warn', origin: 'app', title: 'Проверка обновлений', message: e?.message || String(e),
    });
  }
}
