/**
 * v0.44.0 — SNMP client wrapper (pure JS via net-snmp).
 *
 * Exposes 4 primitives used by discovery.cjs:
 *   - get(host, community, oids)                 -> Record<oid, value>
 *   - walk(host, community, rootOid, opts)       -> Array<{oid, type, value}>
 *   - table(host, community, rootOid, opts)      -> Array<Record<colOid, value>>
 *   - probe(host, community)                     -> { ok, sysDescr, sysName, sysUpTime }
 *
 * All functions return promises. Errors are caught and returned as
 * `{ ok: false, error: string }` from the top-level `getOne / walkOne / tableOne`
 * wrappers so IPC callers never crash the main process.
 */

'use strict';

const snmp = require('net-snmp');

// ---------- Standard OIDs -------------------------------------------------

const OID = {
  // System group
  sysDescr:    '1.3.6.1.2.1.1.1.0',
  sysObjectID: '1.3.6.1.2.1.1.2.0',
  sysUpTime:   '1.3.6.1.2.1.1.3.0',
  sysContact:  '1.3.6.1.2.1.1.4.0',
  sysName:     '1.3.6.1.2.1.1.5.0',
  sysLocation: '1.3.6.1.2.1.1.6.0',

  // IF-MIB (interfaces)
  ifTable:      '1.3.6.1.2.1.2.2.1',
  ifIndex:      '1.3.6.1.2.1.2.2.1.1',
  ifDescr:      '1.3.6.1.2.1.2.2.1.2',
  ifType:       '1.3.6.1.2.1.2.2.1.3',
  ifMtu:        '1.3.6.1.2.1.2.2.1.4',
  ifSpeed:      '1.3.6.1.2.1.2.2.1.5',
  ifPhysAddr:   '1.3.6.1.2.1.2.2.1.6',
  ifAdminStat:  '1.3.6.1.2.1.2.2.1.7',
  ifOperStat:   '1.3.6.1.2.1.2.2.1.8',
  ifName:       '1.3.6.1.2.1.31.1.1.1.1',        // IF-MIB::ifName
  ifHighSpeed:  '1.3.6.1.2.1.31.1.1.1.15',       // Mbit/s

  // BRIDGE-MIB — forwarding DB
  dot1dTpFdbAddress: '1.3.6.1.2.1.17.4.3.1.1',   // MAC (octets)
  dot1dTpFdbPort:    '1.3.6.1.2.1.17.4.3.1.2',   // bridge port
  dot1dTpFdbStatus:  '1.3.6.1.2.1.17.4.3.1.3',
  dot1dBasePortIf:   '1.3.6.1.2.1.17.1.4.1.2',   // bridge port -> ifIndex

  // IP-MIB — ARP
  ipNetToPhysicalPhysAddress: '1.3.6.1.2.1.4.35.1.4', // ipNetToPhysicalPhysAddress
  ipNetToMediaPhysAddress:    '1.3.6.1.2.1.4.22.1.2', // legacy IPv4 ARP

  // LLDP-MIB — remote neighbors
  lldpRemChassisId:    '1.0.8802.1.1.2.1.4.1.1.5',    // .<time>.<localPort>.<idx>
  lldpRemPortId:       '1.0.8802.1.1.2.1.4.1.1.7',
  lldpRemPortDesc:     '1.0.8802.1.1.2.1.4.1.1.8',
  lldpRemSysName:      '1.0.8802.1.1.2.1.4.1.1.9',
  lldpRemSysDesc:      '1.0.8802.1.1.2.1.4.1.1.10',
  lldpRemManAddr:      '1.0.8802.1.1.2.1.4.2.1',      // sub-table

  // LLDP local ports (map ifIndex under table)
  lldpLocPortId:       '1.0.8802.1.1.2.1.3.7.1.3',    // .<localPort>
  lldpLocPortDesc:     '1.0.8802.1.1.2.1.3.7.1.4',
};

// ---------- Session helpers -----------------------------------------------

function mkSession(host, community, opts = {}) {
  return snmp.createSession(host, community || 'public', {
    port: opts.port || 161,
    retries: opts.retries != null ? opts.retries : 1,
    timeout: opts.timeout || 2500,
    transport: 'udp4',
    trapPort: 162,
    version: snmp.Version2c,
    idBitsSize: 32,
  });
}

function closeSession(sess) {
  try { sess.close(); } catch (_) {}
}

// ---------- Value coercion ------------------------------------------------

function coerce(v) {
  if (v == null) return null;
  const { type, value } = v;
  if (snmp.isVarbindError(v)) return null;
  // OctetString → try utf-8 first, hex if looks binary
  if (type === snmp.ObjectType.OctetString) {
    if (Buffer.isBuffer(value)) {
      // Heuristic: mostly-printable → string, else hex
      const printable = value.every(b => b === 0 || (b >= 0x09 && b <= 0x0d) || (b >= 0x20 && b < 0x7f));
      if (printable) return value.toString('utf8').replace(/\0+$/, '');
      return value.toString('hex').toUpperCase().match(/.{1,2}/g).join(':');
    }
    return String(value);
  }
  if (type === snmp.ObjectType.IpAddress && Buffer.isBuffer(value)) {
    return Array.from(value).join('.');
  }
  if (type === snmp.ObjectType.OID) return String(value);
  if (typeof value === 'bigint') return value.toString();
  return value;
}

// ---------- Primitives ----------------------------------------------------

/**
 * SNMP GET one or more scalar OIDs.
 * @returns Promise<Record<oid, value|null>>
 */
function get(host, community, oids, opts) {
  return new Promise((resolve, reject) => {
    const sess = mkSession(host, community, opts);
    const list = Array.isArray(oids) ? oids : [oids];
    sess.get(list, (err, varbinds) => {
      closeSession(sess);
      if (err) return reject(err);
      const out = {};
      (varbinds || []).forEach((vb, i) => {
        out[list[i]] = coerce(vb);
      });
      resolve(out);
    });
  });
}

/**
 * SNMP walk (subtree).
 * @returns Promise<Array<{oid, value}>>
 */
function walk(host, community, rootOid, opts = {}) {
  return new Promise((resolve, reject) => {
    const sess = mkSession(host, community, opts);
    const results = [];
    const maxRepetitions = opts.maxRepetitions || 20;
    sess.subtree(rootOid, maxRepetitions, (varbinds) => {
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) continue;
        results.push({ oid: vb.oid, value: coerce(vb) });
      }
    }, (err) => {
      closeSession(sess);
      if (err) return reject(err);
      resolve(results);
    });
  });
}

/**
 * SNMP table walk — groups results by index suffix.
 * @param {string} rootOid — table entry OID (e.g. IF-MIB::ifEntry .1.3.6.1.2.1.2.2.1)
 * @returns Promise<Array<Record<colOid, value>>> — each row is `{ __index, <colId>: value }`
 */
async function table(host, community, rootOid, opts = {}) {
  const rows = new Map();
  const items = await walk(host, community, rootOid, opts);
  const rootParts = rootOid.split('.').length;
  for (const it of items) {
    const parts = it.oid.split('.');
    // colId is the part immediately after rootOid; index is everything after
    const colId = parts[rootParts];
    const index = parts.slice(rootParts + 1).join('.');
    if (!rows.has(index)) rows.set(index, { __index: index });
    rows.get(index)[colId] = it.value;
  }
  return Array.from(rows.values());
}

// ---------- Probe ---------------------------------------------------------

/**
 * Quick 4-scalar probe. Returns a normalized object; never throws.
 */
async function probe(host, community, opts) {
  try {
    const r = await get(host, community, [
      OID.sysDescr, OID.sysName, OID.sysUpTime, OID.sysObjectID,
    ], opts);
    return {
      ok: true,
      sysDescr: r[OID.sysDescr] || '',
      sysName:  r[OID.sysName]  || '',
      sysUpTime: r[OID.sysUpTime] || 0,
      sysObjectID: r[OID.sysObjectID] || '',
    };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

// ---------- Safe wrappers (IPC-facing) ------------------------------------

async function getSafe(host, community, oids, opts) {
  try { return { ok: true, values: await get(host, community, oids, opts) }; }
  catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
}

async function walkSafe(host, community, rootOid, opts) {
  try { return { ok: true, items: await walk(host, community, rootOid, opts) }; }
  catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
}

async function tableSafe(host, community, rootOid, opts) {
  try { return { ok: true, rows: await table(host, community, rootOid, opts) }; }
  catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
}

module.exports = {
  OID,
  get,
  walk,
  table,
  probe,
  getSafe,
  walkSafe,
  tableSafe,
};
