// 모니터링 상세 — 진행 링, 상태, 변경 이력, 조건·주기·예약 변경, 시작·중지·삭제
import { ChannelPicker } from '../ui/ChannelPicker';
import { syncHolidays } from '../data/siteEvents';
import { /* Check, */ ChevronDown, ExternalLink, Info, Link2Off, Pause, Play, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { daysText, isKeywordSnapshot, isQueueSnapshot, type AnyConditions, type KeywordConditions, type QueueConditions, type Schedule } from '../../shared/types';
import { getSite, getWatch, /* listSites, */ type Watch, type LiveChannel } from '../db/local';
import { useLive } from '../data/events';
import { checkQueueUrl, MODULE_MIN_INTERVAL, normalizeUrl, probeUrl, siteLives } from '../data/sites';

const DEFAULT_QUEUE_URL = 'https://nanacore-queue.netlify.app/?view=viewer';
import { checkWatchNow, headline, kindTone, /* moveWatch, */ refreshWatch, removeWatch, updateWatch, watchState, WATCH_STATE_LABEL, type WatchPatch } from '../data/watches';
import { navigate } from '../lib/router';
import { Aura, Crumbs, PillBar, Ring } from '../ui/Aura';
import { fmtAgo, fmtInterval, fmtNo, fmtTime, Header /* , SiteAvatar */ } from '../ui/parts';
// import { Sheet } from '../ui/TypeList';

/* 모니터링 사이트 옮기기 (숨김 — 다시 쓰려면 이 파일의 "옮기기" 주석들을 풀면 됨)
function hostOrApp(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url || '앱 내장';
  }
}
*/
import { PageUrlField } from '../ui/PageUrlField';
import { ConditionsEditor, IntervalPicker, KeywordConditionsEditor, KeywordInput, ScheduleEditor } from '../ui/WatchSettings';
import { usePolling } from './Home';

const STATUS_TEXT: Record<string, string> = { current: '진행 중', pending: '대기', done: '완료', skipped: '건너뜀' };

interface EditValue {
  conditions: AnyConditions;
  intervalSec: number;
  schedule: Schedule | null;
  label: string;
  /** 키워드 모니터링 */
  url?: string;
  keywords?: string[];
  /** 나나코어 */
  nickname?: string;
  link?: string;
  /** 대기열 채널 */
  liveIndex?: number | null;
}

function Editor({
  init,
  min,
  fixedInterval,
  keyword,
  nicknameEditable,
  siteUrl,
  lives,
  onSave,
}: {
  init: EditValue;
  min: number;
  fixedInterval: boolean;
  keyword: boolean;
  nicknameEditable: boolean;
  siteUrl: string;
  lives: LiveChannel[];
  onSave: (v: EditValue) => Promise<void>;
}) {
  const [v, setV] = useState(init);
  const [busy, setBusy] = useState(false);
  return (
    <div className="editor">
      <h4>모니터링 대상</h4>
      {keyword && (
        <>
          <PageUrlField value={v.url ?? ''} siteUrl={siteUrl} onChange={(url) => setV({ ...v, url })} />
          <div className="field">
            <span>키워드 (최대 10개)</span>
            <KeywordInput value={v.keywords ?? []} onChange={(keywords) => setV({ ...v, keywords })} />
            <small>키워드나 주소를 바꾸면 처음부터 다시 비교해요.</small>
          </div>
        </>
      )}
      {nicknameEditable && (
        <label className="field">
          <span>대기열 주소</span>
          <input value={v.link ?? ''} onChange={(e) => setV({ ...v, link: e.target.value })} placeholder={DEFAULT_QUEUE_URL} inputMode="url" autoCapitalize="off" autoCorrect="off" />
          <small>대기열 주소가 바뀌었으면 새 주소를 넣어 주세요. 저장할 때 한 번 확인해요.</small>
        </label>
      )}
      {nicknameEditable && (
        <label className="field">
          <span>내 닉네임</span>
          <input value={v.nickname ?? ''} onChange={(e) => setV({ ...v, nickname: e.target.value })} autoComplete="off" />
          <small>닉네임을 바꾸면 처음부터 다시 찾아요.</small>
        </label>
      )}
      {!keyword && <ChannelPicker lives={lives} value={v.liveIndex ?? null} onChange={(liveIndex) => setV({ ...v, liveIndex })} />}
      <label className="field">
        <span>이름 (목록에 표시)</span>
        <input value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} maxLength={30} />
      </label>
      <h4>알림 받을 조건</h4>
      {keyword ? (
        <KeywordConditionsEditor value={v.conditions as KeywordConditions} onChange={(conditions) => setV({ ...v, conditions })} />
      ) : (
        <ConditionsEditor value={v.conditions as QueueConditions} onChange={(conditions) => setV({ ...v, conditions })} />
      )}
      {!fixedInterval && (
        <>
          <h4>확인 주기</h4>
          <IntervalPicker value={v.intervalSec} min={min} onChange={(intervalSec) => setV({ ...v, intervalSec })} />
        </>
      )}
      <h4>모니터링 시간</h4>
      <ScheduleEditor value={v.schedule} onChange={(schedule) => setV({ ...v, schedule })} maxText={keyword ? '7일' : '24시간'} holidays={!keyword} />
      <button
        className="primary"
        disabled={busy || (keyword && !v.keywords?.length) || (nicknameEditable && !v.nickname?.trim())}
        onClick={async () => {
          setBusy(true);
          try {
            await onSave(v);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Save size={18} aria-hidden /> {busy ? '저장 중…' : '변경 저장'}
      </button>
    </div>
  );
}

/** 키워드 바로 수정 — 모니터링을 켠 채로 추가·삭제 후 저장 */
function QuickKeywords({ w, found, onSave }: { w: Watch; found: string[]; onSave: (keywords: string[]) => Promise<void> }) {
  const saved = w.target?.keywords ?? [];
  const [list, setList] = useState(saved);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(list) !== JSON.stringify(saved);
  return (
    <section className="card">
      <div className="card-head">
        <h2>키워드</h2>
        <small>{w.view?.running ? '모니터링 중에도 바로 바꿀 수 있어요' : '모니터링이 멈춰 있어요'}</small>
      </div>
      <KeywordInput value={list} onChange={setList} found={found} />
      {dirty && (
        <div className="row">
          <button className="primary outline" disabled={busy} onClick={() => setList(saved)}>
            되돌리기
          </button>
          <button
            className="primary"
            disabled={busy || !list.length}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(list);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Save size={16} aria-hidden /> {busy ? '저장 중…' : '키워드 저장'}
          </button>
        </div>
      )}
    </section>
  );
}

const HISTORY_LIMIT = 6;

export default function WatchDetail({ id, onError, onInfo }: { id: string; onError: (e: unknown) => void; onInfo: (m: string) => void }) {
  const w = useLive(() => getWatch(id).then((x) => x ?? null), ['watches'], [id]);
  const site = useLive(async () => (w ? ((await getSite(w.siteId)) ?? null) : null), ['sites'], [w?.siteId]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  // 옮기기 (숨김)
  // const [moving, setMoving] = useState(false);
  // const allSites = useLive(listSites, ['sites']);
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
        <Header title="모니터링" back="/" />
        <main className="page">
          <p className="muted">모니터링을 찾을 수 없어요. 이미 삭제되었을 수 있어요.</p>
        </main>
      </>
    );
  }

  const v = w.view;
  const last = isQueueSnapshot(v?.last) ? v.last : null;
  const kw = isKeywordSnapshot(v?.last) ? v.last : null;
  const isKw = w.moduleId === 'keyword';
  const state = watchState(w);
  const channelName = w.liveIndex != null && site ? siteLives(site)[w.liveIndex]?.name : undefined;
  const tone = kindTone(w);
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
            <span>서버에서 이 모니터링 작업이 사라졌어요 (알림 연결 만료 등). 삭제한 뒤 다시 등록해 주세요.</span>
          </p>
        )}

        <section className="detail-hero">
          <Aura tone={tone} eyes={false} className="aura-full">
            <Crumbs items={[site?.name ?? '삭제된 사이트', channelName, WATCH_STATE_LABEL[state], w.nickname]} />
            {isKw ? (
              <div className="kw-hero">
                <b className="num">{h.big}</b>
                <div className="kw-chips center">
                  {(w.target?.keywords ?? []).map((k) => (
                    <span key={k} className={`kw-chip ${kw?.found.includes(k) ? 'found' : ''}`}>
                      {k}
                    </span>
                  ))}
                </div>
                <p className="hero-sub">{kw?.title ?? (v?.lastError ? h.sub : fmtAgo(v?.lastCheckedAt))}</p>
              </div>
            ) : (
              <>
                <Ring ahead={last?.ahead ?? null} current={last?.status === 'current'}>
                  {h.pre && <span className="ring-pre">{h.pre}</span>}
                  <b className="num">{h.big}</b>
                  <span>{h.unit ?? h.sub}</span>
                </Ring>
                <p className="hero-sub">{h.unit ? h.sub : fmtAgo(v?.lastCheckedAt)}</p>
              </>
            )}
          </Aura>
          {!w.lost && (
            <PillBar
              left={isKw ? { value: String(w.target?.keywords.length ?? 0), label: '키워드' } : { value: last?.found ? fmtNo(last.position) : '—', label: '내 순번' }}
              right={isKw ? { value: kw ? String(kw.found.length) : '—', label: '발견' } : { value: fmtNo(last?.currentPosition), label: '진행 중' }}
            >
              {v?.running ? (
                <button disabled={busy} onClick={() => run(() => updateWatch(w, { running: false }))}>
                  <Pause size={16} aria-hidden /> 중지
                </button>
              ) : (
                <button disabled={busy} onClick={() => run(() => updateWatch(w, { running: true }))}>
                  <Play size={16} aria-hidden /> 다시 시작
                </button>
              )}
            </PillBar>
          )}
        </section>

        {!isKw && last && !last.found && (
          <p className="note warn">
            <Info size={16} aria-hidden />
            <span>
              지금 명단 ({last.waiting}명 대기)에서 <b>{w.nickname}</b> 을(를) 찾지 못했어요. 대기열에 표시된 닉네임과 철자·띄어쓰기가 같은지 확인해 주세요.
              ‘님’은 빼고 넣어 주세요.
            </span>
          </p>
        )}
        {v?.running && !v.inWindow && (
          <p className="note">
            <Info size={16} aria-hidden />
            <span>
              {v.skipDates?.includes(new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)) ? '오늘은 휴방 일정이 있어 확인하지 않아요.' : '예약 시간 전이라 아직 확인하지 않아요.'} 오른쪽 위 새로고침 버튼으로 지금 한 번 확인할 수 있어요.
            </span>
          </p>
        )}

        {isKw && !w.lost && (
          <QuickKeywords
            key={(w.target?.keywords ?? []).join('|')}
            w={w}
            found={kw?.found ?? []}
            onSave={(keywords) =>
              run(async () => {
                await updateWatch(w, { target: { url: w.target!.url, keywords } });
                onInfo('키워드를 바꿨어요. 바로 다시 확인할게요.');
              })
            }
          />
        )}

        <section className="card">
          <ul className="info-list">
            <li>
              <span>사이트</span>
              <span className="with-action">
                {site?.name ?? '삭제된 사이트'}
                {/* 옮기기 (숨김)
                <button className="link-btn" onClick={() => setMoving(true)}>
                  옮기기
                </button>
                */}
              </span>
            </li>
            {isKw ? (
              <li>
                <span>페이지</span>
                <a className="link" href={w.target?.url} target="_blank" rel="noopener noreferrer">
                  열기 <ExternalLink size={14} aria-hidden />
                </a>
              </li>
            ) : (
              <>
              {w.moduleId === 'nanacore' && (
                <li>
                  <span>대기열</span>
                  <a className="link" href={w.link || DEFAULT_QUEUE_URL} target="_blank" rel="noopener noreferrer">
                    열기 <ExternalLink size={14} aria-hidden />
                  </a>
                </li>
              )}
              <li>
                <span>상태</span>
                <span>{last ? (last.found ? STATUS_TEXT[last.status ?? 'pending'] : '명단에 없음') : '확인 전'}</span>
              </li>
              </>
            )}
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
              <span>모니터링 시간</span>
              <span>{w.schedule ? `${daysText(w.schedule.days)} ${w.schedule.start} ~ ${w.schedule.end}` : `시작 후 최대 ${isKw ? '7일' : '24시간'}`}</span>
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
              <span>알림 조건 · 주기 · 모니터링 시간</span>
              <ChevronDown size={18} aria-hidden />
            </button>
            {editing && (
              <Editor
                init={{
                  conditions: w.conditions,
                  intervalSec: w.intervalSec,
                  schedule: w.schedule,
                  label: w.label,
                  url: w.target?.url,
                  keywords: w.target?.keywords,
                  nickname: w.nickname,
                  link: w.link ?? '',
                  liveIndex: w.liveIndex ?? null,
                }}
                min={MODULE_MIN_INTERVAL[w.moduleId] ?? 60}
                fixedInterval={w.moduleId === 'demo'}
                keyword={isKw}
                nicknameEditable={w.moduleId === 'nanacore'}
                siteUrl={site?.url ?? w.target?.url ?? ''}
                lives={site ? siteLives(site) : []}
                onSave={(nv) =>
                  run(async () => {
                    const patch: WatchPatch = { conditions: nv.conditions, intervalSec: nv.intervalSec, schedule: nv.schedule, label: nv.label };
                    if (!isKw) patch.liveIndex = nv.liveIndex ?? null;
                    if (isKw) {
                      const url = normalizeUrl(nv.url ?? '');
                      if (!url) throw new Error('페이지 주소를 확인해 주세요.');
                      const kws = nv.keywords ?? [];
                      const changed = url !== w.target?.url || JSON.stringify(kws) !== JSON.stringify(w.target?.keywords ?? []);
                      if (changed) {
                        // 주소가 바뀌면 그 페이지가 모니터링 가능한지 먼저 확인
                        if (url !== w.target?.url) {
                          const r = await probeUrl(url, kws);
                          if (r.verdict !== 'ok') throw new Error(r.message);
                        }
                        patch.target = { url, keywords: kws };
                      }
                    }
                    if (w.moduleId === 'nanacore' && nv.nickname !== undefined) patch.nickname = nv.nickname;
                    if (w.moduleId === 'nanacore' && (nv.link ?? '').trim() !== (w.link ?? '')) {
                      const raw = (nv.link ?? '').trim();
                      if (raw) {
                        // 새 대기열 주소가 같은 방식의 대기열인지 확인 후 저장
                        const r = await checkQueueUrl(raw);
                        if (!r.ok || r.moduleId !== w.moduleId) throw new Error(r.ok ? '다른 종류의 대기열이에요. 새 모니터링으로 추가해 주세요.' : r.message);
                        patch.link = normalizeUrl(raw)!;
                      } else patch.link = '';
                    }
                    await updateWatch(w, patch);
                    await syncHolidays(w.siteId); // 채널이 바뀌면 쉬는 날도 다시
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
            {(showAllHistory ? v.history : v.history.slice(0, HISTORY_LIMIT)).map((h, i) => (
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
            {v.history.length > HISTORY_LIMIT && (
              <li className="tl-more">
                <button className="more-row" onClick={() => setShowAllHistory(!showAllHistory)}>
                  {showAllHistory ? '접기' : `${v.history.length - HISTORY_LIMIT}개 더 보기`}
                  <ChevronDown size={16} className={showAllHistory ? 'flip' : ''} aria-hidden />
                </button>
              </li>
            )}
          </ol>
        ) : (
          <p className="muted">아직 변경 이력이 없어요.</p>
        )}

        {/* 옮기기 선택 창 (숨김)
        {moving && (
          <Sheet title="어느 사이트로 옮길까요?" onClose={() => setMoving(false)}>
            <div className="list-card">
              {(allSites ?? []).map((s2) => (
                <button
                  key={s2.id}
                  className="row-item"
                  disabled={s2.id === w.siteId}
                  onClick={() =>
                    run(async () => {
                      await moveWatch(w, s2.id);
                      setMoving(false);
                      onInfo(`‘${s2.name}’ 사이트로 옮겼어요.`);
                    })
                  }
                >
                  <SiteAvatar site={s2} />
                  <div className="row-main">
                    <b>{s2.name}</b>
                    <small>{s2.id === w.siteId ? '지금 이 사이트에 있어요' : hostOrApp(s2.url)}</small>
                  </div>
                  {s2.id === w.siteId && <Check size={18} className="chev" aria-hidden />}
                </button>
              ))}
            </div>
            <p className="hint">알림 조건·진행 상태는 그대로 두고, 어느 사이트에 묶어 볼지만 바꿔요.</p>
          </Sheet>
        )}
        */}

        <button
          className="text-btn danger"
          disabled={busy}
          onClick={() =>
            confirm('이 모니터링을 삭제할까요? 서버의 예약 작업도 함께 지워져요.') &&
            run(async () => {
              await removeWatch(w);
              navigate('/', { replace: true });
            })
          }
        >
          <Trash2 size={16} aria-hidden /> 모니터링 삭제
        </button>
      </main>
    </>
  );
}
