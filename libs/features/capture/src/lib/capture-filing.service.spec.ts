import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TimeoutError } from 'rxjs';

import {
  CAPTURE_RETRY_DELAYS,
  CaptureFilingService,
  failureOf,
  transient,
  type CaptureSent,
} from './capture-filing.service';

const UID = '6f0c5c84-3c39-4a5e-9d7c-5c1a8e0d3003';
const UPLOAD = '/nuxeo/api/v1/automation/Blob.AttachOnDocument';
const RECORD = `/nuxeo/api/v1/id/${UID}`;

const photo = () =>
  new File([new Uint8Array([1, 2, 3, 4, 5])], 'DC-3003-photo-1.jpg', { type: 'image/jpeg' });

/** The record as the server reads it back: with the photo, or without. */
const record = (withPhoto: boolean) => ({
  uid: UID,
  type: 'DamageClaim',
  properties: {
    'files:files': withPhoto ? [{ file: { name: 'DC-3003-photo-1.jpg', length: '5' } }] : [],
  },
});

describe('CaptureFilingService', () => {
  let http: HttpTestingController;
  let filing: CaptureFilingService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CAPTURE_RETRY_DELAYS, useValue: [1_000, 4_000, 10_000] },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    filing = TestBed.inject(CaptureFilingService);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  function send(sentBefore = false) {
    const percents: number[] = [];
    const retries: number[] = [];
    const outcome: { sent?: CaptureSent; error?: unknown; done: boolean } = { done: false };
    filing
      .send(UID, 'files:files', photo(), sentBefore, {
        onPercent: (percent) => percents.push(percent),
        onRetry: (attempt) => retries.push(attempt),
      })
      .subscribe({
        next: (sent) => (outcome.sent = sent),
        error: (error: unknown) => {
          outcome.error = error;
          outcome.done = true;
        },
        complete: () => (outcome.done = true),
      });
    return { percents, retries, outcome };
  }

  it('uploads as the Attachments panel does, into the capture property, with its progress', async () => {
    const { percents, outcome } = send();
    const request = http.expectOne(UPLOAD);
    expect(request.request.method).toBe('POST');
    const body = request.request.body as FormData;
    const params = JSON.parse(await (body.get('request') as Blob).text());
    expect(params).toEqual({ params: { document: UID, save: 'true', xpath: 'files:files' } });
    expect((body.get('file') as File).name).toBe('DC-3003-photo-1.jpg');
    expect(request.request.reportProgress).toBe(true);
    request.event({ type: HttpEventType.UploadProgress, loaded: 2, total: 5 });
    request.event({ type: HttpEventType.UploadProgress, loaded: 5, total: 5 });
    request.flush(new Blob());
    expect(percents).toEqual([40, 100, 100]);
    expect(outcome).toEqual({ sent: 'sent', done: true });
  });

  it('tries again after a dropped connection, once the record is seen not to have the photo', () => {
    const { retries, outcome } = send();
    http.expectOne(UPLOAD).error(new ProgressEvent('error'), { status: 0 });
    expect(retries).toEqual([1]);
    // Nothing goes again before the pause.
    http.expectNone(UPLOAD);
    vi.advanceTimersByTime(1_000);
    http.expectOne(RECORD).flush(record(false));
    http.expectOne(UPLOAD).flush(new Blob());
    expect(outcome).toEqual({ sent: 'sent', done: true });
  });

  it('does not send a photo again whose answer was lost after the server kept it', () => {
    const { outcome } = send();
    http.expectOne(UPLOAD).error(new ProgressEvent('error'), { status: 0 });
    vi.advanceTimersByTime(1_000);
    http.expectOne(RECORD).flush(record(true));
    http.expectNone(UPLOAD);
    expect(outcome).toEqual({ sent: 'found', done: true });
  });

  it('asks the record first, before the first try, for a photo a request carried already', () => {
    const { outcome } = send(true);
    http.expectNone(UPLOAD);
    http.expectOne(RECORD).flush(record(true));
    expect(outcome).toEqual({ sent: 'found', done: true });
  });

  it('sends again when the record cannot be read either, while the connection is still down', () => {
    const { outcome } = send();
    http.expectOne(UPLOAD).error(new ProgressEvent('error'), { status: 0 });
    vi.advanceTimersByTime(1_000);
    http.expectOne(RECORD).error(new ProgressEvent('error'), { status: 0 });
    http.expectOne(UPLOAD).flush(new Blob());
    expect(outcome).toEqual({ sent: 'sent', done: true });
  });

  it('gives up after three tries again, with the connection error', () => {
    const { retries, outcome } = send();
    for (const pause of [1_000, 4_000, 10_000]) {
      http.expectOne(UPLOAD).error(new ProgressEvent('error'), { status: 503 });
      vi.advanceTimersByTime(pause);
      http.expectOne(RECORD).flush(record(false));
    }
    http.expectOne(UPLOAD).error(new ProgressEvent('error'), { status: 0 });
    expect(retries).toEqual([1, 2, 3]);
    expect(outcome.done).toBe(true);
    expect(failureOf(outcome.error)).toBe('connection');
  });

  it('never tries again what the server refused: 403, 404, 413, 400', () => {
    for (const [status, failure] of [
      [403, 'forbidden'],
      [404, 'gone'],
      [413, 'too-large'],
      [400, 'refused'],
    ] as const) {
      const { retries, outcome } = send();
      http.expectOne(UPLOAD).flush(new Blob(['no']), { status, statusText: 'No' });
      vi.advanceTimersByTime(20_000);
      http.expectNone(UPLOAD);
      expect(retries).toEqual([]);
      expect(failureOf(outcome.error)).toBe(failure);
    }
  });

  it('counts a try that took too long as a dropped connection', () => {
    expect(transient(new TimeoutError())).toBe(true);
    expect(transient(new Error('other'))).toBe(false);
  });
});
