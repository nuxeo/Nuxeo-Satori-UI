import { CAPTURE_PHOTOS_MAX, CapturePhotos, type ObjectUrls } from './capture-photos';
import type { PhotoCodec } from './photo-codec';
import { jfifSegment, jpeg, phoneExif } from './photo-fixtures.testing';

/** Object URLs as the browser's, counted: each made and each revoked. */
function countedUrls(): ObjectUrls & { readonly made: string[]; readonly revoked: string[] } {
  const made: string[] = [];
  const revoked: string[] = [];
  let next = 0;
  return {
    made,
    revoked,
    create: () => {
      const url = `blob:capture/${++next}`;
      made.push(url);
      return url;
    },
    revoke: (url) => revoked.push(url),
  };
}

const codec: PhotoCodec = {
  measure: async () => {
    throw new Error('not a picture');
  },
  draw: async (_source, drawing) =>
    new Blob([jpeg(drawing.width, drawing.height, [jfifSegment()])]),
};

const photo = (name = 'image.jpg') =>
  new File([jpeg(1200, 900, [phoneExif(1)])], name, { type: 'image/jpeg' });
const notAPicture = () => new File([new Uint8Array([1, 2, 3, 4])], 'x.png', { type: 'image/png' });

const naming = (keepLocation = false) => ({
  keepLocation,
  name: ({ seq }: { seq: number }) => `DC-3003-photo-${seq}`,
});

describe('CapturePhotos', () => {
  it('makes each photo ready in turn, from its own object URL, named for the record', async () => {
    const urls = countedUrls();
    const photos = new CapturePhotos(codec, urls);
    photos.retarget(naming());
    expect(photos.add([photo(), photo()])).toBe(2);
    expect(photos.items().map((each) => each.state)).toEqual(['preparing', 'preparing']);
    expect(photos.preparing()).toBe(true);
    await photos.settled();
    expect(photos.items().map((each) => each.state)).toEqual(['ready', 'ready']);
    expect(photos.items().map((each) => each.prepared?.file.name)).toEqual([
      'DC-3003-photo-1.jpg',
      'DC-3003-photo-2.jpg',
    ]);
    expect(photos.items().map((each) => each.preview)).toEqual(urls.made);
    expect(photos.fileable()).toHaveLength(2);
  });

  it('refuses a file it cannot read, with the reason, and makes no object URL for it', async () => {
    const urls = countedUrls();
    const photos = new CapturePhotos(codec, urls);
    photos.retarget(naming());
    photos.add([notAPicture()]);
    await photos.settled();
    expect(photos.items()[0]).toMatchObject({
      state: 'refused',
      refusal: 'unreadable',
      preview: null,
    });
    expect(urls.made).toEqual([]);
    expect(photos.fileable()).toEqual([]);
  });

  it("revokes a photo's object URL when it is removed, and never reuses its number", async () => {
    const urls = countedUrls();
    const photos = new CapturePhotos(codec, urls);
    photos.retarget(naming());
    photos.add([photo(), photo()]);
    await photos.settled();
    const [first] = photos.items();
    photos.remove(first.id);
    expect(urls.revoked).toEqual([first.preview]);
    photos.add([photo()]);
    await photos.settled();
    expect(photos.items().map((each) => each.prepared?.file.name)).toEqual([
      'DC-3003-photo-2.jpg',
      'DC-3003-photo-3.jpg',
    ]);
  });

  it('does not remove a photo on its way', async () => {
    const urls = countedUrls();
    const photos = new CapturePhotos(codec, urls);
    photos.retarget(naming());
    photos.add([photo()]);
    await photos.settled();
    const [one] = photos.items();
    for (const state of ['waiting', 'uploading', 'retrying'] as const) {
      photos.update(one.id, { state });
      photos.remove(one.id);
      expect(photos.items()).toHaveLength(1);
    }
    expect(urls.revoked).toEqual([]);
  });

  it('prepares every photo again for another record, revoking each old URL, and drops the filed', async () => {
    const urls = countedUrls();
    const photos = new CapturePhotos(codec, urls);
    photos.retarget(naming());
    photos.add([photo(), photo()]);
    await photos.settled();
    const [filed, kept] = photos.items();
    photos.update(filed.id, { state: 'done' });
    photos.retarget({ keepLocation: true, name: ({ seq }) => `DC-3005-photo-${seq}` });
    expect(urls.revoked).toEqual([filed.preview, kept.preview]);
    await photos.settled();
    expect(photos.items()).toHaveLength(1);
    expect(photos.items()[0]).toMatchObject({ state: 'ready' });
    expect(photos.items()[0].prepared).toMatchObject({ location: 'kept' });
    expect(photos.items()[0].prepared?.file.name).toBe('DC-3005-photo-2.jpg');
  });

  it('revokes every object URL when the page is left, and one made after is never made', async () => {
    const urls = countedUrls();
    const photos = new CapturePhotos(codec, urls);
    photos.retarget(naming());
    photos.add([photo()]);
    await photos.settled();
    photos.add([photo()]);
    // The second is still being made ready when the page goes.
    photos.close();
    await photos.settled();
    expect(urls.made).toHaveLength(1);
    expect(urls.revoked).toEqual(urls.made);
    expect(photos.items()).toEqual([]);
  });

  it('takes no more than one filing holds', async () => {
    const photos = new CapturePhotos(codec, countedUrls());
    photos.retarget(naming());
    const files = Array.from({ length: CAPTURE_PHOTOS_MAX + 3 }, () => photo());
    expect(photos.add(files)).toBe(CAPTURE_PHOTOS_MAX);
    expect(photos.room()).toBe(0);
    expect(photos.add([photo()])).toBe(0);
    await photos.settled();
  });

  it('files again a photo not filed for a dropped connection, and not one the server refused', async () => {
    const photos = new CapturePhotos(codec, countedUrls());
    photos.retarget(naming());
    photos.add([photo(), photo(), photo()]);
    await photos.settled();
    const [dropped, refused, large] = photos.items();
    photos.update(dropped.id, { state: 'failed', failure: 'connection' });
    photos.update(refused.id, { state: 'failed', failure: 'refused' });
    photos.update(large.id, { state: 'failed', failure: 'too-large' });
    expect(photos.fileable().map((each) => each.id)).toEqual([dropped.id]);
  });
});
