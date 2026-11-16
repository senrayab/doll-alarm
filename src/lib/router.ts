// 아주 작은 라우터 — 주소(path)로 화면 결정, 뒤로가기 지원
import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
window.addEventListener('popstate', notify);

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === location.pathname + location.search) return;
  if (opts.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.scrollTo(0, 0);
  notify();
}

/** 앱 안에서 이전 화면이 있으면 뒤로, 없으면 fallback 으로 */
export function goBack(fallback = '/') {
  if (history.state?.idx > 0 || history.length > 1) {
    const before = location.href;
    history.back();
    // 앱 밖으로 나가는 경우(첫 화면) 대비
    setTimeout(() => location.href === before && navigate(fallback, { replace: true }), 150);
  } else navigate(fallback, { replace: true });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useLocation() {
  const path = useSyncExternalStore(subscribe, () => location.pathname);
  const search = useSyncExternalStore(subscribe, () => location.search);
  return { path, query: new URLSearchParams(search) };
}

/** "/sites/:id" 같은 패턴과 비교 */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const a = path.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}
