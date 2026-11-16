// 앱 아이콘 PNG 생성 (외부 의존성 없음) — 분홍 바탕 + 흰 종 모양
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel((x + 0.5) / size, (y + 0.5) / size);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const PINK = [227, 75, 145, 255], WHITE = [255, 255, 255, 255], CLEAR = [0, 0, 0, 0];
// 종: 위쪽 반원 몸통 + 아래 테두리 + 추. 안전 영역(가운데 60%) 안에 그림 (maskable 대응)
function bell(u, v, s = 1) {
  const x = (u - 0.5) / s + 0.5, y = (v - 0.5) / s + 0.5;
  const dome = (x - 0.5) ** 2 / 0.04 + (y - 0.5) ** 2 / 0.05 <= 1 && y <= 0.62;
  const body = Math.abs(x - 0.5) <= 0.2 + Math.max(0, y - 0.5) * 0.4 && y >= 0.48 && y <= 0.64;
  const rim = Math.abs(x - 0.5) <= 0.27 && y >= 0.62 && y <= 0.67;
  const clap = (x - 0.5) ** 2 + (y - 0.71) ** 2 <= 0.045 ** 2;
  const knob = (x - 0.5) ** 2 + (y - 0.27) ** 2 <= 0.035 ** 2;
  return dome || body || rim || clap || knob;
}
const full = (u, v) => (bell(u, v) ? WHITE : PINK);
const round = (u, v) => ((u - 0.5) ** 2 + (v - 0.5) ** 2 > 0.25 ? CLEAR : bell(u, v) ? WHITE : PINK);
const badge = (u, v) => (bell(u, v, 1.5) ? WHITE : CLEAR); // 안드로이드 상단바용 단색
writeFileSync('public/icons/icon-192.png', png(192, round));
writeFileSync('public/icons/icon-512.png', png(512, round));
writeFileSync('public/icons/maskable-512.png', png(512, full));
writeFileSync('public/icons/badge-96.png', png(96, badge));
console.log('icons written');
