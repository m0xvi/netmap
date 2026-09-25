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
 *     proposedDevices: [{ tempId, ip, mac, name, nameSource, vendor, kind,
 *                          kindConfident, hint, vlan?, dhcpComment?, dhcpHost? }],
 *     proposedLinks:   [{ tempId, fromRef, fromPort, toRef, toPort, cable, evidence }],
 *     subnets: [{ cidr, interface, comment }],   // v0.52.0: router /ip/address
 *     vlans:   [{ id, name }],                   // v0.52.0: wood for the VLAN filter
 *     warnings: [string],
 *     stats: { neighborsFound, fdbEntries, arpEntries, leases, ms }
 *   }
 *
 * v0.52.0 naming: nameSource ∈ dhcp|sysname|hostname|ip|mac, приоритет
 * DHCP-comment > sysName/identity > DHCP host-name > IP > MAC.
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

// v0.52.0: MAC из SNMP-значения physAddress. coerce() в snmp.cjs отдаёт
// OCTET STRING либо «AA:BB:..» (есть непечатные байты), либо сырую
// 6-символьную строку (все 6 байт случайно печатные — например MAC
// 44:42:41:43:4B:55 приезжает как "DBACKU"). Понимаем оба формата.
function macFromSnmpValue(v) {
  if (v == null) return '';
  if (Buffer.isBuffer(v)) {
    if (v.length !== 6) return '';
    return Array.from(v).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  }
  const s = String(v);
  if (s.includes(':')) return normMac(s);
  if (s.length === 6) {
    const bytes = [];
    for (let i = 0; i < 6; i++) bytes.push(s.charCodeAt(i) & 0xff);
    return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  }
  return normMac(s);
}

// v0.53.0: OUI-подсказки — порт таблицы из mikrotikClient.ts (проверена
// обычным импортом). Формат префикса — «AA:BB:CC», сравнение в верхнем регистре.
const OUI_HINTS = [
  { prefix: 'B8:27:EB', vendor: 'Raspberry Pi',     kind: 'pc' },
  { prefix: 'DC:A6:32', vendor: 'Raspberry Pi',     kind: 'pc' },
  { prefix: '00:0C:29', vendor: 'VMware',           kind: 'server' },
  { prefix: '00:50:56', vendor: 'VMware',           kind: 'server' },
  { prefix: '00:15:5D', vendor: 'Microsoft HyperV', kind: 'server' },
  { prefix: '00:1B:0D', vendor: 'Cisco',            kind: 'switch' },
  { prefix: '00:1B:63', vendor: 'Apple',            kind: 'pc' },
  { prefix: 'AC:BC:32', vendor: 'Apple',            kind: 'pc' },
  { prefix: 'B4:FB:E4', vendor: 'Ubiquiti',         kind: 'ap' },
  { prefix: '24:5A:4C', vendor: 'Ubiquiti',         kind: 'ap' },
  { prefix: 'F0:9F:C2', vendor: 'Ubiquiti',         kind: 'ap' },
  { prefix: '48:8F:5A', vendor: 'Ubiquiti',         kind: 'ap' },
  { prefix: 'CC:2D:E0', vendor: 'MikroTik',         kind: 'switch' },
  { prefix: '4C:5E:0C', vendor: 'MikroTik',         kind: 'switch' },
  { prefix: '00:0C:42', vendor: 'MikroTik',         kind: 'switch' },
  { prefix: 'D4:CA:6D', vendor: 'MikroTik',         kind: 'switch' },
  { prefix: '00:11:32', vendor: 'Synology',         kind: 'server' },
  { prefix: '00:40:8C', vendor: 'Axis Camera',      kind: 'camera' },
  { prefix: 'AC:CC:8E', vendor: 'Axis Camera',      kind: 'camera' },
  { prefix: 'BC:AD:28', vendor: 'Hikvision',        kind: 'camera' },
  { prefix: '44:19:B6', vendor: 'Hikvision',        kind: 'camera' },
  { prefix: '4C:BD:8F', vendor: 'Hikvision',        kind: 'camera' },
  { prefix: '3C:1B:F8', vendor: 'Dahua',            kind: 'camera' },
  { prefix: '00:80:F0', vendor: 'Kyocera',          kind: 'printer' },
  { prefix: '00:00:74', vendor: 'Ricoh',            kind: 'printer' },
  { prefix: '00:26:73', vendor: 'HP Printer',       kind: 'printer' },
];
function ouiHint(mac) {
  const m = (mac || '').toUpperCase();
  if (!m) return null;
  for (const h of OUI_HINTS) if (m.startsWith(h.prefix)) return h;
  return null;
}

// Токены имени: «AP_baket» → [ap, baket], «Камера-склад» → [камера, склад].
function tokensOf(s) {
  return String(s || '').toLowerCase().split(/[^a-zа-яё0-9]+/).filter(Boolean);
}

// Правила «токены имени → тип», порядок — от специфичных к общим.
// Дефолтные identity («MikroTik») и IP/MAC-заглушки токенов не дают —
// такие устройства честно уходят в «тип не определён».
const NAME_KIND_RULES = [
  { kind: 'ap',      words: ['ap', 'unifi', 'ubnt', 'uap', 'wifi', 'wlan', 'nanostation', 'hap', 'cap', 'wap', 'eap'], stems: [] },
  { kind: 'camera',  words: ['cam', 'camera', 'ipcam', 'cctv', 'hik', 'hikvision', 'dahua', 'axis', 'камера', 'видео'], stems: ['камер', 'видеонаблюд'] },
  { kind: 'printer', words: ['print', 'printer', 'prt', 'mfp', 'laserjet', 'kyocera', 'ricoh', 'мфу', 'принтер'], stems: ['принтер'] },
  { kind: 'pos',     words: ['pos', 'kassa', 'rk7', 'atol', 'paytor', 'evotor', 'касса', 'эвотор'], stems: ['касс'] },
  { kind: 'lock',    words: ['salto', 'lock', 'door', 'скуд', 'skud', 'дверь', 'замок', 'домофон'], stems: ['двер', 'замк'] },
  { kind: 'switch',  words: ['sw', 'switch', 'коммутатор', 'crs', 'css', 'dgs', 'des'], stems: [] },
  { kind: 'router',  words: ['gw', 'gateway', 'router', 'роутер', 'маршрутизатор', 'edge', 'core', 'ccr', 'hex', 'chr', 'rb4011', 'rb5009', 'vyos', 'pfsense', 'keenetic'], stems: [] },
  { kind: 'server',  words: ['srv', 'server', 'сервер', 'nas', 'synology', 'qnap', 'esxi', 'esx', 'hyperv', 'proxmox', 'pve', '1c', '1с'], stems: [] },
  { kind: 'dvr',     words: ['dvr', 'nvr', 'регистратор', 'регик', 'trassir', 'xeoma', 'видеосервер'], stems: ['регистрат'] },
  { kind: 'pbx',     words: ['pbx', 'ats', 'атс', 'миниатс', 'voip', 'sip', 'asterisk', 'freepbx', 'ipbx', '3cx'], stems: ['атс'] },
  { kind: 'patchpanel', words: ['patch', 'patchpanel', 'кросс'], stems: [] },
  { kind: 'pc',      words: ['pc', 'desktop', 'notebook', 'laptop', 'ноутбук', 'пк', 'ws', 'workstation', 'macbook', 'imac', 'iphone', 'android', 'galaxy'], stems: ['комп'] },
];
const PREFIX_KIND = { sw: 'switch', swt: 'switch', ap: 'ap', cam: 'camera', gw: 'router', srv: 'server', pc: 'pc', prt: 'printer', pos: 'pos', dvr: 'dvr', nvr: 'dvr', pbx: 'pbx', ats: 'pbx' };
function kindByNameTokens(name) {
  const toks = tokensOf(name);
  if (!toks.length) return null;
  // «sw1», «ap2», «cam3» — буквы+цифры без разделителя.
  for (const t of toks) {
    const m = /^(sw|swt|ap|cam|gw|srv|pc|prt|pos|dvr|nvr|pbx|ats)(\d+)$/.exec(t);
    if (m) return PREFIX_KIND[m[1]];
  }
  for (const rule of NAME_KIND_RULES) {
    for (const t of toks) {
      if (rule.words.includes(t)) return rule.kind;
      for (const st of rule.stems) if (t.startsWith(st) && t.length <= st.length + 4) return rule.kind;
    }
  }
  return null;
}

// Тип по sysDescr / платформе. Важно: голый «RouterBOARD» роутером НЕ
// считаем (это платформа и свитчей, и точек) — смотрим конкретную модель.
function kindByDescr(descr, vendor) {
  const s = String(descr || '').toLowerCase();
  if (!s) return null;
  if (/hap|cap|wap|lhg|sxt|nray|disc|omnitik|groove|metal|sextant|dynadish|audios|hap ax|cap ax/i.test(s)) return 'ap';
  if (/unifi|ubnt|uap[^a-z]|nanostation/.test(s)) return 'ap';
  if (/access ?point|wireless/.test(s)) return 'ap';
  if (/ccr\d|cloud core|hex( |$)|rb750|rb95|rb2011|rb3011|rb4011|rb5009|chr |isr\d|asr\d|edgerouter|vyos|pfsense|keenetic/.test(s)) return 'router';
  if (/crs\d|css\d|netpower|switch|catalyst|nexus|procurve|edgeswitch|\bdes-|\bdgs|sg\d{2,}|sf\d{2,}|cbs\d/.test(s)) return 'switch';
  if (/dvr|nvr|video recorder|trassir|xeoma/.test(s)) return 'dvr';
  if (/pbx|asterisk|freepbx|voip gateway|yeastar|grandstream ucm|\b3cx\b/.test(s)) return 'pbx';
  if (/camera|ipcam|hikvision|dahua|axis/.test(s)) return 'camera';
  if (/printer|laserjet|kyocera|ricoh/.test(s)) return 'printer';
  if (/synology|qnap|truenas|esxi|proxmox|poweredge|proliant/.test(s)) return 'server';
  if (/raspberry/.test(s)) return 'pc';
  const v = String(vendor || '').toLowerCase();
  if (/hikvision|dahua|axis/.test(v)) return 'camera';
  if (/kyocera|ricoh/.test(v)) return 'printer';
  if (/ubiquiti|unifi/.test(v)) return 'ap';
  if (/synology|qnap|vmware/.test(v)) return 'server';
  return null;
}

// Слабый сигнал: имя VLAN. Только специфичные (CCTV/печать/гости) —
// mgmt/hardware может содержать что угодно, их не трогаем.
function kindByVlanName(vlanName) {
  const s = String(vlanName || '').toLowerCase();
  if (!s) return null;
  if (/cctv|видео|камер|cam\b|video/.test(s)) return 'camera';
  if (/print|печати|принт/.test(s)) return 'printer';
  if (/guest|гост/.test(s)) return 'pc';
  return null;
}

/**
 * v0.53.0 — определение типа устройства по отпечаткам.
 * v0.54.0 — новые типы 'pbx' (АТС) и 'dvr' (регистратор); неуверенный
 * результат теперь kind 'other' + confident false: такие устройства
 * уходят в отдельную группу «Тип не определён», где тип выбирает
 * пользователь.
 */
function fingerprintKind({ names, vendor, descr, mac, vlanName }) {
  for (const n of (names || [])) {
    if (!n) continue;
    const k = kindByNameTokens(n);
    if (k) return { kind: k, confident: true };
  }
  const oui = ouiHint(mac);
  if (oui) return { kind: oui.kind, confident: true, vendor: oui.vendor };
  const dk = kindByDescr(descr, vendor);
  if (dk) return { kind: dk, confident: true };
  const vk = kindByVlanName(vlanName);
  if (vk) return { kind: vk, confident: true };
  return { kind: 'other', confident: false };
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

// v0.52.0: «2,5,10-12» → [2,5,10,11,12]. Для vlan-ids из bridge vlan table.
function expandVlanIds(spec) {
  if (!spec) return [];
  const out = [];
  for (const part of String(spec).split(',')) {
    const p = part.trim();
    if (!p) continue;
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(p);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
    } else if (/^\d+$/.test(p)) {
      out.push(Number(p));
    }
  }
  return out.filter(n => n >= 1 && n <= 4094);
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
    // v0.52.0: DHCP-лизы (имена!), адреса роутера (подсети), VLAN-таблицы.
    leases: [],       // {ip, mac, host, comment, server, status}
    addresses: [],    // {cidr, interface, comment}
    vlanByPort: {},   // untagged port name -> vlanId (из bridge vlan table)
    vlanIfaceByName: {}, // vlan interface name -> vlanId (из /interface vlan)
    vlanNames: {},    // vlanId -> имя/комментарий
    switchVlanIds: [], // v0.53.0: VLAN с switch-chip (перечисление)
    warnings: [],
  };
  try {
    const [ident, resource, neighTerse, arpTerse, ifTerse, fdb,
           leaseTerse, addrTerse, bridgeVlanTerse, vlanIfaceTerse,
           swVlanTerse, swPortTerse] = await Promise.all([
      mt.runCommand(cfg, ':put [/system identity get name]').catch(() => ''),
      mt.runCommand(cfg, '/system resource print without-paging').catch(() => ''),
      mt.runCommand(cfg, '/ip neighbor print terse without-paging').catch(() => ''),
      mt.runCommand(cfg, '/ip arp print terse without-paging').catch(() => ''),
      mt.runCommand(cfg, '/interface print terse without-paging').catch(() => ''),
      mt.runCommand(cfg, '/interface bridge host print terse without-paging').catch(() => ''),
      mt.runCommand(cfg, '/ip dhcp-server lease print terse without-paging').catch(() => ''),
      mt.runCommand(cfg, '/ip address print terse without-paging').catch(() => ''),
      mt.runCommand(cfg, '/interface bridge vlan print terse without-paging').catch(() => ''),
      mt.runCommand(cfg, '/interface vlan print terse without-paging').catch(() => ''),
      mt.runCommand(cfg, '/interface ethernet switch vlan print terse without-paging').catch(() => ''),
      mt.runCommand(cfg, '/interface ethernet switch port print terse without-paging').catch(() => ''),
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
    // v0.52.0: DHCP leases — главный источник человеческих имён
    // (comment приоритетнее host-name: комментарий правит админ).
    for (const row of parseTerseLines(leaseTerse)) {
      const mac = normMac(row['mac-address'] || '');
      if (!mac) continue;
      out.leases.push({
        ip:  normIp(row['address'] || row['active-address'] || ''),
        mac,
        host:    row['host-name'] || '',
        comment: row['comment'] || '',
        server:  row['server'] || '',
        status:  row['status'] || '',
      });
    }
    // /ip address — эталонные подсети роутера для фильтра по сетям.
    for (const row of parseTerseLines(addrTerse)) {
      const cidr = String(row['address'] || '').trim();
      if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(cidr)) continue;
      out.addresses.push({
        cidr,
        interface: row['interface'] || '',
        comment: row['comment'] || '',
      });
    }
    // bridge vlan table: untagged порт → VLAN. FDB-запись на access-порту
    // тем самым привязывается к VLAN (на транках — неоднозначно, пропускаем).
    for (const row of parseTerseLines(bridgeVlanTerse)) {
      const ids = expandVlanIds(row['vlan-ids']);
      if (!ids.length) continue;
      const untagged = String(row['untagged'] || '').split(',')
        .map(s => s.trim()).filter(Boolean);
      for (const p of untagged) {
        if (!(p in out.vlanByPort)) out.vlanByPort[p] = ids[0];
      }
      if (row['comment']) for (const id of ids) {
        if (!out.vlanNames[id]) out.vlanNames[id] = row['comment'];
      }
    }
    // vlan-интерфейсы: имя интерфейса → vlan-id (сосед на v_Office = VLAN 2).
    for (const row of parseTerseLines(vlanIfaceTerse)) {
      const id = Number(row['vlan-id']);
      if (!Number.isFinite(id) || id < 1 || id > 4094) continue;
      if (row['name']) out.vlanIfaceByName[row['name']] = id;
      const label = row['comment'] || row['name'] || '';
      if (label && !out.vlanNames[id]) out.vlanNames[id] = label;
    }
    // v0.53.0: VLAN на switch-chip (CRS1xx/2xx и др., где bridge vlan table
    // пуста). Таблица switch vlan — только для ПЕРЕЧИСЛЕНИЯ id: колонка
    // ports включает и транки, маппить порт→VLAN по ней нельзя.
    for (const row of parseTerseLines(swVlanTerse)) {
      const id = Number(row['vlan-id']);
      if (!Number.isInteger(id) || id < 1 || id > 4094) continue;
      if (!out.switchVlanIds.includes(id)) out.switchVlanIds.push(id);
    }
    // switch port: default-vlan-id маппим, только если это точно access-порт
    // (vlan-header=always-strip — тег всегда срезается) и VLAN на порту
    // вообще включены. Транки и disabled пропускаем: неверный VLAN хуже,
    // чем неизвестный (устройство уедет не в тот фильтр).
    for (const row of parseTerseLines(swPortTerse)) {
      const name = row['name'] || row['port'] || '';
      if (!name || (name in out.vlanByPort)) continue;
      const mode = String(row['vlan-mode'] || '').toLowerCase();
      const header = String(row['vlan-header'] || '').toLowerCase();
      if (!mode || mode === 'disabled') continue;
      if (header !== 'always-strip') continue;
      const id = Number(row['default-vlan-id']);
      if (!Number.isInteger(id) || id < 1 || id > 4094) continue;
      out.vlanByPort[name] = id;
      if (!out.switchVlanIds.includes(id)) out.switchVlanIds.push(id);
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
    lldp: [],       // {localPort, chassisId, portId, sysName, sysDesc, portDesc, mgmtIp}
    mgmtAddrs: [],  // v0.51.20: management-IP соседей по LLDP — топливо рекурсии
    arpByMac: {},   // v0.52.0: MAC -> IP из ipNetToMedia (даёт IP эндпоинтам из FDB)
    vlanList: [],   // v0.53.0: [{id, name}] все VLAN железки (dot1qVlanStatic)
    fdb: [],        // {mac, bridgePort, ifName, vlan?}
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
    // v0.53.0: тип опрошенного хоста — по отпечаткам; SNMP опрашивают
    // обычно коммутаторы, поэтому неуверенный результат → 'switch'.
    {
      const fpSelf = fingerprintKind({
        names: [probe.sysName], vendor: out.self.vendor,
        descr: probe.sysDescr, mac: '', vlanName: '',
      });
      out.self.kind = fpSelf.confident ? fpSelf.kind : 'switch';
    }

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
      // v0.53.0: имена локальных портов из LLDP-MIB — фолбэк, когда IF-MIB
      // пуст или врёт (иначе в связях мелькает «port 0»).
      const locDesc = await snmpApi.walk(host, community, snmpApi.OID.lldpLocPortDesc, scanOpts).catch(() => []);
      const locDescByNum = new Map();
      {
        const rootLen = snmpApi.OID.lldpLocPortDesc.split('.').length;
        for (const it of locDesc) {
          const num = it.oid.split('.').slice(rootLen).join('.');
          if (num && typeof it.value === 'string' && it.value && !locDescByNum.has(num)) {
            locDescByNum.set(num, it.value);
          }
        }
      }
      // v0.52.0: management-адрес КАЖДОГО соседа (lldpRemManAddr) — даёт IP
      // LLDP-соседям, без него они все были бы «без IP». IP читаем прямо из
      // суффикса OID (col.timeMark.localPort.remIdx.subtype.len.bytes…),
      // т.к. coerce() превращает значение-адрес в hex-строку, а не Buffer
      // (старая проверка Buffer.isBuffer никогда не срабатывала — рекурсия
      // v0.51.20 фактически не получала топлива; теперь чиним заодно).
      const manAddr = await snmpApi.walk(host, community, snmpApi.OID.lldpRemManAddr, scanOpts).catch(() => []);
      const mgmtByNeigh = new Map(); // "timeMark.localPort.remIdx" -> IPv4
      {
        const rootLen = snmpApi.OID.lldpRemManAddr.split('.').length;
        for (const it of manAddr) {
          const parts = it.oid.split('.').slice(rootLen);
          // [col, timeMark, localPort, remIdx, subtype, addrLen, ...addrBytes]
          if (parts.length < 7 || parts[0] !== '2') continue; // только колонка lldpRemManAddr
          if (parts[4] !== '1' || parts[5] !== '4') continue;  // только IPv4
          const ip = normIp(parts.slice(6, 10).join('.'));
          if (!ip) continue;
          const key = parts[1] + '.' + parts[2] + '.' + parts[3];
          if (!mgmtByNeigh.has(key)) mgmtByNeigh.set(key, ip);
          if (!out.mgmtAddrs.includes(ip)) out.mgmtAddrs.push(ip);
        }
      }

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
        const localPortName = out.ifNames[localPortIdx]
          || locDescByNum.get(localPortIdx)
          || ('port ' + localPortIdx);
        out.lldp.push({
          localPortIdx,
          localPortName,
          chassisId: rec.chassisId || '',
          portId:    rec.portId    || '',
          portDesc:  rec.portDesc  || '',
          sysName:   rec.sysName   || '',
          sysDesc:   rec.sysDesc   || '',
          mgmtIp:    mgmtByNeigh.get(suffix) || '',  // v0.52.0
        });
      }
    } catch (e) {
      out.warnings.push('LLDP walk failed: ' + e.message);
    }

    // v0.52.0: ARP-таблица L3-устройства (IP-MIB ipNetToMedia): индекс —
    // ifIndex + 4 октета IP, значение — MAC. Даёт IP эндпоинтам из FDB,
    // иначе в чисто SNMP-режиме они все попадали бы в «без IP».
    try {
      const arpItems = await snmpApi.walk(host, community, snmpApi.OID.ipNetToMediaPhysAddress, scanOpts);
      const rootLen = snmpApi.OID.ipNetToMediaPhysAddress.split('.').length;
      for (const it of arpItems) {
        const parts = it.oid.split('.').slice(rootLen);
        if (parts.length < 5) continue;
        const ip = normIp(parts.slice(-4).join('.'));
        const mac = macFromSnmpValue(it.value);
        if (ip && mac && !out.arpByMac[mac]) out.arpByMac[mac] = ip;
      }
    } catch (e) { /* ARP-таблицы может не быть (L2) — не критично */ }

    // v0.53.0: статическая VLAN-таблица (Q-BRIDGE-MIB dot1qVlanStaticName) —
    // перечисляет ВСЕ VLAN коммутатора, даже пустые (без найденных устройств).
    try {
      const vv = await snmpApi.walk(host, community, snmpApi.OID.dot1qVlanStaticName, scanOpts);
      const rootLen = snmpApi.OID.dot1qVlanStaticName.split('.').length;
      for (const it of vv) {
        const id = Number(it.oid.split('.').slice(rootLen)[0]);
        if (!Number.isInteger(id) || id < 1 || id > 4094) continue;
        if (out.vlanList.some(v => v.id === id)) continue;
        out.vlanList.push({ id, name: typeof it.value === 'string' ? it.value : '' });
      }
    } catch (e) { /* нет Q-BRIDGE VLAN MIB — не критично */ }

    // Bridge FDB (fallback for links to unmanaged endpoints).
    // v0.52.0: сначала пробуем Q-BRIDGE-MIB (тот же FDB + номер VLAN),
    // иначе — классический BRIDGE-MIB. MAC берём из индекса OID
    // (6 десятичных subid), а не из значения — значение coerce() может
    // отдать «печатной» строкой вместо hex, если байты MAC случайно
    // все печатные (тогда запись молча терялась).
    try {
      const basePort = await snmpApi.walk(host, community, snmpApi.OID.dot1dBasePortIf, scanOpts).catch(() => []);
      const bp2if = new Map();
      for (const it of basePort) {
        const bp = it.oid.split('.').pop();
        bp2if.set(bp, String(it.value));
      }
      const ifNameOf = (bp) => {
        const ifIdx = bp2if.get(String(bp)) || String(bp);
        return out.ifNames[ifIdx] || ('port ' + ifIdx);
      };
      const macFromDecSuffix = (parts) => {
        const bytes = parts.map(x => Number(x));
        if (bytes.some(b => !Number.isInteger(b) || b < 0 || b > 255)) return '';
        return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
      };
      let usedQbridge = false;
      try {
        const qPort = await snmpApi.walk(host, community, snmpApi.OID.dot1qTpFdbPort, scanOpts);
        if (qPort.length) {
          const qStat = await snmpApi.walk(host, community, snmpApi.OID.dot1qTpFdbStatus, scanOpts).catch(() => []);
          const rootLen = snmpApi.OID.dot1qTpFdbPort.split('.').length;
          const sRootLen = snmpApi.OID.dot1qTpFdbStatus.split('.').length;
          const statByIdx = new Map();
          for (const it of qStat) statByIdx.set(it.oid.split('.').slice(sRootLen).join('.'), Number(it.value));
          for (const it of qPort) {
            const parts = it.oid.split('.').slice(rootLen);
            if (parts.length < 7) continue; // VlanId + 6 байт MAC
            const st = statByIdx.get(parts.join('.'));
            if (st != null && st !== 3 && st !== 4 && st !== 5) continue; // learned/self/mgmt
            const mac = macFromDecSuffix(parts.slice(1, 7));
            if (!mac) continue;
            const vlan = Number(parts[0]);
            out.fdb.push({
              mac, vlan: (vlan >= 1 && vlan <= 4094) ? vlan : undefined,
              bridgePort: String(it.value), ifName: ifNameOf(it.value),
            });
          }
          usedQbridge = out.fdb.length > 0;
        }
      } catch (e) { /* нет Q-BRIDGE — откатываемся на dot1d */ }
      if (!usedQbridge) {
        const fdbPort = await snmpApi.walk(host, community, snmpApi.OID.dot1dTpFdbPort, scanOpts);
        const rootLen = snmpApi.OID.dot1dTpFdbPort.split('.').length;
        for (const it of fdbPort) {
          const parts = it.oid.split('.').slice(rootLen);
          if (parts.length < 6) continue;
          const mac = macFromDecSuffix(parts.slice(-6));
          if (!mac) continue;
          out.fdb.push({ mac, bridgePort: String(it.value), ifName: ifNameOf(it.value) });
        }
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

// v0.52.0: приоритет источников имени. Комментарий DHCP-лизы — самый
// актуальный (его правит админ руками), дальше имя самого устройства
// (LLDP sysName / MikroTik identity), затем host-name из DHCP
// (присылает клиент — часто мусор, но лучше IP), затем IP и MAC.
const NAME_RANK = { mac: 0, ip: 1, hostname: 2, sysname: 3, dhcp: 4 };
function rankOf(src) { return NAME_RANK[src] != null ? NAME_RANK[src] : 0; }

function makeProposal({ doc, rootHost, mt, snmpResults }) {
  const idx = indexDoc(doc);
  const proposedDevices = [];
  const proposedLinks = [];
  const warnings = [];
  const seenTempByKey = new Map(); // 'm:MAC' | 'i:IP' | 's:stable' | 'n:name' -> tempId

  // Справочники для обогащения: DHCP-лизы (имена!), ARP (IP по MAC).
  const leaseByMac = new Map();
  const leaseByIp = new Map();
  if (mt && mt.ok) for (const l of (mt.leases || [])) {
    if (l.mac && !leaseByMac.has(l.mac)) leaseByMac.set(l.mac, l);
    if (l.ip && !leaseByIp.has(l.ip)) leaseByIp.set(l.ip, l);
  }
  const snmpArpByMac = new Map();
  for (const s of (snmpResults || [])) {
    if (!s || !s.ok || !s.arpByMac) continue;
    for (const [mac, ip] of Object.entries(s.arpByMac)) {
      if (!snmpArpByMac.has(mac)) snmpArpByMac.set(mac, ip);
    }
  }
  function leaseFor(mac, ip) {
    return (mac && leaseByMac.get(mac)) || (ip && leaseByIp.get(ip)) || null;
  }
  // v0.53.0: имена VLAN (id → имя) — слабый сигнал для определения типа.
  const vlanNameById = new Map();
  if (mt && mt.ok && mt.vlanNames) for (const [id, nm] of Object.entries(mt.vlanNames)) {
    if (nm) vlanNameById.set(Number(id), nm);
  }
  for (const s of (snmpResults || [])) {
    if (!s || !s.ok || !s.vlanList) continue;
    for (const v of s.vlanList) {
      if (v && v.name && !vlanNameById.has(v.id)) vlanNameById.set(v.id, v.name);
    }
  }

  // Helper: get-or-create proposed device (or point to existing one).
  // v0.52.0: дедуп по трём ключам (MAC → IP → stable/name), при повторной
  // встрече устройство ОБОГАЩАЕТСЯ (доезжают IP, имя получше, VLAN).
  function refFor({ ip, mac, name, nameSrc, vendor, descr, hint, vlan, stableKey }) {
    mac = normMac(mac); ip = normIp(ip);
    const existing = matchDevice(idx, { ip, mac, name });
    if (existing) return existing;
    const keys = [];
    if (mac) keys.push('m:' + mac);
    if (ip) keys.push('i:' + ip);
    if (stableKey) keys.push('s:' + String(stableKey));
    // Ключ по имени — только если нет ни MAC, ни IP: иначе два устройства
    // с дефолтным identity «MikroTik» склеились бы в одно. LLDP-строки без
    // адресов различаем по stableKey (chassisId), имя — последний шанс.
    if (!mac && !ip && name && rankOf(nameSrc) >= 2) keys.push('n:' + String(name).toLowerCase());
    if (!keys.length) return null;

    // DHCP-лиза по MAC или IP может дать имя лучше предложенного.
    let effName = name || '', effSrc = nameSrc || (ip ? 'ip' : 'mac');
    const lease = leaseFor(mac, ip);
    const dhcpComment = (lease && lease.comment) || '';
    const dhcpHost = (lease && lease.host) || '';
    if (dhcpComment && rankOf('dhcp') > rankOf(effSrc)) { effName = dhcpComment; effSrc = 'dhcp'; }
    if (!effName && dhcpHost) { effName = dhcpHost; effSrc = 'hostname'; }
    else if (dhcpHost && rankOf('hostname') > rankOf(effSrc) && effSrc !== 'dhcp' && effSrc !== 'sysname') {
      effName = dhcpHost; effSrc = 'hostname';
    }
    if (!effName) { effName = ip || mac || 'Discovered'; effSrc = ip ? 'ip' : 'mac'; }

    for (const k of keys) {
      if (!seenTempByKey.has(k)) continue;
      // Уже видели — обогащаем: IP, имя (только в сторону улучшения),
      // VLAN, vendor, DHCP-подсказки.
      const tempId = seenTempByKey.get(k);
      const pd = proposedDevices.find(p => p.tempId === tempId);
      if (pd) {
        if (!pd.ip && ip) { pd.ip = ip; seenTempByKey.set('i:' + ip, tempId); }
        if (!pd.mac && mac) { pd.mac = mac; seenTempByKey.set('m:' + mac, tempId); }
        if (rankOf(effSrc) > rankOf(pd.nameSource)) { pd.name = effName; pd.nameSource = effSrc; }
        if (pd.vlan == null && vlan != null) pd.vlan = vlan;
        if (!pd.vendor && vendor) pd.vendor = vendor;
        if (!pd.dhcpComment && dhcpComment) pd.dhcpComment = dhcpComment;
        if (!pd.dhcpHost && dhcpHost) pd.dhcpHost = dhcpHost;
        // v0.53.0: тип пересчитываем, пока он неуверенный: имя получше
        // (например, доехавший DHCP-комментарий «Камера склад») может его дать.
        if (!pd.kindConfident) {
          const fpUp = fingerprintKind({
            names: [pd.name, pd.dhcpComment, pd.dhcpHost],
            vendor: pd.vendor, descr: descr || '', mac: pd.mac,
            vlanName: pd.vlan != null ? vlanNameById.get(pd.vlan) : '',
          });
          if (fpUp.confident) { pd.kind = fpUp.kind; pd.kindConfident = true; }
          if (!pd.vendor && fpUp.vendor) pd.vendor = fpUp.vendor;
        }
      }
      for (const k2 of keys) if (!seenTempByKey.has(k2)) seenTempByKey.set(k2, tempId);
      return { tempId };
    }
    const tempId = 'new_' + RID();
    for (const k of keys) seenTempByKey.set(k, tempId);
    // v0.53.0: тип — по отпечаткам (имя, OUI, descr, имя VLAN).
    const fp = fingerprintKind({
      names: [effName, dhcpHost, dhcpComment],
      vendor: vendor || guessVendor(descr, null),
      descr: descr || '',
      mac,
      vlanName: vlan != null ? vlanNameById.get(vlan) : '',
    });
    proposedDevices.push({
      tempId,
      ip:  ip || undefined,
      mac: mac || undefined,
      name: effName,
      nameSource: effSrc,
      vendor: vendor || fp.vendor || guessVendor(descr, null),
      kind: fp.kind,
      kindConfident: fp.confident,
      hint: hint || '',
      vlan: vlan != null ? vlan : undefined,
      dhcpComment: dhcpComment || undefined,
      dhcpHost: dhcpHost || undefined,
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
      nameSrc: mt.self.name ? 'sysname' : 'ip',
      vendor: 'MikroTik',
      descr: 'RouterOS ' + (mt.self.model || ''),
      hint: 'MikroTik seed',
    });

    if (!selfMatched) {
      // Update the just-created proposed device to be a router
      const pd = proposedDevices.find(p => selfDeviceRef.tempId && p.tempId === selfDeviceRef.tempId);
      if (pd) { pd.kind = 'router'; pd.kindConfident = true; pd.vendor = 'MikroTik'; }
    }

    for (const n of mt.neighbors) {
      if (!n.mac && !n.ip) continue;
      const remoteRef = refFor({
        ip: n.ip, mac: n.mac, name: n.name,
        nameSrc: n.name ? 'sysname' : (n.ip ? 'ip' : 'mac'),
        vendor: guessVendor(n.platform || n.board, null),
        descr: (n.platform || '') + ' ' + (n.board || ''),
        hint: 'via LLDP/neighbor from ' + (mt.self.name || rootHost),
        // v0.52.0: сосед на vlan-интерфейсе (v_Office) — знаем его VLAN.
        // v0.53.0: фолбэк — сосед на access-порту из bridge/switch vlan table.
        vlan: (mt.vlanIfaceByName || {})[n.localIface]
           ?? (mt.vlanByPort || {})[n.localIface],
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
      // Skip if we already added a neighbor with same MAC (avoid dup link).
      // v0.52.0: ключи seenTempByKey теперь с префиксами ('m:'/'i:'/...).
      const fdbKnownTemp = seenTempByKey.get('m:' + f.mac);
      const fdbKnownExisting = idx.byMac.get(f.mac);
      if ((fdbKnownTemp || fdbKnownExisting) && proposedLinks.some(l =>
        (l.toRef.tempId && l.toRef.tempId === fdbKnownTemp) ||
        (l.toRef.existingId && l.toRef.existingId === fdbKnownExisting))) continue;
      const remoteRef = refFor({
        ip, mac: f.mac,
        name: ip || f.mac,
        nameSrc: ip ? 'ip' : 'mac', // refFor сам подтянет DHCP-имя, если есть
        vendor: '',
        descr: '',
        hint: 'via bridge FDB on ' + (mt.self.name || rootHost),
        // v0.52.0: FDB на access-порту → VLAN известен из bridge vlan table.
        vlan: (mt.vlanByPort || {})[f.onIface],
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
      nameSrc: s.self.name ? 'sysname' : 'ip',
      vendor: s.self.vendor, descr: s.self.descr,
      hint: 'SNMP seed',
    });
    if (!seedRef) continue;

    for (const l of s.lldp) {
      const macCandidate = normMac(l.chassisId) || normMac(l.portId);
      // remote sysName if present
      const name = l.sysName || l.chassisId || 'lldp neighbour';
      // v0.52.0: IP соседа — из lldpRemManAddr; текстовый chassisId
      // («Switch-2F») тоже считается именем, MAC — нет.
      const lldpSrc = (l.sysName || (l.chassisId && !macCandidate)) ? 'sysname' : 'mac';
      const remoteRef = refFor({
        ip: l.mgmtIp || '',
        mac: macCandidate,
        name,
        nameSrc: lldpSrc,
        vendor: guessVendor(l.sysDesc, null),
        descr: l.sysDesc,
        hint: 'LLDP neighbour via ' + s.self.name,
        stableKey: l.chassisId || l.portId || l.sysName || '',
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
      // v0.52.0: ключи seenTempByKey теперь с префиксами.
      const snmpKnownTemp = seenTempByKey.get('m:' + f.mac);
      const snmpKnownExisting = idx.byMac.get(f.mac);
      const dupe = (snmpKnownTemp || snmpKnownExisting) && proposedLinks.some(l =>
        (l.toRef.tempId && l.toRef.tempId === snmpKnownTemp) ||
        (l.toRef.existingId && l.toRef.existingId === snmpKnownExisting));
      if (dupe) continue;
      const fdbIp = snmpArpByMac.get(f.mac) || '';
      const remoteRef = refFor({
        ip: fdbIp, mac: f.mac,
        name: fdbIp || f.mac,
        nameSrc: fdbIp ? 'ip' : 'mac',
        vlan: f.vlan, // v0.52.0: из Q-BRIDGE-MIB, если коммутатор отдал
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
  // v0.51.23: если для пары устройств есть LLDP-связь (порты с обеих сторон),
  // грубую SSH-связь «MikroTik /ip neighbor» по той же паре убираем — иначе
  // в режиме «оба» список забит SSH-дублями и выглядит, будто SNMP не работал.
  const lldpPairs = new Set();
  for (const l of uniqLinks) {
    if (!String(l.evidence || '').startsWith('LLDP')) continue;
    const a = l.fromRef.existingId || l.fromRef.tempId;
    const b = l.toRef.existingId   || l.toRef.tempId;
    lldpPairs.add(a < b ? a + '|' + b : b + '|' + a);
  }
  const preferredLinks = uniqLinks.filter(l => {
    if (String(l.evidence || '').startsWith('MikroTik /ip neighbor')) {
      const a = l.fromRef.existingId || l.fromRef.tempId;
      const b = l.toRef.existingId   || l.toRef.tempId;
      const pk = a < b ? a + '|' + b : b + '|' + a;
      if (lldpPairs.has(pk)) return false;
    }
    return true;
  });

  const finalLinks = preferredLinks.filter(l => {
    const a = l.fromRef.existingId || l.fromRef.tempId;
    const b = l.toRef.existingId   || l.toRef.tempId;
    return a !== b;
  });

  // v0.52.0: справочники для фильтров в окне предпросмотра.
  const subnets = (mt && mt.ok && Array.isArray(mt.addresses))
    ? mt.addresses.map(a => ({ cidr: a.cidr, interface: a.interface || '', comment: a.comment || '' }))
    : [];
  const vlanIdSet = new Set();
  for (const pd of proposedDevices) if (pd.vlan != null) vlanIdSet.add(pd.vlan);
  if (mt && mt.ok && mt.vlanNames) for (const id of Object.keys(mt.vlanNames)) vlanIdSet.add(Number(id));
  // v0.53.0: + VLAN с switch-chip роутера и статические VLAN-таблицы
  // опрошенных коммутаторов (находятся даже пустые VLAN).
  if (mt && mt.ok && Array.isArray(mt.switchVlanIds)) for (const id of mt.switchVlanIds) vlanIdSet.add(id);
  for (const s of (snmpResults || [])) {
    if (!s || !s.ok || !s.vlanList) continue;
    for (const v of s.vlanList) if (v && v.id != null) vlanIdSet.add(v.id);
  }
  const vlans = Array.from(vlanIdSet).sort((a, b) => a - b).map(id => ({
    id,
    name: vlanNameById.get(id) || '',
  }));

  return { proposedDevices, proposedLinks: finalLinks, warnings, subnets, vlans };
}

// v0.51.23: сотни одинаковых «[ip] SNMP probe failed: Request timed out»
// схлопываем в одну сводную строку со счётчиком и примерами хостов,
// иначе предупреждения затапливают весь предпросмотр.
function aggregateWarnings(list) {
  const out = [];
  const buckets = new Map();
  for (const w of list) {
    const m = /^\[([^\]]+)\]\s*(SNMP probe failed:.*)$/.exec(String(w));
    if (!m) { out.push(w); continue; }
    let e = buckets.get(m[2]);
    if (!e) { e = { msg: m[2], ips: [], count: 0 }; buckets.set(m[2], e); }
    e.count++;
    if (e.ips.length < 5) e.ips.push(m[1]);
  }
  for (const e of buckets.values()) {
    let line = `${e.count} хостов: ${e.msg} (например: ${e.ips.join(', ')}${e.count > e.ips.length ? ', …' : ''})`;
    // v0.54.0: таймауты — не ошибка сканирования, а молчание хостов.
    // Подсказываем прямо в строке, иначе «205 хостов: …timed out» пугает.
    if (/timed?\s*out/i.test(e.msg)) {
      line += ' — обычно это норма: у хоста нет SNMP-агента, другой community или закрыт firewall. ' +
              'Скан намеренно опрашивает каждый IP из ARP-таблицы, молчуны просто пропускаются.';
    }
    out.push(line);
  }
  return out;
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
  // v0.51.20: РЕКУРСИВНЫЙ обход волнами. Первая волна — seed + явные
  // snmpSeeds; каждая следующая — management-IP LLDP-соседей, найденных
  // предыдущей. Ограничения: число прыжков (1..3) и всего хостов (24),
  // чтобы случайный «public» не полз по всей сети предприятия часами.
  const recursive = cfg.snmpRecursive !== false;
  const maxHops = Math.max(1, Math.min(3, Number(cfg.snmpMaxHops) || 2));
  const MAX_HOSTS = 24;
  const scannedSet = new Set();
  let frontier = Array.from(snmpHosts);
  let hopsUsed = 0;
  for (let hop = 0; hop <= maxHops && frontier.length > 0; hop++) {
    const wave = frontier.filter(h => !scannedSet.has(h));
    frontier = [];
    if (wave.length === 0) break;
    if (hop > 0) hopsUsed = hop;
    await Promise.all(wave.map(async (h) => {
      scannedSet.add(h);
      const r = await collectSnmp(h, community, { timeout: cfg.snmpTimeout || 2500 });
      snmpResults.push(r);
      if (r.warnings && r.warnings.length) warnings.push(`[${h}] ` + r.warnings.join('; '));
      if (recursive && hop < maxHops) {
        for (const ip of r.mgmtAddrs || []) {
          if (!scannedSet.has(ip) && !frontier.includes(ip)
              && snmpResults.length + frontier.length < MAX_HOSTS) {
            frontier.push(ip);
          }
        }
      }
    }));
  }

  const merged = makeProposal({ doc, rootHost, mt, snmpResults });
  const stats = {
    ms: now() - t0,
    neighborsFound: mt ? mt.neighbors.length : 0,
    fdbEntries:     mt ? mt.fdb.length : 0,
    arpEntries:     mt ? mt.arp.length : 0,
    leases:         mt ? mt.leases.length : 0,   // v0.52.0: DHCP-лизы (имена)
    snmpHosts:      snmpResults.filter(s => s.ok).length, // v0.54.0: только ответившие (было: все попытки)
    snmpProbed:     snmpResults.length,   // v0.54.0: всего попыток опроса (с учётом рекурсии)
    hops:           hopsUsed,
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
    subnets: merged.subnets,   // v0.52.0: эталонные подсети роутера
    vlans: merged.vlans,       // v0.52.0: {id, name} для фильтра по VLAN
    warnings: aggregateWarnings([...warnings, ...merged.warnings]),
    stats,
  };
}

// makeProposal экспортирован для модульных проверок (node -e / будущие тесты).
module.exports = { scan, test, makeProposal };
