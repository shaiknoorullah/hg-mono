// Bakes the two static ground textures at build time. Zero dependencies.
// Out: paper-tooth.png (tiling fbm tooth), dither-64.png (ordered Bayer, 64px).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const T = [];
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
// 8-bit greyscale PNG
function png(w, h, px) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; px.copy(raw, y * (w + 1) + 1, y * w, (y + 1) * w); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- tiling value-noise fbm (the USAvionix shader's 3 octaves, run once, on the CPU)
const hash = (x, y, s) => { const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); };
const smooth = t => t * t * (3 - 2 * t);
function noise(x, y, per, s) {           // periodic -> the tile seams
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const w = (a, b) => ((a % b) + b) % b;
  const a = hash(w(xi, per), w(yi, per), s), b = hash(w(xi + 1, per), w(yi, per), s);
  const c = hash(w(xi, per), w(yi + 1, per), s), d = hash(w(xi + 1, per), w(yi + 1, per), s);
  const u = smooth(xf), v = smooth(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x, y, per, s) {             // 3 octaves, amp .5, freq x2
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 3; o++) { v += amp * noise(x * f, y * f, per * f, s + o * 17); amp *= 0.5; f *= 2; }
  return v;
}

const N = 256, PER = 8;                  // 256px tile, 8 noise cells -> seamless
const tooth = Buffer.alloc(N * N);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const u = (x / N) * PER, v = (y / N) * PER;
  const fibre = fbm(u * 4, v * 0.6, PER * 4, 3);        // drawn-out thread
  const grain = fbm(u * 12, v * 12, PER * 12, 11);      // fine tooth
  const t = 0.55 * grain + 0.45 * fibre;                 // NO lighting term: a lit paper is a gradient
  tooth[y * N + x] = Math.max(0, Math.min(255, Math.round(128 + (t - 0.5) * 210)));
}
writeFileSync(new URL('./paper-tooth.png', import.meta.url), png(N, N, tooth));

// --- 64px ordered Bayer (recursive), the anti-banding tile
const M = 64, bay = Buffer.alloc(M * M);
const bayer = (x, y, n) => n === 1 ? 0 : 4 * bayer(x % (n / 2), y % (n / 2), n / 2) + [[0, 2], [3, 1]][y >= n / 2 ? 1 : 0][x >= n / 2 ? 1 : 0];
for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) bay[y * M + x] = Math.round((bayer(x, y, M) / (M * M - 1)) * 255);
writeFileSync(new URL('./dither-64.png', import.meta.url), png(M, M, bay));
console.log('baked');
