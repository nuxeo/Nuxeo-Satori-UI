import { HttpClient, provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { fakeToken } from '../testing/fake-token';
import { PANEL_SERVER } from './panel-server';
import { PanelToken, isRestApiRequest, panelTokenInterceptor } from './panel-token';

const SERVER = {
  origin: 'https://nuxeo.example.com',
  base: 'https://nuxeo.example.com/nuxeo/agentic-ui/embedded/v1/',
};
const TOKEN = fakeToken({ sub: 'jsmith' });

describe('the token on the wire', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let token: PanelToken;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PANEL_SERVER, useValue: SERVER },
        PanelToken,
        provideHttpClient(withXhr(), withInterceptors([panelTokenInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    token = TestBed.inject(PanelToken);
    token.set(TOKEN);
  });

  afterEach(() => backend.verify());

  it('signs a request to the server REST API, in a header, with no browser credentials', () => {
    // Asked for with the browser's credentials, as a library might: the interceptor sends none.
    http.get(`${SERVER.origin}/nuxeo/api/v1/id/abc`, { withCredentials: true }).subscribe();
    const request = backend.expectOne(`${SERVER.origin}/nuxeo/api/v1/id/abc`).request;
    expect(request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request.withCredentials).toBe(false);
    expect(request.urlWithParams).not.toContain(TOKEN);
  });

  it('sends it nowhere else: not to another origin, nor to the server outside its REST API', () => {
    for (const url of [
      'https://crm.example.com/nuxeo/api/v1/id/abc',
      `${SERVER.origin}/nuxeo/agentic-ui-config/layouts.json`,
      `${SERVER.origin}/nuxeo/agentic-embedded/v1/hosts/crm`,
      `${SERVER.base}i18n/en.json`,
    ]) {
      http.get(url, { withCredentials: true }).subscribe();
      const request = backend.expectOne(url).request;
      expect(request.headers.has('Authorization'), url).toBe(false);
      expect(request.withCredentials, url).toBe(false);
    }
  });

  it('refuses to send a request whose address holds the token', async () => {
    await expect(
      firstValueFrom(http.get(`${SERVER.origin}/nuxeo/api/v1/id/abc`, { params: { t: TOKEN } })),
    ).rejects.toThrow(/would have put the panel token in a URL/);
    backend.expectNone(() => true);
  });

  it('sends nothing before the page gives a token, and nothing once it is cleared', () => {
    token.clear();
    http.get(`${SERVER.origin}/nuxeo/api/v1/id/abc`).subscribe();
    expect(
      backend
        .expectOne(`${SERVER.origin}/nuxeo/api/v1/id/abc`)
        .request.headers.has('Authorization'),
    ).toBe(false);
  });

  it('reads the REST API by origin and path, not by text', () => {
    expect(isRestApiRequest('/nuxeo/api/v1/me', SERVER.origin)).toBe(true);
    expect(
      isRestApiRequest('https://nuxeo.example.com.evil.example/nuxeo/api/v1/me', SERVER.origin),
    ).toBe(false);
    expect(isRestApiRequest('//evil.example/nuxeo/api/v1/me', SERVER.origin)).toBe(false);
    expect(isRestApiRequest('https://nuxeo.example.com/nuxeo/apix/v1', SERVER.origin)).toBe(false);
  });
});
