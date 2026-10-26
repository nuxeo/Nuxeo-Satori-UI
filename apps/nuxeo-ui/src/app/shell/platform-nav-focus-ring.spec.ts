import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
// testTranslateModule() removed - no longer exported in ngx-translate 18
import { SatPlatformNavModule } from '@hylandsoftware/satori-ui/platform-nav';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';

import { TranslatePipe } from '@ngx-translate/core';

import { testTranslateModule } from '../i18n/translate-testing';
import { COMPILED_THEME_BASES } from '../theme/app-theme';

/**
 * NXENG-761 — the keyboard focus ring on the platform sidebar nav links must be visible.
 *
 * WCAG 2.1 SC 1.4.11 Non-text Contrast requires 3:1 between a focus indicator and the colours
 * adjacent to it. Satori draws the ring from `--sat-platform-nav-outline`, which this
 * application did not set, so it fell back to `--mat-sys-outline-variant` — a divider token —
 * and measured 2.87:1 against the active-item highlight the inset ring is drawn over.
 *
 * ## Why this spec measures rather than inspects
 *
 * Asserting that `--sat-platform-nav-outline` is declared, or that it names a particular
 * token, would pass on any value including the one that failed. What has to hold is the
 * contrast, so the colours are read back off rendered elements and the ratio is computed. The
 * spec then keeps working — and keeps failing when it should — if a palette changes, if Satori
 * changes which property the ring reads, or if someone points the property somewhere else.
 *
 * Three things make that possible here rather than in a jsdom test:
 *
 *  - these specs run in real Chrome (`ng test --browsers=ChromeHeadless`), so focus semantics
 *    and `getComputedStyle` are the browser's;
 *  - `angular.json` loads `apps/nuxeo-ui/src/styles.scss` into the Karma page, so the real
 *    theme tokens and the real override are in the cascade; and
 *  - `SatPlatformNav` — the component that owns the rule drawing the ring — declares
 *    `ViewEncapsulation.None`, and nothing in the shipped styles carries `_ngcontent`
 *    scoping, so instantiating the real `<sat-platform-nav>` puts that rule in the cascade.
 *
 * ## The one piece of arithmetic
 *
 * `getComputedStyle` returns what an element *declares*, so the active item reads back as
 * `rgba(255, 255, 255, 0.12)` — a translucent overlay, not the colour a user sees. The
 * composite is computed below from the overlay and the panel underneath. That is not a guess:
 * the evidence capture for this ticket sampled the same pixel out of a screenshot and read
 * #6b69b6, which is what this arithmetic produces from the two declared values.
 */

/** sRGB relative luminance, per WCAG 2.1. */
function luminance([r, g, b]: readonly number[]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** `rgb(r, g, b)` / `rgba(r, g, b, a)` — the only forms `getComputedStyle` returns for colours. */
function parseColor(value: string): { rgb: number[]; alpha: number } {
  const parts = value.match(/[\d.]+/g);
  if (!parts || parts.length < 3) {
    throw new Error(`not a colour this test can read: "${value}"`);
  }
  return {
    rgb: parts.slice(0, 3).map(Number),
    alpha: parts.length > 3 ? Number(parts[3]) : 1,
  };
}

/** Composite `value` over `backdrop`, so a translucent overlay is measured as it appears. */
function flatten(value: string, backdrop: readonly number[]): number[] {
  const { rgb, alpha } = parseColor(value);
  return rgb.map((channel, i) => Math.round(alpha * channel + (1 - alpha) * backdrop[i]));
}

/**
 * The host template is external because `AGENTS/08-bug-patterns.md` section 10 requires it of
 * every component and does not exempt test hosts — the same reason
 * `render-trusted-html.spec.ts` keeps its one-line host template in a sibling file.
 */
@Component({
  standalone: true,
  imports: [SatPlatformNavModule, TranslatePipe, testTranslateModule()],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './platform-nav-focus-ring.host.html',
})
class NavHostComponent {}

/**
 * Every compiled theme, taken from the application's own authoritative list rather than
 * restated here — a second copy would leave this "every theme" test green while a newly
 * compiled palette went unexercised.
 *
 * `null` is the no-attribute case, which is not hypothetical: the attribute is applied at
 * runtime, so the first paint of every session is themed by `html:not([data-app-theme])`.
 */
const SHIPPED_THEMES: readonly (string | null)[] = [null, ...COMPILED_THEME_BASES];

const WCAG_1411_MIN_RATIO = 3;

describe('platform sidebar nav — keyboard focus ring (NXENG-761)', () => {
  let fixture: ComponentFixture<NavHostComponent>;
  let originalTheme: string | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      // Satori's nav translates its collapse/expand tooltips, and ngx-translate is
      // bootstrapped by the application rather than by the component — the same reason
      // `tasks-page.viewer-mime.spec.ts` imports it.
      imports: [NavHostComponent, TranslatePipe, testTranslateModule()],
    }).compileComponents();
    originalTheme = document.documentElement.getAttribute('data-app-theme');
    fixture = TestBed.createComponent(NavHostComponent);
    fixture.detectChanges();
    // Satori's panel is `position: fixed`, so it renders regardless of where Karma puts the
    // fixture; attaching to the body keeps the cascade the same as the application's.
    document.body.appendChild(fixture.nativeElement);
  });

  afterEach(() => {
    fixture.nativeElement.remove();
    document.documentElement.style.removeProperty('--sat-platform-nav-outline');
    if (originalTheme === null) {
      document.documentElement.removeAttribute('data-app-theme');
    } else {
      document.documentElement.setAttribute('data-app-theme', originalTheme);
    }
  });

  function link(navId: 'idle' | 'active'): HTMLElement {
    const el = fixture.nativeElement.querySelector(
      `a[sat-platform-nav-menu-item][data-nav-id="${navId}"]`,
    );
    expect(el).withContext(`the ${navId} nav link renders`).toBeTruthy();
    return el as HTMLElement;
  }

  /** Focus a link as a keyboard user would and report the ring it draws, flattened. */
  function focusRingOf(navId: 'idle' | 'active') {
    const el = link(navId);
    el.focus({ focusVisible: true } as FocusOptions);

    const panel = fixture.nativeElement.querySelector('.sat-platform-nav-panel') as HTMLElement;
    const panelRgb = parseColor(getComputedStyle(panel).backgroundColor).rgb;
    const style = getComputedStyle(el);

    // What the *focused* item paints, and what the item next to it paints — both over the
    // panel, and both colours the ring can end up against.
    const own = flatten(style.backgroundColor, panelRgb);
    const neighbour = flatten(
      getComputedStyle(link(navId === 'idle' ? 'active' : 'idle')).backgroundColor,
      panelRgb,
    );

    return {
      matchesFocusVisible: el.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      // Composited over the focused item's own background, not over the panel: the ring is
      // drawn *inside* the item box, so that background is what a translucent ring colour
      // actually mixes with. Compositing over the panel instead inflates the ratio against
      // the highlight — 60% black reads as 3.13:1 that way while the rendered ring is
      // 2.82:1, a false pass. Proved by the negative control at the bottom of this file.
      ring: flatten(style.outlineColor, own),
      panel: panelRgb,
      own,
      neighbour,
      rawOutlineColor: style.outlineColor,
    };
  }

  for (const theme of SHIPPED_THEMES) {
    const label = theme ?? 'no data-app-theme (first paint)';

    for (const focused of ['idle', 'active'] as const) {
      it(`draws a ${WCAG_1411_MIN_RATIO}:1 focus ring on the ${focused} sidebar link — ${label}`, () => {
        if (theme === null) {
          document.documentElement.removeAttribute('data-app-theme');
        } else {
          document.documentElement.setAttribute('data-app-theme', theme);
        }

        const measured = focusRingOf(focused);

        // Loud rather than silent: if Chrome stops honouring `focusVisible`, the ring is not
        // on screen and every ratio below would be measuring a colour nothing paints.
        expect(measured.matchesFocusVisible)
          .withContext('the link must be in the :focus-visible state for the ring to exist')
          .toBe(true);
        expect(measured.outlineStyle).not.toBe('none');
        expect(measured.outlineWidth).toBeGreaterThan(0);

        // Every colour the ring is adjacent to: `outline-offset: -2px` draws it inside the
        // item, so it sits on the item's own background, and the panel and the touching
        // neighbour's background are the colours immediately outside it.
        const adjacent = {
          'the panel': measured.panel,
          "the focused item's own background": measured.own,
          "the neighbouring item's background": measured.neighbour,
        };
        for (const [what, colour] of Object.entries(adjacent)) {
          const ratio = contrastRatio(measured.ring, colour);
          expect(ratio)
            .withContext(
              `focus ring rgb(${measured.ring}) against ${what} rgb(${colour}) is ` +
                `${ratio.toFixed(2)}:1, below the ${WCAG_1411_MIN_RATIO}:1 required by ` +
                'WCAG 2.1 SC 1.4.11',
            )
            .toBeGreaterThanOrEqual(WCAG_1411_MIN_RATIO);
        }
      });
    }
  }

  /**
   * The negative control, committed rather than run once by hand: it proves the assertions in
   * the loop above can fail, and that they fail for the right reason.
   *
   * A translucent ring colour is the case where the choice of backdrop decides the verdict.
   * `rgba(0, 0, 0, 0.6)` over the active item's highlight renders at 2.82:1 — a real failure —
   * while compositing it over the *panel* instead computes 3.13:1 and passes. So this asserts
   * both halves: the measured ring must be below 3:1, and it must be strictly worse than the
   * panel-backdrop figure, which is what makes the earlier version of this helper a false
   * pass rather than a rounding difference.
   *
   * Scoped to the default theme, because those two numbers are palette-specific.
   */
  it('measures a translucent ring over the item it is drawn on, not over the panel', () => {
    document.documentElement.setAttribute('data-app-theme', 'nuxeo');
    const nav = fixture.nativeElement.querySelector('sat-platform-nav') as HTMLElement;
    nav.style.setProperty('--sat-platform-nav-outline', 'rgba(0, 0, 0, 0.6)');

    const measured = focusRingOf('active');
    expect(parseColor(measured.rawOutlineColor).alpha).toBeCloseTo(0.6, 2);

    const asMeasured = contrastRatio(measured.ring, measured.own);
    const overPanelInstead = contrastRatio(
      flatten(measured.rawOutlineColor, measured.panel),
      measured.own,
    );

    expect(asMeasured).toBeLessThan(WCAG_1411_MIN_RATIO);
    expect(overPanelInstead)
      .withContext(
        'the wrong backdrop must be what lets this through, otherwise this control is ' +
          'not exercising the defect it was written for',
      )
      .toBeGreaterThanOrEqual(WCAG_1411_MIN_RATIO);
  });

  /**
   * The contract this default has to keep: it is a **default**, and Layer 0 outranks it.
   *
   * `AppThemeService.applyTheme` writes a theme's `tokens` as inline custom properties on
   * `<html>` (`app-theme.service.ts:87-100`), which is how a customer rebrands from JSON. That
   * only works while the default is declared on the same element — a declaration on
   * `sat-platform-nav` applies directly to the element the vendor rule reads the property
   * from, and beats the inherited root value. This test is red against that placement, which
   * is how the placement was chosen.
   */
  it('lets a Layer 0 theme token override the ring colour', () => {
    // Exactly what applyTheme does with `themes[].tokens`, for this one property.
    document.documentElement.style.setProperty('--sat-platform-nav-outline', 'rgb(255, 0, 0)');

    const el = link('idle');
    el.focus({ focusVisible: true } as FocusOptions);

    expect(getComputedStyle(el).outlineColor)
      .withContext('a customer theme token must still control the focus ring')
      .toBe('rgb(255, 0, 0)');
  });

  it('declares a standalone :focus rule IBM Equal Access can read (NXENG-794)', () => {
    const target = 'sat-platform-nav .sat-platform-nav-item:focus';
    let matched: CSSStyleRule | undefined;
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        const styleRule = rule as CSSStyleRule;
        const canonical = styleRule.selectorText?.replace(/\[_ngcontent-[^\]]+\]/g, '').trim();
        if (canonical === target) {
          matched = styleRule;
          break;
        }
      }
      if (matched) break;
    }
    expect(matched)
      .withContext(`stylesheet must contain ${target} without a comma list`)
      .toBeDefined();
    expect(matched!.cssText).toMatch(/outline:\s*2px\s+solid/);
    expect(matched!.cssText).toMatch(/outline-offset:\s*-2px/);
  });

  /**
   * NXENG-794 — IBM Equal Access reads `:focus` only, so `styles.scss` mirrors Satori's ring on
   * `:focus` as well. Programmatic focus without `:focus-visible` must still paint the ring so
   * the scanner and keyboard users see the same indicator.
   */
  it('draws the ring on :focus even when :focus-visible is false (IBM style_focus_visible)', () => {
    const el = link('idle');
    el.focus({ focusVisible: false } as FocusOptions);
    expect(el.matches(':focus')).toBe(true);
    expect(el.matches(':focus-visible')).toBe(false);
    const style = getComputedStyle(el);
    expect(style.outlineStyle).not.toBe('none');
    expect(parseFloat(style.outlineWidth)).toBeGreaterThan(0);
  });
});

/**
 * NXENG-777 — IBM Equal Access Issue 317808202 on `a[aria-label="Collections"]`.
 * Reuses the contrast matrix above; only the host layout and nav id differ.
 */
@Component({
  standalone: true,
  imports: [SatPlatformNavModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './platform-nav-collections-focus-ring.host.html',
})
class CollectionsNavHostComponent {}

const COLLECTIONS_NAV_ID = 'app.navbar.collections';

describe('platform sidebar nav — Collections link (NXENG-777)', () => {
  let fixture: ComponentFixture<CollectionsNavHostComponent>;
  let originalTheme: string | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        CollectionsNavHostComponent,
        testTranslateModule({ 'shell.test.collections-nav-item': 'Collections' }),
      ],
      providers: [provideSatori(), provideNoopAnimations()],
    }).compileComponents();
    originalTheme = document.documentElement.getAttribute('data-app-theme');
    fixture = TestBed.createComponent(CollectionsNavHostComponent);
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
  });

  afterEach(() => {
    fixture.nativeElement.remove();
    if (originalTheme === null) {
      document.documentElement.removeAttribute('data-app-theme');
    } else {
      document.documentElement.setAttribute('data-app-theme', originalTheme);
    }
  });

  function collectionsLink(): HTMLElement {
    const el = fixture.nativeElement.querySelector(
      `a[sat-platform-nav-menu-item][data-nav-id="${COLLECTIONS_NAV_ID}"]`,
    );
    expect(el).withContext('Collections nav link renders').toBeTruthy();
    return el as HTMLElement;
  }

  function measuredCollectionsRing() {
    const el = collectionsLink();
    expect(el.classList.contains('sat-platform-nav-item-active'))
      .withContext('Collections is the current route — IBM flagged the active highlight')
      .toBe(true);

    el.focus({ focusVisible: true } as FocusOptions);
    expect(el.matches(':focus-visible'))
      .withContext('keyboard focus must be visible before contrast is measured')
      .toBe(true);

    const panel = fixture.nativeElement.querySelector('.sat-platform-nav-panel') as HTMLElement;
    const panelRgb = parseColor(getComputedStyle(panel).backgroundColor).rgb;
    const style = getComputedStyle(el);
    expect(style.outlineStyle).not.toBe('none');
    expect(parseFloat(style.outlineWidth)).toBeGreaterThan(0);

    const own = flatten(style.backgroundColor, panelRgb);
    const ring = flatten(style.outlineColor, own);

    return { ring, panel: panelRgb, own, style };
  }

  it('exposes the accessible name IBM flagged', () => {
    expect(collectionsLink().getAttribute('aria-label')).toBe('Collections');
  });

  for (const theme of SHIPPED_THEMES) {
    const label = theme ?? 'no data-app-theme (first paint)';

    it(`draws a ${WCAG_1411_MIN_RATIO}:1 focus ring on the Collections link — ${label}`, () => {
      if (theme === null) {
        document.documentElement.removeAttribute('data-app-theme');
      } else {
        document.documentElement.setAttribute('data-app-theme', theme);
      }
      fixture.detectChanges();

      const measured = measuredCollectionsRing();
      for (const [what, colour] of Object.entries({
        'the panel': measured.panel,
        "the focused item's own background": measured.own,
      })) {
        const ratio = contrastRatio(measured.ring, colour);
        expect(ratio)
          .withContext(
            `Collections focus ring against ${what} (${label}) — IBM 317808202 / WCAG 1.4.11`,
          )
          .toBeGreaterThanOrEqual(WCAG_1411_MIN_RATIO);
      }
    });
  }
});
