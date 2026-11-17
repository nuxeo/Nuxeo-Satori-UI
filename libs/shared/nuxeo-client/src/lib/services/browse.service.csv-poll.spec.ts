import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';

import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import { BrowseService } from './browse.service';

const EXEC_ID = '1a2b3c4d-1111-2222-3333-444455556666';
const STATUS_URL = `/nuxeo/site/api/v1/automation/Bulk.RunAction/@async/${EXEC_ID}/status`;
const RESULT_URL = `/nuxeo/site/api/v1/automation/Bulk.RunAction/@async/${EXEC_ID}`;
const BLOB_URL = 'http://nuxeo:8080/nuxeo/site/api/v1/bulk/csv/result.csv';
const BLOB_PATH = '/nuxeo/site/api/v1/bulk/csv/result.csv';

describe('BrowseService.pollAndDownloadCsv', () => {
  let service: BrowseService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });
    service = TestBed.inject(BrowseService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
  });

  it('waits before the first status call, then downloads the blob the status names', async () => {
    const pending = firstValueFrom(service.pollAndDownloadCsv(EXEC_ID));

    httpMock.expectNone(STATUS_URL);
    await vi.advanceTimersByTimeAsync(1000);

    httpMock
      .expectOne(STATUS_URL)
      .flush(JSON.stringify({ url: BLOB_URL }), { status: 200, statusText: 'OK' });

    const download = httpMock.expectOne(BLOB_PATH);
    expect(download.request.responseType).toBe('blob');
    download.flush(new Blob(['uid,title\n1,A\n'], { type: 'text/csv' }));

    const csv = await pending;
    expect(await csv.text()).toBe('uid,title\n1,A\n');
  });

  it('polls again after 1.5s while the action is still running', async () => {
    const pending = firstValueFrom(service.pollAndDownloadCsv(EXEC_ID));

    await vi.advanceTimersByTimeAsync(1000);
    httpMock.expectOne(STATUS_URL).flush('', { status: 202, statusText: 'Accepted' });

    httpMock.expectNone(STATUS_URL);
    await vi.advanceTimersByTimeAsync(1500);

    httpMock
      .expectOne(STATUS_URL)
      .flush(JSON.stringify({ url: BLOB_URL }), { status: 200, statusText: 'OK' });
    httpMock.expectOne(BLOB_PATH).flush(new Blob(['done'], { type: 'text/csv' }));

    expect(await (await pending).text()).toBe('done');
  });

  // Nuxeo answers the status call with 200 and a `bulkStatus` message, not 202, while the job is
  // scheduled or running. That message used to be saved as the CSV.
  const bulkStatus = (state: string): string =>
    JSON.stringify({
      'entity-type': 'bulkStatus',
      value: { 'entity-type': 'bulkStatus', commandId: 'cmd-1', state, processed: 0, total: 13 },
    });

  it.each(['SCHEDULED', 'RUNNING', 'SCROLLING_RUNNING'])(
    'keeps polling when the status call answers 200 with a %s bulkStatus message',
    async (state) => {
      const pending = firstValueFrom(service.pollAndDownloadCsv(EXEC_ID));

      await vi.advanceTimersByTimeAsync(1000);
      httpMock.expectOne(STATUS_URL).flush(bulkStatus(state), { status: 200, statusText: 'OK' });

      httpMock.expectNone(BLOB_PATH);
      await vi.advanceTimersByTimeAsync(1500);
      httpMock
        .expectOne(STATUS_URL)
        .flush(JSON.stringify({ url: BLOB_URL }), { status: 200, statusText: 'OK' });
      httpMock.expectOne(BLOB_PATH).flush(new Blob(['uid,title\n1,A\n'], { type: 'text/csv' }));

      const csv = await pending;
      expect(await csv.text()).toBe('uid,title\n1,A\n');
    },
  );

  it('reads the status of a bulkStatus message that is not wrapped in `value`', async () => {
    const pending = firstValueFrom(service.pollAndDownloadCsv(EXEC_ID));
    await vi.advanceTimersByTimeAsync(1000);
    httpMock
      .expectOne(STATUS_URL)
      .flush(JSON.stringify({ 'entity-type': 'bulkStatus', state: 'RUNNING' }), {
        status: 200,
        statusText: 'OK',
      });

    await vi.advanceTimersByTimeAsync(1500);
    httpMock
      .expectOne(STATUS_URL)
      .flush(JSON.stringify({ url: BLOB_URL }), { status: 200, statusText: 'OK' });
    httpMock.expectOne(BLOB_PATH).flush(new Blob(['done'], { type: 'text/csv' }));

    expect(await (await pending).text()).toBe('done');
  });

  it('fetches the result when a 200 bulkStatus message says COMPLETED', async () => {
    const pending = firstValueFrom(service.pollAndDownloadCsv(EXEC_ID));
    await vi.advanceTimersByTimeAsync(1000);
    httpMock
      .expectOne(STATUS_URL)
      .flush(bulkStatus('COMPLETED'), { status: 200, statusText: 'OK' });

    httpMock.expectOne(RESULT_URL).flush({ url: BLOB_URL });
    httpMock.expectOne(BLOB_PATH).flush(new Blob(['finished'], { type: 'text/csv' }));

    expect(await (await pending).text()).toBe('finished');
  });

  it('fails instead of saving a file when the job is ABORTED', async () => {
    const pending = firstValueFrom(service.pollAndDownloadCsv(EXEC_ID));
    await vi.advanceTimersByTimeAsync(1000);
    httpMock.expectOne(STATUS_URL).flush(bulkStatus('ABORTED'), { status: 200, statusText: 'OK' });

    httpMock.expectNone(RESULT_URL);
    httpMock.expectNone(BLOB_PATH);
    await expect(pending).rejects.toThrow('aborted');
  });

  it('treats a non-JSON 200 body as the CSV itself', async () => {
    const pending = firstValueFrom(service.pollAndDownloadCsv(EXEC_ID));
    await vi.advanceTimersByTimeAsync(1000);
    httpMock.expectOne(STATUS_URL).flush('uid,title\n1,A\n', { status: 200, statusText: 'OK' });

    const csv = await pending;
    expect(csv.type).toBe('text/csv');
    expect(await csv.text()).toBe('uid,title\n1,A\n');
  });

  it('reads the result endpoint when the completion redirect loses the auth header', async () => {
    const pending = firstValueFrom(service.pollAndDownloadCsv(EXEC_ID));
    await vi.advanceTimersByTimeAsync(1000);
    httpMock
      .expectOne(STATUS_URL)
      .flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    httpMock.expectOne(RESULT_URL).flush({ url: BLOB_URL });
    httpMock.expectOne(BLOB_PATH).flush(new Blob(['recovered'], { type: 'text/csv' }));

    expect(await (await pending).text()).toBe('recovered');
  });

  it('recovers the same way from a status 0, which is how a blocked redirect surfaces', async () => {
    const pending = firstValueFrom(service.pollAndDownloadCsv(EXEC_ID));
    await vi.advanceTimersByTimeAsync(1000);
    httpMock.expectOne(STATUS_URL).error(new ProgressEvent('error'), { status: 0 });

    httpMock.expectOne(RESULT_URL).flush({ url: BLOB_URL });
    httpMock.expectOne(BLOB_PATH).flush(new Blob(['recovered'], { type: 'text/csv' }));

    expect(await (await pending).text()).toBe('recovered');
  });

  it('surfaces any other status failure instead of polling forever', async () => {
    const pending = firstValueFrom(service.pollAndDownloadCsv(EXEC_ID));
    await vi.advanceTimersByTimeAsync(1000);
    httpMock.expectOne(STATUS_URL).flush('nope', { status: 403, statusText: 'Forbidden' });

    httpMock.expectNone(RESULT_URL);
    await expect(pending).rejects.toMatchObject({ status: 403 });
  });

  it('propagates a failure to read the result endpoint after the 401 recovery', async () => {
    const pending = firstValueFrom(service.pollAndDownloadCsv(EXEC_ID));
    await vi.advanceTimersByTimeAsync(1000);
    httpMock
      .expectOne(STATUS_URL)
      .flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    httpMock.expectOne(RESULT_URL).flush('gone', { status: 500, statusText: 'Server Error' });

    await expect(pending).rejects.toMatchObject({ status: 500 });
  });
});
