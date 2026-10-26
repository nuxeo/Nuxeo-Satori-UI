import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';
import { BrowseService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import { nxsErrorStatus, type NxsErrorStatus } from '../error-state/error-status';

/** What the rename dialog needs from the page that opens it. */
export interface NxsRenameDialogData {
  /** The document to rename. */
  readonly documentId: string;
  /** Its title now, which the field starts from. */
  readonly title: string;
}

/**
 * Renames a document, as a `MatDialog`: `dialog.open(NxsRenameDialogComponent, { data })`.
 *
 * Renaming is a change of the document's title, `dc:title`, as in Nuxeo Web UI; the name in its
 * path does not change, so links to it keep working. The dialog writes the title itself and closes
 * with the updated document. A refusal stays in the dialog with the reason — no permission, or the
 * document locked by someone else — so the user can cancel or try again; nothing is lost.
 */
@Component({
  selector: 'nxs-rename-dialog',
  standalone: true,
  templateUrl: './rename-dialog.component.html',
  styleUrl: './rename-dialog.component.scss',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-rename-dialog' },
})
export class NxsRenameDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<NxsRenameDialogComponent, NuxeoDocument>>(MatDialogRef);
  private readonly browse = inject(BrowseService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly data = inject<NxsRenameDialogData>(MAT_DIALOG_DATA);

  protected readonly title = signal(this.data.title ?? '');
  protected readonly saving = signal(false);
  protected readonly failure = signal<NxsErrorStatus | 409 | null>(null);
  protected readonly trimmed = computed(() => this.title().trim());
  protected readonly unchanged = computed(() => this.trimmed() === (this.data.title ?? '').trim());
  protected readonly canSave = computed(
    () => !this.saving() && this.trimmed().length > 0 && !this.unchanged(),
  );

  protected save(): void {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.failure.set(null);
    this.browse
      .updateDocument(this.data.documentId, { 'dc:title': this.trimmed() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (doc) => this.dialogRef.close(doc),
        error: (error: unknown) => {
          this.saving.set(false);
          const status = (error as { status?: unknown } | null)?.status;
          this.failure.set(status === 409 ? 409 : nxsErrorStatus(error));
        },
      });
  }

  protected cancel(): void {
    this.dialogRef.close();
  }
}
