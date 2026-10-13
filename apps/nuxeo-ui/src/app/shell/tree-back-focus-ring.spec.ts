/**
 * NXSAT-547 / IBM 2906830030 — Browse drawer `.tree-back` keyboard focus indicator on document
 * detail (WCAG 2.4.7). IBM `style_focus_visible` reads `:focus` only; the production rule lives
 * in `nav-drawer.component.scss`.
 *
 * What these tests do NOT cover: focus visibility on a live document-detail route. That verdict
 * belongs to a11y-scout; this Karma suite asserts SCSS wiring and computed outline geometry.
 */
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

@Component({
  standalone: true,
  imports: [MatIconModule],
  styleUrls: ['./nav-drawer/nav-drawer.component.scss', './tree-back-focus-ring.fixture.scss'],
  templateUrl: './tree-back-focus-ring.spec.html',
})
class TreeBackFocusHostComponent {}

describe('Browse drawer Root back — keyboard focus indicator (NXSAT-547)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TreeBackFocusHostComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();
  });

  async function mount(): Promise<{
    fixture: ComponentFixture<TreeBackFocusHostComponent>;
    button: HTMLButtonElement;
  }> {
    const fixture = TestBed.createComponent(TreeBackFocusHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector(
      '[data-testid="tree-back-btn"]',
    ) as HTMLButtonElement;
    return { fixture, button };
  }

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
      expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);
    } finally {
      button.blur();
      fixture.nativeElement.remove();
    }
  });

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
          if (selector?.includes('.tree-back') && selector.includes(':focus')) {
            focusSelectors.push(selector);
          }
        }
      }

      const canonical = focusSelectors.map((selector) =>
        selector.replace(/\[_ngcontent-[^\]]+\]/g, '').trim(),
      );
      expect(canonical).toContain('.tree-back:focus');
      expect(canonical.some((s) => s.includes('.tree-back:focus,'))).toBe(false);
    } finally {
      button.blur();
      fixture.nativeElement.remove();
    }
  });
});
