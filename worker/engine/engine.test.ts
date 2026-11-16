import { describe, expect, it } from 'vitest';
import { nicknameHash, normalizeNickname } from '../../shared/nickname';
import { DEFAULT_QUEUE_CONDITIONS, type QueueSnapshot } from '../../shared/types';
import { demo } from '../modules/demo';
import { nanacore, parseRows, parseViewerConfig } from '../modules/nanacore';
import { evaluate, mergeForPush } from './evaluate';
import { runCheck, type JobState, type PushMessage } from './run';
import { scheduleWindow } from './schedule';
import { ModuleError, snapshotFromRows, type SiteModule } from './types';

const C = DEFAULT_QUEUE_CONDITIONS;
const snap = (o: Partial<QueueSnapshot>): QueueSnapshot => ({
  found: true,
  position: 7,
  status: 'pending',
  ahead: 3,
  currentPosition: 4,
  waiting: 5,
  ...o,
});
const types = (r: ReturnType<typeof evaluate>) => r.events.filter((e) => e.enabled).map((e) => e.type);

describe('snapshotFromRows', () => {
  const rows = [
    { position: 1, status: 'done', mine: false },
    { position: 2, status: 'current', mine: false },
    { position: 3, status: 'pending', mine: false },
    { position: 4, status: 'pending', mine: true },
    { position: 5, status: 'pending', mine: false },
  ];
  it('내 앞 인원 = 진행 중 1 + 앞 대기자', () => {
    expect(snapshotFromRows(rows)).toEqual({ found: true, position: 4, status: 'pending', ahead: 2, currentPosition: 2, waiting: 3 });
  });
  it('같은 닉네임 여러 줄이면 가장 앞의 미완료 기준', () => {
    const r = snapshotFromRows([...rows, { position: 1, status: 'done', mine: true }, { position: 9, status: 'pending', mine: true }].map((x, i) => (i === 0 ? { ...x } : x)));
    expect(r.position).toBe(4);
  });
  it('진행 중이면 ahead 0', () => {
    const r = snapshotFromRows(rows.map((x) => (x.position === 2 ? { ...x, mine: true } : { ...x, mine: false })));
    expect(r).toMatchObject({ status: 'current', ahead: 0 });
  });
  it('없으면 found=false', () => {
    expect(snapshotFromRows(rows.map((x) => ({ ...x, mine: false }))).found).toBe(false);
  });
  it('빈 명단(방송 종료)도 정상', () => {
    expect(snapshotFromRows([])).toMatchObject({ found: false, waiting: 0, currentPosition: null });
  });
});

describe('evaluate', () => {
  it('첫 확인: 대기 중이면 감시 시작 알림', () => {
    expect(types(evaluate(null, snap({}), C, 0))).toEqual(['started']);
  });
  it('첫 확인: 못 찾으면 안내 (오류가 아님)', () => {
    expect(types(evaluate(null, snap({ found: false, position: null, status: null, ahead: null }), C, 0))).toEqual(['notFound']);
  });
  it('앞 인원 감소', () => {
    const r = evaluate(snap({ ahead: 3 }), snap({ ahead: 2 }), C, 0);
    expect(types(r)).toEqual(['ahead']);
    expect(r.events[0].body).toContain('2명');
  });
  it('aheadAtMost 보다 많으면 알림 끔 (기록만)', () => {
    const r = evaluate(snap({ ahead: 6 }), snap({ ahead: 5 }), { ...C, aheadAtMost: 3 }, 0);
    expect(types(r)).toEqual([]);
    expect(r.events.map((e) => e.type)).toEqual(['ahead']);
  });
  it('순번 숫자 변경 + 앞 인원 감소가 같이 오면 둘 다', () => {
    expect(types(evaluate(snap({ position: 7, ahead: 3 }), snap({ position: 6, ahead: 2 }), C, 0))).toEqual(['position', 'ahead']);
  });
  it('내 차례 도달', () => {
    const r = evaluate(snap({ ahead: 0 }), snap({ status: 'current', ahead: 0 }), C, 0);
    expect(types(r)).toEqual(['turn']);
    expect(r.events[0].important).toBe(true);
  });
  it('완료되면 알림 + 감시 종료', () => {
    const r = evaluate(snap({ status: 'current', ahead: 0 }), snap({ status: 'done', ahead: null }), C, 0);
    expect(types(r)).toEqual(['finished']);
    expect(r.stop).toBe(true);
  });
  it('사라짐 → 알림 + 감시 종료', () => {
    const r = evaluate(snap({}), snap({ found: false, position: null, status: null, ahead: null }), C, 0);
    expect(types(r)).toEqual(['gone']);
    expect(r.stop).toBe(true);
  });
  it('나중에 등록되면 알림', () => {
    expect(types(evaluate(snap({ found: false, position: null, status: null, ahead: null }), snap({}), C, 0))).toEqual(['appeared']);
  });
  it('변화 없으면 조용히', () => {
    expect(evaluate(snap({}), snap({}), C, 0).events).toEqual([]);
  });
  it('여러 이벤트는 알림 1개로 — 제목은 가장 중요한 것', () => {
    const m = mergeForPush([
      { type: 'position', title: '대기 순번 변경', body: 'a', at: 0 },
      { type: 'ahead', title: '순번 임박', body: 'b', at: 0 },
    ])!;
    expect(m.title).toBe('순번 임박');
    expect(m.body).toBe('b\na');
  });
});

describe('scheduleWindow (한국 시간)', () => {
  // 2026-11-16 10:30 KST = 01:30 UTC
  const t = Date.UTC(2026, 10, 16, 1, 30);
  it('예약 없음 = 항상', () => expect(scheduleWindow(t, null).inWindow).toBe(true));
  it('시간 안', () => expect(scheduleWindow(t, { start: '10:00', end: '11:00' }).inWindow).toBe(true));
  it('시간 밖이면 다음 시작 시각', () => {
    const w = scheduleWindow(t, { start: '19:00', end: '23:00' });
    expect(w.inWindow).toBe(false);
    expect(w.nextStart).toBe(Date.UTC(2026, 10, 16, 10, 0)); // 19:00 KST
  });
  it('자정 넘는 예약', () => {
    expect(scheduleWindow(Date.UTC(2026, 10, 16, 15, 30), { start: '22:00', end: '02:00' }).inWindow).toBe(true); // 00:30 KST
    expect(scheduleWindow(t, { start: '22:00', end: '02:00' }).inWindow).toBe(false);
  });
});

describe('nanacore 모듈', () => {
  it('뷰어 페이지에서 접속 정보 추출', () => {
    const html = "const SUPABASE_URL='https://abc.supabase.co';\nconst SUPABASE_ANON_KEY='eyJxx.yy.zz';";
    expect(parseViewerConfig(html)).toEqual({ url: 'https://abc.supabase.co', key: 'eyJxx.yy.zz' });
    expect(parseViewerConfig("SUPABASE_URL='https://evil.example.com';SUPABASE_ANON_KEY='k'")).toBeNull();
    expect(parseViewerConfig('<html></html>')).toBeNull();
  });
  it('응답 형식이 바뀌면 오류 (순번 도달로 오해하지 않음)', () => {
    expect(() => parseRows({ message: 'x' })).toThrow(ModuleError);
    expect(() => parseRows([{ position: '1', nickname: 'a', status: 'done' }])).toThrow(ModuleError);
    expect(parseRows([])).toEqual([]);
  });
  it('닉네임 해시로 내 행을 찾음 (서버는 평문을 모름)', async () => {
    const salt = '0123456789abcdef0123456789abcdef';
    const params = nanacore.parseParams({ salt, nicknameHash: await nicknameHash(salt, '  토끼  Lv5 ') })!;
    const page = "SUPABASE_URL='https://abc.supabase.co';SUPABASE_ANON_KEY='key1'";
    const rows = [
      { position: 1, nickname: '곰', status: 'current' },
      { position: 2, nickname: '토끼 lv5', status: 'pending' },
    ];
    const cache = new Map<string, unknown>();
    const calls: string[] = [];
    const fetchMock = (async (input: RequestInfo | URL) => {
      const u = String(input);
      calls.push(u);
      if (u.includes('netlify')) return new Response(page);
      return Response.json(rows);
    }) as typeof fetch;
    const ctx = {
      fetch: fetchMock,
      now: 0,
      checkIndex: 0,
      cacheGet: async <T>(k: string) => cache.get(k) as T,
      cachePut: async (k: string, v: unknown) => void cache.set(k, v),
    };
    expect(await nanacore.fetchSnapshot(params, ctx)).toMatchObject({ found: true, position: 2, ahead: 1 });
    await nanacore.fetchSnapshot(params, ctx);
    expect(calls.filter((c) => c.includes('netlify'))).toHaveLength(1); // 접속 정보는 캐시
  });
  it('닉네임 정규화', () => {
    expect(normalizeNickname('  Ａbc   DEF ')).toBe(normalizeNickname('Ａbc def'));
  });
});

describe('runCheck', () => {
  const base = (): JobState => ({
    v: 1,
    rev: 0,
    moduleId: 'demo',
    params: {},
    conditions: { ...C },
    intervalSec: 15,
    schedule: null,
    push: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } },
    tokenHash: 'h',
    createdAt: 0,
    running: true,
    startedAt: 0,
    checks: 0,
    lastCheckedAt: null,
    lastOkAt: null,
    last: null,
    consecutiveErrors: 0,
    errorNotified: false,
    lastError: null,
    history: [],
  });
  const noCache = { fetch, cacheGet: async () => undefined, cachePut: async () => {} };

  it('데모 대기열 전체 흐름: 시작 → 2명 → 1명 → 다음 → 내 차례 → 완료(중지)', async () => {
    let s = base();
    const sent: PushMessage[] = [];
    for (let i = 0; i < 8 && s.running; i++) {
      ({ state: s } = await runCheck(s, { module: demo as SiteModule, ctx: noCache, now: 1000 + i, sendPush: async (m) => (sent.push(m), { status: 201, gone: false }) }));
    }
    expect(sent.map((m) => m.type)).toEqual(['started', 'ahead', 'ahead', 'ahead', 'turn', 'finished']);
    expect(s.running).toBe(false);
    expect(s.history).toHaveLength(6);
  });

  it('오류 3회 연속에 1번만 알림, 회복 시 1번', async () => {
    let fail = true;
    const mod: SiteModule = {
      ...(demo as SiteModule),
      fetchSnapshot: async () => {
        if (fail) throw new ModuleError('응답 오류 (503)');
        return snap({});
      },
    };
    let s = base();
    const sent: string[] = [];
    const run = async () => ({ state: s } = await runCheck(s, { module: mod, ctx: noCache, now: 1, sendPush: async (m) => (sent.push(m.type), { status: 201, gone: false }) }));
    for (let i = 0; i < 5; i++) await run();
    expect(sent).toEqual(['error']);
    expect(s.last).toBeNull(); // 오류는 상태를 바꾸지 않음
    fail = false;
    await run();
    // 회복 + 감시 시작은 같은 확인에서 나와 알림 1개로 합쳐짐 (기록은 둘 다)
    expect(sent).toEqual(['error', 'started']);
    expect(s.history.slice(0, 2).map((h) => h.type).sort()).toEqual(['recovered', 'started']);
    expect(s.consecutiveErrors).toBe(0);
  });

  it('조건에서 끈 알림은 보내지 않고 기록만', async () => {
    let s = { ...base(), conditions: { ...C, ahead: false } };
    const sent: string[] = [];
    for (let i = 0; i < 2; i++) {
      ({ state: s } = await runCheck(s, { module: demo as SiteModule, ctx: noCache, now: 1, sendPush: async (m) => (sent.push(m.type), { status: 201, gone: false }) }));
    }
    expect(sent).toEqual(['started']);
    expect(s.history.map((h) => [h.type, h.pushStatus])).toEqual([['ahead', null], ['started', 201]]);
  });

  it('구독 만료(410)면 작업 삭제 신호', async () => {
    const r = await runCheck(base(), { module: demo as SiteModule, ctx: noCache, now: 1, sendPush: async () => ({ status: 410, gone: true }) });
    expect(r.subscriptionGone).toBe(true);
  });

  it('예약 없이 24시간 넘으면 자동 중지', async () => {
    const r = await runCheck({ ...base(), startedAt: 0 }, { module: demo as SiteModule, ctx: noCache, now: 25 * 3600 * 1000, sendPush: async () => ({ status: 201, gone: false }) });
    expect(r.state.running).toBe(false);
    expect(r.state.history[0].type).toBe('expired');
  });
});
