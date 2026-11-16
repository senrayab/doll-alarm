import { describe, expect, it } from 'vitest';
import { b64uDecode, b64uEncode, encryptPayload, parsePushTarget, vapidAuthorization } from './webpush';

const enc = new TextEncoder();

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, len: number) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

/** 휴대폰(브라우저) 쪽 복호화를 RFC 8291 그대로 구현해서 왕복 검증 */
async function decryptAsBrowser(body: Uint8Array<ArrayBuffer>, ua: CryptoKeyPair, authSecret: Uint8Array<ArrayBuffer>) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  expect(rs).toBe(4096);
  expect(idlen).toBe(65);

  const uaPublic = new Uint8Array((await crypto.subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(authSecret, ecdh, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext));
  expect(plain[plain.length - 1]).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

async function newUa() {
  const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = b64uEncode((await crypto.subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { ua, pub, auth };
}

describe('encryptPayload (RFC 8291)', () => {
  it('브라우저 쪽 복호화로 원문이 그대로 나온다', async () => {
    const { ua, pub, auth } = await newUa();
    const msg = JSON.stringify({ title: '차례 도달', body: '대기 순번이 도달했습니다! 지금 확인해 주세요.' });
    const body = await encryptPayload(enc.encode(msg), pub, b64uEncode(auth));
    expect(await decryptAsBrowser(body, ua, auth)).toBe(msg);
  });

  it('너무 긴 내용은 거부한다', async () => {
    const { pub, auth } = await newUa();
    await expect(encryptPayload(new Uint8Array(4000), pub, b64uEncode(auth))).rejects.toThrow();
  });
});

describe('vapidAuthorization (RFC 8292)', () => {
  it('공개키로 검증되는 ES256 JWT 를 만든다', async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const publicKey = b64uEncode((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
    const privateKey = (await crypto.subtle.exportKey('jwk', kp.privateKey)).d!;

    const h = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', {
      publicKey,
      privateKey,
      subject: 'mailto:test@example.invalid',
    }, 1_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m).not.toBeNull();
    expect(m[4]).toBe(publicKey);
    const claims = JSON.parse(new TextDecoder().decode(b64uDecode(m[2])));
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_000_000 + 43200, sub: 'mailto:test@example.invalid' });
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      kp.publicKey,
      b64uDecode(m[3]),
      enc.encode(`${m[1]}.${m[2]}`),
    );
    expect(ok).toBe(true);
  });
});

describe('parsePushTarget', () => {
  const keys = { p256dh: b64uEncode(new Uint8Array([4, ...new Uint8Array(64)])), auth: b64uEncode(new Uint8Array(16)) };
  it('FCM 구독은 통과', () => {
    expect(parsePushTarget({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys })).not.toBeNull();
  });
  it('알 수 없는 호스트·http·잘못된 키는 거부', () => {
    expect(parsePushTarget({ endpoint: 'https://evil.example.com/x', keys })).toBeNull();
    expect(parsePushTarget({ endpoint: 'http://fcm.googleapis.com/x', keys })).toBeNull();
    expect(parsePushTarget({ endpoint: 'https://fcm.googleapis.com/x', keys: { ...keys, auth: 'AAAA' } })).toBeNull();
    expect(parsePushTarget(null)).toBeNull();
  });
});
