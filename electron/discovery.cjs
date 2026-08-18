/**
 * v0.44.0 — Auto-discovery orchestrator.
 *
 * Two data sources:
 *   1) MikroTik SSH  — /ip/neighbor, /interface/bridge/host, /ip/arp
 *   2) SNMP LLDP     — universal via LLDP-MIB (works on any managed switch with SNMP)
 *      + BRIDGE-MIB FDB fallback when LLDP is silent
 *
 * The orchestrator returns a *diff proposal* — arrays of new devices and links
 * with stable predicted ids so the renderer can display checkboxes and let the
 * user pick which ones to merge. Nothing is written to the doc from the
 * backend; store.applyDiscovery() does the actual merge with proper undo.
 *
 * Output schema (see docs at bottom of this file):
 *   {
 *     ok: true,
 *     rootHost: '192.168.11.1',
 *     source: 'mikrotik' | 'snmp' | 'both',
 *     seeds: [{ host, name, mac, model, vendor, snmp?, ssh? }],   // switches we polled
 *     proposedDevices: [{ tempId, ip, mac, name, vendor, kind, hint }],
 *     proposedLinks:   [{ tempId, fromRef, fromPort, toRef, toPort, cable, evidence }],
 *     warnings: [string],
 *     stats: { neighborsFound, fdbEntries, arpEntries, ms }
 *   }
 *
 * `fromRef` / `toRef` can be either:
 *   - `{ existingId: 'dev_xxx' }`  — matched an existing device by IP or MAC
 *   - `{ tempId: 'new_yyy' }`      — refers to a proposedDevices entry
 */

'use strict';

const snmpApi = require('./snmp.cjs');
let mikrotikSsh = null;
function getMt() { if (!mikrotikSsh) mikrotikSsh = require('./mikrotik-ssh.cjs'); return mikrotikSsh; }

// ---------- Utilities -----------------------------------------------------

const RID = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();

function normMac(m) {
  if (!m) return '';
  const s = String(m).replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (s.length !== 12) return '';
  return s.match(/.{2}/g).join(':');
}
function normIp(ip) {
  if (!ip) return '';
  const s = String(ip).trim();
  // Basic sanity: 4 dotted decimals in 0..255
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return '';
  for (let i = 1; i <= 4; i++) if (Number(m[i]) > 255) return '';
  return s;
}

function guessKindFromDescr(descr) {
  if (!descr) return 'switch';
  const s = descr.toLowerCase();
  if (/routeros|mikrotik/.test(s) && /router|hex|ccr|rb/.test(s)) return 'router';
  if (/mikrotik|routeros/.test(s)) return 'switch';
  if (/unifi|ubnt|ap-ac|nanostation|uap/.test(s)) return 'ap';
  if (/access ?point|wireless/.test(s)) return 'ap';
  if (/switch|catalyst|procurve|dgs-|dgs |edgeswitch|s5|s6|s3/.test(s)) return 'switch';
  if (/camera|ipcam|hikvision|dahua|axis/.test(s)) return 'camera';
  if (/printer|laserjet|kyocera/.test(s)) return 'printer';
  return 'switch';
}

function guessVendor(descr, oid) {
  const s = (descr || '').toLowerCase();
  if (/mikrotik|routeros/.test(s)) return 'MikroTik';
  if (/unifi|ubnt|ubiquiti/.test(s)) return 'Ubiquiti';
  if (/tp-link|tplink|omada/.test(s)) return 'TP-Link';
  if (/cisco/.test(s)) return 'Cisco';
  if (/hikvision/.test(s)) return 'Hikvision';
  if (/dahua/.test(s)) return 'Dahua';
  if (/d-link|dlink|dgs-/.test(s)) return 'D-Link';
  if (/ruijie|reyee/.test(s)) return 'Ruijie';
  if (/hp |hpe |procurve|aruba/.test(s)) return 'HPE/Aruba';
  if (/juniper/.test(s)) return 'Juniper';
  // OID-based fallbacks (well-known enterprise numbers)
  if (oid) {
    if (/^1\.3\.6\.1\.4\.1\.14988\b/.test(oid)) return 'MikroTik';
    if (/^1\.3\.6\.1\.4\.1\.41112\b/.test(oid)) return 'Ubiquiti';
    if (/^1\.3\.6\.1\.4\.1\.9\b/.test(oid)) return 'Cisco';
    if (/^1\.3\.6\.1\.4\.1\.11\b/.test(oid)) return 'HPE';
    if (/^1\.3\.6\.1\.4\.1\.171\b/.test(oid)) return 'D-Link';
    if (/^1\.3\.6\.1\.4\.1\.4526\b/.test(oid)) return 'Netgear';
    if (/^1\.3\.6\.1\.4\.1\.25506\b/.test(oid)) return 'H3C';
    if (/^1\.3\.6\.1\.4\.1\.25461\b/.test(oid)) return 'Palo Alto';
    if (/^1\.3\.6\.1\.4\.1\.4881\b/.test(oid)) return 'Ruijie';
  }
  return '';
}

// ---------- Matching against existing doc ---------------------------------

/**
 * Build fast lookup indexes over the current doc so we can attach discovered
 * data to existing devices when possible.
 */
function indexDoc(doc) {
  const byIp  = new Map();
  const byMac = new Map();
  const byName = new Map();
  const devicePorts = new Map(); // deviceId -> Map(portLabel|portId -> portId)
  if (!doc || !Array.isArray(doc.devices)) return { byIp, byMac, byName, devicePorts };

  for (const d of doc.devices) {
    if (d.ip)  byIp.set(String(d.ip).trim(), d.id);
    if (d.mac) {
      const m = normMac(d.mac);
      if (m) byMac.set(m, d.id);
    }
    if (d.name) byName.set(d.name.toLowerCase(), d.id);
    const pm = new Map();
    for (const p of (d.ports || [])) {
      if (p.id) pm.set(String(p.id).toLowerCase(), p.id);
      if (p.label) pm.set(String(p.label).toLowerCase(), p.id);
    }
    devicePorts.set(d.id, pm);
    // Additional MAC index — port-level MAC extracted from label like "eth1 (AA:BB:...)".
    for (const p of (d.ports || [])) {
      const macIn = (p.label || '').match(/([0-9A-Fa-f]{2}([:-]?[0-9A-Fa-f]{2}){5})/);
      if (macIn) {
        const m = normMac(macIn[1]);
        if (m && !byMac.has(m)) byMac.set(m, d.id);
      }
    }
  }
  return { byIp, byMac, byName, devicePorts };
}

function matchDevice(idx, { ip, mac, name }) {
  if (mac) {
    const m = normMac(mac);
    if (m && idx.byMac.has(m)) return { existingId: idx.byMac.get(m) };
  }
  if (ip) {
    const i = normIp(ip);
    if (i && idx.byIp.has(i)) return { existingId: idx.byIp.get(i) };
  }
  if (name) {
    const n = name.toLowerCase();
    if (idx.byName.has(n)) return { existingId: idx.byName.get(n) };
  }
  return null;
}

function findPortIdOnDevice(idx, deviceId, portLabel) {
  if (!portLabel) return null;
  const pm = idx.devicePorts.get(deviceId);
  if (!pm) return null;
  const s = String(portLabel).toLowerCase().trim();
  if (pm.has(s)) return pm.get(s);
  // Try alternate forms: "ether1" / "eth1" / "1"
  const digits = s.match(/(\d+)$/);
  if (digits) {
    for (const [k, v] of pm.entries()) {
      const km = k.match(/(\d+)$/);
      if (km && km[1] === digits[1]) return v;
    }
  }
  return null;
}

// ---------- MikroTik SSH source -------------------------------------------

/**
 * Parse `/ip/neighbor print terse` output. Fields: interface, address, mac-address,
 * identity, platform, version, board.
 */
function parseTerseLines(out) {
  const rows = [];
  if (!out) return rows;
  const lines = String(out).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Skip header/flag legend rows
    if (/^Flags?:/.test(line)) continue;
    if (/^Columns?:/.test(line)) continue;
    if (!/=/.test(line)) continue;
    const kv = {};
    // Strip leading "N  " or "N X " prefix (row index + flags)
    let rest = line.replace(/^(\d+)\s+([A-Z*]+)?\s*/, '');
    // MikroTik "print terse" uses foo=bar with quoted values that may contain spaces
    // Simple state machine to split on whitespace unless in quotes.
    let buf = '', inQ = false;
    const tokens = [];
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i];
      if (c === '"') { inQ = !inQ; buf += c; continue; }
      if (c === ' ' && !inQ) { if (buf) { tokens.push(buf); buf = ''; } continue; }
      buf += c;
    }
    if (buf) tokens.push(buf);
    for (const t of tokens) {
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq);
      let v = t.slice(eq + 1);
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      kv[k] = v;
    }
    if (Object.keys(kv).length) rows.push(kv);
  }
  return rows;
}

async function collectMikrotik(cfg, opts) {
  const mt = getMt();
  const out = {
    ok: false,
    self: { name: '', model: '', vendor: 'MikroTik' },
    neighbors: [],
    arp: [],
    fdb: [],
    interfaces: [],
    warnings: [],
  };
  try {
    const [ident, resource, neighTerse, arpTerse, ifTerse, fdb] = await Promise.all([
      mt.runCommand(cfg, ':put [/system identity get name]').catch(() => ''),
      mt.runCommand(cfg, '/system resource print without-paging').catch(() => ''),
      mt.runCommand(cfg, '/ip neighbor print terse without-paging').catch(() => ''),
      mt.runCommand(cfg, '/ip arp print terse without-paging').catch(() => ''),
      mt.runCommand(cfg, '/interface print terse without-paging').catch(() => ''),
      mt.runCommand(cfg, '/interface bridge host print terse without-paging').catch(() => ''),
    ]);
    out.self.name = String(ident || '').trim().split(/\r?\n/)[0] || cfg.host;
    for (const l of String(resource || '').split(/\r?\n/)) {
      const m = /^\s*board-name:\s*(.+?)\s*$/i.exec(l);
      if (m) out.self.model = m[1];
    }

    for (const row of parseTerseLines(neighTerse)) {
      out.neighbors.push({
        localIface: row['interface'] || row['int'] || '',
        ip:         normIp(row['address'] || row['address4'] || ''),
        mac:        normMac(row['mac-address'] || row['mac'] || ''),
        name:       row['identity'] || '',
        platform:   row['platform'] || '',
        version:    row['version']  || '',
        board:      row['board']    || row['board-name'] || '',
      });
    }
    for (const row of parseTerseLines(arpTerse)) {
      out.arp.push({
        ip:  normIp(row['address'] || ''),
        mac: normMac(row['mac-address'] || ''),
        iface: row['interface'] || '',
      });
    }
    for (const row of parseTerseLines(ifTerse)) {
      out.interfaces.push({
        name: row['name'] || '',
        type: row['type'] || '',
        mac:  normMac(row['mac-address'] || ''),
      });
    }
    for (const row of parseTerseLines(fdb)) {
      out.fdb.push({
        mac: normMac(row['mac-address'] || ''),
        onIface: row['on-interface'] || row['interface'] || '',
        bridge:  row['bridge'] || '',
      });
    }
    out.ok = true;
  } catch (e) {
    out.warnings.push('MikroTik SSH: ' + (e && e.message ? e.message : String(e)));
  }
  return out;
}

// ---------- SNMP source ---------------------------------------------------

async function collectSnmp(host, community, opts) {
  const out = {
    ok: false,
    host,
    self: { name: '', descr: '', vendor: '', kind: 'switch' },
    lldp: [],       // {localPort, chassisId, portId, sysName, sysDesc, portDesc}
    fdb: [],        // {mac, bridgePort}
    ifNames: {},    // ifIndex -> ifName/ifDescr
    warnings: [],
  };
  const scanOpts = { timeout: (opts && opts.timeout) || 2500, retries: 1 };
  try {
    const probe = await snmpApi.probe(host, community, scanOpts);
    if (!probe.ok) {
      out.warnings.push('SNMP probe failed: ' + probe.error);
      return out;
    }
    out.self.descr = probe.sysDescr || '';
    out.self.name  = probe.sysName  || '';
    out.self.vendor = guessVendor(probe.sysDescr, probe.sysObjectID);
    out.self.kind = guessKindFromDescr(probe.sysDescr);

    // Interface names
    try {
      const ifTbl = await snmpApi.table(host, community, snmpApi.OID.ifTable, scanOpts);
      for (const row of ifTbl) {
        const idx = row.__index;
        out.ifNames[idx] = row['2'] || ''; // ifDescr
      }
      // Prefer ifName (IF-MIB extension)
      const names = await snmpApi.walk(host, community, snmpApi.OID.ifName, scanOpts).catch(() => []);
      for (const it of names) {
        const idx = it.oid.split('.').pop();
        if (it.value) out.ifNames[idx] = String(it.value);
      }
    } catch (e) {
      out.warnings.push('IF-MIB walk failed: ' + e.message);
    }

    // LLDP remote neighbours
    try {
      const chassis = await snmpApi.walk(host, community, snmpApi.OID.lldpRemChassisId, scanOpts);
      const portId  = await snmpApi.walk(host, community, snmpApi.OID.lldpRemPortId,    scanOpts).catch(() => []);
      const portDsc = await snmpApi.walk(host, community, snmpApi.OID.lldpRemPortDesc,  scanOpts).catch(() => []);
      const sysNm   = await snmpApi.walk(host, community, snmpApi.OID.lldpRemSysName,   scanOpts).catch(() => []);
      const sysDsc  = await snmpApi.walk(host, community, snmpApi.OID.lldpRemSysDesc,   scanOpts).catch(() => []);

      // Index by suffix `<timeMark>.<localPortNum>.<remoteIdx>`
      const bySuffix = new Map();
      function put(list, field) {
        for (const it of list) {
          // Last 3 numeric components form the index; but suffix depends on rootOid depth
          const parts = it.oid.split('.');
          // For lldpRemChassisId .1.0.8802.1.1.2.1.4.1.1.5 length 12
          // suffix starts at index 12
          const rootLen = snmpApi.OID.lldpRemChassisId.split('.').length;
          const suffix = parts.slice(rootLen).join('.');
          if (!bySuffix.has(suffix)) bySuffix.set(suffix, {});
          bySuffix.get(suffix)[field] = it.value;
        }
      }
      put(chassis, 'chassisId');
      put(portId,  'portId');
      put(portDsc, 'portDesc');
      put(sysNm,   'sysName');
      put(sysDsc,  'sysDesc');

      for (const [suffix, rec] of bySuffix.entries()) {
        const parts = suffix.split('.');
        const localPortIdx = parts[1];               // ifIndex-ish
        const localPortName = out.ifNames[localPortIdx] || ('port ' + localPortIdx);
        out.lldp.push({
          localPortIdx,
          localPortName,
          chassisId: rec.chassisId || '',
          portId:    rec.portId    || '',
          portDesc:  rec.portDesc  || '',
          sysName:   rec.sysName   || '',
          sysDesc:   rec.sysDesc   || '',
        });
      }
    } catch (e) {
      out.warnings.push('LLDP walk failed: ' + e.message);
    }

    // Bridge FDB (fallback for links to unmanaged endpoints)
    try {
      const fdbAddr = await snmpApi.walk(host, community, snmpApi.OID.dot1dTpFdbAddress, scanOpts);
      const fdbPort = await snmpApi.walk(host, community, snmpApi.OID.dot1dTpFdbPort,    scanOpts).catch(() => []);
      const basePort = await snmpApi.walk(host, community, snmpApi.OID.dot1dBasePortIf,  scanOpts).catch(() => []);
      const bp2if = new Map();
      for (const it of basePort) {
        const bp = it.oid.split('.').pop();
        bp2if.set(bp, String(it.value));
      }
      const addrMap = new Map();
      for (const it of fdbAddr) {
        const suffix = it.oid.split('.').slice(snmpApi.OID.dot1dTpFdbAddress.split('.').length).join('.');
        addrMap.set(suffix, it.value);
      }
      for (const it of fdbPort) {
        const suffix = it.oid.split('.').slice(snmpApi.OID.dot1dTpFdbPort.split('.').length).join('.');
        const mac = normMac(addrMap.get(suffix) || '');
        if (!mac) continue;
        const bp = String(it.value);
        const ifIdx = bp2if.get(bp) || bp;
        out.fdb.push({ mac, bridgePort: bp, ifIndex: ifIdx, ifName: out.ifNames[ifIdx] || ('port ' + ifIdx) });
      }
    } catch (e) {
      out.warnings.push('FDB walk failed: ' + e.message);
    }

    out.ok = true;
  } catch (e) {
    out.warnings.push('SNMP: ' + (e && e.message ? e.message : String(e)));
  }
  return out;
}

// ---------- Merging into diff proposal ------------------------------------

function makeProposal({ doc, rootHost, mt, snmpResults }) {
  const idx = indexDoc(doc);
  const proposedDevices = [];
  const proposedLinks = [];
  const warnings = [];
  const seenTempByKey = new Map(); // key -> tempId (dedupe)

  // Helper: get-or-create proposed device (or point to existing one)
  function refFor({ ip, mac, name, vendor, descr, hint }) {
    const existing = matchDevice(idx, { ip, mac, name });
    if (existing) return existing;
    const key = (normMac(mac) || normIp(ip) || (name || '').toLowerCase()).trim();
    if (!key) return null;
    if (seenTempByKey.has(key)) return { tempId: seenTempByKey.get(key) };
    const tempId = 'new_' + RID();
    seenTempByKey.set(key, tempId);
    proposedDevices.push({
      tempId,
      ip:  normIp(ip) || undefined,
      mac: normMac(mac) || undefined,
      name: name || (ip || mac || 'Discovered'),
      vendor: vendor || guessVendor(descr, null),
      kind: guessKindFromDescr(descr || ''),
      hint: hint || '',
    });
    return { tempId };
  }

  // --- MikroTik as seed --------------------------------------------------
  if (mt && mt.ok) {
    const selfRef = matchDevice(idx, { ip: rootHost, name: mt.self.name });
    const selfMatched = !!selfRef;
    const selfDeviceRef = selfRef || refFor({
      ip: rootHost,
      name: mt.self.name || rootHost,
      vendor: 'MikroTik',
      descr: 'RouterOS ' + (mt.self.model || ''),
      hint: 'MikroTik seed',
    });

    if (!selfMatched) {
      // Update the just-created proposed device to be a router
      const pd = proposedDevices.find(p => selfDeviceRef.tempId && p.tempId === selfDeviceRef.tempId);
      if (pd) { pd.kind = 'router'; pd.vendor = 'MikroTik'; }
    }

    for (const n of mt.neighbors) {
      if (!n.mac && !n.ip) continue;
      const remoteRef = refFor({
        ip: n.ip, mac: n.mac, name: n.name,
        vendor: guessVendor(n.platform || n.board, null),
        descr: (n.platform || '') + ' ' + (n.board || ''),
        hint: 'via LLDP/neighbor from ' + (mt.self.name || rootHost),
      });
      if (!remoteRef) continue;
      const linkTempId = 'lnk_' + RID();
      proposedLinks.push({
        tempId: linkTempId,
        fromRef: selfDeviceRef,
        fromPort: n.localIface || '',
        toRef: remoteRef,
        toPort: '',
        cable: 'copper',
        evidence: 'MikroTik /ip neighbor on ' + (n.localIface || '?'),
      });
    }

    // FDB — every MAC on a bridge port. If we see it in ARP too, we know the IP.
    const arpByMac = new Map(mt.arp.map(a => [a.mac, a]));
    for (const f of mt.fdb) {
      if (!f.mac || !f.onIface) continue;
      const arp = arpByMac.get(f.mac);
      const ip = arp ? arp.ip : '';
      // Skip if we already added a neighbor with same MAC (avoid dup link)
      if (proposedLinks.some(l => (l.toRef && (l.toRef.existingId || l.toRef.tempId)) &&
                                    normMac(seenTempByKey.get(f.mac) || '') === f.mac)) continue;
      const remoteRef = refFor({
        ip, mac: f.mac,
        name: ip || f.mac,
        vendor: '',
        descr: '',
        hint: 'via bridge FDB on ' + (mt.self.name || rootHost),
      });
      if (!remoteRef) continue;
      // Skip self-links
      if (remoteRef.existingId && selfDeviceRef.existingId && remoteRef.existingId === selfDeviceRef.existingId) continue;
      proposedLinks.push({
        tempId: 'lnk_' + RID(),
        fromRef: selfDeviceRef,
        fromPort: f.onIface,
        toRef: remoteRef,
        toPort: '',
        cable: 'copper',
        evidence: 'bridge FDB on ' + f.onIface + (ip ? ` (ARP ${ip})` : ''),
      });
    }
  }

  // --- SNMP results ------------------------------------------------------
  for (const s of (snmpResults || [])) {
    if (!s || !s.ok) continue;
    const seedRef = matchDevice(idx, { ip: s.host, name: s.self.name }) || refFor({
      ip: s.host, name: s.self.name || s.host,
      vendor: s.self.vendor, descr: s.self.descr,
      hint: 'SNMP seed',
    });
    if (!seedRef) continue;

    for (const l of s.lldp) {
      const macCandidate = normMac(l.chassisId) || normMac(l.portId);
      // remote sysName if present
      const name = l.sysName || l.chassisId || 'lldp neighbour';
      const remoteRef = refFor({
        mac: macCandidate,
        name,
        vendor: guessVendor(l.sysDesc, null),
        descr: l.sysDesc,
        hint: 'LLDP neighbour via ' + s.self.name,
      });
      if (!remoteRef) continue;
      proposedLinks.push({
        tempId: 'lnk_' + RID(),
        fromRef: seedRef,
        fromPort: l.localPortName,
        toRef: remoteRef,
        toPort: l.portDesc || l.portId || '',
        cable: 'copper',
        evidence: 'LLDP on ' + s.self.name + ':' + l.localPortName,
      });
    }
    for (const f of s.fdb) {
      if (!f.mac) continue;
      // Skip if link already exists via LLDP for this pair
      const macKey = f.mac;
      const dupe = proposedLinks.some(l => {
        const to = l.toRef && (l.toRef.existingId || l.toRef.tempId);
        const tempTo = seenTempByKey.get(macKey);
        return tempTo && (to === tempTo);
      });
      if (dupe) continue;
      const remoteRef = refFor({
        mac: f.mac, name: f.mac,
        hint: 'FDB on ' + s.self.name,
      });
      if (!remoteRef) continue;
      proposedLinks.push({
        tempId: 'lnk_' + RID(),
        fromRef: seedRef,
        fromPort: f.ifName,
        toRef: remoteRef,
        toPort: '',
        cable: 'copper',
        evidence: 'FDB on ' + s.self.name + ':' + f.ifName,
      });
    }
  }

  // Dedupe links: same (from,to,port) pairs
  const seenLinkKey = new Set();
  const uniqLinks = [];
  for (const l of proposedLinks) {
    const fk = (l.fromRef.existingId || l.fromRef.tempId) + '|' + (l.fromPort || '');
    const tk = (l.toRef.existingId   || l.toRef.tempId)   + '|' + (l.toPort   || '');
    const key = fk + '=>' + tk;
    const revKey = tk + '=>' + fk;
    if (seenLinkKey.has(key) || seenLinkKey.has(revKey)) continue;
    seenLinkKey.add(key);
    uniqLinks.push(l);
  }

  // Filter self-links (a device shouldn't link to itself)
  const finalLinks = uniqLinks.filter(l => {
    const a = l.fromRef.existingId || l.fromRef.tempId;
    const b = l.toRef.existingId   || l.toRef.tempId;
    return a !== b;
  });

  return { proposedDevices, proposedLinks: finalLinks, warnings };
}

// ---------- Public entry points -------------------------------------------

/**
 * Test that the given credentials can reach the host.
 *
 * cfg = {
 *   mode: 'mikrotik' | 'snmp' | 'both',
 *   host: '192.168.11.1',
 *   port?: 22,
 *   username?, password?,
 *   snmpCommunity?: 'public',
 *   snmpPort?: 161,
 * }
 */
async function test(cfg) {
  const out = { ok: false, mikrotik: null, snmp: null };
  const promises = [];
  if (cfg.mode === 'mikrotik' || cfg.mode === 'both') {
    promises.push((async () => {
      try {
        const mt = getMt();
        const r = await mt.runCommand({ host: cfg.host, port: cfg.port || 22, username: cfg.username, password: cfg.password }, ':put [/system identity get name]');
        out.mikrotik = { ok: true, identity: String(r || '').trim() };
      } catch (e) {
        out.mikrotik = { ok: false, error: e && e.message ? e.message : String(e) };
      }
    })());
  }
  if (cfg.mode === 'snmp' || cfg.mode === 'both') {
    promises.push((async () => {
      const p = await snmpApi.probe(cfg.host, cfg.snmpCommunity || 'public', { timeout: 2000 });
      out.snmp = p;
    })());
  }
  await Promise.all(promises);
  out.ok = (out.mikrotik && out.mikrotik.ok) || (out.snmp && out.snmp.ok);
  return out;
}

/**
 * Full scan. Returns proposal ready for the review dialog.
 *
 * cfg extends the fields from test(). Additionally:
 *   - doc: the current NetMapDoc (to match existing devices)
 *   - snmpSeeds?: [host, host, ...]  additional SNMP hosts to poll
 */
async function scan(cfg) {
  const t0 = now();
  const doc = cfg.doc || { devices: [], links: [] };
  const rootHost = cfg.host;
  const warnings = [];
  let mt = null;
  const snmpResults = [];

  if (cfg.mode === 'mikrotik' || cfg.mode === 'both') {
    mt = await collectMikrotik({
      host: rootHost,
      port: cfg.port || 22,
      username: cfg.username,
      password: cfg.password,
    }, { timeout: cfg.sshTimeout || 8000 });
    warnings.push(...(mt.warnings || []));
  }

  const snmpHosts = new Set();
  if (cfg.mode === 'snmp' || cfg.mode === 'both') {
    snmpHosts.add(rootHost);
  }
  if (Array.isArray(cfg.snmpSeeds)) for (const h of cfg.snmpSeeds) if (normIp(h)) snmpHosts.add(normIp(h));

  // Also add ARP-known /24 mates as opportunistic SNMP targets — but only when
  // user asked for both mode with an explicit "sweep" flag to avoid slow scans.
  if (cfg.snmpSweep && mt && mt.ok) {
    for (const a of mt.arp) if (a.ip) snmpHosts.add(a.ip);
  }

  const community = cfg.snmpCommunity || 'public';
  const snmpTasks = [];
  for (const h of snmpHosts) {
    snmpTasks.push(collectSnmp(h, community, { timeout: cfg.snmpTimeout || 2500 }).then(r => {
      snmpResults.push(r);
      if (r.warnings && r.warnings.length) warnings.push(`[${h}] ` + r.warnings.join('; '));
    }));
  }
  await Promise.all(snmpTasks);

  const merged = makeProposal({ doc, rootHost, mt, snmpResults });
  const stats = {
    ms: now() - t0,
    neighborsFound: mt ? mt.neighbors.length : 0,
    fdbEntries:     mt ? mt.fdb.length : 0,
    arpEntries:     mt ? mt.arp.length : 0,
    snmpHosts:      snmpHosts.size,
    lldpEntries:    snmpResults.reduce((n, s) => n + (s.lldp ? s.lldp.length : 0), 0),
  };

  return {
    ok: true,
    rootHost,
    source: cfg.mode || 'both',
    seeds: snmpResults.map(s => ({
      host: s.host, name: s.self.name, vendor: s.self.vendor, descr: s.self.descr, ok: s.ok,
    })),
    proposedDevices: merged.proposedDevices,
    proposedLinks:   merged.proposedLinks,
    warnings: [...warnings, ...merged.warnings],
    stats,
  };
}

module.exports = { scan, test };
