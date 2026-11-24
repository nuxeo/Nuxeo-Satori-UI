import { HttpErrorResponse } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import { AppRegistryService, type RegistryApp } from '@agentic-ui/shared/app-registry';
import { TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { appConfig } from '../app.config';
import { AuthService } from '../auth/auth.service';
import { AppShellComponent } from './app-shell.component';

const app = (id: string, label: string | null, labelKey: string | null = null): RegistryApp => ({
  id,
  label,
  labelKey,
  url: `apps/${id}/`,
  files: ['app.json'],
  content: {},
});

/**
 * "Switch app" (docs/business-apps/development-plan.md, phase 0's demo, step 3): the settings menu
 * lists the apps the registry lets the person see when there is more than one, checks the one open,
 * and opens another by its id.
 */
describe('AppShellComponent — Switch app', () => {
  const authMock = {
    isAuthenticated: signal(true),
    username: signal('dana'),
    hasAdministrationAccess: signal(false),
    isAdministrator: signal(false),
    basicCredentials: () => null,
    shareAuthToken: () => null,
    logout: () => undefined,
  } as unknown as AuthService;

  let apps: ReturnType<typeof signal<readonly RegistryApp[]>>;
  let chosen: string[];

  beforeEach(async () => {
    apps = signal<readonly RegistryApp[]>([]);
    chosen = [];
    const registry = {
      apps,
      current: computed(() => apps()[1] ?? apps()[0] ?? null),
      choose: (id: string) => chosen.push(id),
      load: () => Promise.resolve(),
      refresh: () => Promise.resolve(false),
      file: (path: string) => throwError(() => new HttpErrorResponse({ status: 404, url: path })),
      labelLanguages: () => of([]),
    };
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [...appConfig.providers, provideHttpClientTesting()],
    })
      .overrideProvider(AuthService, { useValue: authMock })
      .overrideProvider(AppRegistryService, { useValue: registry })
      .compileComponents();
  });

  function openSettings(): HTMLElement {
    const fixture = TestBed.createComponent(AppShellComponent);
    // Supplied rather than loaded: `provideHttpClientTesting()` serves no catalogue
    // (clipboard-nav-aria-label.spec.ts says why). Marked, so a key's text is told from its id.
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('zz', {
      'shell.menu.switch-app': '⟦Switch app⟧',
      'payers.app.directory': '⟦Directory⟧',
    });
    translate.use('zz');
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      '.header-settings-menu-button',
    ) as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    return TestBed.inject(OverlayContainer).getContainerElement();
  }

  it('is not offered with one app or none', () => {
    expect(openSettings().querySelector('.switch-app-menu-item')).toBeNull();

    TestBed.inject(OverlayContainer).getContainerElement().innerHTML = '';
    apps.set([app('payers-claims', 'Claims')]);
    expect(openSettings().querySelector('.switch-app-menu-item')).toBeNull();
  });

  it('lists every app with more than one, the one open checked, and opens the one chosen', async () => {
    apps.set([
      app('payers-claims', 'Claims'),
      app('staff-directory', null, 'payers.app.directory'),
      app('unnamed', null, 'payers.app.untranslated'),
      app('cases', null),
    ]);
    const overlay = openSettings();
    const item = overlay.querySelector('.switch-app-menu-item') as HTMLButtonElement;
    expect(item).withContext('the Switch app item').not.toBeNull();
    expect(item.textContent).toContain('⟦Switch app⟧');

    item.click();
    await new Promise((resolve) => setTimeout(resolve));
    const options = [...overlay.querySelectorAll<HTMLButtonElement>('.switch-app-option')];

    // The label, else the key's text, else the id.
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      'Claims',
      '⟦Directory⟧',
      'unnamed',
      'cases',
    ]);
    expect(options.every((option) => option.getAttribute('role') === 'menuitemradio')).toBe(true);
    expect(options.map((option) => option.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);

    options[3]?.click();
    expect(chosen).toEqual(['cases']);
  });
});
