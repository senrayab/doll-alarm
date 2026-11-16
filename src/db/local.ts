// 휴대폰 안에만 저장하는 데이터 (IndexedDB) — 서버로 보내지 않음
import { openDB, type DBSchema } from 'idb';

interface AppDB extends DBSchema {
  settings: { key: string; value: unknown };
}

const dbPromise = openDB<AppDB>('doll-alarm', 1, {
  upgrade(db) {
    db.createObjectStore('settings');
  },
});

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await (await dbPromise).get('settings', key)) as T | undefined;
}

export async function setSetting(key: string, value: unknown) {
  await (await dbPromise).put('settings', value, key);
}

export async function deleteSetting(key: string) {
  await (await dbPromise).delete('settings', key);
}
