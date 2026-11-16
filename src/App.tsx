import {
  Bell,
  BellOff,
  BellRing,
  CircleAlert,
  CircleCheck,
  Download,
  EllipsisVertical,
  Info,
  Smartphone,
  Timer,
  Zap,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { UnauthorizedError } from './api/client';
import WatchTest from './WatchTest';
import { currentSubscription, disablePush, enablePush, pushSupport, sendTestPush } from './push/subscribe';

type Log = { at: number; text: string; kind: 'ok' | 'err' | 'info' };

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches;
}

const LOG_ICON = { ok: CircleCheck, err: CircleAlert, info: Info } as const;

function StatusRow({ icon, label, on, value }: { icon: ReactNode; label: string; on: boolean; value: string }) {
  return (
    <li>
      <span className="label">
        {icon}
        {label}
      </span>
      <b className={on ? 'on' : 'off'}>{value}</b>
    </li>
  );
}

export default function App({ onLocked }: { onLocked: () => void }) {
  const support = pushSupport();
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(
    'Notification' in window ? Notification.permission : 'unsupported',
  );
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<Log[]>([]);
  const standalone = isStandalone();

  const log = (text: string, kind: Log['kind'] = 'info') =>
    setLogs((l) => [{ at: Date.now(), text, kind }, ...l].slice(0, 20));

  useEffect(() => {
    if (support !== 'ok') return;
    currentSubscription().then(setSub).catch(() => {});
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'push') log(`수신 · ${e.data.payload.title} — ${e.data.payload.body}`, 'ok');
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [support]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (e instanceof UnauthorizedError) return onLocked();
      log(e instanceof Error ? e.message : String(e), 'err');
    } finally {
      setBusy(false);
      if ('Notification' in window) setPerm(Notification.permission);
    }
  }

  const onEnable = () =>
    run(async () => {
      setSub(await enablePush());
      log('알림이 켜졌습니다.', 'ok');
    });

  const onDisable = () =>
    run(async () => {
      await disablePush();
      setSub(null);
      log('알림을 껐습니다.');
    });

  const onTest = (delay: number) =>
    run(async () => {
      if (!sub) throw new Error('먼저 알림을 켜 주세요.');
      await sendTestPush(sub, delay);
      log(delay ? `${delay}초 뒤 발송 예약 — 지금 앱을 닫고 화면을 꺼 보세요.` : '발송 요청 완료', 'ok');
    });

  const permText = { granted: '허용', denied: '차단', default: '확인 전', unsupported: '지원 안 함' }[perm];

  return (
    <div className="app">
      <header className="top">
        <h1>
          <BellRing size={22} strokeWidth={2.4} aria-hidden />
          순번 알리미
        </h1>
        <p className="sub">2단계 · 대기 순번 감시 테스트</p>
      </header>

      <main>
        {support !== 'ok' && (
          <section className="card warn">
            <CircleAlert size={18} aria-hidden />
            <span>
              {support === 'insecure'
                ? 'https 주소에서만 알림을 받을 수 있습니다.'
                : '이 브라우저는 푸시 알림을 지원하지 않습니다. 안드로이드 크롬에서 열어 주세요.'}
            </span>
          </section>
        )}

        <section className="card">
          <h2>상태</h2>
          <ul className="status">
            <StatusRow icon={<Smartphone size={18} aria-hidden />} label="홈 화면 앱으로 실행" on={standalone} value={standalone ? '예' : '아니요'} />
            <StatusRow icon={<Bell size={18} aria-hidden />} label="알림 권한" on={perm === 'granted'} value={permText} />
            <StatusRow icon={<Zap size={18} aria-hidden />} label="푸시 연결" on={!!sub} value={sub ? '연결됨' : '없음'} />
          </ul>
          {!standalone && (
            <p className="hint">
              <Download size={15} aria-hidden />
              <span>
                크롬 메뉴 <EllipsisVertical size={14} className="inline" aria-label="더보기" /> → “홈 화면에 추가” 또는 “앱
                설치”로 설치하면 앱처럼 쓸 수 있어요.
              </span>
            </p>
          )}
          {perm === 'denied' && (
            <p className="hint err">
              <CircleAlert size={15} aria-hidden />
              <span>알림이 차단되어 있습니다. 주소창 왼쪽 아이콘 → 권한 → 알림을 허용해 주세요.</span>
            </p>
          )}
        </section>

        <section className="card">
          <h2>알림</h2>
          {!sub ? (
            <button className="primary" disabled={busy || support !== 'ok'} onClick={onEnable}>
              <Bell size={20} aria-hidden />
              알림 켜기
            </button>
          ) : (
            <div className="stack">
              <button className="primary" disabled={busy} onClick={() => onTest(0)}>
                <BellRing size={20} aria-hidden />
                지금 테스트 알림 받기
              </button>
              <button className="primary outline" disabled={busy} onClick={() => onTest(15)}>
                <Timer size={20} aria-hidden />
                15초 뒤 알림 (화면 끄고 기다리기)
              </button>
              <button className="ghost" disabled={busy} onClick={onDisable}>
                <BellOff size={18} aria-hidden />
                알림 끄기
              </button>
            </div>
          )}
        </section>

        <WatchTest subscription={sub} onError={(m) => log(m, 'err')} onLocked={onLocked} />

        <section className="card">
          <h2>기록</h2>
          {logs.length === 0 ? (
            <p className="muted">아직 기록이 없습니다.</p>
          ) : (
            <ul className="logs">
              {logs.map((l) => {
                const Icon = LOG_ICON[l.kind];
                return (
                  <li key={l.at + l.text} className={l.kind}>
                    <Icon size={16} aria-hidden />
                    <div>
                      <time>{new Date(l.at).toLocaleTimeString('ko-KR')}</time>
                      <span>{l.text}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
