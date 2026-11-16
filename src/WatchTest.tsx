// 2단계 검증용 감시 화면 — 3단계에서 정식 화면(사이트 관리·대시보드)으로 바뀜
import { CircleStop, ListOrdered, Play, RefreshCw, Trash2, UserRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { HistoryItem, JobView } from '../shared/types';
import { UnauthorizedError } from './api/client';
import { checkNow, deleteJob, getJobView, getLocalJob, JobGoneError, setRunning, startJob, type LocalJob } from './api/jobs';

const fmtNo = (n: number | null | undefined) => (n == null ? '—' : String(n).padStart(3, '0'));
const fmtTime = (t: number | null) => (t ? new Date(t).toLocaleTimeString('ko-KR') : '—');

const STATUS_TEXT: Record<string, string> = { current: '진행 중', pending: '대기', done: '완료', skipped: '건너뜀' };

export default function WatchTest({
  subscription,
  onError,
  onLocked,
}: {
  subscription: PushSubscription | null;
  onError: (msg: string) => void;
  onLocked: () => void;
}) {
  const [moduleId, setModuleId] = useState<'nanacore' | 'demo'>('nanacore');
  const [nickname, setNickname] = useState('');
  const [intervalSec, setIntervalSec] = useState(30);
  const [aheadAtMost, setAheadAtMost] = useState('');
  const [job, setJob] = useState<LocalJob | null>(null);
  const [view, setView] = useState<JobView | null>(null);
  const [busy, setBusy] = useState(false);

  const handle = useCallback(
    (e: unknown) => {
      if (e instanceof UnauthorizedError) return onLocked();
      if (e instanceof JobGoneError) {
        setJob(null);
        setView(null);
      }
      onError(e instanceof Error ? e.message : String(e));
    },
    [onError, onLocked],
  );

  const refresh = useCallback(async (j: LocalJob) => {
    try {
      setView(await getJobView(j));
    } catch (e) {
      handle(e);
    }
  }, [handle]);

  useEffect(() => {
    getLocalJob().then((j) => {
      if (j) {
        setJob(j);
        refresh(j);
      }
    });
  }, [refresh]);

  // 화면이 보이는 동안만 5초마다 갱신 (배터리 절약)
  useEffect(() => {
    if (!job) return;
    const tick = () => document.visibilityState === 'visible' && refresh(job);
    const t = setInterval(tick, 5000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [job, refresh]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      handle(e);
    } finally {
      setBusy(false);
    }
  }

  const onStart = () =>
    run(async () => {
      if (!subscription) throw new Error('먼저 위에서 알림을 켜 주세요.');
      const n = aheadAtMost.trim() === '' ? null : Number(aheadAtMost);
      if (n != null && (!Number.isInteger(n) || n < 0)) throw new Error('인원 수는 0 이상의 숫자로 입력해 주세요.');
      const r = await startJob({
        moduleId,
        nickname: moduleId === 'nanacore' ? nickname : undefined,
        intervalSec: moduleId === 'demo' ? 15 : intervalSec,
        conditions: { aheadAtMost: n },
        subscription,
      });
      setJob(r.job);
      setView(r.view);
      setTimeout(() => refresh(r.job), 3000);
    });

  if (!job) {
    return (
      <section className="card">
        <h2>
          <ListOrdered size={18} aria-hidden /> 대기 순번 감시
        </h2>
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={moduleId === 'nanacore'} onClick={() => setModuleId('nanacore')}>
            나나코어
          </button>
          <button role="tab" aria-selected={moduleId === 'demo'} onClick={() => setModuleId('demo')}>
            데모 (연습용)
          </button>
        </div>

        {moduleId === 'nanacore' ? (
          <div className="form">
            <label className="field">
              <span>내 닉네임 (유튜브 채널 닉네임)</span>
              <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="대기열에 표시되는 이름" autoComplete="off" />
              <small>닉네임은 이 휴대폰에만 저장되고, 서버에는 알아볼 수 없는 해시값만 보내요.</small>
            </label>
            <label className="field">
              <span>확인 주기</span>
              <select value={intervalSec} onChange={(e) => setIntervalSec(Number(e.target.value))}>
                <option value={15}>15초</option>
                <option value={30}>30초</option>
                <option value={60}>1분</option>
                <option value={180}>3분</option>
                <option value={300}>5분</option>
              </select>
            </label>
          </div>
        ) : (
          <p className="hint">방송이 없어도 15초마다 한 칸씩 진행되는 가짜 대기열이에요. 앞에 3명 → 내 차례 → 완료까지 약 1분 30초 걸려요. 화면을 끄고 알림이 오는지 확인해 보세요.</p>
        )}

        <label className="field">
          <span>“앞에 N명” 알림 시작 기준 (비우면 줄어들 때마다)</span>
          <input value={aheadAtMost} onChange={(e) => setAheadAtMost(e.target.value)} inputMode="numeric" placeholder="예: 5" />
        </label>

        <button className="primary" disabled={busy || !subscription} onClick={onStart}>
          <Play size={20} aria-hidden /> 감시 시작
        </button>
        {!subscription && <p className="hint err">위에서 알림을 먼저 켜야 감시를 시작할 수 있어요.</p>}
      </section>
    );
  }

  const last = view?.last;
  return (
    <section className="card">
      <h2>
        <ListOrdered size={18} aria-hidden /> {job.moduleId === 'demo' ? '데모 대기열' : '나나코어'} 감시
        <span className={`pill ${view?.running ? 'on' : 'off'}`}>{view ? (view.running ? '감시 중' : '중지됨') : '…'}</span>
      </h2>
      {job.nickname && (
        <p className="who">
          <UserRound size={15} aria-hidden /> {job.nickname}
        </p>
      )}

      <div className="bigstat">
        <div>
          <span>내 순번</span>
          <b>{last?.found ? fmtNo(last.position) : '—'}</b>
        </div>
        <div>
          <span>내 앞</span>
          <b>{last?.status === 'current' ? '내 차례' : last?.ahead != null ? `${last.ahead}명` : '—'}</b>
        </div>
        <div>
          <span>진행 중</span>
          <b>{fmtNo(last?.currentPosition)}</b>
        </div>
      </div>
      <ul className="status">
        <li>
          <span>상태</span>
          <b className={last?.found ? 'on' : 'off'}>{last ? (last.found ? STATUS_TEXT[last.status ?? 'pending'] : '명단에 없음') : '확인 전'}</b>
        </li>
        <li>
          <span>마지막 확인</span>
          <span>{fmtTime(view?.lastCheckedAt ?? null)}</span>
        </li>
        <li>
          <span>확인 주기</span>
          <span>{view ? `${view.intervalSec}초` : '—'}</span>
        </li>
        {view?.lastError && (
          <li className="err">
            <span>오류</span>
            <span>
              {view.lastError} ({view.consecutiveErrors}회)
            </span>
          </li>
        )}
      </ul>

      <div className="row">
        <button className="primary outline" disabled={busy || !view?.running} onClick={() => run(async () => setView(await checkNow(job)))}>
          <RefreshCw size={18} aria-hidden /> 지금 확인
        </button>
        {view?.running ? (
          <button className="primary outline" disabled={busy} onClick={() => run(async () => setView(await setRunning(job, false)))}>
            <CircleStop size={18} aria-hidden /> 중지
          </button>
        ) : (
          <button className="primary outline" disabled={busy} onClick={() => run(async () => setView(await setRunning(job, true)))}>
            <Play size={18} aria-hidden /> 다시 시작
          </button>
        )}
      </div>
      <button
        className="ghost danger"
        disabled={busy}
        onClick={() =>
          confirm('감시를 삭제할까요? 서버에 있는 작업도 함께 지워집니다.') &&
          run(async () => {
            await deleteJob(job);
            setJob(null);
            setView(null);
          })
        }
      >
        <Trash2 size={18} aria-hidden /> 감시 삭제
      </button>

      <h3>변경 기록</h3>
      {view?.history.length ? (
        <ul className="history">
          {view.history.map((h: HistoryItem, i) => (
            <li key={h.at + h.type + i} className={h.important ? 'important' : ''}>
              <time>{fmtTime(h.at)}</time>
              <div>
                <b>{h.title}</b>
                <span>{h.body}</span>
                {h.pushStatus == null ? <small>알림 안 보냄</small> : h.pushStatus >= 400 ? <small className="err">알림 실패 {h.pushStatus}</small> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">아직 기록이 없습니다.</p>
      )}
    </section>
  );
}
