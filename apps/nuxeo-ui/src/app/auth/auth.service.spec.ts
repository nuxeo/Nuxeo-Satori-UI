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
   * `/nuxeo/logout` 404s when there is no session to end, and 302s, ending it, when there is one —
   * measured on the local Nuxeo 2025.10. An earlier version took the first 404 to mean the endpoint
   * was absent and never called it again in that page load, so a session that appeared afterwards
   * (a Web UI sign-in on the same host, or the previous user's) decided who the next sign-in was.
   */
  it('still signs in when /nuxeo/logout answers 404, and ends the session again on the next sign-in', () => {
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

    // Second sign-in: the 404 is not remembered, so the session is ended again.
    service.logout();
    service.login('member01', 'secret', false).subscribe();
    const logout = httpMock.expectOne((r) => r.url.includes('/nuxeo/logout'));
    expect(logout.request.withCredentials).toBeTrue();
    logout.flush('');
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

  it("keeps the user's groups from /me, for the rule context's app.rules.inGroup", () => {
    expect(service.groups()).toEqual([]);
    service.login('poweruser01', 'secret', false).subscribe();

    httpMock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    httpMock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me'))
      .flush({
        id: 'poweruser01',
        properties: { username: 'poweruser01', groups: ['claims-team'] },
        // A subgroup's parent, and a virtual group, are Nuxeo's membership too.
        extendedGroups: [{ name: 'claims-team' }, { name: 'member-services' }, { name: 'members' }],
        isAdministrator: false,
      });
    httpMock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && r.withCredentials)
      .flush({ id: 'poweruser01' });

    expect(service.groups()).toEqual(['claims-team', 'member-services', 'members']);
    // The stored groups alone still decide isPowerUser, as before.
    expect(service.isPowerUser()).toBe(false);

    // And they are what a reload restores, not the stored groups alone.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: NUXEO_API_ORIGIN, useValue: '' }],
    });
    expect(TestBed.inject(AuthService).groups()).toEqual([
      'claims-team',
      'member-services',
      'members',
    ]);
  });

  it("keeps a cookie session's nested and virtual groups when /me is read again", () => {
    sessionStorage.setItem(
      'agentic_ui_nuxeo_session',
      JSON.stringify({
        kind: 'cookie',
        username: 'member01',
        isAdministrator: false,
        groups: ['claims-team'],
        allGroups: ['claims-team', 'members'],
      }),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: NUXEO_API_ORIGIN, useValue: '' }],
    });
    const restored = TestBed.inject(AuthService);
    const mock = TestBed.inject(HttpTestingController);

    restored.refreshCurrentUser().subscribe();
    mock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me'))
      .flush({
        id: 'member01',
        properties: { username: 'member01', groups: ['claims-team'] },
        extendedGroups: [{ name: 'claims-team' }, { name: 'member-services' }, { name: 'members' }],
      });

    expect(restored.groups()).toEqual(['claims-team', 'member-services', 'members']);
    mock.verify();
  });

  it('gives a session stored before every group was kept its stored groups', () => {
    sessionStorage.setItem(
      'agentic_ui_nuxeo_session',
      JSON.stringify({
        kind: 'basic',
        username: 'member01',
        basic: btoa('member01:secret'),
        isAdministrator: false,
        groups: ['claims-team'],
      }),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: NUXEO_API_ORIGIN, useValue: '' }],
    });
    expect(TestBed.inject(AuthService).groups()).toEqual(['claims-team']);
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

  /**
   * This spec used to assert the opposite — that the stored name survived `/me` naming someone
   * else — which is the defect itself: the header said one user while every request ran as another,
   * with that user's administrator flag.
   */
  it('signs a restored password session out when /me answers as someone else', () => {
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
    const warn = spyOn(console, 'warn');

    hydrated.ensureHydrated().subscribe();
    mock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    mock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me'))
      .flush({
        id: 'Administrator',
        properties: { username: 'Administrator', groups: ['administrators'] },
        isAdministrator: true,
      });
    // No browser-session call: the restored session is not carried on.
    mock.expectNone((r) => r.url.includes('/nuxeo/api/v1/me'));

    expect(hydrated.isAuthenticated()).toBe(false);
    expect(hydrated.isAdministrator()).toBe(false);
    expect(sessionStorage.getItem('agentic_ui_nuxeo_session')).toBeNull();
    expect(warn).toHaveBeenCalledWith(jasmine.stringContaining('Administrator'));
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

/**
 * Nuxeo answers a request as the user cached in its HTTP session before it reads `Authorization`,
 * and a same-origin XHR sends the JSESSIONID whatever `withCredentials` says. Measured on the local
 * Nuxeo 2025.10 with an Administrator session cookie: `/me` answered Administrator for a member's
 * own credentials, for a wrong password, and for a user that does not exist. These specs flush
 * what that server answered, and assert the sign-in is refused or ended rather than carried on.
 */
describe('AuthService with a Nuxeo session cookie for another user', () => {
  const ADMIN_ME = {
    id: 'Administrator',
    properties: { username: 'Administrator', groups: ['administrators'] },
    isAdministrator: true,
  };
  const MEMBER_ME = {
    id: 'member01',
    properties: { username: 'member01', groups: ['members'] },
    isAdministrator: false,
  };
  const STORAGE_KEY = 'agentic_ui_nuxeo_session';
  const SIGNED_OUT_KEY = 'agentic_ui_signed_out';

  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
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

  /** Runs `login()` and returns what it ended with, so a refusal can be asserted by key. */
  function signIn(username: string, remember = false): { error: unknown; completed: boolean } {
    const outcome = { error: undefined as unknown, completed: false };
    service.login(username, 'secret', remember).subscribe({
      error: (e: unknown) => (outcome.error = e),
      complete: () => (outcome.completed = true),
    });
    return outcome;
  }

  function probe() {
    return httpMock.expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && !r.withCredentials);
  }

  function browserSessionCall() {
    return httpMock.expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && r.withCredentials);
  }

  function restore(session: object): { restored: AuthService; mock: HttpTestingController } {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: NUXEO_API_ORIGIN, useValue: '' }],
    });
    return { restored: TestBed.inject(AuthService), mock: TestBed.inject(HttpTestingController) };
  }

  it('refuses a sign-in that /me answers as another user, and keeps nothing from it', () => {
    const outcome = signIn('member01', true);
    httpMock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    probe().flush(ADMIN_ME);
    // Refused before the browser-session call, so nothing is established for the wrong user.
    httpMock.expectNone((r) => r.url.includes('/nuxeo/api/v1/me'));

    expect(outcome.completed).toBeFalse();
    expect((outcome.error as { messageKey?: string }).messageKey).toBe(
      'login.message.session-conflict',
    );
    expect(service.isAuthenticated()).toBeFalse();
    expect(service.isAdministrator()).toBeFalse();
    expect(service.username()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('refuses a sign-in whose browser-session call answers as another user', () => {
    // The probe can be right while the cookie-carrying call is not: on a cross-origin deployment
    // only the latter sends cookies, and its session is the one every <img> and download uses.
    sessionStorage.setItem(SIGNED_OUT_KEY, '1');
    const outcome = signIn('member01', true);
    httpMock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    probe().flush(MEMBER_ME);
    const establish = browserSessionCall();
    expect(establish.request.headers.get('Authorization')).toBe(`Basic ${btoa('member01:secret')}`);
    establish.flush(ADMIN_ME);

    expect((outcome.error as { messageKey?: string }).messageKey).toBe(
      'login.message.session-conflict',
    );
    expect(service.isAuthenticated()).toBeFalse();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    // Left as a failed sign-in leaves it: a reload must not pick the other session up.
    expect(sessionStorage.getItem(SIGNED_OUT_KEY)).toBe('1');
  });

  it('refuses a /me that names nobody, rather than trusting its administrator flag', () => {
    const outcome = signIn('member01');
    httpMock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    probe().flush({ isAdministrator: true });
    httpMock.expectNone((r) => r.url.includes('/nuxeo/api/v1/me'));

    expect((outcome.error as { messageKey?: string }).messageKey).toBe(
      'login.message.session-conflict',
    );
    expect(service.isAuthenticated()).toBeFalse();
  });

  it('accepts a /me that differs from the typed username only in case', () => {
    // A case-insensitive directory (LDAP, commonly) accepts JDOE and reports jdoe. Refusing that
    // would lock a legitimate user out; it cannot let a different user in.
    const outcome = signIn('MEMBER01');
    httpMock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    probe().flush(MEMBER_ME);
    browserSessionCall().flush({ id: 'member01' });

    expect(outcome.completed).toBeTrue();
    expect(service.isAuthenticated()).toBeTrue();
    expect(service.isAdministrator()).toBeFalse();
  });

  it('still tolerates a failed browser-session call: that costs an image, not the sign-in', () => {
    const outcome = signIn('member01');
    httpMock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    probe().flush(MEMBER_ME);
    browserSessionCall().flush('nope', { status: 500, statusText: 'Server Error' });

    expect(outcome.completed).toBeTrue();
    expect(service.username()).toBe('member01');
  });

  it('reports a wrong password as invalid credentials, as before', () => {
    const outcome = signIn('member01');
    httpMock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    probe().flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect((outcome.error as { messageKey?: string }).messageKey).toBe(
      'login.message.invalid-credentials',
    );
  });

  it('ends a restored password session when the browser-session call answers as someone else', () => {
    const { restored, mock } = restore({
      kind: 'basic',
      username: 'member01',
      basic: btoa('member01:secret'),
      isAdministrator: false,
      groups: ['members'],
    });
    spyOn(console, 'warn');

    restored.ensureHydrated().subscribe();
    mock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    mock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && !r.withCredentials)
      .flush(MEMBER_ME);
    mock.expectOne((r) => r.url.includes('/nuxeo/api/v1/me') && r.withCredentials).flush(ADMIN_ME);

    expect(restored.isAuthenticated()).toBeFalse();
    mock.verify();
  });

  it('ends a password session when refreshing /me answers as someone else', () => {
    const { restored, mock } = restore({
      kind: 'basic',
      username: 'member01',
      basic: btoa('member01:secret'),
      isAdministrator: false,
      groups: ['members'],
    });
    spyOn(console, 'warn');

    restored.refreshCurrentUser().subscribe();
    mock.expectOne((r) => r.url.includes('/nuxeo/logout')).flush('');
    mock.expectOne((r) => r.url.includes('/nuxeo/api/v1/me')).flush(ADMIN_ME);

    expect(restored.isAuthenticated()).toBeFalse();
    expect(restored.isAdministrator()).toBeFalse();
    mock.verify();
  });

  /**
   * The SSO path has no password to check against: the session cookie *is* the sign-in, so the user
   * is whoever `/me` names. None of the above may touch it — no logout, no Basic, no comparison.
   */
  it('still signs an SSO cookie session in as whoever /me names', () => {
    service.ensureHydrated().subscribe();

    httpMock.expectNone((r) => r.url.includes('/nuxeo/logout'));
    const me = httpMock.expectOne((r) => r.url.includes('/nuxeo/api/v1/me'));
    expect(me.request.headers.has('Authorization')).toBeFalse();
    me.flush({ id: 'sso-user', properties: { username: 'sso-user', groups: ['members'] } });

    expect(service.isAuthenticated()).toBeTrue();
    expect(service.username()).toBe('sso-user');
    expect(service.basicCredentials()).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}').kind).toBe('cookie');
  });

  it('still restores an SSO cookie session as whoever /me names now', () => {
    const { restored, mock } = restore({
      kind: 'cookie',
      username: 'sso-user',
      isAdministrator: false,
      groups: ['members'],
    });

    restored.ensureHydrated().subscribe();
    mock.expectNone((r) => r.url.includes('/nuxeo/logout'));
    mock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me'))
      .flush({ id: 'sso-user', properties: { username: 'sso-user', groups: ['members'] } });

    expect(restored.isAuthenticated()).toBeTrue();
    expect(restored.username()).toBe('sso-user');
    mock.verify();
  });
});

describe('AuthService share landing', () => {
  const KEY = 'nxs.sharedDocumentPath';
  const RECIPIENT = 'transient/recipient@example.invalid';
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [testTranslateModule(), HttpClientTestingModule],
      providers: [{ provide: NUXEO_API_ORIGIN, useValue: '' }],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Anything the test left in flight is not what it is checking.
    httpMock.match(() => true);
    httpMock.verify();
    history.replaceState(null, '', '/');
    sessionStorage.clear();
    localStorage.clear();
  });

  it('remembers the route a token-bearing link opened, for the principal it signed in, and strips the token', () => {
    history.replaceState(null, '', '/#/browse/default-domain/workspaces/ws-1/doc?token=share-abc');

    service.ensureHydrated().subscribe();

    const req = httpMock.expectOne((r) => r.url.includes('/nuxeo/api/v1/me'));
    expect(req.request.headers.get('X-Authentication-Token')).toBe('share-abc');
    req.flush({ id: RECIPIENT, properties: { username: RECIPIENT, groups: [] } });

    expect(service.username()).toBe(RECIPIENT);
    expect(JSON.parse(sessionStorage.getItem(KEY) ?? 'null')).toEqual({
      user: RECIPIENT,
      path: '/browse/default-domain/workspaces/ws-1/doc',
    });
    expect(location.hash).not.toContain('token=');
  });

  it('remembers nothing when the token exchange fails, and forgets a previous landing', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ user: RECIPIENT, path: '/browse/old' }));
    history.replaceState(null, '', '/#/browse/default-domain/workspaces/ws-1/doc?token=bad');

    service.ensureHydrated().subscribe();

    httpMock
      .expectOne((r) => r.url.includes('/nuxeo/api/v1/me'))
      .flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('forgets the remembered landing on sign-in', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ user: RECIPIENT, path: '/browse/old' }));

    service.login('member01', 'secret', false).subscribe({ error: () => undefined });

    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('forgets the remembered landing on sign-out', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ user: RECIPIENT, path: '/browse/old' }));

    service.logout();

    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});
