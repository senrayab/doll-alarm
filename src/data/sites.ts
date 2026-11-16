// 사이트 목록 관리 — 처음엔 비어 있음. 사용자가 주소를 넣으면 지원 여부를 주소로 판정
import type { ProbeResult } from '../../shared/types';
import { apiFetch } from '../api/client';
import { deleteSiteRow, listSites, listWatchesBySite, putSite, type Site, type SiteKind } from '../db/local';
import { emit } from './events';
import { removeWatch } from './watches';

export const KIND_LABEL: Record<SiteKind, string> = {
  queue: '대기 순번',
  product: '상품 상태',
  'new-product': '신규 상품',
  restock: '재입고',
  etc: '기타',
};

/** 개발자가 감시 방식을 확인해 둔 사이트 — 주소의 호스트로 알아봄 */
interface KnownSite {
  hosts: string[];
  label: string;
  kind: SiteKind;
  moduleId: string | null;
  support: 'official' | 'unsupported';
  needsLogin: boolean;
  description?: string;
  unsupportedReason?: string;
}

const KNOWN: KnownSite[] = [
  {
    hosts: ['nanacore-queue.netlify.app'],
    label: '나나코어 대기열',
    kind: 'queue',
    moduleId: 'nanacore',
    support: 'official',
    needsLogin: false,
    description: '공개 대기 명단에서 내 닉네임의 순번을 확인해요.',
  },
  {
    hosts: ['bebepick.me', 'www.bebepick.me'],
    label: '베베픽',
    kind: 'queue',
    moduleId: null,
    support: 'unsupported',
    needsLogin: true,
    unsupportedReason: '순서표를 보려면 로그인이 필요하고, 사이트 약관이 자동 수집을 금지해요. 바로가기로 직접 확인해 주세요.',
  },
];

export function detectKnown(url: string): KnownSite | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return KNOWN.find((k) => k.hosts.includes(host)) ?? null;
  } catch {
    return null;
  }
}

/** 모듈별 최소 확인 주기 (서버 모듈과 같은 값) */
export const MODULE_MIN_INTERVAL: Record<string, number> = { nanacore: 15, demo: 15, keyword: 60 };

export type SiteState = 'ok' | 'login' | 'check' | 'unsupported' | 'paused';

export const SITE_STATE_LABEL: Record<SiteState, string> = {
  ok: '정상',
  login: '로그인 필요',
  check: '연결 확인 필요',
  unsupported: '지원 불가',
  paused: '일시 중지',
};

export function siteState(s: Site): SiteState {
  if (s.support === 'unsupported') return 'unsupported';
  if (!s.enabled) return 'paused';
  if (s.support === 'custom') {
    if (s.needsLogin || s.probe?.verdict === 'login') return 'login';
    if (s.probe?.verdict === 'ok') return 'ok';
    if (s.probe && s.probe.verdict !== 'error') return 'unsupported';
    return 'check';
  }
  return 'ok';
}

export function canWatch(s: Site) {
  if (!s.enabled || !s.moduleId) return false;
  if (s.support === 'official') return true;
  return s.support === 'custom' && !s.needsLogin && s.probe?.verdict === 'ok';
}

/** 연결 확인 (서버가 한 번 열어 봄 — 결과는 저장하지 않음) */
export async function probeUrl(url: string, keywords: string[] = []): Promise<ProbeResult> {
  let res: Response;
  try {
    res = await apiFetch('/api/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, keywords }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new Error('연결 확인이 너무 오래 걸려요. 잠시 뒤 다시 시도해 주세요.');
    }
    throw e;
  }
  if (!res.ok) throw new Error(`연결 확인 실패 (${res.status})`);
  return (await res.json()) as ProbeResult;
}

/** 직접 추가한 사이트에 연결 확인 결과 반영 — 통과하면 키워드 감시 가능 */
function withProbe(site: Site, probe: ProbeResult): Site {
  const ok = probe.verdict === 'ok';
  return {
    ...site,
    probe,
    moduleId: ok ? 'keyword' : null,
    unsupportedReason: ok || probe.verdict === 'error' ? undefined : probe.message,
  };
}

export async function recheckSite(site: Site) {
  const next = withProbe(site, await probeUrl(site.url));
  await putSite(next);
  emit('sites');
  return next;
}

export const isDemo = (s: Pick<Site, 'moduleId'>) => s.moduleId === 'demo';

export function normalizeUrl(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.href;
  } catch {
    return null;
  }
}

export interface SiteInput {
  name: string;
  url: string;
  kind: SiteKind;
  description?: string;
  needsLogin: boolean;
  enabled: boolean;
}

export async function saveSite(input: SiteInput, existing?: Site): Promise<Site> {
  const name = input.name.trim();
  if (!name) throw new Error('사이트 이름을 입력해 주세요.');
  if (name.length > 30) throw new Error('사이트 이름은 30자 이내로 입력해 주세요.');
  const demo = existing && isDemo(existing);
  const url = demo ? '' : normalizeUrl(input.url);
  if (url == null) throw new Error('사이트 주소를 확인해 주세요. 예: https://example.com');

  // 알려진 사이트면 지원 방식·로그인 여부를 주소 기준으로 정함
  const known = demo ? null : detectKnown(url);
  const base = existing ?? { id: crypto.randomUUID(), createdAt: Date.now() };
  let site: Site = {
    ...base,
    name,
    url,
    kind: known?.kind ?? (demo ? 'queue' : input.kind),
    moduleId: demo ? 'demo' : (known?.moduleId ?? null),
    support: demo ? 'official' : (known?.support ?? 'custom'),
    unsupportedReason: known?.unsupportedReason,
    needsLogin: known ? known.needsLogin : input.needsLogin,
    enabled: input.enabled,
    description: input.description?.trim() || (known && !existing ? known.description : undefined),
  };
  // 직접 추가한 사이트: 주소가 새로 들어오거나 바뀌면 연결 확인
  if (!demo && !known) {
    const sameUrl = existing && existing.url === url && existing.probe;
    site = sameUrl ? withProbe(site, existing.probe!) : withProbe(site, await probeUrl(url));
  }
  if (existing?.moduleId && site.moduleId !== existing.moduleId && (await listWatchesBySite(existing.id)).length) {
    throw new Error('감시가 등록된 사이트는 다른 종류의 사이트 주소로 바꿀 수 없어요. 새 사이트로 추가해 주세요.');
  }
  await putSite(site);
  emit('sites');
  return site;
}

/** 설정 화면의 "데모로 연습하기" — 사용자가 누를 때만 추가 */
export async function ensureDemoSite(): Promise<Site> {
  const found = (await listSites()).find(isDemo);
  if (found) return found;
  const site: Site = {
    id: crypto.randomUUID(),
    name: '데모 대기열',
    url: '',
    kind: 'queue',
    moduleId: 'demo',
    support: 'official',
    needsLogin: false,
    enabled: true,
    description: '연습용 가짜 대기열이에요. 15초마다 한 칸씩 진행돼서 알림이 어떻게 오는지 미리 볼 수 있어요.',
    createdAt: Date.now(),
  };
  await putSite(site);
  emit('sites');
  return site;
}

export async function setSiteEnabled(site: Site, enabled: boolean) {
  await putSite({ ...site, enabled });
  emit('sites');
}

/** 사이트 삭제 — 연결된 감시도 서버 작업까지 함께 정리 */
export async function deleteSite(site: Site) {
  for (const w of await listWatchesBySite(site.id)) await removeWatch(w);
  await deleteSiteRow(site.id);
  emit('sites');
}
