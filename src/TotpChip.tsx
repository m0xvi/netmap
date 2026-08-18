/**
 * v0.38 — Live TOTP chip. Shows current 6-digit code with a circular timer
 * that ticks down 30→0 seconds and auto-refreshes. Clicking copies the code.
 *
 * Backend call `vaultTotp(id)` returns { code, remaining, period } — we
 * refetch whenever `remaining` hits zero. Between refetches we just decrement
 * the local timer for smooth animation.
 */

import { useEffect, useRef, useState } from 'react';
import { vaultTotp } from './vaultClient';

interface Props {
  itemId: string;
  /** Optional compact mode (16px vs 20px). */
  size?: 'sm' | 'md';
}

export function TotpChip({ itemId, size = 'md' }: Props) {
  const [code, setCode] = useState<string>('------');
  const [remaining, setRemaining] = useState<number>(30);
  const [period, setPeriod] = useState<number>(30);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>('');
  const mountedRef = useRef(true);

  const refetch = async () => {
    try {
      const res = await vaultTotp(itemId);
      if (!mountedRef.current) return;
      if (res.locked) { setError('vault locked'); return; }
      if (!res.ok) { setError(res.error || 'error'); return; }
      setCode(res.code || '------');
      setRemaining(res.remaining || 30);
      setPeriod(res.period || 30);
      setError('');
    } catch (e: any) {
      if (!mountedRef.current) return;
      setError(e && e.message ? e.message : 'error');
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    refetch();
    const tick = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { refetch(); return 30; }
        return r - 1;
      });
    }, 1000);
    return () => { mountedRef.current = false; clearInterval(tick); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const isSm = size === 'sm';
  const fontSize = isSm ? 11 : 14;
  const arcSize = isSm ? 14 : 18;
  const pct = Math.max(0, Math.min(1, remaining / period));
  const color = remaining <= 5 ? '#DC2626' : remaining <= 10 ? '#F59E0B' : '#059669';

  if (error) {
    return <span style={{ fontSize: 10, color: '#B45309' }} title={error}>TOTP?</span>;
  }

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(code.replace(/\s+/g, '')).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: isSm ? '2px 6px' : '4px 8px',
        border: `1px solid ${color}`,
        background: 'white',
        borderRadius: 6, cursor: 'pointer',
        fontFamily: 'ui-monospace, monospace',
        fontSize, fontWeight: 700, color: '#0F172A',
      }}
      title="Клик — скопировать TOTP-код"
    >
      {/* Circular timer */}
      <svg width={arcSize} height={arcSize} viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="8" fill="none" stroke="#E2E8F0" strokeWidth="2" />
        <circle
          cx="10" cy="10" r="8" fill="none" stroke={color} strokeWidth="2"
          strokeDasharray={`${2 * Math.PI * 8}`}
          strokeDashoffset={`${2 * Math.PI * 8 * (1 - pct)}`}
          transform="rotate(-90 10 10)"
          style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 200ms' }}
        />
      </svg>
      <span>{formatCode(code)}</span>
      {copied && <span style={{ fontSize: 9, color: '#059669' }}>✓</span>}
    </button>
  );
}

function formatCode(code: string): string {
  if (!code || code.length !== 6) return code;
  return code.slice(0, 3) + ' ' + code.slice(3);
}
