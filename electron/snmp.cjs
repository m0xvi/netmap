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
// v0.76.9: DES для SNMPv3 authPriv. net-snmp шифрует DES через OpenSSL 'des-cbc'
// (выключен в OpenSSL 3) и содержит заглушку вместо DES — см. desCompat.cjs.
const { installDesCompat } = require('./desCompat.cjs');
installDesCompat();

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

  // v0.52.0: Q-BRIDGE-MIB per-VLAN FDB — тот же FDB, но с номером VLAN.
  // Индекс: VlanId(1 subid) + MAC(6 subids). Status: 3=learned, 4=self, 5=mgmt.
  dot1qTpFdbPort:    '1.3.6.1.2.1.17.7.1.2.2.1.2',   // bridge port
  dot1qTpFdbStatus:  '1.3.6.1.2.1.17.7.1.2.2.1.3',
  // v0.53.0: статическая VLAN-таблица коммутатора — перечисляет ВСЕ VLAN,
  // известные железке, даже без единого найденного устройства в них.
  dot1qVlanStaticName: '1.3.6.1.2.1.17.7.1.4.3.1.1', // index = VlanId
  // v0.76.7: динамические/текущие VLAN (созданные не вручную) —
  // индекс: TimeMark(1 subid) + VlanId. Берём последний subid.
  dot1qVlanCurrentEgressPorts: '1.3.6.1.2.1.17.7.1.4.2.1.4',
  // v0.76.7: PVID порта (default VLAN для нетегированного трафика); индекс = bridge port.
  dot1qPvid: '1.3.6.1.2.1.17.7.1.4.5.1.1',

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

/** v0.75.1: чистая сборка v3-параметров сессии (юнит-тестируемая).
 *  level: noAuthNoPriv | authNoPriv | authPriv; протоколы — строками
 *  ('md5'|'sha'|'sha256'… / 'des'|'aes'|'aes256b'…), как ключи net-snmp. */
// v0.76.5: net-snmp ждёт USM-параметры В ОБЪЕКТЕ ПОЛЬЗОВАТЕЛЯ
// {name, level, authProtocol, authKey, privProtocol, privKey}, а не в опциях
// сессии. Раньше имя передавалось строкой, а level/протоколы — в options:
// user.name === undefined → пустой msgUserName → authorizationError на любом
// агенте (поймано живым прогоном против pysnmp-агента).
function buildV3User(v3) {
  const level = (v3.level && snmp.SecurityLevel[v3.level]) || snmp.SecurityLevel.noAuthNoPriv;
  const u = { name: v3.user, level };
  if (level >= snmp.SecurityLevel.authNoPriv) {
    u.authProtocol = snmp.AuthProtocols[v3.authProtocol || 'sha'] || snmp.AuthProtocols.sha;
    u.authKey = v3.authKey || '';
  }
  if (level === snmp.SecurityLevel.authPriv) {
    u.privProtocol = snmp.PrivProtocols[v3.privProtocol || 'aes'] || snmp.PrivProtocols.aes;
    u.privKey = v3.privKey || '';
  }
  return u;
}
// Совместимость: старые юниты/вызовы.
function buildV3Options(v3) {
  const u = buildV3User(v3);
  return { version: snmp.Version3, level: u.level,
    ...(u.authProtocol != null ? { authProtocol: u.authProtocol, authKey: u.authKey } : {}),
    ...(u.privProtocol != null ? { privProtocol: u.privProtocol, privKey: u.privKey } : {}) };
}

// v0.76.9: понятные причины отказа SNMPv3. Исходный текст ошибки сохраняется в скобках.
const V3_ERRORS = [
  [/Wrong Digest/i, 'SNMPv3: неверный пароль аутентификации или протокол auth (MD5/SHA/SHA-2). Проверьте ключ или нажмите «Подобрать протокол».'],
  [/Unknown User Name/i, 'SNMPv3: такого пользователя нет на устройстве. Проверьте имя (например, zbx) и что SNMPv3 включён.'],
  [/Unknown Engine ID/i, 'SNMPv3: устройство не приняло engine ID. Обычно это временная рассинхронизация — повторите попытку.'],
  [/Decryption Error/i, 'SNMPv3: ошибка расшифровки. Неверный ключ шифрования (priv) или протокол шифрования (DES/AES).'],
  [/Unsupported Security Level/i, 'SNMPv3: устройство не поддерживает выбранный уровень безопасности. Попробуйте уровень authNoPriv или authPriv.'],
  [/Not In Time Window/i, 'SNMPv3: расхождение времени с устройством. Повторите попытку.'],
];
function humanizeError(msg, v3) {
  const text = String(msg || '');
  if (!v3 || !v3.user) return text;
  for (const [re, human] of V3_ERRORS) if (re.test(text)) return `${human} (${text})`;
  if (/timed out/i.test(text)) {
    return `SNMPv3: нет ответа. Чаще всего неверное имя пользователя, выключенный SNMPv3 или неверный протокол auth. Нажмите «Подобрать протокол». (${text})`;
  }
  return text;
}
function errText(e, opts) {
  return humanizeError(e && e.message ? e.message : String(e), opts && opts.v3);
}

function mkSession(host, community, opts = {}) {
  const base = {
    port: opts.port || 161,
    retries: opts.retries != null ? opts.retries : 1,
    timeout: opts.timeout || 2500,
    transport: 'udp4',
    trapPort: 162,
    idBitsSize: 32,
  };
  // v0.75.1: SNMPv3 (USM) — отдельный тип сессии в net-snmp.
  if (opts.v3 && opts.v3.user) {
    return snmp.createV3Session(host, buildV3User(opts.v3), { ...base });
  }
  const version = opts.snmpVersion === '1' ? snmp.Version1 : snmp.Version2c;
  return snmp.createSession(host, community || 'public', { ...base, version });
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
    return { ok: false, error: errText(e, opts) };
  }
}

// ---------- Safe wrappers (IPC-facing) ------------------------------------

async function getSafe(host, community, oids, opts) {
  try { return { ok: true, values: await get(host, community, oids, opts) }; }
  catch (e) { return { ok: false, error: errText(e, opts) }; }
}

async function walkSafe(host, community, rootOid, opts) {
  try { return { ok: true, items: await walk(host, community, rootOid, opts) }; }
  catch (e) { return { ok: false, error: errText(e, opts) }; }
}

async function tableSafe(host, community, rootOid, opts) {
  try { return { ok: true, rows: await table(host, community, rootOid, opts) }; }
  catch (e) { return { ok: false, error: errText(e, opts) }; }
}

// v0.76.9: подбор протокола SNMPv3. Пробуем комбинации auth×priv от самой частой
// к редкой; первый успешный ответ фиксирует протокол. Неверный протокол обычно
// отвечает «Wrong Digest» почти мгновенно, молчащий агент режется таймаутом.
const V3_AUTH_CANDIDATES = ['sha', 'md5', 'sha256', 'sha512'];
const V3_PRIV_CANDIDATES = ['aes', 'des'];
async function detectV3(host, v3Base, opts = {}) {
  const level = v3Base.level || 'authNoPriv';
  const authList = level === 'noAuthNoPriv' ? [null] : V3_AUTH_CANDIDATES;
  const privList = level === 'authPriv' ? V3_PRIV_CANDIDATES : [null];
  const tried = [];
  for (const a of authList) {
    for (const p of privList) {
      const v3 = {
        ...v3Base,
        ...(a ? { authProtocol: a } : {}),
        ...(p ? { privProtocol: p } : {}),
      };
      const r = await probe(host, '', { timeout: opts.timeout || 1500, retries: 0, snmpVersion: '3', v3 });
      tried.push({ authProtocol: a || '', privProtocol: p || '', ok: !!r.ok, error: r.ok ? '' : r.error });
      if (r.ok) {
        return { ok: true, authProtocol: a || '', privProtocol: p || '', sysName: r.sysName || '', sysDescr: r.sysDescr || '', tried };
      }
    }
  }
  return { ok: false, error: 'Ни одна комбинация протоколов не подошла. Проверьте имя пользователя, ключ и уровень безопасности.', tried };
}

module.exports = {
  OID,
  detectV3,
  humanizeError,
  get,
  walk,
  table,
  probe,
  getSafe,
  walkSafe,
  tableSafe,
  buildV3Options,
  buildV3User,
};
