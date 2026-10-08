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
const { sshAuthFragment } = require('./sshAuth.cjs');

const sessions = new Map(); // sessionId -> { client, stream, sender }

/**
 * Удаляем запись сессии только если она всё ещё принадлежит этому клиенту/потоку.
 * БАГ (v0.40–v0.76): обработчики close/error старой сессии вызывали
 * sessions.delete(id) безусловно. При переподключении с тем же sessionId
 * старый close приходил ПОСЛЕ регистрации новой сессии и удалял её —
 * ввод в терминал переставал работать («session-not-found»).
 */
function forget(id, owner) {
  const cur = sessions.get(id);
  if (cur && (cur.client === owner || cur.stream === owner)) sessions.delete(id);
}

function open(cfg, sender) {
  const id = String(cfg.sessionId || Math.random().toString(36).slice(2));
  if (sessions.has(id)) {
    close(id);
  }
  return new Promise((resolve) => {
    const client = new Client();
    let resolved = false;
    const finishOpen = (result) => {
      if (!resolved) { resolved = true; resolve(result); }
    };

    client.on('ready', () => {
      client.shell({ term: 'xterm-256color', cols: cfg.cols || 100, rows: cfg.rows || 30 }, (err, stream) => {
        if (err) {
          finishOpen({ ok: false, error: err.message });
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
          forget(id, stream);
          try { sender.send('netmap:ssh-close', { sessionId: id, code, signal }); } catch {}
          try { client.end(); } catch {}
        });

        finishOpen({ ok: true, sessionId: id });
      });
    });

    client.on('error', (err) => {
      forget(id, client);
      const msg = err.message || String(err);
      if (!resolved) { finishOpen({ ok: false, error: msg }); }
      else {
        try { sender.send('netmap:ssh-error', { sessionId: id, error: msg }); } catch {}
      }
    });
    client.on('close', () => {
      // Соединение закрылось до готовности (например, сервер оборвал handshake):
      // без этого промис висел бы до readyTimeout без внятной ошибки.
      if (!resolved) finishOpen({ ok: false, error: 'connection closed before ready' });
      if (sessions.get(id) && sessions.get(id).client === client) {
        forget(id, client);
        try { sender.send('netmap:ssh-close', { sessionId: id, reason: 'connection closed' }); } catch {}
      }
    });

    // v0.76: пароль ИЛИ ключ (PEM-текст/файл) + passphrase.
    let auth;
    try { auth = sshAuthFragment(cfg); }
    catch (e) { return finishOpen({ ok: false, error: 'SSH-ключ: ' + (e.message || String(e)) }); }

    // БАГ: с tryKeyboard:true ssh2 отдаёт серверу запрос keyboard-interactive,
    // но без обработчика никто не отвечает → подключение висит до readyTimeout
    // и показывает «Timed out while waiting for handshake». Многие sshd/
    // сетевые устройства принимают пароль ТОЛЬКО через keyboard-interactive.
    // (mikrotik-ssh.cjs делал это правильно — здесь приводим к тому же.)
    client.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
      finish(prompts.map(() => auth.password || auth.passphrase || ''));
    });

    client.connect({
      host: String(cfg.host || '').trim(),
      port: Number(cfg.port) || 22,
      username: String(cfg.username || ''),
      ...auth,
      tryKeyboard: true,
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
