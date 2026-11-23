import { HttpErrorResponse } from '@angular/common/http';
import { InjectionToken } from '@angular/core';
import type { WholeQueryBulkAction } from '@nuxeo/satori-platform/extensions';
import type { BulkCommandService, BulkCommandStatus } from '@nuxeo/satori-platform/nuxeo-client';
import {
  type Observable,
  catchError,
  concat,
  defer,
  finalize,
  map,
  of,
  race,
  shareReplay,
  switchMap,
  take,
  timer,
} from 'rxjs';

/** A bulk action over every result of a queue's query, as the person agreed to it. */
export interface WholeQueryRequest {
  readonly pageProvider: string;
  /** The page provider's parameters, as the queue's list sends them. */
  readonly parameters: readonly string[];
  readonly action: WholeQueryBulkAction;
  /** How many records the person agreed to: the count the confirmation named. */
  readonly confirmed: number;
}

/** Why the server did not take the command. */
export type WholeQueryRefusal = 'forbidden' | 'invalid' | 'signed-out' | 'unreachable' | 'failed';

/** How a command over a whole query ended, or why it never ran. */
export type WholeQueryOutcome =
  /** The server completed it. Some records may have failed: `errorCount`. */
  | { readonly kind: 'done'; readonly status: BulkCommandStatus }
  /**
   * Stopped: by the person (`stopped`), because the server found more records than they agreed to
   * (`too-many`), or by someone else, such as an administrator (`aborted`). `ended` is false when
   * the batches already started had not all finished when the page stopped waiting for them, so
   * `processed` may still grow.
   */
  | {
      readonly kind: 'stopped' | 'too-many' | 'aborted';
      readonly status: BulkCommandStatus;
      readonly ended: boolean;
    }
  /** The server did not take it: nothing ran. */
  | { readonly kind: 'refused'; readonly reason: WholeQueryRefusal; readonly detail: string }
  /** The command ran, and its status could no longer be read: it may still be running. */
  | {
      readonly kind: 'lost';
      readonly status: BulkCommandStatus;
      readonly detail: string;
    };

/** What a run reports: its progress, then how it ended, once. */
export type WholeQueryEvent =
  { readonly kind: 'progress'; readonly status: BulkCommandStatus } | WholeQueryOutcome;

export interface WholeQueryTiming {
  /** Between two reads of the command's status, once the server has counted the records. */
  readonly pollMs: number;
  /**
   * Between two reads until the server has counted the records, so that a command reaching more
   * than was agreed is stopped soon after the count: the server starts processing tens of
   * milliseconds after it has read the query, and a fast action such as `trash` processes thousands
   * of records a second.
   */
  readonly countPollMs: number;
  /** Reads at {@link countPollMs} at most, before the page reads at {@link pollMs} anyway. */
  readonly countReads: number;
  /** Status reads that may fail in a row before the page stops following the command. */
  readonly failures: number;
  /** Status reads, once stopped, that wait for the batches already started to finish. */
  readonly settle: number;
}

export const WHOLE_QUERY_TIMING: WholeQueryTiming = {
  pollMs: 1000,
  countPollMs: 200,
  countReads: 25,
  failures: 3,
  settle: 10,
};

/** The timing a queue's page follows a command with: {@link WHOLE_QUERY_TIMING}, and faster in a spec. */
export const QUEUE_WHOLE_QUERY_TIMING = new InjectionToken<WholeQueryTiming>(
  'QUEUE_WHOLE_QUERY_TIMING',
  { factory: () => WHOLE_QUERY_TIMING },
);

function detail(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const message = (error.error as { message?: unknown } | null)?.message;
    return typeof message === 'string' && message !== ''
      ? `HTTP ${error.status}: ${message}`
      : `HTTP ${error.status}`;
  }
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message !== '' ? message : 'the request failed';
}

function refusal(error: unknown): WholeQueryRefusal {
  if (!(error instanceof HttpErrorResponse)) return 'invalid';
  if (error.status === 0) return 'unreachable';
  if (error.status === 401) return 'signed-out';
  if (error.status === 403) return 'forbidden';
  if (error.status === 400 || error.status === 404) return 'invalid';
  return 'failed';
}

/**
 * Runs `request` on the server through the Bulk Action Framework and follows it: its progress as
 * the command's status is read, then how it ended. Never errors.
 *
 * - **More than agreed.** The command is limited to one record more than the person agreed to, on
 *   the server (`queryLimit`), so a query that has come to reach more records, or a parameter the
 *   server leaves out, processes that many at most. As soon as the server reports the one more, the
 *   command is stopped and the run ends as `too-many`. A fast action such as `trash` has usually
 *   processed them all by then: the limit is what bounds it, the stop is for slower ones.
 * - **Stopping.** `stop` stops the command, and the run then waits a while for the batches already
 *   started to finish, so that the count it reports is final.
 * - **Losing track.** Status reads that fail several times in a row end the run as `lost`: the
 *   command may still be running on the server.
 *
 * Unsubscribing stops following the command, not the command: it goes on on the server.
 */
export function runWholeQuery(
  bulk: BulkCommandService,
  request: WholeQueryRequest,
  stop: Observable<unknown>,
  timing: WholeQueryTiming = WHOLE_QUERY_TIMING,
): Observable<WholeQueryEvent> {
  return defer(() => {
    // Kept from the start, so that a stop asked for while a read is in flight is not missed.
    const stopped = stop.pipe(
      take(1),
      map(() => 'stop' as const),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    const keep = stopped.subscribe();

    const ended = (
      kind: 'stopped' | 'too-many' | 'aborted',
      status: BulkCommandStatus,
    ): WholeQueryOutcome => ({ kind, status, ended: status.ended });

    /** After a stop: reads the status until the server says the command has ended, a while at most. */
    const settle = (
      kind: 'stopped' | 'too-many' | 'aborted',
      last: BulkCommandStatus,
      left: number,
    ): Observable<WholeQueryEvent> =>
      last.ended || left <= 0
        ? of(ended(kind, last))
        : timer(timing.pollMs).pipe(
            switchMap(() => bulk.status(last.commandId)),
            switchMap((status) => settle(kind, status, left - 1)),
            catchError(() => of(ended(kind, last))),
          );

    const halt = (
      kind: 'stopped' | 'too-many',
      last: BulkCommandStatus,
    ): Observable<WholeQueryEvent> =>
      bulk.abort(last.commandId).pipe(
        switchMap((status) => settle(kind, status, timing.settle)),
        catchError((error: unknown) =>
          // The command may have ended in the meantime: the server then refuses to stop it.
          bulk.status(last.commandId).pipe(
            map((status): WholeQueryEvent => {
              if (status.state !== 'COMPLETED')
                return { kind: 'lost', status, detail: `not stopped: ${detail(error)}` };
              return kind === 'too-many' ? ended(kind, status) : { kind: 'done', status };
            }),
            catchError(() =>
              of<WholeQueryEvent>({
                kind: 'lost',
                status: last,
                detail: `not stopped: ${detail(error)}`,
              }),
            ),
          ),
        ),
      );

    const decide = (status: BulkCommandStatus): Observable<WholeQueryEvent> => {
      const progress: WholeQueryEvent = { kind: 'progress', status };
      if (status.total > request.confirmed)
        return status.state === 'COMPLETED'
          ? of(progress, ended('too-many', status))
          : concat(of(progress), halt('too-many', status));
      if (status.state === 'COMPLETED') {
        const done: WholeQueryEvent = { kind: 'done', status };
        return of(progress, done);
      }
      if (status.state === 'ABORTED')
        return concat(of(progress), settle('aborted', status, timing.settle));
      return concat(of(progress), follow(status, 0));
    };

    let reads = 0;
    /** Quickly until the server has counted, a while at most; then at the usual pace. */
    const delay = (last: BulkCommandStatus): number =>
      last.total === 0 && last.state !== 'COMPLETED' && reads < timing.countReads
        ? timing.countPollMs
        : timing.pollMs;

    const follow = (last: BulkCommandStatus, failures: number): Observable<WholeQueryEvent> =>
      race(stopped, timer(delay(last)).pipe(map(() => 'tick' as const))).pipe(
        take(1),
        switchMap((signal) =>
          signal === 'stop'
            ? halt('stopped', last)
            : defer(() => {
                reads += 1;
                return bulk.status(last.commandId);
              }).pipe(
                switchMap(decide),
                catchError((error: unknown) =>
                  failures + 1 >= timing.failures
                    ? of<WholeQueryEvent>({ kind: 'lost', status: last, detail: detail(error) })
                    : follow(last, failures + 1),
                ),
              ),
        ),
      );

    const { pageProvider, parameters, action } = request;
    return (
      bulk
        // One more than agreed, at most: the server stops there, and the one more says the query
        // now reaches more records than the person agreed to.
        .runOverPageProvider(
          pageProvider,
          { parameters, limit: request.confirmed + 1 },
          action.action,
          action.parameters,
        )
        .pipe(
          map((first) => ({ first })),
          // Only the submission's own failure is a refusal: what follows catches its own.
          catchError((error: unknown) => of({ error })),
          switchMap((submitted) =>
            'first' in submitted
              ? decide(submitted.first)
              : of<WholeQueryEvent>({
                  kind: 'refused',
                  reason: refusal(submitted.error),
                  detail: detail(submitted.error),
                }),
          ),
          finalize(() => keep.unsubscribe()),
        )
    );
  });
}
