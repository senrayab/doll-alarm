// 손잡이를 잡고 위아래로 끌어 순서 바꾸기
// - 끄는 카드는 손가락을 그대로 따라가고 살짝 떠오름
// - 다른 카드는 자리를 비켜 줄 때 부드럽게 미끄러짐 (FLIP)
// - 놓으면 제자리로 스르륵 자리 잡고 onReorder 로 새 순서를 알림
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export interface HandleProps {
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  'aria-label': string;
  className: string;
}

export function SortableList({
  ids,
  onReorder,
  renderItem,
  className,
}: {
  ids: string[];
  onReorder: (ids: string[]) => void;
  renderItem: (id: string, handle: HandleProps, dragging: boolean) => ReactNode;
  className?: string;
}) {
  const [order, setOrderState] = useState(ids);
  const orderRef = useRef(ids);
  const setOrder = (n: string[]) => {
    orderRef.current = n;
    setOrderState(n);
  };
  const [dragId, setDragId] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const drag = useRef<{ id: string; startY: number; lastY: number; pointerId: number; el: HTMLElement } | null>(null);
  const before = useRef<Map<string, number> | null>(null);
  const pending = useRef(false);

  // 밖에서 목록이 바뀌면(사이트 추가·삭제) 따라감 — 끄는 중에는 그대로
  const idsKey = ids.join('|');
  const [seenKey, setSeenKey] = useState(idsKey);
  if (!dragId && idsKey !== seenKey) {
    setSeenKey(idsKey);
    setOrder(ids);
  }

  const paintDragged = () => {
    const d = drag.current;
    const el = d && rows.current.get(d.id);
    if (!d || !el) return;
    el.style.transition = 'box-shadow 0.2s';
    el.style.transform = `translate3d(0, ${d.lastY - d.startY}px, 0) scale(1.02)`;
  };

  // 순서가 바뀐 직후: 다른 카드는 옛 자리에서 새 자리로 미끄러지게, 끄는 카드는 손가락 위치 유지
  useLayoutEffect(() => {
    pending.current = false;
    const prev = before.current;
    before.current = null;
    if (!prev) return;
    for (const [id, el] of rows.current) {
      if (id === drag.current?.id) continue;
      const old = prev.get(id);
      if (old == null) continue;
      const delta = old - el.getBoundingClientRect().top;
      if (!delta) continue;
      el.style.transition = 'none';
      el.style.transform = `translate3d(0, ${delta}px, 0)`;
      el.getBoundingClientRect(); // 리플로우
      el.style.transition = `transform 0.32s ${EASE}`;
      el.style.transform = '';
    }
    paintDragged();
  }, [order]);

  function start(id: string, e: React.PointerEvent) {
    e.stopPropagation(); // 옆으로 밀기(수정·삭제)와 겹치지 않게
    e.preventDefault();
    const el = rows.current.get(id);
    if (!el) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // 포인터가 이미 사라진 경우 — window 이벤트로 계속 따라감
    }
    drag.current = { id, startY: e.clientY, lastY: e.clientY, pointerId: e.pointerId, el: e.currentTarget as HTMLElement };
    setDragId(id);
    navigator.vibrate?.(10);
    paintDragged();
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      d.lastY = ev.clientY;
      paintDragged();
      // 이웃 카드의 가운데를 넘으면 자리 바꿈
      // (화면이 새 순서로 다시 그려지기 전에는 다시 판단하지 않음 — 옛 자리로 재면 되돌아감)
      if (pending.current) return;
      const cur = orderRef.current;
      const i = cur.indexOf(d.id);
      const me = rows.current.get(d.id);
      if (!me) return;
      const dy = d.lastY - d.startY;
      // 움직임(transform)과 상관없는 실제 자리로 계산
      const myTop = me.offsetTop;
      const myBottom = myTop + me.offsetHeight;
      const next = cur[i + 1] ? rows.current.get(cur[i + 1]) : undefined;
      const prev = cur[i - 1] ? rows.current.get(cur[i - 1]) : undefined;
      if (next && dy > 0 && myBottom + dy > next.offsetTop + next.offsetHeight / 2) {
        before.current = snapshot();
        pending.current = true;
        d.startY += next.offsetTop + next.offsetHeight - myBottom; // 새 자리 기준으로
        const n = [...cur];
        [n[i], n[i + 1]] = [n[i + 1], n[i]];
        setOrder(n);
      } else if (prev && dy < 0 && myTop + dy < prev.offsetTop + prev.offsetHeight / 2) {
        before.current = snapshot();
        pending.current = true;
        d.startY += prev.offsetTop - myTop;
        const n = [...cur];
        [n[i], n[i - 1]] = [n[i - 1], n[i]];
        setOrder(n);
      }
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      const d = drag.current;
      drag.current = null;
      const me = d && rows.current.get(d.id);
      if (me) {
        me.style.transition = `transform 0.35s ${EASE}, box-shadow 0.35s`;
        me.style.transform = '';
      }
      setDragId(null);
      if (orderRef.current.join('|') !== ids.join('|')) onReorder(orderRef.current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function snapshot() {
    const m = new Map<string, number>();
    for (const [id, el] of rows.current) m.set(id, el.getBoundingClientRect().top);
    return m;
  }

  return (
    <div className={className}>
      {order.map((id) => (
        <div
          key={id}
          className={`sort-row ${dragId === id ? 'dragging' : ''}`}
          ref={(el) => {
            if (el) rows.current.set(id, el);
            else rows.current.delete(id);
          }}
        >
          {renderItem(
            id,
            {
              onPointerDown: (e) => start(id, e),
              onClick: (e) => {
                e.stopPropagation();
                e.preventDefault();
              },
              'aria-label': '끌어서 순서 바꾸기',
              className: 'drag-handle',
            },
            dragId === id,
          )}
        </div>
      ))}
    </div>
  );
}
