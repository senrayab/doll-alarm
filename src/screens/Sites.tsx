// 사이트 목록
import { ChevronRight, Plus } from 'lucide-react';
import { listSites, listWatches } from '../db/local';
import { useLive } from '../data/events';
import { KIND_LABEL, siteState } from '../data/sites';
import { navigate } from '../lib/router';
import { Empty, fmtAgo, Header, SiteAvatar, SiteStatePill } from '../ui/parts';

export function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url || '앱 내장';
  }
}

export default function Sites() {
  const sites = useLive(listSites, ['sites']);
  const watches = useLive(listWatches, ['watches']);

  return (
    <>
      <Header
        title="사이트"
        right={
          <button className="icon-btn" onClick={() => navigate('/sites/new')} aria-label="사이트 추가">
            <Plus size={24} />
          </button>
        }
      />
      <main className="page">
        {sites === undefined ? null : sites.length === 0 ? (
          <Empty emoji="🌐" title="등록된 사이트가 없어요">
            <button className="primary" onClick={() => navigate('/sites/new')}>
              <Plus size={20} aria-hidden /> 사이트 추가
            </button>
          </Empty>
        ) : (
          <div className="list">
            {sites.map((s) => {
              const ws = watches?.filter((w) => w.siteId === s.id) ?? [];
              const active = ws.filter((w) => w.view?.running && !w.lost).length;
              const lastChecked = Math.max(0, ...ws.map((w) => w.view?.lastCheckedAt ?? 0));
              return (
                <button key={s.id} className="site-row" onClick={() => navigate(`/sites/${s.id}`)}>
                  <SiteAvatar site={s} />
                  <div className="site-main">
                    <div className="site-title">
                      <b>{s.name}</b>
                      <SiteStatePill state={siteState(s)} />
                    </div>
                    <small>{hostOf(s.url)}</small>
                    <small>
                      {KIND_LABEL[s.kind]} · 감시 {ws.length}개{active ? ` (${active}개 진행 중)` : ''}
                      {lastChecked ? ` · ${fmtAgo(lastChecked)}` : ''}
                    </small>
                  </div>
                  <ChevronRight size={18} aria-hidden />
                </button>
              );
            })}
          </div>
        )}
        <button className="primary outline" onClick={() => navigate('/sites/new')}>
          <Plus size={20} aria-hidden /> 사이트 추가
        </button>
      </main>
    </>
  );
}
