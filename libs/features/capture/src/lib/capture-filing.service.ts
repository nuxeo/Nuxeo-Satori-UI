import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { DocumentDetailService } from '@nuxeo/satori-platform/nuxeo-client';
import {
  type Observable,
  Subject,
  TimeoutError,
  catchError,
  defer,
  map,
  merge,
  of,
  retry,
  startWith,
  switchMap,
  take,
  throwError,
  timeout,
  timer,
} from 'rxjs';

import type { CaptureFailure } from './capture-photos';
import { CaptureRecordsService } from './capture-records.service';

/**
 * How long the page waits before each try again after the connection drops, in milliseconds: one
 * try and three more, about a quarter of a minute in all, the time a phone takes to find a signal
 * again on a street.
 */
export const CAPTURE_RETRY_DELAYS = new InjectionToken<readonly number[]>('CAPTURE_RETRY_DELAYS', {
  providedIn: 'root',
  factory: () => [1_000, 4_000, 10_000],
});

/**
 * How long a try may send nothing more before it is given up as a dropped connection: a stall,
 * not a slow connection, which goes on as long as it moves.
 */
export const CAPTURE_STALL_MS = 60_000;

/**
 * How long the server may take to answer once the whole file is sent. Longer than a stall: it is
 * saving the file, and a try given up too soon could leave it saved and sent again.
 */
export const CAPTURE_ANSWER_MS = 180_000;

/** How long the read of the record before a try again may take. */
export const CAPTURE_HELD_MS = 15_000;

/** How a file went: sent now, or found on the record already, from a try whose answer was lost. */
export type CaptureSent = 'sent' | 'found';

/** What a filing is told as it goes: how much is sent, and each time it tries again. */
export interface CaptureProgress {
  readonly onPercent: (percent: number) => void;
  /** Before each try again: which, from 1. */
  readonly onRetry: (attempt: number) => void;
}

/** Thrown inside {@link CaptureFilingService.send}'s retry when the record has the file already. */
const FOUND = Symbol('found');

/**
 * A failure another try may mend: no answer (the connection dropped, status 0, or a try that
 * stalled), a timeout or too many requests, or a gateway that could not reach the server or a
 * server too busy to answer (502, 503, 504). A 500 is the server's own failure, which trying again
 * does not mend.
 */
export function transient(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  if (!(error instanceof HttpErrorResponse)) return false;
  return [0, 408, 429, 502, 503, 504].includes(error.status);
}

/** What the page says of a failure. A failure no try could mend is never `connection`. */
export function failureOf(error: unknown): CaptureFailure {
  if (transient(error)) return 'connection';
  const status = error instanceof HttpErrorResponse ? error.status : null;
  if (status === 403) return 'forbidden';
  if (status === 404) return 'gone';
  if (status === 413) return 'too-large';
  if (status !== null && status >= 500) return 'server';
  return 'refused';
}

/**
 * Files one file on a record, as the Attachments panel uploads one: `Blob.AttachOnDocument`,
 * through `DocumentDetailService.uploadAttachment`, into the property the capture names, with the
 * person's own permission, which the server checks.
 *
 * A dropped connection is tried again, after each of {@link CAPTURE_RETRY_DELAYS}: no answer, a try
 * that sent nothing for {@link CAPTURE_STALL_MS}, or one whose answer took longer than
 * {@link CAPTURE_ANSWER_MS} once the file was sent. Before each try again, and before the first try
 * of a file a request has carried already, the record is read: a file of the same name and size
 * there is the earlier try's, whose answer was lost, and is not sent again. Each photo's name is
 * the page's own and unique, so that this cannot mistake another file for it. A file the server is
 * still saving when the record is read is not there yet, and can be sent twice. A refusal, such as
 * a 403, is not tried again.
 */
@Injectable({ providedIn: 'root' })
export class CaptureFilingService {
  private readonly details = inject(DocumentDetailService);
  private readonly records = inject(CaptureRecordsService);
  private readonly delays = inject(CAPTURE_RETRY_DELAYS);

  send(
    uid: string,
    property: string,
    file: File,
    sentBefore: boolean,
    progress: CaptureProgress,
  ): Observable<CaptureSent> {
    const upload = defer(() => this.attempt(uid, property, file, progress)).pipe(
      map((): CaptureSent => 'sent'),
      retry({
        count: this.delays.length,
        delay: (error: unknown, attempt: number) => {
          if (!transient(error)) return throwError(() => error);
          progress.onRetry(attempt);
          return timer(this.delays[attempt - 1] ?? 0).pipe(
            switchMap(() => this.held(uid, property, file)),
            switchMap((held) => (held ? throwError(() => FOUND) : of(true))),
          );
        },
      }),
    );
    const first: Observable<boolean> = sentBefore ? this.held(uid, property, file) : of(false);
    return first.pipe(
      switchMap((held) => (held ? of<CaptureSent>('found') : upload)),
      catchError((error: unknown) =>
        error === FOUND ? of<CaptureSent>('found') : throwError(() => error),
      ),
    );
  }

  /**
   * One try: the upload, watched. Each piece the browser sends restarts the watch, which gives the
   * try up as a {@link TimeoutError} after {@link CAPTURE_STALL_MS} with nothing sent, or after
   * {@link CAPTURE_ANSWER_MS} once all of it is sent and the server is to answer.
   */
  private attempt(
    uid: string,
    property: string,
    file: File,
    progress: CaptureProgress,
  ): Observable<unknown> {
    const sent = new Subject<number>();
    const request = this.details.uploadAttachment(uid, file, {
      xpath: property,
      onUploadPercent: (percent) => {
        sent.next(percent);
        progress.onPercent(percent);
      },
    });
    const watch = sent.pipe(
      startWith(0),
      switchMap((percent) => timer(percent >= 100 ? CAPTURE_ANSWER_MS : CAPTURE_STALL_MS)),
      switchMap(() => throwError(() => new TimeoutError())),
    );
    return merge(request, watch).pipe(take(1));
  }

  /**
   * Whether the record holds the file already. A read that fails, or takes longer than
   * {@link CAPTURE_HELD_MS}, as it does while the connection is still down, answers no: the file is
   * sent again, and that try tells.
   */
  private held(uid: string, property: string, file: File): Observable<boolean> {
    return this.records.holds(uid, property, file.name, file.size).pipe(
      timeout({ first: CAPTURE_HELD_MS }),
      catchError(() => of(false)),
    );
  }
}
