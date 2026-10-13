/**
 * NXSAT-545 / IBM 2851011211 — properties panel version selector keyboard focus (WCAG 2.1 SC 2.4.7).
 * Standalone `:focus` selector shape is owned by document-detail-version-select-focus-ring.spec.ts;
 * this suite owns computed inset geometry, contrast, and IBM `:focus`-only behaviour.
 */
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { COMPILED_THEME_BASES } from '../theme/app-theme';

const WCAG_1411_MIN_RATIO = 3;
const WCAG_AA_NORMAL_TEXT = 4.5;
const WCAG_1411_UI_COMPONENT = 3;

function luminance([r, g, b]: readonly number[]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function parseColor(value: string): { rgb: number[]; alpha: number } {
  const rgbMatch = /rgba?\(([^)]+)\)/.exec(value);
  if (rgbMatch) {
    const parts = rgbMatch[1]
      .split(/[,\s/]+/)
      .filter(Boolean)
      .map(Number);
    return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
  }

  const srgbMatch = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(
    value,
  );
  if (srgbMatch) {
    return {
      rgb: [srgbMatch[1], srgbMatch[2], srgbMatch[3]].map((channel) =>
        Math.round(Number(channel) * 255),
      ),
      alpha: srgbMatch[4] ? Number(srgbMatch[4]) : 1,
    };
  }

  throw new Error(`not a computed colour: "${value}"`);
}

function compositeOver(
  fg: { rgb: number[]; alpha: number },
  backdrop: readonly number[],
): number[] {
  return fg.rgb.map((c, i) => Math.round(c * fg.alpha + backdrop[i] * (1 - fg.alpha)));
}

function paintedBackground(element: HTMLElement): number[] {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const parsed = parseColor(getComputedStyle(node).backgroundColor);
    if (parsed.alpha > 0) {
      return parsed.rgb;
    }
  }
  return [255, 255, 255];
}

@Component({
  standalone: true,
  imports: [MatIconModule],
  styleUrls: [
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail.scss',
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail-version-select-focus.scss',
    './version-select-focus-ring.fixture.scss',
  ],
  templateUrl: './version-select-focus-ring.spec.html',
})
class VersionSelectFocusHostComponent {}

describe('Document detail version selector — keyboard focus indicator (NXSAT-545)', () => {
  let originalTheme: string | null;
  let originalSurfaceToken: string;
  let originalPrimaryToken: string;

  beforeEach(async () => {
    originalTheme = document.documentElement.getAttribute('data-app-theme');
    originalSurfaceToken = document.documentElement.style.getPropertyValue('--mat-sys-surface');
    originalPrimaryToken = document.documentElement.style.getPropertyValue('--mat-sys-primary');

    await TestBed.configureTestingModule({
      imports: [VersionSelectFocusHostComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();
  });

  afterEach(() => {
    if (originalTheme === null) {
      document.documentElement.removeAttribute('data-app-theme');
    } else {
      document.documentElement.setAttribute('data-app-theme', originalTheme);
    }
    if (originalSurfaceToken) {
      document.documentElement.style.setProperty('--mat-sys-surface', originalSurfaceToken);
    } else {
      document.documentElement.style.removeProperty('--mat-sys-surface');
    }
    if (originalPrimaryToken) {
      document.documentElement.style.setProperty('--mat-sys-primary', originalPrimaryToken);
    } else {
      document.documentElement.style.removeProperty('--mat-sys-primary');
    }
  });

  async function mount(): Promise<{
    fixture: ComponentFixture<VersionSelectFocusHostComponent>;
    button: HTMLButtonElement;
  }> {
    const fixture = TestBed.createComponent(VersionSelectFocusHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector('button.version-select') as HTMLButtonElement;
    expect(button).withContext('fixture must render .version-select').toBeTruthy();
    return { fixture, button };
  }

  function applyTheme(theme: (typeof COMPILED_THEME_BASES)[number] | null): void {
    if (theme === null) {
      document.documentElement.removeAttribute('data-app-theme');
    } else {
      document.documentElement.setAttribute('data-app-theme', theme);
    }
  }

  it('draws a 2px inset outline on :focus (IBM style_focus_visible reads :focus only)', async () => {
    const { fixture, button } = await mount();
    try {
      button.focus({ focusVisible: false } as FocusOptions);
      expect(document.activeElement).toBe(button);

      const style = getComputedStyle(button);
      expect(style.outlineStyle).toBe('solid');
      expect(style.outlineWidth).toBe('2px');
      expect(Number.parseFloat(style.outlineOffset)).toBeLessThanOrEqual(-2);
    } finally {
      button.blur();
      fixture.nativeElement.remove();
    }
  });

  it('draws a visible ring on :focus when :focus-visible is false (IBM style_focus_visible)', async () => {
    const { fixture, button } = await mount();
    try {
      button.focus({ focusVisible: false } as FocusOptions);
      expect(button.matches(':focus')).toBe(true);
      expect(button.matches(':focus-visible')).toBe(false);

      const style = getComputedStyle(button);
      expect(style.outlineStyle).toBe('solid');
      expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);
    } finally {
      button.blur();
      fixture.nativeElement.remove();
    }
  });

  it('keeps panel-surface fill and ring contrast when focused and hovered (dark theme)', async () => {
    applyTheme('dark');
    const { fixture, button } = await mount();
    const panel = fixture.nativeElement.querySelector('.properties-panel') as HTMLElement;
    try {
      panel.classList.add('nxsat545-karma-focus-hover');
      panel.style.setProperty('--document-detail-properties-panel-surface', 'rgb(222, 223, 224)');
      document.documentElement.style.setProperty('--mat-sys-surface', 'rgb(12, 13, 14)');
      document.documentElement.style.setProperty('--mat-sys-primary', 'rgb(80, 90, 200)');

      button.focus({ focusVisible: false } as FocusOptions);
      expect(button.matches(':focus')).toBe(true);

      const focusedHoveredBg = getComputedStyle(button).backgroundColor;

      const surfaceHoverProbe = document.createElement('button');
      surfaceHoverProbe.type = 'button';
      surfaceHoverProbe.className = 'version-select nxsat545-simulate-base-hover';
      surfaceHoverProbe.style.position = 'absolute';
      surfaceHoverProbe.style.left = '-9999px';
      panel.appendChild(surfaceHoverProbe);
      const competingHoverFill = getComputedStyle(surfaceHoverProbe).backgroundColor;
      surfaceHoverProbe.remove();

      expect(focusedHoveredBg).not.toBe(competingHoverFill);

      const style = getComputedStyle(button);
      const backdrop = paintedBackground(button);
      const ring = parseColor(style.outlineColor);
      expect(contrastRatio(compositeOver(ring, backdrop), backdrop)).toBeGreaterThanOrEqual(
        WCAG_1411_MIN_RATIO,
      );
    } finally {
      panel.classList.remove('nxsat545-karma-focus-hover');
      button.blur();
      fixture.nativeElement.remove();
    }
  });

  it('keeps label and border contrast on the light panel in dark theme (NXSAT-545)', async () => {
    applyTheme('dark');
    const { fixture, button } = await mount();
    try {
      button.focus({ focusVisible: false } as FocusOptions);
      const style = getComputedStyle(button);
      const fill = paintedBackground(button);
      const label = parseColor(style.color);
      const border = parseColor(style.borderColor);

      expect(contrastRatio(compositeOver(label, fill), fill)).toBeGreaterThanOrEqual(
        WCAG_AA_NORMAL_TEXT,
      );
      expect(contrastRatio(compositeOver(border, fill), fill)).toBeGreaterThanOrEqual(
        WCAG_1411_UI_COMPONENT,
      );
    } finally {
      button.blur();
      fixture.nativeElement.remove();
    }
  });

  for (const theme of [...COMPILED_THEME_BASES, null] as const) {
    const label = theme ?? 'no data-app-theme (first paint)';

    it(`meets ${WCAG_1411_MIN_RATIO}:1 against the version button fill — ${label}`, async () => {
      applyTheme(theme);
      const { fixture, button } = await mount();
      try {
        button.focus({ focusVisible: false } as FocusOptions);
        const style = getComputedStyle(button);

        expect(style.outlineStyle).not.toBe('none');
        expect(parseFloat(style.outlineWidth)).toBeGreaterThan(0);

        const backdrop = paintedBackground(button);
        const ring = parseColor(style.outlineColor);
        const ringOnBackdrop = compositeOver(ring, backdrop);

        expect(contrastRatio(ringOnBackdrop, backdrop)).toBeGreaterThanOrEqual(WCAG_1411_MIN_RATIO);
      } finally {
        button.blur();
        fixture.nativeElement.remove();
      }
    });
  }
});
