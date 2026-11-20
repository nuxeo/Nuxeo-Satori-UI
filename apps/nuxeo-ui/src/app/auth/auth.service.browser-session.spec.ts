import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';
import { AuthService } from './auth.service';
import { NUXEO_COOKIE_SESSION_ONLY, NUXEO_ESTABLISH_BROWSER_SESSION } from './nuxeo-auth.context';
import { testTranslateModule } from '../i18n/translate-testing';

describe('AuthService browser session for NEV', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  function setup(kind: 'basic' | 'cookie' | null = 'basic'): void {
    sessionStorage.clear();
    localStorage.clear();
    if (kind)
      sessionStorage.setItem(
        'agentic_ui_nuxeo_session',
        JSON.stringify({
          kind,
          username: 'member',
          basic: kind === 'basic' ? btoa('member:secret') : undefined,
          isAdministrator: false,
          groups: ['members'],
        }),
      );
    TestBed.configureTestingModule({
      imports: [testTranslateModule(), HttpClientTestingModule],
      providers: [{ provide: NUXEO_API_ORIGIN, useValue: '' }],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  }

  function cookieProbe() {
    const request = http.expectOne('/nuxeo/api/v1/me');
    expect(request.request.context.get(NUXEO_COOKIE_SESSION_ONLY)).toBeTrue();
    expect(request.request.withCredentials).toBeTrue();
    return request;
  }

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('accepts an existing cookie only for the signed-in user', () => {
    setup();
    let ready: boolean | undefined;
    auth.ensureBrowserSession().subscribe((value) => (ready = value));
    cookieProbe().flush({ id: 'member' });
    expect(ready).toBeTrue();
    http.expectNone('/nuxeo/login.jsp');
  });

  it('repairs an expired cookie before launch and verifies it without Basic', () => {
    setup();
    let ready: boolean | undefined;
    auth.ensureBrowserSession().subscribe((value) => (ready = value));
    cookieProbe().flush('', { status: 401, statusText: 'Unauthorized' });
    const page = http.expectOne('/nuxeo/login.jsp');
    expect(page.request.context.get(NUXEO_COOKIE_SESSION_ONLY)).toBeTrue();
    page.flush('<html>Login</html>');
    const basic = http.expectOne('/nuxeo/api/v1/me');
    expect(basic.request.context.get(NUXEO_ESTABLISH_BROWSER_SESSION)).toBeTrue();
    basic.flush({ id: 'member' });
    expect(ready).toBeUndefined();
    cookieProbe().flush({ id: 'member' });
    expect(ready).toBeTrue();
    // A previous successful launch never bypasses the next cookie check.
    auth.ensureBrowserSession().subscribe((value) => (ready = value));
    cookieProbe().flush({ id: 'other-user' });
    expect(ready).toBeFalse();
  });

  it('refuses another user cookie without overwriting it', () => {
    setup();
    auth.ensureBrowserSession().subscribe((value) => expect(value).toBeFalse());
    cookieProbe().flush({ id: 'other-user' });
    http.expectNone('/nuxeo/login.jsp');
  });

  it('does not infer an authenticated cookie from an HTML login page', () => {
    setup();
    auth.ensureBrowserSession().subscribe((value) => expect(value).toBeFalse());
    cookieProbe().flush('<html>Login</html>');
    http.expectNone('/nuxeo/login.jsp');
  });

  for (const response of [{ id: 'other-user' }, '<html>Login</html>']) {
    it(`rejects an unverified bridge response: ${JSON.stringify(response)}`, () => {
      setup();
      auth.ensureBrowserSession().subscribe((value) => expect(value).toBeFalse());
      cookieProbe().flush('', { status: 401, statusText: 'Unauthorized' });
      http.expectOne('/nuxeo/login.jsp').flush('<html></html>');
      http.expectOne('/nuxeo/api/v1/me').flush({ id: 'member' });
      cookieProbe().flush(response);
    });
  }

  it('fails closed if the login page cannot create a browser session', () => {
    setup();
    auth.ensureBrowserSession().subscribe((value) => expect(value).toBeFalse());
    cookieProbe().flush('', { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/nuxeo/login.jsp').flush('', { status: 404, statusText: 'Not Found' });
    cookieProbe().flush('', { status: 401, statusText: 'Unauthorized' });
  });

  it('does not create a Basic session for an expired SSO session', () => {
    setup('cookie');
    auth.ensureBrowserSession().subscribe((value) => expect(value).toBeFalse());
    cookieProbe().flush('', { status: 401, statusText: 'Unauthorized' });
    http.expectNone('/nuxeo/login.jsp');
  });

  it('accepts a valid SSO browser session', () => {
    setup('cookie');
    auth.ensureBrowserSession().subscribe((value) => expect(value).toBeTrue());
    cookieProbe().flush({ id: 'member' });
  });

  it('does not authenticate an anonymous viewer', () => {
    setup(null);
    auth.ensureBrowserSession().subscribe((value) => expect(value).toBeFalse());
    http.expectNone('/nuxeo/api/v1/me');
  });

  it('rejects a response arriving after sign-out', () => {
    setup();
    auth.ensureBrowserSession().subscribe((value) => expect(value).toBeFalse());
    const probe = cookieProbe();
    auth.logout();
    probe.flush({ id: 'member' });
    http.expectNone('/nuxeo/login.jsp');
  });

  it('does not send credentials if sign-out happens while the login page is pending', () => {
    setup();
    auth.ensureBrowserSession().subscribe((value) => expect(value).toBeFalse());
    cookieProbe().flush('', { status: 401, statusText: 'Unauthorized' });
    const page = http.expectOne('/nuxeo/login.jsp');
    auth.logout();
    page.flush('<html></html>');
    http.expectNone('/nuxeo/api/v1/me');
  });

  for (const status of [0, 500]) {
    it(`does not attempt cookie repair after an indeterminate ${status} response`, () => {
      setup();
      auth.ensureBrowserSession().subscribe((value) => expect(value).toBeFalse());
      cookieProbe().flush('', { status, statusText: 'Unavailable' });
      http.expectNone('/nuxeo/login.jsp');
    });
  }
});
