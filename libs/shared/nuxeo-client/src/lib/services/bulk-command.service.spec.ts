import { HttpErrorResponse, provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { firstValueFrom } from 'rxjs';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import { BulkCommandService, readBulkCommandStatus } from './bulk-command.service';

const ID = 'eb3886b6-d528-44be-a3a1-306e12c2cce2';

/** As Nuxeo 2025.10 answers, measured. */
const status = (overrides: Record<string, unknown> = {}) => ({
  'entity-type': 'bulkStatus',
  commandId: ID,
  state: 'SCHEDULED',
  processed: 0,
  skipCount: 0,
  error: false,
  errorCount: 0,
  total: 0,
  action: 'trash',
  username: 'ada',
  submitted: '2026-11-23T17:45:06.262Z',
  completed: null,
  ...overrides,
});

describe('BulkCommandService', () => {
  let service: BulkCommandService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });
    service = TestBed.inject(BulkCommandService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it("runs the action over the page provider's whole result, its parameters each a queryParams value", async () => {
    const first = firstValueFrom(
      service.runOverPageProvider(
        'member_claims',
        { parameters: ['m-1', 'Smith, Jane & co', '$currentUser'] },
        'trash',
        { value: true },
      ),
    );
    const request = http.expectOne(() => true);
    expect(request.request.method).toBe('POST');
    expect(request.request.urlWithParams).toBe(
      '/nuxeo/api/v1/search/pp/member_claims/bulk/trash' +
        '?queryParams=m-1&queryParams=Smith%2C%20Jane%20%26%20co&queryParams=%24currentUser',
    );
    expect(request.request.body).toEqual({ value: true });
    request.flush(status(), { status: 202, statusText: 'Accepted' });
    expect(await first).toEqual({
      commandId: ID,
      state: 'SCHEDULED',
      processed: 0,
      total: 0,
      errorCount: 0,
      skipCount: 0,
      errorMessage: null,
      ended: false,
      result: null,
    });
  });

  it('limits the command to the records asked for, after the parameters', async () => {
    const first = firstValueFrom(
      service.runOverPageProvider('member_claims', { parameters: ['m-1'], limit: 121 }, 'trash', {
        value: true,
      }),
    );
    const request = http.expectOne(() => true);
    expect(request.request.urlWithParams).toBe(
      '/nuxeo/api/v1/search/pp/member_claims/bulk/trash?queryParams=m-1&queryLimit=121',
    );
    request.flush(status());
    expect((await first).state).toBe('SCHEDULED');
  });

  it('sends no query string for a page provider asked with no parameters', async () => {
    const first = firstValueFrom(
      service.runOverPageProvider('default_search', {}, 'trash', { value: true }),
    );
    const request = http.expectOne('/nuxeo/api/v1/search/pp/default_search/bulk/trash');
    request.flush(status());
    expect((await first).state).toBe('SCHEDULED');
  });

  it('refuses, without a request, a name, an action or a parameter that cannot be sent', async () => {
    const refused = [
      service.runOverPageProvider('../search', {}, 'trash', {}),
      service.runOverPageProvider('member_claims', {}, 'trash?x=1', {}),
      service.runOverPageProvider('member_claims', {}, '', {}),
      service.runOverPageProvider('member_claims', { parameters: ['m-1', ''] }, 'trash', {}),
      service.runOverPageProvider('member_claims', { limit: 0 }, 'trash', {}),
      service.runOverPageProvider('member_claims', { limit: 2.5 }, 'trash', {}),
      service.status('../../automation'),
      service.abort('not-an-id'),
    ];
    for (const observable of refused) {
      await expect(firstValueFrom(observable)).rejects.toThrow();
    }
    http.expectNone(() => true);
  });

  it('errors as the server answers when it refuses the command, such as an action it does not open over HTTP', async () => {
    const first = firstValueFrom(
      service.runOverPageProvider('member_claims', { parameters: ['m-1'] }, 'trash', {
        value: true,
      }),
    );
    http
      .expectOne(() => true)
      .flush(
        {
          'entity-type': 'exception',
          status: 403,
          message: 'Action name: trash is not exposed to HTTP',
        },
        { status: 403, statusText: 'Forbidden' },
      );
    const error = await first.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect((error as HttpErrorResponse).status).toBe(403);
  });

  it('reads the status of a command', async () => {
    const read = firstValueFrom(service.status(ID));
    const request = http.expectOne(`/nuxeo/api/v1/bulk/${ID}`);
    expect(request.request.method).toBe('GET');
    request.flush(
      status({
        state: 'COMPLETED',
        processed: 3,
        total: 3,
        errorCount: 1,
        errorMessage: 'Cannot save document: x',
        completed: '2026-11-23T17:52:49.015Z',
        result: { url: 'nxbigblob/x' },
      }),
    );
    expect(await read).toEqual(
      expect.objectContaining({
        state: 'COMPLETED',
        processed: 3,
        total: 3,
        errorCount: 1,
        errorMessage: 'Cannot save document: x',
        ended: true,
        result: { url: 'nxbigblob/x' },
      }),
    );
  });

  it('errors on a command the server does not know', async () => {
    const read = firstValueFrom(service.status(ID));
    http.expectOne(`/nuxeo/api/v1/bulk/${ID}`).flush(
      {
        'entity-type': 'exception',
        status: 404,
        message: `Bulk command with id=${ID} doesn't exist`,
      },
      { status: 404, statusText: 'Not Found' },
    );
    await expect(read).rejects.toBeInstanceOf(HttpErrorResponse);
  });

  it('stops a command', async () => {
    const stopped = firstValueFrom(service.abort(ID));
    const request = http.expectOne(`/nuxeo/api/v1/bulk/${ID}/abort`);
    expect(request.request.method).toBe('PUT');
    request.flush(status({ state: 'ABORTED', processed: 1000, total: 2314 }));
    // ABORTED at once; the batches already started still finish: not ended yet.
    expect(await stopped).toEqual(
      expect.objectContaining({ state: 'ABORTED', processed: 1000, ended: false }),
    );
  });
});

describe('readBulkCommandStatus', () => {
  it('ends a command only once the server writes when it completed', () => {
    expect(readBulkCommandStatus(status({ state: 'ABORTED' })).ended).toBe(false);
    expect(
      readBulkCommandStatus(status({ state: 'ABORTED', completed: '2026-11-23T17:45:25.398Z' }))
        .ended,
    ).toBe(true);
    expect(
      readBulkCommandStatus(status({ state: 'RUNNING', completed: '2026-11-23T17:45:25.398Z' }))
        .ended,
    ).toBe(false);
  });

  it('reads a state it does not know as UNKNOWN, and a count that is not one as 0', () => {
    expect(
      readBulkCommandStatus(status({ state: 'EXPLODED', processed: -4, total: 'many' })),
    ).toEqual(expect.objectContaining({ state: 'UNKNOWN', processed: 0, total: 0 }));
  });

  it('refuses what is not the status of a bulk command', () => {
    for (const body of [
      null,
      'eb3886b6',
      { 'entity-type': 'exception', status: 500 },
      status({ commandId: '../x' }),
      status({ 'entity-type': 'document' }),
    ]) {
      expect(() => readBulkCommandStatus(body)).toThrow(
        'the server did not answer with the status of a bulk command',
      );
    }
  });
});
