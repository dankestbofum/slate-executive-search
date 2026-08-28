'use strict';

// Generates public/icons/icon-{192,512}.png: a flat accent-blue square with
// a white "S" monogram, encoded by hand (PNG chunks + zlib deflate) so the
// build has no image-library dependency. Re-run after changing the design;
// output is committed as static assets, not regenerated on every build.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ACCENT = '#1D4E89';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = chunk('IHDR', ihdrData);

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // per-scanline filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = chunk('IDAT', zlib.deflateSync(raw, { level: 9 }));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

// 5x7 dot-matrix "S"
const GLYPH = [
  '.XXX.',
  'X....',
  'X....',
  '.XXX.',
  '....X',
  '....X',
  'XXXX.'
];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function drawIcon(size) {
  const [br, bg, bb] = hexToRgb(ACCENT);
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = br; buf[i * 4 + 1] = bg; buf[i * 4 + 2] = bb; buf[i * 4 + 3] = 255;
  }
  const rows = GLYPH.length, cols = GLYPH[0].length;
  const safeZone = Math.floor(size * 0.5); // stay inside the maskable-icon safe zone
  const cell = Math.floor(safeZone / rows);
  const glyphW = cell * cols, glyphH = cell * rows;
  const offX = Math.floor((size - glyphW) / 2);
  const offY = Math.floor((size - glyphH) / 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (GLYPH[r][c] !== 'X') continue;
      const x0 = offX + c * cell, y0 = offY + r * cell;
      for (let y = y0; y < y0 + cell; y++) {
        for (let x = x0; x < x0 + cell; x++) {
          const idx = (y * size + x) * 4;
          buf[idx] = 255; buf[idx + 1] = 255; buf[idx + 2] = 255; buf[idx + 3] = 255;
        }
      }
    }
  }
  return buf;
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  const png = encodePNG(size, size, drawIcon(size));
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png);
  console.log('wrote icon-%d.png (%d bytes)', size, png.length);
}
