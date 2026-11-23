import { HttpBackend, HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import { Observable, TimeoutError, catchError, map, of, timeout } from 'rxjs';

/** As for the layout and home reads: `HttpClient` has no timeout of its own. */
export const QUEUE_LOAD_TIMEOUT_MS = 10_000;

/** A queue's id, its file name: layout version 2's ids (app-definition-v2.md, section 2). */
const QUEUE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Whether `id` can name a queue. One that cannot is never asked for. */
export function isQueueId(id: string): boolean {
  return QUEUE_ID.test(id);
}

/**
 * Where the queue `id` opens: the router link of the app's queue page, `/queues/<id>`. The home's
 * links to queues use it, and so do the menu's entries for queues, from `navigation.json`.
 */
export function queueLink(id: string): readonly string[] {
  return ['/queues', id];
}

/** What reading a queue's file found. */
export type QueueLoad =
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable'; readonly reason: string }
  | { readonly kind: 'file'; readonly content: unknown };

/**
 * `queues/<id>.json`, beside the layouts and the home in the directory the configuration service
 * answers from (app-definition-v2.md, sections 1 and 10): `agentic-ui-config/queues/<id>.json`.
 * The configuration servlet of `nuxeo-agentic-core` does not answer there; only the development
 * server does, from `npm run config:dev -- --queue <file>`.
 */
export function queueFileUrl(bootstrapUrl: string, id: string): string {
  const path = bootstrapUrl.split(/[?#]/, 1)[0] ?? '';
  return `${path.slice(0, path.lastIndexOf('/') + 1)}queues/${encodeURIComponent(id)}.json`;
}

function describe(error: unknown): string {
  if (error instanceof TimeoutError) return `no response within ${QUEUE_LOAD_TIMEOUT_MS / 1000} s`;
  if (error instanceof HttpErrorResponse && error.status !== 0) {
    // A body that is not JSON comes back as an error with the status of a success.
    return error.status >= 200 && error.status < 300 ? 'it is not JSON' : `HTTP ${error.status}`;
  }
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message !== '' ? message : 'the request failed';
}

/**
 * A queue's file, read as the layouts and the home are, past the interceptors: no `Authorization`
 * header and no reset of the idle timer, though same-origin, so the browser still attaches its
 * cookies. The queue's records are read through `PageProviderService`, as the signed-in person.
 */
@Injectable({ providedIn: 'root' })
export class QueueService {
  private readonly config = new HttpClient(inject(HttpBackend));
  private readonly bootstrapUrl = inject(APP_BOOTSTRAP_CONFIG_URL);

  /**
   * The queue's file as served; `none` when nothing is served there (404), or when `id` cannot
   * name a queue, which is not asked for. Never errors.
   */
  load(id: string): Observable<QueueLoad> {
    if (!isQueueId(id)) return of<QueueLoad>({ kind: 'none' });
    return this.config.get<unknown>(queueFileUrl(this.bootstrapUrl, id)).pipe(
      timeout(QUEUE_LOAD_TIMEOUT_MS),
      map((content): QueueLoad => ({ kind: 'file', content })),
      catchError((error: unknown) =>
        of<QueueLoad>(
          error instanceof HttpErrorResponse && error.status === 404
            ? { kind: 'none' }
            : { kind: 'unreadable', reason: describe(error) },
        ),
      ),
    );
  }
}
