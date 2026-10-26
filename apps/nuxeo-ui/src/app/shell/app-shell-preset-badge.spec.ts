import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import {
  APP_CONFIG_FORMAT,
  AppConfigService,
  PRESET_STORAGE_KEY,
} from '@nuxeo/satori-platform/app-config';

import { appConfig } from '../app.config';
import { AuthService } from '../auth/auth.service';
import { AppShellComponent } from './app-shell.component';

/**
 * NXSAT-312 — the preset badge is visible in the real header.
 *
 * `sat-app-header` projects only attribute-selected content and has no default slot, so an
 * element without one of its attributes is dropped without a trace. The badge's own spec passes
 * either way; this one renders the shell, so a badge that never reaches the page fails here.
 */
describe('AppShellComponent — presales preset badge', () => {
  let http: HttpTestingController;

  const authMock: Partial<Record<keyof AuthService, unknown>> = {
    isAuthenticated: signal(true),
    username: signal('test.user'),
    hasAdministrationAccess: signal(true),
    isAdministrator: signal(true),
    basicCredentials: () => null,
    shareAuthToken: () => null,
    logout: () => undefined,
  };

  const presales = (presetSwitching: boolean) => ({
    presales: {
      presetSwitching,
      presets: { globex: { label: 'Globex Logistics', bootstrap: {}, manifest: {} } },
    },
  });

  beforeEach(async () => {
    localStorage.setItem(PRESET_STORAGE_KEY, 'globex');
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [...appConfig.providers, provideHttpClientTesting()],
    })
      .overrideProvider(AuthService, { useValue: authMock })
      .compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    localStorage.removeItem(PRESET_STORAGE_KEY);
    const emptyDocumentList = {
      entries: [],
      totalSize: 0,
      currentPageSize: 0,
      currentPageIndex: 0,
      numberOfPages: 0,
    };
    http.match(() => true).forEach((request) => request.flush(emptyDocumentList));
    http.verify();
  });

  async function headerWithBootstrap(body: Record<string, unknown>): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(AppShellComponent);
    const loaded = TestBed.inject(AppConfigService).load();
    http
      .match((request) => request.url.endsWith('/agentic-ui-config/bootstrap.json'))
      .forEach((request) =>
        request.flush({
          format: APP_CONFIG_FORMAT,
          layer: 'bootstrap',
          fragments: [
            { name: 'demo', component: 'com.demo', bundle: 'com.demo', source: 'x', content: body },
          ],
          diagnostics: [],
        }),
      );
    http
      .match((request) => request.url.endsWith('/agentic-ui-config/manifest.json'))
      .forEach((request) => request.flush('', { status: 404, statusText: 'Not Found' }));
    await loaded;
    fixture.detectChanges();

    const header = (fixture.nativeElement as HTMLElement).querySelector('sat-app-header');
    expect(header).withContext('the shell must render the app header').toBeTruthy();
    return header as HTMLElement;
  }

  it('projects the badge into the header when a preset is in force', async () => {
    const header = await headerWithBootstrap(presales(true));

    const badge = header.querySelector('.preset-badge');
    expect(badge).withContext('the badge must reach a projected header slot').toBeTruthy();
    expect(badge!.getAttribute('data-preset')).toBe('globex');
  });

  it('shows no badge when no package enables switching', async () => {
    const header = await headerWithBootstrap(presales(false));

    expect(header.querySelector('.preset-badge')).toBeNull();
  });
});
