// 알림 내역 — 이 휴대폰이 받은 푸시 (휴대폰에만 저장)
import { CalendarCheck, ChevronRight, History, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { clearInbox, listInbox, markAllRead, type InboxItem } from '../db/inbox';
import { emit, useLive } from '../data/events';
import { navigate } from '../lib/router';
import { Empty, fmtTime, Header } from '../ui/parts';

function dayLabel(t: number) {
  const d = new Date(t);
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return '오늘';
  if (d.toDateString() === y.toDateString()) return '어제';
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
}

export default function Alerts() {
  const items = useLive(listInbox, ['inbox']);

  // 이 화면을 보면 읽음 처리
  useEffect(() => {
    if (items?.some((i) => !i.read)) markAllRead().then(() => emit('inbox'));
  }, [items]);

  const groups: [string, InboxItem[]][] = [];
  for (const it of items ?? []) {
    const k = dayLabel(it.receivedAt);
    const g = groups.find((x) => x[0] === k);
    if (g) g[1].push(it);
    else groups.push([k, [it]]);
  }

  return (
    <>
      <Header
        title="알림 내역"
        right={
          items?.length ? (
            <button
              className="round-btn"
              aria-label="모두 지우기"
              onClick={() => confirm('알림 내역을 모두 지울까요?') && clearInbox().then(() => emit('inbox'))}
            >
              <Trash2 size={20} />
            </button>
          ) : null
        }
      />
      <main className="page">
        {items === undefined ? null : items.length === 0 ? (
          <Empty emoji="📭" title="받은 알림이 없어요">
            <p>모니터링 중에 받은 알림이 여기에 쌓여요. 앱이 꺼져 있을 때 받은 알림도 남아요.</p>
          </Empty>
        ) : (
          groups.map(([day, list]) => (
            <section key={day} className="day-group">
              <h3 className="with-icon">
                {day === '오늘' ? <CalendarCheck size={15} aria-hidden /> : <History size={15} aria-hidden />} {day}
              </h3>
              <ul className="inbox card">
                {list.map((it) => (
                  <li key={it.id}>
                    <button className={`inbox-item ${it.important ? 'important' : ''} ${it.read ? '' : 'unread'}`} onClick={() => it.jobId && navigate(`/watch/${it.jobId}`)} disabled={!it.jobId}>
                      <div>
                        <div className="inbox-head">
                          {it.siteName && <span className="tag">{it.siteName}</span>}
                          <b>{it.title}</b>
                        </div>
                        <span>{it.body}</span>
                        <time>{fmtTime(it.receivedAt)}</time>
                      </div>
                      {it.jobId && <ChevronRight size={16} aria-hidden />}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>
    </>
  );
}
