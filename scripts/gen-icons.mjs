// 앱 아이콘 PNG 생성 (외부 의존성 없음) — 오프화이트 바탕 + 오렌지 오라 + 흰 인형 눈
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
const BG = [245, 243, 239];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const STOPS = [
  [0, [255, 138, 61]],
  [0.45, [255, 190, 99]],
  [0.8, [255, 233, 201]],
  [1, BG],
];
function aura(d) {
  for (let i = 1; i < STOPS.length; i++) {
    const [p0, c0] = STOPS[i - 1];
    const [p1, c1] = STOPS[i];
    if (d <= p1) return mix(c0, c1, (d - p0) / (p1 - p0));
  }
  return BG;
}
// 눈 두 개 (살짝 기울어진 타원) — 안전 영역 안
function eye(u, v, cx, cy) {
  const a = 0.21;
  const x = (u - cx) * Math.cos(a) + (v - cy) * Math.sin(a);
  const y = -(u - cx) * Math.sin(a) + (v - cy) * Math.cos(a);
  return (x / 0.055) ** 2 + (y / 0.085) ** 2 <= 1;
}
const eyes = (u, v, s = 1) => {
  const x = (u - 0.5) / s + 0.5, y = (v - 0.5) / s + 0.5;
  return eye(x, y, 0.43, 0.5) || eye(x, y, 0.58, 0.53);
};
function face(u, v) {
  if (eyes(u, v)) return [255, 255, 255, 255];
  const d = Math.min(1, Math.hypot(u - 0.5, (v - 0.68) * 1.15) / 0.62);
  return [...aura(d), 255];
}
const full = face;
const round = (u, v) => ((u - 0.5) ** 2 + (v - 0.5) ** 2 > 0.25 ? [0, 0, 0, 0] : face(u, v));
const badge = (u, v) => (eyes(u, v, 1.6) ? [255, 255, 255, 255] : [0, 0, 0, 0]); // 안드로이드 상단바용 단색
writeFileSync('public/icons/icon-192.png', png(192, round));
writeFileSync('public/icons/icon-512.png', png(512, round));
writeFileSync('public/icons/maskable-512.png', png(512, full));
writeFileSync('public/icons/badge-96.png', png(96, badge));
console.log('icons written');
