// 공개 웹페이지 읽기 공통 — 주소 검사, robots.txt 준수, 크기 제한, 본문 글자 추출
import { ModuleError } from '../engine/types';

export const UA = 'doll-alarm/1.0 (personal page watcher)';
export const UA_TOKEN = 'doll-alarm';
const MAX_BYTES = 2 * 1024 * 1024;

// ---------- 주소 검사 ----------

/** 외부 공개 주소만 허용 (내부망·로컬 주소 차단) */
export function checkPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ModuleError('주소 형식이 올바르지 않아요', false);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ModuleError('http(s) 주소만 모니터링할 수 있어요', false);
  if (u.username || u.password) throw new ModuleError('주소에 계정 정보가 들어 있으면 모니터링할 수 없어요', false);
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const privateHost =
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    !h.includes('.') ||
    /^(127|10|0)\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) ||
    h.includes(':'); // IPv6 직접 주소
  if (privateHost) throw new ModuleError('내부망 주소는 모니터링할 수 없어요', false);
  return u;
}

// ---------- robots.txt ----------

interface RobotsRule {
  allow: boolean;
  path: string;
}

/** robots.txt 에서 우리(doll-alarm) 또는 * 에 해당하는 규칙만 뽑음 */
export function parseRobots(txt: string, ua = UA_TOKEN): RobotsRule[] {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let cur: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && cur) {
      lastWasAgent = false;
      if (key === 'disallow' && val === '') continue; // 빈 Disallow = 전부 허용
      cur.rules.push({ allow: key === 'allow', path: val });
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && ua.toLowerCase().includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

function ruleMatches(rulePath: string, path: string) {
  const re = '^' + rulePath.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$');
  return new RegExp(re).test(path);
}

/** 가장 길게 일치하는 규칙이 이김 (같으면 Allow 우선) */
export function robotsAllows(rules: RobotsRule[], pathAndQuery: string) {
  let best: RobotsRule | null = null;
  for (const r of rules) {
    if (!ruleMatches(r.path, pathAndQuery)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

export interface CacheLike {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

const ROBOTS_TTL = 24 * 3600 * 1000;

export async function checkRobots(u: URL, f: typeof fetch, now: number, cache?: CacheLike): Promise<boolean> {
  const key = `robots:${u.origin}`;
  let rules = cache ? (await cache.get<{ at: number; rules: RobotsRule[] }>(key)) : undefined;
  if (!rules || now - rules.at > ROBOTS_TTL) {
    let parsed: RobotsRule[] = [];
    try {
      const res = await f(`${u.origin}/robots.txt`, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (res.ok) parsed = parseRobots((await res.text()).slice(0, 200_000));
      // 401/403 이면 전부 금지로 봄, 그 밖(404 등)은 허용
      else if (res.status === 401 || res.status === 403) parsed = [{ allow: false, path: '/' }];
    } catch {
      parsed = [];
    }
    rules = { at: now, rules: parsed };
    if (cache) await cache.put(key, rules);
  }
  return robotsAllows(rules.rules, u.pathname + u.search);
}

// ---------- 페이지 받기 ----------

export interface Page {
  status: number;
  finalUrl: string;
  html: string;
  contentType: string;
}

export async function fetchPage(u: URL, f: typeof fetch): Promise<Page> {
  const res = await f(u.href, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8' },
    redirect: 'follow',
  });
  const finalUrl = res.url || u.href;
  checkPublicUrl(finalUrl); // 리다이렉트로 내부 주소에 가지 않게
  const contentType = res.headers.get('content-type') ?? '';
  if (res.ok && !/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
    throw new ModuleError('웹페이지(HTML)가 아니라서 모니터링할 수 없어요', false);
  }
  // 최대 2MB 까지만 읽음
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
  }
  const buf = new Uint8Array(Math.min(size, MAX_BYTES));
  let o = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, buf.length - o);
    buf.set(c.subarray(0, take), o);
    o += take;
    if (o >= buf.length) break;
  }
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1] ?? 'utf-8';
  let html: string;
  try {
    html = new TextDecoder(charset).decode(buf);
  } catch {
    html = new TextDecoder().decode(buf);
  }
  return { status: res.status, finalUrl, html, contentType };
}

// ---------- 본문 글자 ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', ndash: '–', mdash: '—', copy: '©', reg: '®', won: '₩' };

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML → 제목 + 화면에 보이는 글자 (스크립트·스타일 제외) */
export function extractText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body).replace(/[ \t\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return { title: title ? decodeEntities(title).replace(/\s+/g, ' ').trim() || null : null, text };
}

/** 키워드 비교용 — 대소문자·띄어쓰기 무시, 유니코드 정규화 */
export function normalizeForMatch(s: string) {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

export function findKeywords(text: string, keywords: string[]) {
  const hay = normalizeForMatch(text);
  return keywords.filter((k) => {
    const n = normalizeForMatch(k);
    return n.length > 0 && hay.includes(n);
  });
}

// ---------- 로그인·JS 전용 페이지 짐작 ----------

export function looksLikeLogin(page: Page, text: string) {
  if (page.status === 401 || page.status === 403) return true;
  if (/\/(login|signin|sign-in|auth|account\/login|member\/login)\b/i.test(new URL(page.finalUrl).pathname)) return true;
  const hasPassword = /<input[^>]+type=["']?password/i.test(page.html);
  return hasPassword && text.length < 2000;
}

export function looksJsOnly(page: Page, text: string) {
  if (text.length >= 200) return false;
  return /<div[^>]+id=["'](root|app|__next|__nuxt)["']/i.test(page.html) || (page.html.match(/<script/gi)?.length ?? 0) >= 3;
}
