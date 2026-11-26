/**
 * A JPEG photo's own bytes, read and rewritten without decoding its picture: how it is laid out,
 * which way up it is seen (its EXIF orientation), and where it says it was taken.
 *
 * A phone's camera can write where a photo was taken in four places, and each is handled here:
 *
 * - **EXIF's GPS block,** the IFD the `GPSInfo` tag (0x8825) points to: latitude, longitude,
 *   altitude, and the time and direction of the fix;
 * - **the camera maker's notes,** EXIF's `MakerNote` (0x927C), laid out as each maker likes and
 *   filled by some with a location too, so that it cannot be read for one;
 * - **XMP packets,** APP1 segments that can repeat the GPS fields or name the place;
 * - **IPTC,** in a Photoshop APP13 segment, which can name a city, a region and a country;
 *
 * and in a fifth a phone may put another picture with its own metadata: **after the picture's
 * end,** as a gain map or a depth map is, which a Multi-Picture Format (MPF) APP2 segment indexes.
 *
 * Nothing here decodes a picture: the canvas does that (`photo-codec.ts`). What `prepare-photo.ts`
 * makes of a photo is read back with {@link locationCarriers}, so that a photo is uploaded only
 * once it is seen to carry none. Every read is held to its segment's bounds: EXIF that points
 * outside itself is unreadable, and is never read past its end.
 */

/** Where a photo can say where it was taken, as {@link locationCarriers} finds them. */
export type LocationCarrier =
  'gps' | 'maker-note' | 'xmp' | 'iptc' | 'trailing' | 'unreadable-exif';

/** One marker segment before the picture's data: its marker and where it is, `end` exclusive. */
export interface JpegSegment {
  readonly marker: number;
  readonly start: number;
  readonly end: number;
}

/** How a JPEG is laid out. */
export interface JpegLayout {
  /** The marker segments from the start of image to the first scan, in order. */
  readonly segments: readonly JpegSegment[];
  /** From the first scan's header to just past the end of image marker. */
  readonly scan: { readonly start: number; readonly end: number };
  /** Whether anything but zero padding follows the end of image. */
  readonly trailing: boolean;
  /** The picture's size as stored, before its orientation turns it. */
  readonly width: number;
  readonly height: number;
}

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP13 = 0xed;

const EXIF_HEADER: readonly number[] = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const XMP_HEADERS: readonly string[] = [
  'http://ns.adobe.com/xap/1.0/\u0000',
  'http://ns.adobe.com/xmp/extension/\u0000',
];
const MPF_HEADER: readonly number[] = [0x4d, 0x50, 0x46, 0x00]; // "MPF\0"

const TAG_ORIENTATION = 0x0112;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_MAKER_NOTE = 0x927c;
const TAG_PIXEL_X = 0xa002;
const TAG_PIXEL_Y = 0xa003;

/** The bytes one value of each TIFF type takes, by its number. A type not listed is unreadable. */
const TYPE_SIZES: Readonly<Record<number, number>> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
  13: 4, // IFD
};

/** EXIF that points outside its segment, or that is not EXIF as the standard writes it. */
class UnreadableExif extends Error {}

/** Whether `bytes` start as a JPEG does, with its start of image marker. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === SOI;
}

/**
 * How `bytes` are laid out as a JPEG: `null` for bytes that are not one, or one that ends before
 * its picture does. Every segment's length is held to the bytes there are.
 */
export function readJpegLayout(bytes: Uint8Array): JpegLayout | null {
  if (!isJpeg(bytes)) return null;
  const segments: JpegSegment[] = [];
  let width = 0;
  let height = 0;
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    let m = at + 1;
    // Any number of 0xFF fill bytes may come before a marker.
    while (m < bytes.length && bytes[m] === 0xff) m += 1;
    if (m >= bytes.length) return null;
    const marker = bytes[m];
    if (marker === EOI) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at = m + 1;
      continue;
    }
    if (m + 2 >= bytes.length) return null;
    const length = (bytes[m + 1] << 8) | bytes[m + 2];
    const end = m + 1 + length;
    if (length < 2 || end > bytes.length) return null;
    if (isStartOfFrame(marker) && length >= 7) {
      height = (bytes[m + 4] << 8) | bytes[m + 5];
      width = (bytes[m + 6] << 8) | bytes[m + 7];
    }
    if (marker === SOS) {
      const close = endOfImage(bytes, end);
      if (close === null || width === 0 || height === 0) return null;
      const trailing = bytes.subarray(close).some((byte) => byte !== 0);
      return { segments, scan: { start: at, end: close }, trailing, width, height };
    }
    segments.push({ marker, start: at, end });
    at = end;
  }
  return null;
}

/** SOF0 to SOF15, but for DHT (C4), JPG (C8) and DAC (CC), which share the range. */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * Where the picture ends, just past its end of image marker, read on from a scan's header: its
 * entropy-coded data, with its stuffed bytes and restart markers, and in a progressive JPEG the
 * tables and scans between. `null` when the bytes end first.
 */
function endOfImage(bytes: Uint8Array, from: number): number | null {
  let i = from;
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const next = bytes[i + 1];
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) i += 2;
    else if (next === 0xff) i += 1;
    else if (next === EOI) return i + 2;
    else {
      if (i + 3 >= bytes.length) return null;
      const length = (bytes[i + 2] << 8) | bytes[i + 3];
      if (length < 2) return null;
      i += 2 + length;
    }
  }
  return null;
}

function startsWith(bytes: Uint8Array, at: number, prefix: readonly number[]): boolean {
  if (at + prefix.length > bytes.length) return false;
  return prefix.every((byte, index) => bytes[at + index] === byte);
}

const codes = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

/** Where a segment's data starts: past its marker and its two length bytes. */
const dataOf = (segment: JpegSegment): number => segment.start + 4;

function isExif(bytes: Uint8Array, segment: JpegSegment): boolean {
  return segment.marker === APP1 && startsWith(bytes, dataOf(segment), EXIF_HEADER);
}

function isXmp(bytes: Uint8Array, segment: JpegSegment): boolean {
  return (
    segment.marker === APP1 &&
    XMP_HEADERS.some((header) => startsWith(bytes, dataOf(segment), codes(header)))
  );
}

function isMpf(bytes: Uint8Array, segment: JpegSegment): boolean {
  return segment.marker === APP2 && startsWith(bytes, dataOf(segment), MPF_HEADER);
}

interface IfdEntry {
  readonly tag: number;
  readonly type: number;
  readonly count: number;
  /** Where its four-byte value field is. */
  readonly field: number;
}

/**
 * One EXIF segment's TIFF structure, over the segment's bytes, marker included, which every
 * change below writes to: give it a copy. Offsets are from the TIFF header, as EXIF writes them,
 * and each is held to the segment.
 */
class Tiff {
  private readonly view: DataView;
  private readonly little: boolean;
  /** Where the TIFF header is: past the marker, the length and "Exif\0\0". */
  private readonly base = 4 + EXIF_HEADER.length;
  private readonly size: number;

  constructor(private readonly bytes: Uint8Array) {
    this.size = bytes.length - this.base;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (this.size < 8) throw new UnreadableExif('no TIFF header');
    const order = this.view.getUint16(this.base, false);
    if (order === 0x4949) this.little = true;
    else if (order === 0x4d4d) this.little = false;
    else throw new UnreadableExif('no byte order');
    if (this.u16(2) !== 42) throw new UnreadableExif('not TIFF');
  }

  private check(offset: number, length: number): void {
    if (!Number.isInteger(offset) || offset < 0 || length < 0 || offset + length > this.size)
      throw new UnreadableExif('an offset outside the segment');
  }

  u16(offset: number): number {
    this.check(offset, 2);
    return this.view.getUint16(this.base + offset, this.little);
  }

  u32(offset: number): number {
    this.check(offset, 4);
    return this.view.getUint32(this.base + offset, this.little);
  }

  set16(offset: number, value: number): void {
    this.check(offset, 2);
    this.view.setUint16(this.base + offset, value, this.little);
  }

  set32(offset: number, value: number): void {
    this.check(offset, 4);
    this.view.setUint32(this.base + offset, value, this.little);
  }

  zero(offset: number, length: number): void {
    this.check(offset, length);
    this.bytes.fill(0, this.base + offset, this.base + offset + length);
  }

  /** IFD0's offset: the main picture's. */
  first(): number {
    return this.u32(4);
  }

  /** An IFD's entries, and where the offset of the IFD after it is. */
  ifd(offset: number): { readonly entries: readonly IfdEntry[]; readonly next: number } {
    const count = this.u16(offset);
    this.check(offset + 2, count * 12 + 4);
    const entries: IfdEntry[] = [];
    for (let index = 0; index < count; index += 1) {
      const at = offset + 2 + index * 12;
      entries.push({
        tag: this.u16(at),
        type: this.u16(at + 2),
        count: this.u32(at + 4),
        field: at + 8,
      });
    }
    return { entries, next: offset + 2 + count * 12 };
  }

  /** Where an entry's value is, and how many bytes it takes: in its own field, up to four. */
  value(entry: IfdEntry): { readonly offset: number; readonly length: number } {
    const size = TYPE_SIZES[entry.type];
    if (size === undefined) throw new UnreadableExif(`an unknown type, ${entry.type}`);
    const length = size * entry.count;
    const offset = length <= 4 ? entry.field : this.u32(entry.field);
    this.check(offset, length);
    return { offset, length };
  }

  /** Takes `tag` out of the IFD at `offset`: the entries after it move up, and the count drops. */
  remove(offset: number, tag: number): void {
    const { entries, next } = this.ifd(offset);
    const index = entries.findIndex((entry) => entry.tag === tag);
    if (index < 0) return;
    const nextIfd = this.u32(next);
    const from = this.base + offset + 2 + (index + 1) * 12;
    const to = this.base + offset + 2 + entries.length * 12;
    this.bytes.copyWithin(from - 12, from, to);
    this.set16(offset, entries.length - 1);
    const moved = offset + 2 + (entries.length - 1) * 12;
    this.set32(moved, nextIfd);
    this.zero(moved + 4, 12);
  }

  /** Zeroes an IFD, and every value it holds outside its entries. */
  wipe(offset: number): void {
    const { entries, next } = this.ifd(offset);
    for (const entry of entries) {
      const { offset: at, length } = this.value(entry);
      if (at !== entry.field) this.zero(at, length);
    }
    this.zero(offset, next + 4 - offset);
  }

  /** The IFD an entry of the IFD at `offset` points to; `null` when it has none, or points to 0. */
  pointer(offset: number, tag: number): number | null {
    const entry = this.ifd(offset).entries.find((each) => each.tag === tag);
    if (!entry) return null;
    const pointed = this.u32(entry.field);
    return pointed === 0 ? null : pointed;
  }

  /** IFD0, and IFD1 when there is one: where a GPS block's pointer may be. */
  main(): number[] {
    const first = this.first();
    const second = this.u32(this.ifd(first).next);
    return second === 0 ? [first] : [first, second];
  }
}

/** The EXIF orientation in IFD0, 1 to 8: 1 when it has none, or one out of range. */
function orientationIn(tiff: Tiff): number {
  const entry = tiff.ifd(tiff.first()).entries.find((each) => each.tag === TAG_ORIENTATION);
  if (!entry || entry.type !== 3 || entry.count < 1) return 1;
  const value = tiff.u16(entry.field);
  return value >= 1 && value <= 8 ? value : 1;
}

/** Takes the GPS block and the maker's notes out of one EXIF segment. */
function stripExif(tiff: Tiff): void {
  for (const ifd of tiff.main()) {
    const gps = tiff.pointer(ifd, TAG_GPS_IFD);
    if (gps !== null) tiff.wipe(gps);
    tiff.remove(ifd, TAG_GPS_IFD);
  }
  const exif = tiff.pointer(tiff.first(), TAG_EXIF_IFD);
  if (exif === null) return;
  const note = tiff.ifd(exif).entries.find((entry) => entry.tag === TAG_MAKER_NOTE);
  if (!note) return;
  const { offset, length } = tiff.value(note);
  tiff.zero(offset, length);
  tiff.remove(exif, TAG_MAKER_NOTE);
}

/** What one EXIF segment carries of a location. */
function exifCarriers(tiff: Tiff): LocationCarrier[] {
  const found: LocationCarrier[] = [];
  const gps = tiff
    .main()
    .some((ifd) => tiff.ifd(ifd).entries.some((entry) => entry.tag === TAG_GPS_IFD));
  if (gps) found.push('gps');
  const exif = tiff.pointer(tiff.first(), TAG_EXIF_IFD);
  if (exif !== null && tiff.ifd(exif).entries.some((entry) => entry.tag === TAG_MAKER_NOTE))
    found.push('maker-note');
  return found;
}

function copyOf(bytes: Uint8Array, segment: JpegSegment): Uint8Array<ArrayBuffer> {
  return bytes.slice(segment.start, segment.end);
}

/**
 * Every place a JPEG carries, or may carry, where it was taken: an EXIF GPS block, the maker's
 * notes, an XMP or an IPTC segment, or data after the picture's end. EXIF that cannot be read is
 * `unreadable-exif`, since what it holds cannot be told. Empty for a photo that says nowhere, and
 * `null` for bytes that are not a readable JPEG.
 */
export function locationCarriers(bytes: Uint8Array): readonly LocationCarrier[] | null {
  const layout = readJpegLayout(bytes);
  if (!layout) return null;
  const found = new Set<LocationCarrier>();
  for (const segment of layout.segments) {
    if (isExif(bytes, segment)) {
      try {
        for (const carrier of exifCarriers(new Tiff(copyOf(bytes, segment)))) found.add(carrier);
      } catch {
        found.add('unreadable-exif');
      }
    } else if (isXmp(bytes, segment)) found.add('xmp');
    else if (segment.marker === APP13) found.add('iptc');
  }
  if (layout.trailing) found.add('trailing');
  return [...found];
}

/** The photo's EXIF orientation, 1 to 8, from its first EXIF segment: 1 when it says none. */
export function readOrientation(bytes: Uint8Array): number {
  const layout = readJpegLayout(bytes);
  const segment = layout?.segments.find((each) => isExif(bytes, each));
  if (!segment) return 1;
  try {
    return orientationIn(new Tiff(copyOf(bytes, segment)));
  } catch {
    return 1;
  }
}

/** Whether an EXIF orientation turns the picture a quarter, so that its width and height swap. */
export function swapsSides(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

/** A JPEG of `head`'s segments and `layout`'s scan, after a start of image marker. */
function assemble(
  bytes: Uint8Array,
  layout: JpegLayout,
  head: readonly Uint8Array[],
): Uint8Array<ArrayBuffer> {
  const scan = bytes.subarray(layout.scan.start, layout.scan.end);
  const parts = [...head, scan];
  const out = new Uint8Array(2 + parts.reduce((sum, part) => sum + part.length, 0));
  out[0] = 0xff;
  out[1] = SOI;
  let at = 2;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * The photo with nothing left of where it was taken: its EXIF GPS block and maker's notes zeroed
 * and unlinked, and every XMP and IPTC segment, anything after the picture's end and the MPF index
 * of it left out. The rest of its EXIF stays, its orientation and the time it was taken among it,
 * and so do its other segments, its colour profile among them, and its picture, byte for byte.
 * EXIF that cannot be read is left out whole. `null` for bytes that are not a readable JPEG.
 */
export function stripJpegLocation(bytes: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const layout = readJpegLayout(bytes);
  if (!layout) return null;
  const head: Uint8Array[] = [];
  for (const segment of layout.segments) {
    if (isXmp(bytes, segment) || segment.marker === APP13 || isMpf(bytes, segment)) continue;
    if (!isExif(bytes, segment)) {
      head.push(bytes.subarray(segment.start, segment.end));
      continue;
    }
    const copy = copyOf(bytes, segment);
    try {
      stripExif(new Tiff(copy));
      head.push(copy);
    } catch {
      // Left out: what EXIF that cannot be read holds cannot be told, so it is not sent. Its
      // orientation, when that much of it can be read, goes on in an EXIF segment of its own.
      const orientation = orientationOf(segment, bytes);
      if (orientation !== 1) head.push(orientationExif(orientation));
    }
  }
  return assemble(bytes, layout, head);
}

function orientationOf(segment: JpegSegment, bytes: Uint8Array): number {
  try {
    return orientationIn(new Tiff(copyOf(bytes, segment)));
  } catch {
    return 1;
  }
}

/** An EXIF segment that says one thing, `orientation`: an IFD0 with that one entry. */
export function orientationExif(orientation: number): Uint8Array<ArrayBuffer> {
  const segment = new Uint8Array(36);
  const view = new DataView(segment.buffer);
  view.setUint16(0, 0xff00 | APP1);
  view.setUint16(2, segment.length - 2);
  segment.set(EXIF_HEADER, 4);
  const tiff = 4 + EXIF_HEADER.length;
  view.setUint16(tiff, 0x4d4d); // "MM", big-endian
  view.setUint16(tiff + 2, 42);
  view.setUint32(tiff + 4, 8); // IFD0, right after the header
  view.setUint16(tiff + 8, 1); // one entry
  view.setUint16(tiff + 10, TAG_ORIENTATION);
  view.setUint16(tiff + 12, 3); // SHORT
  view.setUint32(tiff + 14, 1);
  view.setUint16(tiff + 18, orientation);
  view.setUint32(tiff + 22, 0); // no IFD after it
  return segment;
}

/** The photo with no EXIF segment: what the canvas draws, so that only this module turns it. */
export function withoutExif(bytes: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const layout = readJpegLayout(bytes);
  if (!layout) return null;
  const head = layout.segments
    .filter((segment) => !isExif(bytes, segment))
    .map((segment) => bytes.subarray(segment.start, segment.end));
  return assemble(bytes, layout, head);
}

/**
 * The first EXIF segment of `original`, made fit for its picture drawn upright at `width` by
 * `height`: orientation 1, the pixel dimensions given, and no thumbnail, whose picture would be
 * the old way up; and, unless `keepLocation`, no GPS block and no maker's notes. `null` when the
 * original has no EXIF, or EXIF that cannot be read.
 */
export function uprightExif(
  original: Uint8Array,
  width: number,
  height: number,
  keepLocation: boolean,
): Uint8Array<ArrayBuffer> | null {
  const layout = readJpegLayout(original);
  const segment = layout?.segments.find((each) => isExif(original, each));
  if (!segment) return null;
  const copy = copyOf(original, segment);
  try {
    const tiff = new Tiff(copy);
    if (!keepLocation) stripExif(tiff);
    const first = tiff.first();
    const orientation = tiff.ifd(first).entries.find((entry) => entry.tag === TAG_ORIENTATION);
    if (orientation && orientation.type === 3 && orientation.count >= 1)
      tiff.set16(orientation.field, 1);
    // The thumbnail is IFD1's: unlinked, so that no reader shows it the old way up.
    tiff.set32(tiff.ifd(first).next, 0);
    const exif = tiff.pointer(first, TAG_EXIF_IFD);
    if (exif !== null) {
      for (const entry of tiff.ifd(exif).entries) {
        const side = entry.tag === TAG_PIXEL_X ? width : entry.tag === TAG_PIXEL_Y ? height : null;
        if (side === null || entry.count !== 1) continue;
        if (entry.type === 3) tiff.set16(entry.field, Math.min(side, 0xffff));
        else if (entry.type === 4) tiff.set32(entry.field, side);
      }
    }
    return copy;
  } catch {
    return null;
  }
}

/**
 * `jpeg` with `exif` as its one EXIF segment: any it has are left out, and `exif` goes after its
 * JFIF segment when it starts with one, else first. `null` for bytes that are not a readable JPEG.
 */
export function withExif(jpeg: Uint8Array, exif: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const layout = readJpegLayout(jpeg);
  if (!layout) return null;
  const kept = layout.segments.filter((segment) => !isExif(jpeg, segment));
  const head: Uint8Array[] = kept.map((segment) => jpeg.subarray(segment.start, segment.end));
  head.splice(kept[0]?.marker === APP0 ? 1 : 0, 0, exif);
  return assemble(jpeg, layout, head);
}

/**
 * The canvas transform that draws a picture stored `width` by `height` the way its EXIF
 * `orientation` says it is seen, `[a, b, c, d, e, f]` as `CanvasRenderingContext2D.transform`
 * takes them, into a canvas of its upright size: its sides swapped for orientations 5 to 8.
 */
export function orientationTransform(
  orientation: number,
  width: number,
  height: number,
): readonly [number, number, number, number, number, number] {
  switch (orientation) {
    case 2:
      return [-1, 0, 0, 1, width, 0];
    case 3:
      return [-1, 0, 0, -1, width, height];
    case 4:
      return [1, 0, 0, -1, 0, height];
    case 5:
      return [0, 1, 1, 0, 0, 0];
    case 6:
      return [0, 1, -1, 0, height, 0];
    case 7:
      return [0, -1, -1, 0, height, width];
    case 8:
      return [0, -1, 1, 0, 0, width];
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}
