// 데이터가 바뀌면 화면들이 다시 읽도록 알리는 간단한 신호
import { useEffect, useState } from 'react';

type Topic = 'sites' | 'watches' | 'inbox';
const listeners = new Set<(t: Topic) => void>();

export function emit(topic: Topic) {
  for (const l of listeners) l(topic);
}

/** loader 결과를 상태로 들고 있다가 관련 신호가 오면 다시 읽음 */
export function useLive<T>(loader: () => Promise<T>, topics: Topic[], deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let alive = true;
    const load = () => loader().then((v) => alive && setValue(v));
    load();
    const l = (t: Topic) => topics.includes(t) && load();
    listeners.add(l);
    return () => {
      alive = false;
      listeners.delete(l);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}
