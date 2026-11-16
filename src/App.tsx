// 앱 뼈대 — 화면 이동, 하단 탭, 안내 메시지, 서비스 워커 메시지 처리
import { Bell, Globe, House, Settings as SettingsIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { UnauthorizedError } from './api/client';
import { unreadCount } from './db/inbox';
import { getWatch } from './db/local';
import { emit, useLive } from './data/events';
import { cleanupTestJob, refreshWatch } from './data/watches';
import { match, navigate, useLocation } from './lib/router';
import { loadPushState } from './push/store';
import Alerts from './screens/Alerts';
import Home from './screens/Home';
import Settings from './screens/Settings';
import SiteDetail from './screens/SiteDetail';
import SiteForm from './screens/SiteForm';
import Sites from './screens/Sites';
import WatchDetail from './screens/WatchDetail';
import WatchNew from './screens/WatchNew';

type Toast = { id: number; text: string; kind: 'err' | 'info' };

const TABS = [
  { path: '/', label: '홈', Icon: House },
  { path: '/sites', label: '사이트', Icon: Globe },
  { path: '/alerts', label: '알림', Icon: Bell },
  { path: '/settings', label: '설정', Icon: SettingsIcon },
] as const;

export default function App({ onLocked }: { onLocked: () => void }) {
  const { path, query } = useLocation();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const unread = useLive(unreadCount, ['inbox']);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, kind }].slice(-3));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 5000 : 3000);
  }, []);

  const onError = useCallback(
    (e: unknown) => {
      if (e instanceof UnauthorizedError) return onLocked();
      toast(e instanceof Error ? e.message : String(e), 'err');
    },
    [onLocked, toast],
  );

  useEffect(() => {
    loadPushState();
    cleanupTestJob().catch(() => {});
    if (!('serviceWorker' in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'push') {
        emit('inbox');
        const jobId = e.data.payload?.jobId as string | undefined;
        if (jobId) getWatch(jobId).then((w) => w && refreshWatch(w).catch(() => {}));
      }
      if (e.data?.type === 'navigate') {
        const u = new URL(e.data.url, location.origin);
        navigate(u.pathname + u.search);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, []);

  let screen: ReactNode;
  let p: Record<string, string> | null;
  if (path === '/') screen = <Home onError={onError} />;
  else if (path === '/sites') screen = <Sites />;
  else if (path === '/sites/new') screen = <SiteForm onError={onError} />;
  else if ((p = match('/sites/:id/edit', path))) screen = <SiteForm key={p.id} id={p.id} onError={onError} />;
  else if ((p = match('/sites/:id', path))) screen = <SiteDetail key={p.id} id={p.id} onError={onError} />;
  else if (path === '/watch/new') screen = <WatchNew siteId={query.get('site')} onError={onError} />;
  else if ((p = match('/watch/:id', path))) screen = <WatchDetail key={p.id} id={p.id} onError={onError} />;
  else if (path === '/alerts') screen = <Alerts />;
  else if (path === '/settings') screen = <Settings onError={onError} onInfo={(m) => toast(m)} onLocked={onLocked} />;
  else screen = <Home onError={onError} />;

  const tabActive = (t: string) => (t === '/' ? path === '/' || path.startsWith('/watch') : path.startsWith(t));

  return (
    <div className="app shell">
      {screen}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
      <nav className="tabbar">
        {TABS.map(({ path: tp, label, Icon }) => (
          <button key={tp} className={tabActive(tp) ? 'active' : ''} onClick={() => navigate(tp)} aria-current={tabActive(tp) ? 'page' : undefined}>
            <span className="tab-icon">
              <Icon size={22} aria-hidden />
              {tp === '/alerts' && !!unread && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
            </span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
