// 감시 조건·주기·예약 편집 (등록 화면과 상세 화면에서 같이 사용)
import { X } from 'lucide-react';
import { useState } from 'react';
import type { KeywordConditions, QueueConditions, Schedule } from '../../shared/types';
import { AHEAD_MILESTONE_CHOICES, DEFAULT_AHEAD_MILESTONES, INTERVAL_CHOICES } from '../../shared/types';
import { fmtInterval, Toggle } from './parts';

type BoolKey = 'turn' | 'ahead' | 'position' | 'gone' | 'error';
const COND_ITEMS: { key: BoolKey; label: string; desc: string }[] = [
  { key: 'turn', label: '지금 내 차례', desc: '진행 중으로 바뀌면 바로 알려요' },
  { key: 'ahead', label: '내 차례 다가옴', desc: '앞 인원이 정한 숫자에 도달하면 알려요' },
  { key: 'position', label: '대기 순번 숫자 변경', desc: '중간 끼워넣기 등으로 번호가 바뀔 때 (알림 많음)' },
  { key: 'gone', label: '대기열에서 사라짐', desc: '명단에서 내 이름이 없어졌을 때' },
  { key: 'error', label: '감시 오류', desc: '사이트 확인이 3번 연속 실패했을 때' },
];

/** 실시간 상태 알림 — 알림창에 현재 상태를 띄워 두고 소리 없이 갱신 */
function LiveRow({ checked, onChange, example }: { checked: boolean; onChange: (v: boolean) => void; example: string }) {
  return (
    <div>
      <div className="setting">
        <div>
          <b>실시간 상태 알림</b>
          <small>알림창에 {example} 처럼 띄워 두고 바뀔 때마다 소리 없이 갱신해요</small>
        </div>
        <Toggle label="실시간 상태 알림" checked={checked} onChange={onChange} />
      </div>
    </div>
  );
}

/** 앞 인원 알림 지점 고르기 — 예: 5명 전 · 3명 전 · 1명 전(다음 순서) */
function MilestonePicker({ value, onChange }: { value: number[] | null; onChange: (v: number[] | null) => void }) {
  const every = value === null;
  const set = new Set(value ?? []);
  const toggle = (n: number) => {
    const next = new Set(set);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    onChange(next.size ? [...next].sort((a, b) => b - a) : [...DEFAULT_AHEAD_MILESTONES]);
  };
  const summary = every
    ? '앞 인원이 줄어들 때마다 알려요'
    : [...set].sort((a, b) => b - a).map((n) => (n === 1 ? '1명 전(다음 순서)' : `${n}명 전`)).join(' → ') + ' → 지금!';
  return (
    <div className="milestones">
      <span className="ms-label">몇 명 남았을 때 알릴까요?</span>
      <div className="chips" role="group" aria-label="알림 지점">
        {AHEAD_MILESTONE_CHOICES.map((n) => (
          <button key={n} type="button" role="checkbox" aria-checked={!every && set.has(n)} className="chip" onClick={() => toggle(n)}>
            {n}명 전
          </button>
        ))}
        <button type="button" role="checkbox" aria-checked={every} className="chip" onClick={() => onChange(every ? [...DEFAULT_AHEAD_MILESTONES] : null)}>
          매번
        </button>
      </div>
      <small>{summary}</small>
    </div>
  );
}

export function ConditionsEditor({ value, onChange }: { value: QueueConditions; onChange: (v: QueueConditions) => void }) {
  return (
    <div className="settings-list">
      {COND_ITEMS.map((c) => (
        <div key={c.key}>
          <div className="setting">
            <div>
              <b>{c.label}</b>
              <small>{c.desc}</small>
            </div>
            <Toggle label={c.label} checked={value[c.key]} onChange={(v) => onChange({ ...value, [c.key]: v })} />
          </div>
          {c.key === 'ahead' && value.ahead && (
            <MilestonePicker
              value={value.aheadMilestones === undefined ? DEFAULT_AHEAD_MILESTONES : value.aheadMilestones}
              onChange={(aheadMilestones) => onChange({ ...value, aheadMilestones })}
            />
          )}
        </div>
      ))}
      <LiveRow checked={value.live ?? true} onChange={(live) => onChange({ ...value, live })} example="‘나나코어 · 앞에 3명’" />
    </div>
  );
}

const KW_ITEMS: { key: 'appear' | 'disappear' | 'error'; label: string; desc: string }[] = [
  { key: 'appear', label: '키워드 등장', desc: '페이지에 키워드가 새로 나타나면 알려요 (재입고 등)' },
  { key: 'disappear', label: '키워드 사라짐', desc: '있던 키워드가 없어지면 알려요 (품절 해제 등)' },
  { key: 'error', label: '감시 오류', desc: '페이지 확인이 3번 연속 실패했을 때' },
];

export function KeywordConditionsEditor({ value, onChange }: { value: KeywordConditions; onChange: (v: KeywordConditions) => void }) {
  return (
    <div className="settings-list">
      {KW_ITEMS.map((c) => (
        <div key={c.key}>
          <div className="setting">
            <div>
              <b>{c.label}</b>
              <small>{c.desc}</small>
            </div>
            <Toggle label={c.label} checked={value[c.key]} onChange={(v) => onChange({ ...value, [c.key]: v })} />
          </div>
        </div>
      ))}
      <LiveRow checked={value.live ?? false} onChange={(live) => onChange({ ...value, live })} example="‘키워드 없음’" />
    </div>
  );
}

/** 키워드 입력 — 쉼표·엔터로 추가, 칩으로 표시 */
export function KeywordInput({ value, onChange, found }: { value: string[]; onChange: (v: string[]) => void; found?: string[] }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...value, ...parts])].slice(0, 10));
    setDraft('');
  };
  return (
    <div className="kw-input">
      <div className="kw-chips">
        {value.map((k) => (
          <span key={k} className={`kw-chip ${found?.includes(k) ? 'found' : ''}`}>
            {k}
            <button type="button" aria-label={`${k} 삭제`} onClick={() => onChange(value.filter((x) => x !== k))}>
              <X size={14} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => (/[,，]/.test(e.target.value) ? add(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            }
          }}
          onBlur={() => add(draft)}
          placeholder={value.length ? '키워드 더 넣기' : '예: 재입고, 입고 완료'}
          enterKeyHint="done"
          maxLength={50}
        />
      </div>
    </div>
  );
}

export function IntervalPicker({ value, min, onChange }: { value: number; min: number; onChange: (v: number) => void }) {
  return (
    <div className="chips" role="radiogroup" aria-label="확인 주기">
      {INTERVAL_CHOICES.filter((s) => s >= min).map((s) => (
        <button key={s} type="button" role="radio" aria-checked={value === s} className="chip" onClick={() => onChange(s)}>
          {fmtInterval(s)}
        </button>
      ))}
    </div>
  );
}

export function ScheduleEditor({ value, onChange, maxText = '24시간' }: { value: Schedule | null; onChange: (v: Schedule | null) => void; maxText?: string }) {
  return (
    <div className="settings-list">
      <div className="setting">
        <div>
          <b>예약 시간에만 감시</b>
          <small>{value ? '매일 이 시간에만 확인해요 (한국 시간)' : `끄면 지금부터 최대 ${maxText} 감시해요`}</small>
        </div>
        <Toggle label="예약 시간" checked={!!value} onChange={(on) => onChange(on ? { start: '19:00', end: '23:59' } : null)} />
      </div>
      {value && (
        <div className="time-range">
          <label className="field">
            <span>시작</span>
            <input type="time" value={value.start} onChange={(e) => e.target.value && onChange({ ...value, start: e.target.value })} />
          </label>
          <span className="tilde">~</span>
          <label className="field">
            <span>종료</span>
            <input type="time" value={value.end} onChange={(e) => e.target.value && onChange({ ...value, end: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  );
}
