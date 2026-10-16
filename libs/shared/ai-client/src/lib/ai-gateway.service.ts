import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';

import { AI_BACKEND_URL } from './ai.config';
import { AiFeatureFlagService } from './ai-feature-flag.service';
import type {
  NlToNxqlResponse,
  NlToNxqlSuggestionsResponse,
  SummarizeResponse,
  SuggestTagsResponse,
  ClassifyResponse,
  SimilarResponse,
  ChatRequest,
  ChatResponse,
  SentimentResponse,
  InsightsResponse,
  AnomaliesResponse,
  NlPermissionsResponse,
  AuditFilterResponse,
  AuditSummaryResponse,
} from './ai.models';

/**
 * Calls Nuxeo Automation Operations backed by the Java AI package (HAIP).
 *
 * All endpoints resolve to:
 *   POST /nuxeo/api/v1/automation/<OperationId>
 *   Body: { "params": { ...params } }
 *
 * The Automation REST API returns the Blob content directly when the
 * operation returns a StringBlob with application/json mime type.
 */
@Injectable({ providedIn: 'root' })
export class AiGatewayService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(AI_BACKEND_URL);
  private readonly featureFlag = inject(AiFeatureFlagService);

  /** Build the Automation endpoint URL for a given operation ID. */
  private op(operationId: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}/api/v1/automation/${operationId}`;
  }

  /** Wrap params in the Nuxeo Automation request envelope. */
  private params(p: Record<string, unknown>): { params: Record<string, unknown> } {
    return { params: p };
  }

  /**
   * The single place every operation goes through, so the feature flag is checked once rather
   * than at thirteen call sites that each have to remember.
   *
   * Components gate their own UI on the flag too, so in practice this never fires. It exists
   * because "the AI features are disabled" has to be true of the network, not only of what is
   * rendered: two callers were found issuing AI requests from `ngOnInit` while their templates
   * were correctly hidden, which is exactly the shape of mistake this catches.
   *
   * Errors rather than returning `EMPTY`: an observable that completes without emitting leaves
   * every caller's `loading` signal set, because their `next` and `error` handlers both go
   * unrun, and a permanent spinner is worse than a message nothing is rendering.
   */
  private call<T>(operationId: string, params: Record<string, unknown>): Observable<T> {
    if (!this.featureFlag.aiEnabled()) {
      return throwError(() => new Error(`AI features are disabled; ${operationId} was not sent`));
    }
    return this.http.post<T>(this.op(operationId), this.params(params));
  }

  nlToNxql(query: string): Observable<NlToNxqlResponse> {
    return this.call<NlToNxqlResponse>('AI.NlToNxql', { query, suggestions: false });
  }

  nlToNxqlSuggestions(query: string): Observable<NlToNxqlSuggestionsResponse> {
    return this.call<NlToNxqlSuggestionsResponse>('AI.NlToNxql', { query, suggestions: true });
  }

  summarize(docId: string): Observable<SummarizeResponse> {
    return this.call<SummarizeResponse>('AI.Summarize', { docId });
  }

  suggestTags(docId: string): Observable<SuggestTagsResponse> {
    return this.call<SuggestTagsResponse>('AI.SuggestTags', { docId });
  }

  classify(docId: string): Observable<ClassifyResponse> {
    return this.call<ClassifyResponse>('AI.Classify', { docId });
  }

  findSimilar(docId: string, limit = 5): Observable<SimilarResponse> {
    return this.call<SimilarResponse>('AI.Similar', { docId, limit });
  }

  chat(request: ChatRequest): Observable<ChatResponse> {
    return this.call<ChatResponse>('AI.Chat', {
      message: request.message,
      historyJson: JSON.stringify(request.history ?? []),
      docId: request.context?.docId ?? '',
      page: request.context?.page ?? '',
    });
  }

  analyzeSentiment(comments: Array<{ id: string; text: string }>): Observable<SentimentResponse> {
    return this.call<SentimentResponse>('AI.Sentiment', {
      commentsJson: JSON.stringify(comments),
    });
  }

  getInsights(userId: string): Observable<InsightsResponse> {
    return this.call<InsightsResponse>('AI.Insights', { userId });
  }

  detectAnomalies(timeRange = '24h'): Observable<AnomaliesResponse> {
    return this.call<AnomaliesResponse>('AI.Anomalies', { timeRange });
  }

  queryPermissions(query: string): Observable<NlPermissionsResponse> {
    return this.call<NlPermissionsResponse>('AI.NlPermissions', { query });
  }

  auditNlFilter(query: string): Observable<AuditFilterResponse> {
    const today = new Date().toISOString().split('T')[0];
    return this.call<AuditFilterResponse>('AI.AuditNlFilter', { query, today });
  }

  auditSummarize(entries: unknown[]): Observable<AuditSummaryResponse> {
    return this.call<AuditSummaryResponse>('AI.AuditSummarize', {
      entriesJson: JSON.stringify(entries),
    });
  }
}
