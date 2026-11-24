/**
 * NXSAT-809 — the icon in a resized Material icon button must sit at the button's centre.
 *
 * A Material icon button is 40px: a 24px icon with 8px of padding on each side. The viewer shrinks
 * its buttons (28px for a format download, 36px for the image toolbar) and uses smaller icons, but
 * left the padding in place and nothing centred the icon, so it started 8px in from the top-left
 * corner and sat low and to the right of the button. This renders the real component in Chrome,
 * with the real stylesheet, and measures where the icon actually is.
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DocumentViewerComponent } from '@nuxeo/satori-platform/ui';

import { testTranslateModule } from '../i18n/translate-testing';

/** How far an icon may sit from its button's centre, in CSS pixels, on either axis. */
const TOLERANCE = 1;

/** The offset of the icon's centre from the button's centre. */
function offset(button: HTMLElement): { x: number; y: number } {
  const icon = button.querySelector('mat-icon') as HTMLElement | null;
  expect(icon)
    .withContext(`${describeButton(button)} has an icon`)
    .not.toBeNull();
  const b = button.getBoundingClientRect();
  const i = (icon as HTMLElement).getBoundingClientRect();
  return {
    x: i.left + i.width / 2 - (b.left + b.width / 2),
    y: i.top + i.height / 2 - (b.top + b.height / 2),
  };
}

function describeButton(button: HTMLElement): string {
  const { width, height } = button.getBoundingClientRect();
  return `"${button.getAttribute('aria-label')}" (${Math.round(width)}x${Math.round(height)})`;
}

describe('DocumentViewer icon buttons are centred (NXSAT-809)', () => {
  let fixture: ComponentFixture<DocumentViewerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DocumentViewerComponent, testTranslateModule()],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(DocumentViewerComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.componentRef.setInput('mimeType', 'image/jpeg');
    fixture.componentRef.setInput('blobUrl', 'blob:mock-image');
    fixture.componentRef.setInput('rawBlobUrl', 'blob:mock-image');
    fixture.componentRef.setInput('pictureInfo', {
      width: 1920,
      height: 1080,
      format: 'JPEG',
      colorSpace: 'sRGB',
      depth: 8,
      weight: '8 KB',
    });
    fixture.componentRef.setInput('pictureViews', [
      {
        title: 'Thumbnail',
        width: 100,
        height: 100,
        fileSize: '512 Bytes',
        format: 'JPEG',
        downloadUrl: '/nuxeo/thumbnail',
      },
      {
        title: 'OriginalJpeg',
        width: 1920,
        height: 1080,
        fileSize: '8792 Bytes',
        format: 'JPEG',
        downloadUrl: '/nuxeo/originaljpeg',
      },
    ]);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  it('centres the download icon of every additional format', () => {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('.format-download-btn'),
    ) as HTMLButtonElement[];
    expect(buttons.length).withContext('format download buttons').toBe(2);
    for (const button of buttons) {
      const { x, y } = offset(button);
      expect(Math.abs(x))
        .withContext(`${describeButton(button)} horizontal offset`)
        .toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(y))
        .withContext(`${describeButton(button)} vertical offset`)
        .toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it('centres the icon of every image toolbar button', () => {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('.viewer-toolbar button'),
    ) as HTMLButtonElement[];
    expect(buttons.length).withContext('image toolbar buttons').toBeGreaterThanOrEqual(5);
    for (const button of buttons) {
      const { x, y } = offset(button);
      expect(Math.abs(x))
        .withContext(`${describeButton(button)} horizontal offset`)
        .toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(y))
        .withContext(`${describeButton(button)} vertical offset`)
        .toBeLessThanOrEqual(TOLERANCE);
    }
  });
});
