// VAPID 키쌍 생성 — 공개키는 wrangler.jsonc vars 에, 개인키는 .dev.vars 와 Worker secret 에
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
const privateKey = (await crypto.subtle.exportKey('jwk', kp.privateKey)).d;

const devVars = '.dev.vars';
const line = `VAPID_PRIVATE_KEY=${privateKey}\n`;
if (existsSync(devVars) && /VAPID_PRIVATE_KEY=/.test(readFileSync(devVars, 'utf8'))) {
  console.error('.dev.vars 에 이미 VAPID_PRIVATE_KEY 가 있어 덮어쓰지 않았습니다. 지우고 다시 실행하세요.');
  process.exit(1);
}
writeFileSync(devVars, (existsSync(devVars) ? readFileSync(devVars, 'utf8') : '') + line);

const cfg = 'wrangler.jsonc';
writeFileSync(cfg, readFileSync(cfg, 'utf8').replace(/"VAPID_PUBLIC_KEY":\s*"[^"]*"/, `"VAPID_PUBLIC_KEY": "${publicKey}"`));

console.log('공개키를 wrangler.jsonc 에, 개인키를 .dev.vars 에 썼습니다.');
console.log('배포용 개인키 등록:  npx wrangler secret put VAPID_PRIVATE_KEY   (값은 .dev.vars 에 있음)');
