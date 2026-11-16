// 알림 권한·푸시 구독 관리 (브라우저 쪽)
import { apiFetch } from '../api/client';

export type PushSupport = 'ok' | 'no-sw' | 'no-push' | 'insecure';

export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return 'insecure';
  if (!('serviceWorker' in navigator)) return 'no-sw';
  if (!('PushManager' in window) || !('Notification' in window)) return 'no-push';
  return 'ok';
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(undefined);
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

function b64uToBytes(s: string) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function sameBytes(a: ArrayBuffer | null, b: Uint8Array) {
  if (!a || a.byteLength !== b.length) return false;
  const u = new Uint8Array(a);
  return u.every((v, i) => v === b[i]);
}

async function vapidKey(): Promise<string> {
  const res = await apiFetch('/api/vapid-public-key');
  if (!res.ok) throw new Error('서버 공개키를 가져오지 못했습니다');
  const { key } = (await res.json()) as { key: string };
  if (!key) throw new Error('서버에 VAPID 공개키가 설정되지 않았습니다');
  return key;
}

export async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** 반드시 버튼 탭 안에서 호출 (권한 요청은 사용자 동작이 필요) */
export async function enablePush(): Promise<PushSubscription> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    throw new Error(
      perm === 'denied' ? '알림이 차단되어 있습니다. 브라우저 사이트 설정에서 허용해 주세요.' : '알림 권한을 허용해 주세요.',
    );
  }
  const reg = await navigator.serviceWorker.ready;
  const key = b64uToBytes(await vapidKey());
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    if (sameBytes(existing.options.applicationServerKey, key)) return existing;
    await existing.unsubscribe(); // 서버 키가 바뀌었으면 다시 구독
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

export async function disablePush() {
  const sub = await currentSubscription();
  await sub?.unsubscribe();
}

export async function sendTestPush(sub: PushSubscription, delaySec = 0) {
  const res = await apiFetch('/api/push/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), delaySec }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; status?: number; detail?: string };
  if (!res.ok) throw new Error(`발송 실패 (${data.error ?? data.status ?? res.status})${data.detail ? `: ${data.detail}` : ''}`);
  return data;
}
