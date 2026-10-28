import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import {
  NUXEO_API_ORIGIN,
  SelectionService,
  BrowseContextService,
  ClipboardTargetService,
} from '@nuxeo/satori-platform/nuxeo-client';
import { AuthService } from './auth.service';
import { testTranslateModule } from '../i18n/translate-testing';

describe('AuthService poweruser access', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    // The "/nuxeo/logout is absent" memo is static, so without this a test that flushes a 404
    // would silently suppress the probe in every test after it.
    AuthService.resetNuxeoLogoutProbe();
    TestBed.configureTestingModule({
      imports: [testTranslateModule(), HttpClientTestingModule],
      providers: [{ provide: NUXEO_API_ORIGIN, useValue: '' }],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    sessionStorage.clear();
    localStorage.clear();
  });

  /**
   * A Nuxeo with no JSF web module 404s `/nuxeo/logout`. Measured on the local Docker stack, where
   * `/nuxeo/logout`, `/nuxeo/logout.faces` and `/nuxeo/nxstartup.faces?nxo=logout` all 404. Login
   * still has to work, and the probe must not re-fire on every subsequent sign-in and hydration —
   * each failed attempt logged a console error that looked like a defect in whatever was being
   * debugged at the time.
   */
  it('still signs in when /nuxeo/logout is absent, and stops probing it', () => {
    service.login('member01', 'secret', false).subscribe();

    httpMock
      .expectOne((r) => r.url.includes('/nuxeo/logout'))
      .flush('not found', { status: 404, statusText: 'Not Found' });
    httpMock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && !r.withCredentials)
      .flush({ id: 'member01', properties: { username: 'member01', groups: ['members'] } });
    httpMock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && r.withCredentials)
      .flush({ id: 'member01' });

    expect(service.isAuthenticated()).toBe(true);
    expect(service.username()).toBe('member01');

    // Second sign-in: no logout request at all this time.
    service.login('member01', 'secret', false).subscribe();
    httpMock.expectNone((r) => r.url.includes('/nuxeo/logout'));
    httpMock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && !r.withCredentials)
      .flush({ id: 'member01', properties: { username: 'member01', groups: ['members'] } });
    httpMock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && r.withCredentials)
      .flush({ id: 'member01' });

    expect(service.isAuthenticated()).toBe(true);
  });

  it('keeps probing /nuxeo/logout when it answers normally', () => {
    service.login('member01', 'secret', false).subscribe();
    httpMock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    httpMock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && !r.withCredentials)
      .flush({ id: 'member01', properties: { username: 'member01', groups: ['members'] } });
    httpMock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && r.withCredentials)
      .flush({ id: 'member01' });

    // A 200 is not a reason to stop clearing a stale cookie session.
    service.login('member01', 'secret', false).subscribe();
    httpMock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    httpMock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && !r.withCredentials)
      .flush({ id: 'member01', properties: { username: 'member01', groups: ['members'] } });
    httpMock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && r.withCredentials)
      .flush({ id: 'member01' });

    expect(service.isAuthenticated()).toBe(true);
  });

  it('sets isPowerUser and hasAdministrationAccess after login', () => {
    service.login('poweruser01', 'secret', false).subscribe();

    httpMock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    httpMock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me'))
      .flush({
        id: 'poweruser01',
        properties: {
          username: 'poweruser01',
          groups: ['members', 'powerusers'],
        },
        isAdministrator: false,
      });
    httpMock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && r.withCredentials)
      .flush({ id: 'poweruser01' });

    expect(service.isPowerUser()).toBe(true);
    expect(service.isAdministrator()).toBe(false);
    expect(service.hasAdministrationAccess()).toBe(true);
  });

  it('does not grant administration access to regular members', () => {
    service.login('member01', 'secret', false).subscribe();

    httpMock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    const req = httpMock.expectOne((r) => r.url.includes('/nuxeo/api/v1/me'));
    expect(req.request.withCredentials).toBeFalse();
    req.flush({
      id: 'member01',
      properties: {
        username: 'member01',
        groups: ['members'],
      },
      isAdministrator: false,
    });
    httpMock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && r.withCredentials)
      .flush({ id: 'member01' });

    expect(service.isPowerUser()).toBe(false);
    expect(service.hasAdministrationAccess()).toBe(false);
  });

  it('restores poweruser groups from persisted session', () => {
    sessionStorage.setItem(
      'agentic_ui_nuxeo_session',
      JSON.stringify({
        kind: 'basic',
        username: 'poweruser01',
        basic: btoa('poweruser01:secret'),
        isAdministrator: false,
        groups: ['members', 'powerusers'],
      }),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: NUXEO_API_ORIGIN, useValue: '' }],
    });
    const restored = TestBed.inject(AuthService);
    expect(restored.isPowerUser()).toBe(true);
    expect(restored.hasAdministrationAccess()).toBe(true);
  });

  it('preserves basic-auth username on hydration when /me matches stored user', () => {
    sessionStorage.setItem(
      'agentic_ui_nuxeo_session',
      JSON.stringify({
        kind: 'basic',
        username: 'test-user',
        basic: btoa('test-user:test-pass'),
        isAdministrator: true,
        groups: ['administrators'],
      }),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: NUXEO_API_ORIGIN, useValue: '' }],
    });
    const hydrated = TestBed.inject(AuthService);
    const mock = TestBed.inject(HttpTestingController);

    hydrated.ensureHydrated().subscribe();
    mock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    mock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me'))
      .flush({
        id: 'test-user',
        properties: {
          username: 'test-user',
          email: 'test.user@gmail.com',
          groups: ['administrators'],
        },
        isAdministrator: true,
      });
    mock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && r.withCredentials)
      .flush({ id: 'test-user' });

    expect(hydrated.username()).toBe('test-user');
    mock.verify();
  });

  it('clears basic-auth session when /me returns 403 during hydration', () => {
    sessionStorage.setItem(
      'agentic_ui_nuxeo_session',
      JSON.stringify({
        kind: 'basic',
        username: 'test-user',
        basic: btoa('test-user:test-pass'),
        isAdministrator: false,
        groups: ['members'],
      }),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: NUXEO_API_ORIGIN, useValue: '' }],
    });
    const hydrated = TestBed.inject(AuthService);
    const mock = TestBed.inject(HttpTestingController);

    hydrated.ensureHydrated().subscribe();
    mock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    mock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me'))
      .flush('Forbidden', { status: 403, statusText: 'Forbidden' });

    expect(hydrated.isAuthenticated()).toBe(false);
    mock.verify();
  });

  it('preserves basic-auth username on hydration when /me principal differs from stale cookie', () => {
    sessionStorage.setItem(
      'agentic_ui_nuxeo_session',
      JSON.stringify({
        kind: 'basic',
        username: 'test-user',
        basic: btoa('test-user:test-pass'),
        isAdministrator: true,
        groups: ['administrators'],
      }),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: NUXEO_API_ORIGIN, useValue: '' }],
    });
    const hydrated = TestBed.inject(AuthService);
    const mock = TestBed.inject(HttpTestingController);

    hydrated.ensureHydrated().subscribe();
    mock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    mock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me'))
      .flush({
        id: 'test.user@gmail.com',
        properties: { username: 'test.user@gmail.com', groups: ['members'] },
        isAdministrator: false,
      });
    mock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && r.withCredentials)
      .flush({ id: 'test-user' });

    expect(hydrated.isAuthenticated()).toBe(true);
    expect(hydrated.username()).toBe('test-user');
    mock.verify();
  });

  it('logout clears browse selection and navigation context', () => {
    const selection = TestBed.inject(SelectionService);
    const browseContext = TestBed.inject(BrowseContextService);
    const clipboardTarget = TestBed.inject(ClipboardTargetService);

    selection.toggle('doc-1', 'Doc 1');
    selection.setClearOnlyMode(true);
    browseContext.setFromNuxeoPath('/default-domain/workspaces/demo');
    clipboardTarget.setTarget({
      uid: 'folder-1',
      title: 'Demo',
      type: 'Folder',
      path: '/default-domain/workspaces/demo',
      lastModified: '',
      properties: {},
    });

    service.login('member01', 'secret', false).subscribe();
    httpMock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    httpMock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me'))
      .flush({
        id: 'member01',
        properties: { username: 'member01', groups: ['members'] },
        isAdministrator: false,
      });
    httpMock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && r.withCredentials)
      .flush({ id: 'member01' });

    service.logout();

    expect(selection.selectedCount()).toBe(0);
    expect(selection.clearOnlyMode()).toBe(false);
    expect(browseContext.contextPath()).toBe('/');
    expect(clipboardTarget.target()).toBeNull();
  });

  it('authenticates external share links via token', () => {
    service.authenticateWithShareToken('share-token-abc').subscribe();

    const req = httpMock.expectOne((r) => r.url.includes('/nuxeo/api/v1/me'));
    expect(req.request.url).not.toContain('token=');
    expect(req.request.headers.get('X-Authentication-Token')).toBe('share-token-abc');
    expect(req.request.withCredentials).toBeTrue();
    req.flush({
      id: 'transient/guest@example.com',
      properties: { username: 'transient/guest@example.com', groups: [] },
      isAdministrator: false,
    });

    expect(service.isAuthenticated()).toBeTrue();
    expect(service.username()).toBe('transient/guest@example.com');
    expect(service.shareAuthToken()).toBeNull();
  });

  it('clears share token when token authentication fails', () => {
    service.authenticateWithShareToken('bad-token').subscribe();

    const req = httpMock.expectOne((r) => r.url.includes('/nuxeo/api/v1/me'));
    expect(req.request.url).not.toContain('token=');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(service.isAuthenticated()).toBeFalse();
    expect(service.shareAuthToken()).toBeNull();
  });
});
