import { HttpErrorResponse } from '@angular/common/http';
import { InjectionToken } from '@angular/core';
import type { WholeQueryBulkAction } from '@nuxeo/satori-platform/extensions';
import {
  BulkCommandStatusError,
  type BulkCommandService,
  type BulkCommandStatus,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  EMPTY,
  type Observable,
  catchError,
  concatMap,
  defer,
  expand,
  finalize,
  from,
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
   * `processed` may still grow. A `too-many` whose `total` is above one more than agreed is one the
   * server did not limit.
   */
  | {
      readonly kind: 'stopped' | 'too-many' | 'aborted';
      readonly status: BulkCommandStatus;
      readonly ended: boolean;
    }
  /** The server did not take it: nothing ran. */
  | { readonly kind: 'refused'; readonly reason: WholeQueryRefusal; readonly detail: string }
  /**
   * The server answered the submission, but not with a command's status: the page cannot tell
   * whether it runs, nor follow it.
   */
  | { readonly kind: 'unconfirmed'; readonly detail: string }
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
  /** After the list is read again at the end, how long before it is read once more, for the index. */
  readonly reindexMs: number;
}

export const WHOLE_QUERY_TIMING: WholeQueryTiming = {
  pollMs: 1000,
  countPollMs: 200,
  countReads: 25,
  failures: 3,
  settle: 10,
  reindexMs: 3000,
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

/**
 * Whether the server answered the submission with a success that is not a command's status: an
 * answer that is not a `bulkStatus`, or a body that is not JSON (Angular reports that as an error
 * carrying the success's status). The command may then be running.
 */
function answeredUnreadably(error: unknown): boolean {
  if (error instanceof BulkCommandStatusError) return true;
  return error instanceof HttpErrorResponse && error.status >= 200 && error.status < 300;
}

function refusal(error: unknown): WholeQueryRefusal {
  if (!(error instanceof HttpErrorResponse)) return 'invalid';
  if (error.status === 0) return 'unreachable';
  if (error.status === 401) return 'signed-out';
  if (error.status === 403) return 'forbidden';
  if (error.status === 400 || error.status === 404) return 'invalid';
  return 'failed';
}

type StopKind = 'stopped' | 'too-many' | 'aborted';

/** What the run does next, after the events a step reports. */
type Next =
  | { readonly kind: 'read'; readonly last: BulkCommandStatus; readonly failures: number }
  | {
      readonly kind: 'halt';
      readonly why: 'stopped' | 'too-many';
      readonly last: BulkCommandStatus;
    }
  | {
      readonly kind: 'settle';
      readonly why: StopKind;
      readonly last: BulkCommandStatus;
      readonly left: number;
    };

/** One step of following a command: what it reports, and what comes next; `null` once it ended. */
interface Step {
  readonly events: readonly WholeQueryEvent[];
  readonly next: Next | null;
}

/**
 * Runs `request` on the server through the Bulk Action Framework and follows it: its progress as
 * the command's status is read, then how it ended. Never errors.
 *
 * - **More than agreed.** The command is limited to one record more than the person agreed to, on
 *   the server (`queryLimit`), so a query that has come to reach more records, or a parameter the
 *   server leaves out, processes that many at most. As soon as the server reports more than agreed,
 *   the command is stopped and the run ends as `too-many`. A fast action such as `trash` has usually
 *   processed them all by then: the limit is what bounds it, the stop is for slower ones. A `total`
 *   above the limit says the server did not keep to it.
 * - **Stopping.** `stop` stops the command, and the run then waits a while for the batches already
 *   started to finish, so that the count it reports is final.
 * - **Losing track.** Status reads that fail several times in a row end the run as `lost`: the
 *   command may still be running on the server.
 * - **As long as it takes.** Each read is a step of its own (`expand`), not nested in the last one,
 *   so a command followed for hours reports as the first minute does.
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
    let reads = 0;

    const end = (event: WholeQueryOutcome, before: readonly WholeQueryEvent[] = []): Step => ({
      events: [...before, event],
      next: null,
    });
    const ended = (kind: StopKind, status: BulkCommandStatus): WholeQueryOutcome => ({
      kind,
      status,
      ended: status.ended,
    });

    /** What a status read means: its progress, and what to do next. */
    const decide = (status: BulkCommandStatus): Step => {
      const progress: WholeQueryEvent = { kind: 'progress', status };
      if (status.total > request.confirmed) {
        return status.state === 'COMPLETED'
          ? end(ended('too-many', status), [progress])
          : { events: [progress], next: { kind: 'halt', why: 'too-many', last: status } };
      }
      if (status.state === 'COMPLETED') return end({ kind: 'done', status }, [progress]);
      if (status.state === 'ABORTED') {
        return {
          events: [progress],
          next: { kind: 'settle', why: 'aborted', last: status, left: timing.settle },
        };
      }
      return { events: [progress], next: { kind: 'read', last: status, failures: 0 } };
    };

    /** A stop answered by a command that had completed meanwhile: it did all it was going to. */
    const completedWhileStopping = (why: 'stopped' | 'too-many', status: BulkCommandStatus): Step =>
      end(why === 'too-many' ? ended(why, status) : { kind: 'done', status });

    /** Quickly until the server has counted, a while at most; then at the usual pace. */
    const delay = (last: BulkCommandStatus): number =>
      last.total === 0 && last.state !== 'COMPLETED' && reads < timing.countReads
        ? timing.countPollMs
        : timing.pollMs;

    const read = (last: BulkCommandStatus, failures: number): Observable<Step> =>
      race(stopped, timer(delay(last)).pipe(map(() => 'tick' as const))).pipe(
        take(1),
        switchMap((signal): Observable<Step> => {
          if (signal === 'stop')
            return of({ events: [], next: { kind: 'halt', why: 'stopped', last } });
          reads += 1;
          return bulk.status(last.commandId).pipe(
            map(decide),
            catchError((error: unknown) =>
              of(
                failures + 1 >= timing.failures
                  ? end({ kind: 'lost', status: last, detail: detail(error) })
                  : { events: [], next: { kind: 'read', last, failures: failures + 1 } as const },
              ),
            ),
          );
        }),
      );

    const halt = (why: 'stopped' | 'too-many', last: BulkCommandStatus): Observable<Step> =>
      bulk.abort(last.commandId).pipe(
        map((status): Step =>
          status.state === 'COMPLETED'
            ? completedWhileStopping(why, status)
            : { events: [], next: { kind: 'settle', why, last: status, left: timing.settle } },
        ),
        // The server refuses to stop a command that has ended in the meantime: read what it is.
        catchError((error: unknown) =>
          bulk.status(last.commandId).pipe(
            map((status): Step => {
              if (status.state === 'COMPLETED') return completedWhileStopping(why, status);
              if (status.state === 'ABORTED') {
                return {
                  events: [],
                  next: { kind: 'settle', why, last: status, left: timing.settle },
                };
              }
              return end({ kind: 'lost', status, detail: `not stopped: ${detail(error)}` });
            }),
            catchError(() =>
              of(end({ kind: 'lost', status: last, detail: `not stopped: ${detail(error)}` })),
            ),
          ),
        ),
      );

    /** After a stop: reads the status until the server says the command has ended, a while at most. */
    const settle = (why: StopKind, last: BulkCommandStatus, left: number): Observable<Step> =>
      last.ended || left <= 0
        ? of(end(ended(why, last)))
        : timer(timing.pollMs).pipe(
            switchMap(() => bulk.status(last.commandId)),
            map((status): Step => ({
              events: [],
              next: { kind: 'settle', why, last: status, left: left - 1 },
            })),
            catchError(() => of(end(ended(why, last)))),
          );

    const perform = (next: Next): Observable<Step> => {
      switch (next.kind) {
        case 'read':
          return read(next.last, next.failures);
        case 'halt':
          return halt(next.why, next.last);
        case 'settle':
          return settle(next.why, next.last, next.left);
      }
    };

    const { pageProvider, parameters, action } = request;
    const submitted: Observable<Step> = bulk
      // One more than agreed, at most: the server stops there, and the one more says the query
      // now reaches more records than the person agreed to.
      .runOverPageProvider(
        pageProvider,
        { parameters, limit: request.confirmed + 1 },
        action.action,
        action.parameters,
      )
      .pipe(
        map(decide),
        // Only the submission's own failure ends the run here: what follows catches its own.
        catchError((error: unknown) =>
          of(
            end(
              answeredUnreadably(error)
                ? { kind: 'unconfirmed', detail: detail(error) }
                : { kind: 'refused', reason: refusal(error), detail: detail(error) },
            ),
          ),
        ),
      );

    return submitted.pipe(
      expand((step) => (step.next === null ? EMPTY : perform(step.next))),
      concatMap((step) => from(step.events)),
      finalize(() => keep.unsubscribe()),
    );
  });
}
