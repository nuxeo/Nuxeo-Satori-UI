/**
 * NXENG-775 / NXENG-909 (IBM 3350142295) — the header global-search input must show a
 * keyboard focus indicator.
 *
 * `.header-search-input` declared `outline: none` with no replacement anywhere, and
 * `apps/nuxeo-ui/src/styles.scss` has no global `:focus-visible` fallback. The input is the
 * first Tab stop on every page in the app, and focusing it changed zero of the 19312 pixels
 * in its box — WCAG 2.1 SC 2.4.7, and failure technique F78.
 *
 * These tests run in real Chrome (`ng test nuxeo-ui` is the Karma builder, and its `styles`
 * option loads the app's global stylesheet), so they assert the *rendered* cascade rather
 * than the text of a stylesheet: the host below pulls in the real
 * `app-shell.component.scss`, focus is moved for real, and the ring is read back out of
 * `getComputedStyle` and measured. A test that grepped the SCSS could not tell a rule that
 * applies from one that is overridden.
 *
 * Three regressions are pinned deliberately, each of which was live at some point while the
 * fix was being written:
 *
 *  1. The ring must be on the input, not on `.header-search-input-wrap`. The wrapper is not
 *     focusable, and a ring on it is invisible to any tool that inspects the focused
 *     element — which is how this went unnoticed.
 *  2. `.header-search-input:focus` must stay its own selector. IBM Equal Access's
 *     `style_focus_visible` reads only `:focus` (it collects `:focus-visible` and
 *     `:focus-within` and then never reads them) and its lookup does not resolve selector
 *     lists, so `&:focus, &:focus-visible` puts the finding straight back.
 *  3. The ring must resolve in the same colour scheme as the surface behind it. Because
 *     `outline-offset` paints the ring outside the field, the colour it contrasts against is
 *     whatever is behind the header — not the field's pinned white. An earlier version of
 *     this fix pinned the wrapper to `color-scheme: light` to keep the ring dark on that
 *     white; measuring the surface the ring actually touches showed that made it 2.65:1 on a
 *     dark header. Letting it track the theme gives 5.80–10.11:1 across the four packaged
 *     themes and both OS schemes.
 *
 * What these tests do NOT cover: the numeric contrast in each packaged theme. The
 * fixture below is a synthetic DOM with no header behind it, so it can only measure against
 * the surface it does have. The theme × colour-scheme combinations were measured against the
 * running app and recorded in the evidence folder; what is pinned here is the invariant that
 * makes them hold — the ring resolves through the theme token and does not pin its scheme.
 */
import { Component, provideZonelessChangeDetection, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
// TranslateModule removed - no longer exported in ngx-translate 18

import { testTranslateModule } from '../i18n/translate-testing';

/** WCAG 2.1 relative luminance. */
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

/** `rgb(86, 84, 172)` / `rgba(86, 84, 172, 1)` -> `[86, 84, 172]`. */
function rgb(css: string): [number, number, number] {
  const parts = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

@Component({
  standalone: true,
  imports: [MatIconModule, testTranslateModule()],
  // The real stylesheet under test. Emulated encapsulation scopes it to this template,
  // which is exactly what we want: the declarations are the shell's, the markup mirrors
  // app-shell.component.html.
  styleUrls: ['./app-shell.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './header-search-focus-ring.spec.html',
})
class HeaderSearchHostComponent {}

describe('header global search — keyboard focus indicator', () => {
  let fixture: ComponentFixture<HeaderSearchHostComponent>;
  let input: HTMLInputElement;
  let wrap: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderSearchHostComponent, testTranslateModule()],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(HeaderSearchHostComponent);
    // The element has to be in the live document for :focus to match and for the global
    // stylesheet's theme tokens to resolve against <html>.
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();

    input = fixture.nativeElement.querySelector('.header-search-input') as HTMLInputElement;
    wrap = fixture.nativeElement.querySelector('.header-search-input-wrap') as HTMLElement;
  });

  /**
   * The nearest ancestor background that is not transparent — which is what a ring painted
   * outside the field is actually drawn on top of. In the running app that is the header; in
   * this fixture it is whatever the global theme puts on `<body>`/`<html>`. Either way it is
   * a themed surface, and it is the right *kind* of comparison.
   */
  function surfaceBehindTheRing(): string {
    let node: HTMLElement | null = wrap.parentElement;
    while (node) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
      node = node.parentElement;
    }
    return 'rgb(255, 255, 255)';
  }

  afterEach(() => {
    input?.blur();
    fixture.nativeElement.remove();
  });

  it('draws no outline while unfocused', () => {
    expect(getComputedStyle(input).outlineStyle).toBe('none');
  });

  it('draws a 2px solid outline on the input itself once focused', () => {
    input.focus();
    expect(document.activeElement).toBe(input);

    const style = getComputedStyle(input);
    expect(style.outlineStyle).toBe('solid');
    expect(style.outlineWidth).toBe('2px');
    expect(style.outlineOffset).toBe('2px');
  });

  it('puts the ring on the focusable element, not on the wrapper', () => {
    input.focus();
    // The wrapper must not be the thing carrying the indicator: a ring on a non-focusable
    // ancestor is what made the missing indicator invisible to tooling in the first place.
    expect(getComputedStyle(wrap).outlineStyle).toBe('none');
    expect(getComputedStyle(input).outlineStyle).toBe('solid');
  });

  it('meets the 3:1 non-text contrast of SC 1.4.11 against the surface the ring touches', () => {
    input.focus();
    const style = getComputedStyle(input);

    // Measure the ring only once there is one. `outline-color` computes to `currentColor`
    // even when `outline-style` is `none`, and on this field that is the near-black text
    // colour — so without this guard the assertion below passed at 15:1 against the
    // *unfixed* stylesheet, where no ring is drawn at all. Verified by reverting the SCSS
    // and watching this spec stay green while the two above it went red.
    expect(style.outlineStyle).not.toBe('none');
    expect(parseFloat(style.outlineWidth)).toBeGreaterThan(0);

    // A positive `outline-offset` paints the ring outside the field's border box, with the
    // gap showing what is behind it — so the field's own background is NOT what the ring
    // contrasts against, and comparing the two was measuring a surface it never touches.
    expect(parseFloat(style.outlineOffset)).toBeGreaterThan(0);

    expect(
      contrastRatio(rgb(style.outlineColor), rgb(surfaceBehindTheRing())),
    ).toBeGreaterThanOrEqual(3);
  });

  it('declares at least one standalone :focus rule that IBM can read', () => {
    // Regression 2 above. The rendered cascade cannot distinguish `&:focus` from
    // `&:focus, &:focus-visible` — both paint the same ring — so this reads the rules back
    // out of the stylesheet Angular injected for the component. Without it, the claim in
    // this file's header that the selector shape is pinned would be a comment.
    //
    // What has to hold is that such a rule EXISTS, not that no other focus rule does.
    // Forbidding the others also rejected a standalone `:focus-visible` override, which can
    // sit alongside the `:focus` rule and stays perfectly scanner-readable.
    const focusSelectors: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let sheetRules: CSSRuleList;
      try {
        sheetRules = sheet.cssRules;
      } catch {
        continue; // cross-origin sheet; none of ours are
      }
      for (const rule of Array.from(sheetRules)) {
        const selector = (rule as CSSStyleRule).selectorText;
        if (selector?.includes('.header-search-input') && selector.includes(':focus')) {
          focusSelectors.push(selector);
        }
      }
    }

    // Match the selector exactly, not by substring. `.header-search-input-wrap:focus-within`
    // contains both `.header-search-input` and `:focus`, has no comma and no
    // `:focus-visible` — so a substring predicate counted a ring on the wrapper as the
    // input's own standalone rule, and the spec could pass with the defect it exists to
    // prevent. Emulated encapsulation appends an attribute selector, which is stripped
    // before comparing; it is Angular's, not the author's.
    const canonical = focusSelectors.map((selector) =>
      selector.replace(/\[_ngcontent-[^\]]+\]/g, '').trim(),
    );
    expect(focusSelectors.length).toBeGreaterThan(0);
    expect(canonical).toContain('.header-search-input:focus');
  });

  it('routes a pointer at the magnifier to the input underneath it', () => {
    // The icon is drawn over the field at `z-index: 1`, so `pointer-events: none` is what
    // keeps it from swallowing pointer input — a behaviour the PR claims and nothing else
    // here asserted. `elementFromPoint` is the browser's own hit test and honours
    // `pointer-events`, so deleting that declaration makes this fail.
    const icon = fixture.nativeElement.querySelector('.header-search-icon') as HTMLElement;
    const box = icon.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);

    expect(hit).toBe(input);
    expect(hit).not.toBe(icon);

    // Deliberately not asserted here: that the click *focuses* the input. Focus-on-click is
    // a browser default action and a synthetic MouseEvent does not trigger it, so the only
    // way to make an assertion about it pass in Karma is to call `focus()` first — which
    // makes it pass whether or not the click did anything. The real pointer interaction is
    // exercised with Playwright in the evidence run instead.
  });

  it('resolves its colour through --mat-sys-primary, so a theme override moves it', () => {
    input.focus();
    const html = document.documentElement;
    // Drive the token to a value no theme uses and require the ring to follow it. Asserting
    // that the token exists and that the ring differs from the text colour was not the same
    // claim: a hard-coded `outline: 2px solid rebeccapurple` would satisfy both while being
    // exactly the pinned value this test is named for, and a customer theme override would
    // leave it behind.
    const SENTINEL = 'rgb(1, 2, 3)';
    const inlineBefore = html.style.getPropertyValue('--mat-sys-primary');
    html.style.setProperty('--mat-sys-primary', SENTINEL);
    const followed = getComputedStyle(input).outlineColor;
    if (inlineBefore) {
      html.style.setProperty('--mat-sys-primary', inlineBefore);
    } else {
      html.style.removeProperty('--mat-sys-primary');
    }

    expect(followed).toBe(SENTINEL);
    // And the token must be back, so this test cannot leave the rest of the suite themed by
    // a sentinel.
    expect(getComputedStyle(input).outlineColor).not.toBe(SENTINEL);
  });

  it('tracks the active theme, so it cannot be dark on a dark header', () => {
    // Regression 3. Pinning the ring's scheme is what made it 2.65:1 on a dark header. The
    // guarantee is that the ring moves when the theme does — asserted by switching to one of
    // the four packaged themes and watching the resolved colour change.
    input.focus();
    const html = document.documentElement;
    const inDefaultTheme = getComputedStyle(input).outlineColor;

    const previous = html.getAttribute('data-app-theme');
    html.setAttribute('data-app-theme', 'dark');
    const inDarkTheme = getComputedStyle(input).outlineColor;
    if (previous === null) {
      html.removeAttribute('data-app-theme');
    } else {
      html.setAttribute('data-app-theme', previous);
    }

    expect(inDarkTheme).not.toBe(inDefaultTheme);
    // The scheme has to be read off the INPUT, which is where the `light-dark()` token
    // resolves. Reading it off the wrapper let `color-scheme: light` on the input itself
    // recreate the whole defect while this assertion stayed green — and because
    // `color-scheme` inherits, checking the input also catches a pin on any ancestor.
    expect(getComputedStyle(input).colorScheme).toBe(getComputedStyle(html).colorScheme);
  });

  it('keeps the search box geometry the wrapper used to own', () => {
    const wrapBox = wrap.getBoundingClientRect();
    const icon = fixture.nativeElement.querySelector('.header-search-icon') as HTMLElement;
    const iconBox = icon.getBoundingClientRect();

    // 42px outer and a 13px icon inset are what the wrapper measured when it owned the
    // 1px border and 12px padding. Moving the border onto the input must not move anything.
    expect(Math.round(wrapBox.height)).toBe(42);
    expect(Math.round(iconBox.x - wrapBox.x)).toBe(13);
    expect(
      Math.abs(iconBox.y + iconBox.height / 2 - (wrapBox.y + wrapBox.height / 2)),
    ).toBeLessThan(1.5);
  });
});
