import {
  SCAN_DATA,
  contains,
  exifIfdValue,
  exifSegment,
  iccSegment,
  iptcSegment,
  jfifSegment,
  jpeg,
  latitudeBytes,
  mpfSegment,
  phoneExif,
  segment,
  tiff,
  xmpSegment,
} from './photo-fixtures.testing';
import {
  isJpeg,
  locationCarriers,
  orientationExif,
  orientationTransform,
  readJpegLayout,
  readOrientation,
  stripJpegLocation,
  swapsSides,
  uprightExif,
  withExif,
  withoutExif,
} from './photo-metadata';

/** A phone's photo: JFIF, its EXIF with a location, an ICC profile, XMP, IPTC, MPF and a gain map. */
const phonePhoto = (orientation = 6, little = true) =>
  jpeg(
    4000,
    3000,
    [
      jfifSegment(),
      phoneExif(orientation, { little, thumbnail: true }),
      iccSegment(),
      xmpSegment(),
      iptcSegment(),
      mpfSegment(),
    ],
    [0xff, 0xd8, 0x47, 0x41, 0x49, 0x4e, 0xff, 0xd9],
  );

const scanOf = (bytes: Uint8Array): Uint8Array => {
  const layout = readJpegLayout(bytes);
  if (!layout) throw new Error('not a JPEG');
  return bytes.slice(layout.scan.start, layout.scan.end);
};

describe('readJpegLayout', () => {
  it('reads the size as stored, each segment before the scan, and where the picture ends', () => {
    const photo = phonePhoto();
    const layout = readJpegLayout(photo);
    expect(layout).not.toBeNull();
    expect(layout?.width).toBe(4000);
    expect(layout?.height).toBe(3000);
    expect(layout?.segments.map((each) => each.marker)).toEqual([
      0xe0, 0xe1, 0xe2, 0xe1, 0xed, 0xe2, 0xc0,
    ]);
    // The scan runs past its stuffed byte and its restart marker to the end of image.
    expect([...photo.slice((layout?.scan.end ?? 0) - 2, layout?.scan.end)]).toEqual([0xff, 0xd9]);
    expect(layout?.trailing).toBe(true);
  });

  it('reads no trailing data in zero padding after the end', () => {
    expect(readJpegLayout(jpeg(10, 10, [], [0, 0, 0]))?.trailing).toBe(false);
  });

  it('refuses what is not a JPEG, and one that ends early or lies about a length', () => {
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(readJpegLayout(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBeNull();
    const whole = jpeg(10, 10);
    expect(readJpegLayout(whole.slice(0, whole.length - 2))).toBeNull();
    const lying = jpeg(10, 10, [segment(0xe1, [1, 2, 3])]);
    lying[5] = 0xff; // the APP1 length now runs past the end
    expect(readJpegLayout(lying)).toBeNull();
    // No frame, so no size: not a picture this page can lay out.
    expect(readJpegLayout(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]))).toBeNull();
  });
});

describe('readOrientation', () => {
  it('reads the EXIF orientation, in either byte order', () => {
    expect(readOrientation(phonePhoto(6))).toBe(6);
    expect(readOrientation(phonePhoto(8, false))).toBe(8);
  });

  it('is 1 with no EXIF, no orientation, one out of range, or EXIF that cannot be read', () => {
    expect(readOrientation(jpeg(10, 10))).toBe(1);
    expect(readOrientation(jpeg(10, 10, [exifSegment(tiff({ ifd0: [] }))]))).toBe(1);
    expect(
      readOrientation(
        jpeg(10, 10, [exifSegment(tiff({ ifd0: [{ tag: 0x0112, value: { short: [9] } }] }))]),
      ),
    ).toBe(1);
    expect(
      readOrientation(
        jpeg(10, 10, [exifSegment(new Uint8Array([0x49, 0x49, 42, 0, 0xff, 0, 0, 0]))]),
      ),
    ).toBe(1);
  });

  it('says which orientations swap the sides', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].filter(swapsSides)).toEqual([5, 6, 7, 8]);
  });
});

describe('locationCarriers', () => {
  it("finds every place a phone's photo says where it was taken", () => {
    expect([...(locationCarriers(phonePhoto()) ?? [])].sort()).toEqual([
      'gps',
      'iptc',
      'maker-note',
      // The MPF index of the gain map: not on the list of what is kept.
      'other-segment',
      'trailing',
      'xmp',
    ]);
  });

  it('finds none in a photo that says nowhere, and none in what is not a JPEG', () => {
    expect(locationCarriers(jpeg(10, 10, [jfifSegment(), iccSegment()]))).toEqual([]);
    expect(locationCarriers(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it('counts EXIF that points outside itself as one that may carry a location', () => {
    const broken = exifSegment(tiff({ ifd0: [{ tag: 0x8825, value: { long: [60_000] } }] }));
    // The pointer itself is a GPS pointer: found. One whose IFD0 is out of range cannot be read.
    expect(locationCarriers(jpeg(10, 10, [broken]))).toEqual(['gps']);
    const unreadable = exifSegment(new Uint8Array([0x49, 0x49, 42, 0, 0x00, 0x10, 0, 0]));
    expect(locationCarriers(jpeg(10, 10, [unreadable]))).toEqual(['unreadable-exif']);
  });
});

describe('stripJpegLocation', () => {
  for (const little of [true, false]) {
    it(`takes out every location, and keeps the rest (${little ? 'little' : 'big'}-endian EXIF)`, () => {
      const photo = phonePhoto(6, little);
      expect(contains(photo, latitudeBytes(little))).toBe(true);
      const out = stripJpegLocation(photo);
      expect(out).not.toBeNull();
      if (!out) return;
      expect(locationCarriers(out)).toEqual([]);
      // Nothing of the latitude, the maker's notes, the XMP, the IPTC or the gain map is left.
      expect(contains(out, latitudeBytes(little))).toBe(false);
      expect(contains(out, 'MAKER NOTE')).toBe(false);
      expect(contains(out, 'GPSLatitude')).toBe(false);
      expect(contains(out, '8BIM')).toBe(false);
      expect(contains(out, 'GAIN')).toBe(false);
      expect(contains(out, 'MPF\0')).toBe(false);
      // The rest stays: the orientation, the camera, the time taken, the colour profile, the
      // JFIF segment, and the picture byte for byte.
      expect(readOrientation(out)).toBe(6);
      expect(contains(out, 'Fictional')).toBe(true);
      expect(contains(out, '2026:11:26 09:41:00')).toBe(true);
      expect(contains(out, 'ICC_PROFILE')).toBe(true);
      expect(contains(out, 'JFIF')).toBe(true);
      expect(scanOf(out)).toEqual(scanOf(photo));
      expect(readJpegLayout(out)?.trailing).toBe(false);
      expect(readJpegLayout(out)).toMatchObject({ width: 4000, height: 3000 });
    });
  }

  it('leaves out EXIF it cannot read, keeping its orientation when that much can be read', () => {
    const exif = exifSegment(
      tiff({
        ifd0: [
          { tag: 0x0112, value: { short: [6] } },
          // An entry of no type TIFF has: the whole segment cannot be read.
          { tag: 0x8825, value: { ifd: 'gps' } },
        ],
        gps: [{ tag: 0x0002, value: { rational: [51, 1, 30, 1, 264, 10] }, type: 99 }],
      }),
    );
    const photo = jpeg(10, 10, [exif]);
    const out = stripJpegLocation(photo);
    expect(out).not.toBeNull();
    if (!out) return;
    expect(locationCarriers(out)).toEqual([]);
    expect(contains(out, latitudeBytes())).toBe(false);
    expect(readOrientation(out)).toBe(6);
  });

  it('refuses what is not a JPEG', () => {
    expect(stripJpegLocation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

describe('what is kept is listed, and nothing else is', () => {
  /** A segment, written with `fill` 0xFF fill bytes before its marker, as the standard allows. */
  const filled = (fill: number, part: Uint8Array): Uint8Array =>
    new Uint8Array([...new Array(fill).fill(0xff), ...part]);
  const PLACE = 'Wharf Lane depot';
  const comment = () => segment(0xfe, new Uint8Array([...PLACE].map((c) => c.charCodeAt(0))));
  const jumbf = () =>
    segment(
      0xeb,
      new Uint8Array([0x4a, 0x50, 0, 1, ...[...'c2pa GPS 51.5'].map((c) => c.charCodeAt(0))]),
    );
  const app3 = () => segment(0xe3, new Uint8Array([...PLACE].map((c) => c.charCodeAt(0))));
  const adobe = () =>
    segment(
      0xee,
      new Uint8Array([...[...'Adobe'].map((c) => c.charCodeAt(0)), 0, 100, 0, 0, 0, 0, 1]),
    );

  it('reads a segment after fill bytes at its marker, and finds and strips it there', () => {
    const photo = jpeg(10, 10, [
      filled(1, phoneExif(6)),
      filled(3, xmpSegment()),
      filled(2, mpfSegment()),
      filled(1, iccSegment()),
    ]);
    expect(readOrientation(photo)).toBe(6);
    expect([...(locationCarriers(photo) ?? [])].sort()).toEqual([
      'gps',
      'maker-note',
      'other-segment',
      'xmp',
    ]);
    const out = stripJpegLocation(photo);
    expect(out && locationCarriers(out)).toEqual([]);
    expect(out && contains(out, latitudeBytes())).toBe(false);
    expect(out && contains(out, 'GPSLatitude')).toBe(false);
    expect(out && readOrientation(out)).toBe(6);
    expect(out && contains(out, 'ICC_PROFILE')).toBe(true);
    // The fill bytes are not written again.
    expect(out && contains(out, new Uint8Array([0xff, 0xff]))).toBe(false);
  });

  it("drops a comment, JUMBF and C2PA, and any other application segment, and keeps Adobe's", () => {
    const photo = jpeg(10, 10, [jfifSegment(), comment(), jumbf(), app3(), adobe()]);
    expect(locationCarriers(photo)).toEqual(['other-segment']);
    const out = stripJpegLocation(photo);
    expect(out && locationCarriers(out)).toEqual([]);
    expect(out && contains(out, PLACE)).toBe(false);
    expect(out && contains(out, 'c2pa')).toBe(false);
    expect(out && contains(out, 'Adobe')).toBe(true);
    expect(out && contains(out, 'JFIF')).toBe(true);
  });

  it('finds XMP written without its NUL, and drops it', () => {
    const bare = segment(
      0xe1,
      new Uint8Array(
        [...'http://ns.adobe.com/xap/1.0/<x:xmpmeta GPS/>'].map((c) => c.charCodeAt(0)),
      ),
    );
    const photo = jpeg(10, 10, [bare]);
    expect(locationCarriers(photo)).toEqual(['xmp']);
    const out = stripJpegLocation(photo);
    expect(out && contains(out, 'xmpmeta')).toBe(false);
  });

  it('reads EXIF padded with another byte than NUL, as ExifTool does, and strips it', () => {
    const exif = phoneExif(6);
    exif[9] = 0x20;
    const photo = jpeg(10, 10, [exif]);
    expect(readOrientation(photo)).toBe(6);
    expect(locationCarriers(photo)).toContain('gps');
    const out = stripJpegLocation(photo);
    expect(out && locationCarriers(out)).toEqual([]);
    expect(out && readOrientation(out)).toBe(6);
  });

  it('finds a GPS pointer in the Exif IFD, not only in IFD0 and IFD1, and strips it', () => {
    const photo = jpeg(10, 10, [
      exifSegment(
        tiff({
          ifd0: [{ tag: 0x8769, value: { ifd: 'exif' } }],
          exif: [{ tag: 0x8825, value: { ifd: 'gps' } }],
          gps: [{ tag: 0x0002, value: { rational: [51, 1, 30, 1, 264, 10] } }],
        }),
      ),
    ]);
    expect(locationCarriers(photo)).toEqual(['gps']);
    const out = stripJpegLocation(photo);
    expect(out && locationCarriers(out)).toEqual([]);
    expect(out && contains(out, latitudeBytes())).toBe(false);
    // And so in the EXIF a photo drawn anew is given back.
    const exif = uprightExif(photo, 10, 10, false);
    expect(exif && contains(exif, latitudeBytes())).toBe(false);
  });

  it('drops what lies between progressive scans but their tables, and keeps the scans', () => {
    // SOI, frame, scan 1 header and data, XMP, a table, scan 2 header and data, end of image.
    const frame = segment(0xc2, [8, 0, 10, 0, 10, 1, 1, 0x11, 0]);
    const scanHeader = segment(0xda, [1, 1, 0, 0, 63, 0]);
    const table = segment(0xc4, [0x00, 1, 2, 3]);
    const photo = new Uint8Array([
      0xff,
      0xd8,
      ...frame,
      ...scanHeader,
      0x11,
      0x22,
      ...xmpSegment(),
      ...comment(),
      ...table,
      ...scanHeader,
      0x33,
      0xff,
      0x00,
      0x44,
      0xff,
      0xd9,
    ]);
    expect([...(locationCarriers(photo) ?? [])].sort()).toEqual(['other-segment', 'xmp']);
    const out = stripJpegLocation(photo);
    expect(out && locationCarriers(out)).toEqual([]);
    expect(out && contains(out, 'GPSLatitude')).toBe(false);
    expect(out && contains(out, PLACE)).toBe(false);
    expect(out && contains(out, table)).toBe(true);
    expect(out && contains(out, new Uint8Array([0x33, 0xff, 0x00, 0x44, 0xff, 0xd9]))).toBe(true);
  });
});

describe('a photo drawn anew', () => {
  it('withoutExif leaves the canvas nothing to turn the picture by', () => {
    const out = withoutExif(phonePhoto(6));
    expect(out).not.toBeNull();
    if (!out) return;
    expect(readOrientation(out)).toBe(1);
    expect(contains(out, 'Exif\0\0')).toBe(false);
    expect(scanOf(out)).toEqual(scanOf(phonePhoto(6)));
  });

  it('uprightExif says orientation 1 and the new size, with no location and no thumbnail', () => {
    const exif = uprightExif(phonePhoto(6), 2304, 3072, false);
    expect(exif).not.toBeNull();
    if (!exif) return;
    const drawn = withExif(jpeg(2304, 3072, [jfifSegment()]), exif);
    expect(drawn).not.toBeNull();
    if (!drawn) return;
    expect(readOrientation(drawn)).toBe(1);
    expect(locationCarriers(drawn)).toEqual([]);
    expect(contains(drawn, latitudeBytes())).toBe(false);
    expect(contains(drawn, '2026:11:26 09:41:00')).toBe(true);
    // The pixel size, as the Exif IFD says it, is the picture's new one.
    expect(exifIfdValue(drawn, 0xa002)).toBe(2304);
    expect(exifIfdValue(drawn, 0xa003)).toBe(3072);
    expect(exifIfdValue(phonePhoto(6), 0xa002)).toBe(4000);
    // The EXIF goes after the JFIF segment.
    expect(
      readJpegLayout(drawn)
        ?.segments.slice(0, 2)
        .map((each) => each.marker),
    ).toEqual([0xe0, 0xe1]);
  });

  it("uprightExif zeroes the thumbnail's IFD and picture, which would be the old way up", () => {
    const thumbnail = new Uint8Array([0xff, 0xd8, 0x54, 0x48, 0x55, 0x4d, 0x42, 0xff, 0xd9]);
    const structure = tiff({
      ifd0: [{ tag: 0x0112, value: { short: [6] } }],
      ifd1: [
        { tag: 0x0201, value: { long: [0] } },
        { tag: 0x0202, value: { long: [thumbnail.length] } },
      ],
    });
    // The thumbnail's picture after the IFDs, and its offset written into IFD1's first entry.
    const at = structure.length;
    const whole = new Uint8Array([...structure, ...thumbnail]);
    const view = new DataView(whole.buffer);
    const ifd1 = view.getUint32(8 + 2 + 12, true);
    view.setUint32(ifd1 + 2 + 8, at, true);
    const photo = jpeg(10, 10, [exifSegment(whole)]);
    expect(contains(photo, 'THUMB')).toBe(true);
    const exif = uprightExif(photo, 10, 10, false);
    expect(exif && contains(exif, 'THUMB')).toBe(false);
    // Nor its IFD: the entries naming the thumbnail's place and length, little-endian, are gone.
    expect(exif && contains(exif, new Uint8Array([0x01, 0x02, 0x04, 0x00]))).toBe(false);
    expect(exif && contains(exif, new Uint8Array([0x02, 0x02, 0x04, 0x00]))).toBe(false);
    expect(exif && readOrientation(withExif(jpeg(10, 10), exif) ?? new Uint8Array())).toBe(1);
  });

  it('uprightExif keeps the GPS block when the layout keeps the location', () => {
    const exif = uprightExif(phonePhoto(6), 2304, 3072, true);
    const drawn = exif && withExif(jpeg(2304, 3072), exif);
    expect(drawn && locationCarriers(drawn)).toEqual(['gps', 'maker-note']);
    expect(drawn && readOrientation(drawn)).toBe(1);
  });

  it('withExif puts one EXIF segment in place of any the JPEG has', () => {
    const drawn = withExif(jpeg(10, 10, [phoneExif(3)]), orientationExif(5));
    expect(drawn && readOrientation(drawn)).toBe(5);
    expect(
      drawn && readJpegLayout(drawn)?.segments.filter((each) => each.marker === 0xe1),
    ).toHaveLength(1);
  });

  it('orientationExif says one orientation and nothing else', () => {
    const photo = withExif(jpeg(10, 10), orientationExif(8));
    expect(photo && readOrientation(photo)).toBe(8);
    expect(photo && locationCarriers(photo)).toEqual([]);
  });
});

describe('orientationTransform', () => {
  const apply = (
    [a, b, c, d, e, f]: readonly number[],
    x: number,
    y: number,
  ): readonly [number, number] => [a * x + c * y + e, b * x + d * y + f];

  // Where the stored picture's top left and top right corners are seen, for each orientation, in
  // a canvas of the upright size: EXIF's own table of the eight.
  const W = 4;
  const H = 3;
  const seen: Record<number, { topLeft: readonly number[]; topRight: readonly number[] }> = {
    1: { topLeft: [0, 0], topRight: [W, 0] },
    2: { topLeft: [W, 0], topRight: [0, 0] },
    3: { topLeft: [W, H], topRight: [0, H] },
    4: { topLeft: [0, H], topRight: [W, H] },
    5: { topLeft: [0, 0], topRight: [0, W] },
    6: { topLeft: [H, 0], topRight: [H, W] },
    7: { topLeft: [H, W], topRight: [H, 0] },
    8: { topLeft: [0, W], topRight: [0, 0] },
  };

  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`draws orientation ${orientation} the way EXIF says it is seen`, () => {
      const matrix = orientationTransform(orientation, W, H);
      expect(apply(matrix, 0, 0)).toEqual(seen[orientation].topLeft);
      expect(apply(matrix, W, 0)).toEqual(seen[orientation].topRight);
    });
  }

  it('leaves an orientation out of range as it is', () => {
    expect(orientationTransform(0, W, H)).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

it('keeps the fixture honest: the scan data ends the picture', () => {
  expect(SCAN_DATA.slice(-2)).toEqual([0xff, 0xd9]);
});
