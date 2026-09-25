/**
 * v0.40 — QR code share dialog. Encodes any string (password / wifi / URL)
 * as a QR code SVG for scanning by phone camera.
 *
 * Uses `qrcode` npm package (pure JS, ~50KB).
 *
 * For Wi-Fi passwords supports the WIFI:S:<ssid>;T:<WPA|WEP|nopass>;P:<pw>;;
 * format which most phone cameras auto-detect and offer to connect.
 *
 * v0.62.0: каркас переведён на DialogShell (единая тема окон).
 */

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { DialogShell, DlgBtn } from './DialogTheme';

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

  if (!open) return null;

  return (
    <DialogShell
      title={title || 'Поделиться'}
      subtitle={subtitle}
      icon="qr"
      width={400}
      level="top"
      onClose={onClose}
      bodyStyle={{ alignItems: 'center', textAlign: 'center' }}
      footer={(
        <>
          <DlgBtn kind="ghost" className="sm" onClick={() => setShowValue(v => !v)}>
            {showValue ? 'Скрыть значение' : 'Показать значение'}
          </DlgBtn>
          <DlgBtn
            kind="ghost" className="sm"
            onClick={() => { navigator.clipboard.writeText(value).catch(() => {}); }}
          >Копировать</DlgBtn>
          <span className="f-spacer" />
          <DlgBtn kind="primary" onClick={onClose}>Готово</DlgBtn>
        </>
      )}
    >
      {wifi && (
        <div className="seg">
          <button className={!asWifi ? 'on' : ''} onClick={() => setAsWifi(false)}>Пароль</button>
          <button className={asWifi ? 'on' : ''} onClick={() => setAsWifi(true)}>Wi-Fi ({wifi.ssid})</button>
        </div>
      )}

      <div
        style={{
          display: 'inline-block', padding: 8, background: 'white',
          borderRadius: 12, border: '1px solid #E2E8F0',
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      <div className="hint">
        {asWifi
          ? 'Наведите камеру телефона — предложит подключиться к Wi-Fi'
          : 'Наведите камеру телефона — распознает как текст, скопируйте'}
      </div>

      {showValue && (
        <div className="mono" style={{
          padding: '8px 10px', background: '#fff', border: '1px solid #E2E8F0',
          borderRadius: 8, fontSize: 12, wordBreak: 'break-all', color: '#0F172A',
          maxWidth: '100%',
        }}>{value}</div>
      )}
    </DialogShell>
  );
}

function escapeWifi(s: string): string {
  return String(s || '').replace(/([\\;,\":])/g, '\\$1');
}
