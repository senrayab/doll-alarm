import { describe, expect, it, vi } from 'vitest';
vi.mock('../api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../db/local', () => ({}));
vi.mock('./events', () => ({ emit: vi.fn() }));
vi.mock('./sites', () => ({ siteLives: (s: { lives?: unknown[] }) => s.lives ?? [] }));
vi.mock('./watches', () => ({ updateWatch: vi.fn(), watchKind: vi.fn() }));
import { channelLabel, holidayDates, kstToMs, nextAt, remindTimes, repeatText, upcomingEvents } from './siteEvents';

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

describe('하루 종일 일정', () => {
  it('그날 끝까지 목록에 남고, 미리 알림은 전날 밤·당일 아침만', () => {
    const at = kstToMs('2026-11-20', '00:00');
    const ev = { id: 'd', type: '이벤트', at, allDay: true, remind: ['dayBefore', 'morning', 'hour', 'start'] as const };
    expect(upcomingEvents({ events: [{ ...ev, remind: [...ev.remind] }] }, kstToMs('2026-11-20', '22:00'))).toHaveLength(1);
    expect(upcomingEvents({ events: [{ ...ev, remind: [...ev.remind] }] }, kstToMs('2026-11-21', '00:30'))).toHaveLength(0);
    const items = remindTimes(at, [...ev.remind], false, kstToMs('2026-11-18', '12:00'), true);
    expect(items.map((i) => i.at)).toEqual([kstToMs('2026-11-19', '21:00'), kstToMs('2026-11-20', '09:00')]);
  });
});

describe('휴방 → 모니터링 쉬는 날짜', () => {
  const now = kstToMs('2026-11-17', '12:00');
  const base = { id: 's', name: 'x', url: '', enabled: true, createdAt: 0 } as never;
  const ev = (o: object) => ({ id: Math.random().toString(), type: '휴방', at: kstToMs('2026-11-20', '19:00'), remind: [], ...o });
  it('한 번 휴방과 매주 휴방(8주)', () => {
    expect(holidayDates({ ...(base as object), events: [ev({})] } as never, null, now)).toEqual(['2026-11-20']);
    const weekly = holidayDates({ ...(base as object), events: [ev({ repeat: 'weekly' })] } as never, null, now);
    expect(weekly).toHaveLength(8);
    expect(weekly[1]).toBe('2026-11-27');
  });
  it('채널 지정 휴방은 같은 채널 대기열만, 채널 없는 휴방은 모든 대기열, 휴방이 아니면 제외', () => {
    const lives = [{ name: '1호점', url: 'a' }, { name: '2호점', url: 'b' }];
    const site = { ...(base as object), lives, events: [ev({ liveIndex: 0 })] } as never;
    expect(holidayDates(site, 0, now)).toEqual(['2026-11-20']); // 1호점 대기열
    expect(holidayDates(site, 1, now)).toEqual([]); // 2호점 대기열
    expect(holidayDates(site, null, now)).toEqual([]); // 채널을 정하지 않은 대기열
    expect(holidayDates({ ...(base as object), lives, events: [ev({ liveIndex: null })] } as never, 1, now)).toEqual(['2026-11-20']);
    expect(holidayDates({ ...(base as object), events: [ev({ type: '양도데이' })] } as never, null, now)).toEqual([]);
  });
  it('채널 여러 개 휴방: 고른 채널 대기열만, 모두 고르면 전체', () => {
    const lives = [1, 2, 3, 4].map((n) => ({ name: `${n}호점`, url: String(n) }));
    const site = { ...(base as object), lives, events: [ev({ channels: [0, 2] })] } as never;
    expect(holidayDates(site, 0, now)).toEqual(['2026-11-20']);
    expect(holidayDates(site, 2, now)).toEqual(['2026-11-20']);
    expect(holidayDates(site, 1, now)).toEqual([]);
    expect(holidayDates({ ...(base as object), lives, events: [ev({ channels: [0, 1, 2, 3] })] } as never, null, now)).toEqual(['2026-11-20']);
    expect(channelLabel({ lives }, { channels: [0, 2] })).toBe('1·3호점');
    expect(channelLabel({ lives }, { channels: [] }, '전체')).toBe('전체');
    expect(channelLabel({ lives }, { liveIndex: 3 })).toBe('4호점');
  });
});
