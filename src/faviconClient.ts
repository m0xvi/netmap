/**
 * v0.40 — Favicon fetcher (with in-memory renderer cache on top of the
 * SQLite backend cache).
 *
 * Usage:
 *   const uri = await getFavicon('https://192.168.1.1'); // → 'data:image/png;base64,…' or null
 */

const w = typeof window !== 'undefined' ? (window as any) : {};
const hasBackend = !!(w.netmap && typeof w.netmap.favicon === 'function');

const memoryCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

export async function getFavicon(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  const key = hostKey(url);
  if (!key) return null;
  if (memoryCache.has(key)) return memoryCache.get(key)!;
  if (inflight.has(key)) return inflight.get(key)!;

  const p = (async () => {
    if (!hasBackend) return null;
    try {
      const res = await w.netmap.favicon(url);
      const dataUri = res && res.ok ? res.dataUri as string : null;
      memoryCache.set(key, dataUri);
      return dataUri;
    } catch {
      memoryCache.set(key, null);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

function hostKey(url: string): string | null {
  try {
    let u = String(url).trim();
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
}
