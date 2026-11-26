/**
 * JPEGs for the capture specs, made byte by byte: a picture of a few bytes, and the metadata a
 * phone writes around it. Nothing here decodes; jsdom could not.
 */

/** A TIFF value, as the builder writes it. */
export type TiffValue =
  | { readonly short: readonly number[] }
  | { readonly long: readonly number[] }
  | { readonly rational: readonly number[] }
  | { readonly ascii: string }
  | { readonly undefined: Uint8Array }
  | { readonly ifd: 'exif' | 'gps' | 'ifd1' };

export interface TiffEntry {
  readonly tag: number;
  readonly value: TiffValue;
  /** Writes this type instead of the value's own, to make an entry the reader must refuse. */
  readonly type?: number;
}

export interface TiffIfds {
  readonly ifd0: readonly TiffEntry[];
  readonly ifd1?: readonly TiffEntry[];
  readonly exif?: readonly TiffEntry[];
  readonly gps?: readonly TiffEntry[];
}

const TYPE: Record<string, number> = {
  short: 3,
  long: 4,
  rational: 5,
  ascii: 2,
  undefined: 7,
  ifd: 4,
};

/** A TIFF structure, as EXIF holds one: IFD0 to IFD1, and the Exif and GPS IFDs they point to. */
export function tiff(ifds: TiffIfds, little = true): Uint8Array {
  const order = (['ifd0', 'ifd1', 'exif', 'gps'] as const).filter((name) => ifds[name]);
  const at: Partial<Record<(typeof order)[number], number>> = {};
  let offset = 8;
  for (const name of order) {
    at[name] = offset;
    offset += 2 + (ifds[name]?.length ?? 0) * 12 + 4;
  }
  const bytes = new Uint8Array(offset + 4096);
  const view = new DataView(bytes.buffer);
  let data = offset;
  bytes.set(little ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  for (const name of order) {
    const entries = ifds[name] ?? [];
    const start = at[name] ?? 0;
    view.setUint16(start, entries.length, little);
    entries.forEach((entry, index) => {
      const place = start + 2 + index * 12;
      const kind = Object.keys(entry.value)[0];
      const raw = encode(entry.value, at, little);
      view.setUint16(place, entry.tag, little);
      view.setUint16(place + 2, entry.type ?? TYPE[kind], little);
      view.setUint32(place + 4, raw.count, little);
      if (raw.bytes.length <= 4) bytes.set(raw.bytes, place + 8);
      else {
        view.setUint32(place + 8, data, little);
        bytes.set(raw.bytes, data);
        data += raw.bytes.length + (raw.bytes.length % 2);
      }
    });
    const next = name === 'ifd0' && at.ifd1 ? at.ifd1 : 0;
    view.setUint32(start + 2 + entries.length * 12, next, little);
  }
  return bytes.slice(0, data);
}

function encode(
  value: TiffValue,
  at: Partial<Record<string, number>>,
  little: boolean,
): { readonly bytes: Uint8Array; readonly count: number } {
  const out = (size: number, numbers: readonly number[]) => {
    const bytes = new Uint8Array(size * numbers.length);
    const view = new DataView(bytes.buffer);
    numbers.forEach((number, index) =>
      size === 2
        ? view.setUint16(index * 2, number, little)
        : view.setUint32(index * 4, number, little),
    );
    return bytes;
  };
  if ('short' in value) return { bytes: out(2, value.short), count: value.short.length };
  if ('long' in value) return { bytes: out(4, value.long), count: value.long.length };
  if ('rational' in value)
    return { bytes: out(4, value.rational), count: value.rational.length / 2 };
  if ('ascii' in value) {
    const bytes = new Uint8Array([...value.ascii].map((char) => char.charCodeAt(0)).concat(0));
    return { bytes, count: bytes.length };
  }
  if ('undefined' in value) return { bytes: value.undefined, count: value.undefined.length };
  return { bytes: out(4, [at[value.ifd] ?? 0]), count: 1 };
}

/** A marker segment: the marker, its length, its body. */
export function segment(marker: number, body: Uint8Array | readonly number[]): Uint8Array {
  const data = body instanceof Uint8Array ? body : new Uint8Array(body);
  const out = new Uint8Array(4 + data.length);
  out[0] = 0xff;
  out[1] = marker;
  out[2] = ((data.length + 2) >> 8) & 0xff;
  out[3] = (data.length + 2) & 0xff;
  out.set(data, 4);
  return out;
}

const text = (value: string): number[] => [...value].map((char) => char.charCodeAt(0));

export function exifSegment(structure: Uint8Array): Uint8Array {
  return segment(0xe1, new Uint8Array([...text('Exif\0\0'), ...structure]));
}

export function xmpSegment(packet = '<x:xmpmeta exif:GPSLatitude="51,30.4N"/>'): Uint8Array {
  return segment(0xe1, new Uint8Array(text(`http://ns.adobe.com/xap/1.0/\0${packet}`)));
}

export const jfifSegment = (): Uint8Array =>
  segment(0xe0, [...text('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
export const iccSegment = (): Uint8Array =>
  segment(0xe2, [...text('ICC_PROFILE\0'), 1, 1, 0xaa, 0xbb]);
export const mpfSegment = (): Uint8Array => segment(0xe2, [...text('MPF\0'), 0x49, 0x49, 0x2a, 0]);
export const iptcSegment = (): Uint8Array =>
  segment(0xed, [...text('Photoshop 3.0\0'), ...text('8BIM'), 4, 4, 0, 0, 0, 0, 0, 0]);

/** The picture's own data: stuffed bytes, a restart marker, and its end. */
export const SCAN_DATA = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd9];

/**
 * A JPEG `width` by `height`, its `head` segments before its frame, and `trailing` after its end.
 */
export function jpeg(
  width: number,
  height: number,
  head: readonly Uint8Array[] = [],
  trailing: readonly number[] = [],
): Uint8Array<ArrayBuffer> {
  const frame = segment(0xc0, [
    8,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    1,
    1,
    0x11,
    0,
  ]);
  const scan = segment(0xda, [1, 1, 0, 0, 63, 0]);
  const parts = [new Uint8Array([0xff, 0xd8]), ...head, frame, scan, new Uint8Array(SCAN_DATA)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0) + trailing.length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  out.set(trailing, at);
  return out;
}

/** The latitude a photo's GPS block holds: rationals easy to find again in the bytes. */
export const LATITUDE = [51, 1, 30, 1, 264, 10];

/** A phone's EXIF: its orientation, a GPS block, the maker's notes and the pixel size. */
export function phoneExif(
  orientation: number,
  options: { readonly little?: boolean; readonly thumbnail?: boolean } = {},
): Uint8Array {
  return exifSegment(
    tiff(
      {
        ifd0: [
          { tag: 0x010f, value: { ascii: 'Fictional' } },
          { tag: 0x0112, value: { short: [orientation] } },
          { tag: 0x8769, value: { ifd: 'exif' } },
          { tag: 0x8825, value: { ifd: 'gps' } },
        ],
        ...(options.thumbnail
          ? {
              ifd1: [
                { tag: 0x0201, value: { long: [0] } },
                { tag: 0x0202, value: { long: [0] } },
              ],
            }
          : {}),
        exif: [
          { tag: 0x9003, value: { ascii: '2026:11:26 09:41:00' } },
          { tag: 0x927c, value: { undefined: new Uint8Array(text('MAKER NOTE: 51.507,-0.127')) } },
          { tag: 0xa002, value: { long: [4000] } },
          { tag: 0xa003, value: { long: [3000] } },
        ],
        gps: [
          { tag: 0x0001, value: { ascii: 'N' } },
          { tag: 0x0002, value: { rational: LATITUDE } },
          { tag: 0x0003, value: { ascii: 'W' } },
          { tag: 0x0004, value: { rational: [0, 1, 7, 1, 39, 1] } },
        ],
      },
      options.little ?? true,
    ),
  );
}

/** Whether `needle` is anywhere in `haystack`. */
export function contains(haystack: Uint8Array, needle: Uint8Array | string): boolean {
  const bytes = typeof needle === 'string' ? new Uint8Array(text(needle)) : needle;
  outer: for (let i = 0; i + bytes.length <= haystack.length; i += 1) {
    for (let j = 0; j < bytes.length; j += 1) if (haystack[i + j] !== bytes[j]) continue outer;
    return true;
  }
  return false;
}

/** The latitude's rationals as a little-endian GPS block holds them. */
export function latitudeBytes(little = true): Uint8Array {
  const bytes = new Uint8Array(LATITUDE.length * 4);
  const view = new DataView(bytes.buffer);
  LATITUDE.forEach((part, index) => view.setUint32(index * 4, part, little));
  return bytes;
}

/**
 * A value of the first EXIF segment's Exif IFD, by its tag: a SHORT or a LONG, read here apart
 * from `photo-metadata.ts`. `null` when there is none.
 */
export function exifIfdValue(bytes: Uint8Array, tag: number): number | null {
  for (let at = 2; at + 4 < bytes.length;) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (marker === 0xda) return null;
    const body = bytes.subarray(at + 4, at + 2 + length);
    if (marker === 0xe1 && String.fromCharCode(...body.subarray(0, 4)) === 'Exif') {
      const tiff = body.subarray(6);
      const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
      const little = tiff[0] === 0x49;
      const ifd = (offset: number, wanted: number): { type: number; field: number } | null => {
        const count = view.getUint16(offset, little);
        for (let index = 0; index < count; index += 1) {
          const entry = offset + 2 + index * 12;
          if (view.getUint16(entry, little) === wanted)
            return { type: view.getUint16(entry + 2, little), field: entry + 8 };
        }
        return null;
      };
      const pointer = ifd(view.getUint32(4, little), 0x8769);
      if (!pointer) return null;
      const found = ifd(view.getUint32(pointer.field, little), tag);
      if (!found) return null;
      return found.type === 3
        ? view.getUint16(found.field, little)
        : view.getUint32(found.field, little);
    }
    at += 2 + length;
  }
  return null;
}
