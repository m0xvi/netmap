/**
 * v0.36.2 — ICMP traceroute (streaming).
 *
 * Wraps the OS-native binary:
 *   Windows: tracert -d -h <maxHops> -w <ms> <target>
 *   Unix:    traceroute -n -q 1 -w 2 -m <maxHops> <target>
 *
 * We PARSE stdout line-by-line and stream partial hop results to the
 * renderer via a custom IPC channel `netmap:traceroute-hop`. That way
 * the UI can render each hop as soon as it arrives (traceroute takes
 * 15-30 сек до дальних хопов, а пользователь хочет видеть путь по мере
 * появления).
 *
 * IPC:
 *   netmap:tracerouteStart({ target, maxHops, timeoutMs, requestId })
 *     → { ok, requestId }  — стартовало.
 *   Events:
 *     netmap:traceroute-hop { requestId, hop: { n, host, rttMs?, timeout? } }
 *     netmap:traceroute-done { requestId, ok, error? }
 *   netmap:tracerouteStop({ requestId }) — прервать.
 */

const { spawn } = require('child_process');

const running = new Map();   // requestId → child

function start(cfg, sender) {
  const requestId = String(cfg?.requestId || Math.random().toString(36).slice(2));
  const target = String(cfg?.target || '').trim();
  if (!target) return { ok: false, error: 'target пустой', requestId };
  const maxHops   = Math.max(1, Math.min(64, Number(cfg?.maxHops) || 30));
  const timeoutMs = Math.max(500, Math.min(10000, Number(cfg?.timeoutMs) || 2000));

  const isWin = process.platform === 'win32';
  const cmd  = isWin ? 'tracert' : 'traceroute';
  const args = isWin
    ? ['-d', '-h', String(maxHops), '-w', String(timeoutMs), target]
    : ['-n', '-q', '1', '-w', String(Math.max(1, Math.round(timeoutMs / 1000))),
       '-m', String(maxHops), target];

  let child;
  try {
    child = spawn(cmd, args, { windowsHide: true });
  } catch (e) {
    return { ok: false, error: `spawn failed: ${e.message}`, requestId };
  }
  running.set(requestId, child);

  const emitHop = (hop) => {
    try { sender.send('netmap:traceroute-hop', { requestId, hop }); } catch {}
  };
  const emitDone = (ok, error) => {
    running.delete(requestId);
    try { sender.send('netmap:traceroute-done', { requestId, ok, error }); } catch {}
  };

  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      const hop = parseHopLine(line, isWin);
      if (hop) emitHop(hop);
    }
  });
  child.stderr.on('data', (d) => {
    // tracert on Windows sometimes writes "unable to resolve" here.
    // Attach as pseudo-error but don't kill — the tool may recover.
    console.warn('[traceroute stderr]', d.toString().trim());
  });
  child.on('error', (e) => emitDone(false, String(e?.message || e)));
  child.on('close', (code) => emitDone(code === 0, code === 0 ? undefined : `exit code ${code}`));

  return { ok: true, requestId };
}

function stop(requestId) {
  const child = running.get(requestId);
  if (!child) return { ok: false, error: 'нет активной сессии' };
  try { child.kill(); running.delete(requestId); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

// ---- parsers -----------------------------------------------------------

/**
 * Windows tracert output samples:
 *   "  1     2 ms     1 ms     1 ms  192.168.11.1"
 *   "  2     *        *        *     Request timed out."
 *   "  3    12 ms    13 ms    12 ms  10.10.10.1"
 * We only asked for 1 probe with -h/-w, so the tracert output here has
 * 3 x RTT columns still (that's just how tracert formats it). Take the
 * FIRST non-* rtt; if all three are *, mark timeout.
 *
 * Unix traceroute -n -q 1:
 *   " 1  192.168.11.1  0.412 ms"
 *   " 2  * "
 *   " 3  10.0.0.1  12.345 ms"
 */
function parseHopLine(line, isWin) {
  const s = line.trim();
  if (!s) return null;
  // Skip header lines ("Tracing route to …", "Trace complete.", banner).
  if (/^Tracing route|Trace complete|Over a maximum|Traceroute to|hops max/i.test(s)) return null;

  if (isWin) {
    // Match hop number
    const m = /^(\d+)\s+(.+)$/.exec(s);
    if (!m) return null;
    const n = Number(m[1]);
    const rest = m[2];
    // Try three RTT slots: "X ms" or "*" or "<1 ms"
    const rttRe = /(?:(<?\d+)\s*ms|\*)/g;
    let rttMs = null;
    let firstMatch;
    while ((firstMatch = rttRe.exec(rest)) !== null) {
      if (firstMatch[1] != null) {
        rttMs = Number(firstMatch[1].replace('<', ''));
        break;
      }
    }
    // Host — trailing IP after RTT columns
    const ipMatch = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s*$/.exec(rest);
    const host = ipMatch ? ipMatch[1] : (/Request timed out/i.test(rest) ? null : rest.replace(/^\s+/, '').split(/\s+/).pop() || null);
    const timeout = rttMs == null;
    return { n, host, rttMs, timeout };
  } else {
    const m = /^(\d+)\s+(.+)$/.exec(s);
    if (!m) return null;
    const n = Number(m[1]);
    const rest = m[2].trim();
    if (rest === '*' || /^\*\s*$/.test(rest)) return { n, host: null, timeout: true };
    // "192.168.11.1  0.412 ms" — first token is host, then rtt
    const parts = rest.split(/\s+/);
    const host = parts[0] === '*' ? null : parts[0];
    const rttToken = parts.find(p => /^\d+(\.\d+)?$/.test(p));
    const rttMs = rttToken ? Math.round(Number(rttToken) * 100) / 100 : null;
    return { n, host, rttMs, timeout: rttMs == null };
  }
}

module.exports = { start, stop, _parseHopLine: parseHopLine };
