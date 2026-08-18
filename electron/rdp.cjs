/**
 * v0.43 — RDP launcher.
 *
 * Generates a temporary .rdp file (Windows-only format) with the host + user
 * pre-filled and hands it to `shell.openPath()` — Windows shell then launches
 * mstsc.exe automatically. The password can't be embedded in a plain .rdp
 * (Windows demands it be encrypted with the user's DPAPI credentials, which
 * we can't produce from Node), so instead we copy it to the clipboard so the
 * user can paste it when mstsc prompts.
 *
 * IPC: netmap:rdpLaunch {host, port?, username?, password?} → { ok, error? }
 *
 * Also works from macOS / Linux — but there the file just opens in whatever
 * app is registered for .rdp (Microsoft Remote Desktop on macOS, Remmina
 * on Linux). No auto-launch there.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { shell, clipboard } = require('electron');

function escapeRdpValue(s) {
  return String(s || '').replace(/[\r\n]/g, ' ').trim();
}

async function launch(cfg) {
  const host = escapeRdpValue(cfg.host);
  if (!host) return { ok: false, error: 'host required' };
  const port = Number(cfg.port) || 3389;
  const user = escapeRdpValue(cfg.username);

  // Standard .rdp format (Microsoft docs: "Supported RDP File Settings").
  // We keep only the essentials + a couple sensible defaults for a smoother
  // first-time experience.
  const rdp = [
    `full address:s:${host}:${port}`,
    'screen mode id:i:2',                          // full screen by default
    'use multimon:i:0',
    'authentication level:i:0',                    // don't nag on self-signed
    'prompt for credentials:i:0',
    'negotiate security layer:i:1',
    'enablecredsspsupport:i:1',
    'redirectclipboard:i:1',
    'redirectprinters:i:0',
    'audiomode:i:2',
    'connection type:i:7',
    'networkautodetect:i:1',
    'bandwidthautodetect:i:1',
    'compression:i:1',
    user ? `username:s:${user}` : '',
  ].filter(Boolean).join('\r\n') + '\r\n';

  const tmpDir = path.join(os.tmpdir(), 'netmap-rdp');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
  const safeHost = host.replace(/[^\w.-]/g, '_');
  const file = path.join(tmpDir, `${safeHost}-${Date.now()}.rdp`);
  try {
    fs.writeFileSync(file, rdp, { encoding: 'utf8' });
  } catch (e) {
    return { ok: false, error: 'write failed: ' + (e.message || String(e)) };
  }

  // Copy the password to clipboard so the user can paste it when mstsc prompts.
  let clipCopied = false;
  if (cfg.password) {
    try {
      clipboard.writeText(String(cfg.password));
      clipCopied = true;
      // Best-effort auto-clear the clipboard after 45 s so the password doesn't
      // linger indefinitely.
      setTimeout(() => {
        try {
          if (clipboard.readText() === String(cfg.password)) {
            clipboard.writeText('');
          }
        } catch {}
      }, 45_000);
    } catch { /* clipboard may be unavailable on Linux w/o Xorg */ }
  }

  try {
    const err = await shell.openPath(file);
    if (err) return { ok: false, error: err };
  } catch (e) {
    return { ok: false, error: 'openPath failed: ' + (e.message || String(e)) };
  }

  // Best-effort cleanup after 60s. The RDP client keeps the file open until
  // the tunnel establishes but usually reads it once at start.
  setTimeout(() => { try { fs.unlinkSync(file); } catch {} }, 60_000);

  return { ok: true, file, clipCopied };
}

module.exports = { launch };
