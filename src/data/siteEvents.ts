// 사이트 일정 (양도데이·이벤트·특별 방송·휴방…) — 내용은 휴대폰에만, 서버에는 미리 알림 시각과 일정 번호만
import { apiFetch } from '../api/client';
import { getSetting, getSite, listSites, listWatchesBySite, putSite, setSetting, type RemindKey, type Site, type SiteEvent } from '../db/local';
import { siteLives } from './sites';
import { updateWatch, watchKind } from './watches';
import { emit } from './events';

export const PRESET_TYPES = ['양도데이', '이벤트', '특별 방송', '휴방', '기타'];

/** 종류별 색 (직접 추가한 종류는 블루) */
const TYPE_TONE: Record<string, string> = { 양도데이: 'pink', 이벤트: 'orange', '특별 방송': 'purple', 휴방: 'gray', 기타: 'mint' };
export const typeTone = (t: string) => TYPE_TONE[t] ?? 'blue';

export const REMIND_OPTIONS: { key: RemindKey; label: string; short: string }[] = [
  { key: 'dayBefore', label: '전날 밤 9시', short: '내일' },
  { key: 'morning', label: '당일 아침 9시', short: '오늘' },
  { key: 'hour', label: '1시간 전', short: '1시간 뒤' },
  { key: 'start', label: '시작 시각', short: '지금' },
];
export const DEFAULT_REMIND: RemindKey[] = ['dayBefore', 'hour'];

// ---------- 한국 시간 ----------

const KST = 9 * 3600 * 1000;
const DAY = 86_400_000;

/** "2026-11-20" + "21:00" (한국 시간) → ms */
export function kstToMs(date: string, time: string) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - KST;
}
export function msToKst(at: number) {
  const k = new Date(at + KST).toISOString();
  return { date: k.slice(0, 10), time: k.slice(11, 16) };
}
const kstDay = (t: number) => Math.floor((t + KST) / DAY);
const WEEK = 7 * DAY;
/** 시작 후 3시간까지는 "진행 중" */
const LIVE_FOR = 3 * 3600 * 1000;

/** 반복 일정의 이번(다음) 회차 시작 시각 */
export function nextAt(ev: Pick<SiteEvent, 'at' | 'repeat'>, now = Date.now()) {
  if (ev.repeat !== 'weekly' || ev.at > now - LIVE_FOR) return ev.at;
  return ev.at + Math.ceil((now - LIVE_FOR - ev.at) / WEEK) * WEEK;
}

/** "매주 수요일" */
export function repeatText(ev: Pick<SiteEvent, 'at' | 'repeat'>) {
  if (ev.repeat !== 'weekly') return '';
  return `매주 ${new Date(ev.at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'long' })}`;
}

/** "11월 20일 (목) 21:00" */
export function fmtEventTime(at: number) {
  return new Date(at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** 홈 배지용 — "오늘 21:00", "내일", "D-3" */
export function ddayText(at: number, now = Date.now()) {
  const diff = kstDay(at) - kstDay(now);
  if (diff === 0) return `오늘 ${msToKst(at).time}`;
  if (diff === 1) return '내일';
  return `D-${diff}`;
}

/** 미리 알림 시각 */
export function remindTimes(at: number, keys: RemindKey[], weekly = false, now = Date.now()) {
  const dayStart = kstDay(at) * DAY - KST; // 그날 0시(한국)
  const map: Record<RemindKey, number> = {
    dayBefore: dayStart - 3 * 3600 * 1000, // 전날 21:00
    morning: dayStart + 9 * 3600 * 1000, // 당일 09:00
    hour: at - 3600 * 1000,
    start: at,
  };
  return REMIND_OPTIONS.filter((o) => keys.includes(o.key))
    .map((o) => ({ at: map[o.key], label: o.short, important: o.key === 'hour' || o.key === 'start' }))
    .filter((r) => r.at < at || r.label === '지금')
    .map((r) => {
      if (!weekly) return { ...r, everyMs: undefined as number | undefined };
      // 매주: 이번 주 알림 시각이 지났으면 다음 주로, 서버가 보낸 뒤 계속 다음 주로 다시 잡음
      let t = r.at;
      while (t <= now) t += WEEK;
      return { ...r, at: t, everyMs: WEEK };
    })
    .filter((r) => r.at > now);
}

// ---------- 목록 ----------

/** 지나지 않은 일정 (시작 후 3시간까지는 "진행 중"으로 남김) */
export function upcomingEvents(site: Pick<Site, 'events'>, now = Date.now()) {
  // 반복 일정은 이번 회차로 바꿔서
  return (site.events ?? [])
    .map((e) => ({ ...e, at: nextAt(e, now) }))
    .filter((e) => e.at > now - LIVE_FOR)
    .sort((a, b) => a.at - b.at);
}
export function pastEvents(site: Pick<Site, 'events'>, now = Date.now()) {
  return [...(site.events ?? [])].filter((e) => e.repeat !== 'weekly' && e.at <= now - LIVE_FOR).sort((a, b) => b.at - a.at);
}

// ---------- 채널 ----------

/** 일정의 채널 번호들 (비어 있으면 전체) — 예전 liveIndex 도 읽음 */
export function eventChannels(ev: Pick<SiteEvent, 'channels' | 'liveIndex'>): number[] {
  if (ev.channels) return [...ev.channels].sort((a, b) => a - b);
  return ev.liveIndex != null ? [ev.liveIndex] : [];
}

/** 화면에 붙일 채널 이름 — "1호점", "1·3호점", 전체면 '' (채널이 하나뿐인 사이트도 '') */
export function channelLabel(site: Pick<Site, 'lives' | 'liveUrl'>, ev: Pick<SiteEvent, 'channels' | 'liveIndex'>, allText = '') {
  const lives = siteLives(site as Site);
  const ch = eventChannels(ev).filter((i) => lives[i]);
  if (lives.length <= 1 || !ch.length || ch.length >= lives.length) return allText;
  const names = ch.map((i) => lives[i].name);
  // "1호점, 3호점" → "1·3호점" (숫자 + 같은 꼬리말일 때)
  const m = names.map((n) => /^(\d+)(\D+)$/.exec(n));
  if (names.length > 1 && m.every((x) => x && x[2] === m[0]![2])) return `${m.map((x) => x![1]).join('·')}${m[0]![2]}`;
  return names.join('·');
}

// ---------- 휴방 → 대기 순번 모니터링 쉬기 ----------

export const HOLIDAY = '휴방';

/**
 * 이 휴방이 이 대기열을 쉬게 하는지
 * - 채널을 지정하지 않은 휴방, 채널이 하나뿐인 사이트 → 사이트의 모든 대기열
 * - 채널을 지정한 휴방 → 같은 채널로 지정한 대기열만 (채널을 정하지 않은 대기열은 다른 채널 것일 수 있어 그대로)
 */
export function holidayPausesMonitoring(
  site: Pick<Site, 'lives' | 'liveUrl'>,
  ev: Pick<SiteEvent, 'type' | 'liveIndex' | 'channels'>,
  channel: number | null = null,
) {
  if (ev.type !== HOLIDAY) return false;
  const ch = eventChannels(ev);
  const lives = siteLives(site as Site).length;
  if (!ch.length || lives <= 1 || ch.length >= lives) return true;
  return channel != null && ch.includes(channel);
}

/** 대기열 하나가 쉬는 휴방 날짜 (한국 날짜, 오늘부터 — 매주 반복은 앞으로 8주) */
export function holidayDates(site: Site, channel: number | null = null, now = Date.now()) {
  const today = msToKst(now).date;
  const out = new Set<string>();
  for (const ev of site.events ?? []) {
    if (!holidayPausesMonitoring(site, ev, channel)) continue;
    const first = nextAt(ev, now);
    const times = ev.repeat === 'weekly' ? Array.from({ length: 8 }, (_, i) => first + i * WEEK) : [ev.at];
    for (const t of times) {
      const d = msToKst(t).date;
      if (d >= today) out.add(d);
    }
  }
  return [...out].sort().slice(0, 60);
}

/** 사이트의 대기 순번 모니터링에 휴방 날짜를 알려 줌 (바뀐 것만) */
export async function syncHolidays(siteId: string) {
  const site = await getSite(siteId);
  if (!site) return;
  for (const w of await listWatchesBySite(siteId)) {
    if (w.lost || !w.view || watchKind(w) !== 'queue') continue;
    const dates = holidayDates(site, w.liveIndex ?? null);
    const cur = (w.view.skipDates ?? []).filter((d) => d >= msToKst(Date.now()).date);
    if (JSON.stringify(cur) === JSON.stringify(dates)) continue;
    await updateWatch(w, { skipDates: dates }).catch(() => {});
  }
}

export async function syncAllHolidays() {
  for (const s of await listSites()) await syncHolidays(s.id);
}

// ---------- 직접 추가한 종류 ----------

export async function customTypes(): Promise<string[]> {
  return (await getSetting<string[]>('eventTypes')) ?? [];
}
export async function addCustomType(name: string) {
  const n = name.trim().slice(0, 10);
  if (!n || PRESET_TYPES.includes(n)) return;
  const cur = await customTypes();
  if (!cur.includes(n)) await setSetting('eventTypes', [...cur, n]);
}

// ---------- 서버 미리 알림 ----------

async function syncReminder(ev: SiteEvent, sub: PushSubscription | null): Promise<SiteEvent> {
  const items = remindTimes(nextAt(ev), ev.remind, ev.repeat === 'weekly');
  const headers = (token?: string) => {
    const h = new Headers({ 'Content-Type': 'application/json' });
    if (token) h.set('X-Job-Token', token);
    return h;
  };
  // 보낼 알림이 없거나 알림이 꺼져 있으면 서버 작업 지움
  if (!items.length || !sub) {
    if (ev.reminder) await apiFetch(`/api/reminders/${ev.reminder.id}`, { method: 'DELETE', headers: headers(ev.reminder.token) }).catch(() => {});
    return { ...ev, reminder: undefined };
  }
  const body = JSON.stringify({ push: sub.toJSON(), eventId: ev.id, items });
  if (ev.reminder) {
    const res = await apiFetch(`/api/reminders/${ev.reminder.id}`, { method: 'PUT', headers: headers(ev.reminder.token), body });
    if (res.ok) return ev;
  }
  const res = await apiFetch('/api/reminders', { method: 'POST', headers: headers(), body });
  const data = (await res.json().catch(() => ({}))) as { id?: string; token?: string; error?: string };
  if (!res.ok || !data.id || !data.token) throw new Error(`미리 알림 등록 실패 (${data.error ?? res.status})`);
  return { ...ev, reminder: { id: data.id, token: data.token } };
}

export async function saveEvent(siteId: string, ev: SiteEvent, sub: PushSubscription | null) {
  const synced = await syncReminder(ev, sub);
  const site = await getSite(siteId);
  if (!site) throw new Error('사이트를 찾을 수 없어요.');
  const events = [...(site.events ?? []).filter((e) => e.id !== ev.id), synced];
  await putSite({ ...site, events });
  emit('sites');
  await syncHolidays(siteId);
  return synced;
}

export async function deleteEvent(siteId: string, ev: SiteEvent) {
  if (ev.reminder) {
    await apiFetch(`/api/reminders/${ev.reminder.id}`, { method: 'DELETE', headers: new Headers({ 'X-Job-Token': ev.reminder.token }) }).catch(() => {});
  }
  const site = await getSite(siteId);
  if (!site) return;
  await putSite({ ...site, events: (site.events ?? []).filter((e) => e.id !== ev.id) });
  emit('sites');
  await syncHolidays(siteId);
}

/** 사이트 삭제 시 그 사이트 일정의 서버 알림도 정리 */
export async function clearSiteReminders(site: Site) {
  for (const ev of site.events ?? []) {
    if (ev.reminder) {
      await apiFetch(`/api/reminders/${ev.reminder.id}`, { method: 'DELETE', headers: new Headers({ 'X-Job-Token': ev.reminder.token }) }).catch(() => {});
    }
  }
}

/** 알림 구독이 바뀌면 모든 일정 알림도 새 구독으로 */
export async function resyncAllReminders(sub: PushSubscription) {
  for (const site of await listSites()) {
    for (const ev of upcomingEvents(site)) await saveEvent(site.id, ev, sub).catch(() => {});
  }
}
