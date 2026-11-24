import {
  DestroyRef,
  Injectable,
  Injector,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { EMPTY, of } from 'rxjs';
import { catchError, filter, map, switchMap } from 'rxjs/operators';

import {
  NxsFolderPickerDialogComponent,
  NxsRenameDialogComponent,
  NxsToastService,
  type NxsFolderPickerDialogData,
  type NxsFolderPickerDialogResult,
  type NxsRenameDialogData,
} from '@nuxeo/satori-platform/components';
import {
  ExtensionActionRegistry,
  type ExtensionActionHandler,
} from '@nuxeo/satori-platform/extensions';
import {
  BrowseContextService,
  BrowseService,
  DocumentChangesService,
  DocumentDetailService,
  PERMISSION_DENIED_KEY,
  SelectionService,
  canRemoveDocument,
  isBrowsableNavNode,
  isCollectionDocument,
  isPermissionDeniedError,
  parentNuxeoFolderPath,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';

import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '../confirm-dialog/confirm-dialog.component';
import { trashDocumentConfirmData } from '../confirm-dialog/trash-confirm.utils';

/**
 * What the platform's row actions do, on whichever list offered them: browse's, a record page's
 * list of related records, a queue's, or any other list that resolves the `rowActions` slot.
 *
 * One instance for the whole app, provided with its registration by
 * {@link providePackagedRowActions}. Its dialogs open from the root `MatDialog`, so they need
 * nothing from the page the list is on.
 *
 * It does not reload the list. After a change it notifies `DocumentChangesService`, and each list
 * on screen asks again. It also asks the folder tree to reload, and takes a moved or trashed
 * document out of the selection, as browse did when it ran these itself.
 *
 * Nothing here is a permission check: the descriptors' rules decide what is offered, and Nuxeo
 * checks the rename, the copy, the move and the trash on the request itself.
 */
@Injectable()
export class RowActionsService {
  private readonly translate = inject(TranslateService);
  private readonly dialog = inject(MatDialog);
  /**
   * Its own toast, unless the environment provides one, as a host or a spec may. `NxsToastService`
   * is not provided in root on purpose: a component lists `provideNxsToast()`, and one that forgets
   * fails at once rather than borrowing an instance that outlives it.
   */
  private readonly toast = inject(NxsToastService, { optional: true }) ?? new NxsToastService();
  private readonly detail = inject(DocumentDetailService);
  private readonly browse = inject(BrowseService);
  private readonly selection = inject(SelectionService);
  private readonly browseContext = inject(BrowseContextService);
  private readonly documentChanges = inject(DocumentChangesService);
  private readonly destroyRef = inject(DestroyRef);

  /** The document's main file, saved by the browser under the file's own name. */
  download(doc: NuxeoDocument): void {
    this.detail
      .fetchBlob(doc.uid, { clientReason: 'download' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const content = doc.properties?.['file:content'] as { name?: string } | null | undefined;
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = content?.name || doc.title || 'download';
          link.click();
          URL.revokeObjectURL(url);
        },
        error: (err: unknown) =>
          this.toast.error(
            this.translate.instant(
              isPermissionDeniedError(err)
                ? PERMISSION_DENIED_KEY
                : 'browse.message.download-failed',
            ),
          ),
      });
  }

  /** Changes the document's title; its path name stays, so links to it keep working. */
  rename(doc: NuxeoDocument): void {
    // The packaged rule's Immutable restriction, held here too because a manifest may clear the
    // rule, and a version's or publication's permissions still list Write.
    if (doc.facets?.includes('Immutable')) {
      this.toast.error(this.translate.instant(PERMISSION_DENIED_KEY));
      return;
    }
    this.dialog
      .open<NxsRenameDialogComponent, NxsRenameDialogData, NuxeoDocument>(
        NxsRenameDialogComponent,
        {
          data: { documentId: doc.uid, title: doc.title },
        },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((updated) => {
        if (!updated) return;
        this.toast.show(
          this.translate.instant('browse.message.renamed', { name: updated.title ?? doc.title }),
        );
        this.changed();
      });
  }

  /** Chooses a folder, then copies the document there. */
  copyTo(doc: NuxeoDocument): void {
    this.copyOrMove('copy', doc);
  }

  /** Chooses a folder, then moves the document there. */
  moveTo(doc: NuxeoDocument): void {
    this.copyOrMove('move', doc);
  }

  /**
   * Moves the document to the trash, after the same confirmation as browse's header Delete. A
   * collection goes through the collection's own delete, and a Collections folder that still
   * holds collections is refused.
   */
  delete(doc: NuxeoDocument): void {
    if (isCollectionDocument(doc)) {
      this.trashCollection(doc);
      return;
    }
    const guard$ =
      doc.type === 'Collections' ? this.browse.hasChildCollections(doc.uid) : of(false);
    guard$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap((blocked) => {
          if (blocked) {
            this.toast.error(
              this.translate.instant(
                'browse.message.remove-all-collections-from-this-folder-before',
              ),
              { duration: 5000 },
            );
            return EMPTY;
          }
          return this.dialog
            .open(ConfirmDialogComponent, {
              data: trashDocumentConfirmData(doc.title, (key, params) =>
                this.translate.instant(key, params),
              ),
            })
            .afterClosed();
        }),
        filter((confirmed) => confirmed === true),
        switchMap(() => this.detail.trashDocument(doc.uid)),
      )
      .subscribe({
        next: () => {
          if (this.selection.isSelected(doc.uid)) this.selection.toggle(doc.uid);
          this.toast.show(this.translate.instant('browse.message.moved-to-trash'));
          this.changed();
        },
        error: (err: unknown) =>
          this.toast.error(
            this.translate.instant(
              isPermissionDeniedError(err)
                ? PERMISSION_DENIED_KEY
                : 'browse.message.failed-to-delete',
            ),
          ),
      });
  }

  /**
   * The picker opens on the folder the document is in, and when moving does not offer that folder
   * as the destination. A folder cannot be chosen as its own destination, nor anything inside it.
   */
  private copyOrMove(operation: 'copy' | 'move', doc: NuxeoDocument): void {
    const here = doc.path ? parentNuxeoFolderPath(doc.path) : undefined;
    const data: NxsFolderPickerDialogData = {
      heading: this.translate.instant(
        operation === 'copy'
          ? 'browse.row-actions.copy-heading'
          : 'browse.row-actions.move-heading',
        { name: doc.title },
      ),
      confirmLabel: this.translate.instant(
        operation === 'copy' ? 'browse.row-actions.copy-here' : 'browse.row-actions.move-here',
      ),
      initialPath: here,
      excludePath: isBrowsableNavNode(doc) ? doc.path : undefined,
      currentParentPath: operation === 'move' ? here : undefined,
    };
    this.dialog
      .open<NxsFolderPickerDialogComponent, NxsFolderPickerDialogData, NxsFolderPickerDialogResult>(
        NxsFolderPickerDialogComponent,
        { data },
      )
      .afterClosed()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((target): target is NxsFolderPickerDialogResult => !!target),
        switchMap((target) =>
          (operation === 'copy'
            ? this.browse.copyDocuments([doc.uid], target.uid)
            : this.browse.moveDocuments([doc.uid], target.uid)
          ).pipe(map(() => target)),
        ),
      )
      .subscribe({
        next: (target) => {
          this.toast.show(
            this.translate.instant(
              operation === 'copy' ? 'browse.message.copied-to' : 'browse.message.moved-to',
              { name: doc.title, folder: target.title },
            ),
          );
          if (operation === 'move' && this.selection.isSelected(doc.uid)) {
            this.selection.toggle(doc.uid);
          }
          this.changed();
        },
        error: (err: unknown) =>
          this.toast.error(
            this.translate.instant(
              isPermissionDeniedError(err)
                ? PERMISSION_DENIED_KEY
                : operation === 'copy'
                  ? 'browse.message.failed-to-copy'
                  : 'browse.message.failed-to-move',
            ),
          ),
      });
  }

  /**
   * A collection's delete: read again for its permissions, since a listed one may not carry them,
   * refused when it cannot be removed, and confirmed as a collection.
   */
  private trashCollection(doc: NuxeoDocument): void {
    this.detail
      .getFullDocument(doc.uid)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        catchError((err: unknown) => {
          this.toast.error(
            this.translate.instant(
              isPermissionDeniedError(err)
                ? PERMISSION_DENIED_KEY
                : 'browse.message.failed-to-load-collection',
            ),
          );
          return EMPTY;
        }),
        switchMap((fullDoc) => {
          if (!canRemoveDocument(fullDoc)) {
            this.toast.error(this.translate.instant(PERMISSION_DENIED_KEY));
            return EMPTY;
          }
          const data: ConfirmDialogData = {
            title: this.translate.instant('confirm.delete-collection'),
            message: this.translate.instant('confirm.delete-document-named', {
              name: fullDoc.title,
            }),
            confirmLabel: this.translate.instant('confirm.delete'),
          };
          return this.dialog
            .open(ConfirmDialogComponent, { data })
            .afterClosed()
            .pipe(
              filter((confirmed) => !!confirmed),
              switchMap(() => this.detail.trashDocument(fullDoc.uid)),
            );
        }),
      )
      .subscribe({
        next: () => {
          this.selection.clear();
          this.toast.show(this.translate.instant('browse.message.collection-moved-to-trash'));
          this.changed();
        },
        error: (err: unknown) =>
          this.toast.error(
            this.translate.instant(
              isPermissionDeniedError(err)
                ? PERMISSION_DENIED_KEY
                : 'browse.message.failed-to-delete-collection',
            ),
          ),
      });
  }

  /** The folder tree and every list on screen read again. */
  private changed(): void {
    this.browseContext.requestTreeRefresh();
    this.documentChanges.notify();
  }
}

/** The platform's row actions, by descriptor id: what each runs on the row in focus. */
const PACKAGED_ROW_ACTION_RUNS: Readonly<
  Record<string, (actions: RowActionsService, doc: NuxeoDocument) => void>
> = {
  'app.rowActions.download': (actions, doc) => actions.download(doc),
  'app.rowActions.rename': (actions, doc) => actions.rename(doc),
  'app.rowActions.copyTo': (actions, doc) => actions.copyTo(doc),
  'app.rowActions.moveTo': (actions, doc) => actions.moveTo(doc),
  'app.rowActions.delete': (actions, doc) => actions.delete(doc),
};

/**
 * Registers the behaviour of `app.rowActions.download`, `.rename`, `.copyTo`, `.moveTo` and
 * `.delete` once, for the whole app, so every list that offers them runs them.
 *
 * Registered with `registerPackaged`, so a customer's `ExtensionActionRegistry.register()` for the
 * same id outranks it whichever runs first. Each handler runs on the context's focused document,
 * which is the row's, and does nothing without one.
 *
 * The service is resolved when an action first runs, not here: this runs while the environment is
 * created, before the configuration loads, and the Nuxeo services it uses read their API origin
 * from the configuration once.
 */
export function providePackagedRowActions(): EnvironmentProviders {
  return makeEnvironmentProviders([
    RowActionsService,
    provideEnvironmentInitializer(() => {
      const injector = inject(Injector);
      const handlers: Record<string, ExtensionActionHandler> = {};
      for (const [id, run] of Object.entries(PACKAGED_ROW_ACTION_RUNS)) {
        handlers[id] = {
          execute: (context) => {
            if (context.document) run(injector.get(RowActionsService), context.document);
          },
        };
      }
      inject(ExtensionActionRegistry).registerPackaged(handlers);
    }),
  ]);
}
