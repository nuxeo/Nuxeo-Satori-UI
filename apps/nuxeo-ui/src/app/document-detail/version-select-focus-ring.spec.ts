/**
 * NXSAT-545 / IBM 2851011211 — properties panel version selector keyboard focus styling contract.
 * Host markup mirrors production `document-detail.html` (see
 * `document-detail-version-select-focus-ring.spec.ts`).
 *
 * What these tests do NOT cover: focus visibility and 1.4.11 contrast verdicts on a live
 * document-detail route. Those belong to a11y-scout on journey screen
 * `document-detail-version-select` (`docs/accessibility.md`); this Karma suite only asserts SCSS
 * wiring, computed outline geometry, and hover/focus cascade invariants on a synthetic host.
 */
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

@Component({
  standalone: true,
  imports: [MatIconModule],
  styleUrls: [
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail.scss',
    '../../../../../libs/features/document-detail/src/lib/document-detail/document-detail-version-select-focus.scss',
    './version-select-focus-ring.fixture.scss',
  ],
  templateUrl: './version-select-focus-ring.spec.html',
})
class VersionSelectFocusHostComponent {}

describe('Document detail version selector — keyboard focus indicator (NXSAT-545)', () => {
  let originalTheme: string | null;
  let originalSurfaceToken: string;
  let originalPrimaryToken: string;

  beforeEach(async () => {
    originalTheme = document.documentElement.getAttribute('data-app-theme');
    originalSurfaceToken = document.documentElement.style.getPropertyValue('--mat-sys-surface');
    originalPrimaryToken = document.documentElement.style.getPropertyValue('--mat-sys-primary');

    await TestBed.configureTestingModule({
      imports: [VersionSelectFocusHostComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();
  });

  afterEach(() => {
    if (originalTheme === null) {
      document.documentElement.removeAttribute('data-app-theme');
    } else {
      document.documentElement.setAttribute('data-app-theme', originalTheme);
    }
    if (originalSurfaceToken) {
      document.documentElement.style.setProperty('--mat-sys-surface', originalSurfaceToken);
    } else {
      document.documentElement.style.removeProperty('--mat-sys-surface');
    }
    if (originalPrimaryToken) {
      document.documentElement.style.setProperty('--mat-sys-primary', originalPrimaryToken);
    } else {
      document.documentElement.style.removeProperty('--mat-sys-primary');
    }
  });

  async function mount(): Promise<{
    fixture: ComponentFixture<VersionSelectFocusHostComponent>;
    button: HTMLButtonElement;
  }> {
    const fixture = TestBed.createComponent(VersionSelectFocusHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector('button.version-select') as HTMLButtonElement;
    expect(button).withContext('fixture must render .version-select').toBeTruthy();
    return { fixture, button };
  }

  function applyTheme(theme: 'dark' | null): void {
    if (theme === null) {
      document.documentElement.removeAttribute('data-app-theme');
    } else {
      document.documentElement.setAttribute('data-app-theme', theme);
    }
  }

  it('draws a 2px inset outline on :focus (IBM style_focus_visible reads :focus only)', async () => {
    const { fixture, button } = await mount();
    try {
      button.focus({ focusVisible: false } as FocusOptions);
      expect(document.activeElement).toBe(button);

      const style = getComputedStyle(button);
      expect(style.outlineStyle).toBe('solid');
      expect(style.outlineWidth).toBe('2px');
      expect(Number.parseFloat(style.outlineOffset)).toBeLessThanOrEqual(-2);
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

  it('keeps panel-surface fill and focus ring when focused and hovered (dark theme)', async () => {
    applyTheme('dark');
    const { fixture, button } = await mount();
    const panel = fixture.nativeElement.querySelector('.properties-panel') as HTMLElement;
    try {
      panel.classList.add('nxsat545-karma-focus-hover');
      panel.style.setProperty('--document-detail-properties-panel-surface', 'rgb(222, 223, 224)');
      document.documentElement.style.setProperty('--mat-sys-surface', 'rgb(12, 13, 14)');
      document.documentElement.style.setProperty('--mat-sys-primary', 'rgb(80, 90, 200)');

      button.focus({ focusVisible: false } as FocusOptions);
      expect(button.matches(':focus')).toBe(true);

      const focusedHoveredBg = getComputedStyle(button).backgroundColor;

      const surfaceHoverProbe = document.createElement('button');
      surfaceHoverProbe.type = 'button';
      surfaceHoverProbe.className = 'version-select nxsat545-simulate-base-hover';
      surfaceHoverProbe.style.position = 'absolute';
      surfaceHoverProbe.style.left = '-9999px';
      panel.appendChild(surfaceHoverProbe);
      const competingHoverFill = getComputedStyle(surfaceHoverProbe).backgroundColor;
      surfaceHoverProbe.remove();

      expect(focusedHoveredBg).not.toBe(competingHoverFill);

      const style = getComputedStyle(button);
      expect(style.outlineStyle).toBe('solid');
      expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);
    } finally {
      panel.classList.remove('nxsat545-karma-focus-hover');
      button.blur();
      fixture.nativeElement.remove();
    }
  });

  it('keeps panel-surface hover fill when unfocused and hovered (dark theme)', async () => {
    applyTheme('dark');
    const { fixture, button } = await mount();
    const panel = fixture.nativeElement.querySelector('.properties-panel') as HTMLElement;
    try {
      panel.classList.add('nxsat545-karma-plain-hover');
      panel.style.setProperty('--document-detail-properties-panel-surface', 'rgb(222, 223, 224)');
      document.documentElement.style.setProperty('--mat-sys-surface', 'rgb(12, 13, 14)');
      document.documentElement.style.setProperty('--mat-sys-primary', 'rgb(80, 90, 200)');

      expect(document.activeElement).not.toBe(button);

      const plainHoveredBg = getComputedStyle(button).backgroundColor;

      const surfaceHoverProbe = document.createElement('button');
      surfaceHoverProbe.type = 'button';
      surfaceHoverProbe.className = 'version-select nxsat545-simulate-base-hover';
      surfaceHoverProbe.style.position = 'absolute';
      surfaceHoverProbe.style.left = '-9999px';
      panel.appendChild(surfaceHoverProbe);
      const competingHoverFill = getComputedStyle(surfaceHoverProbe).backgroundColor;
      surfaceHoverProbe.remove();

      expect(plainHoveredBg).not.toBe(competingHoverFill);
    } finally {
      panel.classList.remove('nxsat545-karma-plain-hover');
      fixture.nativeElement.remove();
    }
  });

  it('routes label and border colour through --document-detail-properties-accent', async () => {
    const { fixture, button } = await mount();
    const panel = fixture.nativeElement.querySelector('.properties-panel') as HTMLElement;
    try {
      const SENTINEL = 'rgb(9, 10, 11)';
      panel.style.setProperty('--document-detail-properties-accent', SENTINEL);
      expect(getComputedStyle(button).color).toBe(SENTINEL);
      expect(getComputedStyle(button).borderColor).toBe(SENTINEL);
    } finally {
      fixture.nativeElement.remove();
    }
  });
});
