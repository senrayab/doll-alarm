// 앱·서버 공통 타입

export type QueueStatus = 'current' | 'pending' | 'done' | 'skipped';

/** 대기열 한 번 확인한 결과 (내 기준) */
export interface QueueSnapshot {
  found: boolean;
  position: number | null;
  status: QueueStatus | null;
  /** 내 앞에 남은 사람 수 (진행 중인 사람 포함) */
  ahead: number | null;
  /** 지금 진행 중인 순번 */
  currentPosition: number | null;
  /** 남은 대기 인원 전체 */
  waiting: number;
}

export interface QueueConditions {
  /** 내 순번 숫자가 바뀜 (중간 끼워넣기 등) */
  position: boolean;
  /** 내 앞 인원이 줄어듦 */
  ahead: boolean;
  /** ahead 알림을 이 인원 이하부터만 (null = 줄어들 때마다) */
  aheadAtMost: number | null;
  /** 내 차례 도달 */
  turn: boolean;
  /** 대기열에서 내 정보가 사라짐 */
  gone: boolean;
  /** 확인 실패 (연속 3회) */
  error: boolean;
}

export const DEFAULT_QUEUE_CONDITIONS: QueueConditions = {
  position: true,
  ahead: true,
  aheadAtMost: null,
  turn: true,
  gone: true,
  error: true,
};

export interface Schedule {
  /** "HH:MM" (한국 시간) */
  start: string;
  end: string;
}

export type EventType =
  | 'started'
  | 'notFound'
  | 'appeared'
  | 'position'
  | 'ahead'
  | 'turn'
  | 'finished'
  | 'gone'
  | 'error'
  | 'recovered'
  | 'expired';

export interface WatchEvent {
  type: EventType;
  title: string;
  body: string;
  at: number;
  important?: boolean;
}

export interface HistoryItem extends WatchEvent {
  /** 푸시 발송 결과 (HTTP 상태). 조건에서 끈 이벤트는 기록만 */
  pushStatus: number | null;
}

/** 앱이 받아 보는 작업 상태 (개인정보 없음) */
export interface JobView {
  moduleId: string;
  running: boolean;
  intervalSec: number;
  schedule: Schedule | null;
  conditions: QueueConditions;
  inWindow: boolean;
  nextCheckAt: number | null;
  lastCheckedAt: number | null;
  lastOkAt: number | null;
  last: QueueSnapshot | null;
  lastError: string | null;
  consecutiveErrors: number;
  history: HistoryItem[];
}

export const INTERVAL_CHOICES = [15, 30, 60, 180, 300] as const;
