import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, ChangeDetectionStrategy } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, from, map, of, startWith, switchMap } from 'rxjs';

import {
  DocumentDetailService,
  parentNuxeoFolderPath,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';

import { formatBytes, formatTimestamp, mainBlob, stringProperty } from './document-fields';

interface Fact {
  readonly label: string;
  readonly value: string;
}

type DetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly doc: NuxeoDocument };

/**
 * One document, its metadata, and its actual content.
 *
 * The content preview is the part worth pointing at: it fetches the **blob**
 * through `DocumentDetailService.fetchBlob()` and reads it as text. That is the
 * only correct way to get a Nuxeo binary into a page — a `<img [src]>` or a bare
 * `fetch()` would bypass this application's auth interceptor and 401. Because it
 * renders the text rather than a URL, there is no object URL to revoke; a fork
 * previewing images must create one **and** revoke it on destroy.
 */
@Component({
  selector: 'app-document-detail',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './document-detail.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './document-detail.scss',
})
export class DocumentDetailComponent {
  private readonly documents = inject(DocumentDetailService);

  /** Bound from the `:uid` route parameter by `withComponentInputBinding()`. */
  readonly uid = input.required<string>();

  /** See the note in `SearchComponent`: an inline literal picks the wrong `toSignal` overload. */
  private static readonly INITIAL: DetailState = { kind: 'loading' };

  private readonly state = toSignal(
    toObservable(this.uid).pipe(
      switchMap((uid) =>
        this.documents.getFullDocument(uid).pipe(
          map((doc): DetailState => ({ kind: 'ready', doc })),
          catchError((error: unknown) =>
            of<DetailState>({ kind: 'error', message: describe(error) }),
          ),
          startWith<DetailState>({ kind: 'loading' }),
        ),
      ),
    ),
    { initialValue: DocumentDetailComponent.INITIAL },
  );

  protected readonly loading = computed(() => this.state().kind === 'loading');

  protected readonly errorMessage = computed(() => {
    const state = this.state();
    return state.kind === 'error' ? state.message : null;
  });

  protected readonly doc = computed(() => {
    const state = this.state();
    return state.kind === 'ready' ? state.doc : null;
  });

  protected readonly parentPath = computed(() => {
    const doc = this.doc();
    return doc ? parentNuxeoFolderPath(doc.path) : null;
  });

  /** Dublin Core and lifecycle facts, skipping anything Nuxeo did not return. */
  protected readonly facts = computed<readonly Fact[]>(() => {
    const doc = this.doc();
    if (!doc) return [];
    const blob = mainBlob(doc);
    const candidates: readonly (Fact | null)[] = [
      { label: 'Type', value: doc.type },
      { label: 'Path', value: doc.path },
      { label: 'UID', value: doc.uid },
      { label: 'Lifecycle state', value: doc.state ?? '—' },
      { label: 'Created', value: formatTimestamp(stringProperty(doc, 'dc:created')) },
      {
        label: 'Modified',
        value: formatTimestamp(stringProperty(doc, 'dc:modified') ?? doc.lastModified),
      },
      { label: 'Author', value: stringProperty(doc, 'dc:creator') ?? '—' },
      {
        label: 'Last contributor',
        value: stringProperty(doc, 'dc:lastContributor') ?? '—',
      },
      nullable('Source', stringProperty(doc, 'dc:source')),
      nullable('Rights', stringProperty(doc, 'dc:rights')),
      nullable('File name', blob?.name ?? null),
      nullable('MIME type', blob?.mimeType ?? null),
      blob ? { label: 'Size', value: formatBytes(blob.length) } : null,
    ];
    return candidates.filter((fact): fact is Fact => fact !== null);
  });

  protected readonly description = computed(() => {
    const doc = this.doc();
    return doc ? stringProperty(doc, 'dc:description') : null;
  });

  /** A `Note`'s body lives in a property, not a blob. */
  protected readonly noteContent = computed(() => {
    const doc = this.doc();
    return doc ? stringProperty(doc, 'note:note') : null;
  });

  /**
   * The blob's text, for the text/* documents this repository holds.
   *
   * Keyed on the uid rather than on `doc()` so switching documents cancels the
   * previous download instead of racing it.
   */
  protected readonly preview = toSignal<string | null, null>(
    toObservable(computed(() => this.textBlobUid())).pipe(
      switchMap((uid) => {
        if (!uid) return of(null);
        return this.documents.fetchBlob(uid).pipe(
          switchMap((blob) => from(blob.text())),
          map((text) => (text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text)),
          catchError(() => of(null)),
          startWith(null),
        );
      }),
    ),
    { initialValue: null },
  );

  private textBlobUid(): string | null {
    const doc = this.doc();
    if (!doc) return null;
    const blob = mainBlob(doc);
    if (!blob?.mimeType?.startsWith('text/')) return null;
    return doc.uid;
  }
}

function nullable(label: string, value: string | null): Fact | null {
  return value === null ? null : { label, value };
}

function describe(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 401) return 'Nuxeo rejected the session. Sign in again.';
    if (error.status === 403) return 'You do not have permission to read this document.';
    if (error.status === 404) return 'That document no longer exists.';
    if (error.status === 0) return 'Could not reach Nuxeo.';
    return `Nuxeo answered HTTP ${error.status}.`;
  }
  return error instanceof Error ? error.message : 'Unable to load this document.';
}
