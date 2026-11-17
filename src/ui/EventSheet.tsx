// 일정 추가·수정 — 종류, 날짜·시간, 채널, 메모, 미리 알림
import { Bell, Plus, Save, Trash2, CalendarX2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RemindKey, Site, SiteEvent } from '../db/local';
import { addCustomType, channelLabel, customTypes, eventChannels, HOLIDAY, repeatText, DEFAULT_REMIND, deleteEvent, kstToMs, msToKst, PRESET_TYPES, REMIND_OPTIONS, saveEvent } from '../data/siteEvents';
import { siteLives } from '../data/sites';
import { usePush } from '../push/store';
import { Sheet } from './TypeList';

export function EventSheet({
  site,
  event,
  onClose,
  onError,
  onInfo,
}: {
  site: Site;
  event?: SiteEvent;
  onClose: () => void;
  onError: (e: unknown) => void;
  onInfo: (m: string) => void;
}) {
  const push = usePush();
  const lives = siteLives(site);
  const init = event ? msToKst(event.at) : { date: msToKst(Date.now() + 86_400_000).date, time: '21:00' };
  const [type, setType] = useState(event?.type ?? PRESET_TYPES[0]);
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [memo, setMemo] = useState(event?.memo ?? '');
  // 채널 여러 개 선택 (비어 있으면 전체)
  const [channels, setChannels] = useState<number[]>(event ? eventChannels(event) : []);
  const toggleChannel = (i: number) =>
    setChannels((cur) => {
      const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort((a, b) => a - b);
      return next.length >= lives.length ? [] : next; // 모두 고르면 전체
    });
  const [remind, setRemind] = useState<RemindKey[]>(event?.remind ?? DEFAULT_REMIND);
  const [weekly, setWeekly] = useState(event?.repeat === 'weekly');
  const [custom, setCustom] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    customTypes().then(setCustom);
  }, []);
  const known = [...PRESET_TYPES, ...custom];
  const types = event && !known.includes(event.type) ? [...known, event.type] : known;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  async function commitNewType() {
    const n = newType.trim().slice(0, 10);
    if (n) {
      await addCustomType(n);
      setCustom(await customTypes());
      setType(n);
    }
    setAdding(false);
    setNewType('');
  }

  const save = () =>
    run(async () => {
      if (!date || !time) throw new Error('날짜와 시간을 넣어 주세요.');
      // 새 종류를 입력하던 중에 저장을 누른 경우
      const pending = adding ? newType.trim().slice(0, 10) : '';
      if (pending) await addCustomType(pending);
      const ev: SiteEvent = {
        id: event?.id ?? crypto.randomUUID(),
        type: pending || type,
        at: kstToMs(date, time),
        memo: memo.trim() || undefined,
        channels,
        liveIndex: undefined,
        remind,
        repeat: weekly ? 'weekly' : undefined,
        reminder: event?.reminder,
      };
      await saveEvent(site.id, ev, push.subscription);
      onInfo(remind.length && !push.subscription ? '일정을 저장했어요. 알림이 꺼져 있어 미리 알림은 오지 않아요.' : '일정을 저장했어요.');
      onClose();
    });

  return (
    <Sheet title={event ? '일정 수정' : '일정 추가'} onClose={onClose}>
      <div className="card form event-form">
        <div className="field">
          <span>종류</span>
          <div className="chips">
            {types.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={type === t} className="chip" onClick={() => setType(t)}>
                {t}
              </button>
            ))}
            {adding ? (
              <span className="ev-add">
                <input
                  autoFocus
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  placeholder="새 종류"
                  maxLength={10}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitNewType();
                    }
                  }}
                  onBlur={commitNewType}
                />
              </span>
            ) : (
              <button type="button" className="chip ev-plus" aria-label="종류 추가" onClick={() => setAdding(true)}>
                <Plus size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="time-range">
          <label className="field">
            <span>날짜</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <span className="tilde" />
          <label className="field">
            <span>시간</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>

        <div className="field">
          <span>반복</span>
          <div className="chips">
            <button type="button" role="radio" aria-checked={!weekly} className="chip" onClick={() => setWeekly(false)}>
              한 번만
            </button>
            <button type="button" role="radio" aria-checked={weekly} className="chip" onClick={() => setWeekly(true)}>
              {date ? repeatText({ at: kstToMs(date, time || '00:00'), repeat: 'weekly' }) : '매주'}
            </button>
          </div>
        </div>

        {lives.length > 0 && (
          <div className="field">
            <span>채널 (여러 개 선택 가능)</span>
            <div className="chips">
              <button type="button" role="checkbox" aria-checked={!channels.length} className="chip" onClick={() => setChannels([])}>
                전체
              </button>
              {lives.map((l, i) => (
                <button key={i} type="button" role="checkbox" aria-checked={channels.includes(i)} className="chip" onClick={() => toggleChannel(i)}>
                  {l.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {type === HOLIDAY && (
          <p className="hint">
            <CalendarX2 size={14} aria-hidden />
            {!channelLabel(site, { channels })
              ? '이날은 이 사이트의 대기 순번 모니터링을 모두 쉬어요.'
              : `이날은 ‘${channelLabel(site, { channels })}’ 채널로 지정한 대기열만 쉬어요.`}
          </p>
        )}

        <label className="field">
          <span>메모 (선택)</span>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 메이메이 양도, 21시 시작" maxLength={60} />
        </label>

        <div className="field">
          <span className="with-icon">
            <Bell size={13} aria-hidden /> 미리 알림
          </span>
          <div className="chips">
            {REMIND_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                role="checkbox"
                aria-checked={remind.includes(o.key)}
                className="chip remind-chip"
                onClick={() => setRemind(remind.includes(o.key) ? remind.filter((k) => k !== o.key) : [...remind, o.key])}
              >
                {o.label}
              </button>
            ))}
          </div>
          {!push.subscription && <small className="err-text">알림이 꺼져 있어 미리 알림이 오지 않아요. 설정에서 알림을 켜 주세요.</small>}
        </div>

        <button className="primary" disabled={busy} onClick={save}>
          <Save size={18} aria-hidden /> {busy ? '저장 중…' : '저장'}
        </button>
        {event && (
          <button
            className="text-btn danger"
            disabled={busy}
            onClick={() =>
              confirm('이 일정을 지울까요?') &&
              run(async () => {
                await deleteEvent(site.id, event);
                onInfo('일정을 지웠어요.');
                onClose();
              })
            }
          >
            <Trash2 size={16} aria-hidden /> 일정 삭제
          </button>
        )}
      </div>
    </Sheet>
  );
}
