import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { DocumentDetailService } from '@nuxeo/satori-platform/nuxeo-client';
import {
  type Observable,
  TimeoutError,
  catchError,
  defer,
  map,
  of,
  retry,
  switchMap,
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

/** How long one file may take to send before the try is given up as a dropped connection. */
export const CAPTURE_SEND_TIMEOUT_MS = 180_000;

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
 * A failure another try may mend: no answer (the connection dropped, status 0, or the try took too
 * long), a timeout or too many requests, or a server that did not manage it (5xx).
 */
export function transient(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  if (!(error instanceof HttpErrorResponse)) return false;
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

/** What the page says of a failure. A failure no try could mend is never `connection`. */
export function failureOf(error: unknown): CaptureFailure {
  if (transient(error)) return 'connection';
  const status = error instanceof HttpErrorResponse ? error.status : null;
  if (status === 403) return 'forbidden';
  if (status === 404) return 'gone';
  if (status === 413) return 'too-large';
  return 'refused';
}

/**
 * Files one file on a record, as the Attachments panel uploads one: `Blob.AttachOnDocument`,
 * through `DocumentDetailService.uploadAttachment`, into the property the capture names, with the
 * person's own permission, which the server checks.
 *
 * A dropped connection is tried again, after each of {@link CAPTURE_RETRY_DELAYS}. Before each try
 * again, and before the first try of a file a request has carried already, the record is read:
 * a file of the same name and size there is the earlier try's, whose answer was lost, and is not
 * sent twice. Each photo's name is the page's own and unique, so that this cannot mistake another
 * file for it. A refusal, such as a 403, is not tried again.
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
    const upload = defer(() =>
      this.details.uploadAttachment(uid, file, {
        xpath: property,
        onUploadPercent: progress.onPercent,
      }),
    ).pipe(
      timeout({ first: CAPTURE_SEND_TIMEOUT_MS }),
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
   * Whether the record holds the file already. A read that fails, as it does while the connection
   * is still down, answers no: the file is sent again, and that try tells.
   */
  private held(uid: string, property: string, file: File): Observable<boolean> {
    return this.records
      .holds(uid, property, file.name, file.size)
      .pipe(catchError(() => of(false)));
  }
}
