// 감시 등록 — 1) 사이트 선택 2) 대상·조건·주기·예약 설정 3) 시작
import { BadgeCheck, Bell, ChevronRight, Lock, Play, Plus, ScanSearch, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_KEYWORD_CONDITIONS, DEFAULT_QUEUE_CONDITIONS, type KeywordConditions, type ProbeResult, type QueueConditions, type Schedule } from '../../shared/types';
import { listSites, type Site } from '../db/local';
import { useLive } from '../data/events';
import { canWatch, MODULE_MIN_INTERVAL, normalizeUrl, probeUrl, SITE_STATE_LABEL, siteState } from '../data/sites';
import { createWatch } from '../data/watches';
import { navigate } from '../lib/router';
import { turnOnPush, usePush } from '../push/store';
import { Empty, Header, SiteAvatar } from '../ui/parts';
import { ConditionsEditor, IntervalPicker, KeywordConditionsEditor, KeywordInput, ScheduleEditor } from '../ui/WatchSettings';

function SitePicker() {
  const sites = useLive(listSites, ['sites']);
  if (!sites) return null;
  const ok = sites.filter(canWatch);
  const no = sites.filter((s) => !canWatch(s));
  return (
    <>
      <Header
        title="감시 추가"
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
            <p>감시할 사이트 주소를 등록하면, 지원하는 사이트인지 바로 알려 드려요.</p>
            <button className="primary" onClick={() => navigate('/sites/new?next=watch')}>
              <Plus size={20} aria-hidden /> 사이트 추가
            </button>
          </Empty>
        ) : (
          <>
            <h3>{ok.length ? '어느 사이트를 감시할까요?' : '자동 감시를 지원하는 사이트가 아직 없어요'}</h3>
            <div className="list-card">
              {ok.map((s) => (
                <button key={s.id} className="row-item" onClick={() => navigate(`/watch/new?site=${s.id}`, { replace: true })}>
                  <SiteAvatar site={s} />
                  <div className="row-main">
                    <b>{s.name}</b>
                    <small>{s.moduleId === 'keyword' ? '공개 페이지 키워드 감시' : (s.description ?? '대기 순번 감시')}</small>
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
            <h3>자동 감시를 할 수 없는 사이트</h3>
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

function WatchForm({ site, onError }: { site: Site; onError: (e: unknown) => void }) {
  const push = usePush();
  const min = MODULE_MIN_INTERVAL[site.moduleId ?? ''] ?? 60;
  const isDemo = site.moduleId === 'demo';
  const isKw = site.moduleId === 'keyword';
  const [label, setLabel] = useState(isDemo ? '데모 대기열' : isKw ? `${site.name} 키워드` : `${site.name} 대기`);
  const [nickname, setNickname] = useState('');
  const [pageUrl, setPageUrl] = useState(site.url);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [check, setCheck] = useState<ProbeResult | null>(null);
  const [intervalSec, setIntervalSec] = useState(isDemo ? 15 : isKw ? 180 : Math.max(30, min));
  const [qCond, setQCond] = useState<QueueConditions>({ ...DEFAULT_QUEUE_CONDITIONS });
  const [kCond, setKCond] = useState<KeywordConditions>({ ...DEFAULT_KEYWORD_CONDITIONS });
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
        label,
        nickname: site.moduleId === 'nanacore' ? nickname : undefined,
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

  const disabled = busy || (site.moduleId === 'nanacore' && !nickname.trim()) || (isKw && (!keywords.length || !pageUrl.trim()));

  return (
    <>
      <Header title="감시 추가" back="/watch/new" />
      <main className="page">
        <section className="card site-hero compact">
          <SiteAvatar site={site} size={40} />
          <div>
            <h2>{site.name}</h2>
            <small>{isKw ? '공개 페이지 키워드 감시' : site.description}</small>
          </div>
        </section>

        <section className="card form">
          <h2>감시 대상</h2>
          {site.moduleId === 'nanacore' && (
            <label className="field">
              <span>내 닉네임 (유튜브 채널 닉네임)</span>
              <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="대기 명단에 표시되는 이름" autoComplete="off" />
              <small>닉네임은 이 휴대폰에만 저장돼요. 서버에는 알아볼 수 없는 해시값만 보내요.</small>
            </label>
          )}
          {isKw && (
            <>
              <label className="field">
                <span>감시할 페이지 주소</span>
                <input
                  value={pageUrl}
                  onChange={(e) => {
                    setPageUrl(e.target.value);
                    setCheck(null);
                  }}
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                />
                <small>상품 상세 페이지처럼 키워드가 나올 페이지 주소를 넣어 주세요.</small>
              </label>
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
          <h2>감시 시간</h2>
          <ScheduleEditor value={schedule} onChange={setSchedule} maxText={isKw ? '7일' : '24시간'} />
        </section>

        {!push.subscription && (
          <p className="note">
            <Bell size={16} aria-hidden />
            <span>시작하면 알림 권한을 물어봐요. ‘허용’을 눌러 주세요.</span>
          </p>
        )}
        <button className="primary sticky" disabled={disabled} onClick={start}>
          <Play size={20} aria-hidden /> 감시 시작
        </button>
      </main>
    </>
  );
}

export default function WatchNew({ siteId, onError }: { siteId: string | null; onError: (e: unknown) => void }) {
  const sites = useLive(listSites, ['sites']);
  if (!siteId) return <SitePicker />;
  if (!sites) return null;
  const site = sites.find((s) => s.id === siteId);
  if (!site || !canWatch(site)) return <SitePicker />;
  return <WatchForm site={site} onError={onError} />;
}
