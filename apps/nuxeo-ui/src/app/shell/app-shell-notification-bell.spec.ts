import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { APP_CONFIG_FORMAT, AppConfigService } from '@nuxeo/satori-platform/app-config';
import { NUXEO_BACKGROUND_REQUEST } from '@nuxeo/satori-platform/nuxeo-client';

import { appConfig } from '../app.config';
import { AuthService } from '../auth/auth.service';
import { AppShellComponent } from './app-shell.component';

/**
 * The notification centre's bell in the shell's header (libs/shared/notifications): drawn beside
 * the header's actions, checking for the signed-in user with background requests only, and turned
 * off by a package's `featureToggles["notifications.bell"]`.
 */
describe('AppShellComponent — notification bell', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<AppShellComponent>;

  const authMock: Partial<Record<keyof AuthService, unknown>> = {
    isAuthenticated: signal(true),
    username: signal('test.user'),
    hasAdministrationAccess: signal(false),
    isAdministrator: signal(false),
    groups: signal([]),
    basicCredentials: () => null,
    shareAuthToken: () => null,
    logout: () => undefined,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [...appConfig.providers, provideHttpClientTesting()],
    })
      .overrideProvider(AuthService, { useValue: authMock })
      .compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match(() => true).forEach((request) => request.flush({ entries: [] }));
    http.verify();
  });

  async function shellWithManifest(content: Record<string, unknown> | null): Promise<HTMLElement> {
    fixture = TestBed.createComponent(AppShellComponent);
    const loaded = TestBed.inject(AppConfigService).load();
    http
      .match((request) => request.url.endsWith('/agentic-ui-config/bootstrap.json'))
      .forEach((request) => request.flush('', { status: 404, statusText: 'Not Found' }));
    http
      .match((request) => request.url.endsWith('/agentic-ui-config/manifest.json'))
      .forEach((request) =>
        content
          ? request.flush({
              format: APP_CONFIG_FORMAT,
              layer: 'manifest',
              fragments: [
                { name: 'acme', component: 'com.acme', bundle: 'com.acme', source: 'x', content },
              ],
              diagnostics: [],
            })
          : request.flush('', { status: 404, statusText: 'Not Found' }),
      );
    await loaded;
    // No catalogue is served, so the compiled-in English fallback names the bell: the bell's name
    // is bound to an accessible name, which `en-fallback.ts` must carry for exactly this case.
    http
      .match((request) => /i18n\/[A-Za-z-]+\.json$/.test(request.url))
      .forEach((request) => request.flush('', { status: 404, statusText: 'Not Found' }));
    fixture.detectChanges();
    // Not `whenStable`: the shell's other reads stay pending here, and the application with them.
    await Promise.resolve();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('draws the bell among the header actions, named with its count', async () => {
    const shell = await shellWithManifest(null);
    const actions = shell.querySelector('[satAppHeaderActions]');
    const bell = actions?.querySelector('lib-notification-bell button');
    expect(bell).withContext('the bell sits with the header actions').toBeTruthy();
    expect(bell?.getAttribute('aria-label')).toBe('Notifications, 0 unread');
    // Before the settings menu, which stays the last action.
    const buttons = [...(actions?.querySelectorAll('button') ?? [])];
    expect(buttons.at(-1)?.classList.contains('header-settings-menu-button')).toBeTrue();
  });

  // That the idle timer ignores them is the interceptor's spec (nuxeo-auth.interceptor.spec.ts).
  it('checks for the signed-in user with background requests only', async () => {
    await shellWithManifest(null);
    const tasks = http.match((request) => request.url.endsWith('/nuxeo/api/v1/task'));
    const followed = http.match((request) =>
      request.url.endsWith('/nuxeo/api/v1/automation/Repository.Query'),
    );
    expect(tasks.length).withContext('the bell asks for the open tasks').toBe(1);
    expect(tasks[0]?.request.params.get('userId')).toBe('test.user');
    expect(followed.length).withContext('the bell asks for the followed records').toBe(1);
    for (const request of [...tasks, ...followed]) {
      expect(request.request.context.get(NUXEO_BACKGROUND_REQUEST))
        .withContext(request.request.url)
        .toBeTrue();
      request.flush({ entries: [] });
    }
  });

  it('is not drawn when a package turns notifications.bell off', async () => {
    const shell = await shellWithManifest({ featureToggles: { 'notifications.bell': false } });
    expect(shell.querySelector('lib-notification-bell')).toBeNull();
    expect(shell.querySelector('.header-settings-menu-button')).toBeTruthy();
  });
});
