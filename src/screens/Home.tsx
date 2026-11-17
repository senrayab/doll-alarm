// 대시보드 — 사이트별로 묶어서 한눈에 (사이트를 누르면 그 사이트의 모니터링 목록)
import { BellOff, ChevronRight, LoaderCircle, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isKeywordSnapshot, isQueueSnapshot } from '../../shared/types';
import { listSites, listWatches, type Site, type Watch } from '../db/local';
import { useLive } from '../data/events';
import { compareUrgency, headline, kindTone, refreshAll, updateWatch, watchState, watchTone, WATCH_STATE_LABEL } from '../data/watches';
import { navigate } from '../lib/router';
import { usePush } from '../push/store';
import { ddayText, typeTone, upcomingEvents } from '../data/siteEvents';
import { Aura, Crumbs } from '../ui/Aura';
import { SwipeRow } from '../ui/SwipeRow';
import { deleteSite } from '../data/sites';
import { Empty, fmtAgo, fmtNo, Header, SiteAvatar } from '../ui/parts';

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

/** 모니터링 카드 — 위: 흰 정보 영역 / 아래: 상태 색 오라 + 큰 숫자 */
/** 카드에서 바로 시작·중지 (상세로 들어가지 않고) */
function CardToggle({ w, onError }: { w: Watch; onError: (e: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  if (w.lost || !w.view) return null;
  const running = w.view.running;
  return (
    <button
      className={`card-toggle ${running ? 'on' : ''}`}
      disabled={busy}
      aria-label={running ? '모니터링 중지' : '모니터링 시작'}
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
        {/* 정해 둔 모니터링 이름 (사이트 이름은 화면 위에 이미 있음) */}
        <Crumbs items={[w.label || site?.name, WATCH_STATE_LABEL[state], fmtAgo(v?.lastCheckedAt, now)]} />
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
          {h.pre && <span className="aura-pre">{h.pre}</span>}
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
  const main = h.unit ? `${h.big}${h.unit}` : h.big;
  return h.pre ? `${h.pre.slice(0, 1)} ${main}` : main;
}

/** 홈의 사이트 카드 — 사이트마다 카드 하나. 이름, 모니터링 수, 가장 급한 상태 오라. 누르면 그 사이트 화면 */
function SiteRow({ site, watches }: { site?: Site; watches: Watch[] }) {
  const sorted = [...watches].sort(compareUrgency);
  const active = sorted.filter((w) => !w.lost && w.view?.running);
  const top: Watch | undefined = active[0];
  // 7일 안의 가장 가까운 일정
  const nextEv = site ? upcomingEvents(site).find((e) => e.at - Date.now() < 7 * 86_400_000) : undefined;
  const go = () => navigate(site ? `/sites/${site.id}` : sorted[0] ? `/watch/${sorted[0].id}` : '/');
  return (
    <button className="site-card" onClick={go}>
      <div className="sc-head">
        {site ? <SiteAvatar site={site} size={44} /> : null}
        <div className="row-main">
          <b className="name-line">
          {site?.name ?? '삭제된 사이트'}
          {nextEv && <span className={`ev-badge mini ev-${typeTone(nextEv.type)}`}>{ddayText(nextEv.at)} {nextEv.type}</span>}
        </b>
          <Crumbs items={watches.length ? [`모니터링 ${watches.length}개`, active.length ? `진행 중 ${active.length}` : '쉬는 중'] : ['아직 모니터링이 없어요']} />
        </div>
        <Aura tone={top ? kindTone(top) : 'idle'} eyes={false} className="sc-orb">
          <span className="num">{top ? shortState(top) : watches.length ? '쉼' : '추가'}</span>
        </Aura>
      </div>
    </button>
  );
}

export default function Home({ onError }: { onError: (e: unknown) => void }) {
  const watches = useLive(listWatches, ['watches']);
  const sites = useLive(listSites, ['sites']);
  const push = usePush();
  const [busy, setBusy] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  usePolling(() => refreshAll().catch(onError), 10_000);

  const siteOf = (id: string) => sites?.find((s) => s.id === id);
  const running = watches?.filter((w) => !w.lost && w.view?.running) ?? [];
  const stopped = watches?.filter((w) => !w.lost && w.view && !w.view.running) ?? [];

  // 홈은 사이트 목록 — 모든 사이트를 보여 주고, 진행 중인 것이 급한 사이트가 위로
  const bySite = (watches ?? []).reduce<Record<string, Watch[]>>((acc, w) => {
    (acc[w.siteId] ??= []).push(w);
    return acc;
  }, {});
  const siteIds = [...new Set([...(sites ?? []).map((s) => s.id), ...Object.keys(bySite)])];
  const urgencyOf = (ws: Watch[]) => {
    const act = ws.filter((w) => !w.lost && w.view?.running).sort(compareUrgency);
    return act[0] ?? null;
  };
  const groups = siteIds
    .map((siteId) => ({ siteId, watches: [...(bySite[siteId] ?? [])].sort(compareUrgency) }))
    .sort((a, b) => {
      const ua = urgencyOf(a.watches);
      const ub = urgencyOf(b.watches);
      if (ua && ub) return compareUrgency(ua, ub);
      if (ua || ub) return ua ? -1 : 1; // 진행 중인 사이트가 위로
      return b.watches.length - a.watches.length; // 그다음 모니터링이 있는 사이트
    });

  function removeSite(siteId: string, n: number) {
    const site = siteOf(siteId);
    if (!site) return;
    const msg = n
      ? `‘${site.name}’을(를) 삭제하면 연결된 모니터링 ${n}개와 서버 예약 작업도 함께 삭제돼요. 삭제할까요?`
      : `‘${site.name}’을(를) 삭제할까요?`;
    if (!confirm(msg)) return;
    deleteSite(site).catch(onError);
  }

  async function bulk(on: boolean) {
    const targets = on ? stopped : running;
    if (!targets.length) return;
    if (!on && !confirm(`모니터링 ${targets.length}개를 모두 중지할까요?`)) return;
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
        sub={sites?.length ? `사이트 ${sites.length}개 • 모니터링 중 ${running.length}` : '인형 알리미'}
        right={
          <button className="round-btn" onClick={() => navigate('/sites/new')} aria-label="사이트 추가">
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

        {watches === undefined || sites === undefined ? null : groups.length === 0 ? (
          <Empty emoji="🔔" title="아직 등록한 사이트가 없어요">
            <p>사이트를 추가하고 그 안에서 대기 순번·재입고 같은 모니터링을 추가해 보세요.</p>
            <button className="primary" onClick={() => navigate('/sites/new')}>
              <Plus size={20} aria-hidden /> 사이트 추가
            </button>
          </Empty>
        ) : (
          <>
            <div className="list stack-tight">
              {groups.map((g) => (
                <SwipeRow
                  key={g.siteId}
                  id={g.siteId}
                  openId={openRow}
                  onOpenChange={setOpenRow}
                  disabled={!siteOf(g.siteId)}
                  actions={[
                    { label: '수정', icon: <Pencil size={20} />, onClick: () => navigate(`/sites/${g.siteId}/edit`) },
                    { label: '삭제', icon: <Trash2 size={20} />, tone: 'danger', onClick: () => removeSite(g.siteId, g.watches.length) },
                  ]}
                >
                  <SiteRow site={siteOf(g.siteId)} watches={g.watches} />
                </SwipeRow>
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
