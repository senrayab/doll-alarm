// 대기열 채널 고르기 (사이트 라이브가 둘 이상일 때)
import type { LiveChannel } from '../db/local';

export function ChannelPicker({ lives, value, onChange }: { lives: LiveChannel[]; value: number | null; onChange: (v: number | null) => void }) {
  if (lives.length < 2) return null;
  return (
    <div className="field">
      <span>채널</span>
      <div className="chips">
        {lives.map((l, i) => (
          <button key={i} type="button" role="radio" aria-checked={value === i} className="chip" onClick={() => onChange(i)}>
            {l.name}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={value === null} className="chip" onClick={() => onChange(null)}>
          지정 안 함
        </button>
      </div>
      <small>채널을 정하면 그 채널의 휴방 일정에 맞춰 쉬어요.</small>
    </div>
  );
}
