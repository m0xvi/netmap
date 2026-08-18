/**
 * v0.37 — TP-Link Omada Cloud importer (omada.tplinkcloud.com).
 *
 * ⚠️ Notes on the Cloud API:
 *   - Omada Cloud does *not* expose a fully documented public REST API for
 *     third-party integrators. What we call here is the same web endpoint
 *     the customer-facing Cloud web UI uses:
 *       POST  https://omada.tplinkcloud.com/api/v2/hotspot/login
 *              → returns { errorCode, result: { token } }
 *       GET   https://omada.tplinkcloud.com/api/v2/users/current?token=…
 *       GET   https://omada.tplinkcloud.com/api/v2/users/orgs?token=…
 *       GET   https://omada.tplinkcloud.com/api/v2/orgs/<orgId>/sites?token=…
 *       GET   https://omada.tplinkcloud.com/api/v2/sites/<siteKey>/devices?token=…
 *       GET   https://omada.tplinkcloud.com/api/v2/sites/<siteKey>/clients/active?token=…
 *   - TP-Link may change these endpoints without warning; treat as
 *     best-effort. If Cloud login stops working we fall back to explaining
 *     to the user that they should use a local Omada Controller (planned).
 *   - 2FA/MFA: if the account has SMS/email verification enabled, login
 *     will return a challenge that we do NOT yet handle — user must temp
 *     disable MFA to import (documented in the dialog help text).
 */

const https = require('node:https');
const { URL } = require('node:url');

const CLOUD_HOST = 'omada.tplinkcloud.com';

function request(method, urlStr, { body, timeoutMs = 20000, extraHeaders } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(new Error(`Bad URL: ${urlStr}`)); }
    const headers = Object.assign({
      'Accept': 'application/json',
      'User-Agent': 'NetMap/0.37',
    }, extraHeaders || {});
    let payload = null;
    if (body != null) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      headers['Content-Type'] = 'application/json;charset=UTF-8';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const opts = {
      method, headers,
      host: u.hostname, port: u.port || 443,
      path: u.pathname + (u.search || ''),
      rejectUnauthorized: true,
    };
    const req = https.request(opts, (res) => {
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
// Auth

async function cloudLogin(cfg) {
  // Omada expects `appType` + hashed pass in some flows, but the web UI still
  // accepts plain username/password. We try that first.
  const res = await request('POST', `https://${CLOUD_HOST}/api/v2/hotspot/login`, {
    body: {
      name: cfg.username,
      password: cfg.password,
      terminalUUID: 'netmap-desktop',
    },
  });
  if (res.status !== 200) throw new Error(`Omada Cloud login HTTP ${res.status}`);
  if (!res.json) throw new Error('Omada Cloud login: non-JSON response');
  if (res.json.errorCode !== 0) {
    const msg = res.json.msg || `errorCode=${res.json.errorCode}`;
    throw new Error(`Omada Cloud login failed: ${msg}`);
  }
  const token = res.json.result && res.json.result.token;
  if (!token) throw new Error('Omada Cloud login: token missing in response');
  return token;
}

async function getOrgs(token) {
  const res = await request('GET', `https://${CLOUD_HOST}/api/v2/users/orgs?token=${encodeURIComponent(token)}`);
  if (res.status !== 200 || !res.json) throw new Error(`orgs HTTP ${res.status}`);
  if (res.json.errorCode !== 0) throw new Error(`orgs failed: ${res.json.msg || res.json.errorCode}`);
  return res.json.result || [];
}

async function getSites(token, orgId) {
  const res = await request('GET',
    `https://${CLOUD_HOST}/api/v2/orgs/${encodeURIComponent(orgId)}/sites?token=${encodeURIComponent(token)}`);
  if (res.status !== 200 || !res.json) throw new Error(`sites HTTP ${res.status}`);
  if (res.json.errorCode !== 0) throw new Error(`sites failed: ${res.json.msg || res.json.errorCode}`);
  return res.json.result || [];
}

async function getDevices(token, siteKey) {
  const res = await request('GET',
    `https://${CLOUD_HOST}/api/v2/sites/${encodeURIComponent(siteKey)}/devices?token=${encodeURIComponent(token)}`);
  if (res.status !== 200 || !res.json) throw new Error(`devices HTTP ${res.status}`);
  if (res.json.errorCode !== 0) throw new Error(`devices failed: ${res.json.msg || res.json.errorCode}`);
  return res.json.result || [];
}

async function getClients(token, siteKey) {
  const res = await request('GET',
    `https://${CLOUD_HOST}/api/v2/sites/${encodeURIComponent(siteKey)}/clients/active?token=${encodeURIComponent(token)}`);
  if (res.status !== 200 || !res.json) return [];
  if (res.json.errorCode !== 0) return [];
  return res.json.result || [];
}

// ---------------------------------------------------------------------------
// Normalizers

function normalizeMac(m) {
  if (!m) return '';
  return String(m).toUpperCase().replace(/-/g, ':');
}

function normalizeType(t) {
  const s = String(t || '').toLowerCase();
  if (s.includes('ap')) return 'ap';
  if (s.includes('switch') || s === 'sw') return 'switch';
  if (s.includes('gateway') || s === 'gw' || s.includes('router')) return 'router';
  return s || 'unknown';
}

function toInterfaces(devs) {
  return devs.map((d) => ({
    name: d.name || d.hostname || d.mac || 'omada-device',
    type: normalizeType(d.type || d.deviceType),
    mac: normalizeMac(d.mac),
    running: (d.status === 'CONNECTED') || (d.status === 1) || (d.state === 1),
    disabled: false,
    comment: [d.model, d.firmwareVersion].filter(Boolean).join(' · '),
  }));
}

function toArpFromDevices(devs) {
  return devs
    .filter((d) => d.ip || d.mac)
    .map((d) => ({
      mac: normalizeMac(d.mac),
      ip: d.ip || null,
      interface: d.name || d.hostname || '',
      dynamic: false,
      complete: !!(d.ip && d.mac),
    }));
}

function toLeasesFromClients(clients) {
  return clients.map((c) => ({
    mac: normalizeMac(c.mac),
    ip: c.ip || null,
    hostname: c.name || c.hostname || '',
    comment: c.vendor || '',
    dynamic: true,
    status: 'online',
    server: c.ssid || '',
    expiresAfter: '',
  }));
}

// ---------------------------------------------------------------------------
// Public API

async function testConnection(cfg) {
  try {
    const token = await cloudLogin(cfg);
    const orgs = await getOrgs(token);
    return {
      ok: true,
      identity: `Omada Cloud (${cfg.username})`,
      version: `${orgs.length} organization(s)`,
      orgs: orgs.map((o) => ({ id: o.orgId || o.id, name: o.name })),
    };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

async function scan(cfg) {
  try {
    const token = await cloudLogin(cfg);
    const orgs = await getOrgs(token);
    if (orgs.length === 0) throw new Error('Omada Cloud: no organizations found');

    // Pick the org and site. If cfg.orgId/siteKey are provided use them, else
    // first available. Multi-site orgs are common — we recommend the user
    // picks the site explicitly in the dialog.
    const org = cfg.orgId ? orgs.find((o) => (o.orgId || o.id) === cfg.orgId) : orgs[0];
    if (!org) throw new Error(`Omada Cloud: org ${cfg.orgId} not found`);
    const sites = await getSites(token, org.orgId || org.id);
    if (sites.length === 0) throw new Error('Omada Cloud: no sites in organization');
    const site = cfg.siteKey ? sites.find((s) => (s.siteKey || s.key) === cfg.siteKey) : sites[0];
    if (!site) throw new Error(`Omada Cloud: site ${cfg.siteKey} not found`);
    const siteKey = site.siteKey || site.key;

    const devices = await getDevices(token, siteKey);
    const clients = (cfg.fetchLeases !== false) ? await getClients(token, siteKey) : [];

    return {
      resource: {
        ok: true,
        identity: `Omada/${site.name || siteKey}`,
        version: `${devices.length} devices, ${clients.length} clients`,
      },
      leases: toLeasesFromClients(clients),
      arp: toArpFromDevices(devices),
      interfaces: toInterfaces(devices),
      vlans: [],
      addresses: [],
    };
  } catch (e) {
    return {
      resource: { ok: false, error: e && e.message ? e.message : String(e) },
      leases: [], arp: [], interfaces: [], vlans: [], addresses: [],
    };
  }
}

module.exports = { testConnection, scan };
