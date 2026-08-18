/**
 * Auto-suggest a vault item for a device based on IP / hostname / mgmtUrl match.
 *
 * Scoring:
 *   +10 exact IP match (item.url contains the IP as host)
 *   +8  exact name match (case-insensitive)
 *   +5  device name is a substring of item name (or vice versa)
 *   +4  mgmtUrl host equals item.url host
 *   +2  folder name matches device kind (e.g. "MikroTik" folder for a router)
 *   +1  device IP appears anywhere in item.notes / fields
 */

import type { Device } from './types';

/**
 * We accept anything that has the same shape as VaultItemMeta minimally —
 * this way local component-scoped types (missing e.g. `updated`) can still be used.
 */
export interface MatchableItem {
  id: string;
  name: string;
  folder?: string | null;
  url?: string | null;
}

export interface VaultSuggestion {
  itemId: string;
  score: number;
  reason: string;
}

function extractHost(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = url.trim();
  if (!s) return null;
  // Try URL constructor first
  try {
    const u = new URL(s.includes('://') ? s : `http://${s}`);
    return u.hostname.toLowerCase();
  } catch {
    // Bare host or IP fragment — return as-is
    return s.replace(/^https?:\/\//, '').split(/[\/:?#]/)[0].toLowerCase() || null;
  }
}

function normalize(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase();
}

export function scoreVaultMatch(device: Device, item: MatchableItem): VaultSuggestion | null {
  const dName = normalize(device.name);
  const dIp = normalize(device.ip);
  const dMgmt = extractHost(device.mgmtUrl);
  const iName = normalize(item.name);
  const iHost = extractHost(item.url);
  const iFolder = normalize(item.folder);
  const dKind = normalize(device.kind);

  let score = 0;
  const reasons: string[] = [];

  if (dIp && iHost && iHost === dIp) {
    score += 10;
    reasons.push(`IP ${dIp}`);
  } else if (dIp && iName.includes(dIp)) {
    score += 6;
    reasons.push(`IP в имени записи`);
  }

  if (dName && iName && iName === dName) {
    score += 8;
    reasons.push('точное имя');
  } else if (dName && iName && (iName.includes(dName) || dName.includes(iName)) && dName.length >= 3) {
    score += 5;
    reasons.push('похожее имя');
  }

  if (dMgmt && iHost && dMgmt === iHost) {
    score += 4;
    reasons.push('совпадает хост');
  }

  if (iFolder && dKind) {
    // MikroTik folder for router/switch; Hikvision folder for camera; etc.
    if (
      (dKind === 'router' && /mikrotik|routeros|router/.test(iFolder)) ||
      (dKind === 'switch' && /mikrotik|cisco|switch|routeros/.test(iFolder)) ||
      (dKind === 'camera' && /hikvision|dahua|cctv|camera/.test(iFolder)) ||
      (dKind === 'ap' && /unifi|ubiquiti|wifi|ap/.test(iFolder)) ||
      (dKind === 'server' && /server|synology|nas|esxi|proxmox/.test(iFolder))
    ) {
      score += 2;
      reasons.push(`папка "${item.folder}"`);
    }
  }

  if (score === 0) return null;
  return { itemId: item.id, score, reason: reasons.join(', ') };
}

/**
 * Returns the best-scoring vault item(s) for this device. Sorted by score desc.
 * Empty array if no match.
 */
export function suggestVaultItems(device: Device, items: MatchableItem[]): VaultSuggestion[] {
  const scored = items
    .map(it => scoreVaultMatch(device, it))
    .filter((x): x is VaultSuggestion => !!x);
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Convenience: returns the single top match, or null if score too low.
 * threshold=4 by default (means at least one strong signal: exact-ip, exact-name, or mgmtUrl match).
 */
export function bestVaultMatch(device: Device, items: MatchableItem[], threshold = 4): VaultSuggestion | null {
  const list = suggestVaultItems(device, items);
  if (!list.length) return null;
  return list[0].score >= threshold ? list[0] : null;
}
