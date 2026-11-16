// 새 버전 감지 — 서버의 version.json 과 내 빌드 번호를 비교
import { useEffect, useState } from 'react';

interface VersionInfo {
  build: string;
  version: string;
  notes: string[];
}

const CHECK_EVERY = 5 * 60 * 1000;
const SEEN_KEY = 'doll-alarm:seen-build';

async function fetchVersion(): Promise<VersionInfo | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as VersionInfo;
  } catch {
    return null;
  }
}

/** 새 버전이 있으면 그 정보를, 없으면 null */
export function useUpdateAvailable() {
  const [next, setNext] = useState<VersionInfo | null>(null);
  useEffect(() => {
    let last = 0;
    const check = async () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 60_000) return;
      last = Date.now();
      const v = await fetchVersion();
      if (v && v.build !== __BUILD_ID__) setNext(v);
      // 서비스 워커도 새 것이 있으면 받아 둠
      navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
    };
    check();
    const t = setInterval(check, CHECK_EVERY);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);
  return next;
}

/** 업데이트 직후 한 번만 — 이번 버전에서 바뀐 점 */
export function useJustUpdated() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  useEffect(() => {
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(SEEN_KEY);
      localStorage.setItem(SEEN_KEY, __BUILD_ID__);
    } catch {
      return;
    }
    // 처음 설치한 경우(seen 없음)는 알리지 않음
    if (!seen || seen === __BUILD_ID__) return;
    fetchVersion().then((v) => v && v.build === __BUILD_ID__ && setInfo(v));
  }, []);
  return info;
}

export function reloadToUpdate() {
  location.reload();
}

/** 새 버전이 있으면, 앱을 잠시 떠났다가 돌아올 때 자동 적용 (입력 중인 화면은 제외) */
export function useAutoApplyOnReturn(available: boolean) {
  useEffect(() => {
    if (!available) return;
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const editing = /\/(new|edit)/.test(location.pathname) || document.activeElement?.matches('input, textarea, select');
      if (hiddenAt && Date.now() - hiddenAt > 30_000 && !editing) location.reload();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [available]);
}
