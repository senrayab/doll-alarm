// 오라 그라데이션 — 상태 색이 흐릿하게 번지는 영역 + 인형 눈
import { useId, type ReactNode } from 'react';
import type { Tone } from '../data/watches';

export function Aura({ tone, children, eyes = true, className = '' }: { tone: Tone; children?: ReactNode; eyes?: boolean; className?: string }) {
  return (
    <div className={`aura aura-${tone} ${className}`}>
      <div className="aura-glow" aria-hidden />
      {eyes && (
        <div className={`eyes ${tone === 'idle' ? 'sleepy' : ''}`} aria-hidden>
          <span />
          <span />
        </div>
      )}
      {children}
    </div>
  );
}

/** 진행 링 — 앞 인원이 줄수록 채워짐 (10명 기준) */
export function Ring({ ahead, current, size = 168, children }: { ahead: number | null; current?: boolean; size?: number; children?: ReactNode }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const p = current ? 1 : ahead == null ? 0 : Math.max(0, Math.min(1, 1 - ahead / 10));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="ring-bar"
          strokeDasharray={`${c * p} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-in">{children}</div>
    </div>
  );
}

/**
 * 이어진 알약 버튼 — [숫자] [동작] [숫자]
 * 동그라미 두 개와 가운데 알약을 SVG "goo" 필터로 녹여 붙여 이음새를 부드러운 오목 곡선으로 만든다.
 * 글자·버튼은 필터 밖 위층에 둬서 또렷하게.
 */
export function PillBar({
  left,
  right,
  children,
}: {
  left: { value: string; label: string };
  right: { value: string; label: string };
  children: ReactNode;
}) {
  const id = useId().replace(/:/g, '');
  return (
    <div className="pillbar">
      <svg width="0" height="0" aria-hidden className="pb-defs">
        <filter id={`goo-${id}`}>
          <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </svg>
      <div className="pb-shape" style={{ filter: `url(#goo-${id})` }} aria-hidden>
        <i className="pb-c" />
        <i className="pb-m" />
        <i className="pb-c" />
      </div>
      <div className="pb-content">
        <div className="pb-end">
          <b className="num">{left.value}</b>
          <small>{left.label}</small>
        </div>
        <div className="pb-mid">{children}</div>
        <div className="pb-end">
          <b className="num">{right.value}</b>
          <small>{right.label}</small>
        </div>
      </div>
    </div>
  );
}

/** "나나코어 • 모니터링 중 • 12초 전" 같은 흐린 작은 라벨 */
export function Crumbs({ items }: { items: (string | false | null | undefined)[] }) {
  return <p className="crumbs">{items.filter(Boolean).join(' • ')}</p>;
}
