import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { APP_CONFIG_FORMAT, AppConfigService } from '@nuxeo/satori-platform/app-config';

import { appConfig } from '../app.config';
import { AuthService } from '../auth/auth.service';
import { AppShellComponent } from './app-shell.component';

/**
 * NXSAT-313 — a logo named in `bootstrap.json` replaces the Satori word mark in the header slot.
 *
 * Driven through the real `AppConfigService` and a flushed bootstrap response rather than a
 * stubbed signal, so the parse, the rejection of unsafe sources and the resolution against the
 * configuration directory are all on the path being asserted.
 */
describe('AppShellComponent — configured logo (branding.logo)', () => {
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
            { name: 'acme', component: 'com.acme', bundle: 'com.acme', source: 'x', content: body },
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

  it('renders the configured logo in the header logo slot instead of the word mark', async () => {
    const header = await headerWithBootstrap({
      branding: { logo: { src: 'acme-logo.svg', alt: 'Acme Insurance' } },
    });

    const img = header.querySelector('img[satAppHeaderLogo]');
    expect(img).withContext('the logo must occupy the projected logo slot').toBeTruthy();
    expect(new URL(img!.getAttribute('src')!, document.baseURI).pathname).toBe(
      '/agentic-ui-config/acme-logo.svg',
    );
    expect(img!.getAttribute('alt'))
      .withContext('the header is named by its heading, so the logo is decorative')
      .toBe('');
    expect(img!.getAttribute('crossorigin'))
      .withContext('a redirect from a remote logo must not carry the session cookie')
      .toBe('anonymous');
    expect(header.querySelector('sat-word-mark-logo')).toBeNull();
  });

  it('keeps the word mark when no logo is configured', async () => {
    const header = await headerWithBootstrap({ branding: { applicationTitle: 'Acme' } });

    expect(header.querySelector('sat-word-mark-logo')).toBeTruthy();
    expect(header.querySelector('img[satAppHeaderLogo]')).toBeNull();
  });

  it('keeps the word mark when the configured src is a Nuxeo REST path', async () => {
    const header = await headerWithBootstrap({
      branding: { logo: { src: '/nuxeo/api/v1/id/abc/@blob/file:content', alt: 'x' } },
    });

    expect(header.querySelector('sat-word-mark-logo')).toBeTruthy();
    expect(header.querySelector('img[satAppHeaderLogo]')).toBeNull();
  });
});
