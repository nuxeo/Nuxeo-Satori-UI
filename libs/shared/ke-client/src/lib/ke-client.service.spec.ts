import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, throwError, type Observable } from 'rxjs';

import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';

import { DEFAULT_KE_CIC_OPERATIONS, KE_CIC_OPERATIONS } from './ke.config';
import { KeClientService, KeEnrichmentError } from './ke-client.service';
import type { KeEnrichRequest, KeEnrichmentResult } from './ke.models';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reads the automation `params` back out of the multipart body.
 *
 * Asserting the request went out is not enough: everything `toAutomationParams` does —
 * joining `actions`, JSON-encoding `classes`, folding `maxWordCount`/`instructions` into
 * `extraJsonPayloadStr` — is only visible inside the `request` part's Blob, and a wrong
 * encoding there is a silently ignored enrichment option rather than a failure.
 *
 * Every step is guarded and throws rather than casting, so a shape change surfaces as a
 * named failure instead of an `undefined` that makes the assertion vacuous.
 */
async function readAutomationParams(req: TestRequest): Promise<Record<string, unknown>> {
  const body: unknown = req.request.body;
  if (!(body instanceof FormData)) {
    throw new Error('enrich() did not post a multipart FormData body');
  }
  const part = body.get('request');
  if (!(part instanceof Blob)) {
    throw new Error('the `request` part of the FormData is not a Blob');
  }
  const parsed: unknown = JSON.parse(await part.text());
  const params = isRecord(parsed) ? parsed['params'] : undefined;
  if (!isRecord(params)) {
    throw new Error('the `request` part carries no `params` object');
  }
  return params;
}

/** Narrow a rejection to `KeEnrichmentError` so `status` and `details` can be asserted. */
async function expectKeError(promise: Promise<unknown>): Promise<KeEnrichmentError> {
  const thrown = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(thrown).toBeInstanceOf(KeEnrichmentError);
  if (!(thrown instanceof KeEnrichmentError)) {
    throw new Error('expected a KeEnrichmentError');
  }
  return thrown;
}

describe('KeClientService', () => {
  let service: KeClientService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        { provide: KE_CIC_OPERATIONS, useValue: DEFAULT_KE_CIC_OPERATIONS },
      ],
    });

    service = TestBed.inject(KeClientService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function expectEnrichRequest() {
    const req = httpMock.expectOne(
      `/nuxeo/site/automation/${encodeURIComponent(DEFAULT_KE_CIC_OPERATIONS.enrich)}`,
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body instanceof FormData).toBe(true);
    return req;
  }

  /** Kick off an enrichment and hand back both the pending result and the captured request. */
  function enrich(
    request: KeEnrichRequest,
    blob = new Blob(['payload'], { type: 'text/plain' }),
  ): { result: Promise<KeEnrichmentResult>; req: TestRequest } {
    const result = firstValueFrom(service.enrich(blob, request));
    return { result, req: expectEnrichRequest() };
  }

  it('posts multipart form data to the KE enrich operation', async () => {
    const blob = new Blob(['hello world'], { type: 'text/plain' });
    const result$ = firstValueFrom(
      service.enrich(blob, {
        actions: ['text-summarization'],
        sourceId: 'doc-1',
        maxWordCount: 100,
      }),
    );

    const req = expectEnrichRequest();
    const requestBody = req.request.body as FormData;
    const requestBlob = requestBody.get('request');
    const inputBlob = requestBody.get('input');

    expect(requestBlob).toBeTruthy();
    expect(inputBlob).toBeTruthy();
    expect(inputBlob).toBeInstanceOf(File);
    req.flush(
      JSON.stringify({
        id: 'job-1',
        status: 'Complete',
        inProgress: false,
        results: [
          {
            objectKey: 'documents/doc-1.pdf',
            textSummary: { isSuccess: true, result: 'Summary text' },
          },
        ],
      }),
    );

    const result = await result$;
    expect(result.requestId).toBe('job-1');
    expect(result.objectKey).toBe('documents/doc-1.pdf');
    expect(result.textSummary?.result).toBe('Summary text');
  });

  it('parses named entity outputs from the Context API result payload', async () => {
    const result$ = firstValueFrom(
      service.enrich(new Blob(['img'], { type: 'image/png' }), {
        actions: ['named-entity-recognition-image'],
      }),
    );

    const req = expectEnrichRequest();
    req.flush(
      JSON.stringify({
        inProgress: false,
        results: [
          {
            namedEntityImage: {
              isSuccess: true,
              result: {
                ORGANIZATION: ['Hyland', 'Hyland'],
                LOCATION: ['Cleveland'],
              },
            },
          },
        ],
      }),
    );

    const result = await result$;
    expect(result.namedEntityImage?.result).toEqual({
      ORGANIZATION: ['Hyland'],
      LOCATION: ['Cleveland'],
    });
  });

  it('unwraps the generic connector response envelope when present', async () => {
    const result$ = firstValueFrom(
      service.enrich(new Blob(['test'], { type: 'text/plain' }), {
        actions: ['text-classification'],
      }),
    );

    const req = expectEnrichRequest();
    req.flush(
      JSON.stringify({
        responseCode: 200,
        responseMessage: 'OK',
        response: {
          inProgress: false,
          results: [
            {
              textClassification: { isSuccess: true, result: 'Contract' },
            },
          ],
        },
      }),
    );

    const result = await result$;
    expect(result.textClassification?.result).toBe('Contract');
  });

  it('surfaces connector errors as KeEnrichmentError', async () => {
    const result$ = firstValueFrom(
      service.enrich(new Blob(['test'], { type: 'text/plain' }), {
        actions: ['text-classification'],
      }),
    );

    const req = expectEnrichRequest();
    req.flush(
      JSON.stringify({
        responseCode: 500,
        responseMessage: 'No authentication info for calling the Enrichment service.',
        response: {},
      }),
    );

    await expect(result$).rejects.toBeInstanceOf(KeEnrichmentError);
    await expect(result$).rejects.toThrow(/No authentication info/);
  });

  describe('automation parameters', () => {
    it('serialises every optional enrichment parameter into the automation params', async () => {
      const { result, req } = enrich({
        actions: ['text-classification', 'text-summarization'],
        sourceId: 'doc-1',
        configName: 'contracts-config',
        classes: ['Invoice', 'Contract'],
        maxWordCount: 120,
        instructions: { tone: 'neutral' },
        v2Actions: { 'text-summarization': { maxWordCount: 50 } },
      });

      expect(await readAutomationParams(req)).toEqual({
        actions: 'text-classification,text-summarization',
        sourceId: 'doc-1',
        configName: 'contracts-config',
        classes: JSON.stringify(['Invoice', 'Contract']),
        extraJsonPayloadStr: JSON.stringify({
          maxWordCount: 120,
          instructions: { tone: 'neutral' },
        }),
        instructionsV2JsonStr: JSON.stringify({ 'text-summarization': { maxWordCount: 50 } }),
      });

      req.flush(JSON.stringify({ inProgress: false, results: [] }));
      await result;
    });

    it('sends only `actions` when nothing optional is supplied', async () => {
      const { result, req } = enrich({ actions: ['image-description'] });

      // Present first: the one parameter that is always sent...
      const params = await readAutomationParams(req);
      expect(params['actions']).toBe('image-description');
      // ...then the absence of the rest, so an accidental `undefined` value cannot pass.
      expect(Object.keys(params)).toEqual(['actions']);

      req.flush(JSON.stringify({ inProgress: false, results: [] }));
      await result;
    });

    it('drops an empty classes list rather than sending an empty JSON array', async () => {
      const { result, req } = enrich({ actions: ['text-classification'], classes: [] });

      const params = await readAutomationParams(req);
      expect(params['actions']).toBe('text-classification');
      expect(params).not.toHaveProperty('classes');

      req.flush(JSON.stringify({ inProgress: false, results: [] }));
      await result;
    });

    it('folds instructions into extraJsonPayloadStr without a maxWordCount', async () => {
      const { result, req } = enrich({
        actions: ['text-summarization'],
        instructions: { audience: 'legal' },
      });

      expect(await readAutomationParams(req)).toEqual({
        actions: 'text-summarization',
        extraJsonPayloadStr: JSON.stringify({ instructions: { audience: 'legal' } }),
      });

      req.flush(JSON.stringify({ inProgress: false, results: [] }));
      await result;
    });

    it('keeps a zero maxWordCount, which is a value and not an absence', async () => {
      const { result, req } = enrich({ actions: ['text-summarization'], maxWordCount: 0 });

      expect(await readAutomationParams(req)).toEqual({
        actions: 'text-summarization',
        extraJsonPayloadStr: JSON.stringify({ maxWordCount: 0 }),
      });

      req.flush(JSON.stringify({ inProgress: false, results: [] }));
      await result;
    });

    it('prefixes the automation URL with a configured API origin, without a double slash', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: NUXEO_API_ORIGIN, useValue: 'https://nuxeo.example.com/' },
          { provide: KE_CIC_OPERATIONS, useValue: DEFAULT_KE_CIC_OPERATIONS },
        ],
      });
      const scopedService = TestBed.inject(KeClientService);
      const scopedMock = TestBed.inject(HttpTestingController);

      void firstValueFrom(
        scopedService.enrich(new Blob(['x']), { actions: ['image-description'] }),
      ).catch(() => undefined);

      const req = scopedMock.expectOne(
        `https://nuxeo.example.com/nuxeo/site/automation/${encodeURIComponent(
          DEFAULT_KE_CIC_OPERATIONS.enrich,
        )}`,
      );
      req.flush(JSON.stringify({ inProgress: false, results: [] }));
      scopedMock.verify();
    });
  });

  describe('response normalisation', () => {
    it('treats an empty response body as a single empty result', async () => {
      const { result, req } = enrich({ actions: ['text-summarization'] });
      req.flush('');

      // An empty body parses to `{}`, which has no `results` array, so the connector's
      // "single result object" shape applies and every field normalises to null.
      await expect(result).resolves.toEqual({
        requestId: null,
        status: null,
        inProgress: false,
        objectKey: null,
        imageDescription: null,
        textSummary: null,
        textClassification: null,
        namedEntityText: null,
        namedEntityImage: null,
        imageMetadata: null,
        textMetadata: null,
        generalProcessingErrors: [],
        raw: {},
      });
    });

    it('accepts a bare single result object with no results array', async () => {
      const { result, req } = enrich({ actions: ['text-summarization'] });
      req.flush(
        JSON.stringify({
          objectKey: '  documents/doc-2.pdf  ',
          textSummary: { isSuccess: true, result: 'Bare summary' },
        }),
      );

      const normalized = await result;
      // The envelope ids are not available on this shape, so they must be null rather
      // than the result object's own fields.
      expect(normalized.requestId).toBeNull();
      expect(normalized.status).toBeNull();
      expect(normalized.inProgress).toBe(false);
      // `asString` trims.
      expect(normalized.objectKey).toBe('documents/doc-2.pdf');
      expect(normalized.textSummary).toEqual({
        isSuccess: true,
        result: 'Bare summary',
        error: null,
      });
    });

    it('yields an empty result for a bare array payload', async () => {
      const { result, req } = enrich({ actions: ['text-summarization'] });
      req.flush('[]');

      const normalized = await result;
      expect(normalized.inProgress).toBe(false);
      expect(normalized.requestId).toBeNull();
      expect(normalized.objectKey).toBeNull();
      expect(normalized.textSummary).toBeNull();
      expect(normalized.generalProcessingErrors).toEqual([]);
      expect(normalized.raw).toEqual([]);
    });

    it('reports an in-progress job without any results yet', async () => {
      const { result, req } = enrich({ actions: ['text-summarization'] });
      req.flush(
        JSON.stringify({ id: 'job-2', status: 'Processing', inProgress: true, results: [] }),
      );

      await expect(result).resolves.toMatchObject({
        requestId: 'job-2',
        status: 'Processing',
        inProgress: true,
        objectKey: null,
        textSummary: null,
      });
    });

    it('normalises a non-string result and a non-object action entry to null', async () => {
      const { result, req } = enrich({ actions: ['text-summarization'] });
      req.flush(
        JSON.stringify({
          inProgress: false,
          results: [
            {
              objectKey: 12345,
              // Not an object: no isSuccess/result/error can be read from it.
              textSummary: 'just a string',
              // An object, but `result` is not a string.
              textClassification: { isSuccess: false, result: { label: 'Contract' } },
              imageDescription: [],
            },
          ],
        }),
      );

      const normalized = await result;
      expect(normalized.objectKey).toBeNull();
      expect(normalized.textSummary).toBeNull();
      expect(normalized.imageDescription).toBeNull();
      expect(normalized.textClassification).toEqual({
        isSuccess: false,
        result: null,
        error: null,
      });
    });

    it('normalises the image and text metadata dictionaries', async () => {
      const { result, req } = enrich({ actions: ['image-description'] });
      req.flush(
        JSON.stringify({
          inProgress: false,
          results: [
            {
              imageMetadata: {
                isSuccess: true,
                result: { width: 1024, colourSpace: 'sRGB' },
              },
              // `result` is not a dictionary, so it must normalise to null while the
              // success flag and error are still reported.
              textMetadata: {
                isSuccess: false,
                result: ['not', 'a', 'dictionary'],
                error: { errorType: 'MetadataError', message: 'no metadata extracted' },
              },
            },
          ],
        }),
      );

      const normalized = await result;
      expect(normalized.imageMetadata).toEqual({
        isSuccess: true,
        result: { width: 1024, colourSpace: 'sRGB' },
        error: null,
      });
      expect(normalized.textMetadata).toEqual({
        isSuccess: false,
        result: null,
        error: { errorType: 'MetadataError', message: 'no metadata extracted' },
      });
    });

    it('drops entity buckets that hold nothing usable, and the map when all of them do', async () => {
      const { result, req } = enrich({ actions: ['named-entity-recognition-text'] });
      req.flush(
        JSON.stringify({
          inProgress: false,
          results: [
            {
              namedEntityText: {
                isSuccess: true,
                result: {
                  PERSON: ['Holmes', 'Holmes', '  Watson  '],
                  // Not an array at all.
                  ORGANIZATION: 'Hyland',
                  // Array, but nothing in it survives `asString`.
                  LOCATION: [1, 2, null, '   '],
                  EMPTY: [],
                },
              },
              // A map whose every bucket is unusable must collapse to null, not `{}`.
              namedEntityImage: { isSuccess: true, result: { MISC: [null, ''] } },
            },
          ],
        }),
      );

      const normalized = await result;
      expect(normalized.namedEntityText).toEqual({
        isSuccess: true,
        // De-duplicated and trimmed.
        result: { PERSON: ['Holmes', 'Watson'] },
        error: null,
      });
      expect(normalized.namedEntityImage).toEqual({ isSuccess: true, result: null, error: null });
    });

    it('normalises an entity result whose result is not a map at all', async () => {
      const { result, req } = enrich({ actions: ['named-entity-recognition-text'] });
      req.flush(
        JSON.stringify({
          inProgress: false,
          results: [{ namedEntityText: { isSuccess: false, result: 'nothing found' } }],
        }),
      );

      await expect(result).resolves.toMatchObject({
        namedEntityText: { isSuccess: false, result: null, error: null },
      });
    });

    it('collects general processing errors and discards the entries that are not errors', async () => {
      const { result, req } = enrich({ actions: ['text-summarization'] });
      req.flush(
        JSON.stringify({
          inProgress: false,
          results: [
            {
              generalProcessingErrors: [
                { errorType: 'UnsupportedMediaType', message: 'audio/wav is not supported' },
                // Not objects: dropped rather than surfaced as blank error rows.
                'a bare string',
                null,
                ['nested'],
                // An object, but with nothing readable on it.
                { code: 500 },
              ],
              textSummary: {
                isSuccess: false,
                result: null,
                error: { errorType: 'Timeout', message: '   ' },
              },
            },
          ],
        }),
      );

      const normalized = await result;
      expect(normalized.generalProcessingErrors).toEqual([
        { errorType: 'UnsupportedMediaType', message: 'audio/wav is not supported' },
        { errorType: null, message: null },
      ]);
      // A whitespace-only message normalises to null so the UI shows the type, not a blank.
      expect(normalized.textSummary).toEqual({
        isSuccess: false,
        result: null,
        error: { errorType: 'Timeout', message: null },
      });
    });

    it('yields no processing errors when the field is not a list', async () => {
      const { result, req } = enrich({ actions: ['text-summarization'] });
      req.flush(
        JSON.stringify({
          inProgress: false,
          results: [{ generalProcessingErrors: { errorType: 'NotAList' } }],
        }),
      );

      await expect(result).resolves.toMatchObject({ generalProcessingErrors: [] });
    });
  });

  describe('error handling', () => {
    it('rejects a response body that is not JSON', async () => {
      const { result, req } = enrich({ actions: ['text-summarization'] });
      req.flush('<html><body>Nuxeo login page</body></html>');

      const error = await expectKeError(result);
      expect(error.message).toBe('Knowledge Enrichment returned a non-JSON response.');
      expect(error.messageKey).toBe('ke-client.message.non-json-response');
      // Thrown from `normalize`, so there is no HTTP status to report.
      expect(error.status).toBeUndefined();
      expect(error.details).toBeUndefined();
    });

    it('gives a credentials-specific message for a 403 in the connector envelope', async () => {
      const { result, req } = enrich({ actions: ['text-summarization'] });
      req.flush(
        JSON.stringify({
          responseCode: 403,
          responseMessage: 'Forbidden',
          response: { detail: 'client is not entitled' },
        }),
      );

      const error = await expectKeError(result);
      // The upstream `Forbidden` is deliberately replaced: a 403 here means the KE
      // credentials are not entitled to the Context API, which is actionable advice.
      expect(error.message).toBe(
        'Knowledge Enrichment credentials are not authorized for the Context API.',
      );
      expect(error.status).toBe(403);
      expect(error.details).toEqual({ detail: 'client is not entitled' });
      // The client's own wording carries a key, so the page showing it can translate it.
      expect(error.messageKey).toBe('ke-client.message.not-authorized');
    });

    it('falls back to the status code when the envelope carries no message', async () => {
      const { result, req } = enrich({ actions: ['text-summarization'] });
      req.flush(JSON.stringify({ responseCode: 502, responseMessage: '', response: null }));

      const error = await expectKeError(result);
      expect(error.message).toBe('Knowledge Enrichment returned HTTP 502.');
      expect(error.status).toBe(502);
      expect(error.details).toBeNull();
      expect(error.messageKey).toBe('ke-client.message.http-status');
      expect(error.messageParams).toEqual({ code: 502 });
    });

    it('reads `detail` out of a JSON error body on an HTTP failure', async () => {
      const { result, req } = enrich({ actions: ['text-summarization'] });
      req.flush(JSON.stringify({ detail: 'Quota exceeded for this tenant', message: 'Too Many' }), {
        status: 429,
        statusText: 'Too Many Requests',
      });

      const error = await expectKeError(result);
      // `detail` wins over `message`.
      expect(error.message).toBe('Quota exceeded for this tenant');
      expect(error.status).toBe(429);
    });

    it('reads `message` out of a JSON error body with no detail', async () => {
      const { result, req } = enrich({ actions: ['text-summarization'] });
      req.flush(JSON.stringify({ message: 'Automation operation not found' }), {
        status: 404,
        statusText: 'Not Found',
      });

      const error = await expectKeError(result);
      expect(error.message).toBe('Automation operation not found');
      expect(error.status).toBe(404);
    });

    it('uses a non-JSON error body verbatim', async () => {
      const { result, req } = enrich({ actions: ['text-summarization'] });
      req.flush('Bad Gateway from the reverse proxy', {
        status: 502,
        statusText: 'Bad Gateway',
      });

      const error = await expectKeError(result);
      expect(error.message).toBe('Bad Gateway from the reverse proxy');
      expect(error.status).toBe(502);
    });

    it('surfaces the raw JSON body when it parses but carries neither detail nor message', async () => {
      const { result, req } = enrich({ actions: ['text-summarization'] });
      req.flush(JSON.stringify({ code: 'NO_DETAIL_FIELD' }), {
        status: 500,
        statusText: 'Server Error',
      });

      const error = await expectKeError(result);
      // NOTE: asserts what the code *does*. `extractErrorDetail` ends its string branch with
      // `parsed.detail ?? parsed.message ?? raw`, so a JSON body with neither field yields
      // the whole serialised body as the user-facing message — here, literally
      // `{"code":"NO_DETAIL_FIELD"}`. The `?? raw` fallback is clearly deliberate for the
      // *non*-JSON case (a proxy's plain-text "Bad Gateway"), but for a parsed object it
      // means raw JSON reaches the UI instead of the Angular-generated "Http failure ... 500"
      // message that the object branch would fall back to.
      //
      // Left as-is rather than changed: it is user-visible error copy, and which of the two
      // is better depends on what the connector actually returns in the field.
      expect(error.message).toBe('{"code":"NO_DETAIL_FIELD"}');
      expect(error.status).toBe(500);
      expect(error.details).toBe('{"code":"NO_DETAIL_FIELD"}');
    });

    it('falls back to the HttpErrorResponse message when there is no error body at all', async () => {
      const { result, req } = enrich({ actions: ['text-summarization'] });
      req.flush(null, { status: 503, statusText: 'Service Unavailable' });

      const error = await expectKeError(result);
      expect(error.message).toContain('503');
      expect(error.status).toBe(503);
      expect(error.details).toBeNull();
    });

    it('wraps a transport-level failure whose error body is an event object', async () => {
      const { result, req } = enrich({ actions: ['text-summarization'] });
      req.error(new ProgressEvent('error'));

      const error = await expectKeError(result);
      // The event object has neither `detail` nor `message`, so the HttpErrorResponse's own
      // message is what reaches the user.
      expect(error.message).toContain('Http failure');
      expect(error.details).toBeInstanceOf(ProgressEvent);
    });
  });
});

/**
 * `toKeError` has a third branch for a failure that is neither a `KeEnrichmentError` nor an
 * `HttpErrorResponse` — a bug in an interceptor, for instance. It is unreachable through the
 * testing backend (every backend failure is an `HttpErrorResponse`), so it needs its own
 * HttpClient with an interceptor that throws a plain error.
 */
describe('KeClientService when the failure is not an HTTP response', () => {
  it('wraps it as KeEnrichmentError with no status and the original error attached', async () => {
    const cause = new TypeError('an interceptor threw');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([(): Observable<never> => throwError(() => cause)])),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        { provide: KE_CIC_OPERATIONS, useValue: DEFAULT_KE_CIC_OPERATIONS },
      ],
    });

    const service = TestBed.inject(KeClientService);
    const httpMock = TestBed.inject(HttpTestingController);

    const error = await expectKeError(
      firstValueFrom(service.enrich(new Blob(['x']), { actions: ['text-summarization'] })),
    );

    expect(error.message).toBe('Knowledge Enrichment request failed unexpectedly.');
    expect(error.messageKey).toBe('ke-client.message.failed-unexpectedly');
    expect(error.status).toBeUndefined();
    expect(error.details).toBe(cause);
    // The interceptor short-circuited, so nothing ever reached the backend.
    httpMock.verify();
  });
});
