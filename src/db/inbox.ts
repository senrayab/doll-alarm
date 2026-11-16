// 알림 내역 — 서비스 워커(public/sw.js)가 푸시를 받을 때 저장, 앱은 읽기·정리
import { openDB, type DBSchema } from 'idb';

export interface InboxItem {
  id: number;
  title: string;
  siteName: string | null;
  body: string;
  type: string;
  jobId: string | null;
  important: boolean;
  url: string;
  sentAt: number | null;
  receivedAt: number;
  read: boolean;
}

interface InboxDB extends DBSchema {
  events: { key: number; value: InboxItem; indexes: { receivedAt: number } };
}

// sw.js 와 같은 이름·버전·구조
const inbox = openDB<InboxDB>('doll-alarm-inbox', 1, {
  upgrade(db) {
    db.createObjectStore('events', { keyPath: 'id', autoIncrement: true }).createIndex('receivedAt', 'receivedAt');
  },
});

export async function listInbox(): Promise<InboxItem[]> {
  return (await (await inbox).getAllFromIndex('events', 'receivedAt')).reverse();
}

export async function unreadCount() {
  return (await listInbox()).filter((e) => !e.read).length;
}

export async function markAllRead() {
  const db = await inbox;
  const tx = db.transaction('events', 'readwrite');
  for (const e of await tx.store.getAll()) if (!e.read) await tx.store.put({ ...e, read: true });
  await tx.done;
}

export async function clearInbox() {
  await (await inbox).clear('events');
}

export async function deleteInboxByJob(jobId: string) {
  const db = await inbox;
  const tx = db.transaction('events', 'readwrite');
  for (const e of await tx.store.getAll()) if (e.jobId === jobId) await tx.store.delete(e.id);
  await tx.done;
}
