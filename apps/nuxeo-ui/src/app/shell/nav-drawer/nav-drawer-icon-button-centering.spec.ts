/**
 * NXSAT-809 — the remove (x) buttons in the Favorites and Clipboard panels must have their icon at
 * the button's centre.
 *
 * A Material icon button is 40px: a 24px icon with 8px of padding on each side. These are shrunk to
 * 28px with a 16px icon, and with the padding left in place and nothing to centre the icon it
 * started 8px in from the top-left corner and sat low and to the right of the button. This renders
 * the real drawer in Chrome, with its real stylesheet, and measures where the icon actually is.
 */
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { CLIPBOARD_STORAGE_KEY } from '@nuxeo/satori-platform/nuxeo-client';

import { testTranslateModule } from '../../i18n/translate-testing';
import type { AppNavItem } from '../../platform-nav-items';
import { NavDrawerComponent } from './nav-drawer.component';

/** How far an icon may sit from its button's centre, in CSS pixels, on either axis. */
const TOLERANCE = 1;

const DOCS = [
  { uid: 'doc-1', title: 'QA753 plain note', type: 'Note', path: '/default-domain/doc-1' },
  { uid: 'doc-2', title: 'Test File', type: 'File', path: '/default-domain/doc-2' },
];

function offset(button: HTMLElement): { x: number; y: number } {
  const icon = button.querySelector('mat-icon') as HTMLElement | null;
  expect(icon).withContext('the remove button has an icon').not.toBeNull();
  const b = button.getBoundingClientRect();
  const i = (icon as HTMLElement).getBoundingClientRect();
  return {
    x: i.left + i.width / 2 - (b.left + b.width / 2),
    y: i.top + i.height / 2 - (b.top + b.height / 2),
  };
}

describe('NavDrawer remove buttons are centred (NXSAT-809)', () => {
  let fixture: ComponentFixture<NavDrawerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavDrawerComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NavDrawerComponent);
    document.body.appendChild(fixture.nativeElement);
  });

  afterEach(() => fixture.nativeElement.remove());

  function expectCentred(selector: string, expected: number): void {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll(selector),
    ) as HTMLButtonElement[];
    expect(buttons.length).withContext(`${selector} buttons`).toBe(expected);
    for (const button of buttons) {
      const { x, y } = offset(button);
      const { width, height } = button.getBoundingClientRect();
      const name = `${selector} (${Math.round(width)}x${Math.round(height)})`;
      expect(Math.abs(x)).withContext(`${name} horizontal offset`).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(y)).withContext(`${name} vertical offset`).toBeLessThanOrEqual(TOLERANCE);
    }
  }

  it('centres the icon of the remove button on every favorite', () => {
    fixture.componentRef.setInput('activeItem', {
      id: 'app.navbar.favorites',
      label: 'Favorites',
    } as AppNavItem);
    fixture.detectChanges();
    fixture.componentInstance.favoritesLoading.set(false);
    fixture.componentInstance.favorites.set(DOCS as never);
    fixture.detectChanges();
    expectCentred('.favorite-card-remove', 2);
  });

  it('centres the icon of the remove button on every clipboard entry', () => {
    // Opening the panel re-reads the clipboard from storage, so that is where the entries go.
    const before = localStorage.getItem(CLIPBOARD_STORAGE_KEY);
    localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(DOCS));
    try {
      fixture.componentRef.setInput('activeItem', {
        id: 'app.navbar.clipboard',
        label: 'Clipboard',
      } as AppNavItem);
      fixture.detectChanges();
      expectCentred('.clipboard-card-remove', 2);
    } finally {
      if (before === null) localStorage.removeItem(CLIPBOARD_STORAGE_KEY);
      else localStorage.setItem(CLIPBOARD_STORAGE_KEY, before);
    }
  });
});
