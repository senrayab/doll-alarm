// 사이트 목록
import { ChevronRight, Plus } from 'lucide-react';
import { listSites, listWatches } from '../db/local';
import { useLive } from '../data/events';
import { siteState } from '../data/sites';
import { navigate } from '../lib/router';
import { Crumbs } from '../ui/Aura';
import { Empty, Header, SiteAvatar, SiteStatePill } from '../ui/parts';

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
        sub={sites?.length ? `${sites.length}개 등록` : '모니터링할 사이트를 등록해요'}
        right={
          <button className="round-btn" onClick={() => navigate('/sites/new')} aria-label="사이트 추가">
            <Plus size={22} />
          </button>
        }
      />
      <main className="page">
        {sites === undefined ? null : sites.length === 0 ? (
          <Empty emoji="🌐" title="등록된 사이트가 없어요">
            <p>모니터링할 사이트 주소를 넣으면, 자동 모니터링을 지원하는 사이트인지 바로 알려 드려요.</p>
            <button className="primary" onClick={() => navigate('/sites/new')}>
              <Plus size={20} aria-hidden /> 사이트 추가
            </button>
          </Empty>
        ) : (
          <div className="list-card">
            {sites.map((s) => {
              const ws = watches?.filter((w) => w.siteId === s.id) ?? [];
              const active = ws.filter((w) => w.view?.running && !w.lost).length;
              return (
                <button key={s.id} className="row-item" onClick={() => navigate(`/sites/${s.id}`)}>
                  <SiteAvatar site={s} />
                  <div className="row-main">
                    <b>{s.name}</b>
                    <Crumbs items={[ws.length ? (active ? `모니터링 ${ws.length}개 · 진행 중 ${active}` : `모니터링 ${ws.length}개`) : '모니터링 없음', hostOf(s.url)]} />
                  </div>
                  <SiteStatePill state={siteState(s)} />
                  <ChevronRight size={16} className="chev" aria-hidden />
                </button>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
