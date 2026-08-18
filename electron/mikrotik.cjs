// MikroTik RouterOS REST API client.
// Requires RouterOS v7.1+ with `/ip service enable www-ssl` (or www) and a user with
// the `api` group. Docs: https://help.mikrotik.com/docs/display/ROS/REST+API
//
// Works in main-process only (Node's fetch / undici — no CORS restrictions).
// Supports:
//   • Basic auth (username:password)
//   • HTTP or HTTPS (self-signed certs accepted when opts.insecure === true)
//   • Endpoints: /ip/dhcp-server/lease, /ip/arp, /system/resource, /interface, /ip/address

const https = require('https');
const http = require('http');
const { URL } = require('url');

function request(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const auth = opts.username != null
      ? 'Basic ' + Buffer.from(`${opts.username}:${opts.password || ''}`).toString('base64')
      : undefined;
    const reqOpts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(auth ? { 'Authorization': auth } : {}),
        ...(opts.headers || {}),
      },
      timeout: opts.timeoutMs || 8000,
      // Accept self-signed HTTPS (very common on RouterOS)
      rejectUnauthorized: !opts.insecure,
    };
    const req = lib.request(reqOpts, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        const status = res.statusCode || 0;
        if (status >= 200 && status < 300) {
          try { resolve(JSON.parse(raw)); }
          catch { resolve(raw); }
        } else {
          reject(new Error(`HTTP ${status}: ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Request timeout')); });
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

/**
 * Test connectivity: hit /system/resource and return a small summary.
 */
async function testConnection(cfg) {
  const base = normalizeBase(cfg.host);
  const res = await request(`${base}/rest/system/resource`, {
    username: cfg.username, password: cfg.password, insecure: cfg.insecure,
  });
  return {
    ok: true,
    boardName: res['board-name'] || res.boardName || 'unknown',
    version:   res.version || 'unknown',
    uptime:    res.uptime || '',
    cpuLoad:   res['cpu-load'] ?? res.cpuLoad,
    identity:  null,
  };
}

/**
 * Read DHCP leases. Returns array of:
 *   { mac, ip, hostname, comment, dynamic, status, server, expiresAfter }
 */
async function fetchDhcpLeases(cfg) {
  const base = normalizeBase(cfg.host);
  const raw = await request(`${base}/rest/ip/dhcp-server/lease`, {
    username: cfg.username, password: cfg.password, insecure: cfg.insecure,
  });
  if (!Array.isArray(raw)) return [];
  return raw.map(r => ({
    mac:       (r['mac-address'] || r.macAddress || '').toUpperCase(),
    ip:        r.address || r['active-address'] || null,
    hostname:  r['host-name']  || r.hostName || r.comment || '',
    comment:   r.comment || '',
    dynamic:   String(r.dynamic) === 'true',
    status:    r.status || (String(r.disabled) === 'true' ? 'disabled' : 'unknown'),
    server:    r.server || '',
    expiresAfter: r['expires-after'] || r.expiresAfter || '',
  })).filter(l => l.mac);   // must have a MAC
}

/**
 * Read ARP table (useful for discovering static IPs that don't have DHCP leases).
 */
async function fetchArp(cfg) {
  const base = normalizeBase(cfg.host);
  const raw = await request(`${base}/rest/ip/arp`, {
    username: cfg.username, password: cfg.password, insecure: cfg.insecure,
  });
  if (!Array.isArray(raw)) return [];
  return raw.map(r => ({
    mac:       (r['mac-address'] || r.macAddress || '').toUpperCase(),
    ip:        r.address || null,
    interface: r.interface || '',
    dynamic:   String(r.dynamic) === 'true',
    complete:  String(r.complete) === 'true',
  })).filter(a => a.mac && a.ip);
}

/**
 * Read VLAN interfaces + bridge VLAN table.
 *   /rest/interface/vlan          — legacy L2 VLAN interfaces (vlan-id + parent iface)
 *   /rest/interface/bridge/vlan   — RouterOS 7 bridge VLAN filtering table
 *
 * Both endpoints may be empty if the router doesn't use that mechanism —
 * we merge results by vlan-id, taking the first mention as canonical.
 */
async function fetchVlans(cfg) {
  const base = normalizeBase(cfg.host);
  const auth = { username: cfg.username, password: cfg.password, insecure: cfg.insecure };

  const [vlanIfaces, bridgeVlans] = await Promise.all([
    request(`${base}/rest/interface/vlan`, auth).catch(() => []),
    request(`${base}/rest/interface/bridge/vlan`, auth).catch(() => []),
  ]);

  const byId = new Map();
  const put = (id, patch) => {
    const n = Number(id);
    if (!Number.isFinite(n) || n < 1 || n > 4094) return;
    const prev = byId.get(n) || { vlanId: n };
    byId.set(n, { ...prev, ...patch });
  };

  if (Array.isArray(vlanIfaces)) {
    for (const v of vlanIfaces) {
      put(v['vlan-id'] || v.vlanId, {
        name: v.name || '',
        iface: v.interface || '',
        comment: v.comment || '',
        source: 'interface',
        disabled: String(v.disabled) === 'true',
      });
    }
  }

  if (Array.isArray(bridgeVlans)) {
    for (const v of bridgeVlans) {
      // bridge vlan entries have a comma-separated vlan-ids field ("10,20,30-40")
      const ids = expandVlanIds(v['vlan-ids'] || v.vlanIds || '');
      for (const id of ids) {
        put(id, {
          bridge: v.bridge || '',
          taggedPorts: v.tagged || '',
          untaggedPorts: v.untagged || '',
          comment: v.comment || (byId.get(id)?.comment ?? ''),
          source: byId.get(id)?.source || 'bridge',
        });
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.vlanId - b.vlanId);
}

/** Expand "10,20,30-33,100" → [10, 20, 30, 31, 32, 33, 100]. */
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

/**
 * Read the router's own interfaces (useful for reflecting physical uplinks).
 */
async function fetchInterfaces(cfg) {
  const base = normalizeBase(cfg.host);
  const raw = await request(`${base}/rest/interface`, {
    username: cfg.username, password: cfg.password, insecure: cfg.insecure,
  });
  if (!Array.isArray(raw)) return [];
  return raw.map(r => ({
    name:   r.name,
    type:   r.type,
    mac:    (r['mac-address'] || '').toUpperCase(),
    running: String(r.running) === 'true',
    disabled: String(r.disabled) === 'true',
    comment: r.comment || '',
  }));
}

/**
 * v0.35.9 NEW — /ip address list for the subnet picker.
 * Each entry has an `address` string like "192.168.11.1/24" that the
 * UI groups by CIDR to let the user check/uncheck subnets before import.
 */
async function fetchAddresses(cfg) {
  const base = normalizeBase(cfg.host);
  const raw = await request(`${base}/rest/ip/address`, {
    username: cfg.username, password: cfg.password, insecure: cfg.insecure,
  }).catch(() => []);
  if (!Array.isArray(raw)) return [];
  return raw.map(r => ({
    address:   r.address || '',
    network:   r.network || '',
    interface: r.interface || '',
    comment:   r.comment  || '',
    disabled:  String(r.disabled) === 'true',
  })).filter(a => a.address.includes('/'));
}

/** Convenience: run everything the importer needs in one shot. */
async function scan(cfg) {
  const [resource, leases, arp, interfaces, vlans, addresses] = await Promise.all([
    testConnection(cfg).catch(e => ({ ok: false, error: String(e.message || e) })),
    cfg.fetchLeases     !== false ? fetchDhcpLeases(cfg).catch(() => []) : Promise.resolve([]),
    cfg.fetchArp        !== false ? fetchArp(cfg).catch(() => [])       : Promise.resolve([]),
    cfg.fetchInterfaces !== false ? fetchInterfaces(cfg).catch(() => []): Promise.resolve([]),
    cfg.fetchVlans      !== false ? fetchVlans(cfg).catch(() => [])     : Promise.resolve([]),
    fetchAddresses(cfg).catch(() => []),
  ]);
  return { resource, leases, arp, interfaces, vlans, addresses };
}

function normalizeBase(host) {
  if (!host) throw new Error('host is required');
  if (!/^https?:\/\//i.test(host)) host = 'https://' + host;
  return host.replace(/\/+$/, '');
}

module.exports = { testConnection, fetchDhcpLeases, fetchArp, fetchInterfaces, fetchVlans, fetchAddresses, scan };
