// 서버 API 호출 — 모든 요청에 개인 접속 코드를 붙임
import { deleteSetting, getSetting, setSetting } from '../db/local';

const KEY = 'accessCode';
let cached: string | undefined;

export class UnauthorizedError extends Error {
  constructor() {
    super('접속 코드가 맞지 않습니다.');
  }
}

export async function loadAccessCode() {
  cached = await getSetting<string>(KEY);
  return cached;
}

export async function clearAccessCode() {
  cached = undefined;
  await deleteSetting(KEY);
}

export async function apiFetch(path: string, init: RequestInit = {}, code = cached) {
  const headers = new Headers(init.headers);
  if (code) headers.set('X-Access-Code', code);
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) throw new UnauthorizedError();
  return res;
}

/** 코드를 서버에 확인한 뒤 맞으면 저장 */
export async function verifyAndSaveAccessCode(code: string) {
  const trimmed = code.trim();
  const res = await apiFetch('/api/auth/check', { method: 'POST' }, trimmed);
  if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
  cached = trimmed;
  await setSetting(KEY, trimmed);
}
