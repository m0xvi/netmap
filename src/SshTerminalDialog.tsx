/**
 * v0.40 — Interactive SSH terminal dialog.
 *
 * Uses xterm.js for the terminal UI and our custom `ssh2`-based shell bridge
 * on the main-process side (see electron/ssh-shell.cjs). We deliberately avoid
 * node-pty so no MSVC / native compilation is required.
 *
 * Opens via CustomEvent 'netmap:open-ssh-terminal' with detail:
 *   { host, port?, username, password?, title?, subtitle? }
 *
 * Auto-resize on container size change. Ctrl+Shift+C copies selection.
 *
 * v0.62.0: каркас переведён на DialogShell (единая тема окон).
 * Escape обрабатывает сам терминал (обёртка), closeOnEscape выключен.
 */

import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { openSshShell, type SshSession, type SshConfig } from './sshShellClient';
import { DialogShell } from './DialogTheme';

interface OpenDetail extends SshConfig {
  title?: string;
  subtitle?: string;
}

export function SshTerminalDialogHost() {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<OpenDetail | null>(null);

  useEffect(() => {
    const h = (e: Event) => {
      const detail = (e as CustomEvent).detail as OpenDetail;
      setCfg(detail);
      setOpen(true);
    };
    window.addEventListener('netmap:open-ssh-terminal', h as EventListener);
    return () => window.removeEventListener('netmap:open-ssh-terminal', h as EventListener);
  }, []);

  if (!open || !cfg) return null;
  return <SshTerminalDialog cfg={cfg} onClose={() => setOpen(false)} />;
}

function SshTerminalDialog({ cfg, onClose }: { cfg: OpenDetail; onClose: () => void }) {
  const termWrapRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<SshSession | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'closed' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!termWrapRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Cascadia Mono, Consolas, Menlo, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      allowProposedApi: true,
      theme: {
        background: '#0F172A', foreground: '#E2E8F0',
        cursor: '#38BDF8', cursorAccent: '#0F172A',
        selectionBackground: 'rgba(56, 189, 248, 0.35)',
        black: '#1E293B',    red: '#F87171',    green: '#4ADE80',
        yellow: '#FBBF24',   blue: '#60A5FA',   magenta: '#C084FC',
        cyan: '#22D3EE',     white: '#E2E8F0',
        brightBlack: '#475569', brightRed: '#FCA5A5', brightGreen: '#86EFAC',
        brightYellow: '#FDE68A', brightBlue: '#93C5FD', brightMagenta: '#D8B4FE',
        brightCyan: '#67E8F9', brightWhite: '#F1F5F9',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termWrapRef.current);
    // eslint-disable-next-line no-console
    try { fit.fit(); } catch { /* container may be 0 on first tick */ }

    termRef.current = term;
    fitRef.current = fit;

    // Copy on Ctrl+Shift+C (browser paste stays Ctrl+Shift+V, forwarded as keystrokes).
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true;
      if (ev.ctrlKey && ev.shiftKey && ev.key === 'C') {
        const sel = term.getSelection();
        if (sel) navigator.clipboard.writeText(sel).catch(() => {});
        return false;
      }
      if (ev.ctrlKey && ev.shiftKey && ev.key === 'V') {
        navigator.clipboard.readText().then(t => {
          if (t && sessionRef.current) sessionRef.current.write(t);
        }).catch(() => {});
        return false;
      }
      return true;
    });

    // Connect
    (async () => {
      try {
        const cols = term.cols, rows = term.rows;
        const session = await openSshShell({
          host: cfg.host, port: cfg.port,
          username: cfg.username, password: cfg.password,
          cols, rows,
        });
        sessionRef.current = session;
        setStatus('connected');

        session.onData(chunk => term.write(chunk));
        session.onClose(() => { setStatus('closed'); term.write('\r\n\x1b[33m[Соединение закрыто]\x1b[0m\r\n'); });
        session.onError(err => { setStatus('error'); setErrorMsg(err); term.write(`\r\n\x1b[31m[Ошибка] ${err}\x1b[0m\r\n`); });

        term.onData(data => session.write(data));
        term.onResize(({ cols, rows }) => session.resize(cols, rows));
      } catch (e: any) {
        setStatus('error');
        setErrorMsg(e?.message || String(e));
        term.write(`\r\n\x1b[31m[Не удалось подключиться] ${e?.message || e}\x1b[0m\r\n`);
      }
    })();

    // Resize handler
    const onResize = () => { try { fit.fit(); } catch {} };
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(termWrapRef.current);

    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      if (sessionRef.current) { sessionRef.current.close().catch(() => {}); }
      term.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusText = status === 'connecting' ? 'Подключение…'
    : status === 'connected' ? 'Подключено'
    : status === 'closed' ? 'Соединение закрыто'
    : `Ошибка${errorMsg ? `: ${errorMsg}` : ''}`;

  return (
    <DialogShell
      title={cfg.title || `SSH · ${cfg.username}@${cfg.host}${cfg.port ? ':' + cfg.port : ''}`}
      subtitle={`${cfg.subtitle ? cfg.subtitle + ' · ' : ''}${statusText} · Ctrl+Shift+C — копировать, Ctrl+Shift+V — вставить, Esc — закрыть`}
      icon="terminal"
      width={1000}
      level="top"
      onClose={onClose}
      closeOnEscape={false}
      bodyStyle={{ background: '#0F172A', padding: 6, gap: 0 }}
    >
      <div
        ref={termWrapRef}
        style={{ height: '70vh', minHeight: 300, background: '#0F172A' }}
        onKeyDown={(e) => { if (e.key === 'Escape' && !e.ctrlKey && !e.shiftKey) onClose(); }}
      />
    </DialogShell>
  );
}
