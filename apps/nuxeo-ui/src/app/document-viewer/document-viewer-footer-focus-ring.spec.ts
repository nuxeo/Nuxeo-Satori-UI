/**
 * NXSAT-496 — Document viewer footer icon buttons (Preview, Download, …) must show a keyboard
 * focus indicator on the fixed light footer strip (IBM `style_focus_visible` / 1425495611,
 * WCAG 2.4.7 / 1.4.11). Karma loads theme tokens and compiled styles like production.
 * Standalone `:focus` selector shape and SCSS token wiring are owned by
 * `document-viewer-footer-focus-ring.spec.ts` (shared/ui Vitest); this suite owns computed
 * outline geometry and per-theme focus-indicator contrast on the footer strip.
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
  footer: HTMLElement,
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
  const stripBg = parseColor(getComputedStyle(footer).backgroundColor).rgb;
  const paintedRing = compositeOver(ringParsed, stripBg);
  const ratio = contrastRatio(paintedRing, stripBg);
  expect(ratio)
    .withContext(
      `${context}: ring ${style.outlineColor} on footer ${getComputedStyle(footer).backgroundColor}`,
    )
    .toBeGreaterThanOrEqual(WCAG_FOCUS_INDICATOR);
}

describe('DocumentViewer footer focus ring by theme (NXSAT-496)', () => {
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
    fixture.componentRef.setInput('blobType', 'image/jpeg');
    fixture.componentRef.setInput('blobUrl', 'blob:mock-image');
    fixture.componentRef.setInput('rawBlobUrl', 'blob:mock-image');
    fixture.componentRef.setInput('fileName', 'sample.jpg');
    fixture.detectChanges();
  });

  afterEach(() => {
    previewButton()?.blur();
    downloadButton()?.blur();
    fixture.nativeElement.remove();
    if (originalTheme === null) {
      document.documentElement.removeAttribute('data-app-theme');
    } else {
      document.documentElement.setAttribute('data-app-theme', originalTheme);
    }
  });

  function previewButton(): HTMLButtonElement {
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('.viewer-footer-actions button'),
    ] as HTMLButtonElement[];
    const button = buttons.find(
      (candidate) => candidate.querySelector('mat-icon')?.textContent?.trim() === 'visibility',
    );
    expect(button).withContext('expected Preview footer button').not.toBeNull();
    return button!;
  }

  function downloadButton(): HTMLButtonElement {
    const button = fixture.nativeElement.querySelector(
      '.viewer-footer-actions button[aria-label="Download"]',
    ) as HTMLButtonElement | null;
    expect(button).withContext('expected Download footer button').not.toBeNull();
    return button!;
  }

  for (const theme of [...COMPILED_THEME_BASES, null] as const) {
    const label = theme ?? 'no data-app-theme (first paint)';

    it(`meets ${WCAG_FOCUS_INDICATOR}:1 focus-indicator contrast on viewer footer — ${label}`, () => {
      if (theme === null) {
        document.documentElement.removeAttribute('data-app-theme');
      } else {
        document.documentElement.setAttribute('data-app-theme', theme);
      }
      fixture.detectChanges();

      const footer = fixture.nativeElement.querySelector('.viewer-footer') as HTMLElement | null;
      expect(footer).withContext(`${label}: expected .viewer-footer`).not.toBeNull();
      if (!footer) return;

      assertFocusRingContrast(previewButton(), footer, `${label} — Preview`);
      assertFocusRingContrast(downloadButton(), footer, `${label} — Download`);

      const backdrop = surfaceBehindPositiveOutlineRing(previewButton());
      const stripBg = parseColor(getComputedStyle(footer).backgroundColor).rgb;
      expect(backdrop)
        .withContext(`${label}: ring backdrop should match the footer strip`)
        .toEqual(stripBg);
    });
  }
});
