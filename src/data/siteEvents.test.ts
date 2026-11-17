import { describe, expect, it, vi } from 'vitest';
vi.mock('../api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../db/local', () => ({}));
vi.mock('./events', () => ({ emit: vi.fn() }));
vi.mock('./sites', () => ({ siteLives: (s: { lives?: unknown[] }) => s.lives ?? [] }));
vi.mock('./watches', () => ({ updateWatch: vi.fn(), watchKind: vi.fn() }));
import { holidayDates, kstToMs, nextAt, remindTimes, repeatText, upcomingEvents } from './siteEvents';

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

describe('휴방 → 모니터링 쉬는 날짜', () => {
  const now = kstToMs('2026-11-17', '12:00');
  const base = { id: 's', name: 'x', url: '', enabled: true, createdAt: 0 } as never;
  const ev = (o: object) => ({ id: Math.random().toString(), type: '휴방', at: kstToMs('2026-11-20', '19:00'), remind: [], ...o });
  it('한 번 휴방과 매주 휴방(8주)', () => {
    expect(holidayDates({ ...(base as object), events: [ev({})] } as never, now)).toEqual(['2026-11-20']);
    const weekly = holidayDates({ ...(base as object), events: [ev({ repeat: 'weekly' })] } as never, now);
    expect(weekly).toHaveLength(8);
    expect(weekly[1]).toBe('2026-11-27');
  });
  it('채널이 여럿인 사이트에서 한 채널만 휴방이면 쉬지 않음, 휴방이 아니면 제외', () => {
    const lives = [{ name: '1호점', url: 'a' }, { name: '2호점', url: 'b' }];
    expect(holidayDates({ ...(base as object), lives, events: [ev({ liveIndex: 0 })] } as never, now)).toEqual([]);
    expect(holidayDates({ ...(base as object), lives, events: [ev({ liveIndex: null })] } as never, now)).toEqual(['2026-11-20']);
    expect(holidayDates({ ...(base as object), events: [ev({ type: '양도데이' })] } as never, now)).toEqual([]);
  });
});
