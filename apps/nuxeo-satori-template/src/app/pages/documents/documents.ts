import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import {
  BrowseService,
  cumulativeNuxeoPathPrefixes,
  isFolderishDocument,
  normalizeNuxeoPath,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';

import { formatBytes, formatTimestamp, mainBlob, stringProperty } from './document-fields';

/**
 * Where browsing starts when no `?path=` is given.
 *
 * A Layer 0 candidate rather than a constant, and deliberately not one yet: the
 * point of the template is to show a customer what to configure, and inventing a
 * `bootstrap.json` key that only this page reads would be inventing surface for
 * the sake of it. A fork that needs it adds the key and reads
 * `AppConfigService.bootstrap()`.
 */
const DEFAULT_ROOT_PATH = '/default-domain/workspaces';

interface FolderRow {
  readonly uid: string;
  readonly title: string;
  readonly type: string;
  readonly path: string;
  readonly folderish: boolean;
  readonly modified: string;
  readonly creator: string;
  readonly size: string;
  readonly description: string | null;
}

type BrowseState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly folder: NuxeoDocument;
      readonly rows: readonly FolderRow[];
      readonly hasMore: boolean;
    };

/**
 * The customer's document browser, built on `BrowseService`.
 *
 * This is the page that makes the template a content application rather than a
 * diagnostics harness: `getBrowseFolderContents()` is the same call the product's
 * own browse feature makes, and every row on screen is a document Nuxeo actually
 * returned.
 *
 * ## Why the load is a stream and not a `subscribe`
 *
 * The path is a route input, so it changes without the component being recreated.
 * `toObservable(path) → switchMap` cancels the request for the folder the user
 * just left; a `subscribe` in an `effect` would leave both in flight and let the
 * slower one win, which is how a browse list ends up showing the previous
 * folder's children. `toSignal` owns the subscription, so there is nothing to
 * unsubscribe by hand.
 */
@Component({
  selector: 'app-documents',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './documents.html',
  styleUrl: './documents.scss',
})
export class DocumentsComponent {
  private readonly browse = inject(BrowseService);

  /** Bound from `?path=` by `withComponentInputBinding()`. */
  readonly path = input<string>('');

  protected readonly currentPath = computed(() =>
    normalizeNuxeoPath(this.path() || DEFAULT_ROOT_PATH),
  );

  /** See the note in `SearchComponent`: an inline literal picks the wrong `toSignal` overload. */
  private static readonly INITIAL: BrowseState = { kind: 'loading' };

  protected readonly state = toSignal(
    toObservable(this.currentPath).pipe(
      switchMap((path) =>
        this.browse.getBrowseFolderContents(path, 100).pipe(
          map((contents): BrowseState => ({
            kind: 'ready',
            folder: contents.folder,
            rows: contents.entries.map(toRow),
            hasMore: contents.hasNextPage === true,
          })),
          catchError((error: unknown) =>
            of<BrowseState>({ kind: 'error', message: describe(error) }),
          ),
          // Without this the previous folder's rows stay on screen for the whole
          // round trip, which reads as "the click did nothing".
          startWith<BrowseState>({ kind: 'loading' }),
        ),
      ),
    ),
    { initialValue: DocumentsComponent.INITIAL },
  );

  /**
   * Narrowed views of {@link state}, so the template never needs `$any()`.
   *
   * A discriminated union is the right model for "loading, failed or here", but
   * Angular's template type checker cannot narrow `state().kind` across a
   * `@switch`, so reading `state().message` inside the error branch is an error.
   * Narrowing in TypeScript and exposing the branches keeps the template honest.
   */
  protected readonly errorMessage = computed(() => {
    const state = this.state();
    return state.kind === 'error' ? state.message : null;
  });

  protected readonly loading = computed(() => this.state().kind === 'loading');

  protected readonly ready = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? state : null;
  });

  /** Clickable ancestors, from the repository root down to the open folder. */
  protected readonly breadcrumbs = computed(() =>
    cumulativeNuxeoPathPrefixes(this.currentPath()).map((prefix) => ({
      path: prefix,
      label: prefix.split('/').filter(Boolean).at(-1) ?? prefix,
    })),
  );
}

function toRow(doc: NuxeoDocument): FolderRow {
  const blob = mainBlob(doc);
  return {
    uid: doc.uid,
    // `dc:title` is the authoritative title; `doc.title` is Nuxeo's own
    // convenience copy and is absent from some page-provider payloads.
    title: stringProperty(doc, 'dc:title') ?? doc.title ?? doc.uid,
    type: doc.type,
    path: doc.path,
    folderish: isFolderishDocument(doc),
    modified: formatTimestamp(stringProperty(doc, 'dc:modified') ?? doc.lastModified),
    creator: stringProperty(doc, 'dc:creator') ?? '—',
    size: formatBytes(blob?.length ?? null),
    description: stringProperty(doc, 'dc:description'),
  };
}

function describe(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) return 'Nuxeo rejected the session. Sign in again.';
    if (error.status === 403) return 'You do not have permission to read this folder.';
    if (error.status === 404) return 'That path does not exist in the repository.';
    if (error.status === 0) return 'Could not reach Nuxeo.';
    return `Nuxeo answered HTTP ${error.status}.`;
  }
  return error instanceof Error ? error.message : 'Unable to load this folder.';
}
