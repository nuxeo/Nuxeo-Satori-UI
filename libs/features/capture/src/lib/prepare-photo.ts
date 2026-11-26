import type { PhotoCodec } from './photo-codec';
import {
  locationCarriers,
  readJpegLayout,
  readOrientation,
  stripJpegLocation,
  swapsSides,
  uprightExif,
  withExif,
  withoutExif,
} from './photo-metadata';

/**
 * The longest side a photo is uploaded at, in pixels. A larger one is drawn down to it: a phone's
 * 12-megapixel photo, 4032 by 3024, goes as 3072 by 2304, about seven megapixels, enough to read a
 * scratch or a label on the photo of a damaged item, at about a third of the bytes.
 */
export const CAPTURE_MAX_EDGE = 3072;

/** The JPEG quality a photo drawn anew is encoded at. */
export const CAPTURE_JPEG_QUALITY = 0.9;

/** The largest file the page reads, in bytes: a phone's photo is a few megabytes. */
export const CAPTURE_MAX_BYTES = 50 * 1024 * 1024;

/** What the photo said of where it was taken, and what was done with it. */
export type PhotoLocation =
  /** It said where, and that was taken out. */
  | 'removed'
  /** It said nowhere. */
  | 'none'
  /** The layout keeps it (`keepLocation`), so it was left as it was. */
  | 'kept';

/** A photo made ready to upload. */
export interface PreparedPhoto {
  /** What is uploaded: a JPEG, but for a kept photo in another format, which goes as it came. */
  readonly file: File;
  /** Its size upright, when the page could read it. */
  readonly width: number | null;
  readonly height: number | null;
  /** Whether it was drawn down to {@link CAPTURE_MAX_EDGE}. */
  readonly downscaled: boolean;
  readonly location: PhotoLocation;
}

/** Why a photo is not uploaded. */
export type PhotoRefusal =
  /** Not a picture the browser can read. */
  | 'unreadable'
  /** Larger than {@link CAPTURE_MAX_BYTES}. */
  | 'too-large'
  /** Its location could not be seen to be gone, so it is not sent. */
  | 'location';

export class PhotoRefused extends Error {
  constructor(readonly reason: PhotoRefusal) {
    super(`the photo is refused: ${reason}`);
  }
}

/** How a photo is prepared: the name it goes by, and whether it keeps where it was taken. */
export interface PhotoPreparation {
  /** The file name it is uploaded with, its extension included. */
  readonly name: string;
  readonly keepLocation: boolean;
  readonly maxEdge?: number;
}

/**
 * A photo made ready to file on a record: drawn down to {@link CAPTURE_MAX_EDGE} on its longest
 * side where it is larger, upright as its original's EXIF orientation says, and, unless the
 * layout keeps it, with nothing left of where it was taken.
 *
 * - **A JPEG** small enough keeps its picture byte for byte, and only what `stripJpegLocation`
 *   lists: the segments that decode it, its JFIF header, its colour profile, and its EXIF without
 *   any GPS block or the maker's notes, its orientation tag kept, so that a viewer turns it. One
 *   larger is drawn anew from its picture as stored, turned upright by its orientation on the
 *   canvas, and given its original's EXIF back with orientation 1, since its pixels are now upright,
 *   its new size, and no thumbnail; without the location unless the layout keeps it, and then only
 *   EXIF's: an XMP or IPTC segment does not come across.
 * - **Any other picture** the browser reads, such as a PNG, a HEIC or a WebP, which this page
 *   cannot read the metadata of, is drawn anew as a JPEG, which carries none, turned as its format
 *   says; with `keepLocation`, it is uploaded as it came, at its size.
 *
 * What is uploaded is read back: a JPEG that still carries a location, or may, is refused rather
 * than sent. Rejects with {@link PhotoRefused}.
 */
export async function preparePhoto(
  original: File,
  preparation: PhotoPreparation,
  codec: PhotoCodec,
): Promise<PreparedPhoto> {
  if (original.size > CAPTURE_MAX_BYTES) throw new PhotoRefused('too-large');
  const maxEdge = preparation.maxEdge ?? CAPTURE_MAX_EDGE;
  const bytes = new Uint8Array(await original.arrayBuffer());
  const layout = readJpegLayout(bytes);
  if (!layout) return prepareOther(original, bytes, preparation, maxEdge, codec);

  const orientation = readOrientation(bytes);
  const swap = swapsSides(orientation);
  const width = swap ? layout.height : layout.width;
  const height = swap ? layout.width : layout.height;
  const carried = locationCarriers(bytes) ?? [];
  const location: PhotoLocation = preparation.keepLocation
    ? 'kept'
    : carried.length > 0
      ? 'removed'
      : 'none';

  if (Math.max(width, height) <= maxEdge) {
    const out = preparation.keepLocation ? bytes : stripJpegLocation(bytes);
    if (!out) throw new PhotoRefused('unreadable');
    return {
      file: uploadFile(out, preparation),
      width,
      height,
      downscaled: false,
      location,
    };
  }

  const size = within(width, height, maxEdge);
  const stored = withoutExif(bytes);
  if (!stored) throw new PhotoRefused('unreadable');
  let drawn: Uint8Array<ArrayBuffer>;
  try {
    drawn = new Uint8Array(
      await (
        await codec.draw(new Blob([stored], { type: 'image/jpeg' }), {
          orientation,
          ...size,
          type: 'image/jpeg',
          quality: CAPTURE_JPEG_QUALITY,
        })
      ).arrayBuffer(),
    );
  } catch {
    throw new PhotoRefused('unreadable');
  }
  // A canvas writes little of its own, but what it writes is held to the same list as a photo's.
  const cleaned = preparation.keepLocation ? drawn : stripJpegLocation(drawn);
  const exif = uprightExif(bytes, size.width, size.height, preparation.keepLocation);
  const out = cleaned && exif ? withExif(cleaned, exif) : cleaned;
  if (!out) throw new PhotoRefused('unreadable');
  return {
    file: uploadFile(out, preparation),
    ...size,
    downscaled: true,
    location,
  };
}

/** A picture in a format this page does not read: drawn anew as a JPEG, unless it keeps its place. */
async function prepareOther(
  original: File,
  bytes: Uint8Array<ArrayBuffer>,
  preparation: PhotoPreparation,
  maxEdge: number,
  codec: PhotoCodec,
): Promise<PreparedPhoto> {
  let measured: { readonly width: number; readonly height: number };
  try {
    measured = await codec.measure(original);
  } catch {
    throw new PhotoRefused('unreadable');
  }
  if (preparation.keepLocation) {
    return {
      file: new File([bytes], withExtension(preparation.name, extensionOf(original)), {
        type: original.type,
      }),
      width: measured.width,
      height: measured.height,
      downscaled: false,
      location: 'kept',
    };
  }
  const size = within(measured.width, measured.height, maxEdge);
  let drawn: Uint8Array<ArrayBuffer>;
  try {
    drawn = new Uint8Array(
      await (
        await codec.draw(original, {
          orientation: 1,
          ...size,
          type: 'image/jpeg',
          quality: CAPTURE_JPEG_QUALITY,
        })
      ).arrayBuffer(),
    );
  } catch {
    throw new PhotoRefused('unreadable');
  }
  const cleaned = stripJpegLocation(drawn);
  if (!cleaned) throw new PhotoRefused('unreadable');
  return {
    file: uploadFile(cleaned, preparation),
    ...size,
    downscaled: size.width !== measured.width || size.height !== measured.height,
    // What another format said of a place cannot be read here: drawn anew, it says nothing.
    location: 'removed',
  };
}

/**
 * The upload, as a JPEG named as the preparation says. Unless the layout keeps its location, the
 * bytes are read back first, by `locationCarriers`' stricter rule, and refused if they carry one,
 * or may: a segment not on the list of those kept, a GPS pointer anywhere, data after the end.
 */
export function uploadFile(bytes: Uint8Array<ArrayBuffer>, preparation: PhotoPreparation): File {
  if (!preparation.keepLocation) {
    const carried = locationCarriers(bytes);
    if (carried === null) throw new PhotoRefused('unreadable');
    if (carried.length > 0) throw new PhotoRefused('location');
  }
  return new File([bytes], withExtension(preparation.name, 'jpg'), { type: 'image/jpeg' });
}

/** `width` by `height` drawn down, at its proportions, to `maxEdge` on its longest side. */
function within(
  width: number,
  height: number,
  maxEdge: number,
): { readonly width: number; readonly height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest <= 0) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** A file's extension, lower case, from its name, else from its type; `bin` for neither. */
function extensionOf(file: File): string {
  const named = /\.([A-Za-z0-9]{1,8})$/.exec(file.name)?.[1];
  if (named) return named.toLowerCase();
  const typed = /^image\/([a-z0-9.+-]{1,16})$/.exec(file.type)?.[1];
  return typed ? typed.replace(/[^a-z0-9]/g, '') || 'bin' : 'bin';
}

function withExtension(name: string, extension: string): string {
  return `${name.replace(/\.[A-Za-z0-9]{1,8}$/, '')}.${extension}`;
}
