/**
 * v0.37 — D-Link importer STUB.
 *
 * D-Link has no unified controller — each family (DGS/DES/DXS) uses different
 * management approaches: SNMP (v2c/v3), telnet CLI, or vendor-specific web
 * scraping. Real implementation planned for v0.38 will start with SNMP walk
 * of ifTable + arpNetToMediaTable using `net-snmp`.
 */

async function testConnection(_cfg) {
  return {
    ok: false,
    error: 'D-Link импорт (SNMP walk) запланирован на v0.38. Пока используйте ручное добавление.',
  };
}

async function scan(_cfg) {
  return {
    resource: {
      ok: false,
      error: 'D-Link импорт запланирован на v0.38.',
    },
    leases: [], arp: [], interfaces: [], vlans: [], addresses: [],
    notImplemented: true,
  };
}

module.exports = { testConnection, scan };
