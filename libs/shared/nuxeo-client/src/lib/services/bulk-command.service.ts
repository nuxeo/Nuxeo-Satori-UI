import { Injectable, inject } from '@angular/core';
import { Observable, map, throwError } from 'rxjs';

import { NuxeoApiBase } from './nuxeo-api-base';
import { isPageProviderName } from './page-provider.service';

/**
 * Where a command of Nuxeo's Bulk Action Framework is: `SCHEDULED`, then `SCROLLING_RUNNING` while
 * the server reads the query, `RUNNING` while it processes the records, and `COMPLETED` or
 * `ABORTED`. `UNKNOWN` is anything else the server writes.
 */
export type BulkCommandState =
  'SCHEDULED' | 'SCROLLING_RUNNING' | 'RUNNING' | 'COMPLETED' | 'ABORTED' | 'UNKNOWN';

/** A command's status, as `GET /api/v1/bulk/{commandId}` answers. */
export interface BulkCommandStatus {
  readonly commandId: string;
  readonly state: BulkCommandState;
  /** The records processed so far, those that failed among them. */
  readonly processed: number;
  /** The records the query found: `0` until the server has read the whole query. */
  readonly total: number;
  /** The records that failed, such as one the person may not change. */
  readonly errorCount: number;
  readonly skipCount: number;
  /** The server's message for the first failure, when it gives one. */
  readonly errorMessage: string | null;
  /**
   * Whether the command has ended. `ABORTED` is written as soon as a command is stopped, while the
   * batches already started still finish and still count: the command has ended once the server
   * also writes when it completed.
   */
  readonly ended: boolean;
  /** What the action produced, such as a CSV export's `{ url }`; `null` for most. */
  readonly result: Readonly<Record<string, unknown>> | null;
}

/** What a page provider's whole result is asked with: its parameters, in order, as a list sends them. */
export interface BulkCommandQuery {
  readonly parameters?: readonly string[];
  /**
   * The most records the server reads from the query and processes: `queryLimit`, a whole number
   * from 1. The server stops reading there, and `total` is then at most this. None by default.
   */
  readonly limit?: number;
}

/** A framework action's name: letters and digits, as Nuxeo's own (`setProperties`, `trash`). */
const ACTION = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

/** A command's id, as the server writes one: a UUID. */
const COMMAND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATES: ReadonlySet<string> = new Set([
  'SCHEDULED',
  'SCROLLING_RUNNING',
  'RUNNING',
  'COMPLETED',
  'ABORTED',
]);

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

/** The server answered, but not with a bulk command's status. */
export class BulkCommandStatusError extends Error {
  constructor() {
    super('the server did not answer with the status of a bulk command');
    this.name = 'BulkCommandStatusError';
  }
}

/** The status the server wrote, or a {@link BulkCommandStatusError} when it is not one. */
export function readBulkCommandStatus(body: unknown): BulkCommandStatus {
  const record = (body ?? {}) as Record<string, unknown>;
  const commandId = record['commandId'];
  if (
    record['entity-type'] !== 'bulkStatus' ||
    typeof commandId !== 'string' ||
    !COMMAND_ID.test(commandId)
  ) {
    throw new BulkCommandStatusError();
  }
  const state = typeof record['state'] === 'string' ? record['state'] : '';
  const known = (STATES.has(state) ? state : 'UNKNOWN') as BulkCommandState;
  const message = record['errorMessage'];
  const result = record['result'];
  return {
    commandId,
    state: known,
    processed: count(record['processed']),
    total: count(record['total']),
    errorCount: count(record['errorCount']),
    skipCount: count(record['skipCount']),
    errorMessage: typeof message === 'string' && message.trim() !== '' ? message.trim() : null,
    ended:
      (known === 'COMPLETED' || known === 'ABORTED') &&
      typeof record['completed'] === 'string' &&
      record['completed'] !== '',
    result:
      result !== null && typeof result === 'object' && !Array.isArray(result)
        ? (result as Record<string, unknown>)
        : null,
  };
}

/**
 * Nuxeo's Bulk Action Framework over REST: an action run over a page provider's whole result on
 * the server, its status, and stopping it.
 *
 * The server checks the person's permission on every record: one they may not change fails and is
 * counted in `errorCount`. It also decides who may run which action: one it does not open over
 * HTTP answers HTTP 403 to everyone but an administrator, and a command's status and stopping it
 * belong to the person who ran it and to administrators.
 */
@Injectable({ providedIn: 'root' })
export class BulkCommandService {
  private readonly api = inject(NuxeoApiBase);

  /**
   * Runs `action` over every result of the page provider `name`, asked with `query`'s parameters,
   * with `actionParameters`: `POST /api/v1/search/pp/{name}/bulk/{action}`. Answers the command's
   * first status, `SCHEDULED`.
   *
   * There is no way to send a facet's chosen buckets: the server builds the command from the page
   * provider's query and leaves out every aggregate chosen, measured on Nuxeo 2025.10, so the
   * command would reach records the list does not show. A parameter the page provider does not
   * take is left out the same way, silently, and widens the command to the provider's whole
   * result. So the caller limits the command to one record more than the person agreed to
   * (`query.limit`), which the server honours, and treats a `total` above what they agreed to as a
   * command that reaches more: measured, `queryLimit=2` over three records read and processed two.
   *
   * Errors, without a request, for a name that is not a page provider's, an action that is not a
   * name, a parameter that is empty or a limit below 1; otherwise as the request does.
   */
  runOverPageProvider(
    name: string,
    query: BulkCommandQuery,
    action: string,
    actionParameters: Readonly<Record<string, unknown>>,
  ): Observable<BulkCommandStatus> {
    if (!isPageProviderName(name)) {
      return throwError(() => new Error(`"${name}" is not the name of a page provider`));
    }
    if (!ACTION.test(action)) {
      return throwError(() => new Error(`"${action}" is not the name of a bulk action`));
    }
    const parameters = query.parameters ?? [];
    const { limit } = query;
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
      return throwError(
        () => new Error(`a bulk command is limited to 1 record or more, not ${String(limit)}`),
      );
    }
    if (parameters.some((parameter) => parameter === '')) {
      return throwError(
        () => new Error('a page provider is not run over a whole query with an empty parameter'),
      );
    }
    const search = [
      ...parameters.map((parameter) => `queryParams=${encodeURIComponent(parameter)}`),
      ...(limit === undefined ? [] : [`queryLimit=${limit}`]),
    ].join('&');
    const path =
      `/nuxeo/api/v1/search/pp/${encodeURIComponent(name)}/bulk/${encodeURIComponent(action)}` +
      (search === '' ? '' : `?${search}`);
    return this.api.post<unknown>(path, actionParameters).pipe(map(readBulkCommandStatus));
  }

  /** The command's status: `GET /api/v1/bulk/{commandId}`. HTTP 404 for one the server does not know. */
  status(commandId: string): Observable<BulkCommandStatus> {
    if (!COMMAND_ID.test(commandId)) {
      return throwError(() => new Error(`"${commandId}" is not the id of a bulk command`));
    }
    return this.api
      .get<unknown>(`/nuxeo/api/v1/bulk/${encodeURIComponent(commandId)}`)
      .pipe(map(readBulkCommandStatus));
  }

  /**
   * Stops the command: `PUT /api/v1/bulk/{commandId}/abort`. The server answers `ABORTED` at once,
   * and the batches it has already started still finish: {@link BulkCommandStatus.ended} says when
   * they have.
   */
  abort(commandId: string): Observable<BulkCommandStatus> {
    if (!COMMAND_ID.test(commandId)) {
      return throwError(() => new Error(`"${commandId}" is not the id of a bulk command`));
    }
    return this.api
      .put<unknown>(`/nuxeo/api/v1/bulk/${encodeURIComponent(commandId)}/abort`, null)
      .pipe(map(readBulkCommandStatus));
  }
}
