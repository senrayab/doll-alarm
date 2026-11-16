// 실시간 상태 알림 — 알림창에 띄워 두고 소리 없이 갱신하는 현재 상태 문구
import { isKeywordSnapshot, type AnySnapshot } from '../../shared/types';

const pad = (n: number | null) => (n == null ? '—' : String(n).padStart(3, '0'));

/** 한국 시간 HH:MM */
export function kstTime(now: number) {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(11, 16);
}

/** 같은 상태면 다시 보내지 않으려고 비교하는 값 */
export function statusKey(s: AnySnapshot): string {
  if (isKeywordSnapshot(s)) return `kw|${[...s.found].sort().join(',')}`;
  return `q|${s.found}|${s.status}|${s.position}|${s.ahead}|${s.currentPosition}`;
}

export function statusMessage(s: AnySnapshot, now: number, keywords: string[] = []): { title: string; body: string } {
  const t = `${kstTime(now)} 확인`;
  if (isKeywordSnapshot(s)) {
    const q = (k: string[]) => k.map((x) => `‘${x}’`).join(', ');
    return s.found.length
      ? { title: `${q(s.found)} 있음`, body: `키워드 ${keywords.length || s.found.length}개 중 ${s.found.length}개 · ${t}` }
      : { title: '키워드 없음', body: `${q(keywords)} 지켜보는 중 · ${t}` };
  }
  if (!s.found) return { title: '명단에서 찾는 중', body: `등록되면 알려 드릴게요 · ${t}` };
  if (s.status === 'current') return { title: '지금 내 차례!', body: `${pad(s.position)}번 · ${t}` };
  if (s.status === 'done' || s.status === 'skipped') return { title: '순서 완료', body: `${pad(s.position)}번 · ${t}` };
  const head = s.ahead != null && s.ahead <= 1 ? '다음 순서' : `앞에 ${s.ahead ?? '—'}명`;
  return { title: head, body: `내 순번 ${pad(s.position)} · 진행 ${pad(s.currentPosition)} · ${t}` };
}
