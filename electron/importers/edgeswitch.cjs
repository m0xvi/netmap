/**
 * v0.37 — Ubiquiti EdgeSwitch importer STUB.
 *
 * EdgeSwitch (EdgeMAX) is managed via SSH CLI (`show mac-address-table`,
 * `show interfaces status`, `show ip arp`). Real implementation planned for
 * v0.38 will reuse the ssh2 client we already use for MikroTik and add a
 * dedicated parser for EdgeSwitch's tabular output.
 */

async function testConnection(_cfg) {
  return {
    ok: false,
    error: 'Ubiquiti EdgeSwitch импорт (SSH CLI) запланирован на v0.38.',
  };
}

async function scan(_cfg) {
  return {
    resource: {
      ok: false,
      error: 'Ubiquiti EdgeSwitch импорт запланирован на v0.38.',
    },
    leases: [], arp: [], interfaces: [], vlans: [], addresses: [],
    notImplemented: true,
  };
}

module.exports = { testConnection, scan };
