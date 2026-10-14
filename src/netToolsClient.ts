/**
 * v0.90.0 — клиент сетевых утилит (SSH-ключ, сохранение файла, SNMP).
 * Вызывает window.netmap.* из electron/preload.cjs. В браузере без моста
 * возвращает понятную ошибку, а не падает.
 */

const w = window as any;

const NO_BACKEND = 'Окно работает только в приложении NetMap (нужен десктопный режим).';

export function hasNetTools(): boolean {
  return !!(w.netmap && typeof w.netmap.snmpWalk === 'function');
}

export interface SshKeyResult {
  ok: boolean;
  error?: string;
  privatePem?: string;
  publicLine?: string;
  fingerprint?: string;
  encrypted?: boolean;
}

export async function sshKeyGenerate(cfg: { comment?: string; passphrase?: string }): Promise<SshKeyResult> {
  if (typeof w.netmap?.sshKeyGenerate !== 'function') return { ok: false, error: NO_BACKEND };
  return w.netmap.sshKeyGenerate(cfg);
}

export interface SaveFileResult {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  error?: string;
}

export async function saveTextFile(opts: {
  defaultPath: string;
  content: string;
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  mode?: '600' | '644';
}): Promise<SaveFileResult> {
  if (typeof w.netmap?.saveTextFile !== 'function') return { ok: false, error: NO_BACKEND };
  return w.netmap.saveTextFile(opts);
}

export type SnmpVersion = '1' | '2c' | '3';

export interface SnmpCfg {
  host: string;
  port?: number;
  snmpVersion: SnmpVersion;
  community?: string;
  v3User?: string;
  v3Level?: 'noAuthNoPriv' | 'authNoPriv' | 'authPriv';
  v3AuthProto?: string;
  v3AuthKey?: string;
  v3PrivProto?: string;
  v3PrivKey?: string;
  timeoutMs?: number;
  rootOid?: string;
}

export interface SnmpProbeResult {
  ok: boolean;
  error?: string;
  sysDescr?: string;
  sysName?: string;
  sysUpTime?: number;
  sysObjectID?: string;
}

export interface SnmpDetectResult {
  ok: boolean;
  error?: string;
  authProtocol?: string;
  privProtocol?: string;
  sysName?: string;
  sysDescr?: string;
}

export interface SnmpWalkResult {
  ok: boolean;
  error?: string;
  rows?: Array<{ oid: string; value: string }>;
  total?: number;
  truncated?: boolean;
  ms?: number;
}

export async function snmpProbe(cfg: SnmpCfg): Promise<SnmpProbeResult> {
  if (typeof w.netmap?.snmpProbe !== 'function') return { ok: false, error: NO_BACKEND };
  return w.netmap.snmpProbe(cfg);
}

export async function snmpDetectV3(cfg: SnmpCfg): Promise<SnmpDetectResult> {
  if (typeof w.netmap?.snmpDetectV3 !== 'function') return { ok: false, error: NO_BACKEND };
  return w.netmap.snmpDetectV3(cfg);
}

export async function snmpWalk(cfg: SnmpCfg): Promise<SnmpWalkResult> {
  if (typeof w.netmap?.snmpWalk !== 'function') return { ok: false, error: NO_BACKEND };
  return w.netmap.snmpWalk(cfg);
}
