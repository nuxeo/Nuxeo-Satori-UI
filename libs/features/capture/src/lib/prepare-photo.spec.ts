import type { PhotoCodec, PhotoDrawing } from './photo-codec';
import {
  contains,
  exifIfdValue,
  iccSegment,
  jfifSegment,
  jpeg,
  latitudeBytes,
  phoneExif,
  xmpSegment,
} from './photo-fixtures.testing';
import { locationCarriers, readJpegLayout, readOrientation } from './photo-metadata';
import {
  CAPTURE_MAX_BYTES,
  CAPTURE_MAX_EDGE,
  PhotoRefused,
  preparePhoto,
  type PhotoRefusal,
} from './prepare-photo';

const bytesOf = async (file: Blob): Promise<Uint8Array> => new Uint8Array(await file.arrayBuffer());

/**
 * A codec as the browser's would be, without a canvas: it records what it was given, and draws a
 * JPEG of the size asked for, as a canvas does, with a JFIF segment and no metadata.
 */
function standInCodec(
  options: {
    readonly measured?: { width: number; height: number };
    readonly draws?: Uint8Array;
  } = {},
) {
  const drawn: { source: Uint8Array; drawing: PhotoDrawing }[] = [];
  const measured: Blob[] = [];
  const codec: PhotoCodec = {
    measure: async (source) => {
      measured.push(source);
      if (!options.measured) throw new Error('not a picture');
      return options.measured;
    },
    draw: async (source, drawing) => {
      drawn.push({ source: await bytesOf(source), drawing });
      return new Blob([options.draws ?? jpeg(drawing.width, drawing.height, [jfifSegment()])], {
        type: 'image/jpeg',
      });
    },
  };
  return { codec, drawn, measured };
}

const photoFile = (bytes: Uint8Array, name = 'image.jpg', type = 'image/jpeg') =>
  new File([bytes as Uint8Array<ArrayBuffer>], name, { type });

/** A phone's photo, `width` by `height` as stored, with its orientation, GPS block and XMP. */
const phonePhoto = (width: number, height: number, orientation: number) =>
  jpeg(
    width,
    height,
    [jfifSegment(), phoneExif(orientation), iccSegment(), xmpSegment()],
    [1, 2, 3],
  );

async function refusal(promise: Promise<unknown>): Promise<PhotoRefusal | 'resolved' | 'other'> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof PhotoRefused ? error.reason : 'other';
  }
}

describe('preparePhoto: a JPEG small enough', () => {
  it('is uploaded as it is, under its new name, with its location taken out', async () => {
    const original = phonePhoto(1200, 900, 6);
    const { codec, drawn } = standInCodec();
    const prepared = await preparePhoto(
      photoFile(original),
      { name: 'DC-3003-photo-1', keepLocation: false },
      codec,
    );
    const out = await bytesOf(prepared.file);
    expect(drawn).toHaveLength(0);
    expect(prepared).toMatchObject({
      width: 900,
      height: 1200,
      downscaled: false,
      location: 'removed',
    });
    expect(prepared.file.name).toBe('DC-3003-photo-1.jpg');
    expect(prepared.file.type).toBe('image/jpeg');
    expect(locationCarriers(out)).toEqual([]);
    expect(contains(out, latitudeBytes())).toBe(false);
    expect(readOrientation(out)).toBe(6);
  });

  it('says it had no location when it had none', async () => {
    const prepared = await preparePhoto(
      photoFile(jpeg(800, 600, [jfifSegment()])),
      { name: 'p', keepLocation: false },
      standInCodec().codec,
    );
    expect(prepared.location).toBe('none');
  });

  it('is left byte for byte as it came when the layout keeps the location', async () => {
    const original = phonePhoto(1200, 900, 1);
    const prepared = await preparePhoto(
      photoFile(original),
      { name: 'p', keepLocation: true },
      standInCodec().codec,
    );
    expect(await bytesOf(prepared.file)).toEqual(original);
    expect(prepared.location).toBe('kept');
  });
});

describe('preparePhoto: a JPEG larger than the longest side', () => {
  it('is drawn down, turned upright by its orientation, from its picture with no EXIF', async () => {
    const { codec, drawn } = standInCodec();
    const prepared = await preparePhoto(
      photoFile(phonePhoto(4000, 3000, 6)),
      { name: 'p', keepLocation: false },
      codec,
    );
    expect(drawn).toHaveLength(1);
    // Stored 4000 by 3000 on its side: upright 3000 by 4000, drawn down to 2304 by 3072.
    expect(drawn[0].drawing).toEqual({
      orientation: 6,
      width: 2304,
      height: CAPTURE_MAX_EDGE,
      type: 'image/jpeg',
      quality: 0.9,
    });
    // The canvas is given no EXIF, so that only the drawing turns the picture.
    expect(contains(drawn[0].source, 'Exif\0\0')).toBe(false);
    const out = await bytesOf(prepared.file);
    expect(prepared).toMatchObject({
      width: 2304,
      height: 3072,
      downscaled: true,
      location: 'removed',
    });
    expect(readJpegLayout(out)).toMatchObject({ width: 2304, height: 3072 });
    // The original's EXIF goes back on, upright and without its location.
    expect(readOrientation(out)).toBe(1);
    expect(exifIfdValue(out, 0xa002)).toBe(2304);
    expect(contains(out, '2026:11:26 09:41:00')).toBe(true);
    expect(locationCarriers(out)).toEqual([]);
    expect(contains(out, latitudeBytes())).toBe(false);
  });

  it('keeps its GPS block, on the drawn picture, when the layout keeps the location', async () => {
    const prepared = await preparePhoto(
      photoFile(phonePhoto(6000, 4000, 1)),
      { name: 'p', keepLocation: true },
      standInCodec().codec,
    );
    const out = await bytesOf(prepared.file);
    expect(prepared).toMatchObject({
      width: 3072,
      height: 2048,
      downscaled: true,
      location: 'kept',
    });
    expect(locationCarriers(out)).toContain('gps');
    expect(contains(out, latitudeBytes())).toBe(true);
  });

  it('is refused, not sent, when what the canvas drew carries a location', async () => {
    // The page's own check of what it uploads: a canvas that wrote XMP would be caught here.
    const leaky = jpeg(2304, 3072, [jfifSegment(), xmpSegment()]);
    const { codec } = standInCodec({ draws: leaky });
    expect(
      await refusal(
        preparePhoto(
          photoFile(phonePhoto(4000, 3000, 6)),
          { name: 'p', keepLocation: false },
          codec,
        ),
      ),
    ).toBe('location');
  });

  it('is refused as unreadable when the canvas cannot draw it', async () => {
    const codec: PhotoCodec = {
      measure: async () => ({ width: 1, height: 1 }),
      draw: async () => {
        throw new Error('the canvas encoded nothing');
      },
    };
    expect(
      await refusal(
        preparePhoto(
          photoFile(phonePhoto(4000, 3000, 1)),
          { name: 'p', keepLocation: false },
          codec,
        ),
      ),
    ).toBe('unreadable');
  });
});

describe('preparePhoto: another format', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it('is drawn anew as a JPEG, which says nothing of a place, turned as its format says', async () => {
    const { codec, drawn } = standInCodec({ measured: { width: 5000, height: 2500 } });
    const prepared = await preparePhoto(
      photoFile(png, 'screen.png', 'image/png'),
      { name: 'DC-1-photo-2', keepLocation: false },
      codec,
    );
    expect(drawn[0].drawing).toMatchObject({ orientation: 1, width: 3072, height: 1536 });
    expect(prepared.file.name).toBe('DC-1-photo-2.jpg');
    expect(prepared.file.type).toBe('image/jpeg');
    expect(prepared).toMatchObject({ downscaled: true, location: 'removed' });
  });

  it('goes as it came, under its own extension, when the layout keeps the location', async () => {
    const { codec, drawn } = standInCodec({ measured: { width: 5000, height: 2500 } });
    const prepared = await preparePhoto(
      photoFile(png, 'IMG_1.HEIC', 'image/heic'),
      { name: 'p', keepLocation: true },
      codec,
    );
    expect(drawn).toHaveLength(0);
    expect(await bytesOf(prepared.file)).toEqual(png);
    expect(prepared.file.name).toBe('p.heic');
    expect(prepared.location).toBe('kept');
  });

  it('is refused when the browser cannot read it as a picture', async () => {
    const { codec } = standInCodec();
    expect(
      await refusal(
        preparePhoto(
          photoFile(png, 'x.png', 'image/png'),
          { name: 'p', keepLocation: false },
          codec,
        ),
      ),
    ).toBe('unreadable');
  });
});

it('refuses a file larger than the page reads, without reading it', async () => {
  const arrayBuffer = vi.fn();
  const huge = {
    size: CAPTURE_MAX_BYTES + 1,
    name: 'x.jpg',
    type: 'image/jpeg',
    arrayBuffer,
  } as unknown as File;
  expect(
    await refusal(preparePhoto(huge, { name: 'p', keepLocation: false }, standInCodec().codec)),
  ).toBe('too-large');
  expect(arrayBuffer).not.toHaveBeenCalled();
});
