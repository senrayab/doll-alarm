// 이전/현재 대기열 상태를 비교해 알림 이벤트를 만든다 (공통 엔진 — 사이트와 무관)
import type { QueueConditions, QueueSnapshot, WatchEvent } from '../../shared/types';

export interface EvalResult {
  /** 발송 후보 (조건에서 끈 것도 포함 — enabled 로 구분) */
  events: (WatchEvent & { enabled: boolean })[];
  /** 더 볼 필요 없음 (완료·사라짐) */
  stop: boolean;
}

const pad = (n: number | null) => (n == null ? '-' : String(n).padStart(3, '0'));

function aheadText(s: QueueSnapshot) {
  if (s.status === 'current') return '지금 내 차례예요';
  if (s.ahead === 0) return '바로 다음 순서예요';
  return `내 앞에 ${s.ahead}명`;
}

export function evaluate(prev: QueueSnapshot | null, cur: QueueSnapshot, cond: QueueConditions, at: number): EvalResult {
  const events: EvalResult['events'] = [];
  const push = (e: Omit<WatchEvent, 'at'>, enabled: boolean) => events.push({ ...e, at, enabled });
  let stop = false;

  const turn = () =>
    push(
      { type: 'turn', title: '차례 도달!', body: `${pad(cur.position)}번 — 대기 순번이 도달했습니다! 지금 확인해 주세요.`, important: true },
      cond.turn,
    );
  const finished = () => {
    push({ type: 'finished', title: '순서 완료', body: `${pad(cur.position)}번 순서가 완료 처리되어 감시를 마칩니다.` }, true);
    stop = true;
  };

  // 첫 확인
  if (!prev) {
    if (!cur.found) {
      push({ type: 'notFound', title: '감시 시작', body: '대기열에서 닉네임을 아직 찾지 못했어요. 등록되면 알려 드릴게요.' }, true);
    } else if (cur.status === 'current') {
      turn();
    } else if (cur.status === 'done' || cur.status === 'skipped') {
      finished();
    } else {
      push({ type: 'started', title: '감시 시작', body: `현재 ${pad(cur.position)}번 · ${aheadText(cur)}` }, true);
    }
    return { events, stop };
  }

  // 새로 등록됨
  if (!prev.found && cur.found) {
    if (cur.status === 'current') turn();
    else if (cur.status === 'done' || cur.status === 'skipped') finished();
    else push({ type: 'appeared', title: '대기열 등록', body: `${pad(cur.position)}번으로 등록되었어요 · ${aheadText(cur)}` }, true);
    return { events, stop };
  }

  // 사라짐 (명단 비움 포함)
  if (prev.found && !cur.found) {
    push({ type: 'gone', title: '대기열에서 사라짐', body: '대기열에서 내 정보가 사라졌어요. 사이트를 확인해 주세요.', important: true }, cond.gone);
    stop = true;
    return { events, stop };
  }

  if (!cur.found) return { events, stop };

  // 상태 변화
  if (cur.status === 'current' && prev.status !== 'current') {
    turn();
    return { events, stop };
  }
  if ((cur.status === 'done' || cur.status === 'skipped') && prev.status !== cur.status) {
    finished();
    return { events, stop };
  }

  if (cur.status === 'pending') {
    if (prev.position !== cur.position) {
      push({ type: 'position', title: '대기 순번 변경', body: `현재 대기 순번이 ${pad(cur.position)}번으로 변경되었습니다.` }, cond.position);
    }
    if (prev.ahead != null && cur.ahead != null && cur.ahead < prev.ahead) {
      const within = cond.aheadAtMost == null || cur.ahead <= cond.aheadAtMost;
      push(
        {
          type: 'ahead',
          title: cur.ahead === 0 ? '다음 순서!' : '순번 임박',
          body: cur.ahead === 0 ? '바로 다음이 내 차례예요. 준비해 주세요!' : `내 앞에 ${cur.ahead}명 남았습니다.`,
          important: cur.ahead === 0,
        },
        cond.ahead && within,
      );
    }
  }

  return { events, stop };
}

const PRIORITY: Record<WatchEvent['type'], number> = {
  turn: 0,
  gone: 1,
  finished: 2,
  error: 3,
  appeared: 4,
  ahead: 5,
  position: 6,
  started: 7,
  notFound: 8,
  recovered: 9,
  expired: 10,
};

/** 같은 확인에서 나온 여러 이벤트를 알림 1개로 합침 */
export function mergeForPush(events: WatchEvent[]) {
  if (!events.length) return null;
  const sorted = [...events].sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type]);
  return {
    title: sorted[0].title,
    body: sorted.map((e) => e.body).join('\n'),
    important: sorted.some((e) => e.important),
    type: sorted[0].type,
  };
}
