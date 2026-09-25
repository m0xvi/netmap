/**
 * v0.64 — единый плавающий тултип устройства (приём из макета B,
 * map-variants.html): тёмная карточка с именем, типом, IP, MAC и статусом.
 *
 * Один fixed-элемент на всю карту, а не per-node DOM: узлы и точки-клиенты
 * диспатчат CustomEvent `netmap:devtip` { id, x, y } на mouseenter/mousemove
 * и `netmap:devtip-hide` на mouseleave. Хост подписан на устройство только
 * пока тултип открыт (useShallow по примитивам — статус/RTT обновляются
 * на лету во время ховера).
 *
 * zIndex 950: выше канваса, ниже контекстного меню (1000) и диалогов (9500+).
 */

import { useEffect, useState } from 'react';
import { useStore } from './store';
import { useShallow } from 'zustand/shallow';
import { KIND_META } from './icons';

export const DEVTIP_SHOW = 'netmap:devtip';
export const DEVTIP_HIDE = 'netmap:devtip-hide';

/** Показать/передвинуть тултип устройства (вызывать из onMouseEnter/Move). */
export function showDeviceTip(id: string, x: number, y: number) {
  window.dispatchEvent(new CustomEvent(DEVTIP_SHOW, { detail: { id, x, y } }));
}

/** Скрыть тултип (onMouseLeave, перед открытием контекстного меню). */
export function hideDeviceTip() {
  window.dispatchEvent(new CustomEvent(DEVTIP_HIDE));
}

const STATUS_TEXT: Record<string, string> = {
  up: 'в сети',
  down: 'недоступен',
  checking: 'проверка…',
  unknown: 'нет данных',
};

const STATUS_COLOR: Record<string, string> = {
  up: '#22C55E',
  down: '#EF4444',
  checking: '#F59E0B',
  unknown: '#98A2B3',
};

export function DeviceTooltipHost() {
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const show = (e: Event) => {
      const d = (e as CustomEvent).detail as { id: string; x: number; y: number };
      if (d && typeof d.id === 'string') setTip({ id: d.id, x: d.x, y: d.y });
    };
    const hide = () => setTip(null);
    window.addEventListener(DEVTIP_SHOW, show as EventListener);
    window.addEventListener(DEVTIP_HIDE, hide);
    // Любое нажатие (клик, драг, правый клик) гасит тултип.
    window.addEventListener('pointerdown', hide, true);
    return () => {
      window.removeEventListener(DEVTIP_SHOW, show as EventListener);
      window.removeEventListener(DEVTIP_HIDE, hide);
      window.removeEventListener('pointerdown', hide, true);
    };
  }, []);

  if (!tip) return null;
  return <TipCard id={tip.id} x={tip.x} y={tip.y} />;
}

const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: 14,
  color: '#C4CBD8', padding: '1.5px 0', fontSize: 11.5,
};
const valStyle: React.CSSProperties = { color: '#FFFFFF', fontWeight: 600 };
const monoStyle: React.CSSProperties = { ...valStyle, fontFamily: 'ui-monospace, Menlo, Consolas, monospace' };

function TipCard({ id, x, y }: { id: string; x: number; y: number }) {
  // Подписка только на примитивы своего устройства — тултип живой:
  // статус/RTT обновляются, пока курсор на карточке.
  const d = useStore(useShallow((s) => {
    const dev = s.doc.devices.find(z => z.id === id);
    if (!dev) return null;
    return {
      name: dev.name,
      kind: dev.kind,
      ip: dev.ip || '',
      mac: dev.mac || '',
      model: dev.model || '',
      liveStatus: dev.liveStatus || 'unknown',
      rtt: typeof dev.lastRttMs === 'number' ? dev.lastRttMs : null,
    };
  }));
  if (!d) return null;

  const meta = KIND_META[d.kind];
  const stColor = STATUS_COLOR[d.liveStatus] || STATUS_COLOR.unknown;
  const stText = STATUS_TEXT[d.liveStatus] || STATUS_TEXT.unknown;
  const W = 236;
  const left = Math.max(8, Math.min(x + 16, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(y + 14, window.innerHeight - 170));

  return (
    <div
      style={{
        position: 'fixed', left, top, width: W, zIndex: 950,
        pointerEvents: 'none',
        background: '#1D2939', color: '#EAECF0',
        borderRadius: 10, padding: '9px 12px',
        boxShadow: '0 12px 30px -8px rgba(15,23,42,0.5)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%', background: stColor, flexShrink: 0,
        }} />
        <span style={{
          fontWeight: 800, fontSize: 12.5, color: '#FFFFFF',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{d.name}</span>
      </div>
      <div style={{
        color: '#98A2B3', fontSize: 9.5, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: 0.5, margin: '1px 0 5px 14px',
      }}>
        {meta.label}
      </div>
      {d.ip && (
        <div style={rowStyle}><span>IP</span><span style={monoStyle}>{d.ip}</span></div>
      )}
      {d.mac && (
        <div style={rowStyle}><span>MAC</span><span style={monoStyle}>{d.mac}</span></div>
      )}
      {d.model && (
        <div style={rowStyle}><span>Модель</span><span style={valStyle}>{d.model}</span></div>
      )}
      <div style={rowStyle}>
        <span>Статус</span>
        <span style={{ ...valStyle, color: stColor }}>
          {stText}{d.liveStatus === 'up' && d.rtt != null ? ` · ${d.rtt} мс` : ''}
        </span>
      </div>
      <div style={{ color: '#7C8698', fontSize: 10, marginTop: 5 }}>
        ПКМ — меню · двойной клик — крупный вид
      </div>
    </div>
  );
}
