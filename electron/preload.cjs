// Preload runs in a privileged context but exposes only a narrow API to the renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('netmap', {
  // Doc storage
  loadDoc:    () => ipcRenderer.invoke('netmap:loadDoc'),
  saveDoc:    (doc) => ipcRenderer.invoke('netmap:saveDoc', doc),
  // v0.41.1: doc backup / restore
  listDocBackups:  () => ipcRenderer.invoke('netmap:listDocBackups'),
  loadDocBackup:   (id) => ipcRenderer.invoke('netmap:loadDocBackup', id),
  deleteDocBackup: (id) => ipcRenderer.invoke('netmap:deleteDocBackup', id),

  // Filters (small key/value)
  loadFilters: () => ipcRenderer.invoke('netmap:loadFilters'),
  saveFilters: (f) => ipcRenderer.invoke('netmap:saveFilters', f),

  // Templates
  loadTemplates: () => ipcRenderer.invoke('netmap:loadTemplates'),
  saveTemplates: (list) => ipcRenderer.invoke('netmap:saveTemplates', list),

  // Vault (v0.6, exposed here for forward-compat; backend is added later)
  vaultUnlock:  (masterPassword) => ipcRenderer.invoke('netmap:vaultUnlock', masterPassword),
  vaultInit:    (masterPassword) => ipcRenderer.invoke('netmap:vaultInit', masterPassword),
  vaultLock:    () => ipcRenderer.invoke('netmap:vaultLock'),
  vaultStatus:  () => ipcRenderer.invoke('netmap:vaultStatus'),
  vaultList:    () => ipcRenderer.invoke('netmap:vaultList'),
  vaultGet:     (id) => ipcRenderer.invoke('netmap:vaultGet', id),
  vaultUpsert:  (item) => ipcRenderer.invoke('netmap:vaultUpsert', item),
  vaultDelete:  (id) => ipcRenderer.invoke('netmap:vaultDelete', id),
  vaultImport:  (payload) => ipcRenderer.invoke('netmap:vaultImport', payload),
  // v0.38: extended vault manager
  vaultTotp:         (id) => ipcRenderer.invoke('netmap:vaultTotp', id),
  vaultGenPw:        (opts) => ipcRenderer.invoke('netmap:vaultGenPw', opts),
  vaultAuditList:    (limit) => ipcRenderer.invoke('netmap:vaultAuditList', limit),
  vaultAuditClear:   () => ipcRenderer.invoke('netmap:vaultAuditClear'),
  vaultFoldersAll:   () => ipcRenderer.invoke('netmap:vaultFoldersAll'),
  vaultFolderUpsert: (f) => ipcRenderer.invoke('netmap:vaultFolderUpsert', f),
  vaultFolderDelete: (id) => ipcRenderer.invoke('netmap:vaultFolderDelete', id),
  vaultSetIdle:      (ms) => ipcRenderer.invoke('netmap:vaultSetIdle', ms),
  vaultTouch:        () => ipcRenderer.invoke('netmap:vaultTouch'),
  onVaultAutoLocked: (cb) => {
    const h = () => cb();
    ipcRenderer.on('netmap:vault-auto-locked', h);
    return () => ipcRenderer.off('netmap:vault-auto-locked', h);
  },
  // v0.39: KeePass .kdbx + generic bulk export
  vaultKdbxParse: (payload) => ipcRenderer.invoke('netmap:vaultKdbxParse', payload),
  vaultKdbxBuild: (payload) => ipcRenderer.invoke('netmap:vaultKdbxBuild', payload),
  vaultExportAll: (opts) => ipcRenderer.invoke('netmap:vaultExportAll', opts),
  vaultReset: () => ipcRenderer.invoke('netmap:vaultReset'),

  // v0.40: interactive SSH shell (uses ssh2, no node-pty needed)
  sshOpen:   (cfg) => ipcRenderer.invoke('netmap:sshOpen', cfg),
  sshWrite:  (payload) => ipcRenderer.invoke('netmap:sshWrite', payload),
  sshResize: (payload) => ipcRenderer.invoke('netmap:sshResize', payload),
  sshClose:  (payload) => ipcRenderer.invoke('netmap:sshClose', payload),
  onSshData:  (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('netmap:ssh-data', h);
    return () => ipcRenderer.off('netmap:ssh-data', h);
  },
  onSshClose: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('netmap:ssh-close', h);
    return () => ipcRenderer.off('netmap:ssh-close', h);
  },
  onSshError: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('netmap:ssh-error', h);
    return () => ipcRenderer.off('netmap:ssh-error', h);
  },

  // v0.40: favicon fetcher with SQLite cache
  favicon: (url) => ipcRenderer.invoke('netmap:favicon', url),

  // v0.43: RDP launcher (Windows-only auto-launch; other OS opens .rdp in default app)
  rdpLaunch: (cfg) => ipcRenderer.invoke('netmap:rdpLaunch', cfg),

  // Ping monitor
  ping:      (host, opts) => ipcRenderer.invoke('netmap:ping', host, opts),
  pingBatch: (items, opts) => ipcRenderer.invoke('netmap:pingBatch', items, opts),

  // MikroTik REST importer
  mikrotikTest:  (cfg) => ipcRenderer.invoke('netmap:mikrotikTest',  cfg),
  mikrotikScan:  (cfg) => ipcRenderer.invoke('netmap:mikrotikScan',  cfg),
  mikrotikDebug: (cfg) => ipcRenderer.invoke('netmap:mikrotikDebug', cfg),

  // v0.37: unified per-vendor importers (UniFi / Omada Cloud / Ruijie / D-Link / EdgeSwitch)
  importTest: (payload) => ipcRenderer.invoke('netmap:importTest', payload),
  importScan: (payload) => ipcRenderer.invoke('netmap:importScan', payload),

  // v0.44: auto-discovery (LLDP + FDB + ARP via SSH/SNMP → diff proposal)
  discoveryTest: (cfg) => ipcRenderer.invoke('netmap:discoveryTest', cfg),
  discoveryScan: (cfg) => ipcRenderer.invoke('netmap:discoveryScan', cfg),

  // v0.36.1: Telegram notifications
  telegramSend:  (cfg) => ipcRenderer.invoke('netmap:telegramSend',  cfg),

  // v0.36.2: Wake-on-LAN
  wolSend: (cfg) => ipcRenderer.invoke('netmap:wolSend', cfg),

  // v0.36.2: ICMP traceroute — starts a streaming session, listen to
  // `netmap:traceroute-hop` / `netmap:traceroute-done` events for results.
  tracerouteStart: (cfg) => ipcRenderer.invoke('netmap:tracerouteStart', cfg),
  tracerouteStop:  (cfg) => ipcRenderer.invoke('netmap:tracerouteStop',  cfg),
  onTracerouteHop:  (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('netmap:traceroute-hop', h);
    return () => ipcRenderer.off('netmap:traceroute-hop', h);
  },
  onTracerouteDone: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('netmap:traceroute-done', h);
    return () => ipcRenderer.off('netmap:traceroute-done', h);
  },

  // v0.36.2: auto-updater (electron-updater + GitHub Releases)
  updateCheck:    () => ipcRenderer.invoke('netmap:updateCheck'),
  updateDownload: () => ipcRenderer.invoke('netmap:updateDownload'),
  updateInstall:  () => ipcRenderer.invoke('netmap:updateInstall'),
  onUpdateStatus: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('netmap:update-status', h);
    return () => ipcRenderer.off('netmap:update-status', h);
  },

  // Utility: paths / info
  getDbPath: () => ipcRenderer.invoke('netmap:getDbPath'),
});
