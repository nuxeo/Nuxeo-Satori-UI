import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WidgetContainerComponent } from '@nuxeo/satori-platform/ui';
import { TranslatePipe } from '@ngx-translate/core';
import { testTranslateModule } from '../i18n/translate-testing';
import { COMPILED_THEME_BASES } from '../theme/app-theme';

@Component({
  standalone: true,
  imports: [WidgetContainerComponent, TranslatePipe],
  templateUrl: './dashboard-theme-surfaces.host.html',
  styleUrl: './dashboard-page.component.scss',
})
class DashboardThemeSurfacesHostComponent {}

// NXSAT-215 / NXSAT-216: verify theme wiring in real Chrome. WCAG conformance
// remains owned by phase-6-a11y; this regression checks resolved palette tokens.
describe('dashboard theme surfaces (NXSAT-215)', () => {
  let fixture: ComponentFixture<DashboardThemeSurfacesHostComponent>;
  let originalTheme: string | null;
  let originalScheme: string;

  beforeEach(async () => {
    originalTheme = document.documentElement.getAttribute('data-app-theme');
    originalScheme = document.documentElement.style.colorScheme;
    await TestBed.configureTestingModule({
      imports: [DashboardThemeSurfacesHostComponent, testTranslateModule()],
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardThemeSurfacesHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
    fixture.destroy();
    if (originalTheme === null) document.documentElement.removeAttribute('data-app-theme');
    else document.documentElement.setAttribute('data-app-theme', originalTheme);
    document.documentElement.style.colorScheme = originalScheme;
  });

  function resolvedToken(token: string): string {
    const probe = document.createElement('span');
    probe.style.color = `var(${token})`;
    fixture.nativeElement.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }

  for (const theme of [null, ...COMPILED_THEME_BASES]) {
    for (const scheme of ['light', 'dark']) {
      it(`keeps surfaces and content on the active palette (${theme ?? 'default'}, ${scheme})`, () => {
        if (theme === null) document.documentElement.removeAttribute('data-app-theme');
        else document.documentElement.setAttribute('data-app-theme', theme);
        // Also exercises the default light-dark() palette under both browser schemes.
        document.documentElement.style.colorScheme = scheme;
        const root = fixture.nativeElement as HTMLElement;
        const widgetSurface = resolvedToken('--mat-sys-surface-container-lowest');
        const pageSurface = resolvedToken('--mat-sys-surface-container-low');
        const foreground = resolvedToken('--mat-sys-on-surface');
        const secondary = resolvedToken('--mat-sys-on-surface-variant');

        // Two distinct surfaces: the page paints `--mat-sys-surface-container-low` and a widget
        // paints `--mat-sys-surface-container-lowest` — white in a light scheme, which is how the
        // shipped Web UI looks.
        //
        // Both used to be asserted against `--mat-sys-surface`. That kept the theme wiring honest
        // but locked in a visual defect: page and widget resolved to the same `#f9f9fc`, so every
        // widget lost its fill and was separated only by its border. Measured distance: 0.0.
        //
        // The intent of the check — nothing hardcoded, everything tracks the active palette — is
        // unchanged, since both values are still resolved palette tokens. The inequality is what
        // stops the two collapsing back together in any theme, and `light-dark()` means it holds
        // under both schemes rather than only the light one.
        expect(pageSurface)
          .withContext(`page and widget surfaces must differ (${theme ?? 'default'}, ${scheme})`)
          .not.toBe(widgetSurface);
        expect(getComputedStyle(root).backgroundColor).toBe(pageSurface);
        for (const selector of ['.widget', '.widget-header', '.widget-table th', '.ai-kpi-card']) {
          expect(getComputedStyle(root.querySelector(selector)!).backgroundColor)
            .withContext(`${selector} surface`)
            .toBe(widgetSurface);
        }
        for (const selector of [
          '.widget-header-title',
          '.widget-table td',
          '.contributor-cell',
          '.task-action',
          '.ai-kpi-text',
        ]) {
          expect(getComputedStyle(root.querySelector(selector)!).color)
            .withContext(`${selector} foreground`)
            .toBe(foreground);
        }
        for (const selector of [
          '.empty-row',
          '.widget-empty',
          '.task-doc-title',
          '.task-workflow',
        ]) {
          expect(getComputedStyle(root.querySelector(selector)!).color)
            .withContext(`${selector} secondary foreground`)
            .toBe(secondary);
        }
      });
    }
  }

  it('paints the page surface through content taller than the viewport', () => {
    fixture.nativeElement.querySelector('.dashboard-page').style.height = '1800px';
    expect(fixture.nativeElement.getBoundingClientRect().height).toBeGreaterThanOrEqual(1800);
  });
});
