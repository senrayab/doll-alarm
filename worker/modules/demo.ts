// 데모 대기열 — 방송이 없어도 알림 흐름 전체를 시험하기 위한 가짜 사이트
// 확인할 때마다 한 칸씩 진행: 앞에 6명 → 5 → 4 → 3 → 2 → 1(다음 순서) → 내 차례 → 완료
// 기본 알림 지점 [5, 3, 1] 이면: 감시 시작 · 5명 전 · 3명 전 · 다음 순서! · 지금 내 차례! · 완료
import type { QueueSnapshot } from '../../shared/types';
import type { QueueModule } from '../engine/types';

const step = (ahead: number): QueueSnapshot => ({ found: true, position: 10, status: 'pending', ahead, currentPosition: 10 - ahead, waiting: ahead + 3 });
const SCRIPT: QueueSnapshot[] = [
  step(6),
  step(5),
  step(4),
  step(3),
  step(2),
  step(1),
  { found: true, position: 10, status: 'current', ahead: 0, currentPosition: 10, waiting: 3 },
  { found: true, position: 10, status: 'done', ahead: null, currentPosition: 11, waiting: 2 },
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
