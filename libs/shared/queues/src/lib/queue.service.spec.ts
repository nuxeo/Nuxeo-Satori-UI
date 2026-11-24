import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_DEFINITION_FILES } from '@agentic-ui/shared/app-registry';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import { firstValueFrom, of } from 'rxjs';

import { QueueService, isQueueId, queueFileUrl, queueLink, type QueueLoad } from './queue.service';

describe('where a queue is read', () => {
  it('is in queues/, beside the layouts and the home, named by its id', () => {
    expect(queueFileUrl('/agentic-ui-config/bootstrap.json', 'unassigned-claims')).toBe(
      '/agentic-ui-config/queues/unassigned-claims.json',
    );
    expect(queueFileUrl('/nuxeo/agentic-ui-config/bootstrap.json?v=2#x', 'open')).toBe(
      '/nuxeo/agentic-ui-config/queues/open.json',
    );
  });

  it('opens at /queues/<id>', () => {
    expect(queueLink('unassigned-claims')).toEqual(['/queues', 'unassigned-claims']);
  });

  it('is named by an id of layout version 2, and nothing that could leave the directory', () => {
    expect(['unassigned-claims', 'q.1_b', '0', 'a'.repeat(64)].every(isQueueId)).toBe(true);
    expect(
      ['', '..', '.hidden', '../home', 'a/b', 'a b', 'a%2Fb', 'a'.repeat(65)].some(isQueueId),
    ).toBe(false);
  });
});

describe('QueueService', () => {
  let service: QueueService;
  let http: HttpTestingController;
  let intercepted: string[];

  beforeEach(() => {
    intercepted = [];
    TestBed.configureTestingModule({
      providers: [
        // The app's interceptors add credentials and reset the idle timer: a configuration read
        // must pass them by, as the layouts and the home do.
        provideHttpClient(
          withInterceptors([
            (request, next) => {
              intercepted.push(request.url);
              return next(request);
            },
          ]),
        ),
        provideHttpClientTesting(),
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: '/agentic-ui-config/bootstrap.json' },
      ],
    });
    service = TestBed.inject(QueueService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const load = (
    id: string,
    answer: (request: ReturnType<HttpTestingController['expectOne']>) => void,
  ) => {
    const loaded = firstValueFrom(service.load(id));
    const request = http.expectOne(`/agentic-ui-config/queues/${id}.json`);
    expect(request.request.method).toBe('GET');
    answer(request);
    return loaded;
  };

  it('reads the file as it is served, past the interceptors', async () => {
    const content = {
      version: 2,
      label: 'Open',
      pageProvider: 'open_claims',
      columns: ['dc:title'],
    };
    expect(await load('open', (request) => request.flush(content))).toEqual<QueueLoad>({
      kind: 'file',
      content,
    });
    expect(intercepted).toEqual([]);
    // The control: the same client does pass through the interceptor when asked through it.
    TestBed.inject(HttpClient).get('/other').subscribe();
    http.expectOne('/other').flush({});
    expect(intercepted).toEqual(['/other']);
  });

  it('finds no queue where nothing is served, as on a server today', async () => {
    expect(
      await load('open', (request) => request.flush('', { status: 404, statusText: 'Not Found' })),
    ).toEqual<QueueLoad>({ kind: 'none' });
  });

  it('says why a queue it cannot read is not loaded', async () => {
    expect(
      await load('open', (request) =>
        request.flush('', { status: 500, statusText: 'Server Error' }),
      ),
    ).toEqual<QueueLoad>({ kind: 'unreadable', reason: 'HTTP 500' });
  });

  it('asks for nothing for an id that cannot name a queue', async () => {
    expect(await firstValueFrom(service.load('../home'))).toEqual<QueueLoad>({ kind: 'none' });
    http.expectNone(() => true);
  });
});

/** Where the app provides the app registry, a queue is read through it, by its path there. */
describe('QueueService, where the app provides the app registry', () => {
  it('reads the queue through APP_DEFINITION_FILES, and asks nothing for an id that is not one', async () => {
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
              return of({ from: 'registry' });
            },
            labelLanguages: () => of([]),
          },
        },
      ],
    });
    const service = TestBed.inject(QueueService);

    expect(await firstValueFrom(service.load('unassigned-claims'))).toEqual<QueueLoad>({
      kind: 'file',
      content: { from: 'registry' },
    });
    expect(await firstValueFrom(service.load('../home'))).toEqual<QueueLoad>({ kind: 'none' });
    expect(asked).toEqual([
      ['queues/unassigned-claims.json', '/nuxeo/agentic-ui-config/queues/unassigned-claims.json'],
    ]);
    TestBed.inject(HttpTestingController).verify();
  });
});
