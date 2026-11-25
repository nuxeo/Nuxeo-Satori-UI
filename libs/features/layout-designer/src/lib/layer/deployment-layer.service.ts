import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, Injector, inject } from '@angular/core';
import { APP_REGISTRY_PATH, AppRegistryService } from '@agentic-ui/shared/app-registry';
import { NUXEO_API_ORIGIN } from '@nuxeo/satori-platform/nuxeo-client';
import { Observable, catchError, from, map, of, startWith, switchMap } from 'rxjs';

import {
  readLayerRefusal,
  readLayerState,
  type LayerAction,
  type LayerRefusal,
  type LayerState,
} from './layer-state';

/**
 * The header a change carries (`LayerEndpoint.CHANGE_HEADER`), which a page on another site cannot
 * send without a preflight the server answers no.
 */
export const LAYER_CHANGE_HEADER = 'X-Agentic-Layer-Change';

/** What reading or changing a file of the layer gave. */
export type LayerReading =
  | { readonly kind: 'reading' }
  | { readonly kind: 'state'; readonly state: LayerState }
  /**
   * There is no layer to read: no app open (`no-app`), the layer switched off on the server
   * (`off`), or the person not an administrator, as the server counts them (`forbidden`).
   */
  | { readonly kind: 'unavailable'; readonly reason: 'no-app' | 'off' | 'forbidden' }
  | { readonly kind: 'refused'; readonly refusal: LayerRefusal }
  | { readonly kind: 'failed'; readonly problem: string };

/** A change, as the server takes it: `{ action, revision, content?, to? }`. */
export interface LayerChange {
  readonly action: LayerAction;
  readonly revision: number;
  readonly content?: unknown;
  /** For a rollback: the version to restore, 0 for the package's file; the one before by default. */
  readonly to?: number;
}

/** As the registry's reads: a 401 without the browser's own sign-in prompt. */
const NO_PROMPT = { 'X-No-Basic-Header': 'true' };

function problemOf(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status !== 0) return `HTTP ${error.status}`;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message !== '' ? message : 'the request failed';
}

/**
 * The app open's deployment layer, as the designer reads and changes it, at the app registry's
 * address (`LayerEndpoint` in `nuxeo-agentic-core`), with the person's credentials through the
 * app's interceptors. Reads are GET; a change is a POST of JSON with {@link LAYER_CHANGE_HEADER}.
 *
 * The server decides: who may read or change a layer, whether a file passes the validator, and who
 * may approve. What this reads of the person's permissions only says which buttons may do anything.
 */
@Injectable({ providedIn: 'root' })
export class DeploymentLayerService {
  private readonly http = inject(HttpClient);
  private readonly registry = inject(AppRegistryService);
  private readonly injector = inject(Injector);

  /** The file at `path` of the app open's layer: `reading`, then the state or why there is none. */
  state(path: string): Observable<LayerReading> {
    const read = (url: string): Observable<LayerReading> =>
      this.http.get<unknown>(url, { headers: new HttpHeaders(NO_PROMPT) }).pipe(
        map((raw) => this.answer(raw)),
        catchError((error: unknown) => of(this.failure(error))),
      );
    return this.withApp(read, path).pipe(startWith({ kind: 'reading' } as const));
  }

  /** Makes one change to the file at `path`, answered with the file as it is then, or the refusal. */
  act(path: string, change: LayerChange): Observable<LayerReading> {
    return this.withApp(
      (url) =>
        this.http
          .post<unknown>(url, change, {
            headers: new HttpHeaders({
              ...NO_PROMPT,
              'Content-Type': 'application/json',
              [LAYER_CHANGE_HEADER]: '1',
            }),
          })
          .pipe(
            map((raw) => this.answer(raw)),
            catchError((error: unknown) => of(this.failure(error))),
          ),
      path,
    );
  }

  /** The file's address in the app open's layer, or `no-app` when the registry lists none. */
  private withApp(
    request: (url: string) => Observable<LayerReading>,
    path: string,
  ): Observable<LayerReading> {
    return from(this.registry.load()).pipe(
      switchMap(() => {
        const app = this.registry.current();
        if (!app) return of({ kind: 'unavailable', reason: 'no-app' } as const);
        const origin = this.injector.get(NUXEO_API_ORIGIN).replace(/\/$/, '');
        const file = path.split('/').map(encodeURIComponent).join('/');
        return request(
          `${origin}${APP_REGISTRY_PATH}apps/${encodeURIComponent(app.id)}/layer/${file}`,
        );
      }),
      catchError((error: unknown) =>
        of<LayerReading>({ kind: 'failed', problem: problemOf(error) }),
      ),
    );
  }

  private answer(raw: unknown): LayerReading {
    const state = readLayerState(raw);
    return state
      ? { kind: 'state', state }
      : { kind: 'failed', problem: "the server's answer is not a deployment layer's" };
  }

  private failure(error: unknown): LayerReading {
    if (!(error instanceof HttpErrorResponse) || error.status === 0)
      return { kind: 'failed', problem: problemOf(error) };
    if (error.status === 403 && (error.error as { error?: unknown } | null)?.error === 'forbidden')
      return { kind: 'unavailable', reason: 'forbidden' };
    if (error.status === 404) return { kind: 'unavailable', reason: 'off' };
    return { kind: 'refused', refusal: readLayerRefusal(error.status, error.error) };
  }
}
