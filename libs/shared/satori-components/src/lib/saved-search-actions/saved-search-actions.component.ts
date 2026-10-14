import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { TranslatePipe } from '@ngx-translate/core';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { DocumentDetailService } from '@nuxeo-satori/platform/nuxeo-client';

/** The permission Web UI requires on a saved search before it offers to change it. */
const EDIT_PERMISSION = 'WriteProperties';

/**
 * The actions on the search being shown — Web UI's `nuxeo-saved-search-actions`.
 *
 * Offers Save as whenever there is something to save, and, on an open saved search the user may
 * change, Save (once its filters have changed), Rename, Share and Delete. Whether the user may change
 * it is the server's answer: the saved search's `WriteProperties` permission, read when it opens. A
 * search shared read-only can still be saved as a copy. It emits what was chosen; the host asks for
 * names and confirmations and sends the requests.
 */
@Component({
  selector: 'nxs-saved-search-actions',
  standalone: true,
  templateUrl: './saved-search-actions.component.html',
  styleUrl: './saved-search-actions.component.scss',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-saved-search-actions' },
})
export class NxsSavedSearchActionsComponent {
  /** The saved search open now, or an empty string for none. */
  readonly savedSearchId = input('');
  /** Whether the filters differ from the open saved search's. */
  readonly dirty = input(false);
  /** Whether any filter is set: with no saved search open, the only thing Save as can save. */
  readonly hasFilters = input(false);

  /** Save the filters as a new saved search. */
  readonly saveAs = output<void>();
  /** Save the filters into the open saved search. */
  readonly save = output<void>();
  /** Rename the open saved search. */
  readonly rename = output<void>();
  /** Share the open saved search. */
  readonly share = output<void>();
  /** Delete the open saved search. */
  readonly remove = output<void>();

  private readonly documents = inject(DocumentDetailService);

  /**
   * Whether the user may change the open saved search: `true` only once the server has said so, so
   * Save, Rename, Share and Delete stay hidden while it is asked and when it cannot answer.
   */
  protected readonly canEdit = toSignal(
    toObservable(this.savedSearchId).pipe(
      switchMap((id) =>
        id.trim()
          ? this.documents.getDocumentPermissions(id).pipe(
              map((doc) => {
                const permissions = doc.contextParameters?.['permissions'];
                return Array.isArray(permissions) && permissions.includes(EDIT_PERMISSION);
              }),
              catchError(() => of(false)),
              startWith(false),
            )
          : of(false),
      ),
    ),
    { initialValue: false },
  );

  protected readonly isSaved = computed(() => this.savedSearchId().trim().length > 0);
  protected readonly showSaveAs = computed(() => this.isSaved() || this.hasFilters());
  protected readonly showSave = computed(() => this.isSaved() && this.dirty() && this.canEdit());
  protected readonly showMenu = computed(() => this.isSaved() && this.canEdit());
}
