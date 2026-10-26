import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpRequest } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AI_BACKEND_URL } from '@agentic-ui/shared/ai-client';
import { KD_CIC_OPERATIONS } from '@agentic-ui/shared/kd-client';
import {
  APP_BOOTSTRAP_CONFIG_URL,
  APP_CONFIG_FORMAT,
  type AppConfigLayer,
} from '@nuxeo/satori-platform/app-config';
import {
  ARENDER_CONFIG,
  NUXEO_API_ORIGIN,
  NUXEO_SAML_LOGIN_ENDPOINTS,
  NUXEO_SERVER_URL,
  NUXEO_SSO_POST_LOGIN_PATH,
  NUXEO_SSO_RETURN_QUERY_PARAM,
} from '@nuxeo/satori-platform/nuxeo-client';

import { appConfig } from '../app.config';
import { AuthService } from '../auth/auth.service';
import { SESSION_TIMEOUT_CONFIG } from '../auth/session-timeout.config';

const SESSION_KEY = 'agentic_ui_nuxeo_session';

const ACME_SSO = { id: 'acme-okta', label: 'Sign in with Acme SSO', path: '/nuxeo/login/acme' };

function envelope(layer: AppConfigLayer, content: Record<string, unknown>) {
  return {
    format: APP_CONFIG_FORMAT,
    layer,
    fragments: [{ name: 'acme', component: 'com.acme', bundle: 'acme-ui', source: 'x', content }],
    diagnostics: [],
  };
}

/**
 * The configuration tokens, as the application starts.
 *
 * Each is an injection token whose factory reads `AppConfigService.bootstrap()` on first
 * injection, and Angular keeps that first answer for the life of the application. So what is
 * under test is ordering: nothing may resolve one before the configuration has loaded. Only the
 * real `appConfig.providers` can show that — a spec of one service, with the token provided by
 * hand, passes whatever the startup order is.
 */
describe('configuration tokens from configuration packages, at startup', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    // A stored password session, so the auth interceptor has a header it would attach. The value
    // is only ever compared for presence; it is not a credential.
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        kind: 'basic',
        username: 'jdoe',
        basic: 'stored-session-placeholder',
        isAdministrator: false,
        groups: [],
      }),
    );
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        provideHttpClientTesting(),
        // Where a deployment serves it. Under Karma the default resolves outside `/nuxeo/`,
        // where the auth interceptor would leave the request alone whatever the order.
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: '/nuxeo/agentic-ui-config/bootstrap.json' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    sessionStorage.removeItem(SESSION_KEY);
  });

  /** Answer the two configuration requests, then whatever else startup asks for, until it is done. */
  async function start(bootstrap: Record<string, unknown>): Promise<HttpRequest<unknown>[]> {
    const status = TestBed.inject(ApplicationInitStatus);
    const configRequests: HttpRequest<unknown>[] = [];
    for (const layer of ['bootstrap', 'manifest'] as const) {
      for (const request of http.match((r) => r.url.endsWith(`/agentic-ui-config/${layer}.json`))) {
        configRequests.push(request.request);
        request.flush(envelope(layer, layer === 'bootstrap' ? bootstrap : {}));
      }
    }
    for (let turn = 0; turn < 50 && !status.done; turn++) {
      await new Promise((resolve) => setTimeout(resolve));
      http.match(() => true).forEach((request) => request.flush({}));
    }
    expect(status.done).withContext('application initializers settled').toBeTrue();
    return configRequests;
  }

  it('applies the Nuxeo origin, SSO and idle-timeout settings a package contributes', async () => {
    await start({
      nuxeoApiOrigin: 'https://nuxeo.acme.example',
      sso: { endpoints: [ACME_SSO], postLoginPath: '/browse', returnQueryParam: 'returnTo' },
      session: { idleTimeoutMs: 900_000, warningBeforeMs: 60_000 },
    });

    expect(TestBed.inject(NUXEO_API_ORIGIN)).toBe('https://nuxeo.acme.example');
    expect(TestBed.inject(NUXEO_SAML_LOGIN_ENDPOINTS)).toEqual([ACME_SSO]);
    expect(TestBed.inject(AuthService).samlLoginOptions()).toEqual([ACME_SSO]);
    expect(TestBed.inject(NUXEO_SSO_POST_LOGIN_PATH)).toBe('/browse');
    expect(TestBed.inject(NUXEO_SSO_RETURN_QUERY_PARAM)).toBe('returnTo');
    expect(TestBed.inject(SESSION_TIMEOUT_CONFIG)).toEqual({
      idleTimeoutMs: 900_000,
      warningBeforeMs: 60_000,
    });
  });

  // `LOCALE_ID` is not here: TestBed resolves it while it builds the module, before any
  // initializer runs, so a spec cannot speak for it. `bootstrapApplication` reads it after them.
  it('applies the server URL and integrations a package contributes', async () => {
    await start({
      nuxeoServerUrl: 'https://nuxeo.acme.example/nuxeo',
      aiBackendUrl: 'https://ai.acme.example/nuxeo',
      integrations: {
        arender: { viewerOrigin: 'https://arender.acme.example' },
        knowledgeDiscoveryOperations: { acmeSearch: 'Acme.KdSearch' },
      },
    });

    expect(TestBed.inject(NUXEO_SERVER_URL)).toBe('https://nuxeo.acme.example/nuxeo');
    expect(TestBed.inject(AI_BACKEND_URL)).toBe('https://ai.acme.example/nuxeo');
    expect(TestBed.inject(ARENDER_CONFIG)?.viewerOrigin).toBe('https://arender.acme.example');
    expect(TestBed.inject(KD_CIC_OPERATIONS)).toEqual(
      jasmine.objectContaining({ acmeSearch: 'Acme.KdSearch' }),
    );
  });

  it('fetches the configuration without the signed-in user’s Authorization header', async () => {
    const requests = await start({});

    expect(requests.map((request) => request.url)).toEqual([
      '/nuxeo/agentic-ui-config/bootstrap.json',
      '/nuxeo/agentic-ui-config/manifest.json',
    ]);
    for (const request of requests) {
      expect(request.headers.has('Authorization')).withContext(request.url).toBeFalse();
    }
  });
});
