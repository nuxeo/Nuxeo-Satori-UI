import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, lastValueFrom } from 'rxjs';
import { vi } from 'vitest';

import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';

import {
  DEFAULT_KD_CIC_OPERATIONS,
  DEFAULT_KD_UPSTREAM_PATHS,
  KD_CIC_OPERATIONS,
  KD_UPSTREAM_PATHS,
} from './kd.config';
import { KdClientService, KdDiscoveryError } from './kd-client.service';
import { buildIndexedReferences } from './kd-references.util';

/**
 * Returns `Record<string, unknown>` rather than `unknown`: `TestRequest.flush()` takes
 * `string | number | boolean | Object | Blob | ArrayBuffer | ... | null`, so an `unknown`
 * return made every single `flush(envelope(...))` call in this file a TS2345 error. Vitest
 * strips types through esbuild so the suite was green with fifteen type errors in it.
 */
function envelope(
  response: unknown,
  responseCode = 200,
  responseMessage = 'OK',
): Record<string, unknown> {
  return { response, responseCode, responseMessage };
}

describe('KdClientService', () => {
  let service: KdClientService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        { provide: KD_CIC_OPERATIONS, useValue: DEFAULT_KD_CIC_OPERATIONS },
        { provide: KD_UPSTREAM_PATHS, useValue: DEFAULT_KD_UPSTREAM_PATHS },
      ],
    });

    service = TestBed.inject(KdClientService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.unstubAllGlobals();
  });

  function expectAutomation(operation: string) {
    const req = httpMock.expectOne(`/nuxeo/site/automation/${encodeURIComponent(operation)}`);
    expect(req.request.method).toBe('POST');
    return req;
  }

  it('lists agents via HylandKnowledgeDiscovery.getAllAgents and unwraps the CIC envelope', async () => {
    const agents$ = firstValueFrom(service.listAgents());
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.getAllAgents);
    expect(req.request.body).toEqual({});
    req.flush(envelope([{ id: 'agent-1', name: 'Contracts', description: '', modelName: 'm' }]));
    const agents = await agents$;
    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe('agent-1');
  });

  it('unwraps a wrapped {agents: [...]} payload', async () => {
    const agents$ = firstValueFrom(service.listAgents());
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.getAllAgents);
    req.flush(
      envelope({
        agents: [{ id: 'agent-2', name: 'Policies', description: '', modelName: 'm' }],
      }),
    );
    const agents = await agents$;
    expect(agents[0]?.id).toBe('agent-2');
  });

  it('listIngestSourceIds reads __sourceId__ from agent static filters', async () => {
    const sourceIds$ = firstValueFrom(service.listIngestSourceIds());
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.getAllAgents);
    req.flush(
      envelope([
        { id: 'agent-1', name: 'No source', sourceIds: [] },
        {
          id: 'agent-2',
          name: 'Bound agent',
          sourceIds: [],
          staticFilterExpression: {
            field: '__sourceId__',
            value: 'efffbf29-7d45-47ec-a7f0-7a9c5df8413b',
          },
        },
      ]),
    );
    await expect(sourceIds$).resolves.toEqual(['efffbf29-7d45-47ec-a7f0-7a9c5df8413b']);
  });

  it('getAgent routes through the Invoke passthrough with the upstream path', async () => {
    const agent$ = firstValueFrom(service.getAgent('agent-1'));
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke);
    expect(req.request.body).toEqual({
      params: { httpMethod: 'GET', endpoint: '/agent/agents/agent-1' },
    });
    req.flush(envelope({ id: 'agent-1', name: 'Contracts', description: '', modelName: 'm' }));
    const agent = await agent$;
    expect(agent.id).toBe('agent-1');
  });

  it('submitQuestion uses askQuestionAndGetAnswer and caches the one-shot result', async () => {
    const submission$ = firstValueFrom(
      service.submitQuestion({ agentId: 'agent-1', question: 'Q?' }),
    );
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer);
    expect(req.request.body).toEqual({
      params: { agentId: 'agent-1', question: 'Q?' },
    });
    req.flush(
      envelope({
        questionId: 'qid-1',
        agentId: 'agent-1',
        question: 'Q?',
        status: 'Complete',
        answer: 'A.',
        citations: [],
      }),
    );
    const submission = await submission$;
    expect(submission.questionId).toBe('qid-1');
    expect(submission.status).toBe('Complete');

    const answer = await firstValueFrom(service.getAnswer('qid-1'));
    expect(answer.answer).toBe('A.');
    expect(answer.status).toBe('Complete');
  });

  it('submitQuestion serializes dynamicFilter as extraPayloadJsonStr', async () => {
    const submission$ = firstValueFrom(
      service.submitQuestion({
        agentId: 'agent-1',
        question: 'Q?',
        dynamicFilter: { tenant: 'acme' },
      }),
    );
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer);
    expect(req.request.body).toEqual({
      params: {
        agentId: 'agent-1',
        question: 'Q?',
        extraPayloadJsonStr: JSON.stringify({ dynamicFilter: { tenant: 'acme' } }),
      },
    });
    req.flush(envelope({ status: 'Complete', answer: 'A.', citations: [] }));
    await submission$;
  });

  it('maps objectReferences from the connector response into citations', async () => {
    const submission$ = firstValueFrom(
      service.submitQuestion({ agentId: 'agent-1', question: 'Who is Holmes?' }),
    );
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer);
    req.flush(
      envelope({
        questionId: 'qid-citations',
        agentId: 'agent-1',
        question: 'Who is Holmes?',
        answer: 'Holmes is a detective.',
        objectReferences: [
          {
            objectId: 'source-id__document-id',
            references: [
              {
                referenceId: 'chunk-1',
                rank: 1,
                rankScore: 0.42,
              },
              {
                referenceId: 'chunk-2',
                rank: 2,
                rankScore: 0.21,
              },
            ],
          },
          {
            objectId: 'source-id__weak-document-id',
            references: [
              {
                referenceId: 'weak-chunk-1',
                rank: 1,
                rankScore: 0.01,
              },
            ],
          },
        ],
      }),
    );

    const documentReq = httpMock.expectOne('/nuxeo/api/v1/id/document-id');
    expect(documentReq.request.method).toBe('GET');
    documentReq.flush({
      uid: 'document-id',
      title: 'KD Sherlock Context Test',
      path: '/default-domain/workspaces/Narasimha/kd-sherlock-context.png',
      properties: {
        'dc:title': 'KD Sherlock Context Test',
        'file:content': { name: 'kd-sherlock-context.png' },
      },
    });

    const weakDocumentReq = httpMock.expectOne('/nuxeo/api/v1/id/weak-document-id');
    weakDocumentReq.flush('', { status: 404, statusText: 'Not Found' });

    await submission$;
    const answer = await firstValueFrom(service.getAnswer('qid-citations'));
    expect(answer.citations).toEqual([
      {
        objectId: 'source-id__document-id',
        referenceId: 'chunk-1',
        title: 'kd-sherlock-context.png',
        excerpt: undefined,
        score: 0.42,
      },
      {
        objectId: 'source-id__document-id',
        referenceId: 'chunk-2',
        title: 'kd-sherlock-context.png',
        excerpt: undefined,
        score: 0.21,
      },
      {
        objectId: 'source-id__weak-document-id',
        referenceId: 'weak-chunk-1',
        title: 'weak-document-id',
        excerpt: undefined,
        score: 0.01,
      },
    ]);
  });

  it('merges reference content from GET answer when the connector returns a persisted question id', async () => {
    const questionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const submission$ = firstValueFrom(
      service.submitQuestion({ agentId: 'agent-1', question: 'Who is Holmes?' }),
    );
    const askReq = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer);
    askReq.flush(
      envelope({
        questionId,
        agentId: 'agent-1',
        question: 'Who is Holmes?',
        answer: 'Holmes is a detective.',
        objectReferences: [
          {
            objectId: 'source-id__document-id',
            references: [{ referenceId: 'chunk-1', rankScore: 0.42 }],
          },
        ],
      }),
    );

    const answerReq = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke);
    expect(answerReq.request.body).toEqual({
      params: {
        httpMethod: 'GET',
        endpoint: `/qna/questions/${questionId}/answer`,
      },
    });
    answerReq.flush(
      envelope({
        objectReferences: [
          {
            objectId: 'source-id__document-id',
            references: [
              {
                referenceId: 'chunk-1',
                rankScore: 0.42,
                content: 'He was a consulting detective.',
              },
            ],
          },
        ],
      }),
    );

    const documentReq = httpMock.expectOne('/nuxeo/api/v1/id/document-id');
    documentReq.flush({
      uid: 'document-id',
      title: 'Sherlock',
      path: '/default-domain/workspaces/demo/sherlock.png',
      properties: { 'file:content': { name: 'sherlock.png' } },
    });

    await submission$;
    const answer = await firstValueFrom(service.getAnswer(questionId));
    expect(buildIndexedReferences(answer)[0]?.content).toBe('He was a consulting detective.');
  });

  it('retries a normalized question when KD returns insufficient answer with a strong citation', async () => {
    const submission$ = firstValueFrom(
      service.submitQuestion({ agentId: 'agent-1', question: 'What is agentic UI?' }),
    );

    const firstReq = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer);
    expect(firstReq.request.body).toEqual({
      params: { agentId: 'agent-1', question: 'What is agentic UI?' },
    });
    firstReq.flush(
      envelope({
        questionId: 'qid-first',
        agentId: 'agent-1',
        question: 'What is agentic UI?',
        answer: "#### I don't have enough information to answer this question.",
        objectReferences: [
          {
            objectId: 'source-id__pdf-document-id',
            references: [{ referenceId: 'chunk-1', rankScore: 0.31 }],
          },
        ],
      }),
    );

    const retryReq = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer);
    expect(retryReq.request.body).toEqual({
      params: { agentId: 'agent-1', question: 'what is agentic ui?' },
    });
    retryReq.flush(
      envelope({
        questionId: 'qid-retry',
        agentId: 'agent-1',
        question: 'what is agentic ui?',
        answer: 'Agentic UI uses agentic AI tooling to build a Nuxeo Angular UI.',
        objectReferences: [
          {
            objectId: 'source-id__pdf-document-id',
            references: [{ referenceId: 'chunk-2', rankScore: 0.44 }],
          },
        ],
      }),
    );

    const documentReq = httpMock.expectOne('/nuxeo/api/v1/id/pdf-document-id');
    documentReq.flush({
      uid: 'pdf-document-id',
      title: 'Test nature',
      path: '/default-domain/workspaces/Narasimha/Test nature',
      properties: {
        'dc:title': 'Test nature',
        'file:content': { name: '_221104827-Agentic UI PoC-300326-060908.pdf' },
      },
    });

    const submission = await submission$;
    expect(submission.questionId).toBe('qid-retry');

    const answer = await firstValueFrom(service.getAnswer('qid-retry'));
    expect(answer.question).toBe('What is agentic UI?');
    expect(answer.answer).toContain('Agentic UI uses agentic AI tooling');
    expect(answer.citations[0]).toEqual(
      expect.objectContaining({
        title: '_221104827-Agentic UI PoC-300326-060908.pdf',
        score: 0.44,
      }),
    );
  });

  it('throws when the CIC envelope carries an error code', async () => {
    const agents$ = firstValueFrom(service.listAgents());
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.getAllAgents);
    req.flush(envelope({}, 401, 'Unauthorized'));
    await expect(agents$).rejects.toThrow(/Unauthorized/);
  });

  it('submitFeedback updates the cached answer locally', async () => {
    const sub$ = firstValueFrom(service.submitQuestion({ agentId: 'a', question: 'Q?' }));
    const post = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer);
    post.flush(envelope({ questionId: 'qid-9', status: 'Complete', answer: 'A.', citations: [] }));
    await sub$;

    await lastValueFrom(service.submitFeedback('qid-9', { feedback: 'Good' }));
    const answer = await firstValueFrom(service.getAnswer('qid-9'));
    expect(answer.feedback).toBe('Good');
  });

  it('getQuestionHistory hits the QnA service path and maps responseCompleteness to status', async () => {
    const history$ = firstValueFrom(service.getQuestionHistory('agent-1', 2, 10));
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke);
    expect(req.request.body).toEqual({
      params: {
        httpMethod: 'GET',
        endpoint: '/qna/agents/agent-1/questions/history?pageNumber=2&pageSize=10',
      },
    });
    req.flush(
      envelope({
        pagination: { totalItems: 1, pageNumber: 2, totalPages: 1, pageSize: 10 },
        data: [
          {
            id: 'qid-42',
            question: 'tell me about nuxeo',
            answer: 'A.',
            dateCreated: '2026-04-24T11:35:25Z',
            dateAnswered: '2026-04-24T11:35:29Z',
            agentVersion: 2,
            responseCompleteness: 'Complete',
            feedback: null,
            staticFilter: null,
            dynamicFilter: null,
          },
        ],
      }),
    );

    const page = await history$;
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toEqual(
      expect.objectContaining({
        id: 'qid-42',
        question: 'tell me about nuxeo',
        answer: 'A.',
        status: 'Complete',
        feedback: null,
      }),
    );
    expect(page.pagination).toEqual({
      totalItems: 1,
      pageNumber: 2,
      totalPages: 1,
      pageSize: 10,
    });
  });

  it('getQuestionHistory falls back gracefully on an empty payload', async () => {
    const history$ = firstValueFrom(service.getQuestionHistory('agent-1'));
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke);
    expect(req.request.body.params.endpoint).toBe(
      '/qna/agents/agent-1/questions/history?pageNumber=1&pageSize=25',
    );
    req.flush(envelope(null));
    const page = await history$;
    expect(page.data).toEqual([]);
    expect(page.pagination).toEqual({});
  });

  it('carries the upstream status code on the thrown KdDiscoveryError', async () => {
    const agents$ = firstValueFrom(service.listAgents());
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.getAllAgents);
    req.flush(envelope({ detail: 'tenant not provisioned' }, 403, 'Forbidden'));

    const error = await agents$.then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(KdDiscoveryError);
    if (!(error instanceof KdDiscoveryError)) throw new Error('expected a KdDiscoveryError');
    expect(error.responseCode).toBe(403);
    expect(error.responseMessage).toBe('Forbidden');
    expect(error.upstreamBody).toEqual({ detail: 'tenant not provisioned' });
  });

  it('reports the status code alone when the connector sends no responseMessage', async () => {
    const agents$ = firstValueFrom(service.listAgents());
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.getAllAgents);
    req.flush({ response: null, responseCode: 502 });
    await expect(agents$).rejects.toThrow('Knowledge Discovery returned HTTP 502.');
  });

  it('throws when the connector returns no envelope at all', async () => {
    const agents$ = firstValueFrom(service.listAgents());
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.getAllAgents);
    req.flush(null);
    await expect(agents$).rejects.toThrow(
      'Unexpected response from Knowledge Discovery connector.',
    );
  });

  it('listAgents yields an empty list when the wrapper carries no agents key', async () => {
    const agents$ = firstValueFrom(service.listAgents());
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.getAllAgents);
    req.flush(envelope({}));
    await expect(agents$).resolves.toEqual([]);
  });

  it('listIngestSourceIds reads a wrapped {agents: [...]} payload', async () => {
    const sourceIds$ = firstValueFrom(service.listIngestSourceIds());
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.getAllAgents);
    req.flush(
      envelope({
        agents: [
          {
            id: 'agent-1',
            name: 'Bound agent',
            sourceIds: ['11111111-2222-3333-4444-555555555555'],
          },
        ],
      }),
    );
    await expect(sourceIds$).resolves.toEqual(['11111111-2222-3333-4444-555555555555']);
  });

  it('listIngestSourceIds swallows a failed agent listing and yields an empty list', async () => {
    const sourceIds$ = firstValueFrom(service.listIngestSourceIds());
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.getAllAgents);
    req.flush(envelope({}, 500, 'Connector unavailable'));
    // Deliberately non-fatal: CheckDigest source resolution is best-effort, so a KD
    // outage must not break the ingest screen it feeds.
    await expect(sourceIds$).resolves.toEqual([]);
  });

  describe('listModels', () => {
    it('normalises the model catalogue and drops entries with no usable model name', async () => {
      const models$ = firstValueFrom(service.listModels());
      const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke);
      expect(req.request.body).toEqual({
        params: { httpMethod: 'GET', endpoint: DEFAULT_KD_UPSTREAM_PATHS.listModels },
      });
      req.flush(
        envelope([
          {
            modelName: 'gpt-4o',
            displayName: 'GPT-4o',
            status: 'Active',
            eolDate: null,
            replacementModelName: null,
          },
          // `name` is the older upstream spelling and must be accepted as `modelName`,
          // with `displayName` defaulting to it.
          {
            name: 'legacy-model',
            status: 'Deprecated',
            eolDate: '2026-12-31',
            replacementModelName: 'gpt-4o',
          },
          { displayName: 'No model name at all' },
          { modelName: '' },
          { modelName: 42 },
        ]),
      );

      await expect(models$).resolves.toEqual([
        {
          modelName: 'gpt-4o',
          displayName: 'GPT-4o',
          status: 'Active',
          eolDate: null,
          replacementModelName: null,
        },
        {
          modelName: 'legacy-model',
          displayName: 'legacy-model',
          status: 'Deprecated',
          eolDate: '2026-12-31',
          replacementModelName: 'gpt-4o',
        },
      ]);
    });

    it('unwraps a wrapped {models: [...]} payload', async () => {
      const models$ = firstValueFrom(service.listModels());
      expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke).flush(
        envelope({ models: [{ modelName: 'claude-sonnet' }] }),
      );

      await expect(models$).resolves.toEqual([
        {
          modelName: 'claude-sonnet',
          displayName: 'claude-sonnet',
          status: undefined,
          eolDate: null,
          replacementModelName: null,
        },
      ]);
    });

    it('yields an empty catalogue when models is absent or not a list', async () => {
      const missing$ = firstValueFrom(service.listModels());
      expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke).flush(envelope({}));
      await expect(missing$).resolves.toEqual([]);

      const notAList$ = firstValueFrom(service.listModels());
      expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke).flush(
        envelope({ models: { 'gpt-4o': true } }),
      );
      await expect(notAList$).resolves.toEqual([]);

      const nothing$ = firstValueFrom(service.listModels());
      expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke).flush(envelope(null));
      await expect(nothing$).resolves.toEqual([]);
    });
  });

  describe('listGuardrails', () => {
    it('reads the guardrail groups from the Agent service', async () => {
      const guardrails$ = firstValueFrom(service.listGuardrails());
      const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke);
      expect(req.request.body).toEqual({
        params: { httpMethod: 'GET', endpoint: DEFAULT_KD_UPSTREAM_PATHS.listGuardrails },
      });
      req.flush(
        envelope({
          guardrailGroups: [
            {
              displayName: 'Safety',
              description: 'Blocks unsafe content',
              guardrails: [{ name: 'PII', severity: 'High', isRecommended: true }],
            },
          ],
        }),
      );

      const guardrails = await guardrails$;
      expect(guardrails.guardrailGroups).toHaveLength(1);
      expect(guardrails.guardrailGroups[0]?.displayName).toBe('Safety');
      expect(guardrails.guardrailGroups[0]?.guardrails).toEqual([
        { name: 'PII', severity: 'High', isRecommended: true },
      ]);
    });

    it('yields an empty group list when the payload is null or omits the key', async () => {
      const nullPayload$ = firstValueFrom(service.listGuardrails());
      expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke).flush(envelope(null));
      await expect(nullPayload$).resolves.toEqual({ guardrailGroups: [] });

      const noKey$ = firstValueFrom(service.listGuardrails());
      expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke).flush(envelope({}));
      await expect(noKey$).resolves.toEqual({ guardrailGroups: [] });
    });
  });

  it('getAnswer rejects for a question id that was never submitted in this session', async () => {
    await expect(firstValueFrom(service.getAnswer('never-asked'))).rejects.toThrow(
      /No cached answer for questionId "never-asked"/,
    );
  });

  it('submitFeedback rejects for a question id that was never submitted in this session', async () => {
    await expect(
      lastValueFrom(service.submitFeedback('never-asked', { feedback: 'Bad' })),
    ).rejects.toThrow(/Feedback can only be submitted on a question produced in this session/);
  });

  /**
   * Mint a synthetic question id with `globalThis.crypto` stubbed to one specific shape.
   *
   * `correlationSuffix()` has three branches and this suite asserted only the first, so it would
   * have failed in the very environment the other two exist for: `crypto.randomUUID` is
   * **secure-context only**, so on an on-prem build served from a plain `http://` origin that is not
   * `localhost` it is `undefined`. Asserting the UUID shape unconditionally made the test pass on
   * the deployment that does not need the fallback and fail on the one that does, while leaving both
   * fallbacks unexercised.
   */
  async function mintQuestionId(cryptoStub: unknown): Promise<string> {
    vi.stubGlobal('crypto', cryptoStub);
    const submission$ = firstValueFrom(
      service.submitQuestion({ agentId: 'agent-7', question: 'Q?' }),
    );
    expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer).flush(envelope(null));
    return (await submission$).questionId;
  }

  it('mints a synthetic question id from crypto.randomUUID in a secure context', async () => {
    const id = await mintQuestionId({ randomUUID: () => '123e4567-e89b-12d3-a456-426614174000' });
    expect(id).toMatch(/^kd-agent-7-\d+-123e4567-e89b-12d3-a456-426614174000$/);
  });

  it('falls back to crypto.getRandomValues when randomUUID is unavailable', async () => {
    const id = await mintQuestionId({
      getRandomValues: (buffer: Uint8Array) => {
        buffer.fill(0xab);
        return buffer;
      },
    });
    // Eight bytes, hex-encoded and zero-padded.
    expect(id).toMatch(/^kd-agent-7-\d+-abababababababab$/);
  });

  it('falls back to a monotonic counter, not Math.random, when Web Crypto is absent', async () => {
    // Deliberately a counter: falling back to `Math.random()` would put the exact API `S2245` flags
    // back into the file, and the id already embeds `Date.now()`, so within one page load a counter
    // cannot collide where six base-36 random characters can. Two calls must therefore differ even
    // if `Date.now()` does not advance between them.
    const first = await mintQuestionId({});
    const second = await mintQuestionId({});
    expect(first).toMatch(/^kd-agent-7-\d+-seq\d+$/);
    expect(second).toMatch(/^kd-agent-7-\d+-seq\d+$/);
    expect(second).not.toBe(first);
  });

  it('mints a synthetic question id when the connector omits one', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => '123e4567-e89b-12d3-a456-426614174000' });
    const submission$ = firstValueFrom(
      service.submitQuestion({ agentId: 'agent-7', question: 'Q?', dynamicFilter: null }),
    );
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer);
    // A null dynamicFilter must not be serialised into extraPayloadJsonStr.
    expect(req.request.body).toEqual({ params: { agentId: 'agent-7', question: 'Q?' } });
    req.flush(envelope(null));

    const submission = await submission$;
    expect(submission.questionId).toMatch(/^kd-agent-7-\d+-123e4567-e89b-12d3-a456-426614174000$/);
    expect(submission.status).toBe('Complete');

    const answer = await firstValueFrom(service.getAnswer(submission.questionId));
    expect(answer.agentId).toBe('agent-7');
    expect(answer.question).toBe('Q?');
    expect(answer.answer).toBe('');
    expect(answer.status).toBe('Complete');
    expect(answer.citations).toEqual([]);
    expect(answer.objectReferences).toBeUndefined();
    expect(answer.feedback).toBeNull();
    expect(answer.dynamicFilter).toBeNull();
    expect(answer.error).toBeNull();
  });

  it('keeps an explicit citations array in preference to flattening objectReferences', async () => {
    const submission$ = firstValueFrom(
      service.submitQuestion({ agentId: 'agent-1', question: 'Q?' }),
    );
    expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer).flush(
      envelope({
        questionId: 'qid-explicit',
        answer: 'A.',
        citations: [
          {
            objectId: 'source-id__doc-a',
            referenceId: 'chunk-1',
            title: 'Upstream title',
            excerpt: 'Upstream excerpt',
            score: 0.8,
          },
        ],
        // Present but for a different document: it must not add a second citation.
        objectReferences: [
          {
            objectId: 'source-id__doc-b',
            references: [{ referenceId: 'chunk-9', rankScore: 0.9 }],
          },
        ],
      }),
    );

    const documentReq = httpMock.expectOne('/nuxeo/api/v1/id/doc-a');
    // No `file:content`, so the display title falls back to the document's own title.
    documentReq.flush({ uid: 'doc-a', title: 'Doc A', properties: {} });

    await submission$;
    const answer = await firstValueFrom(service.getAnswer('qid-explicit'));
    expect(answer.citations).toEqual([
      {
        objectId: 'source-id__doc-a',
        referenceId: 'chunk-1',
        title: 'Doc A',
        excerpt: 'Upstream excerpt',
        score: 0.8,
      },
    ]);
  });

  it('falls back through title, dc:title and uid when a document has no file name', async () => {
    const submission$ = firstValueFrom(
      service.submitQuestion({ agentId: 'agent-1', question: 'Q?' }),
    );
    expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer).flush(
      envelope({
        questionId: 'qid-titles',
        answer: 'A.',
        objectReferences: [
          { objectId: 's__doc-title', references: [{ referenceId: 'c1', rankScore: 0.5 }] },
          { objectId: 's__doc-dc', references: [{ referenceId: 'c2', rankScore: 0.4 }] },
          { objectId: 's__doc-uid', references: [{ referenceId: 'c3', rankScore: 0.3 }] },
          { objectId: 's__doc-empty', references: [{ referenceId: 'c4', rankScore: 0.2 }] },
        ],
      }),
    );

    httpMock
      .expectOne('/nuxeo/api/v1/id/doc-title')
      .flush({ uid: 'doc-title', title: 'From title', properties: {} });
    httpMock
      .expectOne('/nuxeo/api/v1/id/doc-dc')
      .flush({ uid: 'doc-dc', properties: { 'dc:title': 'From dc:title' } });
    // No `properties` key at all, and no title: only the uid is left.
    httpMock.expectOne('/nuxeo/api/v1/id/doc-uid').flush({ uid: 'doc-uid' });
    // Nothing usable at all: the title collapses to an empty string.
    httpMock.expectOne('/nuxeo/api/v1/id/doc-empty').flush({});

    await submission$;
    const answer = await firstValueFrom(service.getAnswer('qid-titles'));
    expect(answer.citations.map((citation) => citation.title)).toEqual([
      'From title',
      'From dc:title',
      'doc-uid',
      '',
    ]);
  });

  it('ignores a non-string dc:title rather than rendering it as a citation title', async () => {
    const submission$ = firstValueFrom(
      service.submitQuestion({ agentId: 'agent-1', question: 'Q?' }),
    );
    expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer).flush(
      envelope({
        questionId: 'qid-bad-title',
        answer: 'A.',
        objectReferences: [
          { objectId: 's__doc-bad', references: [{ referenceId: 'c1', rankScore: 0.5 }] },
        ],
      }),
    );

    httpMock.expectOne('/nuxeo/api/v1/id/doc-bad').flush({
      uid: 'doc-bad',
      properties: { 'dc:title': { value: 'not a string' }, 'file:content': { name: 12345 } },
    });

    await submission$;
    const answer = await firstValueFrom(service.getAnswer('qid-bad-title'));
    expect(answer.citations[0]?.title).toBe('doc-bad');
  });

  it('keeps the original answer when the normalized retry is also insufficient', async () => {
    const submission$ = firstValueFrom(
      service.submitQuestion({ agentId: 'agent-1', question: 'What Is Agentic UI?' }),
    );

    const firstReq = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer);
    firstReq.flush(
      envelope({
        questionId: 'qid-first',
        answer: "#### I don't have enough information to answer this question.",
        objectReferences: [
          { objectId: 's__doc-x', references: [{ referenceId: 'c-1', rankScore: 0.31 }] },
        ],
      }),
    );

    const retryReq = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer);
    expect(retryReq.request.body).toEqual({
      params: { agentId: 'agent-1', question: 'what is agentic ui?' },
    });
    retryReq.flush(
      envelope({
        questionId: 'qid-retry',
        answer: "I don't have enough information to answer this question.",
        objectReferences: [
          { objectId: 's__doc-x', references: [{ referenceId: 'c-1', rankScore: 0.31 }] },
        ],
      }),
    );

    httpMock
      .expectOne('/nuxeo/api/v1/id/doc-x')
      .flush({ uid: 'doc-x', properties: { 'file:content': { name: 'x.pdf' } } });

    // The retry added nothing, so the first answer — and its question id — is kept.
    const submission = await submission$;
    expect(submission.questionId).toBe('qid-first');
    const answer = await firstValueFrom(service.getAnswer('qid-first'));
    expect(answer.question).toBe('What Is Agentic UI?');
    expect(answer.answer).toContain("I don't have enough information");
  });

  it('does not retry an insufficient answer whose best citation is weak', async () => {
    const submission$ = firstValueFrom(
      service.submitQuestion({ agentId: 'agent-1', question: 'What Is Agentic UI?' }),
    );
    expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer).flush(
      envelope({
        questionId: 'qid-weak',
        answer: "I don't have enough information to answer this question.",
        objectReferences: [
          { objectId: 's__doc-weak', references: [{ referenceId: 'c-1', rankScore: 0.01 }] },
        ],
      }),
    );

    httpMock
      .expectOne('/nuxeo/api/v1/id/doc-weak')
      .flush({ uid: 'doc-weak', properties: { 'file:content': { name: 'weak.pdf' } } });

    // No second askQuestionAndGetAnswer: `httpMock.verify()` in afterEach proves it.
    await expect(submission$).resolves.toEqual({
      questionId: 'qid-weak',
      status: 'Complete',
    });
  });

  it('does not retry an insufficient answer that has no citations at all', async () => {
    const submission$ = firstValueFrom(
      service.submitQuestion({ agentId: 'agent-1', question: 'What Is Agentic UI?' }),
    );
    expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer).flush(
      envelope({
        questionId: 'qid-nocitations',
        answer: "I don't have enough information to answer this question.",
      }),
    );

    await expect(submission$).resolves.toEqual({
      questionId: 'qid-nocitations',
      status: 'Complete',
    });
  });

  it('builds citations from the persisted answer when the one-shot payload has none', async () => {
    const questionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const submission$ = firstValueFrom(
      service.submitQuestion({ agentId: 'agent-1', question: 'Q?' }),
    );
    expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer).flush(
      envelope({ questionId, answer: 'A.' }),
    );

    const answerReq = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke);
    expect(answerReq.request.body).toEqual({
      params: {
        httpMethod: 'GET',
        endpoint: DEFAULT_KD_UPSTREAM_PATHS.getQuestionAnswer(questionId),
      },
    });
    answerReq.flush(
      envelope({
        objectReferences: [
          {
            objectId: 's__doc-late',
            references: [{ referenceId: 'c-1', rankScore: 0.6, content: 'Late passage' }],
          },
        ],
      }),
    );

    httpMock
      .expectOne('/nuxeo/api/v1/id/doc-late')
      .flush({ uid: 'doc-late', properties: { 'file:content': { name: 'late.pdf' } } });

    await submission$;
    const answer = await firstValueFrom(service.getAnswer(questionId));
    expect(answer.citations).toEqual([
      {
        objectId: 's__doc-late',
        referenceId: 'c-1',
        title: 'late.pdf',
        excerpt: 'Late passage',
        score: 0.6,
      },
    ]);
  });

  it('prefers the citations array from the persisted answer when it has one', async () => {
    const questionId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const submission$ = firstValueFrom(
      service.submitQuestion({ agentId: 'agent-1', question: 'Q?' }),
    );
    expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer).flush(
      envelope({ questionId, answer: 'A.' }),
    );

    expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke).flush(
      envelope({
        citations: [
          {
            objectId: 's__doc-persisted',
            referenceId: 'c-1',
            title: 'Persisted title',
            excerpt: 'Persisted excerpt',
            score: 0.7,
          },
        ],
      }),
    );

    httpMock
      .expectOne('/nuxeo/api/v1/id/doc-persisted')
      .flush({ uid: 'doc-persisted', properties: { 'file:content': { name: 'persisted.pdf' } } });

    await submission$;
    const answer = await firstValueFrom(service.getAnswer(questionId));
    expect(answer.citations).toEqual([
      {
        objectId: 's__doc-persisted',
        referenceId: 'c-1',
        title: 'persisted.pdf',
        excerpt: 'Persisted excerpt',
        score: 0.7,
      },
    ]);
  });

  it('falls back to the one-shot answer when the persisted answer lookup fails', async () => {
    const questionId = '11111111-2222-3333-4444-555555555555';
    const submission$ = firstValueFrom(
      service.submitQuestion({ agentId: 'agent-1', question: 'Q?' }),
    );
    expectAutomation(DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer).flush(
      envelope({
        questionId,
        answer: 'A.',
        objectReferences: [
          {
            objectId: 's__doc-z',
            references: [{ referenceId: 'c-1', rankScore: 0.5, content: 'One-shot passage' }],
          },
        ],
      }),
    );

    expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke).flush('', {
      status: 500,
      statusText: 'Server Error',
    });

    httpMock
      .expectOne('/nuxeo/api/v1/id/doc-z')
      .flush({ uid: 'doc-z', properties: { 'file:content': { name: 'z.pdf' } } });

    // The GET is an enrichment, not a dependency: its failure must not fail the question.
    await submission$;
    const answer = await firstValueFrom(service.getAnswer(questionId));
    expect(answer.citations).toEqual([
      {
        objectId: 's__doc-z',
        referenceId: 'c-1',
        title: 'z.pdf',
        excerpt: 'One-shot passage',
        score: 0.5,
      },
    ]);
  });

  it('maps an unrecognised responseCompleteness to Unknown and a missing one to Complete', async () => {
    const history$ = firstValueFrom(service.getQuestionHistory('agent-1'));
    expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke).flush(
      envelope({
        data: [
          { id: 'q-1', responseCompleteness: 'PartiallyComplete' },
          { id: 'q-2' },
          { id: 'q-3', status: 'Blocked' },
          { id: 'q-4', responseCompleteness: 'Submitted' },
          { id: 'q-5', responseCompleteness: 'Error' },
        ],
      }),
    );

    const page = await history$;
    expect(page.data.map((item) => item.status)).toEqual([
      'Unknown',
      'Complete',
      'Blocked',
      'Submitted',
      'Error',
    ]);
    // Every other field defaults rather than arriving undefined, so the table never
    // renders "undefined" for a sparse history row.
    expect(page.data[1]).toEqual({
      id: 'q-2',
      question: '',
      answer: '',
      dateCreated: '',
      dateAnswered: '',
      agentVersion: undefined,
      status: 'Complete',
      feedback: null,
      staticFilter: null,
      dynamicFilter: null,
    });
  });

  it('passes a non-string feedback value through unchanged', async () => {
    const history$ = firstValueFrom(service.getQuestionHistory('agent-1'));
    expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke).flush(
      envelope({ data: [{ id: 'q-9', feedback: { value: 'Good' } }] }),
    );

    const page = await history$;
    // NOTE: asserts what the code *does*. `feedback` is declared `string | null` on
    // `KdQuestionHistoryItem`, and the normaliser is written as
    // `typeof item.feedback === 'string' ? item.feedback : (item.feedback ?? null)` — so the
    // guard's else branch hands the *object* back under a string type rather than dropping
    // it. The evident intent of a `typeof` check is to keep non-strings out. Asserted as-is
    // rather than fixed: the QnA history payload shape is what decides the right answer here,
    // and changing it alters what the history table renders.
    expect(page.data[0]?.feedback).toEqual({ value: 'Good' });
  });

  it('carries a persisted history row through verbatim', async () => {
    const history$ = firstValueFrom(service.getQuestionHistory('agent-1', 1, 1));
    expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke).flush(
      envelope({
        pagination: { totalItems: 1 },
        data: [
          {
            id: 'q-full',
            question: 'Q?',
            answer: 'A.',
            dateCreated: '2026-04-24T11:35:25Z',
            dateAnswered: '2026-04-24T11:35:29Z',
            agentVersion: 3,
            responseCompleteness: 'Complete',
            feedback: 'Good',
            staticFilter: { field: '__sourceId__' },
            dynamicFilter: { tenant: 'acme' },
          },
        ],
      }),
    );

    await expect(history$).resolves.toEqual({
      pagination: { totalItems: 1 },
      data: [
        {
          id: 'q-full',
          question: 'Q?',
          answer: 'A.',
          dateCreated: '2026-04-24T11:35:25Z',
          dateAnswered: '2026-04-24T11:35:29Z',
          agentVersion: 3,
          status: 'Complete',
          feedback: 'Good',
          staticFilter: { field: '__sourceId__' },
          dynamicFilter: { tenant: 'acme' },
        },
      ],
    });
  });

  it('getAgent url-encodes an agent id with reserved characters', async () => {
    const agent$ = firstValueFrom(service.getAgent('team/agent 1'));
    const req = expectAutomation(DEFAULT_KD_CIC_OPERATIONS.invoke);
    expect(req.request.body).toEqual({
      params: { httpMethod: 'GET', endpoint: '/agent/agents/team%2Fagent%201' },
    });
    req.flush(envelope({ id: 'team/agent 1', name: 'Contracts' }));
    await expect(agent$).resolves.toEqual({ id: 'team/agent 1', name: 'Contracts' });
  });

  /*
   * NOT COVERED, and not coverable from the public surface: `runInvoke`'s optional
   * `payload` argument, which serialises `params.jsonPayloadStr`
   * (kd-client.service.ts:321-323).
   *
   * `runInvoke` is private and all five call sites — `getAgent`, `listModels`,
   * `listGuardrails`, `getQuestionHistory` and `enrichAnswerFromQuestionEndpoint` — are
   * `GET`s that pass no payload, so the branch is dead. It is consistent with the class
   * comment: the connector's `Invoke` op is GET/POST/PUT but "its payload passthrough does
   * not satisfy the `POST /agents` validation", so nothing writes through it today.
   *
   * Reaching it would mean either calling a private method through an index signature —
   * asserting a contract no caller has — or adding a public write method, which is a
   * feature, not a test. Left uncovered deliberately and reported instead.
   */
});

/**
 * A non-empty `NUXEO_API_ORIGIN` is the deployed configuration (the dev server proxies, so
 * the default is the empty string). Every URL the service builds is prefixed with it, and a
 * trailing slash on the token must not produce a `//` path.
 */
describe('KdClientService with an explicit API origin', () => {
  let service: KdClientService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: 'https://nuxeo.example.com/' },
        { provide: KD_CIC_OPERATIONS, useValue: DEFAULT_KD_CIC_OPERATIONS },
        { provide: KD_UPSTREAM_PATHS, useValue: DEFAULT_KD_UPSTREAM_PATHS },
      ],
    });

    service = TestBed.inject(KdClientService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('strips the trailing slash from the origin for both automation and document URLs', async () => {
    const submission$ = firstValueFrom(
      service.submitQuestion({ agentId: 'agent-1', question: 'Q?' }),
    );

    const req = httpMock.expectOne(
      `https://nuxeo.example.com/nuxeo/site/automation/${encodeURIComponent(
        DEFAULT_KD_CIC_OPERATIONS.askQuestionAndGetAnswer,
      )}`,
    );
    req.flush(
      envelope({
        questionId: 'qid-origin',
        answer: 'A.',
        objectReferences: [
          { objectId: 's__doc-o', references: [{ referenceId: 'c-1', rankScore: 0.5 }] },
        ],
      }),
    );

    const documentReq = httpMock.expectOne('https://nuxeo.example.com/nuxeo/api/v1/id/doc-o');
    expect(documentReq.request.headers.get('properties')).toBe('dublincore,file');
    documentReq.flush({ uid: 'doc-o', properties: { 'file:content': { name: 'o.pdf' } } });

    await submission$;
    const answer = await firstValueFrom(service.getAnswer('qid-origin'));
    expect(answer.citations[0]?.title).toBe('o.pdf');
  });
});
