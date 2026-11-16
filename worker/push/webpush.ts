// Web Push 발송 — 외부 라이브러리 없이 WebCrypto 로 구현
//  - 메시지 암호화: RFC 8291 (aes128gcm, RFC 8188)
//  - 발송자 인증: RFC 8292 (VAPID, ES256 JWT)
// 푸시 내용은 휴대폰만 풀 수 있게 암호화되어 FCM 등 중간 서버는 내용을 볼 수 없다.

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidConfig {
  /** 공개키 — 65바이트 비압축 P-256 점, base64url */
  publicKey: string;
  /** 개인키 — P-256 스칼라 d, base64url (Worker secret) */
  privateKey: string;
  /** mailto: 또는 https: 주소 */
  subject: string;
}

export interface PushOptions {
  /** 푸시 서비스가 보관할 최대 시간(초). 늦게 온 "내 차례" 알림은 의미가 없어 짧게. */
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  /** 같은 topic 의 미전달 메시지는 새 것으로 교체됨 (최대 32자, URL-safe base64 문자) */
  topic?: string;
}

export interface PushResult {
  status: number;
  ok: boolean;
  /** 구독이 만료·해지됨 → 작업 삭제 대상 */
  gone: boolean;
  body?: string;
}

// ---------- base64url ----------

export function b64uEncode(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(str: string): Uint8Array<ArrayBuffer> {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const textEncoder = new TextEncoder();
/** UTF-8 바이트 (ArrayBuffer 기반으로 복사 — WebCrypto 타입 요구) */
const enc = { encode: (s: string) => new Uint8Array(textEncoder.encode(s)) };

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

// ---------- RFC 8291 암호화 ----------

export interface EncryptOverrides {
  /** 테스트용 — 고정 키쌍/salt */
  asKeyPair?: CryptoKeyPair;
  salt?: Uint8Array<ArrayBuffer>;
}

const RECORD_SIZE = 4096;

export async function encryptPayload(
  payload: Uint8Array<ArrayBuffer>,
  uaPublicB64: string,
  authSecretB64: string,
  ov: EncryptOverrides = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64uDecode(uaPublicB64);
  const authSecret = b64uDecode(authSecretB64);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('잘못된 p256dh 키');
  if (authSecret.length !== 16) throw new Error('잘못된 auth 값');
  // 1개 레코드에 담을 수 있는 최대 길이 (헤더 86바이트 + 태그 16 + 구분자 1 고려)
  if (payload.length > RECORD_SIZE - 16 - 1 - 86) throw new Error('푸시 내용이 너무 깁니다');

  const asKeys =
    ov.asKeyPair ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', asKeys.publicKey)) as ArrayBuffer);

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    // 표준 이름은 'public' (Workers 타입 정의만 $public 로 표기)
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as Parameters<SubtleCrypto['deriveBits']>[0], asKeys.privateKey, 256),
  );

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = ov.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const plaintext = concat(payload, new Uint8Array([2])); // 0x02 = 마지막 레코드
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

// ---------- RFC 8292 VAPID ----------

export async function vapidAuthorization(endpoint: string, vapid: VapidConfig, nowSec = Math.floor(Date.now() / 1000)) {
  const pub = b64uDecode(vapid.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('잘못된 VAPID 공개키');
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: b64uEncode(pub.slice(1, 33)),
    y: b64uEncode(pub.slice(33, 65)),
    d: vapid.privateKey,
    ext: true,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const header = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64uEncode(
    enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: vapid.subject })),
  );
  const unsigned = `${header}.${claims}`;
  // WebCrypto ECDSA 서명은 r||s(64바이트) 형식 = JWS ES256 형식 그대로
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64uEncode(sig)}, k=${vapid.publicKey}`;
}

// ---------- 발송 ----------

export async function sendWebPush(
  target: PushTarget,
  payload: unknown,
  vapid: VapidConfig,
  opts: PushOptions = {},
): Promise<PushResult> {
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), target.keys.p256dh, target.keys.auth);
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(target.endpoint, vapid),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl ?? 300),
    Urgency: opts.urgency ?? 'high',
  };
  if (opts.topic) headers.Topic = opts.topic;

  const res = await fetch(target.endpoint, { method: 'POST', headers, body });
  const text = res.ok ? undefined : (await res.text()).slice(0, 500);
  return { status: res.status, ok: res.ok, gone: res.status === 404 || res.status === 410, body: text };
}

// ---------- 구독 검증 ----------

/** 알려진 브라우저 푸시 서비스로만 발송 — Worker 가 임의 주소로 요청을 보내는 통로가 되지 않게 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

export function parsePushTarget(input: unknown): PushTarget | null {
  if (!input || typeof input !== 'object') return null;
  const s = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof s.endpoint !== 'string' || typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string') return null;
  let url: URL;
  try {
    url = new URL(s.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(url.hostname))) return null;
  try {
    if (b64uDecode(s.keys.p256dh).length !== 65 || b64uDecode(s.keys.auth).length !== 16) return null;
  } catch {
    return null;
  }
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}
