// 왼쪽으로 밀면 뒤에 버튼이 드러나는 카드 (홈 사이트 카드: 수정·삭제)
// - 한 번에 하나만 열림: 다른 카드를 밀기 시작하면 열려 있던 카드는 부드럽게 닫힘
// - 끌 때는 손가락을 그대로 따라가고, 놓으면 속도·거리로 열지/닫을지 정해 스프링처럼 자리 잡음
import { useEffect, useRef, type ReactNode } from 'react';

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export interface SwipeAction {
  label: string;
  icon: ReactNode;
  tone?: 'danger';
  onClick: () => void;
}

export function SwipeRow({
  id,
  openId,
  onOpenChange,
  actions,
  disabled,
  children,
}: {
  id: string;
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  actions: SwipeAction[];
  disabled?: boolean;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const width = actions.length * 76 + 8; // 버튼 칸 너비
  const offset = useRef(0);
  const drag = useRef<{ x: number; y: number; base: number; lock: 'x' | 'y' | null; lastX: number; lastT: number; v: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const open = openId === id;

  function paint(x: number, animate: boolean) {
    offset.current = x;
    const card = cardRef.current;
    const row = rowRef.current;
    if (!card || !row) return;
    card.style.transition = animate ? `transform 0.45s ${EASE}` : 'none';
    card.style.transform = x ? `translate3d(${x}px,0,0)` : '';
    // 버튼은 드러나는 만큼 커지고 진해짐
    const p = Math.min(1, -x / width);
    row.style.setProperty('--p', String(p));
    row.style.setProperty('--ease', animate ? `0.45s ${EASE}` : '0s');
  }

  // 밖에서 열림 상태가 바뀌면(다른 카드를 밀기 시작함 등) 부드럽게 따라감
  useEffect(() => {
    if (drag.current?.lock === 'x') return;
    paint(open ? -width : 0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, width]);

  // 열린 상태에서 다른 곳을 누르면 닫힘
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) onOpenChange(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open, onOpenChange]);

  function onPointerDown(e: React.PointerEvent) {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = { x: e.clientX, y: e.clientY, base: offset.current, lock: null, lastX: e.clientX, lastT: e.timeStamp, v: 0, moved: false };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.lock) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      d.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (d.lock === 'y') return; // 세로 스크롤은 그대로
      try {
        cardRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // 포인터가 이미 사라진 경우
      }
      if (openId !== id) onOpenChange(null); // 다른 카드가 열려 있으면 닫힘
    }
    if (d.lock !== 'x') return;
    d.moved = true;
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.v = 0.8 * ((e.clientX - d.lastX) / dt) + 0.2 * d.v;
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    let x = d.base + dx;
    // 끝을 넘으면 고무줄처럼 덜 따라감
    if (x > 0) x = x * 0.25;
    if (x < -width) x = -width + (x + width) * 0.3;
    paint(x, false);
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d || d.lock !== 'x') return;
    suppressClick.current = d.moved;
    const x = offset.current;
    const shouldOpen = d.v < -0.35 ? true : d.v > 0.35 ? false : x < -width / 2;
    paint(shouldOpen ? -width : 0, true);
    onOpenChange(shouldOpen ? id : open ? null : openId);
  }

  return (
    <div ref={rowRef} className="swipe-row">
      <div className="swipe-actions" style={{ width }} aria-hidden={!open}>
        {actions.map((a) => (
          <button
            key={a.label}
            className={`swipe-btn ${a.tone ?? ''}`}
            tabIndex={open ? 0 : -1}
            onClick={() => {
              onOpenChange(null);
              a.onClick();
            }}
          >
            {a.icon}
            <span>{a.label}</span>
          </button>
        ))}
      </div>
      <div
        ref={cardRef}
        className="swipe-card"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(e) => {
          // 끌고 난 직후의 클릭, 또는 열린 카드를 누르면 → 이동하지 않고 닫기만
          if (suppressClick.current || open) {
            e.preventDefault();
            e.stopPropagation();
            suppressClick.current = false;
            if (open) onOpenChange(null);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
