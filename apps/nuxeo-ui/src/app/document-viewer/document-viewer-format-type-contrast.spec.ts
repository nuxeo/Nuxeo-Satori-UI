/**
 * NXENG-768 / NXENG-760 / NXENG-801 / NXENG-806 / NXSAT-494 — fixed light-strip text on
 * `.picture-cards` (including `.format-size`, IBM 1406866183 / NXENG-837) uses host-scoped
 * `--document-viewer-*` tokens such as `--document-viewer-muted-on-light-surface`, not theme
 * `--mat-sys-on-surface-variant`. Karma
 * loads `apps/nuxeo-ui/src/styles.scss` and cross-checks ≥4.5:1 under every compiled palette and
 * when CSS fallbacks apply (unset/invalid tokens). WCAG 2.1 AA conformance is owned by
 * `npm run beta:evidence -- phase-6-a11y` (see docs/accessibility.md).
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DocumentViewerComponent } from '@nuxeo-satori/platform/ui';

import { testTranslateModule } from '../i18n/translate-testing';
import { COMPILED_THEME_BASES } from '../theme/app-theme';

const WCAG_AA_NORMAL_TEXT = 4.5;

function parseRgb(css: string): [number, number, number] | null {
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function luminance([r, g, b]: readonly number[]): number {
  const s = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
}

function contrastRatio(fg: readonly number[], bg: readonly number[]): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseColor(value: string): { rgb: number[]; alpha: number } {
  const match = /rgba?\(([^)]+)\)/.exec(value);
  if (!match) {
    throw new Error(`not a computed colour: "${value}"`);
  }
  const parts = match[1]
    .split(/[,\s/]+/)
    .filter(Boolean)
    .map(Number);
  return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
}

function compositeOver(
  fg: { rgb: number[]; alpha: number },
  backdrop: readonly number[],
): number[] {
  return fg.rgb.map((c, i) => Math.round(c * fg.alpha + backdrop[i] * (1 - fg.alpha)));
}

function opaqueBackground(element: HTMLElement): [number, number, number] {
  const own = parseRgb(getComputedStyle(element).backgroundColor);
  if (own && getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)') {
    return own;
  }
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const bg = parseRgb(getComputedStyle(node).backgroundColor);
    if (bg && getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)') {
      return bg;
    }
  }
  return [255, 255, 255];
}

function assertContrast(element: HTMLElement, cards: HTMLElement, label: string): void {
  const fgParsed = parseColor(getComputedStyle(element).color);
  const bg = opaqueBackground(cards);
  const painted = compositeOver(fgParsed, bg);
  const ratio = contrastRatio(painted, bg);
  expect(ratio)
    .withContext(
      `${label} ${getComputedStyle(element).color} on picture-cards ${getComputedStyle(cards).backgroundColor}`,
    )
    .toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
}

function assertFormatTypeOnCards(
  fixture: ComponentFixture<DocumentViewerComponent>,
  context: string,
): void {
  const formatLabel = fixture.nativeElement.querySelector('.format-type') as HTMLElement | null;
  const cards = fixture.nativeElement.querySelector('.picture-cards') as HTMLElement | null;
  expect(formatLabel).withContext(`${context}: expected .format-type`).not.toBeNull();
  expect(cards).withContext(`${context}: expected .picture-cards`).not.toBeNull();
  if (!formatLabel || !cards) return;

  const stripStyle = getComputedStyle(cards);
  const labelStyle = getComputedStyle(formatLabel);
  expect(parseColor(stripStyle.backgroundColor).alpha)
    .withContext(`${context}: picture-cards background must be opaque`)
    .toBe(1);

  const backdrop = parseColor(stripStyle.backgroundColor).rgb;
  const painted = compositeOver(parseColor(labelStyle.color), backdrop);
  const ratio = contrastRatio(painted, backdrop);
  expect(ratio)
    .withContext(
      `format-type ${labelStyle.color} on picture-cards ${stripStyle.backgroundColor} (${context})`,
    )
    .toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
}

describe('DocumentViewer format-type contrast by theme (NXENG-768, NXENG-760, NXENG-801, NXENG-806)', () => {
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
    fixture.componentRef.setInput('pictureViews', [
      {
        title: 'FullHD',
        width: 1920,
        height: 1080,
        fileSize: '8792 Bytes',
        format: 'JPEG',
        downloadUrl: '/nuxeo/fullhd',
      },
    ]);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
    document.documentElement.style.removeProperty('--mat-sys-surface');
    document.documentElement.style.removeProperty('--mat-sys-on-surface-variant');
    (fixture.nativeElement as HTMLElement).style.removeProperty('--mat-sys-surface');
    (fixture.nativeElement as HTMLElement).style.removeProperty('--mat-sys-on-surface-variant');
    (fixture.nativeElement as HTMLElement).style.removeProperty(
      '--document-viewer-muted-on-light-surface',
    );
    (fixture.nativeElement as HTMLElement).style.removeProperty(
      '--document-viewer-light-strip-surface',
    );
    (fixture.nativeElement as HTMLElement).style.removeProperty('--document-viewer-on-light-strip');
    if (originalTheme === null) {
      document.documentElement.removeAttribute('data-app-theme');
    } else {
      document.documentElement.setAttribute('data-app-theme', originalTheme);
    }
  });

  it('wires format-type and format-size through --document-viewer-muted-on-light-surface on the viewer host', () => {
    const formatLabel = fixture.nativeElement.querySelector('.format-type') as HTMLElement | null;
    const formatSize = fixture.nativeElement.querySelector('.format-size') as HTMLElement | null;
    expect(formatLabel).withContext('expected .format-type').not.toBeNull();
    expect(formatSize).withContext('expected .format-size (NXSAT-494)').not.toBeNull();
    if (!formatLabel || !formatSize) return;

    const host = fixture.nativeElement as HTMLElement;
    const sentinel = 'rgb(1, 2, 3)';
    host.style.setProperty('--document-viewer-muted-on-light-surface', sentinel);
    fixture.detectChanges();

    expect(getComputedStyle(formatLabel).color).withContext('format-type').toBe(sentinel);
    expect(getComputedStyle(formatSize).color)
      .withContext('format-size (NXSAT-494)')
      .toBe(sentinel);
  });

  it(`meets ${WCAG_AA_NORMAL_TEXT}:1 for authored SCSS fallbacks when root theme tokens are unset`, () => {
    document.documentElement.style.setProperty('--mat-sys-surface', 'initial');
    document.documentElement.style.setProperty('--mat-sys-on-surface-variant', 'initial');
    fixture.detectChanges();
    assertFormatTypeOnCards(fixture, 'SCSS fallbacks (unset root tokens)');
  });

  it(`meets ${WCAG_AA_NORMAL_TEXT}:1 when surface tokens are invalid on the viewer host`, () => {
    (fixture.nativeElement as HTMLElement).style.setProperty('--mat-sys-surface', 'initial');
    (fixture.nativeElement as HTMLElement).style.setProperty(
      '--mat-sys-on-surface-variant',
      'initial',
    );
    fixture.detectChanges();
    assertFormatTypeOnCards(fixture, 'invalid host tokens');
  });

  for (const theme of [...COMPILED_THEME_BASES, null] as const) {
    const label = theme ?? 'no data-app-theme (first paint)';

    it(`meets ${WCAG_AA_NORMAL_TEXT}:1 on picture-cards — ${label}`, () => {
      if (theme === null) {
        document.documentElement.removeAttribute('data-app-theme');
      } else {
        document.documentElement.setAttribute('data-app-theme', theme);
      }
      fixture.detectChanges();

      if (theme !== null) {
        const onSurfaceVariant = getComputedStyle(document.documentElement)
          .getPropertyValue('--mat-sys-on-surface-variant')
          .trim();
        expect(onSurfaceVariant)
          .withContext(`theme ${theme} should define --mat-sys-on-surface-variant`)
          .not.toBe('');
      }

      const formatLabel = fixture.nativeElement.querySelector('.format-type') as HTMLElement | null;
      const formatSize = fixture.nativeElement.querySelector('.format-size') as HTMLElement | null;
      const cards = fixture.nativeElement.querySelector('.picture-cards') as HTMLElement | null;
      const cardTitle = fixture.nativeElement.querySelector(
        '.picture-card-title',
      ) as HTMLElement | null;
      const infoValue = fixture.nativeElement.querySelector('.info-value') as HTMLElement | null;
      const downloadIcon = fixture.nativeElement.querySelector(
        '.format-download-btn mat-icon',
      ) as HTMLElement | null;

      expect(formatLabel).withContext(`${label}: expected .format-type`).not.toBeNull();
      expect(formatSize).withContext(`${label}: expected .format-size`).not.toBeNull();
      expect(cards).withContext(`${label}: expected .picture-cards`).not.toBeNull();
      expect(cardTitle).withContext(`${label}: expected .picture-card-title`).not.toBeNull();
      expect(infoValue).withContext(`${label}: expected .info-value`).not.toBeNull();
      expect(downloadIcon).withContext(`${label}: expected download icon`).not.toBeNull();
      if (!formatLabel || !formatSize || !cards || !cardTitle || !infoValue || !downloadIcon) {
        return;
      }

      expect(getComputedStyle(cards).backgroundColor)
        .withContext(`picture-cards background in ${label}`)
        .not.toBe('rgba(0, 0, 0, 0)');
      expect(luminance(opaqueBackground(cards)))
        .withContext(`picture-cards must stay a light strip in ${label}`)
        .toBeGreaterThanOrEqual(0.5);

      assertContrast(formatLabel, cards, 'format-type');
      assertContrast(formatSize, cards, 'format-size');
      assertContrast(cardTitle, cards, 'picture-card-title');
      assertContrast(infoValue, cards, 'info-value');
      assertContrast(downloadIcon, cards, 'format-download icon');
    });
  }
});
