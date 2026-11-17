// 휴대폰 안에만 저장하는 데이터 (IndexedDB) — 서버로 보내지 않음
import { openDB, type DBSchema } from 'idb';
import type { AnyConditions, JobView, ProbeResult, Schedule } from '../../shared/types';

export type SiteKind = 'queue' | 'product' | 'new-product' | 'restock' | 'etc';
export type SiteSupport = 'official' | 'custom' | 'unsupported';

export type RemindKey = 'dayBefore' | 'morning' | 'hour' | 'start';

export interface SiteEvent {
  id: string;
  /** 종류 이름 — 양도데이 / 이벤트 / 특별 방송 / 휴방 / 기타 / 직접 추가한 이름 */
  type: string;
  /** 시작 시각 (ms) */
  at: number;
  memo?: string;
  /** 사이트의 라이브 채널 번호 (1호점 등) */
  liveIndex?: number | null;
  remind: RemindKey[];
  /** 매주 반복 (at 은 첫 회차) */
  repeat?: 'weekly';
  /** 서버 알림 작업 */
  reminder?: { id: string; token: string };
}

export interface Site {
  id: string;
  name: string;
  url: string;
  kind: SiteKind;
  /** 서버 모니터링 모듈 (공식 지원 사이트만) */
  moduleId: string | null;
  support: SiteSupport;
  unsupportedReason?: string;
  needsLogin: boolean;
  enabled: boolean;
  description?: string;
  /** 유튜브 라이브 채널들 (1호점·2호점 등, 바로가기용) */
  lives?: { name: string; url: string }[];
  /** (예전) 라이브 주소 하나 — lives 로 옮겨 씀 */
  liveUrl?: string;
  /** 양도데이·이벤트 같은 일정 (휴대폰에만 — 서버에는 알림 시각과 일정 번호만) */
  events?: SiteEvent[];
  /** 직접 추가한 사이트의 마지막 연결 확인 결과 */
  probe?: ProbeResult;
  createdAt: number;
}

export interface Watch {
  /** 서버 작업 ID */
  id: string;
  siteId: string;
  moduleId: string;
  /** 모니터링 종류 — 대기 순번 / 상품 상태 / 신규 상품 / 재입고 / 기타 (없으면 모듈로 짐작) */
  kind?: SiteKind;
  /** 대기열 주소 (사이트와 다를 수 있음, 열기용) */
  link?: string;
  label: string;
  /** 닉네임 평문 — 휴대폰에만 */
  nickname?: string;
  /** 키워드 모니터링 대상 */
  target?: { url: string; keywords: string[] };
  /** 서버 작업 토큰 — 이 휴대폰만 앎 */
  token: string;
  intervalSec: number;
  conditions: AnyConditions;
  schedule: Schedule | null;
  createdAt: number;
  /** 마지막으로 받아 온 서버 상태 (오프라인 표시용) */
  view?: JobView;
  syncedAt?: number;
  /** 서버에서 작업이 사라짐 (구독 만료 등) */
  lost?: boolean;
}

interface AppDB extends DBSchema {
  settings: { key: string; value: unknown };
  sites: { key: string; value: Site };
  watches: { key: string; value: Watch; indexes: { siteId: string } };
}

/** 다른 창(이전 버전 앱)이 저장소를 붙잡고 있어 구조 변경을 못 하는 상태 */
export const dbBlocked = { value: false, listeners: new Set<() => void>() };

export const dbPromise = openDB<AppDB>('doll-alarm', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) db.createObjectStore('settings');
    if (oldVersion < 2) {
      db.createObjectStore('sites', { keyPath: 'id' });
      db.createObjectStore('watches', { keyPath: 'id' }).createIndex('siteId', 'siteId');
    }
  },
  blocked() {
    dbBlocked.value = true;
    dbBlocked.listeners.forEach((l) => l());
  },
  // 새 버전 앱이 구조를 바꾸려 하면 이 창은 연결을 닫고 새로고침 (새 버전을 막지 않게)
  blocking(_cur, _next, event) {
    (event.target as IDBDatabase).close();
    location.reload();
  },
});

// ---------- settings ----------

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await (await dbPromise).get('settings', key)) as T | undefined;
}

export async function setSetting(key: string, value: unknown) {
  await (await dbPromise).put('settings', value, key);
}

export async function deleteSetting(key: string) {
  await (await dbPromise).delete('settings', key);
}

// ---------- sites ----------

export const listSites = async () => (await (await dbPromise).getAll('sites')).sort((a, b) => a.createdAt - b.createdAt);
export const getSite = async (id: string) => (await dbPromise).get('sites', id);
export const putSite = async (s: Site) => void (await (await dbPromise).put('sites', s));
export const deleteSiteRow = async (id: string) => (await dbPromise).delete('sites', id);

// ---------- watches ----------

export const listWatches = async () => (await (await dbPromise).getAll('watches')).sort((a, b) => b.createdAt - a.createdAt);
export const listWatchesBySite = async (siteId: string) => (await dbPromise).getAllFromIndex('watches', 'siteId', siteId);
export const getWatch = async (id: string) => (await dbPromise).get('watches', id);
export const putWatch = async (w: Watch) => void (await (await dbPromise).put('watches', w));
export const deleteWatchRow = async (id: string) => (await dbPromise).delete('watches', id);
