// 사이트 모듈 인터페이스 — 사이트별 코드는 "데이터 읽기 + 내 상태 뽑기"만 담당
import type { KeywordSnapshot, QueueSnapshot } from '../../shared/types';

export interface ModuleContext {
  fetch: typeof fetch;
  now: number;
  /** 이 작업에서 몇 번째 확인인지 (0부터) */
  checkIndex: number;
  /** 모듈용 작은 캐시 (작업 저장소 안) */
  cacheGet<T>(key: string): Promise<T | undefined>;
  cachePut(key: string, value: unknown): Promise<void>;
}

/** 확인 실패 — "순번 도달"과 절대 섞이지 않게 별도 오류로 구분 */
export class ModuleError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
  }
}

export interface QueueModule<P = unknown> {
  id: string;
  name: string;
  kind: 'queue';
  minIntervalSec: number;
  /** 서버로 들어온 params 검증 (평문 개인정보가 들어 있으면 안 됨) */
  parseParams(raw: unknown): P | null;
  fetchSnapshot(params: P, ctx: ModuleContext): Promise<QueueSnapshot>;
}

export interface KeywordModule<P = unknown> {
  id: string;
  name: string;
  kind: 'keyword';
  minIntervalSec: number;
  parseParams(raw: unknown): P | null;
  fetchSnapshot(params: P, ctx: ModuleContext): Promise<KeywordSnapshot>;
}

export type SiteModule = QueueModule | KeywordModule;

/** 공통: 행 목록 → 내 기준 스냅샷 */
export function snapshotFromRows(rows: { position: number; status: string; mine: boolean }[]): QueueSnapshot {
  const current = rows.find((r) => r.status === 'current') ?? null;
  const pending = rows.filter((r) => r.status === 'pending').sort((a, b) => a.position - b.position);
  const mineRows = rows.filter((r) => r.mine);
  // 같은 닉네임이 여러 줄(주문 여러 건)이면: 진행 중 > 가장 앞의 대기 > 마지막 완료
  const me =
    mineRows.find((r) => r.status === 'current') ??
    mineRows.filter((r) => r.status === 'pending').sort((a, b) => a.position - b.position)[0] ??
    mineRows.sort((a, b) => b.position - a.position)[0] ??
    null;

  let ahead: number | null = null;
  if (me?.status === 'current') ahead = 0;
  else if (me?.status === 'pending') ahead = pending.filter((r) => r.position < me.position).length + (current ? 1 : 0);

  const status = me ? (['current', 'pending', 'done', 'skipped'].includes(me.status) ? me.status : 'pending') : null;
  return {
    found: !!me,
    position: me?.position ?? null,
    status: status as QueueSnapshot['status'],
    ahead,
    currentPosition: current?.position ?? null,
    waiting: pending.length,
    mineCount: mineRows.length,
    mineDone: mineRows.filter((r) => r.status === 'done' || r.status === 'skipped').length,
  };
}
