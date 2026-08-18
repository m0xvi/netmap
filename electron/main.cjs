// Electron entry point — `npm run electron:dev` and packaged .exe
const { app, BrowserWindow, shell, ipcMain, Menu } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;

// Lazy-loaded because native modules must be required after `app.whenReady`
let dbApi = null;
let vaultApi = null;
let pingApi = null;
let mikrotikApi = null;
let mikrotikSshApi = null;
let telegramApi = null;
let wolApi = null;
let tracerouteApi = null;
let updaterApi = null;
let importersApi = null;
let vaultKdbxApi = null;
let sshShellApi = null;
let faviconApi = null;
let rdpApi = null;
let discoveryApi = null;

function getDb() {
  if (!dbApi) {
    try {
      dbApi = require('./db.cjs');
      dbApi.openDb(app.getPath('userData'));
    } catch (e) {
      console.error('[netmap] SQLite backend unavailable:', e && e.message ? e.message : e);
      // Provide a safe stub so the renderer still works via localStorage fallback
      dbApi = disabledDbStub();
    }
  }
  return dbApi;
}
function disabledDbStub() {
  const err = () => { throw new Error('SQLite backend not loaded (see main-process console)'); };
  return {
    loadDoc: () => null, saveDoc: err,
    listDocBackups: () => [], loadDocBackup: () => null, deleteDocBackup: () => {},
    loadFilters: () => null, saveFilters: err,
    loadTemplates: () => [], saveTemplates: err,
    vaultMetaGet: () => null, vaultMetaSet: err,
    vaultAllItems: () => [], vaultGetItem: () => null,
    vaultUpsertItem: err, vaultDeleteItem: err, vaultTouchAccessed: () => {},
    vaultAuditPush: () => {}, vaultAuditList: () => [], vaultAuditClear: () => {},
    vaultFoldersAll: () => [], vaultFolderUpsert: err, vaultFolderDelete: err,
    vaultResetAll: () => {},
    vaultTouchAccessed: () => {},
    _raw: () => { throw new Error('SQLite backend not loaded'); },
    getDbPath: () => null,
  };
}
function getVault() {
  if (!vaultApi) vaultApi = require('./vault.cjs');
  return vaultApi;
}
function getPing() {
  if (!pingApi) pingApi = require('./ping.cjs');
  return pingApi;
}
function getMikrotik() {
  if (!mikrotikApi) mikrotikApi = require('./mikrotik.cjs');
  return mikrotikApi;
}
function getMikrotikSsh() {
  if (!mikrotikSshApi) mikrotikSshApi = require('./mikrotik-ssh.cjs');
  return mikrotikSshApi;
}
/**
 * v0.35.9 — pick the transport backend based on cfg.transport.
 * `rest` (default) uses HTTP(S) to `/rest/*` endpoints. `ssh` uses ssh2 to
 * drive the RouterOS CLI. Both back-ends expose the same public functions
 * (testConnection / scan / fetch*), so the renderer never has to branch.
 */
function pickMikrotik(cfg) {
  return (cfg && cfg.transport === 'ssh') ? getMikrotikSsh() : getMikrotik();
}
function getTelegram() {
  if (!telegramApi) telegramApi = require('./telegram.cjs');
  return telegramApi;
}
function getWol() {
  if (!wolApi) wolApi = require('./wol.cjs');
  return wolApi;
}
function getTraceroute() {
  if (!tracerouteApi) tracerouteApi = require('./traceroute.cjs');
  return tracerouteApi;
}
function getUpdater() {
  if (!updaterApi) updaterApi = require('./updater.cjs');
  return updaterApi;
}
function getImporters() {
  if (!importersApi) importersApi = require('./importers/index.cjs');
  return importersApi;
}
function getVaultKdbx() {
  if (!vaultKdbxApi) vaultKdbxApi = require('./vault-kdbx.cjs');
  return vaultKdbxApi;
}
function getSshShell() {
  if (!sshShellApi) sshShellApi = require('./ssh-shell.cjs');
  return sshShellApi;
}
function getFavicon() {
  if (!faviconApi) faviconApi = require('./favicon.cjs');
  return faviconApi;
}
function getRdp() {
  if (!rdpApi) rdpApi = require('./rdp.cjs');
  return rdpApi;
}
function getDiscovery() {
  if (!discoveryApi) discoveryApi = require('./discovery.cjs');
  return discoveryApi;
}

function safeInvoke(fn) {
  return async (...args) => {
    try { return await fn(...args); }
    catch (e) {
      console.error('[netmap ipc] handler failed:', e && e.message ? e.message : e);
      return { ok: false, error: String(e && e.message || e) };
    }
  };
}

function registerIpc() {
  // ---- Doc ----
  ipcMain.handle('netmap:loadDoc', safeInvoke(() => getDb().loadDoc()));
  ipcMain.handle('netmap:saveDoc', safeInvoke((_e, doc) => getDb().saveDoc(doc)));
  // v0.41.1: rolling backups of the doc — restore point safety net.
  ipcMain.handle('netmap:listDocBackups',  safeInvoke(() => getDb().listDocBackups()));
  ipcMain.handle('netmap:loadDocBackup',   safeInvoke((_e, id) => getDb().loadDocBackup(id)));
  ipcMain.handle('netmap:deleteDocBackup', safeInvoke((_e, id) => getDb().deleteDocBackup(id)));

  // ---- Filters ----
  ipcMain.handle('netmap:loadFilters', safeInvoke(() => getDb().loadFilters()));
  ipcMain.handle('netmap:saveFilters', safeInvoke((_e, f) => getDb().saveFilters(f)));

  // ---- Templates ----
  ipcMain.handle('netmap:loadTemplates', safeInvoke(() => getDb().loadTemplates()));
  ipcMain.handle('netmap:saveTemplates', safeInvoke((_e, list) => getDb().saveTemplates(list)));

  // ---- Vault ----
  ipcMain.handle('netmap:vaultInit',   safeInvoke((_e, pw) => getVault().init(getDb(), pw)));
  ipcMain.handle('netmap:vaultUnlock', safeInvoke((_e, pw) => getVault().unlock(getDb(), pw)));
  ipcMain.handle('netmap:vaultLock',   safeInvoke(() => getVault().lock(getDb())));
  ipcMain.handle('netmap:vaultStatus', safeInvoke(() => getVault().status(getDb())));
  ipcMain.handle('netmap:vaultList',   safeInvoke(() => getVault().listItems(getDb())));
  ipcMain.handle('netmap:vaultGet',    safeInvoke((_e, id) => getVault().getItem(getDb(), id)));
  ipcMain.handle('netmap:vaultUpsert', safeInvoke((_e, item) => getVault().upsertItem(getDb(), item)));
  ipcMain.handle('netmap:vaultDelete', safeInvoke((_e, id) => getVault().deleteItem(getDb(), id)));
  ipcMain.handle('netmap:vaultImport', safeInvoke((_e, payload) => getVault().importPayload(getDb(), payload)));
  // v0.38: extended vault manager
  ipcMain.handle('netmap:vaultTotp',        safeInvoke((_e, id) => getVault().totp(getDb(), id)));
  ipcMain.handle('netmap:vaultGenPw',       safeInvoke((_e, opts) => ({ ok: true, password: getVault().generatePassword(opts) })));
  ipcMain.handle('netmap:vaultAuditList',   safeInvoke((_e, limit) => getVault().auditList(getDb(), limit)));
  ipcMain.handle('netmap:vaultAuditClear',  safeInvoke(() => getVault().auditClear(getDb())));
  ipcMain.handle('netmap:vaultFoldersAll',  safeInvoke(() => getVault().foldersAll(getDb())));
  ipcMain.handle('netmap:vaultFolderUpsert',safeInvoke((_e, f) => getVault().folderUpsert(getDb(), f)));
  ipcMain.handle('netmap:vaultFolderDelete',safeInvoke((_e, id) => getVault().folderDelete(getDb(), id)));
  ipcMain.handle('netmap:vaultSetIdle',     safeInvoke((_e, ms) => { getVault().setIdleTimeout(ms); return { ok: true }; }));
  ipcMain.handle('netmap:vaultTouch',       safeInvoke(() => { getVault().touch(); return { ok: true }; }));

  // v0.39: KeePass .kdbx bridge — parse/build with kdbxweb + Node webcrypto.
  // Renderer sends {base64, password} for import, gets {items, folders}
  // and pushes them through the normal vaultUpsert path so audit + history
  // are consistent. Export goes the other way: renderer sends selected
  // items + folders (already decrypted) and password, gets base64 back.
  ipcMain.handle('netmap:vaultKdbxParse', safeInvoke((_e, { base64, password }) =>
    getVaultKdbx().parseKdbx(base64, password)
  ));
  ipcMain.handle('netmap:vaultKdbxBuild', safeInvoke((_e, { items, folders, dbName, password }) =>
    getVaultKdbx().buildKdbx({ items, folders, dbName }, password)
  ));
  // v0.39: bulk-decrypt for export (Bitwarden JSON / kdbx / CSV).
  // Only callable when vault is unlocked. Never persists to disk on its own.
  ipcMain.handle('netmap:vaultExportAll', safeInvoke((_e, opts) =>
    getVault().exportAll(getDb(), opts || {})
  ));
  // v0.39.1: "forgot password" — wipes all vault data (does not touch
  // the main doc). UI confirms before calling this.
  ipcMain.handle('netmap:vaultReset', safeInvoke(() => getVault().reset(getDb())));

  // v0.40: interactive SSH shell (streams stdin/stdout via events).
  ipcMain.handle('netmap:sshOpen',   safeInvoke((e, cfg) => getSshShell().open(cfg, e.sender)));
  ipcMain.handle('netmap:sshWrite',  safeInvoke((_e, { sessionId, data }) => getSshShell().write(sessionId, data)));
  ipcMain.handle('netmap:sshResize', safeInvoke((_e, { sessionId, cols, rows }) => getSshShell().resize(sessionId, cols, rows)));
  ipcMain.handle('netmap:sshClose',  safeInvoke((_e, { sessionId }) => getSshShell().close(sessionId)));

  // v0.40: favicon fetcher with SQLite cache.
  ipcMain.handle('netmap:favicon', safeInvoke((_e, url) => getFavicon().get(getDb(), url)));

  // v0.43: RDP launcher — generates a .rdp file and hands it to the OS.
  ipcMain.handle('netmap:rdpLaunch', safeInvoke((_e, cfg) => getRdp().launch(cfg)));

  // ---- Ping monitor ----
  ipcMain.handle('netmap:ping',      safeInvoke((_e, host, opts) => getPing().probe(host, opts)));
  ipcMain.handle('netmap:pingBatch', safeInvoke((_e, items, opts) => getPing().probeBatch(items, opts)));

  // ---- MikroTik REST importer ----
  ipcMain.handle('netmap:mikrotikTest',   safeInvoke((_e, cfg) => pickMikrotik(cfg).testConnection(cfg)));
  ipcMain.handle('netmap:mikrotikScan',   safeInvoke((_e, cfg) => pickMikrotik(cfg).scan(cfg)));
  // v0.35.10 — raw output debug (SSH-only, for when the parser silently returns nothing).
  ipcMain.handle('netmap:mikrotikDebug',  safeInvoke((_e, cfg) => {
    const m = pickMikrotik(cfg);
    if (typeof m.fetchRawDebug !== 'function') {
      throw new Error('Отладка сырого ответа доступна только через SSH-транспорт');
    }
    return m.fetchRawDebug(cfg);
  }));

  // ---- v0.36.1: Telegram sender ----
  ipcMain.handle('netmap:telegramSend', safeInvoke((_e, cfg) => getTelegram().send(cfg)));

  // ---- v0.36.2: Wake-on-LAN ----
  ipcMain.handle('netmap:wolSend', safeInvoke((_e, cfg) => getWol().send(cfg)));

  // ---- v0.36.2: ICMP traceroute (streams hops to sender via events) ----
  ipcMain.handle('netmap:tracerouteStart', safeInvoke((e, cfg) => getTraceroute().start(cfg, e.sender)));
  ipcMain.handle('netmap:tracerouteStop',  safeInvoke((_e, { requestId }) => getTraceroute().stop(requestId)));

  // ---- v0.37: per-vendor importers (UniFi / Omada Cloud / Ruijie / D-Link / EdgeSwitch) ----
  ipcMain.handle('netmap:importTest', safeInvoke((_e, { vendor, config }) => getImporters().testConnection(vendor, config)));
  ipcMain.handle('netmap:importScan', safeInvoke((_e, { vendor, config }) => getImporters().scan(vendor, config)));

  // ---- v0.44: auto-discovery (LLDP+FDB+ARP → diff proposal) ----
  ipcMain.handle('netmap:discoveryTest', safeInvoke((_e, cfg) => getDiscovery().test(cfg)));
  ipcMain.handle('netmap:discoveryScan', safeInvoke((_e, cfg) => getDiscovery().scan(cfg)));

  // ---- v0.36.2: auto-updater (electron-updater + GitHub Releases) ----
  ipcMain.handle('netmap:updateCheck',    safeInvoke(() => getUpdater().checkNow()));
  ipcMain.handle('netmap:updateDownload', safeInvoke(() => getUpdater().downloadNow()));
  ipcMain.handle('netmap:updateInstall',  safeInvoke(() => getUpdater().installNow()));

  // ---- Info ----
  ipcMain.handle('netmap:getDbPath', safeInvoke(() => getDb().getDbPath()));
}

function createWindow() {
  // v0.35.7: use packed app icon for the window (title bar + taskbar).
  // In dev the .ico lives under project/build/, in production it's copied
  // into the app resources folder by electron-builder.
  const iconPath = isDev
    ? path.join(__dirname, '..', 'build', 'icon.ico')
    : path.join(process.resourcesPath, 'build', 'icon.ico');

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#F9FAFB',
    autoHideMenuBar: true,
    icon: iconPath,
    title: 'NetMap',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  // Enable DevTools shortcut in production too (F12, Ctrl+Shift+I)
  const template = [
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
    ]},
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    // Absolute file path — path is relative to __dirname (electron/), dist is one level up
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
    console.log('[netmap] loading', indexPath);
    win.loadFile(indexPath);
  }

  // If the renderer fails to load, open DevTools automatically so the error is visible
  win.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
    console.error(`[netmap] did-fail-load ${code} ${description} — ${validatedURL}`);
    win.webContents.openDevTools({ mode: 'detach' });
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[netmap] renderer gone:', details);
    win.webContents.openDevTools({ mode: 'detach' });
  });
  // Also auto-open DevTools once if the page loads but appears empty (heuristic: no <div> children in #root)
  win.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      win.webContents.executeJavaScript(
        `document.getElementById('root') && document.getElementById('root').children.length`
      ).then((n) => {
        if (!n) {
          console.warn('[netmap] #root is empty after load — opening DevTools');
          win.webContents.openDevTools({ mode: 'detach' });
        }
      }).catch(() => {});
    }, 800);
  });

  // Open external links in the default browser instead of a new Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handy: F12 to toggle DevTools in prod
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      win.webContents.toggleDevTools();
    }
  });

  // v0.36.2: bootstrap the auto-updater. Runs a check ~5s after window is
  // created so the initial UX (splash + hydrate) isn't slowed down. All
  // events (checking / available / downloading / downloaded / error /
  // disabled) are pushed to renderer via `netmap:update-status`.
  try { getUpdater().init(win); }
  catch (e) { console.warn('[updater] init failed:', e && e.message ? e.message : e); }

  // v0.38: auto-lock the vault after idle. Renderer sends `vaultSetIdle`
  // from Settings, `vaultTouch` on every keystroke/mouse move. When the
  // timer fires, we notify the renderer so it can show the unlock overlay.
  try {
    getVault().setAutoLockCallback(() => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('netmap:vault-auto-locked');
      }
    });
  } catch (e) { console.warn('[vault] auto-lock hook failed:', e && e.message ? e.message : e); }
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
