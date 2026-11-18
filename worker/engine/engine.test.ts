import { describe, expect, it } from 'vitest';
import { coreNickname, matchesNickname, nicknameHash, normalizeNickname } from '../../shared/nickname';
import { DEFAULT_QUEUE_CONDITIONS, type QueueSnapshot } from '../../shared/types';
import { demo } from '../modules/demo';
import { nanacore, parseRows, parseViewerConfig } from '../modules/nanacore';
import { crossedMilestones, evaluate, mergeForPush } from './evaluate';
import { runCheck, type JobState, type PushMessage } from './run';
import { daysText, isValidSchedule, scheduleWindow } from './schedule';
import { ModuleError, snapshotFromRows, type QueueModule, type SiteModule } from './types';

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
    expect(snapshotFromRows(rows)).toEqual({ found: true, position: 4, status: 'pending', ahead: 2, currentPosition: 2, waiting: 3, mineCount: 1, mineDone: 0 });
  });
  it('같은 닉네임 여러 줄이면 가장 앞의 미완료 기준', () => {
    const r = snapshotFromRows([...rows, { position: 1, status: 'done', mine: true }, { position: 9, status: 'pending', mine: true }].map((x, i) => (i === 0 ? { ...x } : x)));
    expect(r.position).toBe(4);
    expect(r).toMatchObject({ mineCount: 3, mineDone: 1 });
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
  it('첫 확인: 대기 중이면 모니터링 시작 알림', () => {
    expect(types(evaluate(null, snap({}), C, 0))).toEqual(['started']);
  });
  it('첫 확인: 못 찾으면 안내 (오류가 아님)', () => {
    expect(types(evaluate(null, snap({ found: false, position: null, status: null, ahead: null }), C, 0))).toEqual(['notFound']);
  });
  it('앞 인원이 알림 지점(기본 5·3·1)에 도달할 때만 알림', () => {
    expect(types(evaluate(snap({ ahead: 7 }), snap({ ahead: 6 }), C, 0))).toEqual([]);
    const r5 = evaluate(snap({ ahead: 6 }), snap({ ahead: 5 }), C, 0);
    expect(types(r5)).toEqual(['ahead']);
    expect(r5.events[0].title).toBe('5명 전');
    expect(types(evaluate(snap({ ahead: 5 }), snap({ ahead: 4 }), C, 0))).toEqual([]);
    expect(evaluate(snap({ ahead: 4 }), snap({ ahead: 3 }), C, 0).events[0].body).toContain('3명');
  });
  it('1명 이하가 되면 "다음 순서!" (중요 알림)', () => {
    const r = evaluate(snap({ ahead: 2 }), snap({ ahead: 1 }), C, 0);
    expect(types(r)).toEqual(['ahead']);
    expect(r.events[0]).toMatchObject({ title: '다음 순서!', important: true });
  });
  it('여러 지점을 한 번에 건너뛰면 알림 1개 (현재 인원으로)', () => {
    const r = evaluate(snap({ ahead: 7 }), snap({ ahead: 2 }), C, 0);
    expect(types(r)).toEqual(['ahead']);
    expect(r.events[0].body).toContain('2명');
  });
  it('지점 null 이면 줄어들 때마다', () => {
    expect(types(evaluate(snap({ ahead: 9 }), snap({ ahead: 8 }), { ...C, aheadMilestones: null }, 0))).toEqual(['ahead']);
  });
  it('예전 작업(지점 설정 없음)은 기본 5·3·1', () => {
    const old = { ...C } as Partial<typeof C>;
    delete old.aheadMilestones;
    expect(types(evaluate(snap({ ahead: 9 }), snap({ ahead: 8 }), old as typeof C, 0))).toEqual([]);
    expect(types(evaluate(snap({ ahead: 6 }), snap({ ahead: 5 }), old as typeof C, 0))).toEqual(['ahead']);
  });
  it('crossedMilestones', () => {
    expect(crossedMilestones(6, 2, [5, 3, 1])).toEqual([5, 3]);
    expect(crossedMilestones(3, 3, [5, 3, 1])).toEqual([]);
  });
  it('순번 숫자 변경은 기본 꺼짐 (켜면 알림)', () => {
    expect(types(evaluate(snap({ position: 7, ahead: 8 }), snap({ position: 6, ahead: 8 }), C, 0))).toEqual([]);
    expect(types(evaluate(snap({ position: 7, ahead: 8 }), snap({ position: 6, ahead: 8 }), { ...C, position: true }, 0))).toEqual(['position']);
  });
  it('내 차례 도달 → "지금 내 차례!"', () => {
    const r = evaluate(snap({ ahead: 1 }), snap({ status: 'current', ahead: 0 }), C, 0);
    expect(types(r)).toEqual(['turn']);
    expect(r.events[0]).toMatchObject({ title: '지금 내 차례!', important: true });
  });
  it('완료되면 알림 + 모니터링 종료', () => {
    const r = evaluate(snap({ status: 'current', ahead: 0 }), snap({ status: 'done', ahead: null }), C, 0);
    expect(types(r)).toEqual(['finished']);
    expect(r.stop).toBe(true);
  });
  it('사라짐 → 알림 + 모니터링 종료', () => {
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

describe('scheduleWindow 요일', () => {
  // 2026-11-16 은 월요일. 10:30 KST = 01:30 UTC
  const mon1030 = Date.UTC(2026, 10, 16, 1, 30);
  it('휴방 요일이면 시간 안이어도 확인 안 함', () => {
    expect(scheduleWindow(mon1030, { start: '10:00', end: '11:00', days: [2, 3] }).inWindow).toBe(false);
    expect(scheduleWindow(mon1030, { start: '10:00', end: '11:00', days: [1] }).inWindow).toBe(true);
  });
  it('다음 시작은 허용된 요일의 시작 시각', () => {
    // 월 10:30, 월요일 휴방 → 수 19:00 KST (= 수 10:00 UTC)
    expect(scheduleWindow(mon1030, { start: '19:00', end: '23:00', days: [3] }).nextStart).toBe(Date.UTC(2026, 10, 18, 10, 0));
    // 오늘 아직 시작 전이고 오늘이 허용되면 오늘
    expect(scheduleWindow(mon1030, { start: '19:00', end: '23:00', days: [1, 3] }).nextStart).toBe(Date.UTC(2026, 10, 16, 10, 0));
  });
  it('자정 넘는 시간은 시작한 요일 기준', () => {
    // 화 00:30 KST (= 월 15:30 UTC), 월요일 22:00~02:00 방송 → 아직 월요일 방송 중
    const tue0030 = Date.UTC(2026, 10, 16, 15, 30);
    expect(scheduleWindow(tue0030, { start: '22:00', end: '02:00', days: [1] }).inWindow).toBe(true);
    expect(scheduleWindow(tue0030, { start: '22:00', end: '02:00', days: [2] }).inWindow).toBe(false);
  });
  it('요일 검증', () => {
    expect(isValidSchedule({ start: '10:00', end: '11:00', days: [1, 1] })).toBe(false);
    expect(isValidSchedule({ start: '10:00', end: '11:00', days: [] })).toBe(false);
    expect(isValidSchedule({ start: '10:00', end: '11:00', days: [0, 6] })).toBe(true);
    expect(daysText([1, 3, 5])).toBe('월·수·금');
    expect(daysText([0, 1, 2, 3, 4, 5, 6])).toBe('매일');
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
  it('명단 이름에 앞뒤 문구가 붙어도 찾음', async () => {
    const salt = '0123456789abcdef0123456789abcdef';
    const h = await nicknameHash(salt, '라피누0001');
    for (const row of ['(러브픽)라피누0001', '[러브픽] 라피누0001', '러브픽 라피누0001', '라피누0001', '라피누0001 · 2건', '【VIP】라피누0001']) {
      expect(await matchesNickname(salt, h, row), row).toBe(true);
    }
    for (const row of ['라피누0002', '라피누', '러브픽']) {
      expect(await matchesNickname(salt, h, row), row).toBe(false);
    }
  });
  it('괄호 붙여 입력해도, 끝에 님을 붙여 입력해도 같은 사람', async () => {
    expect(coreNickname('(러브픽)라피누0001')).toBe('라피누0001');
    expect(coreNickname('라피누0001 님')).toBe('라피누0001');
    const salt = '0123456789abcdef0123456789abcdef';
    expect(await matchesNickname(salt, await nicknameHash(salt, '(러브픽)라피누0001'), '(러브픽)라피누0001')).toBe(true);
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

  it('데모 대기열 전체 흐름: 시작 → 5명 전 → 3명 전 → 다음 순서 → 지금 내 차례 → 완료(중지)', async () => {
    let s = base();
    const sent: PushMessage[] = [];
    for (let i = 0; i < 12 && s.running; i++) {
      ({ state: s } = await runCheck(s, { module: demo as SiteModule, ctx: noCache, now: 1000 + i, sendPush: async (m) => (sent.push(m), { status: 201, gone: false }) }));
    }
    expect(sent.map((m) => m.title)).toEqual(['모니터링 시작', '5명 전', '3명 전', '다음 순서!', '지금 내 차례!', '순서 완료']);
    expect(s.running).toBe(false);
    expect(s.history.filter((h) => h.pushStatus != null)).toHaveLength(6);
  });

  it('오류 3회 연속에 1번만 알림, 회복 시 1번', async () => {
    let fail = true;
    const mod: QueueModule = {
      ...(demo as QueueModule),
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
    // 회복 + 모니터링 시작은 같은 확인에서 나와 알림 1개로 합쳐짐 (기록은 둘 다)
    expect(sent).toEqual(['error', 'started']);
    expect(s.history.slice(0, 2).map((h) => h.type).sort()).toEqual(['recovered', 'started']);
    expect(s.consecutiveErrors).toBe(0);
  });

  it('조건에서 끈 알림은 보내지 않고 기록만', async () => {
    let s: JobState = { ...base(), conditions: { ...C, ahead: false } };
    const sent: string[] = [];
    for (let i = 0; i < 2; i++) {
      ({ state: s } = await runCheck(s, { module: demo as SiteModule, ctx: noCache, now: 1, sendPush: async (m) => (sent.push(m.type), { status: 201, gone: false }) }));
    }
    expect(sent).toEqual(['started']);
    expect(s.history.map((h) => [h.type, h.pushStatus])).toEqual([['ahead', null], ['started', 201]]);
  });

  it('발송 실패는 0, 조건에서 끈 것은 null 로 구분', async () => {
    const r = await runCheck(base(), { module: demo as SiteModule, ctx: noCache, now: 1, sendPush: async () => { throw new Error('network'); } });
    expect(r.state.history[0].pushStatus).toBe(0);
  });

  it('구독 만료(410)면 작업 삭제 신호', async () => {
    const r = await runCheck(base(), { module: demo as SiteModule, ctx: noCache, now: 1, sendPush: async () => ({ status: 410, gone: true }) });
    expect(r.subscriptionGone).toBe(true);
  });

  it('다시 시작할 때 이미 끝난 순번은 완료로 치지 않고 새 등록을 기다림 (여러 번 구매)', async () => {
    const seq = [
      snap({ position: 4, status: 'done', ahead: null }), // 지난 구매
      snap({ position: 4, status: 'done', ahead: null }),
      snap({ position: 12, status: 'pending', ahead: 3 }), // 새로 줄 섬
      snap({ position: 12, status: 'done', ahead: null }),
    ];
    let i = 0;
    const mod: QueueModule = { ...(demo as QueueModule), fetchSnapshot: async () => seq[i++] };
    let s = base();
    const sent: string[] = [];
    const run = async () => ({ state: s } = await runCheck(s, { module: mod, ctx: noCache, now: 1, sendPush: async (m) => (sent.push(m.type), { status: 201, gone: false }) }));
    await run();
    expect(s.running).toBe(true);
    expect((s.last as QueueSnapshot).prevDone).toBe(4);
    await run();
    expect(s.running).toBe(true);
    await run();
    await run();
    expect(sent).toEqual(['notFound', 'appeared', 'finished']);
    expect(s.running).toBe(false);
  });

  it('예약 없이 24시간 넘으면 자동 중지', async () => {
    const r = await runCheck({ ...base(), startedAt: 0 }, { module: demo as SiteModule, ctx: noCache, now: 25 * 3600 * 1000, sendPush: async () => ({ status: 201, gone: false }) });
    expect(r.state.running).toBe(false);
    expect(r.state.history[0].type).toBe('expired');
  });
});

describe('휴방 날짜', () => {
  const at = (d: string, t: string) => Date.parse(`${d}T${t}:00+09:00`);
  it('휴방 날은 예약 시간이 와도 쉬고, 다음 날 시작 시각으로', () => {
    const sched = { start: '19:00', end: '23:00' };
    const w = scheduleWindow(at('2026-11-20', '20:00'), sched, ['2026-11-20']);
    expect(w.inWindow).toBe(false);
    expect(w.nextStart).toBe(at('2026-11-21', '19:00'));
    expect(scheduleWindow(at('2026-11-21', '20:00'), sched, ['2026-11-20']).inWindow).toBe(true);
  });
  it('자정 넘는 방송은 시작한 날 기준', () => {
    const sched = { start: '22:00', end: '02:00' };
    expect(scheduleWindow(at('2026-11-21', '01:00'), sched, ['2026-11-20']).inWindow).toBe(false);
    expect(scheduleWindow(at('2026-11-21', '01:00'), sched, ['2026-11-21']).inWindow).toBe(true);
  });
  it('예약 시간이 없으면 휴방 날 하루 종일 쉬고 다음 날 0시부터', () => {
    const w = scheduleWindow(at('2026-11-20', '13:00'), null, ['2026-11-20']);
    expect(w.inWindow).toBe(false);
    expect(w.nextStart).toBe(at('2026-11-21', '00:00'));
    expect(scheduleWindow(at('2026-11-19', '13:00'), null, ['2026-11-20']).inWindow).toBe(true);
  });
});
