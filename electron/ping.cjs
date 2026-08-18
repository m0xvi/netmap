// Cross-platform reachability probe. Prefers ICMP (system `ping`), falls back to TCP-connect.
// Runs in the Electron main process only.

const { spawn } = require('child_process');
const net = require('net');
const os = require('os');

/**
 * ICMP-based probe via system `ping` binary.
 * Returns { alive: bool, rttMs?: number, method: 'icmp' }
 */
function icmpPing(host, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    // Windows: -n 1 -w <ms> ; Unix: -c 1 -W <sec>
    const args = isWin
      ? ['-n', '1', '-w', String(timeoutMs), host]
      : ['-c', '1', '-W', String(Math.max(1, Math.round(timeoutMs / 1000))), host];

    let output = '';
    let done = false;
    let child;
    try {
      child = spawn('ping', args);
    } catch (e) {
      return resolve({ alive: false, method: 'icmp', error: 'spawn-failed' });
    }

    const killTimer = setTimeout(() => {
      if (!done) { done = true; try { child.kill('SIGKILL'); } catch {} resolve({ alive: false, method: 'icmp', error: 'timeout' }); }
    }, timeoutMs + 500);

    child.stdout.on('data', (d) => { output += d.toString(); });
    child.on('error', () => {
      if (done) return;
      done = true; clearTimeout(killTimer);
      resolve({ alive: false, method: 'icmp', error: 'exec-error' });
    });
    child.on('close', (code) => {
      if (done) return;
      done = true; clearTimeout(killTimer);
      const alive = code === 0;
      let rttMs;
      // Parse "time=1.23 ms" (unix) or "time=1ms" (win)
      const m = output.match(/time[=<]\s*([\d.]+)\s*ms/i);
      if (m) rttMs = parseFloat(m[1]);
      resolve({ alive, rttMs, method: 'icmp' });
    });
  });
}

/**
 * TCP-connect probe: succeeds if we can open a TCP handshake to any of the given ports.
 * Useful when ICMP is blocked. Ports default to common admin/service ports.
 */
function tcpPing(host, timeoutMs = 1500, ports = [443, 80, 22, 8291, 8080, 8443]) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const start = Date.now();
    let remaining = ports.length;

    for (const port of ports) {
      const sock = new net.Socket();
      const t = setTimeout(() => { sock.destroy(); onDone(false); }, timeoutMs);
      sock.once('connect', () => {
        clearTimeout(t);
        sock.destroy();
        onDone(true, port);
      });
      sock.once('error', () => { clearTimeout(t); onDone(false); });
      sock.connect(port, host);

      function onDone(ok, portOk) {
        if (ok) return finish({ alive: true, rttMs: Date.now() - start, method: 'tcp', port: portOk });
        remaining--;
        if (remaining === 0) finish({ alive: false, method: 'tcp' });
      }
    }
  });
}

/**
 * Try ICMP first; if it fails with an obvious error (permission / no binary), fall back to TCP.
 * If ICMP just reports "not alive" (host is really down), we DO NOT retry TCP — to keep it fast.
 * Caller can pass forceTcp: true to skip ICMP entirely.
 */
async function probe(host, opts = {}) {
  const timeoutMs = opts.timeoutMs || 1500;
  if (opts.forceTcp) return tcpPing(host, timeoutMs);
  const icmp = await icmpPing(host, timeoutMs);
  if (icmp.alive) return icmp;
  if (icmp.error) {
    // ICMP couldn't run at all — try TCP as a courtesy
    const tcp = await tcpPing(host, timeoutMs);
    return tcp.alive ? tcp : icmp;
  }
  return icmp;
}

/**
 * Extract a usable host from a string like "192.168.11.1/24" or "10.0.0.5".
 * Returns null if it's not a plausible IP.
 */
function normalizeHost(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().split('/')[0].split(' ')[0];
  // very permissive: IPv4, IPv6, or a hostname
  if (!/^[a-zA-Z0-9._:-]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Probe a batch of {id, ip}. Returns [{ id, alive, rttMs?, method }].
 * Uses a concurrency of 8 to be nice to the OS.
 */
async function probeBatch(items, opts = {}) {
  const concurrency = opts.concurrency || 8;
  const timeoutMs = opts.timeoutMs || 1500;
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const my = idx++;
      const item = items[my];
      const host = normalizeHost(item.ip);
      if (!host) {
        results[my] = { id: item.id, alive: false, method: 'skip' };
        continue;
      }
      try {
        const r = await probe(host, { timeoutMs, forceTcp: opts.forceTcp });
        results[my] = { id: item.id, ...r };
      } catch (e) {
        results[my] = { id: item.id, alive: false, method: 'error' };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

module.exports = { probe, probeBatch, normalizeHost };
