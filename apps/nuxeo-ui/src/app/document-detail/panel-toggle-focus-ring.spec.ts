/**
 * NXSAT-544 / IBM 2834597055 (NXENG-773 / IBM 247628794) — the document-detail details-panel
 * toggle must show a keyboard focus indicator (WCAG 2.1 SC 2.4.7). Material `mat-icon-button`
 * suppresses the default ring and there is no global `:focus-visible` fallback in `styles.scss`.
 *
 * Same IBM `style_focus_visible` constraints as NXENG-872 / NXENG-775: standalone `:focus`
 * selector on the focused control. Contrast is measured against the rendered
 * `.detail-tabs .mat-mdc-tab-header` background — `nxs-tabs` painted with the tokens document-detail.scss
 * sets — not a duplicated colour.
 *
 * Source-level selector contract: `document-detail-panel-toggle-focus-ring.spec.ts`.
 */
import {
  Component,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
// testTranslateModule() removed - no longer exported in ngx-translate 18
import {
  NxsTabBodyDirective,
  NxsTabsComponent,
  type NxsTab,
} from '@nuxeo/satori-platform/components';

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

/** Background `nxs-tabs` paints from the `--nxs-tabs-header-surface` document-detail.scss sets. */
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
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    NxsTabBodyDirective,
    NxsTabsComponent,
    testTranslateModule(),
  ],
  styleUrls: [
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail.scss',
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail-panel-toggle-focus.scss',
    './panel-toggle-focus-ring.fixture.scss',
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './panel-toggle-focus-ring.spec.html',
})
class PanelToggleFocusHostComponent {
  readonly tabs: readonly NxsTab[] = [{ id: 'app.tabs.view', label: 'View' }];
  /** Matches production default: properties panel visible on first paint. */
  readonly propertiesPanelOpen = signal(true);

  detailsPanelToggleLabelKey(): 'document-detail.hide-details' | 'document-detail.show-details' {
    return this.propertiesPanelOpen()
      ? 'document-detail.hide-details'
      : 'document-detail.show-details';
  }
}

describe('Document detail panel toggle — keyboard focus indicator (NXSAT-544)', () => {
  let originalTheme: string | null;

  beforeEach(async () => {
    originalTheme = document.documentElement.getAttribute('data-app-theme');

    await TestBed.configureTestingModule({
      imports: [PanelToggleFocusHostComponent, testTranslateModule()],
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
    fixture: ComponentFixture<PanelToggleFocusHostComponent>;
    button: HTMLButtonElement;
  }> {
    const fixture = TestBed.createComponent(PanelToggleFocusHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector('.panel-toggle-btn') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Hide details');
    expect(button.getAttribute('aria-label')).not.toBe('Toggle details panel');
    return { fixture, button };
  }

  function applyTheme(theme: (typeof COMPILED_THEME_BASES)[number] | null): void {
    if (theme === null) {
      document.documentElement.removeAttribute('data-app-theme');
    } else {
      document.documentElement.setAttribute('data-app-theme', theme);
    }
  }

  it('exposes the production show/hide details accessible name (not the retired toggle key)', async () => {
    const { fixture, button } = await mount();
    try {
      expect(button.getAttribute('aria-label')).toBe('Hide details');
      fixture.componentInstance.propertiesPanelOpen.set(false);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(button.getAttribute('aria-label')).toBe('Show details');
    } finally {
      button.blur();
      fixture.nativeElement.remove();
    }
  });

  it('draws no outline while unfocused', async () => {
    const { fixture, button } = await mount();
    try {
      expect(getComputedStyle(button).outlineStyle).toBe('none');
    } finally {
      button.blur();
      fixture.nativeElement.remove();
    }
  });

  it('draws a 2px solid outline on the button once focused', async () => {
    const { fixture, button } = await mount();
    try {
      button.focus();
      expect(document.activeElement).toBe(button);

      const style = getComputedStyle(button);
      expect(style.outlineStyle).toBe('solid');
      expect(style.outlineWidth).toBe('2px');
      expect(style.outlineOffset).toBe('2px');
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
      expect(parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);
    } finally {
      button.blur();
      fixture.nativeElement.remove();
    }
  });

  for (const theme of [...COMPILED_THEME_BASES, null] as const) {
    const label = theme ?? 'no data-app-theme (first paint)';

    it(`meets ${WCAG_1411_MIN_RATIO}:1 against the production tab-header background — ${label}`, async () => {
      applyTheme(theme);
      const { fixture, button } = await mount();
      try {
        button.focus();
        const style = getComputedStyle(button);

        expect(style.outlineStyle).not.toBe('none');
        expect(parseFloat(style.outlineWidth)).toBeGreaterThan(0);
        expect(parseFloat(style.outlineOffset)).toBeGreaterThan(0);

        const tabHeaderBg = productionTabHeaderBackground(fixture.nativeElement as HTMLElement);

        expect(contrastRatio(rgb(style.outlineColor), rgb(tabHeaderBg))).toBeGreaterThanOrEqual(
          WCAG_1411_MIN_RATIO,
        );
      } finally {
        button.blur();
        fixture.nativeElement.remove();
      }
    });
  }

  it('declares a standalone :focus rule that IBM style_focus_visible can read', async () => {
    const { fixture, button } = await mount();
    try {
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
          if (selector?.includes('.panel-toggle-btn') && selector.includes(':focus')) {
            focusSelectors.push(selector);
          }
        }
      }

      const canonical = focusSelectors.map((selector) =>
        selector.replace(/\[_ngcontent-[^\]]+\]/g, '').trim(),
      );
      expect(focusSelectors.length).toBeGreaterThan(0);
      expect(canonical).toContain('.panel-toggle-btn.mat-mdc-icon-button:focus');
    } finally {
      button.blur();
      fixture.nativeElement.remove();
    }
  });
});
