/**
 * v0.35.9 — MikroTik importer over SSH (RouterOS CLI).
 * v0.35.10 — hardened parser + `/export compact` fallback + raw-output debug.
 *
 * REST API (port 80/443) is often disabled on production MikroTik boxes for
 * security. SSH is on by default and rarely restricted, so we drive the CLI
 * via `ssh2` and parse the output.
 *
 * The wire format from `print terse` is fiddly:
 *   Flags: X - disabled, R - radius, D - dynamic, B - blocked
 *    0 D  address=192.168.11.100 mac-address=AA:BB:CC:11:22:33 server=dhcp1
 *    1 XD address=192.168.11.101 mac-address=AA:BB:CC:11:22:34 ...
 *   12 D  address=192.168.11.112 comment="Ivan's laptop"
 *
 * Quirks the previous parser missed:
 *   - Rows start with LEADING WHITESPACE for column alignment.
 *   - Flag block is optional (some entries have no flags).
 *   - Flag chars are variable-length: `D`, `XD`, `XDR`, `RS`, `AS`, `*` …
 *   - Long lines wrap with a leading whitespace on the continuation.
 *   - Some RouterOS builds prefix header ";;; comment" lines.
 *   - "print without-paging terse" is more reliable than plain "print terse"
 *     on some builds — some do "pausing prompt" mid-output.
 */

const { Client } = require('ssh2');

// ---------- Low-level SSH helpers -----------------------------------------

/**
 * v0.35.12 — SAFE algorithm set only.
 *
 * Previous version enumerated `chacha20-poly1305@openssh.com` in the cipher
 * list. On some Electron builds ssh2 fails to initialize that cipher (Node's
 * crypto lacks it, or the pure-JS fallback isn't wired in) and throws
 * `Unsupported algorithm: chacha20-poly1305@openssh.com` DURING options
 * validation — before ever contacting the router. Result: handshake never
 * even started.
 *
 * The set below is deliberately conservative: every entry is available in
 * ssh2's default supported list AND known to work in Electron/Node builds
 * without native ciphers. RouterOS 6.30+ and 7.x can negotiate at least one
 * KEX / cipher / MAC / host-key from this list.
 */
function connectionAlgorithms() {
  return {
    kex: [
      // Modern (RouterOS 7+)
      'curve25519-sha256',
      'curve25519-sha256@libssh.org',
      'ecdh-sha2-nistp256',
      'ecdh-sha2-nistp384',
      'ecdh-sha2-nistp521',
      'diffie-hellman-group-exchange-sha256',
      'diffie-hellman-group14-sha256',
      'diffie-hellman-group16-sha512',
      'diffie-hellman-group18-sha512',
      // Legacy (RouterOS 6.x with strong-crypto=no)
      'diffie-hellman-group-exchange-sha1',
      'diffie-hellman-group14-sha1',
      'diffie-hellman-group1-sha1',
    ],
    cipher: [
      // AEAD — supported everywhere, no external deps.
      'aes128-gcm@openssh.com', 'aes256-gcm@openssh.com',
      // CTR — universally supported.
      'aes128-ctr', 'aes192-ctr', 'aes256-ctr',
      // CBC — needed for older RouterOS builds.
      'aes256-cbc', 'aes192-cbc', 'aes128-cbc',
      '3des-cbc',
      // NOTE: `chacha20-poly1305@openssh.com` intentionally NOT listed —
      // some Electron builds reject it at options-validation time.
    ],
    hmac: [
      'hmac-sha2-256-etm@openssh.com',
      'hmac-sha2-512-etm@openssh.com',
      'hmac-sha2-256',
      'hmac-sha2-512',
      'hmac-sha1-etm@openssh.com',
      'hmac-sha1',
      'hmac-md5',
    ],
    serverHostKey: [
      'ssh-ed25519',
      'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521',
      'rsa-sha2-512', 'rsa-sha2-256',
      'ssh-rsa',
      'ssh-dss',
    ],
  };
}

/**
 * v0.35.12 — fallback strategy for `Unsupported algorithm: X` errors.
 * ssh2 walks the arrays we pass in and REJECTS the whole connect() call
 * if it finds an algorithm name it can't instantiate. Rather than making
 * the user re-run manually, we retry once with the offending algorithm
 * stripped out.
 */
function tryDropUnsupported(algos, badName) {
  const dropFrom = (arr) => arr.filter(a => a !== badName);
  return {
    kex: dropFrom(algos.kex),
    cipher: dropFrom(algos.cipher),
    hmac: dropFrom(algos.hmac),
    serverHostKey: dropFrom(algos.serverHostKey),
  };
}

function runCommand(cfg, cmd, _retryAlgos) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let out = '';
    let err = '';
    let done = false;
    const finish = (fn, val) => { if (!done) { done = true; try { conn.end(); } catch {}; fn(val); } };

    const timer = setTimeout(
      () => finish(reject, new Error(`SSH timeout after ${cfg.timeoutMs || 12000} ms`)),
      cfg.timeoutMs || 12000
    );

    conn.on('ready', () => {
      conn.exec(cmd, { pty: false }, (execErr, stream) => {
        if (execErr) { clearTimeout(timer); return finish(reject, execErr); }
        stream.on('data', (chunk) => { out += chunk.toString('utf8'); });
        stream.stderr.on('data', (chunk) => { err += chunk.toString('utf8'); });
        stream.on('close', () => {
          clearTimeout(timer);
          if (err && !out) finish(reject, new Error(err.trim()));
          else finish(resolve, out);
        });
      });
    });
    conn.on('error', (e) => {
      clearTimeout(timer);
      // v0.35.12: auto-retry once if the failure is "Unsupported algorithm: X" —
      // strip X from the algorithm arrays and try again. Recursive with the
      // reduced set until no unsupported names remain (or all buckets are empty).
      const msg = String(e?.message || e);
      const m = /Unsupported algorithm:\s*(\S+)/i.exec(msg);
      if (m) {
        const bad = m[1];
        const base = _retryAlgos || connectionAlgorithms();
        const next = tryDropUnsupported(base, bad);
        const empty = !next.kex.length || !next.cipher.length || !next.hmac.length || !next.serverHostKey.length;
        if (!empty) {
          try { conn.end(); } catch {}
          done = true;
          runCommand(cfg, cmd, next).then(resolve, reject);
          return;
        }
      }
      finish(reject, e);
    });
    const algos = _retryAlgos || connectionAlgorithms();
    // Sanity: options-validate the algos list against ssh2's supported set —
    // if any name is unknown, drop it up-front instead of triggering the
    // Client's ctor throw (which is harder to recover from).
    const cleanAlgos = filterToSupported(algos);
    conn.connect({
      host: cfg.host,
      port: cfg.port || 22,
      username: cfg.username,
      password: cfg.password,
      tryKeyboard: true,
      readyTimeout: cfg.timeoutMs || 12000,
      algorithms: cleanAlgos,
    });
    conn.on('keyboard-interactive', (_name, _instr, _lang, prompts, submit) => {
      submit(prompts.map(() => cfg.password || ''));
    });
  });
}

/** Drop any algorithm name not present in ssh2's own SUPPORTED_* arrays.
 *  This prevents the `Unsupported algorithm: X` exception being thrown
 *  synchronously from connect() (before we ever hit the network). */
function filterToSupported(algos) {
  let C;
  try { C = require('ssh2/lib/protocol/constants'); }
  catch { return algos; }   // very old ssh2 — fall back to raw list
  const keep = (arr, allow) => Array.isArray(arr) && Array.isArray(allow)
    ? arr.filter(a => allow.includes(a))
    : arr;
  return {
    kex:           keep(algos.kex,           C.SUPPORTED_KEX),
    cipher:        keep(algos.cipher,        C.SUPPORTED_CIPHER),
    hmac:          keep(algos.hmac,          C.SUPPORTED_MAC),
    serverHostKey: keep(algos.serverHostKey, C.SUPPORTED_SERVER_HOST_KEY),
  };
}

// ---------- Parser for `print terse` output --------------------------------

/**
 * v0.35.10 — rewritten terse parser.
 *
 * Strategy:
 *   1. Split into physical lines. Skip blanks, headers ("Flags:", "Columns:"),
 *      comment lines (";;;"), and paging prompts ("-- [Q quit|D dump…]").
 *   2. A DATA LINE starts (after leading whitespace) with:  digits + space.
 *      Anything else is a continuation of the previous line (line-wrap).
 *      This is more forgiving than the old "must start with a digit at
 *      column 0" rule — MikroTik uses right-aligned indexes so all rows
 *      begin with 1-3 spaces.
 *   3. Once we have a stitched data line, strip the leading index + optional
 *      flag block (up to 8 A-Z or `*` chars, followed by whitespace).
 *   4. Tokenize `key=value` pairs (quoted or bare).
 */
function parseTerse(text) {
  if (!text || typeof text !== 'string') return [];

  // 1) Fold continuation lines into their data-line owner.
  const physicalLines = text.split(/\r?\n/);
  const stitched = [];
  for (const raw of physicalLines) {
    // Skip banner / header lines outright (they never appear inside data blocks).
    if (/^\s*Flags:/i.test(raw)) continue;
    if (/^\s*Columns:/i.test(raw)) continue;
    if (/^\s*;;;/.test(raw)) continue;             // ;;; comment
    if (/^--\s*\[.*\]/.test(raw)) continue;        // paging prompt
    if (/^\s*$/.test(raw)) continue;               // blank

    // Data line = leading spaces + digit(s). Otherwise → continuation.
    if (/^\s*\d+\s/.test(raw)) {
      stitched.push(raw);
    } else if (stitched.length) {
      // Continuation of the previous data row — append with a space.
      stitched[stitched.length - 1] += ' ' + raw.trim();
    }
    // Else: garbage before the first data row — ignore.
  }

  const rows = [];
  for (const rawLine of stitched) {
    // Strip leading "<idx> [<flags>] "
    // - digits: 1+
    // - optional whitespace
    // - optional flag block: 1-8 chars from [A-Z*]
    // - required trailing whitespace before key=value payload
    const body = rawLine
      .replace(/^\s*\d+\s+/, '')
      .replace(/^([A-Z*!]{1,8})\s+/, '');

    if (!body) continue;

    // Tokenize `key=value key="quoted value" key=`
    // Key: alphanumerics + hyphens + underscores.
    // Value: quoted string OR non-whitespace run (may be empty).
    const obj = {};
    const re = /([a-zA-Z0-9_.-]+)=("(?:[^"\\]|\\.)*"|\S*)/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      const key = m[1];
      let val = m[2] ?? '';
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
      obj[key] = val;
    }
    // Only keep rows that actually have data (guard against pure "0 X" lines).
    if (Object.keys(obj).length > 0) rows.push(obj);
  }
  return rows;
}

// ---------- High-level import queries -------------------------------------

async function testConnection(cfg) {
  // v0.35.11: DO NOT swallow errors here — a failed handshake / auth used to
  // return `{ ok: true, boardName: 'unknown' }` and the UI showed a green
  // "✓ Подключено" badge even though nothing worked. Now we let the FIRST
  // command's error propagate so the UI can show the real reason.
  let ident = '';
  try { ident = await runCommand(cfg, ':put [/system identity get name]'); }
  catch (e) { throw e; }   // handshake / auth failure — surface it

  // resource is best-effort — some hardened user policies deny it even when
  // identity is allowed. Losing the version isn't fatal.
  let resource = '';
  try { resource = await runCommand(cfg, '/system resource print without-paging'); }
  catch { resource = ''; }

  const identity = (ident || '').trim() || null;
  const resObj = {};
  for (const line of (resource || '').split(/\r?\n/)) {
    const m = /^\s*([a-z0-9-]+):\s*(.+?)\s*$/i.exec(line);
    if (m) resObj[m[1].toLowerCase()] = m[2];
  }
  return {
    ok: true,
    boardName: resObj['board-name'] || 'unknown',
    version:   resObj['version']    || 'unknown',
    uptime:    resObj['uptime']     || '',
    cpuLoad:   resObj['cpu-load'] ? Number(String(resObj['cpu-load']).replace('%', '')) : undefined,
    identity,
  };
}

async function fetchDhcpLeases(cfg) {
  // `without-paging` prevents the CLI from stopping at page breaks (which
  // would otherwise wait for a keypress we can't send over exec-only channels).
  const out = await runCommand(cfg, '/ip dhcp-server lease print terse without-paging');
  return parseTerse(out).map(r => ({
    mac:      (r['mac-address'] || '').toUpperCase(),
    ip:       r['address'] || r['active-address'] || null,
    hostname: r['host-name'] || r['comment'] || '',
    comment:  r['comment'] || '',
    dynamic:  r['dynamic'] === 'true',
    status:   r['status'] || (r['disabled'] === 'true' ? 'disabled' : 'unknown'),
    server:   r['server'] || '',
    expiresAfter: r['expires-after'] || '',
  })).filter(l => l.mac);
}

async function fetchArp(cfg) {
  const out = await runCommand(cfg, '/ip arp print terse without-paging');
  return parseTerse(out).map(r => ({
    mac:       (r['mac-address'] || '').toUpperCase(),
    ip:        r['address'] || null,
    interface: r['interface'] || '',
    dynamic:   r['dynamic'] === 'true',
    // "complete" is present as "true"/"false" on ROS 7, absent on 6 — assume true if missing.
    complete:  r['complete'] !== 'false',
  })).filter(a => a.mac && a.ip);
}

async function fetchInterfaces(cfg) {
  const out = await runCommand(cfg, '/interface print terse without-paging');
  return parseTerse(out).map(r => ({
    name:     r['name'] || '',
    type:     r['type'] || '',
    mac:      (r['mac-address'] || '').toUpperCase(),
    running:  r['running']  === 'true',
    disabled: r['disabled'] === 'true',
    comment:  r['comment'] || '',
  }));
}

async function fetchVlans(cfg) {
  const [vlanIfacesOut, bridgeVlansOut] = await Promise.all([
    runCommand(cfg, '/interface vlan print terse without-paging').catch(() => ''),
    runCommand(cfg, '/interface bridge vlan print terse without-paging').catch(() => ''),
  ]);
  const vlanIfaces  = parseTerse(vlanIfacesOut);
  const bridgeVlans = parseTerse(bridgeVlansOut);

  const byId = new Map();
  const put = (id, patch) => {
    const n = Number(id);
    if (!Number.isFinite(n) || n < 1 || n > 4094) return;
    const prev = byId.get(n) || { vlanId: n };
    byId.set(n, { ...prev, ...patch });
  };

  for (const v of vlanIfaces) {
    put(v['vlan-id'], {
      name: v['name'] || '',
      iface: v['interface'] || '',
      comment: v['comment'] || '',
      source: 'interface',
      disabled: v['disabled'] === 'true',
    });
  }
  for (const v of bridgeVlans) {
    const ids = expandVlanIds(v['vlan-ids'] || '');
    for (const id of ids) {
      put(id, {
        bridge: v['bridge'] || '',
        taggedPorts:   v['tagged']   || '',
        untaggedPorts: v['untagged'] || '',
        source: byId.get(id)?.source || 'bridge',
      });
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.vlanId - b.vlanId);
}

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
  return out;
}

async function fetchAddresses(cfg) {
  const out = await runCommand(cfg, '/ip address print terse without-paging');
  return parseTerse(out).map(r => ({
    address:   r['address'] || '',
    network:   r['network'] || '',
    interface: r['interface'] || '',
    comment:   r['comment'] || '',
    disabled:  r['disabled'] === 'true',
  })).filter(a => a.address.includes('/'));
}

/**
 * v0.35.10 — RAW debug fetch. Runs each command and returns its raw stdout
 * so the UI can show the user *exactly* what the router said. Invaluable
 * when the parser silently returns [] and the user has no idea why.
 */
async function fetchRawDebug(cfg) {
  const cmds = [
    '/system identity print',
    '/system resource print without-paging',
    '/ip dhcp-server lease print terse without-paging',
    '/ip arp print terse without-paging',
    '/ip address print terse without-paging',
    '/interface print terse without-paging',
    '/interface vlan print terse without-paging',
  ];
  const results = {};
  for (const c of cmds) {
    try {
      results[c] = { ok: true, out: await runCommand(cfg, c) };
    } catch (e) {
      results[c] = { ok: false, error: String(e?.message || e) };
    }
  }
  return results;
}

async function scan(cfg) {
  // v0.35.11: if testConnection fails (bad host / handshake / auth), don't
  // bother running the other commands — they'd all fail the same way and
  // waste 6 SSH connect attempts. Just return the error in resource.error.
  let resource;
  try {
    resource = await testConnection(cfg);
  } catch (e) {
    return {
      resource: { ok: false, error: String(e?.message || e) },
      leases: [], arp: [], interfaces: [], vlans: [], addresses: [],
    };
  }
  // Sequential — some hardened RouterOS setups rate-limit concurrent SSH.
  const leases     = cfg.fetchLeases     !== false ? await fetchDhcpLeases(cfg).catch(() => []) : [];
  const arp        = cfg.fetchArp        !== false ? await fetchArp(cfg).catch(() => [])        : [];
  const interfaces = cfg.fetchInterfaces !== false ? await fetchInterfaces(cfg).catch(() => []) : [];
  const vlans      = cfg.fetchVlans      !== false ? await fetchVlans(cfg).catch(() => [])      : [];
  const addresses  = await fetchAddresses(cfg).catch(() => []);
  return { resource, leases, arp, interfaces, vlans, addresses };
}

module.exports = {
  testConnection,
  fetchDhcpLeases,
  fetchArp,
  fetchInterfaces,
  fetchVlans,
  fetchAddresses,
  fetchRawDebug,
  scan,
  // Exposed for unit-testing.
  _parseTerse: parseTerse,
};
