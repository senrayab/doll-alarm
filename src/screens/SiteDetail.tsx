// 사이트 상세 — 기본 정보, 상태, 이 사이트의 모니터링 목록
import { Activity, BadgeCheck, CalendarHeart, CirclePlay, CircleStop, ExternalLink, Info, LoaderCircle, Pause, Pencil, Play, Plus, ShieldAlert, SquarePlay, Trash2 } from 'lucide-react';
import { isKeywordSnapshot } from '../../shared/types';
import { Fragment, useEffect, useState } from 'react';
import { getSite, listWatchesBySite, type SiteEvent, type Watch } from '../db/local';
import { HOLIDAY, msToKst, pastEvents, repeatText, syncHolidays, upcomingEvents } from '../data/siteEvents';
import { EventSheet } from '../ui/EventSheet';
import { useLive } from '../data/events';
import { canWatch, deleteSite, setSiteNickname, openInAppHref, recheckSite, siteLives, setSiteEnabled, siteState, WATCH_KIND_LABEL, watchTypesFor } from '../data/sites';
import { compareUrgency, headline, kindTone, refreshWatch, updateWatch, watchKind } from '../data/watches';
import { navigate } from '../lib/router';
import { Aura } from '../ui/Aura';
import { fmtAgo, Header, SiteAvatar, SiteStatePill, Toggle } from '../ui/parts';
import { KIND_ICON, Sheet, TypeList } from '../ui/TypeList';
import { usePolling, WatchCard } from './Home';
import { hostOf } from './Sites';

const CHIP_LIMIT = 4;
const KST = 9 * 3600 * 1000;
/** 오늘부터 며칠 뒤인지 (한국 날짜) */
const kstDayDiff = (at: number) => Math.floor((at + KST) / 86_400_000) - Math.floor((Date.now() + KST) / 86_400_000);
/** 칩 글자: 휴방은 날짜만, 나머지는 날짜 + 시각. 오늘·내일은 말로 */
function chipText(ev: SiteEvent) {
  const time = ev.type === HOLIDAY ? '' : ` ${msToKst(ev.at).time}`;
  if (ev.repeat === 'weekly') return `${repeatText(ev).replace('요일', '')}${time}`;
  const d = kstDayDiff(ev.at);
  if (d <= 0) return `오늘${time}`;
  if (d === 1) return `내일${time}`;
  return `${shortDate(ev.at)}${time}`;
}
/** "11/20(금)" */
const shortDate = (at: number) => {
  const p = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short' }).formatToParts(new Date(at));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('month')}/${g('day')}(${g('weekday')})`;
};

/** 등록할 때 자동으로 붙은 이름인지 (예전 이름 "○○ 기타"도 포함) */
function isDefaultLabel(w: Watch, siteName?: string) {
  if (!siteName) return false;
  const kind = watchKind(w);
  const names = [WATCH_KIND_LABEL[kind], kind === 'etc' ? '기타' : '', '키워드'].filter(Boolean);
  return names.some((n) => w.label.trim() === `${siteName} ${n}`);
}

/** 키워드 계열(상품 상태·신규 상품·재입고·키워드) 네모 위젯 */
export function KeywordTile({ w, siteName, onError }: { w: Watch; siteName?: string; onError: (e: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const kind = watchKind(w);
  const Icon = KIND_ICON[kind];
  const h = headline(w);
  const kw = isKeywordSnapshot(w.view?.last) ? w.view!.last : null;
  const running = !!w.view?.running;
  return (
    <div className="kw-tile" role="link" tabIndex={0} onClick={() => navigate(`/watch/${w.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/watch/${w.id}`)}>
      {/* 켜져 있으면 종류 색, 꺼지면 회색, 오류면 빨강. 키워드를 찾으면 같은 색이 진해짐 */}
      <Aura tone={kindTone(w)} eyes={false} className={`tile-aura ${kw?.found.length && running ? 'is-found' : ''}`}>
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
        {/* 자동으로 붙은 기본 이름(사이트 이름 + 종류)은 종류 표시와 겹쳐서 숨김 — 직접 바꾼 이름만 보여 줌 */}
        {!isDefaultLabel(w, siteName) && <div className="tile-name">{w.label}</div>}
        {/* 키워드는 작은 해시태그 글자로 (몇 개든 두 줄까지) — 지금 페이지에 있는 건 진하게 */}
        <p className="tile-tags">
          {(w.target?.keywords ?? []).map((k) => (
            <Fragment key={k}>
              <span className={kw?.found.includes(k) ? 'found' : undefined}>#{k}</span>{' '}
            </Fragment>
          ))}
        </p>
      </Aura>
    </div>
  );
}

export default function SiteDetail({ id, onError, onInfo }: { id: string; onError: (e: unknown) => void; onInfo: (m: string) => void }) {
  const site = useLive(() => getSite(id).then((s) => s ?? null), ['sites'], [id]);
  const watches = useLive(() => listWatchesBySite(id), ['watches'], [id]);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [nick, setNick] = useState('');
  useEffect(() => {
    if (showInfo) setNick(site?.nickname ?? '');
  }, [showInfo, site?.nickname]);
  // 새로 만든 대기 순번 모니터링에도 휴방 날짜 반영
  const queueIds = (watches ?? []).map((w) => w.id).join();
  useEffect(() => {
    if (queueIds) syncHolidays(id).catch(() => {});
  }, [id, queueIds]);
  const [editingEvent, setEditingEvent] = useState<SiteEvent | 'new' | null>(null);

  // 화면이 보이는 동안 이 사이트 모니터링들의 서버 상태를 10초마다 새로
  usePolling(() => {
    listWatchesBySite(id).then((ws) => ws.filter((w) => !w.lost).forEach((w) => refreshWatch(w).catch(onError)));
  }, 10_000);

  if (site === undefined) return null;
  if (site === null) {
    return (
      <>
        <Header title="사이트" back="/" />
        <main className="page">
          <p className="muted">사이트를 찾을 수 없어요.</p>
        </main>
      </>
    );
  }

  const upcoming = upcomingEvents(site);
  const past = pastEvents(site);
  const multiLive = siteLives(site).length > 1;
  // 종류별로 묶음 (가장 가까운 일정이 있는 종류가 위로)
  const eventGroups = upcoming.reduce<{ type: string; list: SiteEvent[] }[]>((acc, ev) => {
    const g = acc.find((x) => x.type === ev.type);
    if (g) g.list.push(ev);
    else acc.push({ type: ev.type, list: [ev] });
    return acc;
  }, []);
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
      navigate('/', { replace: true });
    });
  };

  return (
    <>
      <Header
        title="사이트"
        back="/"
        right={
          <button className="round-btn" onClick={() => navigate(`/sites/${site.id}/edit`)} aria-label="수정">
            <Pencil size={20} />
          </button>
        }
      />
      <main className="page">
        <section className="card site-hero">
          <button className="hero-info" onClick={() => setShowInfo(true)} aria-label="사이트 정보">
            <Info size={18} />
          </button>
          <SiteAvatar site={site} size={56} />
          <div>
            <h2>{site.name}</h2>
            <small>{hostOf(site.url)}</small>
            <div className="hero-tags">
              <SiteStatePill state={siteState(site)} />
              {site.support !== 'unsupported' && <span className="tag">{site.support === 'official' ? '공식 지원' : '직접 추가'}</span>}
            </div>
          </div>
          {(site.url || siteLives(site).length > 0) && (
            <div className="hero-links">
              {site.url && (
                <a className="link-pill" href={site.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={15} aria-hidden /> 사이트
                </a>
              )}
              {siteLives(site).map((l, i) => (
                <a key={i} className="link-pill live" href={openInAppHref(l.url)} target="_blank" rel="noopener noreferrer">
                  <SquarePlay size={16} aria-hidden /> {l.name}
                </a>
              ))}
            </div>
          )}
        </section>

        <div className="section-head">
          <h3 className="with-icon">
            <CalendarHeart size={16} aria-hidden /> 다가오는 일정 {upcoming.length ? `(${upcoming.length})` : ''}
          </h3>
          <button className="small-btn" onClick={() => setEditingEvent('new')}>
            <Plus size={15} aria-hidden /> 일정 추가
          </button>
        </div>
        {/* 종류별 한 줄: [양도데이] [1호점 내일 21:00] [11/23(월) 21:00] … — 휴방처럼 알약 칩으로 */}
        {eventGroups.length > 0 ? (
          <div className="ev-groups">
            {eventGroups.map(({ type, list }) => {
              const open = expanded.includes(type);
              const shown = open ? list : list.slice(0, CHIP_LIMIT);
              return (
                <div key={type} className="holiday-line">
                  <span className="hl-label">
                    <i className="hl-dot" aria-hidden />
                    {type}
                  </span>
                  <div className="hl-chips">
                  {shown.map((ev) => (
                    <button
                      key={ev.id}
                      className={`hl-chip ${kstDayDiff(ev.at) <= 0 ? 'soon' : ''}`}
                      title={ev.memo}
                      onClick={() => setEditingEvent(ev)}
                    >
                      {/* 채널이 여럿인 사이트: 어느 채널인지 (지정 안 하면 전체) */}
                      {multiLive && <span className="hl-ch">{ev.liveIndex != null ? (siteLives(site)[ev.liveIndex]?.name ?? '채널') : '전체'}</span>}
                      {chipText(ev)}
                    </button>
                  ))}
                  {list.length > CHIP_LIMIT && (
                    <button className="hl-chip more" onClick={() => setExpanded(open ? expanded.filter((t) => t !== type) : [...expanded, type])}>
                      {open ? '접기' : `+${list.length - CHIP_LIMIT}`}
                    </button>
                  )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">양도데이·이벤트 같은 일정을 적어 두면 미리 알려 드려요.</p>
        )}
        {past.length > 0 && <p className="muted small">지난 일정 {past.length}개</p>}
        {editingEvent && (
          <EventSheet
            site={site}
            event={editingEvent === 'new' ? undefined : editingEvent}
            onClose={() => setEditingEvent(null)}
            onError={onError}
            onInfo={onInfo}
          />
        )}

        <div className="section-head">
          <h3 className="with-icon">
            <Activity size={16} aria-hidden /> 모니터링 목록 {watches?.length ? `(${watches.length})` : ''}
          </h3>
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
              <KeywordTile key={w.id} w={w} siteName={site.name} onError={onError} />
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


        {showInfo && (
          <Sheet title="사이트 정보" onClose={() => setShowInfo(false)}>
            <div className="info-sheet">
            {site.unsupportedReason && site.support !== 'custom' && (
              <p className="note warn">
                <ShieldAlert size={16} aria-hidden />
                <span>{site.unsupportedReason}</span>
              </p>
            )}
            {site.description && <p className="desc">{site.description}</p>}
            <section className="card compact-card">
              <div className="settings-list">
                {(site.moduleId === 'nanacore' || (watches ?? []).some((w) => w.moduleId === 'nanacore')) && (
                  <div className="nick-setting">
                    <label className="field">
                      <span>내 닉네임 (대기열 기본값)</span>
                      <div className="inline-input">
                        <input value={nick} onChange={(e) => setNick(e.target.value)} placeholder="대기 명단에 표시되는 이름" autoComplete="off" />
                        <button
                          className="small-btn"
                          disabled={busy || nick.trim() === (site.nickname ?? '')}
                          onClick={() =>
                            run(async () => {
                              const n = await setSiteNickname(site, nick);
                              onInfo(n ? `닉네임을 저장했어요. 대기열 ${n}개도 함께 바꿨어요.` : '닉네임을 저장했어요.');
                            })
                          }
                        >
                          저장
                        </button>
                      </div>
                      <small>대기열을 만들면 이 닉네임이 기본으로 들어가요. 휴대폰에만 저장돼요.</small>
                    </label>
                  </div>
                )}
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
            </div>
          </Sheet>
        )}
      </main>
    </>
  );
}
