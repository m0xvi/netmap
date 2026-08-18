/**
 * v0.36.2 — Wake-on-LAN (magic packet sender).
 *
 * Magic packet = 6 байт 0xFF + 16 повторов MAC-адреса (98 байт total).
 * Отправляется UDP на broadcast адрес порт 9 (по умолчанию) или 7.
 * Никаких сторонних библиотек — чистый dgram.
 *
 * IPC:
 *   netmap:wolSend({ mac, broadcastIp?, port? }) → { ok, sent, targets }
 *     mac         — обязательно (любой формат: AA:BB:CC:11:22:33 / aa-bb-cc-11-22-33 / aabbcc112233)
 *     broadcastIp — опционально. По умолчанию — 255.255.255.255 + все локальные bcast (обычно достаточно; для удалённых подсетей — 192.168.x.255)
 *     port        — 7 или 9 (default), можно любой
 *
 * Работает только в main process (dgram недоступен в renderer с contextIsolation).
 */

const dgram = require('dgram');
const os = require('os');

/** Normalize a MAC string into 6 bytes; returns null if invalid. */
function parseMac(macStr) {
  if (!macStr || typeof macStr !== 'string') return null;
  const hex = macStr.replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 12) return null;
  const out = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function buildMagicPacket(macBytes) {
  const pkt = Buffer.alloc(6 + 16 * 6);
  pkt.fill(0xFF, 0, 6);
  for (let i = 0; i < 16; i++) macBytes.copy(pkt, 6 + i * 6);
  return pkt;
}

/**
 * Enumerate every local IPv4 broadcast address of this machine.
 * We send to ALL of them so users don't have to guess which interface
 * their target is on. Also always send to 255.255.255.255 as a safety net.
 */
function localBroadcasts() {
  const out = new Set(['255.255.255.255']);
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const addr of ifs[name] || []) {
      if (addr.family !== 'IPv4') continue;
      if (addr.internal) continue;
      // Compute the network broadcast from address + netmask.
      const ip = addr.address.split('.').map(Number);
      const mask = (addr.netmask || '255.255.255.0').split('.').map(Number);
      if (ip.length !== 4 || mask.length !== 4) continue;
      const bcast = ip.map((oct, i) => (oct & mask[i]) | (~mask[i] & 0xFF)).join('.');
      out.add(bcast);
    }
  }
  return Array.from(out);
}

/**
 * Send a magic packet.
 * @param {object} cfg
 * @param {string} cfg.mac
 * @param {string} [cfg.broadcastIp]  — если не задан, шлём во все локальные + 255.255.255.255
 * @param {number} [cfg.port=9]
 * @returns {Promise<{ok:boolean, sent:number, targets:string[], error?:string}>}
 */
function send(cfg) {
  return new Promise((resolve) => {
    const macBytes = parseMac(cfg?.mac);
    if (!macBytes) return resolve({ ok: false, sent: 0, targets: [], error: 'Некорректный MAC' });
    const port = Number(cfg?.port) || 9;
    const targets = cfg?.broadcastIp
      ? [String(cfg.broadcastIp)]
      : localBroadcasts();
    const packet = buildMagicPacket(macBytes);

    const sock = dgram.createSocket('udp4');
    let sent = 0;
    let firstErr = null;
    let pending = targets.length;
    const done = () => {
      try { sock.close(); } catch {}
      resolve({
        ok: sent > 0,
        sent,
        targets,
        error: sent === 0 ? (firstErr || 'no broadcast target reachable') : undefined,
      });
    };

    sock.on('error', (e) => { firstErr = firstErr || String(e?.message || e); });
    // Enable broadcast — иначе OS отклонит.
    sock.bind(() => {
      try { sock.setBroadcast(true); }
      catch (e) { firstErr = firstErr || String(e?.message || e); }
      if (targets.length === 0) return done();
      for (const t of targets) {
        sock.send(packet, 0, packet.length, port, t, (err) => {
          if (err) firstErr = firstErr || String(err?.message || err);
          else sent++;
          if (--pending === 0) done();
        });
      }
    });
  });
}

module.exports = { send };
