import { DestroyRef, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Subject,
  catchError,
  concat,
  defer,
  map,
  of,
  switchMap,
  timer,
  type Observable,
} from 'rxjs';

/**
 * Where a search-as-you-type field is: nothing typed, too few characters, waiting on the server,
 * results, none, or a failed request.
 */
export type NxsSearchStatus = 'idle' | 'short' | 'searching' | 'found' | 'none' | 'failed';

export interface NxsSearchState<T> {
  readonly status: NxsSearchStatus;
  /** The term the state is for, without its surrounding whitespace. */
  readonly term: string;
  readonly results: readonly T[];
}

export interface NxsSearchAsYouType<T> {
  readonly state: Signal<NxsSearchState<T>>;
  /** Search for what the user typed. */
  query(text: string): void;
  /** Forget the term and its results, as after a choice. */
  reset(): void;
}

/** Web UI's selectivity waits 300 ms after the last key before it asks the server. */
export const NXS_SEARCH_DEBOUNCE_MS = 300;

/**
 * A search that follows what the user types: `short` below `minChars`, `searching` at once, and the
 * server asked once the user has paused for `NXS_SEARCH_DEBOUNCE_MS`. A newer term cancels an older
 * request, so a late answer never replaces the results for what is typed now, and a failed request
 * is a state rather than an error, so the field keeps working. Call it in an injection context; the
 * subscription ends with the component.
 */
export function nxsSearchAsYouType<T>(
  search: (term: string) => Observable<readonly T[]>,
  minChars: () => number,
): NxsSearchAsYouType<T> {
  const idle: NxsSearchState<T> = { status: 'idle', term: '', results: [] };
  const state = signal<NxsSearchState<T>>(idle);
  const terms = new Subject<string | null>();
  terms
    .pipe(
      switchMap((text): Observable<NxsSearchState<T>> => {
        const term = (text ?? '').trim();
        if (!term) return of(idle);
        if (term.length < Math.max(1, minChars()))
          return of({ status: 'short', term, results: [] });
        return concat(
          of<NxsSearchState<T>>({ status: 'searching', term, results: [] }),
          timer(NXS_SEARCH_DEBOUNCE_MS).pipe(
            switchMap(() => defer(() => search(term))),
            map((results): NxsSearchState<T> => ({
              status: results.length ? 'found' : 'none',
              term,
              results,
            })),
            catchError(() => of<NxsSearchState<T>>({ status: 'failed', term, results: [] })),
          ),
        );
      }),
      takeUntilDestroyed(inject(DestroyRef)),
    )
    .subscribe((next) => state.set(next));
  return {
    state: state.asReadonly(),
    query: (text) => terms.next(text),
    reset: () => terms.next(null),
  };
}
