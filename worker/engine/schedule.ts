// 예약 시간 계산 (한국 시간 고정, 서머타임 없음)
import type { Schedule } from '../../shared/types';

const KST_OFFSET_MIN = 9 * 60;
const DAY = 1440;

export function parseHHMM(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function isValidSchedule(s: unknown): s is Schedule {
  if (!s || typeof s !== 'object') return false;
  const o = s as Schedule;
  return typeof o.start === 'string' && typeof o.end === 'string' && parseHHMM(o.start) != null && parseHHMM(o.end) != null;
}

function kstMinuteOfDay(now: number) {
  return (((Math.floor(now / 60000) + KST_OFFSET_MIN) % DAY) + DAY) % DAY;
}

/** 지금 예약 시간 안인지, 아니면 다음 시작 시각 */
export function scheduleWindow(now: number, sched: Schedule | null): { inWindow: boolean; nextStart: number } {
  if (!sched) return { inWindow: true, nextStart: now };
  const s = parseHHMM(sched.start)!;
  const e = parseHHMM(sched.end)!;
  const m = kstMinuteOfDay(now);
  const inWindow = s === e ? true : s < e ? m >= s && m < e : m >= s || m < e;
  const minuteStart = Math.floor(now / 60000) * 60000;
  const delta = (s - m + DAY) % DAY || DAY;
  return { inWindow, nextStart: minuteStart + delta * 60000 };
}
