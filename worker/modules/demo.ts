// 데모 대기열 — 방송이 없어도 알림 흐름 전체를 시험하기 위한 가짜 사이트
// 확인할 때마다 한 칸씩 진행: 앞에 3명 → 2명 → 1명 → 다음 순서 → 내 차례 → 완료
import type { QueueSnapshot } from '../../shared/types';
import type { QueueModule } from '../engine/types';

const SCRIPT: QueueSnapshot[] = [
  { found: true, position: 7, status: 'pending', ahead: 3, currentPosition: 4, waiting: 5 },
  { found: true, position: 7, status: 'pending', ahead: 2, currentPosition: 5, waiting: 4 },
  { found: true, position: 7, status: 'pending', ahead: 1, currentPosition: 6, waiting: 3 },
  { found: true, position: 7, status: 'pending', ahead: 0, currentPosition: null, waiting: 3 },
  { found: true, position: 7, status: 'current', ahead: 0, currentPosition: 7, waiting: 2 },
  { found: true, position: 7, status: 'done', ahead: null, currentPosition: 8, waiting: 1 },
];

export const demo: QueueModule<Record<string, never>> = {
  id: 'demo',
  name: '데모 대기열',
  kind: 'queue',
  minIntervalSec: 15,
  parseParams: () => ({}),
  async fetchSnapshot(_params, ctx) {
    return SCRIPT[Math.min(ctx.checkIndex, SCRIPT.length - 1)];
  },
};
