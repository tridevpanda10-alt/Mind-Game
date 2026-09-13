// Generates the placeholder PWA icons (dark background + shield "M" mark)
// as real PNGs using zlib from the Node standard library — no image deps.
// Run: node scripts/make-icons.js
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'public');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Icon painter: returns [r, g, b] for a pixel in an S x S icon.
function paint(size) {
  const bg = [11, 11, 15]; // #0b0b0f
  const accent = [76, 201, 240]; // #4cc9f0
  const dim = [30, 36, 48];
  const cx = size / 2;
  const cy = size * 0.52;
  const rx = size * 0.30; // shield half-width
  const ry = size * 0.36;
  const barW = Math.max(2, size * 0.075); // "M" stroke width
  const mTop = cy - ry * 0.45;
  const mBot = cy + ry * 0.5;
  const mMid = mTop + (mBot - mTop) * 0.42;
  const mLeft = cx - rx * 0.52;
  const mRight = cx + rx * 0.52;
  const pixels = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = bg;
      // shield outline region (between 0.92 and 1.0 of the radii)
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d <= 1.0) {
        // inner dark face
        c = d >= 0.86 ? accent : dim;
        // "M" strokes: left leg, middle V, right leg
        const onLeft = x >= mLeft - barW / 2 && x <= mLeft + barW / 2 && y >= mTop && y <= mBot;
        const onRight = x >= mRight - barW / 2 && x <= mRight + barW / 2 && y >= mTop && y <= mBot;
        const t = (y - mTop) / (mMid - mTop);
        const vx = cx - t * barW * 1.6;
        const onMid = y >= mTop && y <= mMid && Math.abs(x - vx) <= barW / 2;
        const t2 = (y - mMid) / (mBot - mMid);
        const vx2 = cx - barW * 1.6 + t2 * barW * 1.6;
        const onMid2 = y > mMid && y <= mBot && Math.abs(x - vx2) <= barW / 2;
        if (onLeft || onRight || onMid || onMid2) c = accent;
      }
      const i = (y * size + x) * 3;
      pixels[i] = c[0];
      pixels[i + 1] = c[1];
      pixels[i + 2] = c[2];
    }
  }
  return pixels;
}

function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const px = paint(size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    Buffer.from(px.buffer, y * size * 3, size * 3).copy(raw, y * (size * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'icon-192.png'), png(192));
writeFileSync(join(OUT, 'icon-512.png'), png(512));
console.log('wrote icon-192.png and icon-512.png');
