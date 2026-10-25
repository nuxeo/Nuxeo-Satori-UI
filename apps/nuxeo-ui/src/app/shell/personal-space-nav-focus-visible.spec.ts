import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { SatPlatformNavModule } from '@hylandsoftware/satori-ui/platform-nav';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
import { TranslatePipe } from '@ngx-translate/core';

import { testTranslateModule } from '../i18n/translate-testing';

import { COMPILED_THEME_BASES } from '../theme/app-theme';

/**
 * NXENG-778 — IBM Equal Access Issue ID 362174057 on the Personal Space sidebar link
 * (`sat-platform-nav-list-item[12]` / `aria-label="Personal Space"`).
 *
 * Same mechanism as NXENG-761: Satori reads `--sat-platform-nav-outline` for every
 * `.sat-platform-nav-item`, including Personal Space. This spec pins the reported element
 * so a regression on that item alone cannot hide behind coverage of a different nav id.
 */

const ACTIVE_CLASS = 'sat-platform-nav-item-active';

const PERSONAL_SPACE_LINK =
  'sat-platform-nav-list-item[data-nav-id="app.navbar.personalSpace"] .sat-platform-nav-item';

@Component({
  standalone: true,
  imports: [SatPlatformNavModule, TranslatePipe, TranslatePipe, testTranslateModule()],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './personal-space-nav-focus-visible.host.html',
})
class PersonalSpaceNavHostComponent {
  readonly active = signal(false);
}

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

function flatten(value: string, backdrop: readonly number[]): number[] {
  return compositeOver(parseColor(value), backdrop);
}

function paintedBackdrop(element: Element): number[] {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const background = getComputedStyle(node).backgroundColor;
    if (background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') {
      return parseColor(background).rgb;
    }
  }
  throw new Error('no painted ancestor found; the nav panel did not render');
}

describe('Personal Space sidebar nav — keyboard focus visible (NXENG-778)', () => {
  const MINIMUM_RATIO = 3;
  let link: HTMLElement;
  let originalTheme: string | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PersonalSpaceNavHostComponent, TranslatePipe, testTranslateModule()],
      providers: [provideSatori(), provideNoopAnimations()],
    }).compileComponents();
    originalTheme = document.documentElement.getAttribute('data-app-theme');
  });

  afterEach(() => {
    if (originalTheme === null) document.documentElement.removeAttribute('data-app-theme');
    else document.documentElement.setAttribute('data-app-theme', originalTheme);
  });

  function measure(theme: string, asCurrentRoute: boolean) {
    document.documentElement.setAttribute('data-app-theme', theme);

    const fixture = TestBed.createComponent(PersonalSpaceNavHostComponent);
    fixture.componentInstance.active.set(asCurrentRoute);
    fixture.detectChanges();

    const anchor = fixture.nativeElement.querySelector(PERSONAL_SPACE_LINK) as HTMLElement | null;
    if (!anchor) throw new Error(`Satori did not render ${PERSONAL_SPACE_LINK}`);
    link = anchor;

    if (anchor.classList.contains(ACTIVE_CLASS) !== asCurrentRoute) {
      throw new Error(
        `[active]="${asCurrentRoute}" did not leave .${ACTIVE_CLASS} ` +
          `${asCurrentRoute ? 'present' : 'absent'} on Personal Space`,
      );
    }

    anchor.focus({ focusVisible: true } as FocusOptions);
    const styles = getComputedStyle(anchor);

    const panel = paintedBackdrop(anchor);
    const ownFill = parseColor(styles.backgroundColor);
    const interior = ownFill.alpha > 0 ? compositeOver(ownFill, panel) : panel;
    const ring = flatten(styles.outlineColor, interior);

    return {
      matchesFocusVisible: anchor.matches(':focus-visible'),
      outlineStyle: styles.outlineStyle,
      outlineWidth: Number.parseFloat(styles.outlineWidth),
      ringColor: styles.outlineColor,
      ratioVsInterior: contrastRatio(ring, interior),
      ratioVsPanel: contrastRatio(ring, panel),
    };
  }

  it('draws a visible keyboard focus ring on the Personal Space link', () => {
    const measured = measure('nuxeo', false);

    expect(measured.matchesFocusVisible)
      .withContext('Personal Space must enter :focus-visible when focused from the keyboard')
      .toBe(true);
    expect(measured.outlineStyle).not.toBe('none');
    expect(measured.outlineWidth).toBeGreaterThanOrEqual(2);

    link.blur();
    expect(getComputedStyle(link).outlineStyle).toBe('none');
  });

  for (const theme of COMPILED_THEME_BASES) {
    it(`Personal Space focus ring clears ${MINIMUM_RATIO}:1 on the nav panel — ${theme}`, () => {
      const measured = measure(theme, false);
      expect(measured.matchesFocusVisible)
        .withContext(`Personal Space must be :focus-visible under ${theme}`)
        .toBe(true);
      expect(measured.outlineStyle).not.toBe('none');
      expect(measured.outlineWidth).toBeGreaterThanOrEqual(2);
      expect(measured.ratioVsPanel)
        .withContext(`ring ${measured.ringColor} on the ${theme} nav panel`)
        .toBeGreaterThanOrEqual(MINIMUM_RATIO);
    });

    it(`Personal Space focus ring clears ${MINIMUM_RATIO}:1 on the current route — ${theme}`, () => {
      const measured = measure(theme, true);
      expect(measured.matchesFocusVisible)
        .withContext(`Personal Space must be :focus-visible under ${theme}, current route`)
        .toBe(true);
      expect(measured.outlineStyle).not.toBe('none');
      expect(measured.outlineWidth).toBeGreaterThanOrEqual(2);
      expect(measured.ratioVsInterior)
        .withContext(`ring ${measured.ringColor} on the ${theme} current-item fill`)
        .toBeGreaterThanOrEqual(MINIMUM_RATIO);
      expect(measured.ratioVsPanel)
        .withContext(`ring ${measured.ringColor} on the ${theme} nav panel, current item`)
        .toBeGreaterThanOrEqual(MINIMUM_RATIO);
    });
  }
});
