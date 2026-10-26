import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { catchError, map, of, startWith } from 'rxjs';

import {
  DocumentDetailService,
  SearchService,
  trustObjectUrl,
  type NuxeoDocument,
  type SearchResultItem,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  DocumentViewerComponent,
  ExportDialogComponent,
  ShareDialogComponent,
  WidgetContainerComponent,
  WidgetGridComponent,
  type ExportDialogData,
  type ExportType,
  type ShareDialogData,
} from '@nuxeo/satori-platform/ui';

import {
  formatBytes,
  formatTimestamp,
  mainBlob,
  stringProperty,
} from '../documents/document-fields';

interface Fact {
  readonly label: string;
  readonly value: string;
}

type ListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly items: readonly SearchResultItem[] };

/**
 * A case file — one ECM working surface, assembled only from published platform APIs.
 *
 * This page answers "what can we actually build on this?" with something closer to a real content
 * task than a stat tile. Four things every content application needs, on one screen:
 *
 * | Concern           | Comes from                                                             |
 * | ----------------- | ---------------------------------------------------------------------- |
 * | Finding documents | `SearchService.search()`                                               |
 * | Metadata          | `DocumentDetailService.getFullDocument()` + this template's own readers |
 * | Content preview   | `DocumentViewerComponent`, published by the platform                   |
 * | Actions           | `ShareDialogComponent`, `ExportDialogComponent`, download              |
 *
 * **Every import is a published entry point.** Nothing reaches into `libs/shared/*` or the product
 * application, which is the property that keeps an upgrade a version bump.
 *
 * ## Search results are not documents, and that shape difference is deliberate
 *
 * `search()` answers `SearchResultItem` — a flat row built for a list: `title`, `type`,
 * `modifiedDate`, `lastContributor`. It carries **no `properties` bag and no blob**, so it cannot
 * feed a metadata panel or a preview. Selecting a row therefore fetches the full `NuxeoDocument`
 * with `getFullDocument(id)`. That two-step is what a real ECM UI does, and collapsing it would mean
 * either over-fetching every row or rendering a metadata panel with holes in it.
 *
 * ## The blob lifecycle is the part worth copying
 *
 * A Nuxeo binary must never reach `[src]` as a URL — that request leaves this application's HTTP
 * interceptor behind and answers 401. So the blob is fetched through the service, wrapped in an
 * object URL, and, the half that gets forgotten, **revoked both when the preview is replaced and when
 * the component is destroyed**. `document-detail.ts` sidesteps this by rendering text, and its own
 * comment says a fork previewing binaries has to do the rest. This is that fork.
 */
@Component({
  selector: 'app-case-file',
  standalone: true,
  imports: [WidgetGridComponent, WidgetContainerComponent, DocumentViewerComponent],
  templateUrl: './case-file.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './case-file.scss',
})
export class CaseFileComponent {
  private readonly search = inject(SearchService);
  private readonly documents = inject(DocumentDetailService);
  private readonly dialog = inject(MatDialog);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  /** An inline literal picks the wrong `toSignal` overload — see `SearchComponent`. */
  private static readonly INITIAL: ListState = { kind: 'loading' };

  private readonly listState = toSignal(
    this.search.search({ pageSize: 40 }).pipe(
      map((response): ListState => ({ kind: 'ready', items: response.items })),
      catchError(() =>
        of<ListState>({ kind: 'error', message: 'Could not reach the repository.' }),
      ),
      startWith<ListState>({ kind: 'loading' }),
    ),
    { initialValue: CaseFileComponent.INITIAL },
  );

  protected readonly loading = computed(() => this.listState().kind === 'loading');
  protected readonly error = computed(() => {
    const state = this.listState();
    return state.kind === 'error' ? state.message : null;
  });
  protected readonly items = computed(() => {
    const state = this.listState();
    return state.kind === 'ready' ? state.items : [];
  });

  protected readonly selectedId = signal<string | null>(null);
  /** The full document, fetched on selection. `null` until it arrives. */
  protected readonly doc = signal<NuxeoDocument | null>(null);
  protected readonly detailLoading = signal(false);

  // ---- preview -------------------------------------------------------------------------------
  protected readonly blobUrl = signal<SafeResourceUrl | null>(null);
  protected readonly previewLoading = signal(false);
  /**
   * Held alongside the `SafeResourceUrl` because only the raw string can be revoked — and because
   * the viewer needs it for its `SecurityContext.NONE` bindings (`source[src]`, `audio[src]`,
   * `video[poster]`). Angular never unwraps a `Safe*` value in those, so it would be assigned as
   * its `toString()` and break playback; the wrapped form is still required for `iframe[src]`.
   */
  protected readonly rawObjectUrl = signal<string | null>(null);
  /** `Blob.type` of the previewed blob. See `DocumentViewerComponent.blobType`. */
  protected readonly objectBlobType = signal<string>('');

  /**
   * Bumped on every selection. `takeUntilDestroyed` cancels on teardown but not on *reselection*, so
   * without this a slow response for a previously selected case file can land after a faster one and
   * overwrite `doc` and the preview with stale content. Each continuation compares the generation it
   * captured against the current one and drops out if it has been superseded.
   */
  private selectionGeneration = 0;

  constructor() {
    this.destroyRef.onDestroy(() => this.releaseObjectUrl());
  }

  private releaseObjectUrl(): void {
    this.objectBlobType.set('');
    const raw = this.rawObjectUrl();
    if (raw) {
      URL.revokeObjectURL(raw);
      this.rawObjectUrl.set(null);
    }
  }

  private blobOf(doc: NuxeoDocument | null) {
    return doc ? mainBlob(doc) : null;
  }

  protected readonly facts = computed<readonly Fact[]>(() => {
    const doc = this.doc();
    if (!doc) return [];
    const blob = mainBlob(doc);
    return [
      { label: 'Title', value: stringProperty(doc, 'dc:title') ?? doc.title },
      { label: 'Type', value: doc.type },
      { label: 'Created', value: formatTimestamp(stringProperty(doc, 'dc:created')) },
      { label: 'Modified', value: formatTimestamp(doc.lastModified) },
      { label: 'Creator', value: stringProperty(doc, 'dc:creator') ?? '—' },
      { label: 'Contributor', value: stringProperty(doc, 'dc:lastContributor') ?? '—' },
      { label: 'Attachment', value: blob?.name ?? 'None' },
      { label: 'Size', value: blob ? formatBytes(blob.length) : '—' },
      { label: 'Path', value: doc.path },
    ];
  });

  protected readonly mimeType = computed(() => this.blobOf(this.doc())?.mimeType ?? '');
  protected readonly fileName = computed(() => this.blobOf(this.doc())?.name ?? '');
  protected readonly fileSize = computed(() => {
    const blob = this.blobOf(this.doc());
    return blob ? formatBytes(blob.length) : '';
  });
  protected readonly hasAttachment = computed(() => this.blobOf(this.doc()) !== null);

  protected select(item: SearchResultItem): void {
    const gen = ++this.selectionGeneration;
    this.selectedId.set(item.id);
    // Replacing a preview must release the previous object URL, not only the last one on destroy.
    this.releaseObjectUrl();
    this.blobUrl.set(null);
    this.doc.set(null);
    this.detailLoading.set(true);
    // Reset here too: a selection with no attachment never calls loadPreview, so a spinner left
    // over from the previous selection would never be cleared.
    this.previewLoading.set(false);

    this.documents
      .getFullDocument(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (doc) => {
          if (gen !== this.selectionGeneration) return;
          this.doc.set(doc);
          this.detailLoading.set(false);
          if (mainBlob(doc)) this.loadPreview(doc, gen);
        },
        error: () => {
          if (gen !== this.selectionGeneration) return;
          this.detailLoading.set(false);
        },
      });
  }

  /** @param gen the `selectionGeneration` captured when this preview was requested */
  private loadPreview(doc: NuxeoDocument, gen: number): void {
    this.previewLoading.set(true);
    this.documents
      .fetchBlob(doc.uid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          // A response for a superseded selection must not install itself over the current preview.
          if (gen !== this.selectionGeneration) return;
          // Release whatever is held before replacing it, or the outgoing URL leaks for the
          // lifetime of the page.
          this.releaseObjectUrl();
          const rawUrl = URL.createObjectURL(data);
          this.rawObjectUrl.set(rawUrl);
          // The served Content-Type, which is what gates the viewer's iframe branches.
          this.objectBlobType.set(data.type);
          this.blobUrl.set(trustObjectUrl(this.sanitizer, rawUrl));
          this.previewLoading.set(false);
        },
        error: () => {
          if (gen !== this.selectionGeneration) return;
          this.previewLoading.set(false);
        },
      });
  }

  // ---- actions -------------------------------------------------------------------------------

  protected share(): void {
    const doc = this.doc();
    if (!doc) return;
    const data: ShareDialogData = {
      title: doc.title,
      url: `${location.origin}/case-file?uid=${doc.uid}`,
    };
    this.dialog.open(ShareDialogComponent, { data, width: '520px' });
  }

  protected exportDocument(): void {
    const doc = this.doc();
    if (!doc) return;
    const data: ExportDialogData = {
      documentUid: doc.uid,
      documentTitle: doc.title,
      // The dialog owns the interaction; the host owns how bytes are fetched, because the platform's
      // services never build an auth header themselves.
      exportFn: (_type: ExportType, uid: string) => this.documents.fetchBlob(uid),
    };
    this.dialog.open(ExportDialogComponent, { data, width: '520px' });
  }

  protected download(): void {
    const doc = this.doc();
    const blob = this.blobOf(doc);
    if (!doc || !blob) return;
    this.documents
      .fetchBlob(doc.uid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((data) => {
        const url = URL.createObjectURL(data);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = blob.name ?? doc.title;
        anchor.click();
        // Immediate: the click has already handed the bytes to the browser.
        URL.revokeObjectURL(url);
      });
  }
}
