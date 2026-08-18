/**
 * v0.37 — Ruijie Cloud importer STUB.
 *
 * Real implementation planned for v0.38. Ruijie Cloud
 * (https://noc.ruijienetworks.com) exposes an OpenAPI at
 * /openapi/v1/... with token-based auth. Requires an API key issued by
 * Ruijie Cloud admin console.
 *
 * For now: dialog opens, user can fill in fields, "Test" and "Scan"
 * return a friendly not-implemented message so the UI is discoverable.
 */

async function testConnection(_cfg) {
  return {
    ok: false,
    error: 'Ruijie Cloud импорт запланирован на v0.38. Пока используйте ручное добавление устройств.',
  };
}

async function scan(_cfg) {
  return {
    resource: {
      ok: false,
      error: 'Ruijie Cloud импорт запланирован на v0.38.',
    },
    leases: [], arp: [], interfaces: [], vlans: [], addresses: [],
    notImplemented: true,
  };
}

module.exports = { testConnection, scan };
