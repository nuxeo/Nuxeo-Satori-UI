import { HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { APP_DEFINITION_FILES } from '@agentic-ui/shared/app-registry';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import {
  CURRENT_USERNAME,
  DocumentService,
  NuxeoApiBase,
  TaskService,
  type NuxeoDocument,
  type NuxeoTask,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Observable, TimeoutError, catchError, map, of, throwError, timeout } from 'rxjs';

import type { HomeKpi, HomeRecent, HomeTasks } from './home-file';

/** As for the layout reads: `HttpClient` has no timeout of its own. */
export const HOME_LOAD_TIMEOUT_MS = 10_000;

/**
 * Where a queue opens, for the home's links to queues: the router link of the queue `id`.
 *
 * The app gives `queueLink` from `libs/shared/queues`, `/queues/<id>`, on its home route. `null`,
 * the default, is for a host with no queue page: the home then leaves out a card that is only a
 * link to a queue, and draws no link on a KPI.
 */
export const HOME_QUEUE_LINK = new InjectionToken<
  ((queue: string) => string | readonly unknown[]) | null
>('HOME_QUEUE_LINK', { factory: () => null });

/**
 * Where the tasks page opens, for a list of tasks: the router link of the task `id`, or of the page
 * itself when `id` is left out.
 *
 * The app gives its own, `/tasks` and `/tasks/<id>`, on its home route. `null`, the default, is for
 * a host with no tasks page: the home then leaves out a list of tasks, which would open nothing.
 */
export const HOME_TASKS_LINK = new InjectionToken<
  ((id?: string) => string | readonly unknown[]) | null
>('HOME_TASKS_LINK', { factory: () => null });

/** What reading `home.json`, or `navigation.json`, found. */
export type HomeLoad =
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable'; readonly reason: string }
  | { readonly kind: 'file'; readonly content: unknown };

/**
 * Where the development server serves `home.json`, beside the layouts in the directory the
 * configuration service answers from (app-definition-v2.md, section 10):
 * `agentic-ui-config/home.json`, from `npm run config:dev -- --home <file>`. The configuration
 * servlet of `nuxeo-agentic-core` does not answer there; on a server, the app registry serves the
 * home of the app open (`APP_DEFINITION_FILES`).
 */
export function homeFileUrl(bootstrapUrl: string): string {
  const path = bootstrapUrl.split(/[?#]/, 1)[0] ?? '';
  return `${path.slice(0, path.lastIndexOf('/') + 1)}home.json`;
}

/**
 * Where the development server serves `navigation.json`, the app's menu, beside `home.json`
 * (app-definition-v2.md, section 9): `agentic-ui-config/navigation.json`, from
 * `npm run config:dev -- --navigation <file>`. As for the home, a server's app registry serves it.
 */
export function navigationFileUrl(bootstrapUrl: string): string {
  const path = bootstrapUrl.split(/[?#]/, 1)[0] ?? '';
  return `${path.slice(0, path.lastIndexOf('/') + 1)}navigation.json`;
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
 * The home's reads: its file, the page provider results its KPIs count, and its lists, the
 * person's tasks and recent records.
 *
 * The file is read through `APP_DEFINITION_FILES`: where the development server serves it, past the
 * interceptors as the layouts are, and otherwise, where the app provides the registry, from the app
 * registry, after sign-in. The results are read through `NuxeoApiBase`, as every other REST call
 * is, so they are the signed-in person's: the server returns only what they may read. The lists
 * are the reads the tasks page and Recently viewed already make, `TaskService.getUserTasks` and
 * `DocumentService.getRecentlyViewed`.
 */
@Injectable({ providedIn: 'root' })
export class HomeService {
  private readonly api = inject(NuxeoApiBase);
  private readonly files = inject(APP_DEFINITION_FILES);
  private readonly bootstrapUrl = inject(APP_BOOTSTRAP_CONFIG_URL);
  private readonly taskService = inject(TaskService);
  private readonly documents = inject(DocumentService);
  private readonly username = inject(CURRENT_USERNAME);

  /** The home file as served; `none` when nothing is served there (404). Never errors. */
  load(): Observable<HomeLoad> {
    return this.read('home.json', homeFileUrl(this.bootstrapUrl));
  }

  /** The menu file as served; `none` when nothing is served there (404). Never errors. */
  loadNavigation(): Observable<HomeLoad> {
    return this.read('navigation.json', navigationFileUrl(this.bootstrapUrl));
  }

  private read(path: string, url: string): Observable<HomeLoad> {
    return this.files.file(path, url).pipe(
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

  /**
   * The signed-in person's open tasks, newest first, at most `list.limit`, of `list.workflow` alone
   * when it names one. Errors with what went wrong, as a text.
   */
  tasks(list: HomeTasks): Observable<readonly NuxeoTask[]> {
    const user = this.username();
    if (user === null) return throwError(() => new Error('no one is signed in'));
    return this.taskService
      .getUserTasks(user, list.limit, undefined, list.workflow ?? undefined)
      .pipe(
        timeout(HOME_LOAD_TIMEOUT_MS),
        catchError((error: unknown) => throwError(() => new Error(describe(error)))),
      );
  }

  /**
   * The records the signed-in person created or edited last, at most `list.limit`, of `list.types`
   * alone when it names some: what the app's Recently viewed lists. Errors with what went wrong.
   */
  recent(list: HomeRecent): Observable<readonly NuxeoDocument[]> {
    const user = this.username();
    if (user === null) return throwError(() => new Error('no one is signed in'));
    return this.documents.getRecentlyViewed(user, list.limit, list.types).pipe(
      timeout(HOME_LOAD_TIMEOUT_MS),
      map((found) => found.entries ?? []),
      catchError((error: unknown) => throwError(() => new Error(describe(error)))),
    );
  }
}
