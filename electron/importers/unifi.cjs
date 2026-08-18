/**
 * v0.37 — UniFi Controller importer (classic self-hosted, port 8443).
 *
 * Auth flow (classic):
 *   POST https://<host>:8443/api/login   { username, password, remember: false }
 *      → sets `unifises` + `csrf_token` cookies (we keep the whole cookie jar)
 *   GET  https://<host>:8443/api/self/sites          → list of sites
 *   GET  https://<host>:8443/api/s/<site>/stat/device → all APs, switches, gateways
 *   GET  https://<host>:8443/api/s/<site>/stat/sta   → all clients (associated)
 *   GET  https://<host>:8443/api/s/<site>/rest/user  → known clients (offline too)
 *   GET  https://<host>:8443/api/s/<site>/rest/networkconf → VLANs / L3 subnets
 *   POST https://<host>:8443/api/logout
 *
 * Uses Node's built-in `https` (no extra deps). `rejectUnauthorized:false` by
 * default (`insecure: true` in cfg) because UniFi controllers ship with a
 * self-signed certificate out of the box.
 *
 * NB: This does NOT support UniFi OS / UDM / Cloud Key Gen2+ — those need the
 * `/proxy/network/` prefix and X-CSRF-Token header. We ship classic-only per
 * user pick in v0.37; UDM support is a follow-up.
 */

const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

const DEFAULT_PORT = 8443;
const DEFAULT_SITE = 'default';

// ---------------------------------------------------------------------------
// HTTP helpers with a simple cookie jar

function makeJar() {
  const cookies = new Map(); // name -> value
  return {
    setFromResponse(res) {
      const raw = res.headers['set-cookie'];
      if (!raw) return;
      for (const line of raw) {
        const seg = line.split(';')[0];
        const eq = seg.indexOf('=');
        if (eq < 0) continue;
        const name = seg.slice(0, eq).trim();
        const val = seg.slice(eq + 1).trim();
        if (name) cookies.set(name, val);
      }
    },
    header() {
      if (cookies.size === 0) return null;
      return Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    },
    get(name) { return cookies.get(name) || null; },
  };
}

function request(method, urlStr, { jar, body, insecure, timeoutMs = 15000, extraHeaders } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(new Error(`Bad URL: ${urlStr}`)); }
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const headers = Object.assign({
      'Accept': 'application/json',
      'User-Agent': 'NetMap/0.37',
    }, extraHeaders || {});
    let payload = null;
    if (body != null) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    // CSRF: some UniFi builds require echoing csrf_token back on unsafe verbs.
    if (jar) {
      const cookie = jar.header();
      if (cookie) headers['Cookie'] = cookie;
      const csrf = jar.get('csrf_token');
      if (csrf && method !== 'GET') headers['X-Csrf-Token'] = csrf;
    }
    const opts = {
      method, headers,
      host: u.hostname, port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ''),
      rejectUnauthorized: !insecure,
    };
    const req = lib.request(opts, (res) => {
      if (jar) jar.setFromResponse(res);
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { /* not JSON */ }
        resolve({ status: res.statusCode || 0, headers: res.headers, raw, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`HTTP timeout after ${timeoutMs}ms`)); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// UniFi calls

function baseUrl(cfg) {
  const host = String(cfg.host || '').trim();
  const port = Number(cfg.port) || DEFAULT_PORT;
  if (!host) throw new Error('Host is required');
  return `https://${host}:${port}`;
}

async function login(cfg, jar) {
  const url = `${baseUrl(cfg)}/api/login`;
  const res = await request('POST', url, {
    jar, insecure: cfg.insecure !== false,
    body: { username: cfg.username, password: cfg.password, remember: false, strict: true },
  });
  if (res.status === 200) return true;
  if (res.status === 400 || res.status === 401) {
    const meta = res.json && res.json.meta;
    const msg = (meta && meta.msg) || 'Invalid credentials';
    throw new Error(`UniFi login failed (HTTP ${res.status}): ${msg}`);
  }
  throw new Error(`UniFi login failed (HTTP ${res.status})`);
}

async function logout(cfg, jar) {
  try { await request('POST', `${baseUrl(cfg)}/api/logout`, { jar, insecure: cfg.insecure !== false }); }
  catch { /* ignore */ }
}

async function listSites(cfg, jar) {
  const res = await request('GET', `${baseUrl(cfg)}/api/self/sites`, { jar, insecure: cfg.insecure !== false });
  if (res.status !== 200) throw new Error(`self/sites failed (HTTP ${res.status})`);
  const data = (res.json && res.json.data) || [];
  return data.map((s) => ({ name: s.name, desc: s.desc || s.name }));
}

async function fetchDevices(cfg, jar, site) {
  const res = await request('GET', `${baseUrl(cfg)}/api/s/${encodeURIComponent(site)}/stat/device`,
    { jar, insecure: cfg.insecure !== false, timeoutMs: 30000 });
  if (res.status !== 200) throw new Error(`stat/device failed (HTTP ${res.status})`);
  return (res.json && res.json.data) || [];
}

async function fetchClients(cfg, jar, site) {
  // Active (associated) clients
  const active = await request('GET', `${baseUrl(cfg)}/api/s/${encodeURIComponent(site)}/stat/sta`,
    { jar, insecure: cfg.insecure !== false, timeoutMs: 30000 });
  if (active.status !== 200) throw new Error(`stat/sta failed (HTTP ${active.status})`);
  return (active.json && active.json.data) || [];
}

async function fetchKnownUsers(cfg, jar, site) {
  const res = await request('GET', `${baseUrl(cfg)}/api/s/${encodeURIComponent(site)}/rest/user`,
    { jar, insecure: cfg.insecure !== false, timeoutMs: 30000 });
  if (res.status !== 200) return [];
  return (res.json && res.json.data) || [];
}

async function fetchNetworks(cfg, jar, site) {
  const res = await request('GET', `${baseUrl(cfg)}/api/s/${encodeURIComponent(site)}/rest/networkconf`,
    { jar, insecure: cfg.insecure !== false, timeoutMs: 30000 });
  if (res.status !== 200) return [];
  return (res.json && res.json.data) || [];
}

// ---------------------------------------------------------------------------
// Normalizers → ScanResult shape

function normalizeDeviceType(t) {
  // UniFi device `type` codes: uap, usw, ugw, udm, uxg, ubb, uls, etc.
  const s = String(t || '').toLowerCase();
  if (s === 'uap') return 'ap';
  if (s === 'usw') return 'switch';
  if (s === 'ugw' || s === 'udm' || s === 'uxg') return 'router';
  return s || 'unknown';
}

function normalizeMac(m) {
  if (!m) return '';
  return String(m).toUpperCase().replace(/-/g, ':');
}

function pickDeviceName(d) {
  return d.name || d.hostname || d.device_id || d.mac || 'unifi-device';
}

/** UniFi devices → we emit them both as `interfaces` (so the ImportDialog
 *  can list them) AND as ARP entries (so subnet grouping works). */
function toInterfaces(devs) {
  return devs.map((d) => ({
    name: pickDeviceName(d),
    type: normalizeDeviceType(d.type),
    mac: normalizeMac(d.mac),
    running: d.state === 1,
    disabled: d.state !== 1,
    comment: [d.model, d.version].filter(Boolean).join(' · '),
  }));
}

function toArpFromDevices(devs) {
  return devs
    .filter((d) => d.ip || d.mac)
    .map((d) => ({
      mac: normalizeMac(d.mac),
      ip: d.ip || null,
      interface: pickDeviceName(d),
      dynamic: false,
      complete: !!(d.ip && d.mac),
    }));
}

function toLeasesFromClients(clients, knownUsers) {
  // Merge active clients + known users by MAC. Active wins if both exist.
  const byMac = new Map();
  for (const u of knownUsers) {
    const mac = normalizeMac(u.mac);
    if (!mac) continue;
    byMac.set(mac, {
      mac,
      ip: u.last_ip || null,
      hostname: u.name || u.hostname || u.noted || '',
      comment: u.note || '',
      dynamic: !(u.use_fixedip),
      status: 'offline',
      server: '',
      expiresAfter: '',
    });
  }
  for (const c of clients) {
    const mac = normalizeMac(c.mac);
    if (!mac) continue;
    byMac.set(mac, {
      mac,
      ip: c.ip || c.last_ip || null,
      hostname: c.name || c.hostname || c.oui || '',
      comment: c.note || '',
      dynamic: !(c.use_fixedip),
      status: 'online',
      server: c.essid || '',
      expiresAfter: '',
    });
  }
  return Array.from(byMac.values());
}

function toAddressesFromNetworks(networks) {
  // UniFi networkconf entries have `ip_subnet` like "192.168.1.1/24"
  return networks
    .filter((n) => n.ip_subnet && n.purpose !== 'wan')
    .map((n) => {
      // Compute network address from ip_subnet by masking.
      const [ipStr, bitsStr] = String(n.ip_subnet).split('/');
      const bits = Number(bitsStr) || 24;
      const parts = ipStr.split('.').map(Number);
      const ip = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
      const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
      const netInt = (ip & mask) >>> 0;
      const netStr = [(netInt >>> 24) & 0xff, (netInt >>> 16) & 0xff, (netInt >>> 8) & 0xff, netInt & 0xff].join('.');
      return {
        address: `${netStr}/${bits}`,
        network: netStr,
        interface: n.name || n.attr_hidden_id || '',
        comment: n.purpose || '',
        disabled: n.enabled === false,
      };
    });
}

function toVlansFromNetworks(networks) {
  return networks
    .filter((n) => Number(n.vlan) > 0)
    .map((n) => ({
      vlanId: Number(n.vlan),
      name: n.name || `VLAN ${n.vlan}`,
      iface: '',
      comment: n.purpose || '',
      source: 'interface',
      disabled: n.enabled === false,
    }));
}

// ---------------------------------------------------------------------------
// Public API

async function testConnection(cfg) {
  const jar = makeJar();
  try {
    await login(cfg, jar);
    const sites = await listSites(cfg, jar);
    return {
      ok: true,
      identity: `UniFi Controller (${cfg.host})`,
      version: `${sites.length} site(s)`,
      sites,
    };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  } finally {
    await logout(cfg, jar);
  }
}

async function scan(cfg) {
  const jar = makeJar();
  const site = String(cfg.site || DEFAULT_SITE);
  try {
    await login(cfg, jar);
    // Sequential (like MikroTik SSH) — small controllers hate concurrent calls.
    const devs = await fetchDevices(cfg, jar, site);
    let clients = [];
    let knownUsers = [];
    let networks = [];
    if (cfg.fetchLeases !== false) {
      try { clients = await fetchClients(cfg, jar, site); } catch (e) { /* soft-fail */ }
      try { knownUsers = await fetchKnownUsers(cfg, jar, site); } catch (e) { /* soft-fail */ }
    }
    if (cfg.fetchVlans !== false) {
      try { networks = await fetchNetworks(cfg, jar, site); } catch (e) { /* soft-fail */ }
    }
    return {
      resource: { ok: true, identity: `UniFi/${site}`, version: `${devs.length} devices` },
      leases: toLeasesFromClients(clients, knownUsers),
      arp: toArpFromDevices(devs),
      interfaces: toInterfaces(devs),
      vlans: toVlansFromNetworks(networks),
      addresses: toAddressesFromNetworks(networks),
    };
  } catch (e) {
    return {
      resource: { ok: false, error: e && e.message ? e.message : String(e) },
      leases: [], arp: [], interfaces: [], vlans: [], addresses: [],
    };
  } finally {
    await logout(cfg, jar);
  }
}

module.exports = { testConnection, scan };
