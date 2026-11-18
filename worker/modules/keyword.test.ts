import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYWORD_CONDITIONS, type KeywordSnapshot } from '../../shared/types';
import { evaluateKeyword } from '../engine/evaluate';
import { runCheck, type JobState } from '../engine/run';
import { ModuleError, type SiteModule } from '../engine/types';
import { keyword, parseKeywordParams, probe } from './keyword';
import { checkPublicUrl, extractText, findKeywords, parseRobots, robotsAllows } from './web';

describe('robots.txt', () => {
  const txt = `
User-agent: *
Disallow: /admin
Allow: /admin/public
Disallow: /*.pdf$

User-agent: BadBot
Disallow: /
`;
  const rules = parseRobots(txt);
  it('* 규칙 적용, 가장 긴 규칙 우선', () => {
    expect(robotsAllows(rules, '/shop/item/1')).toBe(true);
    expect(robotsAllows(rules, '/admin/settings')).toBe(false);
    expect(robotsAllows(rules, '/admin/public/a')).toBe(true);
    expect(robotsAllows(rules, '/file.pdf')).toBe(false);
    expect(robotsAllows(rules, '/file.pdf?x=1')).toBe(true);
  });
  it('전체 금지', () => {
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow: /'), '/anything')).toBe(false);
  });
  it('빈 Disallow 는 전부 허용', () => {
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow:'), '/x')).toBe(true);
  });
  it('우리 이름 그룹이 있으면 그것만', () => {
    const r = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: doll-alarm\nAllow: /');
    expect(robotsAllows(r, '/x')).toBe(true);
  });
});

describe('본문 추출·키워드', () => {
  const html = `<html><head><title>인형 가게 &amp; 굿즈</title><style>.a{}</style></head>
  <body><script>var 재입고 = 1</script><h1>토끼 인형</h1><p>상태: <b>재 입고</b>&nbsp;완료</p><!-- 품절 --></body></html>`;
  it('스크립트·주석은 빼고 보이는 글자만', () => {
    const { title, text } = extractText(html);
    expect(title).toBe('인형 가게 & 굿즈');
    expect(text).toContain('토끼 인형');
    expect(text).not.toContain('var');
    expect(text).not.toContain('품절');
  });
  it('대소문자·띄어쓰기 무시', () => {
    const { text } = extractText(html);
    expect(findKeywords(text, ['재입고', '품절', 'TOKKI'])).toEqual(['재입고']);
    expect(findKeywords('Sold OUT', ['sold out'])).toEqual(['sold out']);
  });
});

describe('주소 검사', () => {
  it('내부망·로컬·계정 포함 주소 차단', () => {
    for (const u of ['http://localhost/x', 'http://127.0.0.1', 'http://192.168.0.1', 'http://10.0.0.5', 'http://[::1]/', 'ftp://a.com', 'https://u:p@a.com', 'http://intranet/']) {
      expect(() => checkPublicUrl(u), u).toThrow(ModuleError);
    }
    expect(checkPublicUrl('https://shop.example.com/item?id=1').hostname).toBe('shop.example.com');
  });
  it('params 검증', () => {
    expect(parseKeywordParams({ url: 'https://a.com', keywords: [' 재입고 ', '재입고', ''] })).toEqual({ url: 'https://a.com', keywords: ['재입고'] });
    expect(parseKeywordParams({ url: 'https://a.com', keywords: [] })).toBeNull();
    expect(parseKeywordParams({ url: 'http://localhost', keywords: ['a'] })).toBeNull();
  });
});

/** 가짜 사이트 */
function site(pages: Record<string, { status?: number; body: string; type?: string }>) {
  return (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    const p = pages[u.pathname];
    if (!p) return new Response('not found', { status: 404 });
    const res = new Response(p.body, { status: p.status ?? 200, headers: { 'content-type': p.type ?? 'text/html; charset=utf-8' } });
    Object.defineProperty(res, 'url', { value: u.href });
    return res;
  }) as typeof fetch;
}
const long = '설명 '.repeat(200);

describe('연결 확인 (probe)', () => {
  it('공개 페이지 → ok + 지금 있는 키워드', async () => {
    const r = await probe('https://shop.example.com/item', ['재입고', '품절'], site({ '/item': { body: `<title>토끼</title><p>${long} 재입고 알림</p>` } }));
    expect(r).toMatchObject({ verdict: 'ok', title: '토끼', found: ['재입고'] });
  });
  it('robots.txt 가 막으면 robots', async () => {
    const r = await probe('https://shop.example.com/item', [], site({ '/robots.txt': { body: 'User-agent: *\nDisallow: /', type: 'text/plain' }, '/item': { body: long } }));
    expect(r.verdict).toBe('robots');
  });
  it('로그인 화면이면 login', async () => {
    const r = await probe('https://shop.example.com/item', [], site({ '/item': { body: '<form><input type="password"></form>' } }));
    expect(r.verdict).toBe('login');
  });
  it('페이지 제목에 있는 키워드도 찾음', async () => {
    const r = await probe('https://shop.example.com/item', ['품절'], site({ '/item': { body: `<title>[품절] 토끼 인형</title><p>${long}</p>` } }));
    expect(r.found).toEqual(['품절']);
  });
  it('JS 로만 그리는 페이지면 js', async () => {
    const r = await probe('https://shop.example.com/item', [], site({ '/item': { body: '<div id="root"></div><script src=a.js></script>' } }));
    expect(r.verdict).toBe('js');
  });
  it('내부 주소는 blocked', async () => {
    expect((await probe('http://127.0.0.1/', [], site({}))).verdict).toBe('blocked');
  });
});

describe('키워드 모니터링 비교', () => {
  const snap = (found: string[]): KeywordSnapshot => ({ kind: 'keyword', found, title: null, textLength: 1000 });
  const C = DEFAULT_KEYWORD_CONDITIONS;
  const on = (r: ReturnType<typeof evaluateKeyword>) => r.events.filter((e) => e.enabled).map((e) => e.type);
  it('첫 확인은 모니터링 시작', () => {
    expect(on(evaluateKeyword(null, snap([]), C, 0))).toEqual(['started']);
  });
  it('새로 나타나면 발견! (중요)', () => {
    const r = evaluateKeyword(snap([]), snap(['재입고']), C, 0);
    expect(on(r)).toEqual(['kwFound']);
    expect(r.events[0]).toMatchObject({ title: '‘재입고’ 발견!', important: true });
  });
  it('사라짐은 기본 꺼짐 (켜면 알림)', () => {
    expect(on(evaluateKeyword(snap(['재입고']), snap([]), C, 0))).toEqual([]);
    expect(on(evaluateKeyword(snap(['재입고']), snap([]), { ...C, disappear: true }, 0))).toEqual(['kwLost']);
  });
  it('그대로면 조용히', () => {
    expect(evaluateKeyword(snap(['a']), snap(['a']), C, 0).events).toEqual([]);
  });
});

describe('키워드 모니터링 실행 (runCheck)', () => {
  it('없음 → 발견 시 알림, robots 캐시', async () => {
    let body = `<p>${long} 품절</p>`;
    let robotsCalls = 0;
    const f = (async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      if (u.pathname === '/robots.txt') {
        robotsCalls++;
        return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } });
      }
      return new Response(body, { headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const cache = new Map<string, unknown>();
    let s: JobState = {
      v: 1, rev: 0, moduleId: 'keyword', params: { url: 'https://shop.example.com/item', keywords: ['재입고'] },
      conditions: { ...DEFAULT_KEYWORD_CONDITIONS }, intervalSec: 60, schedule: null,
      push: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } }, tokenHash: 'h',
      createdAt: 0, running: true, startedAt: 0, checks: 0, lastCheckedAt: null, lastOkAt: null, last: null,
      consecutiveErrors: 0, errorNotified: false, lastError: null, history: [],
    };
    const sent: string[] = [];
    const deps = {
      module: keyword as SiteModule,
      ctx: { fetch: f, cacheGet: async <T,>(k: string) => cache.get(k) as T, cachePut: async (k: string, v: unknown) => void cache.set(k, v) },
      now: 1000,
      sendPush: async (m: { title: string }) => (sent.push(m.title), { status: 201, gone: false }),
    };
    ({ state: s } = await runCheck(s, deps));
    ({ state: s } = await runCheck(s, deps));
    body = `<p>${long} 재입고 되었어요</p>`;
    ({ state: s } = await runCheck(s, deps));
    expect(sent).toEqual(['모니터링 시작', '‘재입고’ 발견!']);
    expect(robotsCalls).toBe(1);
  });
});
