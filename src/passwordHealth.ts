/**
 * v0.40 — Password health analytics.
 *
 * Computes per-item + aggregate health metrics from a decrypted item list:
 *   - weak    (entropy < 60 bits)
 *   - stale   (updated > 365 days ago)
 *   - reused  (same password in ≥ 2 items)
 *   - no2fa   (item flagged as important but missing TOTP)
 *
 * Returns { perItem: Map<id, HealthFlags>, summary: HealthSummary }.
 *
 * No secrets leave this module — pure client-side crunching.
 */

import type { VaultItemFull } from './vaultClient';

export interface HealthFlags {
  weak: boolean;
  stale: boolean;
  reused: boolean;
  no2fa: boolean;
  score: number;         // 0..100
  entropy: number;
  strengthLabel: string;
}

export interface HealthSummary {
  total: number;
  weakCount: number;
  staleCount: number;
  reusedCount: number;
  no2faCount: number;
  healthy: number;
  overallScore: number;  // 0..100
  reusedGroups: Array<{ password: string; itemIds: string[] }>;
}

const STALE_MS = 365 * 24 * 60 * 60 * 1000;

export function analyseItems(items: VaultItemFull[]): {
  perItem: Map<string, HealthFlags>;
  summary: HealthSummary;
} {
  const perItem = new Map<string, HealthFlags>();

  // Reuse detection: bucket by password.
  const buckets = new Map<string, string[]>();
  for (const it of items) {
    if (!it.password || it.password.length < 4) continue;
    const arr = buckets.get(it.password) || [];
    arr.push(it.id);
    buckets.set(it.password, arr);
  }
  const reusedPasswords = new Set<string>();
  const reusedGroups: HealthSummary['reusedGroups'] = [];
  for (const [pw, ids] of buckets) {
    if (ids.length >= 2) {
      reusedPasswords.add(pw);
      reusedGroups.push({ password: pw, itemIds: ids });
    }
  }

  const now = Date.now();
  let weakCount = 0, staleCount = 0, reusedCount = 0, no2faCount = 0, healthy = 0;
  let scoreSum = 0;

  for (const it of items) {
    const entropy = estimateEntropy(it.password || '');
    const label = strengthLabel(entropy);
    const weak = entropy < 60 && (it.password?.length || 0) > 0;
    const stale = !!it.updated && (now - it.updated) > STALE_MS;
    const reused = !!it.password && reusedPasswords.has(it.password);
    const no2fa = isImportant(it) && !it.hasTotp && !it.totpSecret;

    let score = Math.min(100, Math.round(entropy * 1.2));
    if (stale)  score -= 15;
    if (reused) score -= 30;
    if (no2fa)  score -= 10;
    score = Math.max(0, Math.min(100, score));

    perItem.set(it.id, {
      weak, stale, reused, no2fa,
      entropy, strengthLabel: label,
      score,
    });

    if (weak) weakCount++;
    if (stale) staleCount++;
    if (reused) reusedCount++;
    if (no2fa) no2faCount++;
    if (!weak && !stale && !reused && !no2fa) healthy++;
    scoreSum += score;
  }

  const summary: HealthSummary = {
    total: items.length,
    weakCount, staleCount, reusedCount, no2faCount, healthy,
    overallScore: items.length === 0 ? 100 : Math.round(scoreSum / items.length),
    reusedGroups,
  };

  return { perItem, summary };
}

/** Heuristic: item is "important" if URL/tags look like admin panel or router. */
function isImportant(it: VaultItemFull): boolean {
  const t = ((it.tags || []).join(' ') + ' ' + (it.name || '') + ' ' + (it.url || '')).toLowerCase();
  return /admin|router|firewall|mikrotik|unifi|vpn|panel|gateway|dvr|nvr|kub|vault|master/.test(t);
}

export function estimateEntropy(pw: string): number {
  if (!pw) return 0;
  let charset = 0;
  if (/[a-z]/.test(pw)) charset += 26;
  if (/[A-Z]/.test(pw)) charset += 26;
  if (/[0-9]/.test(pw)) charset += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) charset += 32;
  return Math.log2(Math.max(1, charset)) * pw.length;
}

export function strengthLabel(entropy: number): string {
  if (entropy < 30) return 'Очень слабый';
  if (entropy < 60) return 'Слабый';
  if (entropy < 80) return 'Средний';
  if (entropy < 100) return 'Сильный';
  return 'Очень сильный';
}

export function strengthColor(entropy: number): string {
  if (entropy < 30) return '#DC2626';
  if (entropy < 60) return '#F59E0B';
  if (entropy < 80) return '#2563EB';
  if (entropy < 100) return '#059669';
  return '#059669';
}
