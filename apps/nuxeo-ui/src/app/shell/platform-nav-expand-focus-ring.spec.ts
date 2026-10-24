import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { SatPlatformNavModule } from '@hylandsoftware/satori-ui/platform-nav';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
import { TranslateModule } from '@ngx-translate/core';

/**
 * NXENG-796 — keyboard focus indicator on the sidebar **Expand navigation** rail toggle
 * (`#sat-platform-nav-title-icon` / `platform-nav-expand-button`).
 *
 * IBM Equal Access issue 1434332929 (`style_focus_visible`, WCAG 2.4.7) flags this control
 * separately from the nav links fixed in NXENG-761, but Satori draws every
 * `.sat-platform-nav-item` focus ring from the same `--sat-platform-nav-outline` token. The
 * global override on `html` in `styles.scss` therefore applies here too; this spec pins the
 * expand button so it cannot regress behind list-item-only measurements.
 */

@Component({
  standalone: true,
  imports: [SatPlatformNavModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './platform-nav-expand-focus-ring.host.html',
})
class ExpandNavHostComponent {}

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

function paintedBackdrop(element: Element): number[] {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const background = getComputedStyle(node).backgroundColor;
    if (background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') {
      return parseColor(background).rgb;
    }
  }
  throw new Error('no painted ancestor found; the nav panel did not render');
}

const EXPAND_SELECTOR = '#sat-platform-nav-title-icon';
const MINIMUM_RATIO = 3;

describe('Expand navigation rail toggle focus ring (NXENG-796)', () => {
  let fixture: ComponentFixture<ExpandNavHostComponent>;
  let originalTheme: string | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExpandNavHostComponent, TranslateModule.forRoot()],
      providers: [provideSatori(), provideNoopAnimations()],
    }).compileComponents();
    originalTheme = document.documentElement.getAttribute('data-app-theme');
    fixture = TestBed.createComponent(ExpandNavHostComponent);
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
  });

  afterEach(() => {
    fixture.nativeElement.remove();
    if (originalTheme === null) document.documentElement.removeAttribute('data-app-theme');
    else document.documentElement.setAttribute('data-app-theme', originalTheme);
  });

  function expandButton(): HTMLButtonElement {
    const el = fixture.nativeElement.querySelector(EXPAND_SELECTOR) as HTMLButtonElement | null;
    expect(el).withContext('the expand/collapse rail toggle renders').toBeTruthy();
    expect(el?.getAttribute('data-automation-id')).toBe('platform-nav-expand-button');
    return el as HTMLButtonElement;
  }

  function measure(theme: string) {
    document.documentElement.setAttribute('data-app-theme', theme);
    fixture.detectChanges();

    const button = expandButton();
    button.focus({ focusVisible: true } as FocusOptions);

    expect(button.matches(':focus-visible'))
      .withContext('keyboard focus must match :focus-visible for the ring to paint')
      .toBe(true);

    const styles = getComputedStyle(button);
    const panel = paintedBackdrop(button);
    const ownFill = parseColor(styles.backgroundColor);
    const interior = ownFill.alpha > 0 ? compositeOver(ownFill, panel) : panel;
    const ring = parseColor(styles.outlineColor);

    return {
      outlineStyle: styles.outlineStyle,
      outlineWidth: Number.parseFloat(styles.outlineWidth),
      outlineOffset: Number.parseFloat(styles.outlineOffset),
      ratioVsPanel: contrastRatio(compositeOver(ring, panel), panel),
      ratioVsInterior: contrastRatio(compositeOver(ring, interior), interior),
    };
  }

  it('draws a visible focus ring when keyboard-focused', () => {
    const measured = measure('nuxeo');
    expect(measured.outlineStyle).not.toBe('none');
    expect(measured.outlineWidth).toBeGreaterThanOrEqual(2);
    expect(measured.outlineOffset).toBeLessThan(0);
  });

  for (const theme of ['nuxeo', 'dark', 'kawaii', 'light']) {
    it(`meets ${MINIMUM_RATIO}:1 non-text contrast on the ${theme} theme`, () => {
      const measured = measure(theme);
      expect(measured.ratioVsPanel)
        .withContext(`ring against the ${theme} nav panel`)
        .toBeGreaterThanOrEqual(MINIMUM_RATIO);
      expect(measured.ratioVsInterior)
        .withContext(`ring against the ${theme} toggle fill`)
        .toBeGreaterThanOrEqual(MINIMUM_RATIO);
    });
  }

  it('declares a standalone :focus rule IBM style_focus_visible can read', () => {
    document.documentElement.setAttribute('data-app-theme', 'nuxeo');
    fixture.detectChanges();

    const target = 'sat-platform-nav #sat-platform-nav-title-icon:focus';
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
});
