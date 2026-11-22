// 모니터링 종류 고르기 — 대기 순번 / 상품 상태 / 신규 상품 / 재입고 / 기타
import { ChevronRight, ListOrdered, Lock, PackageCheck, Search, Sparkles, Tag, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SiteKind } from '../db/local';
import type { WatchTypeInfo } from '../data/sites';

export const KIND_ICON: Record<SiteKind, LucideIcon> = {
  queue: ListOrdered,
  product: Tag,
  'new-product': Sparkles,
  restock: PackageCheck,
  etc: Search,
};

export function TypeList({ types, onPick }: { types: WatchTypeInfo[]; onPick: (t: WatchTypeInfo) => void }) {
  return (
    <div className="list-card type-list">
      {types.map((t) => {
        const Icon = KIND_ICON[t.kind];
        return (
          <button key={t.kind} className={`row-item ${t.available ? '' : 'disabled'}`} disabled={!t.available} onClick={() => onPick(t)}>
            <span className={`type-icon kind-${t.kind}`} aria-hidden>
              <Icon size={20} />
            </span>
            <div className="row-main">
              <b>{t.label} 모니터링</b>
              <small>{t.available ? t.desc : t.reason}</small>
            </div>
            {t.available ? <ChevronRight size={16} className="chev" aria-hidden /> : <Lock size={15} className="chev" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

/** 아래에서 올라오는 선택 창 */
export function Sheet({ title, onClose, children, action }: { title: string; onClose: () => void; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <span className="sheet-grip" aria-hidden />
        {action ? (
          <div className="sheet-head">
            <h2>{title}</h2>
            {action}
          </div>
        ) : (
          <h2>{title}</h2>
        )}
        {children}
      </div>
    </div>
  );
}
