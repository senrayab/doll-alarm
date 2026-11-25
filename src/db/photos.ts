// 산 인형 사진 — 휴대폰에만 저장 (서버로 보내지 않음)
// 알림 저장소와 따로 두어 구조를 바꿔도 다른 데이터에 영향이 없게
import { openDB, type DBSchema } from 'idb';

export interface Photo {
  id: string;
  /** 어느 사이트에서 샀는지 (없거나 지운 사이트면 '기타') */
  siteId: string | null;
  /** 원본 파일 날짜 (스크린샷 찍은 때) */
  takenAt: number;
  createdAt: number;
  width: number;
  height: number;
  /** 크게 보기용 (webp) */
  blob: Blob;
  /** 목록용 작은 그림 (webp) */
  thumb: Blob;
  /** 떠나보낸 인형 — 교환했어요 / 양도했어요 (없으면 가지고 있음) */
  status?: PhotoStatus;
  statusAt?: number;
  /** 목록 순서 기준 (없으면 takenAt) — 교환으로 받은 인형은 보낸 인형 자리에 */
  orderAt?: number;
  /** 교환으로 받은 인형이면 — 보낸 인형 사진 id */
  tradedFrom?: string;
  /** 교환으로 보낸 인형이면 — 받은 인형 사진 id */
  tradedTo?: string;
}

export type PhotoStatus = 'traded' | 'given';
export const STATUS_LABEL: Record<PhotoStatus, string> = { traded: '교환', given: '양도' };

interface PhotoDB extends DBSchema {
  photos: { key: string; value: Photo; indexes: { siteId: string } };
}

const db = openDB<PhotoDB>('doll-photos', 1, {
  upgrade(d) {
    d.createObjectStore('photos', { keyPath: 'id' }).createIndex('siteId', 'siteId');
  },
  blocking(_cur, _next, event) {
    (event.target as IDBDatabase).close();
  },
});

/** 최근에 찍은 것부터 */
const orderOf = (p: Photo) => p.orderAt ?? p.takenAt;
export async function listPhotos() {
  const d = await db;
  const all = await d.getAll('photos');
  // 순서 기준이 생기기 전에 교환으로 받은 사진도 보낸 인형 자리로 (한 번 고치면 저장)
  for (const p of all) {
    if (!p.tradedFrom || p.orderAt !== undefined) continue;
    const sent = all.find((x) => x.id === p.tradedFrom);
    if (!sent) continue;
    p.orderAt = orderOf(sent);
    p.createdAt = sent.createdAt;
    await d.put('photos', p);
  }
  return all.sort((a, b) => orderOf(b) - orderOf(a) || b.createdAt - a.createdAt);
}
export const putPhoto = async (p: Photo) => void (await (await db).put('photos', p));
export const deletePhotoRow = async (id: string) => (await db).delete('photos', id);
