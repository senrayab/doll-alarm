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
    // 실시간 상태 알림: 소리·진동·팝업 없이 알림창 내용만 갱신, 알림 내역에도 안 남김
    silent: data.silent === true,
    url: data.url || '/',
    sentAt: data.at || null,
    receivedAt: Date.now(),
    read: false,
  };
  event.waitUntil(
    (async () => {
      // 제목 앞에 사이트 이름: "나나코어 · 차례 도달!"
      item.siteName = (await lookupSiteName(item.jobId).catch(() => null)) || item.siteName;
      const title = item.siteName ? `${item.siteName} · ${baseTitle}` : baseTitle;
      await self.registration.showNotification(title, {
        body: item.body,
        tag: data.tag,
        renotify: Boolean(data.tag) && !item.silent,
        silent: item.silent,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        vibrate: item.silent ? undefined : item.important ? [300, 120, 300, 120, 300] : [200, 100, 200],
        requireInteraction: item.important,
        data: { url: item.url },
      });
      if (!item.silent) await saveToInbox(item).catch(() => {});
      // 열려 있는 화면에 알려서 바로 갱신
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) w.postMessage({ type: 'push', payload: item });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
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
