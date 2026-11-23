import { HttpBackend, HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import { NuxeoApiBase } from '@nuxeo/satori-platform/nuxeo-client';
import { Observable, TimeoutError, catchError, map, of, throwError, timeout } from 'rxjs';

import type { HomeKpi } from './home-file';

/** As for the layout reads: `HttpClient` has no timeout of its own. */
export const HOME_LOAD_TIMEOUT_MS = 10_000;

/**
 * Where a queue opens, for the home's links to queues: the router link of the queue `id`.
 *
 * `null`, the default, until the app has a queue page. Phase 1's queue page is not in the app yet,
 * so the home leaves out a card that is only a link to a queue, and draws no link on a KPI.
 */
export const HOME_QUEUE_LINK = new InjectionToken<
  ((queue: string) => string | readonly unknown[]) | null
>('HOME_QUEUE_LINK', { factory: () => null });

/** What reading `home.json` found. */
export type HomeLoad =
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable'; readonly reason: string }
  | { readonly kind: 'file'; readonly content: unknown };

/**
 * `home.json`, beside the layouts in the directory the configuration service answers from
 * (app-definition-v2.md, section 10): `agentic-ui-config/home.json`. The configuration servlet of
 * `nuxeo-agentic-core` does not answer there; only the development server does, from
 * `npm run config:dev -- --home <file>`.
 */
export function homeFileUrl(bootstrapUrl: string): string {
  const path = bootstrapUrl.split(/[?#]/, 1)[0] ?? '';
  return `${path.slice(0, path.lastIndexOf('/') + 1)}home.json`;
}

function describe(error: unknown): string {
  if (error instanceof TimeoutError) return `no response within ${HOME_LOAD_TIMEOUT_MS / 1000} s`;
  if (error instanceof HttpErrorResponse && error.status !== 0) {
    // A body that is not JSON comes back as an error with the status of a success.
    return error.status >= 200 && error.status < 300 ? 'it is not JSON' : `HTTP ${error.status}`;
  }
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message !== '' ? message : 'the request failed';
}

/**
 * The home's two reads: its file, and the page provider results its KPIs count.
 *
 * The file is read as the layouts are, past the interceptors: no `Authorization` header and no
 * reset of the idle timer, though same-origin, so the browser still attaches its cookies. The
 * results are read through `NuxeoApiBase`, as every other REST call is, so they are the signed-in
 * person's: the server returns only what they may read.
 */
@Injectable({ providedIn: 'root' })
export class HomeService {
  private readonly api = inject(NuxeoApiBase);
  private readonly config = new HttpClient(inject(HttpBackend));
  private readonly bootstrapUrl = inject(APP_BOOTSTRAP_CONFIG_URL);

  /** The home file as served; `none` when nothing is served there (404). Never errors. */
  load(): Observable<HomeLoad> {
    return this.config.get<unknown>(homeFileUrl(this.bootstrapUrl)).pipe(
      timeout(HOME_LOAD_TIMEOUT_MS),
      map((content): HomeLoad => ({ kind: 'file', content })),
      catchError((error: unknown) =>
        of<HomeLoad>(
          error instanceof HttpErrorResponse && error.status === 404
            ? { kind: 'none' }
            : { kind: 'unreadable', reason: describe(error) },
        ),
      ),
    );
  }

  /**
   * The page provider's results, a page of one record: what a KPI counts is `resultsCount` and
   * the `aggregations`, not the records. Errors with what went wrong, as a text.
   */
  results(kpi: HomeKpi): Observable<unknown> {
    let params = new HttpParams().set('pageSize', 1).set('currentPageIndex', 0);
    for (const parameter of kpi.parameters)
      params = params.append('queryParams', String(parameter));
    return this.api
      .get<unknown>(
        `/nuxeo/api/v1/search/pp/${encodeURIComponent(kpi.pageProvider)}/execute`,
        params,
        { properties: 'dublincore' },
      )
      .pipe(
        timeout(HOME_LOAD_TIMEOUT_MS),
        catchError((error: unknown) => throwError(() => new Error(describe(error)))),
      );
  }
}
