/**
 * NXENG-781 / NXENG-786 / NXENG-800 / NXSAT-505 — additional-format download icon buttons
 * (e.g. Download Thumbnail / Download Small, IBM 1635062655 / 368748540) must show a keyboard
 * focus indicator on the fixed light `.picture-cards` strip (IBM `style_focus_visible`, WCAG
 * 2.4.7 / 1.4.11). Karma loads `apps/nuxeo-ui/src/styles.scss`, so `data-app-theme` resolves
 * real tokens.
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DocumentViewerComponent } from '@nuxeo-satori/platform/ui';

import { testTranslateModule } from '../i18n/translate-testing';
import { COMPILED_THEME_BASES } from '../theme/app-theme';

const WCAG_FOCUS_INDICATOR = 3;

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

/** Surface the ring is painted on — positive `outline-offset` skips the control's own fill. */
function surfaceBehindPositiveOutlineRing(control: HTMLElement): [number, number, number] {
  for (let node: HTMLElement | null = control.parentElement; node; node = node.parentElement) {
    const bg = parseRgb(getComputedStyle(node).backgroundColor);
    if (bg && getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)') {
      return bg;
    }
  }
  return [255, 255, 255];
}

function assertFocusRingContrast(
  button: HTMLButtonElement,
  cards: HTMLElement,
  context: string,
): void {
  button.focus();
  expect(document.activeElement).withContext(`${context}: button must receive focus`).toBe(button);

  const style = getComputedStyle(button);
  expect(style.outlineStyle).withContext(`${context}: outline must be visible`).not.toBe('none');
  expect(parseFloat(style.outlineWidth))
    .withContext(`${context}: outline width`)
    .toBeGreaterThan(0);
  expect(style.outlineWidth).withContext(`${context}`).toBe('2px');
  expect(parseFloat(style.outlineOffset))
    .withContext(`${context}: positive offset — ring contrasts with strip behind control`)
    .toBeGreaterThan(0);
  expect(style.outlineOffset).withContext(`${context}`).toBe('2px');

  const ringParsed = parseColor(style.outlineColor);
  const stripBg = parseColor(getComputedStyle(cards).backgroundColor).rgb;
  const paintedRing = compositeOver(ringParsed, stripBg);
  const ratio = contrastRatio(paintedRing, stripBg);
  expect(ratio)
    .withContext(
      `${context}: ring ${style.outlineColor} on strip ${getComputedStyle(cards).backgroundColor}`,
    )
    .toBeGreaterThanOrEqual(WCAG_FOCUS_INDICATOR);
}

describe('DocumentViewer format download focus ring by theme (NXENG-781, NXENG-786, NXENG-800, NXSAT-505)', () => {
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
        title: 'Thumbnail',
        width: 100,
        height: 100,
        fileSize: '512 Bytes',
        format: 'JPEG',
        downloadUrl: '/nuxeo/thumbnail',
      },
      {
        title: 'Small',
        width: 480,
        height: 270,
        fileSize: '2048 Bytes',
        format: 'JPEG',
        downloadUrl: '/nuxeo/small',
      },
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
    const button = fixture.nativeElement.querySelector(
      '.format-download-btn',
    ) as HTMLButtonElement | null;
    button?.blur();
    fixture.nativeElement.remove();
    (fixture.nativeElement as HTMLElement).style.removeProperty(
      '--document-viewer-focus-on-light-surface',
    );
    if (originalTheme === null) {
      document.documentElement.removeAttribute('data-app-theme');
    } else {
      document.documentElement.setAttribute('data-app-theme', originalTheme);
    }
  });

  it('focuses the Download Thumbnail control with IBM-readable outline (NXSAT-505)', () => {
    const rows = Array.from(fixture.nativeElement.querySelectorAll('.format-row')) as HTMLElement[];
    const thumbRow = rows.find((row) => row.textContent?.includes('Thumbnail'));
    expect(thumbRow).withContext('expected Thumbnail format row').toBeTruthy();
    const button = thumbRow?.querySelector('.format-download-btn') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    if (!button) return;

    expect(button.getAttribute('aria-label')).toBe('Download Thumbnail');
    const cards = fixture.nativeElement.querySelector('.picture-cards') as HTMLElement | null;
    expect(cards).not.toBeNull();
    if (!cards) return;

    assertFocusRingContrast(button, cards, 'Download Thumbnail (NXSAT-505)');
  });

  it('draws a visible ring on :focus when :focus-visible is false (IBM style_focus_visible)', () => {
    const rows = Array.from(fixture.nativeElement.querySelectorAll('.format-row')) as HTMLElement[];
    const thumbRow = rows.find((row) => row.textContent?.includes('Thumbnail'));
    const button = thumbRow?.querySelector('.format-download-btn') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    if (!button) return;

    button.focus({ focusVisible: false } as FocusOptions);
    expect(button.matches(':focus')).toBe(true);
    expect(button.matches(':focus-visible')).toBe(false);

    const style = getComputedStyle(button);
    expect(style.outlineStyle).withContext('IBM :focus path').not.toBe('none');
    expect(parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);
  });

  it('focuses the Download Small control with IBM-readable outline (NXENG-800)', () => {
    const rows = Array.from(fixture.nativeElement.querySelectorAll('.format-row')) as HTMLElement[];
    const smallRow = rows.find((row) => row.textContent?.includes('Small'));
    expect(smallRow).withContext('expected Small format row').toBeTruthy();
    const button = smallRow?.querySelector('.format-download-btn') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    if (!button) return;

    expect(button.getAttribute('aria-label')).toContain('Small');
    const cards = fixture.nativeElement.querySelector('.picture-cards') as HTMLElement | null;
    expect(cards).not.toBeNull();
    if (!cards) return;

    assertFocusRingContrast(button, cards, 'Download Small (NXENG-800)');
  });

  it('wires the focus ring through --document-viewer-focus-on-light-surface on the viewer host', () => {
    const button = fixture.nativeElement.querySelector(
      '.format-download-btn',
    ) as HTMLButtonElement | null;
    expect(button).withContext('expected .format-download-btn').not.toBeNull();
    if (!button) return;

    const host = fixture.nativeElement as HTMLElement;
    const sentinel = 'rgb(1, 2, 3)';
    host.style.setProperty('--document-viewer-focus-on-light-surface', sentinel);
    fixture.detectChanges();
    button.focus();

    expect(getComputedStyle(button).outlineColor).toBe(sentinel);
  });

  it('declares a standalone :focus rule that IBM style_focus_visible can read', () => {
    const focusSelectors: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let sheetRules: CSSRuleList;
      try {
        sheetRules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(sheetRules)) {
        const selector = (rule as CSSStyleRule).selectorText;
        if (
          selector?.includes('.format-download-btn') &&
          selector.includes('.mat-mdc-icon-button') &&
          selector.includes(':focus')
        ) {
          focusSelectors.push(selector);
        }
      }
    }

    const canonical = focusSelectors.map((selector) =>
      selector.replace(/\[_ngcontent-[^\]]+\]/g, '').trim(),
    );
    expect(canonical).toContain('.format-download-btn.mat-mdc-icon-button:focus');
    expect(canonical.some((selector) => selector.includes(':focus,'))).toBeFalse();
  });

  for (const theme of [...COMPILED_THEME_BASES, null] as const) {
    const label = theme ?? 'no data-app-theme (first paint)';

    it(`meets ${WCAG_FOCUS_INDICATOR}:1 focus-indicator contrast on picture-cards — ${label}`, () => {
      if (theme === null) {
        document.documentElement.removeAttribute('data-app-theme');
      } else {
        document.documentElement.setAttribute('data-app-theme', theme);
      }
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector(
        '.format-download-btn',
      ) as HTMLButtonElement | null;
      const cards = fixture.nativeElement.querySelector('.picture-cards') as HTMLElement | null;
      expect(button).withContext(`${label}: expected download button`).not.toBeNull();
      expect(cards).withContext(`${label}: expected .picture-cards`).not.toBeNull();
      if (!button || !cards) return;

      assertFocusRingContrast(button, cards, label);

      const backdrop = surfaceBehindPositiveOutlineRing(button);
      const stripBg = parseColor(getComputedStyle(cards).backgroundColor).rgb;
      expect(backdrop)
        .withContext(`${label}: ring backdrop should match the light strip`)
        .toEqual(stripBg);
    });
  }
});
