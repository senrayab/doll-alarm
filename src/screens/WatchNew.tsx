// 감시 등록 — 1) 사이트 선택 2) 대상·조건·주기·예약 설정 3) 시작
import { Bell, ChevronRight, Lock, Play, Plus } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_QUEUE_CONDITIONS, type QueueConditions, type Schedule } from '../../shared/types';
import { listSites, type Site } from '../db/local';
import { useLive } from '../data/events';
import { canWatch, MODULE_MIN_INTERVAL, SITE_STATE_LABEL, siteState } from '../data/sites';
import { createWatch } from '../data/watches';
import { navigate } from '../lib/router';
import { turnOnPush, usePush } from '../push/store';
import { Empty, Header, SiteAvatar } from '../ui/parts';
import { ConditionsEditor, IntervalPicker, ScheduleEditor } from '../ui/WatchSettings';

function SitePicker() {
  const sites = useLive(listSites, ['sites']);
  if (!sites) return null;
  const ok = sites.filter(canWatch);
  const no = sites.filter((s) => !canWatch(s));
  return (
    <>
      <Header title="감시 추가" back="/" />
      <main className="page">
        {sites.length === 0 && (
          <Empty emoji="🌐" title="먼저 사이트를 추가해 주세요">
            <p>감시할 사이트 주소를 등록하면, 지원하는 사이트인지 바로 알려 드려요.</p>
            <button className="primary" onClick={() => navigate('/sites/new')}>
              <Plus size={20} aria-hidden /> 사이트 추가
            </button>
          </Empty>
        )}
        {ok.length > 0 && <h3>어느 사이트를 감시할까요?</h3>}
        <div className="list-card">
          {ok.map((s) => (
            <button key={s.id} className="row-item" onClick={() => navigate(`/watch/new?site=${s.id}`, { replace: true })}>
              <SiteAvatar site={s} />
              <div className="row-main">
                <b>{s.name}</b>
                <small>{s.description ?? '대기 순번 감시'}</small>
              </div>
              <ChevronRight size={18} aria-hidden />
            </button>
          ))}
        </div>
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
  const [label, setLabel] = useState(isDemo ? '데모 대기열' : `${site.name} 대기`);
  const [nickname, setNickname] = useState('');
  const [intervalSec, setIntervalSec] = useState(isDemo ? 15 : Math.max(30, min));
  const [conditions, setConditions] = useState<QueueConditions>({ ...DEFAULT_QUEUE_CONDITIONS });
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const sub = push.subscription ?? (await turnOnPush());
      const w = await createWatch({
        site,
        label,
        nickname: site.moduleId === 'nanacore' ? nickname : undefined,
        intervalSec,
        conditions,
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

  return (
    <>
      <Header title="감시 추가" back="/watch/new" />
      <main className="page">
        <section className="card site-hero compact">
          <SiteAvatar site={site} size={40} />
          <div>
            <h2>{site.name}</h2>
            <small>{site.description}</small>
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
          {isDemo && <p className="hint">가짜 대기열이 15초마다 한 칸씩 진행돼요. 앞에 3명 → 내 차례 → 완료까지 약 1분 30초. 화면을 끄고 알림이 오는지 확인해 보세요.</p>}
          <label className="field">
            <span>이름 (목록에 표시)</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={30} />
          </label>
        </section>

        <section className="card">
          <h2>알림 받을 조건</h2>
          <ConditionsEditor value={conditions} onChange={setConditions} />
        </section>

        <section className="card">
          <h2>확인 주기</h2>
          {isDemo ? <p className="hint">데모는 15초로 고정이에요.</p> : <IntervalPicker value={intervalSec} min={min} onChange={setIntervalSec} />}
          {!isDemo && <p className="hint">사이트 부담을 줄이려고 {min}초보다 짧게는 확인하지 않아요.</p>}
        </section>

        <section className="card">
          <h2>감시 시간</h2>
          <ScheduleEditor value={schedule} onChange={setSchedule} />
        </section>

        {!push.subscription && (
          <p className="note">
            <Bell size={16} aria-hidden />
            <span>시작하면 알림 권한을 물어봐요. ‘허용’을 눌러 주세요.</span>
          </p>
        )}
        <button className="primary sticky" disabled={busy || (site.moduleId === 'nanacore' && !nickname.trim())} onClick={start}>
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
