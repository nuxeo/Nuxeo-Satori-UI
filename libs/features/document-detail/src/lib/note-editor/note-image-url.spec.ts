import { hasInsertablePictureBlob, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import {
  buildNotePictureNxfileUrl,
  extractMainBlobFileName,
  notePictureInsertUrl,
} from './note-image-url';

/** A complete `NuxeoDocument`, so a fixture states only the fields its test is about. */
function pictureDoc(overrides: Partial<NuxeoDocument> & Pick<NuxeoDocument, 'uid'>): NuxeoDocument {
  return {
    title: 'Document',
    type: 'File',
    path: '/default-domain/workspaces/document',
    lastModified: '2026-01-01T00:00:00.000Z',
    properties: {},
    ...overrides,
  };
}

describe('note-image-url', () => {
  it('buildNotePictureNxfileUrl matches Web UI nxfile pattern', () => {
    expect(buildNotePictureNxfileUrl('abc-123', 'Beach.jpg')).toBe(
      '/nuxeo/nxfile/default/abc-123/file:content/Beach.jpg',
    );
  });

  it('extractMainBlobFileName reads file:content name', () => {
    const doc = pictureDoc({
      uid: '1',
      properties: { 'file:content': { name: 'photo.png' } },
    });
    expect(extractMainBlobFileName(doc)).toBe('photo.png');
  });

  it('notePictureInsertUrl uses server-supplied file:content.data', () => {
    const doc = pictureDoc({
      uid: '1',
      properties: {
        'file:content': {
          name: 'photo.png',
          data: '/nuxeo/nxfile/default/1/file:content/photo.png',
        },
      },
    });
    expect(notePictureInsertUrl(doc)).toBe('/nuxeo/nxfile/default/1/file:content/photo.png');
  });

  it('notePictureInsertUrl returns null when blob data is missing', () => {
    const doc = pictureDoc({ uid: '1', properties: {} });
    expect(notePictureInsertUrl(doc)).toBeNull();
    expect(hasInsertablePictureBlob(doc)).toBe(false);
  });

  it('hasInsertablePictureBlob rejects non-image blobs without Picture type', () => {
    const doc = pictureDoc({
      uid: '2',
      type: 'File',
      properties: {
        'file:content': {
          data: '/nuxeo/nxfile/default/2/file:content/doc.pdf',
          'mime-type': 'application/pdf',
        },
      },
    });
    expect(notePictureInsertUrl(doc)).not.toBeNull();
    expect(hasInsertablePictureBlob(doc)).toBe(false);
  });
});
