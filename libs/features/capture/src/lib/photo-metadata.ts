/**
 * A JPEG photo's own bytes, read and rewritten without decoding its picture: how it is laid out,
 * which way up it is seen (its EXIF orientation), and where it says it was taken.
 *
 * **What a photo keeps is listed, and nothing else is kept** ({@link stripJpegLocation}): the
 * segments its picture needs to be decoded (frame, Huffman and quantisation tables, restart
 * interval, arithmetic conditioning, the scans), its JFIF header, its colour profile, Adobe's colour
 * transform, and its EXIF, with EXIF's GPS block and the camera maker's notes zeroed and unlinked.
 * Everything else goes, wherever it is, between progressive scans too: XMP and IPTC, which can name
 * the place; comments; the C2PA and JUMBF provenance segments recent phones write, which can repeat
 * the GPS fields; any other application segment; and anything after the picture's end, such as a
 * gain map or a depth map with metadata of its own, with the MPF index of it.
 *
 * **Read back by a stricter rule** ({@link locationCarriers}): any segment that is not on the list
 * is a carrier, as is a GPS pointer in any IFD EXIF reaches, the maker's notes, EXIF that cannot be
 * read, and data after the end. So a carrier the stripping missed is not let through by the check
 * that follows it, which `prepare-photo.ts` makes on every photo before it is uploaded.
 *
 * Nothing here decodes a picture: the canvas does that (`photo-codec.ts`). Every read is held to its
 * segment's bounds: EXIF that points outside itself is unreadable, and is never read past its end.
 * A marker may be preceded by fill bytes (0xFF), as the standard allows; a segment's place is its
 * marker's, so they are dropped when the photo is written again.
 */

/** Where a photo can say where it was taken, as {@link locationCarriers} finds them. */
export type LocationCarrier =
  'gps' | 'maker-note' | 'xmp' | 'iptc' | 'other-segment' | 'trailing' | 'unreadable-exif';

/** One marker segment: its marker, and where it is, from its 0xFF to `end`, exclusive. */
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
  /** The marker segments between the scans, the scans' own headers among them. */
  readonly interior: readonly JpegSegment[];
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
const APP14 = 0xee;

const EXIF_HEADER: readonly number[] = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
/** "Exif\0", and one byte: a writer may pad with another than NUL, as ExifTool accepts. */
const EXIF_SIGNATURE: readonly number[] = EXIF_HEADER.slice(0, 5);
const XMP_SIGNATURES: readonly string[] = [
  'http://ns.adobe.com/xap/1.0/',
  'http://ns.adobe.com/xmp/extension/',
];

const TAG_ORIENTATION = 0x0112;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_INTEROP_IFD = 0xa005;
const TAG_MAKER_NOTE = 0x927c;
const TAG_PIXEL_X = 0xa002;
const TAG_PIXEL_Y = 0xa003;
const TAG_THUMBNAIL = 0x0201;
const TAG_THUMBNAIL_LENGTH = 0x0202;

/** How many IFDs are followed in one EXIF segment: IFD0, IFD1, Exif and Interop, and a margin. */
const MAX_IFDS = 8;

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
 * The marker segment whose 0xFF, or a fill byte before it, is at `at`: its marker and where it
 * ends; a standalone marker (a restart, TEM) ends just past it. `null` when the bytes end first or
 * a length lies.
 */
function markerAt(bytes: Uint8Array, at: number): JpegSegment | null {
  if (bytes[at] !== 0xff) return null;
  let m = at + 1;
  // Any number of 0xFF fill bytes may come before a marker.
  while (m < bytes.length && bytes[m] === 0xff) m += 1;
  if (m >= bytes.length) return null;
  const marker = bytes[m];
  // The segment starts at the 0xFF just before its marker: the fill bytes are not part of it.
  const start = m - 1;
  if (marker === 0x01 || marker === SOI || marker === EOI || (marker >= 0xd0 && marker <= 0xd7))
    return { marker, start, end: m + 1 };
  if (m + 2 >= bytes.length) return null;
  const length = (bytes[m + 1] << 8) | bytes[m + 2];
  const end = m + 1 + length;
  if (length < 2 || end > bytes.length) return null;
  return { marker, start, end };
}

/**
 * How `bytes` are laid out as a JPEG: `null` for bytes that are not one, or one that ends before
 * its picture does. Every segment's length is held to the bytes there are, and every step moves
 * forward, so that a crafted file is read once, never in a loop.
 */
export function readJpegLayout(bytes: Uint8Array): JpegLayout | null {
  if (!isJpeg(bytes)) return null;
  const segments: JpegSegment[] = [];
  let width = 0;
  let height = 0;
  let at = 2;
  while (at < bytes.length) {
    const segment = markerAt(bytes, at);
    if (!segment || segment.marker === EOI || segment.marker === SOI) return null;
    const { marker, start, end } = segment;
    if (end - start <= 2) {
      // A standalone marker before the scan: nothing of it is kept or read.
      at = end;
      continue;
    }
    if (isStartOfFrame(marker) && end - start >= 9) {
      height = (bytes[start + 5] << 8) | bytes[start + 6];
      width = (bytes[start + 7] << 8) | bytes[start + 8];
    }
    if (marker === SOS) {
      if (width === 0 || height === 0) return null;
      const read = readScans(bytes, segment);
      if (!read) return null;
      const trailing = bytes.subarray(read.end).some((byte) => byte !== 0);
      return {
        segments,
        scan: { start, end: read.end },
        interior: read.interior,
        trailing,
        width,
        height,
      };
    }
    segments.push(segment);
    at = end;
  }
  return null;
}

/** SOF0 to SOF15, but for DHT (C4), JPG (C8) and DAC (CC), which share the range. */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * The scans, read on from the first one's header: their entropy-coded data, with its stuffed bytes
 * and restart markers, and every marker segment between them, as a progressive JPEG has its tables
 * and further scans there, up to the end of image. `null` when the bytes end first.
 */
function readScans(
  bytes: Uint8Array,
  first: JpegSegment,
): { readonly end: number; readonly interior: readonly JpegSegment[] } | null {
  const interior: JpegSegment[] = [first];
  let i = first.end;
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const next = bytes[i + 1];
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
      i += 2;
      continue;
    }
    if (next === 0xff) {
      i += 1;
      continue;
    }
    if (next === EOI) return { end: i + 2, interior };
    const segment = markerAt(bytes, i);
    if (!segment || segment.end <= i) return null;
    interior.push(segment);
    i = segment.end;
  }
  return null;
}

function startsWith(bytes: Uint8Array, at: number, prefix: readonly number[]): boolean {
  if (at + prefix.length > bytes.length) return false;
  return prefix.every((byte, index) => bytes[at + index] === byte);
}

const codes = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));
const JFIF = codes('JFIF\0');
const JFXX = codes('JFXX\0');
const ICC = codes('ICC_PROFILE\0');
const ADOBE = codes('Adobe');

/** Where a segment's data starts: past its marker and its two length bytes. */
const dataOf = (segment: JpegSegment): number => segment.start + 4;

function isExif(bytes: Uint8Array, segment: JpegSegment): boolean {
  return (
    segment.marker === APP1 &&
    segment.end - segment.start >= 4 + EXIF_HEADER.length &&
    startsWith(bytes, dataOf(segment), EXIF_SIGNATURE)
  );
}

function isXmp(bytes: Uint8Array, segment: JpegSegment): boolean {
  return (
    segment.marker === APP1 &&
    XMP_SIGNATURES.some((signature) => startsWith(bytes, dataOf(segment), codes(signature)))
  );
}

/** Whether the picture needs the segment to be decoded: a frame, a table, a restart interval. */
function decodes(marker: number): boolean {
  return (
    isStartOfFrame(marker) ||
    marker === 0xc4 || // DHT
    marker === 0xcc || // DAC
    marker === 0xdb || // DQT
    marker === 0xdc || // DNL
    marker === 0xdd || // DRI
    marker === 0xde || // DHP
    marker === 0xdf // EXP
  );
}

/** The metadata kept beside EXIF, which says nothing of a place: JFIF, the colour profile, Adobe's. */
function keptMetadata(bytes: Uint8Array, segment: JpegSegment): boolean {
  const at = dataOf(segment);
  if (segment.marker === APP0) return startsWith(bytes, at, JFIF) || startsWith(bytes, at, JFXX);
  if (segment.marker === APP2) return startsWith(bytes, at, ICC);
  if (segment.marker === APP14) return startsWith(bytes, at, ADOBE);
  return false;
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
  /** Where the TIFF header is: past the marker, the length and "Exif\0" and its pad byte. */
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

  /** A one-number value, a SHORT or a LONG; `null` for another. */
  number(entry: IfdEntry): number | null {
    if (entry.count !== 1) return null;
    if (entry.type === 3) return this.u16(entry.field);
    if (entry.type === 4) return this.u32(entry.field);
    return null;
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

  /** IFD1's offset, the thumbnail's, when IFD0 links one; `null` otherwise. */
  second(): number | null {
    const next = this.u32(this.ifd(this.first()).next);
    return next === 0 ? null : next;
  }

  /**
   * Every IFD the segment reaches, each once: IFD0 and IFD1, and the Exif and Interop IFDs they
   * point to. A GPS pointer may be in any of them, and is looked for in each.
   */
  reached(): number[] {
    const found: number[] = [];
    const queue = [this.first(), this.second()];
    while (queue.length > 0 && found.length < MAX_IFDS) {
      const offset = queue.shift();
      if (offset === null || offset === undefined || found.includes(offset)) continue;
      found.push(offset);
      queue.push(this.pointer(offset, TAG_EXIF_IFD), this.pointer(offset, TAG_INTEROP_IFD));
    }
    return found;
  }
}

/** The EXIF orientation in IFD0, 1 to 8: 1 when it has none, or one out of range. */
function orientationIn(tiff: Tiff): number {
  const entry = tiff.ifd(tiff.first()).entries.find((each) => each.tag === TAG_ORIENTATION);
  if (!entry || entry.type !== 3 || entry.count < 1) return 1;
  const value = tiff.u16(entry.field);
  return value >= 1 && value <= 8 ? value : 1;
}

/** Takes every GPS block, and the maker's notes, out of one EXIF segment. */
function stripExif(tiff: Tiff): void {
  for (const ifd of tiff.reached()) {
    const gps = tiff.pointer(ifd, TAG_GPS_IFD);
    if (gps !== null) {
      // An IFD chained after the GPS block is the block's too, and goes with it.
      const chained = tiff.u32(tiff.ifd(gps).next);
      tiff.wipe(gps);
      if (chained !== 0 && chained !== gps) tiff.wipe(chained);
    }
    tiff.remove(ifd, TAG_GPS_IFD);
    const note = tiff.ifd(ifd).entries.find((entry) => entry.tag === TAG_MAKER_NOTE);
    if (note) {
      const { offset, length } = tiff.value(note);
      tiff.zero(offset, length);
      tiff.remove(ifd, TAG_MAKER_NOTE);
    }
  }
}

/** What one EXIF segment carries of a location: a GPS pointer, or the maker's notes, anywhere. */
function exifCarriers(tiff: Tiff): LocationCarrier[] {
  const found = new Set<LocationCarrier>();
  for (const ifd of tiff.reached()) {
    const tags = tiff.ifd(ifd).entries.map((entry) => entry.tag);
    if (tags.includes(TAG_GPS_IFD)) found.add('gps');
    if (tags.includes(TAG_MAKER_NOTE)) found.add('maker-note');
  }
  return [...found];
}

function copyOf(bytes: Uint8Array, segment: JpegSegment): Uint8Array<ArrayBuffer> {
  return bytes.slice(segment.start, segment.end);
}

/** A carrier for a segment that is not EXIF: XMP, IPTC, or any other that is not on the list. */
function segmentCarrier(bytes: Uint8Array, segment: JpegSegment): LocationCarrier | null {
  if (decodes(segment.marker) || segment.marker === SOS || keptMetadata(bytes, segment))
    return null;
  if (isXmp(bytes, segment)) return 'xmp';
  if (segment.marker === APP13) return 'iptc';
  return 'other-segment';
}

/**
 * Every place a JPEG carries, or may carry, where it was taken: a GPS pointer in any IFD its EXIF
 * reaches, the maker's notes, EXIF that cannot be read, an XMP or an IPTC segment, any segment not
 * on the list of those kept, before the scans or between them, and data after the picture's end.
 * Empty for a photo that says nowhere, and `null` for bytes that are not a readable JPEG.
 */
export function locationCarriers(bytes: Uint8Array): readonly LocationCarrier[] | null {
  const layout = readJpegLayout(bytes);
  if (!layout) return null;
  const found = new Set<LocationCarrier>();
  for (const segment of [...layout.segments, ...layout.interior]) {
    if (isExif(bytes, segment)) {
      try {
        for (const carrier of exifCarriers(new Tiff(copyOf(bytes, segment)))) found.add(carrier);
      } catch {
        found.add('unreadable-exif');
      }
      continue;
    }
    const carrier = segmentCarrier(bytes, segment);
    if (carrier) found.add(carrier);
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

/**
 * A JPEG of `head`'s segments and `layout`'s scans, after a start of image marker. Of what lies
 * between the scans, only what decodes the picture is kept: a scan's header and data, a table.
 */
function assemble(
  bytes: Uint8Array,
  layout: JpegLayout,
  head: readonly Uint8Array[],
): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [...head];
  let at = layout.scan.start;
  for (const segment of layout.interior) {
    if (segment.marker === SOS || decodes(segment.marker)) continue;
    parts.push(bytes.subarray(at, segment.start));
    at = segment.end;
  }
  parts.push(bytes.subarray(at, layout.scan.end));
  const out = new Uint8Array(2 + parts.reduce((sum, part) => sum + part.length, 0));
  out[0] = 0xff;
  out[1] = SOI;
  let position = 2;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}

/** An EXIF segment with its location taken out, its pad byte made NUL; `null` if unreadable. */
function strippedExif(bytes: Uint8Array, segment: JpegSegment): Uint8Array<ArrayBuffer> | null {
  const copy = copyOf(bytes, segment);
  copy[4 + EXIF_HEADER.length - 1] = 0;
  try {
    stripExif(new Tiff(copy));
    return copy;
  } catch {
    return null;
  }
}

/**
 * The photo with nothing left of where it was taken, by the list of what is kept (above): its
 * picture byte for byte, the segments that decode it, JFIF, the colour profile, Adobe's colour
 * transform, and its EXIF with every GPS block and the maker's notes zeroed and unlinked, its
 * orientation and the time it was taken kept. Everything else is left out, anything after the
 * picture's end included. EXIF that cannot be read is left out whole, its orientation kept in an
 * EXIF segment of its own when that much of it can be read. `null` for bytes that are not a
 * readable JPEG.
 */
export function stripJpegLocation(bytes: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const layout = readJpegLayout(bytes);
  if (!layout) return null;
  const head: Uint8Array[] = [];
  for (const segment of layout.segments) {
    if (isExif(bytes, segment)) {
      const stripped = strippedExif(bytes, segment);
      if (stripped) head.push(stripped);
      else {
        // Left out: what EXIF that cannot be read holds cannot be told, so it is not sent. Its
        // orientation, when that much of it can be read, goes on in an EXIF segment of its own.
        const orientation = orientationOf(segment, bytes);
        if (orientation !== 1) head.push(orientationExif(orientation));
      }
    } else if (decodes(segment.marker) || keptMetadata(bytes, segment))
      head.push(bytes.subarray(segment.start, segment.end));
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
 * `height`: orientation 1, the pixel dimensions given, and no thumbnail, whose IFD and picture are
 * zeroed and unlinked, since its picture would be the old way up; and, unless `keepLocation`, no
 * GPS block and no maker's notes. `null` when the original has no EXIF, or EXIF that cannot be
 * read.
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
  copy[4 + EXIF_HEADER.length - 1] = 0;
  try {
    const tiff = new Tiff(copy);
    if (!keepLocation) stripExif(tiff);
    const first = tiff.first();
    const orientation = tiff.ifd(first).entries.find((entry) => entry.tag === TAG_ORIENTATION);
    if (orientation && orientation.type === 3 && orientation.count >= 1)
      tiff.set16(orientation.field, 1);
    const thumbnail = tiff.second();
    if (thumbnail !== null) {
      const entries = tiff.ifd(thumbnail).entries;
      const at = entries.find((entry) => entry.tag === TAG_THUMBNAIL);
      const length = entries.find((entry) => entry.tag === TAG_THUMBNAIL_LENGTH);
      const start = at ? tiff.number(at) : null;
      const size = length ? tiff.number(length) : null;
      if (start !== null && size !== null && size > 0) tiff.zero(start, size);
      tiff.wipe(thumbnail);
    }
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
