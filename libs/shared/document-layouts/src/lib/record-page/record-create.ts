import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { NxsButtonComponent, NxsToastService } from '@nuxeo/satori-platform/components';
import {
  DocumentChangesService,
  NuxeoApiBase,
  type NuxeoDocument,
  PageProviderService,
  canAddChildren,
} from '@nuxeo/satori-platform/nuxeo-client';
import { type Observable, catchError, map, of, switchMap } from 'rxjs';

import { isDocumentId } from './linked-record';
import { RecordCreateDialogComponent, type RecordCreateDialogData } from './record-create-dialog';
import type { RecordCreateEntry } from './record-layout';

/** Where a new record would be filed, as the page found it: the folder, with its permissions. */
type Folder = { readonly path: string; readonly title: string } | null;

interface FolderQuery {
  /** The page provider whose first record is the folder, or `null` for the open record's folder. */
  readonly pageProvider: string | null;
  /** The open record's folder, by id: what is read when there is no page provider. */
  readonly parent: string | null;
}

function warn(message: string): void {
  console.warn(`[agentic-ui-layouts] ${message}`);
}

/**
 * A related list's New (layout-v2.md, section 7): a button over the list that opens the type's
 * create form, with the property that refers to the open record given its id, read-only, and files
 * the new record in the open record's folder, or in the first folder the file's page provider
 * finds.
 *
 * Offered once that folder is found, and only where its permissions, as the server answers them,
 * let the person add to it: the same `AddChildren` that Create in Browse asks for. Not a security
 * control: the server decides whether it takes the record, with the person's own permissions and
 * the folder's types, and the dialog says why it did not. Never on a read-only page, nor on a
 * version or a record in the trash.
 *
 * Created, the lists read their page again (`DocumentChangesService`) and a message names the new
 * record; the page stays on the open record.
 */
@Component({
  selector: 'lib-record-create',
  standalone: true,
  imports: [NxsButtonComponent],
  templateUrl: './record-create.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordCreateComponent {
  /** The open record. */
  readonly document = input.required<NuxeoDocument>();
  readonly create = input.required<RecordCreateEntry>();
  /** The button's words, and the dialog's title, already translated. */
  readonly label = input.required<string>();
  readonly readOnly = input(false);
  /** Where it is written, for the console. */
  readonly source = input('');

  private readonly api = inject(NuxeoApiBase);
  private readonly pageProviders = inject(PageProviderService);
  private readonly dialog = inject(MatDialog);
  private readonly changes = inject(DocumentChangesService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(NxsToastService, { optional: true }) ?? new NxsToastService();
  private readonly destroyRef = inject(DestroyRef);

  /** What the folder is found by, compared by value so that the same is not asked twice. */
  private readonly query = computed<FolderQuery | null>(
    () => {
      const document = this.document();
      if (
        this.readOnly() ||
        document.isVersion === true ||
        document.isProxy === true ||
        document.isTrashed === true
      )
        return null;
      const pageProvider = this.create().folder;
      const parent = isDocumentId(document.parentRef) ? document.parentRef : null;
      return pageProvider === null && parent === null ? null : { pageProvider, parent };
    },
    {
      equal: (a, b) =>
        a === b ||
        (a !== null && b !== null && a.pageProvider === b.pageProvider && a.parent === b.parent),
    },
  );

  /** The folder found, which the person may add to; `null` while it is read, and when it is none. */
  protected readonly folder = toSignal(
    toObservable(this.query).pipe(switchMap((query) => (query ? this.find(query) : of(null)))),
    { initialValue: null as Folder },
  );

  protected open(): void {
    const folder = this.folder();
    const document = this.document();
    if (!folder) return;
    const { type, field } = this.create();
    const data: RecordCreateDialogData = {
      type,
      title: this.label(),
      folder,
      reference: { field, id: document.uid, title: document.title },
    };
    this.dialog
      .open<RecordCreateDialogComponent, RecordCreateDialogData, NuxeoDocument>(
        RecordCreateDialogComponent,
        { data, autoFocus: 'dialog', width: '640px', maxWidth: '95vw' },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((created) => {
        if (!created) return;
        this.toast.show(
          this.translate.instant('document-layouts.create.done', { title: created.title }),
        );
        this.changes.notify();
      });
  }

  /** The folder `query` names, with its permissions, when the person may add to it. Never errors. */
  private find(query: FolderQuery): Observable<Folder> {
    const found: Observable<NuxeoDocument | null> =
      query.pageProvider !== null
        ? this.pageProviders
            .execute(query.pageProvider, { pageSize: 1, pageIndex: 0 })
            .pipe(map((page) => page.entries?.[0] ?? null))
        : this.api.get<NuxeoDocument>(
            `/nuxeo/api/v1/id/${encodeURIComponent(query.parent ?? '')}`,
            undefined,
            { 'enrichers.document': 'permissions' },
          );
    return found.pipe(
      map((folder): Folder => {
        if (!folder) {
          warn(`${this.source()}: no New: ${query.pageProvider ?? 'the folder'} found no folder`);
          return null;
        }
        // As Browse's Create asks: a folder whose permissions say the person may add to it.
        if (!canAddChildren(folder)) return null;
        return { path: folder.path, title: folder.title };
      }),
      catchError((error: unknown) => {
        warn(`${this.source()}: no New: the folder could not be read: ${String(error)}`);
        return of(null);
      }),
    );
  }
}
