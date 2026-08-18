/**
 * v0.40 — QR code share dialog. Encodes any string (password / wifi / URL)
 * as a QR code SVG for scanning by phone camera.
 *
 * Uses `qrcode` npm package (pure JS, ~50KB).
 *
 * For Wi-Fi passwords supports the WIFI:S:<ssid>;T:<WPA|WEP|nopass>;P:<pw>;;
 * format which most phone cameras auto-detect and offer to connect.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';

interface Props {
  open: boolean;
  onClose: () => void;
  /** What to encode. For a plain password/token just pass the string. */
  value: string;
  /** Optional label shown above QR. */
  title?: string;
  /** Optional short description under QR (e.g. "MikroTik-CORE / admin"). */
  subtitle?: string;
  /** If set, offers a "WiFi mode" toggle to encode as WIFI: URI. */
  wifi?: { ssid: string; type?: 'WPA' | 'WEP' | 'nopass' };
}

export function QrShareDialog({ open, onClose, value, title, subtitle, wifi }: Props) {
  const [svg, setSvg] = useState<string>('');
  const [asWifi, setAsWifi] = useState<boolean>(!!wifi);
  const [showValue, setShowValue] = useState(false);

  const encoded = asWifi && wifi
    ? `WIFI:S:${escapeWifi(wifi.ssid)};T:${wifi.type || 'WPA'};P:${escapeWifi(value)};;`
    : value;

  useEffect(() => {
    if (!open || !value) { setSvg(''); return; }
    QRCode.toString(encoded, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 280,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    }).then(setSvg).catch(() => setSvg(''));
  }, [open, encoded, value]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
        zIndex: 100020, display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white', width: 360, borderRadius: 16,
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.35)',
          padding: 24, textAlign: 'center',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>
          {title || 'Поделиться'}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: '#64748B', marginBottom: 12 }}>{subtitle}</div>
        )}

        {wifi && (
          <div style={{ marginBottom: 12, display: 'flex', gap: 6, justifyContent: 'center' }}>
            <button
              onClick={() => setAsWifi(false)}
              style={pill(!asWifi)}
            >Пароль</button>
            <button
              onClick={() => setAsWifi(true)}
              style={pill(asWifi)}
            >Wi-Fi ({wifi.ssid})</button>
          </div>
        )}

        <div
          style={{
            display: 'inline-block', padding: 8, background: 'white',
            borderRadius: 12, border: '1px solid #E2E8F0',
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />

        <div style={{ marginTop: 12, fontSize: 11, color: '#64748B' }}>
          {asWifi
            ? 'Наведите камеру телефона — предложит подключиться к Wi-Fi'
            : 'Наведите камеру телефона — распознает как текст, скопируйте'}
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 6, justifyContent: 'center' }}>
          <button
            onClick={() => setShowValue(v => !v)}
            style={smallBtn}
          >
            {showValue ? '🙈 Скрыть значение' : '👁 Показать значение'}
          </button>
          <button
            onClick={() => { navigator.clipboard.writeText(value).catch(() => {}); }}
            style={smallBtn}
          >📋 Копировать</button>
        </div>
        {showValue && (
          <div style={{
            marginTop: 8, padding: '8px 10px', background: '#F1F5F9',
            borderRadius: 6, fontSize: 12, fontFamily: 'ui-monospace, monospace',
            wordBreak: 'break-all', color: '#0F172A',
          }}>{value}</div>
        )}

        <button
          onClick={onClose}
          style={{
            marginTop: 16, padding: '8px 20px', border: 'none', borderRadius: 8,
            background: '#2563EB', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >Готово</button>
      </div>
    </div>,
    document.body
  );
}

function escapeWifi(s: string): string {
  return String(s || '').replace(/([\\;,":])/g, '\\$1');
}
function pill(active: boolean): React.CSSProperties {
  return {
    padding: '4px 12px', borderRadius: 999, fontSize: 11, cursor: 'pointer',
    border: '1px solid ' + (active ? '#2563EB' : '#CBD5E1'),
    background: active ? '#DBEAFE' : 'white',
    color: active ? '#1E40AF' : '#334155',
    fontWeight: active ? 700 : 500,
  };
}
const smallBtn: React.CSSProperties = {
  padding: '5px 12px', border: '1px solid #CBD5E1', borderRadius: 6, background: 'white',
  fontSize: 11, cursor: 'pointer', color: '#334155',
};
