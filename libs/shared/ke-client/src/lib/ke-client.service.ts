import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';

import { NUXEO_API_ORIGIN } from '@nuxeo-satori/platform/nuxeo-client';

import { KE_CIC_OPERATIONS, type KeCicOperations } from './ke.config';
import {
  toKeWireAction,
  type KeAction,
  type KeEnrichRequest,
  KeEnrichmentResult,
  KeNamedEntityMap,
  KeProcessingError,
  KeStringDictionaryResult,
  KeStringListDictionaryResult,
  KeStringResult,
} from './ke.models';

interface ContextApiResultsEnvelope {
  id?: string | null;
  status?: string | null;
  inProgress?: boolean;
  results?: Array<Record<string, unknown>>;
}

/**
 * Error thrown when the Nuxeo KE automation op or the upstream Context API
 * fails. `details` carries the parsed error body when available.
 *
 * `messageKey` is set when `message` is this client's own generic wording rather than text from
 * the server: a caller that shows the error resolves the key (with `messageParams`) so the user
 * reads it in their language. A server-supplied message has no key and is shown as it came.
 */
export class KeEnrichmentError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly details?: unknown,
    public readonly messageKey?: string,
    public readonly messageParams?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'KeEnrichmentError';
  }
}

@Injectable({ providedIn: 'root' })
export class KeClientService {
  private readonly http = inject(HttpClient);
  private readonly apiOrigin = inject(NUXEO_API_ORIGIN);
  private readonly ops = inject<KeCicOperations>(KE_CIC_OPERATIONS);

  enrich(blob: Blob, request: KeEnrichRequest): Observable<KeEnrichmentResult> {
    const formData = new FormData();
    formData.append(
      'request',
      new Blob([JSON.stringify({ params: this.toAutomationParams(request) })], {
        type: 'application/json',
      }),
    );
    formData.append('input', blob, 'knowledge-enrichment-input');

    return this.http
      .post(this.automationUrl(this.ops.enrich), formData, {
        responseType: 'text',
        headers: {
          Accept: 'application/json, text/plain',
        },
      })
      .pipe(
        map((body) => this.normalize(body)),
        catchError((error) => this.toKeError(error)),
      );
  }

  private toAutomationParams(request: KeEnrichRequest): Record<string, unknown> {
    // The Context API is v2, where action names are camelCase. Translating
    // here, at the single point the request is serialised, keeps the rest of
    // the app on the kebab-case names its templates and state use.
    const params: Record<string, unknown> = {
      actions: request.actions.map(toKeWireAction).join(','),
    };

    if (request.sourceId) {
      params['sourceId'] = request.sourceId;
    }
    if (request.classes?.length) {
      params['classes'] = JSON.stringify(request.classes);
    }
    if (request.configName) {
      params['configName'] = request.configName;
    }
    if (request.maxWordCount !== undefined || request.instructions) {
      const extraPayload: Record<string, unknown> = {};
      if (request.maxWordCount !== undefined) {
        extraPayload['maxWordCount'] = request.maxWordCount;
      }
      if (request.instructions) {
        extraPayload['instructions'] = request.instructions;
      }
      params['extraJsonPayloadStr'] = JSON.stringify(extraPayload);
    }
    if (request.v2Actions) {
      // These keys are action names too, so they need the same translation.
      const wireActions = Object.fromEntries(
        Object.entries(request.v2Actions).map(([action, config]) => [
          toKeWireAction(action as KeAction),
          config,
        ]),
      );
      params['instructionsV2JsonStr'] = JSON.stringify(wireActions);
    }

    return params;
  }

  private normalize(body: string): KeEnrichmentResult {
    const parsed = this.parseBody(body);
    const payload = this.unwrapMaybeEnvelope(parsed);
    const envelope = this.toResultsEnvelope(payload);
    const firstResult = Array.isArray(envelope.results) ? envelope.results[0] : undefined;

    return {
      requestId: envelope.id ?? null,
      status: envelope.status ?? null,
      inProgress: Boolean(envelope.inProgress),
      objectKey: this.asString(firstResult?.['objectKey']) ?? null,
      imageDescription: this.toStringResult(firstResult?.['imageDescription']),
      textSummary: this.toStringResult(firstResult?.['textSummary']),
      textClassification: this.toStringResult(firstResult?.['textClassification']),
      namedEntityText: this.toEntityResult(firstResult?.['namedEntityText']),
      namedEntityImage: this.toEntityResult(firstResult?.['namedEntityImage']),
      imageMetadata: this.toStringDictionaryResult(firstResult?.['imageMetadata']),
      textMetadata: this.toStringDictionaryResult(firstResult?.['textMetadata']),
      generalProcessingErrors: this.toProcessingErrors(firstResult?.['generalProcessingErrors']),
      raw: payload,
    };
  }

  private parseBody(body: string): unknown {
    const trimmed = body.trim();
    if (!trimmed) return {};

    try {
      return JSON.parse(trimmed);
    } catch {
      throw new KeEnrichmentError(
        'Knowledge Enrichment returned a non-JSON response.',
        undefined,
        undefined,
        'ke-client.message.non-json-response',
      );
    }
  }

  /**
   * The KE connector sometimes returns raw Context API results and may also
   * surface a generic `{ response, responseCode, responseMessage }` envelope.
   */
  private unwrapMaybeEnvelope(payload: unknown): unknown {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return payload;
    }

    const maybeEnvelope = payload as {
      response?: unknown;
      responseCode?: number;
      responseMessage?: string;
    };

    if (typeof maybeEnvelope.responseCode !== 'number') {
      return payload;
    }

    if (maybeEnvelope.responseCode < 200 || maybeEnvelope.responseCode >= 300) {
      const code = maybeEnvelope.responseCode;
      if (code === 403) {
        throw new KeEnrichmentError(
          'Knowledge Enrichment credentials are not authorized for the Context API.',
          code,
          maybeEnvelope.response,
          'ke-client.message.not-authorized',
        );
      }
      if (maybeEnvelope.responseMessage) {
        throw new KeEnrichmentError(maybeEnvelope.responseMessage, code, maybeEnvelope.response);
      }
      throw new KeEnrichmentError(
        `Knowledge Enrichment returned HTTP ${code}.`,
        code,
        maybeEnvelope.response,
        'ke-client.message.http-status',
        { code },
      );
    }

    return maybeEnvelope.response;
  }

  private toResultsEnvelope(payload: unknown): ContextApiResultsEnvelope {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { inProgress: false, results: [] };
    }

    const envelope = payload as ContextApiResultsEnvelope;
    if (Array.isArray(envelope.results)) {
      return envelope;
    }

    // Some connector versions return a single result object directly.
    return {
      id: null,
      status: null,
      inProgress: false,
      results: [payload as Record<string, unknown>],
    };
  }

  private toStringResult(value: unknown): KeStringResult | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const entry = value as Record<string, unknown>;
    return {
      isSuccess: entry['isSuccess'] === true,
      result: this.asString(entry['result']),
      error: this.toSingleProcessingError(entry['error']),
    };
  }

  private toEntityResult(value: unknown): KeStringListDictionaryResult | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const entry = value as Record<string, unknown>;
    return {
      isSuccess: entry['isSuccess'] === true,
      result: this.toEntityMap(entry['result']),
      error: this.toSingleProcessingError(entry['error']),
    };
  }

  private toStringDictionaryResult(value: unknown): KeStringDictionaryResult | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const entry = value as Record<string, unknown>;
    const result = entry['result'];

    return {
      isSuccess: entry['isSuccess'] === true,
      result:
        result && typeof result === 'object' && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : null,
      error: this.toSingleProcessingError(entry['error']),
    };
  }

  private toEntityMap(value: unknown): KeNamedEntityMap | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const rawMap = value as Record<string, unknown>;
    const normalized: KeNamedEntityMap = {};

    for (const [key, rawValues] of Object.entries(rawMap)) {
      if (!Array.isArray(rawValues)) continue;
      const values = rawValues
        .map((entry) => this.asString(entry))
        .filter((entry): entry is string => Boolean(entry));
      if (values.length > 0) {
        normalized[key] = Array.from(new Set(values));
      }
    }

    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  private toProcessingErrors(value: unknown): KeProcessingError[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => this.toSingleProcessingError(entry))
      .filter((entry): entry is KeProcessingError => Boolean(entry));
  }

  private toSingleProcessingError(value: unknown): KeProcessingError | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const raw = value as Record<string, unknown>;
    return {
      errorType: this.asString(raw['errorType']),
      message: this.asString(raw['message']),
    };
  }

  private asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private toKeError(error: unknown): Observable<never> {
    if (error instanceof KeEnrichmentError) {
      return throwError(() => error);
    }

    if (!(error instanceof HttpErrorResponse)) {
      return throwError(
        () =>
          new KeEnrichmentError(
            'Knowledge Enrichment request failed unexpectedly.',
            undefined,
            error,
            'ke-client.message.failed-unexpectedly',
          ),
      );
    }

    const detail = this.extractErrorDetail(error.error);
    return throwError(() =>
      detail || error.message
        ? new KeEnrichmentError(detail || error.message, error.status, error.error)
        : new KeEnrichmentError(
            'Knowledge Enrichment request failed.',
            error.status,
            error.error,
            'ke-client.message.failed',
          ),
    );
  }

  private extractErrorDetail(raw: unknown): string | null {
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as { message?: string; detail?: string };
        return parsed.detail ?? parsed.message ?? raw;
      } catch {
        return raw;
      }
    }

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }

    const errorBody = raw as { message?: string; detail?: string };
    return errorBody.detail ?? errorBody.message ?? null;
  }

  private automationUrl(operation: string): string {
    const origin = this.apiOrigin.replace(/\/$/, '');
    return `${origin}/nuxeo/site/automation/${encodeURIComponent(operation)}`;
  }
}
