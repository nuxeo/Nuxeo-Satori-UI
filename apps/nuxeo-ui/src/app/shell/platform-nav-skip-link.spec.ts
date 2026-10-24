import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SatPlatformNavModule } from '@hylandsoftware/satori-ui/platform-nav';
import { TranslateModule } from '@ngx-translate/core';

/**
 * NXENG-783 — shell skip link must be visible on keyboard focus (IBM element_tabbable_visible).
 *
 * Satori's `SatSkipToContent` toggles `.sat-skip-to-content-button-visible` from a `(focus)`
 * handler on an OnPush component. The class binding does not land until the next change
 * detection, but accessibility scanners read computed styles as soon as focus moves — before
 * Angular paints the visible state. The global override in `styles.scss` must therefore expose
 * the link through `:focus` / `:focus-visible` alone, matching the login bypass link (NXENG-745).
 */
@Component({
  standalone: true,
  imports: [SatPlatformNavModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './platform-nav-skip-link.host.html',
})
class SkipLinkHostComponent {}

describe('platform shell skip link (NXENG-783)', () => {
  let fixture: ComponentFixture<SkipLinkHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SkipLinkHostComponent, TranslateModule.forRoot()],
    }).compileComponents();

    fixture = TestBed.createComponent(SkipLinkHostComponent);
    fixture.detectChanges();
  });

  function skipLink(): HTMLAnchorElement {
    const el = fixture.nativeElement.querySelector('a.sat-skip-to-content-button');
    expect(el).withContext('sat-skip-to-content anchor').toBeTruthy();
    return el as HTMLAnchorElement;
  }

  it('shows the skip link on :focus before Angular applies the visible class', () => {
    const link = skipLink();
    link.focus({ focusVisible: true } as FocusOptions);

    expect(link.classList.contains('sat-skip-to-content-button-visible')).toBe(false);

    const style = getComputedStyle(link);
    expect(style.position).toBe('fixed');
    expect(Number.parseFloat(style.opacity)).toBeGreaterThan(0.95);
    expect(style.top).not.toBe('-100px');
  });

  it('targets the main content landmark', () => {
    const link = skipLink();
    expect(link.getAttribute('href')).toBe('#main-content');
    expect(fixture.nativeElement.querySelector('#main-content')).toBeTruthy();
  });

  it('declares a standalone :focus rule IBM element_tabbable_visible can read', () => {
    const target = 'html body a.sat-skip-to-content-button:focus';
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
    expect(matched!.style.opacity).toBe('1');
    expect(matched!.style.position).toBe('fixed');
  });
});
