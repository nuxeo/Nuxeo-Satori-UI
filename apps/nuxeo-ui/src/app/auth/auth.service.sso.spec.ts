import { DOCUMENT } from '@angular/common';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  NUXEO_API_ORIGIN,
  NUXEO_SSO_POST_LOGIN_PATH,
  NUXEO_SSO_RETURN_QUERY_PARAM,
} from '@nuxeo/satori-platform/nuxeo-client';

import { AuthService, resolveSsoLoginUrl } from './auth.service';
import { testTranslateModule } from '../i18n/translate-testing';

/**
 * NXSAT-731 — the boundary for `sso.endpoints[].path`.
 *
 * `bootstrap-config.ts` refuses the plainly wrong forms during the merge, so no button is
 * rendered; these tests are the other half, and the one that has to hold on its own:
 * `NUXEO_SAML_LOGIN_ENDPOINTS` is a DI token a host application can fill with endpoints that
 * never passed through that merge, and `startSamlLogin` is the last point before the browser is
 * sent somewhere.
 */
describe('resolveSsoLoginUrl', () => {
  const NUXEO = 'https://nuxeo.example';
  const APP = 'https://app.example';
  const resolve = (
    path: string,
    overrides: Partial<Parameters<typeof resolveSsoLoginUrl>[0]> = {},
  ) =>
    resolveSsoLoginUrl({
      path,
      nuxeoOrigin: NUXEO,
      appOrigin: APP,
      returnQueryParam: 'requestedUrl',
      postLoginPath: '/dashboard',
      ...overrides,
    });

  const urlOf = (path: string) => {
    const target = resolve(path);
    return 'url' in target ? target.url : null;
  };

  it('opens a legitimate absolute path on the Nuxeo origin, with the return URL attached', () => {
    expect(urlOf('/nuxeo/login/azure')).toBe(
      'https://nuxeo.example/nuxeo/login/azure?requestedUrl=https%3A%2F%2Fapp.example%2Fdashboard',
    );
  });

  it('opens the endpoint the ticket reports as working', () => {
    expect(urlOf('/nuxeo/sso-ok')).toBe(
      'https://nuxeo.example/nuxeo/sso-ok?requestedUrl=https%3A%2F%2Fapp.example%2Fdashboard',
    );
  });

  it('keeps a query the configured path already carries', () => {
    const url = urlOf('/nuxeo/login/azure?tenant=acme');
    expect(url).toContain('tenant=acme');
    expect(url).toContain('requestedUrl=');
  });

  it('sends no return URL when the deployment turned the parameter off', () => {
    const target = resolve('/nuxeo/login/azure', { returnQueryParam: null });
    expect('url' in target && target.url).toBe('https://nuxeo.example/nuxeo/login/azure');
  });

  /**
   * One case per bypass class. The first three are what the ticket suggested refusing by prefix;
   * the rest are why a prefix check was the wrong fix — the URL parser deletes tabs, newlines and
   * carriage returns from the input before it looks at anything, so the string a prefix check
   * sees is harmless while the URL the browser loads is not.
   */
  const OFF_ORIGIN: ReadonlyArray<readonly [string, string]> = [
    ['a protocol-relative path', '//evil.example/sso'],
    ['a backslash in place of the second slash', '/\\evil.example/sso'],
    ['a backslash before a slash', '/\\/evil.example/sso'],
    ['a tab inside the prefix', '/\t/evil.example/sso'],
    ['a newline inside the prefix', '/\n/evil.example/sso'],
    ['a carriage return inside the prefix', '/\r/evil.example/sso'],
    ['a tab before the leading slash', '\t//evil.example/sso'],
    ['no leading slash at all', '\\\\evil.example/sso'],
    ['an absolute https address', 'https://evil.example/sso'],
    ['an absolute http address', 'http://evil.example/sso'],
    ['a protocol-relative path with a userinfo lookalike', '//app.example@evil.example/sso'],
  ];

  OFF_ORIGIN.forEach(([label, path]) => {
    it(`refuses ${label}`, () => {
      const target = resolve(path);
      expect('refused' in target).toBeTrue();
      expect('url' in target).toBeFalse();
    });
  });

  it('says where a refused path resolved to, so a console line identifies the mistake', () => {
    const target = resolve('//evil.example/sso');
    expect('refused' in target && target.refused).toContain('https://evil.example');
    expect('refused' in target && target.refused).toContain('https://nuxeo.example');
  });

  /**
   * An absolute address is refused for being one, rather than left to the origin comparison. The
   * path is tolerated without its leading slash, and prepending one to `https://evil.example/sso`
   * produces the path `/https://evil.example/sso` — which really is on the Nuxeo origin, so the
   * comparison allows it and the administrator gets a 404 with no explanation.
   */
  // Jasmine, not Vitest: this project's specs run under Karma, which has no `it.each`.
  (
    [
      ['https', 'https://evil.example/sso'],
      ['http', 'http://evil.example/sso'],
      ['javascript', 'javascript:alert(1)'],
    ] as const
  ).forEach(([scheme, path]) => {
    it(`names the scheme when refusing an absolute ${scheme} address`, () => {
      const target = resolve(path);
      expect('refused' in target && target.refused).toContain(`"${scheme}:"`);
    });
  });

  it('still tolerates a path written without its leading slash', () => {
    expect(urlOf('nuxeo/login/azure')).toContain('https://nuxeo.example/nuxeo/login/azure');
  });

  /**
   * The load-bearing assertion: the rule is "the resolved URL stays on the Nuxeo origin", so it
   * is asserted on the resolved URL rather than on the shape of the string. A `javascript:` URL
   * has no origin of its own, which is exactly the kind of value a prefix check waves through.
   */
  it('never returns a URL on another origin, whatever the path', () => {
    const everything = [
      ...OFF_ORIGIN.map(([, path]) => path),
      '/nuxeo/login/azure',
      '/nuxeo/sso-ok',
      'javascript:alert(1)',
      'nuxeo/login/azure',
      '/%2f%2fevil.example',
      '/./%2e%2e//evil.example',
      '',
      '   ',
    ];
    for (const path of everything) {
      const url = urlOf(path);
      if (url === null) continue;
      expect(new URL(url).origin)
        .withContext(`${JSON.stringify(path)} resolved to ${url}`)
        .toBe(NUXEO);
    }
  });

  /**
   * The base used to be built by stripping trailing slashes with `/\\/+$/` and appending one.
   * Sonar flagged that as super-linear and it measurably is (2 ms at 2k slashes, 332 ms at 32k),
   * so the strip is gone — the URL parser normalises all three spellings itself. Pinned here
   * because "the parser already does it" is the whole reason it was safe to delete.
   */
  (['https://nuxeo.example', 'https://nuxeo.example/', 'https://nuxeo.example//'] as const).forEach(
    (nuxeoOrigin) => {
      it(`resolves the same URL whether the Nuxeo origin is written as "${nuxeoOrigin}"`, () => {
        const target = resolve('/nuxeo/login/azure', { nuxeoOrigin });
        expect('url' in target && target.url).toBe(
          'https://nuxeo.example/nuxeo/login/azure?requestedUrl=https%3A%2F%2Fapp.example%2Fdashboard',
        );
      });
    },
  );

  it('fails closed when the configured Nuxeo origin is not a URL', () => {
    const target = resolve('/nuxeo/login/azure', { nuxeoOrigin: 'not a url' });
    expect('refused' in target).toBeTrue();
  });

  /**
   * `URL.origin` is the string `"null"` for every opaque origin, so `file:`, `blob:`, `about:` and
   * `data:` all compare equal to one another — and a base on one of them would have let the origin
   * comparison through. A sentinel drawn from the value space it is meant to distinguish is the
   * collision bug pattern 26 records, so the scheme is checked where the base is built.
   */
  (['file://', 'about:', 'blob:', 'data:'] as const).forEach((origin) => {
    it(`refuses an opaque "${origin}" Nuxeo origin rather than comparing "null" to "null"`, () => {
      const target = resolve('/nuxeo/login/azure', { nuxeoOrigin: origin });
      expect('refused' in target).toBeTrue();
      expect('url' in target).toBeFalse();
    });
  });

  it('drops the return parameter when the application has no origin of its own', () => {
    const target = resolve('/nuxeo/login/azure', { appOrigin: 'null' });
    expect('url' in target && target.url).toBe('https://nuxeo.example/nuxeo/login/azure');
    expect('url' in target && target.warning).toBeTruthy();
  });

  /**
   * `postLoginPath` is the second configured value read here, and it reaches the browser as the
   * `requestedUrl` Nuxeo redirects to. Refusing it drops the parameter rather than the sign-in:
   * landing on Nuxeo's default page beats not being able to sign in at all.
   */
  describe('sso.postLoginPath', () => {
    it('drops the return parameter, and says so, when it names another host', () => {
      const target = resolve('/nuxeo/login/azure', { postLoginPath: '//evil.example/landing' });
      expect('url' in target && target.url).toBe('https://nuxeo.example/nuxeo/login/azure');
      expect('url' in target && target.warning).toContain('//evil.example/landing');
    });

    it('still starts SSO when the return path is refused', () => {
      const target = resolve('/nuxeo/login/azure', { postLoginPath: 'https://evil.example/x' });
      expect('url' in target).toBeTrue();
    });

    /**
     * Held to the same scheme rule as the login path, for the same diagnostic reason rather than a
     * security one: prepending a slash to `https://evil.example/` makes the path
     * `/https://evil.example/`, which really is on this application's origin, so the comparison
     * alone would attach it and all the administrator would see is a 404 after sign-in.
     */
    it('refuses an absolute return address rather than sending it as a path on our own origin', () => {
      const target = resolve('/nuxeo/login/azure', { postLoginPath: 'https://evil.example/x' });
      expect('url' in target && target.url).toBe('https://nuxeo.example/nuxeo/login/azure');
      expect('url' in target && target.url).not.toContain('evil.example');
    });

    /**
     * Review of PR 519, and the combination that was missed: a configured path carrying its own
     * `requestedUrl` *and* a refused `postLoginPath`. `set()` covered only the branch with a
     * return URL to write, so this one returned the URL untouched and the smuggled value
     * survived — while the warning said none was sent. Nuxeo redirects there after sign-in, so it
     * is a post-authentication open redirect: worse than the defect this PR reports, because by
     * then the session exists.
     */
    it('drops a return parameter the configured path smuggled in, even when postLoginPath is refused', () => {
      const target = resolve('/nuxeo/login/azure?requestedUrl=https://evil.example/', {
        postLoginPath: '//evil.example/landing',
      });

      expect('url' in target).toBeTrue();
      if (!('url' in target)) return;
      expect(target.url).not.toContain('evil.example');
      expect(new URL(target.url).searchParams.has('requestedUrl')).toBeFalse();
      expect(target.warning).toContain('carried its own requestedUrl');
      expect(target.warning).toContain('no requestedUrl was sent');
    });

    it('replaces a smuggled return parameter when postLoginPath is good, and says it did', () => {
      const target = resolve('/nuxeo/login/azure?requestedUrl=https://evil.example/');

      expect('url' in target).toBeTrue();
      if (!('url' in target)) return;
      expect(target.url).not.toContain('evil.example');
      expect(new URL(target.url).searchParams.get('requestedUrl')).toBe(
        'https://app.example/dashboard',
      );
      expect(target.warning).toContain('carried its own requestedUrl');
    });

    it('drops every occurrence, not just the first', () => {
      const target = resolve(
        '/nuxeo/login/azure?requestedUrl=https://evil.example/a&requestedUrl=https://evil.example/b',
        { postLoginPath: 'javascript:alert(1)' },
      );

      expect('url' in target).toBeTrue();
      if (!('url' in target)) return;
      expect(target.url).not.toContain('evil.example');
      expect(new URL(target.url).searchParams.getAll('requestedUrl')).toEqual([]);
    });

    it('leaves a parameter that is not the return parameter alone', () => {
      const target = resolve('/nuxeo/login/azure?tenant=acme&requestedUrl=https://evil.example/');

      expect('url' in target).toBeTrue();
      if (!('url' in target)) return;
      expect(new URL(target.url).searchParams.get('tenant')).toBe('acme');
      expect(target.url).not.toContain('evil.example');
    });

    /**
     * With the parameter turned off the deployment has said Nuxeo takes its relay state from its
     * own configuration rather than from this URL, so there is no name we own and nothing here
     * for Nuxeo to honour. Pinned so the reasoning is visible rather than looking like a gap.
     */
    it('leaves the path untouched when the deployment sends no return parameter at all', () => {
      const target = resolve('/nuxeo/login/azure?requestedUrl=https://evil.example/', {
        returnQueryParam: null,
      });

      expect('url' in target && target.url).toBe(
        'https://nuxeo.example/nuxeo/login/azure?requestedUrl=https://evil.example/',
      );
    });

    it('never attaches a return URL on another origin, whatever the configured value', () => {
      const values = [
        '/dashboard',
        'dashboard',
        '//evil.example/landing',
        '/\\evil.example/landing',
        '/\t/evil.example/landing',
        'https://evil.example/x',
        'javascript:alert(1)',
        '/%2f%2fevil.example',
      ];
      for (const postLoginPath of values) {
        const target = resolve('/nuxeo/login/azure', { postLoginPath });
        expect('url' in target)
          .withContext(`${JSON.stringify(postLoginPath)} must not refuse the sign-in`)
          .toBeTrue();
        if (!('url' in target)) continue;
        const sent = new URL(target.url).searchParams.get('requestedUrl');
        if (sent === null) continue;
        expect(new URL(sent).origin)
          .withContext(`${JSON.stringify(postLoginPath)} was sent as ${sent}`)
          .toBe(APP);
      }
    });

    it('accepts a relative return path by resolving it on the application origin', () => {
      const url = urlOf('/nuxeo/login/azure');
      expect(url).toContain(encodeURIComponent('https://app.example/dashboard'));
    });
  });
});

describe('AuthService.startSamlLogin', () => {
  const SIGNED_OUT_KEY = 'agentic_ui_signed_out';
  let assigned: string[];

  /**
   * A stand-in `Window` whose `location.assign` can be observed. Chrome will not let a spy
   * replace the real `window.location.assign`, so the service reads its window off `DOCUMENT`
   * and the test supplies one — otherwise the only assertable direction would be the one where
   * nothing happens, and "it did not navigate" is half the claim.
   *
   * The document itself is proxied rather than replaced: Angular's testing modules call real DOM
   * methods on it, and those throw when invoked with anything but a real document as `this`.
   */
  function configure(apiOrigin: string): AuthService {
    assigned = [];
    const view = {
      location: {
        origin: 'https://app.example',
        assign: (url: string) => assigned.push(url),
      },
    } as unknown as Window;
    const stubDocument = new Proxy(document, {
      get(target, property) {
        if (property === 'defaultView') return view;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    sessionStorage.clear();
    localStorage.clear();
    AuthService.resetNuxeoLogoutProbe();
    TestBed.configureTestingModule({
      imports: [testTranslateModule(), HttpClientTestingModule],
      providers: [
        { provide: NUXEO_API_ORIGIN, useValue: apiOrigin },
        { provide: DOCUMENT, useValue: stubDocument },
        { provide: NUXEO_SSO_POST_LOGIN_PATH, useValue: '/dashboard' },
        { provide: NUXEO_SSO_RETURN_QUERY_PARAM, useValue: 'requestedUrl' },
      ],
    });
    return TestBed.inject(AuthService);
  }

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('navigates to a legitimate endpoint on the Nuxeo origin', () => {
    const service = configure('https://nuxeo.example');

    service.startSamlLogin({ id: 'azure', label: 'Azure', path: '/nuxeo/login/azure' });

    expect(assigned).toEqual([
      'https://nuxeo.example/nuxeo/login/azure?requestedUrl=https%3A%2F%2Fapp.example%2Fdashboard',
    ]);
  });

  it('resolves the path on the application origin when no Nuxeo origin is configured', () => {
    const service = configure('');

    service.startSamlLogin({ id: 'azure', label: 'Azure', path: '/nuxeo/login/azure' });

    expect(assigned).toHaveSize(1);
    expect(new URL(assigned[0] as string).origin).toBe('https://app.example');
  });

  it('navigates nowhere for a path that names another host', () => {
    const service = configure('https://nuxeo.example');

    service.startSamlLogin({ id: 'company', label: 'Company SSO', path: '//evil.example/sso' });

    expect(assigned).toEqual([]);
  });

  /**
   * A refused action changes nothing. `clearSignedOut()` used to run before the URL was built, so
   * an explicitly signed-out user clicking a refused button was quietly re-enrolled into the
   * automatic cookie-session hydration and no navigation happened to explain it.
   */
  it('leaves an explicitly signed-out user signed out when it refuses', () => {
    const service = configure('https://nuxeo.example');
    sessionStorage.setItem(SIGNED_OUT_KEY, '1');

    service.startSamlLogin({ id: 'company', label: 'Company SSO', path: '//evil.example/sso' });

    expect(sessionStorage.getItem(SIGNED_OUT_KEY)).toBe('1');
  });

  it('clears the signed-out flag when it does navigate', () => {
    const service = configure('https://nuxeo.example');
    sessionStorage.setItem(SIGNED_OUT_KEY, '1');

    service.startSamlLogin({ id: 'azure', label: 'Azure', path: '/nuxeo/login/azure' });

    expect(sessionStorage.getItem(SIGNED_OUT_KEY)).toBeNull();
  });
});
