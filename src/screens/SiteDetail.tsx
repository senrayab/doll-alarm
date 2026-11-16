// 사이트 상세 — 기본 정보, 상태, 이 사이트의 감시 목록
import { BadgeCheck, CirclePlay, CircleStop, ExternalLink, Info, Pencil, Plus, ScanSearch, ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { getSite, listWatchesBySite } from '../db/local';
import { useLive } from '../data/events';
import { canWatch, deleteSite, KIND_LABEL, recheckSite, setSiteEnabled, siteState } from '../data/sites';
import { updateWatch } from '../data/watches';
import { navigate } from '../lib/router';
import { fmtAgo, Header, SiteAvatar, SiteStatePill, Toggle } from '../ui/parts';
import { WatchCard } from './Home';
import { hostOf } from './Sites';

export default function SiteDetail({ id, onError, onInfo }: { id: string; onError: (e: unknown) => void; onInfo: (m: string) => void }) {
  const site = useLive(() => getSite(id).then((s) => s ?? null), ['sites'], [id]);
  const watches = useLive(() => listWatchesBySite(id), ['watches'], [id]);
  const [busy, setBusy] = useState(false);

  if (site === undefined) return null;
  if (site === null) {
    return (
      <>
        <Header title="사이트" back="/sites" />
        <main className="page">
          <p className="muted">사이트를 찾을 수 없어요.</p>
        </main>
      </>
    );
  }

  const running = watches?.filter((w) => w.view?.running && !w.lost) ?? [];
  const stopped = watches?.filter((w) => w.view && !w.view.running && !w.lost) ?? [];

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  const onDelete = () => {
    const n = watches?.length ?? 0;
    const msg = n
      ? `‘${site.name}’을(를) 삭제하면 연결된 감시 ${n}개와 서버 예약 작업도 함께 삭제돼요. 삭제할까요?`
      : `‘${site.name}’을(를) 삭제할까요?`;
    if (!confirm(msg)) return;
    run(async () => {
      await deleteSite(site);
      navigate('/sites', { replace: true });
    });
  };

  return (
    <>
      <Header
        title="사이트"
        back="/sites"
        right={
          <button className="round-btn" onClick={() => navigate(`/sites/${site.id}/edit`)} aria-label="수정">
            <Pencil size={20} />
          </button>
        }
      />
      <main className="page">
        <section className="card site-hero">
          <SiteAvatar site={site} size={56} />
          <div>
            <h2>{site.name}</h2>
            <small>{hostOf(site.url)}</small>
            <div className="hero-tags">
              <SiteStatePill state={siteState(site)} />
              <span className="tag">{KIND_LABEL[site.kind]}</span>
              {site.support !== 'unsupported' && <span className="tag">{site.support === 'official' ? '공식 지원' : '직접 추가'}</span>}
            </div>
          </div>
        </section>

        {site.unsupportedReason && site.support !== 'custom' && (
          <p className="note warn">
            <ShieldAlert size={16} aria-hidden />
            <span>{site.unsupportedReason}</span>
          </p>
        )}
        {site.support === 'custom' && (
          <section className="card probe-card">
            <div className={`probe-head ${site.probe?.verdict === 'ok' ? 'ok' : site.probe ? 'bad' : ''}`}>
              {site.probe?.verdict === 'ok' ? <BadgeCheck size={20} aria-hidden /> : site.probe ? <ShieldAlert size={20} aria-hidden /> : <Info size={20} aria-hidden />}
              <div>
                <b>{!site.probe ? '아직 연결을 확인하지 않았어요' : site.probe.verdict === 'ok' ? '키워드 감시를 쓸 수 있어요' : '자동 감시를 할 수 없어요'}</b>
                <small>
                  {site.needsLogin
                    ? '로그인이 필요한 사이트로 표시되어 있어요. 바로가기로 직접 확인해 주세요.'
                    : site.probe
                      ? `${site.probe.message} · ${fmtAgo(site.probe.checkedAt)} 확인`
                      : '공개 페이지인지 확인하면 키워드 감시를 쓸 수 있어요.'}
                </small>
              </div>
            </div>
            <button className="primary outline" disabled={busy || !site.url} onClick={() => run(async () => onInfo(`연결 확인 결과 · ${(await recheckSite(site)).probe?.message ?? ''}`))}>
              <ScanSearch size={18} className={busy ? 'spin' : ''} aria-hidden /> {site.probe ? '연결 다시 확인' : '연결 확인'}
            </button>
          </section>
        )}
        {site.description && <p className="desc">{site.description}</p>}

        <section className="card">
          <div className="settings-list">
            <div className="setting">
              <div>
                <b>사용</b>
                <small>{!site.enabled ? '일시 중지 — 새 감시 등록 불가' : canWatch(site) ? '새 감시를 등록할 수 있어요' : '바로가기로 사용 중'}</small>
              </div>
              <Toggle label="사용" checked={site.enabled} disabled={busy} onChange={(v) => run(() => setSiteEnabled(site, v))} />
            </div>
          </div>
          {site.url && (
            <a className="primary outline as-button" href={site.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={18} aria-hidden /> 사이트 열기
            </a>
          )}
        </section>

        <div className="section-head">
          <h3>감시 목록 {watches?.length ? `(${watches.length})` : ''}</h3>
          {watches && watches.length > 0 && (
            running.length ? (
              <button className="small-btn" disabled={busy} onClick={() => run(async () => { for (const w of running) await updateWatch(w, { running: false }); })}>
                <CircleStop size={15} aria-hidden /> 모두 중지
              </button>
            ) : (
              <button className="small-btn" disabled={busy || !stopped.length} onClick={() => run(async () => { for (const w of stopped) await updateWatch(w, { running: true }); })}>
                <CirclePlay size={15} aria-hidden /> 모두 시작
              </button>
            )
          )}
        </div>
        {watches?.length ? (
          <div className="stack">
            {watches.map((w) => (
              <WatchCard key={w.id} w={w} site={site} now={Date.now()} onError={onError} />
            ))}
          </div>
        ) : (
          <p className="muted">이 사이트에 등록된 감시가 없어요.</p>
        )}
        {canWatch(site) && (
          <button className="primary" onClick={() => navigate(`/watch/new?site=${site.id}`)}>
            <Plus size={20} aria-hidden /> {site.moduleId === 'keyword' ? '키워드 감시 추가' : '이 사이트 감시 추가'}
          </button>
        )}

        <button className="text-btn danger" disabled={busy} onClick={onDelete}>
          <Trash2 size={18} aria-hidden /> 사이트 삭제
        </button>
      </main>
    </>
  );
}
