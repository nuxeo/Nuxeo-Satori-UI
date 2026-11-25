import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AppRegistryService, type RegistryApp } from '@agentic-ui/shared/app-registry';
import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';
import { firstValueFrom, lastValueFrom, toArray } from 'rxjs';

import { DeploymentLayerService, LAYER_CHANGE_HEADER } from './deployment-layer.service';
import { LAYER_FORMAT } from './layer-state';

const APP = {
  id: 'payers-claims',
  url: 'apps/payers-claims/',
  files: [],
} as unknown as RegistryApp;
const URL = '/nuxeo/agentic-ui-apps/apps/payers-claims/layer/layouts/Claim/view.layout.json';

const STATE = {
  format: LAYER_FORMAT,
  app: 'payers-claims',
  path: 'layouts/Claim/view.layout.json',
  revision: 0,
  package: null,
  live: null,
  draft: null,
  versions: [],
  trail: [],
  packageChanged: false,
  permissions: { write: true, approve: false, approveRefused: null, selfApproval: false },
};

describe('DeploymentLayerService', () => {
  let http: HttpTestingController;
  let current: RegistryApp | null;

  beforeEach(() => {
    current = APP;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        {
          provide: AppRegistryService,
          useValue: { load: () => Promise.resolve(), current: () => current },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const service = (): DeploymentLayerService => TestBed.inject(DeploymentLayerService);

  /** Lets the registry's listing, a promise, resolve before the request is looked for. */
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

  it("reads a file of the app open's layer, as a GET, with no sign-in prompt", async () => {
    const readings = lastValueFrom(
      service().state('layouts/Claim/view.layout.json').pipe(toArray()),
    );
    await tick();
    const request = http.expectOne(URL);
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('X-No-Basic-Header')).toBe('true');
    request.flush(STATE);
    const [reading, read] = await readings;
    expect(reading).toEqual({ kind: 'reading' });
    expect(read.kind === 'state' && read.state.revision).toBe(0);
  });

  it('sends a change as JSON, with the header a page on another site cannot send', async () => {
    const answer = firstValueFrom(
      service().act('layouts/Claim/view.layout.json', {
        action: 'save',
        revision: 0,
        content: { version: 2 },
      }),
    );
    await tick();
    const request = http.expectOne(URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Content-Type')).toBe('application/json');
    expect(request.request.headers.get(LAYER_CHANGE_HEADER)).toBe('1');
    expect(request.request.body).toEqual({ action: 'save', revision: 0, content: { version: 2 } });
    request.flush({ ...STATE, revision: 1 });
    const read = await answer;
    expect(read.kind === 'state' && read.state.revision).toBe(1);
  });

  it("gives the server's refusal with its findings, and the file as it is when it sends it", async () => {
    const answer = firstValueFrom(
      service().act('layouts/Claim/view.layout.json', { action: 'save', revision: 0, content: {} }),
    );
    await tick();
    http.expectOne(URL).flush(
      {
        format: LAYER_FORMAT,
        error: 'invalid',
        message: 'The validator refuses the file: 1 finding(s).',
        findings: [{ path: 'bogus', kind: 'unknown', message: 'no' }],
        state: STATE,
      },
      { status: 422, statusText: 'Unprocessable' },
    );
    const read = await answer;
    expect(read.kind).toBe('refused');
    if (read.kind !== 'refused') return;
    expect(read.refusal.status).toBe(422);
    expect(read.refusal.findings).toHaveLength(1);
    expect(read.refusal.state?.revision).toBe(0);
  });

  it('tells a layer switched off, and a person the server does not count an administrator, apart', async () => {
    const off = firstValueFrom(service().act('queues/x.json', { action: 'submit', revision: 0 }));
    await tick();
    http
      .expectOne('/nuxeo/agentic-ui-apps/apps/payers-claims/layer/queues/x.json')
      .flush({ error: 'not-found' }, { status: 404, statusText: 'Not Found' });
    expect(await off).toEqual({ kind: 'unavailable', reason: 'off' });

    const forbidden = firstValueFrom(
      service().act('queues/x.json', { action: 'submit', revision: 0 }),
    );
    await tick();
    http
      .expectOne('/nuxeo/agentic-ui-apps/apps/payers-claims/layer/queues/x.json')
      .flush(
        { error: 'forbidden', message: 'Only an administrator' },
        { status: 403, statusText: 'Forbidden' },
      );
    expect(await forbidden).toEqual({ kind: 'unavailable', reason: 'forbidden' });

    const selfApproval = firstValueFrom(
      service().act('queues/x.json', { action: 'approve', revision: 2 }),
    );
    await tick();
    http
      .expectOne('/nuxeo/agentic-ui-apps/apps/payers-claims/layer/queues/x.json')
      .flush(
        { error: 'self-approval', message: 'You wrote this draft' },
        { status: 403, statusText: 'Forbidden' },
      );
    const refused = await selfApproval;
    expect(refused.kind === 'refused' && refused.refusal.message).toBe('You wrote this draft');
  });

  it('asks nothing when no app is open', async () => {
    current = null;
    expect(
      await firstValueFrom(service().act('queues/x.json', { action: 'submit', revision: 0 })),
    ).toEqual({
      kind: 'unavailable',
      reason: 'no-app',
    });
    http.expectNone(() => true);
  });

  it("reads an answer that is not the layer's as a failure", async () => {
    const answer = firstValueFrom(
      service().act('queues/x.json', { action: 'submit', revision: 0 }),
    );
    await tick();
    http
      .expectOne('/nuxeo/agentic-ui-apps/apps/payers-claims/layer/queues/x.json')
      .flush('<html>sign in</html>');
    expect((await answer).kind).toBe('failed');
  });
});
