/**
 * v0.38 — PasswordGenerator modal. Sliders / toggles + Apply / Copy.
 * Uses vaultClient.vaultGeneratePassword() (falls back to WebCrypto if not in Electron).
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { vaultGeneratePassword, type PwGenOpts } from './vaultClient';

interface Props {
  open: boolean;
  onClose: () => void;
  onApply?: (password: string) => void;   // called when user presses Apply
  initialLength?: number;
}

const LS_LAST_OPTS = 'netmap:pwgen:last';

export function PasswordGenerator({ open, onClose, onApply, initialLength = 20 }: Props) {
  const [opts, setOpts] = useState<PwGenOpts>(() => {
    try {
      const raw = localStorage.getItem(LS_LAST_OPTS);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {
      length: initialLength, lower: true, upper: true,
      digits: true, symbol: true, excludeAmbiguous: false,
    };
  });
  const [password, setPassword] = useState('');
  const [copiedAt, setCopiedAt] = useState(0);

  const regenerate = async () => {
    try {
      const pw = await vaultGeneratePassword(opts);
      setPassword(pw);
    } catch (e: any) {
      setPassword('');
    }
  };

  useEffect(() => {
    if (!open) return;
    regenerate();
    // Persist last-used options (never persist the generated password itself).
    try { localStorage.setItem(LS_LAST_OPTS, JSON.stringify(opts)); } catch {}
  }, [open, opts]);

  if (!open) return null;

  const strength = estimateStrength(password);

  return createPortal(
    <div style={backdrop} onClick={onClose}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Генератор паролей</div>
          <button style={closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: 16 }}>
          {/* Password display */}
          <div style={{
            fontFamily: 'ui-monospace, monospace', fontSize: 16,
            padding: '12px 14px', background: '#F1F5F9', borderRadius: 8,
            border: '1px solid #CBD5E1', wordBreak: 'break-all', minHeight: 44,
            color: '#0F172A',
          }}>
            {password || 'Нажмите «Перегенерировать»'}
          </div>

          {/* Strength meter */}
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 6, background: '#E2E8F0', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                width: `${Math.min(100, strength.pct)}%`, height: '100%',
                background: strength.color, transition: 'width 200ms',
              }} />
            </div>
            <span style={{ fontSize: 11, color: strength.color, fontWeight: 600, minWidth: 80, textAlign: 'right' }}>
              {strength.label}
            </span>
          </div>

          {/* Length slider */}
          <div style={{ marginTop: 16 }}>
            <label style={{ fontSize: 12, color: '#334155', display: 'flex', justifyContent: 'space-between' }}>
              <span>Длина</span>
              <b>{opts.length}</b>
            </label>
            <input
              type="range" min={8} max={64} value={opts.length}
              onChange={(e) => setOpts((o) => ({ ...o, length: Number(e.target.value) }))}
              style={{ width: '100%', marginTop: 4 }}
            />
          </div>

          {/* Character toggles */}
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Toggle label="Строчные (a-z)"  value={!!opts.lower}  onChange={(v) => setOpts((o) => ({ ...o, lower: v }))} />
            <Toggle label="Заглавные (A-Z)" value={!!opts.upper}  onChange={(v) => setOpts((o) => ({ ...o, upper: v }))} />
            <Toggle label="Цифры (0-9)"     value={!!opts.digits} onChange={(v) => setOpts((o) => ({ ...o, digits: v }))} />
            <Toggle label="Символы (!@#…)"  value={!!opts.symbol} onChange={(v) => setOpts((o) => ({ ...o, symbol: v }))} />
          </div>

          <div style={{ marginTop: 8 }}>
            <Toggle label="Исключить похожие (l/1/L/o/0/O)" value={!!opts.excludeAmbiguous}
                    onChange={(v) => setOpts((o) => ({ ...o, excludeAmbiguous: v }))} />
          </div>

          {/* Actions */}
          <div style={{
            marginTop: 20, display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center',
          }}>
            <button onClick={regenerate} style={smallBtn}>↻ Перегенерировать</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  if (password) {
                    navigator.clipboard.writeText(password).catch(() => {});
                    setCopiedAt(Date.now());
                    setTimeout(() => setCopiedAt(0), 1500);
                  }
                }}
                style={smallBtn}
              >
                {Date.now() - copiedAt < 1500 ? '✓ Скопировано' : '📋 Копировать'}
              </button>
              {onApply && (
                <button
                  style={primaryBtn}
                  onClick={() => { if (password) { onApply(password); onClose(); } }}
                  disabled={!password}
                >
                  Применить
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Helpers

function estimateStrength(pw: string): { pct: number; label: string; color: string } {
  if (!pw) return { pct: 0, label: '', color: '#94A3B8' };
  let charset = 0;
  if (/[a-z]/.test(pw)) charset += 26;
  if (/[A-Z]/.test(pw)) charset += 26;
  if (/[0-9]/.test(pw)) charset += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) charset += 32;
  const entropy = Math.log2(Math.max(1, charset)) * pw.length;
  if (entropy < 40) return { pct: 20, label: 'Очень слабый', color: '#DC2626' };
  if (entropy < 60) return { pct: 40, label: 'Слабый',       color: '#F59E0B' };
  if (entropy < 80) return { pct: 65, label: 'Средний',      color: '#2563EB' };
  if (entropy < 100) return { pct: 85, label: 'Сильный',      color: '#059669' };
  return { pct: 100, label: 'Очень сильный', color: '#059669' };
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#334155' }}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

// Styles
const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)',
  zIndex: 100010, display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const dialog: React.CSSProperties = {
  background: 'white', width: 460, borderRadius: 12,
  boxShadow: '0 20px 60px rgba(15, 23, 42, 0.25)',
};
const header: React.CSSProperties = {
  padding: '14px 16px', borderBottom: '1px solid #E2E8F0',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
};
const closeBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', fontSize: 18, color: '#64748B', cursor: 'pointer',
};
const smallBtn: React.CSSProperties = {
  padding: '6px 12px', border: '1px solid #CBD5E1', borderRadius: 6, background: 'white',
  fontSize: 12, cursor: 'pointer', color: '#334155',
};
const primaryBtn: React.CSSProperties = {
  padding: '6px 14px', border: 'none', borderRadius: 6, background: '#2563EB',
  color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
