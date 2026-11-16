// 당겨서 새로고침 — 홈 화면 앱(standalone)에는 크롬 기본 기능이 없어서 직접 구현
import { useEffect, useState } from 'react';

const TRIGGER = 80; // 이만큼(px) 당기면 새로고침

/** 화면 맨 위에서 아래로 당긴 거리 (0 ~ TRIGGER*1.3) */
export function usePullToRefresh(onRefresh: () => void) {
  const [pull, setPull] = useState(0);
  useEffect(() => {
    let startY: number | null = null;
    let dist = 0;
    const onStart = (e: TouchEvent) => {
      // 맨 위에 있고, 입력칸이 아닐 때만
      const t = e.target as HTMLElement;
      if (window.scrollY > 0 || t.closest('input, textarea, select, [data-no-pull]')) return;
      startY = e.touches[0].clientY;
      dist = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY == null) return;
      const d = e.touches[0].clientY - startY;
      if (d <= 0 || window.scrollY > 0) {
        dist = 0;
        setPull(0);
        return;
      }
      dist = Math.min(d * 0.5, TRIGGER * 1.3); // 손가락보다 덜 따라오게
      setPull(dist);
    };
    const onEnd = () => {
      if (startY != null && dist >= TRIGGER) onRefresh();
      startY = null;
      dist = 0;
      setPull(0);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [onRefresh]);
  return { pull, ready: pull >= TRIGGER };
}
