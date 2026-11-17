// Service Worker — 앱이 꺼져 있어도 푸시를 받아 시스템 알림으로 띄우고, 알림 내역(휴대폰 IndexedDB)에 저장
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// 알림 내역 저장소 — 앱(src/db/inbox.ts)과 같은 이름·버전
const INBOX_DB = 'doll-alarm-inbox';
const INBOX_VER = 1;
const INBOX_MAX = 300;

function openInbox() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(INBOX_DB, INBOX_VER);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
      store.createIndex('receivedAt', 'receivedAt');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveToInbox(item) {
  const db = await openInbox();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('events', 'readwrite');
    const store = tx.objectStore('events');
    store.add(item);
    // 오래된 것 정리
    const countReq = store.count();
    countReq.onsuccess = () => {
      let extra = countReq.result + 1 - INBOX_MAX;
      if (extra <= 0) return;
      store.index('receivedAt').openCursor().onsuccess = (e) => {
        const cur = e.target.result;
        if (cur && extra-- > 0) {
          cur.delete();
          cur.continue();
        }
      };
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** 휴대폰에 저장된 사이트 이름 찾기 (사용자가 바꾼 이름 우선). 실패하면 null */
function lookupSiteName(jobId) {
  if (!jobId) return Promise.resolve(null);
  return new Promise((resolve) => {
    // 버전 없이 열어 앱이 만든 DB 를 그대로 사용. DB 가 없으면 만들지 않고 포기
    const req = indexedDB.open('doll-alarm');
    req.onupgradeneeded = () => req.transaction.abort();
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      try {
        if (!db.objectStoreNames.contains('watches') || !db.objectStoreNames.contains('sites')) throw 0;
        const tx = db.transaction(['watches', 'sites'], 'readonly');
        const w = tx.objectStore('watches').get(jobId);
        w.onsuccess = () => {
          if (!w.result) return resolve(null);
          const s = tx.objectStore('sites').get(w.result.siteId);
          s.onsuccess = () => resolve(s.result?.name || null);
          s.onerror = () => resolve(null);
        };
        w.onerror = () => resolve(null);
        tx.oncomplete = () => db.close();
      } catch {
        db.close();
        resolve(null);
      }
    };
  });
}

/** 일정 알림 — 서버는 일정 번호만 보내므로 휴대폰 저장소에서 사이트·일정을 찾아 문구를 만듦 */
function lookupEvent(eventId) {
  if (!eventId) return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open('doll-alarm');
    req.onupgradeneeded = () => req.transaction.abort();
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      try {
        if (!db.objectStoreNames.contains('sites')) throw 0;
        const all = db.transaction('sites', 'readonly').objectStore('sites').getAll();
        all.onsuccess = () => {
          for (const site of all.result || []) {
            const ev = (site.events || []).find((e) => e.id === eventId);
            if (ev) return resolve({ site, ev });
          }
          resolve(null);
        };
        all.onerror = () => resolve(null);
      } catch {
        resolve(null);
      } finally {
        setTimeout(() => db.close(), 1000);
      }
    };
  });
}

function eventTimeText(at) {
  return new Date(at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: '인형 알리미', body: event.data ? event.data.text() : '' };
  }
  const baseTitle = data.title || '인형 알리미';
  const item = {
    title: baseTitle,
    siteName: data.siteName || null,
    body: data.body || '',
    type: data.type || 'test',
    jobId: data.jobId || null,
    important: data.important === true,
    url: data.url || '/',
    sentAt: data.at || null,
    receivedAt: Date.now(),
    read: false,
  };
  event.waitUntil(
    (async () => {
      // 일정 알림: "러브픽 · 1시간 뒤 양도데이" / 본문 "11월 20일 (목) 21:00 · 1호점 · 메모"
      if (data.kind === 'reminder') {
        const found = await lookupEvent(data.eventId).catch(() => null);
        item.type = 'reminder';
        if (found) {
          const { site, ev } = found;
          const lives = site.lives && site.lives.length ? site.lives : site.liveUrl ? [{ name: '라이브', url: site.liveUrl }] : [];
          const live = ev.liveIndex != null ? lives[ev.liveIndex] : null;
          item.siteName = site.name;
          item.title = data.label === '지금' ? `지금 ${ev.type} 시작!` : `${data.label} ${ev.type}`;
          item.body = [eventTimeText(ev.at), live ? live.name : '', ev.memo || ''].filter(Boolean).join(' · ');
          // 1시간 전·시작 알림은 누르면 그 채널 라이브로, 나머지는 사이트 화면으로
          item.url = live && (data.label === '지금' || data.label === '1시간 뒤') ? live.url : `/sites/${site.id}`;
        }
      } else {
        // 제목 앞에 사이트 이름: "나나코어 · 차례 도달!"
        item.siteName = (await lookupSiteName(item.jobId).catch(() => null)) || item.siteName;
      }
      const shown = item.title || baseTitle;
      const title = item.siteName ? `${item.siteName} · ${shown}` : shown;
      await self.registration.showNotification(title, {
        body: item.body,
        tag: data.tag,
        renotify: Boolean(data.tag),
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        vibrate: item.important ? [300, 120, 300, 120, 300] : [200, 100, 200],
        requireInteraction: item.important,
        data: { url: item.url },
      });
      await saveToInbox(item).catch(() => {});
      // 열려 있는 화면에 알려서 바로 갱신
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) w.postMessage({ type: 'push', payload: item });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  if (new URL(url).origin !== self.location.origin) {
    event.waitUntil(self.clients.openWindow(url));
    return;
  }
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus();
          w.postMessage({ type: 'navigate', url });
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
