// Draws the app icon (a speedometer dial) and writes the PNG sizes the PWA
// and iOS home screen need. No dependencies: rasterised by hand, encoded with zlib.
//
//   node apps/web/scripts/make-icons.mjs

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../public/", import.meta.url));

const BG = [11, 13, 16];
const TRACK = [42, 49, 58];
const AMBER = [242, 179, 61];
const RED = [239, 75, 75];
const WHITE = [242, 245, 247];

/** Coverage-weighted colour for one pixel, supersampled 4×4. */
function render(size, { rounded }) {
  const px = new Uint8Array(size * size * 4);
  const ss = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          // Unit coordinates: centre (0,0), edges ±1.
          const u = ((x + (sx + 0.5) / ss) / size) * 2 - 1;
          const v = ((y + (sy + 0.5) / ss) / size) * 2 - 1;
          const c = sample(u, v, rounded);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a += 1;
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      px[i] = a ? r / a : 0;
      px[i + 1] = a ? g / a : 0;
      px[i + 2] = a ? b / a : 0;
      px[i + 3] = (a / n) * 255;
    }
  }
  return px;
}

/** The icon as a function of position; null = transparent. */
function sample(u, v, rounded) {
  // Background: rounded square (or full bleed for maskable / iOS, which rounds itself).
  if (rounded) {
    const k = 0.22;
    const dx = Math.max(Math.abs(u) - (1 - k), 0);
    const dy = Math.max(Math.abs(v) - (1 - k), 0);
    if (dx * dx + dy * dy > k * k) return null;
  }
  // Dial sits slightly high, scaled into the maskable safe zone.
  const s = 0.72;
  const x = u / s;
  const y = (v + 0.06) / s;
  const r = Math.hypot(x, y);
  // Angle from straight up, clockwise, degrees.
  const ang = (Math.atan2(x, -y) * 180) / Math.PI;
  const inSweep = ang >= -135 && ang <= 135;

  // Needle at ~70%: a tapered wedge from the hub.
  const needleAng = (60 * Math.PI) / 180;
  const nx = Math.sin(needleAng);
  const ny = -Math.cos(needleAng);
  const along = x * nx + y * ny;
  const across = Math.abs(x * -ny + y * nx);
  if (along > -0.1 && along < 0.78 && across < 0.07 * (1 - along / 0.85)) return WHITE;
  if (r < 0.14) return TRACK;
  if (r < 0.18) return WHITE;

  // Arc: amber up to the "limit", red beyond it.
  if (inSweep && r > 0.82 && r < 0.98) return ang > 85 ? RED : AMBER;
  if (inSweep && r > 0.8 && r < 1.0) return TRACK;
  // Tick marks every 27°.
  if (inSweep && r > 0.62 && r < 0.74 && Math.abs(((ang + 135) % 27) - 13.5) > 11.5) return WHITE;
  return BG;
}

// --- PNG encoding -----------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  // Each row starts with filter type 0.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const icons = [
  { file: "icon-192.png", size: 192, rounded: true },
  { file: "icon-512.png", size: 512, rounded: true },
  { file: "icon-maskable-512.png", size: 512, rounded: false },
  // iOS rounds home-screen icons itself and wants them opaque.
  { file: "apple-touch-icon.png", size: 180, rounded: false },
];

for (const { file, size, rounded } of icons) {
  writeFileSync(OUT + file, png(size, render(size, { rounded })));
  console.log(`wrote ${file}`);
}
