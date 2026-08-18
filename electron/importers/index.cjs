/**
 * v0.37 — per-vendor importer registry.
 *
 * All importers expose the same public surface so the renderer never has to
 * branch on vendor:
 *
 *     module.testConnection(cfg)  -> { ok, identity?, version?, error? }
 *     module.scan(cfg)            -> ScanResult (see mikrotikClient.ts)
 *
 * ScanResult shape (subset, only what the ImportDialog cares about):
 *   {
 *     resource:   { ok, identity?, version?, error? },
 *     leases:     [{ mac, ip, hostname, comment, dynamic, status, server, expiresAfter }],
 *     arp:        [{ mac, ip, interface, dynamic, complete }],
 *     interfaces: [{ name, type, mac, running, disabled, comment }],
 *     vlans?:     [{ vlanId, name, iface?, taggedPorts?, untaggedPorts?, comment? }],
 *     addresses?: [{ address, network, interface, comment, disabled }],
 *     vendor:     'unifi' | 'omada-cloud' | 'ruijie' | 'dlink' | 'edgeswitch',
 *   }
 *
 * MikroTik is NOT registered here — it stays in its own dedicated
 * MikrotikImportDialog because its transport (SSH) and knobs are quite
 * different. But the renderer treats it as "vendor: mikrotik" in the
 * unified ImportDialog dropdown by opening the legacy dialog on select.
 */

let unifiApi = null;
let omadaCloudApi = null;
let ruijieApi = null;
let dlinkApi = null;
let edgeswitchApi = null;

function get(name) {
  switch (name) {
    case 'unifi':
      if (!unifiApi) unifiApi = require('./unifi.cjs');
      return unifiApi;
    case 'omada-cloud':
      if (!omadaCloudApi) omadaCloudApi = require('./omada-cloud.cjs');
      return omadaCloudApi;
    case 'ruijie':
      if (!ruijieApi) ruijieApi = require('./ruijie.cjs');
      return ruijieApi;
    case 'dlink':
      if (!dlinkApi) dlinkApi = require('./dlink.cjs');
      return dlinkApi;
    case 'edgeswitch':
      if (!edgeswitchApi) edgeswitchApi = require('./edgeswitch.cjs');
      return edgeswitchApi;
    default:
      throw new Error(`Unknown importer vendor: ${name}`);
  }
}

async function testConnection(vendor, cfg) {
  const mod = get(vendor);
  return mod.testConnection(cfg);
}

async function scan(vendor, cfg) {
  const mod = get(vendor);
  const res = await mod.scan(cfg);
  if (res && typeof res === 'object') res.vendor = vendor;
  return res;
}

module.exports = { get, testConnection, scan };
