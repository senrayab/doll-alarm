// 감시 등록·조회·변경·삭제 — 서버 작업과 휴대폰 기록을 함께 관리
import { nicknameHash, randomSalt } from '../../shared/nickname';
import type { JobView, QueueConditions, Schedule } from '../../shared/types';
import { apiFetch, UnauthorizedError } from '../api/client';
import { deleteInboxByJob } from '../db/inbox';
import { deleteSetting, deleteWatchRow, getSetting, getWatch, listWatches, putWatch, setSetting, type Site, type Watch } from '../db/local';
import { emit } from './events';

export class JobGoneError extends Error {
  constructor() {
    super('서버에서 감시 작업이 사라졌습니다.');
  }
}

async function call<T>(w: Pick<Watch, 'id' | 'token'>, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('X-Job-Token', w.token);
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await apiFetch(`/api/jobs/${w.id}${path}`, { ...init, headers });
  if (res.status === 404) throw new JobGoneError();
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(errorText(data.error, res.status));
  return data;
}

function errorText(code: string | undefined, status: number) {
  const map: Record<string, string> = {
    invalid_interval: '이 사이트에서 쓸 수 없는 확인 주기예요.',
    invalid_schedule: '예약 시간 형식을 확인해 주세요.',
    invalid_subscription: '알림 연결 정보가 올바르지 않아요. 설정에서 알림을 다시 켜 주세요.',
    invalid_params: '감시 대상 정보가 올바르지 않아요.',
    not_running: '감시가 멈춰 있어요.',
  };
  return (code && map[code]) || `요청 실패 (${code ?? status})`;
}

export interface NewWatchInput {
  site: Site;
  label: string;
  nickname?: string;
  intervalSec: number;
  conditions: QueueConditions;
  schedule: Schedule | null;
  subscription: PushSubscription;
}

export async function createWatch(input: NewWatchInput): Promise<Watch> {
  const { site } = input;
  if (!site.moduleId) throw new Error('이 사이트는 자동 감시를 지원하지 않아요.');
  let params: unknown = {};
  if (site.moduleId === 'nanacore') {
    if (!input.nickname?.trim()) throw new Error('닉네임을 입력해 주세요.');
    const salt = randomSalt();
    params = { salt, nicknameHash: await nicknameHash(salt, input.nickname) };
  }
  const res = await apiFetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      moduleId: site.moduleId,
      params,
      intervalSec: input.intervalSec,
      conditions: input.conditions,
      schedule: input.schedule,
      push: input.subscription.toJSON(),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { jobId?: string; token?: string; job?: JobView; error?: string };
  if (!res.ok || !data.jobId || !data.token || !data.job) throw new Error(errorText(data.error, res.status));

  const w: Watch = {
    id: data.jobId,
    siteId: site.id,
    moduleId: site.moduleId,
    label: input.label.trim() || site.name,
    nickname: input.nickname?.trim() || undefined,
    token: data.token,
    intervalSec: input.intervalSec,
    conditions: input.conditions,
    schedule: input.schedule,
    createdAt: Date.now(),
    view: data.job,
    syncedAt: Date.now(),
  };
  await putWatch(w);
  await setSetting('pushEndpoint', input.subscription.endpoint);
  emit('watches');
  return w;
}

async function saveView(w: Watch, view: JobView) {
  const fresh = (await getWatch(w.id)) ?? w;
  const next: Watch = {
    ...fresh,
    view,
    syncedAt: Date.now(),
    lost: false,
    intervalSec: view.intervalSec,
    conditions: view.conditions,
    schedule: view.schedule,
  };
  await putWatch(next);
  emit('watches');
  return next;
}

async function markLost(w: Watch) {
  const fresh = (await getWatch(w.id)) ?? w;
  await putWatch({ ...fresh, lost: true, view: fresh.view ? { ...fresh.view, running: false } : undefined });
  emit('watches');
}

/** 서버 상태 새로 받기 — 실패해도 마지막 상태는 남김 */
export async function refreshWatch(w: Watch): Promise<Watch | null> {
  try {
    return await saveView(w, await call<JobView>(w, ''));
  } catch (e) {
    if (e instanceof JobGoneError) {
      await markLost(w);
      return null;
    }
    throw e;
  }
}

export async function refreshAll(onlyRunning = true) {
  const all = await listWatches();
  await Promise.all(
    all
      .filter((w) => !w.lost && (!onlyRunning || w.view?.running !== false))
      .map((w) =>
        refreshWatch(w).catch((e) => {
          if (e instanceof UnauthorizedError) throw e;
        }),
      ),
  );
}

export interface WatchPatch {
  running?: boolean;
  intervalSec?: number;
  conditions?: QueueConditions;
  schedule?: Schedule | null;
  label?: string;
}

export async function updateWatch(w: Watch, patch: WatchPatch) {
  const { label, ...server } = patch;
  let cur = w;
  if (label !== undefined) {
    cur = { ...((await getWatch(w.id)) ?? w), label: label.trim() || w.label };
    await putWatch(cur);
    emit('watches');
  }
  if (Object.keys(server).length) {
    try {
      cur = await saveView(cur, await call<JobView>(cur, '', { method: 'PATCH', body: JSON.stringify(server) }));
    } catch (e) {
      if (e instanceof JobGoneError) await markLost(cur);
      throw e;
    }
  }
  return cur;
}

export async function checkWatchNow(w: Watch) {
  await call<JobView>(w, '/check', { method: 'POST' });
  // 서버가 확인을 마칠 시간을 조금 준 뒤 다시 읽음
  await new Promise((r) => setTimeout(r, 2500));
  return refreshWatch(w);
}

/** 서버 작업 + 휴대폰 기록 삭제 (서버에 이미 없으면 휴대폰 것만) */
export async function removeWatch(w: Watch) {
  try {
    await call(w, '', { method: 'DELETE' });
  } catch (e) {
    if (!(e instanceof JobGoneError)) throw e;
  }
  await deleteWatchRow(w.id);
  await deleteInboxByJob(w.id).catch(() => {});
  emit('watches');
  emit('inbox');
}

/** 알림 구독이 바뀌면(다시 켜기 등) 모든 서버 작업에 새 구독 전달 */
export async function syncSubscription(sub: PushSubscription) {
  const prev = await getSetting<string>('pushEndpoint');
  if (prev === sub.endpoint) return;
  const push = sub.toJSON();
  for (const w of await listWatches()) {
    if (w.lost) continue;
    await call(w, '', { method: 'PATCH', body: JSON.stringify({ push }) }).catch((e) => {
      if (e instanceof JobGoneError) return markLost(w);
    });
  }
  await setSetting('pushEndpoint', sub.endpoint);
}

/** 2단계 테스트 화면에서 만든 작업 정리 — 기본 사이트가 없으므로 옮기지 않고 서버 작업까지 삭제 */
export async function cleanupTestJob() {
  const old = await getSetting<{ jobId: string; token: string }>('testJob');
  if (!old) return;
  await call({ id: old.jobId, token: old.token }, '', { method: 'DELETE' }).catch(() => {});
  await deleteSetting('testJob');
}

// ---------- 화면 표시용 상태 ----------

export type WatchState = 'running' | 'paused' | 'error' | 'met' | 'lost' | 'waiting';

export const WATCH_STATE_LABEL: Record<WatchState, string> = {
  running: '정상 감시 중',
  paused: '감시 일시 중지',
  error: '감시 오류',
  met: '조건 충족',
  lost: '연결 확인 필요',
  waiting: '예약 대기',
};

export function watchState(w: Watch): WatchState {
  if (w.lost) return 'lost';
  const v = w.view;
  if (!v) return 'running';
  if (v.last?.status === 'current') return 'met';
  if (!v.running) return v.history[0]?.type === 'finished' ? 'met' : 'paused';
  if (v.consecutiveErrors >= 3) return 'error';
  if (!v.inWindow) return 'waiting';
  return 'running';
}

/** 오라 색 — 차례가 멀면 calm(블루), 다가오면 near(오렌지), 다음·지금이면 hot(핑크), 중지 idle, 오류 alert */
export type Tone = 'calm' | 'near' | 'hot' | 'idle' | 'alert';

export function watchTone(w: Watch): Tone {
  const s = watchState(w);
  if (s === 'lost' || s === 'error') return 'alert';
  const last = w.view?.last;
  if (s === 'met' || last?.status === 'current') return 'hot';
  if (s === 'paused' || s === 'waiting' || !last?.found) return 'idle';
  if (last.ahead != null && last.ahead <= 1) return 'hot';
  if (last.ahead != null && last.ahead <= 5) return 'near';
  return 'calm';
}

/** 오라 안의 큰 글자 */
export function headline(w: Watch): { big: string; unit?: string; sub: string } {
  const last = w.view?.last;
  if (w.lost) return { big: '연결 끊김', sub: '다시 등록이 필요해요' };
  // 예약 시간 밖 — 다음 시작 시각 표시
  if (w.view?.running && !w.view.inWindow) {
    const start = w.view.nextCheckAt
      ? new Date(w.view.nextCheckAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
      : (w.schedule?.start ?? '');
    return { big: start, unit: '부터', sub: '예약 시간을 기다리는 중이에요' };
  }
  if (w.view && !w.view.running && !last) return { big: '중지', sub: '감시를 멈췄어요' };
  if (!w.view || !last) return { big: '확인 중', sub: '첫 확인을 기다리고 있어요' };
  if (last.status === 'current') return { big: '지금!', sub: '내 차례예요' };
  if (last.status === 'done' || last.status === 'skipped') return { big: '완료', sub: '순서가 끝났어요' };
  if (!last.found) return { big: '대기 전', sub: '명단에 아직 없어요' };
  if (last.ahead != null && last.ahead <= 1) return { big: '다음', sub: '곧 내 차례예요' };
  return { big: String(last.ahead ?? '—'), unit: '명 전', sub: `내 앞에 ${last.ahead}명` };
}
