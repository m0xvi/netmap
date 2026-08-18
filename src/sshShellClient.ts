/**
 * v0.40 — SSH shell client (thin bridge over window.netmap.ssh*).
 *
 * Usage:
 *   const session = await openSshShell({ host, port, username, password });
 *   session.onData((chunk) => term.write(chunk));
 *   session.write('ls -la\n');
 *   session.close();
 */

const w = typeof window !== 'undefined' ? (window as any) : {};
export const hasSshBackend = !!(w.netmap && typeof w.netmap.sshOpen === 'function');

export interface SshConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  cols?: number;
  rows?: number;
}

export interface SshSession {
  sessionId: string;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
  onData: (cb: (data: string) => void) => () => void;
  onClose: (cb: (info: { code?: number; reason?: string }) => void) => () => void;
  onError: (cb: (err: string) => void) => () => void;
}

export async function openSshShell(cfg: SshConfig): Promise<SshSession> {
  if (!hasSshBackend) throw new Error('SSH-терминал доступен только в собранной .exe');
  const sessionId = 'ssh-' + Math.random().toString(36).slice(2, 10);
  const res = await w.netmap.sshOpen({ ...cfg, sessionId });
  if (!res || !res.ok) throw new Error(res?.error || 'SSH connect failed');
  const id = res.sessionId || sessionId;

  return {
    sessionId: id,
    write:  (data) => w.netmap.sshWrite({ sessionId: id, data }),
    resize: (cols, rows) => w.netmap.sshResize({ sessionId: id, cols, rows }),
    close:  () => w.netmap.sshClose({ sessionId: id }),
    onData:  (cb) => w.netmap.onSshData((d: any) => { if (d.sessionId === id) cb(d.data); }),
    onClose: (cb) => w.netmap.onSshClose((d: any) => { if (d.sessionId === id) cb(d); }),
    onError: (cb) => w.netmap.onSshError((d: any) => { if (d.sessionId === id) cb(d.error); }),
  };
}
