// 대시보드 — 사이트별로 묶어서 한눈에 (사이트를 누르면 그 사이트의 감시 목록)
import { BellOff, ChevronRight, LoaderCircle, Pause, Play, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isKeywordSnapshot, isQueueSnapshot } from '../../shared/types';
import { listSites, listWatches, type Site, type Watch } from '../db/local';
import { useLive } from '../data/events';
import { compareUrgency, headline, refreshAll, updateWatch, watchState, watchTone, WATCH_STATE_LABEL } from '../data/watches';
import { navigate } from '../lib/router';
import { usePush } from '../push/store';
import { Aura, Crumbs } from '../ui/Aura';
import { Empty, fmtAgo, fmtNo, Header } from '../ui/parts';

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** 화면이 보이는 동안만 주기적으로 서버 상태 갱신 */
export function usePolling(fn: () => void, ms: number) {
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && fn();
    tick();
    const t = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms]);
}

/** 감시 카드 — 위: 흰 정보 영역 / 아래: 상태 색 오라 + 큰 숫자 */
/** 카드에서 바로 시작·중지 (상세로 들어가지 않고) */
function CardToggle({ w, onError }: { w: Watch; onError: (e: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  if (w.lost || !w.view) return null;
  const running = w.view.running;
  return (
    <button
      className={`card-toggle ${running ? 'on' : ''}`}
      disabled={busy}
      aria-label={running ? '감시 중지' : '감시 시작'}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          await updateWatch(w, { running: !running });
        } catch (err) {
          onError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <LoaderCircle size={18} className="spin" /> : running ? <Pause size={18} /> : <Play size={18} />}
    </button>
  );
}

export function WatchCard({ w, site, now, onError }: { w: Watch; site?: Site; now: number; onError: (e: unknown) => void }) {
  const v = w.view;
  const anyLast = v?.last;
  const last = isQueueSnapshot(anyLast) ? anyLast : null;
  const kw = isKeywordSnapshot(anyLast) ? anyLast : null;
  const isKw = w.moduleId === 'keyword';
  const h = headline(w);
  const state = watchState(w);
  return (
    <div
      className="watch-card"
      role="link"
      tabIndex={0}
      onClick={() => navigate(`/watch/${w.id}`)}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/watch/${w.id}`)}
    >
      <div className="wc-head">
        <CardToggle w={w} onError={onError} />
        <Crumbs items={[site?.name ?? '삭제된 사이트', WATCH_STATE_LABEL[state], fmtAgo(v?.lastCheckedAt, now)]} />
        <h2>{w.nickname || w.label}</h2>
        {isKw && w.target && <p className="crumbs">{w.target.keywords.map((k) => `‘${k}’`).join(' ')}</p>}
        <div className="wc-meta">
          {isKw ? (
            <>
              <span>
                키워드 <b className="num">{w.target?.keywords.length ?? 0}</b>
              </span>
              <span className={`tone-dot tone-${watchTone(w)}`} aria-hidden />
              <span>
                발견 <b className="num">{kw ? kw.found.length : '—'}</b>
              </span>
            </>
          ) : (
            <>
              <span>
                내 순번 <b className="num">{last?.found ? fmtNo(last.position) : '—'}</b>
              </span>
              <span className={`tone-dot tone-${watchTone(w)}`} aria-hidden />
              <span>
                진행 <b className="num">{fmtNo(last?.currentPosition)}</b>
              </span>
            </>
          )}
          <span className="wc-more">
            자세히 <ChevronRight size={14} aria-hidden />
          </span>
        </div>
      </div>
      <Aura tone={watchTone(w)}>
        <div className="aura-text">
          <b className="num">{h.big}</b>
          {h.unit && <span>{h.unit}</span>}
        </div>
      </Aura>
    </div>
  );
}


/** 짧은 상태 문구 — "3명 전", "다음", "발견!" */
function shortState(w: Watch) {
  const h = headline(w);
  return h.unit ? `${h.big}${h.unit}` : h.big;
}

/** 사이트별 묶음 카드 — 누르면 그 사이트 화면(감시 목록)으로 */
function SiteGroupCard({ site, watches, now, onError }: { site?: Site; watches: Watch[]; now: number; onError: (e: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const sorted = [...watches].sort(compareUrgency);
  const top = sorted[0];
  const h = headline(top);
  const live = watches.filter((w) => !w.lost && w.view);
  const running = live.filter((w) => w.view!.running);
  const lastChecked = Math.max(0, ...watches.map((w) => w.view?.lastCheckedAt ?? 0));
  const go = () => navigate(site ? `/sites/${site.id}` : `/watch/${top.id}`);

  async function toggleAll(e: React.MouseEvent) {
    e.stopPropagation();
    const on = running.length === 0;
    const targets = on ? live : running;
    if (!on && targets.length > 1 && !confirm(`${site?.name ?? '이 사이트'}의 감시 ${targets.length}개를 모두 중지할까요?`)) return;
    setBusy(true);
    try {
      for (const w of targets) await updateWatch(w, { running: on });
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="watch-card" role="link" tabIndex={0} onClick={go} onKeyDown={(e) => e.key === 'Enter' && go()}>
      <div className="wc-head">
        {live.length > 0 && (
          <button className={`card-toggle ${running.length ? 'on' : ''}`} disabled={busy} aria-label={running.length ? '모두 중지' : '모두 시작'} onClick={toggleAll}>
            {busy ? <LoaderCircle size={18} className="spin" /> : running.length ? <Pause size={18} /> : <Play size={18} />}
          </button>
        )}
        <Crumbs items={[`알림 ${watches.length}개`, running.length ? `진행 중 ${running.length}` : '모두 중지', fmtAgo(lastChecked || null, now)]} />
        <h2>{site?.name ?? '삭제된 사이트'}</h2>
        <div className="group-items">
          {sorted.slice(0, 3).map((w) => (
            <span key={w.id} className="group-item">
              <i className={`tone-dot tone-${watchTone(w)}`} aria-hidden />
              <b>{w.nickname || w.label}</b>
              <span className="num">{shortState(w)}</span>
            </span>
          ))}
          {sorted.length > 3 && <span className="group-more">외 {sorted.length - 3}개</span>}
        </div>
      </div>
      <Aura tone={watchTone(top)}>
        <div className="aura-caption">{top.nickname || top.label}</div>
        <div className="aura-text">
          <b className="num">{h.big}</b>
          {h.unit && <span>{h.unit}</span>}
        </div>
      </Aura>
    </div>
  );
}

export default function Home({ onError }: { onError: (e: unknown) => void }) {
  const watches = useLive(listWatches, ['watches']);
  const sites = useLive(listSites, ['sites']);
  const push = usePush();
  const now = useNow(5000);
  const [busy, setBusy] = useState(false);

  usePolling(() => refreshAll().catch(onError), 10_000);

  const siteOf = (id: string) => sites?.find((s) => s.id === id);
  const running = watches?.filter((w) => !w.lost && w.view?.running) ?? [];
  const stopped = watches?.filter((w) => !w.lost && w.view && !w.view.running) ?? [];

  // 사이트별로 묶고, 급한 사이트가 위로
  const groups = Object.values(
    (watches ?? []).reduce<Record<string, { siteId: string; watches: Watch[] }>>((acc, w) => {
      (acc[w.siteId] ??= { siteId: w.siteId, watches: [] }).watches.push(w);
      return acc;
    }, {}),
  )
    .map((g) => ({ ...g, watches: [...g.watches].sort(compareUrgency) }))
    .sort((a, b) => compareUrgency(a.watches[0], b.watches[0]));

  async function bulk(on: boolean) {
    const targets = on ? stopped : running;
    if (!targets.length) return;
    if (!on && !confirm(`감시 ${targets.length}개를 모두 중지할까요?`)) return;
    setBusy(true);
    try {
      for (const w of targets) await updateWatch(w, { running: on });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header
        title="내 알림 목록"
        sub={watches?.length ? `감시 중 ${running.length} • 중지 ${stopped.length}` : '인형 알리미'}
        right={
          <button className="round-btn" onClick={() => navigate('/watch/new')} aria-label="감시 추가">
            <Plus size={22} />
          </button>
        }
      />
      <main className="page">
        {push.ready && !push.subscription && (
          <button className="notice" onClick={() => navigate('/settings')}>
            <BellOff size={18} aria-hidden />
            <span>알림이 꺼져 있어요. 눌러서 켜 주세요.</span>
            <ChevronRight size={16} aria-hidden />
          </button>
        )}

        {watches === undefined ? null : watches.length === 0 ? (
          <Empty emoji="🔔" title="아직 감시 중인 항목이 없어요">
            <p>사이트를 추가하고 내 닉네임을 넣으면, 순번이 다가오거나 차례가 올 때 알려 드려요.</p>
            <button className="primary" onClick={() => navigate('/watch/new')}>
              <Plus size={20} aria-hidden /> 감시 추가
            </button>
          </Empty>
        ) : (
          <>
            <div className="stack">
              {groups.map((g) => (
                <SiteGroupCard key={g.siteId} site={siteOf(g.siteId)} watches={g.watches} now={now} onError={onError} />
              ))}
            </div>
            {running.length > 0 ? (
              <button className="text-btn" disabled={busy} onClick={() => bulk(false)}>
                모두 중지
              </button>
            ) : stopped.length > 0 ? (
              <button className="text-btn" disabled={busy} onClick={() => bulk(true)}>
                모두 다시 시작
              </button>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}
