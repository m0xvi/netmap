/**
 * v0.40 — Interactive SSH shell via ssh2 (no node-pty needed).
 *
 * Uses the same `ssh2` npm module that MikroTik importer uses. Opens a
 * "shell" stream, forwards keystrokes from the renderer, streams stdout
 * back via IPC events.
 *
 * IPC:
 *   netmap:sshOpen  {sessionId, host, port, username, password}    → { ok, error? }
 *   netmap:sshWrite {sessionId, data}                              → { ok }
 *   netmap:sshResize {sessionId, cols, rows}                       → { ok }
 *   netmap:sshClose {sessionId}                                    → { ok }
 *
 * Renderer events (via preload):
 *   netmap:ssh-data  {sessionId, data}
 *   netmap:ssh-close {sessionId, code?, reason?}
 *   netmap:ssh-error {sessionId, error}
 *
 * NB: We DON'T get a real PTY (that would need node-pty) — instead we
 * request a "vt100" pseudo-tty from the SSH server, which is enough for
 * most CLI tools (bash, RouterOS CLI, tail -f). Full-screen apps like
 * vim/less may render awkwardly but usually work.
 */

const { Client } = require('ssh2');

const sessions = new Map(); // sessionId -> { client, stream, sender }

function open(cfg, sender) {
  const id = String(cfg.sessionId || Math.random().toString(36).slice(2));
  if (sessions.has(id)) {
    close(id);
  }
  return new Promise((resolve) => {
    const client = new Client();
    let resolved = false;

    client.on('ready', () => {
      client.shell({ term: 'xterm-256color', cols: cfg.cols || 100, rows: cfg.rows || 30 }, (err, stream) => {
        if (err) {
          if (!resolved) { resolved = true; resolve({ ok: false, error: err.message }); }
          try { client.end(); } catch {}
          return;
        }
        sessions.set(id, { client, stream, sender });

        stream.on('data', (chunk) => {
          try { sender.send('netmap:ssh-data', { sessionId: id, data: chunk.toString('utf8') }); }
          catch {}
        });
        stream.stderr.on('data', (chunk) => {
          try { sender.send('netmap:ssh-data', { sessionId: id, data: chunk.toString('utf8') }); }
          catch {}
        });
        stream.on('close', (code, signal) => {
          sessions.delete(id);
          try { sender.send('netmap:ssh-close', { sessionId: id, code, signal }); } catch {}
          try { client.end(); } catch {}
        });

        if (!resolved) { resolved = true; resolve({ ok: true, sessionId: id }); }
      });
    });

    client.on('error', (err) => {
      sessions.delete(id);
      if (!resolved) { resolved = true; resolve({ ok: false, error: err.message || String(err) }); }
      else {
        try { sender.send('netmap:ssh-error', { sessionId: id, error: err.message || String(err) }); } catch {}
      }
    });
    client.on('close', () => {
      if (sessions.has(id)) {
        sessions.delete(id);
        try { sender.send('netmap:ssh-close', { sessionId: id, reason: 'connection closed' }); } catch {}
      }
    });

    client.connect({
      host: String(cfg.host || '').trim(),
      port: Number(cfg.port) || 22,
      username: String(cfg.username || ''),
      password: cfg.password ? String(cfg.password) : undefined,
      privateKey: cfg.privateKey || undefined,
      readyTimeout: 15000,
      // Broad set of legacy algorithms so we can talk to old RouterOS/D-Link.
      algorithms: {
        kex: [
          'curve25519-sha256', 'curve25519-sha256@libssh.org',
          'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521',
          'diffie-hellman-group-exchange-sha256',
          'diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1',
          'diffie-hellman-group1-sha1',
        ],
        serverHostKey: [
          'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384',
          'ecdsa-sha2-nistp521', 'rsa-sha2-512', 'rsa-sha2-256',
          'ssh-rsa', 'ssh-dss',
        ],
        cipher: [
          'aes128-gcm@openssh.com', 'aes256-gcm@openssh.com',
          'aes128-ctr', 'aes192-ctr', 'aes256-ctr',
          'aes128-cbc', 'aes192-cbc', 'aes256-cbc',
          '3des-cbc',
        ],
      },
    });
  });
}

function write(sessionId, data) {
  const s = sessions.get(sessionId);
  if (!s || !s.stream) return { ok: false, error: 'session-not-found' };
  try { s.stream.write(data); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

function resize(sessionId, cols, rows) {
  const s = sessions.get(sessionId);
  if (!s || !s.stream) return { ok: false, error: 'session-not-found' };
  try { s.stream.setWindow(rows || 30, cols || 100, 0, 0); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

function close(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return { ok: true };
  try { if (s.stream) s.stream.end(); } catch {}
  try { if (s.client) s.client.end(); } catch {}
  sessions.delete(sessionId);
  return { ok: true };
}

module.exports = { open, write, resize, close };
