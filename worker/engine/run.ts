// 모니터링 1회 실행: 데이터 확인 → 비교 → 알림 → 상태 갱신
// Durable Object 와 분리된 순수 로직이라 단위 테스트 가능
import {
  isKeywordSnapshot,
  isQueueSnapshot,
  type AnyConditions,
  type AnySnapshot,
  type HistoryItem,
  type KeywordConditions,
  type KeywordSnapshot,
  type QueueConditions,
  type QueueSnapshot,
  type Schedule,
  type WatchEvent,
} from '../../shared/types';
import type { PushTarget } from '../push/webpush';
import { evaluate, evaluateKeyword, mergeForPush } from './evaluate';
import { ModuleError, type ModuleContext, type SiteModule } from './types';

export const ERROR_NOTIFY_AFTER = 3;
export const MAX_RUN_MS = 24 * 3600 * 1000; // 예약 없이 켜 둔 대기열 모니터링은 24시간 뒤 자동 중지
export const MAX_RUN_KEYWORD_MS = 7 * 24 * 3600 * 1000; // 키워드(재입고 등)는 7일
const HISTORY_MAX = 30;

export interface JobState {
  v: 1;
  /** 앱에서 설정을 바꿀 때마다 +1 — 확인 도중 바뀌었으면 결과로 덮어쓰지 않음 */
  rev: number;
  moduleId: string;
  params: unknown;
  conditions: AnyConditions;
  intervalSec: number;
  schedule: Schedule | null;
  push: PushTarget;
  tokenHash: string;
  createdAt: number;
  running: boolean;
  startedAt: number | null;
  checks: number;
  lastCheckedAt: number | null;
  lastOkAt: number | null;
  last: AnySnapshot | null;
  consecutiveErrors: number;
  errorNotified: boolean;
  /** 예약 시간 밖이어도 다음 한 번은 확인 ("지금 확인" 버튼) */
  forceOnce?: boolean;
  lastError: string | null;
  history: HistoryItem[];
}

export interface PushMessage {
  title: string;
  body: string;
  important: boolean;
  type: WatchEvent['type'];
}

export interface RunDeps {
  module: SiteModule;
  ctx: Omit<ModuleContext, 'checkIndex' | 'now'>;
  now: number;
  /** 알림 발송 → HTTP 상태 (발송 못 하면 null) */
  sendPush(msg: PushMessage): Promise<{ status: number; gone: boolean } | null>;
}

export interface RunOutcome {
  state: JobState;
  /** 구독이 만료됨 → 작업 삭제 */
  subscriptionGone: boolean;
}

function record(state: JobState, events: WatchEvent[], pushStatus: number | null) {
  state.history = [...events.map((e) => ({ ...e, pushStatus })), ...state.history].slice(0, HISTORY_MAX);
}

export async function runCheck(input: JobState, deps: RunDeps): Promise<RunOutcome> {
  const state: JobState = structuredClone(input);
  const { now } = deps;
  state.lastCheckedAt = now;
  const toSend: WatchEvent[] = [];
  const silent: WatchEvent[] = [];

  // 24시간 초과 (예약 없는 작업)
  const isKw = deps.module.kind === 'keyword';
  const maxRun = isKw ? MAX_RUN_KEYWORD_MS : MAX_RUN_MS;
  if (!state.schedule && state.startedAt != null && now - state.startedAt > maxRun) {
    state.running = false;
    toSend.push({ type: 'expired', title: '모니터링 자동 중지', body: `모니터링을 켠 지 ${isKw ? '7일' : '24시간'}이 지나 자동으로 멈췄어요.`, at: now });
  } else {
    let snap: AnySnapshot | null = null;
    try {
      snap = await (deps.module.fetchSnapshot as (p: unknown, c: ModuleContext) => Promise<AnySnapshot>)(state.params, { ...deps.ctx, now, checkIndex: state.checks });
    } catch (e) {
      const msg = e instanceof ModuleError ? e.message : `확인 실패: ${e instanceof Error ? e.message : String(e)}`;
      state.consecutiveErrors += 1;
      state.lastError = msg;
      if (state.consecutiveErrors >= ERROR_NOTIFY_AFTER && !state.errorNotified) {
        state.errorNotified = true;
        const ev: WatchEvent = { type: 'error', title: '모니터링 오류', body: `${isKw ? '페이지를' : '대기열 정보를'} 확인할 수 없습니다. (${msg})`, at: now };
        (state.conditions.error ? toSend : silent).push(ev);
      }
    }

    if (snap) {
      state.checks += 1;
      if (state.errorNotified) {
        const ev: WatchEvent = { type: 'recovered', title: '모니터링 재개', body: '대기열 확인이 다시 정상으로 돌아왔어요.', at: now };
        (state.conditions.error ? toSend : silent).push(ev);
      }
      state.consecutiveErrors = 0;
      state.errorNotified = false;
      state.lastError = null;
      state.lastOkAt = now;

      const r = isKw
        ? evaluateKeyword(isKeywordSnapshot(state.last) ? state.last : null, snap as KeywordSnapshot, state.conditions as KeywordConditions, now)
        : evaluate(isQueueSnapshot(state.last) ? state.last : null, snap as QueueSnapshot, state.conditions as QueueConditions, now);
      for (const { enabled, ...ev } of r.events) (enabled ? toSend : silent).push(ev);
      state.last = snap;
      if (r.stop) state.running = false;
    }
  }

  let subscriptionGone = false;
  if (silent.length) record(state, silent, null);
  const msg = mergeForPush(toSend);
  if (msg) {
    const res = await deps.sendPush(msg).catch(() => null);
    // 0 = 발송을 시도했지만 실패 (null 은 조건에서 꺼서 보내지 않은 것)
    record(state, toSend, res?.status ?? 0);
    if (res?.gone) subscriptionGone = true;
  }
  return { state, subscriptionGone };
}
