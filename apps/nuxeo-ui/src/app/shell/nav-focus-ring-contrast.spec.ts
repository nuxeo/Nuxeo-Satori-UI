import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { SatPlatformNavModule } from '@hylandsoftware/satori-ui/platform-nav';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
import { TranslateModule } from '@ngx-translate/core';
import { PACKAGED_NAV_ITEMS } from '@nuxeo/satori-platform/extensions';

/**
 * Regression test for NXENG-761 — the keyboard focus indicator on the sidebar nav links.
 *
 * ## What is asserted, and why it is measured rather than inspected
 *
 * The guarantee is a *ratio*, not the presence of a declaration. Asserting that
 * `styles.scss` contains `--sat-platform-nav-outline: …` would pass for any value, including
 * the low-contrast token that caused the defect; and a screenshot cannot tell 2.87:1 from
 * 3.80:1. So this spec renders the real Satori nav, focuses the link, reads the **used**
 * colours the browser reports, and computes the WCAG 2.1 contrast ratio.
 *
 * That is possible because `nuxeo-ui` tests run in real Chrome under Karma with
 * `apps/nuxeo-ui/src/styles.scss` loaded into the page (see `angular.json` → `test.options.styles`),
 * so both halves of the mechanism are present: Satori's own focus rule, injected by the
 * component with `ViewEncapsulation.None`, and our override of the token it reads.
 *
 * None of the application's own colours are written down here. The ring, the panel fill and the
 * current-item overlay all come from `getComputedStyle`, so a Satori release that renames the
 * token, drops the rule or repaints the panel, and a theme whose palette moves, each turn this
 * red. The only colour literal is the sentinel the Layer 0 override test injects, which is not
 * a colour of ours — it exists to be recognised coming back out.
 *
 * ## What it does not cover
 *
 * Nothing about the *route*. The current-item state is driven through the same `[active]`
 * input `app-shell.component.html` binds, so this spec covers Satori's end of that contract
 * but not `isActive()`'s — whether the shell decides the right item is current is
 * `drawer-route-match.spec.ts`'s subject, not this one.
 *
 * It is also Chromium-only, because that is what Karma launches here.
 */

/**
 * Satori's marker class for the item matching the current route.
 *
 * Asserted rather than assumed: the spec drives the public `[active]` input and then checks
 * this class appeared, so a Satori release that renames it fails the run instead of silently
 * leaving every current-item measurement on a plain item.
 */
const ACTIVE_CLASS = 'sat-platform-nav-item-active';

/**
 * Packaged nav entries IBM has flagged individually. The ring mechanism is global
 * (`--sat-platform-nav-outline` on `html`, NXENG-761), but batch a11y tickets name a
 * specific `data-nav-id` — each one gets its own row here so a regression cannot hide
 * behind a sibling item's measurements.
 */
const NAV_ITEMS_UNDER_TEST = [
  { navId: 'app.navbar.dashboard', ticket: 'NXENG-893' },
  { navId: 'app.navbar.trash', ticket: 'NXENG-932' },
  { navId: 'app.navbar.browse', ticket: 'NXENG-794' },
  { navId: 'app.navbar.search', ticket: 'NXENG-785' },
  { navId: 'app.navbar.administration', ticket: 'NXENG-795' },
  { navId: 'app.navbar.clipboard', ticket: 'NXENG-873' },
  { navId: 'app.navbar.assets', ticket: 'NXENG-797' },
  { navId: 'app.navbar.recentlyViewed', ticket: 'NXENG-884' },
  { navId: 'app.navbar.expiredQueue', ticket: 'NXENG-912' },
  { navId: 'app.navbar.tasks', ticket: 'NXENG-931' },
] as const;

const PACKAGED_LABEL_BY_NAV_ID = Object.fromEntries(
  PACKAGED_NAV_ITEMS.map((item) => [item.id, item.label]),
) as Record<string, string>;

/** Focusable anchor inside the list item under test — never a bare `.sat-platform-nav-item`. */
function linkSelector(navId: string): string {
  return `sat-platform-nav-list-item[data-nav-id="${navId}"] .sat-platform-nav-item`;
}

@Component({
  standalone: true,
  imports: [SatPlatformNavModule],
  templateUrl: './nav-focus-ring-contrast.host.html',
})
class NavHostComponent {
  readonly active = signal(false);
  readonly navId = signal<string>(NAV_ITEMS_UNDER_TEST[0].navId);
  readonly label = signal('Nav item under test');
}

/** WCAG relative luminance of an opaque sRGB colour. */
function luminance([r, g, b]: readonly number[]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio between two opaque sRGB colours. */
function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Parse a computed `rgb()`/`rgba()` value into channels plus alpha. */
function parseColor(value: string): { rgb: number[]; alpha: number } {
  const match = /rgba?\(([^)]+)\)/.exec(value);
  if (!match) throw new Error(`not a computed colour: "${value}"`);
  const parts = match[1]
    .split(/[,\s/]+/)
    .filter(Boolean)
    .map(Number);
  return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
}

/** Composite a translucent colour over an opaque backdrop — what the eye actually sees. */
function compositeOver(
  fg: { rgb: number[]; alpha: number },
  backdrop: readonly number[],
): number[] {
  return fg.rgb.map((c, i) => Math.round(c * fg.alpha + backdrop[i] * (1 - fg.alpha)));
}

/** The first ancestor that actually paints a background — the nav panel. */
function paintedBackdrop(element: Element): number[] {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const background = getComputedStyle(node).backgroundColor;
    if (background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') {
      return parseColor(background).rgb;
    }
  }
  throw new Error('no painted ancestor found; the nav panel did not render');
}

describe('sidebar nav focus ring contrast (NXENG-761)', () => {
  /** WCAG 2.1 SC 1.4.11 Non-text Contrast: a focus indicator needs 3:1 against its neighbours. */
  const MINIMUM_RATIO = 3;

  let link: HTMLElement;
  let originalTheme: string | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      // Satori's list item hosts a Material tooltip and translates its own strings, so it
      // needs the same animation and i18n providers the application root sets up.
      imports: [NavHostComponent, TranslateModule.forRoot()],
      providers: [provideSatori(), provideNoopAnimations()],
    }).compileComponents();
    originalTheme = document.documentElement.getAttribute('data-app-theme');
  });

  afterEach(() => {
    if (originalTheme === null) document.documentElement.removeAttribute('data-app-theme');
    else document.documentElement.setAttribute('data-app-theme', originalTheme);
  });

  /**
   * Render the nav under one theme and focus the link, optionally as the current route.
   * Returns the ring colour and the two surfaces it sits between.
   */
  function measure(navId: string, theme: string, asCurrentRoute: boolean) {
    document.documentElement.setAttribute('data-app-theme', theme);

    const fixture = TestBed.createComponent(NavHostComponent);
    // Driven through the same input `app-shell.component.html` binds, rather than by adding
    // Satori's class by hand — otherwise a rename of that class would leave this spec
    // measuring a plain item while still reporting on the current one.
    fixture.componentInstance.navId.set(navId);
    fixture.componentInstance.label.set(PACKAGED_LABEL_BY_NAV_ID[navId] ?? navId);
    fixture.componentInstance.active.set(asCurrentRoute);
    fixture.detectChanges();

    const selector = linkSelector(navId);
    const anchor = fixture.nativeElement.querySelector(selector) as HTMLElement | null;
    if (!anchor) throw new Error(`Satori did not render ${selector}`);
    link = anchor;
    // Both directions, not just the one this call wants. A missing class on `[active]="true"`
    // measures a plain item and calls it the current one; a *lingering* class on
    // `[active]="false"` measures the current item and calls it plain — and that half would
    // make the four panel cases into the same unfailable check the scoped selector just fixed.
    if (anchor.classList.contains(ACTIVE_CLASS) !== asCurrentRoute) {
      throw new Error(
        `[active]="${asCurrentRoute}" did not leave .${ACTIVE_CLASS} ` +
          `${asCurrentRoute ? 'present' : 'absent'} on the item — Satori's current-item ` +
          `contract changed, so the measurements below are not measuring the state they name. ` +
          `Classes seen: ${anchor.className}`,
      );
    }

    anchor.focus();
    const styles = getComputedStyle(anchor);

    const panel = paintedBackdrop(anchor);
    const ownFill = parseColor(styles.backgroundColor);
    // `outline-offset` is negative, so the ring is painted *inside* the item's box: the
    // surface it must contrast with is the item's own fill over the panel, not the panel.
    const interior = ownFill.alpha > 0 ? compositeOver(ownFill, panel) : panel;
    const ring = parseColor(styles.outlineColor);

    return {
      outlineStyle: styles.outlineStyle,
      outlineWidth: Number.parseFloat(styles.outlineWidth),
      ringColor: styles.outlineColor,
      ratioVsInterior: contrastRatio(compositeOver(ring, interior), interior),
      ratioVsPanel: contrastRatio(compositeOver(ring, panel), panel),
    };
  }

  it('registers every flagged nav id in PACKAGED_NAV_ITEMS (shell manifest, not host stubs)', () => {
    for (const { navId, ticket } of NAV_ITEMS_UNDER_TEST) {
      const packaged = PACKAGED_NAV_ITEMS.find((item) => item.id === navId);
      expect(packaged)
        .withContext(`${ticket}: missing packaged nav entry for ${navId}`)
        .toBeDefined();
      expect(PACKAGED_LABEL_BY_NAV_ID[navId])
        .withContext(`${ticket}: label map for ${navId}`)
        .toBe(packaged!.label);
    }
  });

  for (const { navId, ticket } of NAV_ITEMS_UNDER_TEST) {
    describe(`${navId} (${ticket})`, () => {
      it('draws a focus indicator at all when the link is focused', () => {
        const measured = measure(navId, 'nuxeo', false);

        expect(measured.outlineStyle).not.toBe('none');
        expect(measured.outlineWidth).toBeGreaterThanOrEqual(2);
        // Focusing has to change the element's appearance: an unfocused item reports no outline
        // at all. That is the *precondition* IBM's `style_focus_visible` puts in front of a human
        // reviewer, not a substitute for the re-scan itself — no assertion here can produce an
        // IBM verdict.
        link.blur();
        expect(getComputedStyle(link).outlineStyle).toBe('none');
      });

      // Every packaged palette in `styles.scss`. The nav panel is `--mat-sys-primary` and the ring
      // is our override of `--sat-platform-nav-outline`, so each theme is a different pairing and
      // has to be measured rather than reasoned about.
      for (const theme of ['nuxeo', 'dark', 'kawaii', 'light']) {
        it(`clears ${MINIMUM_RATIO}:1 against the nav panel in the ${theme} theme`, () => {
          const measured = measure(navId, theme, false);
          expect(measured.ratioVsPanel)
            .withContext(`ring ${measured.ringColor} on the ${theme} nav panel`)
            .toBeGreaterThanOrEqual(MINIMUM_RATIO);
        });

        it(`clears ${MINIMUM_RATIO}:1 on both sides of the ring on the current item in the ${theme} theme`, () => {
          // The state the defect was in: Satori lightens the current item with a 12% white
          // overlay, and measured 2.87:1 on the default theme before the token was overridden.
          const measured = measure(navId, theme, true);

          // A 2px ring inset by 2px has two neighbours, and WCAG 1.4.11 is about the indicator
          // being distinguishable from what is next to it — so both are asserted. Checking only
          // the interior would let an override pass against the lighter overlay while vanishing
          // against the panel at the item's outer edge.
          expect(measured.ratioVsInterior)
            .withContext(`ring ${measured.ringColor} on the ${theme} current-item fill`)
            .toBeGreaterThanOrEqual(MINIMUM_RATIO);
          expect(measured.ratioVsPanel)
            .withContext(`ring ${measured.ringColor} on the ${theme} nav panel, current item`)
            .toBeGreaterThanOrEqual(MINIMUM_RATIO);
        });
      }

      it("keeps Satori's negative outline-offset, so the ring stays inside the item's box", () => {
        measure(navId, 'nuxeo', false);
        // Why that matters: `.sat-platform-nav-list` sets `overflow-x: hidden`, so a ring drawn
        // outside the box would be cut off at the rail edges. The fix changes colour only.
        expect(Number.parseFloat(getComputedStyle(link).outlineOffset)).toBeLessThan(0);
      });
    });
  }

  it('keeps the packaged Recently viewed label IBM Issue 2658127935 names (NXENG-884)', () => {
    expect(PACKAGED_LABEL_BY_NAV_ID['app.navbar.recentlyViewed']).toBe('Recently viewed');
  });

  it('keeps the packaged Expired Queue descriptor IBM Issue 3416250941 names (NXENG-912)', () => {
    const packaged = PACKAGED_NAV_ITEMS.find((item) => item.id === 'app.navbar.expiredQueue');
    expect(packaged)
      .withContext('PACKAGED_NAV_ITEMS must expose the Expired Queue descriptor')
      .toBeDefined();
    expect(packaged!.path).toBe('/expired-queue');
    expect(packaged!.label).toBe('Expired Queue');
  });

  it('keeps the packaged Tasks descriptor IBM Issue 4267408435 names (NXENG-931)', () => {
    const packaged = PACKAGED_NAV_ITEMS.find((item) => item.id === 'app.navbar.tasks');
    expect(packaged)
      .withContext('PACKAGED_NAV_ITEMS must expose the Tasks descriptor')
      .toBeDefined();
    expect(packaged!.path).toBe('/tasks');
    expect(packaged!.label).toBe('Tasks');
  });

  it('declares a standalone :focus rule on nav links that IBM Equal Access can read (NXENG-794)', () => {
    const target = 'sat-platform-nav .sat-platform-nav-item:focus';
    let matched: CSSStyleRule | undefined;
    for (const sheet of Array.from(document.styleSheets)) {
      let sheetRules: CSSRuleList;
      try {
        sheetRules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(sheetRules)) {
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

  it('takes the ring colour from --agentic-nav-focus-outline-color when it is set', () => {
    // A custom property written onto `<html>` is exactly how `AppThemeService.applyTheme`
    // applies a Layer 0 `themes[].tokens` entry, so this is the customer's path, not a
    // test-only shortcut. The value is a sentinel rather than a colour we would ship.
    document.documentElement.style.setProperty(
      '--agentic-nav-focus-outline-color',
      'rgb(255, 0, 0)',
    );
    try {
      const measured = measure(NAV_ITEMS_UNDER_TEST[0].navId, 'nuxeo', false);
      expect(measured.ringColor).toBe('rgb(255, 0, 0)');
    } finally {
      document.documentElement.style.removeProperty('--agentic-nav-focus-outline-color');
    }
  });
});
