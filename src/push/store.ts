// 알림 상태(권한·구독)를 여러 화면이 같이 쓰도록 한 곳에서 관리
import { useSyncExternalStore } from 'react';
import { resyncAllReminders } from '../data/siteEvents';
import { syncSubscription } from '../data/watches';
import { currentSubscription, disablePush, enablePush, pushSupport, type PushSupport } from './subscribe';

interface PushState {
  support: PushSupport;
  permission: NotificationPermission | 'unsupported';
  subscription: PushSubscription | null;
  ready: boolean;
}

let state: PushState = {
  support: pushSupport(),
  permission: 'Notification' in window ? Notification.permission : 'unsupported',
  subscription: null,
  ready: false,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<PushState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export async function loadPushState() {
  if (state.support !== 'ok') return set({ ready: true });
  const sub = await currentSubscription().catch(() => null);
  set({ subscription: sub, permission: Notification.permission, ready: true });
  if (sub) syncSubscription(sub).catch(() => {});
}

export async function turnOnPush() {
  try {
    const sub = await enablePush();
    set({ subscription: sub });
    await syncSubscription(sub);
    resyncAllReminders(sub).catch(() => {});
    return sub;
  } finally {
    if ('Notification' in window) set({ permission: Notification.permission });
  }
}

export async function turnOffPush() {
  await disablePush();
  set({ subscription: null });
}

export function usePush() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
