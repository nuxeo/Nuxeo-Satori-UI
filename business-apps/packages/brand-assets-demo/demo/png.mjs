/**
 * The kit's pictures, drawn here rather than photographed or downloaded: a plain shape in two
 * colours, written as a PNG with Node's own zlib. The same picture is the same bytes every time, so
 * a second seed finds the file already there and uploads nothing.
 *
 *   picturePng({ shape: 'jacket', size: [1200, 1500], background: [r, g, b], ink: [r, g, b] })
 *
 * Shapes: `jacket`, `jacket-back`, `model`, `shoe` and `hills`. Large enough for Nuxeo to make its
 * Medium view, which the asset page shows first, as it does for a photograph.
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

/** Whether the point (u, v), each from 0 to 1 across the picture, is inside a circle. */
const inCircle = (u, v, cu, cv, r, aspect) => ((u - cu) * aspect) ** 2 + (v - cv) ** 2 <= r * r;

/** A jacket seen from the front or the back: body, sleeves and hood. */
function jacket(u, v, aspect, back) {
  const dx = Math.abs(u - 0.5);
  const body = dx < 0.2 && v > 0.26 && v < 0.86;
  const sleeves = dx >= 0.2 && dx < 0.31 && v > 0.27 && v < 0.27 + 0.4 - (dx - 0.2) * 0.8;
  const hood = inCircle(u, v, 0.5, back ? 0.2 : 0.23, back ? 0.1 : 0.08, aspect);
  // The front has its zip, a thin line of the background down the middle.
  const zip = !back && dx < 0.006 && v > 0.3 && v < 0.86;
  return (body || sleeves || hood) && !zip;
}

const SHAPES = {
  jacket: (u, v, aspect) => jacket(u, v, aspect, false),
  'jacket-back': (u, v, aspect) => jacket(u, v, aspect, true),
  model: (u, v, aspect) => {
    const dx = Math.abs(u - 0.5);
    const head = inCircle(u, v, 0.5, 0.13, 0.065, aspect);
    const legs = v >= 0.84 && v < 0.97 && dx > 0.025 && dx < 0.12;
    return head || legs || jacket(u, v, aspect, false);
  },
  shoe: (u, v, aspect) => {
    const upper = ((u - 0.5) * aspect) ** 2 / 0.13 + (v - 0.58) ** 2 / 0.012 <= 1 && v < 0.64;
    const sole = Math.abs(u - 0.5) < 0.38 && v >= 0.64 && v < 0.69;
    return upper || sole;
  },
  hills: (u, v, aspect) =>
    v > 0.62 + 0.08 * Math.sin(u * Math.PI * 3) || inCircle(u, v, 0.74, 0.26, 0.08, aspect),
};

/** The picture as PNG bytes: 8-bit RGB, no interlace. */
export function picturePng({ shape, size: [width, height], background, ink }) {
  const inside = SHAPES[shape];
  if (!inside) throw new Error(`png.mjs: no shape "${shape}"`);
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0))
    throw new Error(`png.mjs: the size ${width} by ${height} is not one`);
  const aspect = width / height;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    // Filter type 0, none, before each scanline.
    raw[row] = 0;
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = inside((x + 0.5) / width, v, aspect) ? ink : background;
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
