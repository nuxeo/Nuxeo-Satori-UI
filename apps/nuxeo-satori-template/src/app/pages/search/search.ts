import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, debounceTime, map, of, startWith, switchMap } from 'rxjs';

import { SearchService, type SearchResultItem } from '@nuxeo/satori-platform/nuxeo-client';

import { formatBytes, formatTimestamp } from '../documents/document-fields';

interface ResultRow {
  readonly uid: string;
  readonly title: string;
  readonly type: string;
  readonly path: string;
  readonly author: string;
  readonly modified: string;
  readonly size: string;
}

type SearchState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'results'; readonly term: string; readonly rows: readonly ResultRow[] };

/** Below this, a query matches most of the repository and tells the user nothing. */
const MINIMUM_TERM_LENGTH = 2;

/**
 * Full-text search over the repository, through `SearchService`.
 *
 * It calls the `default_search` page provider — the same one the product's own
 * search screen uses — rather than assembling NXQL here. That matters for a
 * customer: the provider is configured **on the Nuxeo server**, so an
 * administrator can change what is searchable without this application being
 * rebuilt, and the results already carry the aggregations a fork would need to
 * add facets.
 */
@Component({
  selector: 'app-search',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './search.html',
  styleUrl: './search.scss',
})
export class SearchComponent {
  private readonly search = inject(SearchService);

  protected readonly term = signal('');

  /**
   * A named constant, not an inline `{ kind: 'idle' }`.
   *
   * `toSignal` has an overload for a source that may not have emitted, and an
   * inline literal makes TypeScript pick it — so the signal came back as
   * `SearchState | undefined` and every narrowing below failed to compile. Giving
   * the initial value the union's type pins the right overload.
   */
  private static readonly INITIAL: SearchState = { kind: 'idle' };

  private readonly state = toSignal(
    toObservable(this.term).pipe(
      // Typing is not a search. Without this every keystroke is a round trip and
      // the results flicker between prefixes of the word being typed.
      debounceTime(250),
      switchMap((raw) => {
        const term = raw.trim();
        if (term.length < MINIMUM_TERM_LENGTH) return of<SearchState>({ kind: 'idle' });
        return this.search.search({ ecmFulltext: term, pageSize: 25 }).pipe(
          map((response): SearchState => ({
            kind: 'results',
            term,
            rows: response.items.map(toRow),
          })),
          catchError((error: unknown) =>
            of<SearchState>({ kind: 'error', message: describe(error) }),
          ),
          startWith<SearchState>({ kind: 'searching' }),
        );
      }),
    ),
    { initialValue: SearchComponent.INITIAL },
  );

  protected readonly searching = computed(() => this.state().kind === 'searching');

  protected readonly errorMessage = computed(() => {
    const state = this.state();
    return state.kind === 'error' ? state.message : null;
  });

  protected readonly results = computed(() => {
    const state = this.state();
    return state.kind === 'results' ? state : null;
  });

  protected onTerm(event: Event): void {
    this.term.set((event.target as HTMLInputElement).value);
  }
}

function toRow(item: SearchResultItem): ResultRow {
  return {
    uid: item.id,
    title: item.title,
    type: item.type,
    path: item.path ?? '—',
    author: item.author || '—',
    modified: formatTimestamp(item.modifiedDate),
    size: formatBytes(item.sizeInBytes ?? null),
  };
}

function describe(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) return 'Nuxeo rejected the session. Sign in again.';
    if (error.status === 0) return 'Could not reach Nuxeo.';
    return `Nuxeo answered HTTP ${error.status}.`;
  }
  return error instanceof Error ? error.message : 'Search failed.';
}
