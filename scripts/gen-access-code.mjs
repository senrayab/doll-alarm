// 개인 접속 코드 생성 → .dev.vars 의 ACCESS_CODE (배포 환경은 wrangler secret)
// 헷갈리는 글자(0/O, 1/I/L) 제외 32자 중 12자 ≈ 60비트
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const ABC = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const bytes = crypto.getRandomValues(new Uint8Array(64));
let raw = '';
for (const b of bytes) {
  if (b >= 248) continue; // 31*8=248, 편향 없이
  raw += ABC[b % ABC.length];
  if (raw.length === 12) break;
}
const code = raw.match(/.{4}/g).join('-');

const f = '.dev.vars';
const cur = existsSync(f) ? readFileSync(f, 'utf8') : '';
if (/^ACCESS_CODE=/m.test(cur) && !process.argv.includes('--force')) {
  console.error('.dev.vars 에 이미 ACCESS_CODE 가 있습니다. 새로 만들려면 --force');
  process.exit(1);
}
writeFileSync(f, cur.replace(/^ACCESS_CODE=.*\n?/m, '') + `ACCESS_CODE=${code}\n`);
console.log(`접속 코드: ${code}`);
console.log('배포 환경 반영: npx wrangler secret bulk .dev.vars');
