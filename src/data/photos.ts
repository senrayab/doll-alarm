// 사진 올리기 — webp 로 바꾸고 크기를 줄여 휴대폰에 저장
import { deletePhotoRow, putPhoto, type Photo, type PhotoStatus } from '../db/photos';
import { emit } from './events';

/** 크게 보기: 가로 최대 960px (스크린샷 글씨가 읽히는 정도) */
const FULL_MAX_W = 960;
const FULL_MAX_H = 2600;
/** 목록 그림: 가로 360px */
const THUMB_W = 360;

async function encode(bmp: ImageBitmap, w: number, h: number, quality: number): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  const webp = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', quality));
  // webp 를 못 만드는 브라우저(일부 아이폰)는 jpeg 로
  if (webp && webp.type === 'image/webp') return webp;
  return (await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', quality)))!;
}

const fit = (w: number, h: number, maxW: number, maxH = Infinity) => {
  const s = Math.min(1, maxW / w, maxH / h);
  return [Math.round(w * s), Math.round(h * s)] as const;
};

export async function convertPhoto(file: File, siteId: string | null): Promise<Photo> {
  const bmp = await createImageBitmap(file);
  try {
    const [fw, fh] = fit(bmp.width, bmp.height, FULL_MAX_W, FULL_MAX_H);
    const [tw, th] = fit(bmp.width, bmp.height, THUMB_W);
    const [blob, thumb] = [await encode(bmp, fw, fh, 0.82), await encode(bmp, tw, th, 0.72)];
    return {
      id: crypto.randomUUID(),
      siteId,
      takenAt: file.lastModified || Date.now(),
      createdAt: Date.now(),
      width: fw,
      height: fh,
      blob,
      thumb,
    };
  } finally {
    bmp.close();
  }
}

/** 여러 장 올리기 → 원래 용량·줄인 용량 */
export async function addPhotos(files: File[], siteId: string | null, onProgress?: (done: number) => void) {
  // 저장 공간이 부족할 때 브라우저가 지우지 않도록 요청
  navigator.storage?.persist?.().catch(() => {});
  let before = 0;
  let after = 0;
  let saved = 0;
  for (const f of files) {
    try {
      const p = await convertPhoto(f, siteId);
      await putPhoto(p);
      before += f.size;
      after += p.blob.size + p.thumb.size;
      saved++;
    } catch {
      // 그림이 아닌 파일은 건너뜀
    }
    onProgress?.(saved);
  }
  emit('photos');
  return { saved, failed: files.length - saved, before, after };
}

export async function movePhoto(p: Photo, siteId: string | null) {
  await putPhoto({ ...p, siteId });
  emit('photos');
}

/** 교환·양도 표시 (null = 다시 가지고 있음) */
export async function setPhotoStatus(p: Photo, status: PhotoStatus | null) {
  await putPhoto({ ...p, status: status ?? undefined, statusAt: status ? Date.now() : undefined });
  emit('photos');
}

/** 교환으로 받은 인형 사진 올리기 — 보낸 사진과 서로 이어 둠 */
export async function addTradePhoto(sent: Photo, file: File) {
  navigator.storage?.persist?.().catch(() => {});
  const got = { ...(await convertPhoto(file, sent.siteId)), tradedFrom: sent.id };
  await putPhoto(got);
  await putPhoto({ ...sent, status: 'traded', statusAt: sent.statusAt ?? Date.now(), tradedTo: got.id });
  emit('photos');
  return got;
}

export async function deletePhoto(id: string) {
  await deletePhotoRow(id);
  emit('photos');
}

export const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
