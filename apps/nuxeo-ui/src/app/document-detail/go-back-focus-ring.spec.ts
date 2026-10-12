/**
 * NXSAT-516 / IBM 1808686844 — document-detail header Go back `mat-icon-button` keyboard focus
 * styling contract. Material icon buttons suppress the default ring; the control sits outside
 * `.header-actions`, so it is styled via `document-detail-go-back-focus.scss` (same path as prod).
 *
 * Same IBM `style_focus_visible` constraints as NXENG-808 / NXENG-773: standalone `:focus`
 * selector on the focused control, token wiring, and outline width/style when focused.
 *
 * What these tests do NOT cover: focus visibility on a live document-detail route. That verdict
 * belongs to a11y-scout (`docs/accessibility.md` §28–33); this Karma suite only asserts SCSS
 * wiring and computed outline geometry on a synthetic host.
 */
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

@Component({
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  styleUrls: [
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail.scss',
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail-go-back-focus.scss',
    './go-back-focus-ring.fixture.scss',
  ],
  templateUrl: './go-back-focus-ring.spec.html',
})
class GoBackFocusHostComponent {}

describe('Document detail header Go back — keyboard focus indicator (NXSAT-516)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GoBackFocusHostComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();
  });

  async function mount(): Promise<{
    fixture: ComponentFixture<GoBackFocusHostComponent>;
    button: HTMLButtonElement;
    header: HTMLElement;
  }> {
    const fixture = TestBed.createComponent(GoBackFocusHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector(
      '[data-testid="go-back-btn"]',
    ) as HTMLButtonElement;
    const header = fixture.nativeElement.querySelector('.detail-header') as HTMLElement;
    return { fixture, button, header };
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
          if (
            selector?.includes('.detail-header-go-back-btn') &&
            selector.includes('mat-mdc-icon-button') &&
            selector.includes(':focus')
          ) {
            focusSelectors.push(selector);
          }
        }
      }

      const canonical = focusSelectors.map((selector) =>
        selector.replace(/\[_ngcontent-[^\]]+\]/g, '').trim(),
      );
      expect(focusSelectors.length).toBeGreaterThan(0);
      expect(canonical).toContain('.detail-header-go-back-btn.mat-mdc-icon-button:focus');
      expect(
        canonical.some((s) => s.includes('.detail-header-go-back-btn.mat-mdc-icon-button:focus,')),
      ).toBe(false);
    } finally {
      button.blur();
      fixture.nativeElement.remove();
    }
  });

  it('resolves its colour through --agentic-document-detail-header-focus-outline', async () => {
    const { fixture, button, header } = await mount();
    try {
      button.focus();
      const SENTINEL = 'rgb(1, 2, 3)';
      header.style.setProperty('--agentic-document-detail-header-focus-outline', SENTINEL);
      expect(getComputedStyle(button).outlineColor).toBe(SENTINEL);
    } finally {
      button.blur();
      fixture.nativeElement.remove();
    }
  });
});
