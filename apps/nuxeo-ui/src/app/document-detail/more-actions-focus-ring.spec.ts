/**
 * NXSAT-535 / IBM 2589851771 — document-detail header "More actions" menu trigger must show a
 * keyboard focus indicator (WCAG 2.1 SC 2.4.7). Material icon buttons suppress the default ring;
 * Karma loads `apps/nuxeo-ui/src/styles.scss` (see `angular.json`), which `@use`s
 * `document-detail-header-toolbar-focus.scss` — the same path production uses.
 *
 * Same IBM `style_focus_visible` constraints as NXENG-808 / toolbar-icon-focus-ring.spec.ts:
 * standalone `:focus` selector, token wiring, and outline width/style when focused.
 */
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

@Component({
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatMenuModule],
  styleUrls: [
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail.scss',
    './more-actions-focus-ring.fixture.scss',
  ],
  templateUrl: './more-actions-focus-ring.spec.html',
})
class MoreActionsFocusHostComponent {}

describe('Document detail More actions — keyboard focus indicator (NXSAT-535 / IBM 2589851771)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MoreActionsFocusHostComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();
  });

  async function mount(): Promise<{
    fixture: ComponentFixture<MoreActionsFocusHostComponent>;
    button: HTMLButtonElement;
    header: HTMLElement;
  }> {
    const fixture = TestBed.createComponent(MoreActionsFocusHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector(
      '[data-testid="more-actions-btn"]',
    ) as HTMLButtonElement;
    const header = fixture.nativeElement.querySelector('.detail-header') as HTMLElement;
    return { fixture, button, header };
  }

  it('focuses the More actions control with IBM-readable outline (NXSAT-535 / IBM 2589851771)', async () => {
    const { fixture, button } = await mount();
    try {
      expect(button.getAttribute('aria-label')).toBe('More actions');
      button.focus();
      expect(document.activeElement).toBe(button);

      const style = getComputedStyle(button);
      expect(style.outlineStyle).toBe('solid');
      expect(style.outlineWidth).toBe('2px');
      expect(Number.parseFloat(style.outlineOffset)).toBeGreaterThanOrEqual(2);
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
