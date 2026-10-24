import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { SatPlatformNavModule } from '@hylandsoftware/satori-ui/platform-nav';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
import { TranslateModule } from '@ngx-translate/core';

import { COMPILED_THEME_BASES } from '../theme/app-theme';
import { testTranslateModule } from '../i18n/translate-testing';

/**
 * NXENG-912 — IBM Equal Access Issue ID 3416250941 on the Expired Queue sidebar link
 * (`sat-platform-nav-list-item[7]` / `aria-label="Expired Queue"`).
 *
 * Same mechanism as NXENG-761 / NXENG-794: Satori reads `--sat-platform-nav-outline` for every
 * `.sat-platform-nav-item`, and `styles.scss` mirrors the ring on `:focus` for IBM
 * `style_focus_visible`. This spec pins the reported element so a regression on that item alone
 * cannot hide behind coverage of a different nav id.
 */

const ACTIVE_CLASS = 'sat-platform-nav-item-active';

const EXPIRED_QUEUE_LINK =
  'sat-platform-nav-list-item[data-nav-id="app.navbar.expiredQueue"] .sat-platform-nav-item';

@Component({
  standalone: true,
  imports: [SatPlatformNavModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './expired-queue-nav-focus-visible.host.html',
})
class ExpiredQueueNavHostComponent {
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

describe('Expired Queue sidebar nav — keyboard focus visible (NXENG-912)', () => {
  const MINIMUM_RATIO = 3;
  let link: HTMLElement;
  let originalTheme: string | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ExpiredQueueNavHostComponent,
        testTranslateModule({ 'shell.test.expired-queue-nav-item': 'Expired Queue' }),
      ],
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

    const fixture = TestBed.createComponent(ExpiredQueueNavHostComponent);
    fixture.componentInstance.active.set(asCurrentRoute);
    fixture.detectChanges();

    const anchor = fixture.nativeElement.querySelector(EXPIRED_QUEUE_LINK) as HTMLElement | null;
    if (!anchor) throw new Error(`Satori did not render ${EXPIRED_QUEUE_LINK}`);
    link = anchor;

    if (anchor.classList.contains(ACTIVE_CLASS) !== asCurrentRoute) {
      throw new Error(
        `[active]="${asCurrentRoute}" did not leave .${ACTIVE_CLASS} ` +
          `${asCurrentRoute ? 'present' : 'absent'} on Expired Queue`,
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

  it('draws a visible keyboard focus ring on the Expired Queue link', () => {
    const measured = measure('nuxeo', false);

    expect(measured.matchesFocusVisible)
      .withContext('Expired Queue must enter :focus-visible when focused from the keyboard')
      .toBe(true);
    expect(measured.outlineStyle).not.toBe('none');
    expect(measured.outlineWidth).toBeGreaterThanOrEqual(2);

    link.blur();
    expect(getComputedStyle(link).outlineStyle).toBe('none');
  });

  it('draws the ring on :focus when :focus-visible is false (IBM style_focus_visible)', () => {
    document.documentElement.setAttribute('data-app-theme', 'nuxeo');
    const fixture = TestBed.createComponent(ExpiredQueueNavHostComponent);
    fixture.detectChanges();
    const anchor = fixture.nativeElement.querySelector(EXPIRED_QUEUE_LINK) as HTMLElement;
    anchor.focus({ focusVisible: false } as FocusOptions);
    expect(anchor.matches(':focus')).toBe(true);
    expect(anchor.matches(':focus-visible')).toBe(false);
    const style = getComputedStyle(anchor);
    expect(style.outlineStyle).not.toBe('none');
    expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);
  });

  for (const theme of COMPILED_THEME_BASES) {
    it(`Expired Queue focus ring clears ${MINIMUM_RATIO}:1 on the nav panel — ${theme}`, () => {
      const measured = measure(theme, false);
      expect(measured.matchesFocusVisible)
        .withContext(`Expired Queue must be :focus-visible under ${theme}`)
        .toBe(true);
      expect(measured.outlineStyle).not.toBe('none');
      expect(measured.outlineWidth).toBeGreaterThanOrEqual(2);
      expect(measured.ratioVsPanel)
        .withContext(`ring ${measured.ringColor} on the ${theme} nav panel`)
        .toBeGreaterThanOrEqual(MINIMUM_RATIO);
    });

    it(`Expired Queue focus ring clears ${MINIMUM_RATIO}:1 on the current route — ${theme}`, () => {
      const measured = measure(theme, true);
      expect(measured.matchesFocusVisible)
        .withContext(`Expired Queue must be :focus-visible under ${theme}, current route`)
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
