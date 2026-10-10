// v0.77.0: экспорт результата автообнаружения — CSV по устройствам и Markdown-отчёт.
// Чистые функции: получают результат скана и текущие решения пользователя
// (галочки, имена, типы), чтобы файл совпадал с тем, что видно на экране.

import type { DiscoveryScanResult, DiscoveryDeviceProposal } from './discoveryClient';

export interface ReportDecisions {
  /** tempId -> выбрано для добавления (по умолчанию все). */
  devPick?: Record<string, boolean>;
  /** tempId -> отредактированное имя. */
  nameEdits?: Record<string, string>;
  /** tempId -> вручную выбранный тип. */
  kindEdits?: Record<string, string>;
  /** Момент формирования отчёта (для тестов). */
  when?: Date;
}

const KIND_RU: Record<string, string> = {
  router: 'роутер', switch: 'коммутатор', ap: 'точка доступа', pc: 'ПК', camera: 'камера',
  printer: 'принтер', phone: 'телефон', server: 'сервер', nas: 'NAS', other: 'другое',
};

const NAME_SRC_RU: Record<string, string> = {
  dhcp: 'DHCP-комментарий', sysname: 'LLDP sysName', hostname: 'host-name', dns: 'DNS (PTR)', ip: 'нет имени (IP)', mac: 'нет имени (MAC)',
};

function effName(d: DiscoveryDeviceProposal, dec: ReportDecisions): string {
  return dec.nameEdits?.[d.tempId] ?? d.name ?? '';
}

function effKind(d: DiscoveryDeviceProposal, dec: ReportDecisions): string {
  return dec.kindEdits?.[d.tempId] ?? d.kind ?? '';
}

function isPicked(d: DiscoveryDeviceProposal, dec: ReportDecisions): boolean {
  return dec.devPick ? dec.devPick[d.tempId] !== false : true;
}

/** Значение CSV: всегда в кавычках при разделителе, кавычках или переводе строки. */
export function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV по всем найденным устройствам. Разделитель «;» и BOM — чтобы Excel
 * в русской локали сразу показал кириллицу в правильных колонках.
 */
export function buildDevicesCsv(scan: DiscoveryScanResult, dec: ReportDecisions = {}): string {
  const header = ['Имя', 'IP', 'MAC', 'Тип', 'Вендор', 'VLAN', 'Источник имени', 'Выбрано для добавления', 'Подсказка'];
  const rows = (scan.proposedDevices || []).map(d => [
    effName(d, dec),
    d.ip || '',
    d.mac || '',
    KIND_RU[effKind(d, dec)] || effKind(d, dec),
    d.vendor || '',
    d.vlan != null ? String(d.vlan) : '',
    d.nameSource ? (NAME_SRC_RU[d.nameSource] || d.nameSource) : '',
    isPicked(d, dec) ? 'да' : 'нет',
    d.hint || '',
  ]);
  const lines = [header, ...rows].map(r => r.map(csvCell).join(';'));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

function mdCell(v: unknown): string {
  return String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Markdown-отчёт: сводка, устройства, связи, VLAN, подсети, предупреждения. */
export function buildMarkdownReport(scan: DiscoveryScanResult, dec: ReportDecisions = {}): string {
  const when = dec.when || new Date();
  const devices = scan.proposedDevices || [];
  const links = scan.proposedLinks || [];
  const byTemp = new Map(devices.map(d => [d.tempId, d]));
  const nameOf = (ref: { tempId?: string; existingId?: string } | undefined): string => {
    if (!ref) return '?';
    if (ref.tempId && byTemp.has(ref.tempId)) return effName(byTemp.get(ref.tempId)!, dec);
    return ref.existingId ? `(существующее: ${ref.existingId})` : '?';
  };
  const picked = devices.filter(d => isPicked(d, dec)).length;
  const out: string[] = [];
  out.push('# Отчёт автообнаружения NetMap');
  out.push('');
  out.push(`- Дата: ${when.toLocaleString('ru-RU')}`);
  out.push(`- Корневой адрес: ${scan.rootHost || '—'}; источник: ${scan.source || '—'}`);
  if (scan.stats?.ms != null) out.push(`- Длительность: ${Math.round(scan.stats.ms / 100) / 10} с`);
  if (scan.scannedHosts?.length) out.push(`- Опрошено по SNMP: ${scan.scannedHosts.length}`);
  if (scan.cancelled) out.push('- **Опрос отменён: данные неполные.**');
  out.push(`- Найдено устройств: ${devices.length} (выбрано для добавления: ${picked}), связей: ${links.length}`);
  out.push('');

  out.push('## Устройства');
  out.push('');
  if (devices.length === 0) {
    out.push('Устройств не найдено.');
  } else {
    out.push('| Имя | IP | MAC | Тип | Вендор | VLAN | Выбрано |');
    out.push('|---|---|---|---|---|---|---|');
    for (const d of devices) {
      out.push(`| ${[
        mdCell(effName(d, dec)), mdCell(d.ip), mdCell(d.mac), mdCell(KIND_RU[effKind(d, dec)] || effKind(d, dec)),
        mdCell(d.vendor), mdCell(d.vlan), isPicked(d, dec) ? 'да' : 'нет',
      ].join(' | ')} |`);
    }
  }
  out.push('');

  out.push('## Связи');
  out.push('');
  if (links.length === 0) {
    out.push('Связей не найдено.');
  } else {
    out.push('| Откуда | Порт | Куда | Порт | Основание |');
    out.push('|---|---|---|---|---|');
    for (const l of links) {
      out.push(`| ${[mdCell(nameOf(l.fromRef)), mdCell(l.fromPort), mdCell(nameOf(l.toRef)), mdCell(l.toPort), mdCell(l.evidence)].join(' | ')} |`);
    }
  }
  out.push('');

  if ((scan.vlans || []).length) {
    out.push('## VLAN');
    out.push('');
    for (const v of scan.vlans || []) out.push(`- VLAN ${v.id}${v.name ? ` — ${v.name}` : ''}`);
    out.push('');
  }
  if ((scan.subnets || []).length) {
    out.push('## Подсети роутера');
    out.push('');
    for (const s of scan.subnets || []) out.push(`- ${s.cidr}${s.interface ? ` (${s.interface})` : ''}${s.comment ? ` — ${s.comment}` : ''}`);
    out.push('');
  }
  if ((scan.warnings || []).length) {
    out.push('## Предупреждения');
    out.push('');
    for (const w of scan.warnings || []) out.push(`- ${w}`);
    out.push('');
  }
  return out.join('\n');
}

/** Имя файла отчёта: netmap-discovery-2026-10-10-1530.csv */
export function reportFileName(ext: 'csv' | 'md', when: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `netmap-discovery-${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}-${p(when.getHours())}${p(when.getMinutes())}.${ext}`;
}
