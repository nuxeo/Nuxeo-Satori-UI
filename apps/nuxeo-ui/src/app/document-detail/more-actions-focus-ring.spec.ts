/**
 * NXSAT-535 / IBM 2589851771 — document-detail header "More actions" menu trigger keyboard focus
 * styling contract. Material icon buttons suppress the default ring; the overflow trigger is a
 * header toolbar `mat-icon-button` styled via `document-detail-header-toolbar-focus.scss` (same
 * path as prod). The host renders the real `nxs-document-toolbar` as `.header-actions`, as
 * production `document-detail.html` does (see
 * `document-detail-more-actions-focus-ring.spec.ts` and `document-detail-slots.spec.ts`).
 *
 * Karma loads `apps/nuxeo-ui/src/styles.scss` (see `angular.json`), which `@use`s the shared
 * header toolbar focus sheet — the same path production uses.
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
import { TranslatePipe } from '@ngx-translate/core';
import {
  NxsDocumentToolbarComponent,
  type NxsToolbarAction,
} from '@nuxeo/satori-platform/components';

import { testTranslateModule } from '../i18n/translate-testing';

@Component({
  standalone: true,
  imports: [MatButtonModule, MatIconModule, NxsDocumentToolbarComponent, TranslatePipe],
  styleUrls: [
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail.scss',
    './more-actions-focus-ring.fixture.scss',
  ],
  templateUrl: './more-actions-focus-ring.spec.html',
})
class MoreActionsFocusHostComponent {
  readonly actions: readonly NxsToolbarAction[] = [
    { id: 'app.toolbar.export', label: 'Export', icon: 'download', overflow: true },
  ];
}

describe('Document detail More actions — focus ring SCSS contract (NXSAT-535 / IBM 2589851771)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        MoreActionsFocusHostComponent,
        testTranslateModule({ 'document-detail.document-detail.more-actions': 'More actions' }),
      ],
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
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.detail-header .header-actions button.mat-mdc-icon-button',
      ),
    ) as HTMLButtonElement[];
    const button = buttons.find(
      (b) => b.querySelector('mat-icon')?.textContent?.trim() === 'more_vert',
    ) as HTMLButtonElement;
    const header = fixture.nativeElement.querySelector('.detail-header') as HTMLElement;
    return { fixture, button, header };
  }

  it('focuses the More actions control with IBM-readable outline (NXSAT-535 / IBM 2589851771)', async () => {
    const { fixture, button } = await mount();
    try {
      expect(button.querySelector('.cdk-visually-hidden')?.textContent?.trim()).toBe(
        'More actions',
      );
      expect(button.querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');
      expect(button.classList.contains('mat-mdc-icon-button')).toBe(true);
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
