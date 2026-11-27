/**
 * The media kit's pictures, drawn here rather than photographed or downloaded: a lighthouse on a
 * headland in two colours, written as a PNG with Node's own zlib. The same picture is the same bytes
 * every time.
 *
 *   picturePng({ shape: 'key-art', size: [480, 270], background: [r, g, b], ink: [r, g, b] })
 *
 * Shapes: `key-art`, the film's poster, and `still`, a frame of it. The writer, its CRC and its
 * chunks are the brand assets kit's `demo/png.mjs`, copied rather than imported, so that each kit's
 * demo stands alone; only the shapes are the media kit's own.
 */
import { deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 PNG puts after each chunk, over its type and data. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A lighthouse: its tower, narrowing upwards, its lamp, and the headland it stands on. */
function lighthouse(u, v, at, beam) {
  const headland = v > 0.78 - 0.12 * Math.exp(-(((u - at) / 0.18) ** 2));
  const top = 0.32;
  const base = 0.7;
  const half = v > top && v < base ? 0.025 + ((v - top) / (base - top)) * 0.03 : 0;
  const tower = Math.abs(u - at) < half;
  const lamp = Math.abs(u - at) < 0.035 && v > top - 0.06 && v <= top;
  // The beam, a wedge from the lamp, on the still alone.
  const rise = (top - 0.03 - v) / Math.max(0.0001, u - at);
  const light = beam && u > at + 0.04 && rise > -0.08 && rise < 0.12;
  return headland || tower || lamp || light;
}

const SHAPES = {
  'key-art': (u, v) => lighthouse(u, v, 0.5, false),
  still: (u, v) => lighthouse(u, v, 0.3, true),
};

/** The picture as PNG bytes: 8-bit RGB, no interlace. */
export function picturePng({ shape, size: [width, height], background, ink }) {
  const inside = SHAPES[shape];
  if (!inside) throw new Error(`png.mjs: no shape "${shape}"`);
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0))
    throw new Error(`png.mjs: the size ${width} by ${height} is not one`);
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    // Filter type 0, none, before each scanline.
    raw[row] = 0;
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = inside((x + 0.5) / width, v) ? ink : background;
      const at = row + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
