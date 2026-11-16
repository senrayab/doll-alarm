// 감시 조건·주기·예약 편집 (등록 화면과 상세 화면에서 같이 사용)
import type { QueueConditions, Schedule } from '../../shared/types';
import { INTERVAL_CHOICES } from '../../shared/types';
import { fmtInterval, Toggle } from './parts';

const COND_ITEMS: { key: keyof Omit<QueueConditions, 'aheadAtMost'>; label: string; desc: string }[] = [
  { key: 'turn', label: '내 차례 도달', desc: '진행 중으로 바뀌면 바로 알려요' },
  { key: 'ahead', label: '내 앞 인원 감소', desc: '“내 앞에 3명 남았습니다”' },
  { key: 'position', label: '대기 순번 변경', desc: '중간에 끼워넣기 등으로 번호가 바뀔 때' },
  { key: 'gone', label: '대기열에서 사라짐', desc: '명단에서 내 이름이 없어졌을 때' },
  { key: 'error', label: '감시 오류', desc: '사이트 확인이 3번 연속 실패했을 때' },
];

export function ConditionsEditor({ value, onChange }: { value: QueueConditions; onChange: (v: QueueConditions) => void }) {
  return (
    <div className="settings-list">
      {COND_ITEMS.map((c) => (
        <div key={c.key} className="setting">
          <div>
            <b>{c.label}</b>
            <small>{c.desc}</small>
          </div>
          <Toggle label={c.label} checked={value[c.key]} onChange={(v) => onChange({ ...value, [c.key]: v })} />
        </div>
      ))}
      {value.ahead && (
        <label className="field inline">
          <span>앞 인원 알림 시작</span>
          <select
            value={value.aheadAtMost ?? ''}
            onChange={(e) => onChange({ ...value, aheadAtMost: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">줄어들 때마다</option>
            {[1, 2, 3, 5, 10, 20].map((n) => (
              <option key={n} value={n}>
                {n}명 이하부터
              </option>
            ))}
          </select>
        </label>
      )}
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

export function ScheduleEditor({ value, onChange }: { value: Schedule | null; onChange: (v: Schedule | null) => void }) {
  return (
    <div className="settings-list">
      <div className="setting">
        <div>
          <b>예약 시간에만 감시</b>
          <small>{value ? '매일 이 시간에만 확인해요 (한국 시간)' : '끄면 지금부터 최대 24시간 감시해요'}</small>
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
