/**
 * v0.36.2 — Update banner.
 * Sits at the top of the screen (below toolbar) whenever there's an update
 * to install or an issue with the update system worth showing the user.
 *
 * States handled:
 *   available     — «Доступна версия X. Загружаем…» (auto-download start)
 *   downloading   — progress bar
 *   downloaded    — «Готово. Установить и перезапустить»
 *   error         — красная плашка с текстом (dismissible)
 *   checking / not-available / disabled — не показываем ничего.
 */

import { useEffect, useRef, useState } from 'react';
import {
  onUpdateStatus, installUpdateNow, downloadUpdateNow,
  type UpdateStatus,
} from './updaterClient';
import { useStore } from './store';

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // v0.39.1: dedupe so we don't push the same error into the notification
  // centre on every re-check (updater retries silently every few minutes).
  const lastAlertedErrorRef = useRef<string>('');

  useEffect(() => {
    const off = onUpdateStatus((s) => {
      setStatus(s);
      setDismissed(false);

      // v0.39.1: mirror update-status errors into the app's notification
      // centre so they don't stay only in the top banner (which the user
      // can miss when scrolled away, or dismiss and forget). Success events
      // (available / downloaded) also worth surfacing.
      const push = useStore.getState().pushAlert;
      if (s.state === 'error') {
        const key = 'err:' + (s.error || '').slice(0, 120);
        if (lastAlertedErrorRef.current !== key) {
          lastAlertedErrorRef.current = key;
          push({
            severity: 'warn', origin: 'app',
            title: 'Проверка обновлений не удалась',
            message: explainUpdateError(s.error || ''),
          });
        }
      } else if (s.state === 'available' && s.info?.version) {
        push({
          severity: 'info', origin: 'app',
          title: 'Доступна новая версия',
          message: `NetMap ${s.info.version} — загружается в фоне.`,
        });
      } else if (s.state === 'downloaded' && s.info?.version) {
        push({
          severity: 'success', origin: 'app',
          title: 'Обновление готово',
          message: `NetMap ${s.info.version} — установите и перезапустите.`,
        });
      }
    });
    return () => { off(); };
  }, []);

  if (!status || dismissed) return null;
  if (status.state === 'checking' || status.state === 'not-available' || status.state === 'disabled') {
    return null;
  }

  const version = status.info?.version;

  if (status.state === 'error') {
    const short = explainUpdateError(status.error || '');
    return (
      <Bar color="#B91C1C" bg="#FEE2E2" border="#FCA5A5">
        <span>⚠ {short}</span>
        <div style={{ flex: 1 }} />
        <button
          style={{ ...dismissBtn, marginRight: 6 }}
          onClick={() => {
            // Full details in a modal / console for the curious.
            console.error('[updater] full error:', status.error);
            alert('Подробности обновления:\n\n' + (status.error || 'unknown'));
          }}
        >Подробнее</button>
        <button style={dismissBtn} onClick={() => setDismissed(true)}>Скрыть</button>
      </Bar>
    );
  }

  if (status.state === 'downloaded') {
    return (
      <Bar color="#065F46" bg="#D1FAE5" border="#6EE7B7">
        <span>✓ Готова версия <b>{version || 'новая'}</b>. Перезапустить и установить?</span>
        <div style={{ flex: 1 }} />
        <button style={secondaryBtn} onClick={() => setDismissed(true)}>Позже</button>
        <button style={primaryBtn} onClick={() => { installUpdateNow(); }}>
          Установить и перезапустить
        </button>
      </Bar>
    );
  }

  if (status.state === 'downloading') {
    const p = status.progress;
    return (
      <Bar color="#1E40AF" bg="#DBEAFE" border="#BFDBFE">
        <span>⬇ Загружаем обновление <b>{version || ''}</b>…</span>
        <div style={{
          flex: 1, height: 6, background: '#FFFFFF',
          borderRadius: 3, overflow: 'hidden', margin: '0 12px',
        }}>
          <div style={{
            width: `${p?.percent ?? 0}%`, height: '100%',
            background: '#2563EB', transition: 'width 300ms',
          }} />
        </div>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
          {p?.percent ?? 0}%{p ? ` · ${formatSpeed(p.bytesPerSecond)}` : ''}
        </span>
      </Bar>
    );
  }

  if (status.state === 'available') {
    return (
      <Bar color="#1E40AF" bg="#DBEAFE" border="#BFDBFE">
        <span>🔔 Доступна новая версия <b>{version || ''}</b>. Начинаем загрузку…</span>
        <div style={{ flex: 1 }} />
        <button style={secondaryBtn} onClick={() => downloadUpdateNow()}>
          Загрузить сейчас
        </button>
        <button style={dismissBtn} onClick={() => setDismissed(true)}>Скрыть</button>
      </Bar>
    );
  }

  return null;
}

function Bar({ children, color, bg, border }: {
  children: React.ReactNode; color: string; bg: string; border: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 16px',
      background: bg, color, borderBottom: `1px solid ${border}`,
      fontSize: 12,
    }}>
      {children}
    </div>
  );
}

function formatSpeed(bps: number) {
  if (bps > 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  if (bps > 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${bps} B/s`;
}

/**
 * v0.39.1 — Convert raw electron-updater errors into actionable Russian text.
 * Most common failure modes we've seen:
 *   - 404 releases.atom  → repo is private (or has no published release yet)
 *   - 403                → GH_TOKEN missing / has no repo scope
 *   - ENOTFOUND / ETIMEDOUT / ECONNRESET → no internet / firewall
 *   - "Cannot find latest.yml" → release published manually without .yml
 */
function explainUpdateError(raw: string): string {
  const s = (raw || '').toLowerCase();
  if (s.includes('releases.atom') && s.includes('404')) {
    return 'Не удалось проверить обновления: репозиторий приватный или релиз опубликован как Draft. Сделайте репозиторий публичным на GitHub и опубликуйте черновик релиза.';
  }
  if (s.includes('404')) {
    return 'Не удалось найти релиз на GitHub (HTTP 404). Проверьте что owner/repo в package.json указаны верно и релиз опубликован (не Draft).';
  }
  if (s.includes('403')) {
    return 'GitHub отклонил запрос (HTTP 403). Если репозиторий приватный — нужен GH_TOKEN. Обычно проще сделать репозиторий публичным.';
  }
  if (s.includes('enotfound') || s.includes('etimedout') || s.includes('econnrefused') || s.includes('econnreset')) {
    return 'Нет соединения с GitHub. Проверьте интернет / прокси / файрвол компании.';
  }
  if (s.includes('cannot find latest.yml') || s.includes('no such file')) {
    return 'На релизе нет файла latest.yml (обычно происходит если релиз собран не через electron-builder publish). Пересоздайте релиз командой npm run publish:win.';
  }
  // Fallback — first 160 chars.
  return 'Обновление не удалось: ' + (raw || 'unknown').replace(/\s+/g, ' ').slice(0, 160);
}

const primaryBtn: React.CSSProperties = {
  background: '#059669', border: 'none', color: '#FFFFFF',
  padding: '5px 12px', borderRadius: 5, cursor: 'pointer',
  fontSize: 11, fontWeight: 600,
};
const secondaryBtn: React.CSSProperties = {
  background: '#FFFFFF', border: '1px solid #93C5FD', color: '#1E40AF',
  padding: '5px 12px', borderRadius: 5, cursor: 'pointer',
  fontSize: 11, fontWeight: 500,
};
const dismissBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid currentColor', color: 'inherit',
  padding: '3px 10px', borderRadius: 5, cursor: 'pointer',
  fontSize: 11, fontWeight: 500,
};
