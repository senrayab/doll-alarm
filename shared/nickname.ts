// 닉네임 정규화·해시 — 앱과 서버가 똑같이 계산해야 하므로 공통 코드
// 서버에는 평문 닉네임 대신 SHA-256(salt:정규화닉네임) 만 보낸다.
// 명단 이름에 "(러브픽)라피누0001" 처럼 앞뒤 문구가 붙어도 찾을 수 있게,
// 서버는 명단 이름의 여러 형태(괄호 뗀 것, 조각)를 해시해서 비교한다.

export function normalizeNickname(s: string) {
  return s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 괄호로 둘러싼 문구 제거: (러브픽) [VIP] 【공지】 {x} <x> 「x」 */
function stripBrackets(s: string) {
  return s
    .replace(/\([^)]*\)|\[[^\]]*\]|【[^】]*】|\{[^}]*\}|<[^>]*>|「[^」]*」|（[^）]*）/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 사용자가 입력한 닉네임의 핵심 부분 — 괄호 문구와 끝의 " 님" 제거 */
export function coreNickname(input: string) {
  const n = normalizeNickname(input).replace(/\s+님$/, '');
  return stripBrackets(n) || n;
}

/** 명단의 이름 하나로 만들 수 있는 비교 후보 */
export function nicknameVariants(raw: string): string[] {
  const n = normalizeNickname(raw);
  const out = new Set<string>([n]);
  const stripped = stripBrackets(n);
  if (stripped) out.add(stripped);
  // "러브픽 라피누0001", "라피누0001 · 2건" 처럼 구분자로 나뉜 조각
  for (const base of [n, stripped]) {
    for (const part of base.split(/[\s·|/_\-~:]+/)) {
      if ([...part].length >= 2) out.add(part);
    }
  }
  return [...out];
}

async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new Uint8Array(new TextEncoder().encode(s)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 앱 → 서버: 입력한 닉네임의 핵심 부분 해시 */
export async function nicknameHash(salt: string, nickname: string) {
  return sha256hex(`${salt}:${coreNickname(nickname)}`);
}

/** 서버: 명단 이름이 내 해시와 맞는지 (여러 형태 중 하나라도) */
export async function matchesNickname(salt: string, hash: string, rowName: string) {
  for (const v of nicknameVariants(rowName)) {
    if ((await sha256hex(`${salt}:${v}`)) === hash) return true;
  }
  return false;
}

export function randomSalt() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
