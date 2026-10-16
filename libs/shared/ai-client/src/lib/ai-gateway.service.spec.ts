import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AI_BACKEND_URL } from './ai.config';
import { AiFeatureFlagService } from './ai-feature-flag.service';
import { AiGatewayService } from './ai-gateway.service';

/**
 * Every method here is a URL and request-body builder over Nuxeo Automation, so `HttpTestingController`
 * covers all of it with no marketplace package installed.
 *
 * These two files were briefly excluded from coverage instrumentation on the grounds that the AI
 * backend is not in this repository. `scripts/beta-harness/coverage-gate.mjs` already rebuts that
 * exactly — "A missing backend does not prevent unit-testing an Angular HTTP client against mocked
 * responses, which is how every other client here is tested" — and records that excluding
 * `shared-ai-client` had been tried once before by mistake. The exclusion is gone and this is what
 * replaces it.
 *
 * What is asserted for each operation is the part that can silently break: the operation id in the
 * path, and the `params` envelope the Automation API requires. A typo in either produces an HTTP 500
 * that looks exactly like the absent-package case, which is why it needs pinning here rather than
 * being left to integration testing.
 *
 * The real `AiFeatureFlagService` reports AI as disabled for every user, and the gateway refuses to
 * send while it does. These cases stub the flag on so the request-shaping contract stays covered
 * while the feature is switched off; the refusal itself is asserted separately at the bottom.
 */
describe('AiGatewayService', () => {
  let service: AiGatewayService;
  let http: HttpTestingController;

  /** A trailing slash on purpose: `op()` has to strip it rather than emit a double slash. */
  const backend = 'https://nuxeo.example.com/nuxeo/';

  function configure(aiEnabled: boolean): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AI_BACKEND_URL, useValue: backend },
        { provide: AiFeatureFlagService, useValue: { aiEnabled: signal(aiEnabled) } },
        AiGatewayService,
      ],
    });

    service = TestBed.inject(AiGatewayService);
    http = TestBed.inject(HttpTestingController);
  }

  beforeEach(() => {
    configure(true);
  });

  afterEach(() => {
    // Fails the test if any method issued a request nothing asserted, which is what stops a
    // copy-pasted case from silently passing against the wrong operation.
    http.verify();
  });

  /** Asserts the single outstanding request targets `operationId` with `params`, and answers it. */
  function expectOperation(operationId: string, params: Record<string, unknown>): void {
    const req = http.expectOne(`https://nuxeo.example.com/nuxeo/api/v1/automation/${operationId}`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ params });
    req.flush({});
  }

  it('strips a trailing slash from the backend URL rather than emitting a double slash', () => {
    service.summarize('doc-1').subscribe();

    // The load-bearing detail: `//api/v1/...` would 404 against Nuxeo.
    http.expectOne('https://nuxeo.example.com/nuxeo/api/v1/automation/AI.Summarize').flush({});
  });

  it('builds the URL from a backend with no trailing slash too', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AI_BACKEND_URL, useValue: 'https://nuxeo.example.com/nuxeo' },
        { provide: AiFeatureFlagService, useValue: { aiEnabled: signal(true) } },
        AiGatewayService,
      ],
    });
    const svc = TestBed.inject(AiGatewayService);
    const ctrl = TestBed.inject(HttpTestingController);

    svc.summarize('doc-1').subscribe();

    ctrl.expectOne('https://nuxeo.example.com/nuxeo/api/v1/automation/AI.Summarize').flush({});
    ctrl.verify();
  });

  describe('natural-language to NXQL', () => {
    it('asks AI.NlToNxql without suggestions', () => {
      service.nlToNxql('every pdf').subscribe();

      expectOperation('AI.NlToNxql', { query: 'every pdf', suggestions: false });
    });

    it('asks the same operation with suggestions turned on', () => {
      service.nlToNxqlSuggestions('every pdf').subscribe();

      // Same operation id, distinguished only by the flag — so a test that ignored the body would
      // not tell these two methods apart.
      expectOperation('AI.NlToNxql', { query: 'every pdf', suggestions: true });
    });
  });

  describe('single-document operations', () => {
    it('asks AI.Summarize for a document', () => {
      service.summarize('doc-1').subscribe();
      expectOperation('AI.Summarize', { docId: 'doc-1' });
    });

    it('asks AI.SuggestTags for a document', () => {
      service.suggestTags('doc-1').subscribe();
      expectOperation('AI.SuggestTags', { docId: 'doc-1' });
    });

    it('asks AI.Classify for a document', () => {
      service.classify('doc-1').subscribe();
      expectOperation('AI.Classify', { docId: 'doc-1' });
    });
  });

  describe('findSimilar', () => {
    it('defaults the limit to five', () => {
      service.findSimilar('doc-1').subscribe();
      expectOperation('AI.Similar', { docId: 'doc-1', limit: 5 });
    });

    it('passes an explicit limit through', () => {
      service.findSimilar('doc-1', 25).subscribe();
      expectOperation('AI.Similar', { docId: 'doc-1', limit: 25 });
    });
  });

  describe('chat', () => {
    it('serialises history and flattens the context', () => {
      service
        .chat({
          message: 'what changed?',
          history: [{ role: 'user', content: 'hello' }],
          context: { docId: 'doc-1', page: 'document-detail' },
        })
        .subscribe();

      expectOperation('AI.Chat', {
        message: 'what changed?',
        historyJson: JSON.stringify([{ role: 'user', content: 'hello' }]),
        docId: 'doc-1',
        page: 'document-detail',
      });
    });

    it('sends an empty history array and empty context strings when omitted', () => {
      service.chat({ message: 'hello' }).subscribe();

      // Automation rejects absent params, so these have to be present-and-empty rather than missing.
      expectOperation('AI.Chat', {
        message: 'hello',
        historyJson: '[]',
        docId: '',
        page: '',
      });
    });
  });

  describe('analyzeSentiment', () => {
    it('serialises the comments into commentsJson', () => {
      const comments = [
        { id: 'c1', text: 'looks good' },
        { id: 'c2', text: 'needs work' },
      ];

      service.analyzeSentiment(comments).subscribe();

      expectOperation('AI.Sentiment', { commentsJson: JSON.stringify(comments) });
    });

    it('serialises an empty list rather than omitting it', () => {
      service.analyzeSentiment([]).subscribe();
      expectOperation('AI.Sentiment', { commentsJson: '[]' });
    });
  });

  it('asks AI.Insights for a user', () => {
    service.getInsights('jdoe').subscribe();
    expectOperation('AI.Insights', { userId: 'jdoe' });
  });

  describe('detectAnomalies', () => {
    it('defaults the time range to 24h', () => {
      service.detectAnomalies().subscribe();
      expectOperation('AI.Anomalies', { timeRange: '24h' });
    });

    it('passes an explicit time range through', () => {
      service.detectAnomalies('7d').subscribe();
      expectOperation('AI.Anomalies', { timeRange: '7d' });
    });
  });

  it('asks AI.NlPermissions with the query', () => {
    service.queryPermissions('who can read this?').subscribe();
    expectOperation('AI.NlPermissions', { query: 'who can read this?' });
  });

  describe('auditNlFilter', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("sends today's date alongside the query so the backend can resolve relative dates", () => {
      // Frozen, because the service reads the clock itself and "yesterday" is meaningless to the
      // backend without an anchor. An unfrozen clock would also make this assertion fail at midnight.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));

      service.auditNlFilter('deletions yesterday').subscribe();

      expectOperation('AI.AuditNlFilter', { query: 'deletions yesterday', today: '2026-06-15' });
    });
  });

  describe('auditSummarize', () => {
    it('serialises the entries into entriesJson', () => {
      const entries = [{ id: 1, eventId: 'documentModified' }];

      service.auditSummarize(entries).subscribe();

      expectOperation('AI.AuditSummarize', { entriesJson: JSON.stringify(entries) });
    });
  });

  describe('responses and failures', () => {
    it('emits the parsed response body', () => {
      const received: unknown[] = [];
      service.summarize('doc-1').subscribe((r) => received.push(r));

      http
        .expectOne('https://nuxeo.example.com/nuxeo/api/v1/automation/AI.Summarize')
        .flush({ summary: 'A short summary.' });

      expect(received).toEqual([{ summary: 'A short summary.' }]);
    });

    it('surfaces the 500 an absent marketplace package produces', () => {
      let status: number | undefined;
      service.summarize('doc-1').subscribe({ error: (e) => (status = e.status) });

      // The documented expected case when the AI package is not installed: the client must pass the
      // failure through rather than swallowing it, so callers can decide what to show.
      http
        .expectOne('https://nuxeo.example.com/nuxeo/api/v1/automation/AI.Summarize')
        .flush({ message: 'Unknown operation' }, { status: 500, statusText: 'Server Error' });

      expect(status).toBe(500);
    });
  });

  describe('when AI features are disabled', () => {
    beforeEach(() => {
      configure(false);
    });

    /**
     * The backstop that makes "AI is disabled" true of the network and not only of the UI.
     * Components gate their own templates, but two of them were issuing requests from `ngOnInit`
     * while their templates were correctly hidden, so the guard cannot live only at the call sites.
     *
     * `http.verify()` in the outer `afterEach` is what actually fails this if a request escapes.
     */
    it('sends no request for any operation', () => {
      service.nlToNxql('every pdf').subscribe({ error: () => undefined });
      service.nlToNxqlSuggestions('every pdf').subscribe({ error: () => undefined });
      service.summarize('doc-1').subscribe({ error: () => undefined });
      service.suggestTags('doc-1').subscribe({ error: () => undefined });
      service.classify('doc-1').subscribe({ error: () => undefined });
      service.findSimilar('doc-1').subscribe({ error: () => undefined });
      service.chat({ message: 'hello' }).subscribe({ error: () => undefined });
      service.analyzeSentiment([]).subscribe({ error: () => undefined });
      service.getInsights('jdoe').subscribe({ error: () => undefined });
      service.detectAnomalies().subscribe({ error: () => undefined });
      service.queryPermissions('who can read this?').subscribe({ error: () => undefined });
      service.auditNlFilter('deletions yesterday').subscribe({ error: () => undefined });
      service.auditSummarize([]).subscribe({ error: () => undefined });

      http.expectNone(() => true);
    });

    it('errors rather than completing silently, so callers clear their loading state', () => {
      // Returning `EMPTY` would leave every caller's `loading` signal set forever, because neither
      // their `next` nor their `error` handler would run.
      let message: string | undefined;
      let completed = false;

      service.summarize('doc-1').subscribe({
        error: (e: Error) => (message = e.message),
        complete: () => (completed = true),
      });

      expect(completed).toBe(false);
      expect(message).toContain('AI.Summarize');
    });
  });
});
