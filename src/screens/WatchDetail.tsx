// 감시 상세 — 진행 링, 상태, 변경 이력, 조건·주기·예약 변경, 시작·중지·삭제
import { ChevronDown, Link2Off, Pause, Play, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { QueueConditions, Schedule } from '../../shared/types';
import { getSite, getWatch } from '../db/local';
import { useLive } from '../data/events';
import { MODULE_MIN_INTERVAL } from '../data/sites';
import { checkWatchNow, headline, refreshWatch, removeWatch, updateWatch, watchState, watchTone, WATCH_STATE_LABEL } from '../data/watches';
import { navigate } from '../lib/router';
import { Aura, Crumbs, PillBar, Ring } from '../ui/Aura';
import { fmtAgo, fmtInterval, fmtNo, fmtTime, Header } from '../ui/parts';
import { ConditionsEditor, IntervalPicker, ScheduleEditor } from '../ui/WatchSettings';
import { usePolling } from './Home';

const STATUS_TEXT: Record<string, string> = { current: '진행 중', pending: '대기', done: '완료', skipped: '건너뜀' };

function Editor({
  init,
  min,
  fixedInterval,
  onSave,
}: {
  init: { conditions: QueueConditions; intervalSec: number; schedule: Schedule | null; label: string };
  min: number;
  fixedInterval: boolean;
  onSave: (v: typeof init) => Promise<void>;
}) {
  const [v, setV] = useState(init);
  const [busy, setBusy] = useState(false);
  return (
    <div className="editor">
      <label className="field">
        <span>이름</span>
        <input value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} maxLength={30} />
      </label>
      <h4>알림 받을 조건</h4>
      <ConditionsEditor value={v.conditions} onChange={(conditions) => setV({ ...v, conditions })} />
      {!fixedInterval && (
        <>
          <h4>확인 주기</h4>
          <IntervalPicker value={v.intervalSec} min={min} onChange={(intervalSec) => setV({ ...v, intervalSec })} />
        </>
      )}
      <h4>감시 시간</h4>
      <ScheduleEditor value={v.schedule} onChange={(schedule) => setV({ ...v, schedule })} />
      <button
        className="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onSave(v);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Save size={18} aria-hidden /> 변경 저장
      </button>
    </div>
  );
}

export default function WatchDetail({ id, onError }: { id: string; onError: (e: unknown) => void }) {
  const w = useLive(() => getWatch(id).then((x) => x ?? null), ['watches'], [id]);
  const site = useLive(async () => (w ? ((await getSite(w.siteId)) ?? null) : null), ['sites'], [w?.siteId]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [, force] = useState(0);

  usePolling(() => {
    getWatch(id).then((x) => {
      if (x && !x.lost) refreshWatch(x).catch(onError);
    });
    force((n) => n + 1);
  }, 5000);

  if (w === undefined) return null;
  if (w === null) {
    return (
      <>
        <Header title="감시" back="/" />
        <main className="page">
          <p className="muted">감시를 찾을 수 없어요. 이미 삭제되었을 수 있어요.</p>
        </main>
      </>
    );
  }

  const v = w.view;
  const last = v?.last;
  const state = watchState(w);
  const tone = watchTone(w);
  const h = headline(w);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header
        title={w.label}
        back="/"
        right={
          !w.lost && v?.running ? (
            <button className="round-btn" disabled={busy} onClick={() => run(() => checkWatchNow(w))} aria-label="지금 확인">
              <RefreshCw size={18} className={busy ? 'spin' : ''} />
            </button>
          ) : null
        }
      />
      <main className="page">
        {w.lost && (
          <p className="note warn">
            <Link2Off size={16} aria-hidden />
            <span>서버에서 이 감시 작업이 사라졌어요 (알림 연결 만료 등). 삭제한 뒤 다시 등록해 주세요.</span>
          </p>
        )}

        <section className="detail-hero">
          <Aura tone={tone} eyes={false} className="aura-full">
            <Crumbs items={[site?.name ?? '삭제된 사이트', WATCH_STATE_LABEL[state], w.nickname]} />
            <Ring ahead={last?.ahead ?? null} current={last?.status === 'current'}>
              <b className="num">{h.big}</b>
              <span>{h.unit ?? h.sub}</span>
            </Ring>
            <p className="hero-sub">{h.unit ? h.sub : fmtAgo(v?.lastCheckedAt)}</p>
          </Aura>
          {!w.lost && (
            <PillBar
              left={{ value: last?.found ? fmtNo(last.position) : '—', label: '내 순번' }}
              right={{ value: fmtNo(last?.currentPosition), label: '진행 중' }}
            >
              {v?.running ? (
                <button disabled={busy} onClick={() => run(() => updateWatch(w, { running: false }))}>
                  <Pause size={16} aria-hidden /> 감시 중지
                </button>
              ) : (
                <button disabled={busy} onClick={() => run(() => updateWatch(w, { running: true }))}>
                  <Play size={16} aria-hidden /> 다시 시작
                </button>
              )}
            </PillBar>
          )}
        </section>

        <section className="card">
          <ul className="info">
            <li>
              <span>상태</span>
              <span>{last ? (last.found ? STATUS_TEXT[last.status ?? 'pending'] : '명단에 없음') : '확인 전'}</span>
            </li>
            <li>
              <span>마지막 확인</span>
              <span className="num">{fmtTime(v?.lastCheckedAt)}</span>
            </li>
            {v?.running && v.nextCheckAt && (
              <li>
                <span>다음 확인</span>
                <span className="num">
                  {v.inWindow ? fmtTime(v.nextCheckAt) : new Date(v.nextCheckAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </li>
            )}
            <li>
              <span>확인 주기</span>
              <span>{fmtInterval(w.intervalSec)}</span>
            </li>
            <li>
              <span>감시 시간</span>
              <span>{w.schedule ? `매일 ${w.schedule.start} ~ ${w.schedule.end}` : '시작 후 최대 24시간'}</span>
            </li>
            {v?.lastError && (
              <li className="err">
                <span>오류</span>
                <span>
                  {v.lastError} ({v.consecutiveErrors}회)
                </span>
              </li>
            )}
          </ul>
        </section>

        {!w.lost && (
          <section className="card">
            <button className="disclosure" aria-expanded={editing} onClick={() => setEditing(!editing)}>
              <span>알림 조건 · 주기 · 감시 시간</span>
              <ChevronDown size={18} aria-hidden />
            </button>
            {editing && (
              <Editor
                init={{ conditions: w.conditions, intervalSec: w.intervalSec, schedule: w.schedule, label: w.label }}
                min={MODULE_MIN_INTERVAL[w.moduleId] ?? 60}
                fixedInterval={w.moduleId === 'demo'}
                onSave={(nv) =>
                  run(async () => {
                    await updateWatch(w, nv);
                    setEditing(false);
                  })
                }
              />
            )}
          </section>
        )}

        <h3 className="section-title">최근 변경</h3>
        {v?.history.length ? (
          <ol className="timeline card">
            {v.history.map((h, i) => (
              <li key={h.at + h.type + i} className={h.important ? 'important' : ''}>
                <i className="tl-dot" aria-hidden />
                <div>
                  <div className="tl-head">
                    <b>{h.title}</b>
                    <time className="num">{fmtTime(h.at)}</time>
                  </div>
                  <span>{h.body}</span>
                  {h.pushStatus == null ? (
                    <small>알림 안 보냄</small>
                  ) : h.pushStatus === 0 || h.pushStatus >= 400 ? (
                    <small className="err">알림 발송 실패{h.pushStatus ? ` (${h.pushStatus})` : ''}</small>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">아직 변경 이력이 없어요.</p>
        )}

        <button
          className="text-btn danger"
          disabled={busy}
          onClick={() =>
            confirm('이 감시를 삭제할까요? 서버의 예약 작업도 함께 지워져요.') &&
            run(async () => {
              await removeWatch(w);
              navigate('/', { replace: true });
            })
          }
        >
          <Trash2 size={16} aria-hidden /> 감시 삭제
        </button>
      </main>
    </>
  );
}
