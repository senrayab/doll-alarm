import { describe, expect, it } from 'vitest';
import { b64uEncode } from './push/webpush';
import { parseReminderInput } from './reminder-input';

const push = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: b64uEncode(new Uint8Array([4, ...new Uint8Array(64)])), auth: b64uEncode(new Uint8Array(16)) } };
const now = Date.UTC(2026, 10, 17, 3, 0);

describe('일정 알림 입력', () => {
  it('지난 알림은 빼고 시각 순으로', () => {
    const r = parseReminderInput(
      { push, eventId: 'ev-1', items: [{ at: now + 7_200_000, label: '1시간 뒤', important: true }, { at: now - 3_600_000, label: '내일' }, { at: now + 3_600_000, label: '내일' }] },
      now,
    )!;
    expect(r.items.map((i) => i.label)).toEqual(['내일', '1시간 뒤']);
  });
  it('서버에는 일정 번호와 시각만 — 이상한 값은 거부', () => {
    expect(parseReminderInput({ push, eventId: '../x', items: [] }, now)).toBeNull();
    expect(parseReminderInput({ push: { endpoint: 'https://evil.example.com' }, eventId: 'a', items: [] }, now)).toBeNull();
    expect(parseReminderInput({ push, eventId: 'a', items: Array(9).fill({ at: now + 1000, label: 'x' }) }, now)).toBeNull();
    expect(parseReminderInput({ push, eventId: 'a', items: [{ at: now + 1000, label: '아주 긴 문구가 들어가면 거부해야 하는 경우입니다' }] }, now)).toBeNull();
  });
});
