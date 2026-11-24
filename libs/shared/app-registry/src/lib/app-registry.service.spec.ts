import {
  HttpErrorResponse,
  type HttpInterceptorFn,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_BOOTSTRAP_CONFIG_URL, AppConfigService } from '@nuxeo/satori-platform/app-config';
import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';
import { firstValueFrom } from 'rxjs';

import {
  APP_DEFINITION_FILES,
  APP_REGISTRY_CHOICE_KEY,
  APP_REGISTRY_RELOAD,
  APP_REGISTRY_REQUEST,
  APP_REGISTRY_STORAGE,
  AppRegistryService,
  chooseApp,
} from './app-registry.service';

const ORIGIN = 'https://nuxeo.example';
const LISTING = `${ORIGIN}/nuxeo/agentic-ui-apps/apps.json`;
const DEV = '/nuxeo/agentic-ui-config/';

const appJson = (id: string): Record<string, unknown> => ({
  version: 2,
  id,
  label: id,
  packageVersion: '1.0.0',
  platform: '>=0.1.0 <1.0.0',
  groups: ['members'],
});

const listed = (...apps: [string, string[]][]): Record<string, unknown> => ({
  format: 'nuxeo-agentic-ui-config/1',
  layer: 'apps',
  apps: apps.map(([id, files]) => ({
    id,
    url: `apps/${id}/`,
    files: ['app.json', ...files],
    content: appJson(id),
  })),
  diagnostics: [],
});

/** Marks the requests that went through the interceptors, as the app's credentials do. */
const marked: HttpInterceptorFn = (request, next) =>
  next(request.clone({ setHeaders: { 'X-Through-Interceptors': 'yes' } }));

const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

describe('AppRegistryService', () => {
  let http: HttpTestingController;
  let reloads: number;
  let storage: MemoryStorage;
  let configLoaded: boolean;

  function setUp(remembered?: string): AppRegistryService {
    reloads = 0;
    storage = new MemoryStorage();
    if (remembered) storage.setItem(APP_REGISTRY_CHOICE_KEY, remembered);
    configLoaded = false;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([marked])),
        provideHttpClientTesting(),
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: `${DEV}bootstrap.json` },
        { provide: NUXEO_API_ORIGIN, useValue: `${ORIGIN}/` },
        {
          provide: AppConfigService,
          useValue: {
            load: async () => {
              await turn();
              configLoaded = true;
            },
          },
        },
        { provide: APP_REGISTRY_RELOAD, useValue: () => reloads++ },
        { provide: APP_REGISTRY_STORAGE, useValue: storage },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(AppRegistryService);
  }

  afterEach(() => http.verify());

  /** The listing request, once the configuration has loaded, answered with `body`. */
  async function answer(body: object | null, status = 200): Promise<void> {
    for (let i = 0; i < 5; i++) await turn();
    const request = http.expectOne(LISTING);
    expect(configLoaded).toBe(true);
    if (status === 200) request.flush(body);
    else request.flush(null, { status, statusText: 'No' });
    await turn();
  }

  it('reads the listing once, after the configuration, with the person’s credentials', async () => {
    const registry = setUp();
    const first = registry.load();
    const second = registry.load();

    for (let i = 0; i < 5; i++) await turn();
    const request = http.expectOne(LISTING);
    expect(request.request.headers.get('X-Through-Interceptors')).toBe('yes');
    expect(request.request.headers.get('X-No-Basic-Header')).toBe('true');
    request.flush(listed(['payers-claims', ['home.json']], ['staff-directory', []]));
    await Promise.all([first, second]);

    expect(registry.state().kind).toBe('listed');
    expect(registry.apps().map((app) => app.id)).toEqual(['payers-claims', 'staff-directory']);
    expect(registry.current()?.id).toBe('payers-claims');
  });

  it.each([
    ['answers 404, as a server without a registry, quietly', 404, null, false],
    ['answers 401, as before anyone signs in, quietly', 401, null, false],
    ['answers 500, and the console says so', 500, null, true],
    [
      'answers something that is not its listing, and the console says so',
      200,
      { format: 'other' },
      true,
    ],
  ])('has no app when the registry %s', async (_, status, body, said) => {
    const registry = setUp();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const load = registry.load();

    await answer(body, status);
    await load;

    expect(registry.state().kind).toBe('none');
    expect(registry.apps()).toEqual([]);
    expect(registry.current()).toBeNull();
    const calls = warn.mock.calls.filter(([message]) =>
      String(message).startsWith('[agentic-ui-apps] no app registry'),
    );
    expect(calls.length).toBe(said ? 1 : 0);
    warn.mockRestore();
  });

  it('opens the app last chosen while the person may still see it, and the first otherwise', async () => {
    const registry = setUp('staff-directory');
    const load = registry.load();
    await answer(listed(['payers-claims', []], ['staff-directory', []]));
    await load;
    expect(registry.current()?.id).toBe('staff-directory');

    const apps = registry.apps();
    expect(chooseApp(apps, 'gone')?.id).toBe('payers-claims');
    expect(chooseApp([], 'staff-directory')).toBeNull();
  });

  it('remembers a choice and reloads the page with it, and does not reload for the app open', async () => {
    const registry = setUp();
    const load = registry.load();
    await answer(listed(['payers-claims', []], ['staff-directory', []]));
    await load;

    registry.choose('payers-claims');
    expect(reloads).toBe(0);

    registry.choose('staff-directory');
    expect(storage.getItem(APP_REGISTRY_CHOICE_KEY)).toBe('staff-directory');
    expect(reloads).toBe(1);
    // Fixed for the page: the reload opens it.
    expect(registry.current()?.id).toBe('payers-claims');
  });

  describe('file', () => {
    async function withApp(files: string[]): Promise<AppRegistryService> {
      const registry = setUp();
      const load = registry.load();
      await answer(listed(['payers-claims', files]));
      await load;
      return registry;
    }

    it('reads the development server’s file first, past the interceptors, and nothing else', async () => {
      const registry = await withApp(['home.json']);
      const read = firstValueFrom(registry.file('home.json', `${DEV}home.json`));
      await turn();

      const request = http.expectOne(`${DEV}home.json`);
      expect(request.request.headers.has('X-Through-Interceptors')).toBe(false);
      request.flush({ from: 'config:dev' });

      expect(await read).toEqual({ from: 'config:dev' });
    });

    it('reads the registry’s when the development server serves nothing there', async () => {
      const registry = await withApp(['home.json', 'queues/open.json']);
      const read = firstValueFrom(registry.file('queues/open.json', `${DEV}queues/open.json`));
      await turn();

      http
        .expectOne(`${DEV}queues/open.json`)
        .flush(null, { status: 404, statusText: 'Not Found' });
      await turn();
      const request = http.expectOne(
        `${ORIGIN}/nuxeo/agentic-ui-apps/apps/payers-claims/queues/open.json`,
      );
      expect(request.request.headers.get('X-Through-Interceptors')).toBe('yes');
      request.flush({ from: 'registry' });

      expect(await read).toEqual({ from: 'registry' });
    });

    it('is a 404 when neither serves it, and asks the registry for no file the app lacks', async () => {
      const registry = await withApp(['home.json']);
      const read = firstValueFrom(registry.file('navigation.json', `${DEV}navigation.json`));
      await turn();

      http.expectOne(`${DEV}navigation.json`).flush(null, { status: 404, statusText: 'Not Found' });

      await expect(read).rejects.toMatchObject({ status: 404 });
    });

    it('does not fall back to the registry on another failure', async () => {
      const registry = await withApp(['home.json']);
      const read = firstValueFrom(registry.file('home.json', `${DEV}home.json`));
      await turn();

      http.expectOne(`${DEV}home.json`).flush(null, { status: 500, statusText: 'Boom' });

      await expect(read).rejects.toMatchObject({ status: 500 });
    });

    it('reads only the registry when there is no development address', async () => {
      const registry = await withApp(['labels/en.json']);
      const read = firstValueFrom(registry.file('labels/en.json', null));
      await turn();
      http
        .expectOne(`${ORIGIN}/nuxeo/agentic-ui-apps/apps/payers-claims/labels/en.json`)
        .flush({ ok: 1 });
      expect(await read).toEqual({ ok: 1 });

      const missing = firstValueFrom(registry.file('labels/fr.json', null));
      await expect(missing).rejects.toBeInstanceOf(HttpErrorResponse);
    });

    it('reads the development server alone where the registry did not answer', async () => {
      const registry = setUp();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const read = firstValueFrom(registry.file('home.json', `${DEV}home.json`));

      http.expectOne(`${DEV}home.json`).flush(null, { status: 404, statusText: 'Not Found' });
      await answer(null, 404);

      await expect(read).rejects.toMatchObject({ status: 404 });
    });

    it('does not wait for the listing to read what the development server serves', async () => {
      const registry = setUp();
      const read = firstValueFrom(registry.file('home.json', `${DEV}home.json`));

      // The listing is not asked for at all: the development server answered first.
      http.expectOne(`${DEV}home.json`).flush({ from: 'config:dev' });
      expect(await read).toEqual({ from: 'config:dev' });
      for (let i = 0; i < 5; i++) await turn();
      http.expectNone(LISTING);
    });
  });

  it('lists the open app’s label languages', async () => {
    const registry = setUp();
    const languages = firstValueFrom(registry.labelLanguages());
    await answer(listed(['payers-claims', ['labels/en.json', 'labels/fr.json']]));

    expect(await languages).toEqual(['en', 'fr']);
  });

  describe('refresh', () => {
    it('says the app open would change, as when someone else signs in', async () => {
      const registry = setUp();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const load = registry.load();
      await answer(null, 401);
      await load;

      const refresh = registry.refresh();
      await answer(listed(['payers-claims', []]));

      expect(await refresh).toBe(true);
    });

    it('keeps the old list when the answer comes for someone who has since signed out', async () => {
      const registry = setUp();
      const load = registry.load();
      await answer(listed(['payers-claims', []]));
      await load;

      const refresh = registry.refresh(() => false);
      await answer(listed(['payers-claims', []], ['staff-directory', []]));

      expect(await refresh).toBe(false);
      expect(registry.apps().map((app) => app.id)).toEqual(['payers-claims']);
    });

    it('keeps the listing as it was when the app open would change, until the page reloads', async () => {
      const registry = setUp();
      const load = registry.load();
      await answer(listed(['payers-claims', []]));
      await load;

      const refresh = registry.refresh();
      await answer(listed(['staff-directory', []]));

      expect(await refresh).toBe(true);
      expect(registry.current()?.id).toBe('payers-claims');
    });

    it('keeps the app open, with the new list, when it would not change', async () => {
      const registry = setUp();
      const load = registry.load();
      await answer(listed(['payers-claims', []]));
      await load;

      const refresh = registry.refresh();
      await answer(listed(['payers-claims', []], ['staff-directory', []]));

      expect(await refresh).toBe(false);
      expect(registry.apps().map((app) => app.id)).toEqual(['payers-claims', 'staff-directory']);
    });
  });
});

describe('APP_DEFINITION_FILES, where the app provides no registry', () => {
  it('reads the development server’s address alone, as before the registry', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([marked])), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const files = TestBed.inject(APP_DEFINITION_FILES);

    const read = firstValueFrom(files.file('home.json', `${DEV}home.json`));
    const request = http.expectOne(`${DEV}home.json`);
    expect(request.request.headers.has('X-Through-Interceptors')).toBe(false);
    request.flush({ cards: [] });
    expect(await read).toEqual({ cards: [] });

    await expect(firstValueFrom(files.file('labels/en.json', null))).rejects.toMatchObject({
      status: 404,
    });
    expect(await firstValueFrom(files.labelLanguages())).toEqual([]);
    http.verify();
  });
});

describe('the app registry’s requests', () => {
  it('are marked, so that the app’s interceptor does not end a session on their 401', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: `${DEV}bootstrap.json` },
        { provide: NUXEO_API_ORIGIN, useValue: ORIGIN },
        { provide: AppConfigService, useValue: { load: () => Promise.resolve() } },
        { provide: APP_REGISTRY_STORAGE, useValue: null },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const registry = TestBed.inject(AppRegistryService);

    const read = firstValueFrom(registry.file('home.json', null));
    for (let i = 0; i < 5; i++) await turn();
    const listing = http.expectOne(LISTING);
    expect(listing.request.context.get(APP_REGISTRY_REQUEST)).toBe(true);
    listing.flush(listed(['payers-claims', ['home.json']]));
    await turn();
    const file = http.expectOne(`${ORIGIN}/nuxeo/agentic-ui-apps/apps/payers-claims/home.json`);
    expect(file.request.context.get(APP_REGISTRY_REQUEST)).toBe(true);
    file.flush({});
    await read;
    http.verify();
  });
});
