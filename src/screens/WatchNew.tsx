// 모니터링 등록 — 1) 사이트 선택 2) 대상·조건·주기·예약 설정 3) 시작
import { ChannelPicker } from '../ui/ChannelPicker';
import { BadgeCheck, Bell, ChevronRight, Lock, Play, Plus, ScanSearch, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_KEYWORD_CONDITIONS, DEFAULT_QUEUE_CONDITIONS, type KeywordConditions, type ProbeResult, type QueueConditions, type Schedule } from '../../shared/types';
import { listSites, type Site } from '../db/local';
import { useLive } from '../data/events';
import { canWatch, checkQueueUrl, detectQueueModule, MODULE_MIN_INTERVAL, normalizeUrl, probeUrl, SITE_STATE_LABEL, siteState, watchTypesFor, type WatchTypeInfo, siteLives } from '../data/sites';
import { createWatch } from '../data/watches';
import { navigate } from '../lib/router';
import { turnOnPush, usePush } from '../push/store';
import { Empty, Header, SiteAvatar } from '../ui/parts';
import { PageUrlField } from '../ui/PageUrlField';
import { TypeList } from '../ui/TypeList';
import { ConditionsEditor, IntervalPicker, KeywordConditionsEditor, KeywordInput, ScheduleEditor } from '../ui/WatchSettings';

function SitePicker() {
  const sites = useLive(listSites, ['sites']);
  if (!sites) return null;
  const ok = sites.filter(canWatch);
  const no = sites.filter((s) => !canWatch(s));
  return (
    <>
      <Header
        title="모니터링 추가"
        back="/"
        right={
          <button className="round-btn" onClick={() => navigate('/sites/new?next=watch')} aria-label="사이트 추가">
            <Plus size={22} />
          </button>
        }
      />
      <main className="page">
        {sites.length === 0 ? (
          <Empty emoji="🌐" title="먼저 사이트를 추가해 주세요">
            <p>모니터링할 사이트 주소를 등록하면, 지원하는 사이트인지 바로 알려 드려요.</p>
            <button className="primary" onClick={() => navigate('/sites/new?next=watch')}>
              <Plus size={20} aria-hidden /> 사이트 추가
            </button>
          </Empty>
        ) : (
          <>
            <h3>{ok.length ? '어느 사이트를 모니터링할까요?' : '자동 모니터링을 지원하는 사이트가 아직 없어요'}</h3>
            <div className="list-card">
              {ok.map((s) => (
                <button key={s.id} className="row-item" onClick={() => navigate(`/watch/new?site=${s.id}`, { replace: true })}>
                  <SiteAvatar site={s} />
                  <div className="row-main">
                    <b>{s.name}</b>
                    <small>{s.moduleId === 'keyword' ? '공개 페이지 키워드 모니터링' : (s.description ?? '대기 순번 모니터링')}</small>
                  </div>
                  <ChevronRight size={18} aria-hidden />
                </button>
              ))}
              <button className="row-item add-row" onClick={() => navigate('/sites/new?next=watch')}>
                <span className="add-icon" aria-hidden>
                  <Plus size={20} />
                </span>
                <div className="row-main">
                  <b>새 사이트 추가</b>
                  <small>주소를 넣으면 지원 여부를 바로 알려 드려요</small>
                </div>
              </button>
            </div>
          </>
        )}
        {no.length > 0 && (
          <>
            <h3>자동 모니터링을 할 수 없는 사이트</h3>
            <div className="list-card">
              {no.map((s) => (
                <button key={s.id} className="row-item disabled" onClick={() => navigate(`/sites/${s.id}`)}>
                  <SiteAvatar site={s} />
                  <div className="row-main">
                    <b>{s.name}</b>
                    <small>{s.unsupportedReason ?? SITE_STATE_LABEL[siteState(s)]}</small>
                  </div>
                  <Lock size={16} aria-hidden />
                </button>
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}

function WatchForm({ site, type, onError }: { site: Site; type: WatchTypeInfo; onError: (e: unknown) => void }) {
  const isQueueType = type.kind === 'queue';
  // 대기 순번은 대기열 주소로 어떤 대기열인지 판정 (사이트 주소가 대기열이면 기본값으로)
  const [queueUrl, setQueueUrl] = useState(() => (detectQueueModule(site.url) ? site.url : ''));
  // 처음 보는 대기열 주소는 서버 확인 결과로 판정
  const [queueCheck, setQueueCheck] = useState<{ url: string; moduleId: string | null; message: string } | null>(null);
  const checkedMod = queueCheck && queueCheck.url === queueUrl ? queueCheck.moduleId : null;
  const mod = type.moduleId ?? (isQueueType ? (detectQueueModule(queueUrl) ?? checkedMod ?? '') : '');
  const push = usePush();
  const min = MODULE_MIN_INTERVAL[mod] ?? 60;
  const isDemo = mod === 'demo';
  const isKw = mod === 'keyword';
  const [label, setLabel] = useState(isDemo ? '데모 대기열' : isKw ? `${site.name} ${type.label}` : `${site.name} 대기`);
  const [nickname, setNickname] = useState('');
  const [liveIndex, setLiveIndex] = useState<number | null>(null);
  const [pageUrl, setPageUrl] = useState(site.url);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [check, setCheck] = useState<ProbeResult | null>(null);
  const [intervalSec, setIntervalSec] = useState(isDemo ? 15 : isKw ? 180 : Math.max(30, min));
  const [qCond, setQCond] = useState<QueueConditions>({ ...DEFAULT_QUEUE_CONDITIONS });
  const [kCond, setKCond] = useState<KeywordConditions>({ ...DEFAULT_KEYWORD_CONDITIONS, disappear: type.notifyDisappear });
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);

  async function preview() {
    setBusy(true);
    try {
      const url = normalizeUrl(pageUrl);
      if (!url) throw new Error('페이지 주소를 확인해 주세요.');
      setCheck(await probeUrl(url, keywords));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    try {
      let target: { url: string; keywords: string[] } | undefined;
      if (isKw) {
        const url = normalizeUrl(pageUrl);
        if (!url) throw new Error('페이지 주소를 확인해 주세요.');
        // 등록 전에 그 페이지를 한 번 확인 (다른 경로라면 로그인·차단일 수 있어서)
        const r = await probeUrl(url, keywords);
        setCheck(r);
        if (r.verdict !== 'ok') throw new Error(r.message);
        target = { url, keywords };
      }
      const sub = push.subscription ?? (await turnOnPush());
      const w = await createWatch({
        site,
        kind: type.kind,
        moduleId: mod,
        link: isQueueType && !isDemo ? (normalizeUrl(queueUrl) ?? undefined) : undefined,
        label,
        nickname: mod === 'nanacore' ? nickname : undefined,
        liveIndex: isQueueType ? liveIndex : null,
        target,
        intervalSec,
        conditions: isKw ? kCond : qCond,
        schedule,
        subscription: sub,
      });
      navigate(`/watch/${w.id}`, { replace: true });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || (isQueueType && !mod) || (mod === 'nanacore' && !nickname.trim()) || (isKw && (!keywords.length || !pageUrl.trim()));

  return (
    <>
      <Header title={`${type.label} 모니터링 추가`} back={`/sites/${site.id}`} />
      <main className="page">
        <section className="card site-hero compact">
          <SiteAvatar site={site} size={40} />
          <div>
            <h2>{site.name}</h2>
            <small>{type.label} 모니터링 · {type.desc}</small>
          </div>
        </section>

        <section className="card form">
          <h2>모니터링 대상</h2>
          {isQueueType && !isDemo && (
            <label className="field">
              <span>대기열 주소</span>
              <input value={queueUrl} onChange={(e) => setQueueUrl(e.target.value)} placeholder="대기 명단이 보이는 페이지 주소" inputMode="url" autoCapitalize="off" autoCorrect="off" />
              {mod ? (
                <small className="ok-text">
                  <BadgeCheck size={14} aria-hidden /> {mod === 'nanacore' ? '나나코어 대기열이에요' : '지원하는 대기열이에요'}
                </small>
              ) : queueUrl.trim() ? (
                queueCheck?.url === queueUrl ? (
                  <small className="err-text">
                    <ShieldAlert size={14} aria-hidden /> {queueCheck.message}
                  </small>
                ) : (
                  <small>
                    처음 보는 대기열 주소예요.{' '}
                    <button
                      type="button"
                      className="link-btn"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const r = await checkQueueUrl(queueUrl);
                          setQueueCheck({ url: queueUrl, moduleId: r.ok ? r.moduleId : null, message: r.message });
                        } catch (e) {
                          onError(e);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      이 주소 확인
                    </button>
                  </small>
                )
              ) : (
                <small>사이트와 대기열 주소가 달라도 괜찮아요. 대기 명단이 보이는 주소를 넣어 주세요.</small>
              )}
            </label>
          )}
          {mod === 'nanacore' && (
            <label className="field">
              <span>내 닉네임 (유튜브 채널 닉네임)</span>
              <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="대기 명단에 표시되는 이름" autoComplete="off" />
              <small>닉네임은 이 휴대폰에만 저장돼요. 서버에는 알아볼 수 없는 해시값만 보내요.</small>
            </label>
          )}
          {isQueueType && site && <ChannelPicker lives={siteLives(site)} value={liveIndex} onChange={setLiveIndex} />}
          {isKw && (
            <>
              <PageUrlField
                value={pageUrl}
                siteUrl={site.url}
                onChange={(v) => {
                  setPageUrl(v);
                  setCheck(null);
                }}
              />
              <div className="field">
                <span>키워드 (최대 10개)</span>
                <KeywordInput
                  value={keywords}
                  onChange={(k) => {
                    setKeywords(k);
                    setCheck(null);
                  }}
                  found={check?.found}
                />
                <small>대소문자·띄어쓰기는 무시해요. 쉼표나 엔터로 여러 개 넣을 수 있어요.</small>
                {type.suggestions.some((k) => !keywords.includes(k)) && (
                  <div className="suggest">
                    <span>추천</span>
                    {type.suggestions
                      .filter((k) => !keywords.includes(k))
                      .map((k) => (
                        <button key={k} type="button" className="chip" onClick={() => (setKeywords([...keywords, k]), setCheck(null))}>
                          + {k}
                        </button>
                      ))}
                  </div>
                )}
              </div>
              <button type="button" className="primary outline" disabled={busy || !pageUrl.trim()} onClick={preview}>
                <ScanSearch size={18} aria-hidden /> 지금 페이지에 있는지 확인
              </button>
              {check && (
                <p className={`note ${check.verdict === 'ok' ? '' : 'warn'}`}>
                  {check.verdict === 'ok' ? <BadgeCheck size={16} aria-hidden /> : <ShieldAlert size={16} aria-hidden />}
                  <span>
                    {check.verdict !== 'ok'
                      ? check.message
                      : !keywords.length
                        ? '공개 페이지예요. 키워드를 넣어 주세요.'
                        : check.found.length
                          ? `지금 페이지에 ${check.found.map((k) => `‘${k}’`).join(', ')} 있어요.`
                          : '지금은 키워드가 없어요. 나타나면 알려 드릴게요.'}
                    {check.title && <small className="probe-title">{check.title}</small>}
                  </span>
                </p>
              )}
            </>
          )}
          {isDemo && <p className="hint">가짜 대기열이 15초마다 한 칸씩 진행돼요. 앞에 6명 → 내 차례 → 완료까지 약 2분. 화면을 끄고 알림이 오는지 확인해 보세요.</p>}
          <label className="field">
            <span>이름 (목록에 표시)</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={30} />
          </label>
        </section>

        <section className="card">
          <h2>알림 받을 조건</h2>
          {isKw ? <KeywordConditionsEditor value={kCond} onChange={setKCond} /> : <ConditionsEditor value={qCond} onChange={setQCond} />}
        </section>

        <section className="card">
          <h2>확인 주기</h2>
          {isDemo ? <p className="hint">데모는 15초로 고정이에요.</p> : <IntervalPicker value={intervalSec} min={min} onChange={setIntervalSec} />}
          {!isDemo && <p className="hint">사이트 부담을 줄이려고 {min < 60 ? `${min}초` : `${min / 60}분`}보다 짧게는 확인하지 않아요.</p>}
        </section>

        <section className="card">
          <h2>모니터링 시간</h2>
          <ScheduleEditor value={schedule} onChange={setSchedule} maxText={isKw ? '7일' : '24시간'} />
        </section>

        {!push.subscription && (
          <p className="note">
            <Bell size={16} aria-hidden />
            <span>시작하면 알림 권한을 물어봐요. ‘허용’을 눌러 주세요.</span>
          </p>
        )}
        <button className="primary sticky" disabled={disabled} onClick={start}>
          <Play size={20} aria-hidden /> 모니터링 시작
        </button>
      </main>
    </>
  );
}

function TypePicker({ site }: { site: Site }) {
  const types = watchTypesFor(site);
  return (
    <>
      <Header title="모니터링 추가" back={`/sites/${site.id}`} />
      <main className="page">
        <section className="card site-hero compact">
          <SiteAvatar site={site} size={40} />
          <div>
            <h2>{site.name}</h2>
            <small>어떤 걸 모니터링할까요?</small>
          </div>
        </section>
        <TypeList types={types} onPick={(t) => navigate(`/watch/new?site=${site.id}&type=${t.kind}`, { replace: true })} />
      </main>
    </>
  );
}

export default function WatchNew({ siteId, typeKind, onError }: { siteId: string | null; typeKind: string | null; onError: (e: unknown) => void }) {
  const sites = useLive(listSites, ['sites']);
  if (!siteId) return <SitePicker />;
  if (!sites) return null;
  const site = sites.find((s) => s.id === siteId);
  if (!site || !canWatch(site)) return <SitePicker />;
  const types = watchTypesFor(site);
  const picked = types.find((t) => t.kind === typeKind && t.available);
  if (picked) return <WatchForm key={picked.kind} site={site} type={picked} onError={onError} />;
  // 고를 수 있는 종류가 하나뿐이면 바로 등록 화면
  const avail = types.filter((t) => t.available);
  if (avail.length === 1) return <WatchForm key={avail[0].kind} site={site} type={avail[0]} onError={onError} />;
  return <TypePicker site={site} />;
}
