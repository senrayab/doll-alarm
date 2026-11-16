// 감시 작업 API — 닉네임 평문은 서버로 보내지 않고 해시만 보냄
import { nicknameHash, randomSalt } from '../../shared/nickname';
import type { JobView, QueueConditions, Schedule } from '../../shared/types';
import { deleteSetting, getSetting, setSetting } from '../db/local';
import { apiFetch } from './client';

/** 휴대폰에만 저장하는 작업 정보 (닉네임 평문 포함) */
export interface LocalJob {
  jobId: string;
  token: string;
  moduleId: string;
  nickname?: string;
  createdAt: number;
}

const KEY = 'testJob';

export const getLocalJob = () => getSetting<LocalJob>(KEY);
export const clearLocalJob = () => deleteSetting(KEY);

export class JobGoneError extends Error {
  constructor() {
    super('서버에서 감시 작업이 사라졌습니다.');
  }
}

async function call<T>(job: LocalJob, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('X-Job-Token', job.token);
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await apiFetch(`/api/jobs/${job.jobId}${path}`, { ...init, headers });
  if (res.status === 404) throw new JobGoneError();
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(`요청 실패 (${data.error ?? res.status})`);
  return data;
}

export interface StartInput {
  moduleId: 'nanacore' | 'demo';
  nickname?: string;
  intervalSec: number;
  conditions?: Partial<QueueConditions>;
  schedule?: Schedule | null;
  subscription: PushSubscription;
}

export async function startJob(input: StartInput): Promise<{ job: LocalJob; view: JobView }> {
  let params: unknown = {};
  if (input.moduleId === 'nanacore') {
    if (!input.nickname?.trim()) throw new Error('닉네임을 입력해 주세요.');
    const salt = randomSalt();
    params = { salt, nicknameHash: await nicknameHash(salt, input.nickname) };
  }
  const res = await apiFetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      moduleId: input.moduleId,
      params,
      intervalSec: input.intervalSec,
      conditions: input.conditions,
      schedule: input.schedule ?? null,
      push: input.subscription.toJSON(),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { jobId?: string; token?: string; job?: JobView; error?: string };
  if (!res.ok || !data.jobId || !data.token || !data.job) throw new Error(`감시 등록 실패 (${data.error ?? res.status})`);
  const job: LocalJob = {
    jobId: data.jobId,
    token: data.token,
    moduleId: input.moduleId,
    nickname: input.nickname?.trim(),
    createdAt: Date.now(),
  };
  await setSetting(KEY, job);
  return { job, view: data.job };
}

export const getJobView = (job: LocalJob) => call<JobView>(job, '');
export const setRunning = (job: LocalJob, running: boolean) =>
  call<JobView>(job, '', { method: 'PATCH', body: JSON.stringify({ running }) });
export const checkNow = (job: LocalJob) => call<JobView>(job, '/check', { method: 'POST' });

export async function deleteJob(job: LocalJob) {
  try {
    await call(job, '', { method: 'DELETE' });
  } catch (e) {
    if (!(e instanceof JobGoneError)) throw e;
  }
  await clearLocalJob();
}
