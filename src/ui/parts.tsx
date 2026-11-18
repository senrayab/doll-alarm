// 공통 화면 부품
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Site } from '../db/local';
import { SITE_STATE_LABEL, type SiteState } from '../data/sites';
import type { WatchState } from '../data/watches';
import { WATCH_STATE_LABEL } from '../data/watches';
import { goBack } from '../lib/router';

/** 큰 제목 헤더 (탭 화면) — back 이 있으면 뒤로가기 원형 버튼 + 가운데 작은 제목 */
export function Header({ title, sub, back, right }: { title: string; sub?: ReactNode; back?: string; right?: ReactNode }) {
  if (back !== undefined) {
    return (
      <header className="bar">
        <button className="round-btn" onClick={() => goBack(back)} aria-label="뒤로">
          <ArrowLeft size={20} />
        </button>
        <h1 className="bar-title">{title}</h1>
        <div className="bar-right">{right}</div>
      </header>
    );
  }
  return (
    <header className="hero-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="crumbs">{sub}</p>}
      </div>
      <div className="bar-right">{right}</div>
    </header>
  );
}

/** 사이트 아이콘 — 파스텔 오라 원 + 첫 글자 (외부 파비콘 서비스를 쓰지 않음) */
const HUES = [
  ['#ffd3a8', '#ff9a62'],
  ['#ffc9e3', '#ff6fae'],
  ['#cfe3ff', '#7fa8ff'],
  ['#e4f7a6', '#b9e34a'],
  ['#e3d6ff', '#a68cff'],
  ['#c9f1ea', '#5cc8b6'],
];
export function SiteAvatar({ site, size = 44 }: { site: Pick<Site, 'id' | 'name'>; size?: number }) {
  let h = 0;
  for (const c of site.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [a, b] = HUES[h % HUES.length];
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `radial-gradient(circle at 70% 75%, ${b} 0%, ${a} 70%)` }}
      aria-hidden
    >
      {[...site.name.trim()][0] ?? '?'}
    </span>
  );
}

export function WatchStatePill({ state }: { state: WatchState }) {
  return (
    <span className={`dot-label dot-${state}`}>
      <i aria-hidden />
      {WATCH_STATE_LABEL[state]}
    </span>
  );
}

export function SiteStatePill({ state }: { state: SiteState }) {
  return (
    <span className={`dot-label site-${state}`}>
      <i aria-hidden />
      {SITE_STATE_LABEL[state]}
    </span>
  );
}

/** 빈 화면 — 이모지는 Tossface */
export function Empty({ emoji, title, children }: { emoji: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-emoji" aria-hidden>
        {emoji}
      </div>
      <b>{title}</b>
      {children}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="toggle" disabled={disabled} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export const fmtNo = (n: number | null | undefined) => (n == null ? '—' : String(n).padStart(3, '0'));

export function fmtAgo(t: number | null | undefined, now = Date.now()) {
  if (!t) return '확인 전';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 10) return '방금';
  if (s < 60) return `${s}초 전`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return new Date(t).toLocaleDateString('ko-KR');
}

export const fmtTime = (t: number | null | undefined) =>
  t ? new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

/** 기록 시각 — 오늘이면 "오후 03:12", 지난 날이면 "11/17 15:12" */
export function fmtStamp(t: number, now = Date.now()) {
  const d = new Date(t);
  if (d.toDateString() === new Date(now).toDateString()) return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtInterval(sec: number) {
  return sec < 60 ? `${sec}초` : `${sec / 60}분`;
}
