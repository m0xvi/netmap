/**
 * v0.40 — Favicon fetcher with 30-day SQLite cache.
 *
 * We use Google's public favicon service (`google.com/s2/favicons?domain=X`)
 * as a fallback for arbitrary URLs — it's the most reliable free source
 * that handles both HTTP and HTTPS sites without CORS issues.
 *
 * Cached in the `favicon_cache` table (created on first use):
 *   host TEXT PRIMARY KEY, data BLOB, mime TEXT, fetched INTEGER
 *
 * If the fetch fails we still cache a "null" entry for 6h so we don't
 * hammer the network on every render of a bad URL.
 *
 * Renderer gets base64 data URIs via IPC. Rendering N favicons at once
 * costs one IPC each — that's fine because they're memoized in the
 * renderer once resolved.
 */

const https = require('node:https');
const { URL } = require('node:url');

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;      // 30 days
const NEG_TTL_MS   = 6  * 60 * 60 * 1000;           // 6 hours for failed fetches
const MAX_SIZE     = 100 * 1024;                    // 100 KB safety cap

let ensured = false;
function ensureTable(db) {
  if (ensured) return;
  db._raw().exec(`
    CREATE TABLE IF NOT EXISTS favicon_cache (
      host    TEXT PRIMARY KEY,
      data    BLOB,
      mime    TEXT,
      fetched INTEGER NOT NULL
    );
  `);
  ensured = true;
}

function hostFromUrl(url) {
  if (!url) return null;
  try {
    let u = String(url).trim();
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    const parsed = new URL(u);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function fetchFromGoogle(host, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
    const opts = {
      host: 'www.google.com',
      port: 443,
      path: `/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
      method: 'GET',
      headers: { 'User-Agent': 'NetMap/0.40 favicon-fetcher' },
    };
    const req = https.request(opts, (res) => {
      if (res.statusCode !== 200) {
        res.resume(); resolve(null); return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total > MAX_SIZE) { req.destroy(); return; }
        chunks.push(c);
      });
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const mime = res.headers['content-type'] || 'image/png';
        resolve({ data: buf, mime });
      });
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/** Public: get favicon data URI (or null) for a URL. Cached in SQLite. */
async function get(db, url) {
  ensureTable(db);
  const host = hostFromUrl(url);
  if (!host) return { ok: false, error: 'no-host' };

  const row = db._raw().prepare(
    'SELECT data, mime, fetched FROM favicon_cache WHERE host = ?'
  ).get(host);

  const now = Date.now();
  if (row) {
    const age = now - row.fetched;
    const ttl = row.data ? CACHE_TTL_MS : NEG_TTL_MS;
    if (age < ttl) {
      if (!row.data) return { ok: false, error: 'no-favicon', cached: true };
      return {
        ok: true, cached: true, host,
        dataUri: `data:${row.mime || 'image/png'};base64,${Buffer.from(row.data).toString('base64')}`,
      };
    }
  }

  // Cache miss or stale — go fetch.
  const fetched = await fetchFromGoogle(host);
  const stmt = db._raw().prepare(
    `INSERT INTO favicon_cache (host, data, mime, fetched) VALUES (?, ?, ?, ?)
     ON CONFLICT(host) DO UPDATE SET data = excluded.data, mime = excluded.mime, fetched = excluded.fetched`
  );
  if (fetched) {
    stmt.run(host, fetched.data, fetched.mime, now);
    return {
      ok: true, cached: false, host,
      dataUri: `data:${fetched.mime};base64,${fetched.data.toString('base64')}`,
    };
  } else {
    stmt.run(host, null, null, now);
    return { ok: false, error: 'fetch-failed', host };
  }
}

module.exports = { get, hostFromUrl };
