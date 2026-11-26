// 내 인형 — 산 인형 스크린샷을 사이트별로 모아 보기 (사진은 휴대폰에만)
import { Archive, ArrowLeftRight, ImageUp, ChevronLeft, ChevronRight, Columns3, Columns4, Gift, Heart, ImagePlus, Store, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getSetting, listSites, type Site } from '../db/local';
import { listPhotos, STATUS_LABEL, type Photo, type PhotoStatus } from '../db/photos';
import { useLive } from '../data/events';
import { addPhotos, addTradePhoto, deletePhoto, replacePhoto, fmtBytes, movePhoto, setPhotoStatus } from '../data/photos';
import { Empty, Header } from '../ui/parts';
import { navigate } from '../lib/router';
import { Sheet } from '../ui/TypeList';

const ETC = '__etc';
/** 썸네일 라벨 — 교환은 악수, 양도는 눈물 */
const STATUS_EMOJI: Record<PhotoStatus, string> = { traded: '🤝', given: '🥲' };
type Filter = 'all' | string;

/** Blob → 화면용 주소 (안 보이게 되면 정리) */
function useBlobUrl(b: Blob | undefined) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!b) return;
    const u = URL.createObjectURL(b);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [b]);
  return url;
}

function Thumb({ p, onOpen }: { p: Photo; onOpen: () => void }) {
  const url = useBlobUrl(p.thumb);
  return (
    <button className={`ph-thumb ${p.status === 'given' ? 'is-given' : ''}`} onClick={onOpen} aria-label="사진 크게 보기">
      {url && <img src={url} alt="" loading="lazy" decoding="async" draggable={false} />}
      {p.status ? (
        <span className={`ph-badge ${p.status}`}>
          <span className="ph-emoji" aria-hidden>
            {STATUS_EMOJI[p.status]}
          </span>
          {STATUS_LABEL[p.status]}
        </span>
      ) : (
        p.tradedFrom && (
          <span className="ph-badge got" aria-label="교환으로 받음">
            <ArrowLeftRight size={11} />
          </span>
        )
      )}
    </button>
  );
}

const readCols = () => {
  try {
    return localStorage.getItem('photoCols') === '4' ? 4 : 3;
  } catch {
    return 3;
  }
};

export default function Photos({ onError, onInfo }: { onError: (e: unknown) => void; onInfo: (m: string) => void }) {
  const photos = useLive(listPhotos, ['photos']);
  const rawSites = useLive(listSites, ['sites']);
  const [order, setOrder] = useState<string[] | null>(null);
  const [lastBackup, setLastBackup] = useState<{ at: number; photos: number } | null>();
  useEffect(() => {
    getSetting<string[]>('siteOrder').then((o) => setOrder(o ?? null));
    getSetting<{ at: number; photos: number }>('lastBackup').then((b) => setLastBackup(b ?? null));
  }, []);
  // 백업 뒤로 사진이 늘었고 일주일이 지났으면 작게 알려 줌
  const backupOld =
    lastBackup !== undefined &&
    !!photos?.length &&
    (lastBackup ? photos.length > lastBackup.photos && Date.now() - lastBackup.at > 7 * 86400000 : photos.length >= 5);
  // 홈과 같은 순서
  const sites = useMemo(() => {
    const list = [...(rawSites ?? [])];
    if (order) list.sort((a, b) => (order.indexOf(a.id) + 1 || 1e9) - (order.indexOf(b.id) + 1 || 1e9));
    return list;
  }, [rawSites, order]);
  const siteIds = new Set(sites.map((s) => s.id));
  const keyOf = (p: Photo) => (p.siteId && siteIds.has(p.siteId) ? p.siteId : ETC);

  const [filter, setFilter] = useState<Filter>('all');
  const [cols, setColsState] = useState<3 | 4>(readCols);
  const setCols = (n: 3 | 4) => {
    setColsState(n);
    try {
      localStorage.setItem('photoCols', String(n));
    } catch {
      // 저장 못 해도 이번에는 적용
    }
  };
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // 가지고 있는 인형 / 교환·양도로 떠나보낸 인형
  const [sent, setSent] = useState(false);
  const sentCount = (photos ?? []).filter((p) => p.status).length;
  useEffect(() => {
    if (sent && photos && !sentCount) setSent(false);
  }, [sent, photos, sentCount]);
  const inBox = (photos ?? []).filter((p) => !!p.status === sent);

  const counts = new Map<string, number>();
  for (const p of inBox) counts.set(keyOf(p), (counts.get(keyOf(p)) ?? 0) + 1);
  const tabs = [
    ...sites.filter((s) => counts.get(s.id)).map((s) => ({ key: s.id, name: s.name })),
    ...(counts.get(ETC) ? [{ key: ETC, name: '기타' }] : []),
  ];
  // 고른 사이트 사진이 모두 지워지면 전체로
  useEffect(() => {
    if (filter !== 'all' && photos && !counts.get(filter)) setFilter('all');
  });
  const shown = inBox.filter((p) => filter === 'all' || keyOf(p) === filter);
  const siteName = (p: Photo) => sites.find((s) => s.id === keyOf(p))?.name ?? '기타';

  return (
    <>
      <Header
        title="내 인형"
        sub={photos?.length ? `가지고 있는 인형 ${photos.length - sentCount}${sentCount ? ` • 떠나보낸 인형 ${sentCount}` : ''}` : '산 인형 사진 모아 보기'}
        right={
          <>
            {!!photos?.length && (
              <button className="round-btn" onClick={() => setCols(cols === 3 ? 4 : 3)} aria-label={`한 줄에 ${cols === 3 ? 4 : 3}개씩 보기`}>
                {cols === 3 ? <Columns4 size={20} /> : <Columns3 size={20} />}
              </button>
            )}
            <button className="round-btn" onClick={() => setAdding(true)} aria-label="사진 올리기">
              <ImagePlus size={21} />
            </button>
          </>
        }
      />
      <main className="page photos-page">
        {photos === undefined ? null : photos.length === 0 ? (
          <Empty emoji="🧸" title="아직 올린 사진이 없어요">
            <p>산 인형 스크린샷을 올려 두면 사이트별로 모아 볼 수 있어요. 사진은 이 휴대폰에만 저장돼요.</p>
            <button className="primary" onClick={() => setAdding(true)}>
              <ImagePlus size={18} aria-hidden /> 사진 올리기
            </button>
          </Empty>
        ) : (
          <>
            {sentCount > 0 && (
              <div className="ph-seg" role="tablist">
                <button role="tab" aria-selected={!sent} onClick={() => (setSent(false), setFilter('all'))}>
                  <Heart size={14} aria-hidden /> 가지고 있어요 <small className="num">{photos.length - sentCount}</small>
                </button>
                <button role="tab" aria-selected={sent} onClick={() => (setSent(true), setFilter('all'))}>
                  <ArrowLeftRight size={14} aria-hidden /> 교환·양도 <small className="num">{sentCount}</small>
                </button>
              </div>
            )}
            {tabs.length > 0 && (
              <div className="ph-tabs" role="tablist">
                <button role="tab" aria-selected={filter === 'all'} className="ph-tab" onClick={() => setFilter('all')}>
                  전체 <small className="num">{inBox.length}</small>
                </button>
                {tabs.map((t) => (
                  <button key={t.key} role="tab" aria-selected={filter === t.key} className="ph-tab" onClick={() => setFilter(t.key)}>
                    {t.name} <small className="num">{counts.get(t.key)}</small>
                  </button>
                ))}
              </div>
            )}
            {!shown.length && <p className="hint page-hint">{sent ? '교환·양도한 인형이 없어요.' : '모두 교환·양도했어요.'}</p>}
            {backupOld && (
              <button className="ph-backup" onClick={() => navigate('/settings')}>
                <Archive size={14} aria-hidden /> {lastBackup ? '마지막 백업 뒤로 사진이 늘었어요' : '사진을 백업해 두면 휴대폰을 바꿔도 안전해요'} · <u>백업하기</u>
              </button>
            )}
            <div className={`ph-grid cols-${cols}`}>
              {shown.map((p) => (
                <Thumb key={p.id} p={p} onOpen={() => setOpenId(p.id)} />
              ))}
            </div>
          </>
        )}
      </main>

      {adding && (
        <AddSheet
          sites={sites}
          initial={filter === 'all' || filter === ETC ? null : filter}
          onClose={() => setAdding(false)}
          onDone={(siteId, r) => {
            setAdding(false);
            if (siteId && filter !== 'all' && filter !== siteId) setFilter(siteId);
            if (!r.saved) return onError(new Error('사진을 읽지 못했어요. 그림 파일인지 확인해 주세요.'));
            onInfo(`사진 ${r.saved}장 저장 · ${fmtBytes(r.before)} → ${fmtBytes(r.after)}${r.failed ? ` (${r.failed}장 건너뜀)` : ''}`);
          }}
          onError={onError}
        />
      )}
      {openId && (
        <Viewer
          list={shown}
          all={photos ?? []}
          onJump={(q) => {
            setSent(!!q.status);
            setFilter('all');
            setOpenId(q.id);
          }}
          id={openId}
          sites={sites}
          siteName={siteName}
          onChange={setOpenId}
          onClose={() => setOpenId(null)}
          onError={onError}
        />
      )}
    </>
  );
}

/** 사이트 고르기 칩 (기타 포함) */
function SitePick({ sites, value, onChange }: { sites: Site[]; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="chips">
      {sites.map((s) => (
        <button key={s.id} type="button" role="radio" aria-checked={value === s.id} className="chip" onClick={() => onChange(s.id)}>
          {s.name}
        </button>
      ))}
      <button type="button" role="radio" aria-checked={value === null} className="chip" onClick={() => onChange(null)}>
        기타
      </button>
    </div>
  );
}

function AddSheet({
  sites,
  initial,
  onClose,
  onDone,
  onError,
}: {
  sites: Site[];
  initial: string | null;
  onClose: () => void;
  onDone: (siteId: string | null, r: Awaited<ReturnType<typeof addPhotos>>) => void;
  onError: (e: unknown) => void;
}) {
  const [siteId, setSiteId] = useState<string | null>(initial ?? sites[0]?.id ?? null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const pick = async (files: File[]) => {
    if (!files.length) return;
    setProgress({ done: 0, total: files.length });
    try {
      const r = await addPhotos(files, siteId, (done) => setProgress({ done, total: files.length }));
      onDone(siteId, r);
    } catch (e) {
      setProgress(null);
      onError(e);
    }
  };

  return (
    <Sheet title="사진 올리기" onClose={progress ? () => {} : onClose}>
      <div className="field">
        <span>어느 사이트에서 샀나요?</span>
        <SitePick sites={sites} value={siteId} onChange={setSiteId} />
      </div>
      <p className="hint">
        <Store size={14} aria-hidden />
        <span>여러 장을 한 번에 고를 수 있어요. 용량을 줄여(webp) 이 휴대폰에만 저장해요.</span>
      </p>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          pick(files);
        }}
      />
      <button className="primary" disabled={!!progress} onClick={() => input.current?.click()}>
        <ImagePlus size={18} aria-hidden />
        {progress ? `줄이는 중… ${progress.done}/${progress.total}` : '사진 고르기'}
      </button>
    </Sheet>
  );
}

/** 교환 짝 사진 — 크게 보기 구석에 작게 */
function PairInset({ p, label, onOpen }: { p: Photo; label: string; onOpen: () => void }) {
  const url = useBlobUrl(p.thumb);
  return (
    <button className="pv-inset" onClick={onOpen} aria-label={`${label} 사진 보기`}>
      {url && <img src={url} alt="" draggable={false} />}
      <span>
        <ArrowLeftRight size={10} aria-hidden /> {label}
      </span>
    </button>
  );
}

function Viewer({
  list,
  all,
  onJump,
  id,
  sites,
  siteName,
  onChange,
  onClose,
  onError,
}: {
  list: Photo[];
  all: Photo[];
  onJump: (p: Photo) => void;
  id: string;
  sites: Site[];
  siteName: (p: Photo) => string;
  onChange: (id: string) => void;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const i = list.findIndex((p) => p.id === id);
  const p = list[i];
  const url = useBlobUrl(p?.blob);
  const [moving, setMoving] = useState(false);
  const [marking, setMarking] = useState(false);
  const [tradeBusy, setTradeBusy] = useState(false);
  const tradeInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  // 뒤로 가기로 닫기
  useEffect(() => {
    history.pushState({ viewer: true }, '');
    const onPop = () => onClose();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const close = () => history.back();

  // 보던 사진이 이 목록에서 빠지면(교환·양도 표시, 사이트 바꾸기) 그 사진이 있는 목록으로 따라감
  useEffect(() => {
    if (p) return;
    const q = all.find((x) => x.id === id);
    if (q) onJump(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, all]);
  if (!p) return null;
  // 교환 짝 사진 (보낸 ↔ 받은)
  const pairId = p.tradedFrom ?? p.tradedTo;
  const pair = pairId ? all.find((x) => x.id === pairId) : undefined;
  const pickTrade = async (f: File | undefined) => {
    if (!f) return;
    setTradeBusy(true);
    try {
      const got = await addTradePhoto(p, f);
      setMarking(false);
      onJump(got);
    } catch (e) {
      onError(e);
    } finally {
      setTradeBusy(false);
    }
  };

  const go = (d: number) => {
    const n = list[i + d];
    if (n) onChange(n.id);
  };
  const date = new Date(p.takenAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="ph-viewer" role="dialog" aria-modal="true" aria-label="사진 보기">
      <div className="pv-bar">
        <button className="pv-btn" onClick={close} aria-label="닫기">
          <X size={22} />
        </button>
        <span className="num pv-count">
          {i + 1} / {list.length}
        </span>
        <div className="pv-actions">
        <input
          ref={replaceInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setReplacing(true);
            replacePhoto(p, f)
              .catch(onError)
              .finally(() => setReplacing(false));
          }}
        />
        <button className="pv-btn" disabled={replacing} onClick={() => replaceInput.current?.click()} aria-label="사진 바꾸기">
          <ImageUp size={20} />
        </button>
        <button
          className="pv-btn"
          aria-label="사진 삭제"
          onClick={() => {
            if (!confirm('이 사진을 지울까요?')) return;
            const next = list[i + 1] ?? list[i - 1];
            deletePhoto(p.id)
              .then(() => (next ? onChange(next.id) : close()))
              .catch(onError);
          }}
        >
          <Trash2 size={20} />
        </button>
        </div>
      </div>
      <div
        className="pv-scroll"
        onPointerDown={(e) => (swipe.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s) return;
          const dx = e.clientX - s.x;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) go(dx < 0 ? 1 : -1);
        }}
      >
        {url && <img src={url} alt="" draggable={false} />}
      </div>
      {i > 0 && (
        <button className="pv-nav prev" onClick={() => go(-1)} aria-label="이전 사진">
          <ChevronLeft size={22} />
        </button>
      )}
      {i < list.length - 1 && (
        <button className="pv-nav next" onClick={() => go(1)} aria-label="다음 사진">
          <ChevronRight size={22} />
        </button>
      )}
      {pair && <PairInset p={pair} label={p.tradedFrom ? '보낸 인형' : '받은 인형'} onOpen={() => onJump(pair)} />}
      <div className="pv-foot">
        <button className="pv-site" onClick={() => setMoving(true)}>
          <Store size={14} aria-hidden /> {siteName(p)}
        </button>
        <button className={`pv-site pv-status ${p.status ?? ''}`} onClick={() => setMarking(true)}>
          {p.status === 'traded' ? <ArrowLeftRight size={14} aria-hidden /> : p.status === 'given' ? <Gift size={14} aria-hidden /> : <Heart size={14} aria-hidden />}
          {p.status ? `${STATUS_LABEL[p.status]}했어요` : '가지고 있어요'}
        </button>
        <small>{date}</small>
      </div>
      {marking && (
        <Sheet title="이 인형은…" onClose={() => setMarking(false)}>
          <div className="chips">
            {([null, 'traded', 'given'] as (PhotoStatus | null)[]).map((st) => (
              <button
                key={st ?? 'own'}
                type="button"
                role="radio"
                aria-checked={(p.status ?? null) === st}
                className="chip"
                onClick={() => {
                  // 교환은 받은 인형 사진을 이어서 물어봄
                  if (st !== 'traded') setMarking(false);
                  if ((p.status ?? null) !== st) setPhotoStatus(p, st).catch(onError);
                }}
              >
                {st ? `${STATUS_LABEL[st]}했어요` : '가지고 있어요'}
              </button>
            ))}
          </div>
          {p.status === 'traded' && !pair && (
            <div className="trade-ask">
              <b>교환으로 받은 인형 사진도 올릴까요?</b>
              <small>받은 사진이 크게, 보낸 사진은 구석에 작게 함께 보여요.</small>
              <input ref={tradeInput} type="file" accept="image/*" hidden onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                pickTrade(f);
              }} />
              <button className="primary" disabled={tradeBusy} onClick={() => tradeInput.current?.click()}>
                <ImagePlus size={18} aria-hidden /> {tradeBusy ? '줄이는 중…' : '받은 인형 사진 고르기'}
              </button>
              <button className="text-btn" onClick={() => setMarking(false)}>
                나중에 할게요
              </button>
            </div>
          )}
          <p className="hint">
            <ArrowLeftRight size={14} aria-hidden />
            <span>교환·양도로 표시하면 ‘교환·양도’ 목록으로 옮겨져요. 사진은 지워지지 않아요.</span>
          </p>
        </Sheet>
      )}
      {moving && (
        <Sheet title="사이트 바꾸기" onClose={() => setMoving(false)}>
          <SitePick
            sites={sites}
            value={p.siteId && sites.some((s) => s.id === p.siteId) ? p.siteId : null}
            onChange={(v) => {
              setMoving(false);
              movePhoto(p, v).catch(onError);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}
