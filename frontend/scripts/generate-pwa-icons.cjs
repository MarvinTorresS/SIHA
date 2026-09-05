// Genera los íconos PWA (pwa-192.png, pwa-512.png) a partir de formas
// dibujadas a mano (sin dependencias externas: zlib ya viene con Node).
// Diseño: fondo rojo UNA a sangre completa (requisito de íconos "maskable")
// con un círculo blanco y un check rojo adentro, aludiendo a la validación
// de horario sin conflictos (propósito central de SIHA, ver PRODUCT.md).
// Si en algún momento hay arte de marca real, reemplazar estos archivos y
// borrar este script generador.
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const UNA_ROJO = [0xea, 0x00, 0x29];
const BLANCO = [0xff, 0xff, 0xff];

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const abLen2 = abx * abx + aby * aby;
  let t = abLen2 === 0 ? 0 : (apx * abx + apy * aby) / abLen2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx, cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const circleR = size * 0.34;
  const strokeW = size * 0.045;

  // Puntos del check, en coordenadas relativas al tamaño del ícono.
  const p1 = [cx - circleR * 0.5, cy + circleR * 0.05];
  const p2 = [cx - circleR * 0.12, cy + circleR * 0.42];
  const p3 = [cx + circleR * 0.55, cy - circleR * 0.4];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dCenter = Math.hypot(x - cx, y - cy);
      let rgb = UNA_ROJO;

      if (dCenter <= circleR) {
        rgb = BLANCO;
        const dCheck = Math.min(
          distToSegment(x, y, p1[0], p1[1], p2[0], p2[1]),
          distToSegment(x, y, p2[0], p2[1], p3[0], p3[1])
        );
        if (dCheck <= strokeW) rgb = UNA_ROJO;
      }

      buf[i] = rgb[0];
      buf[i + 1] = rgb[1];
      buf[i + 2] = rgb[2];
      buf[i + 3] = 0xff;
    }
  }
  return buf;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(rgbaBuf, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter type: none
    rgbaBuf.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.resolve(__dirname, "..", "public");
for (const size of [192, 512]) {
  const png = encodePNG(renderIcon(size), size);
  const outPath = path.join(outDir, `pwa-${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Generado ${outPath}`);
}
