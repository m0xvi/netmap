/**
 * v0.36.1 — глобальный loading-overlay для долгих операций.
 *
 * Как использовать из любого места приложения:
 *   window.dispatchEvent(new CustomEvent('netmap:progress-start', {
 *     detail: { id: 'export-png', title: 'Экспорт PNG', message: 'Готовим сцену…' }
 *   }));
 *   // ...work...
 *   window.dispatchEvent(new CustomEvent('netmap:progress-end', {
 *     detail: { id: 'export-png' }
 *   }));
 *
 * Overlay сам появляется/исчезает. Несколько задач могут идти параллельно —
 * каждая тратит свой `id`, overlay скрывается когда счётчик обнуляется.
 *
 * Также этот же компонент показывает splash при первом монтировании (пока
 * hydrateFromNativeBackend не отработал). Splash автоматически прячется
 * через 400 мс после mount либо когда `netmap:hydrated` дошло.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface Task {
  id: string;
  title: string;
  message?: string;
}

export function LoadingOverlay() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [splash, setSplash] = useState(true);

  useEffect(() => {
    const onStart = (e: Event) => {
      const d = (e as CustomEvent<Task>).detail;
      if (!d?.id) return;
      setTasks(prev => {
        // Replace existing task with same id (allows updating message mid-flight).
        const filtered = prev.filter(t => t.id !== d.id);
        return [...filtered, d];
      });
    };
    const onEnd = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (!id) return;
      setTasks(prev => prev.filter(t => t.id !== id));
    };
    const onHydrated = () => setSplash(false);
    window.addEventListener('netmap:progress-start', onStart as EventListener);
    window.addEventListener('netmap:progress-end',   onEnd   as EventListener);
    window.addEventListener('netmap:hydrated',       onHydrated);
    // Fallback: hide splash after 800 ms even if hydrate event never fires.
    const t = setTimeout(() => setSplash(false), 800);
    return () => {
      clearTimeout(t);
      window.removeEventListener('netmap:progress-start', onStart as EventListener);
      window.removeEventListener('netmap:progress-end',   onEnd   as EventListener);
      window.removeEventListener('netmap:hydrated',       onHydrated);
    };
  }, []);

  if (splash) return <Splash />;
  if (tasks.length === 0) return null;

  // Show the *latest* task's message prominently but list all concurrent ones.
  const latest = tasks[tasks.length - 1];
  return createPortal(
    <div style={overlay}>
      <div style={card}>
        <Spinner size={44} />
        <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginTop: 14 }}>
          {latest.title}
        </div>
        {latest.message && (
          <div style={{ fontSize: 12, color: '#6B7280', marginTop: 6, textAlign: 'center' }}>
            {latest.message}
          </div>
        )}
        {tasks.length > 1 && (
          <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 8 }}>
            + ещё {tasks.length - 1} задач(и)
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/**
 * Первый экран приложения. Показывается до `netmap:hydrated` (или ~800 мс fallback).
 * Занимает всё окно, красивый градиент под цвет иконки приложения.
 */
function Splash() {
  return createPortal(
    <div style={splashOverlay}>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24,
      }}>
        <NetMapLogoLarge />
        <div style={{ fontSize: 28, fontWeight: 800, color: '#FFFFFF',
                       letterSpacing: 0.5, textShadow: '0 2px 8px rgba(0,0,0,0.25)' }}>
          NetMap
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
          Загрузка проекта…
        </div>
        <Spinner size={32} light />
      </div>
    </div>,
    document.body
  );
}

function NetMapLogoLarge() {
  // Miniature copy of the app icon — 6 nodes connected by lines.
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="netmap-splash-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.28"/>
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.12"/>
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="88" height="88" rx="18" fill="url(#netmap-splash-bg)"
            stroke="rgba(255,255,255,0.35)" strokeWidth="1"/>
      {/* edges */}
      <g stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.9">
        <line x1="30" y1="26" x2="48" y2="48"/>
        <line x1="70" y1="26" x2="48" y2="48"/>
        <line x1="20" y1="52" x2="48" y2="48"/>
        <line x1="76" y1="52" x2="48" y2="48"/>
        <line x1="30" y1="72" x2="48" y2="48"/>
        <line x1="66" y1="72" x2="48" y2="48"/>
      </g>
      {/* central hub */}
      <circle cx="48" cy="48" r="7" fill="#FFFFFF"/>
      {/* satellite nodes */}
      <circle cx="30" cy="26" r="4" fill="#FFFFFF"/>
      <rect   x="66" y="22" width="8" height="8" rx="1.5" fill="#FFFFFF"/>
      <circle cx="20" cy="52" r="4" fill="#FFFFFF"/>
      <circle cx="76" cy="52" r="4" fill="#FFFFFF"/>
      <circle cx="30" cy="72" r="4" fill="#FFFFFF"/>
      <circle cx="66" cy="72" r="4" fill="#FFFFFF"/>
    </svg>
  );
}

function Spinner({ size = 44, light = false }: { size?: number; light?: boolean }) {
  const stroke = light ? 'rgba(255,255,255,0.85)' : '#2563EB';
  const dim    = light ? 'rgba(255,255,255,0.2)'  : '#DBEAFE';
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <circle cx="22" cy="22" r="18" fill="none" stroke={dim} strokeWidth="4" />
      <circle cx="22" cy="22" r="18" fill="none" stroke={stroke} strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="30 200"
              style={{ transformOrigin: 'center', animation: 'netmap-spin 0.85s linear infinite' }} />
      <style>{`@keyframes netmap-spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9000,
  background: 'rgba(15,23,42,0.35)', backdropFilter: 'blur(3px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const card: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: 12,
  padding: '28px 36px', minWidth: 280, maxWidth: 420,
  boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  fontFamily: 'system-ui, sans-serif',
};

const splashOverlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9500,
  background: 'linear-gradient(135deg, #2563EB 0%, #7C3AED 100%)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'system-ui, sans-serif',
};
