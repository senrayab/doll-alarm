// 일정 미리 알림 — 일정 하나 = Durable Object 하나
// 서버에는 알림 시각과 일정 번호만 있음 (일정 이름·메모·사이트는 휴대폰에만).
// 정해진 시각에 깨어나 푸시를 보내고, 휴대폰의 서비스 워커가 일정 번호로 내용을 채워 보여 줌.
import { DurableObject } from 'cloudflare:workers';
import { sendWebPush, type PushTarget } from './push/webpush';
import { parseReminderInput, type ReminderItem } from './reminder-input';
import { sha256hex } from './watch-do';

interface State {
  push: PushTarget;
  tokenHash: string;
  eventId: string;
  items: ReminderItem[];
}

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

export class ReminderJob extends DurableObject<Env> {
  private async load() {
    return this.ctx.storage.get<State>('state');
  }

  private async arm(s: State) {
    if (!s.items.length) {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ctx.storage.setAlarm(s.items[0].at);
  }

  /** 만들기·바꾸기 (같은 토큰이어야 바꿀 수 있음) */
  async put(token: string, raw: unknown): Promise<Result<{ count: number }>> {
    const input = parseReminderInput(raw);
    if (!input) return fail(400, 'invalid_reminder');
    const cur = await this.load();
    const tokenHash = await sha256hex(token);
    if (cur && cur.tokenHash !== tokenHash) return fail(404, 'not_found');
    const s: State = { ...input, tokenHash };
    await this.ctx.storage.put('state', s);
    await this.arm(s);
    return { ok: true, value: { count: s.items.length } };
  }

  async remove(token: string): Promise<Result<null>> {
    const cur = await this.load();
    if (cur && cur.tokenHash !== (await sha256hex(token))) return fail(404, 'not_found');
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    return { ok: true, value: null };
  }

  async alarm() {
    const s = await this.load();
    if (!s) return;
    const now = Date.now();
    const due = s.items.filter((i) => i.at <= now + 30_000);
    s.items = s.items.filter((i) => i.at > now + 30_000);
    // 같은 때 여러 개가 겹치면 가장 가까운 것 하나만 (예: 하루 미뤄진 경우)
    const last = due[due.length - 1];
    if (last) {
      const r = await sendWebPush(
        s.push,
        {
          kind: 'reminder',
          eventId: s.eventId,
          label: last.label,
          important: last.important,
          tag: `event-${s.eventId}`,
          // 휴대폰에서 일정을 못 찾으면 이 문구로
          title: '일정 알림',
          body: `${last.label} 일정이 있어요.`,
          url: '/',
          at: now,
        },
        { publicKey: this.env.VAPID_PUBLIC_KEY, privateKey: this.env.VAPID_PRIVATE_KEY, subject: this.env.VAPID_SUBJECT },
        { ttl: 1800, urgency: 'high' },
      ).catch(() => null);
      if (r?.gone) s.items = []; // 휴대폰 알림 연결이 사라짐 → 정리
    }
    await this.ctx.storage.put('state', s);
    await this.arm(s);
  }
}
