/**
 * v0.49.0 — First-run onboarding tour.
 *
 * A modal dialog with 7 slides shown on first launch. Guides the user through
 * the core NetMap workflow:
 *   1. Welcome — what NetMap does
 *   2. Каталог — adding devices via left sidebar
 *   3. Drag-drop connections — port picker
 *   4. Двойной клик — focus mode
 *   5. Автообнаружение — LLDP/SNMP scanner
 *   6. Vault — password manager
 *   7. Start — load a seed project or start empty
 *
 * State:
 *   - localStorage key `netmap:onboarding-completed` (v1) — after tour ends
 *     (either via «Начать работу» or «Пропустить»), never shown again
 *   - Re-openable via Help menu → «Показать введение»
 *   - Event: `netmap:open-onboarding` (Custom event, dispatched from menu)
 *
 * Illustrations: pure inline SVG (no external images) so it works in preview
 * iframe (no network). Each slide has its own decorative graphic matching
 * the described feature.
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from './store';
import { usadbaSeed, donaSeed, chaikovskySeed } from './seed';

const LS_KEY = 'netmap:onboarding-completed';
const LS_VERSION = '1';   // bump to force re-show for existing users

export function hasCompletedOnboarding(): boolean {
  if (typeof localStorage === 'undefined') return true;   // SSR / no window
  return localStorage.getItem(LS_KEY) === LS_VERSION;
}
export function markOnboardingCompleted() {
  try { localStorage.setItem(LS_KEY, LS_VERSION); } catch { /* ignore */ }
}
export function resetOnboarding() {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

// ===========================================================================
// Styles
// ===========================================================================

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
    backdropFilter: 'blur(3px)',
    zIndex: 250000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 20,
  },
  dialog: {
    background: '#fff', borderRadius: 16,
    width: 860, maxWidth: '100%',
    maxHeight: '90vh',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 30px 80px rgba(15,23,42,0.35)',
    overflow: 'hidden',
    fontFamily: 'system-ui, sans-serif',
    position: 'relative',
  },
  skipBtn: {
    position: 'absolute', top: 12, right: 12, zIndex: 2,
    background: 'rgba(255,255,255,0.85)', border: '1px solid #e2e8f0',
    color: '#64748b', padding: '5px 12px', borderRadius: 6,
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
  },
  body: {
    display: 'grid', gridTemplateColumns: '380px 1fr',
    flex: 1, minHeight: 0, overflow: 'hidden',
  },
  illustration: {
    background: 'linear-gradient(135deg, #f8fafc, #eff6ff)',
    padding: 26,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  textCol: {
    padding: '32px 34px', overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  stepBadge: {
    display: 'inline-flex', alignItems: 'center', alignSelf: 'flex-start',
    background: '#eff6ff', color: '#1d4ed8',
    fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
    padding: '3px 10px', borderRadius: 999,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 22, fontWeight: 800, color: '#0f172a',
    lineHeight: 1.15, letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13, color: '#475569', fontWeight: 500,
    marginBottom: 6,
  },
  bodyText: {
    fontSize: 12.5, color: '#334155', lineHeight: 1.65,
  },
  list: {
    display: 'flex', flexDirection: 'column', gap: 6,
    marginTop: 10,
  },
  k: {
    color: '#3b82f6', marginRight: 6, fontWeight: 700,
  },
  tip: {
    marginTop: 14, padding: '10px 12px',
    background: '#fef9c3', border: '1px solid #fde047',
    borderRadius: 8, fontSize: 11.5, color: '#713f12', lineHeight: 1.5,
  },
  footer: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '14px 20px',
    borderTop: '1px solid #e2e8f0', background: '#f8fafc',
  },
  dots: {
    display: 'flex', gap: 5, alignItems: 'center',
  },
  dot: {
    height: 8, borderRadius: 4, background: '#e2e8f0',
    border: 'none', cursor: 'pointer', padding: 0,
    transition: 'width 180ms ease, background 180ms ease',
  },
  btnSecondary: {
    padding: '7px 14px', background: '#fff',
    border: '1px solid #cbd5e1', color: '#334155',
    borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  btnPrimary: {
    padding: '7px 16px',
    background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
    color: '#fff', border: 'none',
    borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(59,130,246,0.35)',
  },
};


// ---------------------------------------------------------------------------
// Host component — listens to `netmap:open-onboarding` and first-launch check
// Mount once in App.tsx.
// ---------------------------------------------------------------------------

export function OnboardingHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // First-launch: if the LS key is not set, show after a tiny delay so
    // the splash and hydrate finish first (feels less jumpy).
    if (!hasCompletedOnboarding()) {
      const t = setTimeout(() => setOpen(true), 400);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('netmap:open-onboarding', handler);
    return () => window.removeEventListener('netmap:open-onboarding', handler);
  }, []);

  const close = () => {
    markOnboardingCompleted();
    setOpen(false);
  };
  if (!open) return null;
  return <OnboardingDialog onClose={close} />;
}

// ---------------------------------------------------------------------------
// Dialog with slides
// ---------------------------------------------------------------------------

interface Slide {
  id: string;
  title: string;
  subtitle: string;
  body: React.ReactNode;      // long description
  illustration: React.ReactNode;
}

function OnboardingDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const slides = useMemo<Slide[]>(() => SLIDES, []);
  const total = slides.length;
  const isLast = step === total - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowRight') setStep(s => Math.min(s + 1, total - 1));
      if (e.key === 'ArrowLeft')  setStep(s => Math.max(s - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, total]);

  const cur = slides[step];

  return createPortal(
    <div style={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={styles.dialog} role="dialog" aria-label="Знакомство с NetMap">
        {/* Skip button top-right */}
        <button onClick={onClose} style={styles.skipBtn}
                title="Пропустить (Esc)">
          Пропустить ✕
        </button>

        {/* Two-column layout: illustration | text */}
        <div style={styles.body}>
          <div style={styles.illustration}>
            {cur.illustration}
          </div>
          <div style={styles.textCol}>
            <div style={styles.stepBadge}>
              Шаг {step + 1} из {total}
            </div>
            <div style={styles.title}>{cur.title}</div>
            <div style={styles.subtitle}>{cur.subtitle}</div>
            <div style={styles.bodyText}>{cur.body}</div>
          </div>
        </div>

        {/* Progress dots + navigation */}
        <div style={styles.footer}>
          <div style={styles.dots}>
            {slides.map((_, i) => (
              <button key={i} onClick={() => setStep(i)}
                title={`Слайд ${i + 1}`}
                style={{
                  ...styles.dot,
                  background: i === step ? '#3b82f6' : i < step ? '#93c5fd' : '#e2e8f0',
                  width: i === step ? 24 : 8,
                }} />
            ))}
          </div>
          <div style={{ flex: 1 }} />
          {step > 0 && (
            <button style={styles.btnSecondary} onClick={() => setStep(s => s - 1)}>
              ← Назад
            </button>
          )}
          {!isLast ? (
            <button style={styles.btnPrimary} onClick={() => setStep(s => s + 1)}>
              Далее →
            </button>
          ) : (
            <StartCTA onDone={onClose} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Last-slide CTA — Load seed or start empty
// ---------------------------------------------------------------------------

function StartCTA({ onDone }: { onDone: () => void }) {
  const importProject = useStore(s => s.importProject);
  const pushAlert = useStore(s => s.pushAlert);

  const loadSeed = (which: 'usadba' | 'dona' | 'chaikovsky') => {
    const seed = which === 'usadba' ? usadbaSeed : which === 'dona' ? donaSeed : chaikovskySeed;
    try {
      const id = importProject(JSON.stringify(seed));
      if (id) {
        pushAlert({
          severity: 'success', origin: 'app',
          title: 'Проект-пример загружен',
          message: `Импортирована схема «${seed.name}». Можно править — это ваша копия.`,
        });
        onDone();
      } else {
        pushAlert({ severity: 'warn', origin: 'app',
                    title: 'Не удалось загрузить пример',
                    message: 'Данные seed повреждены или несовместимы' });
      }
    } catch (e: any) {
      pushAlert({ severity: 'warn', origin: 'app', title: 'Ошибка загрузки', message: e?.message || String(e) });
    }
  };

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <div style={{ fontSize: 11, color: '#64748b', marginRight: 4 }}>Начать с:</div>
      <button style={styles.btnSecondary} onClick={() => loadSeed('usadba')}>Отель «Усадьба»</button>
      <button style={styles.btnSecondary} onClick={() => loadSeed('dona')}>Отель «Дона»</button>
      <button style={styles.btnSecondary} onClick={() => loadSeed('chaikovsky')}>Пример «Чайковский»</button>
      <button style={styles.btnPrimary} onClick={onDone}>Пустой проект</button>
    </div>
  );
}

// ===========================================================================
// SVG illustrations — pure inline, no external assets
// ===========================================================================

function Illu1_Welcome() {
  return (
    <svg viewBox="0 0 300 220" width="100%" height="100%">
      <defs>
        <linearGradient id="ill1-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" stopOpacity="0.15"/>
          <stop offset="1" stopColor="#6366f1" stopOpacity="0.05"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="300" height="220" rx="16" fill="url(#ill1-bg)"/>
      {/* Central hub */}
      <g stroke="#3b82f6" strokeWidth="1.5" fill="none" opacity="0.7">
        <line x1="150" y1="110" x2="60" y2="50"/>
        <line x1="150" y1="110" x2="240" y2="50"/>
        <line x1="150" y1="110" x2="60" y2="170"/>
        <line x1="150" y1="110" x2="240" y2="170"/>
        <line x1="150" y1="110" x2="30" y2="110"/>
        <line x1="150" y1="110" x2="270" y2="110"/>
      </g>
      <circle cx="150" cy="110" r="20" fill="#3b82f6"/>
      <text x="150" y="115" fontSize="11" fontWeight="700" fill="white" textAnchor="middle">HUB</text>
      {/* Satellites */}
      {[
        [60, 50, '#22c55e', 'PC'],
        [240, 50, '#f59e0b', 'AP'],
        [60, 170, '#ef4444', 'CAM'],
        [240, 170, '#8b5cf6', 'SRV'],
        [30, 110, '#3b82f6', 'SW'],
        [270, 110, '#ec4899', 'PoS'],
      ].map(([x, y, c, label], i) => (
        <g key={i}>
          <circle cx={x as number} cy={y as number} r="14" fill={c as string}/>
          <text x={x as number} y={(y as number) + 3} fontSize="8" fontWeight="700" fill="white" textAnchor="middle">{label}</text>
        </g>
      ))}
    </svg>
  );
}

function Illu2_Catalog() {
  return (
    <svg viewBox="0 0 300 220" width="100%" height="100%">
      <rect x="0" y="0" width="300" height="220" rx="16" fill="#f8fafc"/>
      {/* Left sidebar mock */}
      <rect x="10" y="10" width="80" height="200" rx="8" fill="#fff" stroke="#e2e8f0"/>
      <rect x="20" y="22" width="60" height="6" rx="2" fill="#3b82f6"/>
      {['Routers · 2', 'Switches · 4', 'APs · 3', 'Cameras · 12', 'PCs · 8'].map((t, i) => (
        <g key={i} transform={`translate(20, ${40 + i * 30})`}>
          <rect width="60" height="22" rx="4" fill={i === 1 ? '#dbeafe' : '#f1f5f9'}/>
          <circle cx="10" cy="11" r="4" fill={i === 1 ? '#3b82f6' : '#94a3b8'}/>
          <rect x="20" y="8" width="34" height="6" rx="2" fill={i === 1 ? '#1d4ed8' : '#64748b'}/>
        </g>
      ))}
      {/* Drag arrow */}
      <path d="M 100 120 Q 160 60 220 100" fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="4 3"/>
      <polygon points="220,100 214,94 218,102 210,98" fill="#3b82f6"/>
      {/* Drop target — canvas card */}
      <rect x="180" y="90" width="100" height="60" rx="10" fill="#fff" stroke="#3b82f6" strokeWidth="2"/>
      <circle cx="200" cy="115" r="12" fill="#dbeafe"/>
      <circle cx="200" cy="115" r="5" fill="#3b82f6"/>
      <rect x="220" y="105" width="50" height="6" rx="2" fill="#0f172a"/>
      <rect x="220" y="118" width="35" height="5" rx="2" fill="#94a3b8"/>
      <text x="230" y="170" fontSize="10" fontWeight="700" fill="#3b82f6" textAnchor="middle">drag &amp; drop</text>
    </svg>
  );
}

function Illu3_Connect() {
  return (
    <svg viewBox="0 0 300 220" width="100%" height="100%">
      <rect x="0" y="0" width="300" height="220" rx="16" fill="#f8fafc"/>
      {/* Camera being dragged */}
      <g opacity="0.9">
        <rect x="30" y="30" width="70" height="50" rx="10" fill="#fff" stroke="#e2e8f0" strokeWidth="1.5"/>
        <circle cx="65" cy="55" r="10" fill="#fef2f2"/>
        <circle cx="65" cy="55" r="4" fill="#ef4444"/>
        <text x="65" y="76" fontSize="8" fill="#64748b" textAnchor="middle">Camera-1</text>
      </g>
      {/* Arrow with dashed line to switch */}
      <path d="M 100 70 Q 150 100 175 130" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="5 3"/>
      <polygon points="175,130 168,124 172,132 165,128" fill="#f59e0b"/>
      {/* Switch (highlighted with amber dashed outline) */}
      <rect x="150" y="120" width="120" height="70" rx="10" fill="#fff"
            stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="6 3"/>
      <text x="210" y="140" fontSize="10" fontWeight="700" fill="#0f172a" textAnchor="middle">SW-Reception</text>
      {/* Port grid inside switch */}
      {Array.from({ length: 12 }, (_, i) => {
        const row = Math.floor(i / 6), col = i % 6;
        const x = 160 + col * 17;
        const y = 148 + row * 14;
        const free = i > 3;
        return (
          <rect key={i} x={x} y={y} width="14" height="10" rx="2"
                fill={free ? '#dcfce7' : '#fef3c7'}
                stroke={free ? '#86efac' : '#fde68a'} strokeWidth="1"/>
        );
      })}
      <text x="150" y="212" fontSize="10" fontWeight="700" fill="#f59e0b">
        отпустите → диалог выбора порта
      </text>
    </svg>
  );
}

function Illu4_DoubleClick() {
  return (
    <svg viewBox="0 0 300 220" width="100%" height="100%">
      <rect x="0" y="0" width="300" height="220" rx="16" fill="#f8fafc"/>
      {/* Two panels side-by-side */}
      {/* Left: single click → right panel */}
      <g>
        <rect x="10" y="15" width="130" height="94" rx="8" fill="#fff" stroke="#e2e8f0"/>
        <text x="75" y="30" fontSize="9" fontWeight="700" fill="#64748b" textAnchor="middle">1 клик</text>
        <circle cx="45" cy="55" r="10" fill="#3b82f6"/>
        <text x="45" y="59" fontSize="8" fill="white" textAnchor="middle" fontWeight="700">SW</text>
        {/* Right panel schematic */}
        <rect x="70" y="42" width="60" height="55" rx="4" fill="#eff6ff" stroke="#3b82f6"/>
        <rect x="76" y="49" width="30" height="4" rx="1" fill="#1d4ed8"/>
        <rect x="76" y="58" width="45" height="3" rx="1" fill="#94a3b8"/>
        <rect x="76" y="66" width="40" height="3" rx="1" fill="#94a3b8"/>
        <rect x="76" y="74" width="35" height="3" rx="1" fill="#94a3b8"/>
        <rect x="76" y="82" width="45" height="3" rx="1" fill="#94a3b8"/>
      </g>
      {/* Right: double click → focus */}
      <g>
        <rect x="160" y="15" width="130" height="94" rx="8" fill="#fff" stroke="#e2e8f0"/>
        <text x="225" y="30" fontSize="9" fontWeight="700" fill="#64748b" textAnchor="middle">2 клика</text>
        <rect x="170" y="40" width="110" height="58" rx="6" fill="#0f172a"/>
        <circle cx="225" cy="66" r="14" fill="#3b82f6"/>
        <text x="225" y="70" fontSize="10" fill="white" textAnchor="middle" fontWeight="700">SW</text>
        <text x="225" y="94" fontSize="7" fill="#93c5fd" textAnchor="middle">полноэкранный focus</text>
      </g>
      {/* Bottom row explanations */}
      <g transform="translate(0, 130)">
        <rect x="10" y="0" width="130" height="70" rx="8" fill="#eff6ff" stroke="#93c5fd"/>
        <text x="75" y="20" fontSize="10" fontWeight="700" fill="#1d4ed8" textAnchor="middle">Одинарный</text>
        <text x="75" y="38" fontSize="9" fill="#334155" textAnchor="middle">→ выбор</text>
        <text x="75" y="52" fontSize="9" fill="#334155" textAnchor="middle">→ панель справа</text>

        <rect x="160" y="0" width="130" height="70" rx="8" fill="#f1f5f9" stroke="#cbd5e1"/>
        <text x="225" y="20" fontSize="10" fontWeight="700" fill="#334155" textAnchor="middle">Двойной</text>
        <text x="225" y="38" fontSize="9" fill="#334155" textAnchor="middle">→ focus mode</text>
        <text x="225" y="52" fontSize="9" fill="#334155" textAnchor="middle">→ крупный вид</text>
      </g>
    </svg>
  );
}

function Illu5_AutoDiscovery() {
  return (
    <svg viewBox="0 0 300 220" width="100%" height="100%">
      <rect x="0" y="0" width="300" height="220" rx="16" fill="#f8fafc"/>
      {/* Router in center */}
      <rect x="130" y="90" width="60" height="40" rx="8" fill="#3b82f6"/>
      <text x="160" y="115" fontSize="10" fontWeight="700" fill="white" textAnchor="middle">Router</text>
      {/* Waves of discovery */}
      {[30, 50, 70].map((r, i) => (
        <circle key={i} cx="160" cy="110" r={r} fill="none" stroke="#3b82f6"
                strokeWidth="1.5" strokeDasharray="3 4" opacity={0.6 - i * 0.15}/>
      ))}
      {/* Discovered devices around */}
      {[
        [50, 40, '#22c55e', 'AP'],
        [250, 40, '#f59e0b', 'SW'],
        [50, 180, '#ef4444', 'Cam'],
        [250, 180, '#8b5cf6', 'PC'],
      ].map(([x, y, c, l], i) => (
        <g key={i}>
          <circle cx={x as number} cy={y as number} r="14" fill={c as string} opacity="0.9"/>
          <text x={x as number} y={(y as number) + 3} fontSize="8" fill="white" textAnchor="middle" fontWeight="700">{l}</text>
          {/* Green check mark badge */}
          <circle cx={(x as number) + 10} cy={(y as number) - 10} r="6" fill="#16a34a"/>
          <path d={`M ${(x as number) + 7} ${(y as number) - 10} l 2 2 l 4 -4`}
                stroke="white" strokeWidth="1.5" fill="none"/>
        </g>
      ))}
      {/* Label at bottom */}
      <text x="150" y="210" fontSize="10" fontWeight="700" fill="#3b82f6" textAnchor="middle">
        LLDP · SNMP · MikroTik neighbors
      </text>
    </svg>
  );
}

function Illu6_Vault() {
  return (
    <svg viewBox="0 0 300 220" width="100%" height="100%">
      <rect x="0" y="0" width="300" height="220" rx="16" fill="#f8fafc"/>
      {/* Vault card */}
      <rect x="60" y="30" width="180" height="160" rx="12" fill="#4338ca"/>
      <rect x="60" y="30" width="180" height="30" rx="12" fill="#3730a3"/>
      <rect x="60" y="55" width="180" height="5" fill="#3730a3"/>
      <text x="150" y="49" fontSize="12" fontWeight="700" fill="white" textAnchor="middle">🔒 Vault</text>
      {/* Locked padlock icon big */}
      <g transform="translate(115, 80)">
        <rect x="10" y="20" width="50" height="40" rx="4" fill="white"/>
        <path d="M 20 20 v -8 a 15 15 0 0 1 30 0 v 8" fill="none" stroke="white" strokeWidth="4"/>
        <circle cx="35" cy="40" r="4" fill="#4338ca"/>
      </g>
      {/* Bottom fields */}
      <g transform="translate(75, 155)">
        <rect x="0" y="0" width="150" height="6" rx="2" fill="#818cf8"/>
        <rect x="0" y="12" width="120" height="6" rx="2" fill="#a5b4fc"/>
        <rect x="0" y="24" width="90" height="6" rx="2" fill="#a5b4fc"/>
      </g>
      {/* AES badge */}
      <g transform="translate(200, 195)">
        <rect x="0" y="0" width="80" height="20" rx="10" fill="#dcfce7"/>
        <text x="40" y="14" fontSize="10" fontWeight="700" fill="#166534" textAnchor="middle">
          AES-256-GCM
        </text>
      </g>
    </svg>
  );
}

function Illu7_SmartLayout() {
  return (
    <svg viewBox="0 0 300 220" width="100%" height="100%">
      <rect x="0" y="0" width="300" height="220" rx="16" fill="#f8fafc"/>
      {/* Three groups */}
      <g>
        <rect x="15" y="30" width="85" height="160" rx="10" fill="#dbeafe" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4 3"/>
        <text x="57" y="48" fontSize="9" fontWeight="700" fill="#1d4ed8" textAnchor="middle">Ресепшн</text>
        <text x="57" y="60" fontSize="7" fill="#3b82f6" textAnchor="middle">10.11.10.0/24</text>
        {[70, 100, 130, 160].map((y, i) => (
          <g key={i}>
            <rect x="25" y={y} width="65" height="18" rx="4" fill="white" stroke="#93c5fd"/>
            <circle cx="35" cy={y + 9} r="4" fill="#3b82f6"/>
          </g>
        ))}
      </g>
      <g>
        <rect x="108" y="30" width="85" height="160" rx="10" fill="#dcfce7" stroke="#22c55e" strokeWidth="1.5" strokeDasharray="4 3"/>
        <text x="150" y="48" fontSize="9" fontWeight="700" fill="#166534" textAnchor="middle">Серверная</text>
        <text x="150" y="60" fontSize="7" fill="#22c55e" textAnchor="middle">10.11.40.0/24</text>
        {[70, 100, 130, 160].map((y, i) => (
          <g key={i}>
            <rect x="118" y={y} width="65" height="18" rx="4" fill="white" stroke="#86efac"/>
            <circle cx="128" cy={y + 9} r="4" fill="#22c55e"/>
          </g>
        ))}
      </g>
      <g>
        <rect x="201" y="30" width="85" height="160" rx="10" fill="#fee2e2" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 3"/>
        <text x="243" y="48" fontSize="9" fontWeight="700" fill="#991b1b" textAnchor="middle">Камеры</text>
        <text x="243" y="60" fontSize="7" fill="#ef4444" textAnchor="middle">10.11.50.0/24</text>
        {[70, 100, 130, 160].map((y, i) => (
          <g key={i}>
            <rect x="211" y={y} width="65" height="18" rx="4" fill="white" stroke="#fca5a5"/>
            <circle cx="221" cy={y + 9} r="4" fill="#ef4444"/>
          </g>
        ))}
      </g>
      {/* Connecting lines */}
      <line x1="100" y1="110" x2="108" y2="110" stroke="#94a3b8" strokeWidth="1.5"/>
      <line x1="193" y1="110" x2="201" y2="110" stroke="#94a3b8" strokeWidth="1.5"/>
    </svg>
  );
}

function Illu8_Ready() {
  return (
    <svg viewBox="0 0 300 220" width="100%" height="100%">
      <defs>
        <linearGradient id="ill8-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22c55e" stopOpacity="0.15"/>
          <stop offset="1" stopColor="#3b82f6" stopOpacity="0.1"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="300" height="220" rx="16" fill="url(#ill8-bg)"/>
      {/* Big check circle */}
      <circle cx="150" cy="80" r="46" fill="#22c55e"/>
      <path d="M 130 82 l 15 15 l 30 -30" stroke="white" strokeWidth="7"
            fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Three tiles below (seeds) */}
      <g transform="translate(20, 145)">
        {['Усадьба', 'Дона', 'Чайковский'].map((label, i) => (
          <g key={label} transform={`translate(${i * 88}, 0)`}>
            <rect x="0" y="0" width="82" height="55" rx="8" fill="white" stroke="#cbd5e1"/>
            <circle cx="41" cy="20" r="8" fill="#3b82f6"/>
            <text x="41" y="43" fontSize="10" fontWeight="600" fill="#0f172a" textAnchor="middle">{label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

// ===========================================================================
// Slide content
// ===========================================================================

const SLIDES: Slide[] = [
  {
    id: 'welcome',
    title: 'Добро пожаловать в NetMap',
    subtitle: 'Интерактивная схема сети для сисадмина отеля',
    body: (
      <>
        NetMap заменяет статичные схемы в Visio / draw.io живой картой сети,
        которая обновляется вместе с вашей инфраструктурой.
        <div style={styles.list}>
          <div><b style={styles.k}>📍</b> Карта устройств с портами, VLAN, кабелями</div>
          <div><b style={styles.k}>🔒</b> Встроенный vault для паролей (AES-256-GCM)</div>
          <div><b style={styles.k}>📡</b> Ping-мониторинг + автообнаружение LLDP/SNMP</div>
          <div><b style={styles.k}>💾</b> Всё локально — SQLite + localStorage</div>
        </div>
      </>
    ),
    illustration: <Illu1_Welcome />,
  },
  {
    id: 'catalog',
    title: 'Каталог устройств — слева',
    subtitle: 'Быстрое добавление роутеров, свитчей, камер, серверов',
    body: (
      <>
        В левой панели <b>Устройства → Каталог</b> — все типы устройств,
        сгруппированные по kind (router / switch / AP / camera / server / …).
        <div style={styles.list}>
          <div>Клик на плитку типа <b>«+ Добавить устройство»</b> — открывается modal</div>
          <div>Выберите пресет (например «MikroTik hEX S») или пустое устройство</div>
          <div>Устройство появится в правом верхнем углу канваса — можно перетащить</div>
        </div>
        <div style={styles.tip}>
          💡 Слева также вкладка <b>Топология</b> с фильтрами по слоям (core / distribution / access)
          и VLAN.
        </div>
      </>
    ),
    illustration: <Illu2_Catalog />,
  },
  {
    id: 'connect',
    title: 'Соединение drag &amp; drop',
    subtitle: 'Перетащите устройство на свитч → диалог выбора порта',
    body: (
      <>
        Чтобы связать два устройства кабелем:
        <div style={styles.list}>
          <div>1. Удерживайте карточку устройства (Camera, PC, …)</div>
          <div>2. Тяните её на свитч — свитч подсветится <span style={{color:'#f59e0b',fontWeight:700}}>амбер-обводкой</span></div>
          <div>3. Отпустите — открывается <b>PortPicker</b>: grid всех портов</div>
          <div>4. Клик на зелёный (свободный) порт → «Соединить»</div>
        </div>
        <div style={styles.tip}>
          💡 Если все порты заняты — выберите жёлтый порт, диалог покажет
          «Заменить связь» (старая связь удалится, новая создастся).
        </div>
      </>
    ),
    illustration: <Illu3_Connect />,
  },
  {
    id: 'click',
    title: 'Одинарный vs Двойной клик',
    subtitle: 'Разные жесты — разные действия',
    body: (
      <>
        <div style={styles.list}>
          <div>
            <b>Одинарный клик</b> по устройству — открывает <b>правую панель</b>
            с расширенными свойствами: Overview / Ports / VLAN / Links /
            Monitor / <b>Vault</b> / Notes.
          </div>
          <div>
            <b>Двойной клик</b> — переходит в <b>FocusView</b> (полноэкранный крупный вид)
            с подписями всех подключений.
          </div>
          <div>
            <b>Shift + клик</b> — устанавливает traceroute endpoint (A → B).
          </div>
        </div>
        <div style={styles.tip}>
          💡 <b>Esc</b> закрывает focus / модалки, <b>F</b> — восстановить вид карты (fit),
          <b> Ctrl+Z</b> — отмена.
        </div>
      </>
    ),
    illustration: <Illu4_DoubleClick />,
  },
  {
    id: 'discovery',
    title: 'Автообнаружение топологии',
    subtitle: 'Приложение само найдёт устройства и связи',
    body: (
      <>
        Меню <b>Инструменты → Автообнаружение топологии</b> — сканер по трём каналам:
        <div style={styles.list}>
          <div><b>MikroTik SSH</b> — /ip/neighbor + /interface/bridge/host + /ip/arp</div>
          <div><b>SNMP</b> — LLDP-MIB + BRIDGE-MIB + IF-MIB для любого managed switch</div>
          <div><b>Vendor detect</b> — MikroTik / Ubiquiti / Cisco / D-Link / Ruijie</div>
        </div>
        <div style={styles.tip}>
          💡 Найденные устройства показываются в диалоге «Review» с checkbox'ами
          — вы решаете, какие добавить. Один Ctrl+Z отменяет весь пакет.
        </div>
      </>
    ),
    illustration: <Illu5_AutoDiscovery />,
  },
  {
    id: 'vault',
    title: 'Встроенный менеджер паролей',
    subtitle: 'Vault — AES-256-GCM, всё локально',
    body: (
      <>
        Пароли к устройствам, TOTP, заметки — хранятся в зашифрованном
        SQLite и открываются мастер-паролем.
        <div style={styles.list}>
          <div>Клик на устройство → вкладка <b>🔒</b> → «+ Добавить запись»</div>
          <div>Inline-форма как в Bitwarden: URL, login, password, TOTP, notes</div>
          <div>Кнопка <b>Generate</b> — 16-символьный безопасный пароль</div>
          <div><b>Vault Studio (Ctrl+K)</b> — полноэкранный редактор с папками</div>
        </div>
        <div style={styles.tip}>
          💡 Пароль автоматически очищается из буфера обмена через 45 секунд после
          копирования.
        </div>
      </>
    ),
    illustration: <Illu6_Vault />,
  },
  {
    id: 'layout',
    title: 'Умная раскладка карты',
    subtitle: 'Автогруппировка по локациям, VLAN, подсетям',
    body: (
      <>
        Кнопка ⭐ в правом верхнем углу канваса → <b>«Умная раскладка»</b>.
        Приложение автоматически группирует устройства:
        <div style={styles.list}>
          <div><b>Hybrid</b> (default) — сначала по <b>location</b>, потом VLAN, потом /24</div>
          <div><b>Location</b> — только по полю «Локация»</div>
          <div><b>VLAN</b> — по VLAN membership порта</div>
          <div><b>IP /24</b> — по подсети IP-адреса</div>
        </div>
        <div style={styles.tip}>
          💡 Endpoint'ы (камеры, PC, принтеры) автоматически «сворачиваются»
          в чипы внутри своего свитча — карта становится читаемой на 100+ устройствах.
          Toggle в toolbar: <b>Компактно / Развёрнуто</b>.
        </div>
      </>
    ),
    illustration: <Illu7_SmartLayout />,
  },
  {
    id: 'start',
    title: 'Готово! Начнём?',
    subtitle: 'Загрузите пример или начните с пустого проекта',
    body: (
      <>
        Есть три готовых схемы реальных отелей — можно посмотреть
        как выглядит настроенная карта:
        <div style={styles.list}>
          <div><b>Отель «Усадьба»</b> — 66 устройств, 5 VLAN, 8 групп</div>
          <div><b>Отель «Дона»</b> — 38 устройств, 4 VLAN, 6 групп</div>
          <div><b>«Чайковский»</b> — 30 устройств, компактный пример</div>
        </div>
        <div style={styles.tip}>
          💡 Введение можно повторно открыть через <b>Помощь → Показать введение</b> в меню
          сверху. Или посмотреть горячие клавиши через <b>F1</b>.
        </div>
      </>
    ),
    illustration: <Illu8_Ready />,
  },
];

