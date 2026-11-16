// 대시보드 — 등록된 감시 전체를 한눈에
import { BellOff, ChevronRight, CirclePlay, CircleStop, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { listSites, listWatches, type Site, type Watch } from '../db/local';
import { useLive } from '../data/events';
import { refreshAll, updateWatch, watchState } from '../data/watches';
import { navigate } from '../lib/router';
import { usePush } from '../push/store';
import { Empty, fmtAgo, fmtNo, Header, SiteAvatar, WatchStatePill } from '../ui/parts';

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

export function WatchCard({ w, site, now }: { w: Watch; site?: Site; now: number }) {
  const v = w.view;
  const last = v?.last;
  const recent = v?.history[0];
  return (
    <button className="watch-card" onClick={() => navigate(`/watch/${w.id}`)}>
      <div className="wc-top">
        {site && <SiteAvatar site={site} size={36} />}
        <div className="wc-name">
          <b>{w.label}</b>
          <small>
            {site?.name ?? '삭제된 사이트'}
            {w.nickname ? ` · ${w.nickname}` : ''}
          </small>
        </div>
        <WatchStatePill state={watchState(w)} />
      </div>
      <div className="wc-stats">
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
      <div className="wc-foot">
        <span className="wc-recent">{recent ? `${recent.title} · ${recent.body.split('\n')[0]}` : last && !last.found ? '대기열에서 아직 못 찾았어요' : '첫 확인을 기다리는 중'}</span>
        <span className="wc-time">{fmtAgo(v?.lastCheckedAt, now)}</span>
        <ChevronRight size={16} aria-hidden />
      </div>
    </button>
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
        title="순번 알리미"
        right={
          <button className="icon-btn" onClick={() => navigate('/watch/new')} aria-label="감시 추가">
            <Plus size={24} />
          </button>
        }
      />
      <main className="page">
        {push.ready && !push.subscription && (
          <button className="banner warn" onClick={() => navigate('/settings')}>
            <BellOff size={18} aria-hidden />
            <span>알림이 꺼져 있어요. 눌러서 알림을 켜 주세요.</span>
            <ChevronRight size={16} aria-hidden />
          </button>
        )}

        {watches && watches.length > 0 && (
          <div className="summary">
            <div>
              <b>{running.length}</b>
              <span>감시 중</span>
            </div>
            <div>
              <b>{stopped.length}</b>
              <span>중지됨</span>
            </div>
            <div className="summary-actions">
              {running.length > 0 ? (
                <button className="small-btn" disabled={busy} onClick={() => bulk(false)}>
                  <CircleStop size={16} aria-hidden /> 모두 중지
                </button>
              ) : (
                <button className="small-btn" disabled={busy || !stopped.length} onClick={() => bulk(true)}>
                  <CirclePlay size={16} aria-hidden /> 모두 시작
                </button>
              )}
            </div>
          </div>
        )}

        {watches === undefined ? null : watches.length === 0 ? (
          <Empty emoji="🔔" title="아직 감시 중인 항목이 없어요">
            <p>사이트를 추가하고 내 닉네임을 넣으면, 순번이 바뀌거나 차례가 올 때 알려 드려요.</p>
            <button className="primary" onClick={() => navigate('/watch/new')}>
              <Plus size={20} aria-hidden /> 감시 추가
            </button>
          </Empty>
        ) : (
          <div className="stack">
            {watches.map((w) => (
              <WatchCard key={w.id} w={w} site={siteOf(w.siteId)} now={now} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
