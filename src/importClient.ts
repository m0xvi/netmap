/**
 * v0.37 — Thin bridge over window.netmap.importTest / importScan.
 *
 * Reuses the ScanResult shape from mikrotikClient.ts (leases + arp +
 * interfaces + vlans + addresses) so the same subnet-picker + classification
 * pipeline can be reused across vendors.
 */

import type { ScanResult } from './mikrotikClient';

const w = typeof window !== 'undefined' ? (window as any) : {};
export const hasImportBackend = !!(w.netmap && typeof w.netmap.importScan === 'function');

/** Vendors handled by the unified ImportDialog. `mikrotik` is a special
 *  case: selecting it opens the legacy MikrotikImportDialog instead. */
export type ImportVendor =
  | 'mikrotik'      // → MikrotikImportDialog (SSH/REST)
  | 'unifi'         // classic self-hosted controller (:8443)
  | 'omada-cloud'   // omada.tplinkcloud.com
  | 'ruijie'        // stub in v0.37, planned v0.38
  | 'dlink'         // stub in v0.37, planned v0.38
  | 'edgeswitch';   // stub in v0.37, planned v0.38

export interface VendorMeta {
  id: ImportVendor;
  label: string;
  description: string;
  status: 'ready' | 'planned';
  defaults: Partial<ImportConfig>;
  fields: FieldSpec[];
}

export interface FieldSpec {
  key: keyof ImportConfig;
  label: string;
  type: 'text' | 'password' | 'number' | 'checkbox';
  placeholder?: string;
  hint?: string;
  optional?: boolean;
}

export interface ImportConfig {
  // Universal
  host?: string;         // ip or hostname (UniFi)
  port?: number;         // controller port (UniFi 8443)
  username?: string;
  password?: string;
  insecure?: boolean;    // accept self-signed TLS (UniFi controllers)
  site?: string;         // UniFi site name (defaults to "default")

  // Omada Cloud specific
  orgId?: string;
  siteKey?: string;

  // Which sub-datasets to fetch (default all true)
  fetchLeases?: boolean;
  fetchVlans?: boolean;
}

export interface TestResult {
  ok: boolean;
  identity?: string;
  version?: string;
  error?: string;
  sites?: Array<{ name: string; desc?: string }>;
  orgs?: Array<{ id: string; name: string }>;
}

export const VENDORS: VendorMeta[] = [
  {
    id: 'mikrotik',
    label: 'MikroTik (RouterOS)',
    description: 'SSH или REST — открывает специальный диалог с subnet picker',
    status: 'ready',
    defaults: {},
    fields: [], // handled by dedicated dialog
  },
  {
    id: 'unifi',
    label: 'UniFi Controller (self-hosted)',
    description: 'Классический контроллер на порту 8443 (не UDM/Cloud Key Gen2+)',
    status: 'ready',
    defaults: { port: 8443, insecure: true, site: 'default', fetchLeases: true, fetchVlans: true },
    fields: [
      { key: 'host',     label: 'Хост / IP',     type: 'text',     placeholder: '192.168.1.10' },
      { key: 'port',     label: 'Порт',          type: 'number',   placeholder: '8443' },
      { key: 'username', label: 'Логин',         type: 'text',     placeholder: 'admin' },
      { key: 'password', label: 'Пароль',        type: 'password' },
      { key: 'site',     label: 'Site',          type: 'text',     placeholder: 'default', hint: 'Внутреннее имя сайта (по умолчанию "default")' },
      { key: 'insecure', label: 'Принимать самоподписанный TLS', type: 'checkbox', hint: 'UniFi ставится с self-signed сертификатом — обычно нужно' },
      { key: 'fetchLeases', label: 'Загружать клиентов Wi-Fi/LAN', type: 'checkbox' },
      { key: 'fetchVlans',  label: 'Загружать VLAN и подсети',     type: 'checkbox' },
    ],
  },
  {
    id: 'omada-cloud',
    label: 'TP-Link Omada Cloud',
    description: 'omada.tplinkcloud.com — email + пароль аккаунта. MFA пока не поддерживается.',
    status: 'ready',
    defaults: { fetchLeases: true },
    fields: [
      { key: 'username',    label: 'Email',    type: 'text',     placeholder: 'you@example.com' },
      { key: 'password',    label: 'Пароль',   type: 'password' },
      { key: 'orgId',       label: 'Organization ID', type: 'text', optional: true, hint: 'Оставьте пустым — возьмётся первая доступная' },
      { key: 'siteKey',     label: 'Site key',        type: 'text', optional: true, hint: 'Оставьте пустым — возьмётся первый сайт' },
      { key: 'fetchLeases', label: 'Загружать активных клиентов', type: 'checkbox' },
    ],
  },
  {
    id: 'ruijie',
    label: 'Ruijie Cloud',
    description: 'Планируется в v0.38 (OpenAPI /openapi/v1/ с API-key)',
    status: 'planned',
    defaults: {},
    fields: [
      { key: 'username', label: 'API Key', type: 'text', placeholder: 'будет доступно в v0.38' },
      { key: 'password', label: 'API Secret', type: 'password' },
    ],
  },
  {
    id: 'dlink',
    label: 'D-Link (SNMP)',
    description: 'Планируется в v0.38 (SNMP v2c/v3 walk по ifTable + arpNetToMediaTable)',
    status: 'planned',
    defaults: {},
    fields: [
      { key: 'host', label: 'Хост / IP', type: 'text', placeholder: 'будет доступно в v0.38' },
      { key: 'password', label: 'SNMP community', type: 'password', placeholder: 'public' },
    ],
  },
  {
    id: 'edgeswitch',
    label: 'Ubiquiti EdgeSwitch (SSH)',
    description: 'Планируется в v0.38 (SSH CLI: show mac-address-table, show interfaces status)',
    status: 'planned',
    defaults: { port: 22 },
    fields: [
      { key: 'host',     label: 'Хост / IP', type: 'text', placeholder: 'будет доступно в v0.38' },
      { key: 'port',     label: 'Порт SSH',  type: 'number', placeholder: '22' },
      { key: 'username', label: 'Логин',     type: 'text' },
      { key: 'password', label: 'Пароль',    type: 'password' },
    ],
  },
];

export function vendorMeta(id: ImportVendor): VendorMeta {
  const v = VENDORS.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown vendor: ${id}`);
  return v;
}

export async function testImport(vendor: ImportVendor, config: ImportConfig): Promise<TestResult> {
  if (!hasImportBackend) throw new Error('Импорт доступен только в собранной .exe (Electron).');
  return w.netmap.importTest({ vendor, config });
}

export async function scanImport(vendor: ImportVendor, config: ImportConfig): Promise<ScanResult & { notImplemented?: boolean }> {
  if (!hasImportBackend) throw new Error('Импорт доступен только в собранной .exe (Electron).');
  return w.netmap.importScan({ vendor, config });
}
