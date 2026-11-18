// 일정 미리 알림 입력 검증 (Cloudflare 전용 모듈 없이 — 테스트용으로 분리)
import { parsePushTarget, type PushTarget } from './push/webpush';

export interface ReminderItem {
  /** 알림 시각 (ms) */
  at: number;
  /** 화면에 붙일 짧은 말 — "내일", "오늘", "1시간 뒤", "지금" */
  label: string;
  important: boolean;
  /** 반복 간격 (매주 = 7일) — 보낸 뒤 이만큼 뒤로 다시 잡음 */
  everyMs?: number;
}

export const WEEK_MS = 7 * 86_400_000;

const MAX_ITEMS = 8;
const MAX_AHEAD = 400 * 86_400_000;

export function parseReminderInput(raw: unknown, now = Date.now()): { push: PushTarget; eventId: string; items: ReminderItem[] } | null {
  const o = raw as { push?: unknown; eventId?: unknown; items?: unknown } | null;
  if (!o) return null;
  const push = parsePushTarget(o.push);
  if (!push) return null;
  if (typeof o.eventId !== 'string' || !/^[\w-]{1,64}$/.test(o.eventId)) return null;
  if (!Array.isArray(o.items) || o.items.length > MAX_ITEMS) return null;
  const items: ReminderItem[] = [];
  for (const it of o.items) {
    const x = it as Partial<ReminderItem>;
    if (typeof x.at !== 'number' || !Number.isFinite(x.at) || typeof x.label !== 'string' || x.label.length > 20) return null;
    if (x.everyMs !== undefined && x.everyMs !== WEEK_MS) return null;
    if (x.at < now - 60_000 || x.at > now + MAX_AHEAD) continue; // 이미 지난 알림은 빼고
    items.push({ at: x.at, label: x.label, important: x.important === true, ...(x.everyMs ? { everyMs: x.everyMs } : {}) });
  }
  items.sort((a, b) => a.at - b.at);
  return { push, eventId: o.eventId, items };
}

