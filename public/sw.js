// Service Worker — 앱이 꺼져 있어도 푸시를 받아 시스템 알림으로 띄운다
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: '순번 알리미', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || '순번 알리미';
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body: data.body || '',
        tag: data.tag,
        renotify: Boolean(data.tag),
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        vibrate: [200, 100, 200],
        requireInteraction: data.important === true,
        data: { url: data.url || '/' },
      });
      // 열려 있는 화면에 알려서 알림 내역을 갱신하게 함
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) w.postMessage({ type: 'push', payload: { ...data, title, receivedAt: Date.now() } });
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
          if ('navigate' in w) await w.navigate(url).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
