import { ACCESS_HEADER, checkAccessCode } from './auth';
import { MAX_KEYWORDS, probe } from './modules/keyword';
import { b64uEncode, parsePushTarget, sendWebPush, type VapidConfig } from './push/webpush';
import type { CreateInput, PatchInput } from './watch-do';

export { WatchJob } from './watch-do';

const JOB_TOKEN_HEADER = 'X-Job-Token';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function vapidOf(env: Env): VapidConfig {
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}

function jobStub(env: Env, id: string) {
  if (!/^[0-9a-f]{64}$/.test(id)) return null;
  try {
    return env.WATCH.get(env.WATCH.idFromString(id));
  } catch {
    return null;
  }
}

type DoResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const respond = <T>(r: DoResult<T>) => (r.ok ? json(r.value ?? { ok: true }) : json({ error: r.error }, r.status));

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);

    // 모든 서버 기능은 개인 접속 코드가 있어야 함
    if (!env.ACCESS_CODE) return json({ error: 'access_code_not_configured' }, 500);
    if (!(await checkAccessCode(req.headers.get(ACCESS_HEADER), env.ACCESS_CODE))) {
      return json({ error: 'unauthorized' }, 401);
    }

    // 접속 코드 확인용 (앱 첫 화면)
    if (url.pathname === '/api/auth/check' && req.method === 'POST') {
      return json({ ok: true });
    }

    if (url.pathname === '/api/vapid-public-key' && req.method === 'GET') {
      return json({ key: env.VAPID_PUBLIC_KEY });
    }

    // 연결 확인 — 공개 페이지인지, 키워드가 지금 있는지 한 번만 확인 (저장하지 않음)
    if (url.pathname === '/api/probe' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as { url?: unknown; keywords?: unknown } | null;
      if (!body || typeof body.url !== 'string') return json({ error: 'invalid_body' }, 400);
      const keywords = Array.isArray(body.keywords)
        ? body.keywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 0).slice(0, MAX_KEYWORDS)
        : [];
      const result = await probe(body.url, keywords, (i, init) => fetch(i, { ...init, signal: AbortSignal.timeout(10_000) }));
      return json(result);
    }

    // 감시 작업 생성 → { jobId, token, job }
    if (url.pathname === '/api/jobs' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as CreateInput | null;
      if (!body) return json({ error: 'invalid_body' }, 400);
      const id = env.WATCH.newUniqueId();
      const token = b64uEncode(crypto.getRandomValues(new Uint8Array(32)));
      const r = await env.WATCH.get(id).create(body, token);
      if (!r.ok) return json({ error: r.error }, r.status);
      return json({ jobId: id.toString(), token, job: r.value }, 201);
    }

    // 작업 조회·수정·삭제·즉시 확인 (작업 토큰 필요 — 만든 휴대폰만 앎)
    const m = /^\/api\/jobs\/([^/]+)(\/check)?$/.exec(url.pathname);
    if (m) {
      const stub = jobStub(env, m[1]);
      const token = req.headers.get(JOB_TOKEN_HEADER) ?? '';
      if (!stub || !token) return json({ error: 'not_found' }, 404);
      if (m[2]) {
        if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        return respond(await stub.checkNow(token));
      }
      if (req.method === 'GET') return respond(await stub.getView(token));
      if (req.method === 'DELETE') return respond(await stub.remove(token));
      if (req.method === 'PATCH') {
        const body = (await req.json().catch(() => null)) as PatchInput | null;
        if (!body) return json({ error: 'invalid_body' }, 400);
        return respond(await stub.update(token, body));
      }
      return json({ error: 'method_not_allowed' }, 405);
    }

    // 1단계 검증용: 구독 정보를 받아 그대로 테스트 알림 발송 (서버에 저장하지 않음)
    if (url.pathname === '/api/push/test' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as { subscription?: unknown; delaySec?: unknown } | null;
      const target = parsePushTarget(body?.subscription);
      if (!target) return json({ error: 'invalid_subscription' }, 400);
      if (!env.VAPID_PRIVATE_KEY) return json({ error: 'vapid_not_configured' }, 500);

      const delaySec = Math.min(Math.max(Number(body?.delaySec) || 0, 0), 20);
      const payload = {
        title: '테스트 알림',
        body: delaySec ? `${delaySec}초 뒤 알림이 잘 도착했습니다.` : '알림이 잘 도착했습니다.',
        tag: 'test',
        url: '/',
        at: Date.now(),
      };
      const send = () => sendWebPush(target, payload, vapidOf(env), { ttl: 60, urgency: 'high' });

      if (delaySec === 0) {
        const r = await send();
        return json({ sent: r.ok, status: r.status, gone: r.gone, detail: r.body }, r.ok ? 200 : 502);
      }
      // 응답을 먼저 보내고(휴대폰 화면 잠글 시간), 최대 20초 뒤 발송
      ctx.waitUntil(
        scheduler.wait(delaySec * 1000).then(async () => {
          const r = await send();
          if (!r.ok) console.log('delayed push failed', r.status);
        }),
      );
      return json({ scheduled: true, delaySec });
    }

    return json({ error: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env>;
