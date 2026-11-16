// 닉네임 정규화·해시 — 앱과 서버가 똑같이 계산해야 하므로 공통 코드
// 서버에는 평문 닉네임 대신 SHA-256(salt:정규화닉네임) 만 보낸다.

export function normalizeNickname(s: string) {
  return s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function nicknameHash(salt: string, nickname: string) {
  const data = new Uint8Array(new TextEncoder().encode(`${salt}:${normalizeNickname(nickname)}`));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomSalt() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
