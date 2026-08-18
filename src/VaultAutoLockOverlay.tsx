/**
 * v0.38 — Full-screen overlay shown when vault gets auto-locked from idle.
 * User must re-enter master password to continue. Also broadcasts activity
 * events (mouse/keyboard) back to the main process via vaultTouch().
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  vaultStatus, vaultUnlock, vaultTouch, onVaultAutoLocked,
  vaultSetIdleTimeout,
} from './vaultClient';

const LS_IDLE = 'netmap:vault:idleMs';

export function VaultAutoLockOverlay() {
  const [visible, setVisible] = useState(false);
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // On mount, push saved idle timeout down to the main process so the
    // auto-lock timer starts on the first render even before Settings is opened.
    try {
      const raw = localStorage.getItem(LS_IDLE);
      if (raw) vaultSetIdleTimeout(Number(raw)).catch(() => {});
    } catch {}

    // Show overlay when main-process broadcasts auto-lock event.
    const off = onVaultAutoLocked(() => {
      // Only surface if vault was actually in-use (has items or was recently unlocked)
      vaultStatus().then(s => {
        if (s.initialized) setVisible(true);
      }).catch(() => {});
    });
    return off;
  }, []);

  useEffect(() => {
    if (visible) setTimeout(() => inputRef.current?.focus(), 60);
  }, [visible]);

  // Broadcast activity so the idle timer resets while user is working.
  useEffect(() => {
    let last = 0;
    const bump = () => {
      const now = Date.now();
      if (now - last > 5000) { last = now; vaultTouch().catch(() => {}); }
    };
    window.addEventListener('mousemove', bump, { passive: true });
    window.addEventListener('keydown', bump);
    window.addEventListener('click', bump);
    return () => {
      window.removeEventListener('mousemove', bump);
      window.removeEventListener('keydown', bump);
      window.removeEventListener('click', bump);
    };
  }, []);

  if (!visible) return null;

  const doUnlock = async () => {
    setError('');
    const res = await vaultUnlock(pw);
    if (res.ok) { setPw(''); setVisible(false); }
    else setError(res.error === 'wrong-password' ? 'Неверный пароль' : (res.error || 'Ошибка'));
  };

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.85)',
      backdropFilter: 'blur(4px)', zIndex: 100050,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'white', width: 380, borderRadius: 12,
        boxShadow: '0 30px 80px rgba(0, 0, 0, 0.4)', padding: 24,
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>
          🔒 Vault заблокирован
        </div>
        <div style={{ fontSize: 12, color: '#64748B', marginBottom: 16 }}>
          Автоблокировка сработала из-за неактивности. Введите мастер-пароль чтобы продолжить.
        </div>
        <input
          ref={inputRef}
          type="password"
          placeholder="Мастер-пароль"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doUnlock()}
          style={{
            width: '100%', padding: '10px 12px', fontSize: 14,
            border: '1px solid #CBD5E1', borderRadius: 6,
            boxSizing: 'border-box',
          }}
        />
        {error && (
          <div style={{ fontSize: 11, color: '#DC2626', marginTop: 6 }}>{error}</div>
        )}
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={() => { setVisible(false); setPw(''); }}
            style={{
              padding: '8px 14px', border: '1px solid #CBD5E1', borderRadius: 6,
              background: 'white', fontSize: 12, cursor: 'pointer', color: '#334155',
            }}
          >
            Отмена
          </button>
          <button
            onClick={doUnlock}
            style={{
              padding: '8px 16px', border: 'none', borderRadius: 6,
              background: '#2563EB', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Разблокировать
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
