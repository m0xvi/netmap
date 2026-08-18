/**
 * v0.36.2 — Auto-updater (electron-updater + GitHub Releases).
 *
 * Как работает:
 *   1. При запуске приложение бросает `checkForUpdates()` — стучит на
 *      GitHub API `/repos/<owner>/<repo>/releases/latest`, сравнивает
 *      published version с текущей.
 *   2. Если найдена новая — отправляет событие в renderer с описанием
 *      release (version + release notes) и сразу начинает фоновую
 *      загрузку .exe (nsis differential update).
 *   3. По окончании загрузки — второе событие, renderer показывает
 *      баннер «Установить и перезапустить».
 *   4. Клик — `quitAndInstall()`.
 *
 * IPC:
 *   netmap:update-check     → форс-проверить сейчас
 *   netmap:update-download  → начать скачивание (auto=false кейс)
 *   netmap:update-install   → quitAndInstall (закрывает app)
 *
 *   → renderer: netmap:update-status ({ state, info?, progress?, error? })
 *     state: 'checking' | 'available' | 'not-available' | 'downloading'
 *          | 'downloaded' | 'error' | 'disabled'
 *
 * publishConfig (в package.json → build.publish) должен указывать на GitHub
 * repo. Если поле не задано (dev билд) — updater тихо переходит в 'disabled'.
 */

const { app } = require('electron');

let autoUpdater = null;
let mainWindowRef = null;
let disabled = false;

// В деве electron-updater не работает — просто nop.
function isDevMode() {
  return !app.isPackaged;
}

function safeRequireUpdater() {
  if (autoUpdater) return autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
    // Логируем в console main-process — если что-то пошло не так, видно
    // в терминале where the packaged app was launched from OR through
    // Windows event log.
    autoUpdater.logger = console;
    // По-умолчанию сам качает при `available` — оставляем true, renderer
    // просто увидит смену state 'available' → 'downloading' → 'downloaded'.
    autoUpdater.autoDownload = true;
    // НЕ ставим автоматически при exit — пользователь должен явно нажать
    // "Установить и перезапустить".
    autoUpdater.autoInstallOnAppQuit = false;
    return autoUpdater;
  } catch (e) {
    console.warn('[updater] electron-updater unavailable:', e.message);
    disabled = true;
    return null;
  }
}

function sendStatus(payload) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    try { mainWindowRef.webContents.send('netmap:update-status', payload); } catch {}
  }
}

function wireEvents(updater) {
  updater.on('checking-for-update', () => sendStatus({ state: 'checking' }));
  updater.on('update-available',    (info) => sendStatus({ state: 'available', info }));
  updater.on('update-not-available',(info) => sendStatus({ state: 'not-available', info }));
  updater.on('download-progress',   (p)    => sendStatus({
    state: 'downloading',
    progress: {
      percent: Math.round(p.percent),
      bytesPerSecond: p.bytesPerSecond,
      transferred: p.transferred,
      total: p.total,
    },
  }));
  updater.on('update-downloaded',   (info) => sendStatus({ state: 'downloaded', info }));
  updater.on('error',               (err)  => sendStatus({
    state: 'error',
    error: String(err?.stack || err?.message || err),
  }));
}

/** Called once from main.cjs after createWindow(). */
function init(mainWindow) {
  mainWindowRef = mainWindow;
  if (isDevMode()) {
    console.log('[updater] dev mode — updater disabled');
    // Дадим renderer знать, чтобы он не показывал "проверка обновлений…" бесконечно.
    setTimeout(() => sendStatus({ state: 'disabled' }), 1500);
    return;
  }
  const u = safeRequireUpdater();
  if (!u) { sendStatus({ state: 'disabled' }); return; }
  wireEvents(u);
  // Автопроверка через 5 сек после запуска — чтобы не тормозить UX первых кадров.
  setTimeout(() => {
    try { u.checkForUpdates(); }
    catch (e) { sendStatus({ state: 'error', error: String(e?.message || e) }); }
  }, 5000);
}

async function checkNow() {
  if (isDevMode()) return { ok: false, disabled: true, error: 'dev mode' };
  const u = safeRequireUpdater();
  if (!u) return { ok: false, disabled: true };
  try {
    const r = await u.checkForUpdates();
    return { ok: true, updateInfo: r?.updateInfo || null };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function downloadNow() {
  const u = safeRequireUpdater();
  if (!u) return { ok: false, disabled: true };
  try { await u.downloadUpdate(); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

function installNow() {
  const u = safeRequireUpdater();
  if (!u) return { ok: false, disabled: true };
  // Даём renderer время сохранить состояние / показать «до свидания».
  setTimeout(() => {
    try { u.quitAndInstall(false, true); }   // isSilent=false, forceRunAfter=true
    catch (e) { console.error('[updater] quitAndInstall failed', e); }
  }, 400);
  return { ok: true };
}

module.exports = { init, checkNow, downloadNow, installNow, isDisabled: () => disabled };
