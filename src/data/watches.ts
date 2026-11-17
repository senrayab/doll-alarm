// 모니터링 등록·조회·변경·삭제 — 서버 작업과 휴대폰 기록을 함께 관리
import { nicknameHash, randomSalt } from '../../shared/nickname';
import { isKeywordSnapshot, isQueueSnapshot, WEEKDAY_KO, type AnyConditions, type JobView, type QueueSnapshot, type Schedule } from '../../shared/types';
import { apiFetch, UnauthorizedError } from '../api/client';
import { deleteInboxByJob } from '../db/inbox';
import { deleteSetting, deleteWatchRow, getSetting, getWatch, listWatches, putWatch, setSetting, type Site, type SiteKind, type Watch } from '../db/local';
import { emit } from './events';

export class JobGoneError extends Error {
  constructor() {
    super('서버에서 모니터링 작업이 사라졌습니다.');
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
    invalid_params: '모니터링 대상 정보가 올바르지 않아요.',
    not_running: '모니터링이 멈춰 있어요.',
  };
  return (code && map[code]) || `요청 실패 (${code ?? status})`;
}

export interface NewWatchInput {
  site: Site;
  /** 모니터링 종류와 서버 모듈 (대기 순번 = 사이트 모듈, 나머지 = 키워드) */
  kind: SiteKind;
  moduleId: string;
  /** 대기열 주소 (열기용, 휴대폰에만) */
  link?: string;
  label: string;
  nickname?: string;
  /** 대기열 채널 */
  liveIndex?: number | null;
  /** 키워드 모니터링 대상 */
  target?: { url: string; keywords: string[] };
  intervalSec: number;
  conditions: AnyConditions;
  schedule: Schedule | null;
  subscription: PushSubscription;
}

export async function createWatch(input: NewWatchInput): Promise<Watch> {
  const { site, moduleId } = input;
  if (!moduleId) throw new Error('이 사이트는 자동 모니터링을 지원하지 않아요.');
  let params: unknown = {};
  if (moduleId === 'nanacore') {
    if (!input.nickname?.trim()) throw new Error('닉네임을 입력해 주세요.');
    const salt = randomSalt();
    params = { salt, nicknameHash: await nicknameHash(salt, input.nickname), pageUrl: input.link };
  }
  if (moduleId === 'keyword') {
    if (!input.target?.url) throw new Error('모니터링할 페이지 주소를 입력해 주세요.');
    if (!input.target.keywords.length) throw new Error('키워드를 하나 이상 넣어 주세요.');
    params = input.target;
  }
  const res = await apiFetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      moduleId,
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
    moduleId,
    kind: input.kind,
    link: input.link,
    label: input.label.trim() || site.name,
    nickname: input.nickname?.trim() || undefined,
    liveIndex: input.liveIndex ?? null,
    target: moduleId === 'keyword' ? input.target : undefined,
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
  conditions?: AnyConditions;
  schedule?: Schedule | null;
  /** 휴방 날짜 (한국 날짜) */
  skipDates?: string[];
  /** 대기열 채널 (휴대폰에만) */
  liveIndex?: number | null;
  label?: string;
  /** 키워드 모니터링 대상 변경 */
  target?: { url: string; keywords: string[] };
  /** 나나코어 닉네임 변경 (서버에는 새 해시만) */
  nickname?: string;
  /** 대기열 주소 변경 */
  link?: string;
}

export async function updateWatch(w: Watch, patch: WatchPatch) {
  const { label, target, nickname, link, liveIndex, ...rest } = patch;
  const server: Record<string, unknown> = { ...rest };
  let cur = w;
  const local: Partial<Watch> = {};
  if (label !== undefined) local.label = label.trim() || w.label;
  if (liveIndex !== undefined && liveIndex !== (w.liveIndex ?? null)) local.liveIndex = liveIndex;
  if (target !== undefined) {
    server.params = target;
    local.target = target;
  }
  // 나나코어: 닉네임이나 대기열 주소가 바뀌면 대상 정보를 새로 보냄 (닉네임은 해시만)
  const nickChanged = nickname !== undefined && nickname.trim() !== (w.nickname ?? '');
  const linkChanged = link !== undefined && link !== (w.link ?? '');
  if (nickChanged || linkChanged) {
    const nick = nickChanged ? nickname!.trim() : (w.nickname ?? '');
    if (!nick) throw new Error('닉네임을 입력해 주세요.');
    const salt = randomSalt();
    server.params = { salt, nicknameHash: await nicknameHash(salt, nick), pageUrl: (linkChanged ? link : w.link) || undefined };
    if (nickChanged) local.nickname = nick;
    if (linkChanged) local.link = link;
  }
  if (Object.keys(local).length) {
    cur = { ...((await getWatch(w.id)) ?? w), ...local };
  }
  if (Object.keys(server).length) {
    try {
      const view = await call<JobView>(cur, '', { method: 'PATCH', body: JSON.stringify(server) });
      if (Object.keys(local).length) await putWatch(cur); // 서버가 받아들인 뒤에 휴대폰 기록도 바꿈
      cur = await saveView(cur, view);
    } catch (e) {
      if (e instanceof JobGoneError) await markLost(cur);
      throw e;
    }
  } else if (Object.keys(local).length) {
    await putWatch(cur);
    emit('watches');
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
  running: '정상 모니터링 중',
  paused: '모니터링 일시 중지',
  error: '모니터링 오류',
  met: '조건 충족',
  lost: '연결 확인 필요',
  waiting: '예약 대기',
};

export function watchState(w: Watch): WatchState {
  if (w.lost) return 'lost';
  const v = w.view;
  if (!v) return 'running';
  if (isKeywordSnapshot(v.last) && v.last.found.length && v.running) return 'met';
  if (isQueueSnapshot(v.last) && v.last.status === 'current') return 'met';
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
  if (w.view?.lastError && !w.view.last) return 'alert';
  const anyLast = w.view?.last;
  if (isKeywordSnapshot(anyLast)) {
    if (s === 'paused' || s === 'waiting') return 'idle';
    return anyLast.found.length ? 'hot' : 'calm';
  }
  const last = anyLast as QueueSnapshot | null | undefined;
  if (s === 'met' || last?.status === 'current') return 'hot';
  if (s === 'paused' || s === 'waiting' || !last?.found) return 'idle';
  if (last.ahead != null && last.ahead <= 1) return 'hot';
  if (last.ahead != null && last.ahead <= 5) return 'near';
  return 'calm';
}

/** 오라 안의 큰 글자 */
export function headline(w: Watch): { big: string; unit?: string; sub: string; pre?: string } {
  const anyLast = w.view?.last;
  if (isKeywordSnapshot(anyLast) && !w.lost && (w.view?.running === false || w.view?.inWindow !== false)) {
    const n = w.target?.keywords.length ?? 0;
    return anyLast.found.length
      ? { big: '발견!', sub: anyLast.found.map((k) => `‘${k}’`).join(', ') }
      : { big: '없음', sub: `키워드 ${n}개를 지켜보는 중` };
  }
  const last = isQueueSnapshot(anyLast) ? anyLast : null;
  if (w.lost) return { big: '연결 끊김', sub: '다시 등록이 필요해요' };
  // 예약 시간 밖 — 다음 시작 시각 표시
  // 휴방 날은 지난 결과가 있어도 쉬는 중으로 보여 줌
  const holidayToday = !!w.view?.skipDates?.includes(new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10));
  if (w.view?.running && !w.view.inWindow && (!w.view.last || holidayToday)) {
    const at = w.view.nextCheckAt;
    const start = at
      ? new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' })
      : (w.schedule?.start ?? '');
    // 오늘이 아니면 요일을 붙임 — 휴방일을 건너뛰면 다음 방송 요일이 보이게 ("수 19:00부터")
    const dayOf = (t: number) => new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const day = at && dayOf(at) !== dayOf(Date.now()) ? `${WEEKDAY_KO[new Date(at + 9 * 3600 * 1000).getUTCDay()]}요일` : undefined;
    if (holidayToday) return { big: start, unit: '부터', pre: day, sub: `오늘은 휴방이라 쉬어요${day ? ` · ${day}에 다시 시작` : ''}` };
    return { big: start, unit: '부터', pre: day, sub: day ? `${day}까지 쉬어요 · 예약 시간을 기다리는 중` : '예약 시간을 기다리는 중이에요' };
  }
  if (w.view && !w.view.running && !last) return { big: '중지', sub: '모니터링을 멈췄어요' };
  // 확인은 했는데 결과 없이 오류만 있는 경우 — '확인 중'이 아니라 오류를 보여 줌
  if (w.view?.lastCheckedAt && !w.view.last && w.view.lastError) return { big: '오류', sub: w.view.lastError };
  if (!w.view || !last) return { big: '확인 중', sub: '첫 확인을 기다리고 있어요' };
  if (last.status === 'current') return { big: '지금!', sub: '내 차례예요' };
  if (last.status === 'done' || last.status === 'skipped') return { big: '완료', sub: '순서가 끝났어요' };
  if (!last.found) return { big: '대기 전', sub: '명단에 아직 없어요' };
  if (last.ahead != null && last.ahead <= 1) return { big: '다음', sub: '곧 내 차례예요' };
  return { big: String(last.ahead ?? '—'), unit: '명 전', sub: `내 앞에 ${last.ahead}명` };
}

/** 급한 순서 비교 — 단계(지금·다음 > 5명 이하 > 오류 > 대기 중 > 중지), 같은 단계면 앞 인원이 적은 쪽 */
const TONE_RANK: Record<Tone, number> = { hot: 0, near: 1, alert: 2, calm: 3, idle: 4 };
function nearness(w: Watch) {
  const last = w.view?.last;
  if (isKeywordSnapshot(last)) return last.found.length ? 0 : 999;
  if (isQueueSnapshot(last)) return last.status === 'current' ? -1 : last.found ? (last.ahead ?? 998) : 999;
  return 999;
}
export function compareUrgency(a: Watch, b: Watch) {
  return TONE_RANK[watchTone(a)] - TONE_RANK[watchTone(b)] || nearness(a) - nearness(b);
}

/** 모니터링 종류 (예전 모니터링은 모듈로 짐작) */
export function watchKind(w: Watch): SiteKind {
  return w.kind ?? (w.moduleId === 'keyword' ? 'etc' : 'queue');
}

/** 모니터링을 다른 사이트로 옮기기 — 휴대폰 안의 묶음만 바꿈 (서버 작업·진행 상태는 그대로) */
export async function moveWatch(w: Watch, siteId: string) {
  const cur = (await getWatch(w.id)) ?? w;
  if (cur.siteId === siteId) return cur;
  const next = { ...cur, siteId };
  await putWatch(next);
  emit('watches');
  return next;
}

/** 키워드 계열 색 — 켜져 있으면 종류 색(k-재입고 등), 꺼지면 회색, 오류·연결 끊김이면 빨강. 대기 순번은 상태 색 그대로 */
export function kindTone(w: Watch): Tone | `k-${SiteKind}` {
  const kind = watchKind(w);
  if (kind === 'queue') return watchTone(w);
  const t = watchTone(w);
  if (t === 'alert') return 'alert';
  if (!w.view?.running) return 'idle';
  return `k-${kind}`;
}
