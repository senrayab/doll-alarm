// 예약 시간 계산 (한국 시간 고정, 서머타임 없음)
// 요일(days): 0=일 1=월 … 6=토. 없거나 비어 있으면 매일.
// 자정을 넘는 시간(22:00~02:00)은 "시작한 요일" 기준 — 목요일 밤에 시작하면 금요일 새벽까지 이어서 봄.
import type { Schedule } from '../../shared/types';

const KST_OFFSET_MS = 9 * 3600 * 1000;

const DAY_MS = 86_400_000;

export function parseHHMM(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function isValidSchedule(s: unknown): s is Schedule {
  if (!s || typeof s !== 'object') return false;
  const o = s as Schedule;
  if (typeof o.start !== 'string' || typeof o.end !== 'string' || parseHHMM(o.start) == null || parseHHMM(o.end) == null) return false;
  if (o.days !== undefined) {
    if (!Array.isArray(o.days) || o.days.length === 0 || o.days.length > 7) return false;
    if (!o.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return false;
    if (new Set(o.days).size !== o.days.length) return false;
  }
  return true;
}

/** 휴방 날짜 목록 ("2026-11-20", 한국 날짜) 검사 */
export function isValidSkipDates(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= 60 && v.every((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
}

/** 한국 시간 기준 오늘 0시(UTC ms), 요일, 0시부터 지난 분 */
function kstParts(now: number) {
  const k = now + KST_OFFSET_MS;
  const midnight = Math.floor(k / DAY_MS) * DAY_MS - KST_OFFSET_MS;
  return { midnight, weekday: new Date(k).getUTCDay(), minute: Math.floor((k % DAY_MS) / 60000) };
}

/**
 * 지금 예약 시간 안인지, 아니면 다음 시작 시각
 * skip: 휴방 날짜 — 그날 시작하는 시간대는 건너뜀 (예약 시간이 없으면 그날 하루 종일 쉼)
 */
export function scheduleWindow(now: number, sched: Schedule | null, skip?: string[] | null): { inWindow: boolean; nextStart: number } {
  if (!sched && !skip?.length) return { inWindow: true, nextStart: now };
  const sc = sched ?? { start: '00:00', end: '00:00' };
  const s = parseHHMM(sc.start)!;
  const e = parseHHMM(sc.end)!;
  const days = sc.days?.length ? sc.days : null;
  const { midnight, weekday, minute: m } = kstParts(now);
  /** 오늘부터 k일 뒤(어제는 -1)가 모니터링하는 날인지 */
  const allowedDay = (k: number) => {
    if (days && !days.includes((((weekday + k) % 7) + 7) % 7)) return false;
    if (skip?.length && skip.includes(new Date(midnight + k * DAY_MS + KST_OFFSET_MS).toISOString().slice(0, 10))) return false;
    return true;
  };

  // 지금 시간대 안인지 + 그 시간대가 시작된 요일
  let inWindow = false;
  let startOffset = 0;
  if (s === e) inWindow = true;
  else if (s < e) inWindow = m >= s && m < e;
  else if (m >= s) inWindow = true;
  else if (m < e) {
    inWindow = true;
    startOffset = -1; // 어젯밤에 시작한 시간대
  }
  if (inWindow && !allowedDay(startOffset)) inWindow = false;

  // 다음 시작 시각: 오늘부터 8일 안에서 허용된 요일의 시작 시각 중 지금 이후 첫 번째
  let nextStart = now + DAY_MS;
  for (let k = 0; k <= 70; k++) {
    const t = midnight + k * DAY_MS + s * 60000;
    if (t > now && allowedDay(k)) {
      nextStart = t;
      break;
    }
  }
  return { inWindow, nextStart };
}

export { daysText, WEEKDAY_KO } from '../../shared/types';
