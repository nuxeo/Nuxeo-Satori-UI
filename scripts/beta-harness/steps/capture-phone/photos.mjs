/**
 * The capture steps' photos: EXIF, XMP, a comment, a C2PA segment, fill bytes and trailing data
 * written into a JPEG the browser drew, and a reader of what an uploaded JPEG carries, written apart
 * from the app's own (`libs/features/capture/src/lib/photo-metadata.ts`). It reads a different way:
 * every segment's marker is listed, and any that is not one a picture needs or the page keeps is
 * counted, so a kind of segment the app forgot is seen here; and the place's name and the
 * latitude's bytes are looked for anywhere in the file, in whatever segment they might be.
 *
 * Plain Node, no dependency: the runner imports it as it is.
 */

const TAG_ORIENTATION = 0x0112;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;

/** The latitude written into a photo: 51 deg 30 min 26.4 sec, each a rational easy to find again. */
export const LATITUDE = [51, 1, 30, 1, 264, 10];
/** The longitude: 0 deg 7 min 39 sec. */
export const LONGITUDE = [0, 1, 7, 1, 39, 1];
/** A place name the XMP packet carries, which must not reach the server. */
export const PLACE = 'Wharf Lane depot (fictional)';

/**
 * A little-endian EXIF APP1 segment: IFD0 with the orientation, a pointer to an Exif IFD with the
 * picture's pixel size, and a pointer to a GPS IFD with a latitude and a longitude.
 *
 * @param {{ orientation: number, width: number, height: number }} photo
 */
export function exifSegment({ orientation, width, height }) {
  const tiff = Buffer.alloc(256);
  let at = 0;
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  // IFD0: 3 entries, at 8.
  const ifd0 = 8;
  const exif = ifd0 + 2 + 3 * 12 + 4; // 50
  const gps = exif + 2 + 2 * 12 + 4; // 80
  const values = gps + 2 + 4 * 12 + 4; // 134
  const entry = (offset, tag, type, count, value) => {
    tiff.writeUInt16LE(tag, offset);
    tiff.writeUInt16LE(type, offset + 2);
    tiff.writeUInt32LE(count, offset + 4);
    if (type === 3 && count === 1) tiff.writeUInt16LE(value, offset + 8);
    else tiff.writeUInt32LE(value, offset + 8);
  };
  at = ifd0;
  tiff.writeUInt16LE(3, at);
  entry(at + 2, TAG_ORIENTATION, 3, 1, orientation);
  entry(at + 14, TAG_EXIF_IFD, 4, 1, exif);
  entry(at + 26, TAG_GPS_IFD, 4, 1, gps);
  tiff.writeUInt32LE(0, at + 38);
  at = exif;
  tiff.writeUInt16LE(2, at);
  entry(at + 2, 0xa002, 4, 1, width);
  entry(at + 14, 0xa003, 4, 1, height);
  tiff.writeUInt32LE(0, at + 26);
  at = gps;
  tiff.writeUInt16LE(4, at);
  // GPSLatitudeRef "N\0", inline.
  tiff.writeUInt16LE(0x0001, at + 2);
  tiff.writeUInt16LE(2, at + 4);
  tiff.writeUInt32LE(2, at + 6);
  tiff.write('N\0', at + 10, 'latin1');
  entry(at + 14, 0x0002, 5, 3, values);
  // GPSLongitudeRef "W\0", inline.
  tiff.writeUInt16LE(0x0003, at + 26);
  tiff.writeUInt16LE(2, at + 28);
  tiff.writeUInt32LE(2, at + 30);
  tiff.write('W\0', at + 34, 'latin1');
  entry(at + 38, 0x0004, 5, 3, values + 24);
  tiff.writeUInt32LE(0, at + 50);
  [...LATITUDE, ...LONGITUDE].forEach((part, index) =>
    tiff.writeUInt32LE(part, values + index * 4),
  );
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff.subarray(0, values + 48)]);
  return segment(0xe1, body);
}

/** A comment naming the place, which nothing must keep. */
export function commentSegment() {
  return segment(0xfe, Buffer.from(`Taken at ${PLACE}`, 'latin1'));
}

/** A C2PA manifest's JUMBF box in APP11, as recent phones write one, naming the place too. */
export function c2paSegment() {
  return segment(0xeb, Buffer.from(`JP\0\u0001jumb c2pa.assertions ${PLACE}`, 'latin1'));
}

/** A segment with `count` 0xFF fill bytes before its marker, as the standard allows. */
export function filled(count, part) {
  return Buffer.concat([Buffer.alloc(count, 0xff), part]);
}

/** An XMP APP1 segment naming the place, as a phone's editor writes one. */
export function xmpSegment() {
  const packet =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"' +
    ` exif:GPSLatitude="51,30.44N" exif:GPSLongitude="0,7.65W" photoshop:City="${PLACE}"/>` +
    '</rdf:RDF></x:xmpmeta>';
  return segment(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0${packet}`, 'latin1'));
}

function segment(marker, body) {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}

/**
 * `jpeg` with `segments` after its start of image, its own EXIF left out, and `trailing` after its
 * end, as a gain map is.
 *
 * @param {Buffer} jpeg
 * @param {Buffer[]} segments
 * @param {Buffer} [trailing]
 */
export function withMetadata(jpeg, segments, trailing = Buffer.alloc(0)) {
  const kept = [];
  let at = 2;
  while (at < jpeg.length && jpeg[at] === 0xff && jpeg[at + 1] !== 0xda) {
    const length = jpeg.readUInt16BE(at + 2);
    const isExif =
      jpeg[at + 1] === 0xe1 && jpeg.subarray(at + 4, at + 10).toString('latin1') === 'Exif\0\0';
    if (!isExif) kept.push(jpeg.subarray(at, at + 2 + length));
    at += 2 + length;
  }
  return Buffer.concat([jpeg.subarray(0, 2), ...segments, ...kept, jpeg.subarray(at), trailing]);
}

/**
 * What a JPEG carries, read here and nowhere else: its stored size, its EXIF orientation, whether
 * any EXIF IFD has a GPS pointer, whether it holds an XMP or IPTC segment, whether anything follows
 * its end, and whether the place's name or the latitude's bytes are anywhere in it.
 *
 * @param {Buffer} jpeg
 */
export function readPhoto(jpeg) {
  const facts = {
    jpeg: jpeg[0] === 0xff && jpeg[1] === 0xd8,
    width: 0,
    height: 0,
    orientation: null,
    gps: false,
    xmp: false,
    iptc: false,
    trailing: false,
    exifSegments: 0,
    /** Segments that neither decode the picture nor are JFIF, an ICC profile, Adobe's or EXIF. */
    others: [],
    placeNamed: jpeg.includes(Buffer.from(PLACE, 'latin1')),
    latitudeBytes: jpeg.includes(latitudeBytes()),
  };
  if (!facts.jpeg) return facts;
  let at = 2;
  while (at + 4 <= jpeg.length) {
    if (jpeg[at] !== 0xff) break;
    // Fill bytes before a marker.
    while (at + 1 < jpeg.length && jpeg[at + 1] === 0xff) at += 1;
    const marker = jpeg[at + 1];
    const length = jpeg.readUInt16BE(at + 2);
    const body = jpeg.subarray(at + 4, at + 2 + length);
    const label = body.subarray(0, 12).toString('latin1');
    const kept =
      (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc8) ||
      [0xda, 0xdb, 0xdd].includes(marker) ||
      (marker === 0xe0 && label.startsWith('JFIF')) ||
      (marker === 0xe1 && label.startsWith('Exif')) ||
      (marker === 0xe2 && label.startsWith('ICC_PROFILE')) ||
      (marker === 0xee && label.startsWith('Adobe'));
    if (!kept) facts.others.push(marker.toString(16));
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      facts.height = body.readUInt16BE(1);
      facts.width = body.readUInt16BE(3);
    }
    if (marker === 0xe1 && body.subarray(0, 6).toString('latin1') === 'Exif\0\0') {
      facts.exifSegments += 1;
      readExif(body.subarray(6), facts);
    }
    if (
      marker === 0xe1 &&
      body.subarray(0, 28).toString('latin1') === 'http://ns.adobe.com/xap/1.0/'
    )
      facts.xmp = true;
    if (marker === 0xed) facts.iptc = true;
    if (marker === 0xda) {
      const end = jpeg.indexOf(Buffer.from([0xff, 0xd9]), at + 2 + length);
      facts.trailing = end >= 0 && jpeg.subarray(end + 2).some((byte) => byte !== 0);
      break;
    }
    at += 2 + length;
  }
  return facts;
}

function latitudeBytes() {
  const bytes = Buffer.alloc(24);
  LATITUDE.forEach((part, index) => bytes.writeUInt32LE(part, index * 4));
  return bytes;
}

function readExif(tiff, facts) {
  const little = tiff.subarray(0, 2).toString('latin1') === 'II';
  const u16 = (offset) => (little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset));
  const u32 = (offset) => (little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset));
  const ifds = [u32(4)];
  const seen = new Set();
  while (ifds.length > 0) {
    const offset = ifds.shift();
    if (!offset || seen.has(offset) || offset + 2 > tiff.length) continue;
    seen.add(offset);
    const count = u16(offset);
    for (let index = 0; index < count; index += 1) {
      const entry = offset + 2 + index * 12;
      if (entry + 12 > tiff.length) break;
      const tag = u16(entry);
      if (tag === TAG_ORIENTATION) facts.orientation = u16(entry + 8);
      if (tag === TAG_GPS_IFD) facts.gps = true;
      if (tag === TAG_EXIF_IFD) ifds.push(u32(entry + 8));
    }
    const next = offset + 2 + count * 12;
    if (next + 4 <= tiff.length) ifds.push(u32(next));
  }
}

/**
 * The parts of a `multipart/form-data` body, by their names: each one's file name, type and bytes.
 *
 * @param {Buffer} body
 * @param {string} contentType
 */
export function formParts(body, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? '');
  const parts = new Map();
  if (!boundary) return parts;
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`, 'latin1');
  let at = body.indexOf(delimiter);
  while (at >= 0) {
    const start = at + delimiter.length;
    if (body.subarray(start, start + 2).toString('latin1') === '--') break;
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;
    const part = body.subarray(start + 2, next - 2);
    const split = part.indexOf(Buffer.from('\r\n\r\n', 'latin1'));
    const headers = part.subarray(0, split).toString('utf8');
    const name = /name="([^"]*)"/.exec(headers)?.[1];
    const filename = /filename="([^"]*)"/.exec(headers)?.[1] ?? null;
    const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1] ?? null;
    if (name) parts.set(name, { filename, type, bytes: part.subarray(split + 4) });
    at = next;
  }
  return parts;
}
