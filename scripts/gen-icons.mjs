// Genera le icone PWA (PNG) senza dipendenze: un manubrio bianco su sfondo brand.
// Sostituibili con un logo reale quando vuoi.
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const outDir = fileURLToPath(new URL('../frontend/public/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};

function png(S) {
  const bg = [79, 70, 229]; // indigo brand
  const fg = [255, 255, 255];
  const cy = S / 2;
  const bar = (x, y) => Math.abs(y - cy) <= S * 0.05 && x >= S * 0.25 && x <= S * 0.75;
  const block = (x, y, hw, hh, cx) => Math.abs(y - cy) <= S * hh && Math.abs(x - cx) <= S * hw;
  const raw = Buffer.alloc((S * 3 + 1) * S);
  for (let y = 0; y < S; y++) {
    raw[y * (S * 3 + 1)] = 0; // filtro riga
    for (let x = 0; x < S; x++) {
      const white =
        bar(x, y) ||
        block(x, y, 0.045, 0.18, S * 0.31) || block(x, y, 0.045, 0.18, S * 0.69) ||
        block(x, y, 0.035, 0.12, S * 0.22) || block(x, y, 0.035, 0.12, S * 0.78);
      const c = white ? fg : bg;
      const off = y * (S * 3 + 1) + 1 + x * 3;
      raw[off] = c[0]; raw[off + 1] = c[1]; raw[off + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, RGB
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync(outDir + 'pwa-192x192.png', png(192));
writeFileSync(outDir + 'pwa-512x512.png', png(512));
writeFileSync(outDir + 'apple-touch-icon.png', png(180));
console.log('✅ Icone PWA generate in frontend/public/');
