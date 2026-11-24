import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_DEFINITION_FILES } from '@agentic-ui/shared/app-registry';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import { firstValueFrom, of, throwError } from 'rxjs';

import { HomeService, homeFileUrl, navigationFileUrl, type HomeLoad } from './home.service';

describe('where the home is read', () => {
  it('is beside the layouts, in the directory the configuration service answers from', () => {
    expect(homeFileUrl('/agentic-ui-config/bootstrap.json')).toBe('/agentic-ui-config/home.json');
    expect(homeFileUrl('/nuxeo/agentic-ui-config/bootstrap.json?v=2#x')).toBe(
      '/nuxeo/agentic-ui-config/home.json',
    );
  });
});

describe('where the menu is read', () => {
  it('is beside the home', () => {
    expect(navigationFileUrl('/agentic-ui-config/bootstrap.json')).toBe(
      '/agentic-ui-config/navigation.json',
    );
    expect(navigationFileUrl('/nuxeo/agentic-ui-config/bootstrap.json?v=2#x')).toBe(
      '/nuxeo/agentic-ui-config/navigation.json',
    );
  });
});

describe('HomeService', () => {
  let service: HomeService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: '/agentic-ui-config/bootstrap.json' },
      ],
    });
    service = TestBed.inject(HomeService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const load = (answer: (request: ReturnType<HttpTestingController['expectOne']>) => void) => {
    const loaded = firstValueFrom(service.load());
    const request = http.expectOne('/agentic-ui-config/home.json');
    expect(request.request.method).toBe('GET');
    answer(request);
    return loaded;
  };

  it('reads the file as it is served', async () => {
    const content = { version: 2, cards: [] };
    expect(await load((request) => request.flush(content))).toEqual<HomeLoad>({
      kind: 'file',
      content,
    });
  });

  it('reads the menu as it reads the home, and finds none where nothing is served', async () => {
    const content = { version: 2, entries: [] };
    const read = firstValueFrom(service.loadNavigation());
    http.expectOne('/agentic-ui-config/navigation.json').flush(content);
    expect(await read).toEqual<HomeLoad>({ kind: 'file', content });
    const none = firstValueFrom(service.loadNavigation());
    http
      .expectOne('/agentic-ui-config/navigation.json')
      .flush('', { status: 404, statusText: 'Not Found' });
    expect(await none).toEqual<HomeLoad>({ kind: 'none' });
  });

  it('finds no home where nothing is served, as on a server today', async () => {
    expect(
      await load((request) => request.flush('', { status: 404, statusText: 'Not Found' })),
    ).toEqual<HomeLoad>({ kind: 'none' });
  });

  it('says why a home it cannot read is not loaded', async () => {
    expect(
      await load((request) => request.flush('', { status: 500, statusText: 'Server Error' })),
    ).toEqual<HomeLoad>({ kind: 'unreadable', reason: 'HTTP 500' });
    // A body the browser cannot parse as JSON fails with the status of a success.
    expect(
      await load((request) =>
        request.error(new ProgressEvent('error'), { status: 200, statusText: 'OK' }),
      ),
    ).toEqual<HomeLoad>({ kind: 'unreadable', reason: 'it is not JSON' });
  });

  it('asks a page provider for one record, its parameters in order, as the signed-in user', async () => {
    const results = firstValueFrom(
      service.results({
        pageProvider: 'payers_open_claims',
        parameters: ['Claim', 30, true],
        aggregate: 'claim_state_agg',
        bucket: null,
      }),
    );
    const request = http.expectOne(
      (r) => r.url === '/nuxeo/api/v1/search/pp/payers_open_claims/execute',
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('pageSize')).toBe('1');
    expect(request.request.params.getAll('queryParams')).toEqual(['Claim', '30', 'true']);
    expect(request.request.headers.get('properties')).toBe('dublincore');
    request.flush({ resultsCount: 3 });
    expect(await results).toEqual({ resultsCount: 3 });
  });

  it('sends no parameter a page provider was not given, and says why a read failed', async () => {
    const results = firstValueFrom(
      service.results({ pageProvider: 'no_such', parameters: [], aggregate: null, bucket: null }),
    );
    const request = http.expectOne((r) => r.url === '/nuxeo/api/v1/search/pp/no_such/execute');
    expect(request.request.params.has('queryParams')).toBe(false);
    request.flush('', { status: 404, statusText: 'Not Found' });
    await expect(results).rejects.toThrow('HTTP 404');
  });
});

/**
 * Where the app provides the app registry, the home and the menu are read through it: with the
 * path the registry knows each by, and the development server's address to try first.
 */
describe('HomeService, where the app provides the app registry', () => {
  it('reads the home and the menu through APP_DEFINITION_FILES', async () => {
    const asked: [string, string | null][] = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: '/nuxeo/agentic-ui-config/bootstrap.json' },
        {
          provide: APP_DEFINITION_FILES,
          useValue: {
            file: (path: string, developmentUrl: string | null) => {
              asked.push([path, developmentUrl]);
              return path === 'home.json'
                ? of({ from: 'registry' })
                : throwError(() => new HttpErrorResponse({ status: 404 }));
            },
            labelLanguages: () => of([]),
          },
        },
      ],
    });
    const service = TestBed.inject(HomeService);

    expect(await firstValueFrom(service.load())).toEqual<HomeLoad>({
      kind: 'file',
      content: { from: 'registry' },
    });
    expect(await firstValueFrom(service.loadNavigation())).toEqual<HomeLoad>({ kind: 'none' });
    expect(asked).toEqual([
      ['home.json', '/nuxeo/agentic-ui-config/home.json'],
      ['navigation.json', '/nuxeo/agentic-ui-config/navigation.json'],
    ]);
    TestBed.inject(HttpTestingController).verify();
  });
});
