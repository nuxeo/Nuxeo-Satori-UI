import { DOCUMENT } from '@angular/common';
import { InjectionToken, inject } from '@angular/core';

import { orientationTransform, swapsSides } from './photo-metadata';

/** How a picture is drawn anew: turned by `orientation`, at its upright `width` by `height`. */
export interface PhotoDrawing {
  /** The EXIF orientation to turn it by, 1 to 8: 1 leaves it as the browser decodes it. */
  readonly orientation: number;
  /** The size it is drawn at, upright. */
  readonly width: number;
  readonly height: number;
  /** `image/jpeg`. */
  readonly type: string;
  /** The encoder's quality, 0 to 1. */
  readonly quality: number;
}

/**
 * What decodes a picture and draws it anew: the browser's own, through `createImageBitmap` and a
 * canvas. A canvas writes no metadata, so what it encodes says nothing of where it was taken. A
 * test provides a stand-in, since jsdom has no canvas.
 */
export interface PhotoCodec {
  /** The picture's size as the browser decodes it, with any turn its format makes it take. */
  measure(source: Blob): Promise<{ readonly width: number; readonly height: number }>;
  /** Decodes `source`, draws it as `drawing` says, and encodes it. Rejects when it cannot. */
  draw(source: Blob, drawing: PhotoDrawing): Promise<Blob>;
}

/**
 * The browser's codec. A JPEG is given to it with no EXIF (`withoutExif`), so that the bitmap is
 * the picture as stored, whatever the browser does with an orientation, and `drawing.orientation`
 * is the only turn it takes. Another format, which this page cannot read, is drawn as the browser
 * decodes it, turned as that format says.
 */
export const PHOTO_CODEC = new InjectionToken<PhotoCodec>('PHOTO_CODEC', {
  providedIn: 'root',
  factory: () => browserCodec(inject(DOCUMENT)),
});

export function browserCodec(document: Document): PhotoCodec {
  return {
    async measure(source) {
      const bitmap = await createImageBitmap(source);
      try {
        return { width: bitmap.width, height: bitmap.height };
      } finally {
        bitmap.close();
      }
    },
    async draw(source, drawing) {
      const swap = swapsSides(drawing.orientation);
      // The size the stored picture is drawn at, before it is turned upright.
      const width = swap ? drawing.height : drawing.width;
      const height = swap ? drawing.width : drawing.height;
      const bitmap = await decode(source, width, height);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = drawing.width;
        canvas.height = drawing.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('no 2D canvas');
        // A picture with see-through parts is drawn on white, as JPEG has no transparency.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, drawing.width, drawing.height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.setTransform(...orientationTransform(drawing.orientation, width, height));
        context.drawImage(bitmap, 0, 0, width, height);
        return await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('the canvas encoded nothing'))),
            drawing.type,
            drawing.quality,
          ),
        );
      } finally {
        bitmap.close();
      }
    },
  };
}

/**
 * The bitmap, decoded at the size it is drawn at where the browser can, which spares the memory
 * of a full-size decode, and at its own size where it cannot: Safari before 17 refuses the resize
 * options.
 */
async function decode(source: Blob, width: number, height: number): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(source, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'high',
    });
  } catch {
    return createImageBitmap(source);
  }
}
