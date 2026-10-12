/**
 * NXENG-812 / NXSAT-493 — `.info-label` on themed `.picture-cards` uses the light-strip muted token
 * (IBM 716638997, IBM 1390196018). Per-theme cases below verify **token wiring** only (sentinel on
 * `--document-viewer-muted-on-light-surface`), not a WCAG 1.4.3 verdict — that is axe-owned
 * (`docs/accessibility.md` §87–91). Karma loads `apps/nuxeo-ui/src/styles.scss`.
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DocumentViewerComponent } from '@nuxeo-satori/platform/ui';

import { testTranslateModule } from '../i18n/translate-testing';
import { COMPILED_THEME_BASES } from '../theme/app-theme';

describe('DocumentViewer info-label contrast by theme (NXENG-812 / NXSAT-493)', () => {
  let fixture: ComponentFixture<DocumentViewerComponent>;
  let originalTheme: string | null;

  beforeEach(async () => {
    originalTheme = document.documentElement.getAttribute('data-app-theme');

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
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
    if (originalTheme === null) {
      document.documentElement.removeAttribute('data-app-theme');
    } else {
      document.documentElement.setAttribute('data-app-theme', originalTheme);
    }
  });

  for (const theme of [...COMPILED_THEME_BASES, null] as const) {
    const label = theme ?? 'no data-app-theme (first paint)';

    it(`wires .info-label through --document-viewer-muted-on-light-surface — ${label}`, () => {
      if (theme === null) {
        document.documentElement.removeAttribute('data-app-theme');
      } else {
        document.documentElement.setAttribute('data-app-theme', theme);
      }
      fixture.detectChanges();

      const infoLabel = fixture.nativeElement.querySelector('.info-label') as HTMLElement | null;
      const host = fixture.nativeElement as HTMLElement;
      expect(infoLabel).withContext('expected .info-label').not.toBeNull();
      if (!infoLabel) return;

      const sentinel = 'rgb(12, 34, 56)';
      host.style.setProperty('--document-viewer-muted-on-light-surface', sentinel);
      fixture.detectChanges();

      expect(getComputedStyle(infoLabel).color).toBe(sentinel);
    });
  }
});
