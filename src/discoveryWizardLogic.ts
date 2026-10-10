/**
 * v0.87.0 — мастер уточнений автообнаружения.
 *
 * Чистая логика без React: по результату скана строит вопросы (шаги), держит
 * ответы и переводит их в правки, которые диалог уже умеет применять
 * (типы, имена, исключения VLAN/подсетей, связи, выбор ядра).
 *
 * Принцип проекта: ничего не решается молча. Пустой ответ = «не менять».
 * Ответы из прошлых сканов подставляются как предвыбор, но пользователь видит
 * их в шаге и в сводке до применения.
 *
 * Память ответов хранится отдельно от профиля сети (localStorage), чтобы
 * профиль оставался без данных об устройствах.
 */

import type { DiscoveryScanResult, DiscoveryDeviceProposal, DiscoveryLinkProposal } from './discoveryClient';

export const WIZARD_MEMORY_KEY = 'netmap.discovery.wizard.v1';
const MEMORY_MAX = 500;
const SWITCH_LIKE = ['switch', 'router', 'ap'];

export type WizardStepId = 'hubs' | 'kind' | 'name' | 'uplink' | 'vlan' | 'subnet' | 'macOnly';

export const STEP_ORDER: WizardStepId[] = ['hubs', 'kind', 'name', 'uplink', 'vlan', 'subnet', 'macOnly'];

export const STEP_TITLES: Record<WizardStepId, string> = {
  hubs: 'Ядро и распределение',
  kind: 'Тип устройства',
  name: 'Имена устройств',
  uplink: 'Клиенты за аплинком',
  vlan: 'VLAN без имени',
  subnet: 'Подсети роутера',
  macOnly: 'Устройства только по MAC',
};

export interface WizardItem {
  step: WizardStepId;
  /** hubs: IP; kind/name/uplink: tempId (uplink — tempId связи); vlan: id; subnet: CIDR; macOnly: '*' */
  key: string;
  label: string;
  sub: string;
  /** kind: допустимые типы */
  options?: string[];
  /** kind/name: значение из прошлых сканов (предвыбор) */
  remembered?: string;
  /** uplink: коммутаторы, к которым можно переставить клиента */
  candidates?: Array<{ tempId: string; name: string }>;
  /** число клиентов (vlan, subnet, macOnly) */
  count?: number;
}

export interface WizardStep {
  id: WizardStepId;
  title: string;
  items: WizardItem[];
}

export type UplinkChoice = { mode: 'keep' } | { mode: 'drop' } | { mode: 'move'; toTempId: string };

export interface WizardAnswers {
  /** ip ядра/распределения → опросить */
  hubs: Record<string, boolean>;
  /** tempId → тип ('' = не менять) */
  kinds: Record<string, string>;
  /** tempId → имя ('' = не менять) */
  names: Record<string, string>;
  /** tempId связи → что делать */
  uplinks: Record<string, UplinkChoice>;
  /** id VLAN → исключить и/или назвать */
  vlans: Record<string, { exclude: boolean; name: string }>;
  /** CIDR → исключить */
  subnets: Record<string, boolean>;
  /** MAC-only устройства: добавить как есть или пропустить все */
  macOnly: 'add' | 'skip';
}

export interface WizardMemoryEntry { kind?: string; name?: string }
export type WizardMemory = Record<string, WizardMemoryEntry>;

export interface WizardOpts {
  kindOptions: string[];
  memory: WizardMemory;
}

export interface WizardEffects {
  hubs: string[];
  kinds: Record<string, string>;
  names: Record<string, string>;
  /** tempId устройств, с которых снимается галочка (MAC-only при «пропустить») */
  skipDevices: string[];
  dropLinks: string[];
  /** tempId связи → tempId нового коммутатора-источника */
  moveLinks: Record<string, string>;
  excludeVlans: number[];
  vlanNames: Record<number, string>;
  excludeCidrs: string[];
}

// ---------- helpers ----------

/** Стабильный ключ устройства для памяти ответов: MAC, иначе IP. */
export function memKey(d: DiscoveryDeviceProposal): string {
  return ((d.mac || '').toUpperCase() || d.ip || '').trim();
}

function needsName(d: DiscoveryDeviceProposal): boolean {
  const src = d.nameSource;
  return src === 'ip' || src === 'mac' || (!src && !d.name);
}

function isMacOnly(d: DiscoveryDeviceProposal): boolean {
  return !d.ip && !!d.mac;
}

function isUplinkLink(l: DiscoveryLinkProposal): boolean {
  return /за аплинком/.test(String(l.evidence || ''));
}

function ipToInt(s: string): number | null {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(String(s || ''));
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some(x => x > 255)) return null;
  return ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [net, bitsS] = String(cidr || '').split('/');
  const bits = Number(bitsS);
  const a = ipToInt(ip);
  const b = ipToInt(net);
  if (a == null || b == null || !(bits >= 0 && bits <= 32)) return false;
  const size = 2 ** (32 - bits);
  return Math.floor(a / size) === Math.floor(b / size);
}

// ---------- шаги ----------

/** Строит шаги только с вопросами: пустой шаг не показывается. */
export function buildWizardSteps(scan: DiscoveryScanResult, opts: WizardOpts): WizardStep[] {
  const devs = scan.proposedDevices || [];
  const byTemp = new Map(devs.map(d => [d.tempId, d] as const));
  const items: WizardItem[] = [];
  const validKind = (k?: string) => !!k && opts.kindOptions.includes(k);

  for (const h of scan.hubCandidates || []) {
    items.push({ step: 'hubs', key: h.ip, label: h.name || h.ip, sub: 'ядро или распределение, ещё не опрошено' });
  }

  for (const d of devs) {
    if (d.kindConfident === false && (d.ip || d.mac)) {
      const rem = opts.memory[memKey(d)]?.kind;
      items.push({
        step: 'kind', key: d.tempId, label: d.name || d.ip || d.mac || d.tempId,
        sub: [d.ip, d.mac, d.vendor, d.hint].filter(Boolean).join(' · ') || 'тип не определён',
        options: opts.kindOptions,
        remembered: validKind(rem) ? rem : undefined,
      });
    }
  }

  for (const d of devs) {
    if (needsName(d) && (d.ip || d.mac)) {
      const rem = opts.memory[memKey(d)]?.name;
      items.push({
        step: 'name', key: d.tempId, label: d.ip || d.mac || d.tempId,
        sub: [d.mac, d.vendor, d.hint].filter(Boolean).join(' · ') || 'имени нет',
        remembered: rem || undefined,
      });
    }
  }

  for (const l of scan.proposedLinks || []) {
    if (!isUplinkLink(l)) continue;
    const client = byTemp.get(l.toRef.tempId || '');
    if (!client) continue;
    const from = l.fromRef.tempId ? byTemp.get(l.fromRef.tempId) : undefined;
    const candidates = devs
      .filter(d => SWITCH_LIKE.includes(d.kind) && d.tempId !== l.fromRef.tempId && d.tempId !== client.tempId)
      .map(d => ({ tempId: d.tempId, name: d.name || d.ip || d.tempId }));
    items.push({
      step: 'uplink', key: l.tempId,
      label: client.name || client.ip || client.mac || client.tempId,
      sub: `сейчас: ${from ? (from.name || from.ip || from.tempId) : 'коммутатор из проекта'}${l.fromPort ? `, порт ${l.fromPort}` : ''}`,
      candidates,
    });
  }

  for (const v of scan.vlans || []) {
    if (v.name) continue;
    items.push({
      step: 'vlan', key: String(v.id), label: `VLAN ${v.id}`, sub: 'имя не задано',
      count: devs.filter(d => d.vlan === v.id).length,
    });
  }

  for (const s of scan.subnets || []) {
    items.push({
      step: 'subnet', key: s.cidr, label: s.cidr,
      sub: [s.interface, s.comment].filter(Boolean).join(' · ') || 'без комментария',
      count: devs.filter(d => d.ip && ipInCidr(d.ip, s.cidr)).length,
    });
  }

  const macOnlyCount = devs.filter(isMacOnly).length;
  if (macOnlyCount > 0) {
    items.push({
      step: 'macOnly', key: '*', label: `${macOnlyCount} устройств только по MAC`,
      sub: 'по умолчанию добавляются как есть: имя = MAC, связь с портом коммутатора',
      count: macOnlyCount,
    });
  }

  const steps: WizardStep[] = [];
  for (const id of STEP_ORDER) {
    const list = items.filter(i => i.step === id);
    if (list.length > 0) steps.push({ id, title: STEP_TITLES[id], items: list });
  }
  return steps;
}

/** Ответы по умолчанию: всё «как было», плюс предвыбор из памяти. */
export function defaultAnswers(steps: WizardStep[]): WizardAnswers {
  const a: WizardAnswers = { hubs: {}, kinds: {}, names: {}, uplinks: {}, vlans: {}, subnets: {}, macOnly: 'add' };
  for (const st of steps) {
    for (const it of st.items) {
      if (it.step === 'hubs') a.hubs[it.key] = true;
      if (it.step === 'kind' && it.remembered) a.kinds[it.key] = it.remembered;
      if (it.step === 'name' && it.remembered) a.names[it.key] = it.remembered;
      if (it.step === 'uplink') a.uplinks[it.key] = { mode: 'keep' };
      if (it.step === 'vlan') a.vlans[it.key] = { exclude: false, name: '' };
      if (it.step === 'subnet') a.subnets[it.key] = false;
    }
  }
  return a;
}

/** Переводит ответы в правки диалога. Ничего не меняет сам. */
export function wizardEffects(scan: DiscoveryScanResult, answers: WizardAnswers): WizardEffects {
  const devs = scan.proposedDevices || [];
  const fx: WizardEffects = {
    hubs: [], kinds: {}, names: {}, skipDevices: [], dropLinks: [], moveLinks: {},
    excludeVlans: [], vlanNames: {}, excludeCidrs: [],
  };
  for (const [ip, on] of Object.entries(answers.hubs)) if (on) fx.hubs.push(ip);
  for (const [id, k] of Object.entries(answers.kinds)) if (k) fx.kinds[id] = k;
  for (const [id, n] of Object.entries(answers.names)) if (n.trim()) fx.names[id] = n.trim();
  if (answers.macOnly === 'skip') {
    for (const d of devs) if (isMacOnly(d)) fx.skipDevices.push(d.tempId);
  }
  for (const [linkId, c] of Object.entries(answers.uplinks)) {
    if (c.mode === 'drop') fx.dropLinks.push(linkId);
    if (c.mode === 'move') fx.moveLinks[linkId] = c.toTempId;
  }
  for (const [vid, v] of Object.entries(answers.vlans)) {
    const id = Number(vid);
    if (!Number.isInteger(id)) continue;
    if (v.exclude) fx.excludeVlans.push(id);
    else if (v.name.trim()) fx.vlanNames[id] = v.name.trim();
  }
  for (const [cidr, on] of Object.entries(answers.subnets)) if (on) fx.excludeCidrs.push(cidr);
  return fx;
}

/** Короткая сводка для экрана подтверждения. */
export function summarizeEffects(fx: WizardEffects): string[] {
  const out: string[] = [];
  if (fx.hubs.length) out.push(`Опросим ядро/распределение: ${fx.hubs.length} (кнопкой «Опросить выбранные»)`);
  const kinds = Object.keys(fx.kinds).length;
  if (kinds) out.push(`Типы устройств задано: ${kinds}`);
  const names = Object.keys(fx.names).length;
  if (names) out.push(`Имена задано: ${names}`);
  if (fx.skipDevices.length) out.push(`MAC-only устройств пропустим: ${fx.skipDevices.length}`);
  if (fx.dropLinks.length) out.push(`Связей уберём: ${fx.dropLinks.length}`);
  const moves = Object.keys(fx.moveLinks).length;
  if (moves) out.push(`Клиентов переставим на другой коммутатор: ${moves}`);
  if (fx.excludeVlans.length) out.push(`VLAN исключим: ${fx.excludeVlans.join(', ')}`);
  const vn = Object.keys(fx.vlanNames).length;
  if (vn) out.push(`VLAN переименуем: ${vn}`);
  if (fx.excludeCidrs.length) out.push(`Подсети исключим: ${fx.excludeCidrs.join(', ')}`);
  if (out.length === 0) out.push('Ответов нет: ничего не изменится.');
  return out;
}

// ---------- память ответов ----------

/** Запоминает ответы на типы и имена. Старые записи вытесняются. */
export function rememberAnswers(
  memory: WizardMemory, scan: DiscoveryScanResult, answers: WizardAnswers,
): WizardMemory {
  const next: WizardMemory = { ...memory };
  const touch = (key: string, patch: WizardMemoryEntry) => {
    if (!key) return;
    const prev = next[key] || {};
    delete next[key];
    next[key] = { ...prev, ...patch };
  };
  for (const d of scan.proposedDevices || []) {
    const k = answers.kinds[d.tempId];
    if (k) touch(memKey(d), { kind: k });
    const n = (answers.names[d.tempId] || '').trim();
    if (n) touch(memKey(d), { name: n });
  }
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - MEMORY_MAX))) delete next[k];
  return next;
}

export function sanitizeMemory(raw: unknown, kindOptions: string[]): WizardMemory {
  const out: WizardMemory = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== 'string' || k.length === 0 || k.length > 64) continue;
    if (!v || typeof v !== 'object') continue;
    const e = v as Record<string, unknown>;
    const entry: WizardMemoryEntry = {};
    if (typeof e.kind === 'string' && kindOptions.includes(e.kind)) entry.kind = e.kind;
    if (typeof e.name === 'string' && e.name.trim()) entry.name = e.name.trim().slice(0, 120);
    if (entry.kind || entry.name) out[k] = entry;
  }
  const keys = Object.keys(out);
  for (const k of keys.slice(0, Math.max(0, keys.length - MEMORY_MAX))) delete out[k];
  return out;
}

export function loadWizardMemory(kindOptions: string[]): WizardMemory {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(WIZARD_MEMORY_KEY) : null;
    return raw ? sanitizeMemory(JSON.parse(raw), kindOptions) : {};
  } catch {
    return {};
  }
}

export function saveWizardMemory(memory: WizardMemory, kindOptions: string[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(WIZARD_MEMORY_KEY, JSON.stringify(sanitizeMemory(memory, kindOptions)));
    }
  } catch {
    // переполнение localStorage не должно ломать диалог
  }
}
