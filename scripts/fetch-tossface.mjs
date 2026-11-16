// Tossface 이모지 글꼴을 public/fonts/tossface 로 받아 온다 (사이트 안에서 제공 — 외부 CDN 접속 없음)
// 원본 CSS 는 숫자(0-9)·#·* 까지 이모지 글꼴로 덮는다 → 숫자가 이모지로 보이지 않게 그 범위를 뺀다.
// 글꼴 파일은 수정하지 않는다 (SIL OFL — 원본 그대로 재배포).
import { mkdirSync, writeFileSync } from 'node:fs';

const VERSION = '1.6.1'; // 고정 버전 — 올릴 때 여기만 바꿈
const BASE = `https://cdn.jsdelivr.net/gh/toss/tossface@${VERSION}/dist/`;
const OUT = 'public/fonts/tossface/';

async function get(url, type = 'text') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return type === 'text' ? res.text() : Buffer.from(await res.arrayBuffer());
}

mkdirSync(OUT, { recursive: true });
let css = await get(BASE + 'tossface.css');

// 숫자·#·* 와 그 키캡 조합 제거
const DROP = /^(U\+23|U\+2A|U\+30-39|U\+(2[3A]|3[0-9])20E3)$/i;
css = css.replace(/unicode-range:([^;]+);/g, (_, ranges) => {
  const kept = ranges
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r && !DROP.test(r));
  return `unicode-range: ${kept.join(', ')};`;
});
// woff2 만 사용
css = css.replace(/,\s*url\("[^"]+\.woff"\) format\("woff"\)/g, '');
css = css.replace(/@font-face\s*{/g, '@font-face {\n  font-display: swap;');

const files = [...new Set([...css.matchAll(/url\("\.\/([^"]+\.woff2)"\)/g)].map((m) => m[1]))];
for (const f of files) writeFileSync(OUT + f, await get(BASE + f, 'bin'));
writeFileSync(OUT + 'tossface.css', `/* Tossface ${VERSION} — 숫자·#·* 범위 제외 (scripts/fetch-tossface.mjs) */\n` + css);
writeFileSync(OUT + 'LICENSE.txt', await get(`https://cdn.jsdelivr.net/gh/toss/tossface@${VERSION}/LICENSE`));
console.log(`tossface ${VERSION}: ${files.length} files`);
