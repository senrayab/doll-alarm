// 대시보드 — 사이트별로 묶어서 한눈에 (사이트를 누르면 그 사이트의 모니터링 목록)
import { BellOff, ChevronRight, CloudMoon, GripVertical, LoaderCircle, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isKeywordSnapshot, isQueueSnapshot } from '../../shared/types';
import { getSetting, listSites, listWatches, setSetting, type Site, type Watch } from '../db/local';
import { useLive } from '../data/events';
import { compareUrgency, headline, refreshAll, updateWatch, watchTone } from '../data/watches';
import { navigate } from '../lib/router';
import { usePush } from '../push/store';
import { channelLabel, ddayText, HOLIDAY, upcomingEvents } from '../data/siteEvents';
import { Aura, Crumbs } from '../ui/Aura';
import { SwipeRow } from '../ui/SwipeRow';
import { SortableList } from '../ui/SortableList';
import { deleteSite, siteLives } from '../data/sites';
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
  const channel = w.liveIndex != null && site ? siteLives(site)[w.liveIndex]?.name : undefined;
  const holidayToday = !!w.view?.skipDates?.includes(new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10));
  const v = w.view;
  const anyLast = v?.last;
  const last = isQueueSnapshot(anyLast) ? anyLast : null;
  const kw = isKeywordSnapshot(anyLast) ? anyLast : null;
  const isKw = w.moduleId === 'keyword';
  const h = headline(w);
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
        {/* 이름 · 채널 · 마지막 확인 (상태는 아래 큰 글씨와 시작·중지 버튼으로 보임) */}
        <div className="wc-crumbs">
          <Crumbs items={[w.label || site?.name, channel, fmtAgo(v?.lastCheckedAt, now)]} />
          {/* 오늘 휴방 — 글자는 아래에 이미 있으니 아이콘 칩만 */}
          {holidayToday && (
            <span className="holiday-pill" role="img" aria-label="오늘 휴방" title="오늘 휴방">
              <CloudMoon size={14} strokeWidth={2.2} />
            </span>
          )}
        </div>
        <h2>
          {w.nickname || w.label}
          {!!last?.mineCount && <span className="order-count">주문 {last.mineCount}건</span>}
        </h2>
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


/** 홈의 사이트 카드 — 사이트마다 카드 하나. 이름, 가까운 일정, 모니터링 수. 누르면 그 사이트 화면 */
function SiteRow({ site, watches }: { site?: Site; watches: Watch[] }) {
  const sorted = [...watches].sort(compareUrgency);
  const active = sorted.filter((w) => !w.lost && w.view?.running);
  // 7일 안의 가장 가까운 일정
  // 매주 반복 일정은 오늘·내일일 때만 (D-5 같은 건 매주라 굳이 필요 없음)
  const nextEv = site
    ? upcomingEvents(site).find((e) => e.at - Date.now() < 7 * 86_400_000 && (e.repeat !== 'weekly' || !ddayText(e.at).startsWith('D-')))
    : undefined;
  // 채널이 여럿인 사이트면 어느 채널 일정인지
  const evChannel = site && nextEv ? channelLabel(site, nextEv) || undefined : undefined;
  const go = () => navigate(site ? `/sites/${site.id}` : sorted[0] ? `/watch/${sorted[0].id}` : '/');
  return (
    <button className="site-card" onClick={go}>
      <div className="sc-head">
        {site ? <SiteAvatar site={site} size={44} /> : null}
        <div className="row-main">
          <b className="name-line">
          {site?.name ?? '삭제된 사이트'}
          {nextEv && (
            <span className="ev-badge mini ev-gray">
              {/* 휴방은 시각이 의미 없어서 날짜만 ("오늘 1호점 휴방") */}
              {nextEv.type === HOLIDAY || nextEv.allDay ? ddayText(nextEv.at).replace(/ \d{2}:\d{2}$/, '') : ddayText(nextEv.at)} {evChannel ? `${evChannel} ` : ''}
              {nextEv.type}
            </span>
          )}
        </b>
          <Crumbs items={watches.length ? [`모니터링 ${watches.length}개`, active.length ? `진행 중 ${active.length}` : '쉬는 중'] : ['아직 모니터링이 없어요']} />
        </div>
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
  const [siteOrder, setSiteOrder] = useState<string[] | null>(null);
  useEffect(() => {
    getSetting<string[]>('siteOrder').then((o) => setSiteOrder(o ?? null));
  }, []);

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
    })
    // 직접 정한 순서가 있으면 그대로 (새 사이트는 뒤에)
    .map((g, i) => ({ g, i, o: siteOrder ? siteOrder.indexOf(g.siteId) : -1 }))
    .sort((a, b) => (a.o < 0 ? 1e9 + a.i : a.o) - (b.o < 0 ? 1e9 + b.i : b.o))
    .map((x) => x.g);

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
            <SortableList
              className="list stack-tight"
              ids={groups.map((g) => g.siteId)}
              onReorder={(ids) => {
                setSiteOrder(ids);
                setSetting('siteOrder', ids).catch(() => {});
              }}
              renderItem={(siteId, handle) => {
                const g = groups.find((x) => x.siteId === siteId)!;
                return (
                <SwipeRow
                  id={g.siteId}
                  openId={openRow}
                  onOpenChange={setOpenRow}
                  disabled={!siteOf(g.siteId)}
                  actions={[
                    { label: '수정', icon: <Pencil size={20} />, onClick: () => navigate(`/sites/${g.siteId}/edit`) },
                    { label: '삭제', icon: <Trash2 size={20} />, tone: 'danger', onClick: () => removeSite(g.siteId, g.watches.length) },
                  ]}
                >
                  <div className="site-row-wrap">
                    <SiteRow site={siteOf(g.siteId)} watches={g.watches} />
                    {/* 오른쪽 손잡이를 잡고 위아래로 끌면 순서 바꾸기 */}
                    <span role="button" tabIndex={-1} {...handle}>
                      <GripVertical size={20} />
                    </span>
                  </div>
                </SwipeRow>
                );
              }}
            />
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
