/**
 * NXSAT-488 / IBM 1235130066 — document detail tab keyboard focus indicator (WCAG 2.1 SC 2.4.7).
 * Karma loads theme tokens; the host renders the real `nxs-tabs` under document-detail.scss, whose
 * `.detail-tabs` rule sets the ring colour the library draws.
 *
 * The token wiring is owned by `document-detail-tab-focus-ring.spec.ts` (feature Vitest); this
 * suite owns computed outline geometry, contrast against the tab header, and IBM `:focus`-only
 * behaviour.
 */
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  NxsTabBodyDirective,
  NxsTabsComponent,
  type NxsTab,
} from '@nuxeo-satori/platform/components';

import { testTranslateModule } from '../i18n/translate-testing';
import { COMPILED_THEME_BASES } from '../theme/app-theme';

const WCAG_1411_MIN_RATIO = 3;

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function rgb(css: string): [number, number, number] {
  const parts = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function productionTabHeaderBackground(host: HTMLElement): string {
  const header = host.querySelector('.detail-tabs .mat-mdc-tab-header');
  expect(header)
    .withContext('fixture must render the Material tab header styled by document-detail.scss')
    .toBeTruthy();
  const bg = getComputedStyle(header as Element).backgroundColor;
  expect(bg)
    .withContext('tab header must declare a non-transparent background')
    .not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  return bg;
}

@Component({
  standalone: true,
  imports: [NxsTabsComponent, NxsTabBodyDirective],
  styleUrls: [
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail.scss',
    './detail-tab-focus-ring.fixture.scss',
  ],
  templateUrl: './detail-tab-focus-ring.spec.html',
})
class DetailTabFocusHostComponent {
  readonly tabs: readonly NxsTab[] = [
    { id: 'view', label: 'View' },
    { id: 'metadata', label: 'Metadata' },
    { id: 'activity', label: 'Activity' },
  ];
}

describe('Document detail Material tabs — keyboard focus indicator (NXSAT-488)', () => {
  let originalTheme: string | null;

  beforeEach(async () => {
    originalTheme = document.documentElement.getAttribute('data-app-theme');

    await TestBed.configureTestingModule({
      imports: [DetailTabFocusHostComponent, testTranslateModule()],
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
    fixture: ComponentFixture<DetailTabFocusHostComponent>;
    tab: HTMLElement;
  }> {
    const fixture = TestBed.createComponent(DetailTabFocusHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    const tab = fixture.nativeElement.querySelector('.mat-mdc-tab') as HTMLElement;
    expect(tab).withContext('fixture must expose a Material tab label').toBeTruthy();
    return { fixture, tab };
  }

  function applyTheme(theme: (typeof COMPILED_THEME_BASES)[number] | null): void {
    if (theme === null) {
      document.documentElement.removeAttribute('data-app-theme');
    } else {
      document.documentElement.setAttribute('data-app-theme', theme);
    }
  }

  it('draws no outline while unfocused', async () => {
    const { fixture, tab } = await mount();
    try {
      expect(getComputedStyle(tab).outlineStyle).toBe('none');
    } finally {
      tab.blur();
      fixture.nativeElement.remove();
    }
  });

  it('draws a 2px inset outline on the tab once focused', async () => {
    const { fixture, tab } = await mount();
    try {
      tab.focus();
      expect(document.activeElement).toBe(tab);

      const style = getComputedStyle(tab);
      expect(style.outlineStyle).toBe('solid');
      expect(style.outlineWidth).toBe('2px');
      expect(style.outlineOffset).toBe('-2px');
    } finally {
      tab.blur();
      fixture.nativeElement.remove();
    }
  });

  for (const theme of [...COMPILED_THEME_BASES, null] as const) {
    const label = theme ?? 'no data-app-theme (first paint)';

    it(`meets ${WCAG_1411_MIN_RATIO}:1 against the production tab-header background — ${label}`, async () => {
      applyTheme(theme);
      const { fixture, tab } = await mount();
      try {
        tab.focus();
        const style = getComputedStyle(tab);

        expect(style.outlineStyle).not.toBe('none');
        expect(parseFloat(style.outlineWidth)).toBeGreaterThan(0);

        const tabHeaderBg = productionTabHeaderBackground(fixture.nativeElement as HTMLElement);

        expect(contrastRatio(rgb(style.outlineColor), rgb(tabHeaderBg))).toBeGreaterThanOrEqual(
          WCAG_1411_MIN_RATIO,
        );
      } finally {
        tab.blur();
        fixture.nativeElement.remove();
      }
    });
  }

  it('draws a visible ring on :focus when :focus-visible is false (IBM style_focus_visible)', async () => {
    const { fixture, tab } = await mount();
    try {
      tab.focus({ focusVisible: false } as FocusOptions);
      expect(tab.matches(':focus')).toBe(true);
      expect(tab.matches(':focus-visible')).toBe(false);

      const style = getComputedStyle(tab);
      expect(style.outlineStyle).toBe('solid');
      expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);
    } finally {
      tab.blur();
      fixture.nativeElement.remove();
    }
  });
});
