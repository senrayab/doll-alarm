// 키워드 감시 — 사용자가 등록한 공개 페이지에 키워드가 나타나거나 사라지면 알림
import type { KeywordSnapshot, ProbeResult } from '../../shared/types';
import { ModuleError, type KeywordModule, type ModuleContext } from '../engine/types';
import { checkPublicUrl, checkRobots, extractText, fetchPage, findKeywords, looksJsOnly, looksLikeLogin } from './web';

export interface KeywordParams {
  url: string;
  keywords: string[];
}

export const MAX_KEYWORDS = 10;

export function parseKeywordParams(raw: unknown): KeywordParams | null {
  const o = raw as Partial<KeywordParams> | null;
  if (!o || typeof o.url !== 'string' || !Array.isArray(o.keywords)) return null;
  try {
    checkPublicUrl(o.url);
  } catch {
    return null;
  }
  const keywords = [...new Set(o.keywords.filter((k): k is string => typeof k === 'string').map((k) => k.trim()).filter((k) => k.length > 0 && k.length <= 50))];
  if (!keywords.length || keywords.length > MAX_KEYWORDS) return null;
  return { url: o.url, keywords };
}

export const keyword: KeywordModule<KeywordParams> = {
  id: 'keyword',
  name: '키워드 감시',
  kind: 'keyword',
  minIntervalSec: 60, // 일반 사이트 부담 고려
  parseParams: parseKeywordParams,

  async fetchSnapshot(params, ctx: ModuleContext): Promise<KeywordSnapshot> {
    const u = checkPublicUrl(params.url);
    const allowed = await checkRobots(u, ctx.fetch, ctx.now, { get: ctx.cacheGet, put: ctx.cachePut });
    if (!allowed) throw new ModuleError('사이트의 robots.txt 가 이 페이지의 자동 접근을 막고 있어요', false);
    const page = await fetchPage(u, ctx.fetch);
    if (!page.status || page.status >= 400) throw new ModuleError(`페이지 응답 오류 (${page.status})`);
    const { title, text } = extractText(page.html);
    if (looksLikeLogin(page, text)) throw new ModuleError('로그인 화면으로 바뀌어 내용을 볼 수 없어요', false);
    // 제목에도 상태를 넣는 쇼핑몰이 많아서 제목까지 검색 ([품절] 토끼 인형 등)
    return { kind: 'keyword', found: findKeywords(`${title ?? ''}\n${text}`, params.keywords), title, textLength: text.length };
  },
};

/** 연결 확인 — 한 번만 열어 보고 판정 (저장하지 않음) */
export async function probe(rawUrl: string, keywords: string[], f: typeof fetch, now = Date.now()): Promise<ProbeResult> {
  const base: ProbeResult = { verdict: 'error', message: '', status: null, finalUrl: null, title: null, textLength: 0, found: [], checkedAt: now };
  let u: URL;
  try {
    u = checkPublicUrl(rawUrl);
  } catch (e) {
    return { ...base, verdict: 'blocked', message: e instanceof Error ? e.message : '주소를 확인해 주세요' };
  }
  try {
    if (!(await checkRobots(u, f, now))) {
      return { ...base, verdict: 'robots', message: '사이트의 robots.txt 가 자동 접근을 막고 있어 감시할 수 없어요.' };
    }
    const page = await fetchPage(u, f);
    const { title, text } = extractText(page.html);
    const r = { ...base, status: page.status, finalUrl: page.finalUrl, title, textLength: text.length, found: findKeywords(`${title ?? ''}\n${text}`, keywords) };
    if (looksLikeLogin(page, text)) return { ...r, verdict: 'login', message: '로그인해야 볼 수 있는 페이지라 자동 감시를 할 수 없어요.' };
    if (page.status >= 400) return { ...r, verdict: 'error', message: `페이지가 열리지 않아요 (응답 ${page.status}).` };
    if (looksJsOnly(page, text)) {
      return { ...r, verdict: 'js', message: '화면 내용을 자바스크립트로 그리는 사이트라 서버에서 글자를 읽을 수 없어요.' };
    }
    return { ...r, verdict: 'ok', message: '공개 페이지예요. 키워드 감시를 쓸 수 있어요.' };
  } catch (e) {
    const msg = e instanceof ModuleError ? e.message : '페이지에 연결하지 못했어요.';
    return { ...base, verdict: e instanceof ModuleError && !e.retryable ? 'blocked' : 'error', message: msg };
  }
}
