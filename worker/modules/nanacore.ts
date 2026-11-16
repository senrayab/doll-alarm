// 나나코어 공개 대기열 — 공개 뷰어 페이지가 쓰는 Supabase 공개(anon) API 를 똑같이 읽는다.
// 서버에는 닉네임 해시만 있고, 명단의 각 닉네임을 같은 방식으로 해시해 비교한다.
import { nicknameHash } from '../../shared/nickname';
import { ModuleError, snapshotFromRows, type ModuleContext, type QueueModule } from '../engine/types';

const VIEWER_URL = 'https://nanacore-queue.netlify.app/?view=viewer';
const CONFIG_TTL = 6 * 3600 * 1000;
const CACHE_KEY = 'nanacore:config';

export interface NanacoreParams {
  nicknameHash: string;
  salt: string;
}

interface Config {
  url: string;
  key: string;
  fetchedAt: number;
}

/** 뷰어 페이지 소스에서 Supabase 주소·공개키 추출 */
export function parseViewerConfig(html: string): { url: string; key: string } | null {
  const url = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(html)?.[1];
  const key = /SUPABASE_ANON_KEY\s*=\s*'([^']+)'/.exec(html)?.[1];
  if (!url || !key) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !u.hostname.endsWith('.supabase.co')) return null;
  } catch {
    return null;
  }
  return { url: url.replace(/\/$/, ''), key };
}

interface Row {
  position: number;
  nickname: string;
  status: string;
}

export function parseRows(data: unknown): Row[] {
  if (!Array.isArray(data)) throw new ModuleError('대기열 응답 형식이 바뀌었습니다');
  return data.map((r) => {
    if (!r || typeof r !== 'object') throw new ModuleError('대기열 응답 형식이 바뀌었습니다');
    const o = r as Record<string, unknown>;
    if (typeof o.position !== 'number' || typeof o.nickname !== 'string' || typeof o.status !== 'string') {
      throw new ModuleError('대기열 응답에 필요한 항목이 없습니다');
    }
    return { position: o.position, nickname: o.nickname, status: o.status };
  });
}

async function loadConfig(ctx: ModuleContext, force: boolean): Promise<Config> {
  const cached = await ctx.cacheGet<Config>(CACHE_KEY);
  if (!force && cached && ctx.now - cached.fetchedAt < CONFIG_TTL) return cached;
  const res = await ctx.fetch(VIEWER_URL, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new ModuleError(`나나코어 페이지 응답 오류 (${res.status})`);
  const parsed = parseViewerConfig(await res.text());
  if (!parsed) throw new ModuleError('나나코어 페이지 구조가 바뀌어 접속 정보를 찾지 못했습니다', false);
  const cfg = { ...parsed, fetchedAt: ctx.now };
  await ctx.cachePut(CACHE_KEY, cfg);
  return cfg;
}

const UA = 'doll-alarm/1.0 (personal queue notifier)';

async function fetchRows(ctx: ModuleContext, cfg: Config) {
  return ctx.fetch(`${cfg.url}/rest/v1/queue_items?select=position,nickname,status&order=position.asc&limit=1000`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'User-Agent': UA },
  });
}

export const nanacore: QueueModule<NanacoreParams> = {
  id: 'nanacore',
  name: '나나코어',
  kind: 'queue',
  minIntervalSec: 15, // 뷰어 화면 자체 갱신 주기

  parseParams(raw) {
    const o = raw as Partial<NanacoreParams> | null;
    if (!o || typeof o.nicknameHash !== 'string' || !/^[0-9a-f]{64}$/.test(o.nicknameHash)) return null;
    if (typeof o.salt !== 'string' || !/^[0-9a-f]{32}$/.test(o.salt)) return null;
    return { nicknameHash: o.nicknameHash, salt: o.salt };
  },

  async fetchSnapshot(params, ctx) {
    let cfg = await loadConfig(ctx, false);
    let res = await fetchRows(ctx, cfg);
    if (res.status === 401 || res.status === 404) {
      // 공개키·주소가 바뀌었을 수 있음 → 페이지에서 다시 읽기
      cfg = await loadConfig(ctx, true);
      res = await fetchRows(ctx, cfg);
    }
    if (!res.ok) throw new ModuleError(`대기열 응답 오류 (${res.status})`);
    const rows = parseRows(await res.json());

    const hashes = await Promise.all(rows.map((r) => nicknameHash(params.salt, r.nickname)));
    return snapshotFromRows(rows.map((r, i) => ({ position: r.position, status: r.status, mine: hashes[i] === params.nicknameHash })));
  },
};
