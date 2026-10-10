/**
 * v0.87.0 — мастер уточнений автообнаружения (окно поверх диалога).
 *
 * Шаги и логика — в discoveryWizardLogic.ts. Здесь только показ вопросов и сбор ответов.
 * Ничего не применяется до кнопки «Применить ответы» на последнем экране.
 */

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DiscoveryScanResult } from './discoveryClient';
import {
  summarizeEffects, wizardEffects,
  type WizardAnswers, type WizardItem, type WizardStep, type UplinkChoice,
} from './discoveryWizardLogic';

interface Props {
  scan: DiscoveryScanResult;
  steps: WizardStep[];
  initial: WizardAnswers;
  kindLabel: (kind: string) => string;
  onClose: () => void;
  onFinish: (answers: WizardAnswers) => void;
}

export function DiscoveryWizard({ scan, steps, initial, kindLabel, onClose, onFinish }: Props) {
  const [answers, setAnswers] = useState<WizardAnswers>(initial);
  const [idx, setIdx] = useState(0);
  const onSummary = idx >= steps.length;
  const step = steps[idx];

  const summary = useMemo(
    () => (onSummary ? summarizeEffects(wizardEffects(scan, answers)) : []),
    [onSummary, scan, answers]);

  const patch = (fn: (a: WizardAnswers) => WizardAnswers) => setAnswers(a => fn(a));

  return createPortal(
    <div style={S.backdrop} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={S.dialog} role="dialog" aria-label="Мастер уточнений">
        <header style={S.header}>
          <strong>Мастер уточнений</strong>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {steps.length === 0 ? '' : onSummary ? 'Проверка ответов' : `Шаг ${idx + 1} из ${steps.length}: ${step.title}`}
          </span>
        </header>

        <div style={S.body}>
          {steps.length === 0 && (
            <p style={S.p}>Вопросов нет: всё найдено однозначно. Можно закрыть окно и применить результат.</p>
          )}

          {step && !onSummary && (
            <>
              <p style={S.p}>{HINTS[step.id]}</p>
              {step.items.map(it => (
                <ItemRow key={`${it.step}:${it.key}`} item={it} answers={answers} patch={patch} kindLabel={kindLabel} />
              ))}
            </>
          )}

          {onSummary && (
            <>
              <p style={S.p}>Так будет выглядеть результат. Пока ничего не применено.</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                {summary.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </>
          )}
        </div>

        <footer style={S.footer}>
          <button style={S.btn} onClick={onClose}>Отмена</button>
          <span style={{ flex: 1 }} />
          {idx > 0 && <button style={S.btn} onClick={() => setIdx(i => i - 1)}>Назад</button>}
          {steps.length > 0 && !onSummary && (
            <button style={S.btn} onClick={() => setIdx(i => i + 1)}>Далее</button>
          )}
          {onSummary && (
            <button style={{ ...S.btn, ...S.primary }} onClick={() => onFinish(answers)}>Применить ответы</button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

const HINTS: Record<WizardStep['id'], string> = {
  hubs: 'Найдены ядро или распределение, которые ещё не опрошены. Отметьте, какие опросить. Опрос запускается кнопкой «Опросить выбранные» в окне.',
  kind: 'Тип не удалось определить по признакам. Выберите тип или оставьте «не менять».',
  name: 'У этих устройств нет имени. Введите его или оставьте пустым: тогда останется как есть.',
  uplink: 'Эти клиенты найдены через аплинк, то есть за другим коммутатором. Проверьте, за каким коммутатором они стоят.',
  vlan: 'У этих VLAN нет имени. Назовите их или исключите из проекта.',
  subnet: 'Подсети роутера. Если сеть чужая или служебная (гостевая, IoT, управление), исключите её: устройства из неё не добавятся.',
  macOnly: 'Устройства, для которых известен только MAC. Их можно добавить как есть или пропустить все.',
};

function ItemRow({ item, answers, patch, kindLabel }: {
  item: WizardItem;
  answers: WizardAnswers;
  patch: (fn: (a: WizardAnswers) => WizardAnswers) => void;
  kindLabel: (kind: string) => string;
}) {
  const head = (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</div>
      <div style={{ fontSize: 11, color: '#64748b' }}>
        {item.sub}{item.count != null && item.step !== 'macOnly' ? ` · клиентов: ${item.count}` : ''}
      </div>
    </div>
  );

  switch (item.step) {
    case 'hubs':
      return (
        <label style={S.row}>
          <input type="checkbox" checked={!!answers.hubs[item.key]}
            onChange={e => patch(a => ({ ...a, hubs: { ...a.hubs, [item.key]: e.target.checked } }))} />
          {head}
        </label>
      );

    case 'kind':
      return (
        <div style={S.row}>
          {head}
          <select style={S.input} value={answers.kinds[item.key] ?? ''}
            onChange={e => patch(a => ({ ...a, kinds: { ...a.kinds, [item.key]: e.target.value } }))}>
            <option value="">— не менять —</option>
            {(item.options || []).map(k => <option key={k} value={k}>{kindLabel(k)}</option>)}
          </select>
          {item.remembered && <span style={S.hint}>ранее: {kindLabel(item.remembered)}</span>}
        </div>
      );

    case 'name':
      return (
        <div style={S.row}>
          {head}
          <input style={S.input} value={answers.names[item.key] ?? ''} placeholder="оставить как есть"
            onChange={e => patch(a => ({ ...a, names: { ...a.names, [item.key]: e.target.value } }))} />
          {item.remembered && <span style={S.hint}>ранее: {item.remembered}</span>}
        </div>
      );

    case 'uplink': {
      const cur: UplinkChoice = answers.uplinks[item.key] ?? { mode: 'keep' };
      const setC = (c: UplinkChoice) => patch(a => ({ ...a, uplinks: { ...a.uplinks, [item.key]: c } }));
      const cands = item.candidates || [];
      const moveTo = cur.mode === 'move' ? cur.toTempId : (cands[0]?.tempId ?? '');
      return (
        <div style={{ ...S.row, flexDirection: 'column', alignItems: 'stretch' }}>
          {head}
          <label style={S.radio}>
            <input type="radio" name={`up-${item.key}`} checked={cur.mode === 'keep'} onChange={() => setC({ mode: 'keep' })} />
            оставить как есть
          </label>
          <label style={S.radio}>
            <input type="radio" name={`up-${item.key}`} checked={cur.mode === 'drop'} onChange={() => setC({ mode: 'drop' })} />
            убрать связь (не добавлять связь с коммутатором)
          </label>
          {cands.length > 0 && (
            <label style={S.radio}>
              <input type="radio" name={`up-${item.key}`} checked={cur.mode === 'move'} onChange={() => setC({ mode: 'move', toTempId: moveTo })} />
              за другим коммутатором:
              <select style={{ ...S.input, marginLeft: 6 }} disabled={cur.mode !== 'move'} value={moveTo}
                onChange={e => setC({ mode: 'move', toTempId: e.target.value })}>
                {cands.map(c => <option key={c.tempId} value={c.tempId}>{c.name}</option>)}
              </select>
            </label>
          )}
        </div>
      );
    }

    case 'vlan': {
      const v = answers.vlans[item.key] ?? { exclude: false, name: '' };
      const setV = (x: { exclude: boolean; name: string }) => patch(a => ({ ...a, vlans: { ...a.vlans, [item.key]: x } }));
      return (
        <div style={{ ...S.row, flexWrap: 'wrap' }}>
          {head}
          <input style={S.input} value={v.name} placeholder="имя VLAN"
            onChange={e => setV({ ...v, name: e.target.value })} />
          <label style={S.radio}>
            <input type="checkbox" checked={v.exclude} onChange={e => setV({ ...v, exclude: e.target.checked })} />
            исключить из проекта
          </label>
        </div>
      );
    }

    case 'subnet':
      return (
        <label style={S.row}>
          <input type="checkbox" checked={!!answers.subnets[item.key]}
            onChange={e => patch(a => ({ ...a, subnets: { ...a.subnets, [item.key]: e.target.checked } }))} />
          {head}
          <span style={S.hint}>исключить</span>
        </label>
      );

    case 'macOnly':
      return (
        <div style={{ ...S.row, flexDirection: 'column', alignItems: 'stretch' }}>
          {head}
          <label style={S.radio}>
            <input type="radio" name="macOnly" checked={answers.macOnly === 'add'} onChange={() => patch(a => ({ ...a, macOnly: 'add' }))} />
            добавить как есть (имя = MAC)
          </label>
          <label style={S.radio}>
            <input type="radio" name="macOnly" checked={answers.macOnly === 'skip'} onChange={() => patch(a => ({ ...a, macOnly: 'skip' }))} />
            пропустить все
          </label>
        </div>
      );
  }
}

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.42)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9600,
  },
  dialog: {
    background: '#fff', borderRadius: 14, width: 680, maxWidth: '94vw', maxHeight: '90vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 30px 60px -20px rgba(15,23,42,0.4)', fontSize: 13,
  },
  header: {
    padding: '12px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex',
    alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  body: { padding: '12px 16px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 },
  footer: {
    padding: '10px 16px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 8, alignItems: 'center',
  },
  p: { margin: '0 0 4px', color: '#334155', lineHeight: 1.5 },
  row: {
    display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px',
    border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff',
  },
  radio: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#334155' },
  input: { padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12, minWidth: 0 },
  hint: { fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' },
  btn: {
    padding: '6px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff',
    cursor: 'pointer', fontSize: 13,
  },
  primary: { background: '#0f766e', borderColor: '#0f766e', color: '#fff' },
};
