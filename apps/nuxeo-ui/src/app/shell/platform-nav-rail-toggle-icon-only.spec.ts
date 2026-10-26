import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatTooltip } from '@angular/material/tooltip';
import {
  SatPlatformNavModule,
  SatPlatformNavStateService,
} from '@hylandsoftware/satori-ui/platform-nav';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
import { TranslateService } from '@ngx-translate/core';

import { testTranslateModule } from '../i18n/translate-testing';

/**
 * NXENG-927 (icon-only product revert) — Satori rail expand/collapse is conveyed through
 * translated `aria-label` and `matTooltip` only (no host visible-label span).
 * Production wiring is covered in `platform-nav-rail-toggle-icon-only-app-shell.spec.ts`.
 */
const RAIL_TOGGLE_SELECTOR = '#sat-platform-nav-title-icon';
/** Class from the removed PR 246 host workaround; must stay absent on icon-only UI. */
const HOST_VISIBLE_LABEL_CLASS = 'sat-platform-nav-rail-toggle-visible-label';

@Component({
  standalone: true,
  imports: [SatPlatformNavModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './platform-nav-rail-toggle-icon-only.host.html',
})
class PlatformNavRailToggleIconOnlyHostComponent {}

describe('Platform nav rail toggle icon-only labels (NXENG-927)', () => {
  let fixture: ComponentFixture<PlatformNavRailToggleIconOnlyHostComponent>;

  function railToggle(): HTMLButtonElement {
    const button = fixture.nativeElement.querySelector(
      RAIL_TOGGLE_SELECTOR,
    ) as HTMLButtonElement | null;
    expect(button).withContext('rail expand/collapse toggle renders').toBeTruthy();
    return button as HTMLButtonElement;
  }

  function tooltipText(): string {
    const debug = fixture.debugElement.query(By.css(RAIL_TOGGLE_SELECTOR));
    const tooltip = debug.injector.get(MatTooltip, null);
    expect(tooltip).withContext('rail toggle must register MatTooltip').toBeTruthy();
    const message = tooltip!.message;
    return typeof message === 'string' ? message.trim() : String(message ?? '').trim();
  }

  function expectIconOnlyContract(expectedLabel: string): void {
    const button = railToggle();
    expect(button.querySelector(`.${HOST_VISIBLE_LABEL_CLASS}`))
      .withContext('host visible-label span must not be injected')
      .toBeNull();
    expect(button.getAttribute('aria-label')?.trim())
      .withContext('aria-label must carry the translated control name')
      .toBe(expectedLabel);
    expect(tooltipText())
      .withContext('matTooltip must mirror the translated control name')
      .toBe(expectedLabel);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlatformNavRailToggleIconOnlyHostComponent, testTranslateModule()],
      providers: [provideSatori(), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(PlatformNavRailToggleIconOnlyHostComponent);
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      'sat.platform-nav.expand': '⟦Expand navigation⟧',
      'sat.platform-nav.collapse': '⟦Collapse navigation⟧',
    });
    translate.use('en');
    fixture.detectChanges();
  });

  it('exposes translated aria-label and tooltip when the rail is collapsed', () => {
    const navState = TestBed.inject(SatPlatformNavStateService);
    if (!navState.collapsed()) {
      navState.toggleCollapsed();
      fixture.detectChanges();
    }
    expectIconOnlyContract('⟦Expand navigation⟧');
    expect(railToggle().getAttribute('data-automation-id')).toBe('platform-nav-expand-button');
  });

  it('exposes translated aria-label and tooltip when the rail is expanded', () => {
    const navState = TestBed.inject(SatPlatformNavStateService);
    if (navState.collapsed()) {
      navState.toggleCollapsed();
      fixture.detectChanges();
    }
    expectIconOnlyContract('⟦Collapse navigation⟧');
    expect(railToggle().getAttribute('data-automation-id')).toBe('platform-nav-collapse-button');
  });

  it('updates aria-label and tooltip after toggling expand and collapse', () => {
    const button = railToggle();
    expectIconOnlyContract('⟦Expand navigation⟧');

    button.click();
    fixture.detectChanges();
    expectIconOnlyContract('⟦Collapse navigation⟧');

    railToggle().click();
    fixture.detectChanges();
    expectIconOnlyContract('⟦Expand navigation⟧');
  });

  it('refreshes aria-label and tooltip when the active language changes', () => {
    const translate = TestBed.inject(TranslateService);
    expectIconOnlyContract('⟦Expand navigation⟧');

    translate.setTranslation('de', {
      'sat.platform-nav.expand': '⟦Navigation einblenden⟧',
      'sat.platform-nav.collapse': '⟦Navigation ausblenden⟧',
    });
    translate.use('de');
    fixture.detectChanges();

    expectIconOnlyContract('⟦Navigation einblenden⟧');
  });
});
