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
  /** 내 앞 인원 알림 */
  ahead: boolean;
  /** 앞 인원이 이 숫자에 도달할 때만 알림 (예: [5, 3, 1]). null = 줄어들 때마다 */
  aheadMilestones: number[] | null;
  /** 내 차례 도달 */
  turn: boolean;
  /** 대기열에서 내 정보가 사라짐 */
  gone: boolean;
  /** 확인 실패 (연속 3회) */
  error: boolean;
}

export const DEFAULT_AHEAD_MILESTONES = [5, 3, 1];
export const AHEAD_MILESTONE_CHOICES = [10, 5, 3, 2, 1];

export const DEFAULT_QUEUE_CONDITIONS: QueueConditions = {
  position: false,
  ahead: true,
  aheadMilestones: DEFAULT_AHEAD_MILESTONES,
  turn: true,
  gone: true,
  error: true,
};

// ---------- 키워드 모니터링 ----------

/** 공개 페이지 한 번 확인한 결과 */
export interface KeywordSnapshot {
  kind: 'keyword';
  /** 지금 페이지에 있는 키워드 (원래 입력한 글자 그대로) */
  found: string[];
  /** 페이지 제목 */
  title: string | null;
  /** 본문 글자 수 (페이지 구조가 크게 바뀌었는지 참고용) */
  textLength: number;
}

export interface KeywordConditions {
  /** 키워드가 새로 나타남 */
  appear: boolean;
  /** 있던 키워드가 사라짐 */
  disappear: boolean;
  /** 확인 실패 (연속 3회) */
  error: boolean;
}

export const DEFAULT_KEYWORD_CONDITIONS: KeywordConditions = { appear: true, disappear: false, error: true };

export type AnySnapshot = QueueSnapshot | KeywordSnapshot;
export type AnyConditions = QueueConditions | KeywordConditions;

export const isKeywordSnapshot = (s: AnySnapshot | null | undefined): s is KeywordSnapshot => !!s && (s as KeywordSnapshot).kind === 'keyword';
export const isQueueSnapshot = (s: AnySnapshot | null | undefined): s is QueueSnapshot => !!s && (s as KeywordSnapshot).kind !== 'keyword';

/** 연결 확인 결과 */
export type ProbeVerdict = 'ok' | 'login' | 'js' | 'robots' | 'blocked' | 'error';

export interface ProbeResult {
  verdict: ProbeVerdict;
  message: string;
  status: number | null;
  finalUrl: string | null;
  title: string | null;
  textLength: number;
  /** 요청한 키워드 중 지금 페이지에 있는 것 */
  found: string[];
  checkedAt: number;
}

export interface Schedule {
  /** "HH:MM" (한국 시간) */
  start: string;
  end: string;
  /** 모니터링할 요일 0=일 … 6=토 (없으면 매일) — 휴방일 빼기 */
  days?: number[];
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
  | 'expired'
  | 'kwFound'
  | 'kwLost';

export interface WatchEvent {
  type: EventType;
  title: string;
  body: string;
  at: number;
  important?: boolean;
}

export interface HistoryItem extends WatchEvent {
  /** 푸시 발송 결과 (HTTP 상태). null = 조건에서 꺼서 기록만, 0 = 발송 실패 */
  pushStatus: number | null;
}

/** 앱이 받아 보는 작업 상태 (개인정보 없음) */
export interface JobView {
  moduleId: string;
  running: boolean;
  intervalSec: number;
  schedule: Schedule | null;
  /** 휴방 날짜 (한국 날짜) */
  skipDates?: string[];
  conditions: AnyConditions;
  inWindow: boolean;
  nextCheckAt: number | null;
  lastCheckedAt: number | null;
  lastOkAt: number | null;
  last: AnySnapshot | null;
  lastError: string | null;
  consecutiveErrors: number;
  history: HistoryItem[];
}

export const INTERVAL_CHOICES = [15, 30, 60, 180, 300] as const;

/** 요일 이름 (0=일 … 6=토) */
export const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
/** 화면 표시용 "월·수·금" / "매일" (월요일부터) */
export function daysText(days?: number[]) {
  if (!days?.length || days.length === 7) return '매일';
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => WEEKDAY_KO[d]).join('·');
}
