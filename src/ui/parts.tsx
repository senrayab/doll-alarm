// 공통 화면 부품
import { ChevronLeft, CircleAlert, CircleCheck, CirclePause, Clock, Link2Off, PartyPopper, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Site } from '../db/local';
import { goBack } from '../lib/router';
import type { WatchState } from '../data/watches';
import { WATCH_STATE_LABEL } from '../data/watches';
import { SITE_STATE_LABEL, type SiteState } from '../data/sites';

export function Header({ title, back, right }: { title: string; back?: string; right?: ReactNode }) {
  return (
    <header className="bar">
      {back !== undefined ? (
        <button className="icon-btn" onClick={() => goBack(back)} aria-label="뒤로">
          <ChevronLeft size={24} />
        </button>
      ) : (
        <span className="bar-spacer" />
      )}
      <h1>{title}</h1>
      <div className="bar-right">{right}</div>
    </header>
  );
}

/** 사이트 아이콘 — 외부 파비콘 서비스를 쓰지 않음 (접속 정보가 남에게 가지 않게) */
const PALETTE = ['#e34b91', '#7c5cff', '#1f9d74', '#f08c00', '#2f80ed', '#c2410c', '#0e9aa7'];
export function SiteAvatar({ site, size = 40 }: { site: Pick<Site, 'id' | 'name'>; size?: number }) {
  let h = 0;
  for (const c of site.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const color = PALETTE[h % PALETTE.length];
  return (
    <span className="avatar" style={{ width: size, height: size, background: color, fontSize: size * 0.45 }} aria-hidden>
      {[...site.name.trim()][0] ?? '?'}
    </span>
  );
}

const WATCH_ICON: Record<WatchState, LucideIcon> = {
  running: CircleCheck,
  paused: CirclePause,
  error: CircleAlert,
  met: PartyPopper,
  lost: Link2Off,
  waiting: Clock,
};

export function WatchStatePill({ state }: { state: WatchState }) {
  const Icon = WATCH_ICON[state];
  return (
    <span className={`state state-${state}`}>
      <Icon size={13} aria-hidden />
      {WATCH_STATE_LABEL[state]}
    </span>
  );
}

export function SiteStatePill({ state }: { state: SiteState }) {
  return <span className={`state site-${state}`}>{SITE_STATE_LABEL[state]}</span>;
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
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
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

export function fmtInterval(sec: number) {
  return sec < 60 ? `${sec}초` : `${sec / 60}분`;
}
