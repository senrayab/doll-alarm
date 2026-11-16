// 감시 작업 1개 = Durable Object 1개
// alarm 으로 정해진 주기마다 스스로 깨어나 확인 → 알림. 삭제하면 저장소까지 전부 지움.
import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_KEYWORD_CONDITIONS, DEFAULT_QUEUE_CONDITIONS, INTERVAL_CHOICES, type AnyConditions, type JobView, type KeywordConditions, type QueueConditions, type Schedule } from '../shared/types';
import { runCheck, type JobState, type PushMessage } from './engine/run';
import { isValidSchedule, scheduleWindow } from './engine/schedule';
import { getModule } from './modules/registry';
import { parsePushTarget, sendWebPush, type PushTarget } from './push/webpush';

const STATE = 'state';

export async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new Uint8Array(new TextEncoder().encode(s)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseConditions(raw: unknown): QueueConditions | null {
  if (raw == null) return { ...DEFAULT_QUEUE_CONDITIONS };
  if (typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const c = { ...DEFAULT_QUEUE_CONDITIONS };
  for (const k of ['position', 'ahead', 'turn', 'gone', 'error'] as const) {
    if (o[k] !== undefined) {
      if (typeof o[k] !== 'boolean') return null;
      c[k] = o[k];
    }
  }
  if (o.aheadMilestones !== undefined) {
    const m = o.aheadMilestones;
    if (m === null) c.aheadMilestones = null;
    else if (Array.isArray(m) && m.length <= 10 && m.every((n) => Number.isInteger(n) && n >= 0 && n <= 999)) {
      c.aheadMilestones = [...new Set(m as number[])].sort((a, b) => b - a);
    } else return null;
  }
  return c;
}

export function parseKeywordConditions(raw: unknown): KeywordConditions | null {
  if (raw == null) return { ...DEFAULT_KEYWORD_CONDITIONS };
  if (typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const c = { ...DEFAULT_KEYWORD_CONDITIONS };
  for (const k of ['appear', 'disappear', 'error'] as const) {
    if (o[k] !== undefined) {
      if (typeof o[k] !== 'boolean') return null;
      c[k] = o[k];
    }
  }
  return c;
}

/** 모듈 종류에 맞는 알림 조건 검증 */
function conditionsFor(kind: 'queue' | 'keyword', raw: unknown): AnyConditions | null {
  return kind === 'keyword' ? parseKeywordConditions(raw) : parseConditions(raw);
}

export interface CreateInput {
  moduleId: string;
  params: unknown;
  conditions?: unknown;
  intervalSec: number;
  schedule?: unknown;
  push: unknown;
  running?: boolean;
}

export interface PatchInput {
  running?: boolean;
  conditions?: unknown;
  intervalSec?: number;
  schedule?: unknown;
  push?: unknown;
}

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

function validInterval(sec: unknown, min: number): sec is number {
  return typeof sec === 'number' && (INTERVAL_CHOICES as readonly number[]).includes(sec) && sec >= min;
}

export class WatchJob extends DurableObject<Env> {
  private async load() {
    return this.ctx.storage.get<JobState>(STATE);
  }

  private async save(s: JobState) {
    await this.ctx.storage.put(STATE, s);
  }

  private async authorized(token: string): Promise<JobState | null> {
    const s = await this.load();
    if (!s || !token) return null;
    return (await sha256hex(token)) === s.tokenHash ? s : null;
  }

  private view(s: JobState, nextCheckAt: number | null): JobView {
    return {
      moduleId: s.moduleId,
      running: s.running,
      intervalSec: s.intervalSec,
      schedule: s.schedule,
      conditions: s.conditions,
      inWindow: scheduleWindow(Date.now(), s.schedule).inWindow,
      nextCheckAt,
      lastCheckedAt: s.lastCheckedAt,
      lastOkAt: s.lastOkAt,
      last: s.last,
      lastError: s.lastError,
      consecutiveErrors: s.consecutiveErrors,
      history: s.history,
    };
  }

  /** 다음 확인 시각 설정 (예약 시간 밖이면 다음 시작 시각) */
  private async arm(s: JobState, immediate = false) {
    if (!s.running) {
      await this.ctx.storage.deleteAlarm();
      return null;
    }
    const now = Date.now();
    const w = scheduleWindow(now, s.schedule);
    const at = w.inWindow ? now + (immediate ? 0 : s.intervalSec * 1000) : w.nextStart;
    await this.ctx.storage.setAlarm(at);
    return at;
  }

  async create(input: CreateInput, token: string): Promise<Result<JobView>> {
    if (await this.load()) return fail(409, 'exists');
    const mod = getModule(input.moduleId);
    if (!mod) return fail(400, 'unknown_module');
    const params = mod.parseParams(input.params);
    if (!params) return fail(400, 'invalid_params');
    const conditions = conditionsFor(mod.kind, input.conditions);
    if (!conditions) return fail(400, 'invalid_conditions');
    if (!validInterval(input.intervalSec, mod.minIntervalSec)) return fail(400, 'invalid_interval');
    if (input.schedule != null && !isValidSchedule(input.schedule)) return fail(400, 'invalid_schedule');
    const push = parsePushTarget(input.push);
    if (!push) return fail(400, 'invalid_subscription');

    const now = Date.now();
    const running = input.running !== false;
    const s: JobState = {
      v: 1,
      rev: 0,
      moduleId: mod.id,
      params,
      conditions,
      intervalSec: input.intervalSec,
      schedule: (input.schedule as Schedule | undefined) ?? null,
      push,
      tokenHash: await sha256hex(token),
      createdAt: now,
      running,
      startedAt: running ? now : null,
      checks: 0,
      lastCheckedAt: null,
      lastOkAt: null,
      last: null,
      consecutiveErrors: 0,
      errorNotified: false,
      lastError: null,
      history: [],
    };
    await this.save(s);
    const next = await this.arm(s, true); // 등록 즉시 첫 확인
    return { ok: true, value: this.view(s, next) };
  }

  async getView(token: string): Promise<Result<JobView>> {
    const s = await this.authorized(token);
    if (!s) return fail(404, 'not_found');
    const alarm = await this.ctx.storage.getAlarm();
    return { ok: true, value: this.view(s, alarm) };
  }

  async update(token: string, patch: PatchInput): Promise<Result<JobView>> {
    const s = await this.authorized(token);
    if (!s) return fail(404, 'not_found');
    const mod = getModule(s.moduleId)!;
    let restart = false;

    if (patch.conditions !== undefined) {
      const c = conditionsFor(mod.kind, patch.conditions);
      if (!c) return fail(400, 'invalid_conditions');
      s.conditions = c;
    }
    if (patch.intervalSec !== undefined) {
      if (!validInterval(patch.intervalSec, mod.minIntervalSec)) return fail(400, 'invalid_interval');
      s.intervalSec = patch.intervalSec;
    }
    if (patch.schedule !== undefined) {
      if (patch.schedule !== null && !isValidSchedule(patch.schedule)) return fail(400, 'invalid_schedule');
      s.schedule = patch.schedule as Schedule | null;
    }
    if (patch.push !== undefined) {
      const p = parsePushTarget(patch.push);
      if (!p) return fail(400, 'invalid_subscription');
      s.push = p;
    }
    if (patch.running !== undefined && patch.running !== s.running) {
      s.running = patch.running;
      if (s.running) {
        // 다시 시작: 처음부터 새로 비교
        s.startedAt = Date.now();
        s.checks = 0;
        s.last = null;
        s.consecutiveErrors = 0;
        s.errorNotified = false;
        restart = true;
      }
    }
    s.rev += 1;
    await this.save(s);
    const next = await this.arm(s, restart);
    return { ok: true, value: this.view(s, next) };
  }

  async remove(token: string): Promise<Result<null>> {
    const s = await this.authorized(token);
    if (!s) return fail(404, 'not_found');
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    return { ok: true, value: null };
  }

  /** 지금 바로 한 번 확인 (테스트용) */
  async checkNow(token: string): Promise<Result<JobView>> {
    const s = await this.authorized(token);
    if (!s) return fail(404, 'not_found');
    if (!s.running) return fail(409, 'not_running');
    await this.ctx.storage.setAlarm(Date.now());
    return { ok: true, value: this.view(s, Date.now()) };
  }

  async alarm() {
    const s = await this.load();
    if (!s || !s.running) return;

    const w = scheduleWindow(Date.now(), s.schedule);
    if (!w.inWindow) {
      await this.ctx.storage.setAlarm(w.nextStart);
      return;
    }

    const mod = getModule(s.moduleId);
    if (!mod) return;
    const storage = this.ctx.storage;
    const env = this.env;
    const push: PushTarget = s.push;
    const jobId = this.ctx.id.toString();
    const tag = `job-${jobId.slice(0, 12)}`;

    const { state, subscriptionGone } = await runCheck(s, {
      module: mod,
      now: Date.now(),
      ctx: {
        fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
        cacheGet: (k) => storage.get(`cache:${k}`),
        cachePut: (k, v) => storage.put(`cache:${k}`, v),
      },
      async sendPush(msg: PushMessage) {
        const r = await sendWebPush(
          push,
          { title: msg.title, body: msg.body, tag, url: `/watch/${jobId}`, jobId, siteName: mod.name, important: msg.important, type: msg.type, at: Date.now() },
          { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT },
          { ttl: msg.important ? 600 : 300, urgency: 'high' },
        );
        return { status: r.status, gone: r.gone };
      },
    });

    if (subscriptionGone) {
      // 휴대폰에서 알림 구독이 사라짐 → 더 보낼 곳이 없으니 작업 삭제
      await storage.deleteAlarm();
      await storage.deleteAll();
      return;
    }
    // 확인하는 동안(외부 요청 대기 중) 앱에서 중지·삭제·설정 변경이 들어왔을 수 있음
    const latest = await this.load();
    if (!latest) return;
    if (latest.rev !== s.rev) {
      await this.arm(latest);
      return;
    }
    await this.save(state);
    await this.arm(state);
  }
}
