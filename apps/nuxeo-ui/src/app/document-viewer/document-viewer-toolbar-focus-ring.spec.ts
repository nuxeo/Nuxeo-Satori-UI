/**
 * NXENG-799 / NXENG-816 / NXENG-817 / NXSAT-524 — Image toolbar icon buttons (Toggle fit, Zoom
 * in, Zoom out, Rotate left, …) must show a keyboard focus indicator on the light toolbar strip
 * (IBM `style_focus_visible` / 922184956, 2140832667, WCAG 2.4.7 / 1.4.11).
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
  return [240, 240, 240];
}

function assertFocusRingContrast(
  button: HTMLButtonElement,
  toolbar: HTMLElement,
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
  const stripBg = parseColor(getComputedStyle(toolbar).backgroundColor).rgb;
  const paintedRing = compositeOver(ringParsed, stripBg);
  const ratio = contrastRatio(paintedRing, stripBg);
  expect(ratio)
    .withContext(
      `${context}: ring ${style.outlineColor} on toolbar ${getComputedStyle(toolbar).backgroundColor}`,
    )
    .toBeGreaterThanOrEqual(WCAG_FOCUS_INDICATOR);
}

describe('DocumentViewer image toolbar focus ring by theme (NXENG-799 / NXENG-816 / NXENG-817)', () => {
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
    fixture.detectChanges();
  });

  afterEach(() => {
    for (const label of ['Toggle fit', 'Zoom in', 'Zoom out', 'Rotate left']) {
      const button = fixture.nativeElement.querySelector(
        `.viewer-toolbar button[aria-label="${label}"]`,
      ) as HTMLButtonElement | null;
      button?.blur();
    }
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

  function toolbarButton(accessibleName: string): HTMLButtonElement {
    const button = fixture.nativeElement.querySelector(
      `.viewer-toolbar button[aria-label="${accessibleName}"]`,
    ) as HTMLButtonElement | null;
    expect(button).withContext(`expected ${accessibleName} toolbar button`).not.toBeNull();
    return button!;
  }

  function toggleFitButton(): HTMLButtonElement {
    return toolbarButton('Toggle fit');
  }

  function zoomInButton(): HTMLButtonElement {
    return toolbarButton('Zoom in');
  }

  function zoomOutButton(): HTMLButtonElement {
    return toolbarButton('Zoom out');
  }

  function rotateLeftButton(): HTMLButtonElement {
    return toolbarButton('Rotate left');
  }

  it('wires the focus ring through --document-viewer-focus-on-light-surface on the viewer host', () => {
    const button = toggleFitButton();
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
          selector?.includes('.viewer-toolbar') &&
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
    expect(canonical).toContain('.viewer-toolbar button.mat-mdc-icon-button:focus');
    expect(canonical.some((selector) => selector.includes(':focus,'))).toBeFalse();
  });

  for (const theme of [...COMPILED_THEME_BASES, null] as const) {
    const label = theme ?? 'no data-app-theme (first paint)';

    it(`meets ${WCAG_FOCUS_INDICATOR}:1 focus-indicator contrast on toolbar — ${label}`, () => {
      if (theme === null) {
        document.documentElement.removeAttribute('data-app-theme');
      } else {
        document.documentElement.setAttribute('data-app-theme', theme);
      }
      fixture.detectChanges();

      const button = toggleFitButton();
      const toolbar = fixture.nativeElement.querySelector('.viewer-toolbar') as HTMLElement | null;
      expect(toolbar).withContext(`${label}: expected .viewer-toolbar`).not.toBeNull();
      if (!toolbar) return;

      assertFocusRingContrast(button, toolbar, label);
      assertFocusRingContrast(zoomInButton(), toolbar, `${label} — Zoom in (NXENG-816)`);
      assertFocusRingContrast(zoomOutButton(), toolbar, `${label} — Zoom out (NXSAT-524)`);

      const rotate = rotateLeftButton();
      assertFocusRingContrast(rotate, toolbar, `${label} — Rotate left`);

      const backdrop = surfaceBehindPositiveOutlineRing(button);
      const stripBg = parseColor(getComputedStyle(toolbar).backgroundColor).rgb;
      expect(backdrop)
        .withContext(`${label}: ring backdrop should match the toolbar strip`)
        .toEqual(stripBg);
    });
  }
});
