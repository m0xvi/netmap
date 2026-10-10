// v0.77.0: подсказка IP для MAC-only устройств из вывода ARP-таблицы ПК.
// Пользователь вставляет вывод `arp -a` (Windows/Linux) или `ip neigh` — парсер
// достаёт пары IP ↔ MAC. Устройство без IP получает IP, если его MAC найден.

const IPV4 = /(?<![\d.])((?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})(?![\d.])/;
const MAC = /(?<![0-9a-f])([0-9a-f]{2}(?:[-:][0-9a-f]{2}){5})(?![0-9a-f])/i;

/** Нормализация MAC к виду AA:BB:CC:DD:EE:FF. */
export function normalizeMac(raw: string): string {
  return raw.replace(/-/g, ':').toUpperCase();
}

function isUsefulIp(ip: string): boolean {
  const first = Number(ip.split('.')[0]);
  if (ip === '0.0.0.0' || ip === '255.255.255.255') return false;
  if (first >= 224) return false; // multicast и зарезервированные
  return true;
}

function isUsefulMac(mac: string): boolean {
  if (mac === 'FF:FF:FF:FF:FF:FF') return false;
  if (mac.startsWith('01:00:5E') || mac.startsWith('33:33')) return false; // multicast
  if (mac === '00:00:00:00:00:00') return false;
  return true;
}

/**
 * Разбирает вывод ARP-таблицы. Каждая строка с IP и MAC даёт пару.
 * Если один MAC встретился с разными IP, берём последний (ARP-запись свежее).
 */
export function parseArpOutput(text: string): { map: Record<string, string>; pairs: number; skipped: number } {
  const map: Record<string, string> = {};
  let pairs = 0;
  let skipped = 0;
  for (const line of (text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const ipM = IPV4.exec(t);
    const macM = MAC.exec(t);
    if (!ipM || !macM) { skipped++; continue; }
    const ip = ipM[1];
    const mac = normalizeMac(macM[1]);
    if (!isUsefulIp(ip) || !isUsefulMac(mac)) { skipped++; continue; }
    map[mac] = ip;
    pairs++;
  }
  return { map, pairs, skipped };
}

/** Применяет подсказки к устройствам без IP. Возвращает число заполненных IP. */
export function applyArpHints<T extends { mac?: string; ip?: string; hint?: string }>(devices: T[], map: Record<string, string>): { devices: T[]; filled: number } {
  let filled = 0;
  const out = devices.map(d => {
    if (d.ip || !d.mac) return d;
    const ip = map[normalizeMac(d.mac)];
    if (!ip) return d;
    filled++;
    // пометка в подсказке — видно в списке и в отчёте, откуда взят адрес
    return { ...d, ip, hint: [d.hint, 'IP из ARP ПК'].filter(Boolean).join(' · ') };
  });
  return { devices: out, filled };
}
