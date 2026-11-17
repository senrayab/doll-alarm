import { describe, expect, it, vi } from 'vitest';
vi.mock('../api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../db/local', () => ({}));
vi.mock('./events', () => ({ emit: vi.fn() }));
import { kstToMs, nextAt, remindTimes, repeatText, upcomingEvents } from './siteEvents';

const WEEK = 7 * 86_400_000;

describe('매주 반복 일정', () => {
  const first = kstToMs('2026-11-04', '21:00'); // 수요일
  it('이번 회차는 지난 주 다음 수요일', () => {
    const now = kstToMs('2026-11-17', '12:00'); // 화요일
    expect(nextAt({ at: first, repeat: 'weekly' }, now)).toBe(kstToMs('2026-11-18', '21:00'));
    expect(nextAt({ at: first }, now)).toBe(first); // 반복 아니면 그대로
    expect(repeatText({ at: first, repeat: 'weekly' })).toBe('매주 수요일');
  });
  it('시작 후 3시간까지는 이번 회차로 남음', () => {
    const now = kstToMs('2026-11-18', '22:30');
    expect(nextAt({ at: first, repeat: 'weekly' }, now)).toBe(kstToMs('2026-11-18', '21:00'));
  });
  it('지난 반복 일정도 목록에 남고, 미리 알림은 지난 건 다음 주로', () => {
    const now = kstToMs('2026-11-18', '20:30'); // 1시간 전 알림(20:00)은 이미 지남
    const ev = { id: 'a', type: '양도데이', at: first, remind: ['dayBefore', 'hour'] as const, repeat: 'weekly' as const };
    expect(upcomingEvents({ events: [{ ...ev, remind: [...ev.remind] }] }, now)[0].at).toBe(kstToMs('2026-11-18', '21:00'));
    const items = remindTimes(kstToMs('2026-11-18', '21:00'), ['dayBefore', 'hour'], true, now);
    expect(items.map((i) => i.at)).toEqual([kstToMs('2026-11-24', '21:00'), kstToMs('2026-11-25', '20:00')]);
    expect(items.every((i) => i.everyMs === WEEK)).toBe(true);
  });
});
