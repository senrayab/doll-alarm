// 백업 파일 (.zip) — 사진 + 사이트·일정·닉네임·모니터링 설정
// 서버를 거치지 않고 휴대폰에서 파일로 만들고, 공유 창(드라이브·카톡 등)이나 다운로드로 내보냄
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { getSetting, listSites, listWatches, putSite, putWatch, setSetting, deleteSetting, type Site, type Watch } from '../db/local';
import { listPhotos, putPhoto, type Photo } from '../db/photos';
import { currentSubscription } from '../push/subscribe';
import { emit } from './events';
import { resyncAllReminders, syncAllHolidays } from './siteEvents';
import { syncSubscription } from './watches';

const APP = 'doll-alarm-backup';
/** 함께 옮길 설정 (접속 코드·알림 구독 주소는 빼고) */
const SETTING_KEYS = ['eventTypes', 'siteOrder'];

type PhotoMeta = Omit<Photo, 'blob' | 'thumb'> & { blobType: string; thumbType: string };

interface Manifest {
  app: typeof APP;
  version: 1;
  createdAt: number;
  settings: Record<string, unknown>;
  sites: Site[];
  watches: Watch[];
  photos: PhotoMeta[];
}

const ext = (type: string) => (type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg');

export async function makeBackup() {
  const [sites, watches, photos] = await Promise.all([listSites(), listWatches(), listPhotos()]);
  const settings: Record<string, unknown> = {};
  for (const k of SETTING_KEYS) {
    const v = await getSetting(k);
    if (v !== undefined) settings[k] = v;
  }
  const files: Zippable = {};
  const metas: PhotoMeta[] = [];
  for (const p of photos) {
    const { blob, thumb, ...meta } = p;
    files[`photos/${p.id}.${ext(blob.type)}`] = new Uint8Array(await blob.arrayBuffer());
    files[`photos/${p.id}-thumb.${ext(thumb.type)}`] = new Uint8Array(await thumb.arrayBuffer());
    metas.push({ ...meta, blobType: blob.type, thumbType: thumb.type });
  }
  const manifest: Manifest = { app: APP, version: 1, createdAt: Date.now(), settings, sites, watches, photos: metas };
  files['backup.json'] = new TextEncoder().encode(JSON.stringify(manifest));
  // 사진은 이미 압축돼 있어 그대로 담음 (빠르게)
  const zip = zipSync(files, { level: 0 });
  const d = new Date();
  const name = `인형알리미-백업-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.zip`;
  const file = new File([zip as Uint8Array<ArrayBuffer>], name, { type: 'application/zip' });
  return { file, counts: { sites: sites.length, watches: watches.length, photos: photos.length } };
}

/** 공유 창으로 보내기 (안 되면 다운로드) → 'shared' | 'downloaded' | 'cancelled' */
export async function exportBackup() {
  const { file, counts } = await makeBackup();
  let how: 'shared' | 'downloaded' | 'cancelled' = 'downloaded';
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '인형 알리미 백업' });
      how = 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') how = 'cancelled';
      else download(file);
    }
  } else {
    download(file);
  }
  if (how !== 'cancelled') await setSetting('lastBackup', { at: Date.now(), photos: counts.photos });
  return { how, counts, size: file.size };
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 백업 불러오기 — 같은 항목은 백업 내용으로 덮고, 백업에 없는 것은 그대로 둠 */
export async function importBackup(file: File) {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('백업 파일을 열 수 없어요. 인형 알리미에서 만든 .zip 파일인지 확인해 주세요.');
  }
  const raw = entries['backup.json'];
  const m = raw ? (JSON.parse(new TextDecoder().decode(raw)) as Manifest) : null;
  if (!m || m.app !== APP) throw new Error('인형 알리미 백업 파일이 아니에요.');

  for (const [k, v] of Object.entries(m.settings ?? {})) if (SETTING_KEYS.includes(k)) await setSetting(k, v);
  for (const s of m.sites ?? []) await putSite(s);
  for (const w of m.watches ?? []) await putWatch(w);
  let photos = 0;
  for (const { blobType, thumbType, ...meta } of m.photos ?? []) {
    const b = entries[`photos/${meta.id}.${ext(blobType)}`];
    const t = entries[`photos/${meta.id}-thumb.${ext(thumbType)}`];
    if (!b || !t) continue;
    await putPhoto({ ...meta, blob: new Blob([b as Uint8Array<ArrayBuffer>], { type: blobType }), thumb: new Blob([t as Uint8Array<ArrayBuffer>], { type: thumbType }) });
    photos++;
  }
  emit('sites');
  emit('watches');
  emit('photos');

  // 다른 휴대폰에서 만든 백업이면 서버 작업 알림을 이 휴대폰으로 돌림
  await deleteSetting('pushEndpoint');
  const sub = await currentSubscription().catch(() => null);
  if (sub) {
    await syncSubscription(sub).catch(() => {});
    await resyncAllReminders(sub).catch(() => {});
  }
  syncAllHolidays().catch(() => {});
  return { sites: m.sites?.length ?? 0, watches: m.watches?.length ?? 0, photos, pushMoved: !!sub, createdAt: m.createdAt };
}
