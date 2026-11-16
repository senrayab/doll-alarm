// 개인 접속 코드 — 서버 기능(/api/*)은 코드가 맞아야만 동작
// 코드는 Worker secret(ACCESS_CODE)에, 휴대폰에서는 IndexedDB 에 보관

export const ACCESS_HEADER = 'X-Access-Code';

/** 대소문자·하이픈·공백 무시 (입력 편의) */
export function normalizeCode(s: string) {
  return s.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

async function digest(s: string) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
}

/** 시간차로 코드를 추측하지 못하게 해시 후 상수 시간 비교 */
export async function checkAccessCode(given: string | null, expected: string | undefined): Promise<boolean> {
  if (!given || !expected) return false;
  const [a, b] = await Promise.all([digest(normalizeCode(given)), digest(normalizeCode(expected))]);
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBuffer, b: ArrayBuffer) => boolean };
  if (subtle.timingSafeEqual) return subtle.timingSafeEqual(a, b);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
