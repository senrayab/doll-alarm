// 사이트 상세 — 기본 정보, 상태, 이 사이트의 모니터링 목록
import { BadgeCheck, CirclePlay, CircleStop, ExternalLink, Info, LoaderCircle, Pause, Pencil, Play, Plus, ShieldAlert, SquarePlay, Trash2 } from 'lucide-react';
import { isKeywordSnapshot } from '../../shared/types';
import { useState } from 'react';
import { getSite, listWatchesBySite, type Watch } from '../db/local';
import { useLive } from '../data/events';
import { canWatch, deleteSite, KIND_LABEL, recheckSite, setSiteEnabled, siteState, WATCH_KIND_LABEL, watchTypesFor } from '../data/sites';
import { compareUrgency, headline, refreshWatch, updateWatch, watchKind, watchTone } from '../data/watches';
import { navigate } from '../lib/router';
import { Aura, type AuraTone } from '../ui/Aura';
import { fmtAgo, Header, SiteAvatar, SiteStatePill, Toggle } from '../ui/parts';
import { KIND_ICON, Sheet, TypeList } from '../ui/TypeList';
import { usePolling, WatchCard } from './Home';
import { hostOf } from './Sites';

/** 위젯 색 — 켜져 있으면 종류 색, 꺼지면 회색, 오류·연결 끊김이면 빨강 */
function tileTone(w: Watch): AuraTone {
  const t = watchTone(w);
  if (t === 'alert') return 'alert';
  if (!w.view?.running) return 'idle';
  return `k-${watchKind(w)}`;
}

/** 키워드 계열(상품 상태·신규 상품·재입고·기타) 네모 위젯 */
export function KeywordTile({ w, onError }: { w: Watch; onError: (e: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const kind = watchKind(w);
  const Icon = KIND_ICON[kind];
  const h = headline(w);
  const kw = isKeywordSnapshot(w.view?.last) ? w.view!.last : null;
  const running = !!w.view?.running;
  return (
    <div className="kw-tile" role="link" tabIndex={0} onClick={() => navigate(`/watch/${w.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/watch/${w.id}`)}>
      {/* 켜져 있으면 종류 색, 꺼지면 회색, 오류면 빨강. 키워드를 찾으면 같은 색이 진해짐 */}
      <Aura tone={tileTone(w)} eyes={false} className={`tile-aura ${kw?.found.length && running ? 'is-found' : ''}`}>
        <div className="tile-top">
          <span className="tile-kind">
            <Icon size={13} aria-hidden /> {WATCH_KIND_LABEL[kind]}
          </span>
          {!w.lost && w.view && (
            <button
              className={`tile-toggle ${running ? 'on' : ''}`}
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
              {busy ? <LoaderCircle size={14} className="spin" /> : running ? <Pause size={14} /> : <Play size={14} />}
            </button>
          )}
        </div>
        <b className="tile-big num">{h.big}</b>
        <div className="tile-name">{w.label}</div>
        {/* 키워드를 작게 바로 보여 줌 — 지금 페이지에 있는 건 핑크 */}
        <div className="tile-kws">
          {(w.target?.keywords ?? []).slice(0, 3).map((k) => (
            <span key={k} className={`kw-mini ${kw?.found.includes(k) ? 'found' : ''}`}>
              {k}
            </span>
          ))}
          {(w.target?.keywords.length ?? 0) > 3 && <span className="kw-mini more">+{w.target!.keywords.length - 3}</span>}
        </div>
      </Aura>
    </div>
  );
}

export default function SiteDetail({ id, onError, onInfo }: { id: string; onError: (e: unknown) => void; onInfo: (m: string) => void }) {
  const site = useLive(() => getSite(id).then((s) => s ?? null), ['sites'], [id]);
  const watches = useLive(() => listWatchesBySite(id), ['watches'], [id]);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  // 화면이 보이는 동안 이 사이트 모니터링들의 서버 상태를 10초마다 새로
  usePolling(() => {
    listWatchesBySite(id).then((ws) => ws.filter((w) => !w.lost).forEach((w) => refreshWatch(w).catch(onError)));
  }, 10_000);

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

  const sortedWatches = [...(watches ?? [])].sort(compareUrgency);
  const queueWatches = sortedWatches.filter((w) => watchKind(w) === 'queue');
  const tileWatches = sortedWatches.filter((w) => watchKind(w) !== 'queue');
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
      ? `‘${site.name}’을(를) 삭제하면 연결된 모니터링 ${n}개와 서버 예약 작업도 함께 삭제돼요. 삭제할까요?`
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
          {(site.url || site.liveUrl) && (
            <div className="hero-links">
              {site.url && (
                <a className="link-pill" href={site.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={15} aria-hidden /> 사이트
                </a>
              )}
              {site.liveUrl && (
                <a className="link-pill live" href={site.liveUrl} target="_blank" rel="noopener noreferrer">
                  <SquarePlay size={16} aria-hidden /> 라이브
                </a>
              )}
            </div>
          )}
        </section>

        <div className="section-head">
          <h3>모니터링 목록 {watches?.length ? `(${watches.length})` : ''}</h3>
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
        {queueWatches.length > 0 && (
          <div className="stack">
            {queueWatches.map((w) => (
              <WatchCard key={w.id} w={w} site={site} now={Date.now()} onError={onError} />
            ))}
          </div>
        )}
        {(tileWatches.length > 0 || canWatch(site)) && (
          <div className="tile-grid">
            {tileWatches.map((w) => (
              <KeywordTile key={w.id} w={w} onError={onError} />
            ))}
            {canWatch(site) && (
              <button className="add-tile" onClick={() => setPicking(true)}>
                <span className="add-icon" aria-hidden>
                  <Plus size={22} />
                </span>
                <b>모니터링 추가</b>
                <small>대기 순번 · 재입고 · 상품</small>
              </button>
            )}
          </div>
        )}
        {!watches?.length && !canWatch(site) && <p className="muted">이 사이트에 등록된 모니터링이 없어요.</p>}
        {picking && (
          <Sheet title="어떤 걸 모니터링할까요?" onClose={() => setPicking(false)}>
            <TypeList types={watchTypesFor(site)} onPick={(t) => navigate(`/watch/new?site=${site.id}&type=${t.kind}`)} />
          </Sheet>
        )}


        <h3 className="section-title">사이트 정보</h3>
        {site.unsupportedReason && site.support !== 'custom' && (
          <p className="note warn">
            <ShieldAlert size={16} aria-hidden />
            <span>{site.unsupportedReason}</span>
          </p>
        )}
        {site.description && <p className="desc">{site.description}</p>}
        <section className="card compact-card">
          <div className="settings-list">
            {site.support === 'custom' && (
              <div className="setting">
                <div>
                  <b className="with-icon">
                    {site.probe?.verdict === 'ok' ? <BadgeCheck size={15} className="ok-icon" aria-hidden /> : site.probe ? <ShieldAlert size={15} className="bad-icon" aria-hidden /> : <Info size={15} aria-hidden />}
                    연결 상태
                  </b>
                  <small>
                    {site.needsLogin
                      ? '로그인이 필요한 사이트로 표시되어 있어요'
                      : site.probe
                        ? `${site.probe.verdict === 'ok' ? '공개 페이지' : site.probe.message} · ${fmtAgo(site.probe.checkedAt)} 확인`
                        : '아직 확인하지 않았어요'}
                  </small>
                </div>
                <button className="link-btn" disabled={busy || !site.url} onClick={() => run(async () => onInfo(`연결 확인 결과 · ${(await recheckSite(site)).probe?.message ?? ''}`))}>
                  {busy ? '확인 중…' : site.probe ? '다시 확인' : '확인'}
                </button>
              </div>
            )}
            <div className="setting">
              <div>
                <b>사용</b>
                <small>{!site.enabled ? '일시 중지 — 새 모니터링 등록 불가' : '새 모니터링을 등록할 수 있어요'}</small>
              </div>
              <Toggle label="사용" checked={site.enabled} disabled={busy} onChange={(v) => run(() => setSiteEnabled(site, v))} />
            </div>
          </div>
        </section>

        <button className="text-btn danger" disabled={busy} onClick={onDelete}>
          <Trash2 size={18} aria-hidden /> 사이트 삭제
        </button>
      </main>
    </>
  );
}
