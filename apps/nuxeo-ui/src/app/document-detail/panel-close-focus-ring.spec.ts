/**
 * NXENG-830 / IBM 1230336254 — side panel close control keyboard focus (WCAG 2.1 SC 2.4.7).
 * Karma loads theme tokens; the host renders the real `nxs-details-panel` under the feature SCSS,
 * whose `.properties-panel` rule sets the ring colour the library draws. Template wiring and the
 * token are owned by `document-detail-panel-close-focus-ring.spec.ts`; this suite owns computed
 * inset geometry, contrast against the button fill, and the `:focus` ring when `:focus-visible`
 * is false.
 */
import { Component, provideZonelessChangeDetection, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
// testTranslateModule() removed - no longer exported in ngx-translate 18
import {
  NxsDetailsPanelComponent,
  type NxsDetailsPanelTab,
} from '@nuxeo/satori-platform/components';

import { testTranslateModule } from '../i18n/translate-testing';
import { COMPILED_THEME_BASES } from '../theme/app-theme';

/** Resolved from `document-detail.document-detail.close-panel` via testTranslateModule. */
const FIXTURE_CLOSE_PANEL_ARIA_LABEL = 'Close panel';

const WCAG_1411_MIN_RATIO = 3;

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
  const match = /rgba?\(([^)]+)\)/.exec(value);
  if (!match) throw new Error(`not a computed colour: "${value}"`);
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

/** Inset ring (`outline-offset: -2px`) contrasts with the button fill, not the panel behind it. */
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
  imports: [NxsDetailsPanelComponent, testTranslateModule()],
  styleUrls: [
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail.scss',
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './panel-close-focus-ring.spec.html',
})
class PanelCloseFocusHostComponent {
  readonly heading = 'Sample document.pdf';
  readonly views: readonly NxsDetailsPanelTab[] = [{ id: 'properties', label: 'Properties' }];
}

describe('Document detail panel close — keyboard focus indicator (NXENG-830)', () => {
  let originalTheme: string | null;

  beforeEach(async () => {
    originalTheme = document.documentElement.getAttribute('data-app-theme');

    await TestBed.configureTestingModule({
      imports: [PanelCloseFocusHostComponent, testTranslateModule()],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();
  });

  afterEach(() => {
    if (originalTheme === null) {
      document.documentElement.removeAttribute('data-app-theme');
    } else {
      document.documentElement.setAttribute('data-app-theme', originalTheme);
    }
  });

  async function mount(): Promise<{
    fixture: ComponentFixture<PanelCloseFocusHostComponent>;
    button: HTMLButtonElement;
  }> {
    const fixture = TestBed.createComponent(PanelCloseFocusHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector(
      `button[aria-label="${FIXTURE_CLOSE_PANEL_ARIA_LABEL}"]`,
    ) as HTMLButtonElement;
    expect(button)
      .withContext(
        'fixture must expose the properties panel close control by accessible name (production wiring is asserted in document-detail-panel-close-focus-ring.spec.ts)',
      )
      .toBeTruthy();
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

  for (const theme of [...COMPILED_THEME_BASES, null] as const) {
    const label = theme ?? 'no data-app-theme (first paint)';

    it(`meets ${WCAG_1411_MIN_RATIO}:1 against the close button fill — ${label}`, async () => {
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
